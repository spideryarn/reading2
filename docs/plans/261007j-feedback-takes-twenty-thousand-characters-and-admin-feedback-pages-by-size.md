# Feedback takes 20,000 characters, and `/admin/feedback` pages by size

Queue item `qi-8qvg5gwv`, the deferred half of `spya-n8cuqq`. Option B of
[261007b § Questions for Greg](261007b-dictation-says-when-it-is-about-to-stop-and-runs-fifteen-minutes.md#questions-for-greg).

> yes

— Greg, 2026-10-07, to option B (raise both caps to 20,000). The same message:

> try hard to avoid ever losing/throwing away (especially important) user data/input

— Greg, 2026-10-07, now principle 6 in [vision.md](../project/vision.md).

## Why

Dictation runs fifteen minutes. The Feedback box takes 12,000 characters, about thirteen minutes
of non-stop speech; 261007b's soak of fifteen minutes non-stop came to 15,108. Past the cap nothing
is lost (the words stay in the box, Send is off), but the reader has to trim or split. 20,000 covers
fifteen minutes at 200 words a minute.

## What changes

1. **Migration** (`drizzle/…_feedback_body_twenty_thousand.sql`, generated from `schema.ts`):
   `feedback_body_shape` goes from `length(body) <= 12072` to `<= 20000`. It only loosens, so every
   existing row stays legal; the Overseer applies it at deploy.
2. **`MAX_FEEDBACK_BODY_CHARS` = 20,000** and **`MAX_FEEDBACK_ANSWER_CHARS` = 20,000**
   (`src/types.ts`). They become equal: the database's ceiling is the reader's limit. The legacy
   three-answer fold (`MAX_LEGACY_FEEDBACK_ANSWER_CHARS` 4,000 × 3 + headings = 12,072) stays inside
   it. `MAX_FEEDBACK_BODY_BYTES` (route) already reads the constant.
3. **`/admin/feedback` pages by size as well as count.** `listFeedbackAcrossOwners` still fetches
   `limit + 1` rows in keyset order, then cuts the page at the last row whose running total of
   `JSON.stringify(report)` UTF-8 bytes stays within `FEEDBACK_LIST_BYTES` (3 MB; always at
   least one row). `hasMore` and the cursor come from the cut, so nothing is skipped: the next page
   starts after the last row returned. At 500 × 20,000-character bodies a count-only page would be
   10 MB+ against Vercel's 4.5 MB response ceiling; this bound also closes the pre-existing
   `?limit=500` overflow 261007b noted. The client needs no change: it already follows
   `nextCursor`/`hasMore`, and nothing on the page claims a page holds N reports.
4. **The reader's Earlier tab is cut the same way** (GPT Sol's plan review, P1). `GET /api/feedback`
   returns up to fifty whole bodies, and fifty at 120 KB of escaped JSON each is 6 MB. The route
   keeps the longest prefix that fits `FEEDBACK_LIST_BYTES` and sets `more`; the client's validator
   accepts a short page with `more` (never an empty one), and the line counts what it shows
   ("Showing the 12 most recent of your 50 reports"). One helper, `src/json-budget.ts §
   prefixWithinBytes`, does the cut for both lists.

## The Sentry guard, at the new size

The CHECK's stated job is *"what stops one paste of an entire article becoming an attachment on its
way to Sentry"*. It still does that job: the cap moves from 12,072 to 20,000 but stays enforced in
three places — dialog, route (`feedbackAnswer`, 413/400 with a sentence), and the column CHECK for
any writer that bypasses the route. A 20,000-character paste is a short article, which is the trade
Greg accepted. The test that writes exactly the cap and one more (tests/feedback-store.test.ts) moves
with the constant, so the guard is proven at its new value rather than assumed.

**Sentry probably trims a long message, and already did at 12,000.** Upstream Relay gives the
feedback context an 8,192-byte budget and trims strings against it (GPT Sol's plan review cites
`relay-event-schema/src/protocol/contexts/mod.rs` and `relay-event-normalization/src/trimming.rs`).
Not observed on our hosted ingestion. The database row is written first and is the record;
`/admin/feedback` and the Earlier tab show it whole, so no reader's words are lost. Written into
[feedback.md](../project/feedback.md). Sending the whole body as a text attachment when it is long
is the fix if Sentry's copy matters; not built here, put to the Overseer as a recommendation.

## Review

GPT Sol's plan review: [261007j-feedback-20k-plan-review-sol.md](261007j-feedback-20k-plan-review-sol.md).
P1 (the Earlier tab) became item 4; P2 (a fixed 15,300-character "past the cap" fixture that would
have become legal, and the largest-request test still built on the legacy shape) is in the tests
below; P3 (stale prose in dictation.md and the comments) is fixed.

## Tests (red first)

- feedback-store: a body of exactly 20,000 is stored; 20,001 is refused by the CHECK (red against
  the old CHECK).
- feedback-route: `MAX_FEEDBACK_ANSWER_CHARS` is 20,000 and a body of that length is accepted end
  to end (red against 12,000).
- feedback-route: the past-the-cap fixture is built from the constant; the largest-request test
  runs for both shapes, the one box at 20,000 escaped characters now being the larger.
- feedback-route: fifty reports at the cap in control characters come back as a fitting prefix
  with `more` true, every body whole (red before the route cut).
- feedback-dialog: a short page with `more` shows "Showing the N most recent", N its length (red
  against the old validator, which refused it as malformed).
- admin-feedback-store: with reports whose bodies sum past the byte budget, a page stops early with
  `hasMore` true and a cursor at its last row, and walking every page returns every report exactly
  once (red against count-only paging).

## Passed over

- **Shrinking the default page to 100** instead of paging by size: simpler, but it is still a count
  standing in for a size, and `?limit=500` would still overflow.
- **Paging by size in SQL** (a window `sum(length(body))`): bounds characters, not encoded bytes,
  and the JSON of the rest of the row would still be unbounded in principle. Measuring the report
  as it will be sent is the honest number, and the rows are already in memory.

## Checked in a browser

A Sonnet subagent on the box, Playwright, at 1440×900, 820×1180 and 390×844: 19,999 characters,
no line and Send on; 20,001, *"20001 characters — the limit is 20000."*, Send off and all 20,001
still in the box; the Earlier tab renders; no console errors, no horizontal overflow. Nothing was
sent. Shots: [1440](261007j-shot-1440-over-limit.png), [820](261007j-shot-820-over-limit.png),
[390](261007j-shot-390-over-limit.png). The Earlier tab's size cut was not reachable with real
data (36 short reports); the route test covers it.

GPT Sol's code review: [261007j-feedback-20k-code-review-sol.md](261007j-feedback-20k-code-review-sol.md)
— no correctness defects; it rejected an over-fifty page whatever `more` says, added the UTF-8,
escaped and tied-timestamp paging cases, and corrected a comment. Its database tests could not run
in its sandbox and were rerun here: 400 passed.

## Merging 261007d

A sibling (261007d, the Earlier tab says what became of each report) landed on `dev` while this was
built, and two parts of it lean on `MAX_FEEDBACK_ANSWER_CHARS`:

- **An admin's reply to a question** is capped by that constant in the box and the route, and by a
  CHECK of 12,000 on `feedback_question_answers.body`. Raised to 20,000, the route would take what
  the column refuses, and a long reply would come back as a database error. The migration (now
  `20261007094018`, regenerated after the merge) widens that CHECK too; 261007d's own
  exact-the-cap test went red on the merge and green with it.
- **`/api/admin/feedback/earlier`** returns up to fifty whole bodies, like the reader's list, so it
  takes the same `prefixWithinBytes` cut (a route test, seen red without it). The shared client
  validator, `readEnvelope`, carries the short-page rule for both.
