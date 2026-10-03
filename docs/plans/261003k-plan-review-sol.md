Reviewed against **`316e9365c`**. No repository files changed.

1. **F1 — P0: caller-defined options make this a paid classification proxy.**  
   **Evidence:** [plan:83](/home/greg/code/spideryarn2/.claude/worktrees/fbt0dg9u-command-bar-natural-language/docs/plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md:83), [plan:180](/home/greg/code/spideryarn2/.claude/worktrees/fbt0dg9u-command-bar-natural-language/docs/plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md:180).  
   A signed-in caller can supply arbitrary answer ids and descriptions—for example, options classifying an email as spam or legitimate. Returning only an offered id still delivers the classification. Browser validation cannot protect callers who invoke the endpoint directly. This is separate from the accepted no-per-reader-cap decision.  
   **Fix:** Put command descriptions in one shared, trusted registry. Send available command keys and bounded state variants; derive the model’s option text on the server. Preserve dynamic availability without maintaining a second catalogue. Remove the absolute “useless as a general model proxy” claim: prompt restrictions cannot guarantee that.

2. **F2 — P1: the small-model arms cannot supply the confidence contract.**  
   **Evidence:** [plan:130](/home/greg/code/spideryarn2/.claude/worktrees/fbt0dg9u-command-bar-natural-language/docs/plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md:130), [plan:154](/home/greg/code/spideryarn2/.claude/worktrees/fbt0dg9u-command-bar-natural-language/docs/plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md:154), [plan:195](/home/greg/code/spideryarn2/.claude/worktrees/fbt0dg9u-command-bar-natural-language/docs/plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md:195).  
   Those arms return `{id, argument}`, but v1 requires confidence to distinguish automatic execution from proposals. In the hybrid, Jev’s confidence concerns the command choice; it does not establish that the second model extracted the right argument. A sure `find` with wrong words could therefore run automatically.  
   **Fix:** Declare each arm’s complete response and execution policy before measuring it. Calibrate automatic execution against **correct command plus correct argument**, after production validation. The conservative v1 is to propose argument answers and any model answer without measured confidence.

3. **F3 — P1: one model answer can resolve to several commands.**  
   **Evidence:** [plan:195](/home/greg/code/spideryarn2/.claude/worktrees/fbt0dg9u-command-bar-natural-language/docs/plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md:195), [command-proposal.ts:241](/home/greg/code/spideryarn2/.claude/worktrees/fbt0dg9u-command-bar-natural-language/src/web/command-proposal.ts:241), [command-proposal.test.ts:129](/home/greg/code/spideryarn2/.claude/worktrees/fbt0dg9u-command-bar-natural-language/tests/command-proposal.test.ts:129).  
   A confident `glossary + FE` answer produces two rows when two visible entries share that alias. The existing contract explicitly leaves that choice to the reader. “One `row` or `argument` answer” does not establish an unambiguous destination.  
   **Fix:** Require exactly **one ready, executable command after resolution**, as well as confidence and risk checks. Multiple matches must remain proposals. Add this case to the bar tests.

4. **F4 — P1: holding Enter can confirm a spending proposal without a fresh press.**  
   **Evidence:** [plan:198](/home/greg/code/spideryarn2/.claude/worktrees/fbt0dg9u-command-bar-natural-language/docs/plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md:198), [CommandBar.tsx:1544](/home/greg/code/spideryarn2/.claude/worktrees/fbt0dg9u-command-bar-natural-language/src/web/CommandBar.tsx:1544).  
   Enter’s repeated keydown events are currently accepted. Hold Enter to request interpretation; once a spending row appears and `inFlight` clears, the next repeat activates it. The single-flight guard prevents concurrent requests, not confirmation by the original held key.  
   **Fix:** Require a fresh, non-repeated Enter for confirmation; ignore composition events too. Test a held Enter across the request’s completion, asserting zero command runs until release and another press.

5. **F5 — P1: resolving by id can substitute the opposite action after state changes.**  
   **Evidence:** [plan:191](/home/greg/code/spideryarn2/.claude/worktrees/fbt0dg9u-command-bar-natural-language/docs/plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md:191), [article-commands.ts:172](/home/greg/code/spideryarn2/.claude/worktrees/fbt0dg9u-command-bar-natural-language/src/web/article-commands.ts:172), [CommandBar.tsx:584](/home/greg/code/spideryarn2/.claude/worktrees/fbt0dg9u-command-bar-natural-language/src/web/CommandBar.tsx:584).  
   Archive and Put back share `action:archive`. A masthead archive request can be pending when command picking starts. If that write settles first, an answer selecting the offered Archive id resolves to today’s **Put back** command. The sentence and opening are unchanged, so the proposed guards accept it.  
   **Fix:** Bind answers and suggestions to the offered command’s semantic variant, not merely its id. Discard changed variants and resolve current runners at confirmation time. Use a request revision invalidated by edits, closure, account changes and relevant context changes.

6. **F6 — P2: the predeclared selection rule can choose a slower, more complicated arrangement.**  
   **Evidence:** [plan:124](/home/greg/code/spideryarn2/.claude/worktrees/fbt0dg9u-command-bar-natural-language/docs/plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md:124), [plan:140](/home/greg/code/spideryarn2/.claude/worktrees/fbt0dg9u-command-bar-natural-language/docs/plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md:140).  
   A standalone small model could tie Jev’s picking accuracy, extract arguments correctly and finish under one second, yet be rejected because it does not beat Jev’s pick “outright.” The rule then chooses two calls. It also specifies neither an absolute quality floor nor a concrete meaning for “a few points.”  
   **Fix:** Compare complete validated outcomes on the production no-match subset. Measure the hybrid’s conditional, sequential latency and cost—including wrong Jev picks—and report argument-request latency separately. Define quality floors and prefer one call when outcomes are materially equivalent. Freeze thresholds before evaluating the blind set. “Nothing destructive picked” is otherwise vacuous when destructive commands are absent from the list.

7. **F7 — P2: extending the existing runner can silently reuse obsolete answers.**  
   **Evidence:** [plan:118](/home/greg/code/spideryarn2/.claude/worktrees/fbt0dg9u-command-bar-natural-language/docs/plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md:118), [run.ts:190](/home/greg/code/spideryarn2/.claude/worktrees/fbt0dg9u-command-bar-natural-language/evals/command-pick/run.ts:190).  
   Existing results are reused by phrase id alone. Relabelling the original 72 requests and replacing their catalogue does not invalidate their saved answers. A normal run would mix historical and new measurements.  
   **Fix:** Use a fresh results namespace or fingerprint the model, prompt, catalogue, sentence and arm settings. Preserve the original measurement separately.

The stage cut is reasonable: measurement, implementation, then documentation and browser checks. Stage 1 should settle the trusted catalogue and confidence policy so it measures what Stage 2 will actually ship.

The required `opensOnly` field addresses Archive’s immediate execution risk. The no-per-reader-cap policy is explicitly accepted. Jev’s word-selection trick is worth an experimental arm; measure reconstructed arguments through `readPick`. Keeping literal extraction is defensible for v1—silently changing dictated “neuro science” into “neuroscience” would require a separate correction policy.

Validation: existing proposal suite **17/17 passed**; no paid calls made.

**Verdict: build with these changes.**