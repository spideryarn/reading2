---
reports: spya-as0et6
ending: shipped
comment: The button that sends is green and the one that backs out is red, in Feedback and now across the app (sharing, Metadata, the admin pages, chat, notes and more). It is a design rule in controls.md.
---
# Feedback's buttons green to send, red to back out

A suggestion from Greg (an admin; `scripts/feedback-reporter.ts` exit 0 on the production row),
filed 2026-10-19 17:27 UTC from `/admin/users` (#621, `SPIDERYARN-READING2-KE`, queue item
`qi-d9zvk6y2`). Plan and both GPT Sol reviews:
[261020f](../plans/261020f-feedback-buttons-coloured-positive-and-negative.md).

> In the send addendum interface within feedback, you know, color the buttons red and green, and
> for close as well, just so it's easier to see what's, you know, going to effectively a cancel and
> what's a submit. We've done that elsewhere. Let's try and do that throughout the feedback dialogue
> and perhaps elsewhere as well. And maybe, you know, update our design system and/or docs so that
> going forwards, we make it more visible which buttons are kind of positive versus negative.
>
> — Greg, 2026-10-19 (`spya-as0et6`, #621)

**Ending: shipped**, on `dev`, for the Feedback dialog and the shared piece; two parts wait on Greg.

- **One shared pair, `.tone-positive` and `.tone-negative`**, in
  [`button-tone.css`](../../src/web/button-tone.css): `--positive` green or `--danger` red on
  the text and border, no wash, dimmed when it cannot be pressed unless it is working. It replaces
  the thread's four Feedback-only rules (261011h) and `.fb-send`'s own green (261017c). `/design`
  § Controls across modes shows it as *Send and back out*.
- **Where it is**: Write's Send (green) and Cancel (red); Earlier's Close (red, overruling
  261017c's grey); an addendum's Send addendum (green) and Cancel (red, overruling 261011h's
  neutral); a thread's Send reply (green) and Defer for now (red). Left neutral on purpose:
  Previous and Next, Bring back, Add to this report, and the header's ✕, which is the cross every
  dialog shares.
- **Red is a direction, not a warning.** Write's Cancel keeps its draft; the addendum's Cancel
  discards its own, as before. A button that exists to delete is the solid destructive fill.
- **Deferred, both waiting on Greg** in question
  [`q-yvmweg`](questions/q-yvmweg.md): (1) the rule's wording in
  [controls.md](../project/controls.md), a rule doc; (2) the app's ~16 other send/back-out pairs,
  queued as `qi-ysxdv97b`.

Sentry: this session has no Sentry sign-in; the next feedback sweep marks it resolved.

**Answered, 2026-10-20** (reply `spya-xbrvb9` to `q-yvmweg`): yes to both, *"use your judgment,
don't over-use it"*. The rule is in [controls.md](../project/controls.md); the rest of the app's
pairs changed in [261020z](../plans/261020z-green-to-send-red-to-back-out-across-the-app.md), which
lists the few left alone and why.
