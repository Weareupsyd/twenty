import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { CLAIM_PAGE } from 'src/constants/universal-identifiers';
import { htmlResponse } from 'src/lib/http';

const handler = async (event: RoutePayload): Promise<Response> => {
  const policy = (event.queryStringParameters?.policy ?? '').trim();
  return htmlResponse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Report a claim · Protecta Bode</title>
<style>
body{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;margin:0;background:#DDF1F6;color:#071B4D}
.wrap{max-width:560px;margin:0 auto;padding:32px 16px 64px}
.card{background:#fff;border-radius:18px;padding:28px;box-shadow:0 18px 40px -24px rgba(11,28,72,.35)}
label{display:block;font-size:13px;font-weight:600;color:#56607F;margin:14px 0 6px}
input,textarea{width:100%;padding:12px;border:1.5px solid #C9D3EA;border-radius:10px;font-size:16px;box-sizing:border-box}
button{margin-top:22px;width:100%;background:#CA6E2B;color:#fff;border:0;border-radius:12px;padding:14px;font-size:17px;font-weight:700;cursor:pointer}
#out{margin-top:16px;font-size:14px;display:none;border-radius:10px;padding:12px}
</style></head>
<body><div class="wrap"><div class="card">
<h1 style="margin:0">Report a claim</h1>
<p style="color:#56607F">Tell us what happened and our assessors will take it from there.</p>
<label>Policy number (optional — we match by phone)</label><input id="pol" value="${policy.replace(/[<>"&]/g, '')}" placeholder="PB-P-2026-…">
<label>Your phone (WhatsApp)</label><input id="phone" inputmode="tel" placeholder="0772 000 000">
<label>Date of incident</label><input id="date" type="date">
<label>Location</label><input id="loc" placeholder="e.g. Jinja Rd, Kampala">
<label>What happened?</label><textarea id="desc" rows="4" placeholder="Describe the incident, damage, and other parties involved"></textarea>
<button id="go">Submit claim</button>
<div id="out"></div>
</div></div>
<script>
document.getElementById('go').onclick=function(){
var q=function(i){return document.getElementById(i).value};
var out=document.getElementById('out');
out.style.display='block';out.style.background='#EEF3FF';out.style.color='#071B4D';out.textContent='Submitting…';
fetch('/s/protecta/api/claims',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
policyNo:q('pol'),reporterPhone:q('phone'),incidentDate:q('date')||undefined,location:q('loc')||undefined,description:q('desc')})})
.then(function(r){return r.json()}).then(function(d){
if(d.ok){out.style.background='#E6F6EC';out.style.color='#14532D';out.textContent='Claim received — reference '+d.claim.claimRef+' for policy '+d.claim.policyNo+'. Track it at /s/protecta/claims/view?ref='+d.claim.claimRef;}
else{out.style.background='#FDECEC';out.style.color='#7A1C1C';out.textContent=d.error||'Something went wrong.';}
}).catch(function(){out.style.background='#FDECEC';out.style.color='#7A1C1C';out.textContent='Network error. Please try again.';});
};
</script></body></html>`);
};

export default defineLogicFunction({
  universalIdentifier: CLAIM_PAGE,
  name: 'claim-page',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/claims/new',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
