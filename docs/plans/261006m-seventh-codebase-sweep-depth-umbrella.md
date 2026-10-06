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

- **The sixth sweep's "weak null" was not a clean bill.** A real read found **about fifteen live
  defects**, eleven reproduced against the running code or real Postgres. None loses a reader's
  data. The worst a reader can meet: a referee who can neither add nor delete a criterion once the
  oldest has a note on it; an import that ends in *error* with its finished work thrown away when
  the images step outruns its budget; a note that visibly reverts to its old text while an
  explanation streams.
- **One shape explains most of them: an invariant enforced in one layer and not carried to the
  next.** The store refuses a stale chat edit after the route has already stopped somebody's
  answer. A fix put a chat thread's kind and origin inside the transaction and left its anchor and
  help flag outside. `e039d2acd` taught three always-mounted reads to hear a job finish and missed
  the fourth. It is the fifth sweep's "a fix does not travel to the siblings", one level down.
- **The schema is sound, and under-declared.** No table is wrong. Six indexes and five CHECKs exist
  only in migrations; four constraints the code relies on are not in the database though today's
  data satisfies every one; one index is an exact duplicate. All additive, all being built. The
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

Nothing here is built. Each has a recommendation. The plain-words version goes to Greg as one batch
through the Overseer.

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

What the sweep adds to the fifth's "a fix does not travel": **it does not travel downwards either.**
A rule gets enforced where the bug was seen (the route, the hook at hand, the per-process lock) and
the layer that could have made it structural (the transaction, the database, the type) is left
agreeing by convention. The cheapest fixes found were all of one kind: move the existing check one
layer down, and keep the early one for its better error message.

## Review status

- The eight investigations: each cross-reviewed by the other family (table above). Of the Tier 0s,
  the pipeline's four and the schema's one were reproduced against Postgres by the reviewer.
- The read-type plan: GPT Sol, ready with fixes, applied.
- This umbrella: GPT Sol review pending.

## What landed

*(filled in as clusters land)*
