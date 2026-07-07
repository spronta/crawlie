// Self-contained, brand-aligned sign-in UI served by the Worker itself.
//
// Two entry points share one page:
//   GET /         → web sign-in (marketing "Get started" lands here)
//   GET /device   → device-flow verification: sign in, then approve the CLI /
//                   MCP / desktop code shown by `crawlie login`.
//
// The page talks to the Better Auth REST API on the same origin
// (/api/auth/*), so no cross-origin cookie juggling. Inner JS deliberately
// avoids template literals so it can live inside this template literal.
//
// Visual language mirrors the marketing site (apps/website): dark-first, Geist
// type, brand blue #0055ee, the real crawlie logo lockup + crawl-graph mark.

import type { Env } from "./env";

// The real crawlie logo lockup (mark + wordmark), from apps/website BrandLockup.
// Wordmark inherits the page foreground; the mark keeps brand blue.
const LOGO = `<svg width="113" height="23.6" viewBox="0 0 2061 430" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="crawlie">
  <g fill="var(--fg)">
    <path d="M1933.75 397.683C1908.08 397.683 1885.58 391.849 1866.25 380.183C1847.25 368.183 1832.58 352.016 1822.25 331.683C1811.91 311.016 1806.75 287.683 1806.75 261.683C1806.75 235.683 1811.91 212.516 1822.25 192.183C1832.58 171.516 1847.25 155.349 1866.25 143.683C1885.58 131.683 1908.08 125.683 1933.75 125.683C1959.41 125.683 1981.75 131.516 2000.75 143.183C2020.08 154.849 2034.75 171.349 2044.75 192.683C2055.08 213.683 2060.25 237.849 2060.25 265.183V280.183H1864.75C1867.41 302.183 1874.58 319.516 1886.25 332.183C1898.25 344.849 1914.08 351.183 1933.75 351.183C1949.41 351.183 1962.58 347.849 1973.25 341.183C1984.25 334.183 1992.58 324.516 1998.25 312.183H2055.25C2046.91 338.516 2031.91 359.349 2010.25 374.683C1988.91 390.016 1963.41 397.683 1933.75 397.683ZM2001.25 237.183C1997.91 216.849 1990.41 201.016 1978.75 189.683C1967.08 178.016 1952.08 172.183 1933.75 172.183C1915.08 172.183 1899.91 178.016 1888.25 189.683C1876.58 201.016 1869.08 216.849 1865.75 237.183H2001.25Z"/>
    <path d="M1725.93 131.683H1783.43V391.683H1725.93V131.683ZM1725.93 31.6826H1783.43V88.1826H1725.93V31.6826Z"/>
    <path d="M1645.24 31.6826V320.683C1645.24 329.683 1647.24 336.183 1651.24 340.183C1655.24 344.183 1661.74 346.183 1670.74 346.183H1705.24V391.683H1657.24C1633.9 391.683 1616.4 386.849 1604.74 377.183C1593.4 367.516 1587.74 350.849 1587.74 327.183V31.6826H1645.24Z"/>
    <path d="M1370.29 203.683L1315.29 391.683H1255.79L1163.79 131.683H1226.29L1287.29 323.183L1342.29 131.683H1398.29L1452.79 322.683L1514.29 131.683H1576.29L1484.79 391.683H1424.79L1370.29 203.683Z"/>
    <path d="M1105.19 361.183C1094.52 374.183 1082.36 383.516 1068.69 389.183C1055.02 394.849 1039.69 397.683 1022.69 397.683C993.691 397.683 970.691 390.849 953.691 377.183C936.691 363.516 928.191 344.349 928.191 319.683C928.191 297.349 936.191 279.849 952.191 267.183C968.191 254.516 992.858 245.183 1026.19 239.183L1103.19 225.183V208.683C1103.19 196.016 1099.19 186.683 1091.19 180.683C1083.19 174.349 1070.69 171.183 1053.69 171.183C1037.36 171.183 1023.86 174.683 1013.19 181.683C1002.52 188.349 996.858 199.016 996.191 213.683H939.191C939.858 184.349 950.858 162.349 972.191 147.683C993.525 133.016 1020.52 125.683 1053.19 125.683C1088.52 125.683 1115.02 132.516 1132.69 146.183C1150.69 159.516 1159.69 178.349 1159.69 202.683V391.683H1105.19V361.183ZM1033.69 353.683C1052.69 353.683 1069.02 348.349 1082.69 337.683C1096.36 327.016 1103.19 311.183 1103.19 290.183V265.683L1036.69 279.183C1019.36 282.849 1006.69 287.349 998.691 292.683C991.025 297.683 987.191 306.016 987.191 317.683C987.191 328.683 991.025 337.516 998.691 344.183C1006.69 350.516 1018.36 353.683 1033.69 353.683Z"/>
    <path d="M765.902 131.683H821.402V177.683C838.069 145.016 864.736 128.683 901.402 128.683H921.402V182.183H898.902C874.902 182.183 856.236 188.349 842.902 200.683C829.902 212.683 823.402 233.349 823.402 262.683V391.683H765.902V131.683Z"/>
    <path d="M627 397.683C601.667 397.683 579.333 391.849 560 380.183C541 368.183 526.333 352.016 516 331.683C506 311.016 501 287.683 501 261.683C501 235.683 506 212.516 516 192.183C526.333 171.516 541 155.349 560 143.683C579.333 131.683 601.667 125.683 627 125.683C660.667 125.683 687.667 134.516 708 152.183C728.667 169.849 741 193.516 745 223.183H687C684 208.183 677.167 196.349 666.5 187.683C656.167 179.016 643 174.683 627 174.683C605.333 174.683 588.667 182.516 577 198.183C565.667 213.849 560 235.016 560 261.683C560 288.349 565.667 309.516 577 325.183C588.667 340.849 605.333 348.683 627 348.683C643.333 348.683 656.667 344.183 667 335.183C677.667 325.849 684.333 313.183 687 297.183H745C741.333 327.516 729 351.849 708 370.183C687 388.516 660 397.683 627 397.683Z"/>
    <path d="M174.795 364.538H304.606V430H0V125.791H174.795V364.538ZM401 304.209H226.205V65.4623H96.3943V0H401V304.209Z" fill="#0055ee"/>
  </g>
</svg>`;

// GitHub mark (from the marketing site header).
const GH_ICON = `<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>`;

// Small lock, footer trust mark.
const LOCK_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;

const STYLE = `
  :root{
    color-scheme:dark;
    --bg:#080a0f; --bg-soft:#0b0e14; --panel:#101319; --panel-2:#161a22;
    --fg:#f5f7fb; --heading:#ffffff; --muted:#9aa3b2; --muted-2:#6b7382;
    --border:#273040; --border-soft:#1b212c;
    --blue:#0055ee; --blue-hi:#1f6bff; --link:#3b9eff;
    --ok:#3ddc91; --err:#ff6166;
    --radius:16px; --radius-sm:10px;
    --font:'Geist',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
    --mono:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  }
  @media (prefers-color-scheme:light){
    :root{ color-scheme:light;
      --bg:#ffffff; --bg-soft:#f6f8fb; --panel:#ffffff; --panel-2:#f3f5f9;
      --fg:#1b2230; --heading:#0a1220; --muted:#586273; --muted-2:#8b94a3;
      --border:#d7dde7; --border-soft:#e6eaf1; }
  }
  *{ box-sizing:border-box; }
  html,body{ height:100%; }
  body{ margin:0; min-height:100dvh; display:grid; place-items:center; padding:24px;
    background:var(--bg); color:var(--fg); position:relative; overflow:hidden;
    font-family:var(--font); font-size:15px; line-height:1.5; letter-spacing:-0.011em;
    -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility; }
  /* Brand backdrop: a soft blue aurora... */
  body::before{ content:""; position:fixed; inset:0; z-index:0; pointer-events:none;
    background:
      radial-gradient(900px 520px at 50% -8%, rgba(0,85,238,.20), transparent 62%),
      radial-gradient(680px 680px at 90% 112%, rgba(59,158,255,.10), transparent 60%); }
  /* ...over a faint crawl-graph dot grid that fades toward the edges. */
  body::after{ content:""; position:fixed; inset:0; z-index:0; pointer-events:none;
    opacity:.6; color:var(--border-soft);
    background-image:radial-gradient(currentColor .7px, transparent .7px);
    background-size:24px 24px;
    -webkit-mask-image:radial-gradient(62% 52% at 50% 40%, #000, transparent 80%);
            mask-image:radial-gradient(62% 52% at 50% 40%, #000, transparent 80%); }
  .card{ position:relative; z-index:1; width:100%; max-width:396px;
    background:color-mix(in srgb, var(--panel) 86%, transparent);
    -webkit-backdrop-filter:blur(14px) saturate(1.4);
            backdrop-filter:blur(14px) saturate(1.4);
    border:1px solid var(--border-soft); border-radius:var(--radius);
    padding:34px 30px 24px;
    box-shadow:0 1px 0 rgba(255,255,255,.04) inset,
               0 26px 64px -28px rgba(0,0,0,.72); }
  .head{ text-align:center; margin-bottom:24px; }
  .logo{ display:inline-flex; margin-bottom:22px; opacity:.98; }
  h1{ font-size:21px; font-weight:600; letter-spacing:-0.021em;
    color:var(--heading); margin:0 0 6px; }
  p.sub{ color:var(--muted); margin:0 auto; max-width:30ch; font-size:14.5px; }
  .code{ font-family:var(--mono); font-weight:600; font-size:25px; letter-spacing:7px;
    text-align:center; color:var(--heading); padding:14px 10px;
    background:var(--panel-2); border:1px solid var(--border-soft);
    border-radius:var(--radius-sm); margin:0 0 22px; }
  button,.btn{ width:100%; height:47px; padding:0 16px; border-radius:var(--radius-sm);
    border:1px solid var(--border); background:var(--panel-2); color:var(--fg);
    font-family:inherit; font-size:14.5px; font-weight:550; cursor:pointer;
    display:flex; align-items:center; justify-content:center; gap:9px;
    text-decoration:none;
    transition:background .15s, border-color .15s, transform .1s, box-shadow .15s; }
  button:hover,.btn:hover{ background:var(--panel); border-color:var(--muted-2); }
  button:active{ transform:translateY(1px); }
  button.primary{ background:var(--blue); border-color:var(--blue); color:#fff;
    box-shadow:0 8px 22px -8px rgba(0,85,238,.75); }
  button.primary:hover{ background:var(--blue-hi); border-color:var(--blue-hi); }
  button:disabled{ opacity:.6; cursor:progress; }
  button svg{ flex:0 0 auto; }
  .row{ margin-top:10px; }
  .sep{ display:flex; align-items:center; gap:12px; color:var(--muted-2);
    font-size:11px; text-transform:uppercase; letter-spacing:.14em; margin:18px 2px; }
  .sep::before,.sep::after{ content:""; flex:1; height:1px; background:var(--border-soft); }
  input{ width:100%; height:47px; padding:0 14px; border-radius:var(--radius-sm);
    border:1px solid var(--border); background:var(--bg-soft); color:var(--fg);
    font-family:inherit; font-size:14.5px; letter-spacing:-.011em; outline:none;
    transition:border-color .15s, box-shadow .15s; }
  input::placeholder{ color:var(--muted-2); }
  input:focus{ border-color:var(--blue); box-shadow:0 0 0 3px rgba(0,85,238,.28); }
  #otp{ text-align:center; font-family:var(--mono); letter-spacing:6px; font-size:17px; }
  .msg{ margin-top:14px; font-size:13.5px; min-height:18px; text-align:center; color:var(--muted); }
  .msg.ok{ color:var(--ok); } .msg.err{ color:var(--err); }
  .consent{ margin:18px auto 0; max-width:32ch; font-size:11.5px; line-height:1.55;
    color:var(--muted-2); text-align:center; }
  .foot{ margin-top:18px; padding-top:15px; border-top:1px solid var(--border-soft);
    font-size:12px; color:var(--muted-2); text-align:center;
    display:flex; align-items:center; justify-content:center; gap:7px; }
  .foot .sepdot{ opacity:.5; }
  a{ color:var(--link); text-decoration:none; } a:hover{ text-decoration:underline; }
  @media (prefers-reduced-motion:no-preference){
    .card{ animation:rise .5s cubic-bezier(.2,.7,.2,1) both; }
    @keyframes rise{ from{ opacity:0; transform:translateY(10px) scale(.985); } }
  }
`;

// The client script. `MODE` and `AUTH_BASE` are injected below.
function script(authBase: string, mode: "web" | "device"): string {
  return `
  var AUTH='${authBase}', MODE='${mode}';
  function api(path, body){ return fetch(AUTH+path,{method:'POST',
    headers:{'content-type':'application/json'},credentials:'include',
    body:JSON.stringify(body||{})}); }
  function q(id){ return document.getElementById(id); }
  function say(t, ok){ var m=q('msg'); m.textContent=t||'';
    m.className='msg '+(ok===true?'ok':ok===false?'err':''); }
  function userCode(){ var u=new URL(location.href);
    return (u.searchParams.get('user_code')||'').trim(); }

  function github(){
    var cb = MODE==='device'
      ? location.origin+'/device?user_code='+encodeURIComponent(userCode())
      : location.origin+'/?welcome=1';
    say('Redirecting to GitHub…');
    api('/sign-in/social',{provider:'github',callbackURL:cb})
      .then(function(r){return r.json();})
      .then(function(d){ if(d && d.url){ location.href=d.url; }
        else { say('Could not start GitHub sign-in.', false); } })
      .catch(function(){ say('Network error.', false); });
  }

  function sendCode(e){
    e.preventDefault();
    var email=q('email').value.trim(); if(!email){ return; }
    q('send').disabled=true; say('Sending your code…');
    api('/email-otp/send-verification-otp',{email:email,type:'sign-in'})
      .then(function(r){ if(!r.ok){ throw 0; } q('step1').style.display='none';
        q('step2').style.display='block'; q('otp').focus(); say('Code sent to '+email, true); })
      .catch(function(){ say('Could not send a code. Try GitHub instead.', false); })
      .finally(function(){ q('send').disabled=false; });
  }

  function verifyCode(e){
    e.preventDefault();
    var email=q('email').value.trim(), otp=q('otp').value.trim();
    q('verify').disabled=true; say('Verifying…');
    api('/sign-in/email-otp',{email:email,otp:otp})
      .then(function(r){ if(!r.ok){ throw 0; } onSignedIn(); })
      .catch(function(){ say('That code did not work. Check and retry.', false); })
      .finally(function(){ q('verify').disabled=false; });
  }

  function onSignedIn(){
    if(MODE==='device'){ approve(); }
    else { say('You are signed in. You can close this tab and return to Crawlie.', true);
      q('forms').style.display='none';
      q('title').textContent='Signed in ✓'; }
  }

  function approve(){
    var code=userCode();
    say('Approving device…');
    api('/device/approve',{userCode:code})
      .then(function(r){ if(!r.ok){ throw 0; }
        q('forms').style.display='none';
        q('title').textContent='Device approved ✓';
        say('You are signed in. Return to your terminal — it will continue automatically.', true); })
      .catch(function(){ say('Could not approve this device. The code may have expired.', false); });
  }

  // On load: if already signed in, skip straight to approve/success.
  fetch(AUTH+'/get-session',{credentials:'include'})
    .then(function(r){return r.json();})
    .then(function(s){ if(s && s.user){ onSignedIn(); } })
    .catch(function(){});
  `;
}

function render(env: Env, mode: "web" | "device", userCode: string): string {
  const authBase = `${env.BETTER_AUTH_URL}/api/auth`;
  const title = mode === "device" ? "Approve this device" : "Sign in to Crawlie Cloud";
  const sub =
    mode === "device"
      ? "Confirm the code below matches your terminal, then sign in to approve."
      : "One account for the CLI, MCP server, desktop app and dashboard.";
  const codeBlock =
    mode === "device" && userCode
      ? `<div class="code" id="code">${escapeHtml(userCode)}</div>`
      : "";
  // Represent newsletter consent at the point of signup (opt-out, unsubscribe anytime).
  const consent =
    mode === "web"
      ? `<p class="consent">By continuing you agree to occasional Crawlie product
         updates by email. Unsubscribe anytime.</p>`
      : "";
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="dark light"/>
<meta name="robots" content="noindex"/>
<title>${title} · Crawlie</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@500;600&display=swap" rel="stylesheet"/>
<style>${STYLE}</style>
</head><body>
<div class="card">
  <div class="head">
    <a class="logo" href="https://crawlie.dev" aria-label="crawlie">${LOGO}</a>
    <h1 id="title">${title}</h1>
    <p class="sub">${sub}</p>
  </div>
  ${codeBlock}
  <div id="forms">
    <button class="primary" onclick="github()" id="gh">
      ${GH_ICON} Continue with GitHub
    </button>
    <div class="sep">or</div>
    <form id="step1" onsubmit="sendCode(event)">
      <input id="email" type="email" placeholder="you@company.com" autocomplete="email" required/>
      <div class="row"><button id="send" type="submit">Email me a sign-in code</button></div>
    </form>
    <form id="step2" onsubmit="verifyCode(event)" style="display:none">
      <input id="otp" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" required/>
      <div class="row"><button id="verify" class="primary" type="submit">Verify &amp; continue</button></div>
    </form>
  </div>
  <div class="msg" id="msg"></div>
  ${consent}
  <div class="foot">${LOCK_ICON} Protected by Better Auth <span class="sepdot">·</span> <a href="https://crawlie.dev">crawlie.dev</a></div>
</div>
<script>${script(authBase, mode)}</script>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export function webSignInPage(env: Env): string {
  return render(env, "web", "");
}

export function devicePage(env: Env, userCode: string): string {
  return render(env, "device", userCode);
}
