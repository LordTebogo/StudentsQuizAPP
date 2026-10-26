"""Create ten clearly labelled marketplace demo providers and sample listings.

Run once with the app's DATABASE_URL configured. The shared password is generated
locally and saved to demo_market_credentials.txt, which is ignored by Git.
Subsequent runs add missing demo records and refresh only their sample photos.
"""

import hashlib
import json
import secrets
from datetime import datetime, timezone
from pathlib import Path

from database import SessionLocal
from models import Accommodation, Landlord, MarketAdvert


ROOT = Path(__file__).resolve().parent
CREDENTIALS = ROOT / "demo_market_credentials.txt"
IMAGE_BASE = "/static/demo-market"
PHONE = "0000000000"  # Deliberately non-working: demo listings are not real offers.
PRODUCTS = [
    ("laptop", "Refurbished student laptop", 4200),
    ("textbooks", "University textbook bundle", 650),
    ("headphones", "Wireless study headphones", 480),
    ("mini-fridge", "Compact student mini fridge", 1450),
    ("bicycle", "Campus commuter bicycle", 1900),
    ("calculator", "Scientific calculator kit", 320),
    ("desk-lamp", "Adjustable desk lamp", 260),
    ("microwave", "Compact microwave oven", 1100),
    ("backpack", "Backpack and laptop sleeve", 390),
    ("bed-frame", "Single bed and bedding set", 1850),
]


def password_hash(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 210_000).hex()
    return f"{salt}${digest}"


def shared_password() -> str:
    if CREDENTIALS.exists():
        for line in CREDENTIALS.read_text(encoding="utf-8").splitlines():
            if line.startswith("Password: "):
                return line.removeprefix("Password: ")
        raise RuntimeError("The demo credentials file has no password")
    return secrets.token_urlsafe(18)


def seed() -> tuple[int, int, int]:
    now = datetime.now(timezone.utc).isoformat()
    counts = [0, 0, 0]
    with SessionLocal() as db:
        existing = db.query(Landlord).filter(Landlord.email == "demo.provider01@example.test").first()
        if existing and not CREDENTIALS.exists():
            raise RuntimeError("Demo accounts already exist, but the local credentials file is missing")
        password = shared_password()
        for index, (slug, product, price) in enumerate(PRODUCTS, 1):
            email = f"demo.provider{index:02d}@example.test"
            provider = db.query(Landlord).filter(Landlord.email == email).first()
            if provider is None:
                provider = Landlord(
                    full_name=f"Demo Provider {index:02d}",
                    business_name=f"Demo Campus Shop {index:02d}",
                    provider_type="other", email=email, phone=PHONE,
                    password_hash=password_hash(password), active=True, created_at=now,
                )
                db.add(provider)
                db.flush()
                counts[0] += 1

            room_title = f"DEMO: Student room example {index:02d}"
            room_images = [f"{IMAGE_BASE}/sample-room.jpg", f"{IMAGE_BASE}/sample-room-2.jpg"]
            room = db.query(Accommodation).filter(
                Accommodation.landlord_id == provider.id,
                Accommodation.title == room_title,
            ).first()
            if room is None:
                room = Accommodation(
                    landlord_id=provider.id, title=room_title,
                    campus="Demo Campus", area="Sample Area",
                    monthly_rent=2800 + index * 150, bedrooms="1 room",
                    description="Illustrative listing only. This room is not available to rent. The photo was generated for the demo.",
                    contact=PHONE,
                    is_available=True, is_approved=True, created_at=now,
                )
                db.add(room)
                counts[1] += 1
            room.image_url = room_images[0]
            room.image_urls = json.dumps(room_images)

            headline = f"DEMO: {product}"
            advert = db.query(MarketAdvert).filter(
                MarketAdvert.owner_landlord_id == provider.id,
                MarketAdvert.headline == headline,
            ).first()
            if advert is None:
                advert = MarketAdvert(
                    owner_landlord_id=provider.id,
                    business_name=provider.business_name, headline=headline,
                    description="Illustrative product listing only. This item is not for sale. The image was generated for the demo.",
                    category="Sales", price=price,
                    campus="Demo Campus", area="Sample Area", contact=PHONE,
                    placement="feed",
                    status="approved", is_featured=False,
                    created_at=now, updated_at=now,
                )
                db.add(advert)
                counts[2] += 1
            advert_images = [f"{IMAGE_BASE}/{slug}.jpg", f"{IMAGE_BASE}/{slug}-2.jpg"]
            advert.image_url = advert_images[0]
            advert.image_urls = json.dumps(advert_images)
        db.commit()

    if not CREDENTIALS.exists():
        CREDENTIALS.write_text(
            "Demo marketplace provider accounts\n"
            "Sign in via Sell or list on /market.\n"
            f"Password: {password}\n"
            + "\n".join(f"Email: demo.provider{i:02d}@example.test" for i in range(1, 11))
            + "\n", encoding="utf-8",
        )
    return tuple(counts)


if __name__ == "__main__":
    providers, rooms, adverts = seed()
    print(f"Created {providers} providers, {rooms} room listings, and {adverts} product adverts.")
    print(f"Credentials saved to {CREDENTIALS}")
