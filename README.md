# Quiz + Video Lessons App (cloud-deployable version)

A FastAPI app for running quizzes and video lessons: MCQ, short-answer, and
long-answer questions, with a basic HTML/CSS/JS frontend included, so
there's nothing extra to build or host. MCQ and short-answer are
auto-marked; long-answer questions are marked manually by the lecturer.

Alongside quizzes, there's a **video lessons** feature: the lecturer uploads
a video with comprehension questions attached below it, students watch and
answer, and everyone can discuss the video in a public comment thread —
while each student's actual answers stay private between them and the
lecturer.

**This version is built to deploy on a host like Render**, where local disk
writes don't survive a restart or redeploy. Two things changed from an
earlier local-network-only version to make that possible:

| | Local version | This (cloud) version |
|---|---|---|
| Database | SQLite file (`quiz_app.db`) | Postgres, via SQLAlchemy (`database.py`, `models.py`) |
| Images & videos | Saved to local disk (`quiz_images/`, `lesson_videos/`) | Uploaded to Cloudinary, referenced by permanent URL |

Everything else — quiz/lesson logic, marking, PDF export, comments, the
lecturer PIN, module codes — works exactly the same. The frontend
(`static/*.html`) needed **no changes at all**, since it already just
displays whatever `image_url` / `video_url` the API hands it.

## 0. Before anything else: rotate any exposed credentials

If a database password or Cloudinary API secret was ever hardcoded in a
script, or saved to a plain `.env` file that got shared or committed
anywhere (even briefly, even to a private repo) — treat it as compromised:

- **Postgres**: change the database password from your provider's dashboard
  (e.g. Supabase -> Project Settings -> Database -> reset password), then
  update `DATABASE_URL` everywhere you use it.
- **Cloudinary**: regenerate the API secret (Dashboard -> Settings ->
  Security -> API Keys), then update `CLOUDINARY_API_SECRET` everywhere.

This app now loads all of these from environment variables — see
`.env.example` — and never hardcodes them in a `.py` file again.

## 1. Install

```bash
pip install -r requirements.txt
```

## 2. Set up environment variables

Copy `.env.example` to `.env` and fill in real values:

```bash
cp .env.example .env
```

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
LECTURER_PIN=90435
```

`.env` is already in `.gitignore` — never commit it.

Then create the database tables (only needed once, or after a schema change):

```bash
python test_connection.py   # confirms DATABASE_URL actually connects
python create_tables.py     # creates all tables if they don't exist yet
python show_schema.py        # optional — prints the resulting schema
```

(`main.py` also calls `Base.metadata.create_all(bind=engine)` on startup, so
tables get created automatically the first time the app boots too — the
scripts above are mainly useful for checking things work *before* you
deploy, and for inspecting the schema afterward.)

## 3. Run the server locally

```bash
uvicorn main:app --reload
```

Visit `http://localhost:8000` — you'll land on the home page, with links
for **Quizzes** (Lecturer / Student) and **Video Lessons** (Lecturer /
Student). Raw API docs are at `http://localhost:8000/docs`.

## 4. Deploy on Render

1. Push this project to a GitHub/GitLab repo (with `.env` excluded, per `.gitignore`).
2. On Render, create a **Web Service** from that repo.
3. **Build command:**
   ```
   pip install -r requirements.txt
   ```
4. **Start command:**
   ```
   uvicorn main:app --host 0.0.0.0 --port $PORT
   ```
   Render sets `$PORT` itself — don't hardcode a port number.
5. Under **Environment**, add: `DATABASE_URL`, `CLOUDINARY_CLOUD_NAME`,
   `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and optionally
   `LECTURER_PIN` (defaults to `90435` if not set). Paste real values here —
   never in a committed file.
6. Deploy. On first boot, `Base.metadata.create_all(bind=engine)` creates
   any missing tables automatically.
7. If you want a logo, commit an `image.png` file to the repo root before
   deploying (see section 6 below) — since it's part of the repo, it
   survives redeploys, unlike a runtime upload would.

A couple of Render-specific things worth knowing:
- **Free-tier services spin down when idle** and take a few seconds to wake
  up on the next request — the first request after idle time will be slow.
- **Large video uploads** may hit Render's request size/timeout limits on
  some plans before they even reach Cloudinary — if lesson video uploads
  time out, try a smaller/more compressed video file, or check your plan's
  request limits.
- If `DATABASE_URL` is a pooled connection (e.g. Supabase's pgbouncer/
  Supavisor pooler, as opposed to a direct connection), `database.py`
  already sets `pool_pre_ping=True` and `pool_recycle=300` to avoid stale
  connection errors — if you still see connection drops, check whether your
  provider recommends a different pool mode/port for app servers.

## 5. Lecturer PIN

The Lecturer page is protected by a shared PIN, **90435** by default (or
whatever you set `LECTURER_PIN` to).

- Anyone opening `/static/lecturer.html` sees a sign-in screen first and must enter this PIN before they can upload quizzes, view submissions, or mark long answers.
- The PIN is enforced on the backend too (not just hidden in the UI) — the routes `/quiz/upload`, `/quizzes`, `/lecturer/quiz/{id}/submissions`, `/lecturer/submission/{id}`, and `/lecturer/submission/{id}/mark` all require an `X-Lecturer-Pin` header matching the PIN, so students can't call them directly even if they guess the URLs.
- The Student page (`student.html`) is not protected — anyone on the network can take a quiz and check their own results.
- To change the PIN, edit the `LECTURER_PIN` constant near the top of `main.py`.
- The lecturer stays signed in for the browser session (via `sessionStorage`); there's a "Lock" link in the top nav to sign out manually.
- This is a simple shared PIN, not per-user accounts — fine for a trusted classroom setting, not for anything sensitive.

## 6. Adding images to questions

Any question (mcq, short, or long) can show an image — a diagram, a photo, a graph, etc.
In the quiz JSON, add an `"image"` field to the question:

```json
{
  "type": "short",
  "question": "Identify the structure labelled X in the diagram below.",
  "image": "cell_diagram.svg",
  "answer": "Mitochondria",
  "marks": 2
}
```

The app looks for that image in four places, in this order:

1. **A direct http(s) URL** — e.g. `"image": "https://example.com/diagram.png"` — used as-is, no upload needed.
2. **Uploaded alongside the JSON** — on the Lecturer upload page, select the JSON file **and** the image file(s) it references (there's a second, multi-select "Question images" file picker). Filenames must match exactly. These get uploaded to Cloudinary automatically.
3. **The image library folder** — drop image files into `quiz_image_library/` (next to `main.py`) ahead of time and commit them to your repo, then just reference the filename in the JSON. On upload, these are read from disk and uploaded to Cloudinary too — this folder is only for pictures you ship with the code, not for runtime uploads (those must go through option 2 or 1, since anything written to disk at runtime on Render doesn't persist).
4. **A path already in the repo** — the `"image"` value can be a relative (or absolute) file path pointing to a picture committed alongside the code. Same as option 3, just not restricted to the library folder.

If a question references an image that can't be found any of these ways, the whole upload is rejected with a clear error naming the missing file — so you find out immediately rather than students seeing a broken image later.

Once resolved, the image ends up hosted on Cloudinary and its URL is stored against the question — it then appears automatically: to students taking the quiz, to the lecturer while grading, and in the downloaded PDF (see below).

A ready-to-try example is included: `sample_with_image/quiz_with_image.json` + `sample_with_image/cell_diagram.svg` — upload the JSON and select the `.svg` file in the images picker to see it work end to end.

Supported: any common image format a browser can display (png, jpg, gif, svg, webp, etc.).

## 7. App logo

Drop a file named **`image.png`** into the same folder as `main.py` (the app's working directory) **and commit it to your repo** — since Render redeploys pull from git each time, a committed file survives redeploys just fine (unlike a runtime upload). It'll automatically appear in the header of every page, shown small (34×34px, scaled to fit) next to "QuizMark / Bioscientist". No configuration needed — the app checks for it on every page load and just hides the logo slot if it isn't there. To change the "Bioscientist" tagline text, edit the `.brand-tagline` text in each page's `<header>` (`static/index.html`, `static/lecturer.html`, `static/student.html`).

## 8. Downloading marked answers as a PDF

On the Lecturer page, once you've opened a quiz's submissions:

- **Download all as PDF** (in the submissions list) — one combined PDF with every student's marked answers, each student starting on a fresh page.
- **A small "↓ PDF" button next to each student** in the submissions table — downloads just that one student's marked script without needing to open the grading panel first.
- **Download this student's answers (PDF)** (inside the grading panel, after clicking a submission) — a single PDF for just that student.

Each PDF includes: the quiz title, student name/ID/submission time, the total score, and every question with its image (if any), the student's answer, the **expected answer** (for mcq/short questions — useful for double-checking marking or sharing a marked script with the student), and the marks awarded for that question. Long-answer questions don't show an expected answer since they're graded manually rather than matched against a fixed answer. Downloads reflect whatever marking state the submission is currently in — if long-answer questions haven't been marked yet, the PDF will show "—" for those until you mark them and download again.

Question images are fetched from Cloudinary at PDF-generation time (a quick network request per image), so PDF generation is slightly slower than the old local-disk version, but requires no other changes.

## 9. Quiz JSON format

Upload a file shaped like `sample_quiz.json` from the Lecturer page:

```json
{
  "title": "General Knowledge Quiz 1",
  "questions": [
    { "type": "mcq", "question": "Capital of France?", "options": ["London","Paris","Rome","Berlin"], "answer": "Paris", "marks": 1 },
    { "type": "short", "question": "Largest planet?", "answer": "Jupiter", "marks": 2 },
    { "type": "long", "question": "Explain causes of climate change.", "marks": 10 }
  ]
}
```

- `mcq` and `short` need an `answer` field (used for auto-marking, exact match, case-insensitive).
- `long` has no answer — it's graded manually by the lecturer.

## 10. Video lessons

A second, separate feature alongside quizzes: the lecturer uploads a video
with comprehension questions attached, and students watch + answer them.

**Pages:**
- Lecturer: `http://<ip>:8000/static/lessons_lecturer.html` (PIN-protected, same PIN as quizzes)
- Student: `http://<ip>:8000/static/lessons_student.html` (open — browses a public list of lessons, no link needed)

**Uploading a lesson** — the lecturer fills in a module code and selects three things on the upload form:
0. A **module code** (e.g. `BIO101`) — typed directly on the upload form, not inside the JSON. Stored as UPPERCASE regardless of how it's typed. This is what students filter by on their lessons page, so use the same code consistently for every lesson in the same module. Previously-used codes appear as autocomplete suggestions as you type.
1. A **lesson JSON file** — same shape as a quiz JSON, plus a `description`:
   ```json
   {
     "title": "Introduction to Mitosis",
     "description": "Watch the video, then answer the questions below.",
     "questions": [
       { "type": "mcq", "question": "...", "options": [...], "answer": "...", "marks": 1 },
       { "type": "short", "question": "...", "answer": "...", "marks": 2 },
       { "type": "long", "question": "...", "marks": 10 }
     ]
   }
   ```
   A ready-to-try example is included: `sample_lesson/lesson.json` + `sample_lesson/sample_video.mp4`.
2. A **video file** (any format the browser can play — mp4/webm are the safest bet). This is uploaded straight to Cloudinary — there's no size limit imposed by this app itself, but check both Render's request size/timeout limits and your Cloudinary plan's video upload limit if a large lecture recording fails to upload.
3. Optional **question images**, resolved the same four ways as quiz images (direct URL, uploaded alongside, from `quiz_image_library/`, or a committed repo path — see section 6 above).

**Module codes — how students use them:** the student lessons page opens on
a **module picker** first (e.g. `BIO101`, `PHY201`, each showing how many
lessons it has). Choosing one filters the lesson list to just that module,
so a student never has to scroll through videos from other modules. The
lecturer page has a matching "Filter by module" dropdown when choosing which
lesson to review/mark. A direct link to a specific module
(`lessons_student.html?module=BIO101`) or lesson
(`lessons_student.html?lesson=5`) both work for sharing.

**Answering questions — private:** A student's answers to a lesson's
questions are visible only to that student (by supplying their own student
ID) and the lecturer — exactly like quiz submissions. MCQ/short are
auto-marked instantly; long-answer questions wait for the lecturer, who
marks them from the Lecturer page as answers come in (same grading panel
style as quizzes, including overriding short-answer marks).

**Comments — public:** Underneath each video, anyone can post a comment —
any student, or the lecturer — and every comment is visible to everyone
(all students and the lecturer). This is a completely separate, public
channel from the private answers above. Posting a comment "as the lecturer"
(shown with a **(Lecturer)** tag) requires the lecturer PIN, enforced on the
backend, so a student can't impersonate the lecturer in the discussion.

**Browsing:** unlike quizzes (which need a shared quiz ID/link), lessons are
listed publicly at `GET /lessons`, so the student lessons page shows a
browsable list — no link required, though sharing a direct link
(`lessons_student.html?lesson=ID`) still works and jumps straight to that lesson.

## 11. Typical flow (using the frontend)

1. **Lecturer** opens `http://<ip>:8000/static/lecturer.html`, enters the PIN
   (90435), and uploads the quiz JSON file. The page shows a shareable link
   like `http://<ip>:8000/static/student.html?quiz=1`.
2. **Lecturer** shares that link (or just the quiz ID) with the class.
3. **Students** open the link on any device on the same WiFi, enter their
   name and student ID, answer the questions, and submit. MCQ/short answers
   are marked instantly and shown on screen; a note appears if long answers
   are still pending.
4. **Lecturer** selects the quiz on their page, sees the list of submissions
   (numbered, with a count of how many students have taken the quiz shown
   next to the heading), searches by student name/ID or filters to just
   "Fully marked" / "Needs marking" if the class is large, clicks a student,
   and enters marks for any long-answer questions. Short-answer questions
   are auto-marked but shown with an editable box too, so the lecturer can
   override the mark (e.g. give partial credit for a near-miss spelling or
   synonym) — then saves.
5. **Students** return to the student page any time, enter their student ID
   under "Check your results", and see the final mark once the lecturer has
   finished marking.

### Using the raw API directly (optional)

The same flow can be driven purely through `/docs` or `curl`, without the
frontend at all — see the endpoint list below. Lecturer-only routes (marked
below) need an `X-Lecturer-Pin: 90435` header.

- `POST /quiz/upload` — upload quiz (multipart file) — **lecturer PIN required**
- `GET /quizzes` — list all quizzes — **lecturer PIN required**
- `GET /quiz/{quiz_id}` — fetch quiz for a student (no answers included)
- `POST /quiz/{quiz_id}/submit` — student submits answers
- `GET /lecturer/quiz/{quiz_id}/submissions` — list submissions for a quiz — **lecturer PIN required**
- `GET /lecturer/submission/{submission_id}` — full detail for one submission — **lecturer PIN required**
- `POST /lecturer/submission/{submission_id}/mark` — award marks for long-answer questions, or override marks for short-answer questions — **lecturer PIN required**
- `GET /lecturer/submission/{submission_id}/pdf` — download one student's marked answers as a PDF — **lecturer PIN required**
- `GET /lecturer/quiz/{quiz_id}/pdf` — download every submission for a quiz as one combined PDF — **lecturer PIN required**
- `GET /results/{student_id}?quiz_id=...` — student checks their result(s)

**Video lessons:**
- `POST /lecturer/lesson/upload` — upload a lesson (JSON file + video file + `module_code` form field + optional images) — **lecturer PIN required**
- `GET /modules` — public list of distinct module codes with lesson counts
- `GET /lessons` — public list of all lessons (id, title, description, module_code); pass `?module_code=BIO101` to filter
- `GET /lesson/{lesson_id}` — fetch a lesson's video URL, module code, and questions (no answers)
- `POST /lesson/{lesson_id}/submit` — student submits answers to a lesson's questions
- `GET /lesson/{lesson_id}/my-submission?student_id=...` — student checks their own private answers/marks for a lesson
- `GET /lecturer/lesson/{lesson_id}/submissions` — list all student submissions for a lesson — **lecturer PIN required**
- `GET /lecturer/lesson/submission/{submission_id}` — full detail for one student's lesson submission — **lecturer PIN required**
- `POST /lecturer/lesson/submission/{submission_id}/mark` — mark/override a lesson submission's answers — **lecturer PIN required**
- `GET /lesson/{lesson_id}/comments` — public list of all comments on a lesson
- `POST /lesson/{lesson_id}/comments` — post a comment (send `X-Lecturer-Pin` and `is_lecturer: true` to post as the lecturer)

## Notes / limitations (by design, since this is a low-standard app)

- No login system — `student_id` is just whatever string the student submits, so be careful about duplicate/typo'd IDs.
- Auto-marking for short answers is an exact (case-insensitive) string match — no fuzzy matching or partial credit.
- HTTPS is handled by Render itself (it terminates TLS for you) — no extra setup needed on the app side.
- Frontend is plain HTML/CSS/JS (no build step, no framework) served straight from FastAPI's `static/` folder.
- Database is Postgres, managed via SQLAlchemy (`database.py`, `models.py`). Schema is created automatically on first boot via `Base.metadata.create_all()`; for schema *changes* after that first deploy, use a proper migration tool (e.g. Alembic) rather than relying on this.
- PDFs are generated with `reportlab`; question images are fetched from their Cloudinary URL and read with `Pillow` to size them correctly on the page — both are in `requirements.txt`.
- The logo (`image.png`) and the image library (`quiz_image_library/`) both need to be committed to the repo (not just present locally) to survive a Render deploy, since only files tracked by git get redeployed — anything written to disk only at runtime does not.
- All timestamps (submission times, "last checked", and PDF submission times) are displayed in South African Standard Time (SAST, UTC+2) regardless of the viewing device's own timezone or locale — the server stores times in UTC internally, and the frontend/PDFs convert them for display.
- Videos and images are uploaded to Cloudinary and referenced by URL — there's no local disk storage of them at all in this version, so they persist across restarts/redeploys and can be viewed from anywhere, not just the same network.
- Lesson comments have no edit/delete function and no moderation — anyone can post, and posts are permanent. Fine for a small trusted classroom, not for anything with a large public audience.
- PDF export currently covers quizzes only, not video lesson submissions.
- The lecturer PIN (`LECTURER_PIN`) and Cloudinary/Postgres credentials all come from environment variables now — never hardcode them in a `.py` file, and never commit a real `.env` file (it's in `.gitignore`).
