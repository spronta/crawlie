//! Update checking for the CLI.
//!
//! Two entry points:
//! * [`run_check_command`] — the explicit `crawlie update`: always checks now,
//!   prints current vs latest and how to upgrade.
//! * [`maybe_notify`] — a passive, cached, best-effort nudge printed *only* for
//!   interactive humans. It never touches stdout (which stays a clean machine
//!   stream for agents), never runs for agents/CI/pipes, caps network at one
//!   call per 24h, and can be silenced with `CRAWLIE_NO_UPDATE_CHECK`.

use std::io::{IsTerminal, Write};
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// npm dist-tag endpoint for the published CLI package.
const REGISTRY_LATEST: &str = "https://registry.npmjs.org/crawlie/latest";
const TTL_SECS: u64 = 60 * 60 * 24;
const NET_TIMEOUT: Duration = Duration::from_millis(1500);

/// The version this binary was built as.
pub fn current() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

fn cache_path() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".crawlie").join("update-check.json")
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Parse `major.minor.patch` (tolerating a leading `v` and a `-prerelease`
/// suffix). Returns `None` if it doesn't look like semver.
fn parse_semver(s: &str) -> Option<(u64, u64, u64)> {
    let s = s.trim().trim_start_matches('v');
    let core = s.split(['-', '+']).next().unwrap_or(s);
    let mut it = core.split('.');
    let major = it.next()?.parse().ok()?;
    let minor = it.next()?.parse().ok()?;
    let patch = it.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

/// `true` if `latest` is strictly newer than `current`.
pub fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_semver(latest), parse_semver(current)) {
        (Some(l), Some(c)) => l > c,
        // If either side isn't parseable, only nudge on a clear string mismatch.
        _ => latest != current,
    }
}

async fn fetch_latest() -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(NET_TIMEOUT)
        .user_agent(concat!("crawlie/", env!("CARGO_PKG_VERSION")))
        .build()
        .ok()?;
    let resp = client.get(REGISTRY_LATEST).send().await.ok()?;
    let json: serde_json::Value = resp.json().await.ok()?;
    json.get("version")?.as_str().map(|s| s.to_string())
}

fn read_cache() -> Option<(String, u64)> {
    let raw = std::fs::read_to_string(cache_path()).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let latest = v.get("latest")?.as_str()?.to_string();
    let checked = v.get("checkedAt")?.as_u64()?;
    Some((latest, checked))
}

fn write_cache(latest: &str) {
    let path = cache_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let body = serde_json::json!({ "latest": latest, "checkedAt": now_secs() });
    let _ = std::fs::write(path, body.to_string());
}

fn upgrade_hint() -> &'static str {
    "  run:  crawlie update"
}

/// How this binary was installed, inferred from its path — determines the
/// command that upgrades it. (The CLI ships via npm; brew/cargo are supported
/// for users who installed it that way.)
#[derive(Debug, PartialEq)]
enum InstallMethod {
    Npm,
    Brew,
    Cargo,
    Unknown,
}

fn detect_install() -> InstallMethod {
    let exe = std::env::current_exe().ok();
    let path = exe.as_ref().and_then(|p| p.to_str()).unwrap_or("");
    let lp = path.to_lowercase();
    if lp.contains("node_modules") {
        InstallMethod::Npm
    } else if lp.contains("/cellar/") || lp.contains("homebrew") {
        InstallMethod::Brew
    } else if lp.contains("/.cargo/") || lp.contains("cargo/bin") {
        InstallMethod::Cargo
    } else {
        InstallMethod::Unknown
    }
}

fn install_command(method: &InstallMethod) -> Option<(&'static str, Vec<&'static str>)> {
    match method {
        InstallMethod::Npm => Some(("npm", vec!["install", "-g", "crawlie@latest"])),
        InstallMethod::Brew => Some(("brew", vec!["upgrade", "crawlie"])),
        InstallMethod::Cargo => Some(("cargo", vec!["install", "crawlie", "--force"])),
        InstallMethod::Unknown => None,
    }
}

/// `crawlie update` — check, then install the new version in place.
/// `check_only` stops after reporting; `assume_yes` skips the confirmation.
pub async fn run_update(check_only: bool, assume_yes: bool) -> u8 {
    let cur = current();
    let latest = match fetch_latest().await {
        Some(l) => l,
        None => {
            eprintln!("crawlie: could not reach the npm registry");
            return 1;
        }
    };
    write_cache(&latest);

    if !is_newer(&latest, cur) {
        println!("crawlie {cur} is up to date");
        return 0;
    }
    println!("update available: {cur} \u{2192} {latest}");
    if check_only {
        println!("run `crawlie update` to install");
        return 0;
    }

    let method = detect_install();
    let Some((prog, args)) = install_command(&method) else {
        println!("\ncouldn't detect how crawlie was installed — update manually with one of:");
        println!("  npm i -g crawlie@latest");
        println!("  brew upgrade crawlie");
        return 0;
    };
    let display = format!("{prog} {}", args.join(" "));

    if !assume_yes && std::io::stdin().is_terminal() {
        print!("install now? [{display}]  (Y/n) ");
        let _ = std::io::stdout().flush();
        let mut line = String::new();
        let _ = std::io::stdin().read_line(&mut line);
        let ans = line.trim().to_lowercase();
        if !(ans.is_empty() || ans == "y" || ans == "yes") {
            println!("cancelled");
            return 0;
        }
    }

    println!("\n$ {display}");
    match Command::new(prog).args(&args).status() {
        Ok(s) if s.success() => {
            println!("\n\u{2713} updated to {latest} — run `crawlie --version` to confirm");
            0
        }
        Ok(s) => {
            eprintln!("crawlie: `{display}` exited with {s}");
            1
        }
        Err(e) => {
            eprintln!("crawlie: could not run `{prog}`: {e}");
            eprintln!("update manually: {display}");
            1
        }
    }
}

/// Passive nudge for interactive humans. Cheap and silent unless a newer
/// version is known. Safe to call after any command.
pub async fn maybe_notify() {
    // Hard opt-outs and the agent/CI/pipe guard: only nudge a real human at a
    // terminal on both streams (agents capture stdout, so stdout won't be a tty).
    if std::env::var_os("CRAWLIE_NO_UPDATE_CHECK").is_some()
        || std::env::var_os("CI").is_some()
        || !std::io::stdout().is_terminal()
        || !std::io::stderr().is_terminal()
    {
        return;
    }

    let cached = read_cache();
    let fresh = cached
        .as_ref()
        .map(|(_, t)| now_secs().saturating_sub(*t) < TTL_SECS)
        .unwrap_or(false);

    let latest = if fresh {
        cached.map(|(l, _)| l)
    } else {
        match fetch_latest().await {
            Some(l) => {
                write_cache(&l);
                Some(l)
            }
            // network failed — fall back to any stale cache we have
            None => cached.map(|(l, _)| l),
        }
    };

    if let Some(latest) = latest {
        if is_newer(&latest, current()) {
            eprintln!(
                "\n  \u{2192} crawlie {latest} is available (you have {}).\n{}",
                current(),
                upgrade_hint()
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_commands_map() {
        assert_eq!(
            install_command(&InstallMethod::Npm),
            Some(("npm", vec!["install", "-g", "crawlie@latest"]))
        );
        assert_eq!(install_command(&InstallMethod::Brew).unwrap().0, "brew");
        assert_eq!(install_command(&InstallMethod::Cargo).unwrap().0, "cargo");
        assert!(install_command(&InstallMethod::Unknown).is_none());
    }

    #[test]
    fn semver_compare() {
        assert!(is_newer("0.2.1", "0.2.0"));
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(is_newer("v0.3.0", "0.2.9"));
        assert!(!is_newer("0.2.0", "0.2.0"));
        assert!(!is_newer("0.2.0", "0.2.1"));
        assert!(!is_newer("0.2.0-beta", "0.2.0")); // prerelease core == release core
    }
}
