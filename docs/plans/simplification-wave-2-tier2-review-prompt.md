# Code review: Tier 2 as built

You are reviewing **built and committed code** in the repository you can read. This is the second
review of this work and the project weights it higher than the plan review, because a plan-stage
review cannot catch a fix that is wrong in the code. Your plan-stage review already earned that
weighting once today: it found that an AST gate of mine gave a *false* guarantee rather than a weak
one, and fixing it then found a second file in the same shape.

## What to read

Three commits, all mine. Read them with `git show`; do not review anything else in the diff range,
because the branch is shared with about eleven other sessions committing in parallel.

| commit | what it is |
|---|---|
| `984464e` | `collectCitations` — the one part of **2.3** you cleared to build today |
| `d5a4e03` | **2.1** `useStepJob`, plus a `lastFailure()` ref in `useJobs` |
| `a547ca3` | **2.5** `isMain` and `stageCli`, 18 entrypoints migrated, the AST gate rewritten |

Context, in order of usefulness:

- [`docs/plans/simplification-wave-2.md`](simplification-wave-2.md) — the plan. `## Tier 2` and the
  three dated sections above it record what changed and why.
- [`simplification-wave-2-tier2-input-sol.md`](simplification-wave-2-tier2-input-sol.md) — your own
  design answer from earlier today. `984464e` is your 2.3 recommendation carried out; check whether
  it is what you meant.
- [`simplification-wave-2-tier1-review-sol.md`](simplification-wave-2-tier1-review-sol.md) — your
  Tier 1 review, whose findings are all fixed.
- `CLAUDE.md` and [`docs/reusable/silent-success.md`](../reusable/silent-success.md) — the rules
  this work is meant to obey.

## The eight questions I most want answered

Rank by risk. I would rather have one confirmed defect than eight maybes.

1. **`stageCli` changed when `.env.local` is read.** It was inside `main()`; it is now inside
   `stageCli`, before `withLedger`. The subagent argued the hazard is *structurally* absent — the
   tail runs at the bottom of the module, after every import and every module-scope statement, so
   anything reading `process.env` at import time already ran before either version of the call.
   **Is that argument sound for all 18 migrated files, including the five in `scripts/` and
   `evals/`?** Name a file where it fails, or say it holds.

2. **The gate now accepts two tails, and that is where a gate goes soft.**
   `tests/paid-cli-ledger.test.ts` dispatches on whether a file imports `stageCli`. So a file could
   get the *wrong* dispatch and be checked by the lenient branch. Can you construct a paid CLI that
   passes the gate and still spends outside the ledger? Try at least: an import of `stageCli` that
   is never used, both tails present, a re-export, an aliased import, a dynamic `import()`, and a
   `stageCli` imported from somewhere other than `./cli-ledger.js`.

3. **`stageCliOffence` checks `stageCli` itself, and it is the only thing standing behind the other
   22 checks.** If it can be beaten, every "the entrypoint is `stageCli`" verdict becomes worthless.
   Read it adversarially. Is "guard, then env, then wrapper, by position" actually what it enforces?

4. **`isMain` gained a `realpathSync` fallback that none of the ten guards it replaces had.** That
   is new behaviour, not a consolidation. Can it make a module answer **true** when it should answer
   false — two paths that realpath to the same file but are not the same entry? What does it cost on
   a cold NFS or a deep symlink chain, given it runs once per process at startup?

5. **`useJobs.lastFailure()` is a ref read after an `await`.** Under React 18 StrictMode, concurrent
   rendering, or two surfaces mounted at once (glossary and ideas bands both open), can one
   surface's failure be read by the other? `useJobs` is called once per surface — confirm whether
   each gets its own ref or whether anything is shared.

6. **`collectCitations` takes the caller's `Map` and mutates it.** Check the two call sites still
   accumulate over the same span they used to — `converse` hoists `citations` above a *round* loop
   and `explain` does not have rounds. Did the extraction change what a page cited in round one does
   in round two?

7. **`useStepJob` collapsed `postFailed: boolean` plus a separately-read reason into one
   `{ reason }` state.** Is there a sequence — two presses, a press during a running job, an
   unmount — where the new single value is wrong in a way the old pair was not?

8. **Which claim in the three commit messages is weakest?** Answer this one even if you find nothing
   else. Last time your answer to it was my own `.env.local` gate, and you were right.

## What I already know, so do not spend effort re-finding it

- `docs/project/web-client.md:536` still documents reading `queue.error` at render, which `d5a4e03`
  makes the wrong answer. The file has another session's uncommitted work in it, so the fix waits.
- `src/web/Tweets.tsx` is the fourth caller of the `useStepJob` shape and still hand-rolls it,
  including the `queue.error` bug. Same reason.
- Five entrypoints — `arc`, `glossary`, `ideas`, `summarise`, `toc` — are not migrated to `stageCli`,
  for the same reason. The gate accepting both tails is deliberate and temporary.
- `converse`'s citation collection has no end-to-end test; every `url_citation` in `tests/` is in
  `tests/explain.test.ts`. I know. Tell me if you think it is more urgent than it looks.
- The plan's "~120 lines" for 2.1 was wrong; it is 53 code lines and the raw count goes up. Already
  corrected in the plan.
- `npm test` and `npm run typecheck` are red in this tree from other sessions' in-flight work.

## How to answer

- Verdict first, then findings ranked by severity, then the eight answers.
- **Check each finding against the actual code before reporting it.** Some of your Tier 1 findings
  were right about production and wrong about this tree — one proposed a `fetchOk` migration that
  reddened two tests because that suite mocks the module the helper closes over. I would rather you
  say "I could not confirm this" than report it flat.
- Where you think something should be **reverted or left**, say so plainly.
- Do not edit any file. The tree is shared and moving.
