# Key — H1: a plain-words message when looking up a cited work fails, in Citations
**0. Disposition: already done (no-op), report it; at most diagnose one narrow client gap and ask.**
Since 260930d (P-5) the lookup is the first step of *Investigate*, and its failure already reaches
the reader as `CITATION_INVESTIGATE_LOOKUP_FAILED` — "The quick check that looks for this work's
own page failed, so the longer investigation was not started and nothing more was spent. Trying
again starts over. [cite-lookup-failed]" (kind `retry`). A search with no match says so quietly
(`CITATION_NO_MATCH` / `CITATION_LOOKUP_NO_MATCH`), allowance refusals have their own sentences
(`CITATION_INVESTIGATE_BUSY/LIMITED/RESTING`), a paper that could not be read says why
(`paperUnreadableSentence`), and a lookup that landed before a later failure says
`INVESTIGATE_LOOKUP_KEPT`. The only real gap: `src/web/useCitations.ts` shows `(err as Error).message`
(~lines 305, 536) rather than `describeFetchFailure`, so a client bug's raw text could reach the
reader — but nine other mode hooks share that pattern, so that is a sweep to propose, not H1.
## 1. Docs it must read
- MUST `docs/project/citations.md` § "Look it up on the web" (no *Look it up* button since
  2026-09-30; it is Investigate's first step) and § "Investigate" ("A provider failure there stops
  the press before the larger call is paid for; finding nothing does not").
- MUST `docs/project/copy.md` § "The four rules", § "The bracketed code", § "Writing a new one"
  (`CODE_KINDS`, `FROM_FACTORIES`); § "The same seam in the browser" for the client gap.
- USEFUL `docs/plans/260930d-citations-one-button-look-it-up-and-investigate-merged.md` (P-4, P-5);
  `docs/project/ai-gateway.md` (house provider failures `providerHttpFailure`, `tookTooLong`).
## 2. Existing code it must reuse (a second copy is the mistake)
- `src/messages.ts` § `CITATION_INVESTIGATE_LOOKUP_FAILED`, `CITATION_NO_MATCH`,
  `CITATION_LOOKUP_NO_MATCH`, `CODE_KINDS` (`cite-lookup-failed` registered), `paperUnreadableSentence`.
- `src/citation-investigate.ts` § `findTheWork` (catches `isLookupCallFailure`, throws the sentence).
- `src/reader-sentence.ts` § `sayToReader` (lets a coded sentence through the stream's error frame).
- `src/web/CitationInvestigation.tsx` § `investigationViewOf`, `INVESTIGATE_LOOKUP_KEPT`.
- `src/web/lib/describe-failure.ts` § `describeFetchFailure` — only if the client gap is taken up.
- Duplicate shape: a new `CITATION_LOOKUP_FAILED` / `[cite-find-failed]` string, a sentence written
  inline in `CitationsPanel.tsx`, or a second error banner beside Investigate's failed view.
## 3. Code files it would edit (only if a gap is confirmed and agreed)
- `src/web/useCitations.ts` (catches through `describeFetchFailure`; the client-written
  `The server replied N.` wrapped in `ReaderFacingError` or dropped); a test beside
  `tests/describe-fetch-failure.test.ts`.
## 4. Project rules that apply
- Every reader-facing failure lives in `src/messages.ts` with a `kind` and a bracketed code
  registered in `CODE_KINDS`; tests match the code, not the prose (`copy.md`).
- Never pass the provider's own error text to the reader or a log (`copy.md` rule 4; `logging.md`).
- No AI cost figure in reader copy (`cost-tracking.md` § Only the administrator ever sees a figure;
  `tests/no-ai-cost-for-readers.test.ts`).
- Check it is not already built (CLAUDE.md "Before rebuilding…"); failing test first; worktree.
## 5. Traps
- The *Look it up* button is gone; `POST …/find` survives only for old tabs — UI for it is dead work.
- `isLookupCallFailure` separates a failed call (stop) from a no-match (carry on unconfirmed); a
  failure message on a no-match would be wrong.
- A message whose code is not in `CODE_KINDS` silently grows a Retry button (`worthRetrying`).
- A 5xx JSON sentence reaches the reader only if coded (`copy.md` § "And the JSON half, from 500 up").
- Adding `describeFetchFailure` to `useCitations.ts` makes `tests/describe-fetch-failure.test.ts`
  refuse the bare `throw new Error(...)` already in that file.
## 6. Wrong or duplicative actions
- Writing a new message and UI without noticing `cite-lookup-failed` already exists. Fixing `(err as Error).message` in citations alone without saying nine sibling hooks share it.
