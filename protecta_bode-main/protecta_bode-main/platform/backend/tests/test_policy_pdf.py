"""Policy PDF generator: verbatim wording, filled schedule, phone-number lock."""
import io
import re
from datetime import date

from pikepdf import PasswordError, open as pdf_open
from pypdf import PdfReader

from app.services.policy_pdf import build_policy_pdf, phone_password


def _build() -> bytes:
    return build_policy_pdf(
        policy_no="PB-2026-34200A", insured_name="Peter Okello",
        customer_phone="+256772999888",
        period_start=date(2026, 9, 25), period_end=date(2027, 9, 25),
        vehicle={"plate": "UAC 789C", "make": "Subaru", "model": "Outback",
                 "body": "", "cc": "", "seats": ""},
        value=60_000_000, premium=900_000, pricing={},
        issued_at=None)


def test_password_is_phone_digits():
    assert phone_password("+256772999888") == "256772999888"
    assert phone_password("0772999888") == "0772999888"


def test_pdf_is_locked_and_opens_with_phone():
    pdf = _build()
    with pdf_open(io.BytesIO(pdf), password="256772999888") as p:
        assert len(p.pages) >= 3
    try:
        pdf_open(io.BytesIO(pdf))
        raised = False
    except PasswordError:
        raised = True
    assert raised, "PDF must not open without the phone-number password"


def test_schedule_filled_and_ascii_only():
    pdf = _build()
    reader = PdfReader(io.BytesIO(pdf))
    reader.decrypt("256772999888")
    text = " ".join((" ".join((page.extract_text() or "").split()) for page in reader.pages))
    for probe in ("Peter Okello", "UAC 789C", "Subaru Outback", "60,000,000.00",
                  "25/09/2026", "25/09/2027", "Premium 900,000.00", "Sticker fees 6,000.00",
                  "S/Duty 35,000.00", "Total 941,000.00", "Micro Motor Policy",
                  "IMPORTANT NOTES", "EXTENSIONS"):
        assert probe in text, f"missing: {probe}"
    assert not re.search(r"[^\x00-\x7F]", text), "PDF text must stay ASCII"
