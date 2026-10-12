"""Focused server checks with a temporary database and mocked media service."""
import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

_database_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_database_file.close()
os.environ["DATABASE_URL"] = "sqlite:///" + _database_file.name.replace("\\", "/")
os.environ["CLOUDINARY_CLOUD_NAME"] = "test-cloud"
os.environ["CLOUDINARY_API_KEY"] = "test-key"
os.environ["CLOUDINARY_API_SECRET"] = "test-secret"

import main  # noqa: E402
import cloudinary_utils  # noqa: E402
from models import Accommodation, FunPost, Landlord, MarketAdvert, MediaUploadEvent, Student  # noqa: E402


class MarketFeaturesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with main.SessionLocal() as db:
            student = Student(student_number="TEST001", full_name="Test Learner", email="learner@example.test", password_hash="unused", approved=True, active=True, created_at="2026-10-01T00:00:00Z")
            landlord = Landlord(full_name="Test Provider", email="provider@example.test", phone="12345678", password_hash="unused", active=True, created_at="2026-10-01T00:00:00Z")
            db.add_all([student, landlord]); db.flush()
            cls.student_id = student.id
            cls.room_id = None
            room = Accommodation(landlord_id=landlord.id, title="Test room", campus="Test campus", area="Center", description="Room", is_available=True, created_at="2026-10-01T00:00:00Z")
            advert = MarketAdvert(owner_student_id=student.id, business_name="Test Shop", headline="Test product", description="Item", category="Sales", status="approved", placement="feed", premium_video_asset='{"public_id":"test/video","format":"mp4"}', video_url="https://example.test/free-480.mp4", created_at="2026-10-01T00:00:00Z", updated_at="2026-10-01T00:00:00Z")
            db.add_all([room, advert]); db.commit()
            cls.room_id, cls.advert_id = room.id, advert.id
        cls.client = TestClient(main.app)
        cls.token = main._issue_student_token(cls.student_id)

    def test_unique_views_and_rating_updates(self):
        path = f"/marketing/rooms/{self.room_id}/view"
        self.assertEqual(self.client.post(path).json()["views"], 1)
        self.assertEqual(self.client.post(path).json()["views"], 1)
        with TestClient(main.app) as other_browser:
            self.assertEqual(other_browser.post(path).json()["views"], 2)
        rating_path = f"/marketing/rooms/{self.room_id}/rating"
        headers = {"X-Student-Token": self.token}
        self.assertEqual(self.client.put(rating_path, json={"stars": 5}, headers=headers).json()["rating"], 5)
        changed = self.client.put(rating_path, json={"stars": 3}, headers=headers).json()
        self.assertEqual((changed["rating"], changed["rating_count"]), (3, 1))
        self.assertEqual(self.client.put(rating_path, json={"stars": 6}, headers=headers).status_code, 422)
        self.assertEqual(self.client.put(f"/marketing/adverts/{self.advert_id}/rating", json={"stars": 5}, headers=headers).status_code, 403)

    def test_premium_requires_admin_grant(self):
        path = f"/media/premium/advert/{self.advert_id}"
        headers = {"X-Student-Token": self.token}
        self.assertEqual(self.client.get(path, headers=headers).status_code, 403)
        grant = self.client.put(f"/admin/accounts/student/{self.student_id}", headers={"X-Lecturer-Pin":main.LECTURER_PIN}, json={"premium_video":True})
        self.assertEqual(grant.status_code, 200)
        self.assertTrue(grant.json()["premium_video"])
        with patch.object(main, "premium_video_url", return_value="https://example.test/signed-hd.mp4"):
            response = self.client.get(path, headers=headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["url"], "https://example.test/signed-hd.mp4")
        self.assertIn("no-store", response.headers["cache-control"])
        public = self.client.get("/marketing/adverts").json()[0]
        self.assertTrue(public["premium_available"])
        self.assertNotIn("premium_video_asset", public)

    def test_finance_comparison(self):
        headers = {"X-Lecturer-Pin": main.LECTURER_PIN}
        with patch.object(main.cloudinary.api, "usage", return_value={"credits":{"usage":2}}):
            income = self.client.post("/admin/media-finance", headers=headers, json={"month":"2026-10","kind":"income","category":"advert","amount_cents":10000})
            expense = self.client.post("/admin/media-finance", headers=headers, json={"month":"2026-10","kind":"expense","category":"hosting","amount_cents":3000})
            self.assertEqual((income.status_code, expense.status_code), (200, 200))
            data = self.client.get("/admin/media-finance?month=2026-10", headers=headers).json()
        self.assertEqual((data["income_cents"], data["expense_cents"], data["net_cents"]), (10000, 3000, 7000))

    def test_upload_creates_protected_hd_and_public_480p(self):
        private = {"public_id":"test/private", "format":"mp4", "height":1080}
        free = {"secure_url":"https://example.test/free-480.mp4"}
        with patch.object(cloudinary_utils.cloudinary.uploader, "upload", side_effect=[private, free]) as upload:
            public_url, protected = cloudinary_utils.upload_video_variants(b"video", "lesson_videos/test")
        self.assertEqual(public_url, free["secure_url"])
        self.assertEqual(protected, '{"public_id": "test/private", "format": "mp4"}')
        self.assertEqual(upload.call_args_list[0].kwargs["type"], "authenticated")
        self.assertEqual(upload.call_args_list[1].kwargs["transformation"]["height"], 480)
        with patch.object(cloudinary_utils.cloudinary.utils, "private_download_url", return_value="signed") as signed:
            self.assertEqual(cloudinary_utils.premium_video_url(protected), "signed")
        self.assertEqual(signed.call_args.kwargs["type"], "authenticated")

    def test_community_video_monthly_cap_prevents_upload(self):
        month = main.datetime.now(main.timezone.utc).strftime("%Y-%m")
        with main.SessionLocal() as db:
            for index in range(10):
                db.add(FunPost(author_student_id=self.student_id, content=f"Video {index}", video_url=f"https://example.test/{index}.mp4", created_at=f"{month}-01T00:00:00Z"))
            db.commit()
        with patch.object(main, "upload_video_variants") as uploader:
            response = self.client.post("/fun/posts", headers={"X-Student-Token":self.token}, data={"content":"another"}, files={"video":("clip.mp4", b"fake", "video/mp4")})
        self.assertEqual(response.status_code, 429)
        uploader.assert_not_called()
        with main.SessionLocal() as db:
            db.query(FunPost).filter_by(author_student_id=self.student_id).delete()
            for index in range(10):
                db.add(MediaUploadEvent(kind="community", owner_type="student", owner_id=self.student_id, source_bytes=100, premium_created=False, created_at=f"{month}-01T00:00:{index:02d}Z"))
            db.commit()
        with patch.object(main, "upload_video_variants") as uploader:
            response = self.client.post("/fun/posts", headers={"X-Student-Token":self.token}, data={"content":"another"}, files={"video":("clip.mp4", b"fake", "video/mp4")})
        self.assertEqual(response.status_code, 429)
        uploader.assert_not_called()


if __name__ == "__main__":
    unittest.main()
