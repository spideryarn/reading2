Found and fixed three scoped issues; one wider branch-state issue remains.

C1 (P2) — A stored non-DOI value prevented the arXiv URL fallback. Fixed precedence so only a valid DOI wins; added a regression that failed before the fix. Evidence: [citation-index.ts](/var/tmp/spideryarn-worktrees/fbqtk3q2-reception-messages/src/citation-index.ts:109), [citation-index.test.ts](/var/tmp/spideryarn-worktrees/fbqtk3q2-reception-messages/tests/citation-index.test.ts:374).

C2 (P2) — The question, feedback note, and plan still claimed “we looked” or that the AI read and judged every page, contradicting the stored evidence. Fixed those claims and regenerated the compiled question file. Evidence: [q-hbg65m.md](/var/tmp/spideryarn-worktrees/fbqtk3q2-reception-messages/docs/user-feedback/questions/q-hbg65m.md:18), [feedback note](/var/tmp/spideryarn-worktrees/fbqtk3q2-reception-messages/docs/user-feedback/261009_2316-reception-empty-sentence-and-the-arxiv-doi.md:28).

C3 (P3) — Singular/plural behavior was correct but unpinned. Added explicit tests for one and multiple pages/candidates. Evidence: [reception-and-claims-panel.test.tsx](/var/tmp/spideryarn-worktrees/fbqtk3q2-reception-messages/tests/reception-and-claims-panel.test.tsx:661).

C4 (P2) — Reporting, not fixed: `origin/dev` advanced during review. The current diff now appears to delete a new, unrelated Overseer rule at [overseer.md](/var/tmp/spideryarn-worktrees/fbqtk3q2-reception-messages/docs/project/overseer.md:803). Merge current `origin/dev` before landing; I left this out-of-scope file untouched.

Validation:

- Required focused suite: 325 passed.
- Typecheck: passed across all projects via `node --import tsx scripts/typecheck.ts`. The exact npm command could not start because this sandbox forbids `tsx`’s local IPC socket.
- Lint, generated feedback checks, and `git diff --check`: passed.
- Full `npm test`: could not start the database lane because local Docker/Postgres was unavailable; the requested unit suite passed independently.

LAND AFTER FIXES