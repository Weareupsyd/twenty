"""Smoke tests: quote IDs, support, role-scoped reports and partner auth on SQLite."""
import json
import os
import re

os.environ["DATABASE_URL"] = "sqlite:///./test.db"
os.environ["APP_ENV"] = "sandbox"
os.environ["PAYMENT_WEBHOOK_SECRET"] = "smoke-test-payment-webhook-secret"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    # context manager runs startup (create_all + seed); one fresh DB for the run
    if os.path.exists("./test.db"):
        os.remove("./test.db")
    with TestClient(app) as c:
        yield c
    if os.path.exists("./test.db"):
        os.remove("./test.db")


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["service"] == "protecta-api"


def test_staff_password_login(client):
    response = client.post("/api/v1/auth/login-password", json={
        "phone": "+256000000000", "password": "change-me-admin",
    })
    assert response.status_code == 200, response.text
    assert response.json()["role"] == "admin"
    assert response.json()["access_token"]


def test_quote_pricing_is_1_5_percent(client):
    r = client.post("/api/v1/quotes", json={
        "vehicle": {"plate": "UAA 123A", "make": "Toyota", "model": "Premio",
                    "year": 2018, "value": 25_000_000}})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["premium"] == 375_000            # 1.5% of 25,000,000
    assert body["rate"] == 0.015
    assert re.fullmatch(r"\d{15}", body["reference"])
    assert body["share_url"].endswith(body["reference"])


def test_quote_rejects_out_of_range_value(client):
    r = client.post("/api/v1/quotes", json={
        "vehicle": {"plate": "UAA 123A", "make": "Toyota", "model": "Premio",
                    "year": 2018, "value": 500_000}})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "VALUE_OUT_OF_RANGE"


def test_public_quote_uses_random_numeric_id(client):
    r = client.post("/api/v1/quotes", json={
        "vehicle": {"plate": "UAB 456B", "make": "Honda", "model": "Fit",
                    "year": 2019, "value": 18_000_000}})
    assert r.status_code == 201, r.text
    assert re.fullmatch(r"\d{15}", r.json()["reference"])
    assert r.json()["reference"] in r.json()["share_url"]


def test_anonymous_quote_requires_customer_account_before_payment(client):
    quote = client.post("/api/v1/quotes", json={
        "vehicle": {"plate": "UAF 123F", "make": "Toyota", "model": "Vitz",
                    "year": 2018, "value": 20_000_000},
    })
    assert quote.status_code == 201, quote.text
    quote_id = quote.json()["reference"]
    assert quote.json()["customer_attached"] is False

    payment_body = {"quote_reference": quote_id, "method": "mtn_momo", "payer_phone": "+256772999876"}
    anonymous = client.post("/api/v1/payments", json=payment_body)
    assert anonymous.status_code == 401

    phone = "+256772999876"
    requested = client.post("/api/v1/auth/request-otp", json={
        "phone": phone, "email": "checkout@example.test",
    })
    account = client.post("/api/v1/auth/verify-otp", json={
        "phone": phone, "code": requested.json()["debug_code"], "full_name": "Checkout Customer",
        "password": "checkout-customer-pass-12",
    })
    headers = {"Authorization": f"Bearer {account.json()['access_token']}"}
    initiated = client.post("/api/v1/payments", headers=headers, json=payment_body)
    assert initiated.status_code == 200, initiated.text

    attached = client.get(f"/api/v1/quotes/{quote_id}")
    assert attached.status_code == 200, attached.text
    assert attached.json()["customer_attached"] is True


def test_payment_provider_webhook_checks_signature_and_issues_policy(client):
    from app.security import hmac_signature

    phone = "+256772999881"
    requested = client.post("/api/v1/auth/request-otp", json={"phone": phone})
    verified = client.post("/api/v1/auth/verify-otp", json={
        "phone": phone, "code": requested.json()["debug_code"], "full_name": "Webhook Customer",
        "password": "customer-webhook-pass-12",
    })
    headers = {"Authorization": f"Bearer {verified.json()['access_token']}"}
    quote = client.post("/api/v1/quotes", headers=headers, json={
        "vehicle": {"plate": "UAC 456C", "make": "Honda", "model": "Fit",
                    "year": 2019, "value": 18_000_000},
    })
    assert quote.status_code == 201, quote.text
    payment = client.post("/api/v1/payments", json={
        "quote_reference": quote.json()["reference"], "method": "mtn_momo",
    })
    assert payment.status_code == 200, payment.text

    raw = json.dumps({
        "payment_ref": payment.json()["payment_ref"], "provider_ref": "mtn-ref-1",
        "outcome": "success", "amount": payment.json()["amount"],
    }, separators=(",", ":")).encode()
    bad = client.post("/api/v1/payments/webhook/mtn_momo", content=raw,
                      headers={"Content-Type": "application/json", "X-PB-Signature": "sha256=bad"})
    assert bad.status_code == 401

    signature = hmac_signature("smoke-test-payment-webhook-secret", raw)
    confirmed = client.post("/api/v1/payments/webhook/mtn_momo", content=raw,
                            headers={"Content-Type": "application/json",
                                     "X-PB-Signature": f"sha256={signature}"})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "confirmed"
    assert confirmed.json()["policy_no"]
    duplicate = client.post("/api/v1/payments/webhook/mtn_momo", content=raw,
                            headers={"Content-Type": "application/json",
                                     "X-PB-Signature": f"sha256={signature}"})
    assert duplicate.status_code == 200, duplicate.text
    assert duplicate.json()["policy_no"] == confirmed.json()["policy_no"]


def test_first_customer_otp_binds_email_and_creates_account_after_verification(client):
    from app.db import SessionLocal
    from app.models import OtpCode, User

    phone = "+256772999880"
    requested = client.post("/api/v1/auth/request-otp", json={
        "phone": phone, "email": "  New.Customer@Example.Test  ",
    })
    assert requested.status_code == 200, requested.text
    assert requested.json()["delivery"] == "sandbox"
    db = SessionLocal()
    assert db.query(User).filter(User.phone == phone).first() is None
    otp = db.query(OtpCode).filter(OtpCode.phone == phone).one()
    assert otp.email == "new.customer@example.test"
    db.close()

    verified = client.post("/api/v1/auth/verify-otp", json={
        "phone": phone, "code": requested.json()["debug_code"], "full_name": "New Customer",
        "password": "new-customer-password-12",
    })
    assert verified.status_code == 200, verified.text
    profile = client.get("/api/v1/auth/me", headers={
        "Authorization": f"Bearer {verified.json()['access_token']}",
    })
    assert profile.json()["email"] == "new.customer@example.test"
    assert profile.json()["role"] == "customer"
    password_login = client.post("/api/v1/auth/login-password", json={
        "username": "new.customer@example.test", "password": "new-customer-password-12",
    })
    assert password_login.status_code == 200, password_login.text
    assert password_login.json()["role"] == "customer"


def test_otp_verification_requires_setting_a_password(client):
    phone = "+256772999877"
    requested = client.post("/api/v1/auth/request-otp", json={"phone": phone})
    code = requested.json()["debug_code"]

    passwordless = client.post("/api/v1/auth/verify-otp", json={
        "phone": phone, "code": code, "full_name": "Password Setup Customer",
    })
    assert passwordless.status_code == 422

    setup = client.post("/api/v1/auth/verify-otp", json={
        "phone": phone, "code": code, "full_name": "Password Setup Customer",
        "password": "password-setup-customer-12",
    })
    assert setup.status_code == 200, setup.text
    login = client.post("/api/v1/auth/login-password", json={
        "username": phone, "password": "password-setup-customer-12",
    })
    assert login.status_code == 200, login.text
    assert login.json()["role"] == "customer"


def test_production_otp_emails_code_without_returning_debug_secret(client, monkeypatch):
    from types import SimpleNamespace
    from app.api import auth

    sent = []
    monkeypatch.setattr(auth, "get_settings", lambda: SimpleNamespace(is_production=True))
    monkeypatch.setattr(auth, "send_email", lambda template, recipient, values: sent.append((template, recipient, values)))
    phone = "+256772999878"
    response = client.post("/api/v1/auth/request-otp", json={
        "phone": phone, "email": "production@example.test",
    })
    assert response.status_code == 200, response.text
    assert response.json()["delivery"] == "email"
    assert "debug_code" not in response.json()
    assert sent[0][0:2] == ("otp", "production@example.test")

    verified = client.post("/api/v1/auth/verify-otp", json={
        "phone": phone, "code": sent[0][2]["otp_code"], "full_name": "Production Customer",
        "password": "production-customer-12",
    })
    assert verified.status_code == 200, verified.text


def test_whatsapp_otp_sends_through_evolution_and_creates_platform_session(client, monkeypatch):
    from types import SimpleNamespace
    from app.api import auth
    from app.db import SessionLocal
    from app.models import User, UserRole
    from app.services import clients as service_clients

    settings = SimpleNamespace(
        is_production=True,
        evolution_api_url="https://evolution.example.test/",
        evolution_api_key="server-side-test-key",
        evolution_instance="protecta-instance",
    )
    monkeypatch.setattr(auth, "get_settings", lambda: settings)
    monkeypatch.setattr(service_clients, "get_settings", lambda: settings)
    calls = []

    class Response:
        def raise_for_status(self):
            pass

        @staticmethod
        def json():
            return {"key": {"id": "message-1"}}

    def fake_post(url, *, headers, json, timeout):
        calls.append({"url": url, "headers": headers, "body": json, "timeout": timeout})
        return Response()

    monkeypatch.setattr(service_clients.httpx, "post", fake_post)
    db = SessionLocal()
    user = User(full_name="WhatsApp Agent", phone="+256772999866", role=UserRole.agent)
    db.add(user)
    db.commit()
    db.close()

    requested = client.post("/api/v1/auth/request-whatsapp-otp", json={"phone": "0772 999 866"})
    assert requested.status_code == 200, requested.text
    assert requested.json()["sent"] is True
    assert "debug_code" not in requested.json()
    assert calls[0]["url"] == "https://evolution.example.test/message/sendText/protecta-instance"
    assert calls[0]["headers"]["apikey"] == "server-side-test-key"
    assert calls[0]["body"]["number"] == "256772999866"
    assert "sign-in code:" in calls[0]["body"]["text"]
    assert "10 minutes" in calls[0]["body"]["text"]
    code = re.search(r"sign-in code: (\d{6})", calls[0]["body"]["text"]).group(1)
    password_reset = client.post("/api/v1/auth/verify-otp", json={
        "phone": "+256772999866", "code": code,
        "full_name": "WhatsApp Agent", "password": "unrelated-reset-pass-12",
    })
    assert password_reset.status_code == 400

    verified = client.post("/api/v1/auth/verify-whatsapp-otp", json={
        "phone": "+256772999866", "code": code,
    })
    assert verified.status_code == 200, verified.text
    assert verified.json()["role"] == "agent"
    profile = client.get("/api/v1/auth/me", headers={
        "Authorization": f"Bearer {verified.json()['access_token']}",
    })
    assert profile.status_code == 200
    assert profile.json()["full_name"] == "WhatsApp Agent"
    replay = client.post("/api/v1/auth/verify-whatsapp-otp", json={
        "phone": "+256772999866", "code": code,
    })
    assert replay.status_code == 400


def test_whatsapp_otp_request_does_not_disclose_unknown_accounts(client, monkeypatch):
    from types import SimpleNamespace
    from app.api import auth

    monkeypatch.setattr(auth, "get_settings", lambda: SimpleNamespace(
        is_production=False,
        evolution_api_url="",
        evolution_api_key="",
        evolution_instance="",
    ))
    sent = []
    monkeypatch.setattr(auth, "send_evolution_whatsapp_text", lambda phone, text: sent.append((phone, text)))
    response = client.post("/api/v1/auth/request-whatsapp-otp", json={"phone": "0772 123 401"})
    assert response.status_code == 200, response.text
    assert response.json()["sent"] is True
    assert "debug_code" not in response.json()
    assert sent == []
    rejected = client.post("/api/v1/auth/verify-whatsapp-otp", json={
        "phone": "0772 123 401", "code": "123456",
    })
    assert rejected.status_code == 400


def test_whatsapp_otp_is_locked_after_five_incorrect_codes(client, monkeypatch):
    from types import SimpleNamespace
    from app.api import auth
    from app.db import SessionLocal
    from app.models import User

    monkeypatch.setattr(auth, "get_settings", lambda: SimpleNamespace(
        is_production=False,
        evolution_api_url="",
        evolution_api_key="",
        evolution_instance="",
    ))
    db = SessionLocal()
    db.add(User(full_name="OTP Lock Customer", phone="+256772999865"))
    db.commit()
    db.close()

    requested = client.post("/api/v1/auth/request-whatsapp-otp", json={"phone": "+256772999865"})
    assert requested.status_code == 200, requested.text
    correct_code = requested.json()["debug_code"]
    for _ in range(5):
        wrong = client.post("/api/v1/auth/verify-whatsapp-otp", json={
            "phone": "+256772999865", "code": "000000",
        })
        assert wrong.status_code == 400
    locked = client.post("/api/v1/auth/verify-whatsapp-otp", json={
        "phone": "+256772999865", "code": correct_code,
    })
    assert locked.status_code == 400


def test_kyc_client_uses_hosted_verification_initialize(monkeypatch):
    from types import SimpleNamespace
    from app.services import clients as service_clients

    calls = []
    monkeypatch.setattr(service_clients, "get_settings", lambda: SimpleNamespace(
        kyc_api_key="test-kyc-api-key", kyc_service_url="http://kyc-api:3001/",
    ))

    class Response:
        def raise_for_status(self):
            pass

        @staticmethod
        def json():
            return {
                "verification_id": "f42f6a20-1c51-4ace-9123-3c3b96a6d334",
                "verification_url": "https://protectabode.example/kyc/user-verification?session=secret",
            }

    def fake_post(url, *, headers, json, timeout):
        calls.append({"url": url, "headers": headers, "body": json, "timeout": timeout})
        return Response()

    monkeypatch.setattr(service_clients.httpx, "post", fake_post)
    result = service_clients.kyc_open_session(42)
    assert calls[0]["url"] == "http://kyc-api:3001/api/v2/verify/initialize"
    assert calls[0]["headers"]["X-API-Key"] == "test-kyc-api-key"
    assert calls[0]["body"]["user_id"] == "protecta-bode-user-42"
    assert result["id"] == "f42f6a20-1c51-4ace-9123-3c3b96a6d334"
    assert result["url"].startswith("https://protectabode.example/kyc/")


def test_kyc_session_generates_link_and_only_owner_can_check_it(client, monkeypatch):
    from app.services import clients as service_clients

    phone = "+256772999873"
    requested = client.post("/api/v1/auth/request-otp", json={
        "phone": phone, "email": "kyc-owner@example.test",
    })
    account = client.post("/api/v1/auth/verify-otp", json={
        "phone": phone, "code": requested.json()["debug_code"], "full_name": "KYC Link Owner",
        "password": "kyc-owner-password-12",
    })
    headers = {"Authorization": f"Bearer {account.json()['access_token']}"}

    monkeypatch.setattr(service_clients, "kyc_open_session", lambda user_id: {
        "id": "kyc-session-owner-1",
        "url": "https://verify.example.test/kyc/user-verification?session=secure-token",
    })
    opened = client.post("/api/v1/kyc/session", headers=headers)
    assert opened.status_code == 200, opened.text
    assert opened.json()["session_id"] == "kyc-session-owner-1"
    assert opened.json()["url"].startswith("https://verify.example.test/")

    monkeypatch.setattr(service_clients, "kyc_result", lambda session_id: {"status": "verified"})
    status_response = client.get("/api/v1/kyc/session/kyc-session-owner-1", headers=headers)
    assert status_response.status_code == 200, status_response.text
    profile = client.get("/api/v1/auth/me", headers=headers)
    assert profile.json()["kyc_status"] == "approved"

    other_phone = "+256772999872"
    other_otp = client.post("/api/v1/auth/request-otp", json={
        "phone": other_phone, "email": "other-kyc@example.test",
    }).json()["debug_code"]
    other = client.post("/api/v1/auth/verify-otp", json={
        "phone": other_phone, "code": other_otp, "full_name": "Other KYC User",
        "password": "other-kyc-password-12",
    })
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}
    hidden = client.get("/api/v1/kyc/session/kyc-session-owner-1", headers=other_headers)
    assert hidden.status_code == 404


def test_support_tickets_are_scoped_and_staff_can_resolve(client):
    phone = "+256772999887"
    sent = client.post("/api/v1/auth/request-otp", json={"phone": phone})
    code = sent.json()["debug_code"]
    login = client.post("/api/v1/auth/verify-otp", json={
        "phone": phone, "code": code, "full_name": "Support Customer",
        "password": "support-customer-pass-12",
    })
    customer_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    created = client.post("/api/v1/support/tickets", headers=customer_headers, json={
        "subject": "Question about my cover",
        "description": "Please help me understand the cover on my car.",
    })
    assert created.status_code == 201, created.text
    ticket = created.json()
    assert ticket["status"] == "open"
    assert ticket["description"] == "Please help me understand the cover on my car."

    mine = client.get("/api/v1/support/tickets/mine", headers=customer_headers)
    assert [row["reference"] for row in mine.json()] == [ticket["reference"]]

    staff_login = client.post("/api/v1/auth/login-password", json={
        "username": "+256000000000", "password": "change-me-admin",
    })
    staff_headers = {"Authorization": f"Bearer {staff_login.json()['access_token']}"}
    queue = client.get("/api/v1/support/tickets?status=open", headers=staff_headers)
    assert [row["reference"] for row in queue.json()] == [ticket["reference"]]

    resolved = client.post(f"/api/v1/support/tickets/{ticket['reference']}/status",
                           headers=staff_headers, json={"status": "resolved"})
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "resolved"


def test_broker_distribution_is_scoped_to_the_signed_in_broker(client):
    from app.db import SessionLocal
    from app.models import User, UserRole

    db = SessionLocal()
    broker = User(full_name="North Broker", phone="+256772999886", role=UserRole.broker)
    other_broker = User(full_name="South Broker", phone="+256772999885", role=UserRole.broker)
    db.add_all([broker, other_broker])
    db.flush()
    north_agent = User(full_name="North Agent", phone="+256772999884", role=UserRole.agent,
                       parent_broker_id=broker.id)
    south_agent = User(full_name="South Agent", phone="+256772999883", role=UserRole.agent,
                       parent_broker_id=other_broker.id)
    db.add_all([north_agent, south_agent])
    db.commit()
    broker_id, agent_id = broker.id, north_agent.id
    db.close()

    sent = client.post("/api/v1/auth/request-otp", json={"phone": "+256772999886"})
    login = client.post("/api/v1/auth/verify-otp", json={
        "phone": "+256772999886", "code": sent.json()["debug_code"],
        "password": "north-broker-password-12",
    })
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    response = client.get("/api/v1/reports/broker-tree", headers=headers)
    assert response.status_code == 200, response.text
    tree = response.json()["brokers"]
    assert [row["broker_id"] for row in tree] == [broker_id]
    assert [row["agent_id"] for row in tree[0]["agents"]] == [agent_id]


def test_admin_onboards_agents_and_registers_signed_partner_webhooks(client):
    from app.db import SessionLocal
    from app.models import Partner, WebhookDelivery
    from app.security import hmac_signature
    from app.services.webhooks import enqueue_partner_event

    login = client.post("/api/v1/auth/login-password", json={
        "phone": "+256000000000", "password": "change-me-admin",
    })
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    broker_response = client.post("/api/v1/users/onboard", headers=headers, json={
        "full_name": "Provisioned Broker", "phone": "07729998870", "email": "broker@example.test",
        "password": "broker-initial-password-12", "role": "broker", "licence_no": "BRK-TEST-01",
    })
    assert broker_response.status_code == 201, broker_response.text
    broker_id = broker_response.json()["id"]
    agent_response = client.post("/api/v1/users/onboard", headers=headers, json={
        "full_name": "Provisioned Agent", "phone": "07729998871", "email": "agent@example.test",
        "password": "agent-initial-password-12", "role": "agent", "licence_no": "AGT-TEST-01",
        "parent_broker_id": broker_id,
    })
    assert agent_response.status_code == 201, agent_response.text
    assert agent_response.json()["parent_broker_id"] == broker_id
    agent_login = client.post("/api/v1/auth/login-password", json={
        "username": agent_response.json()["phone"], "password": "agent-initial-password-12",
    })
    assert agent_login.status_code == 200, agent_login.text
    assert agent_login.json()["role"] == "agent"
    broker_login = client.post("/api/v1/auth/login-password", json={
        "username": broker_response.json()["phone"], "password": "broker-initial-password-12",
    })
    assert broker_login.status_code == 200, broker_login.text
    assert broker_login.json()["role"] == "broker"

    rejected_target = client.post("/api/v1/integrations/partners", headers=headers, json={
        "name": "Production callback", "environment": "production",
        "webhook_url": "http://127.0.0.1:18092/webhook",
    })
    assert rejected_target.status_code == 422
    created = client.post("/api/v1/integrations/partners", headers=headers, json={
        "name": "Test system", "environment": "sandbox",
        "webhook_url": "http://127.0.0.1:18092/webhook",
    })
    assert created.status_code == 201, created.text
    partner = created.json()
    assert partner["client_secret"] and partner["webhook_secret"]
    listed = client.get("/api/v1/integrations/partners", headers=headers).json()
    safe = next(row for row in listed if row["client_id"] == partner["client_id"])
    assert "client_secret" not in safe and "webhook_secret" not in safe

    db = SessionLocal()
    record = db.query(Partner).filter(Partner.client_id == partner["client_id"]).one()
    delivery_id = enqueue_partner_event(db, record.id, "quote.created", {"quote_id": "583104729165083"})
    delivery = db.query(WebhookDelivery).filter(WebhookDelivery.delivery_id == delivery_id).one()
    assert delivery.status == "pending"
    assert delivery.signature == hmac_signature(partner["webhook_secret"], delivery.payload.encode())
    assert json.loads(delivery.payload)["event"] == "quote.created"
    db.close()


def test_partner_token_flow(client):
    r = client.post("/api/v1/partner/auth/token",
                    json={"client_id": "sandbox-partner", "client_secret": "sandbox-secret"})
    assert r.status_code == 200
    token = r.json()["access_token"]
    r2 = client.post("/api/v1/partner/customers",
                     headers={"Authorization": f"Bearer {token}"},
                     json={"full_name": "Test Customer", "phone": "+256772999888"})
    assert r2.status_code == 201, r2.text
    customer_id = r2.json()["customer_id"]
    owned = client.get(f"/api/v1/partner/customers/{customer_id}",
                       headers={"Authorization": f"Bearer {token}"})
    assert owned.status_code == 200, owned.text
    quote = client.post("/api/v1/partner/quotes", headers={"Authorization": f"Bearer {token}"}, json={
        "customer_id": customer_id,
        "vehicle": {"plate": "UAD 789D", "make": "Toyota", "model": "Vitz",
                    "year": 2017, "value": 16_000_000},
    })
    assert quote.status_code == 201, quote.text
    quote_id = quote.json()["quote_id"]
    assert re.fullmatch(r"\d{15}", quote_id)

    from app.db import SessionLocal
    from app.models import KycStatus, Payment, Quote, User
    db = SessionLocal()
    db.get(User, customer_id).kyc_status = KycStatus.approved
    db.commit()
    db.close()

    bind_path = f"/api/v1/partner/quotes/{quote_id}/bind"
    bind_headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "bind-test-001"}
    bind_body = {"payment_method": "mtn_momo"}
    first_bind = client.post(bind_path, headers=bind_headers, json=bind_body)
    replay = client.post(bind_path, headers=bind_headers, json=bind_body)
    assert first_bind.status_code == 202, first_bind.text
    assert replay.status_code == 202, replay.text
    assert replay.json() == first_bind.json()
    conflict = client.post(bind_path, headers=bind_headers,
                           json={"payment_method": "airtel_money"})
    assert conflict.status_code == 409
    db = SessionLocal()
    payment_count = (db.query(Payment).join(Quote, Payment.quote_id == Quote.id)
                     .filter(Quote.reference == quote_id).count())
    db.close()
    assert payment_count == 1

    db = SessionLocal()
    outsider = User(full_name="Unlinked Customer", phone="+256772999879")
    db.add(outsider)
    db.commit()
    outsider_id = outsider.id
    db.close()
    hidden = client.get(f"/api/v1/partner/customers/{outsider_id}",
                        headers={"Authorization": f"Bearer {token}"})
    assert hidden.status_code == 404


def test_bind_requires_idempotency_key(client):
    token = client.post("/api/v1/partner/auth/token",
                        json={"client_id": "sandbox-partner", "client_secret": "sandbox-secret"}).json()["access_token"]
    r = client.post("/api/v1/partner/quotes/QB-XXXXXX/bind",
                    headers={"Authorization": f"Bearer {token}"}, json={})
    assert r.status_code == 400


def test_startup_adds_nullable_otp_email_without_losing_rows(tmp_path, monkeypatch):
    from sqlalchemy import create_engine, inspect, text
    from app import main
    from app.db import Base

    legacy_engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    Base.metadata.create_all(legacy_engine)
    with legacy_engine.begin() as connection:
        connection.execute(text("ALTER TABLE users DROP COLUMN kyc_session_id"))
        connection.execute(text("DROP TABLE otp_codes"))
        connection.execute(text("""
            CREATE TABLE otp_codes (
                id INTEGER PRIMARY KEY, phone VARCHAR(20) NOT NULL,
                code VARCHAR(6) NOT NULL, expires_at DATETIME NOT NULL,
                consumed BOOLEAN NOT NULL DEFAULT 0
            )
        """))
        connection.execute(text("""
            INSERT INTO otp_codes (phone, code, expires_at, consumed)
            VALUES ('+256700000001', '123456', '2030-01-01 00:00:00', 0)
        """))
    monkeypatch.setattr(main, "engine", legacy_engine)
    monkeypatch.setattr(main.seed, "run", lambda: None)

    main.on_startup()

    otp_columns = {column["name"] for column in inspect(legacy_engine).get_columns("otp_codes")}
    user_columns = {column["name"] for column in inspect(legacy_engine).get_columns("users")}
    assert "email" in otp_columns
    assert "attempts" in otp_columns
    assert "kyc_session_id" in user_columns
    with legacy_engine.connect() as connection:
        row = connection.execute(text("SELECT phone, email FROM otp_codes WHERE id = 1")).one()
    assert row.phone == "+256700000001"
    assert row.email is None
    legacy_engine.dispose()
