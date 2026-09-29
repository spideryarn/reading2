# Code review (write-capable): stage 2 / Part C of docs/plans/260929g-shelf-search-focus-and-metadata-chord.md

Repo: the current working directory, a worktree of Spideryarn. You may edit files in it.

Candidate: commit fdd595b4 (parent eba05e80). `git show --stat fdd595b4` lists every path; start with src/web/key-chord.ts,
src/web/ChatPanel.tsx (the composer ~line 2030-2200 and the edit-a-question box ~1730), src/web/CandidatesPanel.tsx (~876),
src/web/styles/mode-band.css, and the changed tests. That list does not limit scope. The plan's § Part C is the spec.
You reviewed stage 1 earlier (F7); this is new code by a different author.

What it does: the three Enter-sends boxes use `isSendEnter` (Enter, no Shift, not IME-composing incl. nativeEvent.isComposing and
keyCode 229). Chat's Send button moved from `disabled` + OS `title` to `aria-disabled` + the app's Tooltip card listing
"Enter to send" / "Shift+Enter for a new line", with the click stopped while unavailable.

Attack it independently — particularly: can the aria-disabled Send button now submit in a state the old `disabled` refused
(form submit via Enter or a click on a child, dictation armed/read-only, busy)? Is the Stop button swap still right? Did the CSS
selector change miss any state? Is keyboard focus / screen-reader behaviour of an aria-disabled submit OK?

Fix what is inside this stage, narrowly and red-first; report, do not fix, anything wider. You can run `npx vitest run <file>`
for tests needing nothing outside the tree. Severity P0–P3 as before; IDs continue from F8. End with a one-line verdict.
