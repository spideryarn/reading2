---
reports: spya-sutes9
ending: shipped
---
# A long book's hierarchy survives one bad answer

Sentry `SPIDERYARN-READING2-93`, report `spya-sutes9`, from Greg (provenance checked with
`scripts/feedback-reporter.ts`: the production row is an administrator's), 2026-10-01, on an
upload of *The Order of Time* (4.2 MB, 1,041 blocks):

> Can you investigate why the first improt of the Order of Time PDF failed a few minutes ago? I'm
> trying again, dunno if it will help.
>
> It is long, but I was hoping that we'd figured out ways to scale everything... :~ If you see a
> clean, general, robust, root cause fix, go for it. If fixing it will involve tradeoffs or a lot of
> complexity, stop and let's discuss.

**Ending: Shipped**, on `dev`. The plan, with Sol's two reviews, is
[261001s](../plans/261001s-fb93-long-pdf-hierarchy-asks-again.md), and the class is written up in
the postmortem
[261002a](../postmortems/261002a-a-long-answer-thrown-away-for-one-local-fault.md).

What was wrong, in plain words: the whole book's structure comes back from one model call as one
~25,000-character answer, and one small slip anywhere in it threw the whole answer away. Greg's two
attempts slipped in two different places: a section with no range, and a bracket closed in the wrong
order three characters from the end. Retry just drew another answer with the same odds.

What changed: a section with no range is now worked out from its neighbours, as a misplaced boundary
already was. An answer that still can't become a tree is asked for once more inside the same step,
if the time limit allows. The step makes at most two calls, and both counts are logged.

Not done, and named in the plan: building a book's tree a section at a time (the cascade, which is
built but switched off), keeping refused answers so the next fault can be seen rather than inferred
(a privacy call for Greg), and repairing broken JSON. His import was not re-run on production; it
should go through on a Retry after the next deploy.
