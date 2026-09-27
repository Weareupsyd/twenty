import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { SUPPORT_PAGE } from 'src/constants/universal-identifiers';
import { htmlResponse } from 'src/lib/http';

const handler = async (_event: RoutePayload): Promise<Response> => {
  const wa = (
    process.env.SUPPORT_WHATSAPP ??
    process.env.SUPPORT_PHONE ??
    '+256312246500'
  ).replace(/[^\d]/g, '');
  return htmlResponse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Support · Protecta Bode</title>
<style>
body{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;margin:0;background:#DDF1F6;color:#071B4D}
.wrap{max-width:560px;margin:0 auto;padding:32px 16px 64px}
.card{background:#fff;border-radius:18px;padding:28px;box-shadow:0 18px 40px -24px rgba(11,28,72,.35)}
label{display:block;font-size:13px;font-weight:600;color:#56607F;margin:14px 0 6px}
input,textarea{width:100%;padding:12px;border:1.5px solid #C9D3EA;border-radius:10px;font-size:16px;box-sizing:border-box}
button{margin-top:22px;width:100%;background:#071B4D;color:#fff;border:0;border-radius:12px;padding:14px;font-size:17px;font-weight:700;cursor:pointer}
#out{margin-top:16px;font-size:14px;display:none;border-radius:10px;padding:12px}
.wa{display:block;margin-top:14px;text-align:center;background:#25D366;color:#fff!important;padding:13px;border-radius:12px;font-weight:700;text-decoration:none}
</style></head>
<body><div class="wrap"><div class="card">
<h1 style="margin:0">Talk to support</h1>
<p style="color:#56607F">We reply within one business day — or reach us instantly on WhatsApp.</p>
<label>Phone (WhatsApp)</label><input id="phone" inputmode="tel" placeholder="0772 000 000">
<label>Subject</label><input id="subject" placeholder="e.g. Payment not reflecting">
<label>How can we help?</label><textarea id="desc" rows="4"></textarea>
<button id="go">Send message</button>
<div id="out"></div>
<a class="wa" href="https://wa.me/${wa}" target="_blank" rel="noopener">Chat on WhatsApp</a>
</div></div>
<script>
document.getElementById('go').onclick=function(){
var out=document.getElementById('out');
out.style.display='block';out.style.background='#EEF3FF';out.style.color='#071B4D';out.textContent='Sending…';
fetch('/s/protecta/api/tickets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
phone:document.getElementById('phone').value,subject:document.getElementById('subject').value,
description:document.getElementById('desc').value,channel:'PORTAL'})})
.then(function(r){return r.json()}).then(function(d){
if(d.ok){out.style.background='#E6F6EC';out.style.color='#14532D';out.textContent='Received — ticket '+d.ticket.ticketRef+'. We will be in touch shortly.';}
else{out.style.background='#FDECEC';out.style.color='#7A1C1C';out.textContent=d.error||'Something went wrong.';}
}).catch(function(){out.style.background='#FDECEC';out.style.color='#7A1C1C';out.textContent='Network error. Please try again.';});
};
</script></body></html>`);
};

export default defineLogicFunction({
  universalIdentifier: SUPPORT_PAGE,
  name: 'support-page',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/support',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
