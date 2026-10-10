1. **P1 — Fixed synthetic boundaries weakening copy detection.** [src/shingles.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb9d-debate-who-cited-this/src/shingles.ts:204), [src/debate.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb9d-debate-who-cited-this/src/reception.ts:922). The `⁂` marker prevented stitched quotations, but shingles crossing it inflated the density denominator. Three short extracts copied entirely from the article could therefore evade `sourceIsCopy`. Density now forms windows within each real extract. A failing reproduction was added at [tests/debate.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb9d-debate-who-cited-this/tests/reception.test.ts:218).

2. **P1 — Fixed wider extracts duplicating text and consuming the cap.** [src/openrouter-stream.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb9d-debate-who-cited-this/src/openrouter-stream.ts:543). A later superset was appended after its narrower predecessor, potentially spending the 8,000-character cap on duplicate text and still losing the new tail. Supersets now replace every segment they contain, preserving arrival position and the first title. The cap also never retains a partial or content-free separator. Tests cover subsets, supersets after multiple extracts, ordering, and the cap at [tests/collect-citations.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb9d-debate-who-cited-this/tests/collect-citations.test.ts:267).

3. **P2 — Wider-scope recommendation: Citations’ lookup has the same first-extract loss.** [src/citation-find.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb9d-debate-who-cited-this/src/citation-find.ts:373) collects a completed response with first-wins, then checks the result’s title and model quotations at [src/citation-lookup.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb9d-debate-who-cited-this/src/citation-lookup.ts:431). A title or quotation present only in a later annotation can therefore be lost. I recommend opting that caller into `extracts: "all"` in separate work. I did not change it as requested. `stream-run.ts` is correctly first-wins because it is incremental; Dig deeper forwards the first extract but does not perform the same post-answer row/quote validation.

4. **P3 — Completed missing mutation coverage.** The new prompt test did not cover the changed `directPrompt`; it now does at [tests/debate.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb9d-debate-who-cited-this/tests/reception.test.ts:1288). The substantive fixes above were each observed failing before their implementation. Some collector tests—such as invalid-scheme refusal—are deliberately invariant/security tests rather than tests that fail when the whole feature is reverted.

The joined excerpt does not reach storage, tooltips, or the public DTO: only verified `sourceQuote` and `articleReferenceQuote` slices do, so readers cannot see `⁂`. The journal retains raw provider annotations, not the joined value. `linkTo` over all extracts can add an identification signal but cannot bypass the required witness.

The prompt does not loosen admission or contradict `READING`/`RESTRAINT`. The “copy mistakes” instruction is safe for pass B because those fields are quotations checked against exact source/article text.

The evidence supports § Measured. The saved scores give old prompt **4→7** and new prompt **7→10** on identical journal replays; the prompt-only comparison is correctly described as suggestive. The database-free audit reproduced **565 URLs, 75 multi-extract URLs, 76 first-extract misses, 33 later-extract recoveries**. No plan number is wrong. I could not rerun the database-backed scorer because the sandbox refused the local Postgres socket.

Checks:

- Requested Vitest suite: **4 files, 152 tests passed**
- Typecheck: all four projects passed; only the expected unowned `data/fb9d-score.ts` line
- Full `npm test`: blocked before execution by sandbox `EPERM` connecting to local Postgres
- Lint: only three pre-existing informational findings
- No commit made

**Verdict:** Approve after the in-stage fixes above; retain the Citations opt-in as separate follow-up work.