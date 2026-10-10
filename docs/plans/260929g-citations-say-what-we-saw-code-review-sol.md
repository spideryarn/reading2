## Findings

- **C-1 — P1 — [useCitations.ts:198](/home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/web/useBibliography.ts:198) — fixed.**  
  `lookupSubjectOf` was not a sound mirror of the server fingerprint: it compared block IDs, but not the reference and citing-passage text stored under those IDs. A late reply could therefore show a lookup the server considered stale. Removed the client-side lookup attachment; successful lookups now trigger a fresh read, with `attachLookups` as the sole authority.  
  Red/green test: [citations-find-late-reply.test.tsx:322](/home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/tests/bibliography-find-late-reply.test.tsx:322).

- **C-2 — P2 — [citation-find.ts:290](/home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/citation-find.ts:290) — fixed.**  
  DOI/arXiv identity was required in the selected result URL, but the exact identifier was never sent to the search prompt. Linked DOI rows were therefore unnecessarily likely to become `not-identified`. The prompt now supplies the identifier and the fingerprint version was bumped. The identity check remains strict: a publisher URL without the DOI still does not qualify.  
  Red/green test: [citation-find.test.ts:554](/home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/tests/citation-find.test.ts:554).

- **C-3 — P2 — [CitationsPanel.tsx:313](/home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/web/BibliographyPanel.tsx:313) — fixed.**  
  The `unreadable` copy did not explicitly say the work itself was not read and ambiguously said “nothing here comes from the work.” It now distinguishes the unread work from the discarded search-extract reading.  
  Red/green test: [citations-panel.test.tsx:718](/home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/tests/bibliography-panel.test.tsx:718).

- **C-4 — P2 — [paper-text.ts:196](/home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/paper-text.ts:196) — reported.**  
  The 25-second deadline cannot interrupt `pass0`; it is checked only after PDF parsing finishes. A complex accepted PDF can therefore exceed the claimed whole-read deadline. Fixing this needs abort support in the PDF parser or isolation in a worker, so I did not widen this change. `readPaperText` is not called by Citations yet. I found no SSRF gap: both initial and metadata PDF fetches use `fetchDocument` with its address and redirect checks.

- **C-5 — P3 — [citations.md:199](/home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/docs/project/bibliography.md:199) — reported.**  
  The in-progress documentation says code decides “the result is this work,” while the implementation and reader copy deliberately establish only a matching page/search extract. This is outside the exact commits and the file already had someone else’s uncommitted work, so I left it untouched.

## Files changed

- [src/citation-find.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/citation-find.ts)
- [src/citation-lookup.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/citation-lookup.ts)
- [src/web/CitationsPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/web/BibliographyPanel.tsx)
- [src/web/useCitations.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/web/useBibliography.ts)
- [tests/citation-find.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/tests/citation-find.test.ts)
- [tests/citations-find-late-reply.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/tests/bibliography-find-late-reply.test.tsx)
- [tests/citations-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/tests/bibliography-panel.test.tsx)

No store code was changed.

Verification: all six requested suites passed, **146 tests**; all TypeScript projects passed; `git diff --check` passed. Full `npm test` could not start because this sandbox has no Postgres, as anticipated. No commit was made.

**Verdict: approve stages 1–2 with the fixes above.** The remaining PDF timeout limitation affects the proposed later full-paper stage, not the current search-extract assessment.