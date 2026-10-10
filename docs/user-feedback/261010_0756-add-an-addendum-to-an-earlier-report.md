---
reports: spya-saz0yw
ending: shipped
---
# Add an addendum to an earlier open report

An admin report from Greg (`feedback-reporter.ts` exit 0), `spya-saz0yw` (#541,
`SPIDERYARN-READING2-GP`), a suggestion filed 2026-10-10 07:56 UTC from `/changelog#release-151`
(build `29220e7d`). Overseer queue item `qi-7n9nyz3k`.

> Make it possible for me to add a reply as a kind of addendum to any earlier open feedback reports.
>
> — Greg, 2026-10-10 (`spya-saz0yw`)

**Shipped** on `dev`, live with the next deploy (which also applies the additive migration that
creates `feedback_addenda`). In the Feedback dialog's Earlier tab, each of an admin's own reports
that is *Open* or *Needs a decision* has **Add to this report**: a box like the reply box, with its
own microphone. What is added shows under the report's words. Agents see it too:
`feedback-reporter.ts` and `feedback-unswept.ts --show` print it with the report, and
`feedback-unswept.ts` lists any addendum written after its report was taken until a note or queue
item covers it. Beyond what was asked, and not built: addenda for readers other than an admin, and
showing them on `/admin/feedback`.

Plan, both GPT Sol reviews and the deviations:
[261010o](../plans/261010o-addendum-to-an-earlier-feedback-report.md). The app's side:
[feedback.md § Adding to an earlier report](../project/feedback.md#adding-to-an-earlier-report-since-2026-10-10);
the sweep's: [feedback-reports.md § An addendum to a report already taken](../project/feedback-reports.md#an-addendum-to-a-report-already-taken).
