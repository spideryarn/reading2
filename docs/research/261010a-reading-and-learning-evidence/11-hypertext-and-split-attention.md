# Hypertext, link previews, split attention and interruptions

Up: [reading-research-overview.md](../../project/reading-research-overview.md) · part of the
[reading and learning evidence library](digest.md), 2026-10-10.

The question: when a reader has to look away from the sentence they are on (to follow a link, read a
footnote, glance at a side panel, answer a chat), what does it cost them, and does it matter whether
the extra material is beside the sentence, in a pop-up, or somewhere else? The short answer: the
best-established finding is that **related things placed apart cost the reader effort and learning,
and placing them together helps**. But that evidence comes almost entirely from novices studying
diagrams with labels, not from experts reading prose; the research on hypertext links themselves is
older, smaller and more mixed than its reputation; and there is almost no direct evidence on hover
cards, margins or footnote pop-ups. Spideryarn's design leans the right way, mostly by analogy.

## The short answer

- Learners who must hold one source in mind while hunting for its partner (text and diagram,
  say) learn less than when the two are integrated; the pooled effect is moderate to large (g about
  0.6 in the most recent meta-analysis). (**High certainty · Analogy**)
- That effect shrinks, or reverses, for readers who already know the material. Experts reading in
  their own field are the people the effect is least likely to help. (**Moderate certainty · Indirect**)
- Nobody has shown *why* integration helps. A systematic review found cognitive-load measures
  mostly do not support the standard "less extraneous load" explanation. The effect is real; the
  mechanism is contested. (**Moderate certainty · Analogy**)
- Hypertext is not reliably worse than linear text. Reviews and experiments find that outcomes
  depend on the reader's prior knowledge and on the order in which they read; the number of links
  per page may not matter much, while suggestions about which link to follow do help. (**Low
  certainty · Indirect**)
- Mouse-over link previews made tasks faster in one usability experiment without changing
  effectiveness or satisfaction. There is very little else. (**Low certainty · Indirect**)
- Eye-tracking: a single hyperlinked word draws attention, and a hyperlinked *uncommon* word makes
  readers re-read the sentence before it. Links do not seem to slow ordinary reading much; the cost
  is in the decision to follow. (**Low certainty · Indirect**)
- After an interruption, people need time to recover the thread, and cues or a moment of
  preparation shorten that. This is lab work on puzzles and procedures, not reading. (**Moderate
  certainty · Analogy**)
- There is no direct evidence on margin placement of AI notes versus a chat panel; one small
  preprint found no comprehension difference. (**Low certainty · Indirect**)

## The evidence

### Placing related things together (split attention and spatial contiguity)

**The original effect.** Chandler & Sweller (1992) reported two experiments. In the first, trainees
learning a programming language for machine tools did better with text and diagrams physically
integrated than with the conventional separate layout. In the second, they asked whether the effect
survives where separation is the convention, **empirical reports in psychology and education**:
students given the integrated version spent less time processing the instructions yet scored higher
on test questions (abstract only; sample sizes not stated in the abstract). This is the closest
direct ancestor of Spideryarn's situation, in that the material was research-report-like, though it
concerned text and figures rather than annotations, and the readers were students, not experts.
(**Moderate certainty · Indirect**)

**Pooled evidence.** Schroeder & Cenkci (2018) meta-analysed 58 independent comparisons (total
N = 2,426) of spatially integrated versus separated designs and found an overall Hedges' g = 0.63
(p < 0.001); the abstract says integrated designs helped across many moderators, with details in
the full text I could not open (abstract only). An earlier meta-analysis by Ginns (2006) is reported
by a later paper (Beege et al. 2019, read in full) as giving a weighted mean d = 0.85
(95% CI 0.68-1.02); that paper also attributes a split by material complexity (d = 0.78 for
complex material against 0.28, not significant, for simple material) but its sentence is ambiguous
about whose figure that is, so I treat the complexity split as unconfirmed. I could not open Ginns
itself. Populations in these meta-analyses run from young children to university students; materials are mostly short
multimedia lessons (diagrams, animations), not continuous prose. (**High certainty · Analogy**)

**Why it works is unclear.** Schroeder & Cenkci's later systematic review (2020; 41 comparisons)
found that cognitive-load measures "largely do not support" the claim that integration lowers
extraneous load, and no compelling evidence that integrated designs change any load measure; the
authors propose that integration instead helps learners connect the two sources. (abstract
only) So "keep things near what they explain" is well supported as a rule of thumb; "it is because
your working memory is overloaded" is not. (**Moderate certainty · Analogy**)

**Closer is not always better.** Beege et al. (2019; two experiments, N = 98 and N = 85, students,
text labels on a picture) varied the distance between related and unrelated elements. A *medium*
distance gave the best transfer in Experiment 1 (quadratic contrast t = 2.19, p = 0.03) and the best
retention and transfer in Experiment 2 (retention t = 2.06, p = 0.04; transfer t = 2.54, p = 0.01);
in Experiment 1 the fully separated control did not score lower than the integrated conditions, so
the authors' own prediction was rejected. Small samples, one kind of material; I read the first
100,000 characters of the paper. (**Low certainty · Analogy**)

**Expertise reverses it.** Kalyuga, Ayres, Chandler & Sweller (2003) review the "expertise reversal
effect": instructional techniques that help inexperienced learners can lose their effect or turn
harmful for more experienced learners (abstract only; a narrative review, no pooled effect size).
A 2026 meta-analysis of spatial contiguity in digital learning (*Journal of Educators Online*, 28
studies; a minor outlet, seen through its abstract only, via Crossref) likewise reports a larger
benefit for novices (g = 0.75) than for experienced learners (the experienced figure is not in the
abstract). Treat both as pointers, not proof. For Spideryarn's readers, who often know
the field, this matters more than the headline effect size. (**Moderate certainty · Indirect**)

### Hypertext: the cost of deciding to click

**The theory.** DeStefano & LeFevre (2007, *Computers in Human Behavior*) reviewed hypertext studies
through a process model, predicting that extra decisions and visual processing impair reading, with
low working memory and low prior knowledge making it worse. I confirmed the paper exists and its
bibliographic details (Crossref) but could only read a secondary summary of the abstract, so I do not
cite its numbers; see Not verified.

**Reading order matters more than link count.** Salmerón, Cañas, Kintsch & Fajardo (2005; abstract
only) found that the number of different pages read mainly affected memory for the text itself
(textbase), while the order of reading influenced the deeper situation model. Low-knowledge readers
learned more following a high-coherence order; **high-knowledge readers learned more reading in a
low-coherence order**. Madrid, van Oostendorp & Puerta Melguizo (2009; repository abstract record
only; N not given) varied 3 versus 8 links per page and the presence of link suggestions: the number of
links did not affect learning, suggestions did, and the effect on cognitive load ran through the
reading order readers chose. Both were university students on expository hypertexts, not experts on
research papers. (**Low certainty · Indirect**)

**Links in the eye-tracker.** Fitzsimmons, Weal & Drieghe (2019, *PLOS ONE*, full text; three
experiments, N = 30, 36 and 32 undergraduates; Wikipedia-style passages in the third). Coloured
words in a sentence were skipped less often when only one word was coloured, but with several
coloured words the effect vanished. In the web-style passages, link status made no difference to
early reading measures, but hyperlinked *uncommon* words led to more re-reading of the preceding text.
Participants could not click, so navigation was never tested; the sample is young and mostly female;
colour was confounded with contrast. Comprehension was near ceiling (95-97 percent). Fair reading: links
are a mild signal of importance, and for difficult terms invite a re-read, not a big tax per link.
(**Low certainty · Indirect**)

### Previews versus going there

Maes, van Geel & Cozijn (2006, *Interacting with Computers*; abstract only; N not stated) compared a
website with no hyperlink previews against semantic (content) and pragmatic (task-oriented)
mouse-over previews, on search and recall tasks. Previews gave a clear efficiency advantage and no
effect on effectiveness or appreciation; the two kinds of preview did not differ, and a post hoc
analysis suggested learning with the pragmatic kind. That is the only controlled test of the idea I
could open. There is no experiment I found of a rich preview card (title, excerpt, word count) against
following the link, and none on the disorientation cost of leaving the page versus staying.
(**Low certainty · Indirect**)

### Footnotes and glosses

Ebsworth, McDonell, DeFazio & Cai (2017, *IALLT Journal*; N = 40 high-school English learners,
randomised; abstract page only) found no difference in multiple-choice recall or perceived
comprehensibility between hypertext links and footnotes, and note an earlier higher-education study in which
hypertext recall was *lower*. A small L2 study, with passages not like research papers; I did not
open the earlier study. (**Low certainty · Analogy**) I found no experiment comparing footnotes,
endnotes and pop-up or margin notes for adult readers of expository prose.

### Interruptions and getting back

Altmann & Trafton (2002, *Cognitive Science*; abstract only) propose that goals are held by
activation that decays, so suspended goals need cues to be retrieved, and interference from old goals
slows encoding of new ones; they tested the model by simulating data from the Tower of Hanoi puzzle.
Trafton, Altmann, Brock & Mintz (2003, *Int. J. Human-Computer Studies*) manipulated a warning before an interruption; I
confirmed the paper and its design only from search-result summaries (a warned group prepared more and
resumed faster), so it is under Not verified. All of this is puzzle and procedure work with a handful of seconds of cost
per switch; no reading study was opened. The design lesson is still sensible: a return path and a cue at the point of departure
should help, and a reader who followed a link and cannot see where they were will pay for it. (**Moderate certainty · Analogy**)

### Recent work on AI assistance

Joshi & Vogel (2025, **preprint**, arXiv 2509.09840, not peer-reviewed) built a reader where an LLM writes into
comment-style margin notes anchored to selected text, compared with chat. Three Prolific experiments
(N = 26, 30 and 32 analysed), about 500-word non-fiction passages, six multiple-choice questions after a
two-hour delay. Margin note versus chat: no significant difference in comprehension (W = 80, p = .81),
though 65 percent ranked the note first. Automatic selection versus manual: no comprehension difference,
but much lower "psychological ownership" and effort. Tiny samples, short texts, crowd workers, and a null
result with this little power is not evidence of equivalence. (**Low certainty · Indirect**; preprint,
not load-bearing.)

## Where it is weak, contested or contrary

- **The strongest evidence is about novices and diagrams.** The split-attention literature is mostly
  about children and students with labelled figures. Expert adults reading prose with annotations are
  barely represented, and expertise reversal predicts the effect may shrink for them.
- **The mechanism is disputed** (Schroeder & Cenkci 2020), and a medium distance sometimes beats the
  closest (Beege et al. 2019). Do not read "closer is always better".
- **Hypertext research from the 2000s** used simple networks of short pages, often on students, and is
  not about hovering over a card in a long article. Its effect sizes mostly are not reported in
  accessible abstracts, and results conflict (Ebsworth et al. cite an earlier study that found a
  hypertext cost).
- **Almost nothing on reading with a margin, a pop-up card or a back button.** The design is supported
  by analogy rather than test.
- **Interruption research** is on puzzles and procedures; it is not about reading, where resumption
  may be cheaper (the text is still there) or dearer (the argument's thread is lost).

## What it means for Spideryarn

**Hover cards on links** ([links.md](../../project/links.md)). Today a hovered link opens a card built
from the address alone, or from a server-side fetch of the destination, and every outbound link opens in a
new tab so the reader is never carried off; a footnote marker's card shows the whole note.
**Supports:** the pop-up is a form of keeping the extra material close to the word that needs it, and the
only controlled preview study (Maes 2006) found efficiency gains. **Suggests a change:** none firmly.
A possibility to consider: Fitzsimmons 2019 suggests a link on an uncommon word invites re-reading, so a card
that answers "what is this?" quickly may matter most on hard terms. **Untested:** whether a
preview improves what readers take away, whether it lowers the cost of deciding to click, and
whether the card's own text becomes a second thing to attend to.

**Cross-references** ([cross-references.md](../../project/cross-references.md)). A phrase like "reduced
recall by 38%" links to the results paragraph, with the target shown in a card and a back chip after a jump.
**Supports:** this is the nearest thing in the product to the integrated-text effect of Chandler & Sweller
(1992), whose second experiment used empirical reports, and the back chip answers the resumption problem.
**Suggests a change (proposal):** Salmerón et al. (2005) hint that high-knowledge readers do not benefit from
coherence-guiding aids the way novices do, so a link density that suits a novice may clutter an expert's
page; consider a way to dim them. **Untested:** whether the links change comprehension of papers.

**Marginalia** ([marginalia.md](../../project/marginalia.md)). Notes in a column beside the block they are
about, with the block's icons between. **Supports:** spatial contiguity at its simplest, with notes beside the
passage, not at the end. **Untested:** by design the notes are quiet by default; Beege et al. suggest
"nearest" is not automatically best, and the margin is not integration inside the text. A note can
still be a second thing to read.

**The three-column picture** ([interface-vision.md](../../project/interface-vision.md)). Unanchored things
(structure, summary) on the left, anchored annotations on the right, the text in the middle, explicitly
"not decided". **Supports:** the separation of anchored from unanchored matches what contiguity predicts
should live next to the text and what need not. **Suggests a change:** none; the evidence is too thin to
settle it. **Untested:** the relative cost of left-column look-aways, and the effect of
"progressive disclosure" on whether readers see what they would have needed.

**Chat from a mode and the reading band** ([reading-view-overview.md](../../project/reading-view-overview.md)).
Modes take turns in a band beside the prose. **Supports:** a band beside the text means the thing explained is
in view while the explanation is read. **Untested:** whether a chat panel separate from the text costs
comprehension; the only data (Joshi & Vogel 2025, preprint) show no difference, and cannot rule out one.

## Not verified

- DeStefano & LeFevre (2007), doi:10.1016/j.chb.2005.08.012 — existence and bibliographic details confirmed on
  Crossref; the publisher page returned 403 and the abstract reached me only through a search summary, so I
  quote none of its claims.
- Ginns (2006), doi:10.1016/j.learninstruc.2006.10.001 — existence confirmed on Crossref; publisher page
  403. The d = 0.85 figure is as reported by Beege et al. (2019), not read in the original.
- Trafton et al. (2003), doi:10.1016/s1071-5819(03)00023-5 — existence confirmed; PDF text could not be extracted.
  The "warned group resumed faster" claim and the "3.8 s versus 1.9 s resumption lag" figure from other
  Altmann and Trafton work are search-summary only.
- Chen, Fan & Macredie (2006), doi:10.1016/j.chb.2004.06.004 — existence confirmed on Crossref; content only from
  a search summary (a review of how prior knowledge shapes hypermedia navigation).
- Foster et al. on footnotes and a Harper et al. (2004) hypertext-link-preview evaluation — surfaced in
  search results; not located or opened.
- The earlier higher-education study cited by Ebsworth et al. (hypertext recall lower than footnotes).

## Search log

- Crossref (API, with title queries) to confirm: DeStefano; Ginns; Schroeder & Cenkci (2018 and 2020);
  Chandler & Sweller; Altmann; Salmerón; Fitzsimmons; Kalyuga; Madrid; Chen; Trafton. All leads exist as
  cited. Crossref rate-limited some early calls; retried by script.
- OpenAlex and Semantic Scholar for abstracts (Salmerón, Kalyuga, Fitzsimmons, Schroeder 2020).
- Publisher pages: PLOS ONE (full text), Springer (abstract only), OUP (abstract), Frontiers (full text, first 100k
  characters), IALLT journal page, arXiv HTML. ScienceDirect and Cardiff returned 403.
- Web searches: Ginns and Schroeder details; DeStefano abstract; footnotes versus endnotes and pop-ups;
  hyperlink previews and disorientation; Trafton resumption; Madrid; Chen; LLM side panel versus inline.
- No retractions or corrections found. No null or failed replication found for the split-attention effect,
  but the mechanism (Schroeder & Cenkci 2020) and the "closer is better" claim (Beege 2019) are disputed.
- Not searched: Fitzsimmons' later 2020 eye-movement work, Foster in depth, scroll and spatial-memory
  studies of paged versus scrolling text, work on the cost of tab-switching.

## Sources

1. Chandler, P. & Sweller, J. (1992). The split-attention effect as a factor in the design of instruction.
   *British Journal of Educational Psychology*, 62, 233-246. https://doi.org/10.1111/j.2044-8279.1992.tb01017.x —
   checked 2026-10-10 (abstract only, via Crossref).
2. Schroeder, N. L. & Cenkci, A. T. (2018). Spatial contiguity and spatial split-attention effects in multimedia
   learning environments: a meta-analysis. *Educational Psychology Review*, 30, 679-701.
   https://doi.org/10.1007/s10648-018-9435-9 — checked 2026-10-10 (abstract only).
3. Schroeder, N. L. & Cenkci, A. T. (2020). Do measures of cognitive load explain the spatial split-attention
   principle in multimedia learning environments? A systematic review. *Journal of Educational Psychology*,
   112, 254-270. https://doi.org/10.1037/edu0000372 — checked 2026-10-10 (abstract only).
4. Beege, M., Wirzberger, M., Nebel, S., Schneider, S., Schmidt, N. & Rey, G. D. (2019). Spatial continuity effect vs. spatial contiguity
   failure. *Frontiers in Education*, 4, 86. https://doi.org/10.3389/feduc.2019.00086 — checked 2026-10-10
   (full text, first 100,000 characters; authors from Crossref).
5. Ginns, P. (2006). Integrating information: a meta-analysis of the spatial contiguity and temporal contiguity
   effects. *Learning and Instruction*, 16, 511-525. https://doi.org/10.1016/j.learninstruc.2006.10.001 —
   bibliographic details checked on Crossref only; **content not read**.
6. Kalyuga, S., Ayres, P., Chandler, P. & Sweller, J. (2003). The expertise reversal effect. *Educational
   Psychologist*, 38, 23-31. https://doi.org/10.1207/s15326985ep3801_4 — checked 2026-10-10 (abstract only).
7. Fitzsimmons, G., Weal, M. J. & Drieghe, D. (2019). The impact of hyperlinks on reading text. *PLOS ONE*.
   https://doi.org/10.1371/journal.pone.0210900 — checked 2026-10-10 (full text).
8. Salmerón, L., Cañas, J. J., Kintsch, W. & Fajardo, I. (2005). Reading strategies and hypertext
   comprehension. *Discourse Processes*, 40, 171-191. https://doi.org/10.1207/s15326950dp4003_1 — checked
   2026-10-10 (abstract only).
9. Madrid, R. I., van Oostendorp, H. & Puerta Melguizo, M. C. (2009). The effects of the number of links and
   navigation support on cognitive load and learning with hypertext: the mediating role of reading order.
   *Computers in Human Behavior*, 25, 66-75. https://doi.org/10.1016/j.chb.2008.06.005 — checked 2026-10-10
   (repository abstract record only).
10. Maes, A., van Geel, A. & Cozijn, R. (2006). Signposts on the digital highway: the effect of semantic and
    pragmatic hyperlink previews. *Interacting with Computers*, 18, 265-282.
    https://doi.org/10.1016/j.intcom.2005.05.004 — checked 2026-10-10 (abstract only).
11. Ebsworth, M. E., McDonell, T., DeFazio, A. & Cai, C. (2017). Hypertext versus footnotes: high school English
    learners' online reading recall. *IALLT Journal*, 47(1). https://doi.org/10.17161/iallt.v47i1.8568 —
    checked 2026-10-10 (abstract page only).
12. Altmann, E. M. & Trafton, J. G. (2002). Memory for goals: an activation-based model. *Cognitive Science*,
    26, 39-83. https://doi.org/10.1207/s15516709cog2601_2 — checked 2026-10-10 (abstract only, via Crossref).
13. Joshi, N. & Vogel, D. (2025). Designing and evaluating AI margin notes in document reader software.
    **Preprint**, arXiv:2509.09840. https://arxiv.org/html/2509.09840v1 — checked 2026-10-10 (full text of HTML
    version); not peer-reviewed.
14. DeStefano, D. & LeFevre, J.-A. (2007). Cognitive load in hypertext reading: a review. *Computers in Human
    Behavior*, 23, 1616-1641. https://doi.org/10.1016/j.chb.2005.08.012 — Crossref metadata only; **content not
    read**.
15. Trafton, J. G., Altmann, E. M., Brock, D. P. & Mintz, F. E. (2003). Preparing to resume an interrupted task.
    *International Journal of Human-Computer Studies*, 58, 583-603.
    https://doi.org/10.1016/s1071-5819(03)00023-5 — Crossref metadata only; **content not read**.
