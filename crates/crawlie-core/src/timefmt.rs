//! Dependency-free UTC timestamp formatting (no chrono). Used by report
//! listings and the HTML report so saved reports are always dated with time.

/// Format a Unix-ms timestamp as `YYYY-MM-DD HH:MM UTC`.
pub fn format_utc(ms: u64) -> String {
    let secs = ms / 1000;
    let days = (secs / 86400) as i64;
    let (y, m, d) = civil_from_days(days);
    let h = (secs % 86400) / 3600;
    let mi = (secs % 3600) / 60;
    format!("{y:04}-{m:02}-{d:02} {h:02}:{mi:02} UTC")
}

/// Days since 1970-01-01 → (year, month, day). Howard Hinnant's algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}
