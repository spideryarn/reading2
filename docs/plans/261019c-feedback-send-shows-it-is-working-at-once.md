# Feedback's Send shows it is working, at full strength

Report `spya-an90k0` (#608, SPIDERYARN-READING2-JZ), from Greg (admin, `feedback-reporter.ts` exit
0), iPad, production build `956a2380`, 2026-10-18 23:38 UTC. Queue item `qi-drm9mpth`.

> When I click send in this feedback dialog, it seems to take a few seconds to take effect, where
> there is no UI feedback at all, no spinner, and then eventually the dialog disappears and
> presumably got sent.

The second time this has been reported. The first,
[260905_1802](../user-feedback/260905_1802-spinner-on-the-send-button.md), ended "the spinner is
already there, probably too fast to see". This one says *a few seconds*, so that answer does not
cover it.

## What the evidence says

- **The server handler was fast.** Production log, request `gggcd-1792366722741`: the POST
  arrived at 23:38:42.741 and was answered in 81ms; the four other reports Greg filed that evening
  took 67–116ms. (The log starts at arrival, so the time before that is not in it.)
- **The report was dictated.** `/api/transcribe` ran 23:38:23.2–25.97, 24s of audio, 206
  characters, which is exactly this report's length. All five reports that evening have the same
  shape: the transcript lands, and the POST follows 17–19s later. A send queued from the microphone
  (Send while it is on) would POST as soon as the words land, so that rules queued sending out. That
  Greg pressed Stop and reread before pressing Send is inference.
- **The code shows the working state at once.** GPT Sol's trace of every path from a press to the
  POST ([261019c-feedback-send-trace-sol.md](261019c-feedback-send-trace-sol.md)) found none that
  stays on plain "Send". A Sonnet browser run at iPad size, in desktop Chromium and Playwright
  WebKit, measured the "Sending" label and spinner in the DOM 10–110ms after the click, even at 4×
  CPU throttling. That is a DOM update, not a paint on an iPad.
- **What sits between the press and the request on a real iPad** is `apiFetch`'s wait for the
  Supabase session, up to 1.5s (`SESSION_DEADLINE_MS`), plus the network. That can add up to the
  seconds Greg described, and the button is meant to say *Sending* throughout it.

## The likeliest reason he saw nothing

**The working state is drawn as a disabled button at `opacity: 0.45`**
(`.fb-send:disabled`, [feedback.css](../../src/web/styles/feedback.css)): "Sending" and a 14px
spinner, faint, in the corner of a tall dialog. And on the iPad specifically, **a disabled button at
`opacity < 1` is already our leading suspect for the chat Send icon not painting at all**
([260912c](260912c-send-button-icon-and-primary-style.md), WebKit bugs 218798 and 238088). Neither
is proved: that earlier report was treated as fixed from Playwright WebKit screenshots, not a real
iPad, and this one carries no diagnostics.

## The change

The simplest version: **a button that is working is never dimmed.**

1. **`data-working` on the button while it works on the reader's behalf**: *Sending*, *Adding the
   picture*, *Writing that down*. A data attribute rather than `aria-busy`, which lets assistive
   technology hold back announcing changes inside the element, and the changing label is exactly the
   feedback (GPT Sol, plan review 1).
2. **`.fb-send[data-working]:disabled { opacity: 1; cursor: progress; }`** after the dimming rule.
   Only `:disabled`: while *Writing that down* the button is live (a press queues the send), so it
   keeps its pointer and was never dimmed.
3. **The same for the Earlier tab's Send reply / Send addendum** (`FeedbackSendBox`,
   `.fb-reply-send`), which has the same spinner under the same 45% while it sends (plan review 5).
4. **Tests, written first and watched go red** in `tests/feedback-dialog.test.tsx`: the attribute
   in each of the three states and absent at rest; the two CSS rules with `opacity: 1`, read
   through `readerCssNoComments()`, each selector unique.
5. `docs/project/feedback.md § Send spins` gets a paragraph, and the comment in `send` that calls
   the earlier report "too fast to see" is brought up to date.

## Passed over

- **Saying "not yet" with colour instead of opacity**, as `.chat-send` does since 260912c. The
  first draft did it. It is not needed for this report: a working button at full opacity is already
  out of the suspect state. In the Earlier thread a higher-specificity green rule would also have to
  be unpicked. Worth doing if the iPad shows a dimmed Send missing its words.
- **A minimum time on screen for the spinner.** Greg declined it on 2026-09-06, and it would not
  help here, where the state was on screen for seconds and still not seen.
- **Dimming the whole form, or an overlay, while sending.** That is louder, but it is new UI. If the
  iPad still shows nothing at full opacity, an overlay is the next step.
- **Awaiting a frame before building the body** (the `send` comment's deferred fix). Not this
  report: `consented: false` and no screenshot, so nothing heavy ran.
- **Sending on `pointerdown`, or skipping the session wait.** There is no evidence either is the
  cause, and the session wait protects against a stale token.
- **Client-side timing instrumentation** (press → render → session → fetch). That would settle the
  question, but it is new machinery for one report. Worth doing if this comes back after the
  change.

Noted, not changed: the thank-you toast does not follow `visualViewport`, so it can sit under the
departing iOS keyboard. That may be why Greg wrote "presumably got sent". Recorded in the note.

Plan review: [261019c-feedback-send-plan-review-sol.md](261019c-feedback-send-plan-review-sol.md).
Its point 3 corrected a claim in the first draft: the reduced-motion pulse does not take the
spinner to ~11%, because the global reduced-motion guard in `tailwind.css` stops animations.

## Checks

- [x] Tests red first, then green; `npm test`, `npm run typecheck`
  - 📔 Red for the right reason: *"Adding the picture was drawn dimmed: expected false to be true"*,
    and the CSS test found no `[data-working]` rule.
- [x] Screenshot in WebKit at iPad size of: empty (disabled), typed, Sending (POST held)
  - 📔 Computed opacity: empty 0.45 (unchanged), typed 1, Sending 1 in dark and light. Before:
    [261019c-shot-1-before-sending.png](261019c-shot-1-before-sending.png); after:
    [261019c-shot-2-after-sending.png](261019c-shot-2-after-sending.png),
    [261019c-shot-3-after-sending-light.png](261019c-shot-3-after-sending-light.png). Send reply
    was not shot; its test pins the attribute.
- [x] GPT Sol plan review ([261019c-feedback-send-plan-review-sol.md](261019c-feedback-send-plan-review-sol.md)), then code review ([261019c-feedback-send-code-review-sol.md](261019c-feedback-send-code-review-sol.md)): approve; it added the failure-state and Send addendum assertions and tightened two claims to what was measured.
