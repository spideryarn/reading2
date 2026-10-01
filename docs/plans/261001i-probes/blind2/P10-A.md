# P10 (after2): spinner while the Glossary list loads

## 1. Docs opened, in order
- `AGENTS.md` / CLAUDE.md (in context) - pointed to reading-view-overview; signpost helped.
- `docs/project/reading-view-overview.md` - mode list, led to glossary.md and web-client.md; helped.
- `docs/project/glossary.md` (head, then the "two GETs" section) - explained `status: "loading"` and that the owner band's `loading` is the only loading state; helped.
- `docs/project/new-mode.md` (grep hit) - "Where else to look" bullet sends the waiting state to web-client.md; very direct.
- `docs/project/web-client.md` § Empty is not the same as not asked yet, § The waiting state, § Testing it - the rule and the house shape (`useSlow`, `LoaderCircle` + `.cmt-spinner`, `role="status"`, named sentence); the key doc.
- `docs/project/icons.md` (grep only) - spinner section, confirms "never a spinner with no words".

## 2. Code files you would edit
- `src/web/GlossaryPanel.tsx` (line ~381: `owner?.status === "loading"` renders a plain `<p className="gloss-quiet">Looking for a glossary…</p>`; replace with a small `GlossaryLoading` component).
- `src/web/DesignPage.tsx` (line ~895 shows the same sentence as a specimen; keep it in step).
- New test `tests/glossary-loading.test.tsx`, modelled on the chat one.
- Possibly `src/web/styles/mode-band.css` (reuse `.chat-loading` or add a `.gloss-loading` twin).

## 3. Existing helpers/components to reuse
- `src/web/useSlow.ts` § `useSlow`, `SLOW_AFTER_MS` (600ms delay).
- `lucide-react` `LoaderCircle` with class `cmt-spinner` (already imported in GlossaryPanel.tsx).
- `src/web/ChatPanel.tsx` § `ChatListLoading` as the pattern to copy (role="status", held min-height).
- `src/web/styles/mode-band.css` § `.chat-loading` (flex row, min-height) - reuse or mirror.
- `tests/chat-list-loading.test.tsx` and `tests/dock-questions-loading.test.tsx` as the test pattern.
- No new hook needed; `useGlossaryRead` already exposes `status`.

## 4. Rules to follow
- Spinner behind `useSlow`, name what is awaited, `role="status"`, hold height (web-client.md § The waiting state).
- Never claim empty before the fetch worked; test waiting, waiting-below-threshold, failed, real-empty, real-populated (web-client.md § Testing it).
- `status` must never go back to `loading` for an already-answered article (glossary.md) - do not alter useGlossary.
- Visitors have no loading state (comment in GlossaryPanel.tsx) - keep it owner-only.
- Reader-facing copy: copy.md / `src/messages.ts` if the sentence becomes shared.
- Test first, watch it go red; `npm test`, `npm run typecheck`, lint touched files; GPT Sol review before commit; worktree, commit by name, push to dev (AGENTS.md).
- No model call or cost involved; no migration.

## 5. Where I got lost
- Almost nowhere. Note the premise: a loading line already exists (plain text, no spinner), so the task is upgrading it. glossary.md does not mention spinner conventions; I found them only via new-mode.md's pointer and a grep. Unclear whether the panel is also the one used during a job run (there are other `LoaderCircle`s at lines ~1578, ~1771 for different actions).
- I did not check what the Reader-level `useGlossaryRead` shows before the band opens.

## 6. Confidence
8/10.
