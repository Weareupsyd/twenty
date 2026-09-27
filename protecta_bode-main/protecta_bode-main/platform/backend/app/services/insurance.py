"""Core insurance flows shared by every channel (web, bot, agent, partner API)."""
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import (AppSetting, AuditLog, Commission, CommissionStatus, Payment,
                        PaymentStatus, Policy, PolicyStatus, Quote, QuoteChannel,
                        QuoteStatus, User, UserRole, Vehicle)
from app.security import new_opaque_id, new_policy_no, new_reference


class BusinessRule(Exception):
    def __init__(self, code: str, detail: str):
        super().__init__(detail)
        self.code = code
        self.detail = detail


def _extras(db: Session) -> list[dict]:
    row = db.get(AppSetting, "pricing")
    return (row.value.get("extras") if row else []) or []


def premium_of(value: int, extras: list[dict] | None = None, rate: float | None = None) -> int:
    s = get_settings()
    r = rate if rate is not None else s.product_rate
    return round(value * r) + sum(int(e.get("amount", 0)) for e in (extras or []))


def create_quote(db: Session, *, vehicle: dict, channel: QuoteChannel,
                 created_by: int | None, customer: User | None = None,
                 partner_id: int | None = None) -> Quote:
    s = get_settings()
    value = int(vehicle["value"])
    if value < s.min_vehicle_value or value > s.max_vehicle_value:
        raise BusinessRule("VALUE_OUT_OF_RANGE",
                           f"Vehicle value must be between {s.min_vehicle_value:,} and {s.max_vehicle_value:,} UGX")
    extras = _extras(db)
    # Public share URLs use a non-sequential 15-digit ID, not a short typed prefix.
    reference = None
    for _ in range(8):
        candidate = new_opaque_id()
        if not db.query(Quote.id).filter(Quote.reference == candidate).first():
            reference = candidate
            break
    if reference is None:
        raise RuntimeError("Could not allocate a unique quote identifier")
    quote = Quote(
        reference=reference,
        customer_id=customer.id if customer else None,
        vehicle_json=vehicle,
        product_code=s.product_code,
        rate=s.product_rate,
        value=value,
        extras=extras,
        premium=premium_of(value, extras, s.product_rate),
        channel=channel,
        created_by=created_by,
        partner_id=partner_id,
        status=QuoteStatus.shared,
        expires_at=datetime.now(timezone.utc) + timedelta(days=14),
    )
    db.add(quote)
    db.flush()
    db.add(AuditLog(actor="system:service", action="quote_created",
                    entity="quote", entity_id=quote.reference, channel=channel.value,
                    detail={"value": value, "premium": quote.premium}))
    db.commit()
    return quote


def initiate_payment(db: Session, quote: Quote, *, provider: str, payer_phone: str | None,
                     commit: bool = True) -> Payment:
    if quote.status == QuoteStatus.converted:
        raise BusinessRule("QUOTE_ALREADY_CONVERTED", "This quote is already paid")
    expires = quote.expires_at
    if expires and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)   # SQLite returns naive datetimes
    if expires and expires < datetime.now(timezone.utc):
        raise BusinessRule("QUOTE_EXPIRED", "This quote has expired; request a new one")
    payment = Payment(
        reference=new_reference("PM"),
        quote_id=quote.id,
        provider=provider,
        payer_phone=payer_phone,
        amount=quote.premium,
        status=PaymentStatus.initiated,
    )
    if provider == "bank":
        # Virtual reference: customer uses the payment reference as the bank narrative
        payment.provider_ref = payment.reference
        payment.status = PaymentStatus.pending
    else:
        # Mobile money: the provider prompt is triggered by the PSP integration;
        # provider_ref arrives on the callback/webhook.
        payment.status = PaymentStatus.pending
    db.add(payment)
    db.flush()
    db.add(AuditLog(actor="system:service", action="payment_initiated",
                    entity="payment", entity_id=payment.reference, channel=quote.channel.value,
                    detail={"provider": provider, "amount": payment.amount}))
    if commit:
        db.commit()
    return payment


def confirm_payment(db: Session, payment: Payment, *, provider_ref: str,
                    actor: str = "provider") -> Policy:
    """Mark a payment confirmed and issue the policy (idempotent)."""
    if payment.status == PaymentStatus.confirmed and payment.policy_id:
        return db.get(Policy, payment.policy_id)
    quote = db.get(Quote, payment.quote_id)
    if not quote.customer_id:
        raise BusinessRule("CUSTOMER_REQUIRED",
                           "The policyholder must be signed in before payment is confirmed")
    payment.status = PaymentStatus.confirmed
    payment.provider_ref = provider_ref

    policy = db.get(Policy, payment.policy_id) if payment.policy_id else None
    if not policy:
        start = datetime.now(timezone.utc).date()
        policy = Policy(
            policy_no=new_policy_no(),
            quote_id=quote.id,
            policyholder_id=quote.customer_id,
            vehicle_id=quote.vehicle_id,
            period_start=start,
            period_end=start + timedelta(days=365),
            premium=quote.premium,
            status=PolicyStatus.active,
            issued_at=datetime.now(timezone.utc),
        )
        db.add(policy)
        db.flush()
        payment.policy_id = policy.id
        quote.status = QuoteStatus.converted
        _accrue_commission(db, quote, policy)
    db.add(AuditLog(actor=f"provider:{actor}", action="payment_confirmed",
                    entity="policy", entity_id=policy.policy_no, channel=quote.channel.value,
                    detail={"amount": payment.amount, "provider_ref": provider_ref}))
    db.commit()
    return policy


def _accrue_commission(db: Session, quote: Quote, policy: Policy) -> None:
    s = get_settings()
    if not quote.created_by:
        return
    agent = db.get(User, quote.created_by)
    if not agent or agent.role not in (UserRole.agent, UserRole.broker):
        return
    rate = agent.commission_rate if hasattr(agent, "commission_rate") else s.commission_rate_default
    db.add(Commission(
        beneficiary_id=agent.id,
        policy_id=policy.id,
        rate=rate,
        amount=round(policy.premium * rate),
        status=CommissionStatus.accrued,
        statement_month=policy.issued_at.strftime("%Y-%m"),
        created_at=policy.issued_at,
    ))
