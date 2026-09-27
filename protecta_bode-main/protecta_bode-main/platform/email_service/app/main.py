"""Protecta Bode transactional email microservice.

Serves the 21-template Protecta Bode pack (templates/). Features:
- {{double_brace}} substitution (strict mode fails the send on unknown tags)
- REPEAT blocks: `<!-- REPEAT:key -->` ... `<!-- /REPEAT:key -->` rows repeated
  once per item in context[key] (used by invoice line items)
- SMTP via aiosmtplib; OUTBOX=stdout logs the email instead (sandbox/dev)
- Assets: templates reference ../assets/... in the repo; in the container the
  logo URL is rewritten to ASSET_BASE_URL so images resolve in mail clients
"""
import json
import os
import re
from pathlib import Path

from aiosmtplib import send as smtp_send
from fastapi import FastAPI, HTTPException
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pydantic import BaseModel
from pydantic_settings import BaseSettings

TEMPLATES = Path(__file__).resolve().parent.parent / "templates"


class Settings(BaseSettings):
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "Protecta Bode <policies@example.com>"
    outbox: str = "stdout"            # stdout | smtp
    asset_base_url: str = ""          # e.g. https://cdn.protectabode.example/emails
    strict_tags: bool = True


settings = Settings()
app = FastAPI(title="Protecta Bode email service")

TAG_RE = re.compile(r"\{\{(\w+)\}\}")


def load_template(name: str) -> str:
    path = TEMPLATES / f"{name}.html"
    if not path.exists():
        raise HTTPException(404, f"Unknown template '{name}'")
    return path.read_text(encoding="utf-8")


def expand_repeats(html: str, ctx: dict) -> str:
    pattern = re.compile(r"[ \t]*<!-- REPEAT:(\w+) -->(.*?)<!-- /REPEAT:\1 -->[ \t]*\n?", re.S)
    def _expand(m: re.Match) -> str:
        key, row = m.group(1), m.group(2)
        items = ctx.get(key) or []
        out = []
        for i, item in enumerate(items):
            piece = row
            for k, v in item.items():
                piece = piece.replace("{{" + k + "}}", str(v))
            out.append(piece)
        return "".join(out)
    return pattern.sub(_expand, html)


def substitute(html: str, ctx: dict, strict: bool) -> tuple[str, list[str]]:
    missing = []

    def _sub(m: re.Match) -> str:
        key = m.group(1)
        if key in ctx:
            return str(ctx[key])
        missing.append(key)
        return ""

    out = TAG_RE.sub(_sub, html)
    if strict and missing:
        raise HTTPException(422, f"Missing template tags: {sorted(set(missing))}")
    return out, missing


def rewrite_assets(html: str) -> str:
    if settings.asset_base_url:
        return html.replace("../assets/", f"{settings.asset_base_url}/")
    return html


class SendIn(BaseModel):
    template: str
    to: str
    subject: str | None = None
    context: dict = {}
    attachments: list[dict] = []   # [{filename, content_base64}]


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "templates": len(list(TEMPLATES.glob("*.html"))), "outbox": settings.outbox}


@app.get("/templates")
def templates() -> list[str]:
    return sorted(p.stem for p in TEMPLATES.glob("*.html"))


@app.post("/send")
async def send_email(body: SendIn) -> dict:
    html = load_template(body.template)
    html = expand_repeats(html, body.context)
    html, missing = substitute(html, body.context, strict=settings.strict_tags)
    html = rewrite_assets(html)
    m = re.search(r"<title>(.*?)</title>", html)
    subject = body.subject or (m.group(1) if m else "Protecta Bode")

    msg = MIMEMultipart("mixed")
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from
    msg["To"] = body.to
    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(re.sub(r"<[^>]+>", " ", html), "plain", "utf-8"))
    alt.attach(MIMEText(html, "html", "utf-8"))
    msg.attach(alt)
    for att in body.attachments:
        part = MIMEApplication(att["content_base64"].encode("latin-1"), _subtype="pdf")
        part.add_header("Content-Disposition", "attachment", filename=att["filename"])
        msg.attach(part)

    if settings.outbox == "smtp":
        await smtp_send(msg, hostname=settings.smtp_host, port=settings.smtp_port,
                        username=settings.smtp_user or None, password=settings.smtp_password or None,
                        start_tls=True)
    else:
        print(f"[email:stdout] to={body.to} subject={subject!r} bytes={len(html)}")
    return {"sent": True, "template": body.template, "subject": subject}
