---
reports: spya-z6daky
ending: shipped
---
# The quiz seemed to give up writing its questions after a switch of mode

`spya-z6daky`, `kind=problem`, 2026-09-03 02:53Z, from Greg (admin), on
`/read/nagel-bat?mode=remember&remember=quiz` in production. The Sentry mirror never acknowledged it,
so it has no Sentry issue. It never got a note either, so the Earlier tab showed it as not shipped.
The words below were read from its row in production on 2026-10-01.

> I was in Remember / Quiz mode
> (https://www.spideryarn.com/read/nagel-bat?mode=remember&crits=spya-u76kr8,spya-qp5qpn&at=spya-g2xes4&diagram=sketch&runs=spya-s2hmtu&order=prioritised&conf=3&remember=quiz&rank=prioritised&bar=0.90
> ), asked it to write the questions (it started generating, with a timer), then switched over to
> another mode, then switched back to Remember/Quiz mode, and it seemed to have given up on
> generating (and was showing the "Write questions" button again as though the generation had
> somehow aborted.

**Ending: Shipped**, 2026-09-03, and deployed since.

The switch was not the cause: the build failed. The Vercel logs show the job failing after 36
seconds while Greg was in the other mode. The quiz had refused a batch because it was one "hard"
question short of a proportion. The panel then showed the ordinary button again. What we did:

- The quiz now accepts a batch that has at least one question at each end of the scale, rather than
  a proportion of each (`e560757d`).
- A failed step now shows the reader a sentence written for them, not the internal error text
  (`46439f1c`).

The plan was written from the logs, because the report's text could not be read at the time:
[260903c](../plans/260903c-fix-quiz-build-band-spread-failure-and-lost-quiz-answers.md).
