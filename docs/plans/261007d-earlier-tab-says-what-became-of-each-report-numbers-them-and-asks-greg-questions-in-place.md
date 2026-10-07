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
                                                                 GET /api/feedback  ───────▶ Earlier tab:
                                                                                             status, #number,
                                                                                             comment, question
                                                                 POST /api/feedback ◀─────── reply box (+ mic)
                                                                 feedback row, answers = q-…
   feedback-unswept.ts  ◀── read-only, as today ─────────────────┘
   (the answer is an admin's report like any other: provenance proven, queued, dispatched)
```

**Agent to Greg goes through git and the deploy; Greg to agent is an ordinary feedback row.** No
new credential, no new endpoint outside the user gate, no agent write to production. The cost is
latency: a question appears in the dialog only once the commit carrying it has been deployed
(the Overseer deploys ready work from `dev` on its own, usually within hours).

## Decisions, and the simpler option passed over each time

1. **Four statuses, derived, no new ending.** `shipped` · `open` (no note yet: new or in hand) ·
   `waiting` (a note says `awaiting`; shown as *Needs a decision*) · `aside` (a note says
   `declined`, or an admin pressed Ignore; shown as *Set aside*). Precedence when several hold:
   shipped, then waiting, then aside, then open. Pills: **All · Open · Needs a decision · Set aside
   · Shipped**, each with its count.
   *Passed over:* a new `deferred` ending in the notes. "Every report ends in exactly one of three"
   is load-bearing for the sweep, the shipped email and `feedback-unswept.ts`; a fourth ending
   touches all of them, and what Greg described as deferred is today either *awaiting* (needs him)
   or *shipped with a half queued*. The comment line covers the second (decision 2).
   *Passed over:* separate pills for declined and ignored. Greg said "deferred or ignored, or maybe
   even both"; one pill with the reason on each row answers "why is this still here" with fewer
   controls. Easy to split later.
2. **A `comment:` line in the note header**, one line, at most 240 characters, plain text: why it
   was set aside, what the open question is, or what half is still queued. Compiled into the
   generated module beside the ending and shown under the report. Several notes for one report: the
   comment of the note whose ending decided the combined ending, newest file name first.
   **Shown to admins only in this version.** An agent's sentence about a stranger's report, shown
   to that stranger unreviewed, is a published sentence, and those are Greg's
   ([overseer.md](../project/overseer.md)); a declined abuse report's note is exactly where a
   comment could say too much. Readers get the four statuses, which say nothing a note does not
   already decide. Whether readers should see comments is Question 2 below.
3. **A number for every report, stored.** A new column `feedback.number`, an integer from a
   Postgres sequence, unique across all owners, backfilled in the order the reports were filed.
   Shown as `#212` at the start of the row's meta line; said as "feedback 212".
   `feedback-unswept.ts --show` and `feedback-reporter.ts --report-id` accept `212` or `#212` as
   well as the `spya-` id, and print the number.
   *Passed over:* a rank computed per owner (`row_number()` by filing time), with no schema change.
   It is not unique across owners, which is the ambiguity `feedback-reports.md` already warns about
   for `spya-` ids, and it renumbers every later report if a row is ever deleted (an account
   deletion cascades). A number said in conversation has to mean the same report next month.
   *Cost named:* a reader sees a global number, so can infer roughly how many reports exist
   (about 500 today). Accepted for a beta; said here so it is decided rather than inherited.
   *Passed over:* showing the six characters of the existing id. Not sayable.
4. **A question is a file**, `docs/user-feedback/questions/q-<6 chars>.md`, with a header
   (`id`, `report: spya-…|none`, `status: open|answered`, `asked: <ISO date>`, `title:` one line)
   and a plain-text body written to
   [ask-me-questions.md](../reusable/ask-me-questions.md)'s shape. `scripts/feedback-endings.ts`
   compiles open ones into `src/feedback-questions.generated.ts`. A body cap (4,000 characters)
   keeps the bundle and the screen honest.
   *Passed over:* the question as the note's `comment:` line. A question Greg can answer needs
   background and options; one line is the shape he has said he cannot answer.
5. **Questions are for admins.** `GET /api/feedback` adds `questions` to its answer only when
   `isAdmin(user.id)`; a non-admin's answer has an empty list and the client draws nothing. A
   question naming a report is drawn under that report; one naming none is drawn at the top of the
   *Needs a decision* view. The count on that pill includes report-free open questions.
6. **The answer is a feedback report with one more column**, `feedback.answers` (text, null, the
   question id). The reply box posts to the existing `POST /api/feedback` with `answers: "q-…"`.
   The server takes that field only from an admin and only when it names a question in the
   generated list; otherwise 400. So the answer inherits everything a report has: owner scoping,
   rate limit, the Sentry copy, provenance by `feedback-reporter.ts`, and the sweep, which already
   treats an admin's report as trusted input. `feedback-unswept.ts` prints `answers q-…` on the
   line and in `--show`, with the question's title.
   In the dialog a question with an answer row reads *Answered · <time>* with Greg's words under
   it, and can be answered again (a second row; the newest is shown). The agent that acts on the
   answer sets the file to `status: answered`, and the question leaves the list at the next deploy.
   *Passed over:* a `feedback_answers` table. A second store for words Greg typed into the same
   dialog, with its own route, isolation test and sweep.
7. **Dictation on the reply box** is a second `useDictationField` with its own keeper name, one
   reply box open at a time (the others show a *Reply* button), stopped on tab change and close
   exactly as Write's is.
8. **An old tab during the deploy.** The server keeps answering `?show=unshipped` and keeps sending
   `shipped` and `counts.unshipped` if the old client's validator tolerates the added fields; if it
   does not, the old tab's Earlier list says *Try again* until reload, which the beta's licence
   covers. The builder checks which and writes it here.

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
2. **Should a reader who is not an admin see the comment on their own report?** Today (as built)
   they see only the status: *Open*, *Needs a decision*, *Set aside*, *Shipped*.
   (a) Leave it: admins only. Nothing an agent wrote reaches a stranger unreviewed.
   (b) Show it to the report's owner. A reader learns *why* their suggestion was set aside, which
   is kinder; the risk is an agent's sentence that is curt, internal, or says more than it should
   about an abuse report. Would want a rule that a comment is written for the reader, and
   `/admin/feedback` showing every comment so Greg can read them.
   Recommended: (a) until comments have been read for a few weeks, then (b).

Both go on `awaiting-approval.md`, and, once this ships, into `questions/` as the first two files
that are not tied to a single report's ending.

## Stages

### Stage 1 — statuses, comments and numbers (`spya-cnbv8f`)

- [ ] Tests first, red: `tests/feedback-endings.test.ts` (the `comment` field, its cap, the
      combining rule), `tests/feedback-route.test.ts` (status per report, `?show=` for each
      status, counts, comment present for an admin and absent otherwise),
      `tests/feedback-store.test.ts` (status precedence in SQL including `ignored_at`; `number`
      assigned on insert, unique, and backfilled in filing order),
      `tests/feedback-dialog.test.tsx` (five pills, the status word, `#number`, the comment).
- [ ] `scripts/feedback-endings.ts`: `comment` in `HEADER_FIELDS`; the generated module becomes
      `Record<string, { ending, comment? }>`; fix `REPORT_ID` to the real id rule (`src/ids.ts`).
      Every consumer of the generated map updated (`src/feedback-ending.ts`,
      `scripts/feedback-shipped-emails.ts`, `scripts/feedback-unswept.ts`).
- [ ] Migration (hand-written, `npm run db:generate -- --custom --name feedback_number`): add
      `number`, backfill by `(created_at, owner_id, id)`, then the sequence default, `not null`
      and a unique index. Applied locally only; production gets it from the deploy.
- [ ] Store and route: `listMine` selects `number` and computes the status from the three id
      lists and `ignored_at`; counts for every status in the same snapshot.
- [ ] Wire types (`EarlierFeedback.status`, `number`, `comment?`), the strict client validator,
      `EarlierFilter`, `EarlierList`, CSS.
- [ ] Scripts: `--show` and `--report-id` take a number.
- [ ] Add `comment:` to the existing declined and awaiting notes (12 notes) and to the five
      shipped notes with a half waiting on Greg, from what each note already says.
- [ ] Docs: `feedback.md` (and its stale "fifth field" wording), `feedback-reports.md` § The
      note, `/help` if it describes the tab.
- [ ] Gates: typecheck, the touched suites, doc-links. Sol code review. Commit.

### Stage 2 — needs input (`spya-sshjd2`)

- [ ] Tests first, red: the question header parser and compile (bad id, unknown report, body
      over the cap, answered ones left out); the route (questions for an admin only; `answers`
      refused from a non-admin and for an unknown id); the store (`answers` stored and read back,
      owner-scoped); the dialog (a question under its report, a report-free question, the reply
      box, dictation wiring, answered state).
- [ ] `docs/user-feedback/questions/`, the compile step, `src/feedback-questions.generated.ts`.
- [ ] Migration: `feedback.answers` text null.
- [ ] `POST /api/feedback` takes `answers`; `GET /api/feedback` sends `questions` and each
      one's newest answer.
- [ ] The dialog: question cards, reply box with dictation, answered state.
- [ ] `feedback-unswept.ts` prints `answers q-…` and the title.
- [ ] Seed question files for what is on `awaiting-approval.md` now, from each bullet's own
      words, plus the two questions above.
- [ ] Docs: `feedback-reports.md` (§ Three ways a report ends: *Awaiting Greg* also writes a
      question file; a new short section on asking and on acting on an answer), `feedback.md`,
      `/help`.
- [ ] Gates, Sol code review, a browser pass in a Sonnet subagent, commit.

### Finish

- [ ] Full suite once, `npm run typecheck`, push to `dev`.
- [ ] The note, `feedback-endings.ts`, queue entries for each deferred half, `done qi-ewwnsr85`.

## Deferred, each to get its own queue entry

- The fast path (Question 1).
- Comments shown to readers (Question 2).
- One home for a waiting item: generate `awaiting-approval.md`'s waiting list from `questions/`
  so the two cannot drift.
- Multiple-choice options as buttons in a question card (today: Greg types or says "1A").

## Progress

(nothing yet)
