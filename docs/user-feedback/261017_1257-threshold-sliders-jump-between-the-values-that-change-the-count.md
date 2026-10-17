---
reports: spya-t80rep
ending: shipped
---
# Threshold sliders jump between the values that change the count

`spya-t80rep` (#588, Sentry SPIDERYARN-READING2-J9, queue item `qi-krmaq39d`), a suggestion from
Greg (admin; `feedback-reporter.ts` exit 0 on the production row; addenda: none), filed
2026-10-17 12:57 UTC from `/read/arxiv-2609-16247-spya-y0kw0z?mode=search…&conf=71`. This session
had no Sentry sign-in and did not write the Sentry status; the next feedback sweep does.

> For the UI threshold slides (e.g. Search, Glossary, etc), could we somehow subtly indicate where
> changing the threshold will change the number of results? And perhaps even jump between those
> steps. Because changing the threshold value when it has no effect on the number that pass the
> filter isn't that helpful. I'd rather that, as I slide it, it jumps to the values that will affect
> the number of results shown. And/or little visual ticks on the slider that show where within the
> spectrum such thresholds are.

**Ending: Shipped** on `dev`, not deployed. Both halves. Every numeric threshold slider (Search,
Glossary, Citations, FAQ, Quotes) now goes through one shared control. A drag or a tap lands on
the nearest value that changes the count. An arrow key, PageUp/PageDown or Home/End goes to the
next value that does. A faint tick under the track marks each of those values, at its real place on
the scale. Quotes already jumped, but its stops were evenly spaced; it now uses the same scale and
ticks. Reception's word levels are unchanged. Plan and both GPT Sol reviews:
[261017f](../plans/261017f-threshold-sliders-jump-between-the-values-that-change-the-count.md).
