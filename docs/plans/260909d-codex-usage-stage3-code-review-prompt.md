# Code review: persisting the Codex usage reading (stage 3)

You reviewed this plan, and then the code for stage 2 — seven findings, all applied. This is stage 3:
getting the reading onto disk once per pass, beside the Claude one. **Weight this higher than the plan
review**: the bug you found in stage 2 that mattered most (spend-control states discarded) did not exist
until the code did, and the same will be true here.

## The change under review

```
git diff 329e038c..605fbbca -- scripts/overseer.ts tools/fleet/usage-history-record.ts \
  tools/fleet/usage-history-from-report.ts tools/fleet/usage-history-wiring.ts \
  tests/fleet-usage-history-record.test.ts tests/fleet-usage-history-from-report.test.ts \
  tests/fleet-usage-history-wiring.test.ts tests/fleet-usage-history.test.ts
```

Branch `worktree-codex-usage`, +742/-21. Implemented by GPT-5.6-Sol under `workspace-write`; I reviewed
it, fixed a typecheck failure it could not see, ran the checks, and committed.

## Context, in reading order

1. **`docs/plans/260909d-read-the-codex-subscription-usage-limits-and-show-them-beside-claude-s.md`** —
   **stage 3 is the specification.** Stage 1 is the measured evidence about the source.
2. **`docs/plans/260909d-codex-usage-stage2-code-review-sol-r1.md`** — your stage 2 review. Its P1 about
   discarded backend limit states is the one most likely to have a persistence analogue: a bucket field
   that survives parsing and then vanishes on the way to disk recreates it exactly.
3. **`docs/plans/260909d-codex-usage-stage3-report.md`** — the implementer's own report, including four
   specification gaps it found and eight cautions it raised for stage 4.
4. **`tools/fleet/usage-history-record.ts`** — read the whole header. Validity adjudicated once at
   collection time and never again; a line this build cannot read keeps its position; a number never
   stored without the instant that validates it.
5. **`docs/project/usage-history.md`** § "What the chart may not claim".

## What this has to get right

A daemon calls this every 300 seconds and appends one line. The file is long-lived and unpruned, and
it is the **only** record of usage history — the checkpoint keeps just the latest reading and the
underlying caches are overwritten, so anything not written down as it happens does not exist. So:
a dropped line is unrecoverable, a line that cannot be placed in time is worse than an absent one,
and a percentage that outlives its validity becomes a false claim about headroom.

## Where I would look first

My own suspicions. Rank them last if you cannot produce an input that breaks them.

1. **The stash.** Codex is collected in `usage.run()` and stashed for the synchronous `onPass` to
   consume (`usageHistoryDaemonOptions` in `scripts/overseer.ts`). This is safe **only** while the
   daemon refuses to overlap usage passes. Is that actually true on every path — a `keep-stored`
   decision, a thrown Claude pass, a shutdown mid-pass, the very first pass, a pass whose `onPass`
   throws? Is the stash cleared such that a later pass can never publish an earlier pass's Codex
   reading as its own? That would be the worst bug available here and it would look completely normal.
2. **Does any field survive parsing and then vanish on the way to disk?** Specifically
   `spendControlReached` and `individualLimit`, the subject of your stage 2 P1.
3. **The six absences.** Are they genuinely distinguishable *after a round trip through JSON*, or only
   in memory? `undefined` does not survive `JSON.stringify`, and I have already fixed one test that
   was confused about exactly this.
4. **The no-bump decision.** I claim adding an optional field is not a breaking change and that bumping
   `SUMMARY_SCHEMA` would strand every existing line as `unsupported`. Check that against the decoder,
   and check the reverse direction too: what does a *build without this change* do when it reads a line
   this build wrote? That is a real deployment ordering — the dashboard and the daemon restart
   separately.
5. **The composition-root assertion.** The wiring test greps `scripts/overseer.ts` for
   `usage: usageHistoryDaemonOptions(usageRetention)`. It can fail for the reason it names, but it is a
   text match. Is there a stronger form that does not require a live daemon and a lock?

## What I most want from you

- **Can a wrong or stale number reach disk looking good?** That is the whole question.
- **Anything the four specification gaps in the implementer's report get wrong**, or that I was wrong
  to accept rather than fix now. I judged the absent-general-bucket case acceptable because the
  decision still fails safe and only diagnostic detail is lost. Push back if that is wrong.
- **Are the tests real?** 89 green across five suites is a number. The wiring test drives the real
  daemon and reads bytes off disk, which I like; the record tests I am less sure of. Is anything
  asserted loosely enough that a broken implementation passes?
- **Anything simpler.** This added ~740 lines to persist one extra reading.

## How to report

Per finding: severity (**P0** must not land / **P1** fix before landing / **P2** worth doing / **P3**
opinion), then **(a)** an input or condition I can run or construct that breaks it, and **(b)** the
smallest change that closes it, as a code block. Rank by (a); say so when a finding has none. Please do
not patch the tree — hand me the mutation so I can watch it fail first.

You can run one test file (`npx vitest run tests/<one>.test.ts`) and `node --import tsx <script>`. You
have **no network at all** and `npm test` / `npm run typecheck` will not run; I have run both — typecheck
is clean and the five focused suites are green, and I will run the full suite before landing. A red test
inside your sandbox may be the sandbox: say so if you cannot tell. Note `tests/no-undeclared-spend.test.ts`
needs `git ls-files` and was denied for the implementer; I ran it, 36 green.

Finally: **state an explicit verdict** — land as is, land with changes, or do not land — and say which of
my five suspicions you checked and which you could not, and why. Silence will not be read as agreement.
