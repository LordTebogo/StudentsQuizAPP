"""
Quiz + Video Lessons App (FastAPI) — cloud-deployable version
---------------------------------------------------------------
Originally a local-network-only app (SQLite file + local disk for images
and videos). This version is rewritten to deploy on a host like Render,
where local disk writes don't persist across restarts/redeploys:

  - Database: Postgres via SQLAlchemy (see database.py), instead of a
    local quiz_app.db SQLite file.
  - Images & videos: uploaded to Cloudinary (see cloudinary_utils.py) and
    referenced by their permanent URL, instead of saved to local disk.

Everything else — the quiz/lesson logic, marking, PDF export, comments,
lecturer PIN — is unchanged from the local version. The existing frontend
(static/*.html) needs NO changes: it already just displays whatever
image_url/video_url the API gives it.

Run locally with:
    pip install -r requirements.txt
    uvicorn main:app --reload

Deploy on Render with:
    Build command: pip install -r requirements.txt
    Start command: uvicorn main:app --host 0.0.0.0 --port $PORT
    Environment variables: DATABASE_URL, CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET (see README.md)
"""

import io
import json
import os
import re
import base64
import hashlib
import hmac
import secrets
import urllib.request
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from itertools import permutations
from typing import List, Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import func, inspect, text
from sqlalchemy.orm import Session

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    Image as RLImage,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)
from PIL import Image as PILImage

from database import Base, engine, get_db
from models import (
    Answer,
    Lesson,
    LessonAnswer,
    LessonComment,
    LessonQuestion,
    LessonSubmission,
    Lecturer,
    LecturerModule,
    FunPost,
    Question,
    Quiz,
    Submission,
    Student,
)
from cloudinary_utils import upload_image_bytes, upload_video_bytes

# Lecturer-only areas (uploading quizzes, viewing/marking submissions) require
# this PIN. It's sent as a header (X-Lecturer-Pin) on those requests.
# This is intentionally simple (a shared PIN, not per-user accounts).
# For anything beyond a small trusted class, move this to an environment
# variable too (os.getenv("LECTURER_PIN", "90435")) so it isn't baked into
# the deployed code.
LECTURER_PIN = os.getenv("LECTURER_PIN", "90435")
LECTURER_SESSION_SECRET = os.getenv("LECTURER_SESSION_SECRET", LECTURER_PIN)
STUDENT_SESSION_SECRET = os.getenv("STUDENT_SESSION_SECRET", LECTURER_SESSION_SECRET)

# Optional convenience folder: images committed into the repo ahead of time
# (e.g. shipped alongside the code) can be referenced by filename in a quiz
# or lesson JSON's "image" field, without re-uploading them each time. This
# folder itself is part of the deployed code (not a runtime upload), so it
# persists across restarts/redeploys just fine — unlike runtime uploads,
# which must go to Cloudinary instead.
IMAGE_LIBRARY_DIR = "quiz_image_library"
os.makedirs(IMAGE_LIBRARY_DIR, exist_ok=True)

# App logo: drop a file named image.png in the same folder as this file and
# commit it to the repo — it will automatically appear in the frontend
# header. Optional — the app works fine without it. Because this is a
# repo-committed file (not a runtime upload), it survives Render redeploys.
LOGO_PATH = "image.png"

# Create tables on startup if they don't exist yet (equivalent of the old
# init_db()). For schema changes after the first deploy, prefer a proper
# migration tool (e.g. Alembic) over relying on this.
Base.metadata.create_all(bind=engine)

# Lightweight backward-compatible migration for installations created before
# quizzes had module codes. New databases get the column from models.py;
# existing databases are upgraded in place without deleting quiz data.
def ensure_quiz_module_code():
    if "module_code" not in {column["name"] for column in inspect(engine).get_columns("quizzes")}:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE quizzes ADD COLUMN module_code VARCHAR(64) DEFAULT 'GENERAL'"))
            conn.execute(text("UPDATE quizzes SET module_code = 'GENERAL' WHERE module_code IS NULL OR module_code = ''"))
    with engine.begin() as conn:
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_quizzes_module_code ON quizzes (module_code)"))


ensure_quiz_module_code()


def ensure_lecturer_ownership_schema():
    """Add ownership columns to installations created before lecturer accounts."""
    for table in ("quizzes", "lessons"):
        if "lecturer_id" not in {column["name"] for column in inspect(engine).get_columns(table)}:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN lecturer_id INTEGER"))
        with engine.begin() as conn:
            conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table}_lecturer_id ON {table} (lecturer_id)"))


ensure_lecturer_ownership_schema()

app = FastAPI(title="Quiz + Video Lessons App")

# Wide-open CORS since this app has no per-user accounts; the PIN gates the
# lecturer-only routes instead.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic request/response models
# ---------------------------------------------------------------------------

class StudentAnswer(BaseModel):
    question_id: int
    answer: str


class QuizSubmission(BaseModel):
    student_id: str
    student_name: str
    answers: List[StudentAnswer]


class LongAnswerMark(BaseModel):
    question_id: int
    awarded_marks: float


class MarkSubmissionRequest(BaseModel):
    marks: List[LongAnswerMark]


class PinCheck(BaseModel):
    pin: str


class CommentCreate(BaseModel):
    author_name: str
    comment_text: str
    is_lecturer: bool = False


class FunPostCreate(BaseModel):
    content: str
    is_anonymous: bool = False
    parent_id: Optional[int] = None


class AdminQuestionInput(BaseModel):
    type: str
    question: str
    options: Optional[List[str]] = None
    correct_answer: Optional[str] = None
    marks: float = 1
    image_url: Optional[str] = None


class AdminQuizInput(BaseModel):
    title: str
    module_code: str = "GENERAL"
    questions: List[AdminQuestionInput]


class AdminLessonInput(BaseModel):
    title: str
    description: str = ""
    module_code: str
    video_url: str
    questions: List[AdminQuestionInput]


class LecturerLogin(BaseModel):
    email: str
    password: str


class AdminLecturerInput(BaseModel):
    full_name: str
    email: str
    password: str
    phone: str = ""
    institution: str = ""
    bio: str = ""
    approved: bool = False
    active: bool = True
    module_limit: int = 1
    module_codes: List[str] = []


class AdminLecturerUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    institution: Optional[str] = None
    bio: Optional[str] = None
    approved: Optional[bool] = None
    active: Optional[bool] = None
    module_limit: Optional[int] = None
    module_codes: Optional[List[str]] = None


class PasswordReset(BaseModel):
    password: str


class StudentLogin(BaseModel):
    identifier: str
    password: str


class AdminStudentUpdate(BaseModel):
    approved: Optional[bool] = None
    active: Optional[bool] = None


class AdminStudentCreate(BaseModel):
    student_number: str
    full_name: str
    email: str
    password: str
    approved: bool = False
    active: bool = True


def _password_hash(password: str, salt: Optional[str] = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 210_000).hex()
    return f"{salt}${digest}"


def _password_matches(password: str, stored: str) -> bool:
    try:
        salt, _ = stored.split("$", 1)
    except ValueError:
        return False
    return hmac.compare_digest(_password_hash(password, salt), stored)


def _issue_lecturer_token(lecturer_id: int) -> str:
    expires = int((datetime.now(timezone.utc) + timedelta(hours=12)).timestamp())
    payload = f"{lecturer_id}:{expires}".encode("utf-8")
    signature = hmac.new(LECTURER_SESSION_SECRET.encode("utf-8"), payload, hashlib.sha256).digest()
    return f"{base64.urlsafe_b64encode(payload).decode().rstrip('=')}.{base64.urlsafe_b64encode(signature).decode().rstrip('=')}"


def _issue_student_token(student_id: int) -> str:
    expires = int((datetime.now(timezone.utc) + timedelta(hours=12)).timestamp())
    payload = f"{student_id}:{expires}".encode("utf-8")
    signature = hmac.new(STUDENT_SESSION_SECRET.encode("utf-8"), payload, hashlib.sha256).digest()
    return f"{base64.urlsafe_b64encode(payload).decode().rstrip('=')}.{base64.urlsafe_b64encode(signature).decode().rstrip('=')}"


def _lecturer_id_from_token(token: Optional[str]) -> int:
    if not token or "." not in token:
        raise HTTPException(status_code=401, detail="Sign in as a lecturer first")
    encoded_payload, encoded_signature = token.split(".", 1)
    try:
        payload = base64.urlsafe_b64decode(encoded_payload + "=" * (-len(encoded_payload) % 4))
        signature = base64.urlsafe_b64decode(encoded_signature + "=" * (-len(encoded_signature) % 4))
        expected = hmac.new(LECTURER_SESSION_SECRET.encode("utf-8"), payload, hashlib.sha256).digest()
        lecturer_id_text, expires_text = payload.decode("utf-8").split(":", 1)
        if not hmac.compare_digest(signature, expected) or int(expires_text) < int(datetime.now(timezone.utc).timestamp()):
            raise ValueError
        return int(lecturer_id_text)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=401, detail="Your lecturer session has expired. Sign in again.")


def _student_id_from_token(token: Optional[str]) -> int:
    if not token or "." not in token:
        raise HTTPException(status_code=401, detail="Sign in as a student first")
    encoded_payload, encoded_signature = token.split(".", 1)
    try:
        payload = base64.urlsafe_b64decode(encoded_payload + "=" * (-len(encoded_payload) % 4))
        signature = base64.urlsafe_b64decode(encoded_signature + "=" * (-len(encoded_signature) % 4))
        expected = hmac.new(STUDENT_SESSION_SECRET.encode("utf-8"), payload, hashlib.sha256).digest()
        student_id_text, expires_text = payload.decode("utf-8").split(":", 1)
        if not hmac.compare_digest(signature, expected) or int(expires_text) < int(datetime.now(timezone.utc).timestamp()):
            raise ValueError
        return int(student_id_text)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=401, detail="Your student session has expired. Sign in again.")


def require_lecturer_account(
    x_lecturer_token: Optional[str] = Header(None, alias="X-Lecturer-Token"),
    db: Session = Depends(get_db),
) -> Lecturer:
    lecturer = db.query(Lecturer).filter(Lecturer.id == _lecturer_id_from_token(x_lecturer_token)).first()
    if not lecturer or not lecturer.active or not lecturer.approved:
        raise HTTPException(status_code=403, detail="Your lecturer account is not active and approved")
    return lecturer


def require_student_account(
    x_student_token: Optional[str] = Header(None, alias="X-Student-Token"),
    db: Session = Depends(get_db),
) -> Student:
    student = db.query(Student).filter(Student.id == _student_id_from_token(x_student_token)).first()
    if not student or not student.active or not student.approved:
        raise HTTPException(status_code=403, detail="Your student profile is not active and approved")
    return student


def _student_profile(student: Student) -> dict:
    return {"id": student.id, "student_number": student.student_number, "full_name": student.full_name,
            "email": student.email, "phone": student.phone or "", "institution": student.institution or "",
            "bio": student.bio or "", "profile_image_url": student.profile_image_url,
            "approved": student.approved, "active": student.active, "created_at": student.created_at}


def _lecturer_profile(lecturer: Lecturer) -> dict:
    return {
        "id": lecturer.id, "full_name": lecturer.full_name, "email": lecturer.email,
        "phone": lecturer.phone or "", "institution": lecturer.institution or "",
        "bio": lecturer.bio or "", "profile_image_url": lecturer.profile_image_url,
        "approved": lecturer.approved, "active": lecturer.active,
        "module_limit": lecturer.module_limit,
        "module_codes": [item.module_code for item in lecturer.modules],
        "created_at": lecturer.created_at,
    }


def _set_lecturer_modules(db: Session, lecturer: Lecturer, module_codes: List[str], module_limit: int):
    normalized = sorted({code.strip().upper() for code in module_codes if code and code.strip()})
    if module_limit < 0 or len(normalized) > module_limit:
        raise HTTPException(status_code=400, detail="The module assignments exceed this lecturer's module limit")
    # Reconcile assignments instead of deleting and recreating all of them.
    # This avoids temporarily inserting a duplicate `(lecturer_id, module_code)`
    # when an administrator approves an already-assigned lecturer.
    existing = {item.module_code: item for item in lecturer.modules}
    wanted = set(normalized)
    for code, item in existing.items():
        if code not in wanted:
            db.delete(item)
    for code in wanted - set(existing):
        db.add(LecturerModule(lecturer_id=lecturer.id, module_code=code))


def _require_module_access(db: Session, lecturer: Lecturer, module_code: str):
    code = (module_code or "").strip().upper()
    allowed = db.query(LecturerModule).filter(LecturerModule.lecturer_id == lecturer.id, LecturerModule.module_code == code).first()
    if not allowed:
        raise HTTPException(status_code=403, detail=f"You are not assigned to the {code} module")
    return code


def _require_owned_quiz(db: Session, quiz_id: int, lecturer: Lecturer) -> Quiz:
    quiz = db.query(Quiz).filter(Quiz.id == quiz_id, Quiz.lecturer_id == lecturer.id).first()
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found in your lecturer workspace")
    return quiz


def _require_owned_lesson(db: Session, lesson_id: int, lecturer: Lecturer) -> Lesson:
    lesson = db.query(Lesson).filter(Lesson.id == lesson_id, Lesson.lecturer_id == lecturer.id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found in your lecturer workspace")
    return lesson


def require_lecturer_pin(x_lecturer_pin: Optional[str] = Header(None, alias="X-Lecturer-Pin")):
    """Dependency guarding lecturer-only routes. Send the PIN as the
    'X-Lecturer-Pin' header. Raises 401 if it's missing or wrong."""
    if x_lecturer_pin != LECTURER_PIN:
        raise HTTPException(status_code=401, detail="Incorrect or missing lecturer PIN")
    return True


@app.post("/lecturer/verify-pin")
def verify_pin(payload: PinCheck):
    """Used by the lecturer login screen to check a PIN before unlocking the UI."""
    if payload.pin != LECTURER_PIN:
        raise HTTPException(status_code=401, detail="Incorrect PIN")
    return {"ok": True}


@app.post("/lecturers/register")
async def register_lecturer(
    full_name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    phone: str = Form(""),
    institution: str = Form(""),
    bio: str = Form(""),
    profile_image: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    email = email.strip().lower()
    if not full_name.strip() or "@" not in email or len(password) < 8:
        raise HTTPException(status_code=400, detail="Provide a full name, valid email, and a password of at least 8 characters")
    if db.query(Lecturer).filter(Lecturer.email == email).first():
        raise HTTPException(status_code=409, detail="A lecturer profile already uses this email")
    image_url = None
    if profile_image and profile_image.filename:
        image_url = upload_image_bytes(await profile_image.read(), folder="lecturer_profiles")
    lecturer = Lecturer(
        full_name=full_name.strip(), email=email, password_hash=_password_hash(password),
        phone=phone.strip(), institution=institution.strip(), bio=bio.strip(),
        profile_image_url=image_url, approved=False, active=True, module_limit=1,
        created_at=datetime.utcnow().isoformat() + "Z",
    )
    db.add(lecturer)
    db.commit()
    return {"ok": True, "message": "Profile created. An administrator must approve it and assign modules before you can sign in."}


@app.post("/lecturers/login")
def lecturer_login(payload: LecturerLogin, db: Session = Depends(get_db)):
    lecturer = db.query(Lecturer).filter(Lecturer.email == payload.email.strip().lower()).first()
    if not lecturer:
        raise HTTPException(status_code=401, detail="No lecturer profile was found for this email")
    if not _password_matches(payload.password, lecturer.password_hash):
        raise HTTPException(status_code=401, detail="Password does not match this lecturer profile. Ask the administrator to reset it.")
    if not lecturer.active:
        raise HTTPException(status_code=403, detail="This lecturer profile is inactive")
    if not lecturer.approved:
        raise HTTPException(status_code=403, detail="Your profile is waiting for administrator approval")
    return {"token": _issue_lecturer_token(lecturer.id), "lecturer": _lecturer_profile(lecturer)}


@app.get("/lecturer/me")
def lecturer_me(lecturer: Lecturer = Depends(require_lecturer_account)):
    return _lecturer_profile(lecturer)


@app.put("/lecturer/me")
async def update_lecturer_me(
    full_name: str = Form(...),
    phone: str = Form(""),
    institution: str = Form(""),
    bio: str = Form(""),
    profile_image: Optional[UploadFile] = File(None),
    lecturer: Lecturer = Depends(require_lecturer_account),
    db: Session = Depends(get_db),
):
    lecturer.full_name, lecturer.phone = full_name.strip(), phone.strip()
    lecturer.institution, lecturer.bio = institution.strip(), bio.strip()
    if profile_image and profile_image.filename:
        lecturer.profile_image_url = upload_image_bytes(await profile_image.read(), folder="lecturer_profiles")
    db.commit()
    return _lecturer_profile(lecturer)


@app.post("/students/register")
async def register_student(
    student_number: str = Form(...), full_name: str = Form(...), email: str = Form(...),
    password: str = Form(...), confirm_password: str = Form(...), phone: str = Form(""),
    institution: str = Form(""), bio: str = Form(""), profile_image: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    student_number, email = student_number.strip().upper(), email.strip().lower()
    if not student_number or not full_name.strip() or "@" not in email or len(password) < 8:
        raise HTTPException(status_code=400, detail="Provide a student number, full name, valid email, and a password of at least 8 characters")
    if password != confirm_password:
        raise HTTPException(status_code=400, detail="The password confirmation does not match")
    if db.query(Student).filter((Student.student_number == student_number) | (Student.email == email)).first():
        raise HTTPException(status_code=409, detail="A student profile already uses this student number or email")
    image_url = upload_image_bytes(await profile_image.read(), folder="student_profiles") if profile_image and profile_image.filename else None
    student = Student(student_number=student_number, full_name=full_name.strip(), email=email,
                      phone=phone.strip(), institution=institution.strip(), bio=bio.strip(), profile_image_url=image_url,
                      password_hash=_password_hash(password), approved=False, active=True,
                      created_at=datetime.utcnow().isoformat() + "Z")
    db.add(student); db.commit()
    return {"ok": True, "message": "Profile created. An administrator must approve it before you can sign in."}


@app.post("/students/login")
def student_login(payload: StudentLogin, db: Session = Depends(get_db)):
    identifier = payload.identifier.strip()
    student = db.query(Student).filter((Student.student_number == identifier.upper()) | (Student.email == identifier.lower())).first()
    if not student:
        raise HTTPException(status_code=401, detail="No student profile was found for this student number or email")
    if not _password_matches(payload.password, student.password_hash):
        raise HTTPException(status_code=401, detail="Password does not match this student profile. Ask the administrator to reset it.")
    if not student.active:
        raise HTTPException(status_code=403, detail="This student profile is inactive")
    if not student.approved:
        raise HTTPException(status_code=403, detail="Your profile is waiting for administrator approval")
    return {"token": _issue_student_token(student.id), "student": _student_profile(student)}


@app.get("/student/me")
def student_me(student: Student = Depends(require_student_account)):
    return _student_profile(student)


@app.put("/student/me")
async def update_student_me(
    full_name: str = Form(...),
    phone: str = Form(""),
    institution: str = Form(""),
    bio: str = Form(""),
    profile_image: Optional[UploadFile] = File(None),
    student: Student = Depends(require_student_account),
    db: Session = Depends(get_db),
):
    """Let an approved student update their profile without changing access settings."""
    if not full_name.strip():
        raise HTTPException(status_code=400, detail="Full name is required")

    student.full_name = full_name.strip()
    student.phone = phone.strip()
    student.institution = institution.strip()
    student.bio = bio.strip()

    if profile_image and profile_image.filename:
        student.profile_image_url = upload_image_bytes(
            await profile_image.read(), folder="student_profiles"
        )

    db.commit()
    db.refresh(student)
    return _student_profile(student)


# ---------------------------------------------------------------------------
# App logo — serves image.png from the app's working directory if present.
# ---------------------------------------------------------------------------

@app.get("/branding/logo")
def get_logo():
    if not os.path.isfile(LOGO_PATH):
        raise HTTPException(status_code=404, detail="No logo uploaded (add image.png to the app folder)")
    return FileResponse(LOGO_PATH, media_type="image/png")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def normalize(text: Optional[str]) -> str:
    return (text or "").strip().lower()


def short_answer_words(text: Optional[str]) -> list[str]:
    """Return a punctuation-insensitive list of words for a short answer."""
    return re.findall(r"[\w]+", normalize(text), flags=re.UNICODE)


def _small_spelling_variation(expected: str, actual: str) -> bool:
    """Accept a small typo while keeping short-answer marking conservative."""
    if expected == actual:
        return True
    if len(expected) < 3 or len(actual) < 3:
        return False
    return SequenceMatcher(None, expected, actual).ratio() >= 0.80


def short_answer_matches(expected_answer: Optional[str], student_answer: Optional[str]) -> bool:
    """Case-insensitive, order-independent matching for one- or two-word
    short answers, with support for small spelling variations."""
    expected_words = short_answer_words(expected_answer)
    student_words = short_answer_words(student_answer)
    if not expected_words or len(expected_words) > 2 or len(student_words) > 2:
        return False
    if len(expected_words) != len(student_words):
        return False
    return any(
        all(_small_spelling_variation(expected, actual) for expected, actual in zip(expected_words, candidate))
        for candidate in permutations(student_words)
    )


def validate_short_answer_length(answer: Optional[str], question_label: str):
    if len(short_answer_words(answer)) > 2:
        raise HTTPException(status_code=422, detail=f"{question_label} accepts a maximum of two words")


def _pdf_escape(text: Optional[str]) -> str:
    """Escape text for safe use inside a reportlab Paragraph (which parses
    a small XML-like markup)."""
    return (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


SAST = timezone(timedelta(hours=2))  # South African Standard Time, no daylight saving


def format_sast(iso_utc_string: Optional[str]) -> str:
    """Format a stored UTC ISO timestamp (e.g. '2026-07-18T10:00:00.123456Z')
    as South African time for display in generated PDFs."""
    if not iso_utc_string:
        return ""
    try:
        cleaned = iso_utc_string.rstrip("Z")
        dt = datetime.fromisoformat(cleaned).replace(tzinfo=timezone.utc)
        return dt.astimezone(SAST).strftime("%d %b %Y, %H:%M:%S SAST")
    except ValueError:
        return iso_utc_string  # fall back to showing the raw value rather than failing


def resolve_question_image(
    raw_image: Optional[str],
    uploaded_bytes_by_name: dict,
    resolved_cache: dict,
    cloud_folder: str,
    question_label: str,
) -> Optional[str]:
    """Resolve a question's "image" JSON field to a permanent URL, trying
    (in order):
      1. Already a full URL (http:// or https://) -> use as-is.
      2. A filename uploaded alongside this request (the "images" field) ->
         upload those bytes to Cloudinary.
      3. A filename that exists in the local image library folder (a
         repo-committed asset, not a runtime upload) -> upload it to
         Cloudinary.
      4. A relative/absolute path that exists on local disk -> same.
    Raises HTTPException if none of these resolve. Returns None if no image
    was requested at all.
    """
    if not raw_image:
        return None

    if raw_image.startswith("http://") or raw_image.startswith("https://"):
        return raw_image

    if raw_image in resolved_cache:
        return resolved_cache[raw_image]

    candidate_name = os.path.basename(raw_image)

    if candidate_name in uploaded_bytes_by_name:
        url = upload_image_bytes(uploaded_bytes_by_name[candidate_name], folder=cloud_folder)
        resolved_cache[raw_image] = url
        return url

    library_path = os.path.join(IMAGE_LIBRARY_DIR, candidate_name)
    direct_path = raw_image
    source_path = library_path if os.path.isfile(library_path) else (
        direct_path if os.path.isfile(direct_path) else None
    )

    if source_path:
        with open(source_path, "rb") as f:
            url = upload_image_bytes(f.read(), folder=cloud_folder)
        resolved_cache[raw_image] = url
        return url

    raise HTTPException(
        status_code=400,
        detail=(
            f"{question_label} references image '{raw_image}', but it wasn't found. "
            "Either attach it in the 'images' field alongside the upload, place it "
            f"in '{IMAGE_LIBRARY_DIR}/', reference a direct http(s) URL, or make sure "
            "the path is correct relative to the app folder."
        ),
    )


def image_reference_resolvable(raw_image: Optional[str], uploaded_names: set) -> bool:
    """Cheap existence check for a question's "image" field, without
    actually uploading anything — used to validate lesson uploads before
    spending time uploading a (potentially large) video file."""
    if not raw_image:
        return True
    if raw_image.startswith("http://") or raw_image.startswith("https://"):
        return True
    candidate_name = os.path.basename(raw_image)
    if candidate_name in uploaded_names:
        return True
    if os.path.isfile(os.path.join(IMAGE_LIBRARY_DIR, candidate_name)):
        return True
    if os.path.isfile(raw_image):
        return True
    return False


def build_submission_pdf(db: Session, submission_id: int, styles, include_expected_answers: bool = True) -> list:
    """Return a list of reportlab flowables for one student's marked quiz
    submission: header info, each question with its image (if any), the
    student's answer, marks awarded, and a final total."""
    submission = db.query(Submission).filter(Submission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail=f"Submission {submission_id} not found")

    quiz = db.query(Quiz).filter(Quiz.id == submission.quiz_id).first()
    answers = (
        db.query(Answer)
        .join(Question, Answer.question_id == Question.id)
        .filter(Answer.submission_id == submission_id)
        .order_by(Question.q_order)
        .all()
    )

    flow = []
    flow.append(Paragraph(_pdf_escape(quiz.title), styles["QuizTitle"]))
    flow.append(Paragraph(
        f"Student: {_pdf_escape(submission.student_name)} &nbsp;&nbsp;|&nbsp;&nbsp; "
        f"ID: {_pdf_escape(submission.student_id)} &nbsp;&nbsp;|&nbsp;&nbsp; "
        f"Submitted: {_pdf_escape(format_sast(submission.submitted_at))}",
        styles["MetaLine"],
    ))
    status = "Fully marked" if submission.fully_marked else "Some questions still pending marking"
    flow.append(Paragraph(
        f"Total score: <b>{submission.total_score} / {submission.max_score}</b> "
        f"&nbsp;&nbsp;({_pdf_escape(status)})",
        styles["ScoreLine"],
    ))
    flow.append(Spacer(1, 0.5 * cm))

    for i, a in enumerate(answers, start=1):
        q = a.question
        flow.append(Paragraph(
            f"Q{i}. {_pdf_escape(q.question)} "
            f"<font size=9 color='#4A5568'>[{q.marks} mark{'s' if q.marks != 1 else ''}]</font>",
            styles["Question"],
        ))

        if q.image_url:
            try:
                with urllib.request.urlopen(q.image_url, timeout=10) as resp:
                    img_bytes = resp.read()
                buf = io.BytesIO(img_bytes)
                with PILImage.open(buf) as pil_img:
                    px_w, px_h = pil_img.size
                buf.seek(0)
                max_width = 14 * cm
                max_height = 8 * cm
                scale = min(max_width / px_w, max_height / px_h, 1.0)
                disp_w, disp_h = px_w * scale, px_h * scale
                flow.append(RLImage(buf, width=disp_w, height=disp_h))
                flow.append(Spacer(1, 0.15 * cm))
            except Exception:
                pass  # if the image can't be fetched, just skip it rather than fail the whole PDF

        answer_text = a.answer_text or "(no answer given)"
        flow.append(Paragraph(f"<b>Student's answer:</b> {_pdf_escape(answer_text)}", styles["Answer"]))

        if include_expected_answers and q.type in ("mcq", "short") and q.correct_answer:
            flow.append(Paragraph(f"<b>Expected answer:</b> {_pdf_escape(q.correct_answer)}", styles["Expected"]))

        if a.awarded_marks is None:
            flow.append(Paragraph(
                f"<b>Marks awarded:</b> <font color='#C81E3A'><b>Needs marking</b></font> / {q.marks}",
                styles["Marks"],
            ))
        else:
            flow.append(Paragraph(f"<b>Marks awarded:</b> {a.awarded_marks} / {q.marks}", styles["Marks"]))
        flow.append(Spacer(1, 0.35 * cm))

    return flow


def build_pdf_stylesheet():
    """Reportlab paragraph styles used across the marked-answers PDFs."""
    base = getSampleStyleSheet()
    base.add(ParagraphStyle(name="QuizTitle", fontSize=17, leading=21, spaceAfter=6, fontName="Helvetica-Bold"))
    base.add(ParagraphStyle(name="MetaLine", fontSize=10, textColor=colors.HexColor("#4A5568"), spaceAfter=4))
    base.add(ParagraphStyle(name="ScoreLine", fontSize=12, textColor=colors.HexColor("#B5322A"), spaceAfter=10))
    base.add(ParagraphStyle(name="Question", fontSize=11, fontName="Helvetica-Bold", spaceAfter=4))
    base.add(ParagraphStyle(name="Answer", fontSize=10, leftIndent=10, spaceAfter=3))
    base.add(ParagraphStyle(name="Expected", fontSize=10, leftIndent=10, spaceAfter=3, textColor=colors.HexColor("#1C2541"), fontName="Helvetica-Oblique"))
    base.add(ParagraphStyle(name="Marks", fontSize=10, leftIndent=10, textColor=colors.HexColor("#2F6D4F")))
    return base


# ===========================================================================
# QUIZZES
# ===========================================================================

# ---------------------------------------------------------------------------
# Lecturer: upload a quiz from a JSON file (optionally with image files)
# ---------------------------------------------------------------------------
#
# Expected JSON structure:
# {
#   "title": "Chapter 1 Quiz",
#   "questions": [
#     { "type": "mcq", "question": "...", "options": [...], "answer": "...", "marks": 1 },
#     { "type": "short", "question": "...", "image": "cell_diagram.png", "answer": "...", "marks": 2 },
#     { "type": "long", "question": "...", "marks": 10 }
#   ]
# }
#
# The optional "image" field on a question can point to a picture as:
#   1. A direct http(s) URL -> used as-is.
#   2. A filename you also attach in the SAME request's "images" field.
#   3. A filename already in quiz_image_library/ (a repo-committed asset).
#   4. A relative/absolute path that exists on disk.
# Whichever way it's found, the image is uploaded to Cloudinary once and
# its permanent URL is stored against the question.

@app.post("/quiz/upload")
async def upload_quiz(
    file: UploadFile = File(...),
    module_code: str = Form("GENERAL"),
    images: List[UploadFile] = File(default=[]),
    lecturer: Lecturer = Depends(require_lecturer_account),
    db: Session = Depends(get_db),
):
    content = await file.read()
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON file")

    title = data.get("title", "Untitled Quiz")
    questions = data.get("questions", [])
    if not questions:
        raise HTTPException(status_code=400, detail="Quiz JSON must include a 'questions' list")

    module_code = _require_module_access(db, lecturer, module_code)
    quiz = Quiz(title=title, module_code=module_code, lecturer_id=lecturer.id, created_at=datetime.utcnow().isoformat() + "Z")
    db.add(quiz)
    db.flush()  # assigns quiz.id without committing yet

    # Read any images uploaded alongside this request into memory, keyed by
    # their original filename, so questions can reference them by name.
    uploaded_bytes_by_name = {}
    for img in images:
        if not img.filename:
            continue
        uploaded_bytes_by_name[os.path.basename(img.filename)] = await img.read()

    resolved_cache = {}
    cloud_folder = f"quiz_{quiz.id}"

    for order, q in enumerate(questions):
        q_type = q.get("type")
        if q_type not in ("mcq", "short", "long"):
            raise HTTPException(status_code=400, detail=f"Invalid question type: {q_type}")

        question_text = q.get("question")
        marks = q.get("marks", 1)
        options = q.get("options") if q_type == "mcq" else None
        answer = q.get("answer") if q_type in ("mcq", "short") else None

        if q_type == "mcq" and not options:
            raise HTTPException(status_code=400, detail="MCQ questions must include 'options'")
        if q_type in ("mcq", "short") and answer is None:
            raise HTTPException(status_code=400, detail=f"{q_type} questions must include an 'answer'")
        if q_type == "short" and len(short_answer_words(answer)) > 2:
            raise HTTPException(status_code=400, detail=f"Question {order + 1}: short-answer keys can contain a maximum of two words")

        image_url = resolve_question_image(
            q.get("image"), uploaded_bytes_by_name, resolved_cache,
            cloud_folder, f"Question {order + 1}",
        )

        db.add(Question(
            quiz_id=quiz.id,
            q_order=order,
            type=q_type,
            question=question_text,
            options_json=json.dumps(options) if options else None,
            correct_answer=answer,
            marks=marks,
            image_url=image_url,
        ))

    db.commit()
    return {
        "quiz_id": quiz.id,
        "title": title,
        "module_code": module_code,
        "num_questions": len(questions),
        "images_uploaded": len(resolved_cache),
    }


@app.get("/quizzes")
def list_quizzes(lecturer: Lecturer = Depends(require_lecturer_account), db: Session = Depends(get_db)):
    rows = db.query(Quiz).filter(Quiz.lecturer_id == lecturer.id).order_by(Quiz.id.desc()).all()
    return [{"id": r.id, "title": r.title, "module_code": r.module_code, "created_at": r.created_at} for r in rows]


@app.get("/quiz-modules")
def list_quiz_modules(db: Session = Depends(get_db)):
    rows = (
        db.query(Quiz.module_code, func.count(Quiz.id).label("quiz_count"))
        .group_by(Quiz.module_code).order_by(Quiz.module_code.asc()).all()
    )
    return [{"module_code": code, "quiz_count": count} for code, count in rows]


@app.get("/quizzes/by-module/{module_code}")
def list_quizzes_by_module(module_code: str, db: Session = Depends(get_db)):
    rows = (db.query(Quiz).filter(Quiz.module_code == module_code.strip().upper()).order_by(Quiz.id.desc()).all())
    return [{"id": q.id, "title": q.title, "module_code": q.module_code, "created_at": q.created_at} for q in rows]


# ---------------------------------------------------------------------------
# Student: fetch a quiz (answers hidden)
# ---------------------------------------------------------------------------

@app.get("/quiz/{quiz_id}")
def get_quiz(quiz_id: int, db: Session = Depends(get_db)):
    quiz = db.query(Quiz).filter(Quiz.id == quiz_id).first()
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")

    out_questions = []
    for q in quiz.questions:  # already ordered by q_order via the relationship
        item = {
            "question_id": q.id,
            "type": q.type,
            "question": q.question,
            "marks": q.marks,
            "image_url": q.image_url,
        }
        if q.type == "mcq":
            item["options"] = json.loads(q.options_json)
        out_questions.append(item)

    return {"quiz_id": quiz.id, "title": quiz.title, "module_code": quiz.module_code, "questions": out_questions}


# ---------------------------------------------------------------------------
# Student: submit answers -> auto-mark mcq & short, leave long ungraded
# ---------------------------------------------------------------------------

@app.post("/quiz/{quiz_id}/submit")
def submit_quiz(quiz_id: int, submission: QuizSubmission, student: Student = Depends(require_student_account), db: Session = Depends(get_db)):
    questions = db.query(Question).filter(Question.quiz_id == quiz_id).all()
    if not questions:
        raise HTTPException(status_code=404, detail="Quiz not found")

    new_submission = Submission(
        quiz_id=quiz_id,
        student_id=student.student_number,
        student_name=student.full_name,
        submitted_at=datetime.utcnow().isoformat() + "Z",
        total_score=0,
        max_score=0,
        fully_marked=False,
    )
    db.add(new_submission)
    db.flush()

    max_score = 0.0
    auto_score = 0.0
    has_long_pending = False

    for q in questions:
        max_score += q.marks
        student_answer = next((a.answer for a in submission.answers if a.question_id == q.id), "")

        if q.type == "short":
            validate_short_answer_length(student_answer, f"Question {q.q_order + 1}")
            correct = short_answer_matches(q.correct_answer, student_answer)
            awarded = q.marks if correct else 0.0
            auto_score += awarded
            db.add(Answer(
                submission_id=new_submission.id, question_id=q.id,
                answer_text=student_answer, awarded_marks=awarded, marked=True,
            ))
        elif q.type == "mcq":
            correct = normalize(q.correct_answer) == normalize(student_answer)
            awarded = q.marks if correct else 0.0
            auto_score += awarded
            db.add(Answer(
                submission_id=new_submission.id, question_id=q.id,
                answer_text=student_answer, awarded_marks=awarded, marked=True,
            ))
        else:  # long -> needs manual marking
            has_long_pending = True
            db.add(Answer(
                submission_id=new_submission.id, question_id=q.id,
                answer_text=student_answer, awarded_marks=None, marked=False,
            ))

    new_submission.total_score = auto_score
    new_submission.max_score = max_score
    new_submission.fully_marked = not has_long_pending
    db.commit()

    return {
        "submission_id": new_submission.id,
        "auto_marked_score": auto_score,
        "max_score": max_score,
        "fully_marked": not has_long_pending,
        "message": "Long-answer questions still need lecturer marking." if has_long_pending else "Fully marked.",
    }


# ---------------------------------------------------------------------------
# Lecturer: view submissions for a quiz (including pending long answers)
# ---------------------------------------------------------------------------

@app.get("/lecturer/quiz/{quiz_id}/submissions")
def list_submissions(quiz_id: int, lecturer: Lecturer = Depends(require_lecturer_account), db: Session = Depends(get_db)):
    _require_owned_quiz(db, quiz_id, lecturer)
    rows = (
        db.query(Submission)
        .filter(Submission.quiz_id == quiz_id)
        .order_by(Submission.submitted_at.desc())
        .all()
    )
    return [
        {
            "id": s.id, "student_id": s.student_id, "student_name": s.student_name,
            "submitted_at": s.submitted_at, "total_score": s.total_score,
            "max_score": s.max_score, "fully_marked": s.fully_marked,
        }
        for s in rows
    ]


@app.get("/lecturer/submission/{submission_id}")
def get_submission_detail(submission_id: int, lecturer: Lecturer = Depends(require_lecturer_account), db: Session = Depends(get_db)):
    submission = db.query(Submission).filter(Submission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    _require_owned_quiz(db, submission.quiz_id, lecturer)

    answers = (
        db.query(Answer)
        .join(Question, Answer.question_id == Question.id)
        .filter(Answer.submission_id == submission_id)
        .order_by(Question.q_order)
        .all()
    )

    answer_dicts = []
    for a in answers:
        q = a.question
        answer_dicts.append({
            "answer_id": a.id, "question_id": a.question_id, "answer_text": a.answer_text,
            "awarded_marks": a.awarded_marks, "marked": a.marked,
            "type": q.type, "question": q.question, "max_marks": q.marks,
            "correct_answer": q.correct_answer, "image_url": q.image_url,
        })

    return {
        "submission": {
            "id": submission.id, "quiz_id": submission.quiz_id,
            "student_id": submission.student_id, "student_name": submission.student_name,
            "submitted_at": submission.submitted_at, "total_score": submission.total_score,
            "max_score": submission.max_score, "fully_marked": submission.fully_marked,
        },
        "answers": answer_dicts,
    }


# ---------------------------------------------------------------------------
# Lecturer: manually mark long-answer questions, or override short-answer
# auto-marking, for a submission
# ---------------------------------------------------------------------------

@app.post("/lecturer/submission/{submission_id}/mark")
def mark_answers(submission_id: int, payload: MarkSubmissionRequest, lecturer: Lecturer = Depends(require_lecturer_account), db: Session = Depends(get_db)):
    submission = db.query(Submission).filter(Submission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    _require_owned_quiz(db, submission.quiz_id, lecturer)

    for m in payload.marks:
        answer = (
            db.query(Answer)
            .join(Question, Answer.question_id == Question.id)
            .filter(
                Answer.submission_id == submission_id,
                Answer.question_id == m.question_id,
                Question.type.in_(("long", "short")),
            )
            .first()
        )
        if not answer:
            continue  # ignore unknown / mcq question ids silently (low-standard app)

        awarded = min(m.awarded_marks, answer.question.marks)
        answer.awarded_marks = awarded
        answer.marked = True

    all_answers = db.query(Answer).filter(Answer.submission_id == submission_id).all()
    still_pending = any(not a.marked for a in all_answers)
    total = sum(a.awarded_marks or 0 for a in all_answers)

    submission.total_score = total
    submission.fully_marked = not still_pending
    db.commit()

    return {
        "submission_id": submission_id,
        "total_score": total,
        "fully_marked": not still_pending,
    }


# ---------------------------------------------------------------------------
# Lecturer: download marked answers as a PDF
# ---------------------------------------------------------------------------

@app.get("/lecturer/submission/{submission_id}/pdf")
def download_submission_pdf(submission_id: int, lecturer: Lecturer = Depends(require_lecturer_account), db: Session = Depends(get_db)):
    submission = db.query(Submission).filter(Submission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    _require_owned_quiz(db, submission.quiz_id, lecturer)
    styles = build_pdf_stylesheet()
    flow = build_submission_pdf(db, submission_id, styles)
    submission = db.query(Submission).filter(Submission.id == submission_id).first()

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=2 * cm, bottomMargin=2 * cm, leftMargin=2 * cm, rightMargin=2 * cm)
    doc.build(flow)
    buffer.seek(0)

    safe_name = "".join(c for c in (submission.student_name or "student") if c.isalnum() or c in (" ", "_", "-")).strip() or "student"
    filename = f"{safe_name}_answers.pdf"
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/student/submission/{submission_id}/pdf")
def download_student_submission_pdf(submission_id: int, student: Student = Depends(require_student_account), db: Session = Depends(get_db)):
    """Download a student's own script with responses, expected answers, and marks."""
    submission = db.query(Submission).filter(Submission.id == submission_id).first()
    if not submission or submission.student_id != student.student_number:
        raise HTTPException(status_code=404, detail="Submission not found")
    quiz = db.query(Quiz).filter(Quiz.id == submission.quiz_id).first()
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=2 * cm, bottomMargin=2 * cm, leftMargin=2 * cm, rightMargin=2 * cm)
    doc.build(build_submission_pdf(db, submission_id, build_pdf_stylesheet(), include_expected_answers=True))
    buffer.seek(0)
    safe_title = "".join(c for c in quiz.title if c.isalnum() or c in (" ", "_", "-")).strip() or "quiz"
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{safe_title}_my_script.pdf"'})


@app.get("/lecturer/quiz/{quiz_id}/pdf")
def download_quiz_pdf(quiz_id: int, lecturer: Lecturer = Depends(require_lecturer_account), db: Session = Depends(get_db)):
    """Download every submission for a quiz as one combined PDF, one
    student's marked answers per section (page break between students)."""
    quiz = db.query(Quiz).filter(Quiz.id == quiz_id).first()
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    if quiz.lecturer_id != lecturer.id:
        raise HTTPException(status_code=404, detail="Quiz not found in your lecturer workspace")

    submission_ids = [
        s.id for s in db.query(Submission)
        .filter(Submission.quiz_id == quiz_id)
        .order_by(Submission.student_name)
        .all()
    ]
    if not submission_ids:
        raise HTTPException(status_code=404, detail="No submissions yet for this quiz")

    styles = build_pdf_stylesheet()
    flow = []
    for i, sid in enumerate(submission_ids):
        flow.extend(build_submission_pdf(db, sid, styles))
        if i < len(submission_ids) - 1:
            flow.append(PageBreak())

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=2 * cm, bottomMargin=2 * cm, leftMargin=2 * cm, rightMargin=2 * cm)
    doc.build(flow)
    buffer.seek(0)

    safe_title = "".join(c for c in quiz.title if c.isalnum() or c in (" ", "_", "-")).strip() or "quiz"
    filename = f"{safe_title}_all_answers.pdf"
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ===========================================================================
# VIDEO LESSONS
# ===========================================================================

# ---------------------------------------------------------------------------
# Lecturer: upload a video lesson (video file + a JSON file describing the
# comprehension questions, plus optional question images), tagged with a
# module code so students can browse lessons for just their module.
# ---------------------------------------------------------------------------

@app.post("/lecturer/lesson/upload")
async def upload_lesson(
    file: UploadFile = File(...),
    video: UploadFile = File(...),
    module_code: str = Form(...),
    images: List[UploadFile] = File(default=[]),
    lecturer: Lecturer = Depends(require_lecturer_account),
    db: Session = Depends(get_db),
):
    content = await file.read()
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON file")

    title = data.get("title", "Untitled Lesson")
    description = data.get("description", "")
    questions = data.get("questions", [])
    if not questions:
        raise HTTPException(status_code=400, detail="Lesson JSON must include a 'questions' list")

    if not video.filename:
        raise HTTPException(status_code=400, detail="A video file is required")

    module_code = _require_module_access(db, lecturer, module_code)

    # Validate question structure up front (type, options, answer, and that
    # any referenced image can actually be found) before uploading the
    # video — no point spending time/bandwidth on a large video file if the
    # questions JSON is malformed or references a missing image.
    uploaded_bytes_by_name = {}
    for img in images:
        if not img.filename:
            continue
        uploaded_bytes_by_name[os.path.basename(img.filename)] = await img.read()

    for order, q in enumerate(questions):
        q_type = q.get("type")
        if q_type not in ("mcq", "short", "long"):
            raise HTTPException(status_code=400, detail=f"Invalid question type: {q_type}")
        if q_type == "mcq" and not q.get("options"):
            raise HTTPException(status_code=400, detail=f"Question {order + 1}: mcq questions must include 'options'")
        if q_type in ("mcq", "short") and q.get("answer") is None:
            raise HTTPException(status_code=400, detail=f"Question {order + 1}: {q_type} questions must include an 'answer'")
        if not image_reference_resolvable(q.get("image"), set(uploaded_bytes_by_name.keys())):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Question {order + 1} references image '{q.get('image')}', but it wasn't "
                    f"found. Either attach it in the 'images' field, place it in "
                    f"'{IMAGE_LIBRARY_DIR}/', reference a direct http(s) URL, or make sure "
                    "the path is correct relative to the app folder."
                ),
            )

    # Upload the video to Cloudinary first so we can create the Lesson row
    # in one step (no need for the old two-step "create row, then update
    # with the filename" dance that local-disk storage required).
    video_bytes = await video.read()
    video_url = upload_video_bytes(video_bytes, folder=f"lesson_videos/{module_code}")

    lesson = Lesson(
        title=title,
        description=description,
        module_code=module_code,
        lecturer_id=lecturer.id,
        video_url=video_url,
        created_at=datetime.utcnow().isoformat() + "Z",
    )
    db.add(lesson)
    db.flush()

    resolved_cache = {}
    cloud_folder = f"lesson_{lesson.id}"

    for order, q in enumerate(questions):
        q_type = q.get("type")
        if q_type not in ("mcq", "short", "long"):
            raise HTTPException(status_code=400, detail=f"Invalid question type: {q_type}")

        question_text = q.get("question")
        marks = q.get("marks", 1)
        options = q.get("options") if q_type == "mcq" else None
        answer = q.get("answer") if q_type in ("mcq", "short") else None

        if q_type == "mcq" and not options:
            raise HTTPException(status_code=400, detail="MCQ questions must include 'options'")
        if q_type in ("mcq", "short") and answer is None:
            raise HTTPException(status_code=400, detail=f"{q_type} questions must include an 'answer'")
        if q_type == "short" and len(short_answer_words(answer)) > 2:
            raise HTTPException(status_code=400, detail=f"Question {order + 1}: short-answer keys can contain a maximum of two words")

        image_url = resolve_question_image(
            q.get("image"), uploaded_bytes_by_name, resolved_cache,
            cloud_folder, f"Question {order + 1}",
        )

        db.add(LessonQuestion(
            lesson_id=lesson.id,
            q_order=order,
            type=q_type,
            question=question_text,
            options_json=json.dumps(options) if options else None,
            correct_answer=answer,
            marks=marks,
            image_url=image_url,
        ))

    db.commit()
    return {"lesson_id": lesson.id, "title": title, "module_code": module_code, "num_questions": len(questions)}


# ---------------------------------------------------------------------------
# Browsing lessons — public (no PIN) so students can browse the video
# library directly, similar to a course page.
# ---------------------------------------------------------------------------

@app.get("/lessons")
def list_lessons(module_code: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(Lesson)
    if module_code:
        query = query.filter(Lesson.module_code == module_code.strip().upper())
    rows = query.order_by(Lesson.id.desc()).all()
    return [
        {"id": l.id, "title": l.title, "description": l.description,
         "module_code": l.module_code, "created_at": l.created_at}
        for l in rows
    ]


@app.get("/lecturer/lessons")
def list_my_lessons(lecturer: Lecturer = Depends(require_lecturer_account), db: Session = Depends(get_db)):
    rows = db.query(Lesson).filter(Lesson.lecturer_id == lecturer.id).order_by(Lesson.id.desc()).all()
    return [{"id": l.id, "title": l.title, "description": l.description, "module_code": l.module_code, "created_at": l.created_at} for l in rows]


@app.get("/modules")
def list_modules(db: Session = Depends(get_db)):
    """Public list of distinct module codes with how many lessons each has,
    used by the student page to build the module picker."""
    rows = (
        db.query(Lesson.module_code, func.count(Lesson.id).label("lesson_count"))
        .group_by(Lesson.module_code)
        .order_by(Lesson.module_code.asc())
        .all()
    )
    return [{"module_code": code, "lesson_count": count} for code, count in rows]


@app.get("/lesson/{lesson_id}")
def get_lesson(lesson_id: int, db: Session = Depends(get_db)):
    lesson = db.query(Lesson).filter(Lesson.id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")

    out_questions = []
    for q in lesson.questions:
        item = {
            "question_id": q.id, "type": q.type, "question": q.question,
            "marks": q.marks, "image_url": q.image_url,
        }
        if q.type == "mcq":
            item["options"] = json.loads(q.options_json)
        out_questions.append(item)

    return {
        "lesson_id": lesson.id,
        "title": lesson.title,
        "description": lesson.description,
        "module_code": lesson.module_code,
        "video_url": lesson.video_url,
        "questions": out_questions,
    }


# ---------------------------------------------------------------------------
# Student: submit answers to a lesson's comprehension questions.
# ---------------------------------------------------------------------------

@app.post("/lesson/{lesson_id}/submit")
def submit_lesson(lesson_id: int, submission: QuizSubmission, student: Student = Depends(require_student_account), db: Session = Depends(get_db)):
    questions = db.query(LessonQuestion).filter(LessonQuestion.lesson_id == lesson_id).all()
    if not questions:
        raise HTTPException(status_code=404, detail="Lesson not found")

    new_submission = LessonSubmission(
        lesson_id=lesson_id,
        student_id=student.student_number,
        student_name=student.full_name,
        submitted_at=datetime.utcnow().isoformat() + "Z",
        total_score=0,
        max_score=0,
        fully_marked=False,
    )
    db.add(new_submission)
    db.flush()

    max_score = 0.0
    auto_score = 0.0
    has_pending = False

    for q in questions:
        max_score += q.marks
        student_answer = next((a.answer for a in submission.answers if a.question_id == q.id), "")

        if q.type == "short":
            validate_short_answer_length(student_answer, f"Question {q.q_order + 1}")
            correct = short_answer_matches(q.correct_answer, student_answer)
            awarded = q.marks if correct else 0.0
            auto_score += awarded
            db.add(LessonAnswer(
                submission_id=new_submission.id, question_id=q.id,
                answer_text=student_answer, awarded_marks=awarded, marked=True,
            ))
        elif q.type == "mcq":
            correct = normalize(q.correct_answer) == normalize(student_answer)
            awarded = q.marks if correct else 0.0
            auto_score += awarded
            db.add(LessonAnswer(
                submission_id=new_submission.id, question_id=q.id,
                answer_text=student_answer, awarded_marks=awarded, marked=True,
            ))
        else:
            has_pending = True
            db.add(LessonAnswer(
                submission_id=new_submission.id, question_id=q.id,
                answer_text=student_answer, awarded_marks=None, marked=False,
            ))

    new_submission.total_score = auto_score
    new_submission.max_score = max_score
    new_submission.fully_marked = not has_pending
    db.commit()

    return {
        "submission_id": new_submission.id,
        "auto_marked_score": auto_score,
        "max_score": max_score,
        "fully_marked": not has_pending,
    }


# ---------------------------------------------------------------------------
# Student: check their OWN answers/marks for a lesson (private).
# ---------------------------------------------------------------------------

@app.get("/lesson/{lesson_id}/my-submission")
def get_my_lesson_submission(lesson_id: int, student_id: str, student: Student = Depends(require_student_account), db: Session = Depends(get_db)):
    if student_id.strip().upper() != student.student_number:
        raise HTTPException(status_code=403, detail="You can only view your own submission")
    submission = (
        db.query(LessonSubmission)
        .filter(LessonSubmission.lesson_id == lesson_id, LessonSubmission.student_id == student_id)
        .order_by(LessonSubmission.submitted_at.desc())
        .first()
    )
    if not submission:
        return {"submitted": False}

    answers = (
        db.query(LessonAnswer)
        .join(LessonQuestion, LessonAnswer.question_id == LessonQuestion.id)
        .filter(LessonAnswer.submission_id == submission.id)
        .order_by(LessonQuestion.q_order)
        .all()
    )

    return {
        "submitted": True,
        "submission_id": submission.id,
        "submitted_at": submission.submitted_at,
        "total_score": submission.total_score,
        "max_score": submission.max_score,
        "fully_marked": submission.fully_marked,
        "answers": [
            {
                "question_id": a.question_id, "answer_text": a.answer_text,
                "awarded_marks": a.awarded_marks, "marked": a.marked,
                "type": a.question.type, "question": a.question.question,
                "max_marks": a.question.marks,
            }
            for a in answers
        ],
    }


# ---------------------------------------------------------------------------
# Lecturer: view and mark student submissions for a lesson.
# ---------------------------------------------------------------------------

@app.get("/lecturer/lesson/{lesson_id}/submissions")
def list_lesson_submissions(lesson_id: int, lecturer: Lecturer = Depends(require_lecturer_account), db: Session = Depends(get_db)):
    _require_owned_lesson(db, lesson_id, lecturer)
    rows = (
        db.query(LessonSubmission)
        .filter(LessonSubmission.lesson_id == lesson_id)
        .order_by(LessonSubmission.submitted_at.desc())
        .all()
    )
    return [
        {
            "id": s.id, "student_id": s.student_id, "student_name": s.student_name,
            "submitted_at": s.submitted_at, "total_score": s.total_score,
            "max_score": s.max_score, "fully_marked": s.fully_marked,
        }
        for s in rows
    ]


@app.get("/lecturer/lesson/submission/{submission_id}")
def get_lesson_submission_detail(submission_id: int, lecturer: Lecturer = Depends(require_lecturer_account), db: Session = Depends(get_db)):
    submission = db.query(LessonSubmission).filter(LessonSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    _require_owned_lesson(db, submission.lesson_id, lecturer)

    answers = (
        db.query(LessonAnswer)
        .join(LessonQuestion, LessonAnswer.question_id == LessonQuestion.id)
        .filter(LessonAnswer.submission_id == submission_id)
        .order_by(LessonQuestion.q_order)
        .all()
    )

    answer_dicts = []
    for a in answers:
        q = a.question
        answer_dicts.append({
            "answer_id": a.id, "question_id": a.question_id, "answer_text": a.answer_text,
            "awarded_marks": a.awarded_marks, "marked": a.marked,
            "type": q.type, "question": q.question, "max_marks": q.marks,
            "correct_answer": q.correct_answer, "image_url": q.image_url,
        })

    return {
        "submission": {
            "id": submission.id, "lesson_id": submission.lesson_id,
            "student_id": submission.student_id, "student_name": submission.student_name,
            "submitted_at": submission.submitted_at, "total_score": submission.total_score,
            "max_score": submission.max_score, "fully_marked": submission.fully_marked,
        },
        "answers": answer_dicts,
    }


@app.post("/lecturer/lesson/submission/{submission_id}/mark")
def mark_lesson_answers(submission_id: int, payload: MarkSubmissionRequest, lecturer: Lecturer = Depends(require_lecturer_account), db: Session = Depends(get_db)):
    submission = db.query(LessonSubmission).filter(LessonSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    _require_owned_lesson(db, submission.lesson_id, lecturer)

    for m in payload.marks:
        answer = (
            db.query(LessonAnswer)
            .join(LessonQuestion, LessonAnswer.question_id == LessonQuestion.id)
            .filter(
                LessonAnswer.submission_id == submission_id,
                LessonAnswer.question_id == m.question_id,
                LessonQuestion.type.in_(("long", "short")),
            )
            .first()
        )
        if not answer:
            continue
        awarded = min(m.awarded_marks, answer.question.marks)
        answer.awarded_marks = awarded
        answer.marked = True

    all_answers = db.query(LessonAnswer).filter(LessonAnswer.submission_id == submission_id).all()
    still_pending = any(not a.marked for a in all_answers)
    total = sum(a.awarded_marks or 0 for a in all_answers)

    submission.total_score = total
    submission.fully_marked = not still_pending
    db.commit()

    return {
        "submission_id": submission_id,
        "total_score": total,
        "fully_marked": not still_pending,
    }


# ---------------------------------------------------------------------------
# Comments — PUBLIC read/write; posting "as lecturer" requires the PIN.
# ---------------------------------------------------------------------------

@app.get("/lesson/{lesson_id}/comments")
def get_lesson_comments(lesson_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(LessonComment)
        .filter(LessonComment.lesson_id == lesson_id)
        .order_by(LessonComment.created_at.asc())
        .all()
    )
    return [
        {"id": c.id, "author_name": c.author_name, "is_lecturer": c.is_lecturer,
         "comment_text": c.comment_text, "created_at": c.created_at}
        for c in rows
    ]


@app.post("/lesson/{lesson_id}/comments")
def post_lesson_comment(
    lesson_id: int,
    payload: CommentCreate,
    x_lecturer_token: Optional[str] = Header(None, alias="X-Lecturer-Token"),
    db: Session = Depends(get_db),
):
    if not payload.comment_text.strip():
        raise HTTPException(status_code=400, detail="Comment can't be empty")
    lecturer = None
    if payload.is_lecturer:
        lecturer = db.query(Lecturer).filter(Lecturer.id == _lecturer_id_from_token(x_lecturer_token)).first()
        if not lecturer or not lecturer.active or not lecturer.approved:
            raise HTTPException(status_code=401, detail="An approved lecturer account is required to post as a lecturer")

    lesson = db.query(Lesson).filter(Lesson.id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")

    comment = LessonComment(
        lesson_id=lesson_id,
        author_name=lecturer.full_name if lecturer else (payload.author_name.strip() or "Anonymous"),
        is_lecturer=payload.is_lecturer,
        comment_text=payload.comment_text.strip(),
        created_at=datetime.utcnow().isoformat() + "Z",
    )
    db.add(comment)
    db.commit()
    return {"id": comment.id, "ok": True}


# ---------------------------------------------------------------------------
# Admin content management — protected by the same lecturer PIN.
# These routes intentionally expose answers and video URLs, so they must
# never be used without the PIN dependency.
# ---------------------------------------------------------------------------

def _validate_admin_questions(questions: List[AdminQuestionInput]):
    if not questions:
        raise HTTPException(status_code=400, detail="Add at least one question")
    for index, question in enumerate(questions, start=1):
        if question.type not in ("mcq", "short", "long"):
            raise HTTPException(status_code=400, detail=f"Question {index}: type must be mcq, short, or long")
        if not question.question.strip():
            raise HTTPException(status_code=400, detail=f"Question {index}: question text is required")
        if question.marks <= 0:
            raise HTTPException(status_code=400, detail=f"Question {index}: marks must be greater than zero")
        if question.type == "mcq" and (not question.options or len(question.options) < 2):
            raise HTTPException(status_code=400, detail=f"Question {index}: an MCQ needs at least two options")
        if question.type in ("mcq", "short") and not (question.correct_answer or "").strip():
            raise HTTPException(status_code=400, detail=f"Question {index}: a correct answer is required")
        if question.type == "short" and len(short_answer_words(question.correct_answer)) > 2:
            raise HTTPException(status_code=400, detail=f"Question {index}: a short-answer key can contain a maximum of two words")


def _admin_question_dict(question):
    return {
        "id": question.id,
        "type": question.type,
        "question": question.question,
        "options": json.loads(question.options_json) if question.options_json else [],
        "correct_answer": question.correct_answer or "",
        "marks": question.marks,
        "image_url": question.image_url or "",
    }


def _add_quiz_questions(db: Session, quiz_id: int, questions: List[AdminQuestionInput]):
    for order, question in enumerate(questions):
        db.add(Question(
            quiz_id=quiz_id, q_order=order, type=question.type,
            question=question.question.strip(),
            options_json=json.dumps(question.options) if question.type == "mcq" else None,
            correct_answer=question.correct_answer.strip() if question.type in ("mcq", "short") else None,
            marks=question.marks, image_url=(question.image_url or "").strip() or None,
        ))


def _add_lesson_questions(db: Session, lesson_id: int, questions: List[AdminQuestionInput]):
    for order, question in enumerate(questions):
        db.add(LessonQuestion(
            lesson_id=lesson_id, q_order=order, type=question.type,
            question=question.question.strip(),
            options_json=json.dumps(question.options) if question.type == "mcq" else None,
            correct_answer=question.correct_answer.strip() if question.type in ("mcq", "short") else None,
            marks=question.marks, image_url=(question.image_url or "").strip() or None,
        ))


@app.get("/admin/quizzes")
def admin_list_quizzes(_pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    rows = db.query(Quiz).order_by(Quiz.id.desc()).all()
    return [{"id": q.id, "title": q.title, "module_code": q.module_code, "created_at": q.created_at, "question_count": len(q.questions), "submission_count": len(q.submissions)} for q in rows]


@app.get("/admin/quizzes/{quiz_id}")
def admin_get_quiz(quiz_id: int, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    quiz = db.query(Quiz).filter(Quiz.id == quiz_id).first()
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    return {"id": quiz.id, "title": quiz.title, "module_code": quiz.module_code, "created_at": quiz.created_at, "questions": [_admin_question_dict(q) for q in quiz.questions], "submission_count": len(quiz.submissions)}


@app.post("/admin/quizzes")
def admin_create_quiz(payload: AdminQuizInput, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    _validate_admin_questions(payload.questions)
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="Quiz title is required")
    quiz = Quiz(title=payload.title.strip(), module_code=payload.module_code.strip().upper() or "GENERAL", created_at=datetime.utcnow().isoformat() + "Z")
    db.add(quiz)
    db.flush()
    _add_quiz_questions(db, quiz.id, payload.questions)
    db.commit()
    return {"id": quiz.id, "title": quiz.title}


@app.put("/admin/quizzes/{quiz_id}")
def admin_update_quiz(quiz_id: int, payload: AdminQuizInput, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    quiz = db.query(Quiz).filter(Quiz.id == quiz_id).first()
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    if quiz.submissions:
        raise HTTPException(status_code=409, detail="This quiz has submissions and cannot be changed. Create a new version instead.")
    _validate_admin_questions(payload.questions)
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="Quiz title is required")
    quiz.title = payload.title.strip()
    quiz.module_code = payload.module_code.strip().upper() or "GENERAL"
    for question in list(quiz.questions):
        db.delete(question)
    db.flush()
    _add_quiz_questions(db, quiz.id, payload.questions)
    db.commit()
    return {"id": quiz.id, "title": quiz.title}


@app.delete("/admin/quizzes/{quiz_id}")
def admin_delete_quiz(quiz_id: int, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    quiz = db.query(Quiz).filter(Quiz.id == quiz_id).first()
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    db.delete(quiz)
    db.commit()
    return {"ok": True}


@app.get("/admin/lessons")
def admin_list_lessons(_pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    rows = db.query(Lesson).order_by(Lesson.id.desc()).all()
    return [{"id": l.id, "title": l.title, "module_code": l.module_code, "created_at": l.created_at, "question_count": len(l.questions), "submission_count": len(l.submissions), "comment_count": len(l.comments)} for l in rows]


@app.get("/admin/lessons/{lesson_id}")
def admin_get_lesson(lesson_id: int, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    lesson = db.query(Lesson).filter(Lesson.id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    return {"id": lesson.id, "title": lesson.title, "description": lesson.description or "", "module_code": lesson.module_code, "video_url": lesson.video_url, "questions": [_admin_question_dict(q) for q in lesson.questions], "submission_count": len(lesson.submissions)}


@app.post("/admin/lessons")
def admin_create_lesson(payload: AdminLessonInput, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    _validate_admin_questions(payload.questions)
    if not payload.title.strip() or not payload.module_code.strip() or not payload.video_url.strip():
        raise HTTPException(status_code=400, detail="Title, module code, and video URL are required")
    lesson = Lesson(title=payload.title.strip(), description=payload.description.strip(), module_code=payload.module_code.strip().upper(), video_url=payload.video_url.strip(), created_at=datetime.utcnow().isoformat() + "Z")
    db.add(lesson)
    db.flush()
    _add_lesson_questions(db, lesson.id, payload.questions)
    db.commit()
    return {"id": lesson.id, "title": lesson.title}


@app.put("/admin/lessons/{lesson_id}")
def admin_update_lesson(lesson_id: int, payload: AdminLessonInput, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    lesson = db.query(Lesson).filter(Lesson.id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    if lesson.submissions:
        raise HTTPException(status_code=409, detail="This lesson has submissions and cannot be changed. Create a new version instead.")
    _validate_admin_questions(payload.questions)
    if not payload.title.strip() or not payload.module_code.strip() or not payload.video_url.strip():
        raise HTTPException(status_code=400, detail="Title, module code, and video URL are required")
    lesson.title, lesson.description = payload.title.strip(), payload.description.strip()
    lesson.module_code, lesson.video_url = payload.module_code.strip().upper(), payload.video_url.strip()
    for question in list(lesson.questions):
        db.delete(question)
    db.flush()
    _add_lesson_questions(db, lesson.id, payload.questions)
    db.commit()
    return {"id": lesson.id, "title": lesson.title}


@app.delete("/admin/lessons/{lesson_id}")
def admin_delete_lesson(lesson_id: int, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    lesson = db.query(Lesson).filter(Lesson.id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    db.delete(lesson)
    db.commit()
    return {"ok": True}


@app.get("/admin/lecturers")
def admin_list_lecturers(_pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    return [_lecturer_profile(item) for item in db.query(Lecturer).order_by(Lecturer.created_at.desc()).all()]


@app.post("/admin/lecturers")
def admin_create_lecturer(payload: AdminLecturerInput, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    if not payload.full_name.strip() or "@" not in email or len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Provide a full name, valid email, and a password of at least 8 characters")
    if db.query(Lecturer).filter(Lecturer.email == email).first():
        raise HTTPException(status_code=409, detail="A lecturer profile already uses this email")
    lecturer = Lecturer(
        full_name=payload.full_name.strip(), email=email, password_hash=_password_hash(payload.password),
        phone=payload.phone.strip(), institution=payload.institution.strip(), bio=payload.bio.strip(),
        approved=payload.approved, active=payload.active, module_limit=payload.module_limit,
        created_at=datetime.utcnow().isoformat() + "Z",
    )
    db.add(lecturer)
    db.flush()
    _set_lecturer_modules(db, lecturer, payload.module_codes, payload.module_limit)
    db.commit()
    return _lecturer_profile(lecturer)


@app.put("/admin/lecturers/{lecturer_id}")
def admin_update_lecturer(lecturer_id: int, payload: AdminLecturerUpdate, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    lecturer = db.query(Lecturer).filter(Lecturer.id == lecturer_id).first()
    if not lecturer:
        raise HTTPException(status_code=404, detail="Lecturer not found")
    for field in ("full_name", "phone", "institution", "bio", "approved", "active", "module_limit"):
        value = getattr(payload, field)
        if value is not None:
            setattr(lecturer, field, value.strip() if isinstance(value, str) else value)
    if lecturer.module_limit < 0:
        raise HTTPException(status_code=400, detail="Module limit cannot be negative")
    if payload.module_codes is not None:
        _set_lecturer_modules(db, lecturer, payload.module_codes, lecturer.module_limit)
    elif len(lecturer.modules) > lecturer.module_limit:
        raise HTTPException(status_code=400, detail="Increase the module limit before keeping these assignments")
    db.commit()
    return _lecturer_profile(lecturer)


@app.delete("/admin/lecturers/{lecturer_id}")
def admin_delete_lecturer(lecturer_id: int, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    lecturer = db.query(Lecturer).filter(Lecturer.id == lecturer_id).first()
    if not lecturer:
        raise HTTPException(status_code=404, detail="Lecturer not found")
    if lecturer.quizzes or lecturer.lessons:
        raise HTTPException(status_code=409, detail="This lecturer owns content. Reassign or delete that content before removing the profile.")
    db.delete(lecturer)
    db.commit()
    return {"ok": True}


@app.post("/admin/lecturers/{lecturer_id}/reset-password")
def admin_reset_lecturer_password(lecturer_id: int, payload: PasswordReset, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    lecturer = db.query(Lecturer).filter(Lecturer.id == lecturer_id).first()
    if not lecturer:
        raise HTTPException(status_code=404, detail="Lecturer not found")
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="The new password must be at least 8 characters")
    lecturer.password_hash = _password_hash(payload.password)
    db.commit()
    return {"ok": True}


@app.get("/admin/students")
def admin_list_students(_pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    return [_student_profile(item) for item in db.query(Student).order_by(Student.created_at.desc()).all()]


@app.post("/admin/students")
def admin_create_student(payload: AdminStudentCreate, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    number, email = payload.student_number.strip().upper(), payload.email.strip().lower()
    if not number or not payload.full_name.strip() or "@" not in email or len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Provide a student number, full name, valid email, and a password of at least 8 characters")
    if db.query(Student).filter((Student.student_number == number) | (Student.email == email)).first():
        raise HTTPException(status_code=409, detail="A student profile already uses this student number or email")
    student = Student(student_number=number, full_name=payload.full_name.strip(), email=email,
                      password_hash=_password_hash(payload.password), approved=payload.approved,
                      active=payload.active, created_at=datetime.utcnow().isoformat() + "Z")
    db.add(student); db.commit()
    return _student_profile(student)


@app.put("/admin/students/{student_id}")
def admin_update_student(student_id: int, payload: AdminStudentUpdate, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    if payload.approved is not None: student.approved = payload.approved
    if payload.active is not None: student.active = payload.active
    db.commit()
    return _student_profile(student)


@app.post("/admin/students/{student_id}/reset-password")
def admin_reset_student_password(student_id: int, payload: PasswordReset, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student: raise HTTPException(status_code=404, detail="Student not found")
    if len(payload.password) < 8: raise HTTPException(status_code=400, detail="The new password must be at least 8 characters")
    student.password_hash = _password_hash(payload.password); db.commit()
    return {"ok": True}


@app.delete("/admin/students/{student_id}")
def admin_delete_student(student_id: int, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student: raise HTTPException(status_code=404, detail="Student not found")
    db.delete(student); db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Student: check results (quizzes)
# ---------------------------------------------------------------------------

@app.get("/results/{student_id}")
def get_results(student_id: str, quiz_id: Optional[int] = None, student: Student = Depends(require_student_account), db: Session = Depends(get_db)):
    if student_id.strip().upper() != student.student_number:
        raise HTTPException(status_code=403, detail="You can only view your own results")
    query = db.query(Submission).filter(Submission.student_id == student_id)
    if quiz_id is not None:
        query = query.filter(Submission.quiz_id == quiz_id)
    submissions = query.all()

    if not submissions:
        raise HTTPException(status_code=404, detail="No submissions found for this student")

    results = []
    for s in submissions:
        results.append({
            "submission_id": s.id,
            "quiz_id": s.quiz_id,
            "quiz_title": s.quiz.title,
            "module_code": s.quiz.module_code,
            "submitted_at": s.submitted_at,
            "total_score": s.total_score,
            "max_score": s.max_score,
            "fully_marked": s.fully_marked,
            "status": "Final result ready" if s.fully_marked else "Long-answer questions still being marked",
        })
    return results


# ---------------------------------------------------------------------------
# Student community / Fun Page
# ---------------------------------------------------------------------------

def _fun_post_payload(post: FunPost, students_by_id: dict, current_student_id: int, replies: list) -> dict:
    author = students_by_id.get(post.author_student_id)
    return {
        "id": post.id,
        "parent_id": post.parent_id,
        "content": post.content,
        "is_anonymous": post.is_anonymous,
        "author_name": "Anonymous student" if post.is_anonymous else (author.full_name if author else "Former student"),
        "author_image_url": None if post.is_anonymous or not author else author.profile_image_url,
        "created_at": post.created_at,
        "is_author": post.author_student_id == current_student_id,
        "replies": replies,
    }


@app.get("/fun/members")
def fun_members(student: Student = Depends(require_student_account), db: Session = Depends(get_db)):
    """Member handles are used by the Fun Page's @tag helper."""
    rows = (
        db.query(Student)
        .filter(Student.approved == True, Student.active == True)  # noqa: E712
        .order_by(Student.full_name.asc())
        .all()
    )
    return [{"student_number": item.student_number, "full_name": item.full_name} for item in rows]


@app.get("/fun/posts")
def list_fun_posts(student: Student = Depends(require_student_account), db: Session = Depends(get_db)):
    posts = db.query(FunPost).order_by(FunPost.created_at.asc()).all()
    author_ids = {post.author_student_id for post in posts}
    students_by_id = {
        item.id: item
        for item in db.query(Student).filter(Student.id.in_(author_ids)).all()
    } if author_ids else {}

    children_by_parent = {}
    for post in posts:
        children_by_parent.setdefault(post.parent_id, []).append(post)

    def serialize(post: FunPost) -> dict:
        return _fun_post_payload(
            post,
            students_by_id,
            student.id,
            [serialize(child) for child in children_by_parent.get(post.id, [])],
        )

    # New discussions appear first; replies remain in their natural conversation order.
    return [serialize(post) for post in reversed(children_by_parent.get(None, []))]


@app.post("/fun/posts")
def create_fun_post(payload: FunPostCreate, student: Student = Depends(require_student_account), db: Session = Depends(get_db)):
    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Write something before posting")
    if len(content) > 1500:
        raise HTTPException(status_code=400, detail="Posts can be up to 1,500 characters")
    if payload.parent_id is not None and not db.query(FunPost).filter(FunPost.id == payload.parent_id).first():
        raise HTTPException(status_code=404, detail="The post you are replying to no longer exists")

    post = FunPost(
        author_student_id=student.id,
        parent_id=payload.parent_id,
        content=content,
        is_anonymous=payload.is_anonymous,
        created_at=datetime.utcnow().isoformat() + "Z",
    )
    db.add(post)
    db.commit()
    return {"ok": True, "id": post.id}


@app.delete("/fun/posts/{post_id}")
def delete_fun_post(post_id: int, student: Student = Depends(require_student_account), db: Session = Depends(get_db)):
    post = db.query(FunPost).filter(FunPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if post.author_student_id != student.id:
        raise HTTPException(status_code=403, detail="You can only delete your own posts")

    # Delete the full reply thread so no reply is left without its parent.
    def delete_thread(item: FunPost):
        for child in db.query(FunPost).filter(FunPost.parent_id == item.id).all():
            delete_thread(child)
        db.delete(item)

    delete_thread(post)
    db.commit()
    return {"ok": True}


@app.get("/")
def root():
    return RedirectResponse(url="/static/index.html")


# ---------------------------------------------------------------------------
# Frontend static files (plain HTML/CSS/JS — served from /static)
# ---------------------------------------------------------------------------
app.mount("/static", StaticFiles(directory="static", html=True), name="static")
