---
reports: spya-an90k0
ending: shipped
comment: Sending was there but drawn faint, as a disabled button at 45%, which on an iPad may not paint at all. It is now drawn at full strength while it works, and Send reply too. Tell us if your iPad still shows nothing.
---
# Feedback's Send is drawn at full strength while it works

`spya-an90k0` (#608, problem, SPIDERYARN-READING2-JZ), from Greg (admin; `feedback-reporter.ts`
exit 0 on the production row). Filed 2026-10-18 23:38 UTC on an iPad from
`/read/rovelli-order-of-time-…-spya-r26sug?at=spya-g83jsr&margin=1`, build 956a2380. Queue item
`qi-drm9mpth`. Addenda: none.

> When I click send in this feedback dialog, it seems to take a few seconds to take effect, where
> there is no UI feedback at all, no spinner, and then eventually the dialog disappears and
> presumably got sent.

**Ending: shipped**, on `dev`, not deployed. Plan, evidence and both GPT Sol reviews:
[261019c](../plans/261019c-feedback-send-shows-it-is-working-at-once.md).

## What we found

- The second report of this. The first,
  [260905_1802](260905_1802-spinner-on-the-send-button.md), ended "probably too fast to see". This
  one says a few seconds, so that answer did not cover it.
- **Not the server.** The production log has this POST answered in 81ms. The report was dictated,
  and Greg pressed Send about 17s after the words landed, so the dictation was not holding it up
  either.
- **The spinner was there, drawn faint.** Every path from a press to the request switches the
  button to *Sending* with the spinner at once (GPT Sol's trace; a browser run measured 10–110ms).
  But a sending button is disabled, and every disabled Send was drawn at 45% opacity. That is faint
  in the corner of a tall dialog. On an iPad it is also the leading suspect for a button that paints
  nothing at all (the chat Send icon, [260912_0828](260912_0828-send-button-icon-and-primary-style.md)).

## What we did

- A Send that is working (*Sending*, *Adding the picture*, *Writing that down*) is now drawn at
  full strength, not dimmed like one that cannot be pressed. The same goes for Send reply and Send
  addendum on the Earlier tab. Tests pin the attribute in each state and the CSS rule.
- Not proved on a real iPad. If it still shows nothing, the next step is to time the press, the
  render, the session lookup and the request in the browser, which the logs cannot see.

Noted, not changed: the thank-you toast does not follow the iPad keyboard as the dialog does, so
it can appear under the keyboard as it goes. That may be why it read as "presumably got sent".

Sentry: this session had no Sentry sign-in; the next sweep resolves it.
