# The Earlier tab says what became of each report, numbers them, and asks Greg questions in place

Up: [feedback.md](../project/feedback.md) · [feedback-reports.md](../project/feedback-reports.md) ·
reports `spya-cnbv8f` and `spya-sshjd2` (SPIDERYARN-READING2-E2, -E3) · queue item `qi-ewwnsr85` ·
session and worktree `fbcnbv8f-earlier-tab-deferred-and-ask`

Status as of 2026-10-07: **planned, not built** — evidence: no hit for `feedback-questions` or
`EarlierFeedbackStatus` under `src/`.

## What Greg asked for

Both reports are an admin's (`feedback-reporter.ts` exit 0 on each production row).

> When I look in feedback earlier, not shipped, there's still quite a few listed. Some of them are
> very new, so I'm sure you'll get to them. But some of them are older, and I'm assuming that's
> because maybe you've decided not to, or you're deferring them, or you think the complexity doesn't
> merit the value. Okay, that's fine. But let's give you another category for deferred or ignored,
> or maybe even both. Perhaps with the— and what I'd like would be for you to write some kind of
> comment that would indicate why you deferred them, or what the question was, or something like
> that. And maybe you could give every single feedback report its own ID somehow, so that it would
> be easy for us to refer to them in conversation.
>
> — Greg, 2026-10-06 (`spya-cnbv8f`)

> I had a follow-up thought around feedback. Perhaps you could even find some way of signalling when
> you need input from me. So perhaps there'd be a way to categorize feedback reports as needing
> input, and you'd show my report and then their question from you, and then some kind of input box
> with a voice dictation button, so that if there are things that are blocking your ability to act
> on a feedback report, you can ask me inside the feedback dialogue on Spideryarn, and I can respond
> there. Of course, there'll be some things that will need me to open up our conversation, but
> hopefully fewer and fewer actually over time. And in fact, it should be possible for you to ask my
> input on things that aren't tied specifically to a feedback report. So you could ask me questions
> about anything in that needs input section.
>
> If there are any other minor improvements you want to make to this idea, go for it.
>
> — Greg, 2026-10-06 (`spya-sshjd2`)

## Where things stand today

- The Earlier tab's rows carry one boolean, `shipped`. *Not shipped* is everything else: a report
  nobody has reached, one whose note says `declined`, one whose note says `awaiting`, and one an
  admin marked Ignore on `/admin/feedback`. The three-way ending is in
  `src/feedback-endings.generated.ts` already and never leaves the server
  (`src/feedback-ending.ts`).
- A report's id (`spya-cnbv8f`) is shown nowhere in the tab, is not sayable, and is unique only per
  owner.
- A question for Greg lives in a plan doc and one bullet of
  [`awaiting-approval.md`](../user-feedback/awaiting-approval.md). He answers it in a Claude
  conversation.
- **Nothing an unattended agent runs may write to production**, and nothing reaches production from
  an agent except a deploy. That is the constraint stage 2 is designed around.

## The design in one picture

```
   agent                      git (dev)                 production                    Greg
   ─────                      ─────────                 ──────────                    ────
   note header  ───────────▶  docs/user-feedback/*.md
     ending:, comment:           │  feedback-endings.ts
   question file ──────────▶  docs/user-feedback/questions/q-….md
                                 │  (compiled to *.generated.ts)
                                 └──── the Overseer's deploy ──▶ server imports them
                                                  GET  /api/admin/feedback/earlier ───────▶ Earlier tab:
                                                                                             status, #number,
                                                                                             comment, questions
                                                  POST /api/admin/feedback/answers ◀─────── reply box (+ mic)
                                                  row in feedback_question_answers
   feedback-questions.ts --answers  ◀── read-only, like feedback-unswept ──┘
```

**Agent to Greg goes through git and the deploy; Greg to agent is a row he writes himself, which
an agent reads.** No new credential, no endpoint outside the user gate, no agent write to
production, and no admin check outside the `/api/admin/` prefix gate. The cost is latency: a
question appears in the dialog only once the commit carrying it has been deployed (the Overseer
deploys ready work from `dev` on its own, usually within hours).

## Decisions, and the simpler option passed over each time

Revised after GPT Sol's plan review (§ What the plan review changed).

1. **All of this is an admin's view; other readers' Earlier tab does not change.** Both reports
   are Greg's, about his own list. `GET /api/feedback` and `POST /api/feedback` are not edited.
   A non-admin keeps **All · Shipped · Not shipped**, and receives no `ignored_at`, no
   declined/awaiting distinction, no number, no comment and no question. `feedback.md` says today
   that Ignore changes nothing a reader sees, and that stays true. Showing richer outcomes to
   every report's owner is a product decision for Greg (Question 2).
2. **Everything new is under `/api/admin/feedback/…`**, rows in the existing authenticated route
   table behind the unchanged prefix gate ([admin.md](../project/admin.md): the namespace check is
   the whole server-side admin gate). No handler calls `isAdmin` to authorise. The builder does
   not edit `requireUser`, `serveAuthenticatedApi`'s namespace check, or any other listed defence.
   The client picks the route from its cosmetic `isAdmin`; picking wrong gets a 403, not data.
   - `GET /api/admin/feedback/earlier?show=all|open|waiting|aside|shipped` — the signed-in
     admin's **own** reports (owner-scoped in the store exactly as `listMine` is), each with
     `number`, `status`, `comment`; `counts` per status; `more`; and `questions` (every open
     question, each with its newest answer if any).
   - `POST /api/admin/feedback/answers` — `{ id, question, body }`.

   If the admin route answers 404 (new client, old server, or a rollback) the client falls back
   to the plain `/api/feedback` list and three pills. An old client with a new server is
   untouched, because the route it calls is.
3. **Four statuses, derived, no new ending.** `shipped` when the combined ending is shipped;
   otherwise `aside` (shown *Set aside*) when `ignored_at` is set or the ending is declined;
   otherwise `waiting` (shown *Needs a decision*) when the ending is awaiting; otherwise `open`
   (no note yet: new or in hand). An ignored report cannot still demand a decision, which matches
   `feedback-unswept.ts` dropping it. Pills: **All · Open · Needs a decision · Set aside ·
   Shipped**. **Pill counts are report counts** and sum to All.
   *Passed over:* a `deferred` ending in the notes. "Every report ends in exactly one of three"
   is load-bearing for the sweep, the shipped email and `feedback-unswept.ts`; what Greg described
   as deferred is today either *awaiting* or *shipped with a half queued*, and the comment line
   covers the second.
   *Passed over:* separate pills for declined and ignored. Greg said "deferred or ignored, or
   maybe even both"; one pill with the reason on each row has fewer controls and splits easily
   later.
4. **A `comment:` line in the note header**, one line, at most 240 characters, plain text: why it
   was set aside, what the open question is, or what half is still queued. Compiled into the
   generated module beside the ending. Which note's comment, for a report with several: the
   newest note that says `awaiting`; otherwise, when there are fewer notes than `parts`, the
   newest note declaring the largest `parts`; otherwise the newest `shipped` note when the result
   is shipped; otherwise the newest `declined` note. An ignored report with no comment shows the
   fixed line *Set aside on /admin/feedback, <date>*. The generated files are imported by server
   code only; a test asserts no module under `src/web/` imports them.
5. **A number for every report, stored.** A new column `feedback.number`, an integer from a
   Postgres sequence, unique across all owners, backfilled in the order the reports were filed.
   Shown as `#212` at the start of the row's meta line; said as "feedback 212".
   `feedback-unswept.ts --show` and `feedback-reporter.ts --report-id` accept `212` or `#212` as
   well as the `spya-` id, and print the number.
   The migration: create the sequence; backfill in `(created_at, owner_id, id)` order consuming
   `nextval`; attach the default; `not null`; unique index. Drizzle applies it in one transaction,
   so no live insert lands between statements, and unchanged pre-deploy code inserting afterwards
   gets the next number from the default (tested).
   **The production-reading scripts run from `dev` before the deploy**, so they read the column
   absent-safely (`to_jsonb(f)->>'number'`, as `ignored_at` already is) and a numeric lookup
   before the deploy says *numbering is not deployed yet* rather than failing every lookup.
   *Passed over:* a rank computed per owner, with no schema change. Not unique across owners
   (the ambiguity `feedback-reports.md` already warns about for `spya-` ids), and it renumbers
   every later report if a row is ever deleted. A number said in conversation has to mean the
   same report next month.
6. **A question is a file, and the file is the only live record.**
   `docs/user-feedback/questions/q-<6 chars>.md`: a header (`id`, `report: spya-…|none`,
   `status: open|answered`, `asked: <date>`, `title:` one line, `refs:` one line for agents —
   queue item, plan doc, note, Sentry id — not sent to the browser) and a plain-text body, at most
   4,000 characters, written to [ask-me-questions.md](../reusable/ask-me-questions.md)'s shape.
   `scripts/feedback-endings.ts` compiles the open ones into
   `src/feedback-questions.generated.ts`.
   **`awaiting-approval.md`'s *Waiting on Greg now* list moves into these files** and the section
   becomes a signpost to the directory; its other sections (attempted abuse, the answered
   history) stay. `feedback-reports.md` is updated so the sweep reads the directory. One home.
   *Passed over:* the question as the note's `comment:` line. A question Greg can answer needs
   background and options.
7. **The *Needs a decision* view starts with every open question**, whether or not it names a
   report, each under its title with the report's `#number` and first line when it has one, and
   says "N open questions" beside the pill's report count. A question's report may itself be
   Shipped (a deferred half); the question shows regardless. Report status and question status
   are separate facts.
8. **An answer is a row in a new table, `feedback_question_answers`**: `(owner_id, id)` primary
   key with the id minted by the browser as a feedback id is (so a retried POST is idempotent),
   `question_id`, `body` (same cap as a report's), `created_at`. Written only by the admin POST,
   after checking the question id is in the generated list. It never enters the Earlier report
   list, `/admin/feedback`, Sentry, the endings map or the shipped email.
   The dialog shows *Answered · <time>* and Greg's words under the question, with *Reply again*.
   `npx tsx scripts/feedback-questions.ts --answers` reads production read-only (the same
   guarded client as `feedback-unswept.ts`), keeps only rows whose owner `isAdmin`, and prints
   every answer whose question file is still `status: open`. The sweep runs it each time; the
   agent that acts on an answer sets the file to `status: answered` with the answer quoted, and
   the question leaves the dialog at the next deploy.
   *Passed over (my first design, refused in review):* the answer as a `feedback` row with an
   `answers` column. It would have appeared as a second Open report, in `/admin/feedback` and in
   Sentry, and started a second report workflow.
9. **Dictation on the reply box** is a second `useDictationField` with its own keeper name, one
   reply box open at a time (the others show a *Reply* button), stopped on tab change and close
   exactly as Write's is.

## What an unattended run may not build: the fast path

Written up for Greg; nothing below is built. The route above has one weakness: a question waits
for a deploy. Making it instant needs an agent to write into production directly, and both ways of
doing that are outside what this run may do.

- **Option A — keep what is built (recommended for now).** Questions ride the deploy. No new
  credential. Delay: until the next deploy, typically hours.
- **Option B — a token endpoint.** `POST /api/agent/questions`, called by an agent with a secret,
  inserting a row into a new `questions` table. Instant. It would be the third thing dispatched
  before the sign-in gate (after the public read-only namespace and the Stripe webhook), the first
  non-Stripe write with no reader behind it, and a new secret that every pool-account session
  would hold. Whoever holds it can put words in front of Greg under the product's own name. It
  edits the gate, a listed defence.
- **Option C — the Overseer writes the row.** Sessions still write a file; the Overseer, which
  already holds production credentials for the deploy, copies open questions into production on
  its own tick, between deploys. No new endpoint and no secret on pool accounts, but it is a
  standing production write by an agent, and a second home for each question.

What would decide: if, after a week of use, questions regularly sit undeployed for longer than
Greg would have waited, C is the smaller step. B buys nothing C does not.

## Questions for Greg

1. **Is a wait until the next deploy acceptable for a question to appear?** Options A, B, C above.
   Recommended: A now, C if the wait bites.
2. **Should other readers get the richer Earlier tab too?** As built, only an admin sees the four
   statuses, the number and the comment; everyone else still sees *Shipped* or *Not shipped*.
   (a) Leave it. Nothing an agent wrote, and nothing about Ignore, reaches a stranger.
   (b) Statuses and number for everyone, comments still admin-only. A reader learns their
   suggestion was set aside rather than wondering; it also tells them when an admin pressed
   Ignore, which today is invisible to them by design.
   (c) Comments too. Kinder still; the risk is an agent's sentence that is curt, internal, or
   says more than it should about an abuse report. Would want a rule that a comment is written
   for the reader, and `/admin/feedback` showing every comment so Greg can read them.
   Recommended: (a) until Greg has read a few weeks of comments, then (b) or (c).

Both become question files in stage 2, which is where a waiting item now lives.

## What the plan review changed

GPT Sol refused the first draft (`261007d-…-plan-review-sol.md`, F1 to F11). All eleven accepted:
F1 no `isAdmin` branch in the ordinary feedback routes, everything under `/api/admin/`; F2 answers
in their own table, not as feedback rows; F3 questions listed whatever their report's status;
F4 non-admins unchanged; F5 ignored outranks awaiting; F6 the backfill consumes the sequence;
F7 scripts read new columns absent-safely; F8 question files replace the waiting list rather than
copying it; F9 pill counts stay report counts; F10 the comment rule for an incomplete split
report; F11 the skew that matters is new client on old server, handled by the 404 fallback.

**Round two** (`261007d-…-plan-review-sol-r2.md`) closed nine of the eleven and added four. All
six accepted, and **they amend the decisions above where they differ**:

- **F7, the rest.** `feedback-questions.ts --answers` run before the answers table is deployed
  says *answers are not deployed yet* and exits 0 with none, having checked the table is absent
  rather than assumed it; any other read failure is exit 2.
- **F11, the rest.** A reply whose POST gets a 404 keeps the typed words in the box and says to
  reload and try again.
- **F12.** The sweep's real instructions are `scripts/overseer-tools/prompt-feedback-sweep.md`.
  It is updated in stage 2: read every open question file, run `--answers` (exit 2 stops the
  sweep; it is not "no answers"), keep reading `awaiting-approval.md` only for attempted abuse
  and history, and debrief open questions and new answer ids.
- **F13.** The answers table also stores a server-authored `environment`, from the same closed
  mapping as a feedback report's, never from the POST body. The script uses `productionClient()`,
  prints `Target:`, reads inside `begin read only`, and treats as Greg's only a row whose owner
  `isAdmin` **and** whose environment is `production` or `preview`. Anything else is exit 2.
- **F14.** A late reply must not be lost. Every question id is compiled with its status; the GET
  sends only open ones; the POST accepts a reply to any known id. A question file records the
  ids of the answers already acted on (`acted:` in its header), and `--answers` prints every
  provenance-checked answer whose id is not recorded there, whatever the question's status.
- **F15.** A new answer id returns 201. The same owner, id, question and body again returns the
  stored row and 200. The same id with a different question or body returns 409 and changes
  nothing.

Discovery on the plan is closed after two rounds; the code reviews check these as built.

## Stages

### Stage 1 — statuses, comments and numbers (`spya-cnbv8f`)

- [ ] Tests first, red: `tests/feedback-endings.test.ts` (`comment`, its cap, the selection rule
      including a lone `ending: shipped, parts: 2` note); the admin route (status per report,
      each `?show=`, counts summing to All, 403 for a non-admin, owner scoping);
      `tests/feedback-store.test.ts` (status in SQL including `ignored_at` over `awaiting`;
      `number` assigned by the default, unique, backfilled in filing order);
      `tests/authenticated-api-route-contract.test.ts` (the new rows);
      `tests/feedback-dialog.test.tsx` (an admin gets five pills, the status word, `#number`, the
      comment; a non-admin's tab is unchanged; a 404 from the admin route falls back).
- [ ] `scripts/feedback-endings.ts`: `comment` in `HEADER_FIELDS`; the generated module carries
      it; `REPORT_ID` fixed to the real id rule (`src/ids.ts`). Every consumer of the generated
      map updated (`src/feedback-ending.ts`, `scripts/feedback-shipped-emails.ts`, which reads
      the file at a commit and so must read both shapes, `scripts/feedback-unswept.ts`).
- [ ] Migration `feedback_number` (hand-written, `npm run db:generate -- --custom`). Applied
      locally only; production gets it from the deploy.
- [ ] Store, route, wire types, client, CSS.
- [ ] Scripts: `--show` and `--report-id` take a number, absent-safe.
- [ ] `comment:` on the existing declined and awaiting notes and on the shipped notes with a half
      waiting on Greg, from what each note already says.
- [ ] Docs: `feedback.md` (and its stale "fifth field" wording), `feedback-reports.md` § The
      note, `admin.md`, `/help` if it describes the tab.
- [ ] Gates: typecheck, the touched suites, doc-links. Sol code review. Commit.

### Stage 2 — needs input (`spya-sshjd2`)

- [ ] Tests first, red: the question parser and compile (bad id, unknown field, body over the
      cap, answered ones left out, `refs` not in the wire shape); the routes (questions and
      answers for an admin, 403 otherwise, an unknown question id refused, a retried POST
      idempotent); the store (answers owner-scoped; `tests/owner-isolation.test.ts`); the dialog
      (questions first in *Needs a decision*, a linked report's number, the reply box, dictation
      wiring, answered state); the script (non-admin rows dropped, answered files dropped).
- [ ] `docs/user-feedback/questions/`, the compile step, `src/feedback-questions.generated.ts`.
- [ ] Migration: `feedback_question_answers`, with the app role's grants checked against
      `database.md`.
- [ ] Route, store, dialog, `scripts/feedback-questions.ts`.
- [ ] Move *Waiting on Greg now* into question files, each bullet's own words reshaped only as
      far as ask-me-questions.md needs, plus the two questions below; the section becomes a
      signpost.
- [ ] Docs: `feedback-reports.md` (*Awaiting Greg* writes a question file; a short section on
      asking and on acting on an answer; the sweep reads the directory and runs `--answers`),
      `feedback.md`, `admin.md`, `overseer.md` only where it names `awaiting-approval.md` as a
      signpost, `/help`.
- [ ] Gates, Sol code review, a browser pass in a Sonnet subagent, commit.

### Finish

- [ ] Full suite once, `npm run typecheck`, push to `dev`.
- [ ] The note, `feedback-endings.ts`, queue entries for each deferred half, `done qi-ewwnsr85`.

## Deferred, each to get its own queue entry

- The fast path (Question 1).
- The richer tab for other readers (Question 2).
- Multiple-choice options as buttons in a question card (today: Greg types or says "1A").

## Progress

(nothing yet)
