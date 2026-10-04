# Input modality must expire with the interaction it qualifies

Up: [postmortems.md](../project/postmortems.md)

Commit `d85598ac2` taught controlled tooltips to ignore the compatibility `mouseleave` that follows
a touch tap. It also left the remembered touch modality set for the lifetime of the mounted
component. On a hybrid device, a later real mouse could hover in and out without closing the card
until it pressed something. Nothing reached a reader: the candidate was caught in code review.

## What happened

`Tooltip` set `byTouch.current` on `pointerdown` and reset it only on another `pointerdown`. That was
enough for the measured Chrome sequence—touch down, click, compatibility mouse leave—but not for the
next interaction. A mouse does not need to press before it hovers, a cursor may already be over the
trigger when the finger taps it, and a cancelled touch may produce no click at all.

The first regression test reproduced touch followed by a real mouse enter and leave and failed with
one card still open instead of none. Two more red tests reproduced the already-over cursor and the
cancelled-touch/keyboard sequence; an interactive-card test reproduced a mouse entering the card
without crossing its trigger.

## The class: input provenance stored without its lifetime

The state answered a bounded question—*did touch open this card?*—but was stored as an unbounded
fact—*was the last press touch?* A provenance flag is correct only when its lifetime matches the
decision it qualifies. Component lifetime was too broad; the opening and the active pointer
interaction are the boundary.

This is easy to miss when one event trace motivates the change. The trace proves the exception that
is needed, but says nothing about when the exception must end.

## Why nothing went red

The candidate's test ended after the compatibility leave and an outside press. It proved that the
touch-opened card survived and could be dismissed, but never changed input modality while the same
component remained mounted. Typechecking and the existing controlled-tooltip suites had no reason
to object: the ref and every close route were valid in isolation.

## What would have caught it, ranked by ease against value

1. **Follow every modality exception with a transition test.** Touch → mouse, cancelled touch →
   keyboard, and touch → direct mouse entry are now red-first tests. This is done.
2. **Name the lifetime in the state's comment.** `Tooltip` now says the exemption belongs to one
   opening and ends on close, cancellation or real mouse activity. This is done beside the code,
   where a future edit meets it.
3. **A global “current input modality” service** is rejected. It would add shared state and document
   listeners to answer a question local pointer events already answer, while creating a second
   modality authority beside Floating UI's own pointer tracking.

## The long-term fix

Keep the exception local, but end it at every boundary the card can observe: when the card closes,
when the originating pointer is cancelled, when a real mouse reaches or leaves the trigger, and
when it enters an interactive card directly. Child handlers remain composed through Floating UI's
prop getter, so the fix does not replace the trigger's own gesture logic.

## The thing I would tell myself

I had evidence for ignoring one synthetic leave and treated that as evidence for a durable touch
mode. The next question should have been: what observable event proves this exception is no longer
about the tap that earned it?
