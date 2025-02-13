use std::{net::SocketAddr, sync::Arc, io::{Write, Read}, net::TcpStream};
use bytes::Bytes;
use http::{Request, Response, StatusCode};
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use tokio;
use tracing::{error, info};
use url::Url;
use serde_json::{Value, json};
use h3_quinn::quinn::{self, ServerConfig, crypto::rustls::QuicServerConfig};
use bytes::BytesMut;
use h3::{error::ErrorLevel, quic::BidiStream, server::RequestStream};
use std::path::PathBuf;
use std::fs::File;

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
    let cert = CertificateDer::from(std::fs::read("localhost.der")?);
    let key = PrivateKeyDer::try_from(std::fs::read("localhost.key.der")?)?;

    rustls::crypto::ring::default_provider()
    .install_default()
    .expect("Failed to install rustls crypto provider");

    let mut tls_config = rustls::ServerConfig::builder()
    .with_no_client_auth()
    .with_single_cert(vec![cert], key)?;

    
    // let mut tls_config = rustls::ServerConfig::builder()
    // .with_safe_defaults()
    // .with_client_cert_verifier(rustls::server::NoClientAuth::new())
    // .with_single_cert(vec![cert], key)?;

    
    tls_config.max_early_data_size = u32::MAX;
    tls_config.alpn_protocols = vec![ALPN.into()];


    // let server_config = quinn::ServerConfig::with_crypto(Arc::new(tls_config));

    let server_config = quinn::ServerConfig::with_crypto(Arc::new(QuicServerConfig::try_from(tls_config)?));

    
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
    
                if let Ok(mut h3_conn) = h3::server::Connection::new(h3_quinn::Connection::new(conn)).await {
                    while let Ok(Some((req, stream))) = h3_conn.accept().await {
                        let root = root.clone();  // Clone again for the inner spawn
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
    let (status, to_serve) = match serve_root.as_deref() {
        None => (StatusCode::OK, None),
        Some(_) if req.uri().path().contains("..") => (StatusCode::NOT_FOUND, None),
        Some(root) => {
            let to_serve = root.join(req.uri().path().strip_prefix('/').unwrap_or(""));
            match File::open(&to_serve) {
                Ok(file) => (StatusCode::OK, Some(file)),
                Err(e) => {
                    error!("failed to open: {}: {}", to_serve.display(), e);
                    (StatusCode::NOT_FOUND, None)
                }
            }
        }
    };

    let resp = http::Response::builder()
        .status(status)
        .header("content-type", "application/octet-stream")
        .body(())?;

    stream.send_response(resp).await?;

    if let Some(mut file) = to_serve {
        let mut buffer = vec![0; 4096 * 10];
        loop {
            match file.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    stream.send_data(Bytes::copy_from_slice(&buffer[..n])).await?;
                }
                Err(e) => return Err(e.into()),
            }
        }
    }
    
    
    stream.finish().await?;
    Ok(())
}


fn scrape_url(url: &str) -> Result<String, Box<dyn std::error::Error>> {
    let mut stream = TcpStream::connect("127.0.0.1:3000")?;
    
    // Format the HTTP request
    let request = format!(
        "GET /scrape/{} HTTP/1.1\r\nHost: localhost:3000\r\nConnection: close\r\n\r\n",
        url
    );
    
    stream.write_all(request.as_bytes())?;
    
    let mut response = String::new();
    stream.read_to_string(&mut response)?;

    // Parse HTTP response to extract JSON body
    if let Some(body_start) = response.find("\r\n\r\n") {
        let json_str = &response[body_start + 4..];
        let parsed: Value = serde_json::from_str(json_str)?;
        
        if let Some(content) = parsed.get("content") {
            Ok(content.to_string())
        } else if let Some(error) = parsed.get("error") {
            Err(error.to_string().into())
        } else {
            Err("Invalid response format".into())
        }
    } else {
        Err("Invalid HTTP response".into())
    }
}
