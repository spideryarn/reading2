# What makes a longer summary easy to follow for someone who has not read the piece

Up: [research.md](../project/research.md)

Research done 2026-10-05 for Greg's report `spya-rntjxu`, about Summary's Fuller level:

> The brief summary is quite good, but the fuller summary often is hard for me to understand. And I
> think it's because, I mean, it's fine that it uses some jargon from the article, but you have to
> write it as if it's for someone who has not yet read the article. So I guess if you're going to
> use jargon, you have to define it.
>
> Realty though they key principle is to write the fuller summary for someone who hasn't read it yet
> rather than for someone who has.
>
> Use Sonnet for web research on what makes for a really good summary, and tweak the prompts
> accordingly.
>
> — Greg, 2026-10-05

The plan built from this is
[261005h](../plans/261005h-fuller-summary-written-for-someone-who-has-not-read-the-piece.md). The
prompt is `src/simple-summary.ts`, and the product doc is [summaries.md](../project/summaries.md).

**This is the second pass.** The first,
[261002c](261002c-what-makes-a-good-summary.md), was for the 80-word Brief: the order (goal,
finding, takeaway), results over methods, few terms each explained, and why a shorter summary
drifts denser. None of that is repeated here. This pass is about the several-hundred-word Fuller,
and one failure: a summary that reads as if the reader had already seen the piece.

**How it was gathered.** One Sonnet subagent, about thirty web searches and page fetches, on
2026-10-05. A quote marked *(fetched)* was read on the page. One marked *(search summary)* came
through a search engine's summary and was not checked against the page. Confidence is moderate.
Nearly all of it is editorial guidance from journals and style manuals; there are a few studies
behind the curse of knowledge and none behind most of the rest.

**What it did not find**, said first because it matters most: no source tests the instruction
"write for a reader who has not seen the document" on a language model, and no source measures this
particular failure in model-written summaries. ANSI/NISO Z39.14, the APA abstract guidance,
plainlanguage.gov and nature.com's own summary-paragraph page could not be read. So the prompt
change rests on the editorial consensus below and on our own measurement, not on evidence that the
wording works.

## Five findings

### 1. Every guide asks for a summary that stands on its own

- **Wikipedia's lead-section guideline** *(fetched,
  [MOS:LEAD](https://en.wikipedia.org/wiki/Wikipedia:Manual_of_Style/Lead_section))*: "The lead
  section should briefly summarize the most important points covered in an article, in such a way
  that it can stand on its own as a concise version of the article." And: "Where uncommon terms are
  essential, they should be placed in context, linked, and briefly defined."
- **Cochrane** *(fetched,
  [style manual](https://www.cochrane.org/authors/handbooks-and-manuals/style-manual/grammar-punctuation-and-writing-style/simple-and-accessible-english))*
  calls its plain-language summaries "standalone summaries", for "someone with a basic sense of the
  topic, who may not necessarily be an expert".
- **eLife's digest guide** *(fetched,
  [elifesciences.org](https://elifesciences.org/inside-elife/85518309/plain-language-summaries-how-to-write-an-elife-digest))*:
  "If you must use a few specialist or technical terms, you should always define each at its first
  use in more everyday language."

This is Greg's principle, and it is the consensus.

### 2. Context comes before the point

- **MOS:LEAD** *(fetched)*: "The lead should identify the topic, establish context, explain why the
  topic is notable, and summarize the most important points." Context is second, before the points.
- **eLife** *(fetched)*: "Include something that most readers will be able to relate to in the
  first sentence. Get gradually more specific in the following sentences."
- **Nature's summary paragraph** *(search summary; the page itself asked for a login)*: two or
  three sentences of basic introduction to the field, then the background and reason for the work,
  then the main conclusion, then what it means more widely.
- **Gopen and Swan, *The Science of Scientific Writing*** *(fetched,
  [a copy at Tufts](https://www.cs.tufts.edu/comp/105-2015s/readings/sci.html))*: "In general,
  provide context for your reader before asking that reader to consider anything new." And: "Put in
  the topic position the old information that links backward; put in the stress position the new
  information you want the reader to emphasize."

No experiment was found showing that background-first is understood better than finding-first in a
longer summary. It is what the guides agree on.

### 3. A term: defined at first use, one name kept, few abbreviations

- **Defined where it first appears, in everyday words** (eLife, above). Pinker's example is
  "Arabidopsis, a flowering mustard plant" in place of the bare name *(search summary of* The Sense
  of Style*; his wording not checked)*.
- **Jargon includes ordinary words used in a field's own sense.** eLife *(fetched)* gives
  "expression" in genetics as its example.
- **One name for one thing.** Cochrane: "avoid synonyms for key terms" *(search summary)*. Fowler
  named the fault "elegant variation": when a synonym is there only to avoid repeating a word, "the
  reader can be left wondering whether there's some significance in the change" *(search summary,
  [Wikipedia](https://en.wikipedia.org/wiki/Elegant_variation))*.
- **Abbreviations.** eLife *(fetched)*: "Use no more than three acronyms in total". That is the
  only number any guide gave for how many new terms a reader can take, and it is an editor's rule,
  not a study.
- **Meaning first or name first?** No source compares them. The guides only say the meaning must
  be there at first use.

### 4. The writer cannot see the gap, and being told about it may not help

- **Pinker** *(search summary)* calls the curse of knowledge "the single best explanation I know of
  why good people write bad prose": the writer does not notice that readers "haven't mastered the
  patois of her guild, can't divine the missing steps that seem too obvious to mention".
- **It is measured.** In Newton's tapping study, people tapping a tune predicted half their
  listeners would name it, and 2.5% did. Camerer, Loewenstein and Weber (1989) found
  better-informed people overestimated what others knew even when paid to be accurate *(both search
  summaries)*.
- **Awareness alone does not fix it.** Wikipedia's summary of the literature *(fetched,
  [Curse of knowledge](https://en.wikipedia.org/wiki/Curse_of_knowledge))* says the bias "does not
  reduce when you tell people about it or ask them to think more about the other's perspective".
  This is a secondary source about people, not models.

A summariser has just read the whole piece, so it is in an analogous position. That is an
analogy from people to a model, not a finding about models. The lesson for a
prompt: "write for someone who has not read it" is the right principle, but it is an attitude, and
on this evidence an attitude may not be enough. It needs concrete things to check.

### 5. Pointing into the piece breaks the given-new contract

- **Clark and Haviland's given-new contract** *(search summary)*: a speaker who presents something
  as already known must make sure the listener does know it.
- **Decontextualization** (Choi et al., 2021) *(abstract fetched,
  [ACL Anthology](https://aclanthology.org/2021.tacl-1.27/))*: "taking a sentence together with its
  context and rewriting it to be interpretable out of context, while preserving its meaning."
- **Coherence**, as summary evaluation defines it *(search summary,
  [SummEval](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00373/100686/SummEval-Re-evaluating-Summarization-Evaluation))*:
  a summary "should not just be a heap of related information, but should build from sentence to
  sentence to a coherent body of information about a topic".

**The application is ours, not a source's.** "The second experiment", "the authors' earlier model",
"the framework", or a phrase from the piece in quotation marks and left unexplained, each presents
as known something only a reader of the piece knows. No source discusses this case for summaries.

## What we take, and what we pass over

| idea | taken? | why |
|---|---|---|
| the reader has not read the piece; the summary stands on its own | yes, as Fuller's stated reader | Greg's principle; MOS:LEAD, Cochrane, eLife (all fetched) |
| a name the piece introduces is new to a reader who knows the field too | yes | **ours**: an application of findings 1 and 5 that no source states. An established name the reader's profile covers is not included |
| say what a term means where it first appears | already ours; now also for abbreviations, labels and quoted phrases | eLife, MOS:LEAD (fetched) |
| explain a name only as far as the piece does | yes | **ours**: the app's own rule, "only what the piece says", applied to definitions |
| one name for one thing | yes | Cochrane, Fowler (both search summary only) |
| what the reader needs first comes before the finding that needs it | yes | Gopen and Swan, eLife (fetched); Nature (search summary only) |
| nothing referred to before the summary has introduced it | yes | **ours**: an application of finding 5; Clark and Haviland (search summary only) is about speech, not summaries |
| a concrete last check, not only an attitude | yes | finding 4, which is a secondary source about people |
| leave out a name the reader does not need | yes | **ours**: the guard against over-defining; no source tests it |
| a cap on new terms or acronyms (eLife's three) | no | an editor's number with no study behind it; Brief already has a cap of two and Fuller is meant to keep more |
| a sentence cap of 35 words (eLife) | no | Fuller's is already 30 |
| analogies to make an idea concrete | no | "Only what the piece says" forbids one the piece does not make; eLife itself warns that "flowery language and convoluted analogies can be just as difficult to follow as text laden with scientific jargon" |
| results over methods, for Fuller | no | Greg asked on 2026-10-03 for Fuller to be "longer and more detailed still", and how the work was done is part of that; the method has to be explained, not dropped |
| a second model call that rewrites the summary for a new reader | no | the simpler thing is tried first: one prompt section, measured |

**Two warnings the sources give.** Defining everything makes a summary longer and can make it
patronising. And none of this is evidence that a prompt rule changes what a model writes, so the
change has to be measured: read the new summaries and count the terms left undefined and the
phrases that point into the piece.
