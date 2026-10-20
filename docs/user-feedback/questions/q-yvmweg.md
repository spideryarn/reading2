---
id: q-yvmweg
report: spya-as0et6
status: answered
asked: 2026-10-20
title: Should green-to-send, red-to-back-out become a written rule, and spread beyond Feedback?
refs: SPIDERYARN-READING2-KE · qi-d9zvk6y2 · qi-ysxdv97b · docs/plans/261020f-feedback-buttons-coloured-positive-and-negative.md · docs/plans/261020z-green-to-send-red-to-back-out-across-the-app.md · docs/user-feedback/261019_1727-feedback-buttons-green-to-send-red-to-back-out.md · docs/project/controls.md
acted: spya-xbrvb9
---
The Feedback dialog's buttons are now green to send and red to back out (Send, Send addendum, Send reply green; Cancel, Close, Defer for now red). Two things are left for you.

1. Should this go into the design rules (controls.md), so every new form follows it? The wording I would add is at the bottom of Details.
A. Yes, as written (recommended). One new row in the "controls that do the same job" table, and two sentences under it.
B. Yes, but with your changes to the wording.
C. Not yet: keep it to Feedback until we have seen it for a while. The rule then lives only in the stylesheet's comment and on /design.

2. The rest of the app has about 16 other send/back-out pairs (Share it / Cancel, Create the link / Cancel, Save / Cancel on the admin pages, Yes, start again / Cancel, and so on). Should they change too?
A. Yes, all of them, in one piece of work (recommended if you answered 1A). The send button turns from our orange to green, and Cancel from grey to red. About a dozen files, and their tests.
B. Only the admin pages first, where you are the only reader, and see how it feels.
C. No: leave them as they are. Orange-to-confirm, grey-to-cancel stays the norm outside Feedback.

Details

You asked on 2026-10-19, from /admin/users, for Feedback's buttons to be coloured red and green, "for close as well", so it is easier to tell a cancel from a submit, and for the design system to say so going forward.

What is built (on dev, not yet deployed): two shared classes, green and red, in one small stylesheet. They colour only the text and border, with no tint behind (a tint makes the text too faint in the light theme), and a coloured button that cannot be pressed goes faint. The Feedback dialog uses them on every pair: Send and Cancel on Write; Close at the foot of Earlier; Send addendum and Cancel when you add to a report; Send reply and Defer for now in a thread. Left neutral, on purpose: Previous and Next (they move you, they do not finish anything), Bring back (it undoes a deferral), Add to this report (it opens a box), and the small cross at the top right. The cross is the same cross every dialog in the app uses, and colouring it here alone would make Feedback's look different from everyone else's; if you want it red, say so and it is one line.

One thing worth knowing for question 2: red here means "leave without sending", not "this destroys something". Whether the words survive depends on the form, as it did before: Write's Cancel and Close keep your draft, while the addendum box's Cancel throws its half-written addendum away. A button whose whole job is to delete something (Delete for ever on the Metadata page) is a solid red fill, which is a different thing and stays as it is. The words on the buttons still carry the meaning; the colour is a shortcut, and red-green colour blindness loses only the shortcut.

The wording I would add to controls.md (question 1A), as a new row in the table:

  a control that... sends what you wrote, or leaves without sending | the shared piece: .tone-positive (green) and .tone-negative (red), button-tone.css | tests: feedback-dialog-styles

and under the table:

  The pair that ends a form is coloured by what it does: the button that sends what you wrote is green, the one that leaves or puts off without sending is red. Red here is a direction, not a warning: a button whose job is to delete something is the solid destructive fill. Buttons that move you (Previous, Next) or undo (Bring back) stay neutral.

## Greg's answer, 2026-10-20 (in the Feedback dialog, reply `spya-xbrvb9`)

> 1 yes, but use your judgment, don't over-use it, update design rules minimally
>
> 2 A yes these all sound like they should change

Acted on in plan 261020z: the rule is in controls.md, trimmed; the other pairs are green and red,
and the few left alone are listed in the plan with why.
