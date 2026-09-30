You are reviewing CODE in the repo at the current directory (a git worktree). You may FIX what you
find, inside the scope of this change, by editing files; report anything wider for me to decide.
Do not commit, do not run git commands that change state, do not touch other files' unrelated code.

The plan (already reviewed by you once; your findings are in its § Plan review):
docs/plans/260930h-tweets-band-fits-ipad-and-copy-buttons-become-icons.md

The diff against HEAD is in docs/plans/260930h-code-review.diff, plus two new files:
tests/tweets-copy-icons.test.tsx. Changed: src/web/layout.ts (bandWidth, WIDE_SHARE, comments),
tests/layout.test.ts (a wide band), src/web/Tweets.tsx (CopyButton icon-only + tooltip + status),
docs/project/reading-view-overview.md (a signpost line).

Evidence: `npx vitest run tests/layout.test.ts tests/tweets-copy-icons.test.tsx
tests/every-mode-draws-its-surface.test.tsx tests/tweets-press-starts-it.test.tsx` passed (198 tests
across 9 files incl. structure-band-width, spine-width, chat, doc-links); `npm run typecheck` exit 0.
WebKit iPad measurement after the change: band 345 portrait (834) / 496 landscape (1194), exactly
as the plan's tables; the plan's § Measurements has both tables.

Check especially:
1. bandWidth's wide branch: are the bounds right at every root/rail/width (the new sweep test is
   meant to prove it — is the sweep itself strong enough, could it pass on wrong code)?
2. CopyButton: does Tooltip correctly wrap the shadcn Button (ref + props pass-through — see
   src/web/Tooltip.tsx and src/web/IconButton.tsx's PassThrough note; does Button spread
   onFocus/aria-describedby)? Is aria-label stable, the live region right, the visible failure text
   right? Does `tw:pointer-coarse:size-10` win over `size-6` from the cva variant (Tailwind v4, the
   `tw:` prefix — check how cn/twMerge handles prefixed classes in src/web/lib/utils or wherever cn
   lives)? Does `tw:sr-only` exist as a utility with this prefix?
3. The new test: can each assertion go red on broken code? (e.g. visibleText strips .sr-only and
   .tw\:sr-only — right selector?)
4. Anything false in the comments I wrote (quotes of Greg are verbatim from the plan).

Run the scoped tests and typecheck after any fix. Write findings, numbered, most severe first, each
saying FIXED (with what) or FOR YOU. End with: VERDICT: ship / ship after my fixes / do not ship.
