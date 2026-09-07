# Review: a plan for a "re-run this stage" control on the Metadata page

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode`, branch
`worktree-worktree-rerun-a-mode` (a git worktree of the shared repo; trunk is `dev`). TypeScript +
ESM, run with `tsx`, React 19 client under `src/web/`, Postgres + Supabase Storage as the only
store, vitest. **This is a review of a plan, not of code — nothing has been built.**

## The candidate

Committed: `bcb7bcd8` (single commit, adds one file)

```
git show bcb7bcd8 --stat
git diff bcb7bcd8^..bcb7bcd8
```

changed paths: `docs/plans/260907d-re-run-any-generated-mode-from-the-metadata-page.md` — one new
file, 449 lines. That is the whole candidate.

Start with that plan doc. This is where to begin, not the limit of scope: the code it describes is
in the tree and you should read it.

The files the plan reasons about, so you can check its claims rather than take them:

- `src/web/Metadata.tsx` — the page. § `SOON` (~line 300), § `TechnicalDetails` (~1434),
  § `StageRow` (~2225), § `STAGE_ICONS` (~250).
- `src/web/useStepJob.ts` — the client's existing "run one step and watch it" hook.
- `src/web/JobProgress.tsx` — the shared run/stop/retry row.
- `src/web/Tweets.tsx` § `Rewrite` (~line 678) — the two-click confirm the plan copies.
- `src/pipeline.ts` § `FORCE_ONLY_WHEN_NAMED` (~394), § `isStepName` (~3964), § `STEPS` (~1797).
- `src/step-order.ts` § `STEP_ORDER`.
- `src/jobs.ts` § `cascadeForce` (~774), § `unrunnableStepPlan` (~813).
- `src/store/pg.ts` § `articleMetadata` (~2466–2620) — the per-step `isCurrent` switch.
- `src/store/pg-revisions.ts` § `failRevision` (~2072), § `failRevisionIn` (~2120);
  `src/store/pg-session.ts` (~19–52) — the settlement state machine.
- `src/types.ts` § `StageState` (~1790), § `ArticleMetadata` (~2015).
- `src/web/GlossaryPanel.tsx`, `src/web/SketchView.tsx`, `src/web/IdeasPanel.tsx`,
  `src/web/QuotesPanel.tsx` — the existing in-mode regenerate affordances.
- `docs/project/ingest-queue.md`, `docs/project/billing.md`, `docs/project/ai-gateway.md`,
  `docs/postmortems/260905f-a-tightened-tree-rule-wedged-every-article-that-already-broke-it.md`.

## What it is meant to do

Greg, 2026-09-06, having declined a library-wide backfill after a prompt change:

> Leave it, new articles only. Although i think there should be a way to re-run any of the generated
> modes (either within the UI for the mode, or perhaps in the Metadata section) - I realise this is a
> new piece of work, but it's important, so perhaps fan this out as its own thing

So the deliverable is a control that asks for one pipeline step to be generated again, on an article
that already has it. The plan puts it on the Metadata page's existing stage rows, one per eligible
step, as a two-click confirm that posts `{ slug, steps: [step], force: [step] }` to the job queue
that already exists.

**The invariants it must not break:**

1. **A failed re-run must leave the previous, good artefact in place.** Draft-then-publish.
2. **One press must buy exactly one model call.** No force cascade, no second job, no double-press
   starting two.
3. **Nothing on that page may claim an artefact is stale.** The page's own docstring makes that
   refusal explicitly, and a confident wrong verdict there is worse than no verdict.
4. **A control that can only fail must not be offered** — a rule the page already applies twice.

**Deliberately out of scope**, and the plan says so: staleness detection / provenance hashing, a
library-wide backfill, scheduling, a before/after diff, any new in-mode control, and any
replace-the-glossary path.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`). You have **no
network, not even loopback**, so anything touching Postgres will fail — that is most of this repo's
integration suites. `npx vitest run tests/doc-links.test.ts` and `npx vitest run tests/jobs.test.ts`
should work and are worth a go if you want to check a claim about step ordering or doc anchors.

Nothing has been built, so there is no failing output to hand you. The plan's factual claims about
the code are the thing to check, and they are checkable by reading.

## Attack it

Independently, before you read my questions below.

**The invariant most worth trying to break: that this plan's button can spend more of our money than
one model call per press, or can leave an article worse than it found it.** Second most worth
breaking: that the set of steps it offers is the right set — that no offered step can only fail, and
no withheld step is one Greg's sentence plainly asks for.

For each finding give:
- an ID (`F1`, `F2`, …), a severity (P0/P1/P2/P3), and whether it is **established** or **reasoned**
- (a) the concrete scenario the plan does not handle, or the authoritative contract in this repo it
  contradicts — with the file and line
- (b) the smallest change that closes it: exact replacement wording for the plan

A finding with no (a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Grade by consequence, not by the file: a defect in this doc that will cause a P1 to ship is not a P3
because it is made of prose.

Refuse only on an **established** P0 or P1 — direct evidence with no unresolved material inference —
and name what established it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.
Spend most of the run elsewhere.

1. **The offered set.** I chose `FORCE_ONLY_WHEN_NAMED` (arc, tweets, glossary, quotes, ideas,
   timeline, quiz, sketch, illustrated, debate) plus `hierarchy`, and excluded `blocks`, `fetch`,
   `extract`, `labels`, `assets`. Is `hierarchy` safe to offer as a single-step forced run — does
   `{ steps: ["hierarchy"], force: ["hierarchy"] }` really re-cut the tree and run nothing else, and
   does it really leave `labels` and every stamped mode to re-run lazily rather than stranding them?
   Is excluding `labels` right, given that a re-cut tree invalidates them and nothing then rebuilds
   them until something asks?

2. **The confirm sentence** — *"Another model call. What is here now is replaced only if the new one
   succeeds."* Is the second clause actually true for every step on the list, or is there a step
   whose write is not inside the draft?

3. **Eleven `useStepJob` mounts on one page.** Each subscribes to the shared job engine. I claim
   this costs eleven store subscriptions and not eleven polls. Is that right, and is there a
   re-render cost I have not counted — `useNow`, the `announced` set, the `onFinished` callback
   identity?

4. **`onFinished`.** Every existing caller passes a read's `refresh` so a finished job reloads the
   artefact. The Metadata page has no artefact to reload — it has `provenance`. I have not said in
   the plan what `onFinished` should do here. Is refetching `/api/metadata/:slug` right, and is
   there a race with `useOrderedRead`'s `refresh`/`reload` distinction that applies?

5. **The glossary row.** Forcing `glossary` appends rather than replaces. I label that row *Find
   more terms*. Is there any other step on the list whose forced behaviour is not "replace"?

6. **The `blocks` exclusion.** I excluded it because `unrunnableStepPlan` would 400 a lone
   `{ steps: ["blocks"] }`. Would sending `{ steps: ["blocks", "hierarchy"] }` be better than
   excluding it — and would that then be two model calls per press, breaking invariant 2?

Do not change any file.
