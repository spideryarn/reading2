# Code review: Escape leaves Metadata, ⌘-K from inside text fields, a Metadata icon

You are reviewing built code, and you may fix what you find inside this stage's files. Report
anything wider for me to decide; do not widen the stage yourself.

**The evidence:** the single commit `83da416a4` on this branch — `git show 83da416a4`. Base is
`01bdbe8ea`. No untracked files belong to it.

Read first:

1. `docs/plans/261004h-escape-leaves-metadata-cmd-k-from-inside-text-fields-and-a-metadata-icon-of-its-own.md`
   — the plan, including § GPT Sol's plan review, which says which earlier findings were taken and
   which were deliberately not built. Do not re-raise the three not built unless the code makes one
   of them worse than the plan says.
2. The diff: `src/web/Dock.tsx` (`useCommandBarChord`, `keepsItsOwnModK`, `useMetadataEscape`, the
   Metadata `DockLink`), `src/web/TitleEditor.tsx`, `src/web/help/help-topics.tsx`,
   `tests/command-bar.test.tsx`, `tests/metadata-chord.test.tsx`, `docs/project/keyboard.md`,
   `docs/project/icons.md`, the feedback note under `docs/user-feedback/`.

The product decisions are Greg's and not up for review.

What I want:

- **Each finding as (a) an input I can run under which the code fails its own claim, and (b) the
  smallest fix.** Severity P0–P3. Where you can, write (a) as a test, watch it go red, apply (b),
  watch it go green. A finding with no (a) goes last.
- Try to break, specifically:
  - `useCommandBarChord` now listens in the **capture** phase and calls `stopPropagation()` on a
    claimed press. Is there a press it claims and then does not open on (`show()` declining after
    `preventDefault`)? Does the command bar's own input, with the bar already open, still behave
    on a second ⌘-K (the `dialog[open]` refusal now runs with focus inside the bar's input)?
  - `keepsItsOwnModK`: the Mac test reads `navigator.platform`. Is there a real platform string it
    gets wrong in a way that matters (iPadOS reporting `MacIntel` with a hardware keyboard is the
    intended case)? Does the `data-command-bar="off"` check reach every place `TitleEditor` is
    used (the masthead and the Metadata page)?
  - `useMetadataEscape`: any press it acts on that belonged to something else, given the tiers in
    `docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-escape-inventory.md`.
    The hook is registered in `Dock`; check the order against the drawer's capture listener and
    `useEscapeToClose` callers that could be mounted on the Metadata page.
  - The tests: is any new test one that would pass with the change reverted? Name it.
  - The docs and the Help text: any sentence now false.
- **Do not attribute any sentence to Greg that is not already quoted from him in the plan.**
- You may run `npx vitest run tests/command-bar.test.tsx tests/metadata-chord.test.tsx
  tests/one-escape-closes-one-surface.test.tsx tests/key-chord.test.ts`. Not `npm test`, not
  `npm run typecheck`, nothing needing Postgres or the network. Do not commit.

End with a plain verdict: **good to land / good with the fixes I made / not ready**, and a list of
every file you changed.
