# Opus's review of the defences, evals and tooling investigation

Read-only cross-family review of GPT Astra's doc, 2026-10-03. Part of the [fifth sweep](../plans/261003f-fifth-codebase-sweep-umbrella.md); the umbrella carries the corrections. Paths and line numbers are as of `59bd41171`.

# Cross-family review (Claude Opus) of the defences, evals and tooling doc

Doc: `docs/investigations/261003b-fifth-sweep-defences-evals-and-tooling.md` (GPT Astra, F1..F10).
Reviewed against `ba98d5588` (the doc was written against `59bd41171`, two commits earlier; neither
later commit touches a file cited below). Read-only. Nothing in the repo was changed, no database,
no full suite, no model call.

What I ran, so each verdict can be re-checked:

- `J-f1-probe.ts` (this folder): the real `libraryHitHref` composed with the real `findLiteral`.
- `J-sync-census.mjs` (this folder): a Babel AST count of `execFileSync | spawnSync | execSync`.
- `biome lint --only=nursery/noFloatingPromises --max-diagnostics=none .` over the whole tree.
- A one-line `spawnSync` with a TERM-ignoring child, to see the timeout mechanism today.
- `git show` on `9ac3ee21b`, `ba2e96030`, `956e8beb0`, `e5851cb03`.

Not verified, and said so where it matters: the eval census beyond a spot check; knip was not re-run
(I read the sweep's saved `knip.txt`); no daemon test was run under load.

## Headline

Nine of ten findings are real. None is wrong. The doc's weakness is its ranking: it gives **T0 and
"high value" too freely**. Only F1 is a defect a reader can hit. F3 is three different jobs sold as
one L/high-risk item, and its count (26) answers a narrower question than the one asked. F7 and F10
are true mechanisms with little practical consequence.

---

## F1 — library-hit test pins the wrong value: CONFIRMED, and wider than stated

**Reproduced the composed path.** `J-f1-probe.ts`, real functions, JSDOM:

```
{"text":"a café in paris","q":"café","find":"cafe","hits":0}     precomposed é
{"text":"a café in paris","q":"café","find":"cafe","hits":1}     decomposed e + U+0301
{"text":"don’t panic now","q":"don't","find":"don't","hits":0}   curly apostrophe
{"text":"the ﬁnal word","q":"final","find":"final","hits":0}     ligature
```

- `tests/library-hits.test.ts`, "percent-encodes what it puts in the query string", expects
  `find` to be `cafe` for a hit containing `café`. That is the value that fails. So yes, the test
  pins the wrong value.
- The same test also does not test what its name says: `cafe` contains nothing to percent-encode.
- `findLiteral` is the live consumer: `src/web/modes/search/SearchMode.tsx` calls it when
  `matcher === "words"`, which is what `match=words` in the link selects.
- This agrees with W11 in the web-client doc. Same defect, found twice independently.

**Two things the doc under-sells.**

1. **The apostrophe case is the common one.** Accents are rare in English articles; typographic
   apostrophes are in nearly every one. A reader who types `don't` and clicks a passage lands on an
   empty search panel. This raises the value, it does not lower it.
2. **The decomposed case "works" but mis-highlights.** One hit, but the span ends before the
   combining mark, so the highlight covers `cafe` and leaves the accent outside it. The doc says
   "check decomposed characters while doing so"; this is what that check finds.

**The proposed fix is right and needs no new abstraction.** `foldWithMap` in the same file already
returns `starts`/`ends` for exactly this. Take the source slice, send that. Do not widen
`findLiteral`: its header says case-only folding is deliberate.

Verdict: **CONFIRMED. T0, S, value high** (the doc says high; W11 says medium; high is right
because of apostrophes). Do it once, under whichever doc owns it; W11 and F1 are one job.

## F2 — the frozen toc/10 baseline: CONFIRMED as a mechanism, OVERSTATED as T0

**Is the test truly updated with live wording? Yes.**

- `evals/structure-whole-document/toc10-frozen.ts` line 1 says "The exact toc/10 request", and
  imports `TOC10_SYSTEM`, `renderBlocks`, `estimateStructureTokens`, `STRUCTURE_HEADROOM`,
  `budgetFor` from live `src/`.
- `src/structure.ts`: `TOC10_SYSTEM` is the live base. `SYSTEM` is built from it by two
  `replacePromptBlock` calls. So **the constant named TOC10 is today's toc/12 wording** minus two
  blocks. Nothing in the tree holds toc/10's bytes any more; only git does.
- `tests/structure-whole-document-request-parity.test.ts`: `EXPECTED_TOC10_SYSTEM` (line 96) is
  the literal, and `EXPECTED_SYSTEM` (line 272) is derived from it by `.replace`. Its header says
  "RE-PINNED 2026-10-03 for toc/12".
- `git show 9ac3ee21b -- tests/structure-whole-document-request-parity.test.ts` edits lines inside
  that literal ("Send no question" became "Leave question empty", and four more). `ba2e96030` did
  the same the commit before. So the "toc/10" pin has moved at least twice in one day.

**Two things the doc does not say.**

- **It is already written down.** `261003a-...-prompt-eval.md` line 90 records it as "Found, not
  caused". The doc cites that caveat but presents F2 as a finding. It is a confirmation.
- **The arm has a second consumer.** `evals/thinking-effort/tally.ts` and `lineup.ts` map
  `toc10-frozen` to the label `base`. So the next thinking-effort Structure run would also compare
  against a moved base, under a label that hides the name.

**Why not T0.** No reader sees this. The comparison it was pre-registered for has run
(`evals/results/hierarchy-structure/2026-10-02-...-toc10-frozen+incumbent`), before the 10-03
wording moved. The harm is to a *future* run. That is T1.

**Census.** Spot-checked, not re-done. I grepped `frozen` across `evals/**/*.{ts,mts,mjs}` (17
source files) and read the import lines of the ones that could carry a prompt
(`summaries/arms.ts`, `dig-deeper/arms.ts`, `paperwork/structure-starts-replay.ts`,
`thinking-effort/*`). I found no second module that claims a historical prompt and imports live
wording. `structure-starts-replay.ts` imports only the toc/10 *parser*, which is genuinely frozen.
So "exactly one" stands on my sample; I cannot vouch for all 94 vocabulary candidates. (F9 turns
up a near relative outside `evals/`: see the `260930a` probe pair.)

**The fix, corrected.** The doc's fixture is right. Add the half it leaves out: **rename
`TOC10_SYSTEM` in `src/structure.ts`** (it is the live base, and its name is the lie that let this
happen), and stop deriving `EXPECTED_SYSTEM` from the historical literal. The honest alternative is
cheaper still: **delete the arm** and say the baseline is the saved 2026-10-02 output. Greg should
pick; a frozen request nobody will send again is a fixture to maintain for nothing.

Verdict: **CONFIRMED mechanism, OVERSTATED tier. T1, S, value medium.**

## F3 — sync child calls: CONFIRMED, but the count is partial and the item is three jobs

### The counts, reconciled

`J-sync-census.mjs`, Babel AST, `tools scripts src evals`:

| What is counted | tools | scripts | src | evals | total |
|---|---:|---:|---:|---:|---:|
| all sync child calls | 18 | 104 | 1 | 9 | **132** |
| `execFileSync` with a literal `timeout` | 12 | 14 | 0 | 0 | **26** |
| `spawnSync` with a literal `timeout` | 6 | 7 | 0 | 0 | **13** |
| either, literal `timeout` | 18 | 21 | 0 | 0 | **39** |

- **This doc's 26 is right for what it counted, and it counted only `execFileSync`.** Its AST
  filter is `callee.name === "execFileSync"`. It says so, and names `readiness-git.ts` as an
  example of what it left out. But the headline number reads as the family's size, and it is not.
- **The knowledge doc's 44 is a grep with a ten-line window.** 39 are literal-timeout calls; the
  other five are calls whose `timeout` sits on a neighbour or arrives indirectly
  (`gjd-remote.ts`, `worktree-check.ts`). Its 130 total is my 132, give or take two.
- **Both agree on the number that matters: 18 in `tools/`**, every one with a timeout. This doc
  lists 12 of them.

**The six this doc's table misses**, all `spawnSync`:

| Site | Reach |
|---|---|
| `tools/overseer/work-probe.ts:111` | **daemon loop, every tick** — the most frequent of the 18 |
| `tools/fleet/readiness-git.ts:108, 278` | dashboard readiness timer |
| `tools/fleet/revision.ts:80` | startup only |
| `tools/overseer/diagnose.ts:787`, `launchers.ts:291` | CLI |

**One place this doc is right and the knowledge doc is wrong.** The knowledge doc files
`report-artefacts.ts` under "CLI only". `scripts/overseer.ts` `makeReportDrain` defaults its
checker to `makeArtefactChecker(...)`, and its own comment says it is "the daemon's report drain
as `run` composes it". So it is daemon-reachable, as F3 says.

**Exposed sites, merged:** health 1, steer 1, pane 1, routes-actions 2, routes-rename 2,
readiness-wiring 1, readiness-git 2, work-probe 1, usage 1, attention-probe 2, report-artefacts 1
= **15** blocking a request, a timer or the daemon loop. Not 13, not 12.

### Is it a live defect a person can hit?

The mechanism is real today. On this box, Node 26:

```
spawnSync("sh", ["-c", 'trap "" TERM; sleep 3'], { timeout: 300 })
→ {"err":"ETIMEDOUT","signal":null,"ms":3010}
```

A 300 ms timeout held the thread for 3 s. And `routes-new.ts:741` does call the synchronous
`collectHealth` on new-session admission while `server.ts` uses `collectHealthAsync`.

But it fires **only when a child stalls**, which is when the box is struggling. The person who
hits it is Greg at the dashboard, not a reader. Neither doc has a stall observed since the
260910a postmortem. So: latent, operator-facing, middle tier. **T0 is too strong** for the whole
item; the knowledge doc's T1 for the guard is closer.

### L / high risk describes only one third of it

The doc itself says steering must be a separate stage. Then it should be three rows:

| Part | What | Tier | Effort | Risk |
|---|---|---|---|---|
| F3a | The guard | T1 | S | low |
| F3b | Read-only probes onto `probeOwner().run()`: health in `routes-new`, readiness, work-probe, attention, usage, report-artefacts | T1 | M | low–medium |
| F3c | Steering (`steer.ts`, `pane.ts`, `drain.ts`) made async with a per-pane lock | T2 | L | high |

F3c should wait for a recorded stall. `drain.ts` says in capitals that the synchronous send *is*
the exclusion, and it is already bounded by `MAX_SENDS_PER_PASS` and `DRAIN_BUDGET_MS`.
One cheap part of F3c can go now: the `drain.ts` comment still says "~60 seconds of worst case",
which the postmortem disproved. A comment that states a false bound is worth a one-line edit.

### Is the adoption guard worth its keep? Yes, in a smaller shape than proposed

Both docs propose walking the import graph from `server.ts` and the daemon and failing on a
reachable sync import. That is more machinery than needed. `tests/fleet-imports.test.ts` already
has the shape at line 511: "is the only file under tools/ that imports one as a value". So:

- one test: **which files under `tools/` import `execFileSync | spawnSync | execSync` as a value**,
  against a literal list of today's 13 files that may only shrink.
- no reachability walk. Under `tools/` nearly everything is reachable from one of the two
  long-running processes, and "this file is CLI-only" is exactly the claim that goes stale.

It would have caught the two commits the knowledge doc names (`7166b92d`, `77d01268`). It is the
only defence aimed at the class. Worth it.

Verdict: **CONFIRMED mechanism; count PARTIAL (26 is execFileSync only; the family is 39, 18 in
tools, 15 exposed); tier and effort OVERSTATED as one item.** Split as above.

## F4 — daemon tests that sleep: CONFIRMED, value OVERSTATED

Every cited line is there and is what the doc says:

- `overseer-daemon.test.ts:738` — "Give the first one time to take the lock", `setTimeout 60`.
- `:961, 1001, 1055, 1150` — `sleep(40)` or `sleep(30)` before the source ends.
- `overseer-daemon-restart-no-double-dispatch.test.ts:197` — `sleep(40); // many more jobs ticks,
  none of which may dispatch again`. This is the best example: a negative assertion that passes
  if no tick happened at all.
- `overseer-daemon-recovery.test.ts:1028, 1049` — `sleep(120)`, `sleep(100)`.
- `until(`/`tickAfter` appear 0 times in each of those four files, 27 times in
  `recovery-resume`, 6 in `usage-pass`.

No failure at these sites is shown, and the doc says so. So this is two different risks under one
"high": the positive waits can flake on a loaded box; the negative ones can pass vacuously. The
second is the one worth fixing first, and it is four lines in one file.

The helper exists, so no new abstraction. One thing to add: the restart file has its **own**
`waitFor`, beside the shared `until`. See M3.

Verdict: **CONFIRMED. T1, M, value medium** (not high). Do the four negative assertions first.

## F5 — eval fingerprints hash chosen files: CONFIRMED, the proposed fix is too big

- `evals/plain-words/run.ts:342` hashes `["structure.ts", "glossary.ts"]`. Read.
- `evals/paperwork/run.ts:58` `SOURCES` has `paperwork.ts` but not `plain-words.ts`. Read.
- The drift example is real: `9ac3ee21b` touched `src/paperwork.ts` only.

I found something that makes this stronger than the doc says: **the version string does not save
it.** `ba2e96030` bumped `toc/11` to `toc/12`. `9ac3ee21b`, hours later, changed 23 lines of the
shared wording and bumped nothing. So two different Structure prompts are both called `toc/12`,
and an arm labelled by version alone cannot tell them apart. See M1.

**On the fix.** "Hash the assembled request at the call boundary" across seven finished harnesses
is M effort for experiments that have mostly been run and written up. No shared helper exists for
it (`src/source-hash.ts` hashes articles, not requests), so this is a new seam in seven places.
Cheaper and nearly as good: hash the **rendered system prompt string** each harness already holds
or can import. That follows imports for free, needs no seam, and is a two-line change per harness.
Do it in the harnesses that will run again, not all seven.

Verdict: **CONFIRMED. T2, S (not M) with the cheaper fix, value medium** (not high).

## F6 — paperwork pairs silently shrink: CONFIRMED

`evals/paperwork/run.ts` `pairs()`: `if (!rb) continue;` and
`if (xa === null || xb === null) continue;`. No exclusion list is written beside `pairs.md`.
One more hole the doc missed: the loop is `for (const [slug, ra] of A)`, so **a slug only in B is
dropped without even reaching a `continue`**. `modes.ts:213` pushes an `ERROR` row and skips the
totals, as described.

The fix is a count and a printed list, not an abstraction. Agree.

Verdict: **CONFIRMED. T1, S, value medium.** "High" is generous for a harness whose comparison has
been run; it matters the next time it is used.

## F7 — eval Structure paths skip the termination checks: CONFIRMED mechanism, OVERSTATED value

- `src/structure.ts:2779` (refusal) and `:2782` (`max_tokens`) exist.
- `evals/paperwork/run.ts:159–166` and `evals/plain-words/run.ts:378–380` go
  `finalMessage()` → text → `parseWholeDocumentAnswer`, with no `stop_reason` check.

But the case it guards is "cut off at `max_tokens` **and** still valid JSON **and** still passes
the tree checks in `parseWholeDocumentAnswer`". A truncated JSON object almost never parses. A
refusal carries no JSON. So in practice the eval throws anyway, with a worse message. The doc
says "provider occurrence not measured"; I would go further and call it near zero.

Worth doing only if the two checks can be exported as one small function for three callers. Not
worth a stage.

Verdict: **CONFIRMED mechanism, OVERSTATED. T1, S, value low.**

## F8 — floating-promise rule is advisory: CONFIRMED, gateable now

Whole tree, today:

```
biome lint --only=nursery/noFloatingPromises --max-diagnostics=none .
Checked 3368 files in 3s.  Found 1 error.  Found 1 info.      (5.6 s wall)
scripts/changelog/release-notes.ts:303
```

- **Baseline is 1.** One `.catch` and it is zero.
- **Cost is 5.6 s**, the same shape as `npm run cycles`, which is already a gate.
- `scripts/check.ts` runs `lint` with `gate: false`. Confirmed.
- No `biome-ignore` for this rule anywhere, so zero is a true zero, not a suppressed one.

Two cautions for whoever builds it:

- The rule is `nursery` and needs type inference. One hit in 3,368 files may mean the tree is
  clean or the rule is weak. **Gate it only with a red control**: a fixture with a bare
  un-awaited async call that must fail. `tests/biome-config-is-live.test.ts` already names this
  rule in its header; put the control there. The doc says "retain a failing control"; make it a
  condition of landing.
- The "1 info" is Biome asking for `biome migrate` on the config. Harmless, but it means the
  config is behind the pinned binary. Note it; do not fix it in this stage.

No new abstraction: add a `package.json` script and one `gate: true` entry, copying `cycles`.

Verdict: **CONFIRMED. T1, S, value medium.** Agree with the doc exactly.

## F9 — knip's fourteen scripts: CONFIRMED; keep twelve, two are a real question

The saved `knip.txt` shows **15** unused files: these 14 plus `vitest.witness.config.ts`. The doc
says 17 with three root configs; I could not reproduce the other two. Minor.

All fourteen were committed between 2026-09-30 and 2026-10-02. They are three days old, not
abandoned. References outside the file itself (docs, evals, scripts, tests; this sweep's own docs
excluded):

| File | Refs | My call |
|---|---:|---|
| `eval/quotes-spread-eval.ts` | 6 | keep |
| `eval/skim-coverage-eval.ts` | 6 | keep |
| `eval/skim-depth-blind.ts` | 3 | keep |
| `eval/skim-diversity.ts` | 2 | keep |
| `probes/260930a-investigate-probe.ts` | 4 | **ask Greg: delete or freeze** |
| `probes/260930a-investigate-prompt.ts` | 2 | **ask Greg: delete or freeze** |
| `probes/260930d-quote-stop-repro.ts` | 2 | keep |
| `probes/260930f-figure-order-probe.ts` | 1 | keep |
| `probes/261001a-paper-read-probe.ts` | 3 | keep |
| `probes/261001h-fidelity-guard-probe.ts` | 12 | keep |
| `probes/261001p-blind-packet.ts` | 2 | keep |
| `probes/261001p-check-saved-levels.ts` | 5 | keep |
| `probes/261001p-dig-deeper-search-live.ts` | **0** | keep, but nothing cites it |
| `probes/261001p-investigate-cost.ts` | 1 | keep |

**Where I disagree: the `260930a` pair.** The prompt file's own header says: "When the build
lands, this text moves into that file and this one is deleted." The build landed
(`src/citation-investigate.ts` exists). The doc overrides that with "keep as historical". But the
file imports live `plainWords()` and `PROFILE_RULES`, so it is **not** the draft that was
measured. It is F2's defect again, sitting in the doc's own keep list. Either delete both (git has
them, and the write-up can cite the commit) or paste the rendered text in. Keeping it as it is, is
the one wrong option.

**The config fix.** Agree: add `scripts/eval/*.ts` and `scripts/probes/*.ts` as entries. Do
**not** widen to `scripts/**/*.ts`, which would also hide a dead helper under `scripts/changelog/`.

Verdict: **CONFIRMED. T1, S, value low.** Keep 12, decide 2.

## F10 — browser-MCP smoke check: CONFIRMED mechanism, OVERSTATED

Read `scripts/remote-smoke-mcp-browser.mjs`. `finish()` kills the child as soon as its own
navigation answers; the two `openPage` calls run under `Promise.all` with no barrier. True.

But the doc's failing story, "a shared page answers A then B", is not how the real failure looks.
Two MCP servers are two processes. Without `--isolated` they fight over one profile directory and
the second gets "browser is already running for …", which the script's own comment names and
which it catches as `isError`.

The real hole is narrower: **if A opens, answers and is killed before B launches its browser,
there is no overlap and no conflict**, so a non-isolated server can pass. That is a timing race,
and it is cheap to close: resolve without killing, and kill both after `Promise.all`. That is S,
not M. The "deliberately shared-state fake" is more harness than this deserves.

Verdict: **CONFIRMED mechanism, OVERSTATED. T2, S, value low.**

---

## The proposed abstractions: is each worth its keep?

| Proposal | Verdict |
|---|---|
| F1: use the folded-to-source map | **Already exists** (`foldWithMap`). No new code shape. |
| F2: literal historical fixture + digest | Worth it only if the arm will run again. Otherwise delete the arm. |
| F3: reachability guard | Worth it, as a **flat allowlist** copied from `fleet-imports.test.ts:511`. The graph walk is not needed. |
| F3: convert to `probeOwner().run()` | Already exists. Adoption, not invention. |
| F3: per-target serialisation for steering | New, and risky. Defer (F3c). |
| F4: `until` / `tickAfter` | Already exists. |
| F5: request-hash seam in seven harnesses | **Not worth it** as written. Hash the rendered system string instead. |
| F6: expected-case-set check | A count and a list. Fine. |
| F7: shared message-to-accepted-answer function | Marginal. Only if it is one small export. |
| F8: a narrow gate | Copy of `cycles`. Fine. |
| F10: shared-state fake transport | **Not worth it.** Hold both clients open instead. |

The doc's own restraint is good: it rejects a generic eval runner, a blanket sleep ban, faking all
daemon clocks and gating whole lint. I agree with every item in "Considered and rejected".

---

## What it missed

**M1. Prompt wording changed under an unchanged version.** `ba2e96030` set `toc/12`.
`9ac3ee21b` then changed 23 lines of `src/paperwork.ts`, which Structure, Simple and Tweets all
interpolate, and bumped no version (`git show 9ac3ee21b -- src` has no `_VERSION` line). The
literal pin was edited; nothing made the version move with it. A stored artefact made between the
two commits is `toc/12` and is treated as fresh. Whether a deploy fell between them I did not
check, so the production effect is **unverified**. The class is real: the pin and the version are
two assertions, and only one was touched. Cheapest guard: pin `{ version, sha256(SYSTEM) }` as one
literal, so editing the wording forces a visible edit beside the version. T1, S, value medium.

**M2. `TOC10_SYSTEM` is a live constant with a historical name, in `src/`.** This is the root of
F2, and the doc's fix leaves it. Rename it. T1, S.

**M3. Sixteen test files each define their own `waitFor` or `until`.**
`grep -ln "function waitFor\|const waitFor\|function until" tests/*.ts` gives 16, beside
`tests/helpers/overseer-until.ts`. Four are daemon tests F4 names or sits next to
(`restart-no-double-dispatch`, `source-outage`, `process`, `recovery-resume`). The doc's "reuse
the existing helper" is right but does not notice the helper has rivals. Not a defect; fold them
in as files are touched. T1, S per file, value low.

**M4. `work-probe.ts` is the hottest sync site and is absent from F3.** It is `spawnSync`, so the
`execFileSync`-only census could not see it. It runs on every daemon tick. And its timeout branch
is unreachable: `run.error` is tested before `run.signal`, and my probe above shows a timeout
sets `error` (`ETIMEDOUT`). The knowledge doc has this as G2. It belongs in F3b.

**M5. Several small lint rules are in the same position as F8, some closer to bugs.** From the
sweep's saved `lint.json`:

| Rule | Count | Note |
|---|---:|---|
| `suppressions/unused` | 17 | a suppression that suppresses nothing: family A inside the linter |
| `correctness/useExhaustiveDependencies` | 13 | the knowledge doc's D1 |
| `suspicious/noDuplicateProperties` | 8 | |
| `suspicious/noDoubleEquals` | 8 | |
| `correctness/noUnsafeOptionalChaining` | 5 | all in two test files |

F8 promotes one rule and stops. The cheaper general move is one test holding a per-rule count
that may only shrink, for the handful of error-severity rules under about 20. That is a new small
mechanism, so it should be weighed, not assumed. I would do F8 first and see whether the pattern
earns a second use.

**M6. Knip's file check can be a gate the day F9 lands.** `check.ts` says of knip: "promote to a
gate when this reaches zero". After the entry fix, unused *files* is 1
(`vitest.witness.config.ts`, which two scripts mention by name). `knip --include files` is then a
narrow gate exactly like F8. The doc fixes the false positives and does not take the step its own
F8 argues for.

**M7. The two `fold` twins have no parity test.** `src/web/library-hits.ts` and
`src/library-search.ts` each say they must stay twins. `tests/library-search.test.ts` line 21
calls the client's copy "a different function with a different job". Neither test imports both.
Today the bodies match line for line. A ten-line test that runs both over one list of strings
would hold that. Small, and directly beside F1. T1, S, value low–medium.

**M8. `scripts/eval/` and `evals/` are two homes for one kind of thing.** Four eval CLIs live
under `scripts/eval/`, which knip does not treat as entries; `evals/**` it does. Moving the four
would clear four of F9's fourteen with no config change. A move is a rename with its sweep, so
this may not be worth it; it should have been named as the alternative.

---

## Is the overall judgement right?

**Mostly yes.** "No T3 rewrite; the recurring failure is incomplete adoption, or a guard whose
claim exceeds what it observes" is correct and well supported. F1, F2, F3 and F4 are all cases of
a good mechanism that stops one caller short. The "considered and rejected" list is sound.

**Where it is off:**

1. **Three T0s is two too many.** F1 is T0. F2 harms a future eval run. F3 is latent and
   operator-facing. Calling all three T0 flattens the one that a reader hits today.
2. **"High value" on seven of ten** leaves no room to rank. I make it one high (F1), with F3a
   close behind.
3. **F3's number.** Asked to re-count 18, it reported 26 by counting one function of three. The
   honest table is 39 literal-timeout calls, 18 in `tools/`, 15 exposed.
4. **Ranking.** F8 is ranked seventh and is the cheapest real gate on offer: 5.6 s, baseline 1.
   It should be second. F10 and F7 should be last.

**My order:** F1 → F8 → F3a (guard) → F2 with M1 and M2 → F4 (negative assertions first) → F3b →
F6 → F9 with M6 → F5 (cheap form) → F7 → F10 → F3c only after a recorded stall.

## Verdict table

| Finding | Verdict | Doc's tier / effort / value | Corrected tier / effort / value |
|---|---|---|---|
| F1 library-hit handoff | CONFIRMED (reproduced; wider: apostrophes, ligatures) | T0 / S / high | **T0 / S / high** |
| F2 frozen toc/10 | CONFIRMED mechanism; tier OVERSTATED; already recorded in 261003a | T0 / S / high | **T1 / S / medium** (or delete the arm) |
| F3 sync children, as one item | CONFIRMED mechanism; count PARTIAL (26 = execFileSync only; 39 total, 18 in tools, 15 exposed); OVERSTATED as T0/L | T0 / L / high | split below |
| F3a the guard | worth its keep, as a flat allowlist | — | **T1 / S / high** |
| F3b read-only probes (incl. work-probe) | CONFIRMED | — | **T1 / M / medium** |
| F3c async steering | defer until a stall is recorded | — | **T2 / L / medium, risk high** |
| F4 daemon sleeps | CONFIRMED (all sites read); value OVERSTATED | T1 / M / high | **T1 / M / medium** |
| F5 eval fingerprints | CONFIRMED; fix too big | T2 / M / high | **T2 / S / medium** (hash the rendered system string) |
| F6 paperwork pairs | CONFIRMED (plus B-only slugs dropped) | T1 / S / high | **T1 / S / medium** |
| F7 termination checks | CONFIRMED mechanism; OVERSTATED value | T1 / S / medium | **T1 / S / low** |
| F8 floating promises | CONFIRMED (baseline 1, 5.6 s, gateable now with a red control) | T1 / S / medium | **T1 / S / medium** |
| F9 knip's fourteen | CONFIRMED; keep 12; the 260930a pair is delete-or-freeze, not "keep as is" | T1 / S / low | **T1 / S / low** |
| F10 MCP smoke | CONFIRMED mechanism; OVERSTATED (real hole is a no-overlap race) | T1 / M / medium | **T2 / S / low** |
| Eval census "exactly one" | UNVERIFIABLE in full; holds on a spot check of 17 files | — | — |
