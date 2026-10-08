---
reports: spya-btjtbb
ending: shipped
comment: Mostly Apple's: an iPhone home-screen app forgets the grant on every restart and 10 minutes after dictation. We fixed one extra prompt of ours. Try Safari's per-site Microphone: Allow; WebKit bug 280394 tracks the rest.
---
# The iPhone home-screen app asks for the microphone again

Report `spya-btjtbb` (SPIDERYARN-READING2-EN), a suggestion from Greg (an admin, proven by
`scripts/feedback-reporter.ts` exit 0), filed 2026-10-08 07:16 UTC from the home-screen app on
`2608-13566v1-spya-yurten`. Overseer queue item `qi-t6tn7q4y`, session
`fbbtjtbb-dictation-mic-grant-double-tap`, batched with part 2 of `spya-pd9fnc`
([its note](261008_0732-dictation-button-holds-still-for-a-double-tap.md)). A repeat of
`spya-y8va9d` ([its note](260908_1745-microphone-permission-asked-twice-on-iphone.md)).

> I have Spidey on on my phone. I've shared it to my home screen. Every time I try and use the
> microphone voice dictation button, for example in a feedback report, after having opened it, it
> asks me for permission. Is there any way to get it to remember that I've given permission for the
> microphone?
>
> Use Sonnet for web research.

**Ending: shipped** (one fix, and the answer). On `dev`, not deployed. The next feedback sweep
should mark the Sentry issue `resolved`; this session has no Sentry sign-in.

## The answer

Researched afresh by two Sonnet subagents (WebKit's source, and the web), as asked.

**Mostly, a web page cannot make an iPhone remember.** WebKit keeps a microphone grant in memory
for the page only. A home-screen app loses it whenever iOS restarts or reloads the app, and WebKit
wipes it 10 minutes after the microphone was last in use. So you should see a prompt on the first
press after opening the app, and on any press more than 10 minutes after your last dictation, but
not in between. Apple has not built a way to keep it: that is
[WebKit bug 280394](https://bugs.webkit.org/show_bug.cgi?id=280394), open, with a comment saying it
worked up to iOS 26.2 and stopped around 26.3.1. Adding your iOS version there is the one lever left.

**One extra prompt was ours, and is fixed.** When you have picked a microphone (your AirPods), and
its id had changed, which happened to you on every press in September, our first request failed
silently and used up the tap's one "you pressed a button" permission. The second request then
looked to the iPhone as if nothing had been pressed, and was prompted whenever the last dictation
was more than a minute ago instead of ten. We now check the list of microphones first and ask for
the right one once.

**What we did not do:** keep the microphone running between dictations so the 10 minutes never
start. It would mean a live microphone and the orange dot while you are not dictating, and it would
still not survive a restart.

**Two things to try on the phone** (neither is documented to help a home-screen app):
Settings → Apps → Safari → Settings for Websites → Microphone → Allow; or use Spideryarn in a
Safari tab, which does honour that setting.

Plan, the WebKit source reading, and the evidence:
[261008d](../plans/261008d-dictation-button-holds-still-and-why-the-iphone-asks-again.md). Not
tried on a real iPhone; the box has none.
