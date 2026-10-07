# Code review: the contents list and its search box, above the page on a narrow window

You are reviewing **code**, and you may fix what you find. Stay inside this stage: fix narrowly,
red first (a failing test before the fix), and **report rather than fix** anything wider you notice.
Do not commit, and run no git command that changes the tree or the index. Put your findings in
your answer; your edits are read as a proposal.

## The candidate

One commit in this worktree: `43e261c58`, on top of `ed16143cb` (origin/dev at the time).
`git show --stat 43e261c58` lists its sixteen paths; `git show 43e261c58 -- <path>` shows each.

Start with:

- `docs/plans/261007c-contents-list-and-search-above-the-page-on-a-narrow-window.md` — the plan,
  with Greg's report at the top and your plan review's five findings at the bottom. Check each of
  F1 to F5 is really closed in the code, not only in the prose.
- `src/web/PageContents.tsx` — the `<nav>`, the *Contents* button, `open`, `useId`
- `src/web/Metadata.tsx`, `src/web/ProfilePage.tsx` — the mount moved inside `<main>`
- `src/web/help/HelpPage.tsx` — one class on the search input
- `tests/page-contents-narrow.test.tsx` (new), and the changes in
  `tests/metadata-contents-reveal.test.tsx`, `tests/metadata-page-order.test.tsx`,
  `tests/profile-sections-collapsed.test.tsx`, `tests/touch-controls.test.ts`
- `docs/project/reader-profile.md`, `web-client.md`, `phone-and-touch.md`, `narrow-windows.md` —
  read the changed wording against the code; say where a sentence is not true of it.

This is where to start, not a limit on scope. These test files need no database or network; run
them yourself: `npx vitest run tests/page-contents-narrow.test.tsx tests/metadata-contents-reveal.test.tsx tests/metadata-page-order.test.tsx tests/profile-sections-collapsed.test.tsx tests/page-contents-reached.test.tsx tests/touch-controls.test.ts tests/help-page.test.tsx`.
`npm run typecheck` too. A real browser is being driven separately; you cannot reach one.

## What to do

Attack it independently first. Does it do what the plan says, on a phone, an iPad in portrait, an
iPad in landscape and a desktop? Is the desktop list exactly what it was? Read the Tailwind classes
as CSS: which rule wins at each width and pointer type, and is anything left un-scoped that should
be `lg:` (or the reverse)? You can compile the stylesheet to check order rather than reason about
it. Are the new tests able to fail for the right reason; is anything load-bearing untested? Is any
comment or doc sentence false?

## Severity and findings

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding a stable ID (`C1`, `C2`, …), its severity, whether it is **established** or
**reasoned**, whether you **fixed** it or are **reporting** it, and the files you changed. End with
one line: `VERDICT: ship` / `VERDICT: ship with the fixes made` / `VERDICT: do not ship` — refuse
only on an established P0 or P1 you could not fix.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- From 1024px up on a touch screen the search box is now 16px type in an 11rem column; whether
  "Search this page" still fits, and whether that is worth anything.
- The "Nothing on this page matches." line keeps `text-xs` and `pl-3` below `lg`, beside larger rows.
- Whether the `<ul>` keeping `overflow-y-auto` below `lg` can ever make a scroll box there.
- Whether a reveal from the narrow list lands the section under anything (there is no sticky bar on
  these pages, but Metadata has a dock at the bottom).
- Whether moving the `<nav>` inside `<main>` changes what Metadata's `?section=` arrival, the
  command bar, or Escape handling see.
