# Second pass: the restaged `SPIDERYARN_STORE` deletion plan

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag` (branch
`worktree-delete-store-flag`). Read `AGENTS.md` at its root first.

- **The plan (revised):** `docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md`
- **Your first review, which returned *not ready*:** `docs/plans/260903f-delete-the-spideryarn-store-flag-review-sol.md`

You wrote that review. **This pass is not to confirm it was followed** — that is easy to check and
is not where the risk is. It is to find what is *still* wrong now that the shape has changed.

## What changed in response to you

- **Stage A added**: a checked-in manifest classifying every candidate test into your three
  categories, with a recorded reason for each file excluded as safe, policed by a test.
- **Adapter-behaviour tests now die in the same commit as their subject** (stage G), not early.
- **The hinge narrowed** (now stage E). Moved out: `guardDbStore` self-wrapping → D′ (additive,
  before), readiness infrastructure → D′ (built and tested before, hinge only activates),
  `attempt` tightening → H (with the `appendSpoken` return-type split first), glossary → D′.
- **Ledger isolation is its own stage C** with your five acceptance criteria.
- **Fixture loader is stage D, explicitly two tools**, with `load-article`'s real-publication path
  preserved.
- **Stage F added**: the stage CLIs move to Postgres before the adapters are deleted.
- **Stage I added**: tombstone retirement post-deployment.
- **The negative control** now requires all five of your conditions.
- Counts re-derived in this worktree and dated; `vite.config.ts` added as the 19th site.

## Greg's two decisions, now settled

1. **The glossary's "start over" leaves the alpha** rather than getting a Postgres implementation.
   Note your finding that the blocking product question was stale is recorded in the plan anyway.
2. **The stage CLIs move to Postgres** — the runnable-on-its-own rule in AGENTS.md stands.

## What I want from this pass

1. **Is the stage order now correct?** A → B → C → D → D′ → E (hinge) → F → G → H → I. In
   particular: is D′ genuinely safe to land before the hinge, and is F correctly placed before G?
2. **Is anything still in the hinge that should not be, or still missing from it?**
3. **Stage A is doing a lot of load-bearing work.** Is a manifest-policed-by-a-test actually
   sufficient to stop a file being silently mis-classified, or is that guard the kind that agrees
   with the bug?
4. **What is the first thing you would build**, and is there a cheap early stage that would surface
   a wrong assumption before much is invested?
5. **Anything factually wrong**, or any count that has drifted again.
6. **Anything you would now argue we should NOT do**, having seen the full shape — including
   whether any stage is not worth its cost.

## How to work

Read-only; do not edit files. You may run a single test file (`npx vitest run tests/<one>.test.ts`)
or a `node --import tsx` script; do not run `npm test` or `npm run typecheck`.

Verdict: ready to build / ready with changes / not ready. Concrete and brief.
