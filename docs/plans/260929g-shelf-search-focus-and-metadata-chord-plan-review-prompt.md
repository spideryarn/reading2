# Plan review: docs/plans/260929g-shelf-search-focus-and-metadata-chord.md

You are reviewing a PLAN, read-only. Repo: the current working directory (a worktree of Spideryarn, React 19 + TS SPA). Do not change any file.

Candidate (live, pre-commit, both files untracked):
- docs/plans/260929g-shelf-search-focus-and-metadata-chord.md (the plan)
- docs/research/260929a-keyboard-shortcut-libraries.md (the library research it cites)

Read the plan, then the code it touches: src/web/Dock.tsx (useCommandBarChord ~line 1235-1330, the Metadata DockLink ~line 1940, NOT_A_MODE.metadata ~line 2103), src/web/keynav.ts (isTyping ~360, the keydown handler ~460), src/web/TermJump.tsx (isTyping ~72, the key test ~135), src/web/Library.tsx (SearchBox ~909, its mount ~623), src/web/App.tsx (~348-370, where Library mounts), src/web/Link.tsx, docs/project/keyboard.md. Other Cmd/Ctrl+Enter users: grep src/web for `ctrlKey` near "Enter".

Attack the plan independently first: is anything wrong, missing or unsafe? Particularly whether the chord can fire where it shouldn't or fail where it should work, whether the shelf focus can misfire (Back navigation, the signed-in homepage path vs /library, scroll restoration), whether the consolidation is right-sized, and whether the library decision is justified by the research.

Severity: P0 data loss/security/unusable; P1 user-visible wrong behaviour or contract violated; P2 design/maintainability risk; P3 prose. Give each finding an ID F1, F2… with file:line evidence and a concrete fix. End with a one-line verdict.

## My own suspicions (worth less; spend most of the run elsewhere)
- Is `(pointer: coarse)` the right phone test, versus `any-pointer` or `hover: none`?
- I exclude a focused link but not a focused button (the research measured no button default for Ctrl/Meta-Enter in Chrome). Right?
- Does `Library` actually remount on client-side return to the shelf?
