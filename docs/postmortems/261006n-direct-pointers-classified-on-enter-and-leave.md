# Direct pointers must be classified on enter and leave

Caught before deployment in the code review of
[261006i](../plans/261006i-marginalia-narrow-notice-fades-and-can-be-dismissed.md), introduced by
`72121e004`. No reader encountered it. That commit moved Toast's pause clock to pointer events so a
finger tap could not pause it forever, but Apple Pencil still could; on a hybrid device, a finger
lift could also resume a clock while a mouse remained over the notice.

## A pointer policy applied to one value and one half of a transition

The root cause was two partial versions of one input policy. Enter used “anything except `touch`
hovers,” although the project's rule is that `touch` and `pen` are both direct pointers. Leave did
no classification at all. One `hovered` boolean then let a direct pointer's leave clear a mouse's
pause. An independent review subagent confirmed both paths against
[touch.md](../project/touch.md): Apple Pencil counts as a finger, and a touch lift emits the hover
family's leaving events.

The class is **a finite input policy implemented as one exclusion, and only on entry**. It recurs
where a device category has several platform values and an interaction has paired begin/end events.

## Why the checks agreed

The new test sent only `pointerover` with `pointerType: "touch"`. It never supplied `"pen"`, and
never sent the `pointerout` a real touch lift produces. The mouse test used only a mouse stream.
Each proved its one branch while leaving the input matrix and the paired transition untested.

The added Pencil case failed with `is-gone` still absent after `TOAST_MS`. The hybrid sequence
mouse-over → direct-pointer over/out → wait failed with `is-gone` present while the mouse was still
over the element. Both were observed red before the production fix.

## What would have caught it, ranked by ease against value

1. **Run the direct-pointer cases as a table and send their complete enter/leave sequence.** Done;
   both `touch` and `pen` are pinned, including a mouse already holding the pause.
2. **Name the local classification once and use it symmetrically.** Done with `isDirectPointer` in
   `Toast.tsx`, so enter and leave cannot drift without an explicit edit.
3. **One global pointer-classification helper for the whole client.** Rejected. Pointer meaning is
   interaction-specific: the touch doc records deliberate places where pen remains mouse-like.
   Centralising a universal answer would hide those product choices rather than enforce them.

The review fix is also the long-term fix: one local policy, shared by both halves of the transition,
with every accepted direct-pointer value in the test matrix.

Up: [Postmortems](../project/postmortems.md)
