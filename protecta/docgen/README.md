# Protecta Document Generator

A standalone Twenty CRM app that turns document templates into **PDF** and
**Word** files. It is linked to the **Protecta Bode** app: whenever a policy
is issued in the workspace, the full **Liberty General Insurance Uganda
Ltd "Motor Protecta Bode Policy"** document is generated automatically —
cover page, policy schedule with the insured's and vehicle's particulars,
premium breakdown, cover limits and the complete policy wording.

Both apps install side by side into the same workspace (`start.sh` syncs
them together). The link works through shared workspace records and events —
Protecta owns the policies, this app owns the documents.

## How documents are generated

1. A `Generated document` record is created for a Protecta policy
   (`policyNo` is the business key linking back to Protecta):
   - **Automatic** — the `insurancePolicy.created` event fires when a policy
     is issued from the bot, the portal, the partner API or the CRM.
   - **Manual (in the CRM)** — open **Generated documents → + New**, set the
     `Policy no`, save. The reference and content fill themselves in.
   - **Manual (API)** — `POST /s/docgen/generate` with `{ "policyNo": "PB-..." }`.
2. The template body is rendered against the policy's data (see placeholders
   below) and stored on the record as `content`.
3. The PDF and Word files are produced from `content` on demand:
   - PDF: `/s/docgen/documents/view?ref=DOC-XXXXXX`
   - Word: `/s/docgen/documents/docx?ref=DOC-XXXXXX`
   (both also accept `?policyNo=PB-...` for the latest generated document).

Every generation is a new `Generated document` record — regenerating simply
means creating another one, so earlier documents stay as they were.

## Templates and placeholders

Templates live in the **Document templates** object. A template has a `kind`
and a `body`. When no template exists for a kind (or its body is empty), the
built-in template is used — the whole Liberty policy document, so a freshly
installed workspace generates the correct document with no setup.

To get an editable copy in the CRM:

```bash
curl -X POST "$PUBLIC_BASE_URL/s/docgen/templates/install"           # create it
curl -X POST "$PUBLIC_BASE_URL/s/docgen/templates/install?force=1"   # restore the built-in body
```

The route returns the template record id. Without `force=1` an existing
template is left alone, so local edits are never overwritten by accident.
Text templates are plain text with a few layout markers:

| Marker | Meaning |
|---|---|
| `# Heading`, `## Section`, `### Clause` | headings (rendered as headings in HTML, PDF and Word) |
| `- item` | bullet |
| `\| cell \| cell \|` | a table row; consecutive rows form one table, first row = header |
| blank line | spacing between blocks |

### What the policy document fills in from the CRM

| Placeholder | Where it comes from |
|---|---|
| `{{policyNo}}`, `{{status}}`, `{{premium}}`, `{{periodStart}}`, `{{periodEnd}}`, `{{quoteRef}}` | the policy record |
| `{{sumInsured}}` | policy **Sum insured (UGX)**, else the quote's vehicle value (fixed at issuance) |
| `{{bodyType}}`, `{{engineCc}}`, `{{seatingCapacity}}` | policy fields, else the vehicle record for that plate |
| `{{plate}}`, `{{vehicle}}`, `{{vehicleMake}}`, `{{vehicleModel}}`, `{{vehicleYear}}` | policy fields, else the vehicle record |
| `{{policyholderName}}`, `{{insuredAddress}}`, `{{businessProfession}}`, `{{policyholderPhone}}` | the policyholder person (via the quote) |
| `{{trainingLevy}}`, `{{stickerFees}}`, `{{vat}}`, `{{stampDuty}}`, `{{totalPremium}}` | policy fields, else the app settings below, else "—" |
| `{{proposalDate}}` | the quote's creation date, else the cover start |
| `{{productName}}`, `{{supportPhone}}` | app settings |
| `{{issuedDate}}`, `{{reference}}` | generation time / document reference |

Anything the CRM does not hold prints as "—" rather than as a guess: the
document is a contract, so an amount is only printed when it is recorded.
Documented placeholders: see `PLACEHOLDERS` in `src/lib/templates.ts`.

### Premium breakdown without typing it into every policy

Set **Settings → Document Generator** once and every schedule shows the same
lines:

| App setting | Purpose |
|---|---|
| `POLICY_TRAINING_LEVY_RATE` | training levy as a fraction of the premium (`0.005` = 0.5%) |
| `POLICY_VAT_RATE` | VAT as a fraction of the premium (`0.18` = 18%) |
| `POLICY_STICKER_FEES_UGX` | fixed sticker fee per policy |
| `POLICY_STAMP_DUTY_UGX` | fixed stamp duty per policy |

`0` (the default) means "not set": that line prints "—" until either the
setting or the matching per-policy field (`Training levy (UGX)`, `VAT (UGX)`,
`Sticker fees (UGX)`, `Stamp duty (UGX)`, `Total premium (UGX)`) is filled in.
Per-policy values always win. `Total` is the recorded total when there is
one, otherwise the sum of the lines that are known.

### The policy wording itself

`src/lib/policy-template.ts` carries the wording verbatim from
`Protecta bode Final.docx` (repository root), including its original
spelling and its typographical quirks, so the generated document is the
contract Liberty issued. Edit the wording in the CRM (install the template,
then change the body) or in that file; `PLACEHOLDERS` is the single place
that documents what may be referenced.

## Fields the document reads from Protecta

These exist on the Protecta Bode app and are what the schedule prints. The
generator works without them (it falls back to the quote, the vehicle record
and "—"), but filling them makes an issued certificate complete:

| Object | Fields |
|---|---|
| Insurance policy | Sum insured (UGX), Body type, Engine capacity (c.c.), Seating capacity, Training levy (UGX), Sticker fees (UGX), VAT (UGX), Stamp duty (UGX), Total premium (UGX) |
| Vehicle | Body type, Engine capacity (c.c.), Seating capacity |
| Person | Address, Business or profession |

Protecta fills Sum insured from the quote's vehicle value when it issues the
policy (it is then fixed: later value edits do not move an issued
certificate), and keeps vehicle body/capacity details on the vehicle record
as quotes are created.

## Notes

- Route responses are string-only in the logic-function runtime, so the PDF
  preview and the Word download are delivered as base64 `data:` URLs on HTML
  pages (the PDF page also offers a Download PDF link).
- The document view serves text templates as the styled document itself
  (headings, clauses, lists and the schedule tables), with links to the PDF
  and Word file; `?asPdf=1` gives the PDF preview. The PDF keeps the same
  structure: headings, bullets, tables with a repeated header row, page
  numbers and a `Policy … · Document …` footer.
- `Generated documents.reference` is auto-generated (`DOC-XXXXXX`) with the
  same fill-on-create pattern Protecta uses for its record references.
- The app's role reads Protecta's records (policies, quotes, people) in the
  shared workspace and writes only its own document records.

## Development

```bash
npm install
npm run check   # typecheck + unit tests + manifest build
```

Syncing this app on its own, from `protecta/`:

```bash
./twenty.sh docgen           # install what is missing, then apply docgen/app
./twenty.sh docgen plan .    # any other twenty subcommand, run in docgen/app
```

Always go through the app's own CLI (`docgen/app/node_modules/.bin/twenty`). A
bare `npx twenty` does not fail with "not installed": npm looks the name up on
the registry, finds the unrelated `twenty` package and stops with
`could not determine executable to run`.
