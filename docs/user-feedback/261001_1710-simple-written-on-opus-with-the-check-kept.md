---
reports: none
ending: shipped
---
# Simple is written on Opus, with the fidelity check kept

Not from a reader. The Overseer dispatched it after Greg answered [Q-simple-opus-test], 2026-10-01:
*"A yes and then make your own judgment about what's best, proceed autonomously"*. The question was
whether a bigger model, with or without Simple's fidelity check, would beat Sonnet with the check.
There is no Sentry id. The time in the file name is when this session received the brief.

**Ending: Shipped.** On `dev` in ef04cfd5, merged as 2a573770. The implementation and evidence are in
[261001p](../plans/261001p-simple-on-opus-with-and-without-the-fidelity-guard.md). Not deployed: the
Overseer deploys. There is no Sentry issue to resolve.

Measured with the check off, on the PID paper where Sonnet calls the recurrent connections
"feedback loops": Sonnet swapped the terms in 5 levels of 18 and Opus in none of 36. A blind read
by GPT Sol found 3 major faults in 27 Sonnet levels and none in 27 Opus ones. Opus still made one
real fault on Gwern that only the check caught, so the check stays. It now fires on about one PID
press in six rather than five in six, which removes most of the ~15 s retry. Cost per press goes from
about $0.05 to $0.10 (warm cache), and the writer takes about 2.5 s longer on an ordinary press.
Simple is now Opus for every article, so the High-powered AI switch no longer changes it, and the
switch's copy says so. Reversing it is one line, `ALWAYS_HIGH_POWER` in `src/models.ts`.
