# A library of evidence on reading and learning deeply and efficiently

**Status: done, 2026-10-10.** Docs only: no product change lands here. Report `spya-gsw9bh`
(#522, Greg, 2026-10-09), queue item `qi-f36eap6b`.

## The ask

Greg, from the reading view of `arxiv-2609-01481`, 2026-10-09:

> I'd like to think through and build up a library of peer-reviewed evidence about how to read and
> learn deeply and efficiently. I know a lot about learning and memory, but I don't know so much
> about reading per se. … I'm equally interested in research that suggests a better way to do
> things, as well as research that corroborates the way that we are doing things. And eventually we
> might turn some of this into marketing materials, and of course we'll use it to drive product
> development. So initially it's a long list of research topics and ideas that may be relevant. Then
> spawn web researchers to go after each of those and look and sort of write up summaries and
> citations of each of those, and then digest that with regard to how we've applied it and whether
> we've done a good job. And then I guess use the write tutorial skill to generate me an HTML
> tutorial … that will describe all this research in detail.

The full report is quoted in the user-feedback note this work ends with.

## What lands

```
docs/project/reading-research-overview.md      a thin hub: every file below, one line each,
                                               plus the earlier reading-related research.
                                               Parent: vision.md. A line under vision.md's ↳
                                               in CLAUDE.md (not an eighth entry point).
docs/research/261010a-reading-and-learning-evidence/
    01-retrieval-practice.md … 21-….md         one per topic (list below), written by a
                                               Sonnet web researcher
    digest.md                                  owns the conclusions: claim by claim, then
                                               mode by mode
docs/tutorials/261010a-reading-and-learning-evidence.html
                                               the explainer Greg opens himself; listed in
                                               tutorials.md
docs/user-feedback/<note>.md                   the ending for spya-gsw9bh
```

Why a hub in `docs/project/` rather than more lines in `research.md`'s "See also": that list is a
mixed bag of infrastructure research, and Greg asked for something he and later marketing can read
as one body of evidence. The hub only links; the digest owns the conclusions, so there is one home
for each.

## The topics

Revised after GPT Sol's plan review
([review](261010q-reading-and-learning-evidence-library-review-sol.md)): twelve became twenty-one,
because several were too broad for one researcher, and four gaps were added (Search; reading
purpose, motivation and personalisation; generating vs receiving; the HCI census bounded so it does
not duplicate the rest). The leads are leads, not conclusions — the researcher checks each.

| # | File | Topic | Modes / features | Leads |
|---|---|---|---|---|
| 1 | `01-retrieval-practice.md` | Retrieval practice for prose: testing effect, free vs cued vs multiple choice, feedback, delay, transfer | Learn: Recall, Quiz | Roediger & Karpicke 2006; Rowland 2014; Adesope et al. 2017; Pan & Rickard 2018. Prior: 261002c |
| 2 | `02-prequestions-and-metacomprehension.md` | Pre-questions, reader-generated questions, metacomprehension and calibration | Quiz, FAQ, Learn's feedback, Skim's first pass | Pan & Carpenter prequestion work; Rosenshine et al. 1996; Thiede et al. 2003; Glenberg illusion of knowing |
| 3 | `03-scaffolding-and-desirable-difficulty.md` | Human tutoring, scaffolding, the zone of proximal development, desirable difficulties, expertise reversal | Learn: Tutorial, Explore; easier/harder summaries | Wood, Bruner & Ross 1976; VanLehn 2011; Bjork & Bjork; Kalyuga 2003/2007. Prior: 261002c |
| 4 | `04-ai-tutors-and-llms-in-learning.md` | Evaluations of AI tutors and LLM help on learning | Tutorial, Chat, Live, high-powered AI | Bastani et al. 2025 PNAS; Kestin et al. 2025; De Simone et al. (World Bank); Lehmann et al. |
| 5 | `05-summaries-organisers-and-coherence.md` | Summaries before/instead of/after reading; advance organisers; coherence; simplified vs elaborated text | Summary (Brief/Fuller/Thread), Ideas, link hover summaries | Ausubel; Luiten et al. 1980; McNamara, Kintsch, Songer & Kintsch 1996; Yano, Long & Ross 1994; Melumad & Yun 2025. Prior: 261002c, 261005c |
| 6 | `06-cognitive-offloading.md` | Cognitive offloading, the Google effect and its failed replications, deskilling | the product stance; Chat; Glossary | Risko & Gilbert 2016; Sparrow et al. 2011; Camerer et al. 2018; Hesselmann 2020; Lee et al. CHI 2025; Gerlich 2025. Prior: 260831e |
| 7 | `07-trusting-ai-text-vs-the-source.md` | Automation bias, hallucination in summaries, verification and provenance; staying in the source vs an AI rewrite | Skim, Quotes, FAQ, cross-references, Chat | Parasuraman & Manzey 2010; Goddard et al. 2012; summary-faithfulness work; anchoring in 260831e |
| 8 | `08-generating-vs-receiving.md` | Doing it yourself vs being given it: ICAP, generative learning, self-explanation, the generation effect | cross-cutting: Summary, Structure, FAQ, Diagram, Chat, Explore | Chi & Wylie 2014; Fiorella & Mayer 2016; Bisra et al. 2018; Slamecka & Graf 1978; Bertsch et al. 2007 |
| 9 | `09-annotation-highlighting-notes.md` | The reader's own highlighting, annotation and note-taking | Comments, marginalia, Quotes | Dunlosky et al. 2013; Ponce et al. 2022; Mueller & Oppenheimer 2014; Morehead et al. 2019; Urry et al. 2021 |
| 10 | `10-glosses-and-vocabulary.md` | Glosses and definitions on demand: does easy look-up stop learning? | Glossary, maths | Abraham 2008; Yun 2011; Yanagisawa et al. 2020 |
| 11 | `11-hypertext-and-split-attention.md` | Hypertext reading, link previews, disorientation, split attention and spatial contiguity | Links, cross-references, marginalia, the band beside the prose | DeStefano & LeFevre 2007; Ginns 2006; Chandler & Sweller 1992 |
| 12 | `12-skimming-and-speed-reading.md` | Skimming, multiple passes, speed reading and RSVP | Skim, reading-time spine | Duggan & Payne 2009, 2011; Rayner et al. 2016. Prior on RSVP: 260828b |
| 13 | `13-headings-structure-signalling.md` | Headings, outlines, structure and signalling | Structure, generated headings, granularity zoom | Lorch 1989; Schneider et al. 2018; Hyönä et al. 2002 |
| 14 | `14-speaking-vs-typing.md` | Speaking vs typing: speed, effort, quantity; oral vs written explanation and learning | Dictation, Live, Learn's talk-or-type | Ruan et al. 2018; Lachner et al. 2018; Hoogerheide et al. 2016; Fiorella & Mayer 2013 |
| 15 | `15-pictures-and-seductive-details.md` | Multimedia, decorative and seductive images, AI-made pictures | Illustrated, article images, Sketch | Mayer; Rey 2012; Sundararajan & Adesope 2020; Carney & Levin 2002 |
| 16 | `16-maps-diagrams-timelines.md` | Argument maps, concept maps, timelines; viewing vs constructing | Diagram, Sketch, Timeline, Structure | Nesbit & Adesope 2006; Schroeder et al. 2018; Davies argument mapping; Fiorella & Zhang 2018 |
| 17 | `17-typography-and-decoration.md` | Pre-highlighting by others, typographic cues, "bionic reading", disfluent fonts, screen vs paper | decorated-mode experiment, fonts per voice | Fowler & Barker 1974; Gier et al. 2009; Diemand-Yauman 2011; Meyer et al. 2015; Delgado et al. 2018; Clinton 2019. Prior: 260828b, 260929a |
| 18 | `18-critical-reading-and-sourcing.md` | Sourcing, multiple documents, lateral reading, refutation texts, argument evaluation | Sources (Bibliography, Reception, Claims), Referee, Ideas, FAQ | Bråten & Strømsø; Wineburg & McGrew 2019; Tippett 2010; Britt & Rouet. Prior: 260831e, 261009b |
| 19 | `19-search-and-foraging.md` | Within-document search, information foraging, searching as learning | Search, quick search | Pirolli & Card 1999; Vakkari 2016; Marchionini 2006 |
| 20 | `20-purpose-motivation-personalisation.md` | Reading goals, interest and curiosity, learner control, personalisation | Reader profile, purpose-based suggestions | Rouet, Britt & Durik 2017 (RESOLV); Hidi & Renninger 2006; Kang et al. 2009; Gruber et al. 2014 |
| 21 | `21-reading-interfaces-census.md` | Bounded census of AI and intelligent reading interfaces in HCI: what was built, what was measured, how | the product as a whole; the reader study | Semantic Reader (Lo et al. 2024); ScholarPhi; Paper Plain; CiteSee; Scim; 2023–26 LLM readers |

## How each researcher works

One Sonnet subagent per topic, in parallel, from one brief whose rules are these:

- Every reference **opened this session**, not recalled and not taken from a search snippet; the
  DOI checked against the publisher, Crossref or PubMed, never invented; a stable URL for a book or
  a conference paper. Unverifiable leads go under "Not verified", not into the evidence.
- Each load-bearing claim checked against the source, with where it is (abstract, table, page).
- An evidence row for load-bearing studies: design, N, population, text/task, comparator, outcome,
  delay, effect size, limitations.
- **Two grades, kept apart**: *certainty* (High / Moderate / Low / Contested — risk of bias,
  consistency, precision, publication bias; a meta-analysis is not automatically High) and
  *directness* to Spideryarn's readers (Direct / Indirect / Analogy). A strong L2-vocabulary result
  is still Analogy for an expert reading a paper.
- A search log: queries, databases, citation chaining, retractions and null results found.
- Contrary evidence as wanted as support; preprints and the "cognitive surrender" framing labelled
  as such and kept out of the evidential backbone.

## The digest

`digest.md`, written by me from the twenty-one files. The unit of judgment is the **product claim**
("asking the reader to recall before showing them the answer helps them keep it"), not the whole
mode. First a claim–evidence matrix — direction, certainty, directness, and which outcome (immediate
comprehension, delayed retention, transfer, calibration, time, perceived ease) — then one section
per mode drawn from it. Verdicts stay distinct: *supported*, *supported indirectly*, *untested*, *no
reliable effect*, *evidence of harm*. Each section ends with the product idea it points at. Ideas go
to the Overseer's queue or a question file, never built here.

## Stages and reviews

1. **Plan** (this doc) → GPT Sol review of the topic list, read-only. Done: PROCEED WITH CHANGES,
   all taken.
2. **Research**: twenty-one researchers in parallel. I read each file; a separate checker pass
   resolves every DOI against Crossref and flags any that do not resolve or whose title does not
   match.
3. **Digest** → GPT Sol review: *does each conclusion follow from the cited evidence?* Sol may fix
   what it finds in the digest (workspace-write).
4. **Overview, signposts, tutorial** → browser check of the tutorial in a Sonnet subagent.
5. **Land**: gates (`npm test` for doc-links, `npm run typecheck`), commit, push to `dev`, the
   user-feedback note, `npx tsx scripts/feedback-endings.ts`, queue entries for product ideas.

## Done means

Twenty-one topic files with graded, cited findings; a digest Sol has reviewed; the overview
signposted from `vision.md` and CLAUDE.md; a tutorial that renders; the feedback note written; Greg
told where the tutorial is.

## Log

- 2026-10-10: prior-work check — no earlier attempt. Existing reading research to build on:
  260828b (decorated mode, incl. RSVP), 260831e (cognitive offloading), 261002c (recall and tutorial
  pedagogy; what makes a good summary), 261005a (reading time), 261005c (a longer summary someone
  can follow), 261009b (what a peer reviewer needs).
- 2026-10-10: Sol's plan review taken in full — topics split to 21, two-axis grading, claim-level
  digest, overview kept thin.
- 2026-10-10: twenty-one researchers wrote their files (topic 21 waited for a free slot). Almost all
  sources were read at abstract level: publishers blocked automated fetching; each file says which.
  DOI check: 370 DOIs, 307 matched automatically, the other 63 checked by hand and all resolve to the
  paper cited (the misses were the title sitting on another line). The researchers had already caught
  at least ten wrong DOIs in the leads this plan gave them.
- 2026-10-10: digest written; GPT Sol's review
  ([digest-review-sol.md](../research/261010a-reading-and-learning-evidence/digest-review-sol.md)):
  SOUND AFTER FIXES, 12 findings, which Sol applied in the digest. The one that mattered most: the
  draft confused delaying the *final test* (where retrieval's advantage appears) with delaying the
  *first* recall (untested); only calibration is clearly helped by a later self-check. The tutorial
  was aligned with the corrected digest.
- 2026-10-10: two earlier research notes corrected in place (260828b on pre-highlighting; 260831e on
  two second-hand claims). Overview under vision.md, signposted in AGENTS.md, research.md and
  tutorials.md. Tutorial checked in Playwright, light and dark, 1280px and 390px; Figure 1's row labels
  fixed. Product ideas queued as eight proposals (`qi-v7fq6bs5`, `qi-nm7427wf`, `qi-4eae2qjt`,
  `qi-skyqrn2d`, `qi-yg6rvktz`, `qi-xeaxyqpc`, `qi-sw9vwfhx`, `qi-3vbfw234`), none authorised or built.
