use brotlic::{BlockSize, BrotliEncoderOptions, CompressorWriter, Quality, WindowSize};
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use h3::{quic::BidiStream, server::RequestStream};
use h3_quinn::quinn::{self, crypto::rustls::QuicServerConfig};
use http::{Request, Response, StatusCode};
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::{
    io::{Read, Write},
    net::SocketAddr,
    net::TcpStream,
    sync::Arc,
};
use tokio;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{error, info};

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
        "[::1]:4433".parse::<SocketAddr>()?,
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
    _serve_root: Arc<Option<PathBuf>>,
) -> Result<(), Box<dyn std::error::Error>>
where
    T: BidiStream<Bytes>,
{
    let url = req.uri().query().and_then(|v| {
        url::form_urlencoded::parse(v.as_bytes())
            .find(|(key, _)| key == "url")
            .map(|(_, value)| value.to_string())
    });

    match url {
        Some(url_to_scrape) => {
            match scrape_url_ws(&url_to_scrape).await {
                Ok(html_content) => {
                    let encoder = BrotliEncoderOptions::new()
                        .quality(Quality::new(6)?) // Add ? operator for error handling
                        .window_size(WindowSize::new(22)?) // 22 is recommended window size
                        .block_size(BlockSize::new(24)?) // Use new() instead of default()
                        .build()?;

                    let mut compressed_writer = CompressorWriter::with_encoder(encoder, Vec::new());
                    compressed_writer.write_all(html_content.as_bytes())?;
                    let compressed_data = compressed_writer.into_inner()?;

                    let resp = Response::builder()
                        .status(StatusCode::OK)
                        .header("content-type", "text/html; charset=utf-8")
                        .header("content-encoding", "br")
                        .body(())?;

                    stream.send_response(resp).await?;
                    stream.send_data(Bytes::from(compressed_data)).await?;
                }
                Err(e) => {
                    let error_response = Bytes::from(
                        json!({
                            "status": "error",
                            "error": e.to_string()
                        })
                        .to_string(),
                    );

                    let resp = Response::builder()
                        .status(StatusCode::OK)
                        .header("content-type", "application/json")
                        .body(())?;

                    stream.send_response(resp).await?;
                    stream.send_data(error_response).await?;
                }
            }
        }
        None => {
            let error_response = Bytes::from(
                json!({
                    "status": "error",
                    "error": "No URL provided. Use ?url=https://example.com"
                })
                .to_string(),
            );

            let resp = Response::builder()
                .status(StatusCode::OK)
                .header("content-type", "application/json")
                .body(())?;

            stream.send_response(resp).await?;
            stream.send_data(error_response).await?;
        }
    }

    stream.finish().await?;
    Ok(())
}

fn scrape_url(url: &str) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let mut stream = TcpStream::connect("127.0.0.1:3000")?;

    let encoded_url = urlencoding::encode(url);
    let request = format!(
        "GET /scrape/{} HTTP/1.1\r\n\
         Host: localhost:3000\r\n\
         Connection: close\r\n\
         \r\n",
        encoded_url
    );

    stream.write_all(request.as_bytes())?;
    stream.flush()?;

    let mut response = String::new();
    stream.read_to_string(&mut response)?;

    if let Some(body_start) = response.find("\r\n\r\n") {
        let json_str = &response[body_start + 4..];

        let parsed: Value = serde_json::from_str(json_str)?;

        if let Some(content) = parsed.get("content") {
            let charset = parsed
                .get("charset")
                .and_then(|v| v.as_str())
                .unwrap_or("utf-8");

            // Set response headers for browser
            let _resp = Response::builder()
                .status(StatusCode::OK)
                .header("content-type", format!("text/html; charset={}", charset))
                .header("content-encoding", "br")
                .body(())?;

            // Return the Brotli-compressed content
            return Ok(content.as_str().unwrap_or_default().to_string());
        }
    }
    Err("Invalid response".into())
}

async fn scrape_url_ws(url: &str) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let ws_url = url::Url::parse("ws://127.0.0.1:3000")?;
    let (ws_stream, _) = connect_async(ws_url).await?;
    let (mut write, mut read) = ws_stream.split();

    let message = json!({
        "url": url
    })
    .to_string();
    write.send(Message::Text(message)).await?;

    if let Some(msg) = read.next().await {
        match msg? {
            Message::Text(text) => {
                let parsed: Value = serde_json::from_str(&text)?;
                if let Some(content) = parsed.get("content") {
                    return Ok(content.as_str().unwrap_or_default().to_string());
                }
                Err("Content not found in response".into())
            }
            _ => Err("Unexpected message type".into()),
        }
    } else {
        Err("No response received".into())
    }
}
