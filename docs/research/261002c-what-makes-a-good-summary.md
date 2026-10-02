# What makes a good summary, for a reader in a hurry

Research done 2026-10-02 for Greg's report `spya-rpqqxb`, about Summary's Brief level:

> The Briefer summary should also use slightly simpler language, and slightly less jargon, i.e.
> assume it's for someone with less expertise or in more of a hurry.
>
> And in general, do some web research on what makes for a good summary. e.g. perhaps start with
> the goal of the paper, and end with the conclusion/takeaways?
>
> — Greg, 2026-10-02

The plan built from this is
[261002h-brief-summary-plainer-for-a-reader-in-a-hurry.md](../plans/261002h-brief-summary-plainer-for-a-reader-in-a-hurry.md);
the measurement is
[261002q-brief-plainer-prompt-eval.md](../investigations/261002q-brief-plainer-prompt-eval.md). The
summary prompt itself is `src/simple-summary.ts`, and the product doc is
[summaries.md](../project/summaries.md).

**How it was gathered.** One pass of web search on 2026-10-02, by the session doing the work, with a
few pages fetched. Quotes marked *(fetched)* were read on the page. Those marked *(search summary)*
came through a search engine's summary and were not checked against the page: the AGU page answered
403, and Cochrane's template now redirects to a landing page. Confidence is moderate. These are
editorial guides and a few studies, not a systematic review.

## Four findings

### 1. Purpose, then finding, then why it matters

The journal guides agree on the order, and it is Greg's.

- **Science Societies (ASA/CSSA/SSSA)** *(fetched,
  [sciencesocieties.org](https://www.sciencesocieties.org/publications/journals/plain-language-summaries))*
  gives four elements, in order:
  - "Subject Overview (1-3 sentences)—What does a nonspecialist reader need to know"
  - "Research Purpose (1-3 sentences)—What did you set out to investigate?"
  - "Key Findings (1-3 sentences)—What was your most significant result"
  - "Key Takeaways (1-2 sentences)—Why should a reader care about your findings?"
- **AGU** *(search summary,
  [agu.org](https://www.agu.org/meetings/first-timers-guide/abstract-knowledge-center/articles/plain-language-summaries))*
  gives the same four, about 150 words in all.
- **Cochrane's plain-language template** *(search summary,
  [cochrane.org](https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/template-writing-cochrane-plain-language-summary.docx))*
  has three headings in sequence: *What did we want to find out? / What did we do? / What did we
  find?*. It puts two or three "Key messages" **first**, because "they might be the only part of the
  summary that some people read."

So "start with the goal, end with the takeaway" is the consensus for a summary read whole. Cochrane's
key-messages-first, like BLUF and the newsroom's inverted pyramid *(search summary,
[mattstromawn.com](https://mattstromawn.com/writing/bluf/))*, is for a reader who may stop after a
line. **Our Brief is about 80 words and read whole**, so the goal-first order fits it. The
bottom-line-first shape is noted as the alternative if Brief is ever cut to a single sentence.

**This was already our shape.** Since 261001p, every level opens on what the piece is about, says
why it matters, gives its key findings and ends on the takeaway. The only change is to name the
**goal** in the opening line, beside the question and the subject.

### 2. Results over methods

> "Emphasize your results—what you found and why it is important—rather than your methods"
> — Science Societies *(fetched)*

Greg's Brief spent a third of its words on the method: "A depth camera triggered closed-loop
optogenetic silencing of dorsal hippocampus during rears, only in the study phase. This was done in
a delayed win-shift radial maze task." Method is where the field terms cluster. A hurried reader
needs one plain phrase of how ("in an experiment with rats") and no more.

### 3. Jargon: few terms, each explained, and "everyday" is narrower than it feels

- Science Societies *(fetched)*: "free from jargon", "Avoid the use of abbreviations", "a ninth-grade
  level so that the PLS is easy to read for readers across a variety of disciplines".
- Cochrane *(search summary)*: explain any technical term in the key messages, **even if it is
  explained later**, and do not use terms readers might not understand.
- **Lay summaries routinely miss their own target.** A study of *Medical Mycology*'s lay summaries
  *(search summary, [Scientometrics 2023](https://link.springer.com/article/10.1007/s11192-023-04807-1))*
  found their reading grade level *higher* than the scientific abstracts', with technical terms above
  the recommended threshold in both. Kirkpatrick et al. *(search summary, via
  [The Publication Plan](https://thepublicationplan.com/2017/10/24/approaches-to-improve-the-quality-of-plain-english-in-lay-summaries/))*
  found that participants named jargon, ambiguity and complex titles as what got in the way.

The lesson for a prompt: "plain words" alone is not enough. A writer who knows the field cannot tell
which of its words are jargon (the curse of knowledge). A model writing to an expert profile has
been told it does not need to. That is the second cause of Greg's Brief: `PROFILE_RULES` tells every
prompt to "Assume the background they claim."

### 4. Shorter drifts denser, unless told what to drop

**Chain of Density** (Adams et al., 2023, *(fetched)* [arXiv 2309.04269](https://arxiv.org/abs/2309.04269)):

> "A good summary should be detailed and entity-centric without being overly dense and hard to
> follow. … humans prefer GPT-4 summaries that are more dense than those generated by a vanilla
> prompt and almost as dense as human written summaries. Qualitative analysis supports the notion
> that there exists a tradeoff between informativeness and readability."

Squeeze a summary into fewer words and the model keeps the facts and drops the connective
explanation, so each sentence carries more named things. That is exactly what Brief at 80 words did
next to Simple at 170. Simple explained *halorhodopsin* and *theta*; Brief kept both terms and
dropped the explanations. **The fix is to tell the short version what to drop: facts, not
explanations.** Fewer findings, fewer numbers and fewer terms, each one explained.

**LLMs are good at this when asked.** In the BioLaySumm shared tasks, most entrants in 2024 used
LLMs, which scored better on readability than the older fine-tuned models *(search summary,
[arXiv 2408.08566](https://arxiv.org/abs/2408.08566), [arXiv 2501.05224](https://arxiv.org/abs/2501.05224))*.
They judge on relevance, readability (Flesch–Kincaid, Dale–Chall) and factuality. We take the same
three axes for our own measure: plainness, fidelity, and whether it ends on the conclusion.

## What we take, and what we pass over

| idea | taken? | why |
|---|---|---|
| goal → finding → takeaway order | already ours; "goal" added to the opening line | the guides' consensus and Greg's suggestion |
| results over methods | yes, for Brief: one plain phrase of method at most | where Brief's jargon clustered |
| at most a couple of technical terms, each explained | yes, for Brief | Cochrane; the density finding |
| Brief written for an outsider even when the profile claims the field | yes | Greg's "assume … less expertise"; the profile licensed his jargon |
| key messages / bottom line first | no | Brief is read whole at about 80 words; the alternative if it ever becomes a single line |
| a ninth-grade target scored in code | no, a screen only | readability formulas reward short words, not understanding (prompting-guide.md § Measuring) |
| Chain-of-Density-style iterative rewriting | no | it buys density, the opposite of what Brief needs, and costs extra calls |
