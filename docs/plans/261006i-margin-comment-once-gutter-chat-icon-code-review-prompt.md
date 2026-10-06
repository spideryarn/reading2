# Code review: a lone comment in the margin says its words once; a chat is two bubbles

You are reviewing CODE in this worktree, with write access. House workflow
(docs/reusable/codex-cli-as-subagent.md § The house workflow): **fix what you find inside this
stage's scope**, and report anything wider for me to decide. Do not commit, push, or run any git
command that changes state. Do not touch `.env.local`, `infra/`, or anything outside this worktree.

## What was built

The plan, including § "What the plan review changed" (your own plan review and how each finding was
handled; finding 2 was arbitrated by Opus and not taken):
`docs/plans/261006i-a-lone-comment-in-the-margin-says-its-words-once-and-the-gutter-s-chat-button-wears-chat-s-two-bubbles.md`

Your plan-stage findings: `docs/plans/261006i-margin-comment-once-gutter-chat-icon-plan-review-sol.md`.
Treat those as known; say what is new.

The scoped diff of tracked files, as built:
`docs/plans/261006i-margin-comment-once-gutter-chat-icon-code-review.diff` (and `git diff HEAD`
is the live version).

Files: `src/web/marginalia/MarginaliaColumn.tsx` (`ShutNote` `lineOnly`, `CommentNote`
`loneShape`), `src/web/styles/marginalia.css` (`.marg-open[hidden]`), the five icon sites
(`BlockGutter.tsx`, `ChatDialog.tsx`, `OriginChat.tsx`, `DebatePanel.tsx`, `SimplePanel.tsx`),
tests (`tests/marginalia-shut-notes.test.tsx`, `tests/mode-icons.test.ts`,
`tests/block-gutter.test.tsx`), docs (`docs/project/icons.md`, `comments.md`, `marginalia.md`).

Already run and green: those three test files plus `tests/marginalia*`, `npm run typecheck`,
`tests/doc-links.test.ts`. The four new assertions were seen red before the fix.

## What I most want checked

1. `CommentNote`'s three lone shapes (panel / line / text). Any `MarginEntry` that now loses words,
   opens to nothing, or renders a panel with an empty `.marg-open-item`? A lone **question** must be
   unchanged. Several items must be unchanged.
2. The new `.marg-open[hidden] { display: none }`: does anything rely on the shut panel still
   occupying space (layout measurement in `useMarginLayout`, any test, any other stylesheet
   selecting `.marg-open`)? `lineOnly` has no panel: does any CSS or code assume `.marg-shut` with a
   button always has a `.marg-open` sibling, or that `aria-controls` is present (tips, keyboard,
   tests elsewhere)?
3. The `lineOnly` button: accessibility of `aria-expanded` with no controlled element; is there a
   better honest shape that is not more machinery?
4. Icon sweep: any remaining rendered bare `<MessageSquare` meaning a chat anywhere (including
   `tools/`, the `/design` page, help page text or docs that describe the glyph, screenshots'
   captions, tests asserting `lucide-message-square`)? Any stale comment that still says "one
   bubble", "speech bubble" or "the floating chat's icon" about these sites?
5. Are the tests able to fail for the right reason, and is anything untested that should be?
6. The docs: is the new icons.md section accurate against the code?

Run whatever suites you need (the box is busy: prefer the touched files over the full suite).

## Output

Write your findings to `docs/plans/261006i-margin-comment-once-gutter-chat-icon-code-review-sol.md`
first: numbered, each with severity (P0 to P3), evidence (file:line), and whether you **fixed** it
(and where) or are **reporting** it. Then give the same as your final answer. End both with one line
beginning `VERDICT:` (`VERDICT: ship`, `VERDICT: ship with the fixes made`, or `VERDICT: do not ship`).
