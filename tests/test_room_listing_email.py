"""Room notification lifecycle using an isolated database and simulated SMTP."""
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

from fastapi.testclient import TestClient

_database = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_database.close()
os.environ["DATABASE_URL"] = "sqlite:///" + _database.name.replace("\\", "/")
os.environ["SMTP_HOST"] = ""

import main
import room_listing_email as mail
from models import Accommodation, Landlord, RoomListingEmail


class RoomEmailTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)
        with main.SessionLocal() as db:
            owner = Landlord(full_name="Test Advertiser", email="advertiser@example.test", phone="0712345678",
                             password_hash="unused", active=True, created_at=datetime.now(timezone.utc).isoformat())
            db.add(owner); db.commit(); cls.owner_id = owner.id
        cls.headers = {"X-Landlord-Token": main._issue_landlord_token(cls.owner_id)}
        cls.admin = {"X-Lecturer-Pin": main.LECTURER_PIN}

    def setUp(self):
        with main.SessionLocal() as db:
            db.query(RoomListingEmail).delete(); db.query(Accommodation).delete(); db.commit()
        self.sender = patch.object(mail, "send_room_email", return_value=True)
        self.send = self.sender.start()
        self.addCleanup(self.sender.stop)

    def create(self, **extra):
        data = {"title":"Room <near school>", "campus":"Local school", "area":"Phalaborwa",
                "description":"An affordable room", "contact":"0791112233", **extra}
        return self.client.post("/marketing/listings", data=data, headers=self.headers)

    def approve(self, room_id, approved=True, headers=None):
        return self.client.put(f"/admin/market-rooms/{room_id}/approval", params={"approved": str(approved).lower()},
                               headers=self.admin if headers is None else headers)

    def jobs(self):
        with main.SessionLocal() as db:
            return [(job.event, job.status, job.attempts, job.sent_at) for job in db.query(RoomListingEmail).order_by(RoomListingEmail.id)]

    def test_submission_then_approval_sends_account_emails_and_working_public_link(self):
        response = self.create(); self.assertEqual(response.status_code, 200)
        room_id = response.json()["listing"]["id"]
        self.assertFalse(response.json()["listing"]["is_approved"])
        pending = self.send.call_args.args[0]
        self.assertEqual(pending["To"], "advertiser@example.test")
        self.assertIn("awaiting verification", pending["Subject"])
        self.assertIn("We will alert you by email", pending.get_body(preferencelist=("plain",)).get_content())
        self.assertNotIn(f"/listing/room/{room_id}", pending.as_string())
        self.assertEqual(self.client.get(f"/listing/room/{room_id}").status_code, 404)
        self.assertEqual(self.approve(room_id).status_code, 200)
        live = self.send.call_args.args[0]
        self.assertEqual(self.send.call_count, 2)
        self.assertIn("now live", live["Subject"])
        self.assertEqual(live["To"], "advertiser@example.test")
        self.assertIn(f"https://arounus.com/listing/room/{room_id}", live.get_body(preferencelist=("plain",)).get_content())
        html = live.get_body(preferencelist=("html",)).get_content()
        self.assertIn("View your listing", html); self.assertIn("&lt;near school&gt;", html)
        self.assertEqual(self.client.get(f"/listing/room/{room_id}").status_code, 200)
        self.approve(room_id); mail.deliver_room_emails(main.SessionLocal)
        self.assertEqual(self.send.call_count, 2)
        self.assertEqual([row[:2] for row in self.jobs()], [("submitted", "sent"), ("live", "sent")])

    def test_invalid_or_unauthorized_actions_do_not_send(self):
        self.assertIn(self.create(contact="").status_code, (400, 422))
        self.assertEqual(self.jobs(), []); self.send.assert_not_called()
        room_id = self.create().json()["listing"]["id"]; self.send.reset_mock()
        self.assertNotEqual(self.approve(room_id, headers={}).status_code, 200)
        self.assertEqual(self.approve(999999).status_code, 404)
        self.approve(room_id, approved=False)
        self.send.assert_not_called()

    def test_failed_email_is_durable_and_retries_without_recreating_listing(self):
        self.send.return_value = False
        response = self.create(); self.assertEqual(response.status_code, 200)
        self.assertEqual(self.jobs()[0][:3], ("submitted", "pending", 1))
        mail.deliver_room_emails(main.SessionLocal); self.assertEqual(self.send.call_count, 1)
        with main.SessionLocal() as db:
            job = db.query(RoomListingEmail).one()
            job.next_attempt_at = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(); db.commit()
        self.send.return_value = True
        mail.deliver_room_emails(main.SessionLocal)
        self.assertEqual(self.jobs()[0][:3], ("submitted", "sent", 2))
        self.assertIsNotNone(self.jobs()[0][3])

    def test_fast_approval_supersedes_an_undelivered_pending_notice(self):
        self.send.return_value = False
        room_id = self.create().json()["listing"]["id"]
        with main.SessionLocal() as db:
            db.query(RoomListingEmail).one().next_attempt_at = "2000-01-01T00:00:00+00:00"; db.commit()
        self.send.return_value = True; self.send.reset_mock()
        self.approve(room_id)
        self.assertEqual(self.send.call_count, 1)
        self.assertIn("now live", self.send.call_args.args[0]["Subject"])
        self.assertEqual([row[:2] for row in self.jobs()], [("submitted", "skipped"), ("live", "sent")])

    def test_deletion_removes_pending_delivery_and_nonpublic_rooms_get_no_live_notice(self):
        self.send.return_value = False
        room_id = self.create().json()["listing"]["id"]
        self.assertEqual(self.client.delete(f"/marketing/listings/{room_id}", headers=self.headers).status_code, 200)
        self.assertEqual(self.jobs(), [])
        room_id = self.create().json()["listing"]["id"]
        with main.SessionLocal() as db:
            db.get(Accommodation, room_id).is_available = False; db.commit()
        self.send.reset_mock(); self.approve(room_id); self.send.assert_not_called()
        self.assertEqual(self.jobs()[-1][:2], ("live", "skipped"))
        with main.SessionLocal() as db:
            db.get(Accommodation, room_id).is_available = True; db.commit()
        self.send.return_value = True; self.approve(room_id)
        self.assertEqual(self.send.call_count, 1)
        self.assertEqual(self.jobs()[-1][:2], ("live", "sent"))

    def test_malformed_account_does_not_block_other_queued_emails(self):
        with patch.object(mail, "build_room_email", side_effect=ValueError("Invalid header")):
            self.assertEqual(self.create().status_code, 200)
        self.assertEqual(self.jobs()[0][:2], ("submitted", "failed"))
        self.assertEqual(self.create().status_code, 200)
        self.assertEqual(self.send.call_count, 1)

    def test_worker_starts_and_stops_with_application(self):
        stop, thread = MagicMock(), MagicMock()
        with patch.object(main, "start_room_email_worker", return_value=(stop, thread)):
            with TestClient(main.app):
                stop.set.assert_not_called()
            stop.set.assert_called_once(); thread.join.assert_called_once_with(12)


class SmtpTransportTest(unittest.TestCase):
    def test_starttls_delivery_and_authentication(self):
        with patch.dict(os.environ, {"SMTP_HOST":"smtp.example.test", "SMTP_PORT":"587", "SMTP_USER":"sender@example.test", "SMTP_PASSWORD":"test-only", "SMTP_TLS":"1", "SMTP_SSL":"0"}), patch.object(mail.smtplib, "SMTP") as client:
            smtp = client.return_value.__enter__.return_value; smtp.send_message.return_value = {}
            self.assertTrue(mail.send_room_email("message"))
            client.assert_called_once_with("smtp.example.test", 587, timeout=10)
            smtp.starttls.assert_called_once(); smtp.login.assert_called_once_with("sender@example.test", "test-only")
            smtp.send_message.assert_called_once_with("message")

    def test_ssl_and_failed_delivery(self):
        with patch.dict(os.environ, {"SMTP_HOST":"smtp.example.test", "SMTP_PORT":"465"}), patch.object(mail.smtplib, "SMTP_SSL") as client:
            smtp = client.return_value.__enter__.return_value; smtp.send_message.return_value = {}
            self.assertTrue(mail.send_room_email("message")); smtp.starttls.assert_not_called()
            smtp.send_message.side_effect = TimeoutError()
            self.assertFalse(mail.send_room_email("message"))

    def test_missing_configuration_does_not_attempt_network_access(self):
        with patch.dict(os.environ, {"SMTP_HOST":""}), patch.object(mail.smtplib, "SMTP") as client:
            self.assertFalse(mail.send_room_email("message")); client.assert_not_called()


if __name__ == "__main__":
    unittest.main()
