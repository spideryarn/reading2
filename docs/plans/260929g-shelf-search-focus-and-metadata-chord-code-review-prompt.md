# Code review (write-capable): stage 1 of docs/plans/260929g-shelf-search-focus-and-metadata-chord.md

Repo: the current working directory, a worktree of Spideryarn (React 19 + TS SPA). You may edit files in it.

Candidate: commit a907a33c (parent 1687053d). `git show --stat a907a33c` lists every path; start with
src/web/key-chord.ts, src/web/Dock.tsx (useMetadataChord, useCommandBarChord, the Metadata DockLink, NOT_A_MODE.metadata),
src/web/Library.tsx (takesFocusOnArrival, SearchBox), src/web/keynav.ts, src/web/TermJump.tsx, and the three new test files.
That list does not limit your scope. The plan (and your own plan review, F1–F6, now folded in) is the spec.

What it does: the signed-in shelf focuses its search box on arrival (not with a coarse primary pointer, not with ?q=, not when
something else has focus, not when the box is not wholly on screen). On the reading view, Cmd/Ctrl-Enter navigates to the
Metadata page (not while typing, not on a focused link, not over an open dialog, not if defaultPrevented, not repeat/Shift/Alt/IME).
Three isTyping copies became one leaf module.

Attack it independently. Fix what is inside this stage, narrowly and red-first (write or adjust a test, see it fail, then fix).
Report, do not fix, anything wider. You can run `npx vitest run <file>` for tests that need nothing outside the tree
(all three new files qualify; so do tests/term-jump-from-a-paragraph.test.tsx and tests that render Dock with fakes). No network.

Severity: P0 data loss/security/unusable; P1 user-visible wrong behaviour or contract violated; P2 design/maintainability risk;
P3 prose. ID every finding F7, F8… (F1–F6 were the plan review). For each: evidence (file:line, or a test you ran), what you
changed if you fixed it, and which test proves it. End with a one-line verdict.

## My suspicions (worth less; spend most of the run elsewhere)
- The shelf "wholly on screen" test: on a short laptop window, is the search box below the fold on first load, so the feature silently never fires?
- `view === "article"` — is that true on every reading-view mount, including the public/visitor reading view, and false on the metadata page?
- The Metadata tooltip sentence reads well?
