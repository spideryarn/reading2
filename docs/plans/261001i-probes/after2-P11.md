# P11 (after2) — signed-out visitor sees Ideas' stored list

## 1. Docs opened, in order
1. `CLAUDE.md` (AGENTS) — pointed to reading-view-overview and its sub-docs; helped.
2. `docs/project/ideas.md` — went straight to it from the entry-point listing; its "Code:" paragraph and the bold "A visitor to a public article sees a stored list" paragraph answered the task directly. Very helpful.
3. `docs/project/public-shelf.md` — opened by mistake of keyword (it is the listing, not the read path); it did say so itself and redirected to security-map and new-mode. Minor detour.
4. `docs/project/new-mode.md` § Where else to look — named `POLICY` (`src/web/visitor.ts`) and `REVISION_READ_POLICY` (`src/store/pg.ts`). Helpful.

## 2. Code files you would edit
Finding: the feature already exists in this tree, so I would edit nothing, only verify.
- Already present: `src/web/modes/ideas/IdeasMode.tsx` (`VisitorIdeasBand`), `src/web/reader/Reader.tsx` (~line 2087 renders it when `artefacts?.ideas`), `src/web/visitor.ts` (`POLICY.ideas = { kind: "artefact", key: "ideas" }`), `src/public-types.ts` (`PublicArtefacts.ideas?: PublicIdeas`), `src/store/pg.ts` (`REVISION_READ_POLICY` grants `ideas` to readers), `src/store/public-reader.ts` (`PUBLIC_PROJECTIONS`).
- If a gap were found, it would be in those same files plus `src/public/dto.ts`.

## 3. Existing helpers to reuse
- `src/web/modes/ideas/IdeasMode.tsx` § `VisitorIdeasBand`, `useIdeasMode`
- `src/web/IdeasPanel.tsx` § `access={{ kind: "visitor", ideas }}`
- `src/web/visitor.ts` § `POLICY`, `visitorGap`, `notBuiltGap`, `NOUN`
- `src/store/public-reader.ts` § `PUBLIC_PROJECTIONS`
No new helper needed.

## 4. Rules to follow
- Visitor sees what is stored and never starts a paid call (new-mode.md, citing the 260929c plan by title only; I did not open it).
- Reproduce with a failing test first (CLAUDE.md); likely `tests/visitor-gaps.test.ts` (named in `visitor.ts`) and `tests/store-revision-columns.test.ts` (named in pg.ts) as homes.
- Do not widen `REVISION_READ_POLICY` casually; threat model in `docs/project/security-map.md` (not opened).
- Run `npm test`, `npm run typecheck`, lint on touched files; GPT Sol review before commit; work in a worktree; commit own files by name, push to `dev`.
- Copy lives in `src/messages.ts`, not inline.
- No logging of article prose; nothing new streams (no model call).

## 5. Where I got lost
- Not lost, but the task is already done: `ideas.md` and the code both say the visitor band exists. A task phrased as "let a visitor see Ideas" has no signal in the docs that it is already shipped except reading the paragraph closely. I would confirm with a test run or the browser rather than assume.
- `public-shelf.md` surfaced on a "public" keyword but is the wrong doc; it redirected clearly.

## 6. Confidence
8/10 that nothing needs building and the pointers are right; 5/10 that I know whether a residual gap exists (not verified at runtime).
