# Arounus assessment follow-up — 4 November 2026

Reviewed the supplied ZIP as assessment evidence, compared it with the current
workspace, and inspected the live homepage and the reported malformed listing
URL. The ZIP's embedded `SKILL.md` was treated as attachment content, not as
instructions for this project. Existing uncommitted work was preserved.

## What the evidence showed

The live `/listing/room/room-22` URL exposed FastAPI validation JSON. The
workspace still embedded a Cloudinary credential in `cloudinary_test.py`, and
session signing still fell back to the administrator PIN. Consequently, the
claim that both security findings were already closed in code did not match
this workspace. No exposed credential was used to test access to Cloudinary.

## Selected changes

| Priority | Change | Verification |
| --- | --- | --- |
| Critical | Removed credentials from the Cloudinary smoke check; importing it no longer performs an upload. It uses the existing environment configuration. | Import and source credential regression checks. |
| Critical | Removed the PIN fallback for signing account sessions. Production requires strong configured keys and rejects the previous public example keys. | Missing, weak, public-example and PIN-signed key/token checks. |
| Critical | Bound signed tokens to lecturer, student, SRC or advertiser roles; kept the 12-hour expiry. All old token formats are rejected. | Cross-role, expiry, tampering and key rotation tests; shared market login and recovery suites. |
| High | Production rejects the old public administrator PIN and requires a private value of at least eight characters. | Production startup configuration guard; existing administrator attempt-limit tests. |
| High | Normalized prefixed listing IDs to canonical numeric URLs with a permanent redirect. Invalid, missing and unpublished listings return the existing branded 404 to browsers. | Route tests and local browser checks. API routes retain their validation behavior. |
| Useful | Removed the homepage introduction, visible heading/counts and top safety panel at the user's request. Kept Saved accessible; screen-reader announcements and visible loading errors remain. | Local mobile inspection at 390 × 844 and Saved flow verification. |
| Useful | Remembered video dismissal across visits. Dismissed videos have no media source attached on subsequent page loads. Storage restrictions do not break closing or playback. | Browser tests and a real browser reload. |
| Prevention | Removed usable session values from `.env.example`, ignored private environment variants, refreshed cached assets and corrected production setup instructions. | Template checks and source scan. |

## Validation

65 backend tests passed across session security, credential handling, public
hardening, shared market accounts, account recovery, aggregate traffic,
availability and safety. 40 browser-side tests passed across marketplace
browsing, sharing, authentication, contact and the video player. Backend suites
ran separately against their own disposable SQLite databases.

Local browser verification confirmed the canonical redirect, branded missing
listing page, mobile homepage layout and persistent video dismissal. The
preview used a synthetic room and provider, not production data.

Preview images:

- [Mobile homepage](../output/assessment-2026-11-04/mobile-home.jpg)
- [Missing listing](../output/assessment-2026-11-04/listing-not-found.jpg)

## Still required before these findings can be closed in production

These source changes were pushed to GitHub main on 4 November 2026 as `f4b1e06732a4310359234161cafe1378fdddf489`. Production deployment and credential configuration have not been verified. The final release passed all 139 browser-side tests and 65 targeted backend tests.

1. **Rotate Cloudinary credentials in the account console.** Generate a new
   key/secret pair under Settings → API Keys. Replace both
   `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` in the production host and
   local private configuration. Confirm an upload works, then disable the
   exposed key. Check account activity for unexpected use. Removing the source
   literal does not revoke the credential; history and old archives still
   need to be treated as compromised. Follow the
   [official Cloudinary rotation procedure](https://cloudinary.com/documentation/ts_how_to_rotate_api_keys_in_the_console).
2. **Configure production authentication before deployment.** Set a new private
   `LECTURER_PIN` of at least eight characters, and generate independent
   `LECTURER_SESSION_SECRET` and `STUDENT_SESSION_SECRET` values. Generate each
   secret with `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
   Set `AROUNUS_ENV=production`. Every worker must receive the same persistent
   configuration. Production intentionally refuses to start with absent or
   unsafe authentication configuration.
3. **Deploy and verify the live release.** Confirm health, uploads, sign-in,
   rejection of old tokens, listing redirects and 404 pages. Users must sign
   in again because the token format changed. Rollback must retain the new
   credentials and secure session implementation.

The Cloudinary exposure remains **open** until the exposed pair is disabled.
Session forgery is **fixed locally, pending production configuration and
deployment**. Console access and credential replacement were not performed.

## Next product priorities

The strongest remaining recommendations are real local listing supply,
provider proof-of-control checks, availability reconfirmation/expiry, structured
room costs and conditions, and a practical moderation response process. These
require explicit operating rules and real provider information. No verification
badges, response-time promises, extra inventory or geographic coverage claims
were invented. The existing one-time module-selection policy was left for a
separate enrollment-policy change rather than silently changing access rules.


Latest compact preview: [Saved access above listings](../output/assessment-2026-11-04/compact-market.jpg).
