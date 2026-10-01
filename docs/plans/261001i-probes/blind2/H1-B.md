# Probe H1, round after2 — plain-words message when a Citations lookup fails

## 1. Docs opened, in order
- `CLAUDE.md` (AGENTS.md) — signposts to copy.md and citations.md; helped.
- `docs/project/citations.md` — what Look it up / Find it / Investigate do; named `src/citation-lookup.ts`, `src/citation-find.ts`; helped.
- `docs/project/copy.md` — the four rules, the four kinds (retry/ours/bug/blocked), bracketed codes, tests match codes; essential.
- (grep only) `src/messages.ts`, `src/citation-find.ts`, `src/web/useCitations.ts`, `src/web/CitationsPanel.tsx`.

## 2. Code files you would edit
- `src/messages.ts` — a new declared `ReaderFacingFailure` (kind + `[cite-...]` code) only if a gap is found; add the code to the kind table near line 313.
- `src/citation-find.ts` — the `/find` route still rethrows the raw error (`if (err instanceof LookupTransportFailed) throw err.original`, ~line 762); route it through `providerHttpFailure` / `tookTooLong` like Investigate does.
- `src/web/useCitations.ts` — the Find-it catch (~line 303) and the Investigate catch (~line 528); make sure the message is shown, not the raw `Error`.
- `src/web/CitationsPanel.tsx` — where `owner.error` / `note.message` are drawn (~lines 677, 996).
- `tests/citation-find-route.test.ts`, `tests/messages.test.ts` — new tests.

## 3. Existing helpers/components/functions you would reuse
- `src/messages.ts` § `providerHttpFailure`, `tookTooLong`, `PROVIDER_UNREADABLE`, `CITATION_INVESTIGATE_LOOKUP_FAILED` (`[cite-lookup-failed]`), `CITATION_FIND_BUSY/LIMITED/RESTING`.
- `src/messages.ts` § `kindOfMessage`, `worthRetrying` — decide whether to offer another go.
- `src/citation-find.ts` § `isLookupCallFailure`, `LookupCallFailed`, `LookupTransportFailed`.
- `src/web/useCitations.ts` § `wentQuiet` use for stalled streams; `StreamStalled`.
- No new helper needed; the copy mostly exists, the gap is the `/find` path.

## 4. Rules/policies you would follow
- Say what happened, whose problem, what to do next; never repeat the provider's words; call it "the AI service" (`docs/project/copy.md`).
- Every message ends with a bracketed code; tests match the code, not prose (`docs/project/copy.md`); `tests/messages.test.ts` round-trips kinds.
- Test first, watch it go red (CLAUDE.md); `npm test`, `npm run typecheck`, lint on touched files; GPT Sol review before commit.
- Work in a worktree, commit by name, push to `dev`; never log article prose (`docs/project/logging.md`).
- Reader-facing 5xx messages only pass `handleApi` if declared or coded (comment in `src/messages.ts` near `CITATION_FIND_RESTING`).

## 5. Where you got lost
- "Looking up a cited work" is ambiguous: *Look it up* (merged into Investigate step 1), *Find it*, and the registry lookup in `src/citation-registry.ts` (which never fails the step). I had to read three files to see which path lacks plain words.
- citations.md does not say in one place how each failure of Find it / Look it up reaches the reader; I inferred it from `src/messages.ts` comments.
- `src/messages.ts` is ~5000 lines; grep for `cite-` was the only way in.
- Did not verify the client actually renders `err.message` for Find it (no component found by name).

## 6. Confidence
6/10.
