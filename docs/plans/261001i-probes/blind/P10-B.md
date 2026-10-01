# P10 after: spinner while the Glossary list loads

## 1. Docs opened, in order
- `AGENTS.md` / CLAUDE.md (in context) — pointed at reading-view-overview, web-client; helped.
- `docs/project/glossary.md` — what the mode is; no loading-state detail, mild help.
- `docs/project/web-client.md` (grep, then §§ shared helpers, "Empty is not the same as not asked yet", "The waiting state") — decisive: names `useSlow`, `LoaderCircle`/`cmt-spinner`, `role="status"`, 600ms rule, copy rule, tests pattern.
- `docs/project/mode.md` (grep) — confirmed the waiting-state pointer.

## 2. Code files you would edit
- `src/web/GlossaryPanel.tsx` (line ~381, the `owner?.status === "loading"` branch).
- A new test `tests/glossary-loading.test.tsx`, modelled on `tests/chat-list-loading.test.tsx`.
- Possibly `src/web/*.css` only if a min-height class is needed (`chat-loading` is the model).

## 3. Existing helpers/components to reuse
- `src/web/useSlow.ts` § `useSlow` (hook cannot be called inside the conditional; extract a small `GlossaryLoading` component, like ChatPanel).
- `src/web/ChatPanel.tsx` § `ChatListLoading` — the house shape to copy (flex row, `LoaderCircle` + `cmt-spinner`, `role="status"`, quiet-window height).
- `lucide-react` `LoaderCircle`, already imported in `GlossaryPanel.tsx`.
- `src/web/useGlossary.ts` § `status` union ("loading" | ...) — already exposes the three outcomes; no new state.
- No new helper needed beyond the tiny local component.

## 4. Rules/policies I would follow
- Spinner only behind `useSlow` (600ms), standing in place of content — web-client.md § The waiting state.
- Name the thing waited on ("Looking for a glossary…" already does; keep it), `role="status"`, hold height — same.
- Empty claim requires a successful fetch; do not let loading fall to empty/"not built" — web-client.md § Empty is not the same as not asked yet.
- Test pattern: waiting, waiting-below-threshold, failed, plus real empty and populated — web-client.md § Testing it.
- Reproduce first with a failing test; run `npm test` and `npm run typecheck`; lint touched files; GPT Sol review before commit; worktree, merge not rebase, commit by name and push to dev — CLAUDE.md.
- No server, prompt, cost or migration work involved.

## 5. Where I got lost
- Not lost much. The current code already shows a plain-text "Looking for a glossary…" with no spinner and no `useSlow`/`role="status"`, so the task is an upgrade, not a new state. Nothing in glossary.md says this; only the code showed it.
- Did not verify how `owner === null` (visitor) loading behaves; the comment says visitors have no loading state.
- Did not open the CSS for `chat-loading`/`gloss-quiet` (grep returned nothing useful for gloss-quiet in *.css; may live in another stylesheet).

## 6. Confidence
8/10
