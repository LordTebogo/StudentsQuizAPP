"""Hosted channels, webhook authenticity and idempotent Premium credit."""
import hashlib
import hmac
import json
import os
import tempfile
import time
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_db.close()
os.environ["DATABASE_URL"] = "sqlite:///" + _db.name.replace("\\", "/")
os.environ["SMTP_HOST"] = ""

from fastapi.testclient import TestClient
import main
import paystack_checkout as gateway
from models import PremiumPayment, Student

API_KEY = "sk_live_unit_test_only"
SIGNING_KEY = "whsec_unit_test_signing_secret"
WEBHOOK = "/billing/premium/paystack/webhook"


class PaystackPaymentsTest(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.dict(os.environ, {"PAYSTACK_SECRET_KEY": API_KEY, "PAYSTACK_ENABLED": "true",
            "PAYSTACK_WEBHOOK_SECRET": SIGNING_KEY, "PUBLIC_BASE_URL": "https://arounus.test"}))
        self.client = TestClient(main.app)
        self.verify = self.enterContext(patch.object(main, "paystack_verify"))
        self.reference = "AR" + main.secrets.token_hex(16).upper()
        with main.SessionLocal() as db:
            student = Student(student_number=self._testMethodName, full_name="Payment learner",
                email=self._testMethodName+"@example.test", password_hash="unused", approved=True,
                active=True, created_at="2026-11-04")
            db.add(student); db.flush(); self.student_id = student.id; self.email = student.email
            db.add(PremiumPayment(student_id=student.id, merchant_reference=self.reference, provider="paystack",
                plan="intro", amount_cents=1500, status="pending", created_at="2026-11-04"))
            db.commit()
        self.verify.return_value = {"reference": self.reference, "status": "success", "amount_cents": 1500,
            "currency": "ZAR", "domain": "live", "email": self.email}

    def event(self, event="charge.success", reference=None):
        return json.dumps({"event":event,"data":{"reference":reference or self.reference}}).encode()

    def signature(self, body, timestamp=None):
        stamp = str(int(time.time()) if timestamp is None else timestamp)
        digest = hmac.new(SIGNING_KEY.encode(),stamp.encode()+b"."+body,hashlib.sha512).hexdigest()
        return f"t={stamp},v1=whk_test:{digest}"

    def deliver(self, body=None, signature=None):
        body = self.event() if body is None else body
        return self.client.post(WEBHOOK,content=body,headers={"Content-Type":"application/json",
            "Paystack-Signature":self.signature(body) if signature is None else signature})

    def test_hosted_checkout_uses_approved_dashboard_channels(self):
        with patch.object(gateway,"_request",return_value={"reference":self.reference,
                "authorization_url":"https://checkout.paystack.com/unit-test"}) as request:
            self.assertEqual(gateway.start(self.reference,self.email,1500,"https://arounus.test/return"),
                             "https://checkout.paystack.com/unit-test")
            self.assertNotIn("channels",request.call_args.args[1])
            self.assertEqual(request.call_args.args[1]["currency"],"ZAR")

    def test_live_key_and_explicit_enablement_are_required(self):
        self.assertTrue(gateway.configured())
        with patch.dict(os.environ,{"PAYSTACK_ENABLED":"false"}):
            self.assertFalse(gateway.configured())
        with patch.dict(os.environ,{"PAYSTACK_SECRET_KEY":"sk_test_only"}):
            self.assertFalse(gateway.configured())
        with patch.dict(os.environ,{"PAYSTACK_ENABLED":"false"}):
            self.assertEqual(self.deliver().status_code,503)
            self.verify.assert_not_called()

    def test_disabling_paystack_also_blocks_reusing_existing_checkout_links(self):
        with main.SessionLocal() as db:
            db.query(PremiumPayment).filter_by(merchant_reference=self.reference).one().checkout_url = "https://checkout.paystack.com/pending"
            db.commit()
        with patch.dict(os.environ,{"PAYSTACK_ENABLED":"false"}):
            response = self.client.post("/billing/premium/checkout",
                headers={"X-Student-Token":main._issue_student_token(self.student_id)},
                json={"plan":"monthly","provider":"paystack"})
        self.assertEqual(response.status_code,503)

    def test_legacy_enablement_switch_is_only_used_when_new_switch_is_absent(self):
        with patch.dict(os.environ,{"PAYSTACK_GOOGLE_PAY_ENABLED":"true"}):
            os.environ.pop("PAYSTACK_ENABLED")
            self.assertTrue(gateway.configured())
            os.environ["PAYSTACK_ENABLED"]="false"
            self.assertFalse(gateway.configured())

    def test_bad_or_stale_signatures_cannot_reach_verification(self):
        body = self.event()
        for signature in ("", "t=1,v1=whk_test:"+"0"*128, self.signature(body,int(time.time())-301),
                          self.signature(body,int(time.time())+301), self.signature(body)+",t=1",
                          "t="+"9"*5000+",v1=whk_test:"+"0"*128):
            with self.subTest(signature=signature[:35]):
                self.assertEqual(self.deliver(body,signature).status_code,401)
        self.assertEqual(self.deliver(body+b" ",self.signature(body)).status_code,401)
        self.verify.assert_not_called()

    def test_current_signature_supports_multiple_key_ids(self):
        body = self.event()
        valid = self.signature(body)
        signature = valid.split(",")[0]+",v1=whk_old:"+"0"*128+","+valid.split(",")[1]
        self.assertEqual(self.deliver(body,signature).status_code,200)
        self.verify.assert_called_once_with(self.reference)

    def test_legacy_signatures_work_only_before_signing_secret_is_set(self):
        body = self.event()
        signature = hmac.new(API_KEY.encode(),body,hashlib.sha512).hexdigest()
        headers = {"Content-Type":"application/json","x-paystack-signature":signature}
        self.assertEqual(self.client.post(WEBHOOK,content=body,headers=headers).status_code,401)
        with patch.dict(os.environ,{"PAYSTACK_WEBHOOK_SECRET":""}):
            self.assertEqual(self.client.post(WEBHOOK,content=body,headers=headers).status_code,200)

    def test_verified_payment_is_credited_once_even_with_duplicate_delivery(self):
        self.assertEqual(self.deliver().status_code,200)
        with main.SessionLocal() as db:
            first = db.get(Student,self.student_id).premium_until
            until = datetime.fromisoformat(first)
            self.assertAlmostEqual((until-datetime.now(timezone.utc)).total_seconds()/86400,30,places=3)
        self.assertEqual(self.deliver().status_code,200)
        self.verify.assert_called_once()
        with main.SessionLocal() as db:
            self.assertEqual(db.get(Student,self.student_id).premium_until,first)

    def test_live_mode_exact_price_currency_and_email_are_independently_verified(self):
        for field,value in (("amount_cents",1),("currency","USD"),("domain","test"),
                            ("email","other@example.test"),("reference","OTHER")):
            result = dict(self.verify.return_value); result[field] = value
            with self.subTest(field=field), patch.object(main,"paystack_verify",return_value=result):
                self.assertEqual(self.deliver().status_code,200)
                with main.SessionLocal() as db:
                    self.assertIsNone(db.get(Student,self.student_id).premium_until)

    def test_temporary_provider_failure_is_retried(self):
        self.verify.side_effect = main.PaystackError("Temporary outage")
        self.assertEqual(self.deliver().status_code,503)
        self.verify.side_effect = None
        self.assertEqual(self.deliver().status_code,200)

    def test_unrelated_unknown_or_other_provider_events_are_acknowledged_without_credit(self):
        for body in (self.event("transfer.success"),self.event(reference="AR"+"0"*32),
                     self.event(reference="another-product")):
            self.assertEqual(self.deliver(body).status_code,200)
        with main.SessionLocal() as db:
            db.query(PremiumPayment).filter_by(merchant_reference=self.reference).one().provider="payu"
            db.commit()
        self.assertEqual(self.deliver().status_code,200)
        self.verify.assert_not_called()

    def test_bad_json_and_oversized_payloads_are_rejected(self):
        self.assertEqual(self.deliver(b"not-json").status_code,400)
        self.assertEqual(self.deliver(b"[]").status_code,400)
        self.assertEqual(self.deliver(b" "*(256*1024+1)).status_code,413)
        self.verify.assert_not_called()

    def test_new_availability_field_keeps_installed_clients_compatible(self):
        result = self.client.get("/billing/premium/plans").json()
        self.assertTrue(result["paystack_available"])
        self.assertEqual(result["paystack_available"],result["google_pay_available"])


if __name__ == "__main__":
    unittest.main()
