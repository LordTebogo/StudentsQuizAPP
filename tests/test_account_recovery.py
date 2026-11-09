"""Account and recovery integration checks; uses an isolated disposable database.

Run separately from the other backend suites, which also configure their own DB:
python -m unittest discover -s tests -p test_account_recovery.py
"""
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient

_database_dir = tempfile.TemporaryDirectory()
os.environ["DATABASE_URL"] = "sqlite:///" + (_database_dir.name + "/accounts.db").replace("\\", "/")
os.environ["AROUNUS_DEV_RESET_CODES"] = "1"
os.environ["SMTP_HOST"] = ""
for _key in ("CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"):
    os.environ[_key] = ""

import main  # noqa: E402
from models import Lecturer, PasswordResetCode, Student  # noqa: E402


class AccountRecoveryTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.email = self._testMethodName + "@example.test"
        main._LOGIN_ATTEMPTS.clear()

    def account(self, kind="student"):
        prefix = "students" if kind == "student" else "lecturers"
        data = {"full_name": "Test Account", "email": self.email,
                "password": "Old-password-123", "confirm_password": "Old-password-123"}
        if kind == "student":
            data["username"] = "USER-" + self._testMethodName[-30:]
        response = self.client.post(f"/{prefix}/register", data=data)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def request_code(self, prefix="students"):
        response = self.client.post(f"/{prefix}/password-reset/request", json={"email": self.email})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def confirm(self, code, prefix="students"):
        return self.client.post(f"/{prefix}/password-reset/confirm", json={
            "email": self.email, "code": code, "new_password": "New-password-456"})

    def test_registration_signs_in_both_roles(self):
        for kind, path, header in (("student", "/student/me", "X-Student-Token"),
                                   ("lecturer", "/lecturer/me", "X-Lecturer-Token")):
            with self.subTest(kind=kind):
                result = self.account(kind)
                self.assertTrue(result["token"])
                response = self.client.get(path, headers={header: result["token"]})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["email"], self.email)

    def test_code_is_hashed_single_use_and_changes_password_for_both_roles(self):
        for kind, prefix in (("student", "students"), ("lecturer", "lecturers")):
            with self.subTest(kind=kind):
                self.account(kind)
                code = self.request_code(prefix)["dev_code"]
                with main.SessionLocal() as db:
                    row = db.query(PasswordResetCode).filter_by(email=self.email, account_type=kind).one()
                    self.assertNotEqual(row.code_hash, code)
                    self.assertEqual(len(row.code_hash), 64)
                self.assertEqual(self.confirm(code, prefix).status_code, 200)
                self.assertEqual(self.confirm(code, prefix).status_code, 400)
                identifier = {"identifier": self.email} if kind == "student" else {"email": self.email}
                self.assertEqual(self.client.post(f"/{prefix}/login", json={**identifier, "password": "Old-password-123"}).status_code, 401)
                self.assertEqual(self.client.post(f"/{prefix}/login", json={**identifier, "password": "New-password-456"}).status_code, 200)

    def test_room_agent_can_reset_password(self):
        created = self.client.post("/marketing/landlords/register", data={
            "full_name":"Test Agent", "provider_type":"agent", "email":self.email,
            "phone":"0712345678", "password":"Old-password-123", "confirm_password":"Old-password-123"})
        self.assertEqual(created.status_code, 200, created.text)
        self.assertEqual(created.json()["profile"]["provider_type"], "agent")
        prefix = "marketing/landlords"
        code = self.request_code(prefix)["dev_code"]
        self.assertEqual(self.confirm(code, prefix).status_code, 200)
        self.assertEqual(self.client.post("/marketing/landlords/login", json={"email":self.email, "password":"Old-password-123"}).status_code, 401)
        self.assertEqual(self.client.post("/marketing/landlords/login", json={"email":self.email, "password":"New-password-456"}).status_code, 200)

    def test_expired_code_is_rejected(self):
        self.account()
        code = self.request_code()["dev_code"]
        with main.SessionLocal() as db:
            db.query(PasswordResetCode).filter_by(email=self.email).update({
                "expires_at": (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()})
            db.commit()
        self.assertEqual(self.confirm(code).status_code, 400)

    def test_reset_guess_limit_persists_and_replacement_code_works(self):
        self.account()
        code = self.request_code()["dev_code"]
        wrong = "000000" if code != "000000" else "000001"
        for _ in range(main._PASSWORD_RESET_MAX_ATTEMPTS):
            self.assertEqual(self.confirm(wrong).status_code, 400)
        with main.SessionLocal() as db:
            row = db.query(PasswordResetCode).filter_by(email=self.email).one()
            self.assertEqual(row.failed_attempts, main._PASSWORD_RESET_MAX_ATTEMPTS)
            row.created_at = (datetime.now(timezone.utc) - timedelta(seconds=61)).isoformat()
            db.commit()
        self.assertEqual(self.confirm(code).status_code, 429)
        replacement = self.request_code()["dev_code"]
        self.assertEqual(self.confirm(replacement).status_code, 200)

    def test_request_throttle_does_not_invalidate_existing_code(self):
        self.account()
        code = self.request_code()["dev_code"]
        self.assertNotIn("dev_code", self.request_code())
        with main.SessionLocal() as db:
            self.assertEqual(db.query(PasswordResetCode).filter_by(email=self.email).count(), 1)
        self.assertEqual(self.confirm(code).status_code, 200)

    def test_unknown_account_and_unconfigured_delivery(self):
        self.assertNotIn("dev_code", self.request_code())
        self.account()
        with patch.dict(os.environ, {"AROUNUS_DEV_RESET_CODES": "0", "SMTP_HOST": ""}):
            unavailable = self.request_code()
            self.assertFalse(unavailable["recovery_available"])
            self.assertIn("administrator", unavailable["message"])
            unknown = self.client.post("/students/password-reset/request", json={"email": "unknown@example.test"}).json()
            self.assertEqual(unknown, unavailable)

    def test_smtp_delivery_does_not_expose_code(self):
        self.account()
        with patch.dict(os.environ, {"AROUNUS_DEV_RESET_CODES": "0", "SMTP_HOST": "smtp.example.test"}), patch.object(main, "_send_reset_email", return_value=True) as send:
            result = self.request_code()
            self.assertNotIn("dev_code", result)
            send.assert_called_once()
            self.assertEqual(send.call_args.args[0], self.email)
            self.assertEqual(self.confirm(send.call_args.args[1]).status_code, 200)

    def test_codes_cannot_cross_account_roles(self):
        self.account("student")
        self.account("lecturer")
        code = self.request_code()["dev_code"]
        self.assertEqual(self.confirm(code, "lecturers").status_code, 400)
        self.assertEqual(self.confirm(code).status_code, 200)

    def test_login_throttle_has_retry_header_and_reset_unlocks_account(self):
        self.account()
        payload = {"identifier": self.email, "password": "wrong-password"}
        for _ in range(main._LOGIN_MAX_FAILURES):
            self.assertEqual(self.client.post("/students/login", json=payload).status_code, 401)
        locked = self.client.post("/students/login", json=payload)
        self.assertEqual(locked.status_code, 429)
        self.assertGreater(int(locked.headers["retry-after"]), 0)
        self.assertEqual(self.confirm(self.request_code()["dev_code"]).status_code, 200)
        self.assertEqual(self.client.post("/students/login", json={**payload, "password": "New-password-456"}).status_code, 200)

    def test_pages_health_and_head_headers(self):
        for path in ("/", "/learning", "/students", "/lecturers", "/live", "/trust", "/premium", "/tools/pdf", "/reset-password", "/static/ui.css"):
            with self.subTest(path=path):
                get = self.client.get(path)
                head = self.client.head(path)
                self.assertEqual((get.status_code, head.status_code), (200, 200))
                self.assertEqual(head.content, b"")
                self.assertEqual(head.headers["content-length"], get.headers["content-length"])
                self.assertEqual(head.headers["x-content-type-options"], "nosniff")
        self.assertTrue(self.client.get("/healthz").json()["database"])
        with patch.object(main.engine, "connect", side_effect=RuntimeError("Unavailable")):
            self.assertEqual(self.client.get("/healthz").status_code, 503)
        with TestClient(main.app, base_url="https://arounus.test") as secure:
            self.assertIn("max-age=", secure.head("/").headers["strict-transport-security"])
        proxied = self.client.head("/", headers={"X-Forwarded-Proto": "https"})
        self.assertIn("max-age=", proxied.headers["strict-transport-security"])
        csp = self.client.get("/tools/pdf").headers["content-security-policy"]
        self.assertIn("https://cdnjs.cloudflare.com", csp)
        self.assertIn("worker-src 'self' blob:", csp)


def tearDownModule():
    main.engine.dispose()
    _database_dir.cleanup()
