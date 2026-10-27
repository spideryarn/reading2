---
reports: spya-ez2vus
ending: shipped
comment: Code now lists author-year citations the model left out (79 of LeCun's 82 missed). The model-side fix waits for model calls after 1 Nov (queued), and one question for you on where those rows sort.
---
# Citations missed in long articles

Greg, admin, 2026-10-26, on LeCun's *A Path Towards Autonomous Machine Intelligence*
(`10356-a-path-towards-autonomous-mach-spya-jwqnrf`, at `spya-g2afnv`):

> Why didn't it notice the citation for Levine 2021 in this paragraph? I feel like citations often
> seem to miss stuff.

**Shipped** to `dev`: plan
[261027b](../plans/261027b-citations-missed-in-the-text-filled-by-code.md).

- **Why Levine was missed:** the model returned 23 of the paper's 105 works with `capped: false`;
  production's log line shows no stage dropped anything, and no check could see the shortfall.
  A second fault on the same run: the appendix's Table 1 was sent to the model as the article's
  numbered reference list. Postmortem
  [261027a](../postmortems/261027a-citations-model-under-returned-with-no-witness.md).
- **How often:** close to complete up to ~70 works, 22–28% past 100 —
  [investigation 261027a](../investigations/261027a-how-often-citations-are-missed.md).
- **Fixed:** code reads author–year citations and adds a row for each one the model left out (79 of
  LeCun's 82 missed works, no false ones); the bogus reference list is refused; the step's log line
  now counts both.
- **Deferred**, queue `qi-mf9r5hjk`: the model's own recall (a checklist prompt, splitting long
  articles, footnoted articles such as Wikipedia's), which needs model calls after 2026-11-01, and
  making LeCun's list again.
- **Asked:** [q-knkbsk](questions/q-knkbsk.md), where code's rows sit in the prioritised order.
