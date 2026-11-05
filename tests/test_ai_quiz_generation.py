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
        self.mock_quiz(QUIZ)

    def mock_quiz(self, quiz):
        self.network.side_effect = lambda *args, **kwargs: io.BytesIO(json.dumps(gemini_response(quiz)).encode())

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
            self.network.side_effect = None
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
            self.mock_quiz(quiz)
            with self.subTest(change=change):
                self.network.reset_mock()
                self.assertEqual(self.generate().status_code, 502)
                self.assertEqual(self.network.call_count, 2)

    def test_physics_key_is_repaired_once_without_changing_requested_types(self):
        invalid = copy.deepcopy(QUIZ)
        invalid["questions"][0].update(type="short", question="Find the acceleration.",
                                        options=[], correct_answer="9.8 m/s²")
        repaired = copy.deepcopy(invalid)
        repaired["questions"][0].update(question="What property resists a change in motion?",
                                         correct_answer="inertia")
        self.network.side_effect = [
            io.BytesIO(json.dumps(gemini_response(invalid)).encode()),
            io.BytesIO(json.dumps(gemini_response(repaired)).encode()),
        ]
        response = self.generate(topic="Physics: gravity and Newton's laws", question_types="short")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["questions"][0]["correct_answer"], "inertia")
        self.assertEqual(self.network.call_count, 2)
        requests = [call.args[0] for call in self.network.call_args_list]
        self.assertEqual(requests[0].full_url, requests[1].full_url)
        prompt = json.loads(requests[1].data)["contents"][0]["parts"][0]["text"]
        self.assertIn("previous attempt failed validation", prompt)
        self.assertIn("Use only short questions", prompt)

    def test_numeric_short_keys_are_rejected_even_when_the_word_limit_passes(self):
        for answer in ("-5", "9.8", "10 N", "m/s", "F=ma"):
            with self.subTest(answer=answer):
                quiz = copy.deepcopy(QUIZ)
                quiz["questions"][0].update(type="short", options=[], correct_answer=answer)
                self.mock_quiz(quiz)
                self.assertEqual(self.generate(question_types="short").status_code, 502)

    def test_physics_mcq_preserves_decimal_sign_and_units(self):
        quiz = copy.deepcopy(QUIZ)
        quiz["questions"][0].update(question="Take upward as positive. What is gravitational acceleration?",
                                     options=["-9.8 m/s²", "9.8 m/s²", "0 m/s²", "-98 m/s²"],
                                     correct_answer="-9.8 m/s²")
        self.mock_quiz(quiz)
        response = self.generate(topic="Physics: gravity")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["questions"][0]["correct_answer"], "-9.8 m/s²")
        self.assertEqual(self.network.call_count, 1)

    def test_fun_similar_keys_follow_the_same_rules(self):
        for question_type in ("mcq", "short"):
            with self.subTest(question_type=question_type):
                quiz = copy.deepcopy(QUIZ)
                question = quiz["questions"][0]
                question.update(similar_question="A related practice question", similar_correct_answer="4",
                                similar_options=["4"] * 4)
                if question_type == "short":
                    question.update(type="short", options=[], correct_answer="inertia",
                                    similar_options=[], similar_correct_answer="-5")
                self.mock_quiz(quiz)
                self.assertEqual(self.generate(is_fun=True, question_types=question_type).status_code, 502)

    def test_openai_invalid_content_is_repaired_by_openai_only(self):
        with patch.object(main, "GEMINI_API_KEY", ""):
            self.network.side_effect = [io.BytesIO(json.dumps({"output_text": "{}"}).encode()),
                io.BytesIO(json.dumps({"output_text": json.dumps(QUIZ)}).encode())]
            response = self.generate()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.network.call_count, 2)
        self.assertTrue(all(call.args[0].full_url == "https://api.openai.com/v1/responses"
                            for call in self.network.call_args_list))

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
