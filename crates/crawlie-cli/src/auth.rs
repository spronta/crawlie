//! `crawlie login / logout / whoami` — Crawlie Cloud sign-in.
//!
//! Uses the OAuth 2.0 Device Authorization Grant (RFC 8628) against the auth
//! Worker (`api.crawlie.dev`): we request a device+user code, send the human to
//! a browser to approve it, then poll until a session token comes back. The
//! token lands in `~/.crawlie/auth.json`, which the MCP server and desktop app
//! read too — one sign-in, every surface.
//!
//! Override the endpoint for local dev with `CRAWLIE_CLOUD_URL`.

use std::path::PathBuf;
use std::time::Duration;

const DEFAULT_CLOUD_URL: &str = "https://api.crawlie.dev";
const CLIENT_ID: &str = "crawlie-cli";
const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";

/// Base URL of the Crawlie Cloud auth service.
pub fn cloud_url() -> String {
    std::env::var("CRAWLIE_CLOUD_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_CLOUD_URL.to_string())
        .trim_end_matches('/')
        .to_string()
}

/// `~/.crawlie/auth.json` — the shared token store.
pub fn auth_path() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".crawlie").join("auth.json")
}

/// A persisted session, as written to `auth.json`.
pub fn save_token(endpoint: &str, token: &str, email: Option<&str>, name: Option<&str>) {
    let payload = serde_json::json!({
        "access_token": token,
        "token_type": "Bearer",
        "endpoint": endpoint,
        "user": { "email": email, "name": name },
    });
    let path = auth_path();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Err(e) = std::fs::write(
        &path,
        serde_json::to_vec_pretty(&payload).unwrap_or_default(),
    ) {
        eprintln!(
            "  warning: could not save credentials to {}: {e}",
            path.display()
        );
    }
    // Best-effort: keep the token file private (owner read/write only).
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
}

/// Read the stored bearer token, if any.
pub fn load_token() -> Option<String> {
    let raw = std::fs::read_to_string(auth_path()).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("access_token")?.as_str().map(|s| s.to_string())
}

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("crawlie/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("http client")
}

/// Open a URL in the user's default browser (best-effort, cross-platform).
fn open_browser(url: &str) -> bool {
    #[cfg(target_os = "macos")]
    let cmd = ("open", vec![url]);
    #[cfg(target_os = "windows")]
    let cmd = ("cmd", vec!["/C", "start", "", url]);
    #[cfg(all(unix, not(target_os = "macos")))]
    let cmd = ("xdg-open", vec![url]);
    std::process::Command::new(cmd.0)
        .args(cmd.1)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .is_ok()
}

/// `crawlie login` — run the device flow to completion.
pub async fn run_login(no_browser: bool) -> u8 {
    let endpoint = cloud_url();
    let client = http();

    // 1. Request a device + user code.
    let start = match client
        .post(format!("{endpoint}/api/auth/device/code"))
        .json(&serde_json::json!({ "client_id": CLIENT_ID }))
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("  could not reach Crawlie Cloud ({endpoint}): {e}");
            return 1;
        }
    };
    if !start.status().is_success() {
        eprintln!("  sign-in could not start (HTTP {}).", start.status());
        return 1;
    }
    let body: serde_json::Value = start.json().await.unwrap_or_default();
    let device_code = body["device_code"].as_str().unwrap_or_default().to_string();
    let user_code = body["user_code"].as_str().unwrap_or_default().to_string();
    let verify_uri = body["verification_uri"].as_str().unwrap_or_default();
    let verify_complete = body["verification_uri_complete"]
        .as_str()
        .unwrap_or(verify_uri);
    let mut interval = body["interval"].as_u64().unwrap_or(5).max(1);
    if device_code.is_empty() || user_code.is_empty() {
        eprintln!("  sign-in service returned an unexpected response.");
        return 1;
    }

    // 2. Send the human to approve it.
    println!("\n  Sign in to Crawlie Cloud");
    println!("  ────────────────────────");
    println!("  Your code:  \x1b[1m{user_code}\x1b[0m");
    println!("  Open:       {verify_complete}\n");
    if !no_browser && open_browser(verify_complete) {
        println!("  Opened your browser. Waiting for approval…");
    } else {
        println!("  Visit the URL above and enter the code. Waiting for approval…");
    }

    // 3. Poll for the token.
    loop {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        let resp = client
            .post(format!("{endpoint}/api/auth/device/token"))
            .json(&serde_json::json!({
                "grant_type": DEVICE_GRANT,
                "device_code": device_code,
                "client_id": CLIENT_ID,
            }))
            .send()
            .await;
        let resp = match resp {
            Ok(r) => r,
            Err(_) => continue, // transient; keep polling
        };

        if resp.status().is_success() {
            let tok: serde_json::Value = resp.json().await.unwrap_or_default();
            let access = tok["access_token"].as_str().unwrap_or_default().to_string();
            if access.is_empty() {
                eprintln!("  sign-in completed but no token was returned.");
                return 1;
            }
            let (email, name) = fetch_identity(&client, &endpoint, &access).await;
            save_token(&endpoint, &access, email.as_deref(), name.as_deref());
            match email {
                Some(e) => println!("\n  ✓ Signed in as {e}"),
                None => println!("\n  ✓ Signed in to Crawlie Cloud"),
            }
            return 0;
        }

        // Non-2xx: inspect the OAuth error to decide whether to keep waiting.
        let err: serde_json::Value = resp.json().await.unwrap_or_default();
        match err["error"].as_str().unwrap_or("") {
            "authorization_pending" => continue,
            "slow_down" => {
                interval += 5;
                continue;
            }
            "access_denied" => {
                eprintln!("\n  Sign-in was denied.");
                return 1;
            }
            "expired_token" | "" => {
                eprintln!("\n  The code expired before approval. Run `crawlie login` again.");
                return 1;
            }
            other => {
                eprintln!("\n  Sign-in failed: {other}");
                return 1;
            }
        }
    }
}

/// Fetch the signed-in user's email/name via the session (best-effort).
async fn fetch_identity(
    client: &reqwest::Client,
    endpoint: &str,
    token: &str,
) -> (Option<String>, Option<String>) {
    let Ok(resp) = client
        .get(format!("{endpoint}/api/auth/get-session"))
        .bearer_auth(token)
        .send()
        .await
    else {
        return (None, None);
    };
    let v: serde_json::Value = resp.json().await.unwrap_or_default();
    let email = v["user"]["email"].as_str().map(|s| s.to_string());
    let name = v["user"]["name"].as_str().map(|s| s.to_string());
    (email, name)
}

/// `crawlie logout` — revoke the session and delete the local token.
pub async fn run_logout() -> u8 {
    let endpoint = cloud_url();
    if let Some(token) = load_token() {
        // Best-effort server-side sign-out; ignore failures.
        let _ = http()
            .post(format!("{endpoint}/api/auth/sign-out"))
            .bearer_auth(&token)
            .send()
            .await;
    }
    let path = auth_path();
    match std::fs::remove_file(&path) {
        Ok(_) => {
            println!("  ✓ Signed out.");
            0
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            println!("  You're not signed in.");
            0
        }
        Err(e) => {
            eprintln!("  could not remove {}: {e}", path.display());
            1
        }
    }
}

/// `crawlie whoami` — print the signed-in identity (validated against the server).
pub async fn run_whoami() -> u8 {
    let Some(token) = load_token() else {
        println!("  Not signed in. Run `crawlie login`.");
        return 1;
    };
    let endpoint = cloud_url();
    let (email, _name) = fetch_identity(&http(), &endpoint, &token).await;
    match email {
        Some(e) => {
            println!("  Signed in as {e}  ({endpoint})");
            0
        }
        None => {
            println!("  Your session has expired. Run `crawlie login` again.");
            1
        }
    }
}
