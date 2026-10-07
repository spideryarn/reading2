# Seventh codebase sweep: depth, with the second model family

**Status: investigations done and cross-reviewed, 2026-10-06; clusters being built. § What landed is
filled in as each does.**

A follow-on to the [sixth sweep](261006j-sixth-codebase-sweep-umbrella.md), which ran no depth stage
and whose second-family breadth pass was, in its own words, "a weak null, not a clean bill". This
one is the depth stage of [improve-the-codebase.md](../reusable/improve-the-codebase.md): four zones,
each read file by file by GPT Sol and by Opus independently, each doc then reviewed by the other
family.

What it is for, in Greg's words (2026-10-06):

> When the box calms down is a good moment to potentially go broader and deeper on that, i.e. look
> for other areas that could be improved/tidied up/refactored/etc, both in the codebase and the UI
> and anywhere else, and kick off one or more agents to try and get things into good shape before
> the next round of development.
>
> If it's consequential, requires tradeoffs, product decisions, or is hard to reverse, etc, then
> let's discuss first.

On the schema: *"Also pay attention to the database schema and database structures."* On siblings:
*"looking for inconsistencies across modes is a good thing to try and improve"*. What the reader
sees is the UI sweep's; this one is the code behind it.

## The short version

- **The sixth sweep's "weak null" was not a clean bill.** A real read found live defects in every
  zone. **Thirteen were reproduced** against the running code or real Postgres: SV1, SV2/WC1,
  SVO1/DB1, SVO2, SVO3, WCO1, WCO2, WCO5, PQ1, PQ2, PQ3, PQO1, PQO2. No data loss was reproduced
  (one hypothesis: a note shown stale invites a save over the newer one). The worst a reader can
  meet: a referee who can neither add nor delete a criterion once the oldest has a note on it; an
  import that ends in *error* when the images step outruns its budget; a note that visibly reverts
  to its old text while an explanation streams.
- **Three recurring shapes, none of them a majority.** A rule enforced at one boundary and not the
  next (the store refuses a stale chat edit after the route has already stopped somebody's answer;
  a fix put a thread's kind and origin inside the transaction and left its anchor and help flag
  outside) — about 17 of the 64 finding IDs. A fix that reached some siblings (`e039d2acd` taught
  three always-mounted reads to hear a job finish and missed the fourth; Debate's sub-modes were
  not told to two lists). And failure exits nobody walked (the queue).
- **The schema is sound, and under-declared.** No table is wrong. Six indexes and five CHECKs exist
  only in migrations; three constraints the code relies on are not in the database though today's
  data satisfies every one; one index is an exact duplicate. All being built. The
  expensive questions are about **retention** (86% of block rows belong to superseded revisions) and
  are Greg's.
- **The read type (sixth sweep item 5) is being spiked on `useIdeas`**, as both families
  independently recommended, under [its own plan](261006n-one-type-for-a-read-spiked-on-useideas.md).
  Both also say plainly that it is worth less than the sixth sweep thought.
- **Ten clusters, C1–C10.** § For Greg holds twelve questions, each with a recommendation; none
  blocks a cluster.

## The investigation docs

Sixteen documents under one [common brief](../investigations/261006d-seventh-sweep-depth-prompt-common.md)
and one [cross-review brief](../investigations/261006d-seventh-sweep-depth-prompt-cross-review.md).
Finding IDs: Sol's are `SV`, `WC`, `PQ`, `DB`; Opus's add an `O`.

| Zone | GPT Sol read | Opus read | Sol on Opus | Opus on Sol |
|---|---|---|---|---|
| Server request path ([brief](../investigations/261006d-seventh-sweep-depth-prompt-server.md)) | [SV1–4](../investigations/261006d-seventh-sweep-depth-server-request-path-sol.md) | [SVO1–15](../investigations/261006d-seventh-sweep-depth-server-request-path-opus.md) | [review](../investigations/261006d-seventh-sweep-depth-server-review-sol-on-opus.md) | [review](../investigations/261006d-seventh-sweep-depth-server-review-opus-on-sol.md) |
| Reader client ([brief](../investigations/261006d-seventh-sweep-depth-prompt-client.md)) | [WC1–4](../investigations/261006d-seventh-sweep-depth-reader-client-and-per-mode-hooks-sol.md) | [WCO1–10](../investigations/261006d-seventh-sweep-depth-reader-client-and-per-mode-hooks-opus.md) | [review](../investigations/261006d-seventh-sweep-depth-reader-client-review-sol-on-opus.md) | [review](../investigations/261006d-seventh-sweep-depth-reader-client-review-opus-on-sol.md) |
| Pipeline and import queue ([brief](../investigations/261006d-seventh-sweep-depth-prompt-pipeline.md)) | [PQ1–4](../investigations/261006d-seventh-sweep-depth-pipeline-and-import-queue-sol.md) | [PQO1–6](../investigations/261006d-seventh-sweep-depth-pipeline-and-import-queue-opus.md) | [review](../investigations/261006d-seventh-sweep-depth-pipeline-review-sol-on-opus.md) | [review](../investigations/261006d-seventh-sweep-depth-pipeline-review-opus-on-sol.md) |
| Database schema ([brief](../investigations/261006d-seventh-sweep-depth-prompt-schema.md)) | [DB1–6](../investigations/261006d-seventh-sweep-depth-database-schema-sol.md) | [DBO1–13](../investigations/261006d-seventh-sweep-depth-database-schema-opus.md) | [review](../investigations/261006d-seventh-sweep-depth-database-schema-review-sol-on-opus.md) | [review](../investigations/261006d-seventh-sweep-depth-database-schema-review-opus-on-sol.md) |

## Scope line

- **Read file by file** (each doc's § What I read has the exact list): `src/routes.ts` in the
  regions named there, `src/auth.ts`, `src/chat.ts`, `src/stream-run.ts`, `src/store/pg-chat.ts`,
  `pg-comments.ts`, `pg-revisions.ts`, `public-reader.ts`, `db-errors.ts`; `src/jobs.ts`,
  `src/store/pg-jobs.ts`, `src/store/jobs.ts`, `structure-slices.ts`, `another-window.ts`,
  `transport-retry.ts`; the thirteen artefact hooks and the shared read machinery;
  `src/db/schema.ts` in full, both live catalogs, the last 40 migrations by statement kind.
- **Not read, so silence there is not a null:** about 5,000 of the 8,300 pipeline lines changed on
  2026-10-04..06 (`ai-call.ts`, `messages.ts`, `messages-stream.ts`, `models.ts`,
  `simple-summary.ts`, `fetch.ts`, `extract.ts`); two thirds of `Reader.tsx`; `activation.ts`,
  `params.ts`, `mode-catalog.ts`, `lib/sse.ts`; most route families outside chat, comments, search
  and referee; `scripts/`, `tools/`, `evals/`; the per-mode server prompts and parsers.
- **Databases:** local, read-only plus test fixtures. Production read-only as `spideryarn_app`
  inside `BEGIN READ ONLY`, counts and catalog only, no prose columns; statistics reset 2026-08-20.
  Every statement and its output is in the Opus schema doc's appendix.
- **Not run:** the full suite, a browser, a deploy, any paid call, any production write.
- **What the method cannot see:** two server processes against one database (every cross-process
  finding is proved from the transaction's code, not run); deployed frequency of anything; visual
  behaviour; index value at scale (62 articles in production, so most plans prove little).
- **Tree audited:** `bf78e90c7`. Line numbers are stale; locate by content.

## Evidence states

**R** reproduced, **C** proved from the code, **H** hypothesis. "R (pg)" means against real
Postgres. Both families' verdicts are in the review docs; where they differ the difference is
stated in the cluster.

## The clusters

Ease and value are 1–5. File sets are disjoint between clusters in flight together; clusters that
share `src/routes.ts` or `src/db/schema.ts` run one after another.

| # | Cluster | Tier | Ease | Value | Risk | Shares files with |
|---|---|---|---:|---:|---|---|
| **C1** | Readiness records name the failing test files (sixth sweep item 9) | 1 | 3 | 4 | low | — |
| **C2** | Reader client: six small defects | 0 | 4 | 4 | low | — |
| **C3** | Job queue: a stuck claim, a discarded finish, a 200 for no job, a lost title | 0 | 3 | 5 | med | C8 (`pg-jobs.ts`) |
| **C4** | Chat and comment rows: three invariants the route does not carry | 0 | 3 | 4 | med | C6 (`routes.ts`) |
| **C5** | Referee criteria with notes on them | 0 | 4 | 3 | low | C4 (`pg-comments.ts`) |
| **C6** | Server: small request-path defects and dead branches | 0/1 | 4 | 3 | low | C4 |
| **C7** | Schema: declare and enforce what the data already satisfies | 1 | 3 | 4 | med | — |
| **C8** | Pipeline tidy: one Labels-successor rule, the dead filesystem session | 1 | 3 | 2 | low | C3 |
| **C9** | The read type, spiked on `useIdeas` (sixth sweep item 5) | 2 | 2 | 3 | med | C10 (`useSkim.ts`) |
| **C10** | Reader client: the rewrite hold on the seven hooks without one; two unchecked replies | 0/1 | 3 | 3 | med | C9 |

### C1 — readiness records name the failing test files

Sixth sweep, For Greg item 9, asked for by the Overseer. A failed run's record carries
`failedTestFiles: { files, total } | null` (at most 20 paths; `null` is "not known", and an empty
list cannot be written), read by a streaming scanner because vitest's summary sits about 96,000
lines into a 14 MB log, outside the head and tail the counts are read from. The Readiness tab gets a
*Failing test files* card. It cannot move a verdict: the verdict code does not read it. Its plan is
`261006m-seventh-sweep-readiness-records-name-the-failing-test-files.md`, in the cluster's commit.

### C2 — reader client: six small defects

- **WCO1 (R, both families).** `useQuizRead` is always mounted and never hears its job finish, so a
  quiz that finishes after the reader left the band does not reach the prose. `e039d2acd` fixed
  this for Glossary, Quotes and Citations.
- **WCO2 (R, both).** `useCrossrefs` clears links already drawn when a refresh after a job gets an
  HTTP error.
- **WCO5 (R).** The Metadata page shows the raw exception text (*"Load failed"*), and asks "did it
  fail" two ways.
- **WCO7 (C).** `useIllustrated` builds a key from an object, so it reads `[object Object]`.
- **WC2, WC4 (C).** Debate got sub-modes in `4b502174a`; two lists of "which sub-mode is in front"
  (`Reader.tsx` § `surface`, `ModeBoundary.tsx` § `resetKey`) were not told. A held bookmark opens
  its comment box over the newly chosen Debate view, and a failed view's fallback survives
  Back/Forward. Made compiler-checked only if that is a typed table in the existing files.

### C3 — job queue

All in `src/jobs.ts`, all **R (pg)** by the Opus review.

- **PQ1.** A throw outside `runStep`'s `try` (a failed freshness read; `note()` in three more
  places) leaves the row `running` with about 760 s of lease; its own next advance answers `busy`
  and a second job on the article waits behind it.
- **PQO1, the deadline row.** A step that returns its product after **our own** deadline fired ends
  the job in `error` with the finished work discarded, while the card says finished steps are kept.
  Reachable: `assets` can run about 360 s against a 185 s budget. The two Stop rows are question 1.
- **PQ2.** With the queue lock held, a job that does not exist answers 200 `{ran:null, busy:true}`;
  404 once the lock is free. Not reader-visible.
- **PQO2.** `job.title` lives in memory and is set only by `extract`, so a pause or a requeue loses
  it and a two-step paper job never has one; the card shows the slug. Fixed only if no new column
  is needed.
- **PQ4 + PQO4.** Comments describing the deleted filesystem queue, and two "≤" lease bounds that
  are no longer bounds.

### C4 — chat and comment rows

- **SV1 (R, both).** A stale edit from a second tab passes the route's check, **stops the first
  tab's streaming answer**, and is then refused by the store. Fix: run the existing `requireTail`
  before `settleThread`; keep the transactional check.
- **SV3 = SVO4 (R for the helper; both families independently).** A thread's anchor and its
  first-turn `help` flag are checked only under a per-process lock. `1cf578937` moved kind and
  origin into `withTurn`'s transaction ([postmortem 261005h](../postmortems/261005h-a-per-process-origin-check-leaves-the-transaction-accepting-another-origin.md))
  and left these two. Fix: enforce both in `withTurn`; the refusals keep their present status codes.
- **SV2 + WC1 (R).** An explanation finishing sends the comment as it was when the answer began, so
  a note edited mid-stream reverts on screen; the client's `delta` and failure branches do the same
  from their own snapshot. Neither half alone closes it. Also the reverse order: a PATCH answer
  carrying `pending` that lands after `done` leaves a spinner for ever (C).
- **SVO9, folded in.** `streamChat` loads every thread of the article up to four times before
  `begin` reads them again.

### C5 — referee criteria with notes on them

**SVO1 = DB1 (R (pg); both families independently, from two different zones).** `begin` inserts a
criterion and trims the list to twenty in one transaction; the trim deletes the oldest finished
criterion even when a reader's note points at it, the foreign key refuses, and the insert rolls
back. Every later add fails the same way. Deleting such a criterion by hand is a 500. Production has
no article in this state (most criteria on one article: 4; notes on a criterion: 0).

Built: the trim skips criteria that carry notes (so a list can exceed twenty by the number
protected: Greg is told, not asked); a hand delete of a criterion with notes is a 409 with a
sentence instead of a 500, and the client puts the row back; **SVR1**, the same foreign key reached
by a placement that races a delete, gets the same matcher. What Delete *should* do with the notes is
question 3. Two reviewers called the trim change safe and one called it policy; it is built because
the alternative on offer today is a wedged article.

### C6 — server: small defects and dead branches

- **SVO2 (R at the store).** `POST /api/live/<not-a-uuid>/…` is a 500. `find` returns `null` for a
  malformed id, as the upload store does.
- **SVO3 (R).** `serveApi`'s catch writes JSON onto a stream whose headers are out: it throws
  `ERR_HTTP_HEADERS_SENT`, logs a 500 for a 200 and files a second Sentry event. One
  `res.headersSent` guard; the handlers' own catches stay.
- **SVO5, SVO6, SVO12, SVO14 (C).** A second minimal-paper gate kept for a field no client reads; a
  retry `catch` in `pgCommentStore.create` that cannot run; a URL parsed twice; a hand-rolled copy
  of `answerALostClaim`.
- **SVO7, SVO8, SV4 (C).** False comments: the "not yet `200 null`" list (five named, six exist),
  the filesystem store in the present tense in `pg.ts`, and three glossary comments that say Ask
  writes nothing.

### C7 — schema: declare and enforce what the data already satisfies

One worktree, migrations strictly in sequence. Production counts are from 2026-10-06 and each is
re-read before its migration is written.

1. **`revision_blocks (article_id, block_id)` index (DBO1).** The block-identity foreign key has no
   supporting index, so deleting an article checks it by scanning. Sol: the latency claim is a
   hypothesis until a real cascade is timed, so the builder times one locally before and after.
2. **`referee_criteria_diverging_shape` tightened (DB3)** to the all-or-none rule its comment
   states. 0 of 10 production rows violate.
3. **`referee_claims_empty_unless_done` (DBO9)**, withheld on 2026-09 for the filesystem store. 0 of
   4 violate.
4. **`upload_source_guesses.created_at` (DB4).** Its only timestamp is overwritten on every reclaim.
   Nullable for the 5 existing rows; the house rule is "store when it happened".
5. **Drop `chat_messages_thread_ordinal_idx` (DBO3)**, an exact duplicate of the UNIQUE index on the
   same three columns. An index, not data, and re-creatable in one line, so it is built rather than
   asked; Sol calls it safe, the Opus review would have asked.
6. **Declare the six indexes and five CHECKs that exist only in migrations (DBO4)** in `schema.ts`,
   and extend the existing `tests/db-schema.test.ts` to require them, by definition where it
   matters. No DDL runs. Not a second inventory.
7. **`article_revisions_published_has_scalars` (DBO8)**, the CHECK `pg.ts` says "needs a
   migration". 0 of 460 violate, but test fixtures insert published revisions without the four
   numbers, so the fixtures are swept first and this is its own stage.
8. **False schema comments (DB2, DBO11):** five locations, `ai_calls.wire` (three values named,
   seven exist) the clearest.

### C8 — pipeline tidy

- **PQ3 (R (pg), P2).** A live Labels failure marks the base `failed` while a successor is still
  queued; a lease expiry in the same position leaves it `pending`. One helper for both callers.
- **PQO3 (C).** `fsStoreSession` has one caller, a 626-line test; `JobSettles` and the empty
  `LEGACY_UNCONVERTED_STEPS` go with it. Any case with no Postgres twin is ported first.

### C9 — the read type, spiked on `useIdeas`

[Its own plan](261006n-one-type-for-a-read-spiked-on-useideas.md), reviewed by GPT Sol. Stages 1
and 2 are the spike, and it ends in a written decision.

### C10 — the rewrite hold, and two unchecked replies

- **WCO3 (C; Sol traced the controls and calls it Tier 0).** Thirteen artefact hooks have a forced
  re-run; six hold the control until the new result has been read (`useRewriteHold`), seven do not
  (Illustrated, Quotes' *Find more*, Timeline, FAQ, Debate, Citations, Skim). In the gap the button
  is live over the old result, and a second press is a second paid run. Applying the existing
  written rule is a repair, not a policy change.
- **WCO4 (R for the malformed input; no producer today).** `useTweets` and `useSkim` publish a
  reply before checking it.

After C9, because both touch `useSkim.ts`.

## Tier 3: named and sized, not started

- **Rolling the read type out** beyond Ideas: a compatibility decision per hook, most of a week if
  it goes ahead at all. Decided by C9.
- **Job transitions the database refuses (PQO5).** No job transition is refused by the database,
  only by `WHERE` clauses; "a terminal job holds no draft pointer" is kept by hand in four
  statements. A CHECK needs `releaseStepIn` reordered first. M, its own plan, a characterisation
  test first.
- **Revision retention (DBO6, DBO2).** Questions 8 and 9.
- **One owner column per article child (DBO5).** Question 10.

## For Greg

**Superseded by the revised list at the end of § What the review changed**, which is the one that
went to Greg. This first draft is kept so the review's findings about it can be read against it.

1. **Stop pressed during an import's last step.** Today the article is kept if the Stop reached one
   server instance and thrown away if it reached another. *Recommend:* keep it — the work is done
   and paid for, and Stop then means "do no more".
2. **Does a new Summary prompt make stored summaries stale?** For every other step a prompt version
   bump marks stored output out of date; Summary's stamp does not. *Recommend:* confirm it is a
   deliberate exception (re-summarising every article on a wording change is expensive) and write
   that down, or say it should follow the rule.
3. **Deleting a Referee criterion that has notes on it.** After C5 it is refused with a sentence.
   The alternatives: delete the criterion and keep the notes, detached; or delete both after a
   confirmation. *Recommend:* keep the notes, detached — a reader's words outlive the model's.
4. **After "none yet", a failed read and a failed *Try again*, the Generate button is gone** in
   twelve modes and kept in Tweets (WCO6). *Recommend:* keep it everywhere; the reader's way out
   should not depend on the mode. One line, once C9 lands.
5. **The retired `citation-find` rate bucket** (sixth sweep item 8). **One production row carries it**
   (2026-09-29), so the CHECK cannot be narrowed until that row is deleted, and nothing will ever
   sweep it. *Recommend:* delete the one row and narrow the CHECK; or leave both, at no cost.
6. **Drop `queue_state.running_job_id`.** Nothing reads or writes it; the one production row holds
   null. *Recommend:* yes.
7. **`revision_blocks.kind = 'callout'`** is allowed by a CHECK and produced by nothing; 0 rows.
   *Recommend:* leave it unless callouts are abandoned for good.
8. **Thirteen of 62 production articles were never published** (failed first imports) and are never
   removed; they hold 38% of all block ids. *Recommend:* a sweep like the draft sweep you approved
   on 2026-10-04, after C7's index lands; its own small plan.
9. **Superseded revisions are kept for ever:** 411 of 460 published revisions, 86% of block rows.
   They are not dead weight — a sharing draft rebases against its old base. *Recommend:* nothing
   yet at this size; decide a retention rule (keep the last few) before the table is ten times
   larger.
10. **Eight tables carry an `owner_id` nothing uses** (the article already says who owns it); 0 of
    157 rows disagree. Drop them, or add foreign keys that make them true. *Recommend:* leave until
    question 9's shape is known; the two decisions touch the same ownership-transfer script.
11. **Paid calls with no per-reader limit:** chat, meaning search, Referee, quiz marking, the
    command bar, dictation, a forced re-run of a step, and Glossary's Ask. *Recommend:* its own
    look; this sweep only lists them.
12. **Two small ones.** Retire the 24-day-old `?anchors=whole-block` compatibility filter? Finish
    "none yet is not a 404" for the six reads that still answer 404? *Recommend:* yes to both, low
    priority.

Still undecided from earlier sweeps: the fifth's 1, 2, 3, 6; the sixth's 1, 3, 4, 6, 7.

## Considered and rejected

For the next sweep's search. *(again)* marks an earlier rejection raised again.

- A mode registry, a generic artefact-read hook, a generic stream shell, splitting `routes.ts` or
  `Reader.tsx` by size *(again)*: every defect found fits an existing helper or transaction
  boundary. The read type is a type for a result, and C9's stop condition is what holds that line.
- One disconnect policy for streams *(again)*: the differences are written choices.
- An owner-leading index on `articles` (DB5): one owner holds 60 of 62 rows, so the planner scans
  regardless.
- A column for Structure's "awaiting structure" flag (DBO13): a second copy of a fact every tree
  reader and writer already shares.
- A relational identity for glossary and citation entry ids (DBO12): the count behind it was wrong
  (reader-added terms are deliberately outside the JSON), and no harm is shown.
- Relocating the five filesystem readers (SVO11): they are used, and documented, as fixtures.
- A default `Cache-Control` for every authenticated JSON route (SVO10): the facts are right, the
  blanket default is too broad, and no leak is shown.
- Combining `GET /api/reader`'s three reads (SVO13); a sanitiser stamp on stored HTML (SVO15): each
  needs a measurement first.
- An allowlist test of catalog object names (DBO4's first proposal): a deleted allowed object
  leaves it green.
- Making every chat client send an edit tail; rewriting quiz marking around a revision snapshot.

## One level up

**Is the overall approach sound? Yes, in all four zones**, and both families say so separately. The
request and store division works; the queue's design is right and its defects are exits nobody
walked; the schema has no table that should not exist; the client's ordering machinery
(`useOrderedRead`, the rewrite hold) is where the hard problems already live.

What the sweep adds to the fifth's "a fix does not travel" is one more direction it fails to travel
in: **across a boundary.** A rule gets enforced where the bug was seen (the route, the per-process
lock) and the next layer (the transaction, the database) is left agreeing by convention, or the
other way round. GPT Sol counted this class at 17 of 64 finding IDs, generously; it is one recurring
class beside sibling drift and unwalked failure exits, not the explanation of the whole. Where it
applies the fix is cheap: carry the existing check to the other side and keep both.

## Review status

- The eight investigations: each cross-reviewed by the other family (table above). Of the Tier 0s,
  the pipeline's four and the schema's one were reproduced against Postgres by the reviewer.
- The read-type plan: GPT Sol, ready with fixes, applied.
- This umbrella, round 1: [GPT Sol](261006m-seventh-codebase-sweep-depth-umbrella-review-sol.md),
  read-only, **not ready**, 23 findings. All applied in § What the review changed; none overruled.
  No second round of discovery: the changes narrow what is built, and each cluster's code gets its
  own review.

## What the review changed

**Binding on the builders wherever it and a cluster's text above differ.** Reviewed at `b7a0d9253`.

- **U1, C3.** On our own deadline, the step's returned product is **not committed**: `assets` can
  return an incomplete manifest with unfetched images stamped current. The fix discards it, keeps
  what earlier steps committed, and reuses `pauseForDeadline` with all its outcomes. "Stop
  discarding the finished work" was the wrong description.
- **U2, C5. The trim is not built; it goes to Greg** (question 3a). Letting a criteria list exceed
  twenty to protect notes is a retention choice, and one of the four reviews said so. C5 builds
  only the two refusals: a hand delete of a criterion with notes is a 409 with a sentence, and a
  placement that loses a race with a delete (SVR1) is a refusal, not a 500. Until 3a is answered a
  twenty-first criterion on such an article still fails; production has no such article.
- **U3, C7.** Item 6 declares the **five** migration-only indexes that survive item 5, and the five
  CHECKs. Declaring them makes `db:generate` emit `CREATE` statements for objects that exist: the
  builder reconciles the snapshot and journal so none runs, and proves the migrations apply to both
  an existing database and an empty one. All C7 stages are sequential, one migration at a time.
- **U4, NEW1 — held, with a reason.** `scripts/db-reown.ts` updates tables alphabetically, so it
  moves `ingest_events.owner_id` before `jobs.owner_id` and trips the immediate composite foreign
  key between them (C, not run). A local script; nothing a reader reaches. Its repair (a deferrable
  key) is a migration that wants its own plan and shares C7's sequence. It is the real dependency
  of question 10, which the first draft tied to question 9 by mistake.
- **U5, C9. The authorised work ends at the spike and its written evidence.** Rolling the type out
  is a recommendation to Greg through the Overseer, not a continuation. (The session brief does
  say to migrate if the spike passes; the narrower reading costs a day's wait and is the safe one
  for a change that touches every mode.)
- **U6. Findings with no home, now placed:** WCO8 (stale counts and filesystem wording in client
  comments: each cluster fixes them in the files it touches; the rest go to C10) and WCO9 (a
  signpost in `mode.md` to `Reader.tsx`'s 19 `mode ===` comparisons outside the switch, on 17
  lines, covering seven modes, plus the two sub-mode lists) go to **C10**; PQO6 (two regression
  tests that have passed and never been seen red; the Messages continuation boundary has none) goes
  to **C8**. Aliases for the ledger: WC3 and WCO10 are C9; DBO7 is question 5; DB6 and DBO10 are
  question 6.
- **U7. Requirements the summaries dropped:** C2's WCO1 needs a guard that names the always-mounted
  artefact reads with explicit exclusions, not a fourth hand-written entry; WCO2 clears links on a
  successful absence or a stale answer and stays silent on failure; WCO5 covers `StageRecord`'s
  truthiness gate. C4 corrects the false chat-guarantee comments and the two comment-resurrection
  comments. C6's SVO8 includes `pg-reader.ts` and `public-reader.ts`. C8's PQO3 leaves the public
  terminal fixture methods (`JobStore.finish`, `releaseStep`) alone and says so.
- **U8, U9. Evidence and tiers, per item rather than per cluster.** PQ1's freshness failure is
  R (pg); its three `note()` exits are C. PQO2 is C in one review and reproduced at the coordinator
  in the other, Tier 0 to Sol and Tier 1 to Opus. PQ3 is Tier 0 by the letter, P2 in effect.
  SV3/SVO4 is Tier 0 to Sol and Tier 1 to Opus, because no client today produces the colliding
  first sends. WC4 needs a band to throw first. WCO7 is a key correction with no missed completion
  shown. WCO5's raw wording is R; an empty message is H. PQ4/PQO4 span four files, and a persisted
  title touches the job-store contract.
- **U10. Two fixes with a plausible broken twin.** C5's check for notes on a criterion must lock
  the candidate rows and then check references in a **separate statement** (READ COMMITTED: a
  single snapshot `NOT EXISTS` still fails after a concurrent placement). C8's surviving-successor
  helper must exclude the settling job, keep the owner scope and keep the live path's
  `unfinished === "labels"` trigger, or a running job counts as its own successor.
- **U11, C7.** `created_at` is added nullable **with no default**, and the default installed in a
  second statement, or existing rows get an invented date. The comment corrections are the union of
  DB2's eight entries and DBO11's five locations; the `comments.thread_id` history stays as history.
- **U13. Collisions the table missed**, and the order they force: C2 before C10
  (`useIllustrated.ts`); C5 before C6 (`pg-comments.ts`); C5 before C7's stage 7
  (`tests/store-parity-referee.test.ts`); C6 before C7's comment stage (`pg.ts`); C3 before C8
  (`jobs.ts`, `store/jobs.ts`, `pg-jobs.ts`, `pipeline.ts`); C4 before C6 (`routes.ts`,
  `types.ts`); C9 and C10 share `useSkim.ts` and the read-error and rewrite-hold tests.
- **U14. The holds come before the spike.** WCO3 is a reachable second paid run; the spike is
  Tier 2. C10 is split: **C10a**, the hold on the six hooks that are not Skim, plus WCO9, runs
  first; **C10b**, Skim's hold and WCO4, runs after C9.
- **U15, C10b.** An intended `200 null` is absence, not a malformed reply.
- **U16. The refusals this sweep adds, and who can reach each:** C4's stale-edit 409 (an ordinary
  stale tab; an existing refusal moved before the abort); C4's anchor and help refusals (colliding
  first sends only; an identical anchor and an unanchored follow-up must pass; help stays 400,
  anchor 409); C5's delete 409 (a criterion with notes; none in production) and stale-placement
  refusal (an ordinary two-tab race); C6's 404 for a malformed session id (hand-made only); C7's
  three CHECKs (0 of 10, 0 of 4, 0 of 460 violate; test fixtures can); C10b's malformed-reply throw
  (no producer today). Tier 3's PQO5 CHECK needs a production count of terminal jobs still holding
  a draft pointer, and a change to `discardAfterCancel` as well as `releaseStepIn`.
- **U17, U18. § For Greg rewritten** below: consequences before options, engineering work taken
  out. Question 2 was not a question (`pipeline.ts` § `STEPS.simple.stamp` already records it as a
  deliberate exception; C8 writes that into `summaries.md`). Question 11 is an investigation, not a
  decision, and moves to § After. Question 12b (finish "none yet is not a 404", behind the same
  opt-in header) is bounded compatibility work and joins C6. Question 12a stays unasked: 24 days is
  not evidence that every old tab is gone.
- **U19. The scope line described Opus's coverage.** Sol read `Reader.tsx`, `activation.ts`,
  `params.ts`, the mode catalogue and the SSE machinery in full, and parts of `ai-call.ts` and
  `simple-summary.ts`. So: read by one family only, not unread. Read by neither: `messages.ts`,
  `messages-stream.ts`, `models.ts`, `fetch.ts`, `extract.ts`, most route families outside chat,
  comments, search and referee, and `scripts/`, `tools/`, `evals/`.
- **U20.** § One level up and the short version no longer claim one shape explains most findings.
- **U21.** C1's plan was not in the reviewed commit; it and its own code review landed with the
  cluster.
- **U22, confirmed as build decisions:** dropping the exact-duplicate index, and C10's holds, whose
  written rule is [mode.md § forced verbs](../project/mode.md) ("every forced control honours
  `rewriting`").

### § For Greg, as revised (this list replaces the one above)

1. **Stop, pressed while an import's last step is finishing.** Today the result depends on which
   server answered: one keeps and publishes the article, the other discards the draft. If the last
   step is the image step, "keep" can publish an article some of whose images were not fetched.
   *Options:* always keep (the text is done; missing images can be re-run); always discard (Stop
   means stop; the reader imports again and pays again). *Recommend:* always keep.
2. *(Withdrawn: already decided and written in the code.)*
3. **A Referee criterion (one of the questions a reviewer asks of a paper) that has the reader's
   notes placed on it.** Two decisions.
   **3a. The list is capped at twenty, oldest dropped first.** If the oldest carries notes, adding a
   new criterion currently fails outright. *Options:* never drop one that has notes, so a list can
   run past twenty; or drop it and detach its notes. *Recommend:* never drop one with notes.
   **3b. The reader deletes such a criterion by hand.** After this sweep it is refused with a
   sentence. *Options:* keep refusing; delete it and keep the notes, detached — which also clears
   each note's for/against score, since the score means nothing without the criterion; delete both
   after a confirmation. *Recommend:* keep refusing for now; it loses nothing.
4. **After a mode has said "none yet", a read has failed and *Try again* has failed too**, twelve
   modes remove their Generate button and Tweets keeps it. Keeping it lets the reader spend on a
   run while the app does not know whether a result already exists. *Recommend:* keep the button
   everywhere; a possible duplicate run is cheaper than a dead end. Per hook, a few lines each.
5. **One old rate-limit record in production** (from 2026-09-29, no reader text in it) belongs to a
   limit that no longer exists. The database's list of allowed limit names cannot be tidied while
   it is there. *Recommend:* leave both; deleting it buys nothing at runtime.
6. **An unused column, `queue_state.running_job_id`**: nothing reads or writes it and its one row
   is empty. Dropping it also removes a link the export tool follows. *Recommend:* drop it, low
   priority.
7. **Callout blocks**: the database still allows a block kind the pipeline never produces (0 rows).
   Narrow it only if callouts are abandoned for good. *Recommend:* leave it.
8. **Thirteen of 62 production articles never finished their first import** and are never removed;
   they hold 38% of all block ids. Unlike the abandoned drafts you approved deleting on 2026-10-04,
   these are whole article rows with checkpoints, uploads and billing records attached, and a retry
   of the same URL reuses them. *Recommend:* its own small plan with those safeguards; not urgent.
9. **Old published copies of each article are kept for ever** (411 of 460; 86% of block rows). A
   sharing draft needs the copy it was based on, so any rule must protect copies in use.
   *Recommend:* nothing at this size; decide before the table is ten times larger.
10. **Eight tables store the owner twice** (on the row and on its article); 0 of 157 rows disagree.
    Dropping the copy, or enforcing it, changes how ownership transfer works, and the transfer
    script already has an ordering bug (NEW1). *Recommend:* fix NEW1 first, then decide.


## After the clusters: named, not built

- **Paid calls with no per-reader limit** (chat, meaning search, Referee, quiz marking, the command
  bar, dictation, a forced step re-run, Glossary's Ask): an investigation with cost and frequency
  numbers, before anybody is asked to choose limits.
- **NEW1**, the ownership-transfer ordering bug in `scripts/db-reown.ts` (above, U4).
- **`GET /api/reader` reads one row three times (SVO13); every article load re-sanitises every
  block (SVO15):** each wants a measurement before a change.
- **Retiring `?anchors=whole-block`:** needs evidence that no old client still sends it.

## What landed

Each cluster: an Opus builder in its own worktree, red first; a GPT Sol code review, write-capable;
an Opus reader who took Sol's diff as a proposal, saw each regression test go red without its fix,
ran the gates and the Postgres cases Sol could not, merged `origin/dev` and pushed. No deploy. No
browser pass was run on any of them. The full suite was not run per cluster; each ran the files it
touched and their neighbours.

- **C1, readiness records name the failing test files — landed 2026-10-07**, `73d6be783` and
  `cca4957db` ([its plan](261006m-seventh-sweep-readiness-records-name-the-failing-test-files.md)).
  `failedTestFiles: { files, total } | null` on a failed run's record, from a streaming scanner;
  a *Failing test files* card on the Readiness tab. Across 27 real failing logs on the box it named
  every file and matched vitest's own count. **The audit's proposed mechanism was wrong:** the
  counts are read from a log's head and tail, and vitest's summary sits about 96,000 lines into a
  14 MB log, in neither. Sol's review fixed four places the card would have said something false
  (a `FAIL` line quoted inside an error message counted as a second file; an older run called "the
  latest"). **For the Overseer:** the dashboard and the readiness loop need a restart to show it.
  One thing the real logs showed: `tests/store-roundtrip.test.ts` failed in every loop run from
  05:06 to 20:34 on 2026-10-06.

- **C2, six reader-client defects — landed 2026-10-07**, `02e4de13e` and `9f8109f0f`
  ([its plan](261007a-seventh-sweep-client-tier-0-six-defects.md)). All six red first. WC2 and WC4
  are now `Record<ModeWithSubModes, …>` tables in the files they were in, so a seventh sub-mode
  fails to compile. **WCO7 was understated by both reads:** two refused Illustrated starts in a row
  really did skip the Sketch re-ask, and Sol's review found identical refusals still did; it is a
  refusal counter now. Sol also added the derived guard U7 asked for: a hook `OwnedReader` mounts
  with a slug must be covered or named as excluded. Left, wider: a deleted cross-reference artefact
  can be replayed from the offline API cache after a transport failure; an open Quiz band and the
  always-mounted read both hear a completion (two GETs); `DeletePermanently` still interpolates a
  raw exception message.

- **C3, the job queue — landed 2026-10-07**, `7d3a4b4d9` … `3b4792e6a`
  ([its plan](261007b-seventh-sweep-job-queue-tier-0.md)); two review rounds. PQ1's exits were
  four, not one, all reproduced against Postgres. **The first review said "do not ship", and was
  right:** a forced step's `done` reached the job row only through a later progress write, so a
  failed write followed by a pause re-ran the step and paid for it again. It predated the cluster
  through lease expiry; the builder's "a failed progress write logs and carries on" gave it a
  cleaner route. Fixed properly in about twenty lines: the receipt is written in the product's own
  transaction (`keepStepIn`). Sol's second round added a test that a receipt written in a second
  transaction fails, and the lander proved it does. Also from review: a Stop carried on a progress
  response was ignored; a blank title could erase a stored one; **one of the review's own tests
  could not fail** (its assertions sat inside a step body). Left: the Stop question (For Greg 1);
  `STEP_BUDGET_MS.assets` (185 s against about 360 s) and `fetch` (150 s) look too small and were
  not changed; an explicit Retry re-runs a finished forced step, by design.

- **C4, chat and comment rows — landed 2026-10-07**, `17ae67ee6` … `b4dcabb38`
  ([its plan](261007b-seventh-sweep-chat-and-comment-invariants.md)). SV1, SV3/SVO4, SV2 and WC1
  each reproduced through the route and Postgres. `streamChat`'s loads before `begin` went from up
  to five to at most two. **Two existing tests asserted SV3's defect** (a different anchor is
  ignored); Sol traced the history and the tolerance was never intended. Sol traced every sender
  of a chat turn and found no ordinary single-tab request newly refused. Its review found one
  defect in the new code: a `done` frame could carry another attempt's `pending` row and leave a
  spinner for ever. Left: the seven answer-owned fields are listed by hand in several places.

- **C10a, the rewrite hold on six more forced verbs — landed 2026-10-07**, `8720c3af3` …
  `9ce88da24`
  ([its plan](261007b-seventh-sweep-rewrite-hold-on-the-six-forced-verbs-without-one.md)). In every
  one of the six, two clicks in one tick made two forced POSTs: the gap did not need a slow
  network. A syntax-tree guard now fails if a file under `src/web` forces a run without being a
  hold user or a named exclusion. **Review found the gap behind the gap, in all twelve hold
  users:** *Retry* after a failed run reopened it (fixed at the shared seam); and a job that failed
  with its band closed and was then trimmed from the list left the control dead until a reload
  (fixed in about eleven lines: the job engine, which outlives every band, says when a job is
  over). **Four new reader-facing sentences**, in the pattern of the existing six, for Greg to veto:
  *The new quotes haven't loaded yet.* and the same for *timeline*, *search* (Debate) and
  *citations*. **Not built:** moving the loaded branches of `SketchView` and `IllustratedView`
  onto `JobProgress`, which would reverse three recorded decisions (a Stop beside a loaded picture,
  a second run button, the failure colour) and wants a yes or no first. **Left, reproduced and
  pinned by a test that goes red when it is fixed:** the command bar's *Run again* row posts a
  forced run directly and bypasses every mode's hold. Skim's hold waits for C10b.
