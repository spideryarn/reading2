# P10 before: show a loading spinner while the Glossary list is loading

## 1. Docs opened, in order
- `AGENTS.md` (CLAUDE.md): signpost; pointed to reading-view-overview and the working agreements. Helped as a map only.
- `docs/project/reading-view-overview.md`: Glossary entry plus "Where the code is". Pointed at glossary.md, not at the loading rule.
- `docs/project/glossary.md` (head, and the "list has to be fetched for every reader" section): helped; says `status` never returns to `loading`, and the band owns the panel.
- `docs/project/web-client.md` § "Empty is not the same as not asked yet" and § "The waiting state": the key doc. Gives the rule (spinner behind `useSlow`, named sentence, `role="status"`, hold height, house shape). Found only via `grep -i spinner`, not via a link from the overview or glossary.md.
- `docs/project/icons.md` § "The loading spinner": `LoaderCircle` + `.cmt-spinner`, reduced motion, never a spinner without words. Helped.
- `docs/project/copy.md` (head only): copy rules; the loading sentence is not an error so probably only the "name what is awaited" rule applies.

## 2. Code files you would edit
- `src/web/GlossaryPanel.tsx` (replace the `owner?.status === "loading"` plain `<p className="gloss-quiet">Looking for a glossary…</p>`, near line 381)
- `src/web/styles/` the glossary/band css (a small row class, modelled on `.chat-loading` in `src/web/styles/mode-band.css`)
- `src/web/DesignPage.tsx` (line ~895 shows the same "Looking for a glossary…" text as a specimen; update if it mirrors the panel)
- new test `tests/glossary-loading.test.tsx`

## 3. Existing helpers/components/functions to reuse
- `src/web/useSlow.ts` § `useSlow` / `SLOW_AFTER_MS`
- `src/web/ChatPanel.tsx` § `ChatListLoading` (the pattern to copy; a small local `GlossaryLoading` component, no shared helper exists, so I would write one tiny new component rather than extract a shared one)
- `lucide-react` `LoaderCircle` with class `cmt-spinner` (`src/web/styles/annotations.css`)
- `src/web/useGlossary.ts` § `useGlossaryRead` `status` union (already has "loading")
- Tests as patterns: `tests/chat-list-loading.test.tsx`, `tests/dock-questions-loading.test.tsx`, `tests/glossary-one-fetch.test.tsx`

## 4. Rules/policies to follow
- Spinner behind `useSlow` (600ms), names the thing ("Looking for a glossary…"), `role="status"`, wrapper holds height: web-client.md § The waiting state.
- Empty claim only after a successful fetch; keep the three states (loading, failed, real empty) distinct: web-client.md § Empty is not the same as not asked yet.
- Spinner always beside words, `LoaderCircle` not `Loader`, size at call site, reduced motion handled by existing CSS: icons.md.
- Test first, watch it go red; test the waiting, below-threshold and failed states and the real-empty and populated ones the indicator must not eat: web-client.md § Testing it.
- Do not make `status` return to `loading` on revalidation: glossary.md.
- Gates: `npm test`, `npm run typecheck`, lint on touched files, `npm run check` (CLAUDE.md). Worktree, plan doc, GPT Sol review, commit by name, push to `dev`.
- Update `/design` specimen if it mirrors the loading state (design-css-overview.md, from CLAUDE.md signpost).

## 5. Where you got lost
- No link from glossary.md or reading-view-overview.md to the waiting-state rule; I found it by grepping "spinner". The rule lives in the fat web-client.md (700+ lines).
- The glossary panel already renders a text-only loading line, so the task is really "upgrade it to the house shape"; no doc says which panels already have the house shape and which do not.
- Did not verify whether the band wrapper (not just the panel) has its own loading state, or whether the `gloss-quiet` class suits a flex row. Did not check `/design` for the spinner specimen.
- Did not read the `GlossaryBand` code beyond grep lines.

## 6. Confidence
7/10
