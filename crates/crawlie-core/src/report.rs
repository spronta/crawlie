//! Saved-report storage. A `ReportStore` persists full crawl results as JSON in
//! a directory and maintains a lightweight `index.json` for fast listing. Used
//! by the CLI (`crawlie reports`) and the desktop app's history.

use crate::types::{CrawlResult, ReportMeta};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub struct ReportStore {
    dir: PathBuf,
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

impl ReportStore {
    pub fn new(dir: impl AsRef<Path>) -> Self {
        Self { dir: dir.as_ref().to_path_buf() }
    }

    fn ensure(&self) -> io::Result<()> {
        fs::create_dir_all(&self.dir)
    }

    fn index_path(&self) -> PathBuf {
        self.dir.join("index.json")
    }

    fn report_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.json"))
    }

    /// Save a crawl result, returning its metadata. Newest-first in the index.
    pub fn save(&self, result: &CrawlResult) -> io::Result<ReportMeta> {
        self.ensure()?;
        let id = format!("{}-{}", result.started_at, slugify(&result.config.url));
        let meta = ReportMeta {
            id: id.clone(),
            url: result.config.url.clone(),
            created_at: result.started_at,
            total_pages: result.summary.total_pages,
            errors: result.summary.errors,
            warnings: result.summary.warnings,
            health_score: result.summary.health_score,
            geo_score: result.summary.geo_score,
        };
        fs::write(self.report_path(&id), serde_json::to_vec_pretty(result)?)?;
        let mut index = self.list();
        index.retain(|m| m.id != id);
        index.insert(0, meta.clone());
        fs::write(self.index_path(), serde_json::to_vec_pretty(&index)?)?;
        Ok(meta)
    }

    /// List saved reports, newest first.
    pub fn list(&self) -> Vec<ReportMeta> {
        fs::read(self.index_path())
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    /// Load a full saved report by id.
    pub fn load(&self, id: &str) -> Option<CrawlResult> {
        fs::read(self.report_path(id))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
    }

    /// Delete a saved report by id.
    pub fn delete(&self, id: &str) -> io::Result<()> {
        let _ = fs::remove_file(self.report_path(id));
        let mut index = self.list();
        index.retain(|m| m.id != id);
        fs::write(self.index_path(), serde_json::to_vec_pretty(&index)?)?;
        Ok(())
    }
}
