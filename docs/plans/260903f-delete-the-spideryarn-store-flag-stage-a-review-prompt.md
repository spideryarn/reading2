# Review: stage A and stage D′1 of 260903f, as built

You are reviewing code in `/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag`, a git
worktree of the Spideryarn repo. Read `CLAUDE.md` and `docs/reusable/silent-success.md` first — the
second is this codebase's chronic failure class and is what most of this work is about.

The plan is `docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md`. You
have reviewed it three times (*not ready* → *ready with changes* → the stage-CLI decisions memo). All
of your changes are in. **This is the first code review of what was actually built**, and the repo's
own rule says to weight it higher than the plan-stage ones, because a plan review cannot find a
`PATCH` that writes one field and then rejects the request.

## What landed

Four commits on `dev`: `e8f27caa`, `55c76d11`, `16e78bfc`, `4900c89e`.

**D′1 — guard every Postgres store at its export.** `guardDbStore` made idempotent; the fifteen
index-selected seams moved to guarding at their own export; a `SCRUBBED` mark so a guarded store
calling another guarded store logs once; `MissingAttempt` and three sibling refusals given a `status`
and stripped of the slug in their messages; `pgGlossaryStore` (which arrived from another worktree
mid-stage, unguarded at export) fixed, and a shape-based assertion added so the next one is caught
rather than merely absent from a list.

**Stage A — the migration registry.** Two witnesses (a real import-graph walk, and an instrumented
full-suite run recording which test files *actually* reach the filesystem store), a 93-entry
classified registry, and a guard test.

## The diff

`/tmp/claude-1000/-home-greg-code-spideryarn2/225d6eb2-0057-42cc-8a0a-ae321540a3b5/scratchpad/diff-guards.txt`
is the D′1 diff (src/ and tests/ only, both commits). For stage A read the files directly:
`tests/store-migration-registry.ts`, `tests/store-migration-registry.test.ts`,
`tests/store-migration-witness.json`, `scripts/store-migration-candidates.ts`.

**Run things.** `npx vitest run tests/store-guarded.test.ts tests/store-guard-idempotent.test.ts
tests/db-error-scrub.test.ts tests/store-migration-registry.test.ts` is the core of it and takes
under a minute. A finding you reproduced outranks one you reasoned to. The box is shared and busy;
other agents' suites go red around you and those failures are not this work.

## What I most want attacked

**1. The error-boundary changes, hardest.** `src/store/db-errors.ts` is a security boundary with a
written history of five rounds of getting it wrong, and this stage changed it three ways:

- The **early return** on an already-guarded store. Is there a case where handing back the same
  object is wrong — a store legitimately wanting two different seam names, say?
- The **`SCRUBBED` mark** letting an already-scrubbed error through the next guard. It uses
  `Symbol.for`, which is a *global* registry. Is that a hole? Can an error acquire this mark without
  having been through `scrubDbError`? What happens to the stack, and to `code`?
- **Seven refusals moved to door 1** (`status`) with the slug removed from their messages. I removed
  the slug on the grounds that the file's own rule — *"a `status` is not a licence to leak"* — plus
  its ban on messages that can carry a URL, covers a slug, since a slug is a path segment derived
  from a title. **Is that right, or is it over-cautious in a way that costs an operator the one fact
  they need?** The caller already knows the slug; the log's request fields carry it. Argue it either
  way, but say which.

**2. The registry's guard, and whether it can actually fail.** `tests/store-migration-registry.test.ts`.
Its central assertion re-derives the static universe by running `scripts/store-migration-candidates.ts`
as a subprocess every run — 17 seconds, uncached. I watched four deliberate breakages redden it. But
**a check that passed four planted failures can still be blind to a fifth**, and this one's shape is
two set-differences, which are empty when their inputs are empty. There are three controls guarding
exactly that. **Find the fifth thing it cannot see.**

Specifically: is *"every static candidate is in the registry, or the witness says it touched nothing,
or the witness says it is unresolved"* actually closed? Is there a way for a file to be
condemned-module-reaching and yet appear in none of the three?

**3. The classification itself, spot-checked.** 93 entries in four categories. The fourth,
`shared-mechanism-collateral`, means "this file never chose the filesystem store; a shared mechanism
dragged it in, and some other stage resolves it without anybody editing this file". The rule applied
was: collateral only if **every** recorded site is incidental. **Pick three or four entries, read the
test files, and tell me whether the verdicts are right.** I would particularly like
`tests/store-pg-session.test.ts`, `tests/store-roundtrip.test.ts`, and any two
`shared-mechanism-collateral` entries you distrust. A wrong verdict here becomes a deleted test later.

**4. The witness's honesty.** `tests/store-migration-witness.json` says 88 files touch the filesystem
store. It has one recorded blind spot (a file that loads a module under a second id, which the
instrument cannot see by construction). **Is one blind spot plausible, or does the instrumentation
approach have others it has not noticed?** Read `tests/setup/fs-store-witness.ts`. What else could
execute filesystem-store code without going through an instrumented export?

## Two specific worries of my own

- I kept `guarded()` in `src/store/index.ts` calling `guardDbStore` **redundantly** now that every
  store self-guards, on the grounds that the early return makes it free and a store added tomorrow is
  wrapped even if its author has read none of this. **Is that belt-and-braces, or is it the kind of
  redundancy that rots into confusion?**
- `tests/store-migration-witness.json` is a **dated measurement** checked into the repo, and the tree
  moves under it — it counted 588 test files and the graph walk saw 597 ninety minutes later. The
  guard handles new arrivals by requiring `evidence: "static-only"` on them. **Does that degrade
  gracefully, or does it quietly become a rubber stamp as the gap widens?**

## How to answer

Short, and ranked by what actually matters. Say plainly where I am wrong. Where you think something
is fine, one line is enough — I would rather have three real findings than fifteen observations.
Name the file and line for anything concrete. If you run something, say what and what it said.

Do not modify any file, and do not commit.
