---
reports: spya-ayajv6, spya-u3dgk7
ending: shipped
---
# Marginalia: relation words (so, but, vs) and Timeline events in the margin

The rest of two suggestions from Greg, both checked as his with `feedback-reporter.ts` (exit 0), so
trusted and built. Overseer queue item `qi-cbnydm7c`, raised by the
[2026-10-02 re-check](261002-recheck-all-reports.md): an
[earlier note](260930_2311-annotations-mode-marginalia-in-a-right-hand-column.md) shipped the
column and named these two pieces as not done, and nothing had picked them up.

> include the "relation-words", e.g. BUT, SO
>
> — Greg, 2026-09-30 (`spya-u3dgk7`, SPIDERYARN-READING2-7E)

> it should almost entirely be reusing existing stuff that we've already generated from quotes and
> ideas and timeline and summary and... Maybe FAQ and other stuff that I haven't thought of
>
> — Greg, 2026-09-29 (`spya-ayajv6`)

## What we did

Plan, reviews and evidence: [261003f](../plans/261003f-marginalia-relation-words-and-timeline-events.md).
What is built is in [marginalia.md](../project/marginalia.md).

- **Relation words.** A small-caps word beside a paragraph where the argument turns: *so* (it
  draws its conclusion from the one before), *but* (it pushes back), *vs* (it sets something against
  it). Press or hover the word for the sentence. A new `relations` step reads the article once and
  classes every paragraph into one of ten relations; three are drawn, so the column stays sparse
  (12 words on a 75-paragraph article), and drawing more later costs no model call.
- **It is the one thing Marginalia generates.** The press that turns the column on asks for it,
  once. A reload, Back or a pasted `?margin=1` link spends nothing. About 4 cents and 14 seconds on
  a 4,000-word article; the words appear when the job finishes.
- **Timeline events in the margin**, shut like FAQ and Debate: the date (always with its year) or
  the article's own phrase for when, then the event. Only events the piece dates, beside the
  passage that dates them. Nothing is generated for this: it shows once Timeline has been run.

## What Greg should know

- **The words are the AI's reading and will sometimes be weak.** A browser check read six against
  their paragraphs: four fair, two a stretch. The card says who wrote it.
- **Owner only for now.** A visitor to a shared article does not see relation words. A visitor's
  copy cannot yet tell that an artefact is out of date, and a single word cannot be checked against
  its paragraph the way a quote can.
- **It needs a database migration** (one new nullable column, additive). It is applied on the box's
  local database; production gets it at the next deploy.
- **Which words are drawn is one line to change.** GPT Sol argued for only *but* and *vs*; *so*
  stayed because Greg named it. *Why* and *e.g.* are stored and not drawn.

## Left alone, on purpose

- **Opening Marginalia does not run other modes** (FAQ, Timeline and so on). Decided earlier:
  [marginalia.md § What it shows](../project/marginalia.md#what-it-shows).
- **Dashed underlines for ideas in the prose**: still deferred. The margin stamp already carries
  the idea, and a second kind of mark inside the author's text has a cost.
- **Automatic ask-for-help comments**: still declined. It would spend and write into the reader's
  comments unasked.

## Two wider things the code review found, not fixed here

For the Overseer's queue; neither is caused by this work.

1. **After a change of model, a press can be spent on nothing.** The artefact GETs for Ideas,
   Timeline, FAQ and others call an artefact current when the pipeline would call it outdated, so
   the band shows the old list and the press does not start a run. Fixed for relations only
   (`isOutdated` in `src/relations.ts` is the shape).
2. **`HOMES` in `tests/store-artefact-manifest.test.ts` omits several older artefact files**
   (`faq.json`, `citations.json`, `skim.json`, `crossrefs.json`, `simple-summary.json`).

Commits: `2f068a1d6` (Timeline in the margin), `18eaf5951` (relation words and the step), and the
commit carrying this note (GPT Sol's code-review fixes).
