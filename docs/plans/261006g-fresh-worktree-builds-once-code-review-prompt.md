# Code review: worktree:setup and npm run check build what the suite reads

You are the stage's code reviewer, and you may write. **Fix what is inside this stage, narrowly and
red-first; report, do not fix, anything wider you notice.** Do not commit. Do not run `npm run
deploy`, `npm run check` or the full `npm test`. Do not write any sentence attributed to Greg.

## The candidate

- Committed candidate: exactly one commit, `06a035438`. `git show 06a035438` is the whole diff.
- Changed paths: `scripts/check.ts`, `scripts/deploy-checks.ts`, `scripts/worktree-builds.ts` (new),
  `scripts/worktree-setup.ts`, `scripts/readiness-loop.ts` (comment only),
  `tests/check-steps.test.ts` (new), `tests/worktree-builds.test.ts` (new),
  `tests/deploy-checks.test.ts`, `docs/project/worktrees.md`, `docs/project/static-analysis.md`, and
  the plan `docs/plans/261006g-fresh-worktree-builds-once-so-five-reds-stop.md` with its plan review.
- Start with those; it does not limit scope. The plan says what the work is for and holds the
  evidence I gathered by hand (§ What happened). Read that section as a reviewer of its
  conclusions, not only of the code.

## What to do

Attack it independently first. Does a fresh worktree after `npm run worktree:setup` really have
none of the five files red, and can each still fail? Does `npm run check` now build the fleet
client before its test gate under every flag? Is anything a comment or doc now asserts false
against the tree? Run these yourself, they need nothing outside the tree:
`npx vitest run tests/check-steps.test.ts tests/worktree-builds.test.ts` and
`npx tsx scripts/check.ts --list`. (`tests/deploy-checks.test.ts` and the five build-reading files
I ran myself: 180 passed, and 7 files / 198 tests passed after setup; the fleet files need loopback,
which you do not have.)

## Severity, and what a refusal takes

P0 data loss / security / service broadly unusable. P1 user-visible wrong behaviour or an
authoritative contract violated. P2 design or maintainability risk with no wrong behaviour today.
P3 prose defect. Every finding gets an ID (F1, …), a severity, **established** or **reasoned**, and
whether you fixed it. Refuse only on an established P0 or P1 you could not fix. End with one line:
`VERDICT: approve` or `VERDICT: refuse`.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- `worktree:setup` exits 0 when a build fails. The readiness runner calls setup
  (`scripts/readiness-loop.ts`, `runSetup`) and parses its output; does anything there now misread it?
- `scripts/check.ts` now imports `scripts/deploy-checks.ts`, which imports `smol-toml` and others.
  Any cost or cycle I have not seen (`npm run cycles`, knip)?
- `--list` is checked with `process.argv.includes`, like `--fast`. A test that drops the flag would
  run the real check; the test has a 60 s timeout as containment and nothing else.
