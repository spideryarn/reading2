# A retry minted a fresh name, so the checkpoints could never be found

**Found 2026-09-03**, while following a different bug — a 142-page PDF refused on the 100-page cap
with no reason given. Fixed the same evening in `92ff0e83`, under
[260903k](../plans/260903k-pdf-page-cap-refused-with-no-reason-given.md) stage 3.

Chunk checkpointing exists so that a long PDF which runs out of lease time does not re-buy every
chunk it has already paid for. It is keyed on the article. **A retry minted a fresh article**, so the
second attempt looked for its chunks under an id that had none. This was not a degradation. The
feature was inert on the exact case it was written for, from the afternoon it landed until the
evening it was found, and nothing anywhere said so.

## The two changes, ten hours apart

Both landed on 2026-09-01.

`74e29153` at 06:28, *"Every slug ends in a short id, so nothing has to guess a name any more"*. Slugs
stopped being derived from the title with a `-2…-99` collision counter and started ending in a
globally unique short id, answering Greg the day before:

> Yes, let's add a short id — and actually then we could in future allow users to rename the slug,
> and redirect/find it from the short id. So make sure it's globally unique. I'm fine with adding
> that to all slugs.
>
> — Greg, 2026-08-31

The collision counter had needed a companion — `freeUploadSlug` and `slugIsSpokenFor`, which read a
candidate's fetch manifest to ask *is this article this upload's own*, so a retry did not find its own
name occupied by itself. Once every name is unique, nothing collides and nothing has to step aside,
so both were deleted. The commit message is explicit about it, and **names the exact harm it was
about to cause**:

> the Retry bug that question existed to avoid goes with them, because a retry now mints a fresh name
> rather than finding its own slug occupied by itself and paying for the transcription twice

That was true of the world it was written in. Nothing then read a per-article store.

`2988bcb9` at 16:26 the same day, *"A long PDF can finish now"*, gave the checkpoint seam its first
callers. Its own message states the goal and the key in one breath: the chunks a failed attempt had
finished were in a job-scoped `/tmp`, *"and a retry is a new job by design, so the retry started from
zero, timed out again, and an accepted PDF could fail for ever."* The repair was to key them on the
article instead.

Ten hours. Nobody was wrong at either end. The morning change removed a guarantee that nothing was
using; the afternoon change built on that guarantee without going to look at whether it was still
there.

## The real cause

A checkpoint is addressed by the article and the question, and by nothing else
([`src/store/checkpoints.ts`](../../src/store/checkpoints.ts) § *The one thing that would have made it
useless*). That section is a careful piece of thinking about exactly this hazard, one level too
shallow:

> A retry is a new job and a new job begins a new draft revision, so a checkpoint keyed on the
> revision is written on every run and read on none. Nothing errors, nothing warns, every lookup
> simply misses, and the only symptom is a larger bill.
>
> `articleId` is stable across every attempt, so the store binds one at construction.

The first paragraph is the failure mode, described perfectly. The second sentence is the bug, stated
as the premise that rules it out. Two other files say the same thing —
[`src/store/pg-session.ts`](../../src/store/pg-session.ts) at its `checkpoints` property (*"stable
across every job, every attempt and every draft revision, which is exactly what a checkpoint has to
be keyed on"*) and [`src/pdf-read.ts`](../../src/pdf-read.ts) at its `checkpoints` field. Three
files, three assertions, one thing they all describe and none of them owns.

What actually decided it was [`src/jobs.ts`](../../src/jobs.ts), which knew nothing about any of this.
`retryJob` re-enqueued through the ordinary allocation path with `slug: old.slug`, and `enqueue`
allocated afresh: an upload took `slugWithShortId(request.slug)` unconditionally, with no branch that
could adopt; a URL went through `freeSlug`, which adopts only what the shelf or a live job holds. A
first ingest that failed has published nothing and its job row is `error`, so it was neither. Both
branches minted. `openPgStoreSession` → `openOrBeginJobDraft` → `lockOrCreateArticle(tx, slug)` makes
the article a pure function of the slug, so a new name is a new article, and the store the stage is
handed is bound to it at one line.

**And the bug left a visible fingerprint that nobody read.** `slugWithShortId` *appends* an id rather
than replacing one, so three presses of Retry produced `…-spya-aaa-spya-bbb-spya-ccc` — three
articles, three invoices, and a slug that says out loud what happened.

**Blast radius.** Both namespaces, defeated by the same line, because `checkpoints.namespace` is a
CHECK constraint over exactly two values ([`src/db/schema.ts`](../../src/db/schema.ts) § `checkpoints`)
and both are reached through `session.checkpoints`. `pdf-chunk` — up to ~100 paid calls per attempt,
and a liveness cliff, since a document that cannot accumulate finished chunks fails for ever.
`hierarchy-labels` — a handful of paid calls and no cliff, and it kept one live path, a forced
refresh of an article already on the shelf, which adopts.

Nothing else in the tree is exposed. `StoreSession` does not hand a stage the `articleId` itself, only
a store already bound to one, so the surface is the namespace list and the namespace list is
enumerable. Every other `articleId`-keyed table — comments, quotes, glossary, chat, block identities
— hangs off a *published* article and is reached only after an ingest has succeeded, so it never
crosses a retry boundary on an unpublished one. Ingest slots are counted per ingest and a failure
gives its slot back ([billing.md](../project/billing.md)), so the extra articles cost money but not
allowance.

## The class

**A borrowed key.** A feature depends on a property of an identity that a different module mints. The
feature writes the property down in its own files, as often as three times, in the tone of something
established; the minting module has no idea it owes anything, no test names the debt, and the day
somebody changes how names are minted for a good reason of their own, the feature goes quietly inert.

The two halves that make it expensive are both visible above.

**The precondition is documented at the borrower.** A comment saying *"`articleId` is stable across
every attempt"* sitting in the file that consumes `articleId` is a wish. The same sentence sitting in
`src/jobs.ts`, beside the code that decides, is a constraint somebody has to break on purpose.

**The test proved the store and assumed the caller.** `tests/checkpoints-durable-resume.test.ts` built
both attempts with the same `articleId` by hand, through a helper whose header had thought
unusually hard about the problem and stopped one step short:

> The store a claim would be handed — **built fresh, exactly as a new job on a new machine would build
> it.** That is the point of taking no arguments beyond the article: there is nowhere here to put a
> job id, an attempt token or a revision, because the production constructor has nowhere to put one
> either.

Everything in that paragraph is right. It reasons about every value the production constructor
*cannot* carry and never asks where the one value it does carry comes from. The signature is
`storeFor(id = articleId, slug = SLUG)`, and **a default argument for the value under test is the
moment a test stops asking a question.** That is why it stayed green over a dead feature for two days,
and why it would have stayed green indefinitely.

## The fix that landed, and the one that looked right

`retryJob` now carries a `retryOf` field, and `enqueue` routes a retry through `slugForRetry`
([`src/jobs.ts`](../../src/jobs.ts)) — the same three branches as `freeSlug` with one word changed: a
retry's *mint* keeps the failed attempt's own name instead of generating a new one. Whether it
*reserves* is unchanged.

The obvious version of that was wrong, and GPT Sol reproduced it. Making the retry `adopted` looks
tidier — it is, after all, continuing an existing article — but an adopted allocation **reserves
nothing**, so its row sits outside the `jobs_active_source` partial index, and a fresh paste of the
same URL in the same instant would then mint. **Two active articles for one address**, which is the
race that index exists to stop, arrived at through the fix for a different one. Nor is a cleverer
lookup the answer: whatever the repair learns about a live holder is stale by the time its insert
runs, which is the whole bug. So a retry adopts only from the **shelf** — a published address is a
durable fact every later lookup finds too — and mints, and therefore reserves, for everything else;
and a retry the index refuses inserts nothing at all and is handed back the job that refused it
(`handBackToARetry`). The guarantee is the constraint rather than a scan. The full argument is in the
plan under
[§ What the second review found](../plans/260903k-pdf-page-cap-refused-with-no-reason-given.md#what-the-second-review-found-and-what-was-done-about-it).

Two tests hold it now: [`tests/retry-keeps-the-checkpoints.test.ts`](../../tests/retry-keeps-the-checkpoints.test.ts),
which drives real `enqueue`/`retryJob` and does a real write-then-read across the two attempts, with
the three paths that already worked kept beside them as controls; and
[`tests/one-article-for-one-address.test.ts`](../../tests/one-article-for-one-address.test.ts), which
forces the interleaving for both of the index's refusals.

## What would have caught it

Ranked by ease and value.

1. **When a test's subject is "X survives Y", make it produce both sides of Y through the real path.**
   Two lines, and it would have gone red the morning the short-id change landed. The generalisable
   tell is the one above: a test helper with a **default argument for the identity the test is
   about**. A hand-built key is the right shortcut when you are testing a store and do not yet know
   who the caller is; it becomes a lie the moment the test's name starts claiming something about the
   caller. `checkpoints-durable-resume` was called *durable resume*, which is a claim about attempts,
   and what it tested was the store.

2. **Log the hit rate, not the exception.** `storedChunks`
   ([`src/pdf-read.ts`](../../src/pdf-read.ts)) warns when the checkpoint read *throws*, under a
   comment that cites [silent-success.md](../reusable/silent-success.md) and says in as many words
   that *"a store that quietly answered nothing for ever would look exactly like a store nobody had
   wired up, and the only other symptom is a larger bill."* That is the failure we had. It never
   fired, because the read did not throw — it succeeded and returned an empty map, every time, for
   the whole life of the feature. Logging `{ asked, found }` at info on every read turns *"every retry
   ever found zero"* into one log query, and costs one line per step. `generateHierarchy` has the
   same shape at the other end: `labelsResumed` is printed only when it is greater than zero
   ([`src/hierarchy.ts`](../../src/hierarchy.ts)), so the number that would have shown the feature was
   dead is precisely the one suppressed. **The instrumentation existed at both ends and was pointed at
   the interesting case being present rather than absent.**

3. **Put the promise beside the code that grants it.** Three files asserted that `articleId` is stable
   across attempts and none of them was `src/jobs.ts`. What shipped moves the reasoning to
   `slugForRetry`, where a future change to slug allocation has to walk past it, and names the test
   for the promise (`retry-keeps-the-checkpoints`) rather than for the mechanism. The rule worth
   carrying: where a value is *consumed*, a comment should name what it is relying on and who owes it;
   where it is *minted*, the comment should name who is relying. Only the second one can go stale
   loudly.

4. **Not built, and nobody's blocker: `sweepAbandonedDrafts` has no callers at all.** It is defined at
   [`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts) and a repo-wide grep finds every
   other mention of the name to be a comment or a plan — twenty-eight files reason about what it
   spares, thirteen of them TypeScript, and not one of them calls it. Checked 2026-09-04, on `dev`.
   So failed drafts accumulate without bound, and the sweep that several
   comments treat as the backstop for a job that goes terminal still holding a pointer is not running.
   Filed here because it was found on the way and belongs in the record, not because it is urgent: it
   is disk, it is not a correctness bug, and it is not this job. It is also the same shape as the bug
   above — a mechanism whose absence is invisible because everything that depends on it merely
   *mentions* it.

## Decision 8 still stands, and matters less after this than it did when it was made

Carrying a failed attempt's **draft** across a retry is not a new idea to propose here. It is decision
8 of [260831b-finish-the-database-move.md](../plans/260831b-finish-the-database-move.md) — *"A failed
refresh starts over. Do the simple thing now"* — deferred by Greg on 2026-08-31, with the design kept
in that plan's *Appendix: someday maybe*. It has not changed.

What is worth recording is where the decision came from, because it is the same list. **Decision 7,
one line above it, is the short id.** The two were taken the same day, about different things, and the
appendix explains why deferring 8 was cheap:

> The per-chunk PDF checkpoints already hold the expensive part … Making them durable would recover
> most of the value of this idea for a fraction of the work.

So decision 8 was affordable *because* of a substitute that decision 7, its immediate neighbour, had
just made unreachable — and neither decision was in a position to notice, since one was about renaming
and uniqueness and the other about failed refreshes. That is the borrowed key again, at the level of
the decision record rather than the code.

Decision 8 now matters less than it did, for a reason that can be checked rather than assumed. Of the
default ingest — `fetch, extract, blocks, hierarchy, assets` — only `extract` (for PDFs) and
`hierarchy` make paid calls, and the expensive half of each is checkpointed. Fail in `extract` and
carrying the draft saves nothing; fail in `hierarchy` and it saves seconds of deterministic work; fail
in `assets` and it saves one un-checkpointed outline call. That is the whole marginal value, against a
draft-and-revision seam every job shares. Adopting the slug recovers the article and the checkpoints
and leaves the draft a fresh empty one — `openOrBeginJobDraft` finds a draft only via *this job's*
`draft_revision_id`, and both failure paths null it — so the two really are separable, which is what
makes leaving 8 deferred a choice rather than an omission.
