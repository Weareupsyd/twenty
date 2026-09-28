# Protecta Document Generator

A standalone Twenty CRM app that turns document templates into **PDF** and
**Word** files. It is linked to the **Protecta Bode** app: whenever a policy
is issued in the workspace, its policy certificate document is generated
automatically.

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
and a `body`. When no template exists for a kind, a built-in default is used.

Placeholders use `{{name}}` and are replaced at generation time:

| Placeholder | Value |
|---|---|
| `{{policyNo}}` | Policy number, e.g. `PB-2026-004213` |
| `{{reference}}` | Generated document reference (`DOC-XXXXXX`) |
| `{{status}}` | Policy status |
| `{{policyholderName}}` | Policyholder full name |
| `{{policyholderPhone}}` | Policyholder phone |
| `{{plate}}` | Number plate |
| `{{vehicle}}` | Make and model |
| `{{vehicleMake}}` / `{{vehicleModel}}` | Vehicle make / model |
| `{{premium}}` | Premium, formatted `UGX 150,000` |
| `{{periodStart}}` / `{{periodEnd}}` | Cover period |
| `{{quoteRef}}` | Source quote reference |
| `{{productName}}` | Product line (app variable) |
| `{{supportPhone}}` | Support helpline (app variable) |
| `{{issuedDate}}` | Date the document was generated |

## Swapping in the real Word policy template

The original Word policy wording is not in the repo yet. When it arrives,
recreate its text in a template body keeping the placeholders above where
the per-policy data belongs (this is the supported path — PDF and Word are
both produced from the template body). If pixel-fidelity to the original
`.docx` layout becomes necessary, the next step is a `.docx`-fill renderer
(`docx-templater` + `pizzip` on an uploaded template file); the
`documentTemplate` object and the generation pipeline are structured so
that renderer can be added without changing records or routes.

## Notes

- Route responses are string-only in the logic-function runtime, so the PDF
  preview and the Word download are delivered as base64 `data:` URLs on HTML
  pages (the PDF page also offers a Download PDF link).
- `Generated documents.reference` is auto-generated (`DOC-XXXXXX`) with the
  same fill-on-create pattern Protecta uses for its record references.
- The app's role reads Protecta's records (policies, quotes, people) in the
  shared workspace and writes only its own document records.

## Development

```bash
npm install
npm run check   # typecheck + unit tests + manifest build
```
