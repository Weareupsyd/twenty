# Protecta Bode - Email Template Pack

Branded transactional email templates for **customers, agents, brokers and the helpdesk**, built on the supplied `email_design system.html` (660px XHTML table layout, hidden preheader, dark footer band, dark-mode + 3 mobile breakpoints) and re-skinned to Protecta Bode: navy `#0B1C48`, orange `#CA6E2B`, sky `#EEF8FB`, Poppins/Noto Sans (Arial fallback).

**Regenerate everything:** `python3 build_emails.py` -> rewrites all `*.html` + the `index.html` preview gallery. One design system, 20 outputs - never hand-edit a generated file; change the builder.

**Preview:** open `index.html` (gallery with live iframe previews), or serve this folder over HTTP.

## Template index

| # | File | Audience | Trigger |
|---|------|----------|---------|
| 1 | `welcome.html` | Customer | Account created |
| 2 | `quote.html` | Customer | Quote calculated/shared (web, WhatsApp or agent) |
| 3 | `payment-receipt.html` | Customer | Payment confirmed (MoMo / Airtel / bank) |
| 4 | `policy-issued.html` | Customer | Policy issued - policy PDF + motor certificate attached |
| 5 | `payment-failed.html` | Customer | Collection attempt failed - retry |
| 6 | `renewal-reminder.html` | Customer | 30 / 14 / 3 / 0 days before expiry (`{{days}}`) |
| 7 | `claim-acknowledged.html` | Customer | FNOL received - includes the claims-document checklist from the product brochure |
| 8 | `claim-update.html` | Customer | Claim status changed (assigned / assessed / approved / settled) |
| 9 | `otp.html` | Customer | Phone/login one-time code |
| 10 | `password-reset.html` | Customer | Portal password reset |
| 11 | `kyc-verified.html` | Customer | Identity (KYC) check passed |
| 12 | `agent-application-received.html` | Agent | Agent applied - licence + KYC under review |
| 13 | `agent-approved.html` | Agent | Application approved - portal access granted |
| 14 | `agent-sale.html` | Agent | Customer paid - commission accrued |
| 15 | `commission-statement.html` | Agent / Broker | Monthly commission statement (PDF attached) |
| 16 | `broker-fleet-quote.html` | Broker | Fleet/multi-vehicle quote ready to share |
| 17 | `client-expiry-report.html` | Broker | Monthly renewals-due report |
| 18 | `ticket-received.html` | Helpdesk -> customer | Support ticket logged |
| 19 | `ticket-resolved.html` | Helpdesk -> customer | Ticket resolved + satisfaction survey |
| 20 | `helpdesk-escalation.html` | Helpdesk (internal) | Escalated ticket assigned to the helpdesk queue |
| 21 | `invoice.html` | Customer / Broker | Premium invoice (single policy or fleet) - repeatable line items, payment instructions, invoice ref |

**Repeating rows:** line items in `invoice.html` sit between `<!-- REPEAT:line_items -->` … `<!-- /REPEAT:line_items -->` markers - the email service repeats that `<tr>` block per invoice line before tag substitution (preview shows one sample row).

## Merge tags

`{{double_brace}}` tags (Braze/Jinja-compatible - the email service swaps them before send). Common ones: `{{first_name}}` `{{portal_url}}` `{{pay_url}}` `{{renew_url}}` `{{quote_ref}}` `{{premium_ugx}}` `{{value_ugx}}` `{{vehicle}}` `{{plate}}` `{{policy_no}}` `{{period_start}}` `{{period_end}}` `{{amount_ugx}}` `{{payment_method}}` `{{payment_ref}}` `{{receipt_no}}` `{{claim_ref}}` `{{claim_status}}` `{{ticket_ref}}` `{{agent_name}}` `{{partner_name}}` `{{statement_month}}` `{{total_commission_ugx}}` `{{otp_code}}` `{{reset_url}}` `{{days}}`. Plus footer-wide `{{year}}` and `{{unsubscribe_url}}`.

Every tag must be provided at send time; unmatched tags should fail the send in the email service (no silent `{{...}}` leakage to customers).

## Brand assets & icons

- **Logo:** templates reference `../assets/protecta-bode-logo-on-white.png` - a real PNG **extracted from `Protecta Bode on white .svg`** (the SVG embeds a 2681×1618 bitmap; raw SVG does not render in Gmail/Outlook). At send time the service rewrites the path to the hosted CDN URL.
- **Icons:** inline, unbadged **HugeIcons** Stroke-Rounded SVGs (email clients don't load icon fonts). The paths were curated from the set already proven in the AgriLink email service; verify/refresh exact paths from hugeicons.com before production if needed. Footer logotype = shield icon + wordmark text (no image on navy).
- **Footer legal** (from the product brochure): underwritten by Liberty General Insurance Uganda, powered by Stanbic Bancassurance Agency and Safeboda, regulated under the IRA sandbox guidelines. Contacts: 0312 246500 · WhatsApp +256 740 446 717 · info@liberty.co.ug · 3rd Floor, Madhvani Building, Plot 99-101 Buganda Road, Kampala. P.O. Box 22938.

## Before production (email-service checklist)

1. Rewrite `LOGO_URL` (and any attachment paths) to absolute hosted URLs.
2. Attach PDFs where noted: policy schedule + motor certificate (4), receipt (3), statement (15).
3. Generate a plain-text alternative for each send (service-side).
4. Test dark mode + 659/480/389px breakpoints in Gmail, Outlook, Apple Mail.
5. Confirm the `{{unsubscribe_url}}` target exists (marketing sends only; transactional sends may omit it).
