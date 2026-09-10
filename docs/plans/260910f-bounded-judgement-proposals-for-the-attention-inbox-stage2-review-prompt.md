# Review: plan 260910f Stage 2 — the proposal on each surfaced prose question

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/bounded-judgement`, branch
`worktree-bounded-judgement`. TypeScript, ESM, `tsx`; vitest; React for the dashboard client.

## The candidate

Committed: 652b5a3d (parent 261b4759, which is the merge of `origin/dev`)
  git diff 261b4759..652b5a3d
  changed paths: `git diff --name-only 261b4759..652b5a3d`

Start with: `tools/overseer/attention-classify.ts` (the proposal-aware prompt, version 2, and its
parse), `tools/overseer/attention-pass.ts` and `tools/overseer/attention.ts` (where a verdict becomes
an item's `proposal`), `tools/overseer/attention-cli.ts` (`OVERSEER_PROPOSALS`, `reach`), the
`AttentionProposal` types in `tools/fleet/wire.ts` and their three parsers (`tools/overseer/store.ts`,
`tools/fleet/attention.ts`, `tools/fleet/web/src/types.ts`), and `tools/fleet/web/src/AttentionPanel.tsx`.
Where to begin, not the limit. Raw gate output: the full suite on `652b5a3d` is at
`logs/tmux-jobs/bj-s2-fullsuite-1935-617892.log`; the scoped suites were 1,060 of 1,060 across 20
files, and typecheck exit 0.

The plan is `docs/plans/260910f-bounded-judgement-proposals-for-the-attention-inbox.md` — Stage 2 and
§ The shape, decisions D1, D2, D3, D7, D8, D9, D13 and D14. Your earlier findings on the plan and on
Stage 1 are beside it.

## What it is meant to do

- With `OVERSEER_PROPOSALS` unset — the default — prompts, verdicts and cards are exactly as before,
  and every prose card carries `proposal: {kind:"off"}`, which draws nothing.
- With it set, the one classifier call (prompt version 2) also names who holds the information —
  `sol`, `fable`, `greg`, `overseer` or `self` — or says it is `unplaced`, with a reason and a
  verbatim quote of the sentence that asks. A recipient outside that set is an unreadable answer,
  never a default, and never promoted to `greg`. A quote that is not in the tail is unreadable.
- `by` names the model and is written by the code, never taken from the model's output.
- `reach` is worked out on every pass from the current usage reading and is never cached.
- **Nothing is sent to anyone.** The card has no control that delivers a proposal, and no rendered
  text presents a proposal as Greg's.
- An item from an older producer, with no `proposal` field, parses as `not-reported`.

Out of scope: live marks and vetoes (deferred, D10); reports at runtime (D11); the scheduler.

## What you may run and change

The tree is read-only for this review. /tmp is writable; you can run one test file at a time
(`npx vitest run tests/<one>.test.ts`) and `node --import tsx <script>`. No network.
**Write your conclusions FIRST to `/tmp/260910f-stage2-review-findings.md`**, as you establish each,
then put them in your final answer — the runner overwrites the answer file at exit.

## What to check

Independently first. For each guarantee above: does it hold on every path — the daemon's runner and
the hand-run command alike, a cached verdict from version 1 while version 2 is active, a verdict
whose model output includes fields it should not, an older checkpoint read by a newer page and the
other way round, a phone-width card? Is there any route by which a proposal could reach a session, or
read as Greg's decision?

For each finding: ID (continue from F14), P0–P3, established or reasoned, (a) the input that shows
it, (b) the smallest fix. Refuse only on an established P0 or P1.

## My own questions — read last

These are the implementer's departures from its brief, accepted and listed in the plan under
Stage 2, "As built". The ones I'd least like to be wrong about:

- **`ATTENTION_MEMORY_SCHEMA` went from 1 to 2.** This build reads both. Can any path make an older
  build and this one disagree about a verdict, not just rebuild it?
- **A verdict is rebuilt from known fields before it's cached**, and `by` is stamped from the
  constant. Is there any route by which model-written text other than `reason`, `asks`, `why` and
  the topic reaches the card or the cache?
- **The worst-case prompt bound is the larger of the two versions.** Does the budget's reservation
  still cover a version-2 call on the longest tail after `clipForClassifier`?
- **Both compositions take injected seams** (`AttentionSeams`, `LIVE_SEAMS`) so a test can drive
  them. Is the live default the only one production can reach?
- **The card shows the quote above the tail, not in place of it.** Greg as recipient reads "this
  one is yours". Is there any wording that could read as Greg having decided something?

Do not change any file in the repository.
