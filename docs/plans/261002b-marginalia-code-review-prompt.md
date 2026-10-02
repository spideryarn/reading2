You are GPT Sol, reviewing the code for plan
docs/plans/261002b-marginalia-shows-faq-citations-debate-and-comments-shut-by-default.md (read it,
including its "GPT Sol on the plan, and what changed" section; your plan review is
docs/plans/261002b-marginalia-plan-review-sol.md). The diff is
docs/plans/261002b-marginalia-code-review.diff (commit b1af6f07b on top of origin/dev).

You may edit files in this worktree. **Fix what you find inside this stage** (the files in the diff,
plus new tests); report anything wider for me to decide. Do not commit, do not run git commands
that change history or the index, do not touch .env*, infra/, or any database.

Check in particular:
1. Can anything now start a model run or spend? `useFaqRead`/`useDebateRead` must hold no job,
   poll or auto-run; `useFaq`/`useDebate` must behave exactly as before the split (same returned
   fields, `retryRead`, `automatic`, refresh after a job).
2. Placement: earliest surviving block by position (block-ids.md); `findQuote` usage against
   `block.text` (forgiving pass, `near`), empty quotes; citations from `citedAt`; comments with
   `criterionId` excluded; visitor data never includes citations; owner citations only when ready
   and not stale.
3. The disclosure (`ShutNote` in MarginaliaColumn.tsx): button/panel siblings, aria, `hidden`,
   tap inside TableView's cell (src/web/TableView.tsx — does a press on the button or on the link
   select the row or move `?at=`?), the lone-bookmark case, the comment/bookmark line when `body`
   is empty, keys (Debate rows keyed on `url` — can two rows in one block share a url?).
4. `useMarginLayout` re-running when a line opens (ResizeObserver on the note).
5. The CSS: the head's `::before` rule (is `.marg-head` a containing block for it?), the chevron
   hanging in the gap, the ellipsis on the shut line, dark mode tokens, narrow-window.css overrides
   of `.marg-head`.
6. Memo dependencies in Reader.tsx: will `comments` or the feed object re-render TableView on
   every scroll? Is `onFeed`'s effect loop-free?
7. Docs: marginalia.md, mode.md, interface-vision.md are accurate to the code.

Run `npx vitest run tests/marginalia-notes.test.ts tests/marginalia-shut-notes.test.tsx
tests/artefact-read-hooks.test.tsx` and `npm run typecheck` after any fix.

Answer with numbered findings (P0-P3, file:line, what you changed or why you did not), then a list
of files you edited. Check the conclusion too: say whether the plan's claim "nothing generates"
holds after your changes.
