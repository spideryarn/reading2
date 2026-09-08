# The Feedback dialog zooms in on an iPhone

**Sentry:** `SPIDERYARN-READING2-2H` · reported 2026-09-07 17:44 UTC, from
`/read/after-work-we-ll-have-each-other-spya-rqztkp?mode=structure&at=spya-x9qg4p`, build
`c0fb04a4`. From Greg, so
[feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it) says *build it*.

> The Feedback dialog on an iPhone seems to get weirdly zoomed in when I click in and out of the
> Feedback text box.

**Ending: shipped** — but not by this session. **It was already fixed** when the session started,
and the useful part of the work was proving that.

## What it was

iOS Safari zooms the page when it focuses a form control whose computed `font-size` is under 16px,
and does not zoom back out on blur. `.fb-input` was `0.82rem` — 13.12px — and so was every other
hand-styled field in the app.

## What fixed it

[`31b200cd`](../plans/260908a-glossary-order-button-not-clickable-on-touch.md), *"A floor for a
control a finger has to hit, and a field iOS must not zoom into"*, which landed on `dev` at 03:55 on
2026-09-08 — **ten minutes before this session started**, and from a different report:
`SPIDERYARN-READING2-2J`, the glossary's order button on a touch device, whose session found the
whole class on the way past and closed it. That report's note is
[260907_1746-glossary-order-button-on-touch.md](260907_1746-glossary-order-button-on-touch.md); the
class is [the postmortem](../postmortems/260908a-a-rule-written-to-the-width-of-the-complaint.md).

The viewport meta was **not** touched, and should not be: `maximum-scale=1` would suppress this by
taking pinch-zoom away from every reader on every page.

## What this session added

It measured, in a real browser, that the report is genuinely answered — which mattered, because that
rule had already shipped applying to nothing **twice**, green suite both times.

Headless Chrome at an iPhone viewport with touch emulated, signed in against a local dev server:
twelve text-entry controls across six routes, **every one at exactly 16.00px**, including
`.fb-input.fb-body` focused and unfocused. A screenshot would have proved nothing — desktop Chrome
does not reproduce the zoom at all, so the picture looks right whatever the size is.

It also found the one control that rule did not reach — the chat composer's stance `<select>`, still
at **13.28px** — and closed it, as `:root select:not([hidden])` in the same rule. `<select>` was
named nowhere in it, because its heading reads *"the types that raise a keyboard"* and a `<select>`
on iOS raises a wheel picker; **iOS zooms on focus, not on the keyboard**, so that framing was
narrower than the behaviour. GPT Sol settled it from WebKit's source rather than the copied recipe —
a non-text control *"can be zoomed immediately"* on focus and takes the same zoom path, at a target
scale of `16 / fontSize`, which is **1.20×** at 13.28px — and drew a boundary worth keeping: that
scaling is gated to WebKit's small-screen idiom, so it is an iPhone claim, not an iPad one.

The record, the measurements, and the near-miss that is worth more than either — a fresh session
cannot tell from `gjd-remote ls` or from Sentry that another report's session has already fixed its
bug — is
[260908c-the-feedback-box-zoom-was-fixed-ten-minutes-before-i-started.md](../plans/260908c-the-feedback-box-zoom-was-fixed-ten-minutes-before-i-started.md).
