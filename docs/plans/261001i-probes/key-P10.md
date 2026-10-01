# P10 key: a loading spinner while the Glossary mode's list is loading

## 1. Docs it must read
- MUST `docs/project/web-client.md` § "Empty is not the same as not asked yet" (the rule: an empty claim needs a fetch that came back and worked; three outcomes, not two) and § "The waiting state" (behind `useSlow`, name what is awaited, `role="status"`, hold the height, the failure line does not guess why; house shape `LoaderCircle` + `.cmt-spinner` in a flex row beside a sentence).
- MUST `docs/project/icons.md` § "The loading spinner" — the one spinner, never a bare spinner without words.
- MUST `docs/project/glossary.md` § "The underline is always there" (the paragraph "The list has to be fetched for every reader") — `Reader` owns the opening read via `useGlossaryRead`; the band revalidates behind the list; `status` never returns to `loading` for an article already answered; a different article resets it.
- USEFUL `docs/plans/260930j-shelf-topics-loading-spinner.md` — the nearest precedent (Sol P2/P3, height measured in a browser).
- USEFUL `docs/project/copy.md` — name the thing awaited; `docs/project/browser-control.md` + `docs/project/browser-testing.md`.

## 2. Existing code it must reuse
- `src/web/useSlow.ts` § `useSlow`, `SLOW_AFTER_MS` — the 600ms delay; trap: a spinner that flashes on a 40ms fetch, or a second timer constant.
- `src/web/ChatPanel.tsx` § `ChatListLoading` — the house shape to copy (empty wrapper rendered in the quiet 600ms, `role="status"`); also `src/web/SearchPanel.tsx` § `SavedLoading`, `src/web/Dock.tsx` § `QuestionsLoading`, `src/web/ShelfTerms.tsx` § `ShelfTermsLoading`.
- `lucide-react` `LoaderCircle` with `.cmt-spinner` (defined in `src/web/styles/annotations.css`); `GlossaryPanel.tsx` already imports `LoaderCircle`.
- The `owner.status` union: `src/web/useGlossary.ts` § `useGlossaryRead`, `UseGlossary` (aliased `GlossaryOwner` in `src/web/GlossaryPanel.tsx`) — trap: keying the spinner off `entries.length === 0` or `glossary === null`, which would spin for ever after a failure (260930j § Simpler option passed over) or show over a list already underlined in the prose.
- `src/web/Tweets.tsx` has the identical plain `<p className="gloss-quiet">Looking for a thread…</p>`; if a small shared component is extracted, both use it rather than two copies.

## 3. Code files it would edit
- `src/web/GlossaryPanel.tsx` (the `owner?.status === "loading"` line, ~381)
- `src/web/styles/glossary.css` (a row class, modelled on `.chat-loading`), if the existing class does not hold a flex row
- `src/web/DesignPage.tsx` (~895, the `/design` specimen of the same line)
- a test beside `tests/glossary-compact-header.test.tsx` / `tests/mode-surface-changes-no-markup.test.tsx` (they already render `GlossaryPanel` with a stub owner)
- `docs/project/glossary.md` one line

## 4. Project rules that apply
- Failing test first: `role="status"` and the sentence appear after `SLOW_AFTER_MS` while `status: "loading"`, not before, and not on failure — `CLAUDE.md`; `docs/project/testing.md`.
- Visitor path has no loading state (list is in the payload) — leave it alone; `GlossaryPanel.tsx` comment above `builtButEmpty`, `src/web/visitor.ts`.
- Browser check in a Sonnet subagent (slow the GET to see it) — `CLAUDE.md` § Delegating; `docs/project/browser-control.md`.
- Sol code review; `npm test`, `npm run typecheck`, `npm run lint` on touched files — `docs/project/code-quality-overview.md`.
- If it came via the Feedback button, a note under `docs/user-feedback/` — `docs/project/feedback-reports.md`.

## 5. Traps
- The loading state is rarely visible: the read is shared with `Reader` and the band no longer starts from `loading` (glossary.md; `src/web/reader/Reader.tsx` comment on `useGlossaryRead`, plan 260827am). Do not "fix" invisibility by re-fetching.
- Hold the height so the panel does not jump when the words land (web-client.md; 260930j measured residual shift in a browser — a screenshot cannot see a collapsed margin).
- Never a bare spinner: words beside it, visible (260930j, Sol P3).
- Do not add a spinner on revalidation behind an existing list (glossary.md: "behind the list, never in front of it").
