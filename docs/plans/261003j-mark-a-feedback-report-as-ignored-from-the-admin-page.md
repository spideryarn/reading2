# Mark a feedback report as ignored, from `/admin/feedback`

Up: [plans.md](../project/plans.md) · area docs: [feedback.md](../project/feedback.md),
[feedback-reports.md](../project/feedback-reports.md), [admin.md](../project/admin.md)

Report `spya-g95x4j`, Greg, 2026-10-03 (admin, suggestion):

> I just noticed there's a piece of feedback that hasn't been shipped yet that looks like it's just
> testing. It's like ASDF1, ASDF2. And so I wish I could delete it or mark it as invalid or
> something. Yeah, maybe mark it as invalid, or just remove, you know, mark it as to be ignored. I
> mean, hopefully you'd have figured out anything, but I just wanted to be able to do that. And maybe
> even add an addendum. I think probably one shouldn't be able to change the original feedback, but
> perhaps one can add an extra to it or something. I think that second part is lower priority.
> Anyway, I think we had started to move towards using the version in the database rather than the
> version in Sentry as the source of truth. I think that's probably a good idea. … we're not going
> to get to implementing Linear urgently because right now it doesn't feel necessary. It's working
> pretty well as it is, so maybe this is worth doing in the short run.

## What this is for

Greg can see a report on `/admin/feedback` that is plainly a test, and has no way to tell the
agents that sweep the reports to leave it alone. The sweep (`scripts/feedback-unswept.ts`) lists
every production row that no note and no queue entry names, so a test report is picked up, read,
classified and written up like a real one.

## What gets built (v1)

One fact on the row, one button on the card, one filter in the sweep.

1. **A column, `feedback.ignored_at timestamptz null`.** Null means "not ignored". A timestamp
   rather than a boolean because of the standing rule to store when a thing happened. Additive
   migration, no backfill, no CHECK. The original report is never changed or deleted.
2. **An admin-only write**, `PATCH /api/admin/feedback/:ownerId/:id` with body
   `{ "ignored": true | false }`. It sits under `/api/admin/`, so the existing namespace gate
   refuses everyone who is not an admin before the route table is consulted. Keyed on the pair
   `(owner_id, id)` like the two reads beside it. Ignoring an already-ignored report keeps the
   first timestamp (`coalesce(ignored_at, now())`); `false` sets it back to null. 404 when the pair
   names no row; 400 on a body that is not exactly that shape. Answers `{ report }` in the list
   shape so the card can redraw from the server's word.
3. **The card on `/admin/feedback`** gets a small button, **Ignore**. An ignored card is dimmed,
   says *Ignored 3 minutes ago*, and its button reads **Undo**. Nothing is hidden: the ignored
   card stays in the list where it was, so Greg can see what he ignored and take it back.
   `AdminFeedbackReport` gains `ignoredAt: string | null`.
4. **The sweep leaves ignored rows out.** `feedback-unswept.ts` reads the column, drops ignored rows
   before the coverage check, and says how many it dropped in its summary line, so "nothing listed"
   and "three ignored" stay different sentences. `--show` prints `ignored <timestamp>` on the row's
   line. An ignored report needs no note in `docs/user-feedback/`.
5. **Docs**: feedback.md (the row has one admin-written field), feedback-reports.md § Where the
   queue lives (ignored rows are not listed), admin.md § What it cannot do (the line "Nothing on
   `/admin/users` or `/admin/feedback` writes" becomes false and is corrected), and `/help` is not
   touched because no reader sees any of this.

### The sweep has to survive the gap before the deploy

`feedback-unswept.ts` reads **production**. This code reaches `dev` before the Overseer deploys the
migration, and a plain `select f.ignored_at` against a table without the column fails, which would
turn every sweep into exit 2 until the deploy. The Overseer's own tooling runs to a higher standard
than "briefly broken" (CLAUDE.md, the three standards).

So the script's select must work whether or not the column exists. Proposed: the scoping idiom

```sql
select …, (select ignored_at from (select f.*) as present) as ignored_at
  from spideryarn.feedback as f
 cross join (select null::timestamptz as ignored_at) as absent
```

The inner `ignored_at` resolves to the row's own column when the table has one, and otherwise falls
through to the outer `absent.ignored_at`, which is null. One statement, still inside
`begin read only`. Tested against local Postgres both ways (a temp table without the column, and
the real one). Passed over: `to_jsonb(f)->>'ignored_at'`, which serialises each row's 400 KB
screenshot to read one key; a second `information_schema` query, which breaks the "one select"
contract `readRowsReadOnly` pins; and applying the migration to production myself, which a report
run may not do.

## What is not built, and why

- **Delete.** Greg said "delete … or mark as invalid … or mark it as to be ignored" and settled on
  the mark. A mark can be undone and loses nothing; a delete on production data cannot.
- **One state, not two.** "Invalid" and "ignored" would be two words for one effect (the sweep
  skips it). One nullable timestamp; the button says *Ignore*.
- **The addendum** ("add an extra to it"). Greg called it lower priority. It needs a second table
  or column, a text box, and a decision about whether agents trust it as admin input. Queued as its
  own Overseer queue entry, not built here. [Q-addendum] in the debrief.
- **Linear.** Deferred by Greg on 2026-10-02 and again in this report.
- **The reader's Earlier tab** is unchanged. Ignoring does not change its shipped status, which
  comes from the notes alone. Telling a reader "we ignored this" is a published sentence and a
  separate call.
  [Q-reader-sees-ignored] in the debrief.
- **Sentry.** The Sentry copy of an ignored report stays as it is. The database is the queue.
- **Who ignored it.** Only an admin can, and there is in effect one. No `ignored_by` column.
- **A filter to hide ignored cards.** Dimming is enough at this volume.

## The simpler option passed over

A list of ignored report ids in a checked-in file, read by the sweep. No schema, no route, no UI.
Passed over because the thing Greg asked for is to do it himself, from the page where he saw the
report, without asking an agent to edit a file.

## Stages

One stage; it is small and the pieces are not useful apart.

- schema + migration (`npm run db:generate -- --name feedback_ignored_at`), applied locally
- store: `setFeedbackIgnoredAcrossOwners(ownerId, id, ignored)` in `src/store/pg-admin-feedback.ts`,
  on `AdminStore` in `contracts.ts`, wired in `pg-admin.ts`; `ignoredAt` in `LIST_COLUMNS`
- route in `src/routes.ts`; a body parser beside `parseFeedbackFrom` in `src/types.ts`
- card + hook (`AdminFeedbackList.tsx`, `useAdminFeedback.ts`, `AdminPage.tsx`)
- `scripts/feedback-unswept.ts`
- docs

**Done means**: tests written first and seen red for the store (ignore, idempotent timestamp,
undo, wrong pair is null, two owners sharing an id are not confused, the pinned key set), the route
(403 for a non-admin, 400s, 404, 200), the card (button, dimmed state, undo, failure leaves the
card as it was and says so), and the sweep (ignored row dropped and counted; the select works with
and without the column). `npm test`, `npm run typecheck`, lint on touched files. Browser check by a
Sonnet subagent at desktop, iPad and phone widths. GPT Sol on this plan, then on the code.

## Review and what landed

**Plan review, GPT Sol, 2026-10-03: build with changes; no P0 or P1.** All four taken.

- F1 (P2): `tests/authenticated-api-route-contract.test.ts` pins the route table. GET and PATCH
  now share one named matcher, `ADMIN_FEEDBACK_REPORT_PATTERN`; the contract, its order list and
  the guard-count canary are updated.
- F2 (P2): a Refresh that read the old row could land after the Ignore write and redraw *Ignore*.
  The write moved into `useAdminFeedback` (`setIgnored`) and shares the list's in-flight slot, so
  the two take turns; every Ignore, Refresh and Load older is disabled while either is out. Test:
  *takes turns with Refresh*.
- F3 (P2): `Cache-Control: private, no-store` is set before the store is asked, and the route test
  asserts it on the 200 and the 404.
- F4 (P3): the Earlier-tab sentence above was wrong for a report whose note says shipped. Corrected.

**Code review, GPT Sol, 2026-10-03, on `14e70b90b`: approve the patched candidate.**

- F5 (P1, fixed by Sol, red first): switching Everyone / Readers only during the PATCH remounted
  the inbox, whose fresh GET could read the row before the write committed, while the old hook
  dropped the write's answer. `AdminFeedbackPage` now owns a write guard that outlives the keyed
  inbox, and the filter cannot change until the write settles. Postmortem
  [261003c](../postmortems/261003c-a-mutation-guard-ends-before-the-mutation.md). I read the diff
  and reran the suites; this fix has had no second review.
- F6 (P3): feedback-reports.md said Undo puts a report back in the sweep's list. Only if nothing
  already covers it. Corrected.

**Browser check, Sonnet subagent, on `14e70b90b`**: desktop 1280, iPad 820, phone 390, dark mode.
Ignore, reload, Undo, reload all behaved; no overflow, no console errors. The button is 28px tall,
the same as Refresh and the filter pills beside it. Light mode was not checked. Sol's F5 change
came after this check and only disables the two filter pills during a write.

**The deploy gap, measured.** With this branch's script and production still without the column:
`feedback-unswept.ts --since 2d` answered `93 report(s) … 0 named by no note header…`, exit 0, and
`--show spya-g95x4j` printed the row. `tests/admin-feedback-store.test.ts` runs the same two
statements against a table with the column (set and unset) and a copy without it.

**Mutations seen red**: `coalesce(ignored_at, now())` → `now()` (the idempotent-timestamp test),
and the PATCH's `no-store` line removed (the route test).
