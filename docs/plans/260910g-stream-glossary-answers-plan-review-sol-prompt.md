You are reviewing a short implementation plan in the Spideryarn repo, read-only. Do not edit files.

Plan: docs/plans/260910g-stream-glossary-answers-as-they-arrive.md
Parent (section E and the "Common completion contract"): docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md

Code to read: src/term-lookup.ts (makeAskAboutTerm, makeLookUpTerm), src/explain.ts (explainStream,
especially the `abandoned` case that yields `done` with partial text), src/routes.ts (the `sse`
helper, `answer`, `markOneAnswer`, and the `askTerm` / `lookup` POST routes near line 8300),
src/web/useGlossary.ts (`ask`, `look`, `clearAsked`), src/web/GlossaryPanel.tsx (`AskATerm`,
`Looked`, `LookupAnswer`), src/web/lib/sse.ts, src/web/useQuiz.ts (`readMark`, the terminal
contract precedent), tests/glossary-asked-term.test.ts, tests/glossary-asked-term-race.test.tsx,
tests/quiz-mark-route.test.ts (route harness with a fetch-stubbed provider).

Questions, in the order I care about:
1. Can partial text ever become a completed asked-term answer (or, in stage 2, a saved lookup) under
   this design? Walk each ending: provider error, EOF without [DONE], our own timeout/stall, reader
   abort, changed term, changed slug, unmount.
2. Does anything in the design let the reader's typed term be presented as article quotation?
3. Is the split "refusals before headers, then stream(signal)" sound, given `sse(res)` must be called
   after every throwing read? Any refusal that would move into the stream?
4. Is there existing rate-limit or spend-gating middleware on these routes that the plan says does not
   exist? (It claims: none; only withSpendAttribution.)
5. Anything in stage 2's sketch (done only after save succeeds) that will not work with the current
   store or client merge (`patchEntry`)?

Answer with numbered findings, each with severity (P0/P1/P2), the file and line, and the concrete
failure. Say plainly if you find nothing on a question.
