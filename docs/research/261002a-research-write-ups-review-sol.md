Reviewed all 13 research notes and the glossary paragraph.

- `261002a` — Fixed “highest score” → “highest quality point estimate.” The source explicitly distinguishes the point estimate from proof that Opus is best ([source](/home/greg/code/spideryarn2/docs/plans/261001s-dig-deeper-answer-model-eval.md:478)).
- `261002b` — Clean.
- `261002c` — Clean.
- `261002d` — Clean.
- `261002e` — Clean.
- `261002f` — Clean, including Luna’s `openai/gpt-5.6-luna` identifier and the “not recurred, not fixed” qualification.
- `261002g` — Clean.
- `261002h` — Fixed “automatic retry … ships beside the flip” → records the source conflict and later decision: range failures became non-throwing; retry remained a possible follow-up. The results note claimed retry shipped ([source](/home/greg/code/spideryarn2/evals/results/hierarchy-waves-real-corpus-2026-09-04.md:119)), but the later implementation record says the failure was removed instead ([source](/home/greg/code/spideryarn2/docs/plans/260904c-hierarchy-structure-in-waves.md:602)) and retry remained unbuilt ([source](/home/greg/code/spideryarn2/docs/plans/260904c-hierarchy-structure-in-waves.md:617)).
- `261002i` — Clean.
- `261002j` — Clean.
- `261002k` — Fixed title “four measurements” → “five measurements.” The sources contain the baseline, `/6` versus `/7`, quote-spread, deeper-pass, and diversity measurements ([baseline](/home/greg/code/spideryarn2/docs/plans/260928a-trajectory-mode-stage6-coverage-baseline.md:62), [comparison](/home/greg/code/spideryarn2/docs/plans/260928a-trajectory-mode-stage6-coverage-after.md:11), [quote spread](/home/greg/code/spideryarn2/docs/plans/260928a-trajectory-mode-stage6a-quotes-spread-eval.md:128), [deeper passes](/home/greg/code/spideryarn2/docs/plans/260929b-trajectory-stage2-deeper-passes-eval.md:11), [diversity](/home/greg/code/spideryarn2/docs/plans/260929e-trajectory-each-pass-walks-only-its-new-stops.md:33)).
- `261002l` — Clean.
- `261002m` — Fixed “floor 80%” → “predeclared 80% average floor.” The source defines the criterion as at least 80% on average; an individual list reached 71% ([source](/home/greg/code/spideryarn2/docs/plans/260929g-faq-difficulty-centrality-and-a-threshold.md:177), [clarification](/home/greg/code/spideryarn2/docs/plans/260929g-faq-difficulty-centrality-and-a-threshold.md:234)).
- `glossary.md` — Fixed “Opus scored highest” → “Opus had the highest quality point estimate,” using the same source as `261002a` ([source](/home/greg/code/spideryarn2/docs/plans/261001s-dig-deeper-answer-model-eval.md:478)).

All relative links resolve; `tests/doc-links.test.ts` passed 16/16. The only statement without a file source is the explicitly accepted 2026-10-02 Greg quote. No paid evals were rerun.

VERDICT: accurate after fixes