# Fifth sweep, second wave: clusters 9, 15, 16 and 21

Four small, low-risk clusters from the
[fifth codebase sweep](261003f-fifth-codebase-sweep-umbrella.md), built in one run with one commit
each. The umbrella's § The clusters has each row; the evidence for every item id is in the
`docs/investigations/261003b-fifth-sweep-*.md` docs it links. This plan says what each cluster will
change, what done looks like, and which simpler or larger option was passed over.

None of this changes what a reader sees. All four are about checks that claim more than they
prove: an eval control called "frozen" that follows today's wording, tests that prove "blocked" by
waiting 400 ms, scripts that accept a typo, and two freshness deciders nothing compares.

## How it runs

One worktree, four stages with disjoint file sets, built by Opus subagents in parallel. Each stage:
re-run the audit's greps against today's tree, write the failing test and see it red, fix, see it
green, mutate the fix and see the test notice. Then one GPT Sol code review over all four commits
(write-capable, fixes inside the stage, reports anything wider), `npm test` and
`npm run typecheck`, push to `dev`, update the umbrella rows.

## Stage A — cluster 9: the frozen control, and comparisons that shrink silently

Items DF-F2 (with the Opus review's M2), F6, F7, F5, and the `260930a` pair.

**A1. F2/M2: freeze toc/10 for real, and give the live base an honest name.**

Today `evals/structure-whole-document/toc10-frozen.ts` says "the exact toc/10 request" and imports
`TOC10_SYSTEM` from `src/structure.ts` — which is the live base that today's prompt is built from
by two `replacePromptBlock` calls. Its wording moved twice on 2026-10-03 (`ba2e96030`,
`9ac3ee21b`), and the "toc/10" literal in the parity test was edited both times, because the test
derives today's expected production prompt from that same literal.

- Recover the toc/10 system text from git at the commit the pre-registered run used (the
  2026-10-02 `toc10-frozen+incumbent` result; `run.json` and `git log` name it), by reading the
  parity test's literal at that revision **and** rendering `TOC10_SYSTEM` from `src/` at that
  revision, and checking the two agree. Two independent recoveries, so a wrong one shows.
- Store it as a literal in the eval folder (`toc10-system.ts`, a plain string export). The frozen
  arm imports that and nothing from `src/structure.ts` for its system text.
- In the parity test: pin the frozen text by its own `sha256` digest, and make the production
  expectation its own literal, no longer `.replace`d out of the historical one. A production
  wording change then cannot touch the historical pin, and editing the historical literal turns a
  digest red.
- Rename `TOC10_SYSTEM` in `src/structure.ts` to `STRUCTURE_BASE_SYSTEM` (the rename only; two
  uses in `src/`). The base keeps whatever wording it has today.
- The arm still uses live `renderBlocks`, `estimateStructureTokens` and `budgetFor`. Narrow the
  header's promise to say so — the system prompt is frozen, the rendering and the budget are
  today's — rather than freezing three more helpers for an arm that may never run again.

*Red first:* the digest test, against the tree before the literal moves (the live import does not
hash to toc/10's digest).

*Passed over — delete the arm.* The umbrella's For Greg 6 asks whether the arm will ever run
again; it is unanswered. Deleting is less code, but it is Greg's call and it has a second consumer
(`evals/thinking-effort/` maps the arm to `base`, and `structure-panel.sh` runs it). Pinning is
small, is right whichever way he answers, and leaves deletion as a later one-commit change. The
debrief recommends an answer.

**A2. F6: paperwork pairs.** `evals/paperwork/run.ts` § `pairs()` drops a slug missing from arm B,
a slug only in B, and any pair where either output failed, and writes no list of what it dropped.
Change: `pairs()` returns the pairs **and** the exclusions (slug, reason); the exporter refuses
when there are any, unless `--partial` is passed, in which case it prints them and writes them
beside `pairs.md`. `evals/paperwork/modes.ts` totals say attempted / succeeded / failed rather than
counting only successes. *Red first:* a pure test of `pairs()` with a missing-in-B, an only-in-B
and a failed cell. No paid run.

**A3. F7: the two eval Structure paths skip production's termination checks.**
`evals/plain-words/run.ts` and `evals/paperwork/run.ts` go final message → text → production's
parser with no refusal or `max_tokens` check. Use the two existing helpers production's own check
is made of (`wasRefused` in `src/messages-stream.ts`, `truncationFailure` in
`src/token-budget.ts`) at both sites. No new export from `src/structure.ts`: the cluster may only
rename there, and Opus rated this "only if it is one small export". *Red first:* a fake final
message with valid JSON and `stop_reason: "max_tokens"` is accepted today. If the harness has no
seam to hand it a fake message without a provider, pull the three lines into one small function in
`evals/paperwork/structure-parse.ts` (which exists and both can import) and test that.

**A4. F5, the cheap form.** The harness fingerprints hash a hand-kept list of source files, so a
wording change that arrives through an import (`src/paperwork.ts`, `src/plain-words.ts`) leaves the
fingerprint unchanged. Add a `sha256` of the **rendered system prompt** each harness already holds
to its recorded fingerprint, in `evals/paperwork/run.ts`, `evals/plain-words/run.ts`,
`evals/plain-words/answers.ts`, `evals/quiz-build-up.ts` and `evals/quiz-reading-goal.ts`. And
`evals/plain-words/artefacts.ts` reads its source hashes after generation: read them before.
*Passed over:* hashing the assembled request at the call boundary in seven harnesses (the audit's
fix; Opus: not worth it for experiments that have run). `faq-levels` and `arc-length` are outside
this cluster's file set and are left, named here so the next reader knows.

**A5. The `260930a` pair** (`scripts/probes/260930a-investigate-probe.ts`, `…-prompt.ts`). The
prompt file's header says it is deleted when the build lands; the build landed
(`src/citation-investigate.ts`). It imports live `plainWords()`, so it is no longer the draft that
was measured. Delete both, after grepping the whole tree for anything that names them; a doc that
cites them gets the commit that last held them.

Done: the frozen arm's system text cannot move with production and a test says so; a short
comparison refuses or lists what it dropped; the two eval paths refuse a truncated answer; the
fingerprints move when the rendered prompt moves.

## Stage B — cluster 15: tests that wait on the clock

Items SR-R13 and WC-W9.

**B1. R13.** `tests/billing-vouchers.test.ts` (two tests) starts an admission behind a held
`for update`, sleeps 400 ms and asserts it has not settled. That passes when the lock works and
when the box is slow. `tests/public-visibility-pg.test.ts` releases its lock after 300 ms without
showing either request reached it. Replace each sleep with a wait until Postgres says the request
is blocked **by the test's own holding backend** (`pg_blocking_pids`), then assert. In the
visibility test, wait until both requests are blocked.

`waitUntilBlockedBy(pid)` already exists as three private copies
(`tests/store-job-draft.test.ts`, `tests/store-pg-session.test.ts`, `tests/store-tags-pg.test.ts`).
Adding a fourth and fifth copy is the wrong direction, so: move it to `tests/helpers/` and import
it from all five files — if the three copies are the same function. If they differ in a way that
matters, the two new sites import the helper and the plan log says what differs.

*Red first:* these tests are green today, so the proof is a mutation the old test cannot see. Make
the admission slow without making it blocked (take the test's lock on a different row and put a
500 ms delay in front of the admission): the old sleep-then-assert still passes, vacuously; the
new wait times out. Record both outputs.

**B2. W9.** Sol called the audit's version overstated: 53 waits of 300–500 ms across 23 files are
not one cause. Scope here is the hover-delay waits only — a test that hovers, sleeps past
`Tooltip`'s open delay, and asserts. Export `DELAY` from `src/web/Tooltip.tsx` (and `HOVER_DELAY`
where it lives, if not exported) and convert those tests to fake timers advancing by the exported
constant, the way `tests/spine-card.test.tsx` and `tests/spine-hover.test.tsx` do. No shared
`openTip` helper (Sol: premature). A wait that is a transition, a layout settle or a network poll
is left alone and listed in the plan log. Start from the heaviest files the audit names
(`diagram-panel-hover`, `shelf-action-touch`, `skim-panel`, `illustrated-view`) and the
`tooltip-*` tests; stop converting a file if fake timers fight its other async work, and say so.
`origin/dev` is merged first: `261003p` changed the shared tooltip today.

*Red first:* for each converted file, change the exported delay and see the test still pass (it
follows the constant), then break the open path and see it fail.

Done: no lock test in the two files can pass without the lock; the hover-delay tests named do not
sleep on real time; the suite is not slower.

## Stage C — cluster 16: small script fixes

Items XZ-X13f, g, h, d (shell half), i (= DF-F10).

- **f. `scripts/stage.ts`** reads `--force` with `includes` and drops every other `--flag`, so
  `--froce` is an unforced run and a third positional is ignored. Pull the argv reading into a pure
  exported function that refuses an unknown flag and an extra positional, with the usage text.
  *Red:* a test of that function.
- **g. `scripts/check-remote-auth.sh`** treats the string `"false"` as on (`if .external[$p]`),
  and a missing `github` key passes the OFF control. Compare with `== true` and require each
  control's key to be present. *Red:* a test that runs the script's jq against a fake body. The
  script calls `curl`; the test needs a seam — a `SETTINGS_BODY_FILE`-style override is more
  machinery than a shell check deserves, so put a fake `curl` first on `PATH` in the test.
- **h. `scripts/check-google-redirect.sh`** interpolates the callback into the query string
  unencoded. Use `curl -G --data-urlencode`. *Red:* the same fake-`curl` trick, asserting the
  arguments it was called with for a callback that carries `?next=a&x=b`.
- **d (shell half).** The shell `grep | cut | tr` env readers in those two scripts drop
  `export X=…` and keep single quotes. One small shared reader that handles `export`, both quote
  kinds and surrounding spaces, used by both scripts. If a third shell reader exists elsewhere it
  is named, not touched (cluster 1 owns `deploy.ts`).
- **i. `scripts/remote-smoke-mcp-browser.mjs`** kills each client the moment its own navigation
  answers, so a non-isolated server passes whenever the two do not overlap. Opus's cheap form:
  resolve without killing, kill both after both have answered, and re-read the first client's page
  after the second has navigated. Export `openPage` and guard `main()` so a test can reach it.
  *Red:* a fake MCP server with shared state that the old sequence passes when one boots late and
  the new sequence refuses. *Passed over:* a general fake-transport harness.

Done: each of the five has a test that was red; the two shell scripts and the smoke script still
run for real on the box (run them once, read-only as they are, and paste the output in the log).

## Stage D — cluster 21: freshness, an agreement test

Item DP-D5, test only. `src/pipeline.ts` § `stepIsDone` decides whether the queue skips a step;
`src/store/pg.ts` § `articleMetadata` § `isCurrent` decides, in an 18-arm switch of its own,
whether the reader is told the step is current. They have drifted before (the Tweets arm's own
comment). One new test file: for each stamped step, on one fixture article in Postgres, publish a
current artefact and check both say yes; then make it stale the way that step goes stale (prompt
version, model generation, fingerprint) and check both say no. Where they disagree today, that is
a finding: the test pins the disagreement as `it.fails` with a comment naming it, and it goes in
the debrief — the extraction that would fix it is cluster-sized work of its own and is not started
here.

*Red first:* mutate one arm of `isCurrent` (drop a prompt-version comparison) and see the test for
that step go red. A step the test cannot make stale is listed by name rather than skipped silently,
and the test counts its cases against `STEPS` so a new stamped step with no case fails.

*Passed over:* sharing the expected stamps between the two (the audit's D5 proper, T2/M).

## Out of scope

Anything in another cluster's file set. The `waitFor`/`until` copies in sixteen test files (Opus
M3). The version-and-digest pin for today's prompt (Opus M1) — the parity test gets its own literal
here, which is half of it; pinning the version beside it is cluster 13's gate work.

## Log

*(filled in as stages land)*

### 2026-10-04 — GPT Sol's plan review: build, with nine corrections, all accepted

The review is [261004b-…-plan-review-sol.md](261004b-sweep-clusters-9-15-16-21-plan-review-sol.md)
(prompt beside it). No P0 or P1; nine P2s, PF1–PF9. **Where a stage above and a correction below
disagree, the correction wins**, and each builder is handed the review itself.

- **PF1 → A4 is replaced.** Most of these harnesses never hold a rendered system string (the
  generators keep it private), so "hash the rendered prompt" is not available inside the file set.
  Instead: extend each harness's *source* fingerprint to cover the prompt-text modules it really
  depends on (`plain-words.ts`, `paperwork.ts`, and any shared prompt module), take the snapshot
  before generating (in `plain-words/artefacts.ts`, out of `write()`), and call it a source
  fingerprint, not a request hash. Test that changing a previously omitted dependency changes the
  fingerprint. `paperwork/run.ts` already hashes `paperwork.ts`; that part of the audit is stale.
- **PF2 → C item i.** `openPage` returns a live handle with a bounded read and an idempotent
  close. The single-client run closes before the pair starts; every started client is closed in
  `finally`; either completion order must detect shared state; the re-read does not navigate again.
- **PF3 → D.** Changing only an artefact's stamp makes `stampForStep` throw `StampDisagrees`, so a
  stale case changes every recorded copy of the field together. Both calls must resolve before
  their answers are compared. A disagreement is pinned as an ordinary test asserting the exact
  observed pair, not `it.fails`. Deliberate differences (a new profile, a new illustration note)
  are kept apart from currency.
- **PF4 → file sets.** The umbrella rows are amended: cluster 15 also owns
  `tests/store-job-draft.test.ts`, `tests/store-pg-session.test.ts`, `tests/store-tags-pg.test.ts`,
  one new helper under `tests/helpers/`, and export-only edits to `src/web/Tooltip.tsx`
  (`HOVER_DELAY` in `useHoverCard.ts` is already exported). Cluster 16 also owns its shared shell
  env reader and its new tests. Checked against the other rows: nobody else names these.
- **PF5 → C item f.** `scripts/stage.ts` runs its CLI at module scope, so the parser is exported
  *and* the CLI goes behind `src/is-main.ts` § `isMain`. The test also covers the valid forms and
  that a file ingest still refuses `--force`.
- **PF6 → C item g.** Validate that `external` is an object and `google`, `email`, `github` are
  present booleans (malformed exits 2), and use `== true` in the "all providers on" list as well.
- **PF7 → C shell tests.** Run copies of the real scripts in a temporary checkout-shaped directory
  with dummy `.env.local` / `.env.prod`, fake `curl` first on `PATH`, inherited overrides removed.
- **PF8 → A1.** The run's recorded HEAD is `675aa32b22167f1b921f3286ed10e8fa1c50acf0`, where the
  files are `src/hierarchy.ts` and `tests/hierarchy-structure-request-parity.test.ts`. Sol
  reconstructed the text and got sha256 `532c3dc4…522998d`; the builder recovers it independently
  and must reach the same digest. It is described as the prompt reconstructed from the run's
  recorded commit — the run saved neither a dirty-tree check nor the bytes it sent.
- **PF9 → B1 (reasoned; Postgres was not available to Sol).** Two requests on one row can queue
  as request 2 → request 1 → holder, so "two backends directly blocked by the holder" can time out
  on correct code. The visibility test waits for two distinct backends whose blocking chains
  *reach* the holder. Verified on Postgres here, both ways, and recorded.
- A3: guard `stop_reason === "max_tokens"` explicitly before throwing `truncationFailure`.

### 2026-10-04 — all four stages landed

| Stage | Cluster | Commit | Tests I re-ran |
|---|---|---|---|
| A | 9 | `32ed6903c` | 8 files, 73 |
| C | 16 | `616208526` | 3 files, 83 |
| D | 21 | `782563861` | 144 (62 s) |
| B | 15 | `4e6184fde` | 5 Postgres files, 103; 21 tooltip files, 531 |
| review fixes | — | `3e2da25fe` | 6 files, 73 |

Built by four Opus subagents in parallel on disjoint files; every fix was red first and mutated
afterwards. What changed against the plan:

- **A.** A4's helper follows imports one hop against a hand-kept set of shared prompt modules
  (`evals/plain-words/source-fingerprint.ts`); Sol's review made it parse imports rather than
  match text (CF1). `evals/paperwork/modes.ts` had the same silent drop in its own `pairs` and got
  the same refusal. A5 needed one line out of `src/plain-words.ts` § `PLAIN_WORDS_EXEMPT`.
- **B.** The three `waitUntilBlockedBy` copies were the same function, so all five files import
  one helper. PF9 was right: measured on Postgres, the two publishes queue as request 2 → request
  1 → holder. Many cards open on a `TooltipGroup` delay written as an inline `300`, not on
  `DELAY`, so some converted tests advance by `Math.max(DELAY.open, 300)` or by their old number.
  The audit's "heaviest files" were not: it counted source lines, not loop passes.
- **C.** As corrected by PF2, PF5, PF6, PF7. Sol's review moved the argv refusal ahead of the
  runtime load (CF3).
- **D.** The count rule was widened from "stamp or arm" to "stamp, `isDone` or arm", which is what
  brought `blocks` in and found its disagreement. 20 steps covered, none excluded. The file needed
  a lane entry in `tests/store-migration-registry.ts`.

**GPT Sol's code review: land.** [The review](261004b-sweep-clusters-9-15-16-21-code-review-sol.md).
CF1–CF4 (P2) and CF5 (P3) fixed by the reviewer, red first, with a postmortem each for CF1–CF4;
I read the diff and re-ran the tests. One round only: the fixes are small, in evals, tests and one
dev script, and nothing was overruled. **CF6 (reasoned P2) is not built**: the smoke script's
failed-navigation cleanup test fails both clients, so it cannot show the surviving one is closed.
Sol read the `finally` as correct.

**Not verified.** `scripts/check-remote-auth.sh` and `scripts/check-google-redirect.sh` were not run
against the real services with the new code: a worktree has no `.env.prod`. The auth check now
exits 2 if `github` is missing from the real settings body, and nobody has confirmed that key is
always there. Run both once from the primary checkout.

**Found, not fixed (each outside its cluster's file set):**

1. `blocks` freshness: the queue says not done, the reader's page says current, when stage 2's
   HTML has moved. `src/store/pg.ts` § `isCurrent`'s `default: true` comment says there is nothing
   to compare for `blocks`; there is (`blocksMatchTheirHtml`). And
   `tests/store-revision-columns.test.ts` requires an arm only for steps with a `stamp`, not an
   `isDone`. Small fix: an arm for `blocks`, and widen that guard.
2. The visibility race test (`tests/public-visibility-pg.test.ts`) passes with the article row's
   `for update` deleted, because `lockBillingAccount` already serialises two publishes by one
   owner. Its comment and `src/store/pg-visibility.ts`'s header both say otherwise. Either the
   article lock is redundant, or the test needs two owners.
3. `src/structure.ts`: `TOC10_STRUCTURE`, `TOC10_OUTPUT`, the comment "inherited byte-for-byte from
   toc/10" and the error "no longer matches toc/10" all describe the live base under toc/10's
   name. The cluster allowed one rename there.
4. About twenty `<TooltipGroup delay={{ open: 300 … }}>` literals; naming them would let the tests
   follow them.
5. Five shelf test files sleep past a hover through a `wait(ms)` helper they also use for network
   settles; the audit's grep cannot see them.
