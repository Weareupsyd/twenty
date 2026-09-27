"""Protecta Bode domain models (insurance-flavoured, per docs/REPORTS.md and the plan)."""
import enum
from datetime import date, datetime, timezone

from sqlalchemy import (JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer,
                        String, Text, UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


from sqlalchemy import Enum as SaEnum  # noqa: E402


def EnumName(enum_cls):
    """Store enums as their value string (readable rows, easy reports)."""
    return SaEnum(enum_cls, values_callable=lambda e: [m.value for m in e], native_enum=False, length=24)


class UserRole(str, enum.Enum):
    customer = "customer"
    agent = "agent"
    broker = "broker"
    underwriter = "underwriter"
    claims_handler = "claims_handler"
    admin = "admin"


class KycStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class QuoteStatus(str, enum.Enum):
    draft = "draft"
    shared = "shared"
    converted = "converted"
    expired = "expired"


class PolicyStatus(str, enum.Enum):
    pending_payment = "pending_payment"
    active = "active"
    lapsed = "lapsed"
    cancelled = "cancelled"
    expired = "expired"


class PaymentStatus(str, enum.Enum):
    initiated = "initiated"
    pending = "pending"
    confirmed = "confirmed"
    failed = "failed"


class PaymentProvider(str, enum.Enum):
    mtn_momo = "mtn_momo"
    airtel_money = "airtel_money"
    bank = "bank"
    cash_agent = "cash_agent"


class ClaimStatus(str, enum.Enum):
    reported = "reported"
    assigned = "assigned"
    assessed = "assessed"
    approved = "approved"
    rejected = "rejected"
    settled = "settled"


class QuoteChannel(str, enum.Enum):
    web = "web"
    whatsapp = "whatsapp"
    whatsapp_agent = "whatsapp_agent"
    agent = "agent"
    broker = "broker"
    partner_api = "partner_api"


class CommissionStatus(str, enum.Enum):
    accrued = "accrued"
    payable = "payable"
    paid = "paid"
    clawed_back = "clawed_back"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(16), unique=True, index=True)   # E.164 (+256...)
    email: Mapped[str | None] = mapped_column(String(160))
    nin: Mapped[str | None] = mapped_column(String(32))
    role: Mapped[UserRole] = mapped_column(EnumName(UserRole), default=UserRole.customer)
    kyc_status: Mapped[KycStatus] = mapped_column(EnumName(KycStatus), default=KycStatus.pending)
    kyc_session_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Agents / brokers
    licence_no: Mapped[str | None] = mapped_column(String(40))
    parent_broker_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    password_hash: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    vehicles: Mapped[list["Vehicle"]] = relationship(back_populates="owner", foreign_keys="Vehicle.owner_id")


class Vehicle(Base):
    __tablename__ = "vehicles"
    __table_args__ = (UniqueConstraint("plate", "owner_id", name="uq_plate_owner"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    plate: Mapped[str] = mapped_column(String(12), index=True)
    make: Mapped[str] = mapped_column(String(40))
    model: Mapped[str] = mapped_column(String(60))
    year: Mapped[int] = mapped_column(Integer)
    value: Mapped[int] = mapped_column(Integer)          # sum insured, UGX
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    owner: Mapped[User] = relationship(back_populates="vehicles", foreign_keys=[owner_id])


class Quote(Base):
    __tablename__ = "quotes"

    id: Mapped[int] = mapped_column(primary_key=True)
    reference: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    vehicle_id: Mapped[int | None] = mapped_column(ForeignKey("vehicles.id"))
    # Denormalised vehicle snapshot so quotes survive before vehicle capture
    vehicle_json: Mapped[dict] = mapped_column(JSON, default=dict)
    product_code: Mapped[str] = mapped_column(String(20), default="BODE-01")
    rate: Mapped[float] = mapped_column(Float, default=0.015)
    value: Mapped[int] = mapped_column(Integer)
    extras: Mapped[list] = mapped_column(JSON, default=list)
    premium: Mapped[int] = mapped_column(Integer)
    channel: Mapped[QuoteChannel] = mapped_column(EnumName(QuoteChannel), default=QuoteChannel.web)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))   # agent/broker attribution
    partner_id: Mapped[int | None] = mapped_column(ForeignKey("partners.id"), nullable=True)
    status: Mapped[QuoteStatus] = mapped_column(EnumName(QuoteStatus), default=QuoteStatus.draft)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Policy(Base):
    __tablename__ = "policies"

    id: Mapped[int] = mapped_column(primary_key=True)
    policy_no: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    quote_id: Mapped[int] = mapped_column(ForeignKey("quotes.id"))
    policyholder_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    vehicle_id: Mapped[int | None] = mapped_column(ForeignKey("vehicles.id"))
    period_start: Mapped[date]
    period_end: Mapped[date]
    premium: Mapped[int] = mapped_column(Integer)
    status: Mapped[PolicyStatus] = mapped_column(EnumName(PolicyStatus), default=PolicyStatus.pending_payment)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    reference: Mapped[str] = mapped_column(String(24), unique=True, index=True)
    quote_id: Mapped[int] = mapped_column(ForeignKey("quotes.id"))
    policy_id: Mapped[int | None] = mapped_column(ForeignKey("policies.id"), nullable=True)
    provider: Mapped[PaymentProvider] = mapped_column(EnumName(PaymentProvider))
    provider_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payer_phone: Mapped[str | None] = mapped_column(String(16))
    amount: Mapped[int] = mapped_column(Integer)
    status: Mapped[PaymentStatus] = mapped_column(EnumName(PaymentStatus), default=PaymentStatus.initiated)
    failure_reason: Mapped[str | None] = mapped_column(String(160), nullable=True)
    reconciled_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reconciled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Endorsement(Base):
    __tablename__ = "endorsements"

    id: Mapped[int] = mapped_column(primary_key=True)
    policy_id: Mapped[int] = mapped_column(ForeignKey("policies.id"))
    kind: Mapped[str] = mapped_column(String(40))          # plate_fix | value_update | ...
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Claim(Base):
    __tablename__ = "claims"

    id: Mapped[int] = mapped_column(primary_key=True)
    reference: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    policy_id: Mapped[int] = mapped_column(ForeignKey("policies.id"))
    reporter_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    incident_date: Mapped[date]
    description: Mapped[str] = mapped_column(Text)
    location: Mapped[str | None] = mapped_column(String(200))
    photos: Mapped[list] = mapped_column(JSON, default=list)   # document store keys
    status: Mapped[ClaimStatus] = mapped_column(EnumName(ClaimStatus), default=ClaimStatus.reported)
    adjuster_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reserve: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    policy: Mapped["Policy"] = relationship()


class Commission(Base):
    __tablename__ = "commissions"

    id: Mapped[int] = mapped_column(primary_key=True)
    beneficiary_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    policy_id: Mapped[int] = mapped_column(ForeignKey("policies.id"))
    rate: Mapped[float] = mapped_column(Float)
    amount: Mapped[int] = mapped_column(Integer)
    status: Mapped[CommissionStatus] = mapped_column(EnumName(CommissionStatus), default=CommissionStatus.accrued)
    statement_month: Mapped[str | None] = mapped_column(String(7), index=True)   # YYYY-MM
    payout_ref: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Partner(Base):
    """External broker / integrator credentials for the Partner API (docs/PARTNER_API.md)."""
    __tablename__ = "partners"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    client_id: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    client_secret_hash: Mapped[str] = mapped_column(String(128))
    scopes: Mapped[list] = mapped_column(JSON, default=list)
    environment: Mapped[str] = mapped_column(String(10), default="sandbox")
    commission_rate: Mapped[float] = mapped_column(Float, default=0.10)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    webhook_url: Mapped[str | None] = mapped_column(String(300), nullable=True)
    webhook_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PartnerCustomer(Base):
    """Customer records that an external partner is authorized to manage."""
    __tablename__ = "partner_customers"
    __table_args__ = (UniqueConstraint("partner_id", "customer_id", name="uq_partner_customer"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    partner_id: Mapped[int] = mapped_column(ForeignKey("partners.id"), index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PartnerIdempotencyRecord(Base):
    """Committed response for an idempotent partner operation."""
    __tablename__ = "partner_idempotency_records"
    __table_args__ = (UniqueConstraint("partner_id", "key", name="uq_partner_idempotency_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    partner_id: Mapped[int] = mapped_column(ForeignKey("partners.id"), index=True)
    key: Mapped[str] = mapped_column(String(128))
    operation: Mapped[str] = mapped_column(String(80))
    request_hash: Mapped[str] = mapped_column(String(64))
    response: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WebhookDelivery(Base):
    """Durable outbound webhook attempt for a configured integration partner."""
    __tablename__ = "webhook_deliveries"

    id: Mapped[int] = mapped_column(primary_key=True)
    delivery_id: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    partner_id: Mapped[int] = mapped_column(ForeignKey("partners.id"), index=True)
    event: Mapped[str] = mapped_column(String(80), index=True)
    target_url: Mapped[str] = mapped_column(String(300))
    payload: Mapped[str] = mapped_column(Text)
    signature: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class OtpCode(Base):
    __tablename__ = "otp_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    phone: Mapped[str] = mapped_column(String(16), index=True)
    code: Mapped[str] = mapped_column(String(6))
    purpose: Mapped[str] = mapped_column(String(20), default="login")
    email: Mapped[str | None] = mapped_column(String(160), nullable=True)
    consumed: Mapped[bool] = mapped_column(Boolean, default=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    actor: Mapped[str] = mapped_column(String(60), default="system")   # user role/partner/bot
    action: Mapped[str] = mapped_column(String(60), index=True)
    entity: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str | None] = mapped_column(String(40))
    channel: Mapped[str] = mapped_column(String(20), default="web")
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SupportTicket(Base):
    __tablename__ = "support_tickets"

    id: Mapped[int] = mapped_column(primary_key=True)
    reference: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    subject: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default="")
    channel: Mapped[str] = mapped_column(String(20), default="portal")
    status: Mapped[str] = mapped_column(String(20), default="open")   # open | pending | resolved
    priority: Mapped[str] = mapped_column(String(10), default="normal")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# Small helper: store enums as their name string (readable rows, easy reports)
from sqlalchemy import Enum as SaEnum  # noqa: E402


def EnumName(enum_cls):
    return SaEnum(enum_cls, values_callable=lambda e: [m.value for m in e], native_enum=False, length=24)
