import { escapeHtml } from 'src/lib/http';
import { POLICY_TEMPLATE_BODY } from 'src/lib/policy-document/policy-template';
import {
  parseStructuredText,
  structuredTextToHtml,
} from 'src/lib/policy-document/structured-text';

/**
 * The policy wording from the Liberty "Motor Protecta Bode Policy"
 * (Protecta bode Final.docx): extensions, limits, exclusions, conditions and
 * endorsements. The personal schedule (names, vehicle, amounts) is left out;
 * any remaining placeholder reads "as stated in your Policy Schedule".
 */
export const policyWording = (): string => {
  const body = POLICY_TEMPLATE_BODY;
  const start = body.indexOf('## EXTENSIONS');
  const text = (start >= 0 ? body.slice(start) : body)
    .split('\n')
    // Drop the schedule's vehicle table and the signature block lines.
    .filter((line) => !/^\|.*\{\{/.test(line))
    .filter((line) => !/^(Issued by:|Authorised signatory:|Signed for and on behalf|_{5,}|…)/.test(line.trim()))
    .join('\n')
    .replace(/\{\{[a-zA-Z]+\}\}/g, 'as stated in your Policy Schedule');
  return structuredTextToHtml(parseStructuredText(text));
};

export const renderTermsPage = (opts: {
  logoUrl: string;
  supportPhone: string;
}): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Terms and Conditions · Protecta Bode</title>
<link rel="icon" type="image/png" href="${escapeHtml(opts.logoUrl)}">
<style>
:root{--navy:#0B1C48;--orange:#CA6E2B;--sky:#DDF1F6;--line:#BCDCE7;--ink:#162044;--muted:#56607F}
*{box-sizing:border-box}
body{margin:0;font-family:'Noto Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--ink);background:#fff;line-height:1.6;font-size:15px}
header{border-bottom:3px solid var(--navy);background:#fff;position:sticky;top:0;z-index:2}
.bar{max-width:880px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.bar img{height:44px;width:auto;display:block}
.bar a{color:var(--navy);font-weight:700;text-decoration:none;font-size:14px}
main{max-width:880px;margin:0 auto;padding:24px 20px 64px}
h1{font-size:clamp(24px,5vw,32px);color:var(--navy);margin:8px 0 4px;line-height:1.2}
.sub{color:var(--muted);margin:0 0 20px}
nav.toc{border-left:3px solid var(--orange);padding:4px 0 4px 14px;margin:0 0 28px}
nav.toc a{display:block;color:var(--navy);text-decoration:none;padding:2px 0}
nav.toc a:hover{text-decoration:underline}
h2{font-size:20px;color:var(--navy);margin:32px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--line)}
h3,h4{color:var(--navy);margin:18px 0 6px}
h3{font-size:16.5px}h4{font-size:15px}
p{margin:0 0 10px}
ul,ol{margin:0 0 12px;padding-left:22px}
li{margin:0 0 4px}
table{border-collapse:collapse;width:100%;margin:0 0 14px;font-size:14px}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
.wording{overflow-wrap:anywhere}
footer{max-width:880px;margin:0 auto;padding:18px 20px 40px;color:var(--muted);font-size:13px;border-top:1px solid var(--line)}
@media print{header{position:static}nav.toc{display:none}}
</style></head>
<body>
<header><div class="bar"><a href="/s/protecta/" aria-label="Protecta Bode home"><img src="${escapeHtml(opts.logoUrl)}" alt="Protecta Bode"></a><a href="/s/protecta/">← Back to quote</a></div></header>
<main>
<h1>Terms and Conditions</h1>
<p class="sub">Protecta Bode motor cover, underwritten by Liberty General Insurance Uganda Limited.</p>

<nav class="toc" aria-label="Contents">
  <a href="#service">1. Using Protecta Bode</a>
  <a href="#premium">2. Premium and payment</a>
  <a href="#cover">3. When cover starts and ends</a>
  <a href="#claims">4. Claims</a>
  <a href="#data">5. Your information</a>
  <a href="#wording">6. Policy wording</a>
</nav>

<h2 id="service">1. Using Protecta Bode</h2>
<p>Protecta Bode is a motor insurance product offered through this website and WhatsApp and underwritten by Liberty General Insurance Uganda Limited ("the Company"), regulated under the Insurance Regulatory Authority of Uganda (IRA) sandbox guidelines.</p>
<p>By ticking "I confirm these details are correct and I accept the Protecta Bode Terms and Conditions" you confirm that the information you give (name, phone, email, National ID or passport, vehicle make, model, year, number plate and value) is true and complete. Your policy is issued on the basis of that information. Wrong or incomplete information may make the policy void or reduce a claim payment.</p>

<h2 id="premium">2. Premium and payment</h2>
<ul>
<li>The annual premium is 1.5% of the vehicle value you declare, plus any levies, sticker fees, VAT and stamp duty shown in your Policy Schedule.</li>
<li>You can pay by MTN MoMo, Airtel Money or bank transfer to Stanbic Bank Uganda. Use your quote reference as the payment reference.</li>
<li>A quote is valid until the date shown on it. After that a new quote is needed.</li>
<li>The policy is issued only after the full premium is received (Premium Payment Warranty, below).</li>
</ul>

<h2 id="cover">3. When cover starts and ends</h2>
<p>Cover starts once payment is confirmed and your policy number is issued, and runs for the period shown in your Policy Schedule (normally 12 months). Your policy document is sent to you on WhatsApp and by email. The policy may be cancelled as set out in General Condition 9 (Cancellation) below.</p>

<h2 id="claims">4. Claims</h2>
<p>Report any accident, loss or damage immediately at <a href="/s/protecta/claims/new">Report a claim</a> or by calling ${escapeHtml(opts.supportPhone)}. Do not admit liability to any third party. The full claims conditions are in the policy wording below.</p>

<h2 id="data">5. Your information</h2>
<p>We use your details to prepare quotes, issue and service your policy, process payments and handle claims, and we share them with the Company and payment providers for those purposes only. We may contact you on WhatsApp, SMS or email about your quote, policy and claims.</p>

<h2 id="wording">6. Policy wording</h2>
<p>The Motor Protecta Bode Policy wording below forms part of your contract. Amounts and vehicle details specific to you are in your Policy Schedule.</p>
<div class="wording">${policyWording()}</div>
</main>
<footer>Protecta Bode is underwritten by Liberty General Insurance Uganda and regulated under the Insurance Regulatory Authority of Uganda, IRA, sandbox guidelines. Questions? Call ${escapeHtml(opts.supportPhone)}.</footer>
</body></html>`;
