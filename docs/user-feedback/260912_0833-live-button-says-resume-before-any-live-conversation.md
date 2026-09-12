# The Live button says "Resume" before any live conversation has happened

[SPIDERYARN-READING2-3G](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3G) (2026-09-12
08:33 UTC, `kind=suggestion`), from an admin, on an iPad in production, build `607b57a0`, in chat on
`entropy-24-00930-spya-bmvfyb`.

> I'm looking at a chat that I just had, and there's been a couple of messages, and I was thinking about
> using the real-time conversation for it. There is a real-time button. I can see the icon for it, but the
> icon text says resume, which seems weird because I'm assuming that if I had to click that, it would be a
> real-time conversation about this conversation thread, and it would be the first time I've had a
> real-time conversation about this thread. So I don't know, that icon text should say something like
> real-time or similar.

**Ending: Shipped** — on `dev`, not deployed. Resolve 3G.

What we did: the button said **Resume** on any thread with a message in it, typed or spoken; it was
never a test for an earlier live call. It now reads **Live**
in every idle state, and says what the click does in its accessible name and tooltip: "Continue this
conversation live" on a thread with messages, "Start a live conversation" otherwise.
[260912d-live-button-label-says-resume-on-a-thread-with-no-live-history.md](../plans/260912d-live-button-label-says-resume-on-a-thread-with-no-live-history.md).
