## Findings

- **F1 — P1 — Established:** The before-arm Fuller baseline is read from the wrong field. The plan reports `181, 160, 196 / 182, 212, 183` and four paragraphs ([plan:161](</home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/docs/plans/261004b-summary-fuller-longer-and-bold-and-bullets.md:161>)), but those are the `simple` level’s `words`; the probe records Fuller separately as `fullerWords` ([probe:227](</home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/evals/simple/probe.ts:227>), [example result:25](</home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/evals/results/simple/high-none-fbazb1/s41598-023-33209-9-spya-s0qydm.json:25>)). The actual Fuller results are `261, 221, 258 / 261, 244, 249`, with five paragraphs every time. Their median is 253.5, so the 1.6× threshold is 405.6 words, not roughly 350. Correct the evidence and calculate the numeric threshold in the plan before running the after arm.

- **F2 — P1 — Established:** The experiment changes length, content instructions, and formatting together, so it cannot answer whether bold and bullets improve skimming. The only formatting judgement is Greg’s eye on the combined before/after ([plan:157](</home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/docs/plans/261004b-summary-fuller-longer-and-bold-and-bullets.md:157>)). That also omits the paired, shuffled comparison and unchanged-prompt control required by the project’s measurement rule ([prompting-guide.md:204](</home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/docs/project/prompting-guide.md:204>)). Add a free formatting ablation: render each after artifact twice—once with `key`/`list` honoured and once with them ignored—randomize left/right, and judge skimmability on identical words. No additional model generation is needed.

- **F3 — P1 — Established:** The ship rule permits arbitrary fidelity regression in Brief and Simple. Both levels receive the new key instructions and schema ([plan:95](</home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/docs/plans/261004b-summary-fuller-longer-and-bold-and-bullets.md:95>)), but the fidelity limits and judge cover Fuller only ([plan:167](</home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/docs/plans/261004b-summary-fuller-longer-and-bold-and-bullets.md:167>)). Six flagged Briefs and six flagged Simples could therefore satisfy the declared rule. The existing probe already records every level’s guard result ([probe:234](</home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/evals/simple/probe.ts:234>)); require no material guard or judged-fidelity regression at any changed level.

- **F4 — P2 — Established:** Rule 4 is not fully falsifiable. “Against the spread” does not define whether after must beat the before mean, maximum, confidence interval, or both before draws, and “says whether” the added words are substance or padding supplies no passing threshold ([plan:171](</home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/docs/plans/261004b-summary-fuller-longer-and-bold-and-bullets.md:171>)). Faults per 100 words alone can also approve twice as many wrong claims in a summary twice as long. Predeclare the arithmetic and require both an unchanged fault rate and no increase in summaries containing a serious fault; give substance/padding a scored rubric and threshold.

- **F5 — P2 — Established:** The formal `key` acceptance rule omits “non-empty after trimming” ([plan:69](</home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/docs/plans/261004b-summary-fuller-longer-and-bold-and-bullets.md:69>)). `""` is a substring of every sentence, has zero words under the existing counter ([simple-summary.ts:554](</home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/src/simple-summary.ts:554>)), and is shorter than a non-empty sentence, so the stated checks would retain an empty `<strong>` and falsely improve the 95% retention score. Require trimmed non-empty text in code and express `\\S` in the live schema, as sentence text already does ([simple-summary.ts:429](</home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/src/simple-summary.ts:429>)).

## Answers to the seven suspicions

1. **Reading of the requests:** Broadly right. Longer Fuller, experimental bold/bullets, and declining headings are faithful choices. Structured formatting implements the requested effect without literally storing Markdown, which is reasonable. Nothing substantial is built without a request, although “bold at every level, bullets only in Fuller” is an experiment design choice rather than something Greg specified.

2. **Two fields versus Markdown:** The reasoning is sound. Markdown inside `text` would disturb exact rejoining, guard input, word counts, and sentence links or require stripping in several consumers. The simplest canonical storage is:

   - require `key` and `list` in the live schema;
   - store `key` only when valid and non-null;
   - store `list` only when true;
   - derive `text` exactly as now.

   That avoids persisting repeated `null` and `false` values while preserving one schema and old-row compatibility.

3. **Readers and compatibility:** No production reader needs to break if the plan keeps validation centralized.

   - Raising `SIMPLE_LIMITS.fuller` makes 8 paragraphs and 800 words valid at both generation and read boundaries; 801 remains invalid.
   - An old row with neither field remains usable and renders as prose without bold.
   - A stored invalid `key` should disappear through `usableSentences`; it should not invalidate the summary.
   - `list: true` with two usable sentences should deterministically return prose.
   - The public DTO must rebuild fields rather than spread the stored paragraph.
   - Both exports write the artifact verbatim ([export.ts:452](</home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/src/store/export.ts:452>), [export-bundle.ts:485](</home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/src/store/export-bundle.ts:485>)), so new fields survive automatically.
   - Shape-pinning tests requiring deliberate updates include the schema assertion ([simple-summary.test.ts:471](</home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/tests/simple-summary.test.ts:471>)), prompt-version literal ([simple-summary.test.ts:1282](</home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/tests/simple-summary.test.ts:1282>)), public field allowlist ([public-dto.test.ts:1843](</home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/tests/public-dto.test.ts:1843>)), and panel behavior tests.

4. **Strict schema and cache key:** Required nullable `key` and required boolean `list` are valid under `validateAnthropicJsonSchema`; only `key` adds another union parameter, comfortably below the limit ([messages-structured-output.ts:255](</home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/src/messages-structured-output.ts:255>)). Required-nullable also remains compatible with OpenAI’s stricter subset. `ARTICLE_OUTPUT_FORMAT.simple` already points to the same exported schema constant ([pipeline.ts:350](</home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/src/pipeline.ts:350>)), so no separate table edit is needed: changing the schema changes the cache key automatically, and the request/table agreement test covers it.

5. **First sentence as lead-in:** It is sound and is the simplest deterministic rule, provided the prompt explicitly requires a standalone lead followed by at least two one-sentence items. The three-sentence fallback prevents a lead plus one item from masquerading as a useful list. A separate `{lead, items}` shape would be more explicit but adds schema and migration complexity without improving the guard or links.

6. **Versioning and staleness:** A prompt-only bump is correct because the stored additions are optional decorations; this follows the precedent set by optional `sentences`. Existing rows remain usable. They are not marked `stale`, because staleness compares the article fingerprint, but they are marked `outdated` by the prompt-version comparison ([pg.ts:3942](</home/greg/code/spideryarn2/.claude/worktrees/fbazft06-summary-fuller-and-markdown/src/store/pg.ts:3942>)). The UI deliberately keeps that silent. So “not stale” is true; “not marked different in any way” would be false.

7. **Measurement:** Keep the two draws per arm and three articles. Add:

   - the corrected Fuller baseline and precomputed thresholds;
   - the zero-cost formatting-on/off ablation;
   - paired, randomized comparisons, including old-vs-old control;
   - guard/fidelity limits for Brief and Simple;
   - explicit numerical treatment of fidelity and padding;
   - both fault rate and summaries-with-any-serious-fault.

   Replace the vague “substance or padding” judgement with a small rubric: supported new detail, repeated point, generic filler, or unsupported claim. A cross-family judge would also be preferable to having Opus judge Opus-written summaries.

Verdict: **Revise before implementation—the data model is good, but the baseline and experiment/ship rules are not yet trustworthy.**