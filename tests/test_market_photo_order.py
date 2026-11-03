"""Photo order survives storage for new and edited room and advert listings."""
import json
import os
import tempfile
import unittest
from unittest.mock import patch

_database = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_database.close()
os.environ["DATABASE_URL"] = "sqlite:///" + _database.name.replace("\\", "/")
os.environ["CLOUDINARY_CLOUD_NAME"] = "test-cloud"
os.environ["CLOUDINARY_API_KEY"] = "test-key"
os.environ["CLOUDINARY_API_SECRET"] = "test-secret"

from fastapi.testclient import TestClient
import main
from models import Accommodation, Landlord, MarketAdvert


class MarketPhotoOrderTest(unittest.TestCase):
    def setUp(self):
        with main.SessionLocal() as db:
            owner = Landlord(full_name="Test Provider", email=f"{id(self)}@example.test", phone="0791112233", password_hash="unused", active=True, created_at="2026-11-03")
            db.add(owner); db.commit(); self.owner = owner.id
        self.client = TestClient(main.app)
        self.headers = {"X-Landlord-Token": main._issue_landlord_token(self.owner)}
        self.upload = self.enterContext(patch.object(main, "upload_image_bytes", side_effect=lambda data, **kw: f"https://images.example.test/{data.decode()}.jpg"))
        self.enterContext(patch.object(main, "queue_room_email"))
        self.enterContext(patch.object(main, "deliver_room_emails"))

    def form(self, kind):
        shared = {"description":"Description", "contact":"0791112233", "campus":"Village", "area":"Centre"}
        return {**shared, **({"title":"Room", "monthly_rent":"1500"} if kind == "room" else {"headline":"Item", "business_name":"Shop", "category":"Sales & retail", "placement":"feed"})}

    def path(self, kind):
        return "/marketing/listings" if kind == "room" else "/marketing/adverts"

    def create(self, kind, order=None, names=("one", "two", "three")):
        data = self.form(kind)
        if order is not None: data["image_order"] = json.dumps(order)
        return self.client.post(self.path(kind), headers=self.headers, data=data, files=[("images",(f"{name}.jpg",name.encode(),"image/jpeg")) for name in names])

    def public(self, kind, item_id):
        if kind == "room":
            with main.SessionLocal() as db:
                db.get(Accommodation,item_id).is_approved = True; db.commit()
        return next(item for item in self.client.get(self.path(kind)).json() if item["id"] == item_id)

    def test_create_order_sets_thumbnail_and_public_gallery_for_both_listing_types(self):
        for kind in ("room", "advert"):
            response = self.create(kind,[2,0,1]); self.assertEqual(response.status_code,200,response.text)
            item = response.json()["listing" if kind == "room" else "advert"]
            expected = [f"https://images.example.test/{name}.jpg" for name in ("three","one","two")]
            self.assertEqual(item["image_urls"],expected); self.assertEqual(item["image_url"],expected[0])
            self.assertEqual(self.public(kind,item["id"])["image_urls"],expected)

    def test_new_upload_can_become_thumbnail_ahead_of_retained_photos(self):
        for kind in ("room", "advert"):
            created = self.create(kind,names=("one","two")).json()["listing" if kind == "room" else "advert"]
            response = self.client.put(f'{self.path(kind)}/{created["id"]}', headers=self.headers,
                data={**self.form(kind),"retained_image_urls":json.dumps(created["image_urls"]),"image_order":"[2,1,0]"}, files=[("images",("new.jpg",b"new","image/jpeg"))])
            self.assertEqual(response.status_code,200,response.text)
            result = self.public(kind,created["id"])
            self.assertEqual(result["image_urls"],["https://images.example.test/new.jpg","https://images.example.test/two.jpg","https://images.example.test/one.jpg"])
            self.assertEqual(result["image_url"],"https://images.example.test/new.jpg")

    def test_existing_photos_can_be_reordered_without_uploading_again(self):
        for kind in ("room", "advert"):
            created = self.create(kind,names=("one","two")).json()["listing" if kind == "room" else "advert"]
            self.upload.reset_mock()
            response = self.client.put(f'{self.path(kind)}/{created["id"]}',headers=self.headers,data={**self.form(kind),"retained_image_urls":json.dumps(created["image_urls"]),"image_order":"[1,0]"})
            self.assertEqual(response.status_code,200,response.text); self.upload.assert_not_called()
            self.assertEqual(self.public(kind,created["id"])["image_urls"],list(reversed(created["image_urls"])))

    def test_invalid_permutations_are_rejected_before_uploading(self):
        for kind in ("room", "advert"):
            for order in ([],[0,0],[0,2],[-1,1],[True,1],["0",1],{"0":0}):
                self.upload.reset_mock()
                response = self.create(kind,order,names=("one","two"))
                self.assertEqual(response.status_code,400,(kind,order,response.text)); self.upload.assert_not_called()

    def test_clients_without_order_keep_the_original_upload_order(self):
        for kind in ("room", "advert"):
            response = self.create(kind)
            self.assertEqual(response.status_code,200,response.text)
            item = response.json()["listing" if kind == "room" else "advert"]
            self.assertEqual(item["image_urls"],[f"https://images.example.test/{name}.jpg" for name in ("one","two","three")])


if __name__ == "__main__":
    unittest.main()
