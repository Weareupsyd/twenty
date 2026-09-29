import { escapeHtml } from 'src/lib/http';

export const CLAIM_API_PATH = '/s/protecta/api/claims';
export const CLAIM_TRACK_PATH = '/s/protecta/claims/view';
export const PROTECTA_LANDING_PATH = '/s/protecta/';
export const PROTECTA_LOGO_ASSET = 'brand/assets/protecta-bode-logo.png';

const HOME_ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M10 21v-6h4v6"/></svg>';

const STYLE = `
  :root { --navy: #071B4D; --orange: #CA6E2B; --muted: #56607F; --line: #C9D3EA; --info: #EEF3FF; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; background: #DDF1F6; color: var(--navy); }
  .page { min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 14px; }
  .card { width: 100%; max-width: 540px; background: #fff; border-radius: 16px; padding: 16px 20px; box-shadow: 0 18px 40px -26px rgba(11,28,72,.4); }
  .head { display: flex; align-items: center; gap: 12px; }
  .head img { height: 36px; width: auto; display: block; }
  .head h1 { margin: 0; font-size: 19px; line-height: 1.15; }
  .head p { margin: 3px 0 0; font-size: 12px; color: var(--muted); }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; margin-top: 13px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field.wide { grid-column: 1 / -1; }
  label { font-size: 11px; font-weight: 700; color: var(--muted); letter-spacing: .02em; text-transform: uppercase; }
  input, textarea { width: 100%; padding: 9px 11px; border: 1.5px solid var(--line); border-radius: 9px; font: inherit; font-size: 15px; color: var(--navy); background: #fff; }
  input:focus, textarea:focus { outline: none; border-color: #7FA8DF; box-shadow: 0 0 0 3px rgba(127,168,223,.25); }
  textarea { height: 58px; resize: none; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
  .btn { font: inherit; cursor: pointer; border-radius: 11px; padding: 12px 14px; font-weight: 700; text-align: center; text-decoration: none; }
  .btn-primary { flex: 1 1 180px; background: var(--orange); color: #fff; border: 0; font-size: 16px; }
  .btn-primary[disabled] { opacity: .65; cursor: default; }
  .btn-track { flex: 1 1 180px; background: var(--navy); color: #fff; font-size: 15px; }
  .btn-ghost { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; gap: 6px; background: #fff; border: 1.5px solid var(--line); color: var(--navy); font-size: 13px; }
  .btn-ghost:hover { border-color: var(--navy); }
  #out { display: none; margin-top: 11px; padding: 10px 12px; border-radius: 10px; font-size: 13px; line-height: 1.4; }
  #out.info { display: block; background: var(--info); }
  #out.ok { display: block; background: #E6F6EC; color: #14532D; }
  #out.bad { display: block; background: #FDECEC; color: #7A1C1C; }
  @media (max-width: 430px) { .grid { grid-template-columns: 1fr; } .head img { height: 30px; } }
  @media (max-height: 560px) {
    .head img { height: 26px; } .head h1 { font-size: 17px; } .grid { margin-top: 9px; gap: 7px 10px; }
    input, textarea { padding: 6px 10px; font-size: 14px; } textarea { height: 42px; }
    .btn { padding: 9px 12px; font-size: 15px; } .actions { margin-top: 10px; }
  }
`;

export const renderClaimFormPage = ({
  logoUrl,
  policy,
}: {
  logoUrl: string;
  policy: string;
}): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/png" href="${escapeHtml(logoUrl)}">
<title>Report a claim · Protecta Bode</title>
<style>${STYLE}</style></head>
<body><div class="page"><div class="card">
  <div class="head">
    <img src="${escapeHtml(logoUrl)}" alt="Protecta Bode" width="640" height="327">
    <div>
      <h1>Report a claim</h1>
      <p>Tell us what happened and our assessors will take it from there.</p>
    </div>
  </div>

  <div class="grid" id="form">
    <div class="field">
      <label for="pol">Policy number (optional — we match by phone)</label>
      <input id="pol" value="${escapeHtml(policy)}" placeholder="PB-P-2026-…">
    </div>
    <div class="field">
      <label for="phone">Your phone (WhatsApp)</label>
      <input id="phone" inputmode="tel" placeholder="0772 000 000">
    </div>
    <div class="field">
      <label for="date">Date of incident</label>
      <input id="date" type="date">
    </div>
    <div class="field">
      <label for="loc">Location</label>
      <input id="loc" placeholder="e.g. Jinja Rd, Kampala">
    </div>
    <div class="field wide">
      <label for="desc">What happened?</label>
      <textarea id="desc" placeholder="Describe the incident, damage, and other parties involved"></textarea>
    </div>
  </div>

  <div class="actions">
    <button type="button" class="btn btn-primary" id="go">Submit claim</button>
    <a class="btn btn-track" id="track" href="#" hidden>Track this claim</a>
    <a class="btn btn-ghost" href="${PROTECTA_LANDING_PATH}" title="Back to the Protecta Bode main page">${HOME_ICON}Back to main page</a>
  </div>

  <div id="out" role="status" aria-live="polite"></div>
</div></div>
<script>
(function(){
  var go=document.getElementById('go');
  var out=document.getElementById('out');
  var form=document.getElementById('form');
  var track=document.getElementById('track');
  var value=function(id){ return document.getElementById(id).value; };
  var say=function(kind,html){ out.className=kind; out.innerHTML=html; };
  go.onclick=function(){
    go.disabled=true;
    say('info','Submitting…');
    fetch('${CLAIM_API_PATH}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      policyNo:value('pol'),reporterPhone:value('phone'),incidentDate:value('date')||undefined,location:value('loc')||undefined,description:value('desc')})})
    .then(function(r){ return r.json(); }).then(function(d){
      if(d.ok){
        form.hidden=true;
        go.hidden=true;
        track.href='${CLAIM_TRACK_PATH}?ref='+encodeURIComponent(d.claim.claimRef);
        track.hidden=false;
        say('ok','Claim received — reference <b>'+d.claim.claimRef+'</b> for policy '+d.claim.policyNo+'. Our assessors will call you.');
      } else {
        go.disabled=false;
        say('bad',d.error||'Something went wrong.');
      }
    }).catch(function(){
      go.disabled=false;
      say('bad','Network error. Please try again.');
    });
  };
})();
</script></body></html>`;
