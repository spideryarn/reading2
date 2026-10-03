# Defences, evals and tooling: fifth sweep investigation

This is the read-only depth investigation for the [fifth codebase sweep](../plans/261003f-fifth-codebase-sweep-umbrella.md). It examines whether the repository’s defences catch its recurring failures, whether eval controls preserve what they claim to preserve, and whether operational tooling remains usable when the box is struggling. No repository file was modified, no full test suite or deployment was run, and no model or database call was made.

## Scope and limits

Inspected against `59bd411712e4861e3d03a85d25b9f8d88d9797a5`, with other agents working concurrently.

Read `DEPTH-BRIEF.md`, `BRIEF.md`, `A-prior-sweeps.md`, and `B-knowledge.md`. `D-gpt-breadth.md` arrived during the investigation and its relevant nominations were checked against source. `C-measurements.md` remained absent; its requested hotspot scores are therefore leads, not independently verified measurements.

The investigation covered:

- Test inventory, timer patterns, selected daemon and fleet tests, the library-hit regression, and representative guards for the seven postmortem families.
- TypeScript configuration, Biome configuration, `scripts/check.ts`, the typecheck coverage guard, Knip’s unused-file report, and Sentry/logging entry points.
- Executable eval sources, historical prompt definitions, live controls, temporal before/after harnesses, prompt fingerprints, pairing, and Structure response handling.
- Synchronous child-process calls across `scripts/` and `tools/`, their important dashboard/daemon callers, the named complexity hotspots, and the fourteen Knip findings under `scripts/eval` and `scripts/probes`.

Not performed: exhaustive review of 1,449 test files; contention testing; full typecheck, test or check runs; browser automation; live Sentry inspection; production alert verification; paid evals; or adjudication of archived model answers.

Consequently, “proved from code” below establishes a reachable mechanism, not its production frequency. Timing weaknesses are not presented as freshly reproduced flaky failures.

## Findings at a glance

| ID | Finding | Tier | Effort | Value | Risk |
|---|---|---|---|---|---|
| F1 | Library-hit test requires a term the destination cannot match | T0 | S | high | low |
| F2 | Frozen toc/10 prompt and its test both follow live wording | T0 | S | high | low |
| F3 | Dashboard and daemon still reach unbounded synchronous child calls | T0 | L | high | high |
| F4 | Daemon tests still substitute elapsed time for observed work | T1 | M | high | low |
| F5 | Eval fingerprints identify selected files, not the request sent | T2 | M | high | medium |
| F6 | Paperwork comparisons silently discard missing and failed counterparts | T1 | S | high | low |
| F7 | Two Structure eval paths omit production’s termination checks | T1 | S | medium | low |
| F8 | Floating-promise detection works, but remains advisory | T1 | S | medium | low |
| F9 | Knip calls fourteen documented research CLIs unused | T1 | S | low | low |
| F10 | Browser-MCP smoke check does not establish simultaneous isolation | T1 | M | medium | low |

Totals: **3 T0, 6 T1, 1 T2, no T3 recommendation**. Risk describes implementing the proposed change, not leaving the defect alone.

## F1 — A test pins the wrong library-search handoff

**Evidence: reproduced**, with the reader-facing call path traced.

`src/web/Library.tsx:1350` calls `libraryHitHref`. In `src/web/library-hits.ts`, that function chooses a folded query term against folded hit text, then sends the folded term as `find`.

`src/web/search-hits.ts:263` deliberately folds case only. Its destination matcher does not remove accents or normalise punctuation. `findLiteral`, at line 328, therefore cannot fulfil some links that the library constructs.

`tests/library-hits.test.ts`, the test named **“percent-encodes what it puts in the query string”**, explicitly expects `cafe` for a hit containing `café`. It verifies the intermediate representation while missing the feature’s purpose.

A read-only Node probe imported the real functions, with a JSDOM document and `TSX_DISABLE_CACHE=1`:

```text
input: café
hit: a café in paris
href: /read/an-article?at=spya-k3m9qt&mode=search&find=cafe&match=words
findLiteral(blocks, extractedFind).length: 0
findLiteral(blocks, "café").length: 1
```

This is a concrete member of family A: both sides can have passing unit tests while their composition does nothing.

**Cheapest fix:** keep the literal destination matcher’s semantics. Use the existing folded-to-source map to select a source substring for the URL. Replace the wrong expectation with a composition regression: construct the href, read its `find`, and pass that to the actual destination matcher.

Cover an accented word, curly punctuation and a ligature; these are the transformations the producer already performs. Check the existing mapping’s treatment of decomposed combining characters while doing so.

**Files:** `src/web/library-hits.ts`, `tests/library-hits.test.ts`. Read `src/web/search-hits.ts`; changing its search semantics is unnecessary.

## F2 — The frozen baseline’s guard was updated with the thing it should resist

**Evidence: proved from code and commit history.**

The path is:

```text
ARMS["toc10-frozen"]
  → model-arms.ts:1042
  → toc10FrozenRequest()
  → imported TOC10_SYSTEM
  → live plainWords() + paperwork("structure")
```

Relevant locations:

- `evals/structure-whole-document/toc10-frozen.ts:1–3` promises the exact historical request but imports its system prompt and block renderer.
- `src/structure.ts:224` interpolates `plainWords()`.
- `src/structure.ts:226` interpolates `paperwork("structure")`.
- `tests/structure-whole-document-request-parity.test.ts:326` claims to pin toc/10’s exact bytes.

There **is** a literal-byte test. The problem is stronger than an absent test: its `EXPECTED_TOC10_SYSTEM` also supplies the base for the current production expectation, at line 272.

The test header explicitly records repinning for toc/12. Commit `9ac3ee21b` changes the historical expectation alongside the shared paperwork wording:

```sh
git show 9ac3ee21b -- \
  src/paperwork.ts \
  tests/structure-whole-document-request-parity.test.ts
```

Thus a production wording change reaches the historical arm, and updating the production pin also blesses the historical change. The caveat in the [front-matter investigation](261003a-summary-and-structure-skip-the-front-matter-prompt-eval.md) is accurate.

**Cheapest fix:** recover the fully rendered toc/10 system text from the intended historical revision and store it as a literal eval fixture. Give it an independent digest. Stop deriving the current production expectation from the historical expectation.

The file also promises an exact request while importing live rendering and budgeting helpers. Pin their output over a fixed input fixture, or narrow the promise explicitly to the system prompt. A rendered-request fixture covers more than merely banning direct imports from prompt modules.

Do not replace legitimate live incumbent controls with snapshots.

**Files:** `evals/structure-whole-document/toc10-frozen.ts`, one historical text fixture, `tests/structure-whole-document-request-parity.test.ts`.

### Eval-control census

The executable-source census included TypeScript **and** `.mts`/`.mjs`:

```sh
rg --files evals -g '*.ts' -g '*.mts' -g '*.mjs' | wc -l
# 163

rg -l -i '\b(frozen|baseline|control|old|v1)\b' evals \
  -g '*.ts' -g '*.mts' -g '*.mjs' | wc -l
# 94 vocabulary candidates

rg -l 'TOC10_SYSTEM' evals \
  -g '*.ts' -g '*.mts' -g '*.mjs' | wc -l
# 1
```

The 94 are candidate files, not 94 prompts. Imports and arm dispatch were inspected to distinguish historical text from live controls, frozen inputs, stored outputs, algorithms and incidental vocabulary.

| Definition or family | What is actually held constant | Live prompt dependency and verdict |
|---|---|---|
| Structure `toc10-frozen` | Claims the exact historical request | **Affected:** live `TOC10_SYSTEM`, shared rules, renderer and budget helpers |
| Structure `incumbent` and its repeat | Today’s production recipe and its noise | Live intentionally; not a historical freeze |
| Structure `headings`, `incumbent-disk` | Algorithmic tree or stored tree | No historical prompt claim |
| Summaries `incumbent`, repeat, `gists-only` | Current rules, or a declared block substitution | `production-prompt.ts:33` imports `wholeDocumentRequest` intentionally |
| Summaries `v1`, `v2`, `v3` | Named experimental wording from `variants.md` | Literal experimental blocks; not historical production requests |
| Summaries `gists-toc5`, `gists-toc6`, `questions-toc6` | Explicit historical gist/question blocks | Pinned text from `variants.md`; no live text import for the blocks claimed frozen |
| Thinking-effort `base-a/b` | Today’s generator at today’s effort | Live intentionally |
| Thinking-effort Sketch `no-schema-a/b` | Current generator with schema omitted | `run.ts:928` calls live `generateSketch`; “frozen” in test wording overstates this, but runner defines a same-effort schema comparison |
| Plain-words `run`, `answers`, `artefacts` | Outputs captured before and after edits | Live generators; temporal captures, with provenance weaknesses in F5 |
| Paperwork `run`, `modes` | Outputs captured on each prompt revision | Live generators; F5–F7 apply |
| Quiz build-up, Quiz reading-goal, FAQ levels, Arc length | Temporal before/after outputs | Live generators; no immutable old-prompt implementation |
| Simple probe, brief/plain and sentence comparisons | Saved labelled runs | Live generation plus stored-output comparison; not a frozen prompt definition |
| Dig-deeper arms | Captured search evidence shared across arms | Production messages are adapted; “frozen” refers to evidence |
| Shelf-topic `baseline` | `chooseTerms` with today’s defaults | Explicitly live algorithm |
| Referee-claims ablation; chat-web-reach controls; prompt-caching controls | Declared experimental intervention or negative case | Live production calls, not historical baselines |
| PDF bake-off | Literal system wording and experimental variants | User instruction deliberately imports live `instructionFor`; no exact historical-request promise |
| PDF titles `incumbentLadder` | Historical title-selection algorithm | Literal ladder at `titles.mts:341`; not a frozen model prompt |
| Extraction, PDF scoring, retrieval baselines, cost baseline and live-audio candidates | Algorithms, corpora, measurements or fixtures | No additional historical prompt definition found |

**Result:** one falsely frozen full-prompt definition found; no second such definition identified. The historical Summaries blocks are a useful existing example of the correct distinction.

## F3 — The owned-child defence stops at selected callers

**Evidence: proved from code**, supported by the existing timeout postmortem’s measurement. No new stalled child was launched.

The [timeout postmortem](../postmortems/260910a-a-timeout-that-signals-and-then-waits-is-not-a-bound.md) establishes that a synchronous timeout sends a signal and continues waiting for the child. The event loop cannot serve the dashboard meanwhile.

The current mechanism is `probeOwner().run()` in `tools/fleet/child.ts`. Some adapters call it `runOwned`; that is not a universal exported function.

The requested count of eighteen is not the current count under an explicit AST definition. There are **26 calls with an explicit `timeout` property across `scripts/` and `tools/`: 12 under `tools/`, 14 under `scripts/`.**

The census parsed `.ts`/`.tsx` files using the installed Babel parser and counted:

```js
node.type === "CallExpression" &&
node.callee?.name === "execFileSync" &&
node.arguments.some(a =>
  a.type === "ObjectExpression" &&
  a.properties.some(p => p.key?.name === "timeout")
)
```

The discovery grep is:

```sh
rg -n 'execFileSync|timeout:' tools scripts -g '*.ts' -g '*.tsx'
```

The AST filter avoids counting imports, comments and neighbouring timeout declarations. It does not count aliases or options passed indirectly.

| Current sites | Count | Reachability and priority |
|---|---:|---|
| `tools/fleet/health.ts:584` | 1 | `routes-new.ts:741` calls synchronous `collectHealth` |
| `tools/fleet/pane.ts:1398`, `steer.ts:582` | 2 | Steer/action/drain → send coordinator → real transport and capture |
| `tools/fleet/routes-actions.ts:1424,1429` | 2 | Process enumeration for box actions |
| `tools/fleet/routes-rename.ts:102,107` | 2 | Rename request handler |
| `tools/fleet/readiness-wiring.ts:81` | 1 | Readiness timer |
| `tools/overseer/attention-probe.ts:39,89` | 2 | Operational attention probing; convert with its caller ownership |
| `tools/overseer/report-artefacts.ts:51` | 1 | `scripts/overseer.ts:1315` creates the checker used by daemon report draining |
| `tools/overseer/usage.ts:1342` | 1 | Claude auth-status probe; operational scan path |
| Three database setup/reownership scripts | 3 | CLI-only; lower priority |
| `scripts/fleet-collect-bench.ts` | 7 | Instrument deliberately includes blocking comparison arms |
| `scripts/overseer-launch-mode-specimen.ts` | 3 | CLI specimen |
| `scripts/overseer.ts:1293` | 1 | Report CLI’s own tmux-session lookup |

This is not the complete synchronous-process family. `tools/fleet/readiness-git.ts:108,278` still uses `spawnSync`, for example.

**Proved drift:** the health collector has an owned async path while new-session admission still uses its synchronous sibling. The earlier fix did not reach both consumers.

`tools/fleet/drain.ts:32` still calls six ten-second synchronous commands “~60 seconds of worst case”, despite the postmortem disproving that bound.

**Cheapest safe fix:** convert long-running-process paths to the existing owner, starting with health, readiness and read-only probes. Add the proposed reachability guard to the existing AST-based import test, with named shrinking exceptions.

Steering must be a separate stage. Its synchronous execution currently provides exclusion: `drain.ts:41` explicitly relies on never yielding. Introduce per-target serialisation in the same change as async sends, and preserve ambiguous-delivery quarantine. Simply replacing calls with promises would create a second defect.

**Files:** read-only probes and callers; then `steer.ts`, `pane.ts`, `send-coordinator.ts`, `drain.ts`, route adapters and their tests. Guard: `tests/fleet-imports.test.ts`.

## F4 — Some daemon tests still guess how much work fits into milliseconds

**Evidence: proved from code for the timing dependency; busy-box failures at these remaining sites were not reproduced.**

The [fixed-window postmortem](../postmortems/260930a-a-fixed-window-stands-in-for-a-condition.md) already supplied `tests/helpers/overseer-until.ts`. Converted report, usage and attention tests use `until`, `tickAfter` and counted ticks.

The remaining candidates include:

| Site | What the fixed wait substitutes for |
|---|---|
| `tests/overseer-daemon.test.ts:738` | First daemon acquired its lock and wrote its start note |
| Same file, `:961,1001,1055,1150` | Scheduler dispatched, observation started, or state became visible before the source ends |
| `tests/overseer-daemon-ordering.test.ts:488–536` | Heartbeat processed a fake-clock change before the next message |
| `tests/overseer-daemon-restart-no-double-dispatch.test.ts:197,217,285,326` | Several scheduling opportunities occurred without another dispatch |
| `tests/overseer-daemon-recovery.test.ts:1028` | Report drain ran before the source stops |
| Same file, `:1049` | Additional intervals occurred after shutdown |

The restart tests already wait for the first dispatch, but then use 40–60 ms to establish “many more ticks”. A negative assertion can pass vacuously when those ticks never happened.

**Cheapest fix:** reuse the existing condition helper. Observe lock ownership, dispatch, checkpoint publication or a counted scheduling opportunity. For negative claims, establish the opportunities first. Keep real-clock daemon integration tests; the earlier postmortem explicitly rejected globally faking their timers.

**Files:** the four daemon test files named above; reuse `tests/helpers/overseer-until.ts`.

### Timer census: matches are not flaky tests

```python
from pathlib import Path
import re

files = list(Path("tests").rglob("*.test.*"))
for pattern in [
    r"setTimeout|\bsleep\(",
    r"advanceTimersByTime",
]:
    hits = [(p, line) for p in files
            for line in p.read_text().splitlines()
            if re.search(pattern, line)]
    fake = [(p, line) for p, line in hits
            if "useFakeTimers" in p.read_text()]
    print(pattern, len(hits), len({p for p, _ in hits}),
          len(fake), len({p for p, _ in fake}))
```

Results:

| Pattern | Lines | Files | Lines in files mentioning fake timers | Such files |
|---|---:|---:|---:|---:|
| `setTimeout|\bsleep\(` | 619 | 279 | 70 | 26 |
| `advanceTimersByTime` | 417 | 93 | 417 | 93 |

These are lexical categories, not per-test timer-mode analysis. They supersede neither a different grep’s count nor a behavioural review.

Important exclusions:

- `tests/fleet-web.test.tsx` has **13,006 lines**, but its timer matches inspected here are fake-timer advances. Its size is not evidence of real sleeps.
- `fleet-composed-access.test.ts` uses socket safety deadlines and condition polling. Those are not fixed-window assertions.
- Diagram panel tests frequently use a zero-delay turn to settle asynchronous React work.
- `shelf-action-touch.test.tsx:345–478` uses real 300–400 ms tooltip waits. This is a speed opportunity, but no contention failure was established.
- `fleet-child.test.ts:170` measures an actual TERM-ignoring child. Retain this boundary test. Its subsecond upper bound is a separate contention sensitivity to measure, not grounds for deleting the test.

## F5 — Eval provenance follows hand-maintained source lists

**Evidence: proved from code and historical changes.**

Examples of fingerprints that omit prompt dependencies:

| Harness | Fingerprinted source | Missing live dependency |
|---|---|---|
| `plain-words/run.ts:342` | `structure.ts`, `glossary.ts` | Shared plain-word and paperwork rules |
| `plain-words/answers.ts:120` | `explain.ts`, `converse.ts` | Shared plain-word rules |
| `paperwork/run.ts:58` | Structure, Simple, Tweets, paperwork | Plain-word rules |
| `faq-levels/run.ts:72` | `faq.ts` | Plain-word and paperwork rules |
| `arc-length/run.ts:65` | `arc.ts` | Plain-word and paperwork rules |
| `quiz-build-up.ts:254`, `quiz-reading-goal.ts:80` | `quiz.ts` | Plain-word and paperwork rules |

This is demonstrable drift, not just a possible missing import:

```sh
git diff --name-only 9ac3ee21b^ 9ac3ee21b -- \
  src/structure.ts src/glossary.ts src/paperwork.ts src/plain-words.ts
# src/paperwork.ts
```

The Structure prompt changed through its import while the two files hashed by `plain-words/run.ts` did not.

There is also a timing difference between harness copies. `plain-words/artefacts.ts:357` reads source hashes after generation. `quiz-reading-goal.ts:89–105` snapshots before generation and rejects subsequent source movement. An edit during a call can therefore mislabel the former’s loaded code.

**Cheapest durable fix:** capture and hash the assembled request at the existing call boundary. Record separate identities for prompt/settings and consumed article inputs. Hashing the request does not require committing private article text.

Reuse existing digest utilities and request builders. Do not build a generic eval framework or another manually maintained transitive-source manifest. Where full request capture needs a small seam, extract that seam and test it first.

**Files:** the temporal harnesses above, `plain-words/artefacts.ts`, and narrowly necessary request-capture helpers. Coordinate with F6 and F7 because they share harness files.

## F6 — Paperwork pairs silently shrink the comparison

**Evidence: proved from code.**

`evals/paperwork/run.ts:314` pairs by slug:

- At line 327, a missing counterpart causes `continue`.
- At line 347, a failed output on either side also causes `continue`.
- The exported blind packet contains the surviving comparisons, without a case-by-case exclusion manifest.

`evals/paperwork/modes.ts:213` prints individual failures, then omits them from successful-item totals. A reader copying the totals can lose the availability difference.

The stronger sibling exists: `plain-words/answers.ts:253` rejects a missing counterpart, and `quiz-build-up.ts:110` checks the declared corpus. These are useful patterns, although they are not a reason to assume every sibling check is complete.

**Cheapest fix:** require equality of expected case keys before exporting a complete comparison. Carry failed cells in an explicit attempted/succeeded/failed denominator. If exploratory partial packets remain useful, require an explicit partial mode and print the exclusions.

**Files:** `evals/paperwork/run.ts`, `evals/paperwork/modes.ts`, their focused tests. No paid rerun is needed to test a missing or failed arm.

## F7 — Shared parsing still does not mean shared acceptance

**Evidence: proved from code; provider occurrence not measured.**

`evals/plain-words/run.ts:377` and `evals/paperwork/run.ts:158` obtain a final Structure message, extract text and call production’s parser.

Production additionally checks:

- `src/structure.ts:2773`: refusal.
- `src/structure.ts:2782`: `max_tokens`.

A final message containing parseable JSON but a refusing or truncated termination can therefore be accepted by those eval paths while production refuses it.

The [copied-parser postmortem](../postmortems/261001b-a-harness-shared-the-request-and-copied-the-parser.md) was fixed at the parser seam. This is the adjacent acceptance seam left outside that sharing.

**Cheapest fix:** reuse the existing termination checks, or expose the smallest shared message-to-accepted-answer function. Keep raw proposal measurements clearly labelled; do not silently substitute a different end-to-end experiment.

A fake final message with valid JSON and `stop_reason: "max_tokens"` is the low-level negative case. No provider is needed.

**Files:** the two harnesses, existing Structure acceptance helpers, focused eval tests.

## F8 — A working promise rule has no gate

**Evidence: reproduced lint finding; gate status proved from code.**

`biome.jsonc` enables `nursery/noFloatingPromises` as an error. `scripts/check.ts:212` runs lint as advisory, while the separate cycles command gates only import cycles.

A scoped run:

```sh
node_modules/.bin/biome lint \
  --only=nursery/noFloatingPromises \
  --max-diagnostics=none scripts/changelog/release-notes.ts
# exit 1; one floating-promise error at line 303
```

The statement is:

```ts
main(process.argv.slice(2)).then((code) => process.exit(code));
```

The whole-tree scoped JSON report contained one `lint/nursery/noFloatingPromises` diagnostic, at that site, plus a configuration diagnostic. This does not establish that Biome catches every detached async operation.

**Cheapest fix:** handle the CLI rejection, then give this narrow rule its own gate, as cycles already has. Verify the whole-tree command succeeds after the repair and retain a failing control.

This respects the prior rejection of making noisy **whole lint or Knip** a gate. It promotes a small, separately measurable rule.

**Files:** `scripts/changelog/release-notes.ts`, `scripts/check.ts`, `package.json`, a focused gate test.

## F9 — Fourteen “unused” files are documented command entry points

**Evidence: reproduced Knip output and source/reference inspection.**

```sh
node_modules/.bin/knip --no-progress --include files --reporter json
# 17 reported files:
# 14 under scripts/eval or scripts/probes, plus 3 root config files
```

`knip.jsonc` declares `scripts/*.ts` and `evals/**/*.ts` as entries. Nested script CLIs fall outside the first pattern.

Decision for each of the fourteen:

| File under `scripts/` | Decision | Reason |
|---|---|---|
| `eval/quotes-spread-eval.ts` | Keep | Method for the recorded Quotes-spread experiment |
| `eval/skim-coverage-eval.ts` | Keep | Used for multiple Skim comparisons, including later schema review |
| `eval/skim-depth-blind.ts` | Keep | Produces blind packets from coverage results |
| `eval/skim-diversity.ts` | Keep | Measures a continuing product property without a model |
| `probes/260930a-investigate-probe.ts` | Keep as historical | Recorded stage-one measurement cites it |
| `probes/260930a-investigate-prompt.ts` | Keep as historical | Exact draft used by that measurement; deleting it would orphan the method |
| `probes/260930d-quote-stop-repro.ts` | Keep | Reproduction of the quote-guard failure |
| `probes/260930f-figure-order-probe.ts` | Keep | Distinct-image control for provider image ordering |
| `probes/261001a-paper-read-probe.ts` | Keep | Exercises the real cited-paper composition |
| `probes/261001h-fidelity-guard-probe.ts` | Keep | Labelled evidence supporting the guard decision |
| `probes/261001p-blind-packet.ts` | Keep | Method behind the blind comparison |
| `probes/261001p-check-saved-levels.ts` | Keep | Runs the production checker over saved outputs |
| `probes/261001p-dig-deeper-search-live.ts` | Keep | Focused provider/tool compatibility witness |
| `probes/261001p-investigate-cost.ts` | Keep | Recorded end-to-end cost measurement |

The old draft prompt’s header says it will be deleted after shipping. The later recorded measurement is a reason to retain it, clearly historical; it is not the current production prompt or a reliably frozen assembled request.

**Cheapest fix:** declare these research CLI directories as entry points. Do not delete cited instruments to clear Knip, and do not treat the other three configuration findings as confirmed dead files.

**Files:** `knip.jsonc`; historical-status wording in the old probe pair if needed.

## F10 — The browser isolation witness can pass before the conflict exists

**Evidence: proved from code.** The breadth investigator reported a fake-provider reproduction; this depth pass independently checked the mechanism, not the browser.

`scripts/remote-smoke-mcp-browser.mjs:147` judges each navigation response immediately. `finish`, at line 117, kills that client. Line 227 starts two `openPage` calls concurrently, but there is no barrier requiring both to remain alive and observe their state after both navigations.

A shared page can answer A’s navigation with A, then B’s navigation with B. Both responses satisfy the marker checks. A is never read again after B has changed the shared state.

The [registration-versus-behaviour postmortem](../postmortems/260908g-a-check-asserted-registration-not-behaviour.md) correctly demanded a behavioural check. The built check proves page opening more strongly than it proves simultaneous isolation.

**Cheapest fix:** keep both clients alive, establish a readiness barrier, perform both navigations, then independently reread each client’s state using the appropriate MCP tools. Keep a deliberately shared-state fake that must fail. Bound cleanup of the process tree as part of the same harness lifecycle.

**Files:** `scripts/remote-smoke-mcp-browser.mjs`, focused fake-transport tests.

## The seven postmortem families: is the defence built?

The family names and member counts below come from B-knowledge; this was a depth check of representative countermeasures, not a fresh postmortem census.

| Family | Can construction prevent it? | What is built; what remains |
|---|---|---|
| **A — evidence weaker than its claim, 13** | Often: attach proof to the union branch it licenses; derive wire types; prohibit unsupported success states | Account-reading integrity guards and fleet wire/import guards exist. F1 and F10 show that endpoint tests still need composition or adversarial behavioural witnesses. No universal type can prove an observation actually happened. |
| **B — correct rule, contradictory implementation, 7** | Yes where copies can become one imported implementation or exhaustive table | `resource-policy.ts` removed copied health thresholds; evals now share the Structure parser. F2 and F7 show why the scope of sharing matters: historical bytes must not share live wording, while live acceptance must share more than parsing. |
| **C — layout measured at the wrong time or from the wrong width, 8** | Partly: one width source and one landing/remeasure mechanism | `reader/measure.ts:96`, viewport-width tests and page-wide CSS guards are built. The Playwright launch recipe now includes `ignoreDefaultArgs: ["--hide-scrollbars"]`; the postmortem’s “not yet done” is stale. Font/DOM timing still needs realistic browser conditions. |
| **D — React state or events judged at the wrong moment, 8** | Partly: immutable action snapshots, explicit acknowledgement states and data identity | `use-search.test.ts:913` covers failed unacknowledged requests; `dock-quick-search.test.tsx` covers deferred handoffs. These are built regressions. Types alone cannot prove scheduling order; use delayed producers and boundary tests. |
| **E — tests depend on state they do not own, 6** | Required dependency objects can make pure runners explicit; CLI defaults can remain in the composition root | `changelog-runner.test.ts:451` owns its pending file; `thinking-effort-eval.test.ts:215` builds its own corpus. F4 remains open in sibling daemon tests. No global hermeticity rule was found, and the prior global-temp-root proposal remains rejected. |
| **F — model-output contract mismatch, 9** | Syntax and required shape: yes, through schemas and narrower outputs. Semantic truth: no | Structured-output validation and starts-only Structure are built. `simple-summary.test.ts:484` rejects blank sentence text. F7 shows eval acceptance still differs. The long-answer signal survives its rename as `wholeDocumentCalls`, logged at `pipeline.ts:2818`. |
| **G — timeout/cancel/recovery does not converge, 5** | Owned children, explicit terminal outcomes and draining child work close specific subclasses | `fleet-child.test.ts:170` exercises a TERM-ignoring child; `quick-search.test.ts:400` checks descendant draining. F3 is the missing adoption/closure guard. A blanket `Promise.all` ban would not encode ownership correctly. |

A useful correction to the input digest: “habit only” understates E’s local fixes. Fixtures and condition helpers are built. What is missing is their consistent use at remaining sites.

## Production signals and static defences

The underlying approach is sound, with several strong controls already present:

- `tsconfig.base.json` enables strict checking, unchecked-index protection, exact optional properties, unused checks and unreachable-code checks.
- `scripts/typecheck.ts` discovers projects, rejects empty checking and checks `.ts`/`.tsx` coverage. This is stronger than trusting a compiler exit code alone.
- `tests/biome-config-is-live.test.ts` checks both configuration loading and actual rule behaviour, including a negative control.
- Fleet import guards parse syntax and include self-checks. Reuse that machinery for F3.
- `src/jobs.ts:1273` explicitly captures step failures, including failures returned through successful job-advance HTTP responses.
- `src/monitoring.ts:214` isolates captures; `monitoring-scrub.ts:31` allows bounded diagnostic properties such as closed-set codes. This is preferable to forwarding arbitrary model or article text.
- `wholeDocumentCalls` is logged for successful Structure runs, so the long-answer postmortem’s requested re-ask signal was not lost when `structureCalls` was renamed.

No new Sentry alert is recommended from this inspection. There is no verified production incident sample, alert configuration or volume estimate here proving that a proposed threshold would have fired usefully.

The library handoff and moving eval baseline need deterministic guards: neither normally throws an exception for Sentry to capture. A blocked dashboard event loop also cannot reliably report its own blockage.

## Two ways to do one thing — and where drift is proved

| Competing paths | Evidence |
|---|---|
| Library link producer versus destination matcher | Actual composed probe returns zero hits; F1 |
| Historical and current Structure expectations | `9ac3ee21b` updates the shared historical expectation with current wording; F2 |
| Synchronous versus owned health collection | New-session route still uses sync `collectHealth`; F3 |
| Fixed-window versus condition-driven daemon fixtures | `1a5afe5f0` introduced the helper and converted files, while named siblings still sleep before assertions; F4 |
| Source-file lists for eval identity | Shared paperwork changed without changing the files hashed by the plain-words harness; F5 |
| Comparison exporters | Missing counterpart throws in Answers but is skipped in Paperwork; F6 |
| Final-message acceptance | Production checks refusal/truncation; two eval shells parse directly; F7 |

The repeated harnesses copy article loading, generation, provenance, result writing and pairing. The harmful duplication is the **experimental contract**, not their similar command-line plumbing.

Extract only the small decisions that have demonstrably diverged: request identity, expected case-set validation and final-message acceptance. A universal eval runner would add more coupling than this evidence justifies.

## Testability and the named hotspots

`health-view.ts` is 424 lines and already exposes the pure `readHealthStats(unknown)` seam. Its shared thresholds are an example of a successful construction-level fix. Complexity 155 was supplied as a lead; it was not independently remeasured here.

`ActionButtons.tsx` is 2,244 lines. It mixes queue presentation, confirmation lifecycle, outcome wording and box actions. Some decisions are already pure; exhaustive `successCopy` and typed queue-copy tables are useful defences.

The harder seam is `BoxActions` around line 1877: preview generation, stale-response rejection and confirmation state live inside React callbacks. Extract a small state transition only when a lifecycle regression demands it. Existing complexity alone does not justify moving all buttons or introducing a generic confirmation framework.

`scripts/overseer.ts` is 1,906 lines, but already separates argument parsing, scheduler wiring, report dependencies and daemon composition. Its urgent issue is the reachable I/O contract in F3, not its line count.

`tests/fleet-web.test.tsx` contains pure parser/body tests alongside DOM tests—for example the groups at lines 8351 and 8418. They are candidates for focused Node-environment files when edited. This pass did not measure enough runtime or flakiness to rank a wholesale split as a correctness improvement.

## PRODUCT simplifications

No reader feature removal is supported by this investigation.

One operator-facing fallback is possible if async steering must wait: remove direct action delivery from the dashboard and direct the operator to the terminal. This removes a blocking path but loses mobile steering and queued convenience. It is a product trade-off, not the recommended fix, and would not remove the other synchronous probes.

Do not remove historical eval instruments merely because their experiments finished. The lost capability is reconstructing how a product decision was reached.

## Considered and rejected

- **Blanket sleep prohibition:** also catches safety deadlines, condition polling, timer tests and zero-delay settling.
- **Fake all daemon clocks:** repeats a rejected proposal and weakens real wiring tests.
- **Generic timer or eval framework:** narrower existing helpers and seams address the proved drift.
- **Split files because they are large:** insufficient evidence for the named hotspots.
- **Copy every live prompt into evals:** breaks intentionally live incumbents; freeze only historical claims.
- **Ban all `src/` imports in frozen modules:** unnecessarily forbids types and harmless utilities, while missing indirect prompt dependencies. Pin rendered output.
- **Promote whole lint or Knip to a gate:** prior rejection still applies; F8 is a narrow rule.
- **Delete all fourteen unused scripts:** their entry-point configuration is wrong; the scripts retain evidential value.
- **Increase timeouts:** neither establishes that work happened nor bounds a synchronous child.
- **Move collection wholesale into another process:** previously rejected; does not establish ownership or bound individual operations.
- **Add broad Sentry forwarding:** unsupported by an incident replay and contrary to the established privacy boundary.

## Overall judgement and ranked work clusters

The architecture does not need a T3 rewrite. Its best defences already use the right mechanisms: explicit ownership, shared leaf policy, discriminated states, real-boundary tests and negative controls.

The recurring failure is incomplete adoption, or a guard whose claim exceeds what it observes. Finish those boundaries before adding another framework.

Recommended order, with mostly separate file sets:

| Rank | Cluster | Findings | Boundary and landing condition |
|---|---|---|---|
| 1 | Library handoff | F1 | One producer and its tests; real destination finds the term |
| 2 | Historical Structure control | F2 | Frozen module/fixture and request-parity test; current wording changes cannot alter the historical digest |
| 3 | Operational child ownership | F3 | Probe conversion first; steering as a separately reviewed stage with serialisation and quarantine preserved |
| 4 | Remaining daemon witnesses | F4 | Test-only cluster; wait for named work and counted negative opportunities |
| 5 | Eval evidence contracts | F5–F7 | Shared harness files: keep together or stage serially; request identity, denominator and acceptance each get an adversarial test |
| 6 | Browser isolation witness | F10 | Smoke script and fake transport; shared state must fail while both clients remain alive |
| 7 | Narrow promise gate | F8 | Check scripts and one CLI; demonstrate red before promotion |
| 8 | Research CLI discovery | F9 | Knip entries and historical status; clear false positives without deleting evidence |

F3 is larger and riskier than the other confirmed defects. That justifies stages, not another indefinite deferral: monitoring has to remain usable under the conditions it exists to diagnose.

Up: [investigations.md](../project/investigations.md) · Parent: [fifth sweep umbrella](../plans/261003f-fifth-codebase-sweep-umbrella.md)