# Probe P11 (before) — signed-out visitor sees Ideas mode's stored list

## 1. Docs opened, in order
- `CLAUDE.md` (AGENTS) — pointed to reading-view-overview and security-map; signpost only.
- `docs/project/ideas.md` — helped: names code files, incl. `VisitorIdeasBand`; says nothing about public/visitor policy beyond that.
- `docs/project/public-shelf.md` — partly wrong doc (listing, not article read); skimmed, little use.
- `docs/project/mode.md` (§ PUBLIC_PROJECTIONS / visitor, ~l.225-265) — the most useful: says a stored mode is shown to visitors by default, names `public-reader.ts`, `dto.ts`, `visitor.ts` POLICY, the pinning tests, and the 260929a postmortem.
- I did not open `public-readable-sharing.md` fully (headings only).

## 2. Code files you would edit
Finding: the feature appears ALREADY BUILT in this tree. If something is still missing I would check/edit only:
- `src/web/visitor.ts` (POLICY row `ideas: { kind: "artefact", key: "ideas" }` — present)
- `src/store/public-reader.ts` (`ideas: articleRevisions.ideas` — present, two reads, ~l.316 and ~l.813)
- `src/public/dto.ts` (`publicIdeas`, wired at ~l.1230 — present)
- `src/web/reader/Reader.tsx` (composes `VisitorIdeasBand`)
- `src/web/modes/ideas/IdeasMode.tsx` (`VisitorIdeasBand` — present)
Plan: verify each hop end to end (row -> reader -> dto -> `PublicArtefactSet` -> Reader -> band) and only patch a broken hop.

## 3. Existing helpers/components to reuse
- `src/public/dto.ts` § `publicIdeas`
- `src/public-types.ts` § `PublicIdeas`, `PublicArtefactSet`
- `src/web/modes/ideas/IdeasMode.tsx` § `VisitorIdeasBand`, `useIdeasMode`
- `src/web/IdeasPanel.tsx` § `access` union (`kind: "visitor"`)
- `src/web/visitor.ts` § `POLICY`
No new helper needed.

## 4. Rules/policies
- Visitor sees stored output by default; `owners-only` only for reader's own writing — `mode.md`, postmortem 260929a.
- Public graph must not import writer modules (`src/ideas.ts`): no `stale`/`outdated` on the wire — `src/public-types.ts` header, `tests/public-imports.test.ts`.
- Absent is the only "no"; empty `{ideas: []}` is ready-but-empty — `src/public-types.ts`.
- Leaving a column out of the public select silently fails — `public-reader.ts` comment; `tests/public-reads.test.ts`.
- Tests: `tests/public-dto.test.ts` (key pins), `tests/store-revision-columns.test.ts`, `tests/public-network-trace.test.tsx` (BAND_SAYS). Write a failing test first (CLAUDE.md).
- Gates: `npm test`, `npm run typecheck`, lint on touched files; GPT Sol review before commit; worktree, push to `dev`.
- Security: `security-map.md` (unauthenticated namespace) — not opened, would read.

## 5. Where you got lost
- The task is phrased as new work but the code already does it; no doc says "Ideas is public-visible" in one place. `ideas.md` mentions `VisitorIdeasBand` but not the policy/projection chain; I had to grep to confirm. A "which modes a visitor sees" table in one doc would have saved ~6 calls.
- `public-shelf.md` and `public-readable-sharing.md` names mislead (listing / author notices, not the artefact read path).
- Did not locate `REVISION_READ_POLICY` definition's ideas grant (grep hit `src/types.ts`/`pg.ts`/`messages.ts`, not read).

## 6. Confidence
6/10 that I found everything; 9/10 that the feature already exists.
