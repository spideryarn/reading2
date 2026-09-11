# Periodic work, and the fact that we have nowhere to run it

Up: [dev-and-deployment-overview.md](dev-and-deployment-overview.md).

**There is no scheduler.** Nothing in this app runs on a clock. Every line of code in `src/` runs
because a reader made a request, a pipeline stage was invoked, or an agent typed a command. There is
no cron in [`vercel.json`](../../vercel.json), no worker, no queue drain, no nightly anything.

That is a perfectly reasonable state for a beta to be in, and this doc is not an argument for
changing it. It exists because **the absence has started producing a recognisable kind of dead
code**: a sweeper gets written at the moment somebody understands the mess it would clean up, it
cannot be wired to anything, and it is left in the tree with careful comments describing behaviour
that never happens. The next reader believes the comments.

## The shape of the bug this causes

Twice now, and it is the same shape both times: **a mechanism that is reasoned about rather than
run.**

- **[`sweepAbandonedDrafts`](../../src/store/pg-revisions.ts)** — defined, and called by nothing
  until 2026-09-11, when it was wired as below. An exhaustive grep over `src tests scripts evals api` returns the definition and about twenty
  comments. [`src/store/pg-jobs.ts`](../../src/store/pg-jobs.ts) reasons in detail, twice, about what it does to a draft —
  *"spares a revision that any job row names"*, *"a draft it spares for ever"* — and design around
  it. The consequence is storage rather than tidiness; `sweepAbandonedDrafts`'s header records the
  copied payload a crashed worker can leave behind and a dated size example. A compatibility file,
  `src/store/revisions.ts`, repeated that consequence until it was deleted on 2026-09-10.
- **`sweepable`/`SWEEP_GRACE_MS`** ([`src/source.ts`](../../src/source.ts)) — the same. The predicate
  exists and is correct, and `acquireUpload` in [`src/pipeline.ts`](../../src/pipeline.ts) explains
  in a comment that it deliberately does *not* delete a staging object because *"staging litter is
  swept later, after `SWEEP_GRACE_MS`"*. Nothing sweeps later. The three hits for `sweepable` outside
  its own file are all prose.

Both were found on 2026-09-06 by the sweep in
[260906i](../plans/260906i-sweep-for-missed-work-across-feedback-reports-worktrees-and-sessions.md).
Neither is a bug in the function; both are correct code with no caller.

**So the rule, until there is a scheduler: do not write a sweeper you cannot call.** Either wire the
cleanup into a path that already runs, or leave the mess and write down that you are leaving it. A
third option — write the function, describe it in comments, and call it nothing — is the one that
has happened twice and is the worst of the three, because it reads exactly like a solved problem.

## What we do instead, for now

**Abandoned drafts are swept on demand.** Greg, 2026-09-06, asked what to do about the sweeper that
has never run:

> Ignore for now - we'll sweep on demand.

On demand means: when an article next runs a step, that article's old drafts go. It needs no
scheduler, it is self-limiting, and it has the property that an article nobody touches keeps its
drafts — which is also the article that is not growing. This records the decision so that nobody
re-opens the choice.

**Implementation status, 2026-09-11: wired, counting, not yet deleting.**

- `openOrBeginJobDraft` ([`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts)) calls
  `sweepAbandonedDrafts` on the branch that mints a draft — the first step of every job — for the
  article it has just locked, by id. Never the whole library.
- An abandoned draft is `draft` or `failed`, older than `ABANDONED_DRAFT_MS` (six hours, the value
  it had before it was deleted on 2026-09-01), named by no job row, and no article's current
  revision. `abandonedDraftCondition` is that definition, and the inventory script imports it.
- At most `DRAFT_SWEEP_BATCH` (ten) per job start, oldest first; a longer backlog clears over the
  article's next few jobs.
- Protection is rechecked under a row lock, so a job pointer that appears between counting and
  deleting spares its row. A sweep that fails is rolled back to a savepoint and the step goes ahead;
  it is logged after the commit, as is every non-empty sweep.
- **`STEP_START_DRAFT_SWEEP` is `"count"`**: every job start runs the real selection and logs what
  it would have taken, and deletes nothing. Deploying with `"delete"` would be the first destructive
  run against readers' data, so flipping it is Greg's approval, made after reading
  `npx tsx scripts/draft-sweep-inventory.ts` (read-only) against production. Until then this is
  measured retention, not operated retention.

The reasoning, the race tests and the local measurements are in
[260908f](../plans/260908f-prioritised-spideryarn-codebase-improvements.md) § O.

The general form of that answer is the one to reach for first: **attach the periodic work to a
request that is already happening on the same object**. It costs nothing to run, it cannot drift out
of sync with deploys, and it degrades into "nothing happens", which is the state we are already in.

## When a real scheduler would be worth it

Not yet, and here is what would change that. These are the jobs that exist or are wanted today and
that on-demand cannot reach, because there is no request they could hang off:

| the work | why on-demand does not reach it |
|---|---|
| staging-upload litter in Supabase Storage | the object belongs to an upload that was *abandoned*, so by definition no later request touches it |
| orphaned blobs after a permanent article delete | the article is gone; nothing will ever ask about it again — see the delete work in flight, 2026-09-06 |
| re-running a pipeline stage across the library after a prompt change | nobody is waiting, and doing it inside a reader's request would charge one reader for everybody's backfill. The `toc/6` gist-length change of 2026-09-06 is the live example: it reaches new articles only |
| anything that should notice a **stuck** job | a job that stopped is exactly the one with no next request |

**If it is built, the boring option is a Vercel cron** hitting an authenticated route — one entry in
`vercel.json`, no new infrastructure, and it runs where the code already runs. That fits
[vision.md § Principles](vision.md#principles) better than a worker or a queue, and it should be
weighed before anything with more parts. The two things to decide with it are what stops two
invocations doing the same work at once — [ingest-queue.md](ingest-queue.md)'s claim-and-lease
pattern already answers that shape, so copy it rather than inventing a second one — and how a run
that fails silently becomes visible, which is [silent-success.md](../reusable/silent-success.md)'s
whole subject.

**What is not the answer: a cron in an agent's session.** That has been tried and it fails quietly —
a session cron dies with its session, and the only evidence is a gap in a log nobody is reading. The
loop in [feedback-reports.md](feedback-reports.md) runs that way today and is watched by a person
for exactly that reason.

**That half is being fixed, and it is not this doc's half.** The Overseer's daemon is growing an
interval scheduler under `systemd` with `Restart=always`
([overseer-direction.md § The scheduler](overseer-direction.md#the-scheduler)), and the agent-fleet
jobs — the feedback sweep, `get-ready-to-deploy`, the weekly codebase trawl — move onto it and off
the session cron. **It is deliberately not the app's scheduler and must not become one.** It runs on
the box, it may not depend on anything under `src/` or on the product database, and none of the four
rows in the table above is reachable from it: they are all about a reader's data, and the box is the
wrong place to touch that from. The row that says the box *"should not become its scheduler"* in
[hetzner-remote-server-box.md](hetzner-remote-server-box.md) is unchanged by any of this.

## See also

- [ingest-queue.md](ingest-queue.md) — the claim, the lease and the attempt token: how work that
  must not run twice is already handled here
- [database.md](database.md) — where drafts and revisions live
- [architecture.md](architecture.md) — the stages, and what a re-run of one costs
- [hetzner-remote-server-box.md](hetzner-remote-server-box.md) — the always-on box, which is not the
  app and should not become its scheduler
