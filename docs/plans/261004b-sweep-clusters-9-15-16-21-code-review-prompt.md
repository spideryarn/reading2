# Review: four small sweep clusters, built (9 evals, 15 clock-waiting tests, 16 scripts, 21 freshness agreement test)

Repo: this worktree, branch `worktree-sweep5-clusters-9-15-16-21`, cut from `dev`. TypeScript, ESM,
vitest, Postgres, two bash scripts and one `.mjs`.

## The candidate

Committed, four commits in this order:

- `32ed6903c` stage A (cluster 9)
- `616208526` stage C (cluster 16)
- `782563861` stage D (cluster 21)
- `4e6184fde` stage B (cluster 15)

`git diff a994f537d..4e6184fde` is exactly the candidate; `git diff --stat a994f537d..4e6184fde`
prints the complete manifest. The plan is
`docs/plans/261004b-sweep-clusters-9-15-16-21-frozen-control-lock-tests-script-fixes-freshness-agreement.md`;
its Log holds the nine corrections from your plan review (PF1–PF9), which override the stage text.

Start with: `evals/paperwork/run.ts`, `evals/plain-words/source-fingerprint.ts`,
`scripts/remote-smoke-mcp-browser.mjs`, `scripts/stage.ts`, `tests/helpers/blocked-by.ts`,
`tests/freshness-deciders-agree.test.ts`. That is where to begin, not the limit — the manifest is.

## What it is meant to do

Nothing a reader sees changes. Production code changes are meant to be exactly: a rename in
`src/structure.ts` (`TOC10_SYSTEM` → `STRUCTURE_BASE_SYSTEM`), an `export` on `DELAY` in
`src/web/Tooltip.tsx`, one removed entry in `src/plain-words.ts` § `PLAIN_WORDS_EXEMPT`, and one
comment in `src/citation-investigate.ts`. Anything more than that in `src/` is a finding.

- **A.** The toc/10 eval arm's system prompt is a literal reconstructed from commit `675aa32b2`,
  pinned by sha256, independent of the production expectation. Paperwork pairs report exclusions
  and refuse unless `--partial`. The two eval Structure paths refuse a refusal or a `max_tokens`
  stop. Source fingerprints follow shared prompt modules one import hop. The `260930a` probe pair
  is deleted.
- **B.** Lock tests wait on `pg_blocking_pids` (transitively) instead of sleeping. Nineteen tooltip
  tests use fake timers past the open delay.
- **C.** `stage.ts` argv is strict and the CLI is behind `isMain`; the two shell checks validate
  shape, encode the callback and share one env reader; the MCP smoke script keeps both clients
  alive, re-reads, and closes in `finally`.
- **D.** One test holding `stepIsDone` and `articleMetadata(...).stages[].done` to one answer per
  step, with two present-day disagreements pinned (`structure`, `blocks`).

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside these four stages — each finding red-first, with the
test that reproduces it — and leave everything wider as a finding for me to decide. Do not commit.
List every file you changed at the end.

You have no network, not even loopback, so the Postgres tests will skip. I ran these on Postgres
after the builders finished, all green: `billing-vouchers`, `public-visibility-pg`,
`store-job-draft`, `store-pg-session`, `store-tags-pg` (103 tests); `freshness-deciders-agree`
(144); the 19 converted tooltip files plus `tooltip-interactive` and `tooltip-on-link` (531); stage
A's eight files (73); stage C's three (83). `npm run typecheck` is green. The smoke script was run
for real on this box and passed. **The two shell checks were not run against the real services**
(this worktree has no `.env.prod`).

## Attack it

Independently, before you read my questions below. The invariant to break in each stage is the one
its test claims: find an input where the fix is wrong, or a plausible wrong implementation the new
test would still pass. For the converted tooltip tests: one that now passes for a different reason
than before (fake timers left on, an assertion that became vacuous). For the shell scripts: a real
`.env` spelling or a real response the new code mishandles that the old code handled.

Also say, for each new abstraction, whether it is worth its keep: `sourceFingerprint`'s one-hop
import follower with a hand-kept `SHARED_PROMPT_SOURCES` set; `scripts/env-value.sh`;
`waitUntilBlockedBy`'s recursive query; `checkPair`/`checkServer`; a 950-line agreement test.

And check the docs: `docs/project/tooltips.md` § "Three things about testing a card in jsdom" may
still describe real waits; fix it to match if so (a doc made to match the code needs no approval).

For each finding give:
  - an ID continuing the chain (CF1, CF2, …), a severity (P0/P1/P2/P3), established or reasoned
  - (a) the input or mutation I can run that shows it fails its own claim
  - (b) the smallest change that closes it
A finding with no (a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0 or P1, and name what established it. End with `VERDICT: land` or
`VERDICT: do not land`, and say whether that conclusion follows from what you checked.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- A4's `SHARED_PROMPT_SOURCES` is another hand-kept list, one level up. Is it honest about that?
- A2: `modes.ts` got the same refuse-unless-`--partial`, beyond the plan. Right call?
- C: `stage.ts` moved its imports into `loadRuntime()` with typed `let` bindings — is anything
  now read before it is assigned on some path?
- C: `check-remote-auth.sh` now exits 2 if `github` is absent from a real Supabase response. Is
  that key always present in the real `/auth/v1/settings`?
- B: tests that advance by a local literal (300/400) rather than an exported constant still wait
  on a number nobody checks against the component.
- D: the test rewrites published rows in a private-lane database; could it leave state that
  another file in that lane reads?
