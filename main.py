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
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import func
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
    Question,
    Quiz,
    Submission,
)
from cloudinary_utils import upload_image_bytes, upload_video_bytes

# Lecturer-only areas (uploading quizzes, viewing/marking submissions) require
# this PIN. It's sent as a header (X-Lecturer-Pin) on those requests.
# This is intentionally simple (a shared PIN, not per-user accounts).
# For anything beyond a small trusted class, move this to an environment
# variable too (os.getenv("LECTURER_PIN", "90435")) so it isn't baked into
# the deployed code.
LECTURER_PIN = os.getenv("LECTURER_PIN", "90435")

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


def build_submission_pdf(db: Session, submission_id: int, styles) -> list:
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

        if q.type in ("mcq", "short") and q.correct_answer:
            flow.append(Paragraph(f"<b>Expected answer:</b> {_pdf_escape(q.correct_answer)}", styles["Expected"]))

        marks_text = "—" if a.awarded_marks is None else a.awarded_marks
        flow.append(Paragraph(f"<b>Marks awarded:</b> {marks_text} / {q.marks}", styles["Marks"]))
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
    images: List[UploadFile] = File(default=[]),
    _pin_ok: bool = Depends(require_lecturer_pin),
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

    quiz = Quiz(title=title, created_at=datetime.utcnow().isoformat() + "Z")
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
        "num_questions": len(questions),
        "images_uploaded": len(resolved_cache),
    }


@app.get("/quizzes")
def list_quizzes(_pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    rows = db.query(Quiz).order_by(Quiz.id.desc()).all()
    return [{"id": r.id, "title": r.title, "created_at": r.created_at} for r in rows]


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

    return {"quiz_id": quiz.id, "title": quiz.title, "questions": out_questions}


# ---------------------------------------------------------------------------
# Student: submit answers -> auto-mark mcq & short, leave long ungraded
# ---------------------------------------------------------------------------

@app.post("/quiz/{quiz_id}/submit")
def submit_quiz(quiz_id: int, submission: QuizSubmission, db: Session = Depends(get_db)):
    questions = db.query(Question).filter(Question.quiz_id == quiz_id).all()
    if not questions:
        raise HTTPException(status_code=404, detail="Quiz not found")

    new_submission = Submission(
        quiz_id=quiz_id,
        student_id=submission.student_id,
        student_name=submission.student_name,
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

        if q.type in ("mcq", "short"):
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
def list_submissions(quiz_id: int, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
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
def get_submission_detail(submission_id: int, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    submission = db.query(Submission).filter(Submission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

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
def mark_answers(submission_id: int, payload: MarkSubmissionRequest, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    submission = db.query(Submission).filter(Submission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

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
def download_submission_pdf(submission_id: int, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
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


@app.get("/lecturer/quiz/{quiz_id}/pdf")
def download_quiz_pdf(quiz_id: int, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    """Download every submission for a quiz as one combined PDF, one
    student's marked answers per section (page break between students)."""
    quiz = db.query(Quiz).filter(Quiz.id == quiz_id).first()
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")

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
    _pin_ok: bool = Depends(require_lecturer_pin),
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

    module_code = (module_code or "").strip().upper()
    if not module_code:
        raise HTTPException(status_code=400, detail="A module code is required")

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
def submit_lesson(lesson_id: int, submission: QuizSubmission, db: Session = Depends(get_db)):
    questions = db.query(LessonQuestion).filter(LessonQuestion.lesson_id == lesson_id).all()
    if not questions:
        raise HTTPException(status_code=404, detail="Lesson not found")

    new_submission = LessonSubmission(
        lesson_id=lesson_id,
        student_id=submission.student_id,
        student_name=submission.student_name,
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

        if q.type in ("mcq", "short"):
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
def get_my_lesson_submission(lesson_id: int, student_id: str, db: Session = Depends(get_db)):
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
def list_lesson_submissions(lesson_id: int, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
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
def get_lesson_submission_detail(submission_id: int, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    submission = db.query(LessonSubmission).filter(LessonSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

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
def mark_lesson_answers(submission_id: int, payload: MarkSubmissionRequest, _pin_ok: bool = Depends(require_lecturer_pin), db: Session = Depends(get_db)):
    submission = db.query(LessonSubmission).filter(LessonSubmission.id == submission_id).first()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

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
    x_lecturer_pin: Optional[str] = Header(None, alias="X-Lecturer-Pin"),
    db: Session = Depends(get_db),
):
    if not payload.comment_text.strip():
        raise HTTPException(status_code=400, detail="Comment can't be empty")
    if payload.is_lecturer and x_lecturer_pin != LECTURER_PIN:
        raise HTTPException(status_code=401, detail="Lecturer PIN required to post as the lecturer")

    lesson = db.query(Lesson).filter(Lesson.id == lesson_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")

    comment = LessonComment(
        lesson_id=lesson_id,
        author_name=payload.author_name.strip() or "Anonymous",
        is_lecturer=payload.is_lecturer,
        comment_text=payload.comment_text.strip(),
        created_at=datetime.utcnow().isoformat() + "Z",
    )
    db.add(comment)
    db.commit()
    return {"id": comment.id, "ok": True}


# ---------------------------------------------------------------------------
# Student: check results (quizzes)
# ---------------------------------------------------------------------------

@app.get("/results/{student_id}")
def get_results(student_id: str, quiz_id: Optional[int] = None, db: Session = Depends(get_db)):
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
            "submitted_at": s.submitted_at,
            "total_score": s.total_score,
            "max_score": s.max_score,
            "fully_marked": s.fully_marked,
            "status": "Final result ready" if s.fully_marked else "Long-answer questions still being marked",
        })
    return results


@app.get("/")
def root():
    return RedirectResponse(url="/static/index.html")


# ---------------------------------------------------------------------------
# Frontend static files (plain HTML/CSS/JS — served from /static)
# ---------------------------------------------------------------------------
app.mount("/static", StaticFiles(directory="static", html=True), name="static")
