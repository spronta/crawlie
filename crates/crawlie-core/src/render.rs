//! Optional headless-Chrome rendering.
//!
//! By default crawlie audits the raw HTML a server returns. Modern sites
//! (React/Next/Vue/Angular, client-rendered Shopify themes, etc.) inject their
//! real content, links and meta tags only after JavaScript runs — so the raw
//! HTML a crawler sees is near-empty. When the `render` feature is built and the
//! caller opts in, the crawler drives a real headless browser, lets the page
//! hydrate, and feeds the **post-JS DOM** into the same parse + audit pipeline.
//!
//! The browser is launched once per crawl and shared (behind an `Arc`) across
//! the concurrent fetch tasks, each opening its own tab. A render failure for a
//! single page is non-fatal: the crawler falls back to that page's raw HTML.
//!
//! Built without the `render` feature, [`Renderer`] still exists as a stub so
//! the rest of the engine compiles unchanged — `launch` just reports that the
//! binary lacks rendering support.

#[cfg(feature = "render")]
pub use real::Renderer;

#[cfg(not(feature = "render"))]
pub use stub::Renderer;

/// What one page render produced: the post-JavaScript DOM plus lab Web Vitals
/// and contrast results when the browser could report them, and the output of
/// the user's custom JS snippet when one was configured.
pub struct Rendered {
    pub html: String,
    pub vitals: Option<crate::types::WebVitals>,
    /// (failing text elements, checked text elements) for WCAG AA contrast.
    pub contrast: Option<(usize, usize)>,
    /// JSON-encoded return value of the configured custom JS snippet.
    pub custom: Option<String>,
}

/// JS evaluated in the page to read buffered performance entries — the same
/// buffered-PerformanceObserver technique the web-vitals library uses.
#[cfg(feature = "render")]
const VITALS_JS: &str = r#"
(() => {
  const grab = (type) => {
    try {
      const po = new PerformanceObserver(() => {});
      po.observe({ type, buffered: true });
      const rec = po.takeRecords();
      po.disconnect();
      return rec;
    } catch (e) { return []; }
  };
  let lcp = 0;
  const lcpRec = grab('largest-contentful-paint');
  if (lcpRec.length) lcp = lcpRec[lcpRec.length - 1].startTime;
  let cls = 0;
  for (const e of grab('layout-shift')) if (!e.hadRecentInput) cls += e.value;
  let fcp = 0;
  try {
    const p = performance.getEntriesByName('first-contentful-paint');
    if (p.length) fcp = p[0].startTime;
  } catch (e) {}
  return { lcp, cls, fcp };
})()
"#;

/// WCAG AA contrast walker, evaluated in the rendered page. Computes the
/// contrast ratio between each visible text element's color and its effective
/// background (nearest non-transparent ancestor), using the WCAG relative-
/// luminance formula and the 4.5:1 / 3:1 (large text) thresholds — the same
/// check axe-core performs. Bounded to 1,500 elements.
#[cfg(feature = "render")]
const CONTRAST_JS: &str = r#"
(() => {
  const parse = (c) => {
    const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
  };
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const blend = (fg, bg) => {
    const a = fg[3];
    return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat([1]);
  };
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0.99) return c;
      n = n.parentElement;
    }
    return [255, 255, 255, 1];
  };
  let checked = 0, failures = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let node;
  while ((node = walker.nextNode()) && checked < 1500) {
    if (!node.textContent.trim()) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    let fg = parse(cs.color);
    if (!fg) continue;
    const bg = bgOf(el);
    if (fg[3] < 1) fg = blend(fg, bg);
    const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    const ratio = (l1 + 0.05) / (l2 + 0.05);
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    checked++;
    if (ratio < (large ? 3 : 4.5)) failures++;
  }
  return { failures, checked };
})()
"#;

/// Common macOS/Linux/Windows locations for a Chromium-family binary, tried in
/// order when the caller doesn't pin one. Returned to both impls so the error
/// path can hint at what was searched.
#[cfg(feature = "render")]
fn detect_chrome() -> Option<String> {
    const CANDIDATES: &[&str] = &[
        // macOS
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        // Linux
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/microsoft-edge",
        // Windows
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ];
    if let Ok(env) = std::env::var("CHROME") {
        if !env.is_empty() && std::path::Path::new(&env).exists() {
            return Some(env);
        }
    }
    CANDIDATES
        .iter()
        .find(|p| std::path::Path::new(p).exists())
        .map(|p| p.to_string())
}

#[cfg(feature = "render")]
mod real {
    use super::detect_chrome;
    use chromiumoxide::browser::{Browser, BrowserConfig};
    use futures::StreamExt;
    use std::time::Duration;
    use tokio::task::JoinHandle;
    use url::Url;

    /// A live headless browser, shared across a crawl. Drop closes the browser
    /// and tears down its event-handler task.
    pub struct Renderer {
        browser: Browser,
        handler: Option<JoinHandle<()>>,
        /// Hard ceiling on how long any one page render may take.
        nav_timeout: Duration,
    }

    impl Renderer {
        /// Launch a headless browser. `chrome_path` pins an executable; when
        /// `None`, common install locations (and `$CHROME`) are probed. Fails
        /// with a human-readable message when no browser can be found or spawned.
        pub async fn launch(
            chrome_path: Option<String>,
            nav_timeout_secs: u64,
        ) -> Result<Self, String> {
            let exe = chrome_path.or_else(detect_chrome).ok_or_else(|| {
                "no Chrome/Chromium/Edge found — install one or set $CHROME to its path".to_string()
            })?;

            let config = BrowserConfig::builder()
                .chrome_executable(exe)
                .new_headless_mode()
                // A real, modern desktop UA so sites serve their JS app, not a
                // bot/legacy fallback.
                .arg("--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
                .arg("--no-sandbox")
                .arg("--disable-gpu")
                .arg("--disable-dev-shm-usage")
                .build()?;

            let (browser, mut handler) = Browser::launch(config)
                .await
                .map_err(|e| format!("could not launch headless browser: {e}"))?;

            // The handler future must be polled for the CDP connection to work.
            let task = tokio::spawn(async move { while handler.next().await.is_some() {} });

            Ok(Self {
                browser,
                handler: Some(task),
                nav_timeout: Duration::from_secs(nav_timeout_secs.max(1)),
            })
        }

        /// Render `url` and return its post-JavaScript serialized DOM plus lab
        /// Web Vitals and WCAG contrast results. `wait_ms` is an extra settle
        /// delay after navigation for late hydration; `custom_js` is an
        /// optional user snippet whose JSON-encoded result is captured. Always
        /// closes the tab, even on error.
        pub async fn render_html(
            &self,
            url: &Url,
            wait_ms: u64,
            custom_js: Option<&str>,
        ) -> Result<super::Rendered, String> {
            let fut = self.render_inner(url, wait_ms, custom_js);
            match tokio::time::timeout(self.nav_timeout, fut).await {
                Ok(res) => res,
                Err(_) => Err("render timed out".to_string()),
            }
        }

        async fn render_inner(
            &self,
            url: &Url,
            wait_ms: u64,
            custom_js: Option<&str>,
        ) -> Result<super::Rendered, String> {
            let page = self
                .browser
                .new_page(url.as_str())
                .await
                .map_err(|e| format!("new tab failed: {e}"))?;

            let nav = page.wait_for_navigation().await;
            if wait_ms > 0 {
                tokio::time::sleep(Duration::from_millis(wait_ms)).await;
            }
            let html = match nav {
                Ok(p) => p.content().await,
                // Navigation reported an error, but the DOM may still be usable
                // (e.g. a slow sub-resource). Try to read it anyway.
                Err(_) => page.content().await,
            };
            // Read buffered performance entries; failure is non-fatal.
            #[derive(serde::Deserialize)]
            struct Raw {
                lcp: f64,
                cls: f64,
                fcp: f64,
            }
            let vitals = match page.evaluate(super::VITALS_JS).await {
                Ok(v) => v.into_value::<Raw>().ok().and_then(|r| {
                    (r.lcp > 0.0 || r.fcp > 0.0 || r.cls > 0.0).then_some(crate::types::WebVitals {
                        lcp_ms: r.lcp.round().max(0.0) as u32,
                        cls: r.cls as f32,
                        fcp_ms: r.fcp.round().max(0.0) as u32,
                    })
                }),
                Err(_) => None,
            };
            // WCAG contrast walk over the live computed styles.
            #[derive(serde::Deserialize)]
            struct Contrast {
                failures: usize,
                checked: usize,
            }
            let contrast = match page.evaluate(super::CONTRAST_JS).await {
                Ok(v) => v
                    .into_value::<Contrast>()
                    .ok()
                    .filter(|c| c.checked > 0)
                    .map(|c| (c.failures, c.checked)),
                Err(_) => None,
            };
            // User-configured snippet; its JSON result is captured verbatim.
            let custom = match custom_js {
                Some(js) => match page.evaluate(js).await {
                    Ok(v) => v.value().map(|j| j.to_string()),
                    Err(_) => None,
                },
                None => None,
            };
            let _ = page.close().await;
            html.map(|html| super::Rendered {
                html,
                vitals,
                contrast,
                custom,
            })
            .map_err(|e| format!("could not read rendered DOM: {e}"))
        }
    }

    impl Renderer {
        /// Load `url` (typically a `file://` report) and print it to PDF.
        pub async fn pdf(&self, url: &Url) -> Result<Vec<u8>, String> {
            use chromiumoxide::cdp::browser_protocol::page::PrintToPdfParams;
            let fut = async {
                let page = self
                    .browser
                    .new_page(url.as_str())
                    .await
                    .map_err(|e| format!("new tab failed: {e}"))?;
                let _ = page.wait_for_navigation().await;
                let params = PrintToPdfParams {
                    print_background: Some(true),
                    ..Default::default()
                };
                let bytes = page
                    .pdf(params)
                    .await
                    .map_err(|e| format!("print to PDF failed: {e}"));
                let _ = page.close().await;
                bytes
            };
            match tokio::time::timeout(self.nav_timeout, fut).await {
                Ok(res) => res,
                Err(_) => Err("PDF render timed out".to_string()),
            }
        }
    }

    impl Drop for Renderer {
        fn drop(&mut self) {
            if let Some(h) = self.handler.take() {
                h.abort();
            }
        }
    }
}

#[cfg(not(feature = "render"))]
mod stub {
    use url::Url;

    /// Placeholder used when the binary was built without the `render` feature.
    pub struct Renderer;

    impl Renderer {
        pub async fn launch(
            _chrome_path: Option<String>,
            _nav_timeout_secs: u64,
        ) -> Result<Self, String> {
            Err(
                "this build of crawlie was compiled without JavaScript rendering \
                 (the `render` feature)"
                    .to_string(),
            )
        }

        pub async fn render_html(
            &self,
            _url: &Url,
            _wait_ms: u64,
            _custom_js: Option<&str>,
        ) -> Result<super::Rendered, String> {
            Err("rendering unavailable".to_string())
        }

        pub async fn pdf(&self, _url: &Url) -> Result<Vec<u8>, String> {
            Err("rendering unavailable".to_string())
        }
    }
}
