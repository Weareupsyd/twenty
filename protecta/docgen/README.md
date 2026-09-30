# Protecta Document Generator

A standalone Twenty CRM app that renders document templates into **PDF**
and **Word** files. It is linked to the **Protecta Bode** app. The built-in
policy template uses the Word-exported HTML at
`Protecta bode Final (1).html`, fills the schedule from CRM records, and sends
the HTML to a Chromium-based renderer for PDF output. The broken cover-image
reference was removed as requested.

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

Templates live in the **Document templates** object. A template has a `kind`,
`format` and `body`. For the policy kind, the built-in HTML template is used
when no template exists, when its body is empty, or when it finds the previous
built-in text transcription. Custom workspace templates are preserved.

To get an editable copy in the CRM:

```bash
curl -X POST "$PUBLIC_BASE_URL/s/docgen/templates/install"           # create it
curl -X POST "$PUBLIC_BASE_URL/s/docgen/templates/install?force=1"   # restore the built-in body
```

The route returns the template record id. Without `force=1` an existing
custom template is left alone. `force=1` restores the built-in Word-exported
HTML template. The previous plain-text format remains supported for custom
templates; its layout markers are:

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
| `{{trainingLevy}}`, `{{stickerFees}}`, `{{vat}}`, `{{stampDuty}}`, `{{totalPremium}}` | formatted amounts for text templates |
| `{{premiumAmount}}`, `{{trainingLevyAmount}}`, `{{stickerFeesAmount}}`, `{{vatAmount}}`, `{{stampDutyAmount}}`, `{{totalPremiumAmount}}` | amounts without a currency prefix for the original HTML schedule |
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

`0` means "not configured" for training levy and VAT, so those lines print
"—" until a policy value or app setting is available. The supplied HTML
schedule itself specifies sticker fees of UGX 6,000 and stamp duty of UGX
35,000; recorded policy values or nonzero app settings override those source
defaults. A recorded total always wins; otherwise the HTML schedule total is
calculated from the premium and known line items.

### The policy HTML and schedule mapping

The policy template is the Word-exported `Protecta bode Final (1).html` at
the repository root, bundled as `src/lib/policy-template-html.ts` for the
logic-function runtime. CRM values replace placeholders in the schedule;
unknown premium components print as an em dash instead of a guessed amount.
The converted file includes Word-specific styles and page-break rules. The
Chromium result must still be visually checked against the source HTML because
browser rendering can differ from Microsoft Word.

The source HTML's broken external cover-image reference was intentionally
removed; no sidecar image asset is required.

### HTML-to-PDF runtime

The policy PDF route submits the filled HTML to Gotenberg's Chromium endpoint and sets the phone number entered by the customer as the PDF open password.
Set the DocGen application variable `DOCGEN_HTML_TO_PDF_URL` (or the equivalent Twenty server environment variable); it defaults to the internal Gotenberg address below:

```text
DOCGEN_HTML_TO_PDF_URL=http://gotenberg:3000/forms/chromium/convert/html
```

The optional renderer service is defined in `protecta/docker-compose.caddy.yml`.
Start it with `docker compose --profile docgen-renderer -f docker-compose.caddy.yml up -d gotenberg`.
It joins the external Twenty network (default `twenty_default`) and does not
publish a public port. Set `TWENTY_DOCKER_NETWORK` if your Twenty Docker network
has a different name. The Twenty app runtime must be able to resolve and
reach this service, and its `DOCGEN_HTML_TO_PDF_URL` application variable must
match the endpoint; a missing or unreachable renderer produces a 503 rather
than silently flattening the policy HTML to text.

Gotenberg encrypts the resulting PDF with that same phone number as its user/open password. The response is checked for a PDF signature before it is offered to the customer. The phone form submits by POST so the phone number is not placed in the URL.

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
- Generic document views provide preview, PDF, Word and print actions. The
  public Protecta policy route submits phone verification by POST, then offers
  exactly one PDF download. Gotenberg protects the PDF with the entered phone
  number as its open password.
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
