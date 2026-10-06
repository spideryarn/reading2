# Plan review: a fresh worktree builds once, so the five standing reds stop

You are reviewing a **plan**, before anything is built. Read-only: do not change any file.

## The candidate

- Live pre-commit candidate. Base: `4979c75b39b6fbaf9b893749b8fbe0790893b639`.
- One untracked file is the plan: `docs/plans/261006g-fresh-worktree-builds-once-so-five-reds-stop.md`.
- Code it proposes to change, all as it stands at the base: `scripts/check.ts`,
  `scripts/worktree-setup.ts`, `scripts/worktree-setup-bootstrap.mjs`, `scripts/deploy-checks.ts`
  (`GATE_TOOLING_BUILDS`), `scripts/deploy.ts` (its use of that list), `tests/deploy-checks.test.ts`
  (`describe("GATE_TOOLING_BUILDS")`), and the five test files the plan's table names, plus
  `tests/helpers/fleet-child-server.ts`. Start there; it does not limit scope.
- Docs it touches: `docs/project/worktrees.md` § What a worktree costs,
  `docs/project/static-analysis.md`.

## What to do

Attack the plan independently first. Is the diagnosis right? Is the chosen shape the simplest one
that keeps every one of those five checks able to fail? Is anything the plan asserts about the code
false (check each claim against the tree)? What breaks: `--fast`, `--offline`, the bootstrap, the
primary checkout, a worktree made under high load, concurrent builds, the readiness runner, knip?
Is there a third place that runs the suite without building that the plan missed?

## Severity, and what a refusal takes

P0 data loss / security / service broadly unusable. P1 user-visible wrong behaviour or an
authoritative contract violated. P2 design or maintainability risk with no wrong behaviour today.
P3 prose defect. Give every finding an ID (F1, F2, …), a severity, and say whether it is
**established** (direct evidence, no unresolved inference) or **reasoned**. Refuse the plan only on
an established P0 or P1. End with one line: `VERDICT: approve` or `VERDICT: refuse`.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- Whether a failed build in `worktree:setup` should fail setup rather than print FAIL and carry on.
- Whether `--list` on `check.ts` is the right way to make the order testable, or machinery for a test.
- Whether `SUITE_BUILDS` belongs in `deploy-checks.ts` or deserves its own small module.
