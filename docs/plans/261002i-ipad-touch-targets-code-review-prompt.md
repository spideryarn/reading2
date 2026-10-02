You are doing the code review of one stage in this repo, and you may FIX what you find inside the stage (workspace-write). Do not commit, do not run git commands that change history or the index, do not touch files outside this change's scope; report anything wider for me to decide.

The plan: docs/plans/261002i-ipad-touch-targets-shelf-card-actions-on-the-bottom-row-bigger-close-crosses-a-visible-band-scrollbar.md (your own earlier plan review is docs/plans/261002i-ipad-touch-targets-plan-review-sol.md; its findings are claimed fixed — verify that claim).
The diff of the stage: docs/plans/261002i-ipad-touch-targets-code-review.diff (it is HEAD~1..HEAD; read the real files too).

Look hardest at:
1. src/web/ShelfEntry.tsx `pressCapture`: the fingerSurface branch — data-commits read off the target, rerun reveal-first, unavailable reveal-first, the second tap committing (armed id), the "Tap again" card text, and that nothing changed for a mouse, for the table (no fingerRow), or for a pen with any-pointer: fine. Any way a tap on the wide card's row on iOS (click pointerType "mouse", tooltip `mouseOnly`) leaves a card stuck open or swallows a press?
2. ShelfCard layout: Actions moved into the bottom row (now a <div>, was <p>); the `!editing` path; the stretched-link overlay vs the `relative` on the actions wrapper (is the wrapper above the ::after link so taps reach the buttons? the old row had `tw:relative` on itself — check both the row and the ⋯ menu wrapper are still positioned); the note button lost ml-auto.
3. The Tailwind class strings (prefix tw:) — container query `@max-[28rem]`, descendant arbitrary variants — and tests/shelf-actions-visible-to-a-finger-in-chrome.test.tsx which compiles real Tailwind and runs real Chrome (it passes here).
4. styles/close.css and the seven component rules: anything that still sets a size and wins, focus rings, the ::after hit area (inset -4px) overlapping a neighbour in any of the seven headers (look at each header's gap/children), hover styles, `position: relative` breaking any positioning.
5. tests/close-cross.test.ts — can it go green on a broken state (e.g. a size set in a media-query rule, or in a rule whose selector list is `.x, .y`)? Tighten if cheap.
6. .mode-band scrollbar-color.

Run the focused tests after any fix: npx vitest run tests/close-cross.test.ts tests/annotate-dialog-copy.test.tsx tests/shelf-action-touch.test.tsx tests/shelf-actions-visible-to-a-finger-in-chrome.test.tsx tests/shelf-actions-menu.test.tsx tests/shelf-action-tooltips.test.tsx ; and npm run typecheck.

Report: numbered findings with severity (P0–P3), file:line, what you changed for each (or why not), and anything wider left for me.
