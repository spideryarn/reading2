You are reviewing a PLAN (and a spiked server half) for the Spideryarn repo, read-only. Do not edit files.

Read, in this order:

1. docs/plans/260930j-debate-themes-and-key-sources.md — the plan. Greg's request is quoted at the top.
2. src/debate-themes.ts — the new pure module: prompt, `themesPrompt`, `readSynthesisAnswer`, `keyCap`.
3. src/debate.ts — `synthesiseDebate` (search for it) and where `generateDebate` calls it. Also read the file header to understand this stage's "every failure is total" rule, which the plan makes one exception to.
4. src/types.ts — `Debate.synthesis`, `DebateKeyRole`, `DebateTheme`, `DebateKeySource`, `DebateSynthesis`, `readStoredSynthesis` (search for them).
5. docs/plans/260930j-themes-eval-run1.txt and -run2.txt — the two measured passes over nine real stored debates.
6. For the client half, which is not built yet: src/web/DebatePanel.tsx (the `DebatePanel` function), src/web/modes/debate/DebateMode.tsx, src/web/params.ts (`bearsParam`, `debateOrderParam`), docs/project/url-state.md (first 40 lines).
7. src/public/dto.ts § `publicDebate` — confirm `synthesis` cannot reach a visitor.

Questions to answer:

- Is the exception to "every failure is total" sound, or does storing `{kind:"failed"}` create a silent-success hole (docs/reusable/silent-success.md)? Is there any path where a failure is stored as `made` with empty lists and looks like "no themes"?
- Does `readSynthesisAnswer` enforce what the plan claims? Any id, dedupe, cap or type hole? Is the rows/3 key cap and the two-URL theme rule right?
- `readStoredSynthesis`: does it re-check enough on the way out of the database? Anything the client could crash on?
- Abort handling in `synthesiseDebate`: does an abort or the step's clock propagate correctly? Could a thrown non-ProviderRefused error that is not an abort be swallowed wrongly (e.g. a programming bug hidden as `failed`)?
- Cost metering: is the third call counted on the debate step's ledger in production (look at how the pipeline opens a spend collector around a step)?
- Prompt: any injection or plain-words problem; is the `origin` role a good addition to Greg's three?
- Client design: the URL parameter name `?dbtthread=`, the filter running after both bars, what the head count and foot lines should say, the disabled-thread rule. Anything that conflicts with how DebatePanel counts rows ("every number on this panel is read out of one result")?
- Anything simpler that gets Greg the same thing?

Write your findings as a numbered list, each with severity (P0 blocker / P1 should fix before building / P2 worth doing / P3 nit), the file and line, what is wrong, and the fix. End with a one-line verdict: build as planned, build with changes, or rethink.
