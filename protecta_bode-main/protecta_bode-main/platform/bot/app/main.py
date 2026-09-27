"""Protecta Bode WhatsApp bot.

Transport: WhatsApp Business Cloud API. Identity = the WhatsApp number.
Every chat action writes through the Protecta API (same records as the
portals); every outbound message is wrapped by brand() which prepends the
bold heading:

    *Protecta Bode*

per docs/WHATSAPP_BOT_FLOWS.md. No emojis, ASCII punctuation only.
"""
import os

import httpx
from fastapi import FastAPI, Request
from pydantic_settings import BaseSettings

API_URL = os.getenv("API_URL", "http://api:8000")
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "change-me-in-production")
GRAPH_TOKEN = os.getenv("WHATSAPP_TOKEN", "")
PHONE_NUMBER_ID = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "")
VERIFY_TOKEN = os.getenv("WHATSAPP_VERIFY_TOKEN", "protecta-verify")

MENU = (
    "Welcome! Cover your ride, cover your life.\n"
    "1 Buy cover  2 Renew  3 My policy  4 Claim  5 Pay a bill\n"
    "6 Talk to support  7 My details\n"
    "Reply with a number or type MENU."
)


def brand(body: str) -> str:
    """Bold brand heading on every outbound message (never hand-written in flows)."""
    return f"*Protecta Bode*\n{body}"


def api(method: str, path: str, json: dict | None = None) -> dict:
    r = httpx.request(method, f"{API_URL}/api/v1{path}", json=json,
                      headers={"X-Internal-Key": INTERNAL_API_KEY}, timeout=15)
    return r.json()


def send_text(to: str, text: str) -> None:
    if not GRAPH_TOKEN:
        print(f"[bot:dev] to {to}: {brand(text)}")
        return
    httpx.post(
        f"https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages",
        headers={"Authorization": f"Bearer {GRAPH_TOKEN}"},
        json={"messaging_product": "whatsapp", "to": to.removeprefix("+"),
              "type": "text", "text": {"body": brand(text)}},
        timeout=15,
    )


app = FastAPI(title="Protecta Bode WhatsApp bot")


@app.get("/webhook")
def verify(request: Request) -> str:
    """Cloud API webhook verification handshake."""
    params = request.query_params
    if params.get("hub.verify_token") == VERIFY_TOKEN:
        return params.get("hub.challenge", "")
    return "forbidden"


@app.post("/webhook")
async def webhook(request: Request) -> dict:
    payload = await request.json()
    try:
        change = payload["entry"][0]["changes"][0]["value"]
        msg = change["messages"][0]
        sender = "+" + msg["from"]
        text = (msg.get("text", {}) or {}).get("body", "").strip()
    except (KeyError, IndexError):
        return {"ok": True}
    send_text(sender, handle(sender, text))
    return {"ok": True}


def handle(phone: str, text: str) -> str:
    t = text.lower().strip()
    if t in ("menu", "hi", "hello", ""):
        return MENU
    if t == "1":
        return ("Buy cover\n"
                "What's your car's value in UGX? (e.g. 25,000,000)")
    if t.startswith("2"):
        return ("Renew\n"
                "Reply with your number plate (e.g. UAA 123A) and we'll pull up your policy.")
    if t == "4":
        return ("Claim\n"
                "Tell us what happened, when and where. You can also attach photos of the damage.")
    if t == "6":
        api("POST", "/support/tickets",
            {"phone": phone, "subject": "WhatsApp request", "channel": "whatsapp"})
        return ("Support\n"
                "We've opened a ticket. A member of the team will reply here shortly.")
    # Free text: try to parse a car value for the buy flow
    digits = "".join(ch for ch in text if ch.isdigit())
    if digits and t not in ("3", "5", "7"):
        value = int(digits)
        if value < 1_000_000 and digits.isdigit():
            value *= 1_000_000 if value <= 300 else 1
        r = api("POST", "/quotes/internal", {"vehicle": {
            "plate": "PENDING", "make": "TBD", "model": "TBD", "year": 2015, "value": value}})
        if "premium" in r:
            ref = r["reference"]
            return (f"Your quote\n"
                    f"UGX {r['premium']:,}/year (1.5% of UGX {value:,})\n"
                    f"Covers: car body, third party, driver. [Quote {ref}]\n"
                    f"1 Pay now  2 Send me the link")
        return f"Sorry, we couldn't price that value. Range is UGX 1,000,000 to 300,000,000."
    if t == "3":
        return "My policy\nReply with your number plate and we'll send your policy status and documents."
    return MENU
