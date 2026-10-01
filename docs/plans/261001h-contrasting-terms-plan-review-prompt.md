# Plan review: Simple's "feedback loops" reversal on the PID paper

You are reviewing a plan, read-only. Read:

- docs/plans/261001h-plain-words-summaries-keep-the-piece-s-contrasting-terms.md (the plan)
- src/simple-summary.ts (the prompt: `simpleSystem`, `SYSTEM_TAIL`) and src/plain-words.ts
- docs/project/prompting-guide.md (how a prompt change is measured here)
- evals/simple/probe.ts (the harness), the outputs under evals/results/simple/high-none-pidpre*/ and the
  older evals/results/simple/*/entropy-24-00930-spya-pywwkq.json
- the paper's passages are quoted in the plan (blocks spya-xs5660 and spya-sd9fzd).

Questions, answer each:

1. Is the diagnosis right? Is "a plain synonym that is already one of the piece's terms for something else"
   the real cause, or does something else (the inputs, the article rendering, the level pitch, the model)
   explain the evidence better? Check the claim that an expert profile almost never makes the slip
   against the outputs yourself.
2. Is the proposed rule the right fix, and is the wording likely to work? Suggest better wording if you have
   it. Could it make anything worse (more jargon kept, outputs over the word ceilings in SIMPLE_LIMITS,
   failed validations)?
3. Is the measurement sound and enough: 6 vs 6 runs on the paper, the definition of the fault, the controls,
   the threshold "0–1 of 18 after"? What would produce a false "fixed"?
4. Is leaving SIMPLE_VERSION unbumped right? And leaving the shared plainWords() core alone?
5. Anything else wrong or missing.

Answer with findings ranked P0/P1/P2, each with its evidence (file:line or output path).
