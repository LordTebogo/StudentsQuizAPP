# Arounus local reassessment — 5 November 2026

## Scope and confidence

This is a local-only reassessment of the current Arounus workspace. It inspected the source tree, frontend behavior tests, backend security tests, database/deployment configuration, service worker, and the synthetic localhost preview. It did not connect to Render, production Postgres, Cloudinary, payment providers, or real user accounts.

## Current status

The local workspace is clean according to Git status, with the current implementation already containing the recent marketplace, messaging, learning, PWA and hardening work.

The local synthetic preview responds successfully for `/`, `/learning`, `/marketing/listings`, and `/marketing/adverts`. It rejects write requests with HTTP 503 and is safe for visualization only.

### Test results

- Frontend suite: **157 passed, 1 failed out of 158**.
- The remaining failure is deterministic in `tests/market-compact-cards.test.cjs`: browser Back closes the listing dialog visually, but the URL still contains `listing=room-7` at the assertion point. The run also reports asynchronous jsdom activity after test completion (`Cannot read properties of null (reading '_location')`). This is a real navigation/cleanup defect or race, not merely a test-environment warning.
- Backend security and site-hardening subset: **23 passed**.
- Full Python discovery: **110 tests, 82 errors** when run as one unittest process. The dominant error is `sqlite3.OperationalError: unable to open database file`. The test modules mutate global `DATABASE_URL` and import `main`/`database` at module import time, so temporary fixture lifetimes and import order interfere with one another. The individual suites can pass when run in isolation, but the repository does not currently have a reliable one-command Python test run.

## Findings and recommendations

### P0 — Fix private-page caching in the service worker before relying on offline mode

`static/service-worker.js` caches navigation responses in `SHELL_CACHE` using `cacheResponse(SHELL_CACHE, request, online)`. The app shell also includes private routes such as `/students`, `/lecturers`, `/admin`, `/live`, `/reset-password` and workspace pages. The account-header cache-key protection applies to API requests carrying account headers, not necessarily to document navigations. A shared device may therefore retain private HTML offline or serve an old private document after sign-out.

Recommended fix:

1. Treat authenticated/private document paths as network-only or `Cache-Control: no-store`.
2. Remove private routes from `APP_SHELL`; keep only the public shell and public guides there.
3. On service-worker activation, delete legacy private document caches and add a regression test that a private navigation is never put into `SHELL_CACHE`.
4. On sign-out, clear account-scoped API caches and reload from a public route.

### P0 — Remove the tracked database artifact and rotate any data exposed by repository history

`quiz_app.db` is tracked by Git even though other database files are ignored. A committed SQLite database can contain student, lecturer, quiz, messaging, or payment-related data. Do not assume deleting it from the working tree is enough: inspect repository history and rotate any credentials or tokens that may have been present.

Recommended fix:

1. Confirm whether `quiz_app.db` contains real or test data without distributing its contents.
2. Remove it from the repository and rewrite history if it was ever pushed.
3. Rotate any secrets or account credentials found in the file or historical commits.
4. Add a CI guard that fails when `*.db`, credential files, `.env`, or reset-code artifacts are tracked.

### P1 — Make the Python test suite isolated and repeatable

The current tests are not safe to discover together because they configure global environment variables and import the application once per interpreter. This hides regressions and makes CI results dependent on test order.

Recommended fix:

- Use a test runner that starts each database-dependent module in a subprocess, or refactor application construction into `create_app(settings)` and database setup into an explicit fixture.
- Replace `tempfile.mktemp()` with `TemporaryDirectory()` or `NamedTemporaryFile(delete=False)` plus deterministic cleanup.
- Ensure every fixture keeps its parent directory alive for the entire test module.
- Add a documented command that passes from a clean checkout, and run it in CI.

### P1 — Fix marketplace Back/Forward state and jsdom cleanup

The remaining frontend failure is in listing history. `static/campus-home.js` uses `pushState`, `history.back()`, `closingFromHistory`, and a dialog `close` event. The test observes the listing query still present after Back, suggesting the close/popstate sequence is not fully synchronized. The asynchronous `_location` errors suggest timers, fetches, or jsdom callbacks remain active after the test closes its window.

Recommended fix:

- Make URL state authoritative: on `popstate`, first reconcile the URL, then close/open the dialog without a second history mutation.
- Await or flush the dialog-close transition in the test before asserting URL state.
- Abort pending listing/view/rating/image work when the window or listing is closed.
- Add a small history state machine test covering: direct link, open, share dialog, Back, Forward, close button, refresh, and missing listing.

### P1 — Replace process-local abuse throttles before scaling beyond one worker

Login, reset and admin throttling are process-local dictionaries. They help against casual spraying but do not coordinate across Render instances or worker processes and reset on restart.

Recommended fix:

- Move counters to a shared store such as Postgres with expiry columns or Redis.
- Key limits by a privacy-preserving account identifier plus IP/network signal, with careful proxy handling.
- Add monitoring for lockouts, reset abuse, webhook failures and unusual listing/report volume.

### P1 — Introduce real database migrations

`main.py` calls `Base.metadata.create_all()` and performs multiple ad-hoc `ALTER TABLE`/index checks on import. This is fragile during concurrent deploys, makes rollback difficult, and can make startup fail after a partial schema change. The code comments already recommend a migration tool, but no migration directory/configuration was found.

Recommended fix:

- Add Alembic migrations for every current schema change.
- Run migrations as a controlled deploy/release step, not on every web-worker import.
- Keep startup limited to dependency checks and fail with an actionable health status when schema version is incompatible.

### P1 — Narrow CORS and reduce CSP exceptions

`main.py` still configures `allow_origins=["*"]`, all methods, and all headers. The general CSP permits `unsafe-inline`, `unsafe-eval`, broad HTTPS connections, and multiple external script hosts. Market pages receive a stricter policy, but learning, admin and tool pages retain the broad policy.

Recommended fix:

- Allow only the production origin and explicitly approved local development origins.
- Enumerate methods and headers required by the application.
- Move remaining inline scripts/styles to versioned first-party assets, then remove `unsafe-inline`/`unsafe-eval` page by page.
- Add CSP report-only telemetry before enforcement on complex tool pages.

### P2 — Reduce the offline shell and separate public from authenticated workspaces

The static tree is approximately **9.3 MB across 134 files**, and the service worker references roughly **104 shell entries**, including many private workspaces and optional tools. This increases installation time, update churn, storage use, and the chance of stale content.

Recommended fix:

- Keep the initial shell to public market, public learning entry, trust, guide and core assets.
- Lazy-cache tool libraries and workspace bundles only when a user enters the relevant feature.
- Version cache names by a manifest hash and show update progress/failure in the UI.
- Test offline behavior on a low-storage mobile device.

### P2 — Improve operational observability

There is a `/healthz` endpoint that checks the database, but no visible migration status, structured error correlation, metrics, or alerting configuration was found in the local project. The room email worker is started with the application lifespan, which makes background job health and duplicate-worker behavior important to observe.

Recommended fix:

- Add structured request IDs and JSON logs.
- Expose non-sensitive counters for request latency, 5xx responses, DB pool errors, queue depth, email failures, payment webhook rejects, and cache failures.
- Add a readiness check that includes schema version and required external configuration without leaking secrets.
- Document Render health-check, worker, restart and rollback procedures.

### P2 — Strengthen product trust and conversion

The marketplace now clearly labels synthetic examples and warns that listing freshness cannot be confirmed. The next product step is to make trust measurable and useful: show last-confirmed timestamps, provider response rate, report outcomes, moderation state, and a clear path from learner onboarding to the first successful action.

Recommended fix:

- Add provider verification levels rather than a binary “approved” implication.
- Add stale-listing reminders and provider confirmation prompts.
- Make the first signed-out learning screen explain the learner/tutor outcomes before asking for credentials.
- Instrument funnel events: landing → search → listing detail → contact/signup → completed action.

## Suggested implementation order

1. Remove/secure tracked database artifacts and review repository history.
2. Stop caching private document navigations and add service-worker privacy tests.
3. Fix marketplace history/cleanup failure and make the frontend suite fully green.
4. Isolate Python test modules so the entire suite passes reliably in one CI command.
5. Add Alembic migrations and deployment checks.
6. Replace process-local throttles with shared storage.
7. Narrow CORS/CSP and reduce offline shell size.
8. Add operational metrics, provider trust signals and onboarding funnel instrumentation.
