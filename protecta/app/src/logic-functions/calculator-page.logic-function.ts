import { defineLogicFunction, type RoutePayload } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';
import { CALCULATOR } from 'src/constants/universal-identifiers';
import { htmlResponse } from 'src/lib/http';

const handler = async (_event: RoutePayload): Promise<Response> =>
  htmlResponse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Premium calculator · Protecta Bode</title>
<style>
*{box-sizing:border-box}
body{font-family:-apple-system,'Segoe UI',Roboto,sans-serif;margin:0;background:#DDF1F6;color:#0B1C48;overflow-x:hidden}
.wrap{max-width:560px;width:100%;margin:0 auto;padding:24px 16px 32px;box-sizing:border-box}
.card{background:#fff;border-radius:18px;padding:28px 22px;box-shadow:0 18px 40px -24px rgba(11,28,72,.35);width:100%;max-width:100%;box-sizing:border-box;overflow:hidden}
h1{font-size:clamp(22px,5vw,28px);margin:0 0 8px;line-height:1.15}
.money{display:flex;align-items:baseline;gap:10px;border-bottom:2px solid #0B1C48;padding:6px 2px 8px;margin-top:16px;max-width:100%}
.money input{flex:1;border:0;outline:0;background:transparent;font-size:clamp(28px,7vw,32px);font-weight:800;color:#0B1C48;min-width:0;max-width:100%}
input[type=range]{width:100%;max-width:100%;margin:16px 0 4px;accent-color:#CA6E2B;box-sizing:border-box}
.result{margin-top:18px;background:#0B1C48;color:#fff;border-radius:14px;padding:18px 18px;box-sizing:border-box;max-width:100%;overflow:hidden}
.result .amt{font-size:clamp(28px,6vw,38px);font-weight:800;word-break:break-word;overflow-wrap:break-word}
.result .meta{color:#C9D3EA;font-size:14px;margin-top:4px;word-break:break-word}
.cta{display:block;margin-top:20px;background:#CA6E2B;color:#fff!important;text-align:center;padding:14px 18px;border-radius:12px;font-weight:700;text-decoration:none;font-size:18px;box-sizing:border-box;max-width:100%}
.note{font-size:13px;color:#56607F;margin-top:12px;word-break:break-word}
@media (max-width:420px){.wrap{padding:16px 12px 24px}.card{padding:20px 14px;border-radius:14px}.cta{font-size:16px;padding:12px 14px}}
</style></head>
<body><div class="wrap"><div class="card">
<h1>Premium calculator</h1>
<div class="money"><span style="font-weight:700">UGX</span><input id="v" inputmode="numeric" placeholder="0" /></div>
<input type="range" id="r" min="5000000" max="300000000" step="500000" value="30000000" />
<div class="result"><div class="amt" id="p">UGX 0<small style="font-size:15px;font-weight:600"> / year</small></div><div class="meta" id="m">Enter your car’s value.</div></div>
<a class="cta" href="/s/protecta/">Proceed with this cover</a>
<p class="note">Terms and Conditions apply · Underwritten by Liberty General Insurance Uganda.</p>
</div></div>
<script>
(function(){
var RATE=0.015,MIN=1000000,v=document.getElementById('v'),r=document.getElementById('r');
fetch('/s/protecta/api/calc-config').then(function(x){return x.json()}).then(function(c){
if(c&&c.ok!==false){RATE=c.rate||RATE;MIN=c.minVehicleValue||MIN;r.min=c.minVehicleValue||5000000;r.max=c.maxVehicleValue||300000000;}
render(+(r.value||0));
}).catch(function(){render(+(r.value||0));});
function fmt(n){return 'UGX '+Math.round(n).toLocaleString('en-UG');}
function render(n){
n=Math.max(0,n||0);
v.value=n?n.toLocaleString('en-UG'):'';
r.value=Math.max(+r.min,Math.min(n,+r.max));
var ok=n>=MIN,p=Math.round(n*RATE);
document.getElementById('p').innerHTML=(ok?fmt(p):'UGX 0')+'<small style="font-size:15px;font-weight:600"> / year</small>';
document.getElementById('m').textContent=ok?((RATE*100)+'% of '+fmt(n)):'Enter your car’s value (from '+fmt(MIN)+').';
}
v.addEventListener('input',function(){render(+v.value.replace(/\\D/g,'').slice(0,11));});
r.addEventListener('input',function(){render(+r.value);});
render(30000000);
})();
</script></body></html>`);

export default defineLogicFunction({
  universalIdentifier: CALCULATOR,
  name: 'calculator-page',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/protecta/calculator',
    httpMethod: 'GET',
    isAuthRequired: false,
  },
});
