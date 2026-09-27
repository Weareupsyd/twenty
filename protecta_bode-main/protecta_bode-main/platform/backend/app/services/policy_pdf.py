"""Protecta Bode policy PDF generator.

Renders the official MOTOR PROTECTA BODE POLICY document exactly as supplied
("Protecta bode Final.docx"; wording extracted verbatim into policy_content.py):
same order, same sections, plain black text, simple bordered tables. The only
change is that the schedule blanks are filled from live data (insured name,
period, proposal date, policy number, vehicle details and the premium block).

Output is password-protected: the password is the customer's phone number in
international digits-only form (e.g. +256772999888 -> 256772999888).
"""
import io
import re
from datetime import datetime, timezone
from html import escape

from app.services.policy_content import ELEMENTS

_DOC_NO = "P/HQ/BODE/26/000008"          # placeholder number in the blank form
_COVER = ("Liberty General Insurance Uganda Ltd (LGIUL)", "MOTOR",
          "PROTECTA BODE", "POLICY")


class PolicyPdfError(RuntimeError):
    pass


def phone_password(phone: str) -> str:
    """PDF password: the customer's phone digits, no leading +."""
    return re.sub(r"\D", "", phone or "")


def _fmt(n) -> str:
    return f"{float(n):,.2f}"


def premium_breakdown(premium: int, pricing: dict) -> list[tuple[str, float]]:
    """The schedule's PREMIUM (UGX) block, filled in.

    Defaults mirror the paper document (Sticker fees 6,000.00; S/Duty
    35,000.00); Training Levy and VAT stay 0.00 until Liberty confirms the
    rates. Override via the app_settings 'pricing' row.
    """
    sticker = float(pricing.get("sticker_fee", 6_000))
    duty = float(pricing.get("stamp_duty", 35_000))
    levy = round(premium * float(pricing.get("training_levy_rate", 0.0)))
    vat = round(premium * float(pricing.get("vat_rate", 0.0)))
    return [
        ("Premium", float(premium)),
        ("Training Levy", float(levy)),
        ("Sticker fees", sticker),
        ("VAT", float(vat)),
        ("S/Duty", duty),
    ]


def _d(value) -> str:
    if isinstance(value, datetime):
        value = value.date()
    return value.strftime("%d/%m/%Y") if value else ""


def _p(text: str, cls: str = "p") -> str:
    return f'<p class="{cls}">{text}</p>'


def _bold_if_heading(text: str) -> str:
    return _p(f"<b>{text}</b>") if text.isupper() and len(text) <= 90 else _p(text)


def _grid(rows: list[list[str]], header_first: bool = True) -> str:
    """Plain bordered table, like the Word grid - no shading, no colours."""
    out = ['<table class="grid">']
    for i, row in enumerate(rows):
        attr = ' class="b"' if (header_first and i == 0) else ""
        cells = "".join(f"<td{attr}>{c}</td>" for c in row)
        out.append(f"<tr>{cells}</tr>")
    out.append("</table>")
    return "\n".join(out)


def _premium_lines(breakdown: list[tuple[str, float]]) -> str:
    total = sum(a for _, a in breakdown)
    lines = [f"{escape(name)} {_fmt(amount)}" for name, amount in breakdown]
    lines.append(f"Total {_fmt(total)}")
    return "<br/>".join(escape(l) for l in lines)


def _schedule(values: dict) -> str:
    """The POLICY SCHEDULE table with the blanks filled, layout as supplied."""
    premium_cell = _premium_lines(values["breakdown"])
    period = values["period_text"]
    return f"""
<table class="grid sched">
  <tr><td class="b" width="30%">THE COMPANY</td><td width="30%">LIBERTY GENERAL INSURANCE (U) LTD</td><td class="b" width="40%">PREMIUM (UGX)</td></tr>
  <tr><td class="b">INSURED'S NAME</td><td>{values['insured_name']}</td><td rowspan="6">{premium_cell}</td></tr>
  <tr><td class="b">ADDRESS</td><td>{values['address']}</td></tr>
  <tr><td class="b">BUSINESS OR PROFESSION</td><td>{values['business']}</td></tr>
  <tr><td class="b">PERIOD OF INSURANCE</td><td>{period}</td></tr>
  <tr><td class="b">DATE OF SIGNATURE OF PROPOSAL AND DECLARATION</td><td>{values['signature_date']}</td></tr>
  <tr><td class="b">TYPE OF INSURANCE PROVIDED</td><td>Micro Motor Policy</td></tr>
</table>
<table class="grid sched">
  <tr><td class="b" colspan="6">DETAILS OF VEHICLE</td></tr>
  <tr><td class="b" width="15%">REG NO.</td><td class="b" width="17%">MAKE</td><td class="b" width="14%">BODY</td><td class="b" width="13%">C.C</td><td class="b" width="18%">SEATING CAPACITY</td><td class="b" width="23%">AGREED LIMIT OF COVER/ SUM INSURED</td></tr>
  <tr><td>{values['plate']}</td><td>{values['make']}</td><td>{values['body']}</td><td>{values['cc']}</td><td>{values['seats']}</td><td>{values['sum_insured']}</td></tr>
</table>"""


def _banded_tables(rows: list[list[str]]) -> str:
    """The EXTENSIONS + LIMITS grid: the Word table bands rows with different
    column layouts (via merged cells). Render each band as a stacked 100%-wide
    table so the borders read as one continuous grid, widths like the original."""
    widths_by_count = {
        2: [25, 75],
        4: [25, 9, 36, 30],
        5: [25, 7, 30, 19, 19],
    }
    out, run, count = [], [], None

    def flush():
        nonlocal run, count
        if not run:
            return
        widths = widths_by_count.get(count)
        wattr = "".join(f' width="{w}%"' for w in widths) if widths else ""
        body = []
        for i, row in enumerate(run):
            cells = []
            for j, c in enumerate(row):
                bold = '<b>%s</b>' % c if (i == 0 or (j == 0 and c)) else c
                w = widths[j] if widths and j < len(widths) and i == 0 else None
                cells.append(f'<td width="{w}%">{bold}</td>' if w else f"<td>{bold}</td>")
            body.append("<tr>" + "".join(cells) + "</tr>")
        out.append('<table class="grid">' + "".join(body) + "</table>")
        run, count = [], None

    for row in rows:
        n = len(row)
        if count is None or n == count:
            count = count or n
            run.append(row)
        else:
            flush()
            count, run = n, [row]
    flush()
    return "\n".join(out)


def _notes_box(cell_text: str) -> str:
    """IMPORTANT NOTES: one bordered box, heading centred, numbered lines."""
    lines = cell_text.split("\n")
    heading, body = lines[0], lines[1:]
    inner = [_p(f"<b><u>{escape(heading)}</u></b>", "c")]
    inner += [_p(escape(l)) for l in body]
    return '<table class="grid"><tr><td>' + "".join(inner) + "</td></tr></table>"


def _render_content(values: dict) -> str:
    """Walk the extracted elements in document order - verbatim, plain."""
    out = []
    for idx, el in enumerate(ELEMENTS):
        kind, val = el["t"], (el["x"] if el["t"] == "p" else el["rows"])
        if kind == "p":
            x = escape(val)
            if idx < len(_COVER) and val == _COVER[idx]:
                cls = ["co", "sub", "big", "sub2"][idx]
                out.append(_p(x, cls))
            elif val == "MOTOR PROTECTA BODE POLICY":
                out.append(_p(f"<b>{x}</b>", "c"))
            elif val == "MOTOR PROTECTA BODE POLICY SCHEDULE":
                out.append(_p(f"<b>{x}</b>", "c pb"))
            elif val == _DOC_NO:
                out.append(_p(f"<b>{escape(values['policy_no'])}</b>", "c"))
            else:
                out.append(_bold_if_heading(x))
        else:
            rows = [[escape(c).replace("\n", "<br/>") for c in row] for row in val]
            if len(val) == 1 and len(val[0]) == 1 and val[0][0].startswith("IMPORTANT NOTES"):
                out.append(_notes_box(val[0][0]))
            elif val[0][0] == "THE COMPANY":
                out.append(_schedule(values))
            elif val[0][0].startswith("EXTENSIONS"):
                out.append(_banded_tables(val))
            else:
                out.append(_grid(rows))
    return "\n".join(out)


def build_policy_pdf(*, policy_no: str, insured_name: str, customer_phone: str,
                     period_start, period_end, vehicle: dict, value: int,
                     premium: int, pricing: dict | None = None,
                     address: str = "", business: str = "",
                     issued_at: datetime | None = None) -> bytes:
    """Render the policy document verbatim with schedule blanks filled, then
    password-protect it with the customer's phone digits."""
    from xhtml2pdf import pisa
    import pikepdf

    pricing = pricing or {}
    issued = issued_at or datetime.now(timezone.utc)
    start, end = _d(period_start), _d(period_end)
    breakdown = premium_breakdown(premium, pricing)
    values = {
        "policy_no": policy_no,
        "insured_name": escape(insured_name),
        "address": escape(address),
        "business": escape(business),
        "period_text": escape(f"From {start} TO {end} (Both dates inclusive)"),
        "signature_date": _d(issued),
        "breakdown": breakdown,
        "plate": escape(str(vehicle.get("plate", ""))),
        "make": escape(f"{vehicle.get('make', '')} {vehicle.get('model', '')}".strip()),
        "body": escape(str(vehicle.get("body", ""))),
        "cc": escape(str(vehicle.get("cc", ""))),
        "seats": escape(str(vehicle.get("seats", ""))),
        "sum_insured": escape(_fmt(value)),
    }

    html = f"""<html><head><style>
      @page {{ size: A4; margin: 2cm; }}
      body {{ font-family: Helvetica; font-size: 10pt; color: #000000; }}
      p {{ margin: 4px 0; }}
      p.c   {{ text-align: center; }}
      p.co  {{ text-align: center; font-size: 11pt; }}
      p.sub {{ text-align: center; font-size: 11pt; letter-spacing: 3px; }}
      p.sub2 {{ text-align: center; font-size: 12pt; letter-spacing: 3px; }}
      p.big {{ text-align: center; font-size: 15pt; font-weight: bold; letter-spacing: 1px; }}
      table.grid {{ width: 100%; border-collapse: collapse; margin: 6px 0; }}
      table.grid td {{ border: 0.6pt solid #000000; padding: 4px 5px; font-size: 9.5pt; vertical-align: top; }}
      td.b {{ font-weight: bold; }}
      p.pb {{ page-break-before: always; }}
    </style></head><body>
    {_render_content(values)}
    </body></html>"""

    buf = io.BytesIO()
    result = pisa.CreatePDF(io.StringIO(html), dest=buf)
    if result.err:
        raise PolicyPdfError(f"PDF rendering failed with {result.err} error(s)")

    password = phone_password(customer_phone)
    if not password:
        raise PolicyPdfError("Customer phone is required to protect the policy PDF")

    out = io.BytesIO()
    with pikepdf.open(io.BytesIO(buf.getvalue())) as pdf:
        with pdf.open_metadata() as meta:
            meta["dc:title"] = f"Protecta Bode Policy {policy_no}"
        pdf.save(out, encryption=pikepdf.Encryption(user=password, owner="liberty-lgiul", R=6))
    return out.getvalue()
