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
/// when the browser could report them.
pub struct Rendered {
    pub html: String,
    pub vitals: Option<crate::types::WebVitals>,
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
        /// Web Vitals. `wait_ms` is an extra settle delay after navigation for
        /// late hydration. Always closes the tab, even on error.
        pub async fn render_html(
            &self,
            url: &Url,
            wait_ms: u64,
        ) -> Result<super::Rendered, String> {
            let fut = self.render_inner(url, wait_ms);
            match tokio::time::timeout(self.nav_timeout, fut).await {
                Ok(res) => res,
                Err(_) => Err("render timed out".to_string()),
            }
        }

        async fn render_inner(&self, url: &Url, wait_ms: u64) -> Result<super::Rendered, String> {
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
            let _ = page.close().await;
            html.map(|html| super::Rendered { html, vitals })
                .map_err(|e| format!("could not read rendered DOM: {e}"))
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
        ) -> Result<super::Rendered, String> {
            Err("rendering unavailable".to_string())
        }
    }
}
