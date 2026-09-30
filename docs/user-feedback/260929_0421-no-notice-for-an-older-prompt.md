---
reports: spya-n3t8v5
ending: shipped
---
# No notice when a mode was made by an older prompt

[SPIDERYARN-READING2-55](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-55) (2026-09-29
04:21 UTC), from an admin (Greg), in production, in Trajectory.

> I'm seeing "This route was planned by an older version of the prompt. Plan it again". Maybe provide a x for me to hide that. Or perhaps even don't bother showing it. There are probably lots of cases where the prompt will get out of date, and it's not worth bugging the user about it.

**Ending: Shipped** — on `dev`. The next feedback sweep does the Sentry status write.

Your last thought, taken: the "…by an older version of the prompt" notice and its redo button are
gone from every mode that had one — Trajectory, Ideas, Timeline, Debate, Quiz, Quotes, Glossary,
Citations and FAQ. Two notices stay, because they can mean the result is now wrong rather than just
dated: **the article changed** under it, and **your profile changed**. Re-running lives in Metadata
(report 53); FAQ and Citations gained rows there, since the notice had been their only way to be
made again.

One thing you might notice: on a list made by an older prompt, Glossary and Quotes do not offer
*Find more* — there it would replace the list rather than add to it. Re-running in Metadata brings it
back.

Plan: [260929c](../plans/260929c-no-notice-when-a-mode-was-made-by-an-older-prompt.md).
