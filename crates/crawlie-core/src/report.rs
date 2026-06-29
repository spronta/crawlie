//! Saved-report storage, backed by SQLite. A `ReportStore` persists full crawl
//! results in a single `crawlie.db` file: the complete result as a JSON blob
//! (the source of truth that `load` returns), plus normalized `pages` and
//! `issues` tables that make crawls *queryable* and let us diff one crawl
//! against another with set operations instead of loading everything into RAM.
//!
//! The public API (`save` / `list` / `load` / `delete`) is unchanged from the
//! previous JSON-directory store, so the CLI, MCP server, and desktop app keep
//! working untouched. Existing JSON reports are imported automatically on first
//! open. `diff` is new — it powers crawl-over-crawl trend reporting.

use crate::types::{Category, CrawlDiff, CrawlResult, IssueDelta, ReportMeta, Severity};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub struct ReportStore {
    dir: PathBuf,
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS crawls (
    id           TEXT PRIMARY KEY,
    url          TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    total_pages  INTEGER NOT NULL,
    errors       INTEGER NOT NULL,
    warnings     INTEGER NOT NULL,
    health_score INTEGER NOT NULL,
    geo_score    INTEGER NOT NULL,
    a11y_score   INTEGER NOT NULL DEFAULT 100,
    result       TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pages (
    crawl_id  TEXT NOT NULL,
    url       TEXT NOT NULL,
    status    INTEGER NOT NULL,
    depth     INTEGER NOT NULL,
    seo_score INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS issues (
    crawl_id TEXT NOT NULL,
    url      TEXT NOT NULL,
    rule     TEXT NOT NULL,
    title    TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    detail   TEXT
);
CREATE INDEX IF NOT EXISTS idx_pages_crawl  ON pages(crawl_id);
CREATE INDEX IF NOT EXISTS idx_issues_crawl ON issues(crawl_id);
CREATE INDEX IF NOT EXISTS idx_crawls_time  ON crawls(created_at DESC);
";

fn ioerr<E: std::fmt::Display>(e: E) -> io::Error {
    io::Error::other(e.to_string())
}

fn slugify(url: &str) -> String {
    let host = url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
        .unwrap_or_else(|| "site".into());
    host.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// Serde token for a category/severity (`geo`, `titles-meta`, `warning`, …) so
/// the value round-trips through the text columns.
fn token<T: serde::Serialize>(v: &T) -> String {
    serde_json::to_value(v)
        .ok()
        .and_then(|j| j.as_str().map(String::from))
        .unwrap_or_default()
}

fn category_from(s: &str) -> Category {
    serde_json::from_value(serde_json::Value::String(s.to_string())).unwrap_or(Category::Response)
}

fn severity_from(s: &str) -> Severity {
    serde_json::from_value(serde_json::Value::String(s.to_string())).unwrap_or(Severity::Notice)
}

fn sev_rank(s: Severity) -> u8 {
    match s {
        Severity::Error => 3,
        Severity::Warning => 2,
        Severity::Notice => 1,
        Severity::Good => 0,
    }
}

impl ReportStore {
    pub fn new(dir: impl AsRef<Path>) -> Self {
        Self {
            dir: dir.as_ref().to_path_buf(),
        }
    }

    /// Open (creating if needed) the database, ensure the schema exists, and
    /// import any legacy JSON reports the first time.
    fn open(&self) -> io::Result<Connection> {
        fs::create_dir_all(&self.dir)?;
        let conn = Connection::open(self.dir.join("crawlie.db")).map_err(ioerr)?;
        conn.execute_batch(SCHEMA).map_err(ioerr)?;
        // Add columns introduced after the original schema to pre-existing DBs.
        // `CREATE TABLE IF NOT EXISTS` won't alter an existing table, so do it
        // explicitly; the duplicate-column error on an already-migrated DB is
        // expected and ignored.
        let _ = conn.execute(
            "ALTER TABLE crawls ADD COLUMN a11y_score INTEGER NOT NULL DEFAULT 100",
            [],
        );
        self.migrate_legacy(&conn);
        Ok(conn)
    }

    /// One-time import of the old `index.json` + `<id>.json` report files into
    /// the database. Best-effort: a report that won't parse is skipped, and the
    /// index is renamed afterwards so this never runs twice.
    fn migrate_legacy(&self, conn: &Connection) {
        let index = self.dir.join("index.json");
        let marker = self.dir.join("index.json.migrated");
        if !index.exists() || marker.exists() {
            return;
        }
        if let Some(metas) = fs::read(&index)
            .ok()
            .and_then(|b| serde_json::from_slice::<Vec<ReportMeta>>(&b).ok())
        {
            if let Ok(tx) = conn.unchecked_transaction() {
                for m in &metas {
                    let path = self.dir.join(format!("{}.json", m.id));
                    if let Some(result) = fs::read(&path)
                        .ok()
                        .and_then(|b| serde_json::from_slice::<CrawlResult>(&b).ok())
                    {
                        let _ = insert_result(&tx, &result);
                    }
                }
                let _ = tx.commit();
            }
        }
        let _ = fs::rename(&index, &marker);
    }

    /// Save a crawl result, returning its metadata.
    pub fn save(&self, result: &CrawlResult) -> io::Result<ReportMeta> {
        let mut conn = self.open()?;
        let tx = conn.transaction().map_err(ioerr)?;
        let meta = insert_result(&tx, result).map_err(ioerr)?;
        tx.commit().map_err(ioerr)?;
        Ok(meta)
    }

    /// List saved reports, newest first.
    pub fn list(&self) -> Vec<ReportMeta> {
        self.try_list().unwrap_or_default()
    }

    fn try_list(&self) -> io::Result<Vec<ReportMeta>> {
        let conn = self.open()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, url, created_at, total_pages, errors, warnings, health_score, geo_score, a11y_score \
                 FROM crawls ORDER BY created_at DESC",
            )
            .map_err(ioerr)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(ReportMeta {
                    id: r.get(0)?,
                    url: r.get(1)?,
                    created_at: r.get::<_, i64>(2)? as u64,
                    total_pages: r.get::<_, i64>(3)? as usize,
                    errors: r.get::<_, i64>(4)? as usize,
                    warnings: r.get::<_, i64>(5)? as usize,
                    health_score: r.get::<_, i64>(6)? as u8,
                    geo_score: r.get::<_, i64>(7)? as u8,
                    a11y_score: r.get::<_, i64>(8)? as u8,
                })
            })
            .map_err(ioerr)?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    /// Load a full saved report by id. Derived scores are recomputed from the
    /// stored signals so reports saved before a scoring fix self-heal.
    pub fn load(&self, id: &str) -> Option<CrawlResult> {
        let conn = self.open().ok()?;
        let blob: String = conn
            .query_row(
                "SELECT result FROM crawls WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .optional()
            .ok()
            .flatten()?;
        let mut result: CrawlResult = serde_json::from_str(&blob).ok()?;
        crate::scoring::recompute(&mut result);
        Some(result)
    }

    /// Delete a saved report by id.
    pub fn delete(&self, id: &str) -> io::Result<()> {
        let mut conn = self.open()?;
        let tx = conn.transaction().map_err(ioerr)?;
        tx.execute("DELETE FROM crawls WHERE id = ?1", params![id])
            .map_err(ioerr)?;
        tx.execute("DELETE FROM pages WHERE crawl_id = ?1", params![id])
            .map_err(ioerr)?;
        tx.execute("DELETE FROM issues WHERE crawl_id = ?1", params![id])
            .map_err(ioerr)?;
        tx.commit().map_err(ioerr)?;
        Ok(())
    }

    /// Compare two saved crawls: score deltas, pages added/removed, and issues
    /// that newly appeared or were resolved. Returns `None` if either id is
    /// unknown. Computed with SQL set operations over the normalized tables, so
    /// it never deserializes the full page list.
    pub fn diff(&self, old_id: &str, new_id: &str) -> io::Result<Option<CrawlDiff>> {
        let conn = self.open()?;
        let (Some(old), Some(new)) = (
            self.meta(&conn, old_id).map_err(ioerr)?,
            self.meta(&conn, new_id).map_err(ioerr)?,
        ) else {
            return Ok(None);
        };

        let pages_added = page_diff(&conn, new_id, old_id).map_err(ioerr)?;
        let pages_removed = page_diff(&conn, old_id, new_id).map_err(ioerr)?;
        let new_issues = issue_deltas(&conn, new_id, old_id).map_err(ioerr)?;
        let resolved_issues = issue_deltas(&conn, old_id, new_id).map_err(ioerr)?;

        Ok(Some(CrawlDiff {
            old_id: old_id.to_string(),
            new_id: new_id.to_string(),
            old_created_at: old.created_at,
            new_created_at: new.created_at,
            health_before: old.health_score,
            health_after: new.health_score,
            health_delta: new.health_score as i16 - old.health_score as i16,
            geo_before: old.geo_score,
            geo_after: new.geo_score,
            geo_delta: new.geo_score as i16 - old.geo_score as i16,
            a11y_before: old.a11y_score,
            a11y_after: new.a11y_score,
            a11y_delta: new.a11y_score as i16 - old.a11y_score as i16,
            pages_before: old.total_pages,
            pages_after: new.total_pages,
            pages_added,
            pages_removed,
            new_issues,
            resolved_issues,
        }))
    }

    fn meta(&self, conn: &Connection, id: &str) -> rusqlite::Result<Option<ReportMeta>> {
        conn.query_row(
            "SELECT id, url, created_at, total_pages, errors, warnings, health_score, geo_score, a11y_score \
             FROM crawls WHERE id = ?1",
            params![id],
            |r| {
                Ok(ReportMeta {
                    id: r.get(0)?,
                    url: r.get(1)?,
                    created_at: r.get::<_, i64>(2)? as u64,
                    total_pages: r.get::<_, i64>(3)? as usize,
                    errors: r.get::<_, i64>(4)? as usize,
                    warnings: r.get::<_, i64>(5)? as usize,
                    health_score: r.get::<_, i64>(6)? as u8,
                    geo_score: r.get::<_, i64>(7)? as u8,
                    a11y_score: r.get::<_, i64>(8)? as u8,
                })
            },
        )
        .optional()
    }
}

/// Insert (replacing any existing report with the same id) a full result into
/// all three tables. The caller owns the transaction.
fn insert_result(conn: &Connection, r: &CrawlResult) -> rusqlite::Result<ReportMeta> {
    let id = format!("{}-{}", r.started_at, slugify(&r.config.url));
    let blob = serde_json::to_string(r)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

    conn.execute("DELETE FROM crawls WHERE id = ?1", params![id])?;
    conn.execute("DELETE FROM pages WHERE crawl_id = ?1", params![id])?;
    conn.execute("DELETE FROM issues WHERE crawl_id = ?1", params![id])?;

    conn.execute(
        "INSERT INTO crawls \
         (id, url, created_at, total_pages, errors, warnings, health_score, geo_score, a11y_score, result) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            id,
            r.config.url,
            r.started_at as i64,
            r.summary.total_pages as i64,
            r.summary.errors as i64,
            r.summary.warnings as i64,
            r.summary.health_score as i64,
            r.summary.geo_score as i64,
            r.summary.a11y_score as i64,
            blob,
        ],
    )?;

    {
        let mut stmt = conn.prepare(
            "INSERT INTO pages (crawl_id, url, status, depth, seo_score) VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        for p in &r.pages {
            stmt.execute(params![
                id,
                p.url,
                p.status as i64,
                p.depth as i64,
                p.seo_score as i64
            ])?;
        }
    }
    {
        let mut stmt = conn.prepare(
            "INSERT INTO issues (crawl_id, url, rule, title, category, severity, detail) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        for i in &r.issues {
            stmt.execute(params![
                id,
                i.url,
                i.rule,
                i.title,
                token(&i.category),
                token(&i.severity),
                i.detail,
            ])?;
        }
    }

    Ok(ReportMeta {
        id,
        url: r.config.url.clone(),
        created_at: r.started_at,
        total_pages: r.summary.total_pages,
        errors: r.summary.errors,
        warnings: r.summary.warnings,
        health_score: r.summary.health_score,
        geo_score: r.summary.geo_score,
        a11y_score: r.summary.a11y_score,
    })
}

/// URLs present in crawl `a` but not crawl `b` (capped for sanity).
fn page_diff(conn: &Connection, a: &str, b: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT url FROM pages WHERE crawl_id = ?1 \
         EXCEPT SELECT url FROM pages WHERE crawl_id = ?2 LIMIT 1000",
    )?;
    let rows = stmt.query_map(params![a, b], |r| r.get::<_, String>(0))?;
    Ok(rows.filter_map(Result::ok).collect())
}

/// Issues present (by url+rule) in crawl `a` but not crawl `b`, grouped by rule
/// and ranked by severity then count, with up to 5 sample URLs each.
fn issue_deltas(conn: &Connection, a: &str, b: &str) -> rusqlite::Result<Vec<IssueDelta>> {
    let mut stmt = conn.prepare(
        "SELECT n.url, n.rule, n.title, n.category, n.severity FROM issues n \
         WHERE n.crawl_id = ?1 AND NOT EXISTS ( \
            SELECT 1 FROM issues o \
            WHERE o.crawl_id = ?2 AND o.url = n.url AND o.rule = n.rule)",
    )?;
    let rows = stmt.query_map(params![a, b], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
        ))
    })?;

    let mut map: HashMap<String, IssueDelta> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for row in rows {
        let (url, rule, title, cat, sev) = row?;
        let entry = map.entry(rule.clone()).or_insert_with(|| {
            order.push(rule.clone());
            IssueDelta {
                rule: rule.clone(),
                title,
                category: category_from(&cat),
                severity: severity_from(&sev),
                count: 0,
                sample_urls: Vec::new(),
            }
        });
        entry.count += 1;
        if entry.sample_urls.len() < 5 {
            entry.sample_urls.push(url);
        }
    }

    let mut out: Vec<IssueDelta> = order.into_iter().filter_map(|r| map.remove(&r)).collect();
    out.sort_by(|a, b| {
        sev_rank(b.severity)
            .cmp(&sev_rank(a.severity))
            .then(b.count.cmp(&a.count))
    });
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{CrawlConfig, Issue, Summary};
    use std::collections::BTreeMap;

    fn sample(url: &str, started_at: u64, issues: Vec<Issue>, page_urls: &[&str]) -> CrawlResult {
        let pages = page_urls
            .iter()
            .map(|u| {
                let mut p = crate::types::Page {
                    url: u.to_string(),
                    final_url: u.to_string(),
                    status: 200,
                    redirect_chain: vec![],
                    content_type: Some("text/html".into()),
                    response_time_ms: 1,
                    size_bytes: 100,
                    depth: 0,
                    server: None,
                    content_encoding: None,
                    cache_control: None,
                    x_robots_tag: None,
                    hsts: false,
                    title: None,
                    meta_description: None,
                    h1: vec![],
                    h2_count: 0,
                    h3_count: 0,
                    word_count: 0,
                    text_ratio: 0.0,
                    text: None,
                    canonical: None,
                    meta_robots: None,
                    lang: None,
                    has_viewport: false,
                    rendered: false,
                    pre_render_word_count: 0,
                    indexable: true,
                    indexability: None,
                    canonicalized: false,
                    images_total: 0,
                    images_missing_alt: 0,
                    internal_links: vec![],
                    external_links: vec![],
                    inlinks: 0,
                    link_score: 0.0,
                    seo_score: 0,
                    og_title: None,
                    og_image: None,
                    twitter_card: None,
                    schema_types: vec![],
                    schema_validations: vec![],
                    invalid_jsonld: 0,
                    hreflang: vec![],
                    mixed_content: 0,
                    a11y: Default::default(),
                    geo: Default::default(),
                    extractions: vec![],
                    content_hash: None,
                    duplicate_of: None,
                    error: None,
                };
                p.status = 200;
                p
            })
            .collect();
        CrawlResult {
            config: CrawlConfig::new(url),
            pages,
            issues,
            summary: Summary {
                total_pages: page_urls.len(),
                errors: 0,
                warnings: 0,
                notices: 0,
                good: 0,
                health_score: 90,
                geo_score: 50,
                a11y_score: 100,
                avg_response_ms: 1,
                indexable_pages: page_urls.len(),
                duplicate_pages: 0,
                by_status: BTreeMap::new(),
                by_category: BTreeMap::new(),
                by_depth: BTreeMap::new(),
                duration_ms: 1,
            },
            robots_found: true,
            sitemap_urls: 0,
            sitemap_found: false,
            robots_blocked: vec![],
            llms_txt_found: false,
            link_graph: Default::default(),
            seed_redirected_from: None,
            started_at,
        }
    }

    fn issue(rule: &str, url: &str) -> Issue {
        Issue {
            rule: rule.into(),
            title: rule.into(),
            category: Category::TitlesMeta,
            severity: Severity::Warning,
            url: url.into(),
            detail: None,
        }
    }

    #[test]
    fn save_list_load_delete_roundtrip() {
        let tmp = std::env::temp_dir().join(format!("crawlie-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let store = ReportStore::new(&tmp);

        let r = sample(
            "https://a.example",
            1000,
            vec![issue("title-missing", "https://a.example/")],
            &["https://a.example/"],
        );
        let meta = store.save(&r).unwrap();
        assert_eq!(store.list().len(), 1);
        let loaded = store.load(&meta.id).expect("loads back");
        assert_eq!(loaded.issues.len(), 1);
        assert_eq!(loaded.config.url, "https://a.example");

        store.delete(&meta.id).unwrap();
        assert!(store.list().is_empty());
        assert!(store.load(&meta.id).is_none());
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn diff_reports_added_pages_and_resolved_issues() {
        let tmp = std::env::temp_dir().join(format!("crawlie-difftest-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let store = ReportStore::new(&tmp);

        let old = sample(
            "https://b.example",
            1000,
            vec![
                issue("title-missing", "https://b.example/"),
                issue("h1-missing", "https://b.example/about"),
            ],
            &["https://b.example/", "https://b.example/about"],
        );
        let new = sample(
            "https://b.example",
            2000,
            vec![issue("h1-missing", "https://b.example/about")],
            &[
                "https://b.example/",
                "https://b.example/about",
                "https://b.example/new",
            ],
        );
        let old_meta = store.save(&old).unwrap();
        let new_meta = store.save(&new).unwrap();

        let diff = store.diff(&old_meta.id, &new_meta.id).unwrap().unwrap();
        assert_eq!(diff.pages_added, vec!["https://b.example/new".to_string()]);
        assert!(diff.pages_removed.is_empty());
        // title-missing was fixed between the two crawls.
        assert!(diff
            .resolved_issues
            .iter()
            .any(|d| d.rule == "title-missing"));
        // nothing new appeared.
        assert!(diff.new_issues.is_empty());

        assert!(store.diff(&old_meta.id, "nope").unwrap().is_none());
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn a11y_score_persists_in_meta_and_diff() {
        let tmp = std::env::temp_dir().join(format!("crawlie-a11ytest-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let store = ReportStore::new(&tmp);

        let mut old = sample("https://c.example", 1000, vec![], &["https://c.example/"]);
        old.summary.a11y_score = 60;
        let mut new = sample("https://c.example", 2000, vec![], &["https://c.example/"]);
        new.summary.a11y_score = 85;

        let old_meta = store.save(&old).unwrap();
        let new_meta = store.save(&new).unwrap();

        // The score survives the round-trip into the listing metadata...
        assert_eq!(old_meta.a11y_score, 60);
        let listed = store.list();
        assert!(listed.iter().any(|m| m.a11y_score == 85));

        // ...and the diff reports the improvement.
        let diff = store.diff(&old_meta.id, &new_meta.id).unwrap().unwrap();
        assert_eq!(diff.a11y_before, 60);
        assert_eq!(diff.a11y_after, 85);
        assert_eq!(diff.a11y_delta, 25);
        let _ = fs::remove_dir_all(&tmp);
    }
}
