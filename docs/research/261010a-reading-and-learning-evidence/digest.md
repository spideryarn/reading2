# What the evidence says about how Spideryarn helps people read

Up: [reading-research-overview.md](../../project/reading-research-overview.md) · the plan:
[261010q](../../plans/261010q-reading-and-learning-evidence-library.md) · written 2026-10-10 from the
twenty-one topic files beside this one.

Greg asked, on 2026-10-09:

> I'd like to think through and build up a library of peer-reviewed evidence about how to read and
> learn deeply and efficiently. … I'm equally interested in research that suggests a better way to do
> things, as well as research that corroborates the way that we are doing things.

This file is the digest. It takes the product's claims one at a time — "asking the reader to recall
before showing the answer helps them keep it" — and says how well the evidence in the twenty-one
topic files supports each claim. Then it goes mode by mode. It **owns the conclusions**: the topic
files own the evidence and the citations, and every verdict here names the file to open for them.

## How to read the verdicts

Each claim gets one of five verdicts, kept distinct on purpose. A row can carry more than one only
when it separates outcomes or separates the shipped design from a neighbouring design:

| Verdict | Means |
|---|---|
| **Supported** | Good evidence, in people and material reasonably close to ours. |
| **Supported indirectly** | Good evidence, but in students, short passages, school maths, or a lab task; we are assuming it carries over. |
| **Untested** | Nobody has tested it in any setting close enough to count. Not the same as wrong. |
| **No reliable effect** | Tested, and the effect is absent or too small to rely on. |
| **Evidence of harm** | Tested, and it made things worse on some outcome that matters. |

Each topic file grades every finding twice: **certainty** (High / Moderate / Low / Contested) and
**directness** to our readers (Direct / Indirect / Analogy). An expert adult reading a research paper
in their own field is almost never the person studied. Only a handful of the graded findings are
Direct, and most of those are about the text (how often an LLM summary overgeneralises)
or about readers in general (how fast adults read), not about what our readers learn. **Read every
verdict below with that in mind.**

**One more caution, about the library itself.** Publisher sites blocked automated reading, so most
sources were read at abstract level, through Crossref, OpenAlex, Europe PMC or Semantic Scholar
records. Each file marks which sources were read in full. All 370 cited DOIs were resolved against
Crossref on 2026-10-10. 307 matched their citation line automatically. The other 63 were checked by
hand and each resolves to the paper it is cited as: most failed the automatic match only because the
title sits on a different line from the DOI, and one is registered outside Crossref but resolves at
doi.org. The researchers themselves caught and corrected at least ten wrong DOIs among the leads
they were given. Before any number here goes into marketing copy, open
the paper.

## The short answer

1. **The best-supported thing Spideryarn does is make the reader produce something, then show them
   the text.** Learn's Recall, Quiz and the self-explanation shape of Explore sit on the strongest
   evidence in the library: retrieval practice, self-explanation, and feedback against the source.
   It is supported indirectly — students and short prose — but it is the sturdiest ground we stand on.
   ([01](01-retrieval-practice.md), [02](02-prequestions-and-metacomprehension.md),
   [08](08-generating-vs-receiving.md))
2. **"Augment, don't replace" has indirect evidence behind it now, from 2025.** Three randomised studies
   point the same way. An unguarded chatbot raised practice scores and lowered later unaided scores
   by 17% (Bastani et al., about 1,000 pupils, school maths). LLM-only study lost to note-taking on a
   three-day reading test (Kreijkes et al., 405 pupils). An AI summary that replaced the passage
   helped weak readers and hurt strong ones (Etkin et al., 195 young adults, with a caveat about the
   split). None is about experts reading papers. This is not evidence that offloading is inherently
   bad: in lab tasks, intending to learn nearly removed its memory cost, and saving material could
   improve memory for what came next. Design and intent matter. ([04](04-ai-tutors-and-llms-in-learning.md),
   [06](06-cognitive-offloading.md), [07](07-trusting-ai-text-vs-the-source.md))
3. **In three small controlled studies, reading tools made reading faster or easier without a
   detected correctness gain.** ScholarPhi, Scim and Paper Plain used 19–27 people in short tasks;
   speed or perceived ease moved, while answer correctness did not. AI help can also inflate confidence. A tool that feels
   better while the reader understands no more is the failure we are most exposed to, and we measure
   none of it today. ([21](21-reading-interfaces-census.md), [06](06-cognitive-offloading.md))
4. **Most of what the model makes for the reader — summaries, the tree, Sketch, FAQ — is supported
   only as an orienting aid.** Being handed a good explanation or organiser can help. Generating a
   self-explanation adds a modest benefit over receiving one, but constructing a map does not reliably
   beat a good supplied map and can lose to it. The
   help shrinks, and can reverse, as the reader knows more (expertise reversal). Our readers are
   often the experts. ([05](05-summaries-organisers-and-coherence.md),
   [08](08-generating-vs-receiving.md), [16](16-maps-diagrams-timelines.md))
5. **Timing matters, in two different ways.** Immediate retrieval after reading can improve retention
   on a test days later; it is the *final test*, not necessarily the first retrieval attempt, that must
   be delayed for that comparison. Separately, readers judge their own understanding better when a
   generation task is delayed. Learn and Quiz are offered when reading ends and nothing brings the
   reader back, but whether moving the first attempt later improves retention is untested here. ([01](01-retrieval-practice.md),
   [02](02-prequestions-and-metacomprehension.md))
6. **Greg's glossary worry is not supported, but it is not refuted either.** A gloss beats no gloss
   for learning words, so easy look-up does not cancel learning compared with no help. But nobody has
   compared "show it" with "guess first, then show it", and the memory literature makes a benefit
   from guessing first plausible. That is a cheap experiment, not a finding. ([10](10-glosses-and-vocabulary.md))
7. **Voice is faster and fuller. That it helps learning is not shown.** Speech is about three times
   faster than phone typing, and spoken answers carry more words and topics. Spoken versus written
   explanation is mixed. The one voice-versus-text AI tutor study (a preprint) found more interaction,
   higher cost and no learning gain. ([14](14-speaking-vs-typing.md))
8. **Keeping the article's own words available is the safer instinct, for reasons beyond trust.** Wrong
   automated advice drags people below what they manage alone. In one study, several LLMs overgeneralised
   science at several times the rate experts did, though model results varied. Citations raised trust overall;
   only 9.8% were hovered, and checking was associated with lower trust. An
   LLM fact-check that correctly labelled 90% of the false headlines still did not help people tell
   true from false. Summary error rates varied sharply by model and prompt. So
   verbatim quotes, answers made of passages, and "no verdict" in Referee are well chosen — and the
   model-written parts around them (role lines, reasons, questions) are the exposed part.
   ([07](07-trusting-ai-text-vs-the-source.md), [18](18-critical-reading-and-sourcing.md))
9. **Some things are settled no.** Speed reading and RSVP give no free gain. "Bionic reading" does
   nothing. Hard-to-read fonts as a "desirable difficulty" failed to replicate. One earlier belief
   of ours is corrected: pre-highlighting is not "the worst" idea. Accurate marks help a little;
   *wrong* marks hurt comprehension and calibration. ([12](12-skimming-and-speed-reading.md),
   [17](17-typography-and-decoration.md))
10. **The biggest gap is our own readers.** No study in the library measures what expert adults
    retain from a full research paper days later, with or without a tool. The reader-study protocol
    ([260910a](../../investigations/260910a-reader-study-protocol-do-the-reading-tools-help-understanding.md))
    is already stronger than most of the published reading-tool evaluations, and running it is the
    single most informative next step. ([21](21-reading-interfaces-census.md))

## The claims, one by one

The product claims Spideryarn rests on, each with the outcome it is about, what the evidence says,
and the verdict. Certainty and directness are the topic files' grades for the best evidence on the
claim. "Outcome" names what was measured, because a tool can help one outcome and harm another.

| # | Claim | Modes | Outcome | Evidence | Certainty · directness | Verdict | File |
|---|---|---|---|---|---|---|---|
| C1 | Recalling the piece beats re-reading it for keeping it | Recall, Quiz | delayed retention | Testing effect on prose; g ≈ 0.5 across 222 classroom studies; holds on ~2,500-word journal papers | High · Indirect | **Supported indirectly** | [01](01-retrieval-practice.md) |
| C2 | Feedback is especially important when recall is difficult or initial success is low | Recall, Quiz | delayed retention | Free recall without feedback produced delayed gains on short prose; on journal papers, difficult short-answer testing beat re-reading only when the answer was shown afterwards | Moderate · Indirect | **Supported indirectly** | [01](01-retrieval-practice.md) |
| C3 | Recall can transfer to new questions, not only repeated ones | Recall, Quiz | transfer | d ≈ 0.40 across 192 effects; whole-paragraph recall transferred, fill-in-the-blank mostly did not; transfer to understanding complex material remains contested | Moderate / Contested · Indirect | **Supported indirectly** | [01](01-retrieval-practice.md) |
| C4 | Moving the first Recall or Quiz attempt to later would improve it | Learn, Quiz | delayed retention, calibration | Immediate retrieval produced better retention on tests days later; a delayed generation task improved calibration | Moderate–High · Indirect | **Supported indirectly** for calibration; **untested** for improving retention by moving the first attempt | [01](01-retrieval-practice.md), [02](02-prequestions-and-metacomprehension.md) |
| C5 | Readers judge their own understanding poorly | all | calibration | r ≈ 0.24 between predicted and actual comprehension across 94 studies; AI help can inflate confidence | High · Indirect; Moderate · Indirect | **Supported indirectly** | [02](02-prequestions-and-metacomprehension.md), [06](06-cognitive-offloading.md) |
| C6 | Explaining it to yourself helps | Explore, Tutorial, Comments | comprehension | Self-explanation g = 0.55, g = 0.79 for text; but only g = 0.35 over being given the explanation | Moderate · Indirect | **Supported indirectly** | [08](08-generating-vs-receiving.md) |
| C7 | Small contingent steps, with help before the learner stays stuck | Tutorial, Recall hint ladder | learning | Tutoring effects range from ≈ 0.29 to 0.8 SD by setting; insurmountable difficulty is not useful; fading has thin support | Moderate · Analogy | **Supported indirectly**; the exact two-rung “never fail twice” rule is **untested** | [03](03-scaffolding-and-desirable-difficulty.md) |
| C8 | A guardrailed, hint-giving AI tutor is safer than unrestricted AI | Learn, Tutorial, Chat | later unaided performance | Bastani: unrestricted −17%; a package of teacher solutions, common mistakes, stepwise hints and answer-withholding had no drop, but no gain | Moderate · Indirect | **Supported indirectly** for the package, not any one component | [04](04-ai-tutors-and-llms-in-learning.md) |
| C9 | A summary beside the article helps the reader | Summary, Ideas, Thread | comprehension | Advance organisers help conditionally; no study of a summary *beside* a long article; when summaries replaced passages, the independently defined strong-reader group fell by d = 0.35 and the weak-reader gain vanished | Moderate · Indirect; Low–Moderate · Indirect | **Untested** for our design; **evidence of harm** in one low-certainty substitution study | [05](05-summaries-organisers-and-coherence.md), [07](07-trusting-ai-text-vs-the-source.md) |
| C10 | Help should adapt to the reader's prior knowledge | Summary levels, profile, Structure, cross-refs | comprehension | Expertise reversal: high assistance d = +0.51 for novices, low assistance d = −0.43 favoured for experts (meta-analysis, design tasks) | Moderate · Indirect | **Supported indirectly** | [05](05-summaries-organisers-and-coherence.md), [03](03-scaffolding-and-desirable-difficulty.md) |
| C11 | Seeing the structure helps | Structure, generated headings | memory for topics | Headings and overviews improve mostly immediate memory for topics and organisation, especially for complex structure; related multimedia-signalling studies suggest larger benefits for lower-knowledge readers; partial signalling hurts unsignalled material and can trade detail for breadth | Moderate · Indirect; Moderate · Analogy on prior knowledge | **Supported indirectly**, with cautions | [13](13-headings-structure-signalling.md) |
| C12 | Model-made headings are as good as an author's | generated headings | — | Nothing found | — | **Untested** | [13](13-headings-structure-signalling.md) |
| C13 | Skimming gets the gist efficiently | Skim | gist vs detail | Ordinary skimming keeps important ideas, loses detail and inference, and depends on easy navigation; Scim was faster with no accuracy gain | Moderate · Indirect | **Supported indirectly** for ordinary triage; the model-chosen three-pass route is **untested** | [12](12-skimming-and-speed-reading.md), [21](21-reading-interfaces-census.md) |
| C14 | Showing original passages avoids paraphrase error in those passages | Quotes, Skim, FAQ, cross-refs | textual fidelity, calibrated trust | In one study several LLMs overgeneralised (OR ≈ 4.85 against expert summaries), but rates varied by model and another study found far fewer errors; a low-certainty preprint favoured showing passages over model explanations | Moderate · Direct on summary text; Low · Indirect on reader judgement | **Supported indirectly** for avoiding paraphrase risk; **untested** for improving calibrated trust | [07](07-trusting-ai-text-vs-the-source.md) |
| C15 | A source link raises trust more often than it prompts checking | Summary, Chat, cross-refs | verification | Even random citations raised trust; 9.8% of referenced answers had a citation hovered; checking was associated with lower trust | Low–Moderate · Indirect | **Supported indirectly** | [07](07-trusting-ai-text-vs-the-source.md) |
| C16 | A model's verdict on a claim can harm readers' judgement | Sources, Referee (by contrast) | discernment | An LLM labelled 90% of false headlines correctly but did not improve overall discernment; where it mislabelled or was unsure, it moved belief the wrong way; human fact-checks helped | Moderate · Indirect | **Evidence of harm** — supports our “no verdict” rule | [18](18-critical-reading-and-sourcing.md) |
| C17 | Easy look-up does not stop the reader learning the term | Glossary | vocabulary | Glossed reading beats unglossed (45% vs 27% of words immediately); on-demand expert reading and “guess then check” are untested | Moderate · Analogy | **Supported indirectly** against no help; **untested** for our on-demand design and against guessing first | [10](10-glosses-and-vocabulary.md) |
| C18 | Keeping the explanation next to the text helps | hover cards, marginalia, the band | learning | Spatial contiguity g ≈ 0.6; shrinks or reverses for experts; "closest" is not always best | High · Analogy | **Supported indirectly**, weaker for experts | [11](11-hypertext-and-split-attention.md) |
| C19 | The reader's own highlights help | Comments | memory vs comprehension | Learner highlighting +0.36 memory and no reliable comprehension gain; evidence for notes and later review is stronger but not close to our design | Moderate · Indirect | **Supported indirectly** for memory; **no reliable effect** on comprehension | [09](09-annotation-highlighting-notes.md) |
| C20 | Model-chosen highlights help | Quotes marks, decorated | memory, calibration | Instructor-chosen highlights averaged ≈ +0.44, but a later digital experiment found no effect; inaccurate highlights hurt comprehension and calibration; model selection is untested | Low–Moderate · Analogy / Indirect | **Untested** for model choices; mixed indirect evidence for accurate other-chosen highlights; **evidence of harm** if wrong | [09](09-annotation-highlighting-notes.md), [17](17-typography-and-decoration.md) |
| C21 | Voice is faster and people say more | Dictation, Live, Learn | speed, quantity | ≈ 2.9× faster than phone typing; more words and topics in spoken survey answers, but not necessarily better-organised or more accurate ones | High · Analogy; Moderate · Indirect | **Supported indirectly**, for phone entry and quantity | [14](14-speaking-vs-typing.md) |
| C22 | Voice helps learning | Live, Learn | learning | Oral vs written explaining is mixed; one voice-tutor preprint found no gain and 2.8× cost | Low · Indirect | **Untested** for our reading design | [14](14-speaking-vs-typing.md) |
| C23 | A picture of the argument helps | Sketch, Diagram, Timeline | comprehension, recall | Supplied maps can help modestly; author-made organisers beat learner-made ones on transfer in a direct test; one N = 14 machine-map study found no accuracy gain and no study tested delayed learning | Low–Moderate · Indirect | **Supported indirectly** (weakly) for supplied organisers; **untested** for our machine-drawn modes | [16](16-maps-diagrams-timelines.md) |
| C24 | A painted illustration helps | Illustrated | learning, motivation | Decorative pictures ≈ neutral; seductive details hurt; emotional design has small gains; AI-made and misleading pictures are not adequately tested | Low–Moderate · Indirect | **Untested** as built; **no reliable effect** for purely decorative pictures; **evidence of harm** for seductive details | [15](15-pictures-and-seductive-details.md) |
| C25 | A reading goal changes what the reader learns | reader profile, purpose | goal-relevant recall | An assigned goal improves recall of relevant parts and *lowers* recall of the rest; a later shift of perspective recovers some | Moderate · Analogy | **Supported indirectly**; asking for a purpose and conditioning model output on it are **untested** | [20](20-purpose-motivation-personalisation.md) |
| C26 | Returning places rather than synthesised answers is safer for learning | Search, chat tools | learning | Synthesised answers in place of sources produce shallower learning; goal-led reading narrows; within-document search is untested | Moderate · Analogy | **Supported indirectly** as a design principle; Search as built is **untested** | [19](19-search-and-foraging.md) |
| C27 | Checking outside the document helps judge source credibility | Sources (Reception, Claims) | source evaluation | Lateral reading and source evaluation work for students judging websites; whether they help judge a paper's argument is untested | Moderate · Indirect / Analogy | **Supported indirectly** for source credibility; **untested** for a paper's argument and for Sources as built | [18](18-critical-reading-and-sourcing.md) |
| C28 | Reviewers need help noticing flaws | Referee | error detection | 607 BMJ reviewers found ≈ 2.6 of 9 planted major errors; one training result found only a small improvement, with low certainty | Moderate · **Direct** on the need; Low · Direct on training | **Supported** for the need | [18](18-critical-reading-and-sourcing.md) |
| C29 | Distinct typefaces for author, model and reader | fonts | provenance | Nothing tested; typeface within normal ranges does not change comprehension | — | **Untested** (low risk) | [17](17-typography-and-decoration.md) |
| C30 | Speed reading, RSVP, bionic bolding, disfluent fonts | none (rejected) | comprehension, time, confidence | No reliable benefit; high-speed RSVP clearly harms comprehension; Bionic was null in four studies with a cost in one; a 25-article disfluency meta-analysis found recall d = −0.01 and transfer d = 0.03, while time and confidence worsened | Moderate–High · Indirect | **No reliable effect** on learning; **evidence of harm** for high-speed RSVP and some costs — keep rejecting | [12](12-skimming-and-speed-reading.md), [17](17-typography-and-decoration.md) |

## Mode by mode

What each mode claims, what the evidence says, and the idea it points at. Ideas are proposals for
Greg, not decisions; they are collected at the end with a rough sense of ease and value.

### Learn: Recall

**What it does.** The reader says or types what they took from the piece. The model corrects at most
once, links the passage, nudges them to remember more, and tells them after two rungs of hints
([learn-mode.md](../../project/learn-mode.md)).

**What the evidence says.** This is the best-supported mode we have. Free recall of the whole text is
the format of the strongest retrieval experiments, an attempt followed by the answer is what the
feedback results favour, and the hint ladder is consistent with both the finding that success rate
matters more than format and the limit on desirable difficulty; its exact two-rung rule is untested
(C1–C3, C7). It is also structurally similar to the delayed-summary task that improves calibration —
but only if there *is* a delay (C4, C5).

**Verdict.** Supported indirectly. Immediate retrieval is compatible with the retention evidence.
Whether a second, delayed attempt adds retention is untested; a delayed generation task is supported
indirectly for calibration.

**Ideas.** A “come back tomorrow” Recall after the immediate attempt (spacing is already named in
[learning-vision.md](../../project/learning-vision.md) as "the strongest effect in the literature" and
is not built). Tell the reader that struggling to recall is expected and is the point.

### Quiz

**What it does.** Up to a dozen-odd short-answer questions, easy and central first, each marked
against the article's own passages, with a reference answer behind a control and no grade
([quiz.md](../../project/quiz.md)).

**What the evidence says.** Short answers with feedback were the best format on journal-length papers,
and easy-first is intended to raise the success rate that matters, though that ordering was not itself
tested (C1, C2). Marking against passages the reader can
open is the kind of standard that improves calibration (C5).

**Verdict.** Supported indirectly.

**Ideas.** A confidence rating before the mark, with a quiet running record of "you were sure and
wrong". Mix inference questions in with recall ones, since transfer depends on practising the kind
of thinking you want. Offer it again after a delay.

### Learn: Tutorial and Explore

**What they do.** Tutorial teaches in small cited pieces, each turn a reaction, a quoted piece of the
article and one task, stepping up and down with the reader. Explore prompts the reader's own thinking
one move at a time ([learn-mode.md](../../project/learn-mode.md)).

**What the evidence says.** Small steps with feedback are where tutoring's benefit lives, and reported
effects range from about 0.29 SD in broad school trials to about 0.8 in other tutoring comparisons,
not Bloom's 2 (C7). The guarded tutor in Bastani avoided harm but produced no
gain on its own exam (C8). Self-explanation ("why does this follow?") is the best-supported generative
act for text, but its edge over simply being given a good explanation is small (C6). For an expert,
help tuned to a novice can hurt (C10).

**Verdict.** Tutorial is supported indirectly, with the qualifier that "safe" and "helpful" are
different results. Explore is untested as built; its why/how self-explanation shape is supported
indirectly.

**Ideas.** A one-question check at the start ("which of these statements does the piece support?")
to set the level, instead of inferring it from the profile — Kalyuga's rapid test is a tested way to
do this. End a Tutorial pass with something the reader produces (a note, a Recall turn), since the
LLM-only arm is the one that lost in Kreijkes. Phrase Explore's moves as "why" and "how", not "what".

### Chat and Live conversation

**What they do.** A chat with tools that reach the article, the reader's notes and the web, with
citation chips to passages; Live is the same thread spoken ([chat-tools.md](../../project/chat-tools.md),
[live-conversation.md](../../project/live-conversation.md)).

**What the evidence says.** Chat is the mode closest to the anti-goal. One 2025 trial found lower
later unaided performance without students recognising the loss; separate experiments find that AI
can inflate confidence. An exploratory preprint
analysis associated requests for explanations with better understanding and requests for solutions
with worse; citations work as trust cues more readily than checks (C8, C15). Voice raised interaction
but not learning in one preprint (C22).

**Verdict.** Untested for reading; the nearest evidence is a caution.

**Ideas.** Measure how often a chat answer's chips are pressed — the cheapest check on whether chat
behaves like a reading aid or like a replacement. Sometimes ask "what do you think?" before
answering. Say plainly in Live that its case is fluency and preference, not proven learning, and
watch its cost.

### Summary (Brief, Fuller, Thread)

**What it does.** Model-written paragraphs at two depths, each linked to the passages it rests on,
checked by a fidelity guard; Thread is the same as a numbered thread
([summaries.md](../../project/summaries.md), [tweets.md](../../project/tweets.md)). Its own doc says:
"No evidence it helps."

**What the evidence says.** An orienting passage ahead of detail is the advance-organiser idea, which
helps "if used in appropriate situations" (C9). The same help tends to fade or reverse for readers who
know the field (C10). In Etkin et al.'s headline split, replacing the text with a summary helped weak
readers and hurt strong ones; with independently defined groups, the weak-reader gain vanished and
the strong-reader loss shrank. Paper Plain's gist-only reader rated their understanding highly and scored 2/7
(C9; [21](21-reading-interfaces-census.md)). Some models and prompts overgeneralise science, while
another study/configuration produced far fewer errors; within the first study, the Claude models did
not differ significantly from the originals. Error rates are model-, prompt- and input-dependent. The fidelity
guard cannot catch an overgeneralisation that the cited passages do not contradict (C14). The
reverse-cohesion claim — experts learn more from gappier text — is itself contested (see
§ Disagreements).

**Verdict.** Untested as built (beside the article). Evidence of harm if it becomes a substitute for
reading, especially for strong readers.

**Ideas.** For readers who say they know the field, ask for their own one-line gist before showing the
Brief. Test the fidelity guard on overgeneralisation specifically. Keep the summary a press, never a
default.

### Ideas ("what you need to bring")

**What it does.** Lists the ideas an article leans on without stating, and those it puts forward,
judged against the reader's profile ([ideas.md](../../project/ideas.md)).

**What the evidence says.** This is closer to Ausubel's actual advance organiser — the missing
background concepts — than a summary is, and tailoring it to what the reader knows is what expertise
reversal recommends (C9, C10).

**Verdict.** The organiser rationale is supported indirectly; Ideas as built is untested.

### Structure and generated headings

**What it does.** The article's tree, labels and gists, in the band; headings generated only where the
author's are missing or uninformative ([structure.md](../../project/structure.md),
[structure-step.md](../../project/structure-step.md)).

**What the evidence says.** Visible topic structure improves mostly immediate memory for the topics
and their organisation — the signalling literature's best result (C11), chiefly for complex
structure. Related multimedia-signalling studies, only an analogy for headings, suggest larger gains
for lower-knowledge readers. Three cautions. When only *some* topics are signalled, the
unsignalled ones are remembered worse than in a text with no signals. And signals
trade detail for breadth. Model-made headings have never been compared with authors' (C12). Building
the outline yourself is not clearly better than being handed a good one (C23).

**Verdict.** Supported indirectly for complex structure; the lower-knowledge moderator is analogical,
and the tree as built and model headings are untested.

**Ideas.** Make the tree's coverage even, or say where labels are missing, so a half-labelled article
does not leave its unlabelled half less remembered. Generate headings only for long or complex flat
articles, where signalling helped.

### Skim

**What it does.** A route through stored quotes, walked three times at increasing depth, each stop in
the real prose with a cue saying what to look for ([skim.md](../../project/skim.md)).

**What the evidence says.** Skimming keeps the important ideas and loses detail and inference, and its
benefit depended on easy navigation — which Skim's stepping and stop-ringing supply (C13). Scim, the
nearest published system, was faster with no accuracy gain, and no help when the answer was off the
highlighted path. Showing the article's own words rather than a summary is the safer shape (C14). The
stops on pass one may be favoured in memory, because a preview mainly helps what it points
at (C13 with [02](02-prequestions-and-metacomprehension.md)). No rigorous trial of three-pass reading,
SQ3R or Keshav's method exists.

**Verdict.** Ordinary skimming is supported indirectly as triage. The model-chosen three-pass route is
untested, including as a way to understand more.

**Ideas.** Say plainly, in the mode and its doc, that Skim is for getting the shape quickly, not
proven for comprehension. Let each pass name what it leaves out (methods detail, caveats). The role
line under each stop is model paraphrase; consider showing the passage first.

### Quotes

**What it does.** The article's own sentences, verified verbatim, marked in the prose; the reader's own
marks kept as separate rows ([quotes.md](../../project/quotes.md)).

**What the evidence says.** Instructor-chosen highlighting helped memory and comprehension a little in
a pooled analysis, but a later digital experiment found no average benefit (C20). Wrong marks hurt
comprehension and made confidence run backwards. The quote itself sidesteps paraphrase risk; the
model's *choice* and *reason* do not (C14).

**Verdict.** Model selection is untested. Accurate other-chosen highlights offer mixed indirect
support; wrong choices carry evidence of harm.

**Ideas.** Optionally let the reader pick first and see the model's choices after.

### FAQ

**What it does.** Up to twelve questions a careful reader would ask, each answered only by the piece's
own passages ([faq.md](../../project/faq.md)).

**What the evidence says.** Answers made of passages avoid introducing paraphrase error into the
answer itself (C14). Prequestions produced g = 0.66 for questioned content and about zero for the rest;
together with generation evidence, that makes guess-before-reveal plausible, not tested. FAQ is
after or alongside reading, not the prequestion design. The question itself is the model's framing
and can anchor what the reader thinks the objection is.

**Verdict.** Passage answers avoid paraphrase risk by construction; FAQ as a reading or learning aid
is untested.

**Ideas.** A "guess before you reveal" state on the top questions. Let the reader write their own
question first, as an option.

### Glossary

**What it does.** Terms the piece uses non-obviously are underlined; pointing shows a card with the
article's own definition; the reader initiates every look-up ([glossary.md](../../project/glossary.md)).

**What the evidence says.** Greg's worry: "maybe the glossary, because it's constantly making it easy
for you to look up the answer, means that you're not actually learning it." A gloss beats no gloss
for learning the word, immediately and later, so access to a gloss does not cancel learning (C17).
Whether that result carries to an on-demand hover card is untested.
Multiple-choice glosses did best on average, but one second-hand comparison favoured direct L1
translations and wrong choices can plant a wrong meaning. Errors followed by feedback,
and generation, both predict that guessing first would beat looking up — but no study tests that for
adults reading expository text. Separately, ScholarPhi's in-place definitions sped look-up without
hurting correctness, and its failure was readers treating an incomplete list as complete.

**Verdict.** Supported indirectly against no help. The on-demand design and guessing first are untested.

**Ideas.** An optional "what do you think it means?" step before the card, or a setting that hides
definitions until asked twice. Say when a term is used in more than one sense.

### Links, cross-references and marginalia

**What they do.** Hover cards on the article's own links; phrases that sum up a result link to the
passage that reports it, with a back chip; a column of notes level with the blocks they concern
([links.md](../../project/links.md), [cross-references.md](../../project/cross-references.md),
[marginalia.md](../../project/marginalia.md)).

**What the evidence says.** Putting related material next to what it explains helps (g ≈ 0.6), but
less, or not at all, for experts, and "closest" is not always best (C18). Links cost readers little;
deciding whether to follow them is the cost. The one controlled hover-preview study found speed gains
and no change in effectiveness. Cross-references are the cheapest-to-check link in the product, but
their validation proves the link is well-formed, not that the target supports the phrase (C15).

**Verdict.** Keeping related material near the text is supported indirectly; learning effects of these
hover-card, marginalia and cross-reference designs are untested.

**Ideas.** A way to dim cross-reference links for readers in their own field. A fidelity check for
cross-references like the one summaries have.

### Comments

**What it does.** Select to highlight; an optional note; an optional model answer
([comments.md](../../project/comments.md)).

**What the evidence says.** The reader's own highlighting helps memory a little and comprehension not
reliably; lower-certainty evidence suggests notes and later review can do more (C19). Keeping the AI
optional fits the Kreijkes result that the reader's own writing is worth protecting.

**Verdict.** Supported indirectly for memory; no reliable comprehension effect for the mark alone.

**Ideas.** Make "add a few words" the easiest next step after a highlight. Resurface the reader's own
notes for review later.

### Search

**What it does.** Find-on-page, a quick meaning match, and a deeper one; every result is a place to
read, never an answer ([search.md](../../project/search.md)).

**What the evidence says.** Returning places rather than a synthesised answer stays on the right side of
the answer-versus-sources evidence (C26). But a goal narrows learning: the reader who follows hits will
remember those passages better and the rest worse (C25). In one small adolescent study, answering with
the text open helped the immediate answer but not free recall a day later.

**Verdict.** Returning places rather than answers is supported indirectly as a design principle;
within-document Search as built is untested.

**Ideas.** After a search, show how much of the piece the reader has actually been through, using the
reading-time machinery, so the narrowing is visible. Offer "how do these passages relate?" beside the
results, since integration tasks beat look-up tasks for deep learning.

### Sources (Bibliography, Reception, Claims) and Referee

**What they do.** Sources lists what the piece cites, what others say about it, and the claims it rests
on to check against the web. Referee helps a peer reviewer without giving a verdict
([sources.md](../../project/sources.md), [referee-mode.md](../../project/referee-mode.md)).

**What the evidence says.** Checking a source's publisher and credibility outside the document is what
fact-checkers do and what works when taught to students; that does not test whether a paper's inference
is sound (C27). The library's one Direct result about expert readers' own performance is
that reviewers catch about 2.6 of 9 planted errors. One trial found only a small training improvement,
with low certainty — the case for the need behind Referee (C28). An LLM's verdict did
not improve discernment, so "no verdict" is the right rule (C16).

**Verdict.** Supported indirectly for source credibility; Sources as built and judging a paper's
argument are untested. The need behind Referee is supported; Referee's effect is untested.

**Ideas.** On each Reception row, show the author's position, motive and whether it was reviewed —
the three source cues taught successfully in Pérez et al. 2018. Say where the model is unsure. Frame
Referee's candidates as questions rather than findings. The planted-error design (Schroter 2008) is a
ready-made test of whether Referee raises the 2.6.

### Diagram, Sketch and Timeline

**What they do.** Pictures of the argument's shape drawn by a model and checked against block ids;
dates the piece gives, with uncertainty kept ([diagram.md](../../project/diagram.md),
[sketch.md](../../project/sketch.md), [timeline.md](../../project/timeline.md)).

**What the evidence says.** Supplied organisers help, and in the one direct comparison author-made
organisers beat learner-made ones on transfer — so "you must build it yourself" is not the rule it is
often said to be (C23). But the headline construction benefit is not delivered by looking, and there
is only one tiny machine-drawn-map study (N = 14): it found 83.6% extraction precision, lower perceived
load, more viewing time, faster test completion and no accuracy gain, with no delayed test. There is
no adult timeline evidence. Argument mapping's large effects shrink after correcting for publication
bias, and they come from training people to build maps.

**Verdict.** Supported indirectly and weakly; untested for what we actually draw.

**Ideas.** Use the picture rather than only show it: recall the argument, then compare with the Sketch;
or fill in a part of it.

### Illustrated and the article's own figures

**What they do.** A painted plate from the Sketch scene, labelled as an interpretation; the article's
own figures kept in the reading view ([illustrated.md](../../project/illustrated.md),
[article-images.md](../../project/article-images.md)).

**What the evidence says.** Explanatory pictures help; decorative ones are about neutral; interesting
but irrelevant material hurts, especially when it comes first; attractive design gives small gains,
mostly in motivation (C24). One small vocabulary study compared text alone with text plus AI-made
pictures, but without a human-picture condition it cannot attribute the gain to AI generation. Nothing
tests our painted scenes or shows that a wrong picture plants a false belief — the risk Illustrated's
own doc names.

**Verdict.** Illustrated is untested as built. Pure decoration has no reliable learning effect;
seductive material carries evidence of harm, while emotional design may help motivation. The article's
own figures are supported indirectly only when they are relevant and explanatory.

**Ideas.** Show the plate after reading rather than as a lead-in. Treat its case as delight and
motivation, and say so.

### Dictation

**What it does.** Talk into any text box; transcribed twice, fillers removed
([dictation.md](../../project/dictation.md)).

**What the evidence says.** Greg's belief was: "voice is lower effort, it's faster. And … people
probably say more and probably provide more context." Faster and more — supported on phone entry and
in surveys (C21), not established for laptop typing or for better-organised, more accurate content.
Lower effort — only perceived effort has support. Spoken explaining elaborates more and written
explaining organises better; pushed voice lowered response rates, only about half of one panel said
they would use it, and speech left slightly more final transcription errors (C22).

**Verdict.** Supported indirectly for speed and quantity; untested for learning.

**Ideas.** The card could say “faster than phone typing, and fuller in survey answers”, not anything
about learning, and keep the keyboard an equal. After talking in Learn, an optional two-line typed
summary would take both benefits.

### Reading time

**What it does.** A tint down the spine where the reader has spent longer
([reading-time.md](../../project/reading-time.md)).

**What the evidence says.** It makes no comprehension claim, which is right: dwell time cannot tell
reading from skimming. Adults read non-fiction at about 238 wpm, and about 100 wpm when reading to
remember.

**Verdict.** Untested as an aid; it makes no comprehension claim.

**Ideas.** Distinguish "skimmed" from "not seen".

### Fonts per voice, decoration and screen reading

**What they do.** Four faces — the author's serif, the model's monospace, the reader's, the app's
([fonts.md](../../project/fonts.md)). Decorated mode is a playground, not shipped
([260929a](../../tutorials/260929a-decorated-mode.html)).

**What the evidence says.** Nothing tests marking voices by typeface; face choice within normal ranges
does not change comprehension, so the cost is probably small (C29). Monospace for long model paragraphs
is untested. Bionic and disfluent fonts have no reliable learning benefit (C30). Separately, two
meta-analyses found small screen comprehension penalties (g = −0.25 overall in one and −0.21 in the
other; g = −0.32 for expository text in the first), and the first found calibration better on paper
(g = 0.20). A newer synthesis located the difference chiefly where scrolling was required and found
no reliable device difference without scrolling.

**Verdict.** Voice-marking by typeface is untested. There is evidence of a small screen-reading cost
under some conditions, not a verdict on this layout.

**Ideas.** A cheap experiment: show a gist in the author's face and in the model's, and ask readers who
wrote each.

### The reader profile and "why you're reading this"

**What it does.** "About you" and a per-article purpose go into model prompts
([reader-profile.md](../../project/reader-profile.md)).

**What the evidence says.** A goal changes what is learned — more of the relevant, less of the rest —
and switching perspective later recovers content the first goal left behind (C25). The help that
suits a novice can hurt an expert, and the profile is a self-description, while the effect depends on
actual knowledge (C10). Personalising to interest risks seductive details.

Choice can raise motivation, but learner control over sequencing and pacing averaged only g = 0.05;
whether choosing one's own modes improves learning is untested.

**Verdict.** Goal-directed recall is supported indirectly, with a cost. Asking for a purpose and
conditioning model output on it are untested.

**Ideas.** After a purpose-led pass, prompt for what the piece says that the purpose did not ask about.
Let the purpose be revised mid-read. Personalise to background and level, not interests.

## Where the evidence and the product disagree

The counter-evidence, collected, because Greg asked for it as much as for support.

1. **The missing later check.** Offering Recall and Quiz at the end of reading matches the retrieval
   experiments. But nothing brings the reader back for the delayed generation task that improves
   calibration. A later re-offer may also add spacing, but its extra retention benefit is untested here
   (C4).
2. **Expert readers.** Several modes are help of the kind that suits novices — gap-free summaries, dense
   cross-references, the tree — and the expertise-reversal evidence says such help fades or reverses
   for people who know the field (C10). Our readers are often those people. One tiny study of 13 HCI
   researchers points the other way — LLM help improved experts' critical thinking while novices tended
   to decline — so expertise is a moderator, not a universal direction.
3. **Seeing is not always doing, but doing is not always better.** Self-explanation modestly beats a
   supplied explanation. For maps, however, direct comparisons found supplied organisers tied or beat
   learner-built ones. The useful conclusion is task dependence, not a general generation rule (C6,
   C23).
4. **Feeling is not understanding.** Three small reading-tool studies found gains in speed or perceived
   ease without a correctness gain, and AI help can inflate confidence (C5, census). Nothing in the
   product shows a reader their actual level except Quiz's marks.
5. **Links are not checks.** We lean on "every sentence is a door into the text". Citations raised trust
   overall, few were opened, and opening them was associated with lower trust (C15).
6. **Narrowing by goal.** Asking for a purpose and searching both focus the reader, which improves what
   they came for and costs them the rest (C25, C26).

## Disagreements between files, and how they are settled here

- **Etkin et al. 2025** is graded Moderate in [21](21-reading-interfaces-census.md). [07](07-trusting-ai-text-vs-the-source.md)
  is internally inconsistent: Low in its short answer and Low–Moderate in its detailed finding. [07] read the
  paper and found the "hurts strong readers" split was made on the same control scores used as the
  baseline, so part of the gap may be regression to the mean; under an independent split (SAT/ACT) the
  drop is d = 0.35, not 0.83. **This digest uses Low–Moderate and the smaller figure.** The direction
  agrees with expertise reversal, which is why it is still worth taking seriously.
- **Pre-highlighting.** The 2026-08-28 note called it "the worst" decoration. [09](09-annotation-highlighting-notes.md)
  grades the instructor-highlight meta-analysis Low · Analogy; [17](17-typography-and-decoration.md)
  grades it Moderate · Indirect, while also reporting a later N = 170 digital experiment with no
  average effect. Wrong highlights harm, and the "attention narrows" claim had no source. **This digest
  uses Low–Moderate · Analogy / Indirect and calls model selection untested.** The earlier note now
  carries a correction.
- **The reverse-cohesion effect** (experts learn more from less coherent text) is cited as fact in older
  writing. [05](05-summaries-organisers-and-coherence.md) found it failed to replicate inside its own
  paper and was reversed for skilled readers in a later study of 143 students;
  [03](03-scaffolding-and-desirable-difficulty.md) could not open the original. **Contested.** The
  broader expertise-reversal meta-analysis is the safer ground for C10.
- **Constructing versus viewing.** These files test different acts and do not point in one direction.
  [08](08-generating-vs-receiving.md) finds self-explanation beats being given explanations, but by
  g = 0.35, not 0.67. [16](16-maps-diagrams-timelines.md) finds the apparent construction advantage is
  confounded across studies, while direct same-text experiments had author-made organisers beat
  learner-made ones on transfer and tie on retention. Generation helps in some forms, not as a rule.
- **The "85% rule"** for difficulty comes from machine-learning classifiers, not readers
  ([03](03-scaffolding-and-desirable-difficulty.md)). Not used.
- **A retracted meta-analysis** of ChatGPT and learning (g = 0.87) is excluded
  ([04](04-ai-tutors-and-llms-in-learning.md)). Bastani et al. has a published correction that no
  researcher could open; its figures should be treated as provisional until someone reads it.

## Product ideas this points at

Collected from the sections above, roughly in order of value for the effort. **None is decided; none is
built here.** Each goes to the Overseer's queue as a proposal for Greg.

| # | Idea | Modes | Evidence | Effort |
|---|---|---|---|---|
| P1 | **Run the reader study** (260910a), adding: an item the tool does not cover, a seeded hole, each reader's baseline, a delayed test | all | the gap in C3–C5 and the census | moderate, mostly Greg's time |
| P2 | **A delayed Learn/Quiz re-offer**: “come back tomorrow” after the immediate attempt | Recall, Quiz | C1, C4, C5 | moderate (no scheduler exists) |
| P3 | **Confidence before the mark** in Quiz, with a quiet record of sure-and-wrong | Quiz | C5 | small |
| P4 | **Guess first** on the glossary card and on top FAQ questions, as an option | Glossary, FAQ | C17, pre-questions | small |
| P5 | **Measure chip press-through** in chat and summaries | Chat, Summary | C15 | small |
| P6 | **"Your gist first"** before the Brief for readers who say they know the field | Summary | C9, C10 | small |
| P7 | **Say what each mode is for, honestly**: Skim is triage, Live is fluency, Illustrated is delight | Skim, Live, Illustrated | C13, C22, C24 | small, copy |
| P8 | **Show coverage after search** (how much of the piece you have actually been through) | Search | C25, C26 | small–moderate |
| P9 | **Even coverage in the tree**, or say where labels are missing | Structure | C11 | small |
| P10 | **Source cues on Reception rows** (author's position, motive, reviewed or not) | Sources | C27 | moderate |
| P11 | **Fidelity checks for overgeneralisation and for cross-references** | Summary, cross-refs | C14, C15 | moderate |
| P12 | **Use the Sketch**: recall the argument, then compare; fill in a part | Sketch | C23 | moderate |
| P13 | **A one-question level check** at the start of Tutorial | Tutorial | C7, C10 | small |
| P14 | **Note, not just mark**: make "a few words" the easy next step after a highlight; resurface notes later | Comments | C19 | small |
| P15 | **Planted-error test of Referee** (does it raise the 2.6 of 9?) | Referee | C28 | moderate |

## What could honestly be said in marketing

Only things the evidence carries, phrased no stronger than it does. Check each number against the paper
before it is printed.

- Testing yourself on what you read beats re-reading it for keeping it — one of the best-replicated
  findings in learning research. Spideryarn's Learn mode is built on it.
- In one 2025 randomised trial at a Turkish high school, unrestricted GPT-4 help in maths practice left
  pupils worse off on the unaided exam; Spideryarn is designed to keep you reading the article itself.
  The paper has a published correction that this library has not yet checked.
- In one 2025 study of 4,900 science summaries, several LLMs overgeneralised; rates varied materially
  by model and prompt. Spideryarn keeps the author's text beside its AI help and marks verified quotes
  as word-for-word passages.
- Not to be said: that Spideryarn improves comprehension or retention. Nobody, including us, has
  measured that yet.

## Where to go next

- The topic files, one per question: [reading-research-overview.md](../../project/reading-research-overview.md)
  lists them all.
- Earlier reading research this builds on: [261002c recall and tutorial pedagogy](../261002c-recall-and-tutorial-pedagogy-for-remember-mode.md),
  [261002c what makes a good summary](../261002c-what-makes-a-good-summary.md),
  [260828b reading science for decorated mode](../260828b-decorated-mode/ideas-reading-science.md),
  [260831e cognitive offloading](../260831e-helping-peer-reviewers/prior-art-and-cognitive-offloading.md).
- The tutorial that explains all of this from the start:
  [261010a-reading-and-learning-evidence.html](../../tutorials/261010a-reading-and-learning-evidence.html).
