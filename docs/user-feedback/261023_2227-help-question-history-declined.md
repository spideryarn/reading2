---
reports: spya-jyjph5
ending: declined
comment: Not built, for now. Nothing about a Help question is stored today, and the privacy page promises so. A history needs a new table, saved answers, a dated list and a reworded privacy page: about a day's work. The plan has the outline.
---
# A history of your own Help questions: declined for now, with its cost

Report #681 `spya-jyjph5` (SPIDERYARN-READING2-ND), a suggestion from Greg (`feedback-reporter.ts` exit 0, no addenda when
re-read before this note), filed 2026-10-23 22:27 UTC from `/help` (build `db758ed8`). Session
`fbp8h7r3-help-input-and-history`, with its sibling
[261023_2226](261023_2226-help-box-grows-with-its-words.md).

> It might be nice to be able to see previous questions I've asked of the help. I don't think this
> is super important though, so if it adds a lot of complexity, then we can skip it. But in an ideal
> world, the help would have a sort of, I don't know, a tab or something for previous questions, and
> obviously their answers as well. And obviously, you know, each user would only be able to see
> their own. And it would have to show the date as well.

**Declined for now**, on the condition Greg set. The costing is in
[261024e § #681](../plans/261024e-help-box-grows-with-its-words-and-a-costed-history.md#681-a-history-of-your-questions-not-built-and-why),
checked by GPT Sol, who agreed the decline is fair. In short:

- **Nothing is stored that could show a history.** The question and the answer are neither stored
  nor logged; only who asked and when (a rate-limit row, swept later) and the call's cost are kept.
  **The public privacy page promises it**: *"the question is not kept, and is not written to our
  logs"*.
- **It would take**: a table and migration, the store's plumbing, a save that copes with a Stop
  (which today ends the stream with no final answer to save), a read route, a *Your questions*
  list on `/help` with dates, ideally a delete, and the privacy page, its test and three docs
  reworded. Around a dozen files and two product choices (how long to keep them; what an
  interrupted answer saves). About a day of agent work with its reviews.
- Keeping them in the browser instead was passed over: per-device, not per-reader, and the privacy
  page would still change.
