# Selecting a mode does not reveal its hidden band

Up: [postmortems.md](../project/postmortems.md)

The citation-card candidate `e5be1f9fc24118d86e9cc1ea08a832be31c35866` could start a paid reading
and close its card while leaving the answer's band hidden on a phone or narrow window. This was
caught during review; production exposure was not established by this investigation.

## What happened

Following a Citations passage link sets `bandAway` while retaining the mounted band and
`?mode=citations`. The prose's new Dig deeper button starts the reading, requests row focus and
sets that same mode. Reader's `[mode]` effect does not run because the mode has not changed.

The red-first whole-page regression in
[a-band-link-steps-the-band-aside-on-a-phone.test.tsx](../../tests/a-band-link-steps-the-band-aside-on-a-phone.test.tsx)
failed with **“Dig deeper left the answer in a hidden band”**, expected `false`, received `true`.
It traverses the band's real passage link, the prose mark and the card button rather than calling
the new callback directly. The cases cover 390px and 600px windows.

## The class: navigation state is mistaken for visibility state

The action promises to open an answer, but writes only its destination. Visibility has a separate
owner: `bandAway` intentionally survives passage navigation and retains the band's state. A
destination write reveals the band incidentally when it changes the mode; it cannot implement an
“open” action when the destination is already selected.

The new citation handler copied `openTermInGlossary`'s shape. That sibling also writes its mode
without clearing `bandAway`: reopening Glossary from a term card after a glossary passage jump
has the same gap. The glossary helper predates this change (`f890331390`); the generic passage-link
step-aside behavior landed in `edc312c248` on 2026-09-29. That sibling is reported outside this
review's Part 1 scope, not silently treated as fixed.

## Why the existing checks agreed

The citation-card tests supplied an action callback and proved the button called it and closed the
card. They did not compose that action with Reader's retained narrow-window visibility state.
Selecting Citations from another mode also changes `mode`, so it exercises the existing effect and
conceals the missing same-mode case. A valid URL, a mounted row and a running stream can all coexist
with hidden paint.

## What would have caught it, ranked by ease against value

1. **Exercise reopening the current hidden destination through the whole page.** The red-first
   390px and 600px regressions do this for the citation action. This is the cheap check that sees
   both state owners together.
2. **Make every “open band” action explicitly restore visibility.** The scoped fix clears
   `bandAway` in the citation handler. Applying the same contract to the glossary sibling remains
   reported work; this review does not claim the whole class is closed.
3. **Reset visibility on every URL write** is rejected. Unrelated history and passage navigation
   deliberately leave the band aside. That broader reset would change the reader's navigation
   behavior without expressing an actual request to open a band.

## The long-term fix

An action that promises to open a band must select the destination and restore its visibility,
including when that destination is already selected. Keep passage-jump behavior separate. The
one-line citation fix expresses that contract locally; a shared open-band helper becomes useful
only when the wider sibling work is undertaken and the existing callers can be audited together.
