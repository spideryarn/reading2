# An addendum to an earlier feedback report

Up: [feedback.md § What became of each report](../project/feedback.md#what-became-of-each-report-for-an-admin-since-2026-10-07) ·
[feedback-reports.md](../project/feedback-reports.md) · imitates
[261007d](261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md)
stage 2 (the reply box and `feedback_question_answers`) · report `spya-saz0yw` (#541,
SPIDERYARN-READING2-GP) · queue item `qi-7n9nyz3k` · session `fbsaz0yw-addendum-to-earlier-report`

Status as of 2026-10-10: **plan, before review.**

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
