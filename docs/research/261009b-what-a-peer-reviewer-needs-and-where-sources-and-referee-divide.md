# What a peer reviewer needs, and where Sources and Referee divide

Owned by [research.md](../project/research.md). Report `spya-h5aypq` (#519,
SPIDERYARN-READING2-FZ), Overseer queue item `qi-8g2tr5bt`, session `fbh5aypq-peer-review-research`.
The plan that builds the first piece is
[261009w](../plans/261009w-the-guide-offers-referee-to-a-reader-who-says-they-are-refereeing.md).
Written 2026-10-09.

**What this builds on.** A deeper pass on the same person already exists:
[260831e-helping-peer-reviewers/](260831e-helping-peer-reviewers/README.md), from when Referee
mode was designed (the policies, the tools already out there, and what AI help does to a reader's
own judgement). This doc does not repeat it. It adds a fresh web pass on the reviewer's tasks and
what they miss ([261009b-peer-reviewer-web-pass-sonnet.md](261009b-peer-reviewer-web-pass-sonnet.md),
Sonnet, 2026-10-09, sources in place, most read through search summaries rather than fetched).
Then it lays the reviewer's job over the modes Spideryarn has today, and draws the line between
the two modes that serve it.

**A name, before anything else.** The mode built on 2026-10-09 as *Peer review* (Citations and
Debate, merged) is being renamed **Sources**, on Greg's answer to q-xf2xvb (*"B Sources. Rename
comprehensively"*, reply `spya-egmn6r`, 2026-10-09), by plan
the Sources rename (Overseer queue item `qi-m9tmnpy3`). This doc uses the new
names: Sources › Bibliography, Reception, Claims. The clash Greg felt while dictating this report
(*"I thought it was a really good name a minute ago"*) is the same clash, and the rename settles it.

## What Greg asked

> So conversations with friends and potential users, especially the scientists and academics, peer
> review is a real opportunity. … So the main one I'm focusing on is someone who's been asked to do
> a peer review. … And again, remember the vision. The vision is not to write the review for them.
> The vision is to enable them to notice stuff. … I guess referee is specifically about being a,
> you know, reviewer for a journal or whatever, and peer review is now, well. I thought it was a
> really good name a minute ago, but, you know, it's more about understanding this paper and where
> it's situated both in terms of inbound and outbound citations. Yeah, and referee is more like
> making a decision on the paper itself. Obviously, that still requires you to look at where it's
> situated in terms of peer review, but referee is more about making a decision and therefore sort
> of having information highlighted suggests that perhaps the reader evaluates.
>
> P.S. I mean, if the reader says in their Guide chat or their Why You're Reading This that they are
> a referee, that should obviously present tools for the Referee mode etc.
>
> — Greg, 2026-10-09 (report `spya-h5aypq`, abridged; the whole of it is in the
> [note](../user-feedback/261009_1237-peer-review-research-and-where-sources-and-referee-divide.md))

## The short answer

- **Sources asks "where does this piece sit?"** Outward: what it cites, who has written about it,
  and how the claims it rests on fare elsewhere. It is for any reader. Nobody needs to owe a verdict
  to want it.
- **Referee asks "what do I have to judge, and have I looked at it?"** Inward: the reviewer's own
  criteria marked in the prose, what the paper promises against where it delivers, their own
  comments read back to them, and anything hidden in the source. It is only for someone who owes
  a verdict. It never gives one.
- **The rule of thumb for a new feature:** if it would help a reader who has no decision to make,
  it belongs in Sources (or another ordinary mode). If it only makes sense because you must decide,
  it belongs in Referee. Referee may point into Sources. Checking where a paper sits is part of
  judging it, as Greg says. Sources never points the other way.
- **The evidence says the opportunity is noticing, not writing.** Reviewers given a paper with nine
  planted major errors found about 2.6 of them (Schroter et al., *J R Soc Med* 2008, 607 reviewers).
  Several major policies forbid AI to make the assessment: Elsevier, NIH, IOP, and CVPR 2026 (seen
  only at second hand). Others, such as Springer Nature and ICLR, allow some help if it is
  disclosed. And the one controlled result in the earlier pass is for feedback on the reviewer's
  *own* draft (ICLR 2025). So the gaps worth building are second-look aids that point at passages,
  not verdicts.
- **The first piece, built with this research:** a reader who tells the guide, or says in *Why
  you're reading this*, that they are refereeing gets Referee offered as a button. It is a press,
  never opened for them. Until now that was impossible for most readers, because Referee is behind
  the experimental switch and the guide could only name it in words. Plan 261009w, measured in
  [261009d](../investigations/261009d-the-guide-offers-referee-to-referees-measured.md).

## The reviewer's job, step by step, and what Spideryarn has for each

The order comes from published how-to guides (COPE, NeurIPS, PLOS ONE, Vanderbilt's guide; the
web pass § 3). It is advice, not an observed study, and reviewers loop back. The one study of
practice, ReviewFlow (arXiv:2402.03530), reports about 6.4 hours a review for novices and 4.75 for
experienced reviewers. It also finds that novices struggle most with *the background literature* and
*judging novelty*. Both are Sources' ground.

| Step | What the reviewer is doing | What Spideryarn has now | Gap |
|---|---|---|---|
| 1. Say yes or no | Is this mine to judge? Any conflict? Time? | Guide (*Why you're reading*), Structure, Skim | none worth building. Candidates is the editor's job, not this one (§ Questions) |
| 2. First pass | What is claimed as new; is there a fatal flaw | Skim, Structure, Ideas (what it assumes), Summary as a map | — |
| 3. The close read | Do methods support results; figures match text; statistics; limitations | **Referee › Criteria** (your own criteria, marked in the prose), **Referee › Claims** (promise against the passages meant to deliver it), Glossary, Cross-references, Search | figures against text; numbers that disagree; a limitations list |
| 4. The literature around it | Is the related work fair; does a cited work say what it is cited for; what is missing; what others have said | **Sources › Bibliography** (what it cites, and whether we read each work), **Sources › Reception** (what others wrote), **Sources › Claims** (its claims checked on the web), the one-work *Investigate* button | *does the cited work say that?* at the citing sentence; *what is missing?* |
| 5. Writing comments | Major and minor points, each tied to a passage | Comments (anchored to a block), **Referee › Mirror** (reads your comments back, never a verdict) | sorting your own notes into major and minor; taking them out as a skeleton in your own words |
| 6. Recommendation | Accept, revise, reject; a note to the editor | nothing, on purpose: Referee's rule 1 is *no verdict, ever* | none: this stays the reviewer's |
| Throughout | Confidentiality; hidden instructions in the manuscript | **Referee › Hidden text** (a scan of the source, before any model); the three confidentiality sentences | below |

What that table says: steps 3 and 5 are Referee's, step 4 is Sources', and step 6 is deliberately
nobody's. Greg's lean (*"Peer review = understanding the paper and where it's situated … referee is
more like making a decision"*) matches what is already built, almost row for row. The overlap is
one word (§ The two Claims) and one sub-mode for a different person (Candidates).

## Where the two modes meet

### A referee needs both, and only the guide knows they are a referee

A referee's step 4 is Sources, and their steps 3 and 5 are Referee. Nothing in either mode should
copy the other. The join is the guide: it knows why the reader is reading, so it can say "you are
refereeing: Referee for the close read, Sources for the literature around it". Until today it could
not offer Referee as a button to most readers (§ The short answer). That is plan 261009w.

### The two Claims

Both modes have a sub-mode called **Claims**, and they are different things:

- **Sources › Claims**: the claims the piece rests on, checked against what the rest of the web
  says. Outward.
- **Referee › Claims**: what the piece promises, against the passages inside it that are meant to
  deliver. Inward.

Each fits its own mode, and the line above explains why both exist. But a referee with the
experimental switch on sees two chips with one word. The Sources rename keeps the word on screen
and gives the stored name a prefix (`sources-claims`) so the code cannot confuse them
(the Sources rename (Overseer queue item `qi-m9tmnpy3`)). The screen still
can. That is a question for Greg, not a rename to slip in (§ Questions, Q1).

### Candidates is the editor's

Referee › Candidates (*"Who could review this piece, and what expertise it would take"*) serves the
person Greg called *"quite a niche case … they can do that with just a standard chat agent"*: the
editor looking for reviewers. It is also the one Referee call that sees the byline (rule 4,
[referee-mode.md](../project/referee-mode.md)). Whether it stays is Greg's (§ Questions, Q2).

## Confidentiality decides whether a reviewer can use any of this

The fresh pass agrees with the earlier one, and adds dates: NIH (NOT-OD-23-149, 23 June 2023),
Elsevier, Springer Nature, IOP Publishing and ICLR 2026 all treat uploading a manuscript to an
outside AI tool as a breach in itself. Practice is ahead of the rules: 53% of reviewers in Frontiers'
December 2025 survey use AI. Spideryarn sends an article's text to a model provider when it is
added, and Referee already says so, in the past tense, behind its Notices button
([referee-mode.md § Confidentiality](../project/referee-mode.md#confidentiality-exact-and-unflinching-about-the-tense)).
The honest audience is the one that page names: public preprints, open-review submissions, and drafts
shared with the author's consent.

What that means for the guide: when it offers Referee to a referee, it says in one sentence that
this article's text was already sent to an AI provider when it was added, and that Referee's
Notices say what journals' rules are on that. Past tense, like the mode's own notice, and no
lecture. A mode that keeps nothing, or runs locally, would be a real product decision,
and it is not proposed here.

## Promising ideas for later

Each is tagged with the mode it belongs in by the rule of thumb above. None is built. The earlier
idea list ([ideas-fable.md](260831e-helping-peer-reviewers/ideas-fable.md)) has the long version of
several of them.

**The order is my judgement of value and fit, not of evidence.** The evidence behind each differs in
kind. The planted-error studies show what reviewers miss, but say nothing about whether starter
criteria help. Statcheck has a preliminary intervention study (Nuijten and Wicherts 2024, seen in a
summary). The disclosure log answers a stated policy requirement. Nothing here has been tried on
our readers.

1. **Referee: starter criteria from what reviewers miss.** Criteria is the reviewer's own list, and
   the box starts empty. A handful of starters, taken from the errors the planted-error studies
   seeded (do the conclusions follow from the results; is the control adequate; do the figures say
   what the text says; are the limitations stated), offered as text to pick and edit, never run
   without a press. It is cheap, because Criteria exists. It is the most direct answer to *about 2.6
   of 9*. Careful: a starter list is the tool suggesting what to judge, which is close to the
   anchoring the earlier research warns about. It should be offered after the reviewer has written
   at least one criterion of their own, not before.
2. **Sources: "does the cited work say that?"** At a citing sentence, the cited work's own passage,
   when we can read it (open access, or already in Spideryarn). Quotation errors run at 14–25% of
   citations in the published literature (Mogull 2017; Jergas and Baethge 2015). Bibliography's
   *Investigate* already reads one work. This would aim the reading at the sentence. It is useful to
   any reader, so it is Sources'.
3. **Sources: what it does not cite.** Reception's web search, aimed at work on the same question
   that the piece does not cite. ICML and EC added this question to their reviewer forms. One
   caveat: reviewers who ask authors to cite the reviewer's own work approve less often (eLife,
   37,000 reviews), so every suggestion must say why it is relevant, and the reviewer decides.
4. **Referee: your notes, sorted by you.** The reviewer marks each of their own comments major or
   minor. Then they take them out as a skeleton, in their own words only: summary, major, minor.
   This is step 5, with nothing written for them.
5. **Referee: numbers that disagree.** A deterministic check, statcheck-style, for reported
   statistics that are inconsistent with themselves. About half of psychology papers have at least
   one (Nuijten et al.). It needs no model, which suits rule 1. It works only where statistics are
   reported in a standard form.
6. **Referee: figure against text.** Where the prose describes a figure, put the two side by side.
   Images are hosted already ([article-images.md](../project/article-images.md)).
7. **Referee: a disclosure log.** What Spideryarn did on this article, for the venues that ask a
   reviewer to declare AI use (Springer Nature, ICLR).

## Questions for Greg

None blocks plan 261009w. They are in the question file for this report
([q-fkq30v.md](../user-feedback/questions/q-fkq30v.md)), each with its options.

- **Q1. The two Claims.** Keep one word for both, or rename one on screen?
- **Q2. Candidates.** Keep it in Referee, move it out, or retire it, now that the editor is a
  persona you have set aside?
- **Q3. Referee and the switch.** Take Referee out of experimental, now that it has a reason to be
  in front of referees? Or keep it behind the switch and let the guide offer it, as built today?
- **Q4. Which idea next.** Of the seven above, which one first?

## Dead ends and limits

- No study found of *how* reviewers check references or use "cited by" lists. The tasks in step 4
  rest on journal forms (ICML, EC) and error rates, not on observed behaviour.
- No first-person reviewer accounts turned up in this pass. The *what is hard* column rests on
  surveys (Publons 2018, eLife's early-career survey, IOP 2025, Frontiers 2025).
- The NeurIPS 2025 and CVPR 2026 policies were seen only through a secondary paper
  (arXiv:2606.10159). The Baxt 1998 *two thirds missed* figure was not confirmed. Both are marked in
  the web pass.
- The web pass read most pages through search summaries. Treat its numbers as dated examples, and
  re-fetch before quoting one on the website.
