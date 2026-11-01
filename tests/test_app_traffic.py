"""Traffic integration tests use an isolated temporary database, never production."""
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient

_directory = tempfile.TemporaryDirectory()
os.environ["DATABASE_URL"] = "sqlite:///" + (_directory.name + "/traffic.db").replace("\\", "/")

import main
from app_traffic import COOKIE_NAME, create_traffic_router
from models import AppTrafficActivity

NOW = datetime(2026, 11, 1, 10, 30, tzinfo=timezone.utc)
ADMIN = {"X-Lecturer-Pin": main.LECTURER_PIN}


def tearDownModule():
    main.engine.dispose()
    _directory.cleanup()


class AppTrafficTest(unittest.TestCase):
    def setUp(self):
        with main.SessionLocal() as db:
            db.query(AppTrafficActivity).delete()
            db.commit()
        main._admin_pin_failures.clear()
        self.client = TestClient(main.app)

    def tearDown(self):
        self.client.close()

    def heartbeat(self, client=None, when=NOW, **kwargs):
        with patch("app_traffic.utc_now", return_value=when):
            response = (client or self.client).post("/traffic/heartbeat", **kwargs)
        self.assertEqual(response.status_code, 204, response.text)
        return response

    def report(self, when=NOW, client=None, query=""):
        with patch("app_traffic.utc_now", return_value=when):
            response = (client or self.client).get("/admin/traffic" + query, headers=ADMIN)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        return response.json()

    def test_browser_deduplication_new_browser_and_no_identity_leak(self):
        first = self.heartbeat()
        self.assertIn("HttpOnly", first.headers["set-cookie"])
        self.assertIn("SameSite=lax", first.headers["set-cookie"])
        self.assertEqual(first.headers["cache-control"], "no-store")
        self.heartbeat(when=NOW + timedelta(seconds=10))
        self.heartbeat(when=NOW + timedelta(minutes=1))
        with TestClient(main.app) as other:
            self.heartbeat(other)
        report = self.report(when=NOW + timedelta(minutes=1))
        self.assertEqual(report["summary"]["active_now"], 2)
        self.assertEqual(report["summary"]["today"], 2)
        self.assertEqual(report["summary"]["all_time"], 2)
        with main.SessionLocal() as db:
            self.assertEqual(db.query(AppTrafficActivity).count(), 2)
            row = db.query(AppTrafficActivity).first()
            self.assertNotIn(row.visitor_hash, str(report))
            self.assertNotIn(self.client.cookies.get(COOKIE_NAME).split(".")[0], row.visitor_hash)

    def test_active_expiry_and_past_hour_are_rolling(self):
        self.heartbeat()
        self.assertEqual(self.report(NOW + timedelta(seconds=121))["summary"]["active_now"], 0)
        self.assertEqual(self.report(NOW + timedelta(minutes=59))["summary"]["past_hour"], 1)
        later = self.report(NOW + timedelta(minutes=61))["summary"]
        self.assertEqual(later["past_hour"], 0)
        self.assertEqual(later["today"], 1)
        self.assertEqual(later["all_time"], 1)

    def test_hour_and_day_history_deduplicate_returning_browsers(self):
        self.heartbeat(when=NOW - timedelta(days=2))
        self.heartbeat(when=NOW - timedelta(hours=1))
        self.heartbeat()
        with TestClient(main.app) as other:
            self.heartbeat(other, when=NOW - timedelta(hours=1))
        data = self.report()
        self.assertEqual(data["summary"]["all_time"], 2)
        self.assertEqual(data["summary"]["selected_period"], 2)
        self.assertEqual(data["daily"][-1], {"date": "2026-11-01", "visitors": 2})
        self.assertEqual(data["daily"][-2]["visitors"], 0)
        self.assertEqual(data["daily"][-3]["visitors"], 1)
        self.assertEqual([row["visitors"] for row in data["hourly"][-2:]], [2, 1])
        self.assertEqual(len(data["hourly"]), 24)

    def test_south_africa_midnight_and_continuing_session(self):
        before = datetime(2026, 10, 31, 21, 59, tzinfo=timezone.utc)
        after = before + timedelta(minutes=2)
        self.heartbeat(when=before)
        self.heartbeat(when=after)
        data = self.report(after)
        self.assertEqual(data["daily"][-2:], [{"date": "2026-10-31", "visitors": 1}, {"date": "2026-11-01", "visitors": 1}])
        self.assertEqual(data["summary"]["all_time"], 1)
        self.assertEqual(data["hourly"][-1]["hour"], "2026-11-01T00:00:00+02:00")

    def test_persistence_after_application_restart_and_custom_history(self):
        self.heartbeat(when=NOW - timedelta(days=60))
        cookie = self.client.cookies.get(COOKIE_NAME)
        from fastapi import FastAPI
        restarted = FastAPI()
        restarted.include_router(create_traffic_router(main.require_lecturer_pin, main.STUDENT_SESSION_SECRET))
        with TestClient(restarted) as client:
            client.cookies.set(COOKIE_NAME, cookie)
            self.heartbeat(client)
            data = self.report(client=client, query="?start_date=2026-09-01&end_date=2026-09-30")
            self.assertEqual(data["summary"]["all_time"], 1)
            self.assertEqual(data["summary"]["selected_period"], 1)
            self.assertEqual(len(data["daily"]), 30)

    def test_no_history_is_fabricated_and_html_assets_do_not_count(self):
        for path in ("/", "/students", "/admin", "/static/app-traffic.js?v=1", "/healthz"):
            self.assertEqual(self.client.get(path).status_code, 200)
        self.assertEqual(self.client.head("/").status_code, 200)
        data = self.report()
        self.assertIsNone(data["tracking_started_at"])
        self.assertTrue(all(value == 0 for value in data["summary"].values()))
        for page in set(main.FRONTEND_PAGES.values()):
            from pathlib import Path
            self.assertIn('/static/app-traffic.js?v=1', Path("static", page).read_text(encoding="utf-8"), page)

    def test_admin_access_ranges_and_cross_site_rejection(self):
        self.assertEqual(self.client.get("/admin/traffic").status_code, 401)
        for query, status in (("?start_date=bad", 422), ("?start_date=2026-11-03&end_date=2026-11-01", 400),
                              ("?start_date=2020-01-01&end_date=2026-11-01", 400),
                              ("?start_date=9999-12-31&end_date=9999-12-31", 400)):
            self.assertEqual(self.client.get("/admin/traffic" + query, headers=ADMIN).status_code, status)
        for headers in ({"Origin": "https://other.example"}, {"Sec-Fetch-Site": "cross-site"}):
            self.assertEqual(self.client.post("/traffic/heartbeat", headers=headers).status_code, 403)
        self.assertEqual(self.report()["summary"]["all_time"], 0)

    def test_cookie_tampering_and_https_cookie(self):
        self.client.cookies.set(COOKIE_NAME, "a" * 32 + ".forged")
        response = self.heartbeat(headers={"X-Forwarded-Proto": "https"})
        self.assertIn("Secure", response.headers["set-cookie"])
        with main.SessionLocal() as db:
            import hashlib
            self.assertNotEqual(db.query(AppTrafficActivity).first().visitor_hash, hashlib.sha256(("a" * 32).encode()).hexdigest())


if __name__ == "__main__":
    unittest.main()
