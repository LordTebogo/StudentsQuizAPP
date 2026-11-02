"""Public-site hardening: docs exposure, headers, crawler files and abuse limits."""
import json
import os
import re
import tempfile
import unittest
import http.client
import logging
import socket
import threading
import time
import uvicorn

from fastapi.testclient import TestClient

_database_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_database_file.close()
os.environ["DATABASE_URL"] = "sqlite:///" + _database_file.name.replace("\\", "/")
os.environ.pop("ENABLE_API_DOCS", None)

import main  # noqa: E402
from models import Landlord, MarketAdvert  # noqa: E402

HTML = {"Accept": "text/html,application/xhtml+xml"}


class SiteHardeningTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with main.SessionLocal() as db:
            landlord = Landlord(full_name="Shop Owner", email="owner@example.test", phone="0820000000", password_hash="unused", active=True, created_at="2026-10-01T00:00:00Z")
            db.add(landlord); db.flush()
            advert = MarketAdvert(owner_landlord_id=landlord.id, business_name="Campus Tutor", headline="Maths <tutoring>", description="Weekly sessions", category="Tutoring", price=150, status="approved", placement="feed", created_at="2026-10-01T00:00:00Z", updated_at="2026-10-05T09:00:00Z")
            db.add(advert); db.commit()
            cls.advert_id = advert.id
        cls.client = TestClient(main.app)

    def setUp(self):
        main._admin_pin_failures.clear()
        main._advert_clicks_seen.clear()

    def test_api_docs_are_not_public_by_default(self):
        for path in ("/docs", "/redoc", "/openapi.json"):
            self.assertEqual(self.client.get(path).status_code, 404, path)

    def test_security_txt(self):
        response = self.client.get("/.well-known/security.txt")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Contact: ", response.text)
        self.assertRegex(response.text, r"Expires: \d{4}-\d{2}-\d{2}T")

    def test_missing_pages_are_html_for_browsers_and_json_for_api_clients(self):
        page = self.client.get("/no-such-page", headers=HTML)
        self.assertEqual(page.status_code, 404)
        self.assertIn("text/html", page.headers["content-type"])
        self.assertIn("Browse campus listings", page.text)
        api = self.client.get("/no-such-page", headers={"Accept": "application/json"})
        self.assertEqual(api.status_code, 404)
        self.assertEqual(api.json(), {"detail": "Not Found"})

    def test_private_pages_are_noindex(self):
        self.assertIn("noindex", self.client.get("/admin").headers.get("x-robots-tag", ""))
        self.assertNotIn("x-robots-tag", self.client.get("/").headers)

    def test_market_home_uses_strict_csp(self):
        home = self.client.get("/").headers["content-security-policy"]
        self.assertIn("script-src 'self';", home)
        self.assertNotIn("unsafe-inline' 'unsafe-eval", home)
        tools = self.client.get("/tools/pdf").headers["content-security-policy"]
        self.assertIn("'unsafe-eval'", tools)
        with open(os.path.join("static", "index.html"), encoding="utf-8") as handle:
            index = handle.read()
        for tag in re.findall(r"<script\b[^>]*>", index):
            self.assertTrue("src=" in tag or 'type="application/ld+json"' in tag, f"strict CSP would block {tag}")
        self.assertIsNone(re.search(r"\son[a-z]+=", index), "strict CSP blocks inline event handlers")

    def test_listing_location_is_allowed_only_for_same_origin(self):
        for path in ("/", "/market"):
            policy = self.client.get(path).headers["permissions-policy"]
            self.assertIn("geolocation=(self)", policy)
            self.assertNotIn("geolocation=*", policy)

    def test_static_cache_headers(self):
        versioned = self.client.get("/static/campus-home.js?v=5")
        self.assertIn("immutable", versioned.headers["cache-control"])
        plain = self.client.get("/static/style.css")
        self.assertIn("max-age=3600", plain.headers["cache-control"])
        self.assertEqual(self.client.get("/service-worker.js").headers["cache-control"], "no-store")

    def test_head_transport_keeps_content_length_without_server_errors(self):
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(main.app, host="127.0.0.1", port=port, http="httptools", loop="asyncio", lifespan="off", access_log=False, log_config=None))
        thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
        with self.assertNoLogs("uvicorn.error", level=logging.ERROR):
            try:
                thread.start()
                deadline = time.monotonic() + 5
                while not server.started and thread.is_alive() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(server.started)
                for path in ("/", "/static/ui.css?v=2", "/branding/logo"):
                    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                    try:
                        connection.request("HEAD", path)
                        response = connection.getresponse()
                        self.assertEqual(response.status, 200)
                        self.assertGreater(int(response.getheader("Content-Length")), 0)
                        self.assertEqual(response.read(), b"")
                    finally:
                        connection.close()
            finally:
                server.should_exit = True
                thread.join(timeout=5)
                sock.close()
                self.assertFalse(thread.is_alive())

    def test_logo_is_downscaled(self):
        response = self.client.get("/branding/logo", headers={"Accept": "image/avif,image/webp,*/*"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "image/webp")
        self.assertLess(len(response.content), 120_000)
        png = self.client.get("/branding/logo", headers={"Accept": "*/*"})
        self.assertEqual(png.headers["content-type"], "image/png")
        self.assertLess(len(png.content), os.path.getsize(main.LOGO_PATH))

    def test_verify_pin_is_rate_limited(self):
        for _ in range(main.ADMIN_MAX_FAILURES):
            self.assertEqual(self.client.post("/lecturer/verify-pin", json={"pin": "wrong"}).status_code, 401)
        self.assertEqual(self.client.post("/lecturer/verify-pin", json={"pin": main.LECTURER_PIN}).status_code, 429)
        self.assertEqual(self.client.get("/admin/accounts", headers={"X-Lecturer-Pin": main.LECTURER_PIN}).status_code, 429)

    def test_advert_clicks_are_counted_once_per_client(self):
        for _ in range(5):
            self.client.post(f"/marketing/adverts/{self.advert_id}/click")
        with main.SessionLocal() as db:
            self.assertEqual(db.get(MarketAdvert, self.advert_id).clicks, 1)

    def test_sitemap_lists_listing_with_lastmod_and_no_duplicate_market_page(self):
        body = self.client.get("/sitemap.xml").text
        self.assertNotIn("<loc>https://arounus.com/market</loc>", body)
        self.assertIn(f"<loc>https://arounus.com/listing/offer/{self.advert_id}</loc><lastmod>2026-10-05</lastmod>", body)

    def test_listing_page_has_safe_structured_data(self):
        page = self.client.get(f"/listing/offer/{self.advert_id}").text
        match = re.search(r'<script type="application/ld\+json">(.*?)</script>', page)
        self.assertIsNotNone(match)
        self.assertNotIn("<tutoring>", match.group(1))
        data = json.loads(match.group(1))
        self.assertEqual(data["name"], "Maths <tutoring>")
        self.assertEqual(data["offers"]["priceCurrency"], "ZAR")
        self.assertEqual(data["offers"]["price"], "150")


    def test_premium_plans_are_priced_in_order(self):
        plans = {plan["id"]: plan["amount_cents"] for plan in self.client.get("/billing/premium/plans").json()["plans"]}
        self.assertEqual(plans, {"monthly": 1500, "six_months": 15000, "annual": 40000})

if __name__ == "__main__":
    unittest.main()
