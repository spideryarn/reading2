---
reports: spya-kzdmhb
ending: shipped
---
# The live conversation kept hanging, on a phone, outdoors with headphones

[SPIDERYARN-READING2-42](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-42) (2026-09-12
16:39 UTC, `kind=problem`), from an admin, on a phone in production, build `c9ab99b1`, in chat on
`entropy-24-00930-spya-bmvfyb` (thread `spya-uwhuwv`).

> I tried using the live real-time conversation in a chat. I'm on my phone walking down the street
> with sort of fancy headphones that are usually pretty good at cancelling out noise in the
> microphone, I don't know. And the real-time live conversation just kept kind of hanging,
> unexpected.

**Ending: Shipped** — on `dev`, not deployed. Resolve 42.

What we did: no production logs were reachable from the run, so we diagnosed from the code. We found
five ways a session could get stuck while the page still said "Listening" or "Thinking" and showed
nothing wrong:

- the phone muted the microphone (screen lock, a Bluetooth switch);
- the connection wobbled;
- street noise held the reader's turn open;
- a reply was owed and never started;
- the phone paused the voice.

Each one now shows a plain sentence in the Chat panel with a **Reconnect** button. Reconnect ends the
call, keeps what was said, and starts a fresh call in the same conversation. The button is there
whenever a call is live. The first time a stall lasts five seconds in a session, it now sends a Sentry
event with counts, no words, so the next report can say which one happened.
[260915b-live-conversation-stalls-visible-and-recoverable.md](../plans/260915b-live-conversation-stalls-visible-and-recoverable.md).

**Left for Greg:** making street noise harmless rather than just visible is a change to how the
conversation behaves, so it was not built. There are three ways, and any of them can be combined:

- a "noisy place" setting that is harder to trigger;
- stopping background sound from cutting the companion off mid-sentence;
- push-to-talk, where you hold a button while you speak.

The plan's § Not built describes each one.

**Decided 2026-09-24, on Greg's delegated judgment: wait for data.** None of the three changes is
built, because each alters every live conversation and the first Sentry `LiveStall-*` events will say
whether street noise is the stall that actually happens; revisit when they arrive.

**The data, 2026-10-03, and the second half shipped** (queue item `qi-8k6vjbzz`). There have been
five live sessions in production since then, all yours, and one `LiveStall` event:
[SPIDERYARN-READING2-6Y](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-6Y), `open-turn`.
On 2026-09-30 the first turn of a call opened two seconds in and was still open 74 seconds later,
when you hung up. A test against OpenAI's real server reproduced it. Traffic rumble alone does
nothing, because noise reduction removes it. **Other people's voices** are the problem: the
companion answered a bystander, was cut off by the next one, and then held the turn open for as long
as they kept talking.

So the "noise is holding your turn open" notice now offers **Tap to talk** beside Reconnect. For the
rest of that call you tap **Talk**, speak, and tap **Done**. Nothing is heard in between, so voices
around you can neither hold your turn open nor cut the reply off. It is the push-to-talk option
above, but tap rather than hold, and only for a call that has just shown the problem. Every other
live conversation is unchanged.
[261003d-tap-to-talk-when-noise-holds-the-live-turn-open.md](../plans/261003d-tap-to-talk-when-noise-holds-the-live-turn-open.md).

What only your phone can check is the real WebRTC audio, in a street, with those headphones. The
notice takes 30 seconds of held-open turn to appear.
