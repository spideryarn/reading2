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
