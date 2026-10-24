---
reports: spya-rvj2p7
ending: shipped
comment: Shipped: a short article whose suggested links all pointed at the next paragraph no longer fails; the step is now called "Adding cross-references", and a failed extra says the article is unchanged.
---
# Cross-references failed a short article, and said so confusingly

Greg (admin, `feedback-reporter.ts` exit 0), 2026-10-23 22:35 UTC, a problem filed from
`https://www.spideryarn.com/` with *Report this* on a failed job card. Feedback row #684; Sentry
`SPIDERYARN-READING2-NG` (event `ae908f6aeb8f41fbbd35ead4ce382d25`). Session
`fbrvj2p7-crossrefs-failure-wording`. No addenda when re-read before building, or before this note.

> This import failed.
>
> Job: spya-dqbje9
> Article: effective-expressiveness-spya-z8dehh
> Status: error
> Failed at step: crossrefs
> Error: Linking the article to itself did not finish. […] [jb-step-again]
> […]
> I have no idea what that error means, and the article seemed to work, so it's just a very
> confusing message.

## What went wrong

Read-only, from Vercel's runtime log for the job: the article is short (9 paragraphs, 486 words), and
the import had finished fine. The cross-references job that the import queues afterwards asked the
model for links; it offered three, all to the paragraph right next door, and the rule that drops
those dropped all three. The step treated "every link dropped" as a failed answer and threw, so the
card showed a failure — named *Linking the article to itself* — and *Report this* called it a failed
import, though the article was untouched.

## What we did

[261024c](../plans/261024c-a-failed-optional-step-after-import-reads-as-optional-and-crossrefs-keeps-an-all-nearby-answer-as-empty.md),
with the postmortem
[261024a](../postmortems/261024a-a-guard-against-an-emptied-answer-must-ask-which-rule-emptied-it.md):

- **The cause.** An answer whose every link pointed at its own or the next paragraph is now kept as
  "no cross-references", which is what it means. Any other way of losing every link still fails, so
  a broken answer is not published as an empty one.
- **The name.** The step is now *Adding cross-references*, the name Metadata already used.
- **The card.** A failed job made only of the extras an import queues afterwards (glossary,
  quotes, ideas, summary levels, skim, bibliography, cross-references) now says *"The article itself is unchanged. Only this extra
  did not finish."* An import's failure still says nothing of the kind.
- **The report.** *Report this* on a job that was not an import now opens on *"This job failed."*

GPT Sol reviewed the plan and the code; its plan review narrowed both the cause fix and the card
sentence, and the plan says how.

This article's cross-references were not re-run: nothing was written to production. Re-running them
from Metadata's *AI processing* once this is deployed will finish with no links, as it should.
