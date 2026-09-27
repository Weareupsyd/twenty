"""First-boot seed: admin user, product settings, sandbox partner."""
from app.config import get_settings
from app.db import SessionLocal
from app.models import AppSetting, Partner, User, UserRole
from app.security import hash_password


def run() -> None:
    s = get_settings()
    db = SessionLocal()
    try:
        if not db.query(User).filter(User.role == UserRole.admin).first():
            admin = User(full_name=s.admin_name, phone=s.admin_phone or "+256000000000",
                         email=s.admin_email or None, role=UserRole.admin,
                         password_hash=hash_password(s.admin_password), kyc_status="approved")
            db.add(admin)
            db.commit()
            print(f"[seed] admin created (phone={admin.phone}) - change the default password immediately")

        if not db.get(AppSetting, "pricing"):
            db.add(AppSetting(key="pricing", value={
                "product_code": s.product_code, "rate": s.product_rate,
                "extras": [], "min_value": s.min_vehicle_value, "max_value": s.max_vehicle_value,
            }))
        if not db.get(AppSetting, "commission"):
            db.add(AppSetting(key="commission", value={
                "default_rate": s.commission_rate_default, "cooling_period_days": s.cooling_period_days,
            }))
        if not db.query(Partner).first():
            db.add(Partner(name="Sandbox Partner", client_id="sandbox-partner",
                           client_secret_hash=hash_password("sandbox-secret"),
                           scopes=["customers:w", "quotes:w", "policies:r", "payments:w"],
                           environment="sandbox"))
        db.commit()
    finally:
        db.close()
