"""Tutor-owned lesson management and unique video viewer checks."""
import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

_database_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_database_file.close()
os.environ["DATABASE_URL"] = "sqlite:///" + _database_file.name.replace("\\", "/")
os.environ["CLOUDINARY_CLOUD_NAME"] = "test-cloud"
os.environ["CLOUDINARY_API_KEY"] = "test-key"
os.environ["CLOUDINARY_API_SECRET"] = "test-secret"

import main  # noqa: E402
import cloudinary_utils  # noqa: E402
from models import Lecturer, Lesson, LessonAnswer, LessonComment, LessonQuestion, LessonSubmission, LessonView, Student, StudentModule  # noqa: E402


class LessonManagementTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with main.SessionLocal() as db:
            owner = Lecturer(full_name="Owner", email="owner@example.test", password_hash="unused", approved=True, active=True, created_at="2026-10-01T00:00:00Z")
            other = Lecturer(full_name="Other", email="other@example.test", password_hash="unused", approved=True, active=True, created_at="2026-10-01T00:00:00Z")
            student = Student(student_number="LEARN001", full_name="Learner", email="learner@example.test", password_hash="unused", approved=True, active=True, created_at="2026-10-01T00:00:00Z")
            second_student = Student(student_number="LEARN002", full_name="Second learner", email="second@example.test", password_hash="unused", approved=True, active=True, created_at="2026-10-01T00:00:00Z")
            db.add_all([owner, other, student, second_student]); db.flush()
            db.add_all([StudentModule(student_id=student.id, module_code="BIO101"), StudentModule(student_id=second_student.id, module_code="BIO101")])
            db.commit()
            cls.owner_id, cls.other_id, cls.student_id, cls.second_student_id = owner.id, other.id, student.id, second_student.id
        cls.client = TestClient(main.app)
        cls.owner_headers = {"X-Lecturer-Token": main._issue_lecturer_token(cls.owner_id)}
        cls.other_headers = {"X-Lecturer-Token": main._issue_lecturer_token(cls.other_id)}
        cls.student_headers = {"X-Student-Token": main._issue_student_token(cls.student_id)}

    def setUp(self):
        with main.SessionLocal() as db:
            lesson = Lesson(title="Original", description="Description", module_code="BIO101", lecturer_id=self.owner_id, video_url="https://example.test/video.mp4", created_at="2026-10-01T00:00:00Z")
            db.add(lesson); db.flush()
            db.add(LessonQuestion(lesson_id=lesson.id, q_order=0, type="mcq", question="Old question?", options_json='["A", "B"]', correct_answer="A", marks=1))
            db.commit()
            self.lesson_id = lesson.id

    def test_unique_views_and_owner_only_management(self):
        view_path = f"/student/lessons/{self.lesson_id}/view"
        self.assertEqual(self.client.post(view_path, headers=self.student_headers).status_code, 200)
        self.assertEqual(self.client.post(view_path, headers=self.student_headers).status_code, 200)
        lessons = self.client.get("/lecturer/lessons", headers=self.owner_headers).json()
        self.assertEqual((lessons[0]["unique_viewers"], lessons[0]["video_starts"]), (1, 2))
        self.assertEqual(self.client.post(view_path, headers={"X-Student-Token": main._issue_student_token(self.second_student_id)}).status_code, 200)
        lessons = self.client.get("/lecturer/lessons", headers=self.owner_headers).json()
        self.assertEqual((lessons[0]["unique_viewers"], lessons[0]["video_starts"]), (2, 3))
        self.assertEqual(lessons[0]["question_count"], 1)
        self.assertEqual(self.client.get("/lecturer/lessons", headers=self.other_headers).json(), [])
        edit_path = f"/lecturer/lesson/{self.lesson_id}/edit"
        self.assertEqual(self.client.get(edit_path, headers=self.other_headers).status_code, 404)
        self.assertEqual(self.client.put(edit_path, headers=self.other_headers, json={"title":"Taken", "questions":[]}).status_code, 404)
        self.assertEqual(self.client.delete(f"/lecturer/lesson/{self.lesson_id}", headers=self.other_headers).status_code, 404)

    def test_edit_questions_then_protect_submitted_answers(self):
        path = f"/lecturer/lesson/{self.lesson_id}/edit"
        current = self.client.get(path, headers=self.owner_headers)
        self.assertEqual(current.status_code, 200)
        self.assertEqual(current.json()["questions"][0]["correct_answer"], "A")
        payload = {"title":"Updated", "description":"New notes", "questions":[{"type":"short", "question":"New question?", "correct_answer":"yes", "marks":2}]}
        self.assertEqual(self.client.put(path, headers=self.owner_headers, json=payload).status_code, 200)
        updated = self.client.get(path, headers=self.owner_headers).json()
        self.assertEqual((updated["title"], updated["questions"][0]["question"]), ("Updated", "New question?"))
        with main.SessionLocal() as db:
            submission = LessonSubmission(lesson_id=self.lesson_id, student_id="LEARN001", student_name="Learner", submitted_at="2026-10-01T00:00:00Z", total_score=0, max_score=2, fully_marked=False)
            db.add(submission); db.flush()
            question = db.query(LessonQuestion).filter_by(lesson_id=self.lesson_id).one()
            db.add_all([
                LessonAnswer(submission_id=submission.id, question_id=question.id, answer_text="yes", awarded_marks=2, marked=True),
                LessonComment(lesson_id=self.lesson_id, author_name="Learner", comment_text="Thanks", created_at="2026-10-01T00:00:00Z"),
                LessonView(lesson_id=self.lesson_id, student_account_id=self.student_id, first_viewed_at="2026-10-01T00:00:00Z", last_viewed_at="2026-10-01T00:00:00Z", view_count=1),
            ])
            db.commit()
        self.assertEqual(self.client.put(path, headers=self.owner_headers, json=payload).status_code, 409)
        with patch.object(main, "delete_lesson_video_variants", return_value=True) as delete_media:
            deleted = self.client.delete(f"/lecturer/lesson/{self.lesson_id}", headers=self.owner_headers)
        self.assertEqual(deleted.status_code, 200)
        self.assertTrue(deleted.json()["media_deleted"])
        delete_media.assert_called_once()
        self.assertEqual(self.client.get(path, headers=self.owner_headers).status_code, 404)
        with main.SessionLocal() as db:
            self.assertEqual(db.query(LessonAnswer).count(), 0)
            self.assertEqual(db.query(LessonComment).count(), 0)
            self.assertEqual(db.query(LessonView).count(), 0)

    def test_cloudinary_cleanup_only_targets_managed_lesson_uploads(self):
        premium = '{"public_id":"lesson_videos/BIO101/premium/secret","format":"mp4"}'
        free = "https://res.cloudinary.com/test-cloud/video/upload/v123/lesson_videos/BIO101/free/public.mp4"
        with patch.object(cloudinary_utils.cloudinary.uploader, "destroy", return_value={"result":"ok"}) as destroy:
            self.assertTrue(cloudinary_utils.delete_lesson_video_variants(free, premium))
        self.assertEqual(destroy.call_count, 2)
        with patch.object(cloudinary_utils.cloudinary.uploader, "destroy") as destroy:
            self.assertFalse(cloudinary_utils.delete_lesson_video_variants("https://other.test/video.mp4", None))
            destroy.assert_not_called()


if __name__ == "__main__":
    unittest.main()
