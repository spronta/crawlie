//! Pack resolution — where `.crawlie` packs live and how a reference resolves.
//!
//! Three layers, in increasing precedence, plus an explicit path escape hatch:
//!
//! 1. **Built-in** — embedded in the binary (`slop-default`). Always available.
//! 2. **Global**   — `~/.crawlie/packs/<name>.crawlie`, shared across projects.
//! 3. **Repo**     — `<repo>/.crawlie/<name>.crawlie`, committed with the site.
//!
//! A repo pack shadows a global one of the same name, which shadows the
//! built-in. The same packs you commit are what CI and Crawlie Cloud run.
//!
//! The resolver takes explicit directories so the core engine stays pure and
//! testable — the CLI supplies `~/.crawlie/packs` and the discovered repo dir.

use crate::pack::RulePack;
use crate::parse::{self, ParseError};
use std::path::{Path, PathBuf};

/// Where a resolved pack came from — surfaced by `crawlie pack list/which`.
#[derive(Debug, Clone, PartialEq)]
pub enum Origin {
    Builtin,
    Global(PathBuf),
    Repo(PathBuf),
    Path(PathBuf),
}

impl Origin {
    pub fn label(&self) -> String {
        match self {
            Origin::Builtin => "built-in".into(),
            Origin::Global(p) => format!("global · {}", p.display()),
            Origin::Repo(p) => format!("repo · {}", p.display()),
            Origin::Path(p) => format!("path · {}", p.display()),
        }
    }
}

#[derive(Debug)]
pub enum ResolveError {
    NotFound(String),
    Io(String),
    Parse(String, ParseError),
}

impl std::fmt::Display for ResolveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ResolveError::NotFound(n) => write!(
                f,
                "no pack named `{n}` found (repo .crawlie/, ~/.crawlie/packs, or built-in)"
            ),
            ResolveError::Io(m) => write!(f, "{m}"),
            ResolveError::Parse(src, e) => write!(f, "{src}:{e}"),
        }
    }
}
impl std::error::Error for ResolveError {}

/// A resolved pack plus where it was found.
pub struct Resolved {
    pub pack: RulePack,
    pub origin: Origin,
}

/// A pack discovered during listing.
pub struct PackEntry {
    pub name: String,
    pub origin: Origin,
}

/// Resolves pack references against the repo and global directories.
pub struct Resolver {
    /// `<repo>/.crawlie`, if one was found.
    pub repo_dir: Option<PathBuf>,
    /// `~/.crawlie/packs`, if a home directory is known.
    pub global_dir: Option<PathBuf>,
}

impl Resolver {
    fn read_pack(name: &str, path: &Path) -> Result<RulePack, ResolveError> {
        let src = std::fs::read_to_string(path)
            .map_err(|e| ResolveError::Io(format!("{}: {e}", path.display())))?;
        parse::load(name, &src).map_err(|e| ResolveError::Parse(path.display().to_string(), e))
    }

    /// Resolve a reference. An explicit path (ends in `.crawlie` or contains a
    /// path separator) loads directly; a bare name resolves repo → global →
    /// built-in.
    pub fn resolve(&self, reference: &str) -> Result<Resolved, ResolveError> {
        let as_path = Path::new(reference);
        if (reference.ends_with(".crawlie") || reference.contains('/')) && as_path.is_file() {
            let name = as_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("pack");
            let pack = Self::read_pack(name, as_path)?;
            return Ok(Resolved {
                pack,
                origin: Origin::Path(as_path.to_path_buf()),
            });
        }

        let name = reference.trim_end_matches(".crawlie");

        if let Some(dir) = &self.repo_dir {
            let p = dir.join(format!("{name}.crawlie"));
            if p.is_file() {
                return Ok(Resolved {
                    pack: Self::read_pack(name, &p)?,
                    origin: Origin::Repo(p),
                });
            }
        }
        if let Some(dir) = &self.global_dir {
            let p = dir.join(format!("{name}.crawlie"));
            if p.is_file() {
                return Ok(Resolved {
                    pack: Self::read_pack(name, &p)?,
                    origin: Origin::Global(p),
                });
            }
        }
        if name == "slop-default" {
            let pack = crate::slop::default_pack()
                .map_err(|e| ResolveError::Parse("slop-default".into(), e))?;
            return Ok(Resolved {
                pack,
                origin: Origin::Builtin,
            });
        }
        Err(ResolveError::NotFound(name.to_string()))
    }

    /// Every pack visible to this resolver, repo first (shadowing wins), then
    /// global, then the built-in.
    pub fn available(&self) -> Vec<PackEntry> {
        let mut seen = std::collections::BTreeSet::new();
        let mut out = Vec::new();

        let mut scan = |dir: &Option<PathBuf>, repo: bool| {
            if let Some(dir) = dir {
                if let Ok(rd) = std::fs::read_dir(dir) {
                    let mut paths: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
                    paths.sort(); // deterministic listing
                    for p in paths {
                        if p.extension().and_then(|x| x.to_str()) != Some("crawlie") {
                            continue;
                        }
                        if let Some(name) = p.file_stem().and_then(|s| s.to_str()) {
                            if seen.insert(name.to_string()) {
                                let origin = if repo {
                                    Origin::Repo(p.clone())
                                } else {
                                    Origin::Global(p.clone())
                                };
                                out.push(PackEntry {
                                    name: name.to_string(),
                                    origin,
                                });
                            }
                        }
                    }
                }
            }
        };
        scan(&self.repo_dir, true);
        scan(&self.global_dir, false);

        if seen.insert("slop-default".to_string()) {
            out.push(PackEntry {
                name: "slop-default".into(),
                origin: Origin::Builtin,
            });
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let p =
            std::env::temp_dir().join(format!("crawlie-rules-test-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn builtin_resolves_with_no_dirs() {
        let r = Resolver {
            repo_dir: None,
            global_dir: None,
        };
        let got = r.resolve("slop-default").unwrap();
        assert_eq!(got.origin, Origin::Builtin);
    }

    #[test]
    fn repo_shadows_global_and_builtin() {
        let repo = tmp("repo");
        let global = tmp("global");
        std::fs::write(
            repo.join("slop-default.crawlie"),
            "phrase_rule(\"only\", weight = 1, phrases = [\"x\"])",
        )
        .unwrap();
        std::fs::write(
            global.join("slop-default.crawlie"),
            "phrase_rule(\"g\", weight = 1, phrases = [\"y\"])",
        )
        .unwrap();
        let r = Resolver {
            repo_dir: Some(repo.clone()),
            global_dir: Some(global),
        };
        let got = r.resolve("slop-default").unwrap();
        assert!(matches!(got.origin, Origin::Repo(_)));
        assert_eq!(got.pack.rules.len(), 1);
        assert_eq!(got.pack.rules[0].name, "only");
    }

    #[test]
    fn unknown_name_errors() {
        let r = Resolver {
            repo_dir: None,
            global_dir: None,
        };
        assert!(matches!(r.resolve("nope"), Err(ResolveError::NotFound(_))));
    }

    #[test]
    fn available_lists_builtin() {
        let r = Resolver {
            repo_dir: None,
            global_dir: None,
        };
        let names: Vec<_> = r.available().into_iter().map(|e| e.name).collect();
        assert!(names.contains(&"slop-default".to_string()));
    }
}
