# Probe H1 (after): plain-words message when a Citations lookup fails

## 1. Docs opened, in order
1. `AGENTS.md` / CLAUDE.md (in context) — pointed to reading-view-overview and copy; helpful.
2. `docs/project/citations.md` — found directly via the entry-point list; says what is built, names Look it up / Investigate and the code files. Very helpful.
3. `docs/project/copy.md` (first 260 lines) — the four rules, `ReaderFacingFailure` kinds, bracketed `cite-` codes, "tests match the code not the prose". Helpful, decisive.

## 2. Code files you would edit
- `src/messages.ts` (any new/reworded `cite-` sentence + `CODE_KINDS` entry)
- `src/citation-investigate.ts` (the `findTheWork` catch, ~line 796) and `src/citation-find.ts` (the standalone `/find` route's failures)
- `src/web/useCitations.ts` (the `catch` in the investigate press, ~line 528: what `err.message` becomes) and `src/web/CitationInvestigation.tsx` (`failed` case, ~line 511)
- `tests/citation-investigate.test.ts`, `tests/citations-investigate-client.test.tsx`, `tests/messages.test.ts`

## 3. Existing helpers/components/functions you would reuse
- `src/messages.ts` § `CITATION_INVESTIGATE_LOOKUP_FAILED` (already a plain "quick check failed, nothing more spent, trying again starts over [cite-lookup-failed]"), `CITATION_INVESTIGATE_GONE`, `CITATION_FIND_RESTING`
- `src/messages.ts` § `ReaderFacingFailure`, `CODE_KINDS`, `kindOfMessage`, `worthRetrying`
- `src/reader-sentence.ts` § `sayToReader` (server streamed-failure boundary)
- `src/routes.ts` § `streamCitationInvestigation` (already emits `error` frame)
- `src/web/useCitations.ts` § `setInvestigateFailed`, `StreamStalled`/`wentQuiet`
- `src/web/CitationInvestigation.tsx` § the `failed` view and `INVESTIGATE_LOOKUP_KEPT`
No new helper needed.

## 4. Rules/policies I would follow
- Copy rules: say what happened, whose problem (retry/ours/bug/blocked), what to do next, never echo the provider's body, "the AI service" not a provider name — `docs/project/copy.md`
- Bracketed code last, registered in `CODE_KINDS`; tests match `/\[cite-...\]/` not prose — `copy.md`
- Sentences live in `src/messages.ts` (leaf file, client-imports test) — `copy.md`
- Failing test first, then fix; `npm test`, `npm run typecheck`, lint on touched files — CLAUDE.md
- Worktree, plan doc, GPT Sol review before commit, commit own files by name, push to `dev` — CLAUDE.md
- Log from server via `src/log.ts`, no article prose — CLAUDE.md
- No cost-tracking change needed (no new AI call).

## 5. Where you got lost
- The task is probably mostly already built: the lookup-failure path already carries a plain sentence. I could not tell from docs which failure still reaches the reader as a raw `err.message` (e.g. non-lookup throws in the investigate client `catch`, a network failure on `/find`, or a `readJson` error). citations.md does not list the failure paths; I had to read code, and did not trace the `/find` route's client side (no caller since 260930d). Residual gap likely in the client catch fallback when the error is not a coded sentence.
- copy.md is long; the `cite-` family gets one clause (`cite-resting`) and omits the other `cite-` codes.

## 6. Confidence
6/10
