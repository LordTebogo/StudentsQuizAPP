"""Availability ordering and shared-room status with a temporary database."""
import json
import os
import re
import tempfile
import unittest

_database = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_database.close()
os.environ["DATABASE_URL"] = "sqlite:///" + _database.name.replace("\\", "/")
os.environ["CLOUDINARY_CLOUD_NAME"] = "test-cloud"
os.environ["CLOUDINARY_API_KEY"] = "test-key"
os.environ["CLOUDINARY_API_SECRET"] = "test-secret"

from fastapi.testclient import TestClient
import main
from models import Accommodation, Landlord


class RoomAvailabilityTest(unittest.TestCase):
    def setUp(self):
        with main.SessionLocal() as db:
            owner = Landlord(full_name="Provider", email=f"{id(self)}@example.test", phone="0791112233", password_hash="unused", active=True, created_at="2026-01-01")
            db.add(owner); db.flush()
            self.owner_id = owner.id
            self.ids = {}
            for label, available, approved, created in [("Available", True, True, "2026-01-01"), ("Filled", False, True, "2026-11-03"), ("Unpublished", False, False, "2026-11-03")]:
                room = Accommodation(landlord_id=owner.id, title=label, campus="Campus", area="Centre", description="Room", contact="0791112233", monthly_rent=1500, is_available=available, is_approved=approved, created_at=created)
                db.add(room); db.flush()
                self.ids[label] = room.id
            db.commit()
        self.client = TestClient(main.app)

    def test_public_feed_includes_filled_after_available_and_excludes_unpublished(self):
        rooms = self.client.get("/marketing/listings").json()
        mine = [room for room in rooms if room["landlord"]["id"] == self.owner_id]
        self.assertEqual([room["id"] for room in mine], [self.ids["Available"], self.ids["Filled"]])
        self.assertEqual([room["is_available"] for room in mine], [True, False])

    def test_shared_room_pages_show_accurate_labels_and_structured_availability(self):
        for label, schema in [("Available", "InStock"), ("Filled", "OutOfStock")]:
            response = self.client.get(f"/listing/room/{self.ids[label]}")
            self.assertEqual(response.status_code, 200)
            self.assertIn(f'room-availability--{label.lower()}', response.text)
            self.assertIn(label, response.text)
            structured = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', response.text).group(1))
            self.assertEqual(structured["offers"]["availability"], f"https://schema.org/{schema}")
        self.assertEqual(self.client.get(f'/listing/room/{self.ids["Unpublished"]}').status_code, 404)

    def test_filled_room_view_is_supported_and_hidden_provider_stays_hidden(self):
        path = f'/marketing/rooms/{self.ids["Filled"]}/view'
        self.assertEqual(self.client.post(path).status_code, 200)
        with main.SessionLocal() as db:
            db.get(Landlord, self.owner_id).active = False
            db.commit()
        self.assertEqual(self.client.post(path).status_code, 404)
        self.assertEqual(self.client.get(f'/listing/room/{self.ids["Filled"]}').status_code, 404)

    def test_provider_can_change_a_room_between_filled_and_available(self):
        headers = {"X-Landlord-Token": main._issue_landlord_token(self.owner_id)}
        room_id = self.ids["Available"]
        for available, badge in [(False, "filled"), (True, "available")]:
            result = self.client.put(f"/marketing/listings/{room_id}", headers=headers, data={"title":"Room", "campus":"Campus", "area":"Centre", "description":"Room", "contact":"0791112233", "monthly_rent":"1500", "is_available":str(available).lower()})
            self.assertEqual(result.status_code, 200)
            public = next(room for room in self.client.get("/marketing/listings").json() if room["id"] == room_id)
            self.assertEqual(public["is_available"], available)
            self.assertIn(f"room-availability--{badge}", self.client.get(f"/listing/room/{room_id}").text)


if __name__ == "__main__":
    unittest.main()
