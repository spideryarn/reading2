# Logical list continuity does not preserve DOM focus

Review of fleet preview stage 2 established an older desktop focus loss. At 1280px, select alpha,
focus beta's title, then clear selection by navigating to `#sessions`: the list remains visible,
but its replacement beta button has lost focus to `BODY`. A temporary assertion expecting the
replacement button failed on both the working candidate and `38ed43920`, before previews existed.
No live dashboard was changed. This wider behavior is left unfixed under the review's explicit
instruction to fix only stage-local findings; the temporary failing probe was removed.

## The class: logical continuity is not DOM continuity

The two-pane list sits inside an extra ancestor. Closing the detail moves the full-width list
into a different render branch, remounting its buttons even though their session ids have not
changed. A person's place in the list survives logically while the browser's focused node does
not. The one-pane restore path combines focus restoration with pixel-scroll restoration, so it
cannot cover the desktop case.

History and blame identify `44f606198c`, which introduced master/detail on 2026-09-08, as the source
of the differing ancestry. The historical commit was not executed. Stage 1's `bcba3df084` added
restoration explicitly at one pane; its subsequent fixes in `38ed43920` retain that restriction.
An `enabled` prop on `Tooltip` would preserve the title across local preview eligibility changes,
but would not preserve it across replacement of the whole list.

## The repair and countermeasures, ranked

1. **Add the desktop transition regression above.** Cheap and directly observed red. The existing
   one-pane history tests pass because they never exercise this ancestry transition.
2. **Restore the focused row by session identity across list replacement independently of pixel
   restoration.** Keep the existing checks for obsolete scroll coordinates; focus has a different
   lifetime. This needs to cover the currently focused row, which may differ from the selected one.
3. **Preserve the list subtree across layout changes.** A stronger structural repair, but larger
   than this review's stage. Check one/two-pane transitions and ordering/grouping as part of it.
4. **Rejected: a Tooltip-only fix.** It removes one remount but leaves the observed parent remount
   unchanged. Also reject extending saved scroll pixels to desktop: their validity is a separate
   question from which surviving row should receive focus.

## Fixed, 2026-10-06

Countermeasures 1 and 2, in `tools/fleet/web/src/SessionsPanel.tsx`. The panel reads which session's
title has focus as it renders; after the commit, if focus has fallen to `<body>`, it goes back to the
button with that `data-session`, without scrolling. It never takes focus from anything else, and it
is separate from the one-pane pixel restore, which keeps its own rules.

Countermeasure 3 was not taken. With nothing selected and more than one band, the list is dealt into
columns, so cards change parent whatever the surrounding markup does. Keeping the subtree would have
covered the reported case and left that one.

The local remount went too: `Tooltip` has an `enabled` prop, so a card gaining or losing its preview
keeps its title button.

Held by `tests/fleet-session-preview.test.tsx` § "keyboard focus across a change of layout", seen red
before the fix and again with the focus call removed. Not yet checked in a real browser.

Up: [Postmortems](../project/postmortems.md)
