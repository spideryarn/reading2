---
reports: spya-azft06, spya-qzsvx4
ending: shipped
---
# Summary: a longer Fuller, and bold and bullets to skim by

Two suggestions from Greg, filed a minute apart from the Feedback button on 2026-10-03 while reading
`we-must-pace-the-frontier-spya-qhda2b` in Summary's Fuller view, and checked as an admin's
(`feedback-reporter.ts` exit 0, by the sweep). SPIDERYARN-READING2-BC and -BD; Overseer queue item
`qi-pev956hc`. One note, because both change the same prompt and were built together.

> I think we want the most detailed submode of Summary to be longer and more detailed still. (I
> think it's called fuller.)
>
> — Greg, 2026-10-03 (`spya-azft06`, SPIDERYARN-READING2-BC)

> Maybe, maybe the summary submodes could make use of Markdown, like bold or bullet points, to make
> it easier to skim the summary. I suppose it's possible they could use headings, but that might be
> overkill. That could be interesting. Experiment with it.
>
> — Greg, 2026-10-03 (`spya-qzsvx4`, SPIDERYARN-READING2-BD)

## What we did

Plan and reviews: [261004b](../plans/261004b-summary-fuller-longer-and-bold-and-bullets.md). The
measurements, with the before and after text for three articles:
[261004a](../investigations/261004a-summary-fuller-longer-and-bold-and-bullets-prompt-eval.md).
What is built is in [summaries.md](../project/summaries.md).

- **`spya-azft06`, shipped, at a smaller step than first built.** Fuller is about half as long again:
  a median of 374 words where it was 254, with the room spent on how the work was done, the numbers
  behind each finding and the limits the piece names. Twice as long was built and read well, but it
  doubled the wait for the whole summary (55 s against 26 s), because Brief is not shown until Fuller
  is written. **The longer version is queued as `qi-nec8qqzc`**, with the change that would make it
  affordable (show Brief as soon as it is written), and waits on Greg's answer to
  Q-summary-fuller-length in the investigation.
- **`spya-qzsvx4`, shipped as an experiment to look at.** Brief and Fuller have a few key phrases in
  bold, and Fuller can draw a paragraph as a bulleted list. Each bullet is still one sentence, so it
  still links to its passage and lights up with it. No headings. Whether to keep both, one or
  neither is Q-summary-format-keep in the investigation.

Summaries already written keep their text until somebody presses *Write it again*.
