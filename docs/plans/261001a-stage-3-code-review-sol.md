## Findings

- **C-1 — P2 — passages model could silently differ from the quick-check model.**  
  The new job had a separate environment override, so the draft’s “quick check’s model” claim became false whenever either override was set. The existing test compared two identical defaults and could not detect this. I made both jobs share `SPIDERYARN_CITATIONS_FIND_MODEL`, while retaining separate ledger attribution, and added an override-based test that would fail under the old wiring. Evidence: [src/models.ts:1304](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/src/models.ts:1304), [tests/citation-investigate.test.ts:1131](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/tests/citation-investigate.test.ts:1131).

- **C-2 — P2 — no test proved `PAPER_SELECTION_VERSION` participates in the fingerprint.**  
  The implementation was correct, but its regression protection was missing. I added an independently constructed expected digest containing the selection version; removing or moving that component now fails. Evidence: [src/citation-investigate-context.ts:150](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/src/citation-investigate-context.ts:150), [tests/citation-investigate-context.test.ts:127](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/tests/citation-investigate-context.test.ts:127).

- **C-3 — P3 — paper-reader faults were specified but untested.**  
  The code already lets `readPaperEvidence` faults fail the press. I added a test proving no passages call, streamed answer, save, or `done` occurs, while the allowance is released. Evidence: [src/citation-investigate.ts:853](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/src/citation-investigate.ts:853), [tests/citation-investigate.test.ts:1155](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/tests/citation-investigate.test.ts:1155).

No P0 or P1 findings.

All nine builder decisions are sound after C-1/C-2: `null` versus `[]` is represented accurately; the 50-press cap stays below $20; the lease includes registry, PDF, passage, and answer deadlines; malformed entries are handled as specified; reader faults propagate; passages stay collapsed; `not-confirmed` remains generic; the fence re-export preserves callers; and the fingerprint now has direct coverage.

The passage provenance path is sound: parsing is bounded, verification is limited to the named sent chunk, the stored text is the source slice rather than the model’s spelling, paper text remains outside the stream guard’s allowlist, and passages appear only when opened. Both paper-bearing prompts fence and delimiter-defuse the paper, place a reminder afterwards, and the passage call has no tools. Non-read states give the model explicit system and state-specific prohibitions; as with any generative prose, this is prompt enforcement rather than a semantic output validator.

The migration is additive and nullable, accepts legacy all-null rows, and its checks match every state written by the mapper. Paper data remains owner-only, is absent from the public projection, and is carried by the export paths. The composition root wires the real registry and paper reader.

Verification:

- Typecheck: passed all projects using the requested `node --import tsx` fallback.
- Unit tests: 13 files, 380 tests passed; final focused rerun, 116 passed.
- `drizzle-kit check`: passed.
- Biome: no errors; two advisory complexity notices.
- `git diff --check`: passed.
- Database-dependent route/export tests could not run because this sandbox cannot reach the local Postgres socket; the runner aborted rather than skipping them.

**Verdict: approve after fixes.** No commit made.