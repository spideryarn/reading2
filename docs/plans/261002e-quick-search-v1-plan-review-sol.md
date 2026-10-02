The core design is right for v1: a third matcher reuses the existing workflow, `kind` deserves a column because pending/error runs lack a model, and **flesh out should create a separate meaning run** so the quick answer remains available for comparison.

I found one established P1 and several P2 gaps. Evidence below refers to the original code baseline; concurrent implementation edits appeared during the review.

1. **F1 — P1: `isSearchable` does not exclude headings.**  
   The plan explicitly relies on that behaviour (`docs/plans/261002e-quick-search-v1.md:98`). In reality, the predicate returns `gistable` (`src/block-policy.ts:101`), and ordinary headings remain gistable (`src/blocks.ts:355`). All nine Noema fixture headings pass it; its title scores **0.86 with the proposed plain prompt** (`evals/results/quick-search-spike-2026-10-02/raw-noema-mythology-of-conscious-ai.json:450`). The documented junk therefore survives the proposed filter.  
   **Fix:** explicitly exclude `kind === "heading"` locally in quick search, retaining searchable supplements. Test with a gistable heading; do not change the shared predicate.

2. **F2 — P2: whole-block quotes bypass both snippet budgets.**  
   The proposed conversion uses the entire block as `quote` (`plan:87`). `resolveOne` passes the located span to `snippet` (`src/web/search-hits.ts:558`), whose budget never truncates the matched span (`src/quote-match.ts:438`). A read-only probe returned **6,499 characters for both the 90-character snippet and 400-character hover budget**. CSS clamps the visible list to three lines, but the hover still receives the entire paragraph.  
   **Fix:** separate the highlight span from the preview window for quick hits. Keep whole-block highlighting while bounding list and hover excerpts. Test a long block; do not set `Found.whole` merely to obtain shorter snippets, because that flag means quote placement failed.

3. **F3 — P2: overflow recovery needs a deliberate gateway exception.**  
   “Modelled line for line on `openRouterTranscription`” (`plan:80`) conflicts with the proposed context-error recovery (`plan:139`). The baseline `ProviderRefused` discards the response body and exposes no context-overflow classification (`src/ai-call.ts:1165`). The raw failure embeds `max_tokens_exceeded` inside `error.message` (`evals/results/quick-search-spike-2026-10-02/mechanics.json`, `overflow`). A caller cannot recover that reason after the seam discards it.  
   **Fix:** specify an allowlisted `context-exceeded` classification at the gateway boundary, without exposing provider text. Test overflow, unrelated 400, and malformed error bodies. The concurrent draft already begins addressing this; retain it as an explicit plan requirement.

4. **F4 — P2: the response and termination contracts are underspecified.**  
   The conversion/chunking description (`plan:85`) does not require complete, valid answers or define a deadline. The spike helper silently accepts missing `answers` as `{}` (`runner.ts.txt:132`). Copying that behaviour could save malformed or incomplete output as a successful search with no matches. Halving also cannot rescue one oversized block.  
   **Fix:** require an answer for every submitted question, with the expected type and a finite `noul` in `[0,1]`; fail the run if a chunk is incomplete. Define one overall deadline covering requests and retries, abort outstanding work on failure, and terminate clearly on an oversized singleton. Add negative tests for missing answers, invalid probabilities, one failed chunk, timeout, and singleton overflow.

5. **F5 — P2: retry identity must include the matcher on the server.**  
   The plan covers client retry-by-kind (`plan:96`), but `withRun` identifies a retry only by id, criterion and error status (`src/searches.ts:160`). Its reset rebuilds the row field by field, and the SQL reset repeats those same conditions (`src/store/pg-searches.ts:200`). Client transport errors also rebuild rows (`src/web/useSearch.ts:574`).  
   **Fix:** preserve `kind` in every optimistic/error/reset row; include it in retry identity and the corresponding SQL predicate; dispatch using the persisted run’s kind. Key in-flight duplicate suppression by **kind plus criterion**, so a meaning request for the same words can run while quick is pending. Test mismatched-kind requests and retries after a dropped stream.

6. **F6 — P2: `kind` will disappear at explicit projection boundaries.**  
   Neither stage names the exporter, public query or DTO. These rebuild rows explicitly: `src/store/export.ts:667`, `src/store/public-reader.ts:614`, `src/public/dto.ts:1004`, and `src/public-types.ts:839`. The fixture importer also omits new fields unless changed (`tests/helpers/seed-reader-state.ts:338`). A default of meaning could conceal these omissions.  
   **Fix:** carry `kind` through all those boundaries. Add a mixed quick/meaning export round trip and a public quick-run fixture. Verify visitors see the quick label and hits but have no flesh-out, retry, delete or recolour controls. Make the DB column `NOT NULL DEFAULT 'meaning'` with a two-value CHECK.

7. **F7 — P2: the floor evidence does not validate the selected production arm.**  
   The cutoff script evaluates **`noulOne`**, which includes the sentence the plan removes (`cutoff-rules.ts.txt:24`; `runner.ts.txt:85`). Recomputing the raw data, “how the agents covered their tracks” retains **four** blocks at 0.8 with that prompt and **two** with the selected plain prompt (`raw-openai-huggingface.json:2026`, `:2364`). Plain was run once per fixture query and never on the long article. The investigation’s “within one block” stability claim also has a counterexample: 16/14/14 retained hits.  
   **Fix:** assess the final plain prompt and final block filter at the chosen floor, including repeated runs and the long article. Separate ranking evidence from threshold evidence. Describe 0.8 as a provisional product choice until then.

8. **F8 — P2: add the model inventory and privacy work to the stages.**  
   The new seam/job description (`plan:79`) leaves the fixed-model taxonomy implicit, and the docs stage omits privacy (`plan:112`). Jev is not either tier’s model; adding it as an ordinary `Task` would give it unsuitable tier/effort machinery. The privacy page names the default models that receive reader text (`src/web/PrivacyPage.tsx:423`), enforced by `tests/privacy-page.test.ts:83`.  
   **Fix:** explicitly use a fixed-model, non-tier job; update `AiJob`, `AI_JOB_WIRE`, `RoutedJob`, the `ChatJob` exclusion, `JOB_DISPOSITION`, and the model/display inventory. Add Jev and what it receives to Privacy. Verify accounting for **each chunk and retry**, including zero output tokens. No new bypass declaration is needed for calls through the owned seam; the ledger’s purpose and wire columns are text, not closed job enums.

9. **F9 — P2: the quick label must reach result-level score explanations.**  
   The plan distinguishes probabilities only on the saved row and its title (`plan:142`). Results from several runs merge, while their hover and accessible text currently describe the same confidence concept (`src/web/SearchPanel.tsx:1677`, `:1780`). A saved-row tag does not explain which kind produced a score in that merged list.  
   **Fix:** carry or look up run kind for each result and explain quick scores as Jev’s yes score, without presenting them as calibrated accuracy. Retaining the number is reasonable. The default *Prioritised* threshold is **30**, so it does not hide hits already retained at 80; the main issue is interpretation, not an established default-threshold bug.

The billing conclusion checks out: the raw 1/10/40-question probe reports **4,339 / 4,573 / 5,343 input tokens**, supporting once-per-state billing for the tested Jev requests. Four parallel chunks and sub-second latency are also supported for the measured arm; the proposed smaller question allowance is an estimate rather than the exact measured configuration. The endpoint spelling agrees with [OpenRouter’s Decisions reference](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request).

I made no repository edits or paid calls.

VERDICT: proceed with changes