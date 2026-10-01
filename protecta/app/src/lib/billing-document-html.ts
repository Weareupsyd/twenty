import { BANK_TRANSFER } from 'src/lib/bank-transfer';
import { PROTECTA_LOGO_PNG_BASE64 } from 'src/lib/brand-logo';
import { escapeHtml } from 'src/lib/http';
import { formatUgx } from 'src/lib/money';
import { type RecordData } from 'src/lib/records';

/**
 * The billing document family: payment invoice and payment receipt, built from
 * the black & white sample templates (invoice-sample.html / receipt-sample.html).
 * The layout, type scale and rules are the samples' own; only the brand block
 * and the content are this app's — the logo image replaces the sample's mark
 * plus wordmark, and every line is real Protecta Bode data.
 */

/** Uganda's six stripes as an inline SVG so the flag survives offline renders;
 * at 15x10 px the crane reads as the white disc, and the flag carries the
 * country code so no dial code is ever printed next to a phone. */
const UG_FLAG_DATA_URI =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 30">' +
      '<rect width="45" height="30" fill="#D90000"/>' +
      '<rect width="45" height="10" y="0" fill="#000000"/>' +
      '<rect width="45" height="10" y="5" fill="#FCDC04"/>' +
      '<rect width="45" height="10" y="15" fill="#000000"/>' +
      '<rect width="45" height="5" y="20" fill="#FCDC04"/>' +
      '<circle cx="22.5" cy="15" r="8" fill="#FFFFFF"/>' +
      '</svg>',
  );

/** The samples' stylesheet, verbatim apart from the brand block (an image now)
 * and the flag (inline instead of a Wikimedia fetch). */
const BILLING_DOC_CSS = `
  /* Professional black & white document — no gradients, no card containers. */
  :root {
    --ink: #111111;
    --mid: #4a4a4a;
    --soft: #8a8a8a;
    --rule: #e4e4e4;
    --rule-strong: #c9c9c9;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #ffffff; color: var(--ink); font-family: "Geist", -apple-system, "Segoe UI", system-ui, sans-serif; }
  .page { max-width: 640px; margin: 0 auto; padding: 40px 24px; }
  a { color: inherit; }

  /* Header */
  .doc-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; padding-bottom: 20px; border-bottom: 2px solid var(--ink); }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand img { height: 42px; width: auto; display: block; }
  .doc-type { text-align: right; }
  .doc-type .dt { font-family: "JetBrains Mono", monospace; font-size: 10px; letter-spacing: .18em; text-transform: uppercase; color: var(--soft); }
  .doc-type .dn { font-family: "JetBrains Mono", monospace; font-size: 20px; font-weight: 600; letter-spacing: .01em; margin-top: 2px; }

  /* Meta grid */
  .doc-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 22px 0; border-bottom: 1px solid var(--rule); }
  .meta-col h4 { font-family: "JetBrains Mono", monospace; font-size: 9px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--soft); margin-bottom: 8px; }
  .meta-col p { font-size: 13px; line-height: 1.6; color: var(--ink); }
  .meta-col p .muted { color: var(--mid); }
  .doc-labels { text-align: right; }
  .doc-labels h4 { text-align: right; }

  /* Line items */
  table { width: 100%; border-collapse: collapse; margin-top: 22px; }
  thead th { font-family: "JetBrains Mono", monospace; font-size: 9px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--soft); text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--rule-strong); }
  thead th.r, tbody td.r { text-align: right; }
  tbody td { font-size: 13px; padding: 12px 8px; border-bottom: 1px solid var(--rule); vertical-align: top; }
  tbody td .sub { font-size: 11px; color: var(--soft); }
  tbody td.num { font-family: "JetBrains Mono", monospace; }

  /* Totals */
  .totals { margin-top: 18px; margin-left: auto; width: 100%; max-width: 300px; }
  .totals-row { display: flex; justify-content: space-between; font-size: 13px; padding: 6px 8px; color: var(--mid); }
  .totals-row .lbl { font-family: "JetBrains Mono", monospace; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
  .totals-row.grand { border-top: 2px solid var(--ink); margin-top: 6px; padding-top: 12px; color: var(--ink); font-weight: 600; font-size: 15px; }
  .totals-row.grand .lbl { font-family: "Geist", sans-serif; font-size: 13px; letter-spacing: 0; text-transform: none; }

  /* Footer / notes */
  .pay-terms { margin-top: 30px; padding-top: 16px; border-top: 1px solid var(--rule); }
  .pay-terms h4 { font-family: "JetBrains Mono", monospace; font-size: 9px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--soft); margin-bottom: 8px; }
  .pay-terms p, .pay-terms li { font-size: 12px; line-height: 1.7; color: var(--mid); }
  .pay-terms ul { list-style: none; }
  .pay-terms li { padding-left: 14px; position: relative; }
  .pay-terms li::before { content: "–"; position: absolute; left: 0; color: var(--soft); }

  .stamp { margin-top: 26px; padding-top: 14px; border-top: 1px dashed var(--rule-strong); display: flex; justify-content: space-between; align-items: center; }
  .stamp .amount { font-family: "JetBrains Mono", monospace; font-size: 13px; color: var(--ink); }
  .stamp .code { font-family: "JetBrains Mono", monospace; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--soft); }
  .support { margin-top: 8px; font-family: "JetBrains Mono", monospace; font-size: 10px; color: var(--soft); }
  .support a { text-decoration: none; }

  /* Payment-provider banner on the receipt */
  .rec-evbanner { display: flex; align-items: center; gap: 10px; padding: 14px 0; border-bottom: 1px solid var(--rule); }
  .rec-evbanner .ev { width: 44px; height: 28px; }
  .rec-evbanner .ev-txt { font-size: 13px; }
  .rec-evbanner .ev-txt b { font-family: "JetBrains Mono", monospace; font-weight: 600; }

  /* Inline rectangular flag — the flag IS the country code, so the numeric dial code is never shown. */
  .dflag { display: inline-block; width: 15px; height: 10px; margin-right: 4px; vertical-align: -1px; border-radius: 1px; background-size: cover; background-repeat: no-repeat; box-shadow: inset 0 0 0 1px rgba(0,0,0,.08); }
  .dflag.dflag-ug { background-image: url("${UG_FLAG_DATA_URI}"); }

  @media print { body { print-color-adjust: exact; } .page { padding: 24px 0; } }
`;

const BRAND_LOGO_DATA_URI = `data:image/png;base64,${PROTECTA_LOGO_PNG_BASE64}`;

const supportPhone = (): string => process.env.SUPPORT_PHONE ?? '';
const supportEmail = (): string => process.env.SUPPORT_EMAIL ?? '';

/** Monochrome provider marks, drawn to the sample's 44x28 banner box. */
const providerMark = (provider: string): { svg: string; label: string } => {
  const raw = String(provider ?? '').toUpperCase();
  if (raw.includes('AIRTEL')) {
    return {
      label: 'Airtel Money',
      svg:
        '<svg class="ev" viewBox="0 0 44 28" xmlns="http://www.w3.org/2000/svg" aria-label="Airtel Money" fill="none" stroke="#111111" stroke-width="2.4" stroke-linecap="round">' +
        '<path d="M22 4c-5 6-8 12-8 17 0 2 1.4 3.4 3.4 3.4 1.7 0 3-1 4.6-3 1.6 2 2.9 3 4.6 3 2 0 3.4-1.4 3.4-3.4 0-5-3-11-8-17Z"/>' +
        '<path d="M14 15c-2.4-2.6-4.6-4-7-4M30 15c2.4-2.6 4.6-4 7-4"/>' +
        '</svg>',
    };
  }
  if (raw.includes('BANK') || raw.includes('STANBIC')) {
    return {
      label: 'Bank transfer',
      svg:
        '<svg class="ev" viewBox="0 0 44 28" xmlns="http://www.w3.org/2000/svg" aria-label="Bank transfer" fill="none" stroke="#111111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M6 12 22 4l16 8M8 12v10M16 12v10M28 12v10M36 12v10M5 24h34"/>' +
        '</svg>',
    };
  }
  // MTN MoMo and anything else mobile-money: the sample's MTN glyph.
  return {
    label: 'MTN MoMo',
    svg:
      '<svg class="ev" viewBox="0 0 1280 640" xmlns="http://www.w3.org/2000/svg" aria-label="MTN MoMo"><path fill="#111111" d="M 1280 640 L 0 640 L 0 0 L 1280 0 Z M 0 0 L 0 640 L 160 407 L 366 640 L 440 640 L 640 407 L 840 640 L 940 640 L 1140 407 L 1280 587 L 1280 0 Z M 640 77 c -37 0 -67 30 -67 67 s 30 67 67 67 67 -30 67 -67 -30 -67 -67 -67 m 0 0 c 97 0 176 79 176 176 0 56 -146 62 -270 44 -46 -7 -82 -27 -82 -58 0 -54 34 -90 81 -112 19 -9 42 -15 64 -17 m -142 -5 c -46 22 -83 66 -83 134 0 48 42 92 145 105 120 14 310 10 310 -116 0 -97 -79 -176 -176 -176 -43 0 -82 14 -114 38 m 44 14 c 20 -16 41 -25 58 -25 41 0 66 33 66 74 0 45 -37 83 -77 140 c -13 18 -29 40 -47 66 m 0 0 c 47 -65 81 -92 92 -102 45 -41 74 -82 74 -106 0 -34 -20 -55 -46 -55 -34 0 -51 31 -86 70 c -17 19 -27 40 -34 65 c -18 31 -34 79 -34 131 0 51 16 98 44 133 m 0 164 c -24 -34 -36 -70 -36 -111 0 -30 6 -66 17 -98 m 79 209 c 39 -34 61 -74 61 -114 0 -24 -8 -50 -26 -79 z"/></svg>',
  };
};

/**
 * A Ugandan number as the design prints it: two digits, a masked middle and
 * the last four, behind the flag that carries the country code.
 */
export const maskedUgPhone = (raw: string | null | undefined): string => {
  const digits = String(raw ?? '').replace(/\D/g, '');
  const local = digits.startsWith('256')
    ? digits.slice(3)
    : digits.startsWith('0')
      ? digits.slice(1)
      : digits;
  if (local.length < 6) return String(raw ?? '') || '—';
  return `${local.slice(0, 2)}\u2022\u2022 ${local.slice(-4)}`;
};

const brandBlock = (): string =>
  `<div class="brand"><img src="${BRAND_LOGO_DATA_URI}" alt="Protecta Bode" /></div>`;

const supportLine = (): string => {
  const phone = supportPhone();
  const email = supportEmail();
  const phoneHtml = phone
    ? `<a href="tel:${escapeHtml(phone.replace(/[^+\d]/g, ''))}">${escapeHtml(phone)}</a>`
    : '';
  const emailHtml = email ? escapeHtml(email) : '';
  const joined = [phoneHtml, emailHtml].filter(Boolean).join(' \u00b7 ');
  return `<p class="support">Support: ${joined || 'Protecta Bode'}</p>`;
};

const shell = ({
  title,
  docType,
  docNumber,
  body,
  pageId,
}: {
  title: string;
  docType: string;
  docNumber: string;
  body: string;
  pageId: string;
}): string => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${BILLING_DOC_CSS}</style>
</head>
<body>
<div class="page" id="${pageId}">
  <div class="doc-head">
    ${brandBlock()}
    <div class="doc-type">
      <div class="dt">${escapeHtml(docType)}</div>
      <div class="dn">${escapeHtml(docNumber)}</div>
    </div>
  </div>
${body}
  ${supportLine()}
</div>
</body>
</html>
`;

const metaGrid = (left: string, right: string): string => `  <div class="doc-meta">
    <div class="meta-col">
${left}
    </div>
    <div class="meta-col doc-labels">
${right}
    </div>
  </div>`;

const lineItemTable = (
  columns: string[],
  rows: Array<{ cells: string[] }>,
): string => `  <table>
    <thead>
      <tr>
${columns.map((c, i) => `        <th${i > 0 ? ' class="r"' : ''}>${escapeHtml(c)}</th>`).join('\n')}
      </tr>
    </thead>
    <tbody>
${rows
  .map(
    (row) =>
      `      <tr>\n${row.cells
        .map((cell, i) => `        <td${i > 0 ? ' class="r num"' : ''}>${cell}</td>`)
        .join('\n')}\n      </tr>`,
  )
  .join('\n')}
    </tbody>
  </table>`;

const totalsBlock = (
  rows: Array<{ label: string; value: string }>,
  grand: { label: string; value: string },
): string => `  <div class="totals">
${rows.map((r) => `    <div class="totals-row"><span class="lbl">${escapeHtml(r.label)}</span><span class="num">${escapeHtml(r.value)}</span></div>`).join('\n')}
    <div class="totals-row grand"><span class="lbl">${escapeHtml(grand.label)}</span><span class="num">${escapeHtml(grand.value)}</span></div>
  </div>`;

const notesBlock = (heading: string, items: string[]): string => `  <div class="pay-terms">
    <h4>${escapeHtml(heading)}</h4>
    <ul>
${items.map((i) => `      <li>${i}</li>`).join('\n')}
    </ul>
  </div>`;

const stampBlock = (amount: string, code: string): string => `  <div class="stamp">
    <div class="amount">${escapeHtml(amount)}</div>
    <div class="code">${escapeHtml(code)}</div>
  </div>`;

/** Insurance line items for a quote or policy, shared by both documents. */
const premiumRows = (
  doc: RecordData,
  options: { withBreakdown?: boolean },
): Array<{ cells: string[] }> => {
  const vehicle = `${String(doc.vehicleMake ?? '')} ${String(doc.vehicleModel ?? '')}`.trim();
  const plate = String(doc.plate ?? '');
  const premium = Number(doc.premium ?? doc.premiumUgx ?? 0);
  const description = `Motor insurance premium${vehicle ? ` \u2014 ${vehicle}` : ''}`;
  const sub = [plate && `Plate ${plate}`, `Cover ${process.env.POLICY_DAYS ?? '12'} months`]
    .filter(Boolean)
    .join(' \u00b7 ');
  return [
    {
      cells: [
        `${escapeHtml(description)}<br><span class="sub">${escapeHtml(sub)}</span>`,
        '1 policy',
        escapeHtml(formatUgx(premium)),
        escapeHtml(formatUgx(premium)),
      ],
    },
    ...(options.withBreakdown ? levyRows(doc) : []),
  ];
};

const levyRows = (doc: RecordData): Array<{ cells: string[] }> => {
  const entries: Array<[string, unknown]> = [
    ['Training levy', doc.trainingLevyUgx],
    ['Sticker fees', doc.stickerFeesUgx],
    ['VAT', doc.vatUgx],
    ['Stamp duty', doc.stampDutyUgx],
  ];
  return entries
    .filter(([, value]) => Number(value ?? 0) > 0)
    .map(([label, value]) => ({
      cells: [
        escapeHtml(label),
        '',
        '',
        escapeHtml(formatUgx(Number(value))),
      ],
    }));
};

const issuedDate = (doc: RecordData): string => {
  const raw = String(doc.createdAt ?? '');
  const date = raw ? new Date(raw) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Kampala',
  });
};

export type InvoiceHtmlInput = {
  quote: RecordData;
  name?: string;
  payerPhone?: string;
  payUrl?: string;
  issuedOn?: string;
};

/**
 * The proforma payment invoice: what is due, how to pay it, and the pay link.
 * Same shape as the sample invoice, filled from the quote.
 */
export const renderInvoiceHtml = (input: InvoiceHtmlInput): string => {
  const quote = input.quote;
  const ref = String(quote.reference ?? '');
  const premium = Number(quote.premium ?? 0);
  const payer = input.payerPhone || String(quote.policyholderPhone ?? '');
  const name = input.name || 'Protecta Bode customer';
  const vehicle = `${String(quote.vehicleMake ?? '')} ${String(quote.vehicleModel ?? '')}`.trim();

  const left = `      <h4>Billed to</h4>
      <p>${escapeHtml(name)}<br><span class="muted">${escapeHtml(vehicle || 'Motor vehicle')}</span>${
        String(quote.plate ?? '')
          ? `<br><span class="muted">Plate ${escapeHtml(String(quote.plate))}</span>`
          : ''
      }${
        payer
          ? `<br><span class="muted"><span class="dflag dflag-ug"></span>${escapeHtml(maskedUgPhone(payer))}</span>`
          : ''
      }</p>`;

  const right = `      <h4>Issued</h4>
      <p><span class="muted">${escapeHtml(input.issuedOn ?? issuedDate(quote))}</span></p>
      <p><span class="muted">Quote</span> #${escapeHtml(ref)}</p>
      <p><span class="muted">Due</span> ${escapeHtml(String(quote.validUntil ?? 'On receipt'))}</p>`;

  const body = [
    metaGrid(left, right),
    lineItemTable(['Description', 'Qty', 'Rate', 'Amount'], premiumRows(quote, { withBreakdown: false })),
    totalsBlock(
      [{ label: 'Subtotal', value: formatUgx(premium) }],
      { label: 'Total due', value: formatUgx(premium) },
    ),
    notesBlock('Payment & notes', [
      'Pay by Mobile Money (MTN MoMo / Airtel Money) or bank transfer.',
      `Bank transfer: ${escapeHtml(BANK_TRANSFER.bank)}, account ${escapeHtml(BANK_TRANSFER.account)}, reference ${escapeHtml(ref)}.`,
      'Cover activates once payment confirms; until then this is a proforma invoice.',
      input.payUrl
        ? `Pay online: <span class="num">${escapeHtml(input.payUrl)}</span>`
        : 'Reply PAY to the Protecta WhatsApp bot to start the payment.',
    ]),
    stampBlock(
      `Amount due: ${formatUgx(premium)}`,
      `Payment pending \u00b7 Quote ${ref}`,
    ),
  ].join('\n');

  return shell({
    title: `Invoice INV-${ref} \u00b7 Protecta Bode`,
    docType: 'Invoice',
    docNumber: `INV-${ref}`,
    pageId: 'invoice',
    body,
  });
};

export type ReceiptHtmlInput = {
  payment: RecordData;
  quote: RecordData;
  policy?: RecordData | null;
  name?: string;
  receivedOn?: string;
};

/**
 * The payment receipt, sent once the payment confirms: what was received,
 * through which provider, and the policy it bought.
 */
export const renderReceiptHtml = (input: ReceiptHtmlInput): string => {
  const { payment, quote, policy } = input;
  const ref = String(payment.protectaRef ?? payment.paymentRef ?? '');
  const amount = Number(payment.amountUgx ?? quote.premium ?? 0);
  const payer = String(payment.payerPhone ?? quote.policyholderPhone ?? '');
  const name = input.name || 'Protecta Bode customer';
  const vehicle = `${String(quote.vehicleMake ?? '')} ${String(quote.vehicleModel ?? '')}`.trim();
  const provider = String(payment.provider ?? '');
  const providerRef = String(payment.providerRef ?? '');
  const mark = providerMark(provider);

  const left = `      <h4>Received from</h4>
      <p>${escapeHtml(name)}<br><span class="muted">${escapeHtml(vehicle || 'Motor vehicle')}</span>${
        String(quote.plate ?? '')
          ? `<br><span class="muted">Plate ${escapeHtml(String(quote.plate))}</span>`
          : ''
      }</p>`;

  const right = `      <h4>Transaction</h4>
      <p><span class="muted">Date</span> ${escapeHtml(input.receivedOn ?? issuedDate(payment))}</p>
      <p><span class="muted">Ref</span> #${escapeHtml(providerRef || ref)}</p>
      <p><span class="muted">Status</span> Received</p>`;

  const notes = [
    policy?.policyNo
      ? `Motor policy ${escapeHtml(String(policy.policyNo))} is active for this payment.`
      : 'The motor policy for this payment is issued on confirmation.',
    policy?.periodStart && policy?.periodEnd
      ? `Cover ${escapeHtml(String(policy.periodStart))} to ${escapeHtml(String(policy.periodEnd))}.`
      : '',
    `Quote ${escapeHtml(String(quote.reference ?? ''))} \u00b7 keep this receipt with your policy documents.`,
  ].filter(Boolean);

  const body = [
    `  <div class="rec-evbanner">
    ${mark.svg}
    <div class="ev-txt">Paid via <b>${escapeHtml(mark.label)}</b>${
      payer
        ? ` \u00b7 <span class="dflag dflag-ug"></span>${escapeHtml(maskedUgPhone(payer))}`
        : ''
    }</div>
  </div>`,
    metaGrid(left, right),
    lineItemTable(
      ['Item', 'Qty', 'Amount'],
      [
        {
          cells: [
            escapeHtml(
              `Motor insurance premium${vehicle ? ` \u2014 ${vehicle}` : ''}${
                String(quote.plate ?? '') ? ` \u00b7 ${String(quote.plate)}` : ''
              }`,
            ),
            '1 policy',
            escapeHtml(formatUgx(amount)),
          ],
        },
      ],
    ),
    totalsBlock(
      [{ label: 'Subtotal', value: formatUgx(amount) }],
      { label: 'Total received', value: formatUgx(amount) },
    ),
    notesBlock('Notes', notes),
    stampBlock(
      `Received ${formatUgx(amount)}`,
      `${mark.label}${providerRef ? ` \u00b7 ${providerRef}` : ''}`,
    ),
  ].join('\n');

  return shell({
    title: `Receipt RCP-${ref} \u00b7 Protecta Bode`,
    docType: 'Receipt',
    docNumber: `RCP-${ref}`,
    pageId: 'receipt',
    body,
  });
};
