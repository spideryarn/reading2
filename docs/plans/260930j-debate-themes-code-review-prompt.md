You are GPT Sol, doing the CODE review of one change in the Spideryarn repo. This is the house workflow: **fix what you find inside this change**, then report. Report anything wider than this change (other modes, the public DTO, security defences) for me to decide rather than fixing it. Do not commit, do not touch git state, do not run `npm run deploy`, do not touch the database, `.env*`, `infra/`, or `src/public/dto.ts` (a security defence).

Context, read first:
- docs/plans/260930j-debate-themes-and-key-sources.md — the plan as built, including § The plan review (your own earlier review of the plan: docs/plans/260930j-debate-themes-plan-review-sol.md) and what was taken.
- docs/plans/260930j-debate-themes-code-review.diff — the scoped diff of this change (src, tests, evals). The working tree also has the merge of the latest dev on top; review only this change.

Files the change touches: src/debate-synthesis.ts (new, client-importable rules), src/debate-themes.ts (new, prompt + answer reader), src/debate.ts (`synthesiseDebate`, the call in `generateDebate`, PROMPT_VERSION), src/types.ts (the synthesis types), src/pipeline.ts (log line), src/messages.ts (one sentence), src/web/debate-threads.ts (new, pure), src/web/DebatePanel.tsx (threads box, filter, key line, failed line, foot counts), src/web/params.ts (`debateThreadParam`), src/web/modes/debate/DebateMode.tsx, src/web/styles/debate.css, and tests: tests/debate-themes.test.ts, tests/debate-threads.test.ts, tests/debate-panel.test.tsx (§ threads), plus small prop additions in three other tests.

Check especially:
1. Does the code do what the plan now claims? Every claim in § The design and § The plan review — verify each against the code, and say which you checked. In particular: failed vs empty made; the work identity (`workIds`, `canonicalAddress`, `titleKey`) — any false merge of two genuinely different works that would wrongly drop a theme or a key source (e.g. short generic titles, same-host different-path pages, title suffix stripping); the stored reader re-applying every rule; error handling in `synthesiseDebate` (only ProviderRefused degraded; aborts and everything else thrown).
2. Panel correctness: every number on the panel read from one result (head count, Showing line, foot lines, thread counts); a stale `?debatethread=` id; a pressed thread the bars empty; the visitor path (a PublicDebate must never reach `readStoredSynthesis`, and nothing should crash for it); React keys; accessibility of the toggle buttons.
3. Anything that could crash the panel on a stored document of an unexpected shape.
4. Tests: does each test actually fail if the behaviour it names breaks? Any test that could pass vacuously? Missing tests for a claim the plan makes?
5. The prompt in src/debate-themes.ts: injection, plain words, whether it asks for anything the code then silently discards.

Gates to run after your fixes (and report the exit codes and summary lines honestly): `npm run typecheck` (judge by exit code; failures go to stderr), and `npx vitest run tests/debate-themes.test.ts tests/debate-threads.test.ts tests/debate-panel.test.tsx tests/debate.test.ts tests/debate-passes.test.ts tests/client-imports.test.ts tests/debate-legacy-lean.test.tsx tests/mode-surface-changes-no-markup.test.tsx tests/url-state.test.ts`.

Write your answer as: a numbered list of findings, each with severity (P0/P1/P2/P3), file:line, what was wrong, and whether you FIXED it (with a one-line description of the fix) or are REPORTING it for me to decide; then the gate results; then a one-line verdict.
