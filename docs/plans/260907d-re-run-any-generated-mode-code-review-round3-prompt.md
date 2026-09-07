# Narrow check: the fixes to F12, F13, F14 — discovery is closed

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode`, branch
`worktree-worktree-rerun-a-mode`. TypeScript + ESM, React 19 client under `src/web/`, vitest.

**This is not a third general review.** You reviewed the plan (round 0), the built code (round 1)
and the fixes (round 2). Round 2 established three P1s — F12, F13, F14 — whose fixes are new since
your last snapshot. House rules give exactly those fixes one narrowly scoped check, and close
discovery otherwise.

**In scope:** whether the F12, F13 and F14 fixes actually close what they claim to, and whether they
break something they touch.

**Out of scope, and please do not spend the run there:** the feature's design, the offered step list,
F2's queue remedy, anything F1–F11 settled, and new findings unrelated to these three fixes. If you
see something genuinely serious outside that scope, say so in one line at the end under
*Out of scope, noticed anyway* — do not build it into a finding.

## The candidate

Committed: `f41c0118`, on top of the round-2 snapshot `51c8ffd2`.

```
git diff 51c8ffd2..f41c0118
```

The code is `src/web/Metadata.tsx` (§ `RerunRow`, § `RERUN_CONFIRM_DEBATE`) and
`tests/metadata-rerun-section.test.tsx`. The rest of the diff is docs.

## What each fix claims

**F12 — the Debate price.** The confirm now reads: *"Two model calls, not one: it searches the open
web, and it is the dearest thing on this page — $0.20–0.40 for a completed run on a short article,
and more on a long one. The result changes only if the run succeeds."* Taken from
`docs/plans/260905f-debate-mode-stage-0-spike-results.md` § *Stage 3½* § 1, which supersedes the
§ *spend ceiling* figure I first quoted. **Check I have quoted the right section this time**, and
that the sentence is true of what the step actually does.

**F13 — the cost is announced.** The confirm sentence carries `id="rerun-confirm-<step>"`; the Yes
button has `aria-describedby` pointing at it and takes focus via a ref when the confirm opens.
Cancel is deliberately *not* described by it — the reasoning is in the code. **Check that a
keyboard/screen-reader user reaching Yes is actually told the price**, and that focusing Yes on open
does not trap or misdirect focus.

**F14 — an obsolete confirm cannot hide a live job.** `RerunRow` computes `obsolete` (a pending
confirm with an active `job`, or a pending `"retry"` whose `failed.retry` has gone), clears
`pending` in an effect, and draws off a derived `asking` so the bad render never happens. Widened to
a pending `"run"` as well as `"retry"`. It keys on `job` and never on `starting`, so our own POST
cannot tear the confirm away mid-answer. **Check the widening did not break the confirm's own
purpose**, and that there is no remaining interleaving where a paid press escapes the sentence or a
live job stays hidden.

## What you can and cannot run

Tree read-only; `/tmp` writable; **no network**. Please run
`npx vitest run tests/metadata-rerun-section.test.tsx` (15 cases) — a finding you reproduce outranks
one you reason to. On my machine: `npm test` → 800 files, **14,817 passed**, 35 skipped, `EXIT=0`;
`npm run typecheck` clean.

## How to answer

Continue the ID series — **start at `F17`**. For each: severity, established or reasoned, (a) the
input or mutation that shows it fails, (b) the smallest change that closes it.

Same scale as before (P0 data loss / security / incorrect charging; P1 user-visible wrong behaviour
or a contract violated; P2 design risk; P3 prose).

**If all three fixes hold, say so plainly** — a clean verdict on a narrow question is the useful
answer here, not a search for something to report. Refuse only on an established P0 or P1 **in the
three fixes**.

One known residual, already recorded, so it is not a finding: when a confirm is torn away by a job
arriving from another tab, focus falls to `BODY`. Moving focus in response to a background event is
its own anti-pattern, so it was left deliberately.

Do not change any file.
