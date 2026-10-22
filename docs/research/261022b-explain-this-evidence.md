# Explaining names, terms and allusions: what the evidence says

Up: [research.md](../project/research.md) · the direction it informs:
[explain-this-vision.md](../project/explain-this-vision.md) · the plan that acted on it:
[261022f](../plans/261022f-explain-this-and-a-glossary-that-scales-with-length.md)

**The question.** Greg's report `spya-e5t77w` (2026-10-21): he met *Torricelli* in Rovelli's *The
Order of Time*, did not know who that was, and nothing made it one click away. Should Spideryarn
treat glossary terms, citations and uncited names or things as one continuum of "explain this"? Should
it find candidates cheaply and write the explanation only on demand, or just ahead of the reader? And
should it search the web when the model is unsure?

**How it was made.** On 2026-10-22, a research subagent ran web and literature searches. It built on
the existing library rather than redoing it:
[261010a digest](261010a-reading-and-learning-evidence/digest.md) and files
[07](261010a-reading-and-learning-evidence/07-trusting-ai-text-vs-the-source.md),
[08](261010a-reading-and-learning-evidence/08-generating-vs-receiving.md),
[10](261010a-reading-and-learning-evidence/10-glosses-and-vocabulary.md),
[11](261010a-reading-and-learning-evidence/11-hypertext-and-split-attention.md),
[15](261010a-reading-and-learning-evidence/15-pictures-and-seductive-details.md) and
[21](261010a-reading-and-learning-evidence/21-reading-interfaces-census.md). Those already cover:

- a gloss against no gloss (Yanagisawa 2020);
- split attention, and links in the eye-tracker (Fitzsimmons 2019);
- hover previews (Maes 2006);
- ScholarPhi, Paper Plain, CiteSee and CiteRead;
- over-trust in AI text;
- self-explanation (Bisra 2018).

Everything below is new beyond them. Two design opinions from Opus subagents, prompted in opposite
directions, are summarised at the end. Labels: **strong / moderate / weak / product-anecdote**. The
subagent read most papers through abstracts and secondary sources, and says so where it matters.

## The short answer

- **Background knowledge matters, and a name the argument depends on matters most.** No study
  tests glossing proper names or allusions for adult native readers. The background-knowledge
  literature predicts that a name matters in proportion to how much the argument rests on it.
  Torricelli in Rovelli is an example, not a premise.
- **An underline is not free, even if nobody presses it.** It tells the reader *this matters*, and
  it steers a skimming eye. Text with no underline reads as less important when there are underlines
  nearby. So the density of underlines is a design decision, not a by-product.
- **A list that is incomplete gets read as complete.** What a reader needs explained varies widely,
  even between experts in one subfield. So no list fits every reader, and the only complete answer is
  letting the reader point at anything.
- **A card that has to be written on click is a different thing from a card that is already there.**
  No study measures how long a reader will wait for one, but help that arrives after the hard
  passage is worth much less than help before or during it.
- **Model accuracy falls steeply for rare people and things, and retrieval fixes that end.**
  Torricelli is not rare, so the model knew him. The miss was the cap and a rule against passing names, not knowledge. Search
  belongs to the obscure names, and even search-backed answers are often unsupported by what they
  cite.
- **Every precedent with numbers measured exploration, speed or ease, not comprehension.** Claims
  that an "explain this" feature improves understanding would be ours to test.

## 1. Background knowledge: does not knowing "Torricelli" hurt?

- **Topic knowledge predicts comprehension, sometimes more than reading skill.**
  *Moderate–strong.*
  - Recht & Leslie (1988, 64 children reading about baseball): knowing baseball mattered more than
    reading level ([summary](https://en.wikipedia.org/wiki/Baseball_Study);
    [critique](https://www.shanahanonliteracy.com/blog/prior-knowledge-or-he-isnt-going-to-pick-on-the-baseball-study)).
  - O'Reilly, Wang & Sabatini (2019, *Psychological Science*, N = 3,534 high-school students) found
    a threshold. Below about 59% on a topic test, knowledge barely related to comprehension
    (β ≈ 0.18); above it, the relationship was strong (β ≈ 0.81).
    ([paper](https://journals.sagepub.com/doi/10.1177/0956797619862276)) *Moderate*: one topic, and
    correlational. Missing knowledge does not cost a little at a time; below some level the passage
    stops making sense.
  - Smith, Snow, Serry & Hammond (2021, *Reading Psychology*) reviewed 23 studies, all of children.
    The effect depends on the text and the situation model it asks for, and low-knowledge readers
    gain more from cohesive text.
    ([summary](https://www.readingrockets.org/resources/resource-library/role-background-knowledge-reading-comprehension-critical-review))
  - McNamara & Kintsch (1996): prior knowledge feeds the situation model. Low-knowledge readers need
    explicit coherence. *Moderate.*
- **Timing.** Bransford & Johnson (1972): a context-setting title given *before* a hard passage
  roughly doubled recall. The same help given *after* did about as little as none. *Strong* for the
  effect; the numbers come from secondary sources.
- **Advocacy, not evidence.** Hirsch's knowledge-rich-curriculum argument goes well past the lab
  results. Its best causal support is at curriculum level (Grissmer et al. 2023, a Core Knowledge
  lottery study: about +16 percentile points; [EdWorkingPaper 755](https://edworkingpapers.com/sites/default/files/ai23-755.bib)),
  and that says nothing about a hover card.
- **Proper names are almost unstudied.**
  - Klassen (2021, *Language Teaching*, [doi](https://doi.org/10.1017/S026144482100015X)) points out
    that vocabulary research assumes names are known.
  - The one experiment Klassen cites, Kobeleva (2012), was about listening, with 110 second-language
    learners. Unfamiliar names hurt understanding of the details, and listeners took names for
    common nouns ([thesis](https://openaccess.wgtn.ac.nz/articles/thesis/The_Impact_of_Unfamiliar_Proper_Names_on_ESL_Learners_Listening_Comprehension/16945726)).
  - *Weak, and only by analogy.*

## 2. Underlines, glosses and density

- **Underlining changes what readers think matters.**
  - Jayes, Fitzsimmons, Weal, Kaakinen & Drieghe (2022, *PLOS ONE*) used Wikipedia text. Sentences
    with links were rated more important, and sentences *without* links were rated less important
    when the passage around them had links.
    ([paper](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0263669))
    *Weak–moderate.*
  - Fitzsimmons et al. (2020, *PLOS ONE*): reading for comprehension, readers process linked and
    unlinked words alike. When skimming, they fully process only the linked ones.
    ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC7497986)) *Weak–moderate.*
  - Underlining every name would lift side examples to the level of the key terms. That is the
    seductive-details risk of file 15, carried by typography.
- **Signalling helps a little, most for low-knowledge readers.** Richter, Scheiter & Eitel (2016)
  meta-analysed 27 studies (N = 2,464) and found r = 0.17. *Moderate*, and the studies were
  multimedia rather than prose.
- **Which terms a reader needs varies by reader.** Guo et al. (NAACL 2024) had 11 researchers make
  10,000+ familiarity judgements. Which terms counted as jargon "varied widely across annotators,
  even within the same sub-domain."
  ([arXiv 2311.09481](https://arxiv.org/abs/2311.09481)) *Moderate.*
- **A cheap detector over-flags.** Reading.help (CHI '26,
  [arXiv 2505.14031](https://arxiv.org/html/2505.14031v2)) underlines hard words and sentences ahead
  of time with a cheap model, and explains them on demand. *Weak* (N = 15 pilot, 5 final).
  - Tuned to catch 88% of the hard items, only 18% of its underlines were right. Tuned stricter, 38%
    were right and it caught 48%.
  - Expert raters judged 7–12% of the explanations invalid.
  - Long explanations overwhelmed the readers.
  - This is the closest working precedent for a two-stage design, and it shows what that design
    trades.
- **ScholarPhi, in more detail than file 21** (Head et al., CHI '21,
  [ar5iv](https://ar5iv.labs.arxiv.org/html/2009.14237)). *Weak* (N = 9 and 27).
  - Readers avoided looking things up because it was a context switch out of the headspace a hard
    passage needs.
  - Subtle single-colour underlines, shown only where a definition existed, were not felt as
    distracting. Multi-colour highlighting was dropped as clutter.
  - Definitions were *position-sensitive*: the most recent one before the point where the reader
    asked.
  - Tooltips were the most-used feature, and the up-front glossary the least.

## 3. How long a reader will wait

- **The thresholds.** Nielsen, Miller and Card: about 0.1 s feels instant, about 1 s keeps the train
  of thought, about 10 s loses attention
  ([NN/g](https://www.nngroup.com/articles/response-times-3-important-limits/)). *Weak–moderate*
  heuristics, none of them about reading.
- **No study measures how long a reader will wait for an on-demand gloss.**
- **Wikipedia's Page Previews** opens a card only after 500 ms of hover, so a short deliberate delay
  is normal. After that, the content has to be there at once
  ([A/B tests](https://www.mediawiki.org/wiki/Page_Previews/2017-18_A/B_Tests)).
- **A slow answer can look more thoughtful.** Tan et al. (preprint,
  [arXiv 2604.06183](https://arxiv.org/abs/2604.06183)) found that people rated 2-second chat answers
  as *less* thoughtful than slower ones. That was chat, not reading; do not borrow it for a card.

## 4. Product precedents

| Product | What it does | Measured? |
|---|---|---|
| **Wikipedia Page Previews** | Hover card on internal links | **Large A/B tests** (2017–18; 53 million sessions in one). Pageviews per session −3–5%. Distinct pages engaged with **+20–22%**. About **0.01%** of sessions turned it off. *Strong* for behaviour; nothing on comprehension. [results](https://www.mediawiki.org/wiki/Page_Previews/2017-18_A/B_Tests) |
| **Kindle X-Ray / Word Wise** | X-Ray: a per-book list of people, terms and places. Word Wise: hints above hard words, with a density slider | No public data. *Product-anecdote.* Word Wise puts gloss density under the reader's control. |
| **Play Books look-up, Readlang, LingQ** | Select a word, get a dictionary, Wikipedia or translation entry | Vendor claims only |
| **Explainpaper, Scholarcy, SciSpace** | Highlight a passage, get an LLM explanation | No published evaluations found |
| **Reading.help** | Underlines ahead of time, explains on demand | See § 2 |
| **StopGap** (CHI '25, [arXiv 2503.00715](https://arxiv.org/abs/2503.00715)) | Real-time jargon explanations in video, N = 24 | Readers' preferred formats differed. The authors stress reader control. *Weak* |

## 5. "Explain this sentence"

- **What file 08 already found.** Self-explanation beats nothing (g = 0.67), and beats a supplied
  explanation by a smaller margin (g = 0.35). So a supplied explanation gets back most of the
  benefit.
- **Why explanations fail.** Wittwer & Renkl (2008, *Educational Psychologist*) argue they fail when
  processed passively. They work when they fit what the learner knows, focus on concepts, and are
  followed by something the learner has to do. *Moderate* (a review, read through secondary
  sources).
- **Elaborate beside the text, don't replace it.** In second-language reading, adding paraphrase or
  definitions alongside the original wording matches or beats simplifying it, and keeps the author's
  language (Yano, Long & Ross 1994, N = 483). Simplifying helped low-proficiency readers more (Rets &
  Rogaten 2021). *Weak–moderate*, by analogy.
- So "explain this sentence" belongs **beside** the author's sentence, never in place of it. For a
  sentence the reader wants to understand, an optional *say what you think it means first* is where
  the self-explanation evidence points.

## 6. Wrong or over-trusted explanations of named things

- **Accuracy falls with rarity.** FActScore (Min et al., EMNLP 2023,
  [ar5iv](https://ar5iv.labs.arxiv.org/html/2305.14251)) scored biographies. ChatGPT went from about
  80% supported facts on frequent entities to about 16% on rare ones. A search-backed model fell
  too, by about half. *Strong* as a benchmark; models have improved since.
- **Bigger models mostly learn the popular facts; retrieval fixes the rare end.** Mallen et al. (ACL
  2023, [arXiv 2212.10511](https://arxiv.org/abs/2212.10511)) found that retrieving *only when the
  entity is less popular* improved accuracy and cut cost. Kandpal et al. (ICML 2023): accuracy tracks
  how many training documents mention the entity. *Strong.*
- **Search does not make an answer trustworthy by itself.** Liu, Zhang & Liang (2023,
  [arXiv 2304.09848](https://arxiv.org/abs/2304.09848)) audited generative search engines. Only
  51.5% of sentences were fully supported by their citations, and fluency ran *opposite* to
  verifiability. *Strong.*
- **What it means here.** Torricelli is a popular entity, and the model knows him. The risk is the
  obscure name: a minor correspondent, a cited lab, a local event.

## Two design opinions (Opus subagents, 2026-10-22)

**One was prompted as a sceptical learning scientist.** Its verdict: make the count follow the
length, keep one density rule, and do not build the continuum or underline candidates in bulk yet.

- It sees explaining a *referent* (who Torricelli was) as augmenting: it supplies what the author
  assumed, as a footnote in a good edition does.
- It sees a model-placed "this sentence is hard" underline as replacing: it tells the reader not to
  wrestle with the sentence, and takes away the confusion signal
  [vision.md](../project/vision.md) calls the most valuable input there is.
- A reader-chosen "explain this" is fine. A "guess first" step on it is better.

**The other was prompted as a pragmatic engineer.**

- It traced the miss to the quota: 20 chosen from a book by centrality leaves a name used once last
  by construction.
- It recommended splitting the book into stretches, each with its own quota. GPT Sol's plan review
  rejected that (duplicates across calls, partial failure, cache fan-out) in favour of one call with
  the count unclamped, which is what was built, with a part-by-part line in the prompt.
- It costed that at about $0.70–1.40 a book on Sonnet, against $0.25–0.35 today.
- It found that a reader's *Look up a term* already streams, may search the web, and adds the entry.
  It also found that selecting a passage already offers *Explain this passage* (comments.md).
- It sized the two-stage design honestly: several stages, needing a new entry state, a second
  underline, streaming into the card, a prefetch scheduler, and an allowance so strangers cannot spend
  on clicks.

## The biggest gaps

- No study on glossing proper names or allusions for adult native readers.
- No reading-specific study of how long a reader will wait for a card.
- Nothing on whether a cheap first-pass underliner helps or clutters at the precision such detectors
  reach: 18–38% of underlines correct in Reading.help.
