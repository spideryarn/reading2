---
reports: spya-f3b6ab
ending: shipped
---
# Editing an earlier Recall message gave no reply

Report `spya-f3b6ab`, a problem, from Greg (admin), filed 2026-10-01T18:41:50Z on production,
relayed by the Overseer with no Sentry mirror, on
`https://www.spideryarn.com/read/melnikoff-bargh-2018-mythical-number-2-0-spya-bucuzj?at=spya-v0y284&mode=remember&summary=brief&thread=spya-jxcxj7`:

> I tried editing a previous message in Recall mode, hoping that it would then trigger a response to
> that modified message, but it didn't.

**Ending: Shipped** — but honestly: **the reported bug did not reproduce**, and what shipped is the
fix for the one candidate cause the hunt found. Postmortem
[261002g](../postmortems/261002g-a-refusal-with-no-voice.md); plan
[261002i](../plans/261002i-one-adaptive-recall-and-a-tutorial-sub-mode-for-remember.md), stage 1.

Tried and working: editing in jsdom with the real Remember band, the server against Postgres with
the client's exact edit body, and a real browser (tick and Enter, first and last message, after
Start over and after a reload). The thread in the report was deleted by a Start over three minutes
later, and the feedback row carried no diagnostics. The candidate: while an answer was still
arriving, Enter in the editor did nothing and the tick only greyed out, with no word of why. Now the
editor says *"An answer is still arriving. Ask again once it has finished — your rewrite is kept."*
If it happens again, the URL, whether Enter or the tick was pressed, and whether an answer was still
arriving would settle it.
