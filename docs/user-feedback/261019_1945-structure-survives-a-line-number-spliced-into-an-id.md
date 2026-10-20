---
reports: spya-c09nnb, spya-e2vxrw
ending: shipped
comment: One cause for both. The model copied a line number into a section's id, and that one slip threw away the whole Structure, so every mode refused. Now the slip is read as its line, and a bad section is folded into its neighbour.
---
# Structure survives a line number spliced into an id

`spya-c09nnb` (#627, problem, SPIDERYARN-READING2-KP) and `spya-e2vxrw` (#628, problem,
SPIDERYARN-READING2-KQ), both from Greg (admin; `feedback-reporter.ts` exit 0 on both production
rows), filed 2026-10-19 19:45 and 19:47 UTC from `https://www.spideryarn.com/`, build 8e1fd75a.
Queue item `qi-emc5tnty`. Addenda: none.

> A new user (Adrian de Froment) just imported an article - why didn't it auto-generate standard
> stuff, e.g. highlighted-quotes?

> Why didn't the Structure finish building for the article that Adrian just imported? You can read
> the production database.

**Ending: shipped**, on `dev`, not deployed. Plan, evidence and the three GPT Sol reviews:
[261019l](../plans/261019l-structure-recovers-a-start-that-splices-the-line-number-into-the-id.md).
Postmortem:
[261019d](../postmortems/261019d-a-line-number-spliced-into-a-block-id-cost-the-whole-tree.md).

## What we found

Production was only read: the jobs, `ai_calls`, checkpoints, revision blocks, and Vercel's logs.

- **One cause for both reports.** The article was a 648-block PDF. Its full Structure failed three
  times (19:41 on arrival, then two presses of Retry), at about $0.58 each. Quotes, Ideas, Simple,
  Tweets and Bibliography then each refused in under 15 ms with "the structure of this article has
  not been built yet". A fourth Retry at 20:04 succeeded, and every one of those modes generated
  itself within three minutes.
- **Why Structure failed.** The prompt shows each block as `[582] spya-xcf0dz <h1>: …`. Running at
  effort `low` with a JSON schema, the model does no thinking at all. Sometimes it splices the
  line number into the id (`spya-582xcf0dz`), and one start that named no block refused the whole
  answer. I re-sent the exact production request four times, and all four answers had such a
  start.
- **It is not just this article.** 5 of 28 production Structure jobs since 2026-10-03 needed the
  step's in-built re-ask.

## What we did

- A first child's start is no longer checked, because its parent's start is used regardless.
- A spliced line number is read as that line, provided the digits split only one way and the
  line falls between the section's neighbours.
- Any other bad start still refuses the first answer, so the step asks once more. On the last
  answer, that section is folded into the one before it, which keeps the tree. This only applies
  while each sibling set keeps two children and no more than one start in ten is lost.
- `startsRecovered` and `startsDropped` are now on the step's log line.
- Checked on the real answers: all four would now build, two of them with nothing lost. Today's
  code refuses all four.
- **Queued, not built:**
  - `qi-vcsypqem`: change the prompt so it stops inviting the splice. That needs the structure
    eval.
  - `qi-vpc3zecf` (needs Greg): should modes run over the headings-first outline when the full
    Structure fails?
