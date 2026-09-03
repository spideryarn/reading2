# Two design calls on the stage CLIs, and one on the plan's new shape

You are reviewing work in `/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag`, a git
worktree of the Spideryarn repo. Read `CLAUDE.md` there first — especially **"Prefer simple over
easy"**, **"Simplest version first"** and **"Every stage stays runnable on its own"**, which are the
principles these calls have to be settled against.

The plan is
`docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md`. You have reviewed
it twice already (`…-review-sol.md`, *not ready*; `…-review-2-sol.md`, *ready with changes*). Both
sets of changes are in, all three pre-build spikes you asked for have run, and each moved the plan.
**Read stage E and the contract under it before answering** — the spike's findings are recorded there.

Greg was asked three product questions. He answered the first himself and handed the other two back:

> **"Use your judgment — get input from GPT Sol if needed, aiming for simple/clean/long-term-best."**

So these are genuinely open, and I want your view rather than your ratification. **Argue against my
recommendation where you can.** If you think a question is malformed, say so.

---

## Background you need

We are deleting `SPIDERYARN_STORE` and the filesystem store. Six standalone pipeline-stage CLIs
(`npm run fetch|extract|pdf|blocks|hierarchy|labels`) still write filesystem artefacts. Greg decided
they move to Postgres rather than being deleted, because `AGENTS.md` requires every pipeline stage to
stay runnable on its own against a slug.

The spike established (all verified against local Postgres, not reasoned):

- **None of the six touches `src/store/artifacts-fs.ts` or `src/store/data-root.ts`.** Each does a
  bare `fs.writeFile` to a path off `process.cwd()`.
- **The CLI cannot stay in the stage module.** Every Postgres artefact write is fenced on a running
  `jobs` row plus a draft revision (`requireLiveJobOwnsDraft`, `src/store/pg-session.ts`), so a
  standalone run must reach `src/jobs.ts` — and `jobs.ts` → `pipeline.ts` → `blocks.ts`, so a
  `main()` reaching for the queue from inside a stage closes a cycle that `npm run check` gates on.
  The prototype is therefore one script for all six: `scripts/stage.ts` (present, uncommitted).
- **It works.** `blocks --force` twice then unforced, on a real article: 19 blocks, 0 minted, 19
  kept, three revisions, one distinct id set; unforced correctly `skipped`.

---

## Question 1 — what happens to `npm run labels`

`STEP_ORDER` in `src/pipeline.ts` is `fetch, extract, blocks, hierarchy, assets, arc, tweets,
glossary, …`. **There is no `labels` step** — labelling is produced *inside* the hierarchy step
(`generateHierarchy` returns `parts.labels`). So unlike the other five, `npm run labels` has nothing
to move to. (`pdf` is also absent from `STEP_ORDER`, but it has an obvious home: it is a branch
inside `extract`, and the CLI becomes an upload plus `{ upload, steps: ["extract"] }`. `labels` has
no such home.)

What `npm run labels <dir>` does today: reads `tree.json` and `blocks.json`, re-runs the labelling
model call, writes `labels.json` and `tree.json` back.

- **(i) Retire it.** Re-labelling becomes `npm run hierarchy -- <slug> --force`, which also re-cuts
  the structure and so costs one extra model call. `generateLabels` stays exported for `evals/`.
- **(ii) Add a real `labels` step to `STEP_ORDER`**, re-labelling an existing tree in place without
  re-cutting. Cheaper per run, but the pipeline then carries a step that a normal ingest never runs
  — and `DEFAULT_INGEST_STEPS` would have to exclude it.
- **(iii) Keep it filesystem-only.** Not available: stage G deletes the files it reads.

**My recommendation is (i).** My reasoning: it is a debugging tool for one stage's second half, the
extra structure call is the honest price of not carrying a step nobody ingests through, and a step
in `STEP_ORDER` that never runs by default is a trap for the next person adding one.

**Argue against it.** In particular: is there a case that (ii) is the *simpler* long-term shape
because it makes the pipeline's steps match the artefacts one-for-one, rather than one step
producing two artefacts? Read `docs/project/hierarchy.md` and
`docs/project/architecture.md` § Stage ownership before answering — the "Hierarchy and the
granularity-zoom tree are the same structure, produced by stages 4 and 5 together" rule in
`CLAUDE.md` may bear on this and I may be missing its force.

---

## Question 2 — does `npm run fetch -- <url>` now put an article on the shelf

Today it writes files and nothing on the shelf changes. The plan records that running it by hand is
how the queue's fetch step gets satisfied in practice, so this is a live workflow.

Driving the queue means it necessarily creates an `articles` row.

- **(i) `enqueue({ url, steps: ["fetch"] })`** — routes through `freeSlug`, so it adopts an article
  the reader already has for that URL, or creates one that then sits on the shelf with nothing
  readable in it yet.
- **(ii) Make `npm run fetch` the whole default ingest** — exactly what pasting the URL into the add
  box does — and drop "fetch alone" as something you can ask for from a terminal.
- **(iii) A flag that creates the row and removes it again** if only `fetch` was asked for.

**My recommendation is (i)**, on the grounds that it preserves the workflow and that a half-ingested
article visible on the shelf is better than invisible files. I rejected (iii) as a special case in
the queue existing for one command.

**Argue against it.** Specifically: **is a shelf entry with nothing readable in it a bad reader-facing
state?** Look at what the shelf does with an article whose revision has only `raw` — `src/store/pg-shelf.ts`,
`docs/project/library.md`, and whatever the ingest card does. If the answer is that it renders as a
broken or confusing row, (i) is worse than I think and I would like to know before building it.

Also: there is an **unrelated bug** the spike found and I would like your read on where it should be
fixed. `enqueue` (`src/jobs.ts`, the ownership check) refuses only when a slug is *somebody else's*.
A slug that exists nowhere is treated as claiming a name, so `npm run blocks -- typoo` creates an
`articles` row and a failed revision and leaves the wreck on the shelf. Reproduced, then cleaned up.
The prototype guards it in the script with an `articleExists` pre-check. **Should the fix be in
`enqueue` itself** — a slug-only request refusing a slug that does not exist — **and if so does that
break the route path?** That is the question I actually want answered; the script-level guard is a
plaster.

---

## Question 3 — sanity-check the plan's new shape

Greg decided to **absorb `docs/plans/260903e-a-private-test-database-so-the-suite-stops-racing-dev-servers.md`
stages B–E into this plan** (its Stage A is already on `dev`). The reason: 260903f needs that
machinery for three separate things — the ledger isolation in stage C, the suite-registration
abstraction in D′2, and the mandatory database preflight in § *Making the database required* — and
the two plans were about to build two per-test-file manifests and two lane mechanisms that would
disagree.

Read both plans' stage lists. **Is the merged stage order in 260903f's status block right?** It is:

> A (manifest) → T (private test database) → B0 (seed lock) → spike `pdf` → C → B → D → D′1b–3 → E →
> F (hinge) → G → H → I

Two things I am unsure about and want you to attack:

1. **Is putting T that early correct**, or does it front-load 6–10 hours of infrastructure before any
   of this plan's actual subject has moved? The counter-argument I can see is that B (converting
   ~80 route suites) is the bulk of the work and does not strictly need T — it needs a database, not
   an isolated one — so B could run in parallel with T and the merge cost paid later.
2. **Does merging the two manifests into one file with two columns actually work**, or are
   "which store does this test touch" and "which lane does this test belong in" different enough
   questions that one file makes both harder to read? I claimed they are the same verdict over the
   same ~200 files. Check that against 260903e's Stage C, which lists specific lane exceptions
   (`tests/auth-user-seeding.test.ts`, `tests/seed-admin-signin.test.ts`, `tests/admin-store.test.ts`
   in the shared-services lane).

---

## How to answer

Short. A verdict per question with the reasoning that actually decided it, not a survey. Where you
disagree with me, say so plainly and say what you would do instead. Where you think I have asked the
wrong question, reframe it.

You may run one or two test files or a read-only script if it would settle something — a finding you
reproduced outranks one you reasoned to. Say what you ran. Do not modify any file, and do not commit.
