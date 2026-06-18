//! Minimal robots.txt support: fetch, parse the rules for our user-agent, and
//! answer allow/deny. Also surfaces declared sitemaps.

use reqwest::Client;
use url::Url;

#[derive(Clone)]
struct Rule {
    allow: bool,
    path: String,
}

/// Parsed robots.txt rules applicable to our user-agent.
#[derive(Clone, Default)]
pub struct Robots {
    rules: Vec<Rule>,
    pub sitemaps: Vec<String>,
    pub found: bool,
}

impl Robots {
    /// Fetch and parse `/robots.txt` for `base`. Always returns a value; on any
    /// failure it's an empty (allow-all) ruleset with `found = false`.
    pub async fn fetch(client: &Client, base: &Url, user_agent: &str) -> Robots {
        let Ok(robots_url) = base.join("/robots.txt") else {
            return Robots::default();
        };
        let body = match client.get(robots_url).send().await {
            Ok(r) if r.status().is_success() => r.text().await.unwrap_or_default(),
            _ => return Robots::default(),
        };
        let mut robots = Robots::parse(&body, user_agent);
        robots.found = true;
        robots
    }

    /// Parse robots.txt text, selecting the most specific matching user-agent
    /// group (our token, else `*`).
    pub fn parse(text: &str, user_agent: &str) -> Robots {
        // Our agent token is the first word of the UA, lowercased ("crawlie/0.1" -> "crawlie").
        let ua_token = user_agent
            .split(['/', ' '])
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();

        let mut sitemaps = Vec::new();
        // Collect rules per group; track whether the current group applies to us.
        let mut star_rules: Vec<Rule> = Vec::new();
        let mut ua_rules: Vec<Rule> = Vec::new();
        let mut group_agents: Vec<String> = Vec::new();
        let mut group_rules: Vec<Rule> = Vec::new();
        let mut last_was_agent = false;

        let flush =
            |agents: &[String], rules: &[Rule], star: &mut Vec<Rule>, mine: &mut Vec<Rule>| {
                for a in agents {
                    if a == "*" {
                        star.extend(rules.iter().cloned());
                    }
                }
                // matched if our token contains the agent or vice-versa
                let matches_us = agents
                    .iter()
                    .any(|a| a != "*" && (a.contains(&ua_token) && !ua_token.is_empty()));
                if matches_us {
                    mine.extend(rules.iter().cloned());
                }
            };

        for raw in text.lines() {
            let line = raw.split('#').next().unwrap_or("").trim();
            if line.is_empty() {
                continue;
            }
            let Some((field, value)) = line.split_once(':') else {
                continue;
            };
            let field = field.trim().to_ascii_lowercase();
            let value = value.trim().to_string();
            match field.as_str() {
                "user-agent" => {
                    if !last_was_agent && (!group_agents.is_empty() || !group_rules.is_empty()) {
                        flush(&group_agents, &group_rules, &mut star_rules, &mut ua_rules);
                        group_agents.clear();
                        group_rules.clear();
                    }
                    group_agents.push(value.to_ascii_lowercase());
                    last_was_agent = true;
                }
                "disallow" => {
                    if !value.is_empty() {
                        group_rules.push(Rule {
                            allow: false,
                            path: value,
                        });
                    }
                    last_was_agent = false;
                }
                "allow" => {
                    group_rules.push(Rule {
                        allow: true,
                        path: value,
                    });
                    last_was_agent = false;
                }
                "sitemap" => {
                    sitemaps.push(value);
                    last_was_agent = false;
                }
                _ => last_was_agent = false,
            }
        }
        flush(&group_agents, &group_rules, &mut star_rules, &mut ua_rules);

        // Prefer rules that named us; fall back to the wildcard group.
        let rules = if !ua_rules.is_empty() {
            ua_rules
        } else {
            star_rules
        };
        Robots {
            rules,
            sitemaps,
            found: false,
        }
    }

    /// Is `path` (path + query) allowed? Uses longest-match wins, Allow breaking
    /// ties — the de-facto Google behaviour.
    pub fn allowed(&self, path: &str) -> bool {
        let mut best: Option<(&Rule, usize)> = None;
        for rule in &self.rules {
            if path_matches(&rule.path, path) {
                let len = rule.path.len();
                if best.map(|(_, l)| len > l).unwrap_or(true) {
                    best = Some((rule, len));
                }
            }
        }
        match best {
            Some((rule, _)) => rule.allow,
            None => true,
        }
    }
}

/// robots.txt pattern match supporting `*` wildcard and `$` end-anchor.
fn path_matches(pattern: &str, path: &str) -> bool {
    if pattern.is_empty() {
        return false;
    }
    let anchored = pattern.ends_with('$');
    let pat = pattern.trim_end_matches('$');
    let parts: Vec<&str> = pat.split('*').collect();

    let mut pos = 0usize;
    for (i, part) in parts.iter().enumerate() {
        if part.is_empty() {
            continue;
        }
        if i == 0 {
            // first part must match at the start
            if !path[pos..].starts_with(part) {
                return false;
            }
            pos += part.len();
        } else if let Some(found) = path[pos..].find(part) {
            pos += found + part.len();
        } else {
            return false;
        }
    }
    if anchored {
        pos == path.len()
    } else {
        true
    }
}
