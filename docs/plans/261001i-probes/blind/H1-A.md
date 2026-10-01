# Probe H1 : plain-words message when a cited-work lookup fails in Citations mode

## 1. Docs opened, in order
- `CLAUDE.md` (AGENTS.md) — pointed at reading-view-overview, citations.md, copy.md; helped.
- `docs/project/citations.md` — helped: the "Look it up" is now step one of Investigate; also the Find it and registry lookups.
- `docs/project/copy.md` — helped a lot: four rules, kinds `retry/ours/bug/blocked`, bracketed code, prefix `cite-`, tests match the code not prose.
- (Did not open reading-view-overview.md / web-client.md / mode.md; grepped code instead.)

## 2. Code files you would edit
- `src/messages.ts` — message text and the `cite-*` kind table (around line 313 and 5150-5260).
- `src/web/useCitations.ts` — where `investigateFailed` / `findNote` / `error` are set from a thrown error (lines ~303, ~484, ~528-540).
- `src/web/CitationInvestigation.tsx` — `InvestigateFailureHere`, `investigationViewOf` (how the failure is drawn).
- `src/web/CitationsPanel.tsx` — where `failed` is passed to the row (~731, ~1007).
- `src/citation-investigate.ts` (~796) and `src/citation-lookup.ts` — only if a failure path throws something raw rather than a coded message.
- Tests: `tests/messages.test.ts`, `tests/citation-investigate.test.ts`, `tests/citations-investigate-client.test.tsx`.

## 3. Existing helpers to reuse
- `src/messages.ts` § `CITATION_INVESTIGATE_LOOKUP_FAILED` (already says "quick check ... failed ... nothing more was spent ... [cite-lookup-failed]"), `CITATION_LOOKUP_NO_MATCH`, `CITATION_FIND_BUSY/LIMITED/RESTING`, `ReaderFacingFailure`, `kindOfMessage`, `worthRetrying`, `wentQuiet`.
- `src/web/useCitations.ts` § `InvestigateFailure`, `setInvestigateFailed`.
- `src/web/CitationsPanel.tsx` § `readNoteOf` (the "what we have read" line).
- No new helper expected; a new message would be a new constant + a `cite-` code in the kind table.

## 4. Rules/policies
- Copy rules: say what happened in plain words, "the AI service" not provider, say whose problem (kind), say what to do next, never repeat provider text — `docs/project/copy.md`.
- Bracketed code last, stable; tests match `/\[cite-...\]/` not prose — `docs/project/copy.md`.
- Messages live only in `src/messages.ts`, which must stay a leaf (client-imports test) — comment in `src/messages.ts`.
- Write a failing test first; run `npm test` and `npm run typecheck`; lint touched files; cross-family review before commit — `CLAUDE.md`.
- Worktree, plan doc, push to dev — `CLAUDE.md`.
- Streaming rule relevant only if I touched the stream path (I would not).

## 5. Where you got lost
- The task is ambiguous: a failing lookup could be Find it, the quick-check step of Investigate, or the registry (Crossref) lookup. citations.md says the registry never fails the step and Find it has its own messages. Much of this appears already built (`CITATION_INVESTIGATE_LOOKUP_FAILED`), so I could not tell which gap the task means without history, which is barred.
- The copy.md code-prefix list was long; I did not read to the `cite-` entry's end.
- I did not verify which messages reach the client for a non-coded 5xx (copy.md hints `handleApi` passes only declared/coded ones).

## 6. Confidence
5/10
