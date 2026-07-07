//! Read the Crawlie Cloud session that `crawlie login` writes.
//!
//! The MCP server can't open a browser, so it never signs in itself — it shares
//! the CLI's token store (`~/.crawlie/auth.json`) so an agent inherits whatever
//! account the human already signed into. Read-only and offline: we report the
//! identity the CLI recorded at login rather than making a network call.

use std::path::PathBuf;

fn auth_path() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".crawlie").join("auth.json")
}

/// The signed-in account, as recorded by `crawlie login`.
pub struct Identity {
    pub email: Option<String>,
    pub endpoint: Option<String>,
}

/// Load the current session, if the human has signed in.
pub fn identity() -> Option<Identity> {
    let raw = std::fs::read_to_string(auth_path()).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let token = v.get("access_token")?.as_str()?;
    if token.is_empty() {
        return None;
    }
    Some(Identity {
        email: v["user"]["email"].as_str().map(|s| s.to_string()),
        endpoint: v.get("endpoint").and_then(|e| e.as_str()).map(|s| s.to_string()),
    })
}
