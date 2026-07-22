"""
SQLAlchemy models for the quiz + video-lesson app.

This mirrors the SQLite schema the app used to run on (see the old
init_db() in main.py), translated to Postgres via SQLAlchemy. A few
storage-related columns changed meaning now that files live in Cloudinary
instead of on local disk:

  - Question.image_filename  -> Question.image_url   (full Cloudinary/URL)
  - LessonQuestion.image_filename -> LessonQuestion.image_url
  - Lesson.video_filename     -> Lesson.video_url     (full Cloudinary URL)

Everything else (field names, table shapes) matches the old app closely so
the FastAPI endpoints — and therefore the existing frontend, which just
reads whatever URL the API gives it — need minimal changes.
"""

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from database import Base


# ---------------------------------------------------------------------------
# Lecturer accounts and module permissions
# ---------------------------------------------------------------------------

class Lecturer(Base):
    __tablename__ = "lecturers"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String, nullable=False)
    email = Column(String, nullable=False, unique=True, index=True)
    phone = Column(String)
    institution = Column(String)
    bio = Column(Text)
    profile_image_url = Column(Text)
    password_hash = Column(String, nullable=False)
    approved = Column(Boolean, nullable=False, default=False)
    active = Column(Boolean, nullable=False, default=True)
    module_limit = Column(Integer, nullable=False, default=1)
    created_at = Column(String, nullable=False)

    modules = relationship("LecturerModule", back_populates="lecturer", cascade="all, delete-orphan")
    quizzes = relationship("Quiz", back_populates="lecturer")
    lessons = relationship("Lesson", back_populates="lecturer")


class LecturerModule(Base):
    __tablename__ = "lecturer_modules"
    __table_args__ = (UniqueConstraint("lecturer_id", "module_code", name="lecturer_module_unique"),)

    id = Column(Integer, primary_key=True)
    lecturer_id = Column(Integer, ForeignKey("lecturers.id"), nullable=False, index=True)
    module_code = Column(String, nullable=False, index=True)

    lecturer = relationship("Lecturer", back_populates="modules")


# ---------------------------------------------------------------------------
# Quizzes
# ---------------------------------------------------------------------------

class Quiz(Base):
    __tablename__ = "quizzes"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    module_code = Column(String, nullable=False, default="GENERAL", index=True)
    lecturer_id = Column(Integer, ForeignKey("lecturers.id"), index=True)
    created_at = Column(String, nullable=False)  # ISO-8601 UTC string, e.g. "...Z"

    questions = relationship(
        "Question", back_populates="quiz",
        cascade="all, delete-orphan", order_by="Question.q_order",
    )
    submissions = relationship(
        "Submission", back_populates="quiz", cascade="all, delete-orphan",
    )
    lecturer = relationship("Lecturer", back_populates="quizzes")


class Question(Base):
    __tablename__ = "questions"
    __table_args__ = (
        CheckConstraint("type IN ('mcq', 'short', 'long')", name="question_type_check"),
    )

    id = Column(Integer, primary_key=True, index=True)
    quiz_id = Column(Integer, ForeignKey("quizzes.id"), nullable=False)
    q_order = Column(Integer, nullable=False)
    type = Column(String, nullable=False)
    question = Column(Text, nullable=False)
    options_json = Column(Text)          # JSON-encoded list, only for mcq
    correct_answer = Column(Text)        # used for mcq / short, NULL for long
    marks = Column(Float, nullable=False)
    image_url = Column(Text)             # Cloudinary (or other) URL, optional

    quiz = relationship("Quiz", back_populates="questions")
    answers = relationship(
        "Answer", back_populates="question", cascade="all, delete-orphan",
    )


class Submission(Base):
    __tablename__ = "submissions"

    id = Column(Integer, primary_key=True, index=True)
    quiz_id = Column(Integer, ForeignKey("quizzes.id"), nullable=False)
    student_id = Column(String, nullable=False, index=True)
    student_name = Column(String, nullable=False)
    submitted_at = Column(String, nullable=False)
    total_score = Column(Float, nullable=False, default=0)
    max_score = Column(Float, nullable=False, default=0)
    fully_marked = Column(Boolean, nullable=False, default=False)

    quiz = relationship("Quiz", back_populates="submissions")
    answers = relationship(
        "Answer", back_populates="submission", cascade="all, delete-orphan",
    )


class Answer(Base):
    __tablename__ = "answers"

    id = Column(Integer, primary_key=True, index=True)
    submission_id = Column(Integer, ForeignKey("submissions.id"), nullable=False)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=False)
    answer_text = Column(Text)
    awarded_marks = Column(Float)
    marked = Column(Boolean, nullable=False, default=False)

    submission = relationship("Submission", back_populates="answers")
    question = relationship("Question", back_populates="answers")


# ---------------------------------------------------------------------------
# Video lessons
# ---------------------------------------------------------------------------

class Lesson(Base):
    __tablename__ = "lessons"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text)
    module_code = Column(String, nullable=False, default="GENERAL", index=True)
    lecturer_id = Column(Integer, ForeignKey("lecturers.id"), index=True)
    video_url = Column(Text, nullable=False)  # Cloudinary secure video URL
    created_at = Column(String, nullable=False)

    questions = relationship(
        "LessonQuestion", back_populates="lesson",
        cascade="all, delete-orphan", order_by="LessonQuestion.q_order",
    )
    submissions = relationship(
        "LessonSubmission", back_populates="lesson", cascade="all, delete-orphan",
    )
    comments = relationship(
        "LessonComment", back_populates="lesson", cascade="all, delete-orphan",
    )
    lecturer = relationship("Lecturer", back_populates="lessons")


class LessonQuestion(Base):
    __tablename__ = "lesson_questions"
    __table_args__ = (
        CheckConstraint("type IN ('mcq', 'short', 'long')", name="lesson_question_type_check"),
    )

    id = Column(Integer, primary_key=True, index=True)
    lesson_id = Column(Integer, ForeignKey("lessons.id"), nullable=False)
    q_order = Column(Integer, nullable=False)
    type = Column(String, nullable=False)
    question = Column(Text, nullable=False)
    options_json = Column(Text)
    correct_answer = Column(Text)
    marks = Column(Float, nullable=False)
    image_url = Column(Text)

    lesson = relationship("Lesson", back_populates="questions")
    answers = relationship(
        "LessonAnswer", back_populates="question", cascade="all, delete-orphan",
    )


class LessonSubmission(Base):
    __tablename__ = "lesson_submissions"

    id = Column(Integer, primary_key=True, index=True)
    lesson_id = Column(Integer, ForeignKey("lessons.id"), nullable=False)
    student_id = Column(String, nullable=False, index=True)
    student_name = Column(String, nullable=False)
    submitted_at = Column(String, nullable=False)
    total_score = Column(Float, nullable=False, default=0)
    max_score = Column(Float, nullable=False, default=0)
    fully_marked = Column(Boolean, nullable=False, default=False)

    lesson = relationship("Lesson", back_populates="submissions")
    answers = relationship(
        "LessonAnswer", back_populates="submission", cascade="all, delete-orphan",
    )


class LessonAnswer(Base):
    __tablename__ = "lesson_answers"

    id = Column(Integer, primary_key=True, index=True)
    submission_id = Column(Integer, ForeignKey("lesson_submissions.id"), nullable=False)
    question_id = Column(Integer, ForeignKey("lesson_questions.id"), nullable=False)
    answer_text = Column(Text)
    awarded_marks = Column(Float)
    marked = Column(Boolean, nullable=False, default=False)

    submission = relationship("LessonSubmission", back_populates="answers")
    question = relationship("LessonQuestion", back_populates="answers")


class LessonComment(Base):
    __tablename__ = "lesson_comments"

    id = Column(Integer, primary_key=True, index=True)
    lesson_id = Column(Integer, ForeignKey("lessons.id"), nullable=False)
    author_name = Column(String, nullable=False)
    is_lecturer = Column(Boolean, nullable=False, default=False)
    comment_text = Column(Text, nullable=False)
    created_at = Column(String, nullable=False)

    lesson = relationship("Lesson", back_populates="comments")
