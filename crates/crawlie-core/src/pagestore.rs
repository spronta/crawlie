//! On-disk page storage for a single crawl — the spine of the streaming
//! (out-of-core) crawl. Where the default crawl accumulates a `Vec<Page>` in
//! memory, the streaming crawl writes each fetched page straight into a SQLite
//! database here and never holds them all at once.
//!
//! Heavy per-page data (body text, link lists, schema, headers) lives in the
//! `blob` column; small fields are indexed columns so the cross-page passes
//! (duplicate detection, inlink counts, the link graph) run as SQL/streaming
//! queries instead of in-RAM scans. Pages are streamed back one at a time for
//! the per-page audit, so peak memory is bounded by compact metadata — a
//! url→id map, an integer edge graph, and the issue list — not the corpus.

use crate::audit::CrossPage;
use crate::types::{Category, CrawlResult, Issue, Page, Severity};
use rusqlite::{params, Connection, OptionalExtension};
use std::cell::Cell;
use std::collections::{HashMap, HashSet};
use std::io;
use std::path::{Path, PathBuf};
use url::Url;

const SCHEMA: &str = "
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS page (
    id               INTEGER PRIMARY KEY,
    url              TEXT NOT NULL,
    final_url        TEXT NOT NULL,
    status           INTEGER NOT NULL,
    depth            INTEGER NOT NULL,
    content_hash     TEXT,
    title            TEXT,
    meta_description TEXT,
    blob             TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS edge (
    src INTEGER NOT NULL,
    dst TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_edge_dst ON edge(dst);
-- The audit findings + crawl metadata, written once the crawl finishes, so a
-- streamed .db is a complete, self-contained crawl artifact (queryable later).
CREATE TABLE IF NOT EXISTS issue (
    rule     TEXT NOT NULL,
    title    TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    url      TEXT NOT NULL,
    detail   TEXT
);
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
";

fn ioerr<E: std::fmt::Display>(e: E) -> io::Error {
    io::Error::other(e.to_string())
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

/// Normalize a URL the same way the crawler does (drop the fragment) so the
/// keys in the id/status/inlink maps line up with crawled URLs.
fn norm(s: &str) -> String {
    match Url::parse(s) {
        Ok(mut u) => {
            u.set_fragment(None);
            u.to_string()
        }
        Err(_) => s.to_string(),
    }
}

pub struct PageStore {
    conn: Connection,
    next: Cell<i64>,
    path: PathBuf,
}

impl PageStore {
    /// Create a fresh store at `path`, replacing any existing file so a crawl
    /// always starts clean.
    pub fn create(path: impl AsRef<Path>) -> io::Result<Self> {
        let path = path.as_ref();
        let _ = std::fs::remove_file(path);
        // WAL leaves side files; clear them too for a truly fresh start.
        for ext in ["-wal", "-shm"] {
            let mut p = path.as_os_str().to_os_string();
            p.push(ext);
            let _ = std::fs::remove_file(p);
        }
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)?;
            }
        }
        let conn = Connection::open(path).map_err(ioerr)?;
        conn.execute_batch(SCHEMA).map_err(ioerr)?;
        Ok(Self {
            conn,
            next: Cell::new(0),
            path: path.to_path_buf(),
        })
    }

    /// Open an existing store for reading (querying a completed crawl).
    pub fn open(path: impl AsRef<Path>) -> io::Result<Self> {
        let path = path.as_ref();
        let conn = Connection::open(path).map_err(ioerr)?;
        conn.execute_batch(SCHEMA).map_err(ioerr)?;
        let next: i64 = conn
            .query_row("SELECT COALESCE(MAX(id) + 1, 0) FROM page", [], |r| {
                r.get(0)
            })
            .map_err(ioerr)?;
        Ok(Self {
            conn,
            next: Cell::new(next),
            path: path.to_path_buf(),
        })
    }

    /// The path of the database file backing this store.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Persist one crawled page (plus its internal-link edges) and return its
    /// 0-based id. Called once per page during the crawl; nothing is retained.
    pub fn insert(&self, page: &Page) -> io::Result<usize> {
        let id = self.next.get();
        self.next.set(id + 1);
        let blob = serde_json::to_string(page).map_err(ioerr)?;
        self.conn
            .execute(
                "INSERT INTO page \
                 (id, url, final_url, status, depth, content_hash, title, meta_description, blob) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    id,
                    page.url,
                    page.final_url,
                    page.status as i64,
                    page.depth as i64,
                    page.content_hash,
                    page.title,
                    page.meta_description,
                    blob,
                ],
            )
            .map_err(ioerr)?;
        if !page.internal_links.is_empty() {
            let mut stmt = self
                .conn
                .prepare("INSERT INTO edge (src, dst) VALUES (?1, ?2)")
                .map_err(ioerr)?;
            for link in &page.internal_links {
                stmt.execute(params![id, norm(link)]).map_err(ioerr)?;
            }
        }
        Ok(id as usize)
    }

    /// Number of pages stored.
    pub fn count(&self) -> io::Result<usize> {
        self.conn
            .query_row("SELECT COUNT(*) FROM page", [], |r| r.get::<_, i64>(0))
            .map(|n| n as usize)
            .map_err(ioerr)
    }

    /// url/final_url → page index (0-based, first writer wins), matching the
    /// in-memory PageRank index map.
    fn idx_map(&self) -> io::Result<HashMap<String, usize>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, url, final_url FROM page ORDER BY id")
            .map_err(ioerr)?;
        let mut idx: HashMap<String, usize> = HashMap::new();
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)? as usize,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(ioerr)?;
        for row in rows {
            let (id, url, final_url) = row.map_err(ioerr)?;
            idx.entry(norm(&final_url)).or_insert(id);
            idx.entry(norm(&url)).or_insert(id);
        }
        Ok(idx)
    }

    /// The internal-link adjacency list (`adj[i]` = page indices page `i` links
    /// to), built by streaming the edge table — the input to [`crate::scoring::pagerank`].
    pub fn adjacency(&self) -> io::Result<Vec<Vec<usize>>> {
        let n = self.count()?;
        let idx = self.idx_map()?;
        let mut adj: Vec<Vec<usize>> = vec![Vec::new(); n];
        let mut stmt = self
            .conn
            .prepare("SELECT src, dst FROM edge")
            .map_err(ioerr)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, i64>(0)? as usize, r.get::<_, String>(1)?))
            })
            .map_err(ioerr)?;
        for row in rows {
            let (src, dst) = row.map_err(ioerr)?;
            if let Some(&j) = idx.get(&dst) {
                if j != src && src < n {
                    adj[src].push(j);
                }
            }
        }
        for list in &mut adj {
            list.sort_unstable();
            list.dedup();
        }
        Ok(adj)
    }

    /// Inlink count per normalized URL (`GROUP BY dst`). A page's inlink count
    /// is the value for its normalized `final_url`.
    pub fn inlink_counts(&self) -> io::Result<HashMap<String, usize>> {
        let mut stmt = self
            .conn
            .prepare("SELECT dst, COUNT(*) FROM edge GROUP BY dst")
            .map_err(ioerr)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as usize))
            })
            .map_err(ioerr)?;
        let mut map = HashMap::new();
        for row in rows {
            let (dst, c) = row.map_err(ioerr)?;
            map.insert(dst, c);
        }
        Ok(map)
    }

    /// First-seen URL per content hash (id order) — the canonical of each
    /// duplicate cluster. A page is a duplicate when its hash maps elsewhere.
    pub fn hash_canon(&self) -> io::Result<HashMap<String, String>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT content_hash, url FROM page WHERE content_hash IS NOT NULL ORDER BY id",
            )
            .map_err(ioerr)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(ioerr)?;
        let mut map: HashMap<String, String> = HashMap::new();
        for row in rows {
            let (hash, url) = row.map_err(ioerr)?;
            map.entry(hash).or_insert(url);
        }
        Ok(map)
    }

    /// Duplicate-title / duplicate-description sets across 200 pages, computed
    /// with `GROUP BY ... HAVING COUNT(*) > 1` — the streaming equivalent of
    /// [`crate::audit::cross_page`].
    pub fn cross_page(&self) -> io::Result<CrossPage> {
        let dup = |col: &str| -> io::Result<HashSet<String>> {
            let sql = format!(
                "SELECT {col} FROM page WHERE status = 200 AND {col} IS NOT NULL AND {col} <> '' \
                 GROUP BY {col} HAVING COUNT(*) > 1"
            );
            let mut stmt = self.conn.prepare(&sql).map_err(ioerr)?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(ioerr)?;
            let mut set = HashSet::new();
            for row in rows {
                set.insert(row.map_err(ioerr)?);
            }
            Ok(set)
        };
        Ok(CrossPage {
            dup_title: dup("title")?,
            dup_desc: dup("meta_description")?,
        })
    }

    /// Normalized url/final_url → status, for broken-link detection.
    pub fn status_map(&self) -> io::Result<HashMap<String, u16>> {
        let mut stmt = self
            .conn
            .prepare("SELECT url, final_url, status FROM page")
            .map_err(ioerr)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)? as u16,
                ))
            })
            .map_err(ioerr)?;
        let mut map = HashMap::new();
        for row in rows {
            let (url, final_url, status) = row.map_err(ioerr)?;
            map.insert(norm(&final_url), status);
            map.insert(norm(&url), status);
        }
        Ok(map)
    }

    /// Stream every page back in id order, deserializing one blob at a time and
    /// handing `(id, page)` to `f`. This is how the per-page audit runs without
    /// the whole corpus in memory.
    pub fn for_each_page<F: FnMut(usize, Page)>(&self, mut f: F) -> io::Result<()> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, blob FROM page ORDER BY id")
            .map_err(ioerr)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, i64>(0)? as usize, r.get::<_, String>(1)?))
            })
            .map_err(ioerr)?;
        for row in rows {
            let (id, blob) = row.map_err(ioerr)?;
            if let Ok(page) = serde_json::from_str::<Page>(&blob) {
                f(id, page);
            }
        }
        Ok(())
    }

    /// Overwrite a page's blob (used to write derived fields — inlinks, link
    /// score, duplicate-of, SEO score — back into the stored page).
    pub fn put_blob(&self, id: usize, page: &Page) -> io::Result<()> {
        let blob = serde_json::to_string(page).map_err(ioerr)?;
        self.conn
            .execute(
                "UPDATE page SET blob = ?2 WHERE id = ?1",
                params![id as i64, blob],
            )
            .map_err(ioerr)?;
        Ok(())
    }

    /// Write the audit findings + crawl metadata into the store, making the .db
    /// a complete, self-contained crawl artifact that [`to_result`](Self::to_result)
    /// can reload. Called once `crawl_to_store` has finished auditing.
    pub fn finalize(&self, result: &CrawlResult) -> io::Result<()> {
        self.begin()?;
        {
            let mut stmt = self
                .conn
                .prepare(
                    "INSERT INTO issue (rule, title, category, severity, url, detail) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                )
                .map_err(ioerr)?;
            for i in &result.issues {
                stmt.execute(params![
                    i.rule,
                    i.title,
                    token(&i.category),
                    token(&i.severity),
                    i.url,
                    i.detail,
                ])
                .map_err(ioerr)?;
            }
        }
        // The meta blob is the full result minus the heavy/duplicated fields:
        // pages live in the `page` table, issues in the `issue` table.
        let mut slim = result.clone();
        slim.pages = Vec::new();
        slim.issues = Vec::new();
        let blob = serde_json::to_string(&slim).map_err(ioerr)?;
        self.conn
            .execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('crawl', ?1)",
                params![blob],
            )
            .map_err(ioerr)?;
        self.commit()
    }

    /// The audit findings recorded in the store.
    pub fn issues(&self) -> io::Result<Vec<Issue>> {
        let mut stmt = self
            .conn
            .prepare("SELECT rule, title, category, severity, url, detail FROM issue")
            .map_err(ioerr)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Issue {
                    rule: r.get(0)?,
                    title: r.get(1)?,
                    category: category_from(&r.get::<_, String>(2)?),
                    severity: severity_from(&r.get::<_, String>(3)?),
                    url: r.get(4)?,
                    detail: r.get(5)?,
                })
            })
            .map_err(ioerr)?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    /// Load every stored page into memory (for rendering a small/medium crawl).
    pub fn load_pages(&self) -> io::Result<Vec<Page>> {
        let mut pages = Vec::new();
        self.for_each_page(|_, p| pages.push(p))?;
        Ok(pages)
    }

    /// Reconstruct the full [`CrawlResult`] from a finalized store. Returns
    /// `None` if the store was never finalized (no metadata). `include_pages`
    /// loads the full page list; leave it off for issue/summary-only views.
    pub fn to_result(&self, include_pages: bool) -> io::Result<Option<CrawlResult>> {
        let blob: Option<String> = self
            .conn
            .query_row("SELECT value FROM meta WHERE key = 'crawl'", [], |r| {
                r.get(0)
            })
            .optional()
            .map_err(ioerr)?;
        let Some(blob) = blob else { return Ok(None) };
        let mut result: CrawlResult = serde_json::from_str(&blob).map_err(ioerr)?;
        result.issues = self.issues()?;
        if include_pages {
            result.pages = self.load_pages()?;
        }
        Ok(Some(result))
    }

    /// Open a write transaction. Pair with [`commit`](Self::commit) to batch the
    /// per-page inserts during a crawl (and the derived-field write-back) into
    /// one fsync instead of thousands. Safe to call across `await` points since
    /// it only flips connection state.
    pub fn begin(&self) -> io::Result<()> {
        self.conn.execute_batch("BEGIN").map_err(ioerr)
    }

    /// Commit the open transaction.
    pub fn commit(&self) -> io::Result<()> {
        self.conn.execute_batch("COMMIT").map_err(ioerr)
    }
}
