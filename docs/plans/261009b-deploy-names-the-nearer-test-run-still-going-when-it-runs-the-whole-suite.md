# The deploy names the nearer test run still going when it runs the whole suite

Status: built, 2026-10-09. Brief from the Overseer, under Greg's standing licence to fix bugs
(2026-10-09, *"You are definitely authorised to fix bugs any time you notice them"*) and his aim for
the test gate:

> Could we not just run the test that failed and if that's been fixed, assume it's okay? I'm willing
> to take that small risk rather rerun the whole test suite every time.
>
> — Greg, 2026-10-08

## What the brief said, and what the store says

The brief: the readiness loop passed `e229c575` at 00:21Z; `changelog:prepare` committed the notes
on top as `af37412f`; the deploy of `af37412f` "at 00:55Z" still ran the 70-minute suite, so reuse
cannot fire across the notes commit, and the partial path chose the void run on `25c673ca` over the
pass on `e229c575`.

**The 00:55 was BST, not UTC.** `af37412f` was committed at `00:55:32 +0100` (23:55Z), and the deploy
log (`logs/tmux-jobs/deploy-0100-0055-3891598.log`) is from the same minute. The readiness run on
`e229c575` (`39a00e871fcc`) started at 23:07Z and finished, green, at **00:21Z — 26 minutes after the
deploy's test gate asked**. When it asked, the store held:

| commit     | run            | state when the gate asked |
|------------|----------------|---------------------------|
| `e229c575` | `39a00e871fcc` | running, 48 minutes in    |
| `25c673ca` | `260ec0c4c48f` | finished 22:47Z, void     |

`partialEvidenceFor` did what [261008h](261008h-deploy-reruns-only-the-tests-that-failed-and-ready-deploys-the-first-commit-carrying-its-notes.md)
designed: a run still going does not decide which commit is nearest, so the nearest *settled* run
was the void one on `25c673ca`, and a void run is never passed over for an older green one.

**Replayed against the real store** (a scratch script calling `testEvidenceFor`,
`readinessFullRuns` and `partialEvidenceFor` with the clock set and later records hidden):

```
23:56Z  partial: run    the newest run on 25c673ca (readiness 260ec0c4c48f) cannot stand in: it did not reach a verdict
00:30Z  partial: rerun  a whole run on e229c575 (1 file(s) changed since) by readiness 39a00e871fcc, 8m ago, green — nothing to rerun here
```

So the notes commit already reuses its parent's run: the one file changed is
`src/web/changelog-pending.json`, which is neither a test nor test infrastructure, and the gate reruns
nothing. Nothing in the brief's proposed fix (a list of files "the suite cannot see") is needed; it
would have duplicated what `isTestFile` and `isTestInfrastructure` already decide.

## The bug that is there

The gate's reason named the void run and stopped. It did not say that the run which would have
answered was 48 minutes into a ~75-minute check on the candidate's own parent. Read at 23:55Z, the
line gave no hint that waiting half an hour would turn a 70-minute suite into nothing; read later,
it misled the Overseer into the diagnosis above.

**Fix:** when `partialEvidenceFor` refuses, and a run still going is on a commit nearer the
candidate than the one that decided, the reason says so: *"…; a run on e229c575 (readiness
39a00e871fcc), started 48m ago, is still going and may stand in once it finishes"*. It changes the
words, never the decision. The deploy's gate line and summary already carry `partial.why`.

## Passed over

- **Waiting for the nearer run.** The deploy could sleep until a run on a nearer commit finishes.
  That is a product trade-off (a deploy that blocks for up to an hour on another process, which may
  go void) and Greg's to make; the sentence lets whoever deploys choose.
- **Letting a running run decide nearness.** 261008h tried and reversed it: the loop is mid-run
  almost always, so it sent nearly every deploy to the whole suite.

## Tests

`tests/deploy-partial-evidence.test.ts` § "a refusal names a run still going on a nearer commit":
the 2026-10-09 shape (void on `B`, running on `C`, candidate `Y`), seen red before the change.

## Review and dry run

GPT Sol ([…-code-review-sol.md](261009b-code-review-sol.md), workspace-write, plan and code in one
pass since the change is a sentence): the diagnosis holds, `25c673ca` was the right choice under
261008h, `refuse` changes only words. One P3, fixed by Sol: the deployment.md sentence overstated
when the clause appears (only after a settled run was chosen and refused). *Ship after my fixes.*

`npm run deploy -- --dry-run` from this worktree at 03:23Z, stopped once the gate had spoken:

```
test evidence: running the suite here — …; and no partial rerun: the newest run on e229c575 (readiness
39a00e871fcc) cannot stand in: readiness run 39a00e871fcc ran in …/spideryarn2/.claude/worktrees/readiness-checks,
not in the readiness runner (/var/tmp/…/deploy-reuse-notes-commit/.claude/worktrees/readiness-checks) …;
a run on c5f0f9b4 (readiness 4ec388e5bd72), started 1.0h ago, is still going and may stand in once it finishes
```

The runner-path refusal is the dry run being made from a worktree rather than the primary, as
designed; the new clause is the last one.
