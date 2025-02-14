use bytes::Bytes;
use bytes::BytesMut;
use h3::{error::ErrorLevel, quic::BidiStream, server::RequestStream};
use h3_quinn::quinn::{self, crypto::rustls::QuicServerConfig, ServerConfig};
use http::{Request, Response, StatusCode};
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use serde_json::{json, Value};
use std::fs::File;
use std::path::PathBuf;
use std::{
    io::{Read, Write},
    net::SocketAddr,
    net::TcpStream,
    sync::Arc,
};
use tokio;
use tracing::{error, info};
use url::Url;

static ALPN: &[u8] = b"h3";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_span_events(tracing_subscriber::fmt::format::FmtSpan::FULL)
        .with_writer(std::io::stderr)
        .with_max_level(tracing::Level::INFO)
        .init();

    let cert = CertificateDer::from(std::fs::read("localhost.der")?);
    let key = PrivateKeyDer::try_from(std::fs::read("localhost.key.der")?)?;

    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("Failed to install rustls crypto provider");

    let mut tls_config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![cert], key)?;

    tls_config.max_early_data_size = u32::MAX;
    tls_config.alpn_protocols = vec![ALPN.into()];

    let server_config =
        quinn::ServerConfig::with_crypto(Arc::new(QuicServerConfig::try_from(tls_config)?));

    let endpoint = quinn::Endpoint::server(
        server_config,
        "127.0.0.1:4433".parse::<SocketAddr>()?,
        // "0.0.0.0:4433".parse::<SocketAddr>()?,
    )?;

    info!("listening on localhost:4433");

    while let Some(new_conn) = endpoint.accept().await {
        let root = Arc::new(None::<PathBuf>);

        tokio::spawn(async move {
            if let Ok(conn) = new_conn.await {
                info!("new connection established");

                if let Ok(mut h3_conn) =
                    h3::server::Connection::new(h3_quinn::Connection::new(conn)).await
                {
                    while let Ok(Some((req, stream))) = h3_conn.accept().await {
                        let root = root.clone(); // Clone again for the inner spawn
                        tokio::spawn(async move {
                            if let Err(e) = handle_request(req, stream, root).await {
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
    serve_root: Arc<Option<PathBuf>>,
) -> Result<(), Box<dyn std::error::Error>>
where
    T: BidiStream<Bytes>,
{
    let params: Vec<(String, String)> = req
        .uri()
        .query()
        .map(|v| {
            url::form_urlencoded::parse(v.as_bytes())
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect()
        })
        .unwrap_or_default();

    let url = params
        .iter()
        .find(|(k, _)| k == "url")
        .map(|(_, v)| v.clone());

    let response_data = match url {
        Some(url_to_scrape) => match scrape_url(&url_to_scrape) {
            Ok(content) => json!({
                "status": "success",
                "content": content
            }),
            Err(e) => json!({
                "status": "error",
                "error": e.to_string()
            }),
        },
        None => json!({
            "status": "error",
            "error": "No URL provided"
        }),
    };

    let response_bytes = Bytes::from(response_data.to_string());

    let resp = Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/json")
        .body(())?;

    stream.send_response(resp).await?;
    stream.send_data(response_bytes).await?;
    stream.finish().await?;
    Ok(())
}

fn scrape_url(url: &str) -> Result<String, Box<dyn std::error::Error>> {
    let mut stream = TcpStream::connect("127.0.0.1:3000")?;

    let request = format!(
        "POST /scrape HTTP/1.1\r\n\
         Host: localhost:3000\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         \r\n\
         {{\"url\":\"{}\"}}",
        url.len() + 9,
        url
    );

    stream.write_all(request.as_bytes())?;
    stream.flush()?;

    let mut response = String::new();
    stream.read_to_string(&mut response)?;

    if let Some(body_start) = response.find("\r\n\r\n") {
        let json_str = &response[body_start + 4..];
        let parsed: Value = serde_json::from_str(json_str)?;
        Ok(parsed.to_string())
    } else {
        Err("Invalid HTTP response".into())
    }
}
