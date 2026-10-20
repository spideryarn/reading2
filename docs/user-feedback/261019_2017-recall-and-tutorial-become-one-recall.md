---
reports: spya-gtzeqm
ending: shipped
comment: Recall now does both, and Learn has three parts. It kept the name Recall; if you'd rather the chip said Tutorial, that is only a label change.
---

# Recall and Tutorial become one Recall

Report `spya-gtzeqm` (#636, SPIDERYARN-READING2-M1), suggestion, from an admin, 2026-10-19:

> Can we collapse Recall and Tutorial to get the best of both worlds (and reduce the number of
> sub-modes)?

**Ending: shipped**, on `dev`, not yet deployed.

Learn's chips are now **Recall · Explore · Quiz**. Recall keeps what it had: corrections, nudges,
the Hint button and Live. It also does what Tutorial did. A reader who hasn't read the piece starts
from zero, is never asked what they "remember", and is taught one small cited piece at a time, each
followed by a task. Old `?learn=tutorial` links open Recall. The migration appends each Tutorial
conversation to that article's Recall conversation, so nothing a reader wrote is lost. Production
has 2 Tutorial conversations, and one article has both.

Plan, with both GPT Sol reviews:
[261020m](../plans/261020m-recall-and-tutorial-become-one-recall.md). Measurements:
[261020c](../investigations/261020c-merged-recall-prompt-against-recall-and-tutorial-evals.md).
