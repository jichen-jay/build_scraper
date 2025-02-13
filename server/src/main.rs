use std::{net::SocketAddr, process::Command, sync::Arc};
use bytes::Bytes;
use http::{Request, Response, StatusCode};
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use tokio;
use tracing::{error, info};
use url::Url;

use h3::{error::ErrorLevel, quic::BidiStream, server::RequestStream};
use h3_quinn::quinn::{self, crypto::rustls::QuicServerConfig};

static ALPN: &[u8] = b"h3";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_span_events(tracing_subscriber::fmt::format::FmtSpan::FULL)
        .with_writer(std::io::stderr)
        .with_max_level(tracing::Level::INFO)
        .init();

    // Setup TLS configuration
    let cert = CertificateDer::from(std::fs::read("server.cert")?);
    let key = PrivateKeyDer::try_from(std::fs::read("server.key")?)?;

    let mut tls_config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![cert], key)?;

    tls_config.max_early_data_size = u32::MAX;
    tls_config.alpn_protocols = vec![ALPN.into()];

    let server_config = quinn::ServerConfig::with_crypto(Arc::new(QuicServerConfig::try_from(tls_config)?));
    let endpoint = quinn::Endpoint::server(
        server_config,
        "0.0.0.0:5000".parse::<SocketAddr>()?,
    )?;

    info!("listening on 0.0.0.0:5000");

    while let Some(new_conn) = endpoint.accept().await {
        tokio::spawn(async move {
            if let Ok(conn) = new_conn.await {
                info!("new connection established");

                if let Ok(mut h3_conn) = h3::server::Connection::new(h3_quinn::Connection::new(conn)).await {
                    while let Ok(Some((req, stream))) = h3_conn.accept().await {
                        tokio::spawn(async move {
                            if let Err(e) = handle_request(req, stream).await {
                                error!("handling request failed: {}", e);
                            }
                        });
                    }
                }
            }
        });
    }

    endpoint.wait_idle().await;
    Ok(())
}

async fn handle_request<T>(
    req: Request<()>,
    mut stream: RequestStream<T, Bytes>,
) -> Result<(), Box<dyn std::error::Error>>
where
    T: BidiStream<Bytes>,
{
    let query_params = req.uri().query().unwrap_or("");
    let params: Vec<_> = url::form_urlencoded::parse(query_params.as_bytes()).collect();
    
    let target_url = params.iter()
        .find(|(key, _)| key == "url")
        .map(|(_, value)| value.to_string());

    let (status, content) = match target_url {
        None => (
            StatusCode::BAD_REQUEST,
            "Error: Missing \"url\" query parameter.".to_string(),
        ),
        Some(url) => match fetch_url_content(&url) {
            Ok(content) => (StatusCode::OK, content),
            Err(e) => {
                error!("Error processing webpage: {}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, "Error processing the webpage.".to_string())
            }
        },
    };

    let resp = Response::builder()
        .status(status)
        .header("Content-Type", "text/html; charset=utf-8")
        .header("Cache-Control", "no-cache")
        .header("Connection", "keep-alive")
        .body(())
        .unwrap();

    stream.send_response(resp).await?;
    stream.send_data(Bytes::from(content)).await?;
    stream.finish().await?;

    Ok(())
}

fn fetch_url_content(url: &str) -> Result<String, Box<dyn std::error::Error>> {
    let output = Command::new("curl")
        .arg("--silent")
        .arg("--show-error")
        .arg(url)
        .output()?;

    if output.status.success() {
        Ok(String::from_utf8(output.stdout)?)
    } else {
        Err(String::from_utf8(output.stderr)?.into())
    }
}
