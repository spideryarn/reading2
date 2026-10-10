# An addendum to an earlier feedback report

Up: [feedback.md § What became of each report](../project/feedback.md#what-became-of-each-report-for-an-admin-since-2026-10-07) ·
[feedback-reports.md](../project/feedback-reports.md) · imitates
[261007d](261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md)
stage 2 (the reply box and `feedback_question_answers`) · report `spya-saz0yw` (#541,
SPIDERYARN-READING2-GP) · queue item `qi-7n9nyz3k` · session `fbsaz0yw-addendum-to-earlier-report`

Status as of 2026-10-10: **built and on `dev`.** Plan review: GPT Sol, REVISE, eight findings, all taken (§ What the plan review changed). Code review: GPT Sol, APPROVE-WITH-FIXES (§ What the code review found).

## What Greg asked for

> Make it possible for me to add a reply as a kind of addendum to any earlier open feedback reports.
>
> — Greg, 2026-10-10 (`spya-saz0yw`, filed from /changelog)

An admin's own report, proven by `feedback-reporter.ts` (exit 0), so it is built. The brief that
dispatched this session narrowed it to the simplest version: admin-only, own reports only, and the
sweep and the report's session must see the addendum alongside the original words.

## What it looks like

```
 Earlier ▸ Open                                              (admin's own tab)
 ┌──────────────────────────────────────────────────────────────────────────┐
 │ #541 · 10 Oct · suggestion · on /changelog                               │
 │ Make it possible for me to add a reply as a kind of addendum …           │   reader's face
 │                                                                          │
 │   Added 10 Oct 09:12                                                     │   reader's face,
 │   Actually, only the Open ones — the others have threads already.        │   indented
 │                                                                          │
 │ [ Add to this report ]                                                   │   ▸ opens a box:
 │   ┌────────────────────────────────────────────┐ 🎤                       │     textarea +
 │   │                                            │                         │     microphone
 │   └────────────────────────────────────────────┘                         │
 │   [ Send addendum ]  [ Cancel ]                                          │
 └──────────────────────────────────────────────────────────────────────────┘
```

- **Which reports.** Only those whose status is **Open** — Greg's word, and the name of the pill:
  no note yet, not ignored. *Needs a decision* reports already have a reply box in their question's
  thread; *Shipped* and *Set aside* are finished. Widening it later is a one-word change on each
  side (§ Deferred).
- **Where they show.** Under the report's own words, oldest first, each with its time, in the
  reader's face ([fonts.md](../project/fonts.md)) because they are the reader's words. Shown on any
  of the admin's own reports that has some, whatever its status now (an addendum written while a
  report was open stays visible after it ships).
- **Only in the admin's view.** Every other reader's Earlier tab, `GET /api/feedback`, is
  unchanged. Nothing new on `/admin/feedback` in this version (§ Deferred).

## Design

### The row: a new table, `feedback_addenda` (an additive migration)

Not a column on `feedback` and not a row in `feedback_question_answers`. A reply belongs to a
question (`question_id`, a compiled file); an addendum belongs to a report row. Reusing the answers
table would mean a nullable `question_id` beside a nullable `report_id` — a bag of optionals.

```sql
CREATE TABLE spideryarn.feedback_addenda (
  id          text NOT NULL,            -- browser-minted spya- id, the idempotency key
  owner_id    uuid NOT NULL,
  report_id   text NOT NULL,            -- the feedback row's id
  body        text NOT NULL,
  environment text NOT NULL,            -- which deployment wrote it, as on feedback_question_answers
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, report_id) REFERENCES spideryarn.feedback (owner_id, id) ON DELETE RESTRICT,
  CHECK id format, CHECK report_id format, CHECK environment in (…),
  CHECK length(btrim(body)) > 0 and length(body) <= 1000000
);
-- + owner_fk to auth.users ON DELETE RESTRICT, by hand, as every owner_id has
-- + index (owner_id, report_id) for the listing's lookup
```

**The composite foreign key is what makes "own reports only" a key rather than a good intention**
([sql.md](../project/sql.md)): the row is written under the signed-in owner, so an addendum to a
report id that is not that owner's own fails at the database, not only in the route. Additive:
one new table, nothing existing touched. Greg asked for the feature, so the migration is in scope
(brief); it goes to production with the deploy, as every migration does.

### The route: `POST /api/admin/feedback/addenda`

`{ id, report, body }`, nothing else. Under `/api/admin/`, so the namespace gate has refused
everybody else; the row is the signed-in owner's. Mirrors `/answers` exactly:

- **201** new, **200** the same addendum again (a retry), **409** the id already used for a
  different addendum.
- **404** when the report is not the caller's own (no such row for this owner — the FK, or a read
  before insert; the route never says whether another owner has that id).
- **409** when the report is no longer **Open** (a note has since been deployed, or Ignore was
  pressed): "That report has been closed since this page was loaded." The check uses the same
  `statusOf` expression as the list, inside the same transaction as the insert, so the list and the
  gate cannot disagree. A retry of an addendum already stored is a 200 even if the report has
  closed since (it is the same row).
- Body at most `MAX_FEEDBACK_BODY_CHARS` (20,000), the same cap as a report: an addendum is more of
  the report. Not rate-limited, as the replies are not (admin-only).
- Logs ids and a length, never the words ([logging.md](../project/logging.md)).

### The read: on `GET /api/admin/feedback/earlier`

Each report in the admin's list gains `addenda: { id, body, createdAt }[]`, oldest first. One extra
query for the page's report ids, inside the list's existing read-only snapshot, owner predicate
always present. **The bytes count against `FEEDBACK_LIST_BYTES`** with the report they belong to,
so the 3 MiB budget still holds (a report and its addenda are kept or cut together).

**Two builds at once.** The browser accepts a report with no `addenda` key as having none (an older
server mid-deploy), and then shows no box either, since the route may not exist yet. An older
browser ignores the new key (to be checked: `isAdminEarlierFeedbackPage` must not reject extra
keys). A 404 on the POST says to copy the words, reload and try again, as the reply box's does.

### The box

Reuse, don't copy: the reply box under a question thread already has `useFitTextarea`, its own
`useDictationField`, the "off while it listens" rule, the held-reload guard and the
browser-minted idempotent id. Factor the shared part into one component if it is not one already,
with keeper name `feedback-addendum` for its microphone. One box open at a time; a draft survives
switching pill or thread for the life of the dialog, as the reply box's does. A sent addendum shows
at once and stays shown until a list read started after it lands — the same "what this page did,
before the server knows" rule.

### The agents' side: printed with the report, and listed until something covers it

1. **`feedback-reporter.ts` and `feedback-unswept.ts --show`** print a report's addenda under its
   words, from the production rows in the same read-only transaction, each with its id, time and
   `environment`. A row whose `environment` is not `production` is printed with that word in front
   of it, never silently as Greg's.
2. **`feedback-unswept.ts` lists addenda nothing covers yet**, in their own section after the
   reports: every addendum whose id no note header and no queue item `source` names. This is the
   case that would otherwise be lost: Greg adds to a report that a session is already working on,
   or whose note is committed but not yet deployed (the tab still says Open). An addendum to a
   report that is itself unswept appears in that section too, and on the report's line as
   `+N addenda`, so the sweep queues both ids together.
3. **Coverage is the same structured fields as a report's.** A queue item's `source` naming the
   addendum id covers it (the existing regex already reads every `spya-` id there). A note covers it
   with a new optional header line, `addenda: spya-…, spya-…`, parsed by `parseNoteHeader` with the
   same id rules as `reports:`; it is not compiled into the endings map (an addendum has no ending
   of its own).
4. **The runbook says what to do with one**
   ([feedback-reports.md](../project/feedback-reports.md), not a rule doc): a session re-reads its
   report with `feedback-reporter.ts` before writing the note, and names any addenda in
   `addenda:`; the sweep, finding an uncovered addendum whose report has a live `fb<short-id>`
   session, `SendMessage`s it; otherwise it queues the addendum with both ids in `--source`.

## Stages

1. **Schema, store, route, scripts** (Opus subagent). Migration + `schema.ts`, store method
   `addAddendum` and the read for the list, the route, `addenda` on the admin earlier response with
   its bytes in the budget, `feedback-reporter.ts` / `feedback-unswept.ts` printing and the uncovered
   section, `addenda:` in `parseNoteHeader`. Tests: store (own report only, not-open refused,
   idempotency three ways, owner isolation), route, unswept coverage, header parsing, schema tests
   that already enumerate tables. `npm test`, `npm run typecheck`.
2. **The box in the Earlier tab** (Opus subagent), reusing the reply box. Component tests in the
   style of the existing Earlier tests; then a Sonnet browser check on the box (Playwright on this
   box, [browser-control.md](../project/browser-control.md)).
3. **Docs and bookkeeping.** feedback.md subsection, feedback-reports.md runbook lines, database.md
   if it lists tables; GPT Sol code review (write-capable); push to `dev`; the note for
   `spya-saz0yw`; `feedback-endings.ts`; queue item done.

## Deferred, and why

- **Addenda on *Needs a decision* reports.** Those reports have a reply box in their thread when
  a question exists. If Greg wants it there too, it is widening one status check on each side; the
  coverage listing already handles a report that has ended.
- **Showing addenda on `/admin/feedback`.** The scripts are what agents read; the admin page is a
  second viewer. Add it if Greg asks.
- **Other readers adding to their own reports.** Admin-only first, as the brief says; the table
  and route are owner-scoped already, so widening is the route's namespace and a rate limit.
- **Editing or deleting an addendum.** Rows here are never deleted, as with replies.
- **Sentry copy, email to the admin.** An addendum is not a report: never in Sentry, the endings
  map, a shipped email or the rate cap.

## The simpler option passed over

**Just send a new report that says "re #212: …".** It needs nothing built, and the sweep already
reads it. Passed over because nothing ties it to the report: a session already working on #212
never hears about it, the sweep has to spot the reference by reading free text, and the Earlier tab
shows two unrelated reports. Greg asked for it to be *on* the earlier report.

A second simpler option: **no uncovered-addenda listing**, only print addenda with the report.
Passed over because the addendum Greg most needs seen is the one he writes after the sweep has
already taken the report — exactly the case printing-with-the-report misses, silently.

## What the plan review changed

GPT Sol, [261010o-addendum-plan-review-sol.md](261010o-addendum-plan-review-sol.md), REVISE. All
eight taken; where they contradict the sections above, this section wins.

- **F1 (P1) Bounded addenda.** All of one report's addenda together are at most
  `MAX_FEEDBACK_BODY_CHARS` (20,000) characters, checked under the parent row's lock, so a report
  plus its addenda is at most twice a report and `prefixWithinBytes`'s "always keeps the first
  item" stays bounded. Past it, 409 *"This report has as much added to it as it can take."* Test:
  the largest permitted report-plus-addenda item.
- **F2 (P1) Typed coverage.** Addenda coverage is its own set, never the report set. A note says
  `addenda: spya-…`; a queue item's `source` says `addendum:spya-…` (the prefix is required; a bare
  `spya-` there only ever covers a report). An addendum id shared by two owners is listed as
  ambiguous, as a report id is. Tests: an addendum whose id equals its parent's, and a duplicate id
  across owners.
- **F3 (P1) The race, closed properly.** In one transaction: an existing row under this id is the
  idempotent answer (200 / 409); otherwise `select … for update` the owner's parent row — none is a
  404 ("no such report of yours", never whether another owner has it); then `statusOf` on that row
  — closed is a 409; then the aggregate check; then the insert. Ignore's update waits on the lock.
- **F4 (P1) Scripts before the deploy.** `feedback-reporter.ts` and `feedback-unswept.ts` probe
  `to_regclass('spideryarn.feedback_addenda')` in their read-only transaction, as
  `feedback-questions.ts` does for replies, and say *addenda: not deployed* and carry on.
- **F5 (P1) Everything keyed by report.** Drafts, retry ids, local receipts and the dictation keeper
  (`feedback-addendum:${report.id}`), as replies are keyed by question.
- **F6 (P1) The handoff, mechanically.** `feedback-unswept.ts` prints, for each uncovered addendum,
  the parent's number and id and, when a queue item covers the parent, that item's id and its
  `dispatchedTo` session. The sweep sends the addendum there and covers it only on an
  acknowledgement; otherwise it queues `addendum:spya-…` with the parent's id for the next agent.
- **F7 (P2) Request bytes.** The route reads with the answers route's six-bytes-a-character
  envelope limit; test a maximum-length, heavily escaped body.
- **F8 (P2) Which statuses.** **Open and Needs a decision** — every report that has not been shipped
  or set aside. The premise for leaving *Needs a decision* out was wrong: some waiting reports have
  no question, and a reply to a question is not more of the report. This replaces "Open only" above
  and the first deferred item.

## What landed

- **Stage 1** (`76424a883`): `feedback_addenda` (migration `drizzle/20261010235243_feedback_addenda.sql`, restamped after a merge put `20261010221230_command_suggestion_dismissals` ahead of it),
  `submitAddendum`, `POST /api/admin/feedback/addenda`, `addenda` on the admin Earlier list, and the
  scripts. One deviation: the store looks for an existing row twice, before and after taking the
  parent's lock, so four concurrent copies of one retry are one created and three duplicates rather
  than a false "full".
- **Stage 2** (`7b1e0b2be`): the reply box's shared parts moved to `src/web/FeedbackSendBox.tsx`,
  used by the reply box and the new `AddendumBox` (`src/web/FeedbackAddendum.tsx`). Deviations: a
  box holding words stays open whatever else is opened, even after its report closes, so a draft is
  never a reload hold nobody can see; *Cancel* throws the words away; the box unmounts on a pill
  change (the draft is kept in the hook, and an interrupted recording is offered back by its
  per-report keeper, which the code review checked).

## What the code review found

GPT Sol, [261010o-addendum-code-review-sol.md](261010o-addendum-code-review-sol.md),
APPROVE-WITH-FIXES.

- **C1 (P1), fixed by the reviewer**: the uncovered-addenda line found the parent's queue item by
  report id alone, and report ids are unique only per owner, so a collision could name another
  reader's session. The line now says when the parent id is shared and names no session.
- **C2 (P2), reported, not fixed here**: the compiled endings map is keyed by report id alone, so
  two owners sharing an id would share a status, and the addendum gate would follow it. It is the
  existing endings format's limit, older than this work, and needs a six-character browser-minted
  id to collide between two owners; widening the format is its own change. Not queued: the
  existing `feedback-unswept.ts` already lists every id two owners share as ambiguous.
