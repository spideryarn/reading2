# Plan review: Escape leaves Metadata, ⌘-K from inside text fields, a Metadata icon

You are reviewing a plan before it is built. Read-only: do not edit anything.

Read, in this order:

1. `docs/plans/261004h-escape-leaves-metadata-cmd-k-from-inside-text-fields-and-a-metadata-icon-of-its-own.md` — the plan.
2. `src/web/Dock.tsx` — `useCommandBarChord`, `useMetadataChord`, the drawer's capture-phase Escape
   listener, and the Metadata `DockLink`.
3. `src/web/key-chord.ts`, `src/web/useEscapeToClose.ts`.
4. `docs/project/keyboard.md` § ⌘-K and § ⌘-Enter, and
   `docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-escape-inventory.md`.
5. `tests/command-bar.test.tsx` (the chord tests near "does not fire while a text field has focus")
   and `tests/metadata-chord.test.tsx`.

The product decisions are Greg's and are not up for review: Escape leaves Metadata, ⌘-K works from
inside text inputs in the reading view, the Metadata button gets a different icon, no button moves.

What I want from you:

- **Each finding as (a) the concrete input or sequence under which the planned behaviour is wrong,
  and (b) the smallest change to the plan that closes it.** Severity P0–P3. A finding with no (a)
  goes last.
- Specifically try to break:
  - **Escape on Metadata.** Is there a surface on the Metadata page (`src/web/Metadata.tsx`,
    `PageContents.tsx`, `TagEditor.tsx`, `TitleEditor.tsx`, `AccessSharing.tsx`, hover cards,
    tooltips, a confirm for delete) that is open, does not stop the press, and is not a text field
    or a native dialog — so one Escape would both close it and leave the page? Is there any state
    on that page (an unsaved edit outside a text field, a running job) that leaving on Escape would
    lose?
  - **⌘-K in capture with stopPropagation.** Which existing listener depends on seeing that
    keydown? Does anything rely on the old order (the drawer's capture Escape listener is a
    different key, but check)? Is there a field where opening a modal dialog over it loses the
    draft or the dictation in progress (`src/web/` dictation, `CommentDialog.tsx`,
    `AnnotateDialog.tsx`, `ChatPanel.tsx`, `SearchPanel.tsx`, `DockQuickSearch.tsx`)? Does a command
    picked from the bar then discard that draft?
  - Ctrl-K on a Mac inside a text field, and Ctrl-K on Windows/Linux in a browser that binds it.
- Say plainly at the end: **ready to build / ready with changes / not ready**.

You may run a single test file with `npx vitest run tests/<one>.test.tsx`; not `npm test`, and
nothing that needs Postgres or the network.
