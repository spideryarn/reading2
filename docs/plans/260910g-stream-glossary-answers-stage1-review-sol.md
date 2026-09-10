No P0 findings. I fixed four in-scope issues; the five stage claims now hold.

1. **P1 — malformed `done` could become `asked` and crash rendering.** [useGlossary.ts:123](/home/greg/code/spideryarn2/.claude/worktrees/glossary-streaming/src/web/useGlossary.ts:123), [GlossaryPanel.tsx:1800](/home/greg/code/spideryarn2/.claude/worktrees/glossary-streaming/src/web/GlossaryPanel.tsx:1800).  
   `citations: [null]` passed the array-only validation, was promoted to `asked`, then crashed on `c.url`. I added structural citation validation and null-safe frame parsing. The regression test at [glossary-asked-term-stream.test.tsx:295](/home/greg/code/spideryarn2/.claude/worktrees/glossary-streaming/tests/glossary-asked-term-stream.test.tsx:295) was red before the fix and is green now.

2. **P2 — same-tick submissions could duplicate or lose a request.** [useGlossary.ts:680](/home/greg/code/spideryarn2/.claude/worktrees/glossary-streaming/src/web/useGlossary.ts:680).  
   The `asking` state closure could admit two synchronous submits before React rerendered. Conversely, `clearAsked(); ask(...)` in one tick could reject the replacement using stale `asking=true`. Admission now uses the synchronously updated `live.current` controller. Added double-submit and clear-then-replace regressions at [glossary-asked-term-stream.test.tsx:194](/home/greg/code/spideryarn2/.claude/worktrees/glossary-streaming/tests/glossary-asked-term-stream.test.tsx:194) and [glossary-asked-term-stream.test.tsx:314](/home/greg/code/spideryarn2/.claude/worktrees/glossary-streaming/tests/glossary-asked-term-stream.test.tsx:314).

3. **P2 — failed partial text appeared above its failure explanation.** [GlossaryPanel.tsx:1584](/home/greg/code/spideryarn2/.claude/worktrees/glossary-streaming/src/web/GlossaryPanel.tsx:1584).  
   This contradicted the documented “under the failure sentence” presentation. I moved the failure ahead of `askDraft`. Drafts still show only “arriving…” or “unfinished”; provenance, sources and “checked” remain exclusive to `asked`.

4. **P2 — test/source commentary overstated its evidence.** [glossary-asked-term-stream-route.test.ts:7](/home/greg/code/spideryarn2/.claude/worktrees/glossary-streaming/tests/glossary-asked-term-stream-route.test.ts:7), [routes.ts:1160](/home/greg/code/spideryarn2/.claude/worktrees/glossary-streaming/src/routes.ts:1160).  
   The route test claimed every refusal was directly covered, although it has representative 400/409 seam controls and the full refusal matrix lives in the unit test. I corrected that wording, fixed the SSE-caller count and two ending-count comments, and removed an unsafe assertion cast.

Claims:

- Claim 1 holds: all refusals precede `sse(res)`; successful requests emit `begin`, deltas, then one terminal frame.
- Claim 2 holds after finding 1. Abandoned, truncated and filtered server endings cannot produce `done`; EOF, error, stall and malformed `done` cannot produce `asked`. The explicitly documented `unknown-finish-reason` and `wants-tools` classifications remain accepted.
- Claim 3 holds: both `begin.quote` and `done.quote` originate from `anchor.matched`.
- Claim 4 holds after finding 2. Clear, slug change and unmount abort; `gone` reaches the provider; stale `finally` blocks cannot change a newer request’s spinner.
- Claim 5 holds: `explain()` strips `ending`, and the comments route remains unchanged.
- The held-provider harness genuinely remains open until `finish()`, and its early snapshot is taken before that release.

Verification: 61 focused unit tests passed; all 2,107 TypeScript files passed typechecking; targeted Biome and `git diff --check` passed. I could not independently rerun the Postgres route file because this sandbox denied the local database connection with `EPERM 127.0.0.1:54362`; I inspected that harness directly. No full suite was run and nothing was committed.

Wider decision: the shallow wire-validation and React-state-as-admission-lock bug classes meet the repo’s postmortem rule. I did not add postmortems because they are outside this stage’s scoped code review.

Files I edited:

- `src/explain.ts`
- `src/routes.ts`
- `src/term-lookup.ts`
- `src/web/GlossaryPanel.tsx`
- `src/web/useGlossary.ts`
- `tests/glossary-asked-term-stream-route.test.ts`
- `tests/glossary-asked-term-stream.test.tsx`