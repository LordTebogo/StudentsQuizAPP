"""Tutor generation: provider selection, safe errors and unpublished drafts."""
import copy
import io
import json
import os
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

_database = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_database.close()
os.environ["DATABASE_URL"] = "sqlite:///" + _database.name.replace("\\", "/")
os.environ["SMTP_HOST"] = ""

from fastapi.testclient import TestClient
import main
from models import Lecturer, LecturerModule, LecturerQuizDraft, Quiz


QUIZ = {"title": "Arithmetic", "questions": [{
    "type": "mcq", "question": "What is two plus two?",
    "options": ["1", "2", "3", "4"], "correct_answer": "4", "marks": 1,
    "explanation": "Adding two and two gives four.", "similar_question": "",
    "similar_options": [], "similar_correct_answer": "",
}]}


def gemini_response(quiz=QUIZ, finish="STOP"):
    return {"candidates": [{"finishReason": finish, "content": {"parts": [{"text": json.dumps(quiz)}]}}]}


class AIQuizGenerationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with main.SessionLocal() as db:
            tutor = Lecturer(full_name="AI test tutor", email="ai-tutor@example.test", password_hash="unused",
                             active=True, approved=True, created_at="2026-11-04")
            db.add(tutor); db.flush()
            db.add(LecturerModule(lecturer_id=tutor.id, module_code="MATH"))
            db.commit(); cls.tutor_id = tutor.id
        cls.client = TestClient(main.app)
        cls.headers = {"X-Lecturer-Token": main._issue_lecturer_token(cls.tutor_id)}

    def setUp(self):
        self.enterContext(patch.object(main, "GEMINI_API_KEY", "unit-test-gemini-key"))
        self.enterContext(patch.object(main, "GEMINI_QUIZ_MODEL", "gemini-3.1-flash-lite"))
        self.enterContext(patch.object(main, "OPENAI_API_KEY", "unit-test-openai-key"))
        self.network = self.enterContext(patch("urllib.request.urlopen"))
        self.network.return_value = io.BytesIO(json.dumps(gemini_response()).encode())

    def generate(self, **changes):
        payload = dict(topic="Basic arithmetic", module_code="MATH", question_count=1, question_types="mcq")
        payload.update(changes)
        return self.client.post("/lecturer/quiz/generate", headers=self.headers, json=payload)

    def test_gemini_preferred_and_key_is_only_in_header(self):
        response = self.generate(source_text="Two plus two equals four.")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["provider"], "gemini")
        self.assertEqual(response.json()["model"], "gemini-3.1-flash-lite")
        request = self.network.call_args.args[0]
        self.assertEqual(request.get_header("X-goog-api-key"), "unit-test-gemini-key")
        self.assertNotIn("key=", request.full_url)
        self.assertNotIn("unit-test-gemini-key", response.text)
        body = json.loads(request.data)
        self.assertIn("responseJsonSchema", body["generationConfig"])
        self.assertIn("Two plus two equals four.", body["contents"][0]["parts"][0]["text"])
        with main.SessionLocal() as db:
            self.assertEqual(db.query(Quiz).count(), 0)
            self.assertEqual(db.query(LecturerQuizDraft).count(), 0)

    def test_openai_used_only_when_gemini_is_not_configured(self):
        with patch.object(main, "GEMINI_API_KEY", ""):
            self.network.return_value = io.BytesIO(json.dumps({"output_text": json.dumps(QUIZ)}).encode())
            response = self.generate()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["provider"], "openai")
        request = self.network.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.openai.com/v1/responses")
        self.assertFalse(json.loads(request.data)["store"])

    def test_missing_configuration_returns_actionable_error(self):
        with patch.object(main, "GEMINI_API_KEY", ""), patch.object(main, "OPENAI_API_KEY", ""):
            response = self.generate()
        self.assertEqual(response.status_code, 503)
        self.network.assert_not_called()

    def test_auth_and_assigned_modules_are_enforced_before_network(self):
        self.assertEqual(self.client.post("/lecturer/quiz/generate", json={"topic":"Arithmetic", "module_code":"MATH"}).status_code, 401)
        self.assertEqual(self.generate(module_code="HISTORY").status_code, 403)
        self.assertEqual(self.generate(question_count=31).status_code, 422)
        self.network.assert_not_called()

    def test_provider_errors_never_echo_notes_or_key_and_never_switch_to_paid_provider(self):
        for code in (400, 401, 403, 404, 429, 503):
            with self.subTest(code=code):
                self.network.reset_mock()
                self.network.side_effect = urllib.error.HTTPError("https://provider.test/", code, "failed", {},
                    io.BytesIO(b'{"error":{"message":"unit-test-gemini-key private lecture notes"}}'))
                response = self.generate()
                self.assertEqual(response.status_code, 429 if code == 429 else 502)
                self.assertNotIn("unit-test-gemini-key", response.text)
                self.assertNotIn("private lecture notes", response.text)
                self.assertEqual(self.network.call_count, 1)

    def test_timeouts_malformed_and_incomplete_output_are_rejected(self):
        self.network.side_effect = TimeoutError()
        self.assertEqual(self.generate().status_code, 504)
        self.network.side_effect = None
        cases = [b"not-json", b"null", b"[]", b"{}", json.dumps(gemini_response(finish="MAX_TOKENS")).encode(),
                 json.dumps({"candidates":[{"finishReason":"SAFETY"}]}).encode()]
        for data in cases:
            with self.subTest(data=data[:60]):
                self.network.return_value = io.BytesIO(data)
                self.assertEqual(self.generate().status_code, 502)

    def test_wrong_count_and_invalid_answer_keys_are_rejected(self):
        for change in ("count", "key", "duplicate-options"):
            quiz = copy.deepcopy(QUIZ)
            if change == "count": quiz["questions"] = []
            if change == "key": quiz["questions"][0]["correct_answer"] = "5"
            if change == "duplicate-options": quiz["questions"][0]["options"] = ["4"] * 4
            self.network.return_value = io.BytesIO(json.dumps(gemini_response(quiz)).encode())
            with self.subTest(change=change):
                self.assertEqual(self.generate().status_code, 502)

    def test_output_budget_depends_on_question_count(self):
        self.network.return_value = io.BytesIO(json.dumps(gemini_response()).encode())
        main._call_gemini_quiz("question " * 200, 1)
        small = json.loads(self.network.call_args.args[0].data)["generationConfig"]["maxOutputTokens"]
        self.network.return_value = io.BytesIO(json.dumps(gemini_response()).encode())
        main._call_gemini_quiz("short prompt", 30)
        large = json.loads(self.network.call_args.args[0].data)["generationConfig"]["maxOutputTokens"]
        self.assertLess(small, large)


if __name__ == "__main__":
    unittest.main()
