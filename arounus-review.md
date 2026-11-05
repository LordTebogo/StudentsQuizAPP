# Arounus.com — Structure & Usability Assessment

**Reviewed:** 1 November 2026 · **Pages:** `/` (Campus Market), `/learning`, `/trust`, sell dialog, listing dialog · **Viewports:** 1440×900 and 390×844 · **Method:** live browser interaction, DOM/CSS inspection, HTTP header checks, contrast calculation.

* * *

## 1\. What the site is

Arounus presents itself as a South African campus marketplace: students can find rooms, transport, second-hand items and services around their university, and can list their own. A second product, "Arounus Learning," sits behind a sign-in and offers quizzes, tutors, video lessons and messaging.

The first impression is genuinely good. The homepage has a clear promise ("Campus life, all in one place"), a single search block, category chips, and a well-written empty state. The visual language is calm and modern — off-white surfaces, deep green accents, Space Grotesk headings — and the copy is friendly without being childish. Underneath that polish, though, the site is still a thin shell: on the day of review there was **one real listing** (a R150 tutoring ad at University of Limpopo) against **twenty demo listings**, and the marketplace's core mechanics — per-listing pages, shareable searches, seller identity, safety guidance — are missing or incomplete.

* * *

## 2\. Information architecture and structure

**The homepage funnel is the strongest part of the site.** It reads top to bottom in a logical order: brand and promise → primary actions → search and filters → results → "Have something to offer?" seller call-to-action. A "Skip to listings" link is the first tab stop, and the results region is properly marked up as `main`. Someone landing cold understands within five seconds what the site does and what to do next.

**But the site has two competing identities.** The homepage `<title>` is "Campus Market — Arounus," the learning page is "Learning — Arounus," and the trust page describes Arounus as "the Bioscientist learning platform… with optional community and market spaces." So the market is positioned as the main product in one place and as an optional add-on in another. For a first-time visitor this creates real ambiguity about whether they are on a classifieds site or a study platform. Pick one hierarchy and state it consistently.

**Navigation is extremely thin.** The header contains only the logo, "Learning ↗" and "Sell or list." There is no "Rooms," "Transport," "Items," "About," "Safety," "Help" or "Sign in" in the market header. Categories exist only as filter chips _below_ the fold, so they are not navigation — they are filtering. A marketplace normally needs browsable category landing pages (e.g. `/rooms`, `/transport`) that are linkable, indexable and shareable. Here, categories have no URLs at all.

**Listing detail is a modal, not a page.** Clicking "View room" opens a dialog (`#offerDialog`) and the URL never changes. This is the single biggest structural weakness. It means:

-   no deep link to a listing, so nothing can be shared on WhatsApp or a campus group;
-   no back-button behaviour or browser history for a listing;
-   no indexable listing pages, which is fatal for marketplace SEO;
-   no place to put rich content (map, house rules, availability calendar, seller history).

**Filter state is invisible to the URL.** I searched "room," selected "Transport," and reloaded: the URL stayed `https://arounus.com/` and every filter reset. Users cannot bookmark or share a search, cannot return to results after opening a listing, and search engines see only the unfiltered default view.

**The learning section is a wall, not a shopfront.** The homepage's first CTA — "Study and find a tutor" — leads to `/learning`, which is a role picker (Learner / Tutor / Visitor / Advertiser) plus a sign-in form and a single tutoring offer. There is no preview of quizzes, no sample lesson, no tutor directory, no explanation of pricing. The promise on the homepage ("Study with quizzes and tutors") is not visible or testable before creating an account. That is a conversion problem as much as a structural one.

**The trust centre is a stub.** `/trust` covers privacy, terms and support in about 200 words, and its support section says to "use the available support contact" — without providing an email address, phone number, form or response time. For a site that asks students to meet strangers and pay for rooms, this is the weakest page on the domain.

* * *

## 3\. Usability findings

### Critical

**Demo inventory swamps real inventory, and the interface does not separate them.** Of 21 cards on the homepage, 20 are labelled "DEMO" / "Example only" and one is real. Worse, the result counter mixes the two registers: filtering to Rooms produced the line **"0 active listings across all campuses · 10 clearly marked examples"** while ten room cards filled the screen. Searching "room" likewise returned "0 active listings" alongside ten room results. A user cannot tell what is actually available, and the contradiction between the count and the grid undermines confidence in the whole dataset. Demo content should be in a separate, clearly bounded "Preview" state — or removed before public launch.

**There is no seller identity or listing provenance.** Cards show a title, campus, price, "N unique views" and "No ratings yet." There is no posted date, no seller name or photo, no verification badge, no response rate, no distance from campus. For a room rental — the highest-risk category — the absence of "listed 3 days ago by Thabo, verified student" is a serious trust gap.

### High

**The sell flow demands an account before showing the form.** "Sell or list" opens a dialog that begins with "Create advertiser account" (name, business name, phone, email, password, confirm password). Only after registering does a user see what a listing actually requires. This inverts the ideal order — let people draft a listing, then ask them to register to publish — and will lose a large share of first-time sellers.

**Ratings are interactive on content that cannot be rated.** Every demo card carries five clickable star buttons with the accessible name "Rate 1 star" … "Rate 5 star," even though the card says "No ratings yet" and the listing is explicitly not real. Clicking a star on a demo listing is a dead-end interaction that invites accidental input.

**No way to save, compare, report or contact from the grid.** The only actions are "View room" and the star row. There is no heart/save, no "report listing," no "share," and no quick contact. On mobile, where most of this audience will browse, that leaves the experience read-only until a modal opens.

**The mobile header stacks two CTAs awkwardly.** At 390px the logo and "Learning ↗" occupy the first row, and "Sell or list" wraps onto a second row beneath them (measured at y≈80px), producing a tall, staggered header. It does not overflow horizontally — the page width stays at 390px, which is good — but the header reads as an accident rather than a layout.

### Medium

**Search relevance is unclear.** Searching "room" returned zero _real_ results while still displaying ten demo rooms, and the real tutoring listing disappeared. Because demo items are excluded from the text index but included in the grid, the search behaves in a way users cannot predict.

**Result counts and grammar need care.** "1 unique views," "0 unique views," "2 unique views" — the pluralisation is wrong throughout, and "unique views" is an internal metric that means little to a student deciding whether a room is still available.

**The campus field relies on a native `<datalist>`.** It is functional and has `autocomplete="off"` plus a `campusOptions` list, but datalist dropdowns are inconsistent across mobile browsers and offer no "near me" or geolocation shortcut, which is the natural entry point for "around campus."

**Category chips lack a pressed/selected semantic.** They are plain `<button>` elements; there is no `aria-pressed` or tab semantics, so a screen-reader user cannot tell which category is active. The same applies to the Learner/Tutor/Visitor role buttons on `/learning`, which are visually a tab set but expose no `role="tab"` or `aria-selected`.

### Low

-   The footer is minimal (Learning, Support, Privacy) and repeats "Arounus · Bioscientist," adding to the identity confusion.
-   "No ratings yet" plus five empty stars is repeated on every card, adding visual noise without information.
-   The empty state itself is well written ("No listings here yet. Try another campus or category, or be the first to list something.") — a genuine bright spot.

* * *

## 4\. Accessibility

The foundations are better than most early-stage marketplaces. There is one `<h1>`, a sensible heading order, `header`/`nav`/`main`/`footer` landmarks, a working skip link, visible `:focus-visible` styling, and every form control I checked is associated with a real `<label>`. The result counter is an `aria-live="polite"` status region, so filtering is announced to screen readers. Colour contrast passes WCAG AA across the palette I measured: body text 12.9:1, muted text 5.4:1, white on the green CTA 4.9:1, green on white 4.7:1.

The problems are in the details:

-   **Tap targets.** The star buttons measure roughly 20×22px, far below the 44×44px guideline, and they sit five-in-a-row on every card. Category chips are 41px tall, just under the threshold.
-   **Duplicate focus stops.** Each card is an `<article tabindex="0">` _and_ contains focusable buttons, so keyboard users tab through the card twice for the same destination.
-   **Ambiguous accessible names.** Fifty buttons on one page are named "Rate 1 star" through "Rate 5 star" with no listing context. They should read "Rate DEMO: Student room example 01, 3 stars."
-   **Missing state semantics** on category chips and learning role buttons, as noted above.
-   **No `lang`/region issues found** — `<html lang="en">` is present, which is correct.

* * *

## 5\. Technical and performance observations

The page is server-rendered by a Python service behind Cloudflare (`x-render-origin-server: uvicorn`) with client-side hydration. A cold load made 22 requests; the two data calls (`/listings`, `/adverts`) took roughly 530ms each and were the slowest resources, while CSS and JS were fast. Ten of fourteen images are lazy-loaded, which is appropriate.

Two pieces of technical debt are visible in the CSS:

1.  **The brand typeface is not applied to body copy.** `campus-home.css` sets `.campus-home { font-family: Arial, sans-serif; }`, which overrides the `--font-body` (Manrope) token defined elsewhere. Computed styles confirm it: headings render in Space Grotesk, but navigation, buttons, card text, eyebrows and the footer all render in **Arial**. Manrope is downloaded and loaded but effectively unused for body text — a small but pervasive brand inconsistency, and wasted bytes.
2.  **A dark theme is layered under a light theme.** `style.css` still contains a full dark palette (`rgba(3,7,18)`, `#06121d`, cyan-on-navy buttons) that `light.css` overrides. Five stylesheets and eight external scripts are loaded on the homepage to produce a fairly simple page. This is the kind of cascade that makes future changes risky.

Other notes: HTML responses are `cf-cache-status: DYNAMIC` with no cache-control headers, so every visit re-renders; static assets are served with version query strings but I could not confirm long-lived caching. `/robots.txt` and `/sitemap.xml` both return **404**.

* * *

## 6\. SEO

This is the weakest area after trust. Across `/`, `/learning` and `/trust` there is **no meta description, no Open Graph tags, no Twitter card and no canonical link**. Combined with the modal-only listing model and the missing robots/sitemap, the site is effectively invisible to search and gives poor link previews when shared on WhatsApp — the main distribution channel for South African campus communities. Titles are good and unique per page; everything around them is missing.

* * *

## 7\. Trust and safety

For a marketplace that brokers room rentals between students, the safety surface is underbuilt:

-   No contact channel on the trust page (no email, phone, form or SLA).
-   No guidance on paying deposits, viewing a room before paying, or spotting scams.
-   No POPIA (South African data-protection) reference in the privacy section.
-   No moderation or takedown policy beyond "may be moderated or removed."
-   No seller verification for market listings — verification is described only for SRC profiles.
-   The single real listing routes contact to a personal WhatsApp number, which is pragmatic but leaves no audit trail or dispute path.

* * *

## 8\. Scorecard

| Dimension | Score | Comment |
| --- | --- | --- |
| Visual design & first impression | 8/10 | Calm, credible, distinctive palette |
| Homepage structure | 7/10 | Clear funnel; weak header navigation |
| Information architecture | 5/10 | Two products, one identity; no category pages |
| Search & filtering | 5/10 | Works, but state is not shareable and counts contradict results |
| Listing experience | 4/10 | Modal-only, no deep links, no seller context |
| Seller onboarding | 4/10 | Account required before the form is even shown |
| Trust & safety | 3/10 | Thin policy pages, no contact, no scam guidance |
| Accessibility | 7/10 | Strong semantics, weak targets and state labels |
| Mobile | 7/10 | No overflow, readable, but header wraps badly |
| Performance | 6/10 | Fast enough; layered CSS/JS debt |
| SEO | 3/10 | No descriptions, no OG, no sitemap, no listing URLs |
| **Overall** | **5.5/10** | A well-designed shell waiting for marketplace fundamentals |

* * *

## 9\. Prioritised recommendations

**P0 — before promoting the site publicly**

1.  Separate demo inventory from real inventory. Either hide demos behind a "Preview" toggle, or remove them. Never show a count of "0 active listings" above ten visible cards.
2.  Give every listing a real URL (`/listing/<id>`) with server-rendered title, price, campus, photos and description. Keep the modal as an enhancement, not the destination.
3.  Encode filters in the URL (`?campus=…&category=rooms&max=3500&q=…`) so searches are shareable and survive reload.
4.  Publish a real support contact, a marketplace safety page (deposits, viewings, scams) and a POPIA-compliant privacy note.

**P1 — next sprint**

5.  Add posted date, seller name/verification, and a "report listing" action to every card.
6.  Let sellers draft a listing first and register at publish time; show a one-screen preview of what a listing looks like.
7.  Add save/favourite and share (WhatsApp-first) actions to cards.
8.  Replace the native datalist with a proper combobox offering "near me" and recent campuses.
9.  Fix the mobile header so the two CTAs sit on one row or collapse into a menu.

**P2 — polish**

10.  Apply Manrope to body copy and delete the dead dark-theme rules; consolidate the five stylesheets.
11.  Enlarge star and chip tap targets to 44px, remove `tabindex="0"` from cards, and give each star button a listing-specific accessible name.
12.  Add `aria-pressed` to category chips and proper tab semantics to the learning role selector.
13.  Add meta descriptions, Open Graph images and a sitemap; make `/robots.txt` return a real file.
14.  Fix pluralisation ("1 view") and replace "unique views" with a user-meaningful signal such as "Listed 2 days ago."

* * *

## 10\. Closing comment

Arounus has the hard-to-teach part right: it looks trustworthy, the copy is human, the homepage funnel is clear, and the accessibility foundations are solid. What it lacks is the unglamorous plumbing that makes a marketplace actually work — permanent listing pages, shareable searches, visible sellers, and safety information a parent would accept. None of those are redesigns; they are additions. Fix the demo/real-data confusion and the missing listing URLs first, and the existing design will start carrying real inventory instead of sample rooms.