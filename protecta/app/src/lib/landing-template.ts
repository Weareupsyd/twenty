export type LandingAssets = {
  logo: string;
  kvWebp720: string;
  kvWebp1080: string;
  kvWebp1600: string;
  kvJpg720: string;
  kvJpg1080: string;
  kvJpg1600: string;
  mtn: string;
  airtel: string;
  stanbic: string;
  wa: string;
  email: string;
};

// Frontend page share actions use Hugeicons: <HugeiconsIcon icon={Mail01Icon} /> for email and <HugeiconsIcon icon={Mail01Icon} /> for whatsapp
// The landing HTML below inlines the Mail01Icon SVG (from @hugeicons/core-free-icons) so the static page renders without a React runtime,
// while the React front-component `landing-share` renders the same icon via <HugeiconsIcon icon={Mail01Icon} />.
const mail01Svg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M2 6L8.91302 9.91697C11.4616 11.361 12.5384 11.361 15.087 9.91697L22 6"></path><path d="M2.01577 13.4756C2.08114 16.5412 2.11383 18.0739 3.24496 19.2094C4.37608 20.3448 5.95033 20.3843 9.09883 20.4634C11.0393 20.5122 12.9607 20.5122 14.9012 20.4634C18.0497 20.3843 19.6239 20.3448 20.7551 19.2094C21.8862 18.0739 21.9189 16.5412 21.9842 13.4756C22.0053 12.4899 22.0053 11.5101 21.9842 10.5244C21.9189 7.45886 21.8862 5.92609 20.7551 4.79066C19.6239 3.65523 18.0497 3.61568 14.9012 3.53657C12.9607 3.48781 11.0393 3.48781 9.09882 3.53656C5.95033 3.61566 4.37608 3.65521 3.24495 4.79065C2.11382 5.92608 2.08114 7.45885 2.01576 10.5244C1.99474 11.5101 1.99475 12.4899 2.01577 13.4756Z"></path></svg>`;

const waSvg = `<svg width="20" height="20" viewBox="0 0 448 512" fill="currentColor" aria-hidden="true"><path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-82.7 184.6-184.5 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.5 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-2 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/></svg>`;

/**
 * Protecta Bode landing page + premium calculator, design preserved as-is.
 * Only the data layer is rewired: pricing comes from calc-config, quotes and
 * payments are created through the app's public JSON routes.
 */
export const renderLandingPage = (
  apiBase: string,
  a: LandingAssets,
  supportPhone: string,
  supportHref: string,
): string => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>Protecta Bode · Cover Your Ride, Cover Your Life · Liberty Uganda</title>
<meta name="description" content="Protecta Bode by Liberty General Insurance Uganda — motor cover in minutes." />
<meta name="theme-color" content="#0B1C48" />
<link rel="icon" type="image/png" href="${a.logo}" />
<link rel="preload" as="image" type="image/webp"
      imagesrcset="${a.kvWebp720} 720w, ${a.kvWebp1080} 1080w, ${a.kvWebp1600} 1600w"
      imagesizes="(min-width: 1024px) and (min-aspect-ratio: 5/4) 86svh, 100vw" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600;700&family=Poppins:wght@700;800&display=swap" rel="stylesheet" />
<style>
/* Protecta Bode brand tokens (sampled from the key visual) */
:root{
  --navy:#0B1C48;
  --navy-band:#0E1C4B;
  --ink:#162044;
  --orange:#CA6E2B;
  --orange-press:#B25E20;
  --sky:#DDF1F6;
  --sky-line:#BCDCE7;
  --sky-soft:#EEF8FB;
  --white:#FFFFFF;
  --muted:#56607F;
  --error:#B3261E;
  --ok:#1E7B4C;
  --radius:18px;
  --kv-ratio:1.16507;
  --band:0.05149;
  --panel-min:460px;
  --display:'Poppins',system-ui,sans-serif;
  --body:'Noto Sans',system-ui,sans-serif;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%;overflow-x:clip}
body{font-family:var(--body);color:var(--ink);background:var(--white);font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased;overflow-x:clip}
img{display:block;max-width:100%}
button,input,select{font:inherit;color:inherit}
[hidden]{display:none!important}
[tabindex="-1"]:focus{outline:none}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}

/* ───────── Stage: the key visual IS the landing page ───────── */
.stage{min-height:100svh;max-width:100vw;overflow-x:clip;background:var(--sky)}
.kv{background:var(--sky);min-width:0;overflow:hidden}
.kv-frame{position:relative;width:100%;max-width:100%;aspect-ratio:1080/1258.56}
.kv-frame img{width:100%;height:100%;max-width:100%;object-fit:contain;object-position:center bottom;font-size:0;color:transparent}
.kv-frame img.is-broken{display:none}
.kv-fallback{display:flex;flex-direction:column;min-height:100%;background:linear-gradient(180deg,#f4fbfe 0%,#ffffff 42%,#ffffff 88%,#0E1C4B 88%)}
.kv-fallback[hidden]{display:none!important}
.kv-fallback-inner{flex:1;display:flex;flex-direction:column;justify-content:center;padding:36px 28px 24px;text-align:center;color:var(--navy)}
.kv-fallback-brand{font-weight:800;letter-spacing:.14em;font-size:13px}
.kv-fallback-brand span{display:block;letter-spacing:0;font-weight:500;font-style:italic;font-size:14px;margin-top:2px}
.kv-fallback h2{font-family:var(--display);font-weight:800;font-size:clamp(40px,5vw,64px);line-height:.95;margin:18px 0 8px}
.kv-fallback h2 em{font-style:normal;color:var(--orange)}
.kv-fallback-headline{font-family:var(--display);font-weight:800;font-size:clamp(26px,3vw,36px);line-height:1.05;margin:8px 0 12px}
.kv-fallback p{font-size:15px}
.kv-fallback a{color:var(--navy);font-weight:800;text-decoration:none}
.kv-fallback-band{background:var(--navy-band);color:#d5deef;font-size:11px;line-height:1.35;text-align:center;padding:10px 16px}
.kv-call{position:absolute;left:25.4%;top:83.6%;width:50.4%;height:6.2%;border-radius:10px}
.kv-call:focus-visible{outline:3px solid var(--orange);outline-offset:2px}

.panel{background:var(--sky);display:flex;flex-direction:column;justify-content:center;min-height:100svh;overflow:hidden;width:100%;max-width:100vw;box-sizing:border-box}
.panel-inner{width:100%;max-width:560px;box-sizing:border-box;margin:0 auto;padding:20px 16px 24px;display:flex;flex-direction:column;justify-content:center;min-height:100svh;min-width:0}
.panel-band{display:none}

@media (min-width:1024px) and (min-aspect-ratio:5/4){
  .stage{
    --kv-h:min(100svh, calc((100vw - var(--panel-min)) * var(--kv-ratio)));
    display:grid;grid-template-columns:auto minmax(var(--panel-min),1fr);width:100%;gap:0;height:100svh;overflow:hidden;background:var(--sky);
  }
  .kv{position:sticky;top:0;height:100svh;display:flex;align-items:flex-end;justify-content:center;background:var(--sky)}
  .kv-frame{height:var(--kv-h);width:auto;max-height:100svh}
  html{scroll-padding-bottom:calc(var(--kv-h) * var(--band) + 24px)}
  /* Panel fills exactly one viewport; the navy band sits flush at the bottom,
     joined with the blue footer of the key visual and never moves. */
  .panel{height:100svh;min-height:0;justify-content:flex-start;overflow:hidden}
  .panel-inner{flex:1;min-height:0;max-width:560px;width:100%;margin:0 auto;padding:18px clamp(20px,3vw,48px);display:flex;flex-direction:column;justify-content:center}
  .card{flex:1;min-height:0;max-height:none}
  .card-body{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;overflow:auto;scrollbar-width:none;-ms-overflow-style:none}
  .card-body::-webkit-scrollbar{display:none}
  .panel-band{display:block;flex:none;height:calc(var(--kv-h) * var(--band));background:var(--navy-band)}
}

/* ───────── Card ───────── */
.card{background:var(--white);border:1px solid var(--sky-line);border-radius:var(--radius);box-shadow:0 18px 40px -24px rgba(11,28,72,.35);overflow:hidden;display:flex;flex-direction:column;width:100%;max-width:100%;min-width:0;box-sizing:border-box}
.card-body{padding:22px 22px;overflow:auto;min-width:0;box-sizing:border-box;width:100%}
@media (max-width:420px){.card-body{padding:18px 14px}.panel-inner{padding:16px 12px 20px}}

.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--orange)}
.eyebrow svg{width:14px;height:16px}
.title{font-family:var(--display);font-weight:800;color:var(--navy);font-size:clamp(24px,2.8vw,30px);line-height:1.12;letter-spacing:-.01em;margin:6px 0 10px}
.lede{color:var(--ink);font-size:14px}
.lede b,.hl{color:var(--orange);font-weight:700}
.fine{font-size:12.5px;color:var(--muted);overflow-wrap:break-word;word-break:break-word}

/* ───────── Calculator ───────── */
.field-label{display:block;font-size:12.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--navy);margin-bottom:6px}
.money{display:flex;align-items:baseline;gap:10px;border-bottom:2px solid var(--navy);padding:6px 2px 8px;transition:border-color .2s}
.money:focus-within{border-color:var(--orange)}
.money span{font-family:var(--display);font-weight:700;font-size:20px;color:var(--navy)}
.money input{flex:1;min-width:0;border:0;outline:0;background:transparent;font-family:var(--display);font-weight:800;font-size:clamp(28px,4vw,38px);color:var(--navy);letter-spacing:-.01em}
.money input::placeholder{color:#B7C3D6}
.calc{margin-top:12px;min-width:0;width:100%;box-sizing:border-box}

.range{position:relative;height:28px;margin:14px 0 4px}
.range-track,.range-fill{position:absolute;top:50%;height:6px;border-radius:6px;transform:translateY(-50%)}
.range-track{left:0;right:0;background:var(--sky)}
.range-fill{left:0;background:var(--navy);width:0}
.range input{position:absolute;inset:0;width:100%;height:100%;margin:0;background:transparent;-webkit-appearance:none;appearance:none;cursor:pointer}
.range input::-webkit-slider-runnable-track{background:transparent;height:28px}
.range input::-moz-range-track{background:transparent;height:28px}
.range input::-webkit-slider-thumb{-webkit-appearance:none;width:26px;height:26px;border-radius:50%;background:var(--orange);border:4px solid var(--white);box-shadow:0 0 0 1px var(--sky-line),0 4px 10px rgba(11,28,72,.25)}
.range input::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:var(--orange);border:4px solid var(--white);box-shadow:0 0 0 1px var(--sky-line),0 4px 10px rgba(11,28,72,.25)}
.range input:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 3px var(--navy)}
.range-scale{display:flex;justify-content:space-between;font-size:12px;color:var(--muted)}

.result{margin-top:14px;background:var(--navy);color:var(--white);border-radius:14px;padding:16px 18px;display:grid;grid-template-columns:1fr auto;gap:4px 16px;align-items:end;box-sizing:border-box;max-width:100%;min-width:0;overflow:hidden}
.result-label{font-size:12.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#C9D3EA;grid-column:1;grid-row:1;align-self:center;min-width:0}
.result-amount{grid-column:1/-1;grid-row:2}
.result-amount{font-family:var(--display);font-weight:800;font-size:clamp(26px,3.2vw,40px);line-height:1.05;letter-spacing:-.01em;white-space:normal;word-break:break-word;overflow-wrap:break-word;min-width:0}
.result-amount .cur{font-size:.5em;margin-right:6px;color:#C9D3EA;letter-spacing:.02em}
.result-amount small{font-family:var(--body);font-size:15px;font-weight:600;color:#C9D3EA;margin-left:4px;letter-spacing:0}
.result-rate{font-family:var(--display);font-weight:800;font-size:22px;color:var(--orange);background:var(--white);border-radius:10px;padding:4px 10px;line-height:1.2;grid-column:2;grid-row:1;font-size:18px;justify-self:end;max-width:100%}
.result-meta{grid-column:1/-1;font-size:13.5px;color:#C9D3EA;margin-top:6px;word-break:break-word;overflow-wrap:break-word;min-width:0}
.result.is-empty .result-amount{color:#8C9AC0}

.covers{list-style:none;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px;width:100%;max-width:100%;box-sizing:border-box}
.covers li{display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;padding:12px 8px;border:1px solid var(--sky-line);border-radius:12px;background:var(--sky-soft);font-size:13px;font-weight:600;color:var(--navy);line-height:1.25;min-width:0;box-sizing:border-box;word-break:break-word}
.covers svg{width:30px;height:34px}
@media (max-width:520px){
  .result{padding:18px}
  .result-amount{font-size:34px}
  #proceedBtn{font-size:17px}
}
@media (max-width:380px){.covers{grid-template-columns:1fr}.covers li{flex-direction:row;text-align:left;padding:10px 12px}}

/* ───────── Buttons ───────── */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;border:0;border-radius:12px;cursor:pointer;font-weight:700;font-size:18px;padding:15px 22px;transition:background .15s,transform .1s,opacity .15s;text-decoration:none}
.btn:active{transform:translateY(1px)}
.btn:focus-visible{outline:3px solid var(--navy);outline-offset:3px}
.btn-primary{background:var(--orange);color:var(--white)}
.btn-primary:hover{background:var(--orange-press)}
.btn-primary[disabled]{opacity:.45;cursor:not-allowed}
.btn-ghost{background:transparent;color:var(--navy);font-size:15.5px;padding:15px 10px}
.btn-ghost:hover{text-decoration:underline}
.btn-outline{background:var(--white);color:var(--navy);border:1.5px solid var(--sky-line);font-size:15px;padding:12px 16px}
.btn-outline:hover{border-color:var(--navy)}
.btn-block{width:100%;max-width:100%;white-space:normal;word-break:break-word;box-sizing:border-box}
.btn svg{width:20px;height:20px;flex:none}
.actions{display:flex;align-items:center;gap:8px;margin-top:22px;flex-wrap:wrap;max-width:100%;box-sizing:border-box}
.actions .btn-primary{flex:1}
.after{display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px 14px;margin-top:14px}
.after a{color:var(--navy);font-weight:600;text-decoration:none}
.after a:hover{text-decoration:underline}

/* ───────── Flow chrome ───────── */
.flow-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 28px;background:var(--sky-soft);border-bottom:1px solid var(--sky-line)}
.flow-head img{height:34px;width:auto}
.flow-premium{text-align:right;line-height:1.2}
.flow-premium span{display:block;font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.flow-premium button{background:none;border:0;cursor:pointer;font-family:var(--display);font-weight:800;font-size:18px;color:var(--navy);display:inline-flex;align-items:center;gap:6px}
.flow-premium button svg{width:14px;height:14px;color:var(--orange)}
@media (max-width:420px){.flow-head{padding:12px 18px}}

.stepper{list-style:none;display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:22px}
.stepper li{font-size:12px;font-weight:600;color:var(--muted);display:flex;flex-direction:column;gap:7px}
.stepper li::before{content:"";height:4px;border-radius:4px;background:var(--sky)}
.stepper li.done::before{background:var(--navy)}
.stepper li.current{color:var(--navy)}
.stepper li.current::before{background:var(--orange)}

.step-title{font-family:var(--display);font-weight:800;font-size:24px;color:var(--navy);line-height:1.2;margin-bottom:4px}
.step-sub{color:var(--muted);font-size:14.5px;margin-bottom:20px}

.grid{display:grid;grid-template-columns:1fr;gap:16px}
.grid .full{grid-column:1/-1}
.f{display:flex;flex-direction:column;gap:6px}
.f label{font-size:13px;font-weight:700;color:var(--navy)}
.f input,.f select{width:100%;border:1.5px solid var(--sky-line);border-radius:10px;padding:12px 13px;background:var(--white);font-size:15.5px;transition:border-color .15s,box-shadow .15s}
.f select{appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%230B1C48' stroke-width='2'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;padding-right:36px}
.f input:focus,.f select:focus{outline:0;border-color:var(--navy);box-shadow:0 0 0 3px rgba(11,28,72,.12)}
.f input[readonly]{background:var(--sky-soft);color:var(--navy);font-weight:600}
.f .hint{font-size:12.5px;color:var(--muted)}
.f .err{font-size:12.5px;color:var(--error);display:none}
.f.invalid input,.f.invalid select{border-color:var(--error)}
.f.invalid .err{display:block}
.f.invalid .hint{display:none}
.tel{display:flex}
.tel span{display:flex;align-items:center;padding:0 12px;border:1.5px solid var(--sky-line);border-right:0;border-radius:10px 0 0 10px;background:var(--sky-soft);font-weight:600;color:var(--navy);font-size:15px}
.tel input{border-radius:0 10px 10px 0}
.check{display:flex;gap:10px;align-items:flex-start;font-size:14px;color:var(--ink);cursor:pointer}
.check input{width:20px;height:20px;margin-top:1px;accent-color:var(--navy);flex:none}
.check.invalid{color:var(--error)}

.review{border:1px solid var(--sky-line);border-radius:14px;overflow:hidden;margin-bottom:22px}
.review-top{background:var(--navy);color:var(--white);padding:16px 18px;display:flex;justify-content:space-between;align-items:flex-end;gap:10px}
.review-top span{display:block;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#C9D3EA;font-weight:700}
.review-top strong{font-family:var(--display);font-weight:800;font-size:26px;line-height:1.1}
.review-top em{font-style:normal;font-family:var(--display);font-weight:800;color:var(--orange);background:var(--white);border-radius:8px;padding:2px 8px;font-size:15px}
.review dl{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;padding:16px 18px}
.review dt{font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700}
.review dd{font-weight:600;color:var(--navy);font-size:14.5px;word-break:break-word}
.review .edit{grid-column:1/-1;display:flex;gap:14px;padding-top:4px;border-top:1px dashed var(--sky-line);margin-top:4px;padding-top:12px}
.review .edit button{background:none;border:0;cursor:pointer;color:var(--orange);font-weight:700;font-size:13.5px}

.methods{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
.method{position:relative;display:flex;flex-direction:column;align-items:center;gap:8px;border:1.5px solid var(--sky-line);border-radius:12px;padding:12px 8px;cursor:pointer;background:var(--white);font-size:13px;font-weight:600;color:var(--navy);text-align:center;transition:border-color .15s,box-shadow .15s}
.method input{position:absolute;opacity:0;pointer-events:none}
.method img{height:34px;width:auto;max-width:90%;object-fit:contain}
.method:has(input:checked){border-color:var(--navy);box-shadow:0 0 0 2px var(--navy)}
.method:has(input:focus-visible){outline:3px solid var(--orange);outline-offset:2px}
.pay-panel{display:none}
.pay-panel.show{display:block}
.bank{border:1px solid var(--sky-line);border-radius:12px;background:var(--sky-soft);padding:14px 16px;display:grid;gap:8px;font-size:14.5px}
.bank div{display:flex;justify-content:space-between;gap:10px}
.bank span{color:var(--muted)}
.bank strong{color:var(--navy)}
.pending{display:none;align-items:center;gap:12px;margin-top:16px;padding:14px 16px;border-radius:12px;background:var(--sky-soft);border:1px solid var(--sky-line);font-size:14.5px;color:var(--navy)}
.pending.show{display:flex}
.spinner{width:22px;height:22px;border-radius:50%;border:3px solid var(--sky-line);border-top-color:var(--orange);animation:spin .8s linear infinite;flex:none}
@keyframes spin{to{transform:rotate(360deg)}}

.done{text-align:center}
.done-mark{width:84px;height:96px;margin:6px auto 14px}
.ref{display:inline-block;margin:18px 0 6px;padding:12px 20px;border:1.5px dashed var(--orange);border-radius:12px}
.ref span{display:block;font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:700}
.ref strong{font-family:var(--display);font-weight:800;font-size:22px;color:var(--navy);letter-spacing:.04em}
.share{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:20px}
.share .btn{font-size:14px;padding:12px 8px}
@media (max-width:420px){.share{grid-template-columns:1fr}}

[data-step]{display:none}
[data-step].active{display:block;animation:rise .28s ease both}
@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}

@media (min-width:1024px) and (max-height:920px){
  .panel-inner{padding-top:18px;padding-bottom:18px}
  .card-body{padding:20px 22px}
  .title{font-size:26px;margin:4px 0 8px}
  .calc{margin-top:10px}
  .range{margin:10px 0 4px}
  .result{margin-top:12px;padding:12px 16px}
  .result-amount{font-size:30px}
  .covers{margin-top:10px}
  .covers li{flex-direction:row;justify-content:center;padding:8px 6px;gap:6px}
  .covers svg{width:20px;height:23px}
  #proceedBtn{margin-top:12px!important;padding:12px 18px}
}

/* ───────── Fit-to-screen layout ─────────
   The card always fits the visible screen. Content that does not fit
   scrolls inside the card, and the Next / Back / Pay buttons stay pinned
   at the bottom so they never need a page scroll to reach. */
.card-body{justify-content:flex-start!important;scrollbar-width:thin!important;-ms-overflow-style:auto!important;-webkit-overflow-scrolling:touch}
.card-body::-webkit-scrollbar{display:block!important;width:6px}
.card-body::-webkit-scrollbar-thumb{background:var(--sky-line);border-radius:6px}
[data-step].active{display:flex;flex-direction:column;flex:1 0 auto;min-height:0}
[data-step].active>form{display:flex;flex-direction:column;flex:1 0 auto}
[data-step].active>form>.actions{margin-top:auto}
[data-step=calc].active{justify-content:center}
[data-step=calc].active>.calc{display:flex;flex-direction:column}
.actions{position:sticky;bottom:0;z-index:2;background:var(--white);padding:12px 0 2px;margin-top:16px;box-shadow:0 -10px 12px -10px rgba(11,28,72,.18)}
.actions .btn{flex:1 1 auto}
.actions .btn-ghost{flex:0 0 auto}
.btn,.title,.step-title,.step-sub,.fine,.lede,.covers li,.method,.stepper li{overflow-wrap:anywhere;hyphens:auto}
.stepper li{font-size:clamp(10px,2.6vw,12px)}
.title{font-size:clamp(20px,min(6vw,4.2svh),30px)}
.step-title{font-size:clamp(19px,min(5.4vw,3.6svh),24px)}
.money input{font-size:clamp(22px,min(8vw,5svh),38px)}
.result-amount{font-size:clamp(22px,min(8vw,5svh),40px)!important}
@media (min-width:520px){.grid{grid-template-columns:1fr 1fr}}

/* Phones and tablets: the calculator comes first and fills the screen;
   the poster follows below it. */
@media not all and (min-width:1024px) and (min-aspect-ratio:5/4){
  .stage{display:flex;flex-direction:column}
  .panel{order:-1;height:100svh;min-height:0;justify-content:stretch}
  .panel-inner{height:100%;min-height:0;padding:10px 10px 12px;justify-content:stretch}
  .card{flex:1;min-height:0}
  .card-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:auto}
  .flow-head{padding:10px 16px}
  .flow-head img{height:28px}
}

/* Short screens: tighten spacing so the whole step fits without scrolling. */
@media (max-height:820px){
  .card-body{padding:16px 18px}
  .stepper{margin-bottom:12px}
  .step-sub{margin-bottom:12px;font-size:13.5px}
  .grid{gap:10px 12px}
  .f input,.f select{padding:9px 11px;font-size:15px}
  .title{margin:2px 0 6px}
  .calc{margin-top:8px}
  .range{margin:8px 0 2px}
  .result{margin-top:10px;padding:10px 14px}
  .covers{margin-top:8px}
  .covers li{flex-direction:row;justify-content:center;padding:7px 6px;gap:6px;font-size:12.5px}
  .covers svg{width:18px;height:21px}
  #proceedBtn{margin-top:12px!important;padding:12px 16px}
  #proceedBtn+.btn{margin-top:8px!important;padding:10px 16px}
  .after{margin-top:8px}
  .review{margin-bottom:12px}
  .review-top{padding:10px 14px}
  .review-top strong{font-size:22px}
  .review dl{padding:10px 14px;gap:8px 12px}
  .methods{margin-bottom:10px;gap:8px}
  .method{padding:8px 6px;gap:4px}
  .method img{height:24px}
  .done-mark{width:56px;height:64px;margin:0 auto 8px}
  .ref{margin:10px 0 4px}
  .share{margin-top:12px}
}
@media (max-height:660px){
  .covers,.result-meta,.step-sub{display:none}
  .range-scale{font-size:11px}
  .review .edit{padding-top:6px}
  .f .hint{display:none}
}
@media print{
  .kv,.panel-band,.flow-head button,.share,.no-print{display:none!important}
  .panel{background:#fff}
  .card{box-shadow:none;border:0}
}
</style>
</head>
<body>

<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="shield" viewBox="0 0 30 34"><path d="M15 1.5 2.5 6v9.2c0 8 5.3 14.3 12.5 17.3 7.2-3 12.5-9.3 12.5-17.3V6L15 1.5Z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/></symbol>
  <symbol id="shield-fill" viewBox="0 0 30 34"><path d="M15 1.5 2.5 6v9.2c0 8 5.3 14.3 12.5 17.3 7.2-3 12.5-9.3 12.5-17.3V6L15 1.5Z" fill="currentColor"/></symbol>
  <symbol id="arrow" viewBox="0 0 20 20"><path d="M4 10h11m-4.5-5 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="pencil" viewBox="0 0 16 16"><path d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3L11 2.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></symbol>
</svg>

<main class="stage">

  <section class="kv" aria-label="Protecta Bode">
    <div class="kv-frame">
      <picture>
        <source type="image/webp"
                srcset="${a.kvWebp720} 720w, ${a.kvWebp1080} 1080w, ${a.kvWebp1600} 1600w"
                sizes="(min-width: 1024px) and (min-aspect-ratio: 5/4) 86svh, 100vw" />
        <img src="${a.kvJpg1080}"
             srcset="${a.kvJpg720} 720w, ${a.kvJpg1080} 1080w, ${a.kvJpg1600} 1600w"
             sizes="(min-width: 1024px) and (min-aspect-ratio: 5/4) 86svh, 100vw"
             width="1080" height="1259" fetchpriority="high" decoding="async"
             alt="Protecta Bode"
             onerror="this.classList.add('is-broken');var f=document.getElementById('kvFallback');if(f)f.hidden=false;" />
      </picture>
      <div class="kv-fallback" id="kvFallback" hidden>
        <div class="kv-fallback-inner">
          <p class="kv-fallback-brand">LIBERTY <span>In it with you</span></p>
          <h2>Protecta <em>Bode</em></h2>
          <p class="kv-fallback-headline">Cover Your Ride<br>Cover Your Life</p>
          <p>Terms and Conditions apply.</p>
          <p><a href="${supportHref}">Call ${supportPhone} today</a></p>
        </div>
        <p class="kv-fallback-band">Protecta Bode is underwritten by Liberty General Insurance Uganda and regulated under the Insurance Regulatory Authority of Uganda, IRA, sandbox guidelines.</p>
      </div>
      <a class="kv-call" href="${supportHref}" aria-label="Call ${supportPhone}"></a>
    </div>
  </section>

  <section class="panel" id="calculator" aria-label="Protecta Bode premium calculator">
    <div class="panel-inner">
      <div class="card">

        <div class="flow-head" id="flowHead" hidden>
          <img src="${a.logo}" alt="Protecta Bode" width="640" height="327" />
          <div class="flow-premium">
            <span>Annual premium</span>
            <button type="button" data-goto="calc" aria-label="Edit car value"><b id="headPremium">UGX 0</b><svg><use href="#pencil"/></svg></button>
          </div>
        </div>

        <div class="card-body">
          <ol class="stepper" id="stepper" hidden aria-label="Progress">
            <li data-s="vehicle">Vehicle</li>
            <li data-s="details">Your details</li>
            <li data-s="pay">Payment</li>
            <li data-s="done">Covered</li>
          </ol>

          <section data-step="calc" class="active" aria-labelledby="calcTitle">
            <h1 class="title" id="calcTitle">Calculate your premium</h1>
            <p class="fine" id="resumeRow" style="margin-top:8px">Already have a quote? <a href="#" id="resumeLink">Resume payment</a> · <a href="/s/protecta/quotes/resume">Find my quotes</a></p>

            <div class="calc">
              <label class="field-label" for="carValue">Your car’s value</label>
              <div class="money">
                <span aria-hidden="true">UGX</span>
                <input id="carValue" type="text" inputmode="numeric" autocomplete="off" placeholder="0" aria-describedby="valueHelp" />
              </div>
              <div class="range">
                <div class="range-track"></div>
                <div class="range-fill" id="rangeFill"></div>
                <input type="range" id="carRange" min="5000000" max="300000000" step="500000" aria-label="Car value slider" />
              </div>
              <div class="range-scale" aria-hidden="true"><span>5M</span><span>300M+</span></div>
              <p class="sr-only" id="valueHelp">Enter the current market value of your car in Uganda shillings.</p>

              <div class="result" id="result" aria-live="polite">
                <span class="result-label">Your annual premium</span>
                <div class="result-amount"><span id="premium"><span class="cur">UGX</span>0</span><small>/ year</small></div>
                <span class="result-rate" aria-label="rate 1.5 percent">1.5%</span>
                <span class="result-meta" id="resultMeta">Enter your car’s value to see your premium.</span>
              </div>

              <ul class="covers" aria-label="What you are covered for">
                <li><svg style="color:var(--navy)"><use href="#shield"/></svg>Car body</li>
                <li><svg style="color:var(--orange)"><use href="#shield"/></svg>Third party</li>
                <li><svg style="color:var(--navy)"><use href="#shield"/></svg>Driver cover</li>
              </ul>

              <button type="button" class="btn btn-primary btn-block" id="proceedBtn" style="margin-top:22px" disabled>
                Proceed with this cover <svg><use href="#arrow"/></svg>
              </button>
              <a class="btn btn-outline btn-block" href="/s/protecta/claims/new" style="margin-top:12px">Report a claim</a>
              <div class="after fine">
                <span>Terms and Conditions apply</span>
                <a href="${supportHref}">Call ${supportPhone}</a>
              </div>
            </div>
          </section>

          <section data-step="vehicle" aria-labelledby="vehTitle">
            <h2 class="step-title" id="vehTitle">Tell us about your car</h2>
            <p class="step-sub">We’ll use this to prepare your Protecta Bode policy.</p>
            <form id="vehicleForm" novalidate>
              <div class="grid">
                <div class="f">
                  <label for="make">Make</label>
                  <input id="make" name="make" list="makeList" autocomplete="off" placeholder="e.g. Toyota" required />
                  <datalist id="makeList"></datalist>
                  <span class="err">Enter your car’s make.</span>
                </div>
                <div class="f">
                  <label for="model">Model</label>
                  <input id="model" name="model" list="modelList" autocomplete="off" placeholder="e.g. Premio" required />
                  <datalist id="modelList"></datalist>
                  <span class="err">Enter your car’s model.</span>
                </div>
                <div class="f">
                  <label for="year">Year of manufacture</label>
                  <select id="year" name="year" required><option value="">Select year</option></select>
                  <span class="err">Select the year.</span>
                </div>
                <div class="f">
                  <label for="plate">Number plate</label>
                  <input id="plate" name="plate" autocomplete="off" placeholder="UAA 123A" maxlength="10" required style="text-transform:uppercase;letter-spacing:.06em;font-weight:600" />
                  <span class="err">Enter a valid number plate, e.g. UBK 123A.</span>
                </div>
                <div class="f full">
                  <label for="valueRo">Car value</label>
                  <input id="valueRo" readonly tabindex="-1" />
                  <span class="hint">From your calculation. <a href="#" data-goto="calc" style="color:var(--orange);font-weight:700">Change value</a></span>
                </div>
              </div>
              <div class="actions">
                <button type="button" class="btn btn-ghost" data-goto="calc">Back</button>
                <button type="submit" class="btn btn-primary">Continue <svg><use href="#arrow"/></svg></button>
              </div>
            </form>
          </section>

          <section data-step="details" aria-labelledby="detTitle">
            <h2 class="step-title" id="detTitle">Your details</h2>
            <p class="step-sub">Who should we issue the policy to?</p>
            <form id="detailsForm" novalidate>
              <div class="grid">
                <div class="f full">
                  <label for="fullName">Full name</label>
                  <input id="fullName" name="fullName" autocomplete="name" placeholder="e.g. John Ssemakula" required />
                  <span class="err">Enter your full name.</span>
                </div>
                <div class="f">
                  <label for="phone">Phone number</label>
                  <div class="tel"><span>+256</span><input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="701 440 613" required /></div>
                  <span class="err">Enter a valid Ugandan number, e.g. 0701440613 or 701 440 613.</span>
                </div>
                <div class="f">
                  <label for="email">Email address</label>
                  <input id="email" name="email" type="email" autocomplete="email" placeholder="you@email.com" required />
                  <span class="err">Enter a valid email address.</span>
                </div>
                <div class="f full">
                  <label for="idNo">National ID (NIN) or passport number</label>
                  <input id="idNo" name="idNo" autocomplete="off" placeholder="e.g. CM90123456TYCQ" required style="text-transform:uppercase" />
                  <span class="err">Enter your NIN or passport number.</span>
                </div>
                <label class="check full" id="agreeWrap">
                  <input type="checkbox" id="agree" required />
                  <span>I confirm these details are correct and I accept the Protecta Bode Terms and Conditions.</span>
                </label>
              </div>
              <p class="err" id="quoteErr" style="color:var(--error);font-size:13.5px;display:none;margin-top:12px"></p>
              <div class="actions">
                <button type="button" class="btn btn-ghost" data-goto="vehicle">Back</button>
                <button type="submit" class="btn btn-primary" id="detailsBtn">Review &amp; pay <svg><use href="#arrow"/></svg></button>
              </div>
            </form>
          </section>

          <section data-step="pay" aria-labelledby="payTitle">
            <h2 class="step-title" id="payTitle">Review &amp; pay</h2>
            <p class="step-sub">Check your cover, then choose how to pay.</p>

            <div class="review">
              <div class="review-top">
                <div><span>Annual premium</span><strong id="rvPremium">UGX 0</strong></div>
                <em>1.5%</em>
              </div>
              <dl>
                <div><dt>Policyholder</dt><dd id="rvName">—</dd></div>
                <div><dt>Phone</dt><dd id="rvPhone">—</dd></div>
                <div><dt>Vehicle</dt><dd id="rvVehicle">—</dd></div>
                <div><dt>Number plate</dt><dd id="rvPlate">—</dd></div>
                <div><dt>Car value</dt><dd id="rvValue">—</dd></div>
                <div><dt>Cover</dt><dd>Car body, third party &amp; driver</dd></div>
                <div class="edit no-print">
                  <button type="button" data-goto="vehicle">Edit vehicle</button>
                  <button type="button" data-goto="details">Edit details</button>
                </div>
              </dl>
            </div>

            <form id="payForm" novalidate>
              <fieldset style="border:0">
                <legend class="field-label" style="margin-bottom:10px">Payment method</legend>
                <div class="methods">
                  <label class="method"><input type="radio" name="method" value="mtn" /><img src="${a.mtn}" alt="" />MTN MoMo</label>
                  <label class="method"><input type="radio" name="method" value="airtel" /><img src="${a.airtel}" alt="" />Airtel Money</label>
                  <label class="method"><input type="radio" name="method" value="bank" /><img src="${a.stanbic}" alt="" />Bank transfer</label>
                </div>
              </fieldset>

              <div class="pay-panel" id="payMobile">
                <div class="f">
                  <label for="payPhone"><span id="payNet">Mobile money</span> number</label>
                  <div class="tel"><span>+256</span><input id="payPhone" type="tel" inputmode="tel" placeholder="701 440 613" /></div>
                  <span class="hint">You’ll get a prompt on this phone to approve the payment.</span>
                  <span class="err">Enter a valid Ugandan mobile money number, e.g. 0701440613.</span>
                </div>
              </div>
              <div class="pay-panel" id="payBank">
                <div class="bank">
                  <div><span>Bank</span><strong>Stanbic Bank Uganda</strong></div>
                  <div><span>Account number</span><strong>9030005603063</strong></div>
                  <div><span>Currency</span><strong>UGX</strong></div>
                  <div><span>Amount</span><strong id="bankAmount">—</strong></div>
                  <div><span>Reference</span><strong id="bankRef">—</strong></div>
                </div>
              </div>
              <p class="err" id="methodErr" style="color:var(--error);font-size:13px;display:none;margin-top:4px">Choose a payment method.</p>

              <div class="pending" id="pending" role="status"><span class="spinner"></span><span id="pendingText">Sending payment prompt…</span></div>

              <div class="actions">
                <button type="button" class="btn btn-ghost" data-goto="details">Back</button>
                <button type="submit" class="btn btn-primary" id="payBtn">Pay <span id="payAmount">UGX 0</span></button>
              </div>
            </form>
          </section>

          <section data-step="done" class="done" aria-labelledby="doneTitle">
            <svg class="done-mark" viewBox="0 0 30 34" aria-hidden="true">
              <path d="M15 1.5 2.5 6v9.2c0 8 5.3 14.3 12.5 17.3 7.2-3 12.5-9.3 12.5-17.3V6L15 1.5Z" fill="var(--navy)"/>
              <path d="m9.5 16.8 3.8 3.8 7.4-7.6" fill="none" stroke="var(--orange)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <h2 class="title" id="doneTitle" style="margin-top:0">You’re covered</h2>
            <p class="lede" id="doneText">Thank you. Your Protecta Bode cover is being issued.</p>
            <div class="ref"><span>Reference number</span><strong id="refNo">PB-0000-000000</strong></div>
            <p class="fine">A copy of your policy will be sent to <b id="doneEmail" style="color:var(--navy)">your email</b>.</p>
            <!-- Frontend page inlines the Mail01Icon (email) and a WhatsApp glyph; the React landing-share front component renders the same via Hugeicons. -->
            <div class="share">
              <a class="btn btn-outline" id="shareWa" target="_blank" rel="noopener">${waSvg}WhatsApp</a>
              <a class="btn btn-outline" id="shareMail">${mail01Svg}Email</a>
              <button type="button" class="btn btn-outline" onclick="window.print()">Save / print</button>
            </div>
            <button type="button" class="btn btn-ghost" id="restart" style="margin-top:10px">Start a new quote</button>
            <div class="after fine" style="justify-content:center"><span>Questions?</span><a href="${supportHref}">Call ${supportPhone}</a></div>
          </section>
        </div>
      </div>
    </div>
    <div class="panel-band" aria-hidden="true"></div>
  </section>
</main>

<script>
(function () {
  'use strict';
  var API = ${JSON.stringify(apiBase)};
  var SUPPORT = ${JSON.stringify(supportPhone)};

  var PRICING = { rate: 0.015, extras: [] };
  var RANGE = { min: 5000000, max: 300000000 };
  var MIN_VALUE = 1000000;
  var DEFAULT_VALUE = 30000000;

  var VEHICLES = {
    'Toyota':['Allion','Alphard','Auris','Avensis','Axio','Belta','C-HR','Caldina','Camry','Corolla','Crown','Estima','Fielder','Fortuner','Harrier','Hiace','Hilux','Ipsum','Isis','Kluger','Land Cruiser','Land Cruiser Prado','Mark II','Mark X','Noah','Passo','Premio','Probox','Ractis','RAV4','Rumion','Rush','Sienta','Spacio','Succeed','Vanguard','Vitz','Voxy','Wish'],
    'Nissan':['AD Van','Bluebird','Caravan','Dualis','Juke','March','Murano','Navara','Note','Patrol','Serena','Sylphy','Teana','Tiida','Wingroad','X-Trail'],
    'Subaru':['Exiga','Forester','Impreza','Legacy','Outback','XV'],
    'Mitsubishi':['Canter','Delica','L200','Lancer','Outlander','Pajero','Pajero iO','RVR'],
    'Honda':['Accord','Airwave','Civic','CR-V','Fit','HR-V','Insight','Stream','Vezel'],
    'Mazda':['Atenza','Axela','BT-50','CX-5','Demio','Premacy','Tribute'],
    'Suzuki':['Alto','Carry','Escudo','Every','Jimny','Solio','Swift','Vitara','Wagon R'],
    'Isuzu':['D-Max','Elf','MU-X','Trooper'],
    'MG':['HS','MG3','MG5','RX5','ZS'],
    'Lexus':['ES','GX','IS','LX','NX','RX'],
    'Mercedes-Benz':['C-Class','E-Class','G-Class','GLA','GLC','GLE','ML','S-Class'],
    'BMW':['3 Series','5 Series','X1','X3','X5','X6'],
    'Land Rover':['Defender','Discovery','Discovery Sport','Freelander','Range Rover','Range Rover Evoque','Range Rover Sport'],
    'Volkswagen':['Amarok','Golf','Passat','Polo','Tiguan','Touareg'],
    'Ford':['Escape','Everest','Explorer','Focus','Ranger'],
    'Hyundai':['Creta','Elantra','i10','Santa Fe','Tucson'],
    'Kia':['Picanto','Rio','Seltos','Sorento','Sportage'],
    'Peugeot':['208','3008','508','5008'],
    'Audi':['A4','A6','Q5','Q7'],
    'Volvo':['XC60','XC90'],
    'Jeep':['Cherokee','Compass','Grand Cherokee','Wrangler']
  };

  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function fmt(n) { return 'UGX ' + Math.round(n).toLocaleString('en-UG'); }
  function digits(s) {
    var out = '';
    var raw = String(s || '');
    for (var i = 0; i < raw.length; i++) {
      var c = raw.charAt(i);
      if (c >= '0' && c <= '9') out += c;
    }
    return out;
  }
  function nationalUg(s) {
    var d = digits(s);
    if (d.indexOf('00') === 0) d = d.slice(2);
    if (d.indexOf('2560') === 0 && d.length === 13) d = '256' + d.slice(4);
    if (d.indexOf('256') === 0 && d.length === 12) d = d.slice(3);
    if (d.charAt(0) === '0' && d.length === 10) d = d.slice(1);
    return d;
  }

  var state = Object.assign({ value: DEFAULT_VALUE, step: 'calc' }, load());
  // Portal: allow return & complete payment — ?ref=QUOTE_REF deep-links to pay
  (function () {
    try {
      var params = new URLSearchParams(window.location.search);
      var ref = (params.get('ref') || params.get('resume') || '').trim().toUpperCase();
      if (!ref) return;
      // If we already have this quote loaded and paid, stay on done
      if (state.quoteRef === ref && state.paid) return;
      fetch(API + '/api/quotes/get?ref=' + encodeURIComponent(ref))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.quote) return;
          var q = d.quote;
          state.quoteRef = q.reference;
          state.shareUrl = q.shareUrl;
          state.serverPremium = q.premium;
          state.value = Number(q.vehicleValue) || state.value;
          state.plate = q.plate || state.plate;
          state.make = q.vehicleMake || state.make;
          state.model = q.vehicleModel || state.model;
          state.quoteStatus = q.status;
          // Try to keep policyholder info if present
          if (q.policyholderPhone) state.phone = q.policyholderPhone;
          state._qphone = state.phone; state._qplate = state.plate; state._qvalue = state.value;
          save();
          // Pre-fill premium display and go to pay (after details if needed)
          try { setValue(state.value); } catch (e) {}
          // Defer navigation until after initial go() below; mark intended step
          state._resumeRef = ref;
          state._resumeStatus = q.status;
        }).catch(function () {});
    } catch (e) {}
  })();
  function premiumOf(v) { return Math.round(v * PRICING.rate); }
  function ratePct() { return (PRICING.rate * 100).toLocaleString('en-UG', { maximumFractionDigits: 2 }) + '%'; }

  function api(path, opts) {
    return fetch(API + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || data.ok === false) throw new Error(data.error || ('Request failed (' + res.status + ')'));
        return data;
      });
    });
  }

  fetch(API + '/api/calc-config').then(function (res) { return res.json(); }).then(function (cfg) {
    if (!cfg || cfg.ok === false) return;
    if (cfg.rate) PRICING.rate = cfg.rate;
    if (cfg.minVehicleValue) { MIN_VALUE = cfg.minVehicleValue; }
    if (cfg.minVehicleValue) RANGE.min = Math.max(1000000, Math.min(cfg.minVehicleValue, 5000000));
    if (cfg.maxVehicleValue) RANGE.max = cfg.maxVehicleValue;
    var range = $('#carRange');
    range.min = RANGE.min; range.max = RANGE.max;
    var scale = document.querySelector('.range-scale');
    if (scale) scale.innerHTML = '<span>' + short(RANGE.min) + '</span><span>' + short(RANGE.max) + '+</span>';
    $all('.result-rate').forEach(function (el) { el.textContent = ratePct(); });
    setValue(state.value);
  }).catch(function () { /* keep advertised defaults */ });
  function short(n) { return n >= 1e6 ? (n / 1e6).toLocaleString('en-UG', { maximumFractionDigits: 1 }) + 'M' : n.toLocaleString('en-UG'); }

  var valueIn = $('#carValue'), rangeIn = $('#carRange'), fill = $('#rangeFill');

  function setValue(v, from) {
    v = Math.max(0, Math.min(v || 0, 99999999999));
    state.value = v;
    if (from !== 'input') valueIn.value = v ? v.toLocaleString('en-UG') : '';
    var clamped = Math.max(RANGE.min, Math.min(v, RANGE.max));
    if (from !== 'range') rangeIn.value = clamped;
    fill.style.width = ((clamped - RANGE.min) / (RANGE.max - RANGE.min) * 100) + '%';
    renderPremium();
    save();
  }

  function renderPremium() {
    var v = state.value, ok = v >= MIN_VALUE, p = premiumOf(v);
    $('#result').classList.toggle('is-empty', !ok);
    $('#premium').innerHTML = '<span class="cur">UGX</span>' + (ok ? p.toLocaleString('en-UG') : '0');
    $('#resultMeta').textContent = ok
      ? (ratePct() + ' of ' + fmt(v))
      : ('Enter your car’s value (from ' + fmt(MIN_VALUE) + ') to see your premium.');
    $('#proceedBtn').disabled = !ok;
    ['#headPremium', '#rvPremium', '#payAmount', '#bankAmount'].forEach(function (s) { $(s).textContent = fmt(p); });
    $('#valueRo').value = fmt(v);
    $('#rvValue').textContent = fmt(v);
  }

  valueIn.addEventListener('input', function () {
    var fromEnd = valueIn.value.length - valueIn.selectionEnd;
    var n = +digits(valueIn.value).slice(0, 11);
    valueIn.value = n ? n.toLocaleString('en-UG') : '';
    var pos = Math.max(0, valueIn.value.length - fromEnd);
    try { valueIn.setSelectionRange(pos, pos); } catch (e) {}
    state.quoteRef = null; state.policyNo = null; state.paid = false;
    setValue(n, 'input');
  });
  valueIn.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !$('#proceedBtn').disabled) go('vehicle'); });
  rangeIn.addEventListener('input', function () { state.quoteRef = null; state.policyNo = null; state.paid = false; setValue(+rangeIn.value, 'range'); });
  $('#proceedBtn').addEventListener('click', function () { go('vehicle'); });

  var ORDER = ['vehicle', 'details', 'pay', 'done'];
  function go(step, opts) {
    opts = opts || {};
    state.step = step;
    $all('[data-step]').forEach(function (s) { s.classList.toggle('active', s.dataset.step === step); });
    var inFlow = step !== 'calc';
    $('#flowHead').hidden = !inFlow;
    $('#stepper').hidden = !inFlow;
    var idx = ORDER.indexOf(step);
    $all('#stepper li').forEach(function (li, i) {
      li.classList.toggle('done', i < idx);
      li.classList.toggle('current', i === idx);
      if (i === idx) li.setAttribute('aria-current', 'true'); else li.removeAttribute('aria-current');
    });
    if (step === 'pay') fillReview();
    save();
    if (!opts.silent) {
      var panel = $('#calculator');
      var top = panel.getBoundingClientRect().top + window.scrollY;
      if (Math.abs(window.scrollY - top) > 40 && window.matchMedia('(max-width: 1023px), (max-aspect-ratio: 5/4)').matches) {
        window.scrollTo({ top: top, behavior: 'smooth' });
      }
      var h = document.querySelector('[data-step="' + step + '"] h1, [data-step="' + step + '"] h2');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-goto]');
    if (t) { e.preventDefault(); go(t.dataset.goto); }
  });

  function field(el) { return el.closest('.f'); }
  function mark(el, ok) { var f = field(el); if (f) f.classList.toggle('invalid', !ok); return ok; }
  function ugPhone(s) { var d = nationalUg(s); return d.length === 9 && d.charAt(0) === '7'; }
  function normPhone(s) { var d = nationalUg(s); return ugPhone(s) ? '+256' + d : ''; }
  function prettyPhone(s) { var d = nationalUg(s); return d ? '+256 ' + d.slice(0,3) + ' ' + d.slice(3,6) + ' ' + d.slice(6) : ''; }
  function network(s) { var p = nationalUg(s).slice(0, 2); return ['76','77','78','79'].indexOf(p) >= 0 ? 'mtn' : (['70','74','75'].indexOf(p) >= 0 ? 'airtel' : null); }
  function plateOk(s) {
    var plate = String(s || '').trim().toUpperCase();
    var compact = '';
    for (var i = 0; i < plate.length; i++) {
      var c = plate.charAt(i);
      if (c === ' ') continue;
      var letter = c >= 'A' && c <= 'Z';
      var digit = c >= '0' && c <= '9';
      if (!letter && !digit) return false;
      compact += c;
    }
    return compact.length >= 5 && compact.length <= 10;
  }
  function emailOk(s) {
    var v = String(s || '').trim();
    var at = v.indexOf('@');
    var dot = v.lastIndexOf('.');
    return at > 0 && dot > at + 1 && dot < v.length - 1 && v.indexOf(' ') < 0;
  }

  $all('input,select').forEach(function (el) { el.addEventListener('input', function () { var f = field(el); if (f) f.classList.remove('invalid'); }); });

  var makeIn = $('#make'), modelIn = $('#model'), yearSel = $('#year'), plateIn = $('#plate');
  $('#makeList').innerHTML = Object.keys(VEHICLES).sort().map(function (m) { return '<option value="' + m + '">'; }).join('');
  var thisYear = new Date().getFullYear();
  for (var y = thisYear + 1; y >= 1985; y--) yearSel.insertAdjacentHTML('beforeend', '<option>' + y + '</option>');
  function fillModels() {
    var want = makeIn.value.trim().toLowerCase();
    var key = Object.keys(VEHICLES).find(function (k) { return k.toLowerCase() === want; });
    $('#modelList').innerHTML = key ? VEHICLES[key].map(function (m) { return '<option value="' + m + '">'; }).join('') : '';
  }
  makeIn.addEventListener('input', fillModels);
  plateIn.addEventListener('input', function () { plateIn.value = plateIn.value.toUpperCase().replace(/[^A-Z0-9 ]/g, ''); });

  $('#vehicleForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var ok = [
      mark(makeIn, makeIn.value.trim().length > 1),
      mark(modelIn, modelIn.value.trim().length > 0),
      mark(yearSel, !!yearSel.value),
      mark(plateIn, plateOk(plateIn.value))
    ].every(Boolean);
    if (!ok) { var bad = $('#vehicleForm .invalid input, #vehicleForm .invalid select'); if (bad) bad.focus(); return; }
    var next = { make: makeIn.value.trim(), model: modelIn.value.trim(), year: yearSel.value, plate: plateIn.value.trim().toUpperCase() };
    if (next.plate !== state.plate || next.make !== state.make) { state.quoteRef = null; state.policyNo = null; state.paid = false; }
    Object.assign(state, next);
    go('details');
  });

  var nameIn = $('#fullName'), phoneIn = $('#phone'), emailIn = $('#email'), idIn = $('#idNo'), agree = $('#agree');
  agree.addEventListener('change', function () { $('#agreeWrap').classList.remove('invalid'); });
  $('#detailsForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var ok = [
      mark(nameIn, nameIn.value.trim().split(' ').filter(function (part) { return part.length > 0; }).length >= 2),
      mark(phoneIn, ugPhone(phoneIn.value)),
      mark(emailIn, emailOk(emailIn.value)),
      mark(idIn, idIn.value.trim().length >= 6)
    ].every(Boolean);
    $('#agreeWrap').classList.toggle('invalid', !agree.checked);
    if (!ok || !agree.checked) { ($('#detailsForm .invalid input') || agree).focus(); return; }
    Object.assign(state, { name: nameIn.value.trim(), phone: normPhone(phoneIn.value), email: emailIn.value.trim(), idNo: idIn.value.trim().toUpperCase(), consent: agree.checked });
    if (!state.method) { var n = network(state.phone); if (n) selectMethod(n); }
    if (!$('#payPhone').value) $('#payPhone').value = nationalUg(state.phone);
    createQuoteThen(function () { go('pay'); });
  });

  function sameQuoteAsState(q) {
    return state.quoteRef && q &&
      state._qphone === state.phone && state._qplate === state.plate &&
      Number(state._qvalue) === Number(state.value);
  }

  function createQuoteThen(next) {
    if (sameQuoteAsState(state.quoteRef)) { next(); return; }
    var btn = $('#detailsBtn');
    var err = $('#quoteErr');
    err.style.display = 'none';
    btn.disabled = true;
    var original = btn.innerHTML;
    btn.textContent = 'Creating your quote…';
    api('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: state.phone, name: state.name, plate: state.plate,
        vehicleValue: state.value, make: state.make, model: state.model,
        year: Number(state.year) || undefined,
        email: state.email || undefined, idNo: state.idNo || undefined,
        consent: state.consent === true
      })
    }).then(function (data) {
      state.quoteRef = data.quote.reference;
      state.shareUrl = data.quote.shareUrl;
      state.serverPremium = data.quote.premium;
      state._qphone = state.phone; state._qplate = state.plate; state._qvalue = state.value;
      btn.disabled = false; btn.innerHTML = original;
      next();
    }).catch(function (ex) {
      btn.disabled = false; btn.innerHTML = original;
      err.textContent = ex.message || 'Could not create your quote. Check your connection and try again.';
      err.style.display = 'block';
    });
  }

  function fillReview() {
    $('#rvName').textContent = state.name || '—';
    $('#rvPhone').textContent = state.phone ? prettyPhone(state.phone) : '—';
    $('#rvVehicle').textContent = [state.year, state.make, state.model].filter(Boolean).join(' ') || '—';
    $('#rvPlate').textContent = state.plate || '—';
    $('#bankRef').textContent = state.quoteRef || '—';
  }
  function selectMethod(m) {
    state.method = m;
    var r = document.querySelector('input[name="method"][value="' + m + '"]'); if (r) r.checked = true;
    $('#payMobile').classList.toggle('show', m === 'mtn' || m === 'airtel');
    $('#payBank').classList.toggle('show', m === 'bank');
    $('#payNet').textContent = m === 'mtn' ? 'MTN MoMo' : m === 'airtel' ? 'Airtel Money' : 'Mobile money';
    $('#payBtn').firstChild.textContent = m === 'bank' ? 'I’ve paid ' : 'Pay ';
    $('#methodErr').style.display = 'none';
    save();
  }
  $all('input[name="method"]').forEach(function (r) { r.addEventListener('change', function () { selectMethod(r.value); }); });

  $('#payForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!state.method) { $('#methodErr').style.display = 'block'; return; }
    var payPhone = $('#payPhone');
    if (state.method !== 'bank') {
      if (!mark(payPhone, ugPhone(payPhone.value))) return payPhone.focus();
      var net = network(payPhone.value);
      if (net && net !== state.method) {
        field(payPhone).classList.add('invalid');
        field(payPhone).querySelector('.err').textContent = 'That looks like ' + (net === 'mtn' ? 'an MTN' : 'an Airtel') + ' number. Switch method or use another number.';
        return payPhone.focus();
      }
    }
    if (!state.quoteRef) {
      createQuoteThen(function () { startPayment(); });
      return;
    }
    startPayment();
  });

  function startPayment() {
    var btn = $('#payBtn');
    btn.disabled = true;
    $('#pending').classList.add('show');
    $('#pendingText').textContent = state.method === 'bank'
      ? 'Recording your transfer…'
      : 'Sending payment prompt…';
    var provider = state.method === 'mtn' ? 'mtn_momo' : state.method === 'airtel' ? 'airtel_money' : 'bank';
    api('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteRef: state.quoteRef, provider: provider,
        payerPhone: state.method === 'bank' ? state.phone : normPhone($('#payPhone').value)
      })
    }).then(function (data) {
      state.paymentRef = data.payment.paymentRef;
      if (data.policy && data.policy.policyNo) state.policyNo = data.policy.policyNo;
      save();
      if (data.draft) {
        if (data.policy && data.policy.policyNo) { state.policyNo = data.policy.policyNo; state.paid = true; save(); }
        $('#pendingText').textContent = data.instructions || 'Your payment is being processed. You will receive a confirmation shortly.';
        setTimeout(function () {
          $('#pending').classList.remove('show'); btn.disabled = false;
          if (data.policy && data.policy.policyNo) state.paid = true;
          else state.paid = true;
          finish(); go('done');
        }, 1400);
        return;
      }
      if (provider === 'bank') {
        $('#pending').classList.remove('show'); btn.disabled = false;
        state.paid = true; finish(); go('done');
        return;
      }
      $('#pendingText').textContent = data.instructions ||
        ('Payment prompt sent to ' + prettyPhone($('#payPhone').value) + '. Approve it on your phone…');
      pollPayment(data.payment.paymentRef, 0, btn);
    }).catch(function (ex) {
      $('#pending').classList.remove('show'); btn.disabled = false;
      $('#methodErr').textContent = ex.message || 'Payment failed to start. Try again.';
      $('#methodErr').style.display = 'block';
    });
  }

  function pollPayment(ref, tries, btn) {
    if (tries > 60) {
      $('#pending').classList.remove('show'); btn.disabled = false;
      $('#methodErr').textContent = 'Still waiting for approval — dial back or try again. Your quote ' + state.quoteRef + ' is saved.';
      $('#methodErr').style.display = 'block';
      return;
    }
    setTimeout(function () {
      api('/api/payments/get?ref=' + encodeURIComponent(ref)).then(function (data) {
        var st = data.payment.status;
        if (st === 'CONFIRMED') {
          if (data.policy && data.policy.policyNo) state.policyNo = data.policy.policyNo;
          $('#pending').classList.remove('show'); btn.disabled = false;
          state.paid = true; finish(); go('done');
        } else if (st === 'FAILED') {
          $('#pending').classList.remove('show'); btn.disabled = false;
          $('#methodErr').textContent = 'The payment failed or was cancelled. Try again or choose another method.';
          $('#methodErr').style.display = 'block';
        } else {
          pollPayment(ref, tries + 1, btn);
        }
      }).catch(function () { pollPayment(ref, tries + 1, btn); });
    }, 3000);
  }

  function finish() {
    $('#refNo').textContent = state.policyNo || state.quoteRef || '—';
    $('#doneEmail').textContent = state.email || 'your email';
    $('#doneText').textContent = state.method === 'bank'
      ? 'Thank you. Your cover will be activated as soon as your transfer is confirmed.'
      : ('Thank you' + (state.name ? ', ' + state.name.split(' ')[0] : '') + '. Your Protecta Bode cover for ' + (state.plate || 'your car') + ' is being issued.');
    var summary = [
      'Protecta Bode · Liberty General Insurance Uganda',
      'Reference: ' + (state.policyNo || state.quoteRef || ''),
      'Policyholder: ' + (state.name || ''),
      'Vehicle: ' + [state.year, state.make, state.model].join(' ') + ' (' + (state.plate || '') + ')',
      'Car value: ' + fmt(state.value),
      'Annual premium: ' + fmt(premiumOf(state.value)) + ' (' + ratePct() + ')',
      'Cover: car body, third party & driver cover',
      'Questions? Call ' + SUPPORT
    ].join('\\n');
    $('#shareWa').href = 'https://wa.me/?text=' + encodeURIComponent(summary);
    $('#shareMail').href = 'mailto:' + encodeURIComponent(state.email || '') + '?subject=' + encodeURIComponent('My Protecta Bode cover · ' + (state.policyNo || state.quoteRef || '')) + '&body=' + encodeURIComponent(summary);
  }
  var resumeLink = $('#resumeLink');
  if (resumeLink) resumeLink.addEventListener('click', function (e) {
    e.preventDefault();
    var ref = prompt('Enter your 6-digit quote reference (e.g. 482913), policy number or phone number:');
    if (!ref) return;
    ref = ref.trim();
    // If it looks like a phone, go to resume portal; else go to portal with ref
    var digits = ref.replace(/[^0-9]/g, '');
    if (digits.length >= 9 && digits.length <= 13 && ref.indexOf('PB-') === -1) {
      window.location.href = '/s/protecta/quotes/resume?phone=' + encodeURIComponent(ref);
    } else {
      window.location.href = API + '/?ref=' + encodeURIComponent(ref.toUpperCase());
    }
  });
  $('#restart').addEventListener('click', function () {
    try { sessionStorage.removeItem('pb'); } catch (e) {}
    ['#vehicleForm', '#detailsForm', '#payForm'].forEach(function (f) { $(f).reset(); });
    for (var k of Object.keys(state)) delete state[k];
    Object.assign(state, { value: DEFAULT_VALUE, step: 'calc' });
    $all('.pay-panel').forEach(function (p) { p.classList.remove('show'); });
    setValue(DEFAULT_VALUE); go('calc');
  });

  function save() { try { sessionStorage.setItem('pb', JSON.stringify(state)); } catch (e) {} }
  function load() { try { return JSON.parse(sessionStorage.getItem('pb')) || {}; } catch (e) { return {}; } }

  setValue(state.value);
  if (state.make) { makeIn.value = state.make; fillModels(); }
  if (state.model) modelIn.value = state.model;
  if (state.year) yearSel.value = state.year;
  if (state.plate) plateIn.value = state.plate;
  if (state.name) nameIn.value = state.name;
  if (state.phone) { phoneIn.value = nationalUg(state.phone); $('#payPhone').value = nationalUg(state.phone); }
  if (state.email) emailIn.value = state.email;
  if (state.idNo) idIn.value = state.idNo;
  if (state.method) selectMethod(state.method);
  if (state.paid) finish();
  var resume = state.step || 'calc';
  if (resume === 'done' && !state.paid) resume = 'pay';
  // If we deep-linked via ?ref=, prefer that navigation after a short delay
  if (state._resumeRef) {
    setTimeout(function () {
      try {
        if (state._resumeStatus === 'ACCEPTED') {
          // Already paid — go to policy doc
          window.location.href = '/s/protecta/policies/doc?ref=' + encodeURIComponent(state._resumeRef);
          return;
        }
        if (state.name && state.phone && state.plate) go('pay');
        else go('details');
      } catch (e) { go('pay'); }
      delete state._resumeRef; delete state._resumeStatus; save();
    }, 600);
  }
  go(resume, { silent: true });
})();
</script>
</body>
</html>`;
