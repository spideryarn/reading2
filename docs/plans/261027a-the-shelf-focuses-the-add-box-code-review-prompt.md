# Code review: the shelf focuses the add box on arrival (261027a)

You are reviewing an uncommitted change in this worktree. Read the plan,
`docs/plans/261027a-the-shelf-focuses-the-add-box-on-arrival.md`, then the diff: run
`git diff HEAD` and `git status` (the test file was renamed with `git mv` from
`tests/shelf-search-focus.test.tsx` to `tests/shelf-add-box-focus.test.tsx`).

The request (Greg, admin): "By default, put the focus in the add box, not the search box." The
focus-on-arrival effect moved from `SearchBox` in `src/web/Library.tsx` to the URL input in
`src/web/AddArticle.tsx`, keeping the guards: coarse pointer, something already focused, box not
wholly on screen, and (decided by Library) a page that arrived with `?q=`.

Look for, and fix inside this change where the fix is clearly right:

1. Correctness of the mount-once effect in `AddArticle` — does it fire after the input is in the
   DOM and laid out? `AddArticle` wraps its form in `UploadPicker` with a render-prop; confirm the
   input exists on the first commit (not after some async state), or the effect silently never
   focuses.
2. Whether `query === ""` in Library is the value at mount (nuqs state) and whether the arrival
   rule is sound.
3. Anything else that assumed the search box had focus on arrival — a keyboard shortcut, a test, a
   doc (`docs/project/keyboard.md`, `docs/project/library.md`, `docs/project/touch.md`), a comment.
4. Phones: the on-screen keyboard must not pop up on a coarse-pointer device.
5. Whether the new test would really go red if the behaviour regressed (it was seen red before the
   fix, on the first case).

Then run `npx vitest run tests/shelf-add-box-focus.test.tsx tests/shelf-search-clear.test.tsx` and
`npm run typecheck`. Do not commit, push, or touch anything outside this worktree. End with a
short list of findings: each one fixed / not fixed and why.
