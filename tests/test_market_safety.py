"""Report storage, privacy, moderation access and abuse limits on an isolated DB."""
import os
import tempfile
import unittest

_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_db.close()
os.environ["DATABASE_URL"] = "sqlite:///" + _db.name.replace("\\", "/")
os.environ["CLOUDINARY_CLOUD_NAME"] = "test-cloud"
os.environ["CLOUDINARY_API_KEY"] = "test-key"
os.environ["CLOUDINARY_API_SECRET"] = "test-secret"

from fastapi.testclient import TestClient
import main
from models import Accommodation, Landlord, MarketAdvert, MarketListingReport


class MarketSafetyTest(unittest.TestCase):
    def setUp(self):
        main._admin_pin_failures.clear()
        with main.SessionLocal() as db:
            db.query(MarketListingReport).delete()
            owner = Landlord(full_name="Provider", phone="0791112233", email=f"{id(self)}@example.test", password_hash="unused", active=True, created_at="2026-11-01")
            db.add(owner); db.flush()
            room = Accommodation(landlord_id=owner.id, title="Room <&>", campus="Town", area="Centre", description="Room", is_available=True, is_approved=True, created_at="2026-11-01")
            pending = Accommodation(landlord_id=owner.id, title="Private room", campus="Town", area="Centre", description="Room", is_available=True, is_approved=False, created_at="2026-11-01")
            advert = MarketAdvert(owner_landlord_id=owner.id, headline="Tutor", business_name="Tutor", category="Tutoring", description="Lessons", status="approved", placement="feed", created_at="2026-11-01", updated_at="2026-11-01")
            db.add_all([room, pending, advert]); db.commit()
            self.room, self.pending, self.offer = room.id, pending.id, advert.id
        self.client = TestClient(main.app)
        self.admin = {"X-Lecturer-Pin": main.LECTURER_PIN}

    def report(self, **changes):
        return self.client.post("/marketing/reports", json={"kind":"room", "listing_id":self.room, "reason":"outdated", "details":"Old price <script>alert(1)</script>", **changes})

    def test_guest_report_is_durable_private_and_deduplicated(self):
        response = self.report()
        self.assertEqual(response.status_code, 201)
        reference = response.json()["reference"]
        self.assertEqual(self.report().json()["reference"], reference)
        self.assertEqual(self.client.get("/admin/market-reports").status_code, 401)
        rows = self.client.get("/admin/market-reports", headers=self.admin).json()
        self.assertIn("no-store", self.client.get("/admin/market-reports", headers=self.admin).headers["cache-control"])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["listing_title"], "Room <&>")
        self.assertNotIn("reporter_key", rows[0])
        with main.SessionLocal() as db:
            stored = db.get(MarketListingReport, reference)
            self.assertEqual(len(stored.reporter_key), 64)
            self.assertEqual(stored.status, "open")
            self.assertTrue(db.get(Accommodation, self.room).is_approved)

    def test_review_requires_admin_and_does_not_change_listing(self):
        reference = self.report(kind="offer", listing_id=self.offer).json()["reference"]
        path = f"/admin/market-reports/{reference}"
        self.assertEqual(self.client.patch(path, json={"status":"resolved"}).status_code, 401)
        self.assertEqual(self.client.patch(path, json={"status":"resolved"}, headers=self.admin).status_code, 200)
        self.assertEqual(self.client.get("/admin/market-reports", headers=self.admin).json(), [])
        self.assertIsNotNone(self.client.get("/admin/market-reports?status=resolved", headers=self.admin).json()[0]["reviewed_at"])
        with main.SessionLocal() as db:
            self.assertEqual(db.get(MarketAdvert, self.offer).status, "approved")
        self.assertEqual(self.client.patch(path, json={"status":"open"}, headers=self.admin).status_code, 200)

    def test_invalid_reports_are_rejected(self):
        for changes, code in [({"kind":"unknown"},422), ({"reason":"spam"},422), ({"listing_id":0},422), ({"details":"x"*2001},422), ({"listing_id":self.pending},404), ({"listing_id":999999},404)]:
            self.assertEqual(self.report(**changes).status_code, code)
        with main.SessionLocal() as db:
            db.get(Accommodation, self.room).title = "DEMO: sample"
            db.commit()
        self.assertEqual(self.report().status_code, 400)

    def test_admin_can_pause_and_restore_a_reported_offer_without_losing_report(self):
        reference = self.report(kind="offer", listing_id=self.offer).json()["reference"]
        path = f"/admin/market-adverts/{self.offer}"
        self.assertEqual(self.client.put(path, json={"status":"paused"}, headers=self.admin).status_code, 200)
        self.assertNotIn(self.offer, [row["id"] for row in self.client.get("/marketing/adverts").json()])
        self.assertEqual(self.client.get(f"/listing/offer/{self.offer}").status_code, 404)
        with main.SessionLocal() as db:
            self.assertEqual(db.get(MarketListingReport, reference).listing_title, "Tutor")
        self.assertEqual(self.client.put(path, json={"status":"approved"}, headers=self.admin).status_code, 200)
        self.assertEqual(self.client.get(f"/listing/offer/{self.offer}").status_code, 200)

    def test_database_backed_rate_limit(self):
        for listing_id in range(1000, 1010):
            with main.SessionLocal() as db:
                # Obtain the same hashed identifier used by the guest request.
                if listing_id == 1000:
                    key = self.report().json()["reference"]
                    reporter_key = db.get(MarketListingReport, key).reporter_key
                    db.query(MarketListingReport).delete()
                db.add(MarketListingReport(kind="offer", listing_id=listing_id, listing_title="Test", reason="outdated", reporter_key=reporter_key, status="open", created_at=main.datetime.now(main.timezone.utc).isoformat()))
                db.commit()
        response = self.report(reason="suspicious")
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.headers["retry-after"], "3600")

    def test_public_page_explains_contact_and_verification_and_has_report(self):
        response = self.client.get(f"/listing/room/{self.room}")
        self.assertEqual(response.status_code, 200)
        self.assertIn(f'data-report-listing="room-{self.room}"', response.text)
        self.assertIn('data-report-title="Room &lt;&amp;&gt;"', response.text)
        self.assertIn("not independently verified", response.text)
        self.assertIn("approval is not a property inspection", response.text)
        self.assertIn("In-app messages are linked to your account", response.text)


if __name__ == "__main__":
    unittest.main()
