//! Watch palette file and send changes over a loopback WebSocket.
use std::io::ErrorKind::{TimedOut, WouldBlock};
use std::{env, fs, net::TcpListener, thread, time::Duration};
use tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tungstenite::{Error, Message, accept_hdr, http::StatusCode};

fn main() {
    let mut args = env::args().skip(1);
    let path = args
        .next()
        .expect("usage: coloreader-bridge <palette.json> [--allow-origin <origin>]...");
    let mut allowed_origins = Vec::new();
    while let Some(flag) = args.next() {
        assert_eq!(flag, "--allow-origin", "unknown argument");
        allowed_origins.push(args.next().expect("--allow-origin requires an origin"));
    }
    let listener = TcpListener::bind("127.0.0.1:7521").expect("cannot listen on 127.0.0.1:7521");
    for stream in listener.incoming().flatten() {
        let path = path.clone();
        let allowed_origins = allowed_origins.clone();
        thread::spawn(move || {
            stream.set_read_timeout(Some(Duration::from_secs(1))).ok();
            let Ok(mut socket) = accept_hdr(stream, |request: &Request, response| {
                palette_client(request, response, &allowed_origins)
            }) else {
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

fn palette_client(
    request: &Request,
    response: Response,
    allowed_origins: &[String],
) -> Result<Response, ErrorResponse> {
    let allowed = request.headers().get("Origin").is_none_or(|value| {
        value.to_str().is_ok_and(|origin| {
            origin.starts_with("moz-extension://")
                || origin.starts_with("chrome-extension://")
                || allowed_origins.iter().any(|allowed| allowed == origin)
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
