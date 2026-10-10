---
reports: spya-t858ug
ending: shipped
comment: Live conversation is on GPT-Live for everyone now, with no engine dropdown. With Experimental features on, Realtime is a small arrow on the Live button.
---
# GPT-Live for everyone; Realtime from an arrow on the Live button

An admin report from Greg (`scripts/feedback-reporter.ts` exit 0), filed 2026-10-09 at 23:02 UTC
from Chat on *Attention Is All You Need* (#525, build `5f6d3d5f`). Queue item `qi-s8brz9cw`,
session `fbt858ug-live-default-engine-arrow`. The plan, both GPT Sol reviews and the browser check:
[261010a](../plans/261010a-gpt-live-is-the-live-engine-for-everyone-realtime-from-an-arrow-on-the-live-button.md).

> Anytime we have a Live button for real-time conversation, there's a drop-down next to it, which is
> a bit cumbersome and ugly for choosing between OpenAI's Live and Realtime APIs. Let's make Live
> the default and keep real-time only for Experimental Features. In other words, for people who
> have Experimental Features turned off, they won't see that dropdown and it'll always be in Live
> mode.
>
> And for the people who do have experimental features turned on, can you just make it a little
> drop down on the live button rather than its own separate drop down? i.e. a little drop down arrow
> to the right of the live button.
>
> — Greg, 2026-10-09

## What we did

- **Every reader's live call is on GPT-Live** (`DEFAULT_ENGINE` in `src/web/live/engine.ts`).
  With Experimental features off there is no engine control at all.
- **With Experimental features on, a small arrow joined to the right of the Live button** opens a
  menu: GPT-Live (the default) or Realtime. It is remembered per browser and cannot be changed
  during a call. It is one component, so every Live button gets it: Chat, Learn and the guide.
- Turning Experimental off mid-call now ends a *Realtime* call, as it used to end a GPT-Live one.
- Live's Advanced panel no longer offers noise reduction on GPT-Live, which has none. Before, it
  changed nothing and reconnected anyway.
- `/privacy` now names `gpt-live-1` and `gpt-6-luna`, which it had never listed, and its date moved
  to 10 October 2026.

**This answers `qi-hq3fv9pw`**, which had held the move back because GPT-Live's answers about the
article measured about two seconds slower. Two of its four conditions have since been met (the
server handshake, and a two-minute idle cap). The latency and the filler have not been re-measured.
The plan sets out what every reader gives up: Tap to talk and noise reduction, and Listening and
Speaking become estimates. It also covers the cost: about a quarter as much per turn, but billed
for every open minute. Worth a look in `/admin/costs` after the deploy.

Sentry: this session had no Sentry sign-in, so the next feedback sweep marks it resolved.
