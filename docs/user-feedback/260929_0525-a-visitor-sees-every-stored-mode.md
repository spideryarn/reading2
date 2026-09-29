# A visitor sees every stored mode on a public article

SPIDERYARN-READING2-56, from Greg (admin), in production, build `070a2503`, 2026-09-29 04:27:05Z,
article `bf03197835-spya-qfwsw2`. The time in the file name is when this session received the report
from the Overseer; it could not read Sentry.

> I tried to open this in an incognito window:
> https://www.spideryarn.com/read/bf03197835-spya-qfwsw2?mode=trajectory&deep=2
> but I got this message:
> """
> Trajectory is for whoever added this article — asking costs a model call, and a shared link spends
> nobody's money. Make a free account to read your own articles this way.
> """
> It's a public article, and the Trajectory has already been generated, so it should show it. I think
> this should be true for all modes - they're available to non-logged-in users if the article is
> public AND they have been generated AND it doesn't incur extra costs to run (e.g. Chat is never
> available to non-logged-in users).

**Ending: Shipped** — on `dev`, not deployed. Resolve 56 (the next feedback sweep does the Sentry
status write).

What we did: on a public article, someone who isn't signed in now sees the stored **Trajectory**,
**FAQ**, **Citations** and **Debate**, read from the page itself. Nothing they can press or link to
can start a model call. Where nothing has been generated yet, they are told so, rather than told it
costs money.

What they still don't get, and why:

- **Chat** — it's all model calls, and it's your own conversation.
- **Remember** — Recall is your own answers. Quiz is left out, as you allowed: showing it read-only
  wasn't small, because Quiz is half of the Remember mode rather than a mode of its own.
- **Referee** — your own criteria and marks.
- **Diagram's Illustrated pictures** — a follow-up. Showing them needs a new public route for the
  image files. The Sketch is already shown.
- **Citations' *Find it* results** — they record what you searched for, so they stay yours.

Addresses are checked on the way out: a link to a cited work, or to a Debate source, that carries a
password or points at a private address is dropped. A Debate row that would reveal the article's own
private address is dropped too, and the page says how many were held back.

Plan: [260929c](../plans/260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md).
Postmortem: [260929a](../postmortems/260929a-one-policy-row-decided-who-may-make-a-mode-and-who-may-see-it.md)
— one policy decided both who may *make* a mode's output and who may *see* it.
