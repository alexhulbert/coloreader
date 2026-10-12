//! Watch palette file and send changes over a loopback WebSocket.
use std::io::ErrorKind::{TimedOut, WouldBlock};
use std::{env, fs, net::TcpListener, thread, time::Duration};
use tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tungstenite::{accept_hdr, http::StatusCode, Error, Message};

fn main() {
    let path = env::args()
        .nth(1)
        .expect("usage: coloreader-bridge <palette.json>");
    let listener = TcpListener::bind("127.0.0.1:7521").expect("cannot listen on 127.0.0.1:7521");
    for stream in listener.incoming().flatten() {
        let path = path.clone();
        thread::spawn(move || {
            stream.set_read_timeout(Some(Duration::from_secs(1))).ok();
            let Ok(mut socket) = accept_hdr(stream, palette_client) else {
                return;
            };
            let mut sent = String::new();
            loop {
                let asked = match socket.read() {
                    Ok(Message::Text(text)) => text.as_str() == "get",
                    Ok(_) => false,
                    Err(Error::Io(error)) if matches!(error.kind(), WouldBlock | TimedOut) => false,
                    Err(_) => return,
                };
                let palette = fs::read_to_string(&path).unwrap_or_default();
                if (asked || palette != sent)
                    && !palette.is_empty()
                    && socket.send(Message::text(palette.clone())).is_ok()
                {
                    sent = palette;
                }
            }
        });
    }
}

// Only allow requests with no origin header or requests from browser extensions
fn palette_client(request: &Request, response: Response) -> Result<Response, ErrorResponse> {
    let allowed = request.headers().get("Origin").is_none_or(|value| {
        value.to_str().is_ok_and(|origin| {
            origin.starts_with("moz-extension://") || origin.starts_with("chrome-extension://")
        })
    });
    if allowed {
        Ok(response)
    } else {
        let mut refusal = ErrorResponse::new(None);
        *refusal.status_mut() = StatusCode::FORBIDDEN;
        Err(refusal)
    }
}
