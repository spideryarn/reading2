# P11 key: a signed-out visitor sees the Ideas mode's stored list

**The right answer is "already built" — since public-read slice 1b (2026-08-28), confirmed by the
260929c audit table, row "glossary, ideas, quotes, timeline: yes — `{ kind: "artefact" }`, on the
payload … This plan: nothing".** An ideal agent verifies each hop, finds the pinning tests, and
reproduces the reader's case (prod build, the article really public, ideas really generated)
before touching code. Writing a second visitor path for Ideas would be the mistake.

## 1. Docs it must read
- MUST `docs/project/new-mode.md` § "The artefact, if the mode shows one" (the `PUBLIC_PROJECTIONS` and public-DTO bullet: a stored mode is shown to a visitor by default; `owners-only` only for the reader's own writing; which tests pin it).
- MUST `docs/project/security-map.md` § "Where the defences physically live" and § "The allowlist has two failure directions, and only one of them is loud" — the DTO is an allowlist and a listed defence.
- MUST `docs/postmortems/260929a-one-policy-row-decided-who-may-make-a-mode-and-who-may-see-it.md` — making vs showing.
- USEFUL `docs/project/ideas.md` (names `VisitorIdeasBand`); `docs/project/public-readable-sharing.md` (what the author is told; Ideas is one of the profiled artefacts already on a shared link); `docs/plans/260904c-more-modes-on-a-shared-link.md` § "What every stage owes" (the recipe, if a hop were missing).
- USEFUL `docs/project/debugging.md`, `docs/project/feedback-reports.md` if this arrived as a report.

## 2. Existing code it must reuse (all present)
- `src/web/visitor.ts` § `POLICY` (`ideas: { kind: "artefact", key: "ideas" }`), `visitorGap` — the "not built" band if absent.
- `src/store/public-reader.ts` § `PUBLIC_PROJECTIONS` (`ideas: articleRevisions.ideas`, two reads ~316 and ~813).
- `src/public/dto.ts` § `publicIdeas` (wired in `publicArticle`, ~1230); `src/public-types.ts` § `PublicArtefactSet.ideas`, `PublicIdeas`.
- `src/web/modes/ideas/IdeasMode.tsx` § `VisitorIdeasBand`, composed in `src/web/reader/Reader.tsx` (~2087); owner/visitor seam per `src/web/reader-capability.ts`.
- Trap: a new route, a `readOnly` flag on `IdeasBand`, or mounting `useIdeas`/`useAutoRun` for a visitor (that can spend); or resolving the article id and calling the owner's reader (forbidden by `tests/public-imports.test.ts`).

## 3. Code files it would edit
- Probably none. If a hop is broken: the one file above that breaks it, plus a red-first test. A doc line in `docs/project/ideas.md` saying a visitor sees the stored list, if missing.

## 4. Project rules that apply
- Reproduce before fixing; failing test first — `CLAUDE.md`; `docs/project/testing.md`.
- Any widening of the public DTO is a security decision for Greg — 261001b § The decision; `docs/project/security-map.md`.
- Provenance (`profileHash`, `generatedAt`, `version`…) never crosses; a visitor's copy must not say "shaped by your profile" — 260929c § What crosses; `src/web/visitor.ts` comments.
- Visitors never trigger a paid call — 260929c § The rule; `docs/project/new-mode.md` (`useAutoRun`).
- Browser check signed out (incognito) in a Sonnet subagent — `CLAUDE.md` § Delegating; `docs/project/browser-control.md`.
- Production is readable only inside `BEGIN READ ONLY`; never write — `CLAUDE.md` § Real data.

## 5. Traps
- Pinning tests already exist: `tests/visitor-gaps.test.ts` (ideas built/not built), `tests/public-dto.test.ts`, `tests/public-dto-owner-only-fields.test.ts`, `tests/public-visibility-pg.test.ts`, `tests/public-network-trace.test.tsx`, `tests/store-revision-columns.test.ts`. Run them before believing a hop is missing.
- Forgetting a column in `PUBLIC_PROJECTIONS` is the silent failure (260929c § References); a new column must be added to both reads.
- A Postgres visibility test needs a second, private fixture article, or the predicate is untestable (new-mode.md).
- A stale artefact must not be drawn to a visitor where the owner would see nothing (261001b, Sol F8 on crossrefs) — check Ideas behaves the same for owner and visitor.
- Experimental is not a gate for visitor rules (260929c § Decided).
