"""Protecta Bode API configuration (env-driven)."""
from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_env: str = "sandbox"                 # sandbox | production
    secret_key: str = "change-me-in-production"
    internal_api_key: str = "change-me-in-production"   # bot / services -> API
    payment_webhook_secret: str = ""               # HMAC key for PSP callbacks

    database_url: str = "postgresql+psycopg2://protecta:protecta@postgres:5432/protecta"
    redis_url: str = "redis://redis:6379/0"

    email_service_url: str = "http://email:8010"
    public_base_url: str = "https://protectabode.example"

    # Passwordless WhatsApp sign-in, sent by the backend through Evolution API.
    evolution_api_url: str = ""
    evolution_api_key: str = ""
    evolution_instance: str = ""

    # Vendored KYC stack (platform/kyc, rebranded Protecta Bode)
    kyc_service_url: str = "http://kyc-api:3001"
    kyc_api_key: str = ""
    kyc_public_url: str = ""

    # Product configuration (defaults; editable via app_settings table)
    product_code: str = "BODE-01"
    product_rate: float = 0.015
    min_vehicle_value: int = 1_000_000
    max_vehicle_value: int = 300_000_000
    commission_rate_default: float = 0.10
    cooling_period_days: int = 14

    admin_name: str = "Platform Admin"
    admin_phone: str = ""
    admin_email: str = ""
    admin_password: str = "change-me-admin"

    class Config:
        env_file = ".env"

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
