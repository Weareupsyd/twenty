"""FastAPI application: routers, startup, health."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from app.api import (auth, claims, integrations, internal, kyc, payments, policies,
                     quotes, reports, partner, support, users)
from app.config import get_settings
from app.db import Base, engine
from app import seed

settings = get_settings()

app = FastAPI(
    title="Protecta Bode API",
    version="0.1.0",
    description="Insurance platform API: quotes, policies, payments, claims, "
                "commissions, partner integrations. Underwritten by Liberty General Insurance Uganda.",
    docs_url="/docs",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.public_base_url, "http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (auth.router, quotes.router, payments.router, policies.router,
               claims.router, kyc.router, partner.router, reports.router, support.router,
               integrations.router, users.router, internal.router):
    app.include_router(router, prefix="/api/v1")


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(engine)
    # `create_all` does not add columns to existing installs. Keep the first
    # helpdesk rollout safe for databases created before ticket descriptions existed.
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    if "support_tickets" in tables:
        columns = {column["name"] for column in inspector.get_columns("support_tickets")}
        if "description" not in columns:
            with engine.begin() as connection:
                connection.execute(text(
                    "ALTER TABLE support_tickets ADD COLUMN description TEXT NOT NULL DEFAULT ''"
                ))
    if "quotes" in tables:
        columns = {column["name"] for column in inspector.get_columns("quotes")}
        if "partner_id" not in columns:
            with engine.begin() as connection:
                connection.execute(text(
                    "ALTER TABLE quotes ADD COLUMN partner_id INTEGER REFERENCES partners(id)"
                ))
    if "otp_codes" in tables:
        columns = {column["name"] for column in inspector.get_columns("otp_codes")}
        with engine.begin() as connection:
            if "email" not in columns:
                connection.execute(text("ALTER TABLE otp_codes ADD COLUMN email VARCHAR(160)"))
            if "attempts" not in columns:
                connection.execute(text(
                    "ALTER TABLE otp_codes ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0"
                ))
    if "users" in tables:
        columns = {column["name"] for column in inspector.get_columns("users")}
        if "kyc_session_id" not in columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE users ADD COLUMN kyc_session_id VARCHAR(128)"))
    seed.run()


@app.get("/health", tags=["ops"])
def health() -> dict:
    return {"status": "ok", "env": settings.app_env, "service": "protecta-api"}
