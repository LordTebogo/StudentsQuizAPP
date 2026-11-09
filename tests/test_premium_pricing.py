"""Premium prices and entitlements with an isolated DB and mocked gateways."""
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy import create_engine, inspect, text

_directory = tempfile.TemporaryDirectory()
os.environ["DATABASE_URL"] = "sqlite:///" + (_directory.name + "/premium.db").replace("\\", "/")
import main  # noqa: E402
from models import PremiumPayment, Student  # noqa: E402


class PremiumPricingTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        with main.SessionLocal() as db:
            student = Student(student_number=self._testMethodName, full_name="Test Learner", email=self._testMethodName + "@example.test", password_hash="unused", active=True, approved=True, created_at="2026-11-01T00:00:00Z")
            db.add(student)
            db.commit()
            self.student_id = student.id
            self.email = student.email
        self.headers = {"X-Student-Token": main._issue_student_token(self.student_id)}
        for item in [patch.dict(os.environ, {"PUBLIC_BASE_URL": "https://arounus.test"}), patch.object(main, "payu_configured", return_value=True), patch.object(main, "paystack_configured", return_value=True)]:
            item.start()
            self.addCleanup(item.stop)

    def checkout(self, plan="monthly", provider="payu", **extra):
        return self.client.post("/billing/premium/checkout", headers=self.headers, json={"plan": plan, "provider": provider, **extra})

    def payment(self):
        with main.SessionLocal() as db:
            row = db.query(PremiumPayment).filter_by(student_id=self.student_id).order_by(PremiumPayment.id.desc()).first()
            db.expunge(row)
            return row

    def confirm(self, payment, amount=None, state="SUCCESSFUL"):
        result = {"merchant_reference": payment.merchant_reference, "payu_reference": payment.payu_reference, "amount_cents": str(payment.amount_cents if amount is None else amount), "currency": "ZAR", "transaction_type": "PAYMENT", "successful": True, "state": state}
        with patch.object(main, "payu_verify", return_value=result), main.SessionLocal() as db:
            return main._confirm_premium_payment(payment.merchant_reference, db)

    def seed_payment(self, plan, amount, status="pending"):
        with main.SessionLocal() as db:
            payment = PremiumPayment(student_id=self.student_id, merchant_reference="AR" + main.secrets.token_hex(16).upper(), payu_reference=main.secrets.token_hex(12), provider="payu", plan=plan, amount_cents=amount, status=status, created_at="2026-11-01T00:00:00Z")
            db.add(payment)
            db.commit()
            db.refresh(payment)
            db.expunge(payment)
            return payment

    def test_plan_prices_change_after_first_successful_purchase(self):
        plans = self.client.get("/billing/premium/plans", headers=self.headers).json()["plans"]
        self.assertEqual({p["id"]: p["amount_cents"] for p in plans}, {"monthly": 1500, "six_months": 15000, "annual": 40000})
        self.assertTrue(plans[0]["introductory"])
        self.seed_payment("annual", 10000, "paid")
        response = self.client.get("/billing/premium/plans", headers=self.headers)
        monthly = next(p for p in response.json()["plans"] if p["id"] == "monthly")
        self.assertEqual(monthly["amount_cents"], 5000)
        self.assertFalse(monthly["introductory"])
        self.assertIn("private, no-store", response.headers["cache-control"])

    def test_first_month_uses_server_price_and_reuses_pending_checkout(self):
        with patch.object(main, "payu_start", return_value=("PAYU-FIRST", "https://secure.payu.co.za/first")) as start:
            first = self.checkout(amount_cents=1)
            repeat = self.checkout()
            self.assertEqual(first.status_code, 200, first.text)
            self.assertEqual(repeat.json(), first.json())
            start.assert_called_once()
            self.assertEqual(start.call_args.args[1], 1500)
            self.assertEqual(self.checkout(provider="paystack").status_code, 409)
        payment = self.payment()
        self.assertEqual(payment.plan, "intro")
        self.assertEqual(payment.amount_cents, 1500)
        self.assertEqual(self.confirm(payment), "paid")
        self.assertEqual(self.confirm(payment), "paid")
        with main.SessionLocal() as db:
            until = datetime.fromisoformat(db.get(Student, self.student_id).premium_until)
            self.assertAlmostEqual((until - datetime.now(timezone.utc)).total_seconds() / 86400, 30, places=3)
        with patch.object(main, "payu_start", return_value=("PAYU-SECOND", "https://secure.payu.co.za/second")) as start:
            self.assertEqual(self.checkout().status_code, 200)
            self.assertEqual(start.call_args.args[1], 5000)
        self.assertEqual(self.confirm(self.payment()), "paid")
        with main.SessionLocal() as db:
            after = datetime.fromisoformat(db.get(Student, self.student_id).premium_until)
            self.assertEqual(after, until + timedelta(days=30))

    def test_paystack_uses_introductory_server_price_and_blocks_new_ozow_checkout(self):
        self.assertEqual(self.checkout(provider="ozow").status_code, 400)
        with patch.object(main, "paystack_start", return_value="https://checkout.paystack.com/test") as start:
            self.assertEqual(self.checkout(provider="paystack").status_code, 200)
            self.assertEqual(start.call_args.args[1:3], (self.email, 1500))
            self.assertEqual(self.checkout(provider="paystack").status_code, 200)
            start.assert_called_once()
        payment = self.payment()
        self.assertEqual(payment.provider, "paystack")
        verified = {"reference": payment.merchant_reference, "status": "success", "amount_cents": 1500,
                    "currency": "ZAR", "domain": "live", "email": self.email}
        with patch.object(main, "paystack_verify", return_value=verified) as verify, main.SessionLocal() as db:
            self.assertEqual(main._confirm_premium_payment(payment.merchant_reference, db), "paid")
            verify.assert_called_once_with(payment.merchant_reference)

    def test_six_months_preserves_calendar_months_and_handles_leap_day(self):
        year = datetime.now(timezone.utc).year + 1
        while not main.calendar.isleap(year + 1):
            year += 1
        start = datetime(year, 8, 31, 12, 0, tzinfo=timezone.utc)
        with main.SessionLocal() as db:
            db.get(Student, self.student_id).premium_until = start.isoformat()
            db.commit()
        with patch.object(main, "payu_start", return_value=("PAYU-SIX", "https://secure.payu.co.za/six")) as gateway:
            response = self.checkout("six_months")
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(gateway.call_args.args[1], 15000)
        self.assertEqual(self.confirm(self.payment()), "paid")
        with main.SessionLocal() as db:
            until = datetime.fromisoformat(db.get(Student, self.student_id).premium_until)
            self.assertEqual(until, datetime(year + 1, 2, 29, 12, 0, tzinfo=timezone.utc))

    def test_annual_costs_400_and_grants_365_days(self):
        with patch.object(main, "payu_start", return_value=("PAYU-YEAR", "https://secure.payu.co.za/year")) as gateway:
            self.assertEqual(self.checkout("annual").status_code, 200)
            self.assertEqual(gateway.call_args.args[1], 40000)
        self.assertEqual(self.confirm(self.payment()), "paid")
        with main.SessionLocal() as db:
            until = datetime.fromisoformat(db.get(Student, self.student_id).premium_until)
            self.assertAlmostEqual((until - datetime.now(timezone.utc)).total_seconds() / 86400, 365, places=3)

    def test_bad_payment_amount_never_grants_access(self):
        payment = self.seed_payment("intro", 1500)
        self.assertEqual(self.confirm(payment, amount=1), "mismatch")
        with main.SessionLocal() as db:
            self.assertIsNone(db.get(Student, self.student_id).premium_until)
        self.assertTrue(self.client.get("/billing/premium/plans", headers=self.headers).json()["plans"][0]["introductory"])

    def test_failed_payment_releases_introductory_offer(self):
        self.assertEqual(self.confirm(self.seed_payment("intro", 1500), state="FAILED"), "failed")
        with patch.object(main, "payu_start", return_value=("PAYU-RETRY", "https://secure.payu.co.za/retry")) as start:
            self.assertEqual(self.checkout().status_code, 200)
            self.assertEqual(start.call_args.args[1], 1500)

    def test_gateway_setup_failure_allows_retry(self):
        with patch.object(main, "payu_start", side_effect=main.PayUError("Temporarily unavailable")):
            self.assertEqual(self.checkout().status_code, 502)
        with patch.object(main, "payu_start", return_value=("PAYU-RECOVER", "https://secure.payu.co.za/recover")):
            self.assertEqual(self.checkout().status_code, 200)
        self.assertEqual(self.payment().amount_cents, 1500)

    def test_database_rejects_multiple_pending_introductory_payments(self):
        self.seed_payment("intro", 1500)
        with self.assertRaises(IntegrityError):
            self.seed_payment("intro", 1500)

    def test_existing_monthly_payment_uses_original_amount_and_duration(self):
        self.assertEqual(self.confirm(self.seed_payment("monthly", 1000)), "paid")
        with main.SessionLocal() as db:
            until = datetime.fromisoformat(db.get(Student, self.student_id).premium_until)
            self.assertAlmostEqual((until - datetime.now(timezone.utc)).total_seconds() / 86400, 30, places=3)

    def test_existing_lifetime_payment_is_honoured_but_new_sales_are_disabled(self):
        self.assertEqual(self.checkout("once").status_code, 400)
        self.assertEqual(self.confirm(self.seed_payment("once", 1000)), "paid")
        with main.SessionLocal() as db:
            self.assertTrue(db.get(Student, self.student_id).premium_lifetime)
        self.assertEqual(self.checkout().status_code, 400)

    def test_schema_upgrade_preserves_existing_tables_and_can_run_twice(self):
        engine = create_engine("sqlite://")
        try:
            with engine.begin() as connection:
                connection.execute(text("CREATE TABLE students (id INTEGER PRIMARY KEY)"))
                connection.execute(text("CREATE TABLE premium_payments (id INTEGER PRIMARY KEY, student_id INTEGER, plan VARCHAR, status VARCHAR)"))
            with patch.object(main, "engine", engine):
                main.ensure_premium_billing_schema()
                main.ensure_premium_billing_schema()
            columns = {column["name"] for column in inspect(engine).get_columns("premium_payments")}
            self.assertTrue({"provider", "checkout_url"}.issubset(columns))
            self.assertIn("ux_premium_intro_per_student", {index["name"] for index in inspect(engine).get_indexes("premium_payments")})
        finally:
            engine.dispose()


def tearDownModule():
    main.engine.dispose()
    _directory.cleanup()
