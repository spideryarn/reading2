---
reports: spya-jew7ds
ending: shipped
---
# Does the reading-time estimate know how hard the piece is?

`spya-jew7ds`, from Greg (admin; relayed by the Overseer as his own report), filed 2026-10-04 20:42
UTC from Structure on *The Order of Time*. Sentry confirmed it (event
`034594aba7524cdc899fcf478309aca5`). This session did not write the Sentry status; the next feedback
sweep does.

> We estimate the number of minutes to read. Does this take into account the difficulty? I think the
> old_version of Spideryarn had some logic along these lines, though maybe it was too simplistic (and
> maybe it should be something the LLM returns as part of the input process). For example, this Carlo
> Rovelli book uses fairly simple language for complex ideas, so our difficulty ratings should take
> into account both dimensions. And also perhaps the user's profile.
>
> Use Sonnet for web research, and to see how we did it in old_version (and the research we did for
> that).
>
> Create a rich tooltip that explains the estimate of reading time, reused both at the top of article
> and in Metadata.

**Ending: Shipped.** It is on `dev` and not deployed.

What we did:

- **The answer to the question is no**, and the card now says so. The estimate is body words at a
  flat rate.
- **The rich tooltip**, one component in both places: the masthead's `~22 min` and Metadata's *Read
  time* tile. It gives the words, the rate, the range most adults fall in, what the estimate cannot
  see, and the notes it left out.
- **The rate is 238 words a minute, not 230**, with its source (Brysbaert 2019).
- **The research** is written up:
  [261005a](../research/261005a-reading-time-estimates-and-text-difficulty.md). The old version's
  code is on Greg's Mac only, so that half rests on our earlier digest of it.

**Deferred, and Greg's to choose**: making the number itself depend on difficulty. There is a
published one-line formula from word length, which needs a stored letter count per article and
cannot see hard ideas in plain words; and there is a model rating at import, which could, and has
not been checked against reading time on our articles. It went to Greg as a question in this
session's debrief, and the Overseer was asked to queue it under this report's id (the queue takes
entries only from Greg or the Overseer, so this session could not add it itself).

Plan: [261005c](../plans/261005c-reading-time-estimate-says-its-rate-its-range-and-what-it-does-not-know.md).
