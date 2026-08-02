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
import asyncio
import json
import os
import re
import base64
import hashlib
import hmac
import secrets
import time
import tempfile
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from itertools import permutations
from typing import List, Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
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
from pypdf import PdfReader, PdfWriter
import pymupdf
try:
    from pywebpush import WebPushException, webpush
except ImportError:  # The app stays usable while push dependencies are being installed.
    WebPushException = Exception
    webpush = None

from database import Base, SessionLocal, engine, get_db
from models import (
    Answer,
    DirectMessage,
    DirectMessageBlock,
    Lesson,
    LessonAnswer,
    LessonComment,
    LessonQuestion,
    LessonSubmission,
    LessonView,
    Lecturer,
    LecturerModule,
    FunPost,
    FunOfficialPost,
    Question,
    Quiz,
    Submission,
    Student,
    PushSubscription,
    StudentModule,
    Landlord, Accommodation, AccommodationComment, MarketAdvert,
    SrcPresident,
    ComradePost, ComradeReply, ComradeSrcReply,
)
from cloudinary_utils import upload_image_bytes, upload_video_bytes

# Matplotlib is loaded lazily for equation rendering. Give it a writable
# cache in local and cloud environments where the default home may be read-only.
os.environ.setdefault("MPLCONFIGDIR", os.path.join(tempfile.gettempdir(), "nucleocampus-matplotlib"))

# Lecturer-only areas (uploading quizzes, viewing/marking submissions) require
# this PIN. It's sent as a header (X-Lecturer-Pin) on those requests.
# This is intentionally simple (a shared PIN, not per-user accounts).
# For anything beyond a small trusted class, move this to an environment
# variable too (os.getenv("LECTURER_PIN", "90435")) so it isn't baked into
# the deployed code.
LECTURER_PIN = os.getenv("LECTURER_PIN", "90435")
LECTURER_SESSION_SECRET = os.getenv("LECTURER_SESSION_SECRET", LECTURER_PIN)
STUDENT_SESSION_SECRET = os.getenv("STUDENT_SESSION_SECRET", LECTURER_SESSION_SECRET)
SRC_SESSION_SECRET = os.getenv("SRC_SESSION_SECRET", STUDENT_SESSION_SECRET)
LANDLORD_SESSION_SECRET = os.getenv("LANDLORD_SESSION_SECRET", STUDENT_SESSION_SECRET)
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "").strip()
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "").strip()
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:admin@example.com").strip()
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
MAX_LESSON_VIDEO_BYTES = 80 * 1024 * 1024
ADMIN_MAX_FAILURES = int(os.getenv("ADMIN_MAX_FAILURES", "5"))
ADMIN_LOCKOUT_SECONDS = int(os.getenv("ADMIN_LOCKOUT_SECONDS", "300"))
_admin_pin_failures: dict[str, list[float]] = {}

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


def ensure_fun_post_media_schema():
    """Add attachment and sticker fields for existing Fun Page installations."""
    if "fun_posts" not in inspect(engine).get_table_names():
        return
    columns = {column["name"] for column in inspect(engine).get_columns("fun_posts")}
    with engine.begin() as conn:
        if "image_url" not in columns:
            conn.execute(text("ALTER TABLE fun_posts ADD COLUMN image_url TEXT"))
        if "video_url" not in columns:
            conn.execute(text("ALTER TABLE fun_posts ADD COLUMN video_url TEXT"))
        if "sticker_code" not in columns:
            conn.execute(text("ALTER TABLE fun_posts ADD COLUMN sticker_code VARCHAR(32)"))
        if "is_pinned" not in columns:
            conn.execute(text("ALTER TABLE fun_posts ADD COLUMN is_pinned BOOLEAN DEFAULT FALSE"))


ensure_fun_post_media_schema()


def ensure_comment_moderation_schema():
    """Add official and pinned state to lesson discussions created before moderation."""
    if "lesson_comments" not in inspect(engine).get_table_names():
        return
    columns = {column["name"] for column in inspect(engine).get_columns("lesson_comments")}
    with engine.begin() as conn:
        if "is_official" not in columns:
            conn.execute(text("ALTER TABLE lesson_comments ADD COLUMN is_official BOOLEAN DEFAULT FALSE"))
        if "is_pinned" not in columns:
            conn.execute(text("ALTER TABLE lesson_comments ADD COLUMN is_pinned BOOLEAN DEFAULT FALSE"))


ensure_comment_moderation_schema()


def ensure_lesson_comment_thread_schema():
    """Bring existing lesson discussions up to the threaded Fun Page experience."""
    if "lesson_comments" not in inspect(engine).get_table_names():
        return
    columns = {column["name"] for column in inspect(engine).get_columns("lesson_comments")}
    with engine.begin() as conn:
        if "author_student_id" not in columns:
            conn.execute(text("ALTER TABLE lesson_comments ADD COLUMN author_student_id INTEGER"))
        if "parent_id" not in columns:
            conn.execute(text("ALTER TABLE lesson_comments ADD COLUMN parent_id INTEGER"))
        if "is_anonymous" not in columns:
            conn.execute(text("ALTER TABLE lesson_comments ADD COLUMN is_anonymous BOOLEAN DEFAULT FALSE"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_lesson_comments_parent_id ON lesson_comments (parent_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_lesson_comments_author_student_id ON lesson_comments (author_student_id)"))


ensure_lesson_comment_thread_schema()


def ensure_accommodation_location_schema():
    """Add map coordinates without interrupting existing accommodation listings."""
    if "accommodations" not in inspect(engine).get_table_names():
        return
    columns = {column["name"] for column in inspect(engine).get_columns("accommodations")}
    with engine.begin() as conn:
        if "latitude" not in columns:
            conn.execute(text("ALTER TABLE accommodations ADD COLUMN latitude FLOAT"))
        if "longitude" not in columns:
            conn.execute(text("ALTER TABLE accommodations ADD COLUMN longitude FLOAT"))


ensure_accommodation_location_schema()


def ensure_market_provider_type_schema():
    """Allow the existing provider account to serve residences or transport."""
    if "landlords" not in inspect(engine).get_table_names():
        return
    columns = {column["name"] for column in inspect(engine).get_columns("landlords")}
    if "provider_type" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE landlords ADD COLUMN provider_type VARCHAR(32) DEFAULT 'residence'"))
            conn.execute(text("UPDATE landlords SET provider_type = 'residence' WHERE provider_type IS NULL OR provider_type = ''"))


ensure_market_provider_type_schema()


def ensure_market_gallery_schema():
    """Add multi-image galleries while keeping legacy single images."""
    for table in ("accommodations", "market_adverts"):
        if table not in inspect(engine).get_table_names():
            continue
        columns = {column["name"] for column in inspect(engine).get_columns(table)}
        if "image_urls" not in columns:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN image_urls TEXT"))


ensure_market_gallery_schema()


def ensure_comrade_identity_schema():
    """Link new announcements to the verified SRC profile that created them."""
    if "comrade_posts" not in inspect(engine).get_table_names():
        return
    columns = {column["name"] for column in inspect(engine).get_columns("comrade_posts")}
    if "src_president_id" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE comrade_posts ADD COLUMN src_president_id INTEGER"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_comrade_posts_src_president_id ON comrade_posts (src_president_id)"))
    for table in ("comrade_replies", "comrade_src_replies"):
        if table not in inspect(engine).get_table_names():
            continue
        reply_columns = {column["name"] for column in inspect(engine).get_columns(table)}
        if "parent_key" not in reply_columns:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN parent_key VARCHAR(64)"))
                conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table}_parent_key ON {table} (parent_key)"))


ensure_comrade_identity_schema()


def ensure_direct_message_privacy_schema():
    """Add anonymous support without disturbing existing message history."""
    if "direct_messages" not in inspect(engine).get_table_names():
        return
    columns = {column["name"] for column in inspect(engine).get_columns("direct_messages")}
    if "is_anonymous" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE direct_messages ADD COLUMN is_anonymous BOOLEAN DEFAULT FALSE"))


ensure_direct_message_privacy_schema()

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


class DirectMessageCreate(BaseModel):
    recipient_type: str
    recipient_id: int
    content: str
    is_anonymous: bool = False


class ProviderBroadcastMessage(BaseModel):
    content: str
    recipient_ids: List[int]
    audience: str = "selected"


class MessageBlockRequest(BaseModel):
    target_type: str
    target_id: int


class PushSubscriptionCreate(BaseModel):
    endpoint: str
    keys: dict[str, str]


class PushSubscriptionDelete(BaseModel):
    endpoint: str


class AdminBroadcastMessage(BaseModel):
    content: str
    module_codes: List[str] = []


class LecturerBroadcastMessage(BaseModel):
    content: str
    module_code: str


class ModuleSelection(BaseModel):
    module_codes: List[str]


class PinCheck(BaseModel):
    pin: str


class ComradeAnnouncement(BaseModel):
    content: str


class ComradeReplyInput(BaseModel):
    content: str
    parent_key: Optional[str] = None


class SrcPresidentLogin(BaseModel):
    email: str
    password: str


class LandlordLogin(BaseModel):
    email: str
    password: str


class AccommodationCommentCreate(BaseModel):
    content: str
    parent_id: Optional[int] = None
    is_anonymous: bool = False


class SrcPasswordChange(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str


class AdminSrcPresidentUpdate(BaseModel):
    approved: Optional[bool] = None
    active: Optional[bool] = None


class AdminMarketAdvertUpdate(BaseModel):
    status: Optional[str] = None
    is_featured: Optional[bool] = None
    starts_at: Optional[str] = None
    expires_at: Optional[str] = None


class CommentCreate(BaseModel):
    comment_text: str
    author_name: str = ""
    is_lecturer: bool = False
    parent_id: Optional[int] = None
    is_anonymous: bool = False


class AdminOfficialComment(BaseModel):
    content: str


class PinUpdate(BaseModel):
    pinned: bool


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
    module_codes: Optional[List[str]] = None


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
    except (AttributeError, ValueError):
        return False
    # Older student registration screens removed accidental leading/trailing
    # spaces before saving. Accept that same normalised value at sign-in too,
    # while preserving exact matching for every other password.
    candidates = [password]
    trimmed = password.strip()
    if trimmed != password:
        candidates.append(trimmed)
    return any(hmac.compare_digest(_password_hash(candidate, salt), stored) for candidate in candidates)


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


def _issue_src_token(src_president_id: int) -> str:
    expires = int((datetime.now(timezone.utc) + timedelta(hours=12)).timestamp())
    payload = f"{src_president_id}:{expires}".encode("utf-8")
    signature = hmac.new(SRC_SESSION_SECRET.encode("utf-8"), payload, hashlib.sha256).digest()
    return f"{base64.urlsafe_b64encode(payload).decode().rstrip('=')}.{base64.urlsafe_b64encode(signature).decode().rstrip('=')}"


def _issue_landlord_token(landlord_id: int) -> str:
    expires = int((datetime.now(timezone.utc) + timedelta(hours=12)).timestamp())
    payload = f"{landlord_id}:{expires}".encode("utf-8")
    signature = hmac.new(LANDLORD_SESSION_SECRET.encode("utf-8"), payload, hashlib.sha256).digest()
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


def _src_president_id_from_token(token: Optional[str]) -> int:
    if not token or "." not in token:
        raise HTTPException(status_code=401, detail="Sign in as the SRC president first")
    encoded_payload, encoded_signature = token.split(".", 1)
    try:
        payload = base64.urlsafe_b64decode(encoded_payload + "=" * (-len(encoded_payload) % 4))
        signature = base64.urlsafe_b64decode(encoded_signature + "=" * (-len(encoded_signature) % 4))
        expected = hmac.new(SRC_SESSION_SECRET.encode("utf-8"), payload, hashlib.sha256).digest()
        president_id_text, expires_text = payload.decode("utf-8").split(":", 1)
        if not hmac.compare_digest(signature, expected) or int(expires_text) < int(datetime.now(timezone.utc).timestamp()):
            raise ValueError
        return int(president_id_text)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=401, detail="Your SRC session has expired. Sign in again.")


def _landlord_id_from_token(token: Optional[str]) -> int:
    if not token or "." not in token:
        raise HTTPException(status_code=401, detail="Sign in as a landlord first")
    encoded_payload, encoded_signature = token.split(".", 1)
    try:
        payload = base64.urlsafe_b64decode(encoded_payload + "=" * (-len(encoded_payload) % 4))
        signature = base64.urlsafe_b64decode(encoded_signature + "=" * (-len(encoded_signature) % 4))
        expected = hmac.new(LANDLORD_SESSION_SECRET.encode("utf-8"), payload, hashlib.sha256).digest()
        landlord_id_text, expires_text = payload.decode("utf-8").split(":", 1)
        if not hmac.compare_digest(signature, expected) or int(expires_text) < int(datetime.now(timezone.utc).timestamp()):
            raise ValueError
        return int(landlord_id_text)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=401, detail="Your landlord session has expired. Sign in again.")


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


def require_landlord_account(
    x_landlord_token: Optional[str] = Header(None, alias="X-Landlord-Token"),
    db: Session = Depends(get_db),
) -> Landlord:
    landlord = db.query(Landlord).filter(Landlord.id == _landlord_id_from_token(x_landlord_token)).first()
    if not landlord or not landlord.active:
        raise HTTPException(status_code=403, detail="Your landlord account is inactive")
    return landlord


def require_src_president_account(
    x_src_token: Optional[str] = Header(None, alias="X-Src-Token"),
    db: Session = Depends(get_db),
) -> SrcPresident:
    president = db.query(SrcPresident).filter(SrcPresident.id == _src_president_id_from_token(x_src_token)).first()
    if not president or not president.active or not president.approved:
        raise HTTPException(status_code=403, detail="Your SRC president account is not active and approved")
    return president


def _student_profile(student: Student) -> dict:
    return {"id": student.id, "student_number": student.student_number, "full_name": student.full_name,
            "email": student.email, "phone": student.phone or "", "institution": student.institution or "",
            "bio": student.bio or "", "profile_image_url": student.profile_image_url,
            "approved": student.approved, "active": student.active, "module_codes": [item.module_code for item in student.modules], "created_at": student.created_at}


def _src_president_profile(president: SrcPresident) -> dict:
    return {
        "id": president.id,
        "full_name": president.full_name,
        "party_name": president.party_name,
        "email": president.email,
        "phone": president.phone or "",
        "profile_image_url": president.profile_image_url,
        "approved": president.approved,
        "active": president.active,
        "created_at": president.created_at,
    }


def _active_src_party_exists(db: Session, party_name: str, exclude_id: Optional[int] = None) -> bool:
    query = db.query(SrcPresident).filter(
        func.lower(SrcPresident.party_name) == party_name.strip().lower(),
        SrcPresident.active.is_(True),
    )
    if exclude_id is not None:
        query = query.filter(SrcPresident.id != exclude_id)
    return query.first() is not None


def _set_student_modules(db: Session, student: Student, codes: List[str]):
    wanted = {code.strip().upper() for code in codes if code and code.strip()}
    existing = {item.module_code: item for item in student.modules}
    for code, item in existing.items():
        if code not in wanted: db.delete(item)
    for code in wanted - set(existing): db.add(StudentModule(student_id=student.id, module_code=code))


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


def require_lecturer_pin(request: Request, x_lecturer_pin: Optional[str] = Header(None, alias="X-Lecturer-Pin")):
    """Dependency guarding lecturer-only routes. Send the PIN as the
    'X-Lecturer-Pin' header. Raises 401 if it's missing or wrong."""
    client_key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    recent = [stamp for stamp in _admin_pin_failures.get(client_key, []) if now - stamp < ADMIN_LOCKOUT_SECONDS]
    if len(recent) >= ADMIN_MAX_FAILURES:
        raise HTTPException(status_code=429, detail="Too many failed admin sign-in attempts. Try again in a few minutes.")
    supplied = x_lecturer_pin or ""
    if not hmac.compare_digest(supplied, LECTURER_PIN):
        recent.append(now)
        _admin_pin_failures[client_key] = recent
        raise HTTPException(status_code=401, detail="Incorrect or missing administrator PIN")
    _admin_pin_failures.pop(client_key, None)
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
        profile_image_url=image_url, approved=True, active=True, module_limit=1,
        created_at=datetime.utcnow().isoformat() + "Z",
    )
    db.add(lecturer)
    db.commit()
    return {"ok": True, "message": "Profile created and activated. You can sign in now; module access appears once modules are assigned."}


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
        raise HTTPException(status_code=403, detail="This lecturer profile is not currently approved")
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
    institution: str = Form(""), bio: str = Form(""), module_codes: str = Form(""), profile_image: Optional[UploadFile] = File(None),
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
                      password_hash=_password_hash(password), approved=True, active=True,
                      created_at=datetime.utcnow().isoformat() + "Z")
    db.add(student); db.flush()
    _set_student_modules(db, student, module_codes.split(","))
    db.commit()
    return {"ok": True, "message": "Profile created and activated. You can sign in now."}


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
        raise HTTPException(status_code=403, detail="This student profile is not currently approved")
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


def _looks_like_math_answer(text: str) -> bool:
    """MathLive stores structured answers as LaTeX; normal text stays plain."""
    return bool(re.search(r"\\[A-Za-z]+|[_^][{]", text))


def _math_answer_image(latex: str) -> Optional[RLImage]:
    """Render one MathLive LaTeX line to a sharp transparent PNG flowable."""
    try:
        from matplotlib.mathtext import math_to_image
        cleaned = latex.strip().replace(r"\mleft", r"\left").replace(r"\mright", r"\right")
        cleaned = re.sub(r"\\placeholder\{[^}]*\}", r"\\square", cleaned)
        output = io.BytesIO()
        math_to_image(f"${cleaned}$", output, format="png", dpi=180)
        output.seek(0)
        with PILImage.open(output) as image:
            pixel_width, pixel_height = image.size
        output.seek(0)
        scale = min(72 / 180, (14 * cm) / max(pixel_width, 1))
        rendered = RLImage(output, width=max(pixel_width * scale, 0.4 * cm), height=max(pixel_height * scale, 0.35 * cm))
        rendered.hAlign = "LEFT"
        return rendered
    except Exception:
        return None


def _append_pdf_answer(flow: list, label: str, answer_text: str, style):
    """Add a text answer as a paragraph or a MathLive answer as real notation."""
    if not _looks_like_math_answer(answer_text):
        flow.append(Paragraph(f"<b>{_pdf_escape(label)}:</b> {_pdf_escape(answer_text).replace(chr(10), '<br/>')}", style))
        return
    flow.append(Paragraph(f"<b>{_pdf_escape(label)}:</b>", style))
    for line in (line for line in answer_text.splitlines() if line.strip()):
        equation = _math_answer_image(line)
        if equation:
            flow.append(equation)
            flow.append(Spacer(1, 0.08 * cm))
        else:
            # Preserve the answer if an unusual command cannot be rendered.
            flow.append(Paragraph(_pdf_escape(line), style))


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
        _append_pdf_answer(flow, "Student's answer", answer_text, styles["Answer"])

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


def _append_pdf_question_image(flow: list, image_url: Optional[str]):
    """Add a remotely hosted question image to a PDF without making a
    temporary disk file. A missing/unavailable image must never prevent the
    learner from downloading the rest of the script."""
    if not image_url:
        return
    try:
        with urllib.request.urlopen(image_url, timeout=10) as response:
            image_bytes = response.read()
        buffer = io.BytesIO(image_bytes)
        with PILImage.open(buffer) as image:
            pixel_width, pixel_height = image.size
        buffer.seek(0)
        scale = min((14 * cm) / pixel_width, (8 * cm) / pixel_height, 1.0)
        flow.append(RLImage(buffer, width=pixel_width * scale, height=pixel_height * scale))
        flow.append(Spacer(1, 0.15 * cm))
    except Exception:
        pass


def build_lesson_script_pdf(db: Session, lesson_id: int, styles) -> list:
    """Build a downloadable lesson handout. Expected quiz answers are not
    included here; they are released in the learner's marked script."""
    lesson = db.query(Lesson).filter(Lesson.id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")

    flow = [
        Paragraph(_pdf_escape(lesson.title), styles["QuizTitle"]),
        Paragraph(f"Module: {_pdf_escape(lesson.module_code)}", styles["MetaLine"]),
    ]
    if lesson.description:
        for paragraph in re.split(r"\n\s*\n", lesson.description.strip()):
            flow.append(Paragraph(_pdf_escape(paragraph).replace("\n", "<br/>"), styles["Answer"]))
            flow.append(Spacer(1, 0.15 * cm))

    questions = (
        db.query(LessonQuestion)
        .filter(LessonQuestion.lesson_id == lesson_id)
        .order_by(LessonQuestion.q_order)
        .all()
    )
    if questions:
        flow.append(Spacer(1, 0.3 * cm))
        flow.append(Paragraph("Lesson quiz", styles["Question"]))
    for index, question in enumerate(questions, start=1):
        flow.append(Paragraph(
            f"Q{index}. {_pdf_escape(question.question)} "
            f"<font size=9 color='#4A5568'>[{question.marks} mark{'s' if question.marks != 1 else ''}]</font>",
            styles["Question"],
        ))
        _append_pdf_question_image(flow, question.image_url)
        if question.type == "mcq" and question.options_json:
            try:
                options = json.loads(question.options_json)
            except (TypeError, json.JSONDecodeError):
                options = []
            for option in options:
                flow.append(Paragraph(f"• {_pdf_escape(str(option))}", styles["Answer"]))
        flow.append(Spacer(1, 0.25 * cm))
    return flow


def build_lesson_submission_pdf(
    db: Session,
    submission_id: int,
    styles,
    include_expected_answers: bool = True,
) -> list:
    """Build one learner's marked lesson quiz script, including expected
    answers for automatically marked MCQ and short-answer questions."""
    submission = db.query(LessonSubmission).filter(LessonSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Lesson submission not found")
    lesson = db.query(Lesson).filter(Lesson.id == submission.lesson_id).first()
    answers = (
        db.query(LessonAnswer)
        .join(LessonQuestion, LessonAnswer.question_id == LessonQuestion.id)
        .filter(LessonAnswer.submission_id == submission_id)
        .order_by(LessonQuestion.q_order)
        .all()
    )

    status = "Fully marked" if submission.fully_marked else "Some questions still pending marking"
    flow = [
        Paragraph(_pdf_escape(lesson.title), styles["QuizTitle"]),
        Paragraph(
            f"Student: {_pdf_escape(submission.student_name)} &nbsp;&nbsp;|&nbsp;&nbsp; "
            f"ID: {_pdf_escape(submission.student_id)} &nbsp;&nbsp;|&nbsp;&nbsp; "
            f"Submitted: {_pdf_escape(format_sast(submission.submitted_at))}",
            styles["MetaLine"],
        ),
        Paragraph(
            f"Total score: <b>{submission.total_score} / {submission.max_score}</b> "
            f"&nbsp;&nbsp;({_pdf_escape(status)})",
            styles["ScoreLine"],
        ),
        Spacer(1, 0.5 * cm),
    ]
    for index, answer in enumerate(answers, start=1):
        question = answer.question
        flow.append(Paragraph(
            f"Q{index}. {_pdf_escape(question.question)} "
            f"<font size=9 color='#4A5568'>[{question.marks} mark{'s' if question.marks != 1 else ''}]</font>",
            styles["Question"],
        ))
        _append_pdf_question_image(flow, question.image_url)
        _append_pdf_answer(flow, "Student's answer", answer.answer_text or "(no answer given)", styles["Answer"])
        if include_expected_answers and question.type in ("mcq", "short") and question.correct_answer:
            flow.append(Paragraph(
                f"<b>Expected answer:</b> {_pdf_escape(question.correct_answer)}",
                styles["Expected"],
            ))
        if answer.awarded_marks is None:
            marks_text = f"<font color='#C81E3A'><b>Needs marking</b></font> / {question.marks}"
        else:
            marks_text = f"{answer.awarded_marks} / {question.marks}"
        flow.append(Paragraph(f"<b>Marks awarded:</b> {marks_text}", styles["Marks"]))
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
    assigned_students = db.query(Student.id).join(StudentModule).filter(
        Student.approved.is_(True),
        Student.active.is_(True),
        StudentModule.module_code == module_code,
    ).all()
    _notify_students_by_push(
        db,
        [student_id for (student_id,) in assigned_students],
        "New quiz available",
        f"A new {module_code} quiz is ready: {title}",
        f"/static/student.html?module={module_code}",
        f"quiz-{quiz.id}",
    )
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


@app.get("/student/modules")
def student_modules(student: Student = Depends(require_student_account)):
    return {"module_codes": [item.module_code for item in student.modules]}


@app.put("/student/modules")
def update_student_modules(payload: ModuleSelection, student: Student = Depends(require_student_account), db: Session = Depends(get_db)):
    available = {row[0] for row in db.query(Quiz.module_code).distinct().all()} | {row[0] for row in db.query(Lesson.module_code).distinct().all()}
    wanted = {code.strip().upper() for code in payload.module_codes if code and code.strip()}
    invalid = wanted - available
    if invalid:
        raise HTTPException(status_code=400, detail="Only modules created by Admin can be selected")
    _set_student_modules(db, student, list(wanted)); db.commit()
    return {"module_codes": sorted(wanted)}


@app.get("/quizzes/by-module/{module_code}")
def list_quizzes_by_module(module_code: str, db: Session = Depends(get_db)):
    rows = (db.query(Quiz).filter(Quiz.module_code == module_code.strip().upper()).order_by(Quiz.id.desc()).all())
    return [{"id": q.id, "title": q.title, "module_code": q.module_code, "created_at": q.created_at} for q in rows]


@app.get("/student/quizzes/by-module/{module_code}")
def list_student_quizzes_by_module(
    module_code: str,
    student: Student = Depends(require_student_account),
    db: Session = Depends(get_db),
):
    """List a module's quizzes together with this student's latest result."""
    rows = (
        db.query(Quiz)
        .filter(Quiz.module_code == module_code.strip().upper())
        .order_by(Quiz.id.desc())
        .all()
    )
    latest_by_quiz = {}
    for submission in (
        db.query(Submission)
        .filter(Submission.student_id == student.student_number)
        .order_by(Submission.submitted_at.desc())
        .all()
    ):
        latest_by_quiz.setdefault(submission.quiz_id, submission)

    output = []
    for quiz in rows:
        submission = latest_by_quiz.get(quiz.id)
        output.append({
            "id": quiz.id,
            "title": quiz.title,
            "module_code": quiz.module_code,
            "created_at": quiz.created_at,
            "completed": submission is not None,
            "submission_id": submission.id if submission else None,
            "total_score": submission.total_score if submission else None,
            "max_score": submission.max_score if submission else None,
            "fully_marked": submission.fully_marked if submission else None,
        })
    return output


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
    if not video_bytes:
        raise HTTPException(status_code=400, detail="The selected video file is empty")
    if len(video_bytes) > MAX_LESSON_VIDEO_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Your video is too large. The maximum allowed size is 80 MB. Please compress the video or choose a smaller MP4.",
        )
    try:
        video_url = upload_video_bytes(video_bytes, folder=f"lesson_videos/{module_code}")
    except Exception:
        raise HTTPException(
            status_code=502,
            detail="Your video is too large. The maximum allowed size is 80 MB. Please compress the video or choose a smaller MP4.",
        )

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


@app.get("/student/lessons")
def list_student_lessons(
    module_code: Optional[str] = None,
    student: Student = Depends(require_student_account),
    db: Session = Depends(get_db),
):
    """List lessons with each student's latest completion and result state."""
    query = db.query(Lesson)
    if module_code:
        query = query.filter(Lesson.module_code == module_code.strip().upper())
    rows = query.order_by(Lesson.id.desc()).all()
    latest_by_lesson = {}
    for submission in (
        db.query(LessonSubmission)
        .filter(LessonSubmission.student_id == student.student_number)
        .order_by(LessonSubmission.submitted_at.desc())
        .all()
    ):
        latest_by_lesson.setdefault(submission.lesson_id, submission)

    output = []
    for lesson in rows:
        submission = latest_by_lesson.get(lesson.id)
        output.append({
            "id": lesson.id,
            "title": lesson.title,
            "description": lesson.description,
            "module_code": lesson.module_code,
            "created_at": lesson.created_at,
            "completed": submission is not None,
            "submission_id": submission.id if submission else None,
            "total_score": submission.total_score if submission else None,
            "max_score": submission.max_score if submission else None,
            "fully_marked": submission.fully_marked if submission else None,
        })
    return output


@app.get("/lecturer/lessons")
def list_my_lessons(lecturer: Lecturer = Depends(require_lecturer_account), db: Session = Depends(get_db)):
    rows = db.query(Lesson).filter(Lesson.lecturer_id == lecturer.id).order_by(Lesson.id.desc()).all()
    lesson_ids = [lesson.id for lesson in rows]
    analytics = {}
    if lesson_ids:
        counts = db.query(
            LessonView.lesson_id,
            func.count(LessonView.id),
            func.coalesce(func.sum(LessonView.view_count), 0),
        ).filter(LessonView.lesson_id.in_(lesson_ids)).group_by(LessonView.lesson_id).all()
        analytics = {lesson_id: {"unique_viewers": viewers, "video_starts": starts} for lesson_id, viewers, starts in counts}
    return [{"id": l.id, "title": l.title, "description": l.description, "module_code": l.module_code,
             "created_at": l.created_at, **analytics.get(l.id, {"unique_viewers": 0, "video_starts": 0})} for l in rows]


@app.post("/student/lessons/{lesson_id}/view")
def record_lesson_view(lesson_id: int, student: Student = Depends(require_student_account), db: Session = Depends(get_db)):
    lesson = db.query(Lesson).filter(Lesson.id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    now = datetime.now(timezone.utc).isoformat()
    view = db.query(LessonView).filter(LessonView.lesson_id == lesson_id, LessonView.student_account_id == student.id).first()
    if view:
        view.last_viewed_at = now
        view.view_count = (view.view_count or 0) + 1
    else:
        view = LessonView(lesson_id=lesson_id, student_account_id=student.id, first_viewed_at=now, last_viewed_at=now, view_count=1)
        db.add(view)
    db.commit()
    return {"ok": True}


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


@app.get("/lesson/{lesson_id}/script/pdf")
def download_lesson_script_pdf(lesson_id: int, db: Session = Depends(get_db)):
    """Download the lesson notes and quiz questions shown below the video."""
    lesson = db.query(Lesson).filter(Lesson.id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    buffer = io.BytesIO()
    document = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=2 * cm, leftMargin=2 * cm,
                                 topMargin=2 * cm, bottomMargin=2 * cm)
    document.build(build_lesson_script_pdf(db, lesson_id, build_pdf_stylesheet()))
    buffer.seek(0)
    safe_title = "".join(c for c in lesson.title if c.isalnum() or c in (" ", "_", "-")).strip() or "lesson"
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}_lesson_script.pdf"'},
    )


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


@app.get("/student/lesson/submission/{submission_id}/pdf")
def download_student_lesson_submission_pdf(
    submission_id: int,
    student: Student = Depends(require_student_account),
    db: Session = Depends(get_db),
):
    """Download the signed-in learner's marked lesson script and expected answers."""
    submission = db.query(LessonSubmission).filter(LessonSubmission.id == submission_id).first()
    if not submission or submission.student_id != student.student_number:
        raise HTTPException(status_code=404, detail="Lesson submission not found")
    lesson = db.query(Lesson).filter(Lesson.id == submission.lesson_id).first()
    buffer = io.BytesIO()
    document = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=2 * cm, leftMargin=2 * cm,
                                 topMargin=2 * cm, bottomMargin=2 * cm)
    document.build(build_lesson_submission_pdf(db, submission_id, build_pdf_stylesheet(), True))
    buffer.seek(0)
    safe_title = "".join(c for c in lesson.title if c.isalnum() or c in (" ", "_", "-")).strip() or "lesson"
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}_marked_script.pdf"'},
    )


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


@app.get("/lecturer/lesson/submission/{submission_id}/pdf")
def download_lesson_submission_pdf(
    submission_id: int,
    lecturer: Lecturer = Depends(require_lecturer_account),
    db: Session = Depends(get_db),
):
    """Download a learner's marked lesson script with expected answers."""
    submission = db.query(LessonSubmission).filter(LessonSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Lesson submission not found")
    lesson = _require_owned_lesson(db, submission.lesson_id, lecturer)
    buffer = io.BytesIO()
    document = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=2 * cm, leftMargin=2 * cm,
                                 topMargin=2 * cm, bottomMargin=2 * cm)
    document.build(build_lesson_submission_pdf(db, submission_id, build_pdf_stylesheet(), True))
    buffer.seek(0)
    safe_student = "".join(c for c in submission.student_name if c.isalnum() or c in (" ", "_", "-")).strip() or "student"
    safe_title = "".join(c for c in lesson.title if c.isalnum() or c in (" ", "_", "-")).strip() or "lesson"
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}_{safe_student}_marked_script.pdf"'},
    )


# ---------------------------------------------------------------------------
# Comments — PUBLIC read/write; posting "as lecturer" requires the PIN.
# ---------------------------------------------------------------------------

@app.get("/lesson/{lesson_id}/comments")
def get_lesson_comments(
    lesson_id: int,
    x_student_token: Optional[str] = Header(None, alias="X-Student-Token"),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(LessonComment)
        .filter(LessonComment.lesson_id == lesson_id)
        .order_by(LessonComment.is_pinned.desc(), LessonComment.created_at.asc())
        .all()
    )
    current_student_id = None
    if x_student_token:
        try:
            current_student_id = _student_id_from_token(x_student_token)
        except HTTPException:
            # Reading stays public; an expired login only removes own-post controls.
            pass

    author_ids = {item.author_student_id for item in rows if item.author_student_id}
    students_by_id = {
        item.id: item
        for item in db.query(Student).filter(Student.id.in_(author_ids)).all()
    } if author_ids else {}
    children_by_parent = {}
    for comment in rows:
        children_by_parent.setdefault(comment.parent_id, []).append(comment)

    def serialize(comment: LessonComment) -> dict:
        author = students_by_id.get(comment.author_student_id)
        anonymous = bool(comment.is_anonymous)
        return {
            "id": comment.id,
            "parent_id": comment.parent_id,
            "author_name": "Anonymous student" if anonymous else (author.full_name if author else comment.author_name),
            "author_image_url": None if anonymous else (author.profile_image_url if author else None),
            "is_anonymous": anonymous,
            "is_author": bool(comment.author_student_id and comment.author_student_id == current_student_id),
            "is_lecturer": comment.is_lecturer,
            "is_official": comment.is_official,
            "is_pinned": comment.is_pinned,
            "comment_text": comment.comment_text,
            "created_at": comment.created_at,
            "replies": [serialize(child) for child in children_by_parent.get(comment.id, [])],
        }

    roots = [serialize(comment) for comment in children_by_parent.get(None, [])]
    return sorted(roots, key=lambda item: (bool(item["is_pinned"]), item["created_at"]), reverse=True)


@app.post("/lesson/{lesson_id}/comments")
def post_lesson_comment(
    lesson_id: int,
    payload: CommentCreate,
    x_lecturer_token: Optional[str] = Header(None, alias="X-Lecturer-Token"),
    x_student_token: Optional[str] = Header(None, alias="X-Student-Token"),
    db: Session = Depends(get_db),
):
    content = payload.comment_text.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Comment can't be empty")
    if len(content) > 1500:
        raise HTTPException(status_code=400, detail="Comments can be up to 1,500 characters")
    lecturer = None
    student = None
    if payload.is_lecturer:
        lecturer = db.query(Lecturer).filter(Lecturer.id == _lecturer_id_from_token(x_lecturer_token)).first()
        if not lecturer or not lecturer.active or not lecturer.approved:
            raise HTTPException(status_code=401, detail="An approved lecturer account is required to post as a lecturer")
    else:
        student = db.query(Student).filter(Student.id == _student_id_from_token(x_student_token)).first()
        if not student or not student.active or not student.approved:
            raise HTTPException(status_code=401, detail="An approved student account is required to join the discussion")

    lesson = db.query(Lesson).filter(Lesson.id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    if payload.parent_id is not None and not db.query(LessonComment).filter(
        LessonComment.id == payload.parent_id,
        LessonComment.lesson_id == lesson_id,
    ).first():
        raise HTTPException(status_code=404, detail="The comment you are replying to no longer exists")

    comment = LessonComment(
        lesson_id=lesson_id,
        author_student_id=student.id if student else None,
        parent_id=payload.parent_id,
        author_name=lecturer.full_name if lecturer else ("Anonymous student" if payload.is_anonymous else student.full_name),
        is_lecturer=payload.is_lecturer,
        is_anonymous=bool(payload.is_anonymous) if student else False,
        is_official=False,
        is_pinned=False,
        comment_text=content,
        created_at=datetime.utcnow().isoformat() + "Z",
    )
    db.add(comment)
    if student:
        # Full-name tags create the same private notification as Fun Page tags.
        tagged_students = db.query(Student).filter(
            Student.approved == True, Student.active == True, Student.id != student.id  # noqa: E712
        ).all()
        for tagged in tagged_students:
            mention = "@" + tagged.full_name.strip()
            if mention != "@" and re.search(r"(?<!\\w)" + re.escape(mention) + r"(?!\\w)", content, re.IGNORECASE):
                db.add(DirectMessage(
                    sender_type="student",
                    sender_id=student.id,
                    recipient_type="student",
                    recipient_id=tagged.id,
                    content=f"{student.full_name} mentioned you in the lesson discussion for {lesson.title}: {content[:300]}",
                    created_at=datetime.now(timezone.utc).isoformat(),
                ))
    db.commit()
    return {"id": comment.id, "ok": True}


@app.delete("/lesson/comments/{comment_id}")
def delete_lesson_comment(
    comment_id: int,
    student: Student = Depends(require_student_account),
    db: Session = Depends(get_db),
):
    comment = db.query(LessonComment).filter(LessonComment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    if comment.author_student_id != student.id:
        raise HTTPException(status_code=403, detail="You can only delete your own comments")

    def delete_thread(item: LessonComment):
        for child in db.query(LessonComment).filter(LessonComment.parent_id == item.id).all():
            delete_thread(child)
        db.delete(item)

    delete_thread(comment)
    db.commit()
    return {"ok": True}


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
    if payload.module_codes is not None: _set_student_modules(db, student, payload.module_codes)
    db.commit()
    return _student_profile(student)


@app.post("/admin/students/{student_id}/reset-password")
def admin_reset_student_password(student_id: int, payload: PasswordReset, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student: raise HTTPException(status_code=404, detail="Student not found")
    if len(payload.password) < 8: raise HTTPException(status_code=400, detail="The new password must be at least 8 characters")
    student.password_hash = _password_hash(payload.password)
    db.commit()
    db.refresh(student)
    if not _password_matches(payload.password, student.password_hash):
        raise HTTPException(status_code=500, detail="The new password could not be saved. Please try again.")
    return {"ok": True}


@app.delete("/admin/students/{student_id}")
def admin_delete_student(student_id: int, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student: raise HTTPException(status_code=404, detail="Student not found")
    db.delete(student); db.commit()
    return {"ok": True}


@app.get("/admin/src-presidents")
def admin_list_src_presidents(_pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    return [_src_president_profile(item) for item in db.query(SrcPresident).order_by(SrcPresident.created_at.desc()).all()]


@app.put("/admin/src-presidents/{president_id}")
def admin_update_src_president(president_id: int, payload: AdminSrcPresidentUpdate, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    president = db.query(SrcPresident).filter(SrcPresident.id == president_id).first()
    if not president:
        raise HTTPException(status_code=404, detail="SRC president profile not found")
    next_active = president.active if payload.active is None else payload.active
    if next_active and _active_src_party_exists(db, president.party_name, president.id):
        raise HTTPException(status_code=409, detail="Another active SRC president profile already represents this party")
    if payload.approved is not None:
        president.approved = payload.approved
    if payload.active is not None:
        president.active = payload.active
    db.commit()
    return _src_president_profile(president)


@app.delete("/admin/src-presidents/{president_id}")
def admin_delete_src_president(president_id: int, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    president = db.query(SrcPresident).filter(SrcPresident.id == president_id).first()
    if not president:
        raise HTTPException(status_code=404, detail="SRC president profile not found")
    db.delete(president)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Administrator: every quiz script across every module
# ---------------------------------------------------------------------------

def _message_person(db: Session, kind: str, person_id: Optional[int]) -> str:
    if kind == "admin":
        return "NucleoCampus Admin"
    if kind == "src_president":
        president = db.query(SrcPresident).filter(SrcPresident.id == person_id).first()
        return f"{president.party_name} SRC president" if president else "Former SRC president"
    if kind == "landlord":
        provider = db.query(Landlord).filter(Landlord.id == person_id).first()
        return (provider.business_name or provider.full_name) if provider else "Former marketplace provider"
    model = Student if kind == "student" else Lecturer
    person = db.query(model).filter(model.id == person_id).first()
    return person.full_name if person else "Unknown account"


def _message_dict(db: Session, message: DirectMessage, viewer_type: str = "", viewer_id: Optional[int] = None):
    anonymous = bool(getattr(message, "is_anonymous", False) and message.sender_type == "student")
    viewing_own = viewer_type == "student" and viewer_id == message.sender_id
    sender_name = "You (anonymous)" if anonymous and viewing_own else "Anonymous student" if anonymous else _message_person(db, message.sender_type, message.sender_id)
    return {"id": message.id, "sender_type": message.sender_type, "sender_id": message.sender_id if not anonymous or viewing_own else None,
            "sender_name": sender_name, "is_anonymous": anonymous,
            "recipient_type": message.recipient_type, "recipient_id": message.recipient_id,
            "recipient_name": _message_person(db, message.recipient_type, message.recipient_id),
            "content": message.content, "read_at": message.read_at,
            "unread": bool(message.read_at is None and message.recipient_type == viewer_type and message.recipient_id == viewer_id),
            "created_at": message.created_at}


def _message_pair_blocked(db: Session, sender_type: str, sender_id: Optional[int], recipient_type: str, recipient_id: int) -> bool:
    if sender_id is None:
        return False
    return db.query(DirectMessageBlock).filter(
        ((DirectMessageBlock.blocker_type == sender_type) & (DirectMessageBlock.blocker_id == sender_id) &
         (DirectMessageBlock.blocked_type == recipient_type) & (DirectMessageBlock.blocked_id == recipient_id)) |
        ((DirectMessageBlock.blocker_type == recipient_type) & (DirectMessageBlock.blocker_id == recipient_id) &
         (DirectMessageBlock.blocked_type == sender_type) & (DirectMessageBlock.blocked_id == sender_id))
    ).first() is not None


def _push_enabled() -> bool:
    return bool(webpush and VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY and VAPID_SUBJECT)


def _notify_students_by_push(db: Session, student_ids: List[int], title: str, body: str, url: str, tag: str):
    """Deliver a best-effort browser push notification to every opted-in device.

    Notifications are intentionally generic: message text stays inside the
    authenticated app instead of appearing on a locked phone screen.
    """
    if not _push_enabled() or not student_ids:
        return
    subscriptions = db.query(PushSubscription).filter(
        PushSubscription.student_id.in_(set(student_ids))
    ).all()
    payload = json.dumps({"title": title[:90], "body": body[:180], "url": url, "tag": tag[:80]})
    removed = False
    for subscription in subscriptions:
        try:
            webpush(
                subscription_info=json.loads(subscription.subscription_json),
                data=payload,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={"sub": VAPID_SUBJECT},
                ttl=60 * 60 * 24,
            )
        except WebPushException as error:
            status = getattr(getattr(error, "response", None), "status_code", None)
            if status in (404, 410):
                db.delete(subscription)
                removed = True
        except (TypeError, ValueError, json.JSONDecodeError):
            db.delete(subscription)
            removed = True
    if removed:
        db.commit()


def _create_direct_message(db: Session, sender_type: str, sender_id: Optional[int], payload: DirectMessageCreate):
    recipient_type = payload.recipient_type.strip().lower()
    content = payload.content.strip()
    if recipient_type not in {"student", "lecturer", "landlord", "admin"} or not content or len(content) > 2000:
        raise HTTPException(status_code=400, detail="Choose a recipient and enter a message of up to 2,000 characters")
    if recipient_type == "admin":
        recipient = None
        recipient_id = 0
    else:
        model = Student if recipient_type == "student" else Lecturer if recipient_type == "lecturer" else Landlord
        recipient = db.query(model).filter(model.id == payload.recipient_id).first()
        approved = True if recipient_type == "landlord" else bool(recipient and recipient.approved)
        if not recipient or not approved or not recipient.active:
            raise HTTPException(status_code=404, detail="That recipient is not available")
        recipient_id = recipient.id
    if _message_pair_blocked(db, sender_type, sender_id, recipient_type, recipient_id):
        raise HTTPException(status_code=403, detail="Private messaging is blocked between these accounts")
    message = DirectMessage(sender_type=sender_type, sender_id=sender_id, recipient_type=recipient_type,
                            recipient_id=recipient_id, content=content,
                            is_anonymous=bool(payload.is_anonymous and sender_type == "student"),
                            created_at=datetime.now(timezone.utc).isoformat())
    db.add(message); db.commit(); db.refresh(message)
    if recipient_type == "student":
        _notify_students_by_push(
            db,
            [recipient.id],
            "New NucleoCampus message",
            f"You have a new message from {_message_person(db, sender_type, sender_id)}.",
            "/static/student.html",
            f"message-{message.id}",
        )
    return _message_dict(db, message, sender_type, sender_id)


def _inbox(db: Session, kind: str, person_id: int):
    unread = db.query(DirectMessage).filter(DirectMessage.recipient_type == kind,
        DirectMessage.recipient_id == person_id, DirectMessage.read_at.is_(None)).all()
    now = datetime.now(timezone.utc).isoformat()
    for item in unread:
        item.read_at = now
    if unread:
        db.commit()
    rows = db.query(DirectMessage).filter(
        ((DirectMessage.recipient_type == kind) & (DirectMessage.recipient_id == person_id)) |
        ((DirectMessage.sender_type == kind) & (DirectMessage.sender_id == person_id))
    ).order_by(DirectMessage.created_at.desc()).all()
    return [_message_dict(db, row, kind, person_id) for row in rows]


@app.get("/notifications/config")
def notification_config():
    """Public VAPID key for browsers; the private key never leaves the server."""
    return {"enabled": _push_enabled(), "public_key": VAPID_PUBLIC_KEY if _push_enabled() else ""}


@app.post("/student/notifications/subscribe")
def subscribe_student_notifications(
    payload: PushSubscriptionCreate,
    student: Student = Depends(require_student_account),
    db: Session = Depends(get_db),
):
    if not _push_enabled():
        raise HTTPException(status_code=503, detail="Push notifications have not been configured yet")
    endpoint = payload.endpoint.strip()
    if not endpoint.startswith("https://") or not payload.keys.get("p256dh") or not payload.keys.get("auth"):
        raise HTTPException(status_code=422, detail="That device notification subscription is invalid")
    saved = db.query(PushSubscription).filter(PushSubscription.endpoint == endpoint).first()
    if saved:
        saved.student_id = student.id
        saved.subscription_json = json.dumps({"endpoint": endpoint, "keys": payload.keys})
        saved.created_at = datetime.now(timezone.utc).isoformat()
    else:
        db.add(PushSubscription(
            student_id=student.id,
            endpoint=endpoint,
            subscription_json=json.dumps({"endpoint": endpoint, "keys": payload.keys}),
            created_at=datetime.now(timezone.utc).isoformat(),
        ))
    db.commit()
    return {"ok": True}


@app.delete("/student/notifications/subscribe")
def unsubscribe_student_notifications(
    payload: PushSubscriptionDelete,
    student: Student = Depends(require_student_account),
    db: Session = Depends(get_db),
):
    subscription = db.query(PushSubscription).filter(
        PushSubscription.endpoint == payload.endpoint.strip(),
        PushSubscription.student_id == student.id,
    ).first()
    if subscription:
        db.delete(subscription)
        db.commit()
    return {"ok": True}


@app.get("/student/message-lecturers")
def student_message_lecturers(student: Student = Depends(require_student_account), db: Session = Depends(get_db)):
    module_codes = {item.module_code for item in student.modules}
    rows = db.query(Lecturer).join(LecturerModule).filter(
        Lecturer.approved.is_(True), Lecturer.active.is_(True), LecturerModule.module_code.in_(module_codes)
    ).distinct().order_by(Lecturer.full_name).all() if module_codes else []
    return [{"id": item.id, "full_name": item.full_name,
             "module_codes": [module.module_code for module in item.modules if module.module_code in module_codes]} for item in rows]


@app.get("/lecturer/message-students")
def lecturer_message_students(lecturer: Lecturer = Depends(require_lecturer_account), db: Session = Depends(get_db)):
    assigned = {item.module_code for item in lecturer.modules}
    return [{"id": item.id, "full_name": item.full_name, "student_number": item.student_number,
             "module_codes": [module.module_code for module in item.modules if module.module_code in assigned]}
            for item in db.query(Student).join(StudentModule).filter(Student.approved.is_(True), Student.active.is_(True), StudentModule.module_code.in_(assigned)).distinct().order_by(Student.full_name).all()] if assigned else []


@app.get("/lecturer/students")
def lecturer_students(lecturer: Lecturer = Depends(require_lecturer_account), db: Session = Depends(get_db)):
    assigned = {item.module_code for item in lecturer.modules}
    rows = db.query(Student).join(StudentModule).filter(Student.approved.is_(True), Student.active.is_(True), StudentModule.module_code.in_(assigned)).distinct().order_by(Student.full_name).all()
    return [{"id": item.id, "full_name": item.full_name, "student_number": item.student_number,
             "module_codes": [module.module_code for module in item.modules if module.module_code in assigned]} for item in rows]


@app.get("/student/messages")
def student_messages(student: Student = Depends(require_student_account), db: Session = Depends(get_db)):
    return _inbox(db, "student", student.id)


@app.get("/lecturer/messages")
def lecturer_messages(lecturer: Lecturer = Depends(require_lecturer_account), db: Session = Depends(get_db)):
    return _inbox(db, "lecturer", lecturer.id)


@app.get("/student/messages/unread")
def student_unread_messages(student: Student = Depends(require_student_account), db: Session = Depends(get_db)):
    return {"count": db.query(DirectMessage).filter(DirectMessage.recipient_type == "student", DirectMessage.recipient_id == student.id, DirectMessage.read_at.is_(None)).count()}


@app.get("/lecturer/messages/unread")
def lecturer_unread_messages(lecturer: Lecturer = Depends(require_lecturer_account), db: Session = Depends(get_db)):
    return {"count": db.query(DirectMessage).filter(DirectMessage.recipient_type == "lecturer", DirectMessage.recipient_id == lecturer.id, DirectMessage.read_at.is_(None)).count()}


@app.post("/student/messages")
def student_send_message(payload: DirectMessageCreate, student: Student = Depends(require_student_account), db: Session = Depends(get_db)):
    recipient_type = payload.recipient_type.strip().lower()
    if recipient_type not in {"lecturer", "landlord", "admin"}:
        raise HTTPException(status_code=400, detail="Students can message an administrator, assigned lecturer or marketplace provider")
    if recipient_type == "lecturer":
        student_codes = {item.module_code for item in student.modules}
        allowed = db.query(LecturerModule).filter(LecturerModule.lecturer_id == payload.recipient_id, LecturerModule.module_code.in_(student_codes)).first() if student_codes else None
        if not allowed:
            raise HTTPException(status_code=403, detail="You can message lecturers assigned to your modules only")
    return _create_direct_message(db, "student", student.id, payload)


@app.get("/marketing/provider/messages")
def provider_messages(landlord: Landlord = Depends(require_landlord_account), db: Session = Depends(get_db)):
    rows = db.query(DirectMessage).filter(
        ((DirectMessage.recipient_type == "landlord") & (DirectMessage.recipient_id == landlord.id)) |
        ((DirectMessage.sender_type == "landlord") & (DirectMessage.sender_id == landlord.id))
    ).order_by(DirectMessage.created_at.desc()).all()
    return [_message_dict(db, row, "landlord", landlord.id) for row in rows]


@app.post("/marketing/provider/messages/read/{student_id}")
def provider_mark_thread_read(student_id: int, landlord: Landlord = Depends(require_landlord_account), db: Session = Depends(get_db)):
    rows = db.query(DirectMessage).filter(DirectMessage.sender_type == "student", DirectMessage.sender_id == student_id,
        DirectMessage.recipient_type == "landlord", DirectMessage.recipient_id == landlord.id, DirectMessage.read_at.is_(None)).all()
    now = datetime.now(timezone.utc).isoformat()
    for row in rows:
        row.read_at = now
    if rows:
        db.commit()
    return {"ok": True, "read_count": len(rows)}


@app.post("/marketing/provider/messages")
def provider_send_message(payload: DirectMessageCreate, landlord: Landlord = Depends(require_landlord_account), db: Session = Depends(get_db)):
    recipient_type = payload.recipient_type.strip().lower()
    if recipient_type not in {"student", "landlord"}:
        raise HTTPException(status_code=400, detail="Providers can reply to students or other marketplace providers")
    if recipient_type == "landlord" and payload.recipient_id == landlord.id:
        raise HTTPException(status_code=400, detail="Choose another provider")
    return _create_direct_message(db, "landlord", landlord.id, payload)


@app.post("/marketing/provider/messages/broadcast")
def provider_broadcast_message(payload: ProviderBroadcastMessage, landlord: Landlord = Depends(require_landlord_account), db: Session = Depends(get_db)):
    content = payload.content.strip()
    if not content or len(content) > 2000:
        raise HTTPException(status_code=400, detail="Enter a message of up to 2,000 characters")
    if payload.audience not in {"unread", "read", "selected"}:
        raise HTTPException(status_code=400, detail="Choose unread, read or selected contacts")
    incoming = db.query(DirectMessage).filter(DirectMessage.sender_type == "student", DirectMessage.recipient_type == "landlord",
        DirectMessage.recipient_id == landlord.id, DirectMessage.sender_id.is_not(None)).all()
    allowed = {}
    for message in incoming:
        state = allowed.setdefault(message.sender_id, {"read": False, "unread": False})
        state["unread" if message.read_at is None else "read"] = True
    requested = set(payload.recipient_ids)
    student_ids = {student_id for student_id, state in allowed.items() if student_id in requested and (payload.audience == "selected" or state[payload.audience]) and not _message_pair_blocked(db, "landlord", landlord.id, "student", student_id)}
    students = db.query(Student).filter(Student.id.in_(student_ids), Student.approved.is_(True), Student.active.is_(True)).all() if student_ids else []
    now = datetime.now(timezone.utc).isoformat()
    for student in students:
        db.add(DirectMessage(sender_type="landlord", sender_id=landlord.id, recipient_type="student", recipient_id=student.id, content=content, is_anonymous=False, created_at=now))
    if payload.audience == "unread":
        for message in incoming:
            if message.sender_id in student_ids and message.read_at is None:
                message.read_at = now
    db.commit()
    _notify_students_by_push(db, [student.id for student in students], "Marketplace provider update", "A provider you contacted sent an update.", "/static/marketing.html", f"provider-broadcast-{landlord.id}-{now}")
    return {"ok": True, "recipient_count": len(students)}


def _set_message_block(db: Session, blocker_type: str, blocker_id: int, payload: MessageBlockRequest, blocked: bool):
    target_type = payload.target_type.strip().lower()
    if target_type not in {"student", "landlord"} or payload.target_id <= 0 or (target_type == blocker_type and payload.target_id == blocker_id):
        raise HTTPException(status_code=400, detail="Choose a valid account to block")
    row = db.query(DirectMessageBlock).filter(DirectMessageBlock.blocker_type == blocker_type, DirectMessageBlock.blocker_id == blocker_id,
        DirectMessageBlock.blocked_type == target_type, DirectMessageBlock.blocked_id == payload.target_id).first()
    if blocked and not row:
        db.add(DirectMessageBlock(blocker_type=blocker_type, blocker_id=blocker_id, blocked_type=target_type, blocked_id=payload.target_id, created_at=datetime.now(timezone.utc).isoformat()))
    if not blocked and row:
        db.delete(row)
    db.commit()
    return {"ok": True, "blocked": blocked}


@app.get("/marketing/provider/message-blocks")
def provider_message_blocks(landlord: Landlord = Depends(require_landlord_account), db: Session = Depends(get_db)):
    return [{"target_type": row.blocked_type, "target_id": row.blocked_id} for row in db.query(DirectMessageBlock).filter(DirectMessageBlock.blocker_type == "landlord", DirectMessageBlock.blocker_id == landlord.id).all()]


@app.post("/marketing/provider/message-blocks")
def provider_block_message_account(payload: MessageBlockRequest, landlord: Landlord = Depends(require_landlord_account), db: Session = Depends(get_db)):
    return _set_message_block(db, "landlord", landlord.id, payload, True)


@app.delete("/marketing/provider/message-blocks")
def provider_unblock_message_account(payload: MessageBlockRequest, landlord: Landlord = Depends(require_landlord_account), db: Session = Depends(get_db)):
    return _set_message_block(db, "landlord", landlord.id, payload, False)


@app.get("/student/message-blocks")
def student_message_blocks(student: Student = Depends(require_student_account), db: Session = Depends(get_db)):
    return [{"target_type": row.blocked_type, "target_id": row.blocked_id} for row in db.query(DirectMessageBlock).filter(DirectMessageBlock.blocker_type == "student", DirectMessageBlock.blocker_id == student.id).all()]


@app.post("/student/message-blocks")
def student_block_message_account(payload: MessageBlockRequest, student: Student = Depends(require_student_account), db: Session = Depends(get_db)):
    return _set_message_block(db, "student", student.id, payload, True)


@app.delete("/student/message-blocks")
def student_unblock_message_account(payload: MessageBlockRequest, student: Student = Depends(require_student_account), db: Session = Depends(get_db)):
    return _set_message_block(db, "student", student.id, payload, False)


@app.post("/lecturer/messages")
def lecturer_send_message(payload: DirectMessageCreate, lecturer: Lecturer = Depends(require_lecturer_account), db: Session = Depends(get_db)):
    if payload.recipient_type.strip().lower() != "student":
        raise HTTPException(status_code=400, detail="Lecturers can message students only")
    assigned = {item.module_code for item in lecturer.modules}
    student_codes = {item.module_code for item in db.query(StudentModule).filter(StudentModule.student_id == payload.recipient_id).all()}
    if not assigned.intersection(student_codes):
        raise HTTPException(status_code=403, detail="You can message students enrolled in your modules only")
    return _create_direct_message(db, "lecturer", lecturer.id, payload)


@app.post("/lecturer/messages/broadcast")
def lecturer_broadcast_message(payload: LecturerBroadcastMessage, lecturer: Lecturer = Depends(require_lecturer_account), db: Session = Depends(get_db)):
    content, module_code = payload.content.strip(), payload.module_code.strip().upper()
    assigned = {item.module_code for item in lecturer.modules}
    if module_code not in assigned:
        raise HTTPException(status_code=403, detail="Choose one of your assigned modules")
    if not content or len(content) > 2000:
        raise HTTPException(status_code=400, detail="Enter a message of up to 2,000 characters")
    recipients = db.query(Student).join(StudentModule).filter(Student.approved.is_(True), Student.active.is_(True), StudentModule.module_code == module_code).distinct().all()
    now = datetime.now(timezone.utc).isoformat()
    for student in recipients:
        db.add(DirectMessage(sender_type="lecturer", sender_id=lecturer.id, recipient_type="student", recipient_id=student.id, content=content, is_anonymous=False, created_at=now))
    db.commit()
    _notify_students_by_push(db, [student.id for student in recipients], "New module message", f"A new message was sent to {module_code} students.", "/static/student.html", f"module-message-{module_code}-{now}")
    return {"ok": True, "recipient_count": len(recipients), "module_code": module_code}


@app.get("/admin/messages")
def admin_messages(_pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    return [_message_dict(db, item, "admin", None) for item in db.query(DirectMessage).order_by(DirectMessage.created_at.desc()).all()]


@app.post("/admin/messages")
def admin_send_message(payload: DirectMessageCreate, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    return _create_direct_message(db, "admin", None, payload)


@app.post("/admin/messages/broadcast")
def admin_broadcast_message(payload: AdminBroadcastMessage, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    content = payload.content.strip()
    if not content or len(content) > 2000:
        raise HTTPException(status_code=400, detail="Enter a message of up to 2,000 characters")
    codes = {code.strip().upper() for code in payload.module_codes if code and code.strip()}
    query = db.query(Student).filter(Student.approved.is_(True), Student.active.is_(True))
    if codes:
        query = query.join(StudentModule).filter(StudentModule.module_code.in_(codes)).distinct()
    recipients = query.all()
    now = datetime.now(timezone.utc).isoformat()
    for student in recipients:
        db.add(DirectMessage(sender_type="admin", sender_id=None, recipient_type="student", recipient_id=student.id, content=content, created_at=now))
    db.commit()
    _notify_students_by_push(
        db,
        [student.id for student in recipients],
        "New NucleoCampus message",
        "NucleoCampus Admin sent you a new message.",
        "/static/student.html",
        f"admin-broadcast-{now}",
    )
    return {"ok": True, "recipient_count": len(recipients)}


@app.delete("/admin/messages/{message_id}")
def admin_delete_message(message_id: int, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    message = db.query(DirectMessage).filter(DirectMessage.id == message_id).first()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    db.delete(message); db.commit()
    return {"ok": True}

def _submission_detail_payload(db: Session, submission: Submission):
    answers = (db.query(Answer).join(Question, Answer.question_id == Question.id)
               .filter(Answer.submission_id == submission.id).order_by(Question.q_order).all())
    return {
        "submission": {"id": submission.id, "quiz_id": submission.quiz_id,
                       "student_id": submission.student_id, "student_name": submission.student_name,
                       "submitted_at": submission.submitted_at, "total_score": submission.total_score,
                       "max_score": submission.max_score, "fully_marked": submission.fully_marked},
        "answers": [{"answer_id": a.id, "question_id": a.question_id, "answer_text": a.answer_text,
                     "awarded_marks": a.awarded_marks, "marked": a.marked, "type": a.question.type,
                     "question": a.question.question, "max_marks": a.question.marks,
                     "correct_answer": a.question.correct_answer, "image_url": a.question.image_url} for a in answers],
    }


def _apply_marks(db: Session, submission: Submission, marks: List[LongAnswerMark]):
    for item in marks:
        answer = (db.query(Answer).join(Question, Answer.question_id == Question.id)
                  .filter(Answer.submission_id == submission.id, Answer.question_id == item.question_id,
                          Question.type.in_(("long", "short"))).first())
        if answer:
            answer.awarded_marks = max(0, min(item.awarded_marks, answer.question.marks))
            answer.marked = True
    answers = db.query(Answer).filter(Answer.submission_id == submission.id).all()
    submission.total_score = sum(answer.awarded_marks or 0 for answer in answers)
    submission.fully_marked = not any(not answer.marked for answer in answers)
    db.commit()
    return {"submission_id": submission.id, "total_score": submission.total_score, "fully_marked": submission.fully_marked}


@app.get("/admin/submissions/{submission_id}")
def admin_submission_detail(submission_id: int, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    submission = db.query(Submission).filter(Submission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    return _submission_detail_payload(db, submission)


@app.post("/admin/submissions/{submission_id}/mark")
def admin_mark_submission(submission_id: int, payload: MarkSubmissionRequest, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    submission = db.query(Submission).filter(Submission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    return _apply_marks(db, submission, payload.marks)

@app.get("/admin/submissions")
def admin_list_all_submissions(_pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    rows = (
        db.query(Submission)
        .join(Quiz, Quiz.id == Submission.quiz_id)
        .order_by(Submission.submitted_at.desc())
        .all()
    )
    return [
        {
            "id": submission.id,
            "quiz_id": submission.quiz_id,
            "quiz_title": submission.quiz.title,
            "module_code": submission.quiz.module_code,
            "student_id": submission.student_id,
            "student_name": submission.student_name,
            "submitted_at": submission.submitted_at,
            "total_score": submission.total_score,
            "max_score": submission.max_score,
            "fully_marked": submission.fully_marked,
        }
        for submission in rows
    ]


@app.get("/admin/submissions/{submission_id}/pdf")
def admin_download_submission_pdf(submission_id: int, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    submission = db.query(Submission).filter(Submission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer, pagesize=A4, topMargin=2 * cm, bottomMargin=2 * cm,
        leftMargin=2 * cm, rightMargin=2 * cm,
    )
    document.build(build_submission_pdf(db, submission_id, build_pdf_stylesheet(), include_expected_answers=True))
    buffer.seek(0)

    safe_name = "".join(c for c in (submission.student_name or "student") if c.isalnum() or c in (" ", "_", "-")).strip() or "student"
    safe_module = "".join(c for c in (submission.quiz.module_code or "module") if c.isalnum() or c in ("_", "-")).strip() or "module"
    filename = f"{safe_module}_{safe_name}_script.pdf"
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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

FUN_STICKERS = {
    "spark": "✨",
    "celebrate": "🎉",
    "study": "📚",
    "rocket": "🚀",
    "heart": "💜",
    "science": "🧬",
    "laugh": "😂",
    "thinking": "🤔",
}

# ---------------------------------------------------------------------------
# Campus marketing / accommodation marketplace
# ---------------------------------------------------------------------------

def _landlord_profile(landlord: Landlord) -> dict:
    return {"id": landlord.id, "full_name": landlord.full_name, "business_name": landlord.business_name or "", "provider_type": landlord.provider_type or "residence", "email": landlord.email, "phone": landlord.phone, "profile_image_url": landlord.profile_image_url}


def _accommodation_payload(item: Accommodation, landlord: Landlord) -> dict:
    directions_url = None
    if item.latitude is not None and item.longitude is not None:
        directions_url = f"https://www.google.com/maps/dir/?api=1&destination={item.latitude},{item.longitude}"
    image_urls = _market_image_urls(item)
    return {"id": item.id, "title": item.title, "campus": item.campus, "area": item.area, "monthly_rent": item.monthly_rent, "bedrooms": item.bedrooms or "", "description": item.description, "contact": item.contact or landlord.phone, "image_url": image_urls[0] if image_urls else None, "image_urls": image_urls, "latitude": item.latitude, "longitude": item.longitude, "directions_url": directions_url, "is_available": item.is_available, "created_at": item.created_at, "landlord": {"id": landlord.id, "name": landlord.full_name, "business_name": landlord.business_name or "", "profile_image_url": landlord.profile_image_url}}


def _market_image_urls(item) -> List[str]:
    try:
        urls = json.loads(item.image_urls or "[]")
    except (TypeError, json.JSONDecodeError):
        urls = []
    urls = [str(url) for url in urls if str(url).startswith(("http://", "https://"))]
    if not urls and item.image_url:
        urls = [item.image_url]
    return urls


async def _upload_market_images(files: List[UploadFile], limit: int, folder: str, max_bytes: int) -> List[str]:
    chosen = [file for file in files if file and file.filename]
    if len(chosen) > limit:
        raise HTTPException(status_code=400, detail=f"Choose no more than {limit} images")
    uploaded = []
    for file in chosen:
        if not (file.content_type or "").startswith("image/"):
            raise HTTPException(status_code=400, detail="Please choose image files only")
        image_bytes = await file.read()
        if len(image_bytes) > max_bytes:
            raise HTTPException(status_code=400, detail=f"Each image must be {max_bytes // (1024 * 1024)} MB or smaller")
        uploaded.append(upload_image_bytes(image_bytes, folder=folder))
    return uploaded


def _accommodation_coordinates(latitude: str, longitude: str) -> tuple[Optional[float], Optional[float]]:
    latitude, longitude = latitude.strip(), longitude.strip()
    if not latitude and not longitude:
        return None, None
    if not latitude or not longitude:
        raise HTTPException(status_code=400, detail="Choose a complete location on the map")
    try:
        lat, lng = float(latitude), float(longitude)
    except ValueError:
        raise HTTPException(status_code=400, detail="The selected map coordinates are invalid")
    if not -90 <= lat <= 90 or not -180 <= lng <= 180:
        raise HTTPException(status_code=400, detail="The selected map coordinates are outside the valid range")
    return lat, lng


@app.post("/marketing/landlords/register")
async def register_landlord(full_name: str = Form(...), business_name: str = Form(""), provider_type: str = Form("residence"), email: str = Form(...), phone: str = Form(...), password: str = Form(...), confirm_password: str = Form(...), profile_image: Optional[UploadFile] = File(None), db: Session = Depends(get_db)):
    email = email.strip().lower()
    if not full_name.strip() or not phone.strip() or "@" not in email or len(password) < 8:
        raise HTTPException(status_code=400, detail="Provide your name, contact number, valid email, and a password of at least 8 characters")
    if password != confirm_password:
        raise HTTPException(status_code=400, detail="The password confirmation does not match")
    if provider_type not in {"residence", "transport"}:
        raise HTTPException(status_code=400, detail="Choose accommodation or transport provider")
    if db.query(Landlord).filter(Landlord.email == email).first():
        raise HTTPException(status_code=409, detail="A provider profile already uses this email")
    image_url = None
    if profile_image and profile_image.filename:
        if not (profile_image.content_type or "").startswith("image/"):
            raise HTTPException(status_code=400, detail="Please choose a valid profile image")
        image_url = upload_image_bytes(await profile_image.read(), folder="landlord_profiles")
    landlord = Landlord(full_name=full_name.strip()[:160], business_name=business_name.strip()[:160], provider_type=provider_type, email=email, phone=phone.strip()[:60], profile_image_url=image_url, password_hash=_password_hash(password), active=True, created_at=datetime.now(timezone.utc).isoformat())
    db.add(landlord); db.commit()
    return {"ok": True, "token": _issue_landlord_token(landlord.id), "profile": _landlord_profile(landlord)}


@app.post("/marketing/landlords/login")
def landlord_login(payload: LandlordLogin, db: Session = Depends(get_db)):
    landlord = db.query(Landlord).filter(Landlord.email == payload.email.strip().lower()).first()
    if not landlord or not _password_matches(payload.password, landlord.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect provider email or password")
    if not landlord.active:
        raise HTTPException(status_code=403, detail="This landlord profile is inactive")
    return {"token": _issue_landlord_token(landlord.id), "profile": _landlord_profile(landlord)}


@app.get("/marketing/landlords/me")
def landlord_me(landlord: Landlord = Depends(require_landlord_account)):
    return _landlord_profile(landlord)


@app.get("/marketing/listings")
def list_accommodations(search: str = "", campus: str = "", db: Session = Depends(get_db)):
    query = db.query(Accommodation, Landlord).join(Landlord, Landlord.id == Accommodation.landlord_id).filter(Landlord.active == True)  # noqa: E712
    # Keep the former campus parameter as a compatible alias while making the
    # market search useful for listing/accommodation names as well.
    term = (search or campus).strip().lower()
    if term:
        phrase = f"%{term}%"
        query = query.filter(
            (func.lower(Accommodation.title).like(phrase))
            | (func.lower(Accommodation.area).like(phrase))
            | (func.lower(Accommodation.campus).like(phrase))
            | (func.lower(Accommodation.description).like(phrase))
        )
    rows = query.order_by(Accommodation.is_available.desc(), Accommodation.created_at.desc()).all()
    return [_accommodation_payload(item, landlord) for item, landlord in rows]


@app.get("/marketing/maps-config")
def marketing_maps_config():
    """The browser Maps key is intentionally public, but should be domain-restricted in Google Cloud."""
    return {"api_key": GOOGLE_MAPS_API_KEY}


@app.get("/marketing/landlord/listings")
def landlord_listings(landlord: Landlord = Depends(require_landlord_account), db: Session = Depends(get_db)):
    rows = db.query(Accommodation).filter(Accommodation.landlord_id == landlord.id).order_by(Accommodation.created_at.desc()).all()
    return [_accommodation_payload(item, landlord) for item in rows]


@app.post("/marketing/listings")
async def create_accommodation(title: str = Form(...), campus: str = Form(...), area: str = Form(...), monthly_rent: str = Form(""), bedrooms: str = Form(""), description: str = Form(...), contact: str = Form(""), latitude: str = Form(""), longitude: str = Form(""), images: Optional[List[UploadFile]] = File(None), image: Optional[UploadFile] = File(None), landlord: Landlord = Depends(require_landlord_account), db: Session = Depends(get_db)):
    if not title.strip() or not campus.strip() or not area.strip() or not description.strip():
        raise HTTPException(status_code=400, detail="Add a title, campus, area, and description")
    if len(description.strip()) > 2500:
        raise HTTPException(status_code=400, detail="Accommodation descriptions can be up to 2,500 characters")
    try:
        rent = int(monthly_rent) if monthly_rent.strip() else None
    except ValueError:
        raise HTTPException(status_code=400, detail="Monthly rent must be a whole number")
    if rent is not None and rent < 0:
        raise HTTPException(status_code=400, detail="Monthly rent cannot be negative")
    lat, lng = _accommodation_coordinates(latitude, longitude)
    files = list(images or []) + ([image] if image and image.filename else [])
    image_urls = await _upload_market_images(files, 3, "accommodation_listings", 10 * 1024 * 1024)
    item = Accommodation(landlord_id=landlord.id, title=title.strip()[:180], campus=campus.strip()[:120], area=area.strip()[:160], monthly_rent=rent, bedrooms=bedrooms.strip()[:80], description=description.strip(), contact=contact.strip()[:160], image_url=image_urls[0] if image_urls else None, image_urls=json.dumps(image_urls), latitude=lat, longitude=lng, is_available=True, created_at=datetime.now(timezone.utc).isoformat())
    db.add(item); db.commit()
    return {"ok": True, "listing": _accommodation_payload(item, landlord)}


@app.put("/marketing/listings/{listing_id}")
async def update_accommodation(listing_id: int, title: str = Form(...), campus: str = Form(...), area: str = Form(...), monthly_rent: str = Form(""), bedrooms: str = Form(""), description: str = Form(...), contact: str = Form(""), latitude: str = Form(""), longitude: str = Form(""), is_available: bool = Form(True), images: Optional[List[UploadFile]] = File(None), image: Optional[UploadFile] = File(None), landlord: Landlord = Depends(require_landlord_account), db: Session = Depends(get_db)):
    item = db.query(Accommodation).filter(Accommodation.id == listing_id, Accommodation.landlord_id == landlord.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Accommodation listing not found")
    if not title.strip() or not campus.strip() or not area.strip() or not description.strip():
        raise HTTPException(status_code=400, detail="Add a title, campus, area, and description")
    try:
        rent = int(monthly_rent) if monthly_rent.strip() else None
    except ValueError:
        raise HTTPException(status_code=400, detail="Monthly rent must be a whole number")
    if rent is not None and rent < 0:
        raise HTTPException(status_code=400, detail="Monthly rent cannot be negative")
    # Availability updates do not include the picker fields, so retain a
    # previously selected point unless the landlord supplies a new one.
    lat, lng = _accommodation_coordinates(latitude, longitude) if latitude.strip() or longitude.strip() else (item.latitude, item.longitude)
    item.title, item.campus, item.area = title.strip()[:180], campus.strip()[:120], area.strip()[:160]
    item.monthly_rent, item.bedrooms, item.description = rent, bedrooms.strip()[:80], description.strip()[:2500]
    item.contact, item.latitude, item.longitude, item.is_available = contact.strip()[:160], lat, lng, is_available
    files = list(images or []) + ([image] if image and image.filename else [])
    if any(file and file.filename for file in files):
        image_urls = await _upload_market_images(files, 3, "accommodation_listings", 10 * 1024 * 1024)
        item.image_url, item.image_urls = image_urls[0], json.dumps(image_urls)
    db.commit()
    return {"ok": True, "listing": _accommodation_payload(item, landlord)}


@app.delete("/marketing/listings/{listing_id}")
def delete_accommodation(listing_id: int, landlord: Landlord = Depends(require_landlord_account), db: Session = Depends(get_db)):
    item = db.query(Accommodation).filter(Accommodation.id == listing_id, Accommodation.landlord_id == landlord.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Accommodation listing not found")
    for comment in db.query(AccommodationComment).filter(AccommodationComment.accommodation_id == item.id).all():
        db.delete(comment)
    db.delete(item); db.commit()
    return {"ok": True}


@app.get("/marketing/listings/{listing_id}/comments")
def list_accommodation_comments(listing_id: int, db: Session = Depends(get_db)):
    if not db.query(Accommodation).filter(Accommodation.id == listing_id).first():
        raise HTTPException(status_code=404, detail="Accommodation listing not found")
    rows = db.query(AccommodationComment).filter(AccommodationComment.accommodation_id == listing_id).order_by(AccommodationComment.created_at.asc()).all()
    student_ids = {item.author_student_id for item in rows if item.author_student_id}
    landlord_ids = {item.author_landlord_id for item in rows if item.author_landlord_id}
    students = {item.id: item for item in db.query(Student).filter(Student.id.in_(student_ids)).all()} if student_ids else {}
    landlords = {item.id: item for item in db.query(Landlord).filter(Landlord.id.in_(landlord_ids)).all()} if landlord_ids else {}
    children = {}
    for item in rows: children.setdefault(item.parent_id, []).append(item)
    def serialize(item: AccommodationComment) -> dict:
        is_landlord = bool(item.author_landlord_id)
        author = landlords.get(item.author_landlord_id) if is_landlord else students.get(item.author_student_id)
        return {"id": item.id, "parent_id": item.parent_id, "content": item.content, "author_name": "Anonymous student" if item.is_anonymous else (author.full_name if author else item.author_name), "author_image_url": None if item.is_anonymous or not author else author.profile_image_url, "is_landlord": is_landlord, "business_name": (author.business_name or "") if is_landlord and author else "", "is_anonymous": item.is_anonymous, "created_at": item.created_at, "replies": [serialize(child) for child in children.get(item.id, [])]}
    return [serialize(item) for item in children.get(None, [])]


@app.post("/marketing/listings/{listing_id}/comments")
def create_accommodation_comment(listing_id: int, payload: AccommodationCommentCreate, x_student_token: Optional[str] = Header(None, alias="X-Student-Token"), x_landlord_token: Optional[str] = Header(None, alias="X-Landlord-Token"), db: Session = Depends(get_db)):
    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Write a comment first")
    if len(content) > 1500:
        raise HTTPException(status_code=400, detail="Comments can be up to 1,500 characters")
    if not db.query(Accommodation).filter(Accommodation.id == listing_id).first():
        raise HTTPException(status_code=404, detail="Accommodation listing not found")
    if payload.parent_id is not None and not db.query(AccommodationComment).filter(AccommodationComment.id == payload.parent_id, AccommodationComment.accommodation_id == listing_id).first():
        raise HTTPException(status_code=404, detail="The comment you are replying to no longer exists")
    landlord = None; student = None
    if x_landlord_token:
        landlord = db.query(Landlord).filter(Landlord.id == _landlord_id_from_token(x_landlord_token)).first()
        if not landlord or not landlord.active:
            raise HTTPException(status_code=403, detail="Your landlord account is inactive")
    else:
        student = db.query(Student).filter(Student.id == _student_id_from_token(x_student_token)).first()
        if not student or not student.active or not student.approved:
            raise HTTPException(status_code=403, detail="An approved student account is required to join the discussion")
    comment = AccommodationComment(accommodation_id=listing_id, parent_id=payload.parent_id, author_student_id=student.id if student else None, author_landlord_id=landlord.id if landlord else None, author_name=landlord.full_name if landlord else ("Anonymous student" if payload.is_anonymous else student.full_name), content=content, is_anonymous=bool(payload.is_anonymous) if student else False, created_at=datetime.now(timezone.utc).isoformat())
    db.add(comment); db.commit()
    return {"ok": True, "id": comment.id}


def _advert_payload(item: MarketAdvert, owner_name: str = "") -> dict:
    image_urls = _market_image_urls(item)
    return {
        "id": item.id, "business_name": item.business_name, "headline": item.headline,
        "description": item.description, "category": item.category, "campus": item.campus or "",
        "contact": item.contact or "", "website_url": item.website_url or "",
        "placement": item.placement, "image_url": image_urls[0] if image_urls else None, "image_urls": image_urls, "starts_at": item.starts_at,
        "expires_at": item.expires_at, "status": item.status, "is_featured": item.is_featured,
        "impressions": item.impressions or 0, "clicks": item.clicks or 0,
        "created_at": item.created_at, "updated_at": item.updated_at, "owner_name": owner_name,
        "provider_id": item.owner_landlord_id,
    }


def _advert_owner(db: Session, student_token: Optional[str], landlord_token: Optional[str]):
    if landlord_token:
        owner = db.query(Landlord).filter(Landlord.id == _landlord_id_from_token(landlord_token)).first()
        if not owner or not owner.active:
            raise HTTPException(status_code=403, detail="Your landlord account is inactive")
        return None, owner
    if student_token:
        owner = db.query(Student).filter(Student.id == _student_id_from_token(student_token)).first()
        if not owner or not owner.active or not owner.approved:
            raise HTTPException(status_code=403, detail="An active, approved student account is required")
        return owner, None
    raise HTTPException(status_code=401, detail="Sign in as a student or landlord to submit an advert")


def _clean_advert_dates(starts_at: str, expires_at: str) -> tuple[Optional[str], Optional[str]]:
    def clean(value: str) -> Optional[str]:
        if not value.strip():
            return None
        try:
            return datetime.fromisoformat(value.strip().replace("Z", "+00:00")).date().isoformat()
        except ValueError:
            raise HTTPException(status_code=400, detail="Advert dates must be valid dates")
    start, end = clean(starts_at), clean(expires_at)
    if start and end and end < start:
        raise HTTPException(status_code=400, detail="The advert end date must be after its start date")
    return start, end


@app.get("/marketing/adverts")
def list_market_adverts(placement: str = "", db: Session = Depends(get_db)):
    today = datetime.now(timezone.utc).date().isoformat()
    query = db.query(MarketAdvert).filter(
        MarketAdvert.status == "approved",
        (MarketAdvert.starts_at.is_(None)) | (MarketAdvert.starts_at <= today),
        (MarketAdvert.expires_at.is_(None)) | (MarketAdvert.expires_at >= today),
    )
    if placement in {"feed", "spotlight"}:
        query = query.filter(MarketAdvert.placement == placement)
    rows = query.order_by(MarketAdvert.is_featured.desc(), MarketAdvert.created_at.desc()).all()
    for item in rows:
        item.impressions = (item.impressions or 0) + 1
    db.commit()
    return [_advert_payload(item) for item in rows]


@app.post("/marketing/adverts")
async def create_market_advert(
    business_name: str = Form(...), headline: str = Form(...), description: str = Form(...),
    category: str = Form(...), campus: str = Form(""), contact: str = Form(""), website_url: str = Form(""),
    placement: str = Form("spotlight"), starts_at: str = Form(""), expires_at: str = Form(""),
    images: Optional[List[UploadFile]] = File(None), image: Optional[UploadFile] = File(None), x_student_token: Optional[str] = Header(None, alias="X-Student-Token"),
    x_landlord_token: Optional[str] = Header(None, alias="X-Landlord-Token"), db: Session = Depends(get_db),
):
    student, landlord = _advert_owner(db, x_student_token, x_landlord_token)
    if not business_name.strip() or not headline.strip() or not description.strip() or not category.strip():
        raise HTTPException(status_code=400, detail="Add a business name, headline, description and category")
    if len(description.strip()) > 1200:
        raise HTTPException(status_code=400, detail="Advert descriptions can be up to 1,200 characters")
    if placement not in {"feed", "spotlight"}:
        raise HTTPException(status_code=400, detail="Choose feed or spotlight placement")
    start, end = _clean_advert_dates(starts_at, expires_at)
    files = list(images or []) + ([image] if image and image.filename else [])
    transport_service = bool(re.search(r"transport|ride|taxi|uber|shuttle|courier|delivery", category, re.IGNORECASE))
    image_limit = 2 if transport_service else 1
    image_urls = await _upload_market_images(files, image_limit, "market_adverts", 8 * 1024 * 1024)
    now = datetime.now(timezone.utc).isoformat()
    item = MarketAdvert(
        owner_student_id=student.id if student else None, owner_landlord_id=landlord.id if landlord else None,
        business_name=business_name.strip()[:160], headline=headline.strip()[:180], description=description.strip(),
        category=category.strip()[:80], campus=campus.strip()[:120], contact=contact.strip()[:160],
        website_url=website_url.strip()[:500], placement=placement, image_url=image_urls[0] if image_urls else None, image_urls=json.dumps(image_urls),
        starts_at=start, expires_at=end, status="pending", is_featured=False, impressions=0, clicks=0,
        created_at=now, updated_at=now,
    )
    db.add(item); db.commit(); db.refresh(item)
    return {"ok": True, "message": "Advert submitted for review", "advert": _advert_payload(item)}


@app.get("/marketing/my-adverts")
def my_market_adverts(
    x_student_token: Optional[str] = Header(None, alias="X-Student-Token"),
    x_landlord_token: Optional[str] = Header(None, alias="X-Landlord-Token"), db: Session = Depends(get_db),
):
    student, landlord = _advert_owner(db, x_student_token, x_landlord_token)
    query = db.query(MarketAdvert).filter(
        MarketAdvert.owner_student_id == student.id if student else MarketAdvert.owner_landlord_id == landlord.id
    )
    return [_advert_payload(item) for item in query.order_by(MarketAdvert.created_at.desc()).all()]


@app.put("/marketing/adverts/{advert_id}/pause")
def pause_market_advert(
    advert_id: int, x_student_token: Optional[str] = Header(None, alias="X-Student-Token"),
    x_landlord_token: Optional[str] = Header(None, alias="X-Landlord-Token"), db: Session = Depends(get_db),
):
    student, landlord = _advert_owner(db, x_student_token, x_landlord_token)
    query = db.query(MarketAdvert).filter(MarketAdvert.id == advert_id)
    query = query.filter(MarketAdvert.owner_student_id == student.id) if student else query.filter(MarketAdvert.owner_landlord_id == landlord.id)
    item = query.first()
    if not item:
        raise HTTPException(status_code=404, detail="Advert not found")
    item.status = "paused"; item.updated_at = datetime.now(timezone.utc).isoformat(); db.commit()
    return {"ok": True}


@app.post("/marketing/adverts/{advert_id}/click")
def record_market_advert_click(advert_id: int, db: Session = Depends(get_db)):
    item = db.query(MarketAdvert).filter(MarketAdvert.id == advert_id, MarketAdvert.status == "approved").first()
    if not item:
        raise HTTPException(status_code=404, detail="Advert not found")
    item.clicks = (item.clicks or 0) + 1; db.commit()
    return {"ok": True}


@app.get("/admin/market-adverts")
def admin_market_adverts(_pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    rows = db.query(MarketAdvert).order_by(MarketAdvert.created_at.desc()).all()
    student_ids = {item.owner_student_id for item in rows if item.owner_student_id}
    landlord_ids = {item.owner_landlord_id for item in rows if item.owner_landlord_id}
    students = {item.id: item.full_name for item in db.query(Student).filter(Student.id.in_(student_ids)).all()} if student_ids else {}
    landlords = {item.id: item.full_name for item in db.query(Landlord).filter(Landlord.id.in_(landlord_ids)).all()} if landlord_ids else {}
    return [_advert_payload(item, students.get(item.owner_student_id, "") or landlords.get(item.owner_landlord_id, "")) for item in rows]


@app.put("/admin/market-adverts/{advert_id}")
def admin_update_market_advert(advert_id: int, payload: AdminMarketAdvertUpdate, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    item = db.query(MarketAdvert).filter(MarketAdvert.id == advert_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Advert not found")
    if payload.status is not None:
        if payload.status not in {"pending", "approved", "rejected", "paused"}:
            raise HTTPException(status_code=400, detail="Invalid advert status")
        item.status = payload.status
    if payload.is_featured is not None:
        item.is_featured = payload.is_featured
    if payload.starts_at is not None or payload.expires_at is not None:
        item.starts_at, item.expires_at = _clean_advert_dates(payload.starts_at or "", payload.expires_at or "")
    item.updated_at = datetime.now(timezone.utc).isoformat(); db.commit()
    return {"ok": True, "advert": _advert_payload(item)}


@app.delete("/admin/market-adverts/{advert_id}")
def admin_delete_market_advert(advert_id: int, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    item = db.query(MarketAdvert).filter(MarketAdvert.id == advert_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Advert not found")
    db.delete(item); db.commit()
    return {"ok": True}


@app.post("/src/register")
async def register_src_president(
    full_name: str = Form(...), party_name: str = Form(...), email: str = Form(...),
    password: str = Form(...), confirm_password: str = Form(...), phone: str = Form(""),
    profile_image: Optional[UploadFile] = File(None), db: Session = Depends(get_db),
):
    email = email.strip().lower()
    if not full_name.strip() or not party_name.strip() or "@" not in email or len(password) < 8:
        raise HTTPException(status_code=400, detail="Provide your name, party name, valid email, and a password of at least 8 characters")
    if password != confirm_password:
        raise HTTPException(status_code=400, detail="The password confirmation does not match")
    if db.query(SrcPresident).filter(SrcPresident.email == email).first():
        raise HTTPException(status_code=409, detail="An SRC president profile already uses this email")
    image_url = upload_image_bytes(await profile_image.read(), folder="src_profiles") if profile_image and profile_image.filename else None
    president = SrcPresident(full_name=full_name.strip()[:160], party_name=party_name.strip()[:120], email=email,
        phone=phone.strip()[:60], profile_image_url=image_url, password_hash=_password_hash(password),
        approved=True, active=True, created_at=datetime.now(timezone.utc).isoformat())
    db.add(president); db.commit()
    return {"ok": True, "message": "SRC profile created and activated. You can sign in and publish announcements now."}


@app.post("/src/login")
def src_president_login(payload: SrcPresidentLogin, db: Session = Depends(get_db)):
    president = db.query(SrcPresident).filter(SrcPresident.email == payload.email.strip().lower()).first()
    if not president or not _password_matches(payload.password, president.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect SRC email or password")
    if not president.active:
        raise HTTPException(status_code=403, detail="This SRC president profile is inactive")
    if not president.approved:
        raise HTTPException(status_code=403, detail="This SRC president profile is not currently approved")
    return {"token": _issue_src_token(president.id), "profile": _src_president_profile(president)}


@app.get("/src/me")
def src_president_me(president: SrcPresident = Depends(require_src_president_account)):
    return _src_president_profile(president)


@app.put("/src/me")
async def update_src_president_me(
    full_name: str = Form(...), party_name: str = Form(...), phone: str = Form(""),
    profile_image: Optional[UploadFile] = File(None), president: SrcPresident = Depends(require_src_president_account),
    db: Session = Depends(get_db),
):
    if not full_name.strip() or not party_name.strip():
        raise HTTPException(status_code=400, detail="Full name and party name are required")
    if president.active and _active_src_party_exists(db, party_name, president.id):
        raise HTTPException(status_code=409, detail="Another active SRC president profile already represents this party")
    president.full_name, president.party_name = full_name.strip()[:160], party_name.strip()[:120]
    president.phone = phone.strip()[:60]
    if profile_image and profile_image.filename:
        president.profile_image_url = upload_image_bytes(await profile_image.read(), folder="src_profiles")
    db.commit()
    return _src_president_profile(president)


@app.post("/src/me/change-password")
def change_src_president_password(payload: SrcPasswordChange, president: SrcPresident = Depends(require_src_president_account), db: Session = Depends(get_db)):
    if not _password_matches(payload.current_password, president.password_hash):
        raise HTTPException(status_code=401, detail="Your current password is incorrect")
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="Your new password must be at least 8 characters")
    if payload.new_password != payload.confirm_password:
        raise HTTPException(status_code=400, detail="The new password confirmation does not match")
    president.password_hash = _password_hash(payload.new_password); db.commit()
    return {"ok": True}


def _comrade_parent_key(db: Session, post_id: int, parent_key: Optional[str]) -> Optional[str]:
    """Validate a reply parent across student and SRC reply tables."""
    if not parent_key:
        return None
    try:
        parent_type, parent_id_text = parent_key.split(":", 1)
        parent_id = int(parent_id_text)
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="That parent comment is invalid")
    model = ComradeReply if parent_type == "student" else ComradeSrcReply if parent_type == "src" else None
    if not model or not db.query(model).filter(model.id == parent_id, model.post_id == post_id).first():
        raise HTTPException(status_code=404, detail="The parent comment no longer exists")
    return f"{parent_type}:{parent_id}"


def _notify_comrade_tags(db: Session, content: str, sender_type: str, sender_id: int, sender_label: str):
    """Mentions in Comrade discussions create the same private student alert as Fun Page mentions."""
    tagged_students = db.query(Student).filter(Student.approved == True, Student.active == True).all()  # noqa: E712
    for tagged in tagged_students:
        if sender_type == "student" and tagged.id == sender_id:
            continue
        mention = "@" + tagged.full_name.strip()
        if mention != "@" and re.search(r"(?<!\w)" + re.escape(mention) + r"(?!\w)", content, re.IGNORECASE):
            db.add(DirectMessage(
                sender_type=sender_type, sender_id=sender_id, recipient_type="student", recipient_id=tagged.id,
                content=f"{sender_label} mentioned you in a Comrade Page reply: {content[:300]}",
                created_at=datetime.now(timezone.utc).isoformat(),
            ))


@app.get("/comrade/members")
def comrade_members(
    x_student_token: Optional[str] = Header(None, alias="X-Student-Token"),
    x_src_token: Optional[str] = Header(None, alias="X-Src-Token"),
    db: Session = Depends(get_db),
):
    if x_student_token:
        require_student_account(x_student_token, db)
    elif x_src_token:
        require_src_president_account(x_src_token, db)
    else:
        raise HTTPException(status_code=401, detail="Sign in to tag a student")
    rows = db.query(Student).filter(Student.approved == True, Student.active == True).order_by(Student.full_name.asc()).all()  # noqa: E712
    return [{"full_name": row.full_name} for row in rows]


@app.get("/comrade/posts")
def comrade_posts(db: Session = Depends(get_db)):
    """Public announcements with a threaded mixture of student and official SRC responses."""
    posts = db.query(ComradePost).order_by(ComradePost.created_at.desc()).all()
    students = {student.id: student.full_name for student in db.query(Student).all()}
    nodes_by_post = {}
    for reply in db.query(ComradeReply).order_by(ComradeReply.created_at).all():
        nodes_by_post.setdefault(reply.post_id, []).append({
            "key": f"student:{reply.id}", "parent_key": reply.parent_key,
            "author_label": students.get(reply.student_id, "Former student"), "author_type": "student",
            "content": reply.content, "created_at": reply.created_at,
        })
    for reply in db.query(ComradeSrcReply).order_by(ComradeSrcReply.created_at).all():
        nodes_by_post.setdefault(reply.post_id, []).append({
            "key": f"src:{reply.id}", "parent_key": reply.parent_key,
            "author_label": f"{reply.party_name} SRC president", "author_type": "src_president",
            "content": reply.content, "created_at": reply.created_at,
        })

    def thread(nodes: list) -> list:
        by_key = {node["key"]: node for node in nodes}
        children = {}
        for node in nodes:
            children.setdefault(node["parent_key"], []).append(node)
        def serialize(node):
            result = dict(node)
            result["replies"] = [serialize(child) for child in children.get(node["key"], [])]
            return result
        return [serialize(node) for node in nodes if not node["parent_key"] or node["parent_key"] not in by_key]

    return [{
        "id": post.id, "party_name": post.party_name, "created_by": f"{post.party_name} SRC president",
        "content": post.content, "created_at": post.created_at, "replies": thread(nodes_by_post.get(post.id, [])),
    } for post in posts]

@app.post("/comrade/posts")
def create_comrade_post(payload: ComradeAnnouncement, president: SrcPresident = Depends(require_src_president_account), db: Session = Depends(get_db)):
    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="An announcement is required")
    post = ComradePost(
        src_president_id=president.id,
        party_name=president.party_name,
        content=content[:2000],
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    db.add(post)
    db.commit()
    return {"ok": True, "id": post.id}

@app.post("/comrade/posts/{post_id}/replies")
def reply_comrade_post(post_id: int, payload: ComradeReplyInput, student: Student = Depends(require_student_account), db: Session = Depends(get_db)):
    if not db.query(ComradePost).filter(ComradePost.id == post_id).first():
        raise HTTPException(status_code=404, detail="Announcement not found")
    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Write a reply")
    parent_key = _comrade_parent_key(db, post_id, payload.parent_key)
    db.add(ComradeReply(
        post_id=post_id,
        student_id=student.id,
        parent_key=parent_key,
        content=content[:1500],
        created_at=datetime.now(timezone.utc).isoformat(),
    ))
    _notify_comrade_tags(db, content, "student", student.id, student.full_name)
    db.commit()
    return {"ok": True}


@app.post("/comrade/posts/{post_id}/src-replies")
def reply_comrade_post_as_src(post_id: int, payload: ComradeReplyInput, president: SrcPresident = Depends(require_src_president_account), db: Session = Depends(get_db)):
    if not db.query(ComradePost).filter(ComradePost.id == post_id).first():
        raise HTTPException(status_code=404, detail="Announcement not found")
    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Write a reply")
    parent_key = _comrade_parent_key(db, post_id, payload.parent_key)
    db.add(ComradeSrcReply(
        post_id=post_id,
        src_president_id=president.id,
        parent_key=parent_key,
        party_name=president.party_name,
        content=content[:1500],
        created_at=datetime.now(timezone.utc).isoformat(),
    ))
    _notify_comrade_tags(db, content, "src_president", president.id, f"{president.party_name} SRC president")
    db.commit()
    return {"ok": True}

def _fun_post_payload(post: FunPost, students_by_id: dict, current_student_id: int, replies: list) -> dict:
    author = students_by_id.get(post.author_student_id)
    return {
        "id": post.id,
        "parent_id": post.parent_id,
        "content": post.content,
        "image_url": post.image_url,
        "video_url": post.video_url,
        "sticker_code": post.sticker_code,
        "is_pinned": post.is_pinned,
        "is_official": False,
        "can_reply": True,
        "is_anonymous": post.is_anonymous,
        "author_name": "Anonymous student" if post.is_anonymous else (author.full_name if author else "Former student"),
        "author_image_url": None if post.is_anonymous or not author else author.profile_image_url,
        "created_at": post.created_at,
        "is_author": post.author_student_id == current_student_id,
        "replies": replies,
    }


def _official_fun_post_payload(post: FunOfficialPost) -> dict:
    return {
        "id": f"official-{post.id}",
        "parent_id": None,
        "content": post.content,
        "image_url": None,
        "video_url": None,
        "sticker_code": None,
        "is_pinned": post.is_pinned,
        "is_official": True,
        "can_reply": False,
        "is_anonymous": False,
        "author_name": "NucleoCampus Admin",
        "author_image_url": None,
        "created_at": post.created_at,
        "is_author": False,
        "replies": [],
    }


@app.get("/fun/members")
def fun_members(student: Student = Depends(require_student_account), db: Session = Depends(get_db)):
    """Names are used by the Fun Page's @tag helper; student numbers stay private."""
    rows = (
        db.query(Student)
        .filter(Student.approved == True, Student.active == True)  # noqa: E712
        .order_by(Student.full_name.asc())
        .all()
    )
    return [{"full_name": item.full_name, "profile_image_url": item.profile_image_url} for item in rows]


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

    roots = [serialize(post) for post in children_by_parent.get(None, [])]
    roots.extend(_official_fun_post_payload(post) for post in db.query(FunOfficialPost).all())
    # Pinned notices come first; replies remain in their natural conversation order.
    return sorted(roots, key=lambda item: (bool(item["is_pinned"]), item["created_at"]), reverse=True)


@app.post("/fun/posts")
async def create_fun_post(
    content: str = Form(""),
    is_anonymous: bool = Form(False),
    parent_id: Optional[int] = Form(None),
    sticker: str = Form(""),
    image: Optional[UploadFile] = File(None),
    video: Optional[UploadFile] = File(None),
    student: Student = Depends(require_student_account),
    db: Session = Depends(get_db),
):
    content = content.strip()
    sticker = sticker.strip().lower()
    has_image = bool(image and image.filename)
    has_video = bool(video and video.filename)
    if sticker and sticker not in FUN_STICKERS:
        raise HTTPException(status_code=400, detail="That sticker is not available")
    if not content and not has_image and not has_video and not sticker:
        raise HTTPException(status_code=400, detail="Write something, attach media, or choose a sticker before posting")
    if len(content) > 1500:
        raise HTTPException(status_code=400, detail="Posts can be up to 1,500 characters")
    if parent_id is not None and not db.query(FunPost).filter(FunPost.id == parent_id).first():
        raise HTTPException(status_code=404, detail="The post you are replying to no longer exists")

    image_url = None
    if has_image:
        if not (image.content_type or "").startswith("image/"):
            raise HTTPException(status_code=400, detail="Please choose a valid image file")
        image_bytes = await image.read()
        if len(image_bytes) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Images must be 10 MB or smaller")
        image_url = upload_image_bytes(image_bytes, folder="fun_page/images")

    video_url = None
    if has_video:
        if not (video.content_type or "").startswith("video/"):
            raise HTTPException(status_code=400, detail="Please choose a valid video file")
        video_bytes = await video.read()
        if len(video_bytes) > 50 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Videos must be 50 MB or smaller")
        video_url = upload_video_bytes(video_bytes, folder="fun_page/videos")

    post = FunPost(
        author_student_id=student.id,
        parent_id=parent_id,
        content=content,
        image_url=image_url,
        video_url=video_url,
        sticker_code=sticker or None,
        is_anonymous=is_anonymous,
        created_at=datetime.utcnow().isoformat() + "Z",
    )
    db.add(post)
    # A tag is a private notification as well as visible text in the post.
    # Match complete display names only, so @Ann does not notify @Annette.
    tagged_students = db.query(Student).filter(
        Student.approved == True, Student.active == True, Student.id != student.id  # noqa: E712
    ).all()
    for tagged in tagged_students:
        mention = "@" + tagged.full_name.strip()
        if mention != "@" and re.search(r"(?<!\\w)" + re.escape(mention) + r"(?!\\w)", content, re.IGNORECASE):
            db.add(DirectMessage(
                sender_type="student",
                sender_id=student.id,
                recipient_type="student",
                recipient_id=tagged.id,
                content=f"{student.full_name} mentioned you in a Fun Page post: {content[:300]}",
                created_at=datetime.now(timezone.utc).isoformat(),
            ))
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


# ---------------------------------------------------------------------------
# Administrator community moderation
# ---------------------------------------------------------------------------

def _delete_fun_post_thread(db: Session, post: FunPost):
    for child in db.query(FunPost).filter(FunPost.parent_id == post.id).all():
        _delete_fun_post_thread(db, child)
    db.delete(post)


@app.get("/admin/fun/posts")
def admin_list_fun_posts(_pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    student_posts = db.query(FunPost).order_by(FunPost.is_pinned.desc(), FunPost.created_at.desc()).all()
    author_ids = {post.author_student_id for post in student_posts}
    students_by_id = {
        item.id: item for item in db.query(Student).filter(Student.id.in_(author_ids)).all()
    } if author_ids else {}
    items = []
    for post in student_posts:
        item = _fun_post_payload(post, students_by_id, -1, [])
        item["kind"] = "student"
        items.append(item)
    for post in db.query(FunOfficialPost).order_by(FunOfficialPost.is_pinned.desc(), FunOfficialPost.created_at.desc()).all():
        item = _official_fun_post_payload(post)
        item["kind"] = "official"
        items.append(item)
    return sorted(items, key=lambda item: (bool(item["is_pinned"]), item["created_at"]), reverse=True)


@app.post("/admin/fun/official-posts")
def admin_create_fun_official_post(payload: AdminOfficialComment, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Write an official comment before posting")
    if len(content) > 1500:
        raise HTTPException(status_code=400, detail="Official comments can be up to 1,500 characters")
    post = FunOfficialPost(content=content, is_pinned=False, created_at=datetime.utcnow().isoformat() + "Z")
    db.add(post)
    db.commit()
    return {"ok": True, "id": post.id}


@app.put("/admin/fun/posts/{post_id}/pin")
def admin_pin_fun_post(post_id: int, payload: PinUpdate, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    post = db.query(FunPost).filter(FunPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Fun Page post not found")
    post.is_pinned = payload.pinned
    db.commit()
    return {"ok": True, "pinned": post.is_pinned}


@app.put("/admin/fun/official-posts/{post_id}/pin")
def admin_pin_official_fun_post(post_id: int, payload: PinUpdate, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    post = db.query(FunOfficialPost).filter(FunOfficialPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Official Fun Page post not found")
    post.is_pinned = payload.pinned
    db.commit()
    return {"ok": True, "pinned": post.is_pinned}


@app.delete("/admin/fun/posts/{post_id}")
def admin_delete_fun_post(post_id: int, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    post = db.query(FunPost).filter(FunPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Fun Page post not found")
    _delete_fun_post_thread(db, post)
    db.commit()
    return {"ok": True}


@app.delete("/admin/fun/official-posts/{post_id}")
def admin_delete_official_fun_post(post_id: int, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    post = db.query(FunOfficialPost).filter(FunOfficialPost.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Official Fun Page post not found")
    db.delete(post)
    db.commit()
    return {"ok": True}


@app.get("/admin/lesson-comments")
def admin_list_lesson_comments(_pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    rows = (
        db.query(LessonComment, Lesson)
        .join(Lesson, Lesson.id == LessonComment.lesson_id)
        .order_by(LessonComment.is_pinned.desc(), LessonComment.created_at.desc())
        .all()
    )
    return [
        {"id": comment.id, "lesson_id": lesson.id, "lesson_title": lesson.title,
         "author_name": comment.author_name, "is_lecturer": comment.is_lecturer,
         "parent_id": comment.parent_id, "is_anonymous": comment.is_anonymous,
         "is_official": comment.is_official, "is_pinned": comment.is_pinned,
         "comment_text": comment.comment_text, "created_at": comment.created_at}
        for comment, lesson in rows
    ]


@app.post("/admin/lessons/{lesson_id}/comments")
def admin_create_lesson_comment(lesson_id: int, payload: AdminOfficialComment, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    lesson = db.query(Lesson).filter(Lesson.id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Write an official comment before posting")
    if len(content) > 1500:
        raise HTTPException(status_code=400, detail="Official comments can be up to 1,500 characters")
    comment = LessonComment(
        lesson_id=lesson.id, author_name="NucleoCampus Admin", is_lecturer=True,
        is_official=True, is_pinned=False, comment_text=content,
        created_at=datetime.utcnow().isoformat() + "Z",
    )
    db.add(comment)
    db.commit()
    return {"ok": True, "id": comment.id}


@app.put("/admin/lesson-comments/{comment_id}/pin")
def admin_pin_lesson_comment(comment_id: int, payload: PinUpdate, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    comment = db.query(LessonComment).filter(LessonComment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Lesson comment not found")
    comment.is_pinned = payload.pinned
    db.commit()
    return {"ok": True, "pinned": comment.is_pinned}


@app.delete("/admin/lesson-comments/{comment_id}")
def admin_delete_lesson_comment(comment_id: int, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    comment = db.query(LessonComment).filter(LessonComment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Lesson comment not found")

    def delete_thread(item: LessonComment):
        for child in db.query(LessonComment).filter(LessonComment.parent_id == item.id).all():
            delete_thread(child)
        db.delete(item)

    delete_thread(comment)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Shared student / lecturer PDF tools
# ---------------------------------------------------------------------------
DOCUMENT_TOOL_MAX_BYTES = 25 * 1024 * 1024
_rapid_ocr_engine = None


def require_document_tool_user(
    x_student_token: Optional[str] = Header(None, alias="X-Student-Token"),
    x_lecturer_token: Optional[str] = Header(None, alias="X-Lecturer-Token"),
    db: Session = Depends(get_db),
) -> str:
    """Allow either approved account type without weakening their other routes."""
    if x_student_token:
        student = db.query(Student).filter(Student.id == _student_id_from_token(x_student_token)).first()
        if student and student.active and student.approved:
            return "student"
    if x_lecturer_token:
        lecturer = db.query(Lecturer).filter(Lecturer.id == _lecturer_id_from_token(x_lecturer_token)).first()
        if lecturer and lecturer.active and lecturer.approved:
            return "lecturer"
    raise HTTPException(status_code=401, detail="Sign in as a student or lecturer to use document tools")


async def _document_bytes(upload: UploadFile) -> bytes:
    data = await upload.read(DOCUMENT_TOOL_MAX_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail=f"{upload.filename or 'The file'} is empty")
    if len(data) > DOCUMENT_TOOL_MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"{upload.filename or 'The file'} is larger than 25 MB")
    return data


def _download(data: bytes, media_type: str, filename: str) -> StreamingResponse:
    return StreamingResponse(io.BytesIO(data), media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.post("/document-tools/merge")
async def merge_pdf_files(files: List[UploadFile] = File(...), _user: str = Depends(require_document_tool_user)):
    if len(files) < 2 or len(files) > 20:
        raise HTTPException(status_code=400, detail="Choose between 2 and 20 PDF files")
    writer = PdfWriter()
    try:
        for upload in files:
            data = await _document_bytes(upload)
            if not data.startswith(b"%PDF"):
                raise HTTPException(status_code=400, detail=f"{upload.filename or 'A selected file'} is not a PDF")
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                raise HTTPException(status_code=400, detail=f"{upload.filename or 'A PDF'} is password protected")
            for page in reader.pages:
                writer.add_page(page)
        output = io.BytesIO(); writer.write(output)
        return _download(output.getvalue(), "application/pdf", "merged-document.pdf")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail="One of the PDFs is damaged or unsupported") from exc


@app.post("/document-tools/convert")
async def convert_document(file: UploadFile = File(...), target: str = Form(...), _user: str = Depends(require_document_tool_user)):
    data = await _document_bytes(file)
    if target == "image-to-pdf":
        try:
            image = PILImage.open(io.BytesIO(data)); image.load()
            if image.mode not in ("RGB", "L"):
                background = PILImage.new("RGB", image.size, "white")
                if image.mode == "RGBA": background.paste(image, mask=image.getchannel("A"))
                else: background.paste(image.convert("RGB"))
                image = background
            elif image.mode != "RGB": image = image.convert("RGB")
            output = io.BytesIO(); image.save(output, "PDF", resolution=150)
            return _download(output.getvalue(), "application/pdf", "converted-image.pdf")
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Choose a valid JPG, PNG, WEBP, BMP or TIFF picture") from exc
    if target == "pdf-to-images":
        if not data.startswith(b"%PDF"):
            raise HTTPException(status_code=400, detail="PDF to pictures requires a PDF file")
        try:
            document = pymupdf.open(stream=data, filetype="pdf")
            if document.page_count > 50:
                raise HTTPException(status_code=400, detail="PDF conversion is limited to 50 pages")
            output = io.BytesIO()
            with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
                for number, page in enumerate(document, 1):
                    pixmap = page.get_pixmap(dpi=160, colorspace=pymupdf.csRGB, alpha=False)
                    archive.writestr(f"page-{number:03d}.png", pixmap.tobytes("png"))
            document.close()
            return _download(output.getvalue(), "application/zip", "pdf-pages.zip")
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=400, detail="The PDF is damaged, encrypted or unsupported") from exc
    raise HTTPException(status_code=400, detail="Choose a supported conversion")


@app.post("/document-tools/ocr")
async def ocr_document(file: UploadFile = File(...), source_type: str = Form(...), _user: str = Depends(require_document_tool_user)):
    if source_type not in {"picture", "scanned-pdf"}:
        raise HTTPException(status_code=400, detail="Choose Picture or Scanned PDF")
    data = await _document_bytes(file)
    try:
        global _rapid_ocr_engine
        if _rapid_ocr_engine is None:
            from rapidocr import RapidOCR
            _rapid_ocr_engine = RapidOCR()
        engine = _rapid_ocr_engine
        images = []
        if source_type == "scanned-pdf":
            if not data.startswith(b"%PDF"):
                raise HTTPException(status_code=400, detail="Scanned PDF mode requires a PDF file")
            document = pymupdf.open(stream=data, filetype="pdf")
            if document.page_count > 20:
                raise HTTPException(status_code=400, detail="OCR is limited to 20 PDF pages at a time")
            images = [(index + 1, page.get_pixmap(dpi=220, colorspace=pymupdf.csRGB, alpha=False).tobytes("png")) for index, page in enumerate(document)]
            document.close()
        else:
            if data.startswith(b"%PDF"):
                raise HTTPException(status_code=400, detail="This is a PDF. Select Scanned PDF instead of Picture")
            PILImage.open(io.BytesIO(data)).verify()
            images = [(1, data)]
        pages = []
        for page_number, image_bytes in images:
            result = engine(image_bytes)
            lines = list(result.txts or ()) if result else []
            heading = f"--- Page {page_number} ---\n" if source_type == "scanned-pdf" else ""
            pages.append(heading + "\n".join(lines))
        text_output = "\n\n".join(pages).strip() or "No readable text was detected."
        return _download(text_output.encode("utf-8"), "text/plain; charset=utf-8", "ocr-text.txt")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail="OCR could not read this file. Use a clear, upright picture or scanned PDF") from exc


# ---------------------------------------------------------------------------
# Ephemeral WebRTC live lessons (signalling only - no media is stored)
# ---------------------------------------------------------------------------
_live_rooms: dict[str, dict[str, dict]] = {}
LIVE_ROOM_LIMIT = 12


@app.post("/live/token")
async def live_lesson_token(
    room_code: str = Form(...),
    screen_only: bool = Form(False),
    x_student_token: Optional[str] = Header(None, alias="X-Student-Token"),
    x_lecturer_token: Optional[str] = Header(None, alias="X-Lecturer-Token"),
    db: Session = Depends(get_db),
):
    """Issue a short-lived SFU room token; video, audio and chat are not persisted here."""
    livekit_url = os.getenv("LIVEKIT_URL", "").strip()
    api_key = os.getenv("LIVEKIT_API_KEY", "").strip()
    api_secret = os.getenv("LIVEKIT_API_SECRET", "").strip()
    if not all((livekit_url, api_key, api_secret)):
        raise HTTPException(status_code=503, detail="Live lessons need LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET configuration")
    code = re.sub(r"[^A-Z0-9_-]", "", room_code.upper())[:32]
    if len(code) < 4:
        raise HTTPException(status_code=400, detail="Enter a valid room code")
    if x_lecturer_token:
        account = db.query(Lecturer).filter(Lecturer.id == _lecturer_id_from_token(x_lecturer_token)).first()
        role = "lecturer"
        valid = bool(account and account.active and account.approved)
    elif x_student_token:
        account = db.query(Student).filter(Student.id == _student_id_from_token(x_student_token)).first()
        role = "student"
        valid = bool(account and account.active and account.approved)
    else:
        account = None; role = ""; valid = False
    if not valid:
        raise HTTPException(status_code=403, detail="Your approved student or lecturer account is required")
    try:
        from livekit import api
        participant_role = "screen" if screen_only else role
        identity = f"{participant_role}-{account.id}-{secrets.token_urlsafe(5)}"
        access = (api.AccessToken(api_key, api_secret)
            .with_identity(identity)
            .with_name((account.full_name + (" screen" if screen_only else ""))[:100])
            .with_attributes({"role": participant_role})
            .with_grants(api.VideoGrants(room_join=True, room=code, can_publish=True, can_subscribe=not screen_only, can_publish_data=not screen_only))
            .with_room_config(api.RoomConfiguration(max_participants=100, empty_timeout=600, departure_timeout=30)))
        return {"token": access.to_jwt(), "url": livekit_url, "room": code, "role": role, "name": account.full_name, "capacity": 100}
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Could not prepare the live lesson") from exc


@app.get("/live/ice-config")
def live_lesson_ice_config():
    servers = [{"urls": "stun:stun.l.google.com:19302"}]
    turn_url = os.getenv("TURN_URL", "").strip()
    if turn_url:
        servers.append({"urls": turn_url, "username": os.getenv("TURN_USERNAME", ""), "credential": os.getenv("TURN_CREDENTIAL", "")})
    return {"iceServers": servers}


@app.post("/live/{room_code}/transcript.pdf")
async def live_lesson_transcript_pdf(
    room_code: str,
    transcript_json: str = Form(...),
    x_lecturer_token: Optional[str] = Header(None, alias="X-Lecturer-Token"),
    db: Session = Depends(get_db),
):
    """Compile a client-captured live transcript into a lecturer-owned PDF."""
    lecturer = db.query(Lecturer).filter(Lecturer.id == _lecturer_id_from_token(x_lecturer_token or "")).first()
    if not lecturer or not lecturer.active or not lecturer.approved:
        raise HTTPException(status_code=403, detail="An approved lecturer account is required")
    code = re.sub(r"[^A-Z0-9_-]", "", room_code.upper())[:32]
    try:
        entries = json.loads(transcript_json)
    except (TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="The transcript could not be read") from exc
    if not isinstance(entries, list) or len(entries) > 10000:
        raise HTTPException(status_code=400, detail="The transcript is invalid or too large")

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("LiveTitle", parent=styles["Title"], textColor=colors.HexColor("#0f766e"), spaceAfter=10)
    meta_style = ParagraphStyle("LiveMeta", parent=styles["Normal"], textColor=colors.HexColor("#526174"), fontSize=9, leading=13, spaceAfter=16)
    lecturer_style = ParagraphStyle("LecturerLine", parent=styles["BodyText"], leftIndent=0, borderColor=colors.HexColor("#14b8a6"), borderWidth=0, borderPadding=7, backColor=colors.HexColor("#ecfdf5"), spaceAfter=7, leading=14)
    student_style = ParagraphStyle("StudentLine", parent=styles["BodyText"], leftIndent=14, borderPadding=7, backColor=colors.HexColor("#f1f5f9"), spaceAfter=7, leading=14)
    story = [
        Paragraph("Live lesson transcript", title_style),
        Paragraph(f"Room: {_pdf_escape(code)} &nbsp;&nbsp; Lecturer: {_pdf_escape(lecturer.full_name)}<br/>Compiled: {datetime.now(timezone.utc).strftime('%d %B %Y, %H:%M UTC')}", meta_style),
    ]
    accepted = 0
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        text_value = str(entry.get("text", "")).strip()[:5000]
        if not text_value:
            continue
        name = str(entry.get("name", "Participant")).strip()[:100] or "Participant"
        role = "lecturer" if entry.get("role") == "lecturer" else "student"
        timestamp = str(entry.get("time", "")).strip()[:30]
        label = "Lecturer" if role == "lecturer" else "Student question / response"
        story.append(Paragraph(f"<b>{_pdf_escape(name)}</b> · {label} · {_pdf_escape(timestamp)}<br/>{_pdf_escape(text_value)}", lecturer_style if role == "lecturer" else student_style))
        accepted += 1
    if not accepted:
        story.append(Paragraph("No spoken transcript entries were captured for this lesson.", styles["BodyText"]))
    story.extend([Spacer(1, 14), Paragraph("Automatically transcribed speech may contain errors. Review important academic details against the original lesson materials.", meta_style)])
    buffer = io.BytesIO()
    SimpleDocTemplate(buffer, pagesize=A4, rightMargin=1.7*cm, leftMargin=1.7*cm, topMargin=1.6*cm, bottomMargin=1.6*cm, title=f"Live lesson {code} transcript").build(story)
    buffer.seek(0)
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="live-lesson-{code}-transcript.pdf"'})


@app.post("/live/{room_code}/participants/{identity}/mute")
async def lecturer_mute_live_participant(
    room_code: str,
    identity: str,
    track_sid: str = Form(...),
    x_lecturer_token: Optional[str] = Header(None, alias="X-Lecturer-Token"),
    db: Session = Depends(get_db),
):
    lecturer = db.query(Lecturer).filter(Lecturer.id == _lecturer_id_from_token(x_lecturer_token or "")).first()
    if not lecturer or not lecturer.active or not lecturer.approved:
        raise HTTPException(status_code=403, detail="An approved lecturer account is required")
    code = re.sub(r"[^A-Z0-9_-]", "", room_code.upper())[:32]
    if len(code) < 4 or not identity or not track_sid:
        raise HTTPException(status_code=400, detail="Invalid live participant or room")
    livekit_url = os.getenv("LIVEKIT_URL", "").strip()
    api_key = os.getenv("LIVEKIT_API_KEY", "").strip()
    api_secret = os.getenv("LIVEKIT_API_SECRET", "").strip()
    if not all((livekit_url, api_key, api_secret)):
        raise HTTPException(status_code=503, detail="Live classroom moderation is not configured")
    try:
        from livekit import api
        async with api.LiveKitAPI(livekit_url, api_key, api_secret) as livekit:
            await livekit.room.mute_published_track(api.MuteRoomTrackRequest(
                room=code,
                identity=identity,
                track_sid=track_sid,
                muted=True,
            ))
        return {"muted": True, "identity": identity}
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Could not mute this participant") from exc


@app.get("/admin/live-sessions")
async def admin_live_sessions(_pin_ok: bool = Depends(require_lecturer_pin)):
    """Return current LiveKit room metadata only; no lesson media is accessed or stored."""
    livekit_url = os.getenv("LIVEKIT_URL", "").strip()
    api_key = os.getenv("LIVEKIT_API_KEY", "").strip()
    api_secret = os.getenv("LIVEKIT_API_SECRET", "").strip()
    if not all((livekit_url, api_key, api_secret)):
        return {"active_rooms": 0, "participants": 0, "rooms": [], "configured": False}
    try:
        from livekit import api
        async with api.LiveKitAPI(livekit_url, api_key, api_secret) as livekit:
            response = await livekit.room.list_rooms(api.ListRoomsRequest())
        def room_started_at(room):
            timestamp = room.creation_time
            if not timestamp:
                return None
            if timestamp > 10_000_000_000:
                timestamp /= 1000
            return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()
        rooms = [
            {
                "code": room.name,
                "participants": room.num_participants,
                "publishers": room.num_publishers,
                "started_at": room_started_at(room),
            }
            for room in response.rooms
            if room.num_participants > 0
        ]
        rooms.sort(key=lambda item: item["started_at"] or "", reverse=True)
        return {
            "active_rooms": len(rooms),
            "participants": sum(item["participants"] for item in rooms),
            "rooms": rooms,
            "configured": True,
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Could not read current live classroom activity") from exc


async def _live_broadcast(room: dict[str, dict], message: dict, exclude: Optional[str] = None):
    sends = [member["socket"].send_json(message) for peer_id, member in room.items() if peer_id != exclude]
    if sends:
        await asyncio.gather(*sends, return_exceptions=True)


@app.websocket("/ws/live/{room_code}")
async def live_lesson_socket(websocket: WebSocket, room_code: str):
    room_code = re.sub(r"[^A-Z0-9_-]", "", room_code.upper())[:32]
    if len(room_code) < 4:
        await websocket.close(code=1008, reason="Invalid room code")
        return
    await websocket.accept()
    peer_id = secrets.token_urlsafe(8)
    role = ""; display_name = ""; joined = False
    try:
        auth = await asyncio.wait_for(websocket.receive_json(), timeout=10)
        token = str(auth.get("token", "")); role = str(auth.get("role", ""))
        db = SessionLocal()
        try:
            if role == "student":
                account = db.query(Student).filter(Student.id == _student_id_from_token(token)).first()
                valid = bool(account and account.active and account.approved)
            elif role == "lecturer":
                account = db.query(Lecturer).filter(Lecturer.id == _lecturer_id_from_token(token)).first()
                valid = bool(account and account.active and account.approved)
            else:
                valid = False; account = None
            if not valid:
                await websocket.send_json({"type": "error", "message": "Your account cannot join this live lesson"})
                await websocket.close(code=1008)
                return
            display_name = account.full_name[:100]
        finally:
            db.close()

        room = _live_rooms.get(room_code)
        if room is None:
            if role != "lecturer":
                await websocket.send_json({"type": "error", "message": "This live lesson has not started yet"})
                await websocket.close(code=1008)
                return
            room = _live_rooms.setdefault(room_code, {})
        if len(room) >= LIVE_ROOM_LIMIT:
            await websocket.send_json({"type": "error", "message": "This live lesson is full"})
            await websocket.close(code=1008)
            return

        participants = [{"id": existing_id, "name": member["name"], "role": member["role"]} for existing_id, member in room.items()]
        room[peer_id] = {"socket": websocket, "name": display_name, "role": role}
        joined = True
        await websocket.send_json({"type": "welcome", "selfId": peer_id, "room": room_code, "participants": participants})
        await _live_broadcast(room, {"type": "peer-joined", "id": peer_id, "name": display_name, "role": role}, exclude=peer_id)

        while True:
            message = await websocket.receive_json()
            kind = message.get("type")
            if kind not in {"offer", "answer", "ice"}:
                continue
            target = str(message.get("target", ""))
            if target not in room:
                continue
            relay = {"type": kind, "from": peer_id}
            if kind in {"offer", "answer"}:
                relay["sdp"] = message.get("sdp")
            else:
                relay["candidate"] = message.get("candidate")
            await room[target]["socket"].send_json(relay)
    except (WebSocketDisconnect, asyncio.TimeoutError, ValueError, HTTPException):
        pass
    finally:
        room = _live_rooms.get(room_code)
        if joined and room:
            room.pop(peer_id, None)
            await _live_broadcast(room, {"type": "peer-left", "id": peer_id, "name": display_name})
            if role == "lecturer" and not any(member["role"] == "lecturer" for member in room.values()):
                await _live_broadcast(room, {"type": "room-ended"})
                for member in list(room.values()):
                    try: await member["socket"].close(code=1000)
                    except Exception: pass
                room.clear()
            if not room:
                _live_rooms.pop(room_code, None)
        elif not joined:
            try:
                await websocket.close(code=1008)
            except Exception:
                pass


FRONTEND_PAGES = {
    "/": "index.html",
    "/students": "student.html",
    "/lecturers": "lecturer.html",
    "/students/lessons": "lessons_student.html",
    "/lecturers/lessons": "lessons_lecturer.html",
    "/live": "live_lesson.html",
    "/community": "fun.html",
    "/src": "comrade.html",
    "/market": "marketing.html",
    "/admin": "admin.html",
    "/tools/pdf": "pdf_tools.html",
    "/trust": "trust.html",
}


def _frontend_page(filename: str):
    def serve_page():
        return FileResponse(os.path.join("static", filename))

    return serve_page


def _legacy_frontend_redirect(friendly_path: str):
    def redirect(request: Request):
        destination = friendly_path
        if request.url.query:
            destination += f"?{request.url.query}"
        return RedirectResponse(url=destination, status_code=308)

    return redirect


@app.get("/service-worker.js", include_in_schema=False)
def service_worker():
    return FileResponse(
        os.path.join("static", "service-worker.js"),
        media_type="application/javascript",
    )


# Give each screen a readable public URL while preserving old bookmarks.
# These routes must be registered before the catch-all /static file mount.
for friendly_path, filename in FRONTEND_PAGES.items():
    route_name = filename.removesuffix(".html")
    app.add_api_route(
        friendly_path,
        _frontend_page(filename),
        methods=["GET"],
        name=f"frontend_{route_name}",
        include_in_schema=False,
    )
    app.add_api_route(
        f"/static/{filename}",
        _legacy_frontend_redirect(friendly_path),
        methods=["GET"],
        name=f"legacy_frontend_{route_name}",
        include_in_schema=False,
    )


# ---------------------------------------------------------------------------
# Frontend static files (plain HTML/CSS/JS — served from /static)
# ---------------------------------------------------------------------------
app.mount("/static", StaticFiles(directory="static", html=True), name="static")
