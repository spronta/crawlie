// Minimal, self-contained sign-in UI served by the Worker itself.
//
// Two entry points share one page:
//   GET /         → web sign-in (marketing "Get started" lands here)
//   GET /device   → device-flow verification: sign in, then approve the CLI /
//                   MCP / desktop code shown by `crawlie login`.
//
// The page talks to the Better Auth REST API on the same origin
// (/api/auth/*), so no cross-origin cookie juggling. Inner JS deliberately
// avoids template literals so it can live inside this template literal.

import type { Env } from "./env";

const STYLE = `
  :root { color-scheme: light dark; --bg:#fff; --fg:#0a0a0a; --muted:#6b7280;
    --border:#e5e7eb; --brand:#2563eb; --card:#fff; --ok:#059669; --err:#dc2626; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0a0a0a; --fg:#f5f5f5;
    --muted:#9ca3af; --border:#262626; --card:#111; } }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
    background:var(--bg); color:var(--fg); font:15px/1.5 ui-sans-serif,system-ui,
    -apple-system,"Segoe UI",Roboto,sans-serif; padding:24px; }
  .card { width:100%; max-width:400px; border:1px solid var(--border);
    border-radius:16px; background:var(--card); padding:32px; }
  .brand { display:flex; align-items:center; gap:8px; font-weight:650;
    font-size:18px; margin-bottom:4px; }
  .dot { width:10px; height:10px; border-radius:50%; background:var(--brand); }
  h1 { font-size:20px; margin:16px 0 4px; }
  p.sub { color:var(--muted); margin:0 0 20px; }
  .code { font:600 22px ui-monospace,SFMono-Regular,Menlo,monospace;
    letter-spacing:3px; text-align:center; padding:12px; border:1px dashed
    var(--border); border-radius:10px; margin-bottom:20px; }
  button, .btn { width:100%; padding:11px 14px; border-radius:10px; border:1px solid
    var(--border); background:var(--card); color:var(--fg); font-size:15px;
    font-weight:550; cursor:pointer; display:flex; align-items:center;
    justify-content:center; gap:8px; text-decoration:none; }
  button.primary { background:var(--brand); border-color:var(--brand); color:#fff; }
  button:disabled { opacity:.6; cursor:progress; }
  .row { margin-top:12px; }
  .sep { display:flex; align-items:center; gap:10px; color:var(--muted);
    font-size:13px; margin:18px 0; }
  .sep::before, .sep::after { content:""; flex:1; height:1px; background:var(--border); }
  input { width:100%; padding:11px 14px; border-radius:10px; border:1px solid
    var(--border); background:var(--bg); color:var(--fg); font-size:15px; }
  .msg { margin-top:14px; font-size:14px; min-height:20px; }
  .msg.ok { color:var(--ok); } .msg.err { color:var(--err); }
  .foot { margin-top:22px; font-size:12px; color:var(--muted); text-align:center; }
  a { color:var(--brand); }
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
        q('step2').style.display='block'; say('Code sent to '+email, true); })
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
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>${title} · Crawlie</title>
<style>${STYLE}</style>
</head><body>
<div class="card">
  <div class="brand"><span class="dot"></span> crawlie</div>
  <h1 id="title">${title}</h1>
  <p class="sub">${sub}</p>
  ${codeBlock}
  <div id="forms">
    <button class="primary" onclick="github()" id="gh">
      Continue with GitHub
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
  <div class="foot">Protected by Better Auth · <a href="https://crawlie.dev">crawlie.dev</a></div>
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
