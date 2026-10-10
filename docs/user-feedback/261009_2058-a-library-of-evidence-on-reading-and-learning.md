---
reports: spya-gsw9bh
ending: shipped
comment: The library, digest and tutorial are on dev. The fifteen product ideas it surfaced are proposals in the Overseer's queue, waiting on you.
---
# A library of evidence on reading and learning, with a digest and a tutorial

An admin suggestion from Greg (`feedback-reporter.ts` exit 0), filed 2026-10-09 20:58 UTC from the
reading view of `arxiv-2609-01481-spya-jytq2h` (build `8bd1e67b`): `spya-gsw9bh` (#522,
`SPIDERYARN-READING2-G2`). Overseer queue item `qi-f36eap6b`. This session had no Sentry sign-in and
did not write the Sentry status; the next feedback sweep does (the issue was already marked ignored
with no note).

> I'd like to think through and build up a library of peer-reviewed evidence about how to read and
> learn deeply and efficiently. I know a lot about learning and memory, but I don't know so much
> about reading per se. So I think this will all go in Docs Research, maybe with a research
> overview.md that's signposts to all of the Docs Research Markdown files, and that research overview
> should be signposted to from agents.md with a blurb. And so the kinds of research I can imagine us
> doing, we've done some already about whether the rapid serial visual presentation helps. I mean, a
> lot of the stuff in learn mode, like the recall submode and the quiz, is based on test-driven
> learning. The stuff about the Socratic questioning in tutorial mode is partly based on the zone of
> proximal development, so trying to stay in the zone where things are hard but not too hard. That's
> also why we have kind of the easier and the harder summaries. You know, I think there's research
> showing that voice is lower effort, it's faster. And that people probably provide, they probably say
> more and probably provide more context. So that's why we try and encourage that rather than typing.
> But I don't know if there's evidence for keeping people in the article, you know, with skim mode and
> other stuff that tries to, you know, show them text from the article and have them read the article
> itself and annotate the article, and rather than just giving them an LLM summary or LLM chat where
> everything's rewritten by the LLM. I think it's partly just about feeling like we can trust the
> article because it is the article, whereas the LLM description might be wrong. But it's also about,
> you know, we don't want the human to atrophy or fall prey to cognitive surrender. So anyway, I guess
> maybe start with thinking through each of the different modes and a lot of the different features
> and thinking through what scientific evidence might support or indeed suggest that the way we've
> implemented things is not ideal. I mean, I'm open to that. You know, maybe the glossary because it's
> constantly making it easy for you to look up the answer means that you're not actually learning it.
> So, you know, I'm equally interested in research that suggests a better way to do things, as well as
> research that corroborates the way that we are doing things. And eventually we might turn some of
> this into marketing materials, and of course we'll use it to drive product development. So initially
> it's a long list of research topics and ideas that may be relevant. Then spawn web researchers to go
> after each of those and look and sort of write up summaries and citations of each of those, and then
> digest that with regard to how we've applied it and whether we've done a good job. And then I guess
> use the write tutorial skill to generate me an HTML tutorial and open it in a browser, ideally. I
> guess you won't be able to do that because you'll be running on a server. Okay, generate me an HTML
> tutorial and then tell me when it's ready and I'll open it that will describe all this research in
> detail. We also have research on the decorative.html experiment that might be relevant too.
>
> — Greg, 2026-10-09 (`spya-gsw9bh`)

**Ending: Shipped** (docs only, on `dev`; nothing to deploy). Plan
[261010q](../plans/261010q-reading-and-learning-evidence-library.md).

- **The library**: twenty-one topic files under
  [docs/research/261010a-reading-and-learning-evidence/](../research/261010a-reading-and-learning-evidence/digest.md),
  one Sonnet web researcher each, every finding graded for certainty and for how directly it applies
  to our readers; all 370 DOIs resolved against Crossref.
- **The digest**: [digest.md](../research/261010a-reading-and-learning-evidence/digest.md), thirty
  product claims with verdicts, then mode by mode. GPT Sol reviewed it (SOUND AFTER FIXES, 12
  findings, applied).
- **The overview**: [reading-research-overview.md](../project/reading-research-overview.md), under
  `vision.md`, with a signpost line in AGENTS.md (a signpost, not a rule edit).
- **The tutorial**: [261010a-reading-and-learning-evidence.html](../tutorials/261010a-reading-and-learning-evidence.html).
- **Two earlier notes corrected**: the decorated-mode note's "pre-highlighting is the worst", and two
  second-hand claims in the cognitive-offloading note.
- **What it found that you asked about**: the glossary worry is neither supported nor refuted (a gloss
  beats no gloss; "guess first" is untested); voice is faster and fuller, and a learning benefit is not
  shown; keeping readers in the article's own words is the safer shape; Recall and Quiz stand on the
  best evidence, but nothing brings the reader back for a later check.
- **Deferred to the queue, as proposals for Greg** (none built): `qi-v7fq6bs5` reader study additions,
  `qi-nm7427wf` a later Learn/Quiz check and confidence ratings, `qi-4eae2qjt` reader-goes-first
  options, `qi-skyqrn2d` measuring chip press-through, `qi-yg6rvktz` honest mode copy, `qi-xeaxyqpc`
  three small UI nudges, `qi-sw9vwfhx` Sources/fidelity/Referee, `qi-3vbfw234` using the Sketch.
