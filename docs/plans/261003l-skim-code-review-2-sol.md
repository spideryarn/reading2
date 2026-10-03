F7 is **closed**. The stated code guarantee is accurate:

- The cap is based on kept stops first placed at each depth.
- Capacity is consumed in route order, so the latest excess `again` entries are removed and counted in `overCarried`.
- Rule 8 never removes a stop.
- `passRoute` walks only each stop’s stored `depth`/`again` membership.

**F11 — P3, established — reported.** The cap documentation is internally inconsistent:

- [docs/project/skim.md:454](/home/greg/code/spideryarn2/.claude/worktrees/fbkudr63-skim-arrows-and-shared-items/docs/project/skim.md:454) says there is “currently no enforced limit,” contradicting the new validator.
- Several places describe the limit as simply “half,” while the implementation rounds up. Most notably, [the investigation](/home/greg/code/spideryarn2/.claude/worktrees/fbkudr63-skim-arrows-and-shared-items/docs/investigations/261003e-skim-again-carried-stops-eval.md:657) says the cap bounds a walk at 40%; with one own stop, `maxCarried(1) === 1`, allowing a 50%-carried walk.
- The prompt’s “never as many as it adds” is likewise stricter than the validator for that one-stop case.

The measured 40% maximum remains accurate; it just is not the cap’s universal bound. These passages should consistently say `ceil(own / 2)` or “half, rounded up,” and distinguish the observed 40% from the theoretical limit.

The round-three JSON supports every requested measurement:

- More: `21/80 = 26.25%` → 26%
- Most: `28/137 = 20.44%` → 20%
- Largest observed walk share: 40%
- Starting at More: 12–0–0
- After Gist: 8–2–2
- `overCarried`: 2 entries across 12 runs

Verification passed: `tests/skim.test.ts` 69/69, full typecheck clean, and diff whitespace check clean. No files changed.

VERDICT: land after fixes (F11)