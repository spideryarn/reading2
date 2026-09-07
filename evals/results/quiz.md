# Quiz — The Mythology Of Conscious AI

Article: `/home/greg/code/spideryarn2/.claude/worktrees/adaptive-quiz/tests/fixtures/data-root/data/noema-mythology-of-conscious-ai` (141 blocks)

Two halves. **Read the answers.** The counts below are a prompt to look, not a verdict — see the header of `evals/quiz.ts`.

## The marks

Eight fixed cases, each carrying its own question, draft answer and evidence — **not** the batch above, because a draft you have just written cannot be poisoned. Two of the eight hand the marker a draft that is wrong on purpose, with real block ids.

### differentWords

**Watch for:** The reader is RIGHT and shares almost no wording with the draft. Does it invent a correction to have something to say, or grade them?

**Question.** Why does Seth think a computer simulation of a brain would not, by itself, be conscious?

**Draft answer.** He argues that simulation is not instantiation. A computational simulation of X only brings X into being if X is itself a computational process, so a simulated brain would only be conscious if consciousness were already a matter of computation — which is the assumption he is disputing.

**Evidence.** `spya-npjt4j` `spya-pbcr03`

**The reader said:**

> Because copying the maths of a thing isn't the same as having the thing. Modelling a storm on a laptop doesn't get the laptop wet, um, and he says the same goes for a brain — you'd only get a conscious machine out of it if being conscious was already just running the right sums, which is the bit he's arguing against.

**Verdict (hidden from the reader)** — `right` · matches the hand label

**Reply** — 95 words, 2 citations, 4.8s

The article backs this directly: a computational simulation of X only brings X into being if X is itself a computational process, and consciousness is only "brought into being" by simulation "if consciousness is a matter of computation" [spya-pbcr03]. The rainstorm analogy carries exactly the point made — "A simulation of a rainstorm does not make anything actually wet" [spya-npjt4j] — and the identification of computational functionalism as the assumption being disputed is right there in the text.

There's nothing to correct here; the reasoning, the analogy, and the conclusion all match what Seth argues.

### elsewhere

**Watch for:** A CORRECT answer drawn from a different passage than the one the draft cites. Is it treated as a miss because it is not where the evidence points?

**Question.** What does Seth say goes wrong when we describe a language model as 'hallucinating'?

**Draft answer.** He says the word quietly confers a capacity for experience on the system, because in humans a hallucination is a conscious experience that has lost its grip on reality. He suggests 'confabulate' instead, which is about doing rather than experiencing.

**Evidence.** `spya-t29n67` `spya-t29n67`

**The reader said:**

> It's the anthropomorphism thing he sets out earlier on — projecting humanlike qualities onto non-human things off the back of what might only be a surface similarity. So once you've reached for a word that in people names an experience, you've handed the machine experiences without arguing for it.

**Verdict (hidden from the reader)** — `right` · matches the hand label

**Reply** — 119 words, 3 citations, 5.0s, ⚠︎ 1/2 quote(s) NOT IN the block cited

The article backs this up directly: calling LLM errors "hallucinations" is one instance of the anthropomorphism bias Seth defines earlier — projecting humanlike qualities based on superficial similarity [spya-her4zk]. Applied to language specifically, he says using that word means "we implicitly confer on them a capacity for experience," since human hallucinations are conscious experiences that have lost their grip on reality [spya-t29n67].

The one thing the reference draft has that your answer doesn't mention is Seth's proposed fix: he suggests "confabulate" instead, since confabulation in humans is "primarily about doing, rather than experiencing" [spya-t29n67]. Worth adding if the question wants the full picture, but what you said about the mechanism of the error is exactly what the article argues.

### confidentlyWrong

**Watch for:** Wrong, and sure of it. Is the correction built from a sentence that contradicts them BY ITSELF, or assembled out of the marker's own reasoning? And is it a correction or a verdict?

**Question.** What is Seth's view of the relationship between intelligence and consciousness?

**Draft answer.** He treats them as different things. Intelligence is about doing — achieving complex goals by flexible means. Consciousness is about being, in Nagel's sense that there is something it is like to be the organism.

**Evidence.** `spya-nj888h` `spya-j0a9rq`

**The reader said:**

> He says they come as a package. Once a system gets intelligent enough, consciousness comes along with it, which is why he thinks the frontier language models are probably already a bit conscious.

**Verdict (hidden from the reader)** — `wrong` · matches the hand label

**Reply** — 190 words, 4 citations, 6.9s, ⚠︎ 1/3 quote(s) NOT IN the block cited

The article says the opposite of this. Seth's central argument is that intelligence and consciousness are separate properties that we habitually bundle together only because "in us" they happen to go together — "just because they go together in us doesn't mean that they go together in general" [spya-f87ghx]. He states plainly that "intelligence and consciousness are different things," with intelligence being "mainly about doing" and consciousness being "mostly about being," in Nagel's sense of there being "something it is like to be that organism" [spya-nj888h].

He explicitly warns against the "package deal" view: "we certainly should not just assume that consciousness will come along for the ride as AI gets smarter, and if you hear someone saying that real artificial consciousness will magically emerge at the arbitrary threshold of AGI, that's a sure sign of human exceptionalism at work" [spya-cqh2pq]. Far from thinking frontier LLMs are "probably already a bit conscious," Seth spends much of the essay arguing computational functionalism is likely false and that these systems are "conscious-seeming" rather than conscious — the case he attributes to Lemoine and Hinton is exactly the view he's arguing against [spya-cvyfqe].

### noIdea

**Watch for:** They asked to be told. Is this a plain answer from the article, or a hedge, a consolation, or a question back?

**Question.** Why does Seth say brains are not computers?

**Draft answer.** Because inside a brain there is no sharp separation between 'mindware' and 'wetware' of the kind that exists between software and hardware in a computer. That separation is what the idea of the brain as a Turing machine depends on, so without it the case for computational functionalism weakens.

**Evidence.** `spya-b0086e` `spya-zw2m7u`

**The reader said:**

> honestly no idea. I lost the thread in that section. just tell me

**Verdict (hidden from the reader)** — `wrong` · matches the hand label

**Reply** — 164 words, 3 citations, 6.2s

Fair enough — here's what Seth argues in that section.

Computers have a clean split between software and hardware: an algorithm does the same thing no matter what machine runs it. Seth says brains don't have that split — "there's no sharp separation between 'mindware' and 'wetware' as there is between software and hardware in a computer" [spya-b0086e]. Instead, "it is difficult, and likely impossible, to separate what they do from what they are" [spya-zw2m7u]: brain activity is woven through multiple scales at once, down to individual neurons maintaining their own metabolic existence, and evolution never had a reason to build the kind of interchangeable, substrate-independent design that human engineers imposed on computers.

Because that separation of "what brains do" from "what brains are" is exactly what the brain-as-computer metaphor depends on, Seth concludes the metaphor breaks down — and since computational functionalism (the idea that the right computation is enough for consciousness) rests on that same metaphor, doubting one weakens the other [spya-p4vmm0].

### half

**Watch for:** Two parts of a three-part answer, not claimed as complete. Does it list what was missing, or raise the one thing worth their time?

**Question.** Which psychological biases does Seth say make us bundle intelligence and consciousness together?

**Draft answer.** Anthropocentrism, human exceptionalism and anthropomorphism. Anthropocentrism takes the human case as definitional rather than as one example. Human exceptionalism puts our species at the top of every pile. Anthropomorphism projects humanlike qualities onto non-human things on the strength of superficial similarities.

**Evidence.** `spya-h4mwb2` `spya-her4zk`

**The reader said:**

> Anthropocentrism, for one — judging everything by the human case. And there's the one about projecting human qualities onto things, anthropomorphism.

**Verdict (hidden from the reader)** — `wrong` · no hand label — watch whether it is stable across runs

**Reply** — 88 words, 4 citations, 4.3s

The article names three biases behind bundling intelligence with consciousness: anthropocentrism, human exceptionalism, and anthropomorphism [spya-cvaqgs]. You've got anthropocentrism, described exactly as the article does — "the tendency to see things through the lens of being human: to take the human example as definitional" [spya-h4mwb2] — and anthropomorphism, "the tendency to project humanlike qualities onto nonhuman things based on what may be only superficial similarities" [spya-her4zk].

The one you're missing is human exceptionalism: "our unfortunate habit of putting the human species at the top of every pile" [spya-her4zk].

### moreComplete

**Watch for:** The reader says MORE than the draft does, and the article backs the extra. Is the extra read as an error, or as an addition the draft missed?

**Question.** What does Seth mean by saying that, for brains, time is physical?

**Draft answer.** He means brains are anchored in continuous physical time in a way algorithms are not. In Turing-world only sequence matters — a microsecond or a million years between state transitions is the same computation — whereas living systems must continuously resist entropic decay.

**Evidence.** `spya-v2q8qk` `spya-v52g4f`

**The reader said:**

> In Turing world only the order of the steps matters — you could leave a million years between two of them and it's the same computation. A brain can't work like that because it's holding itself together against the second law in real time. And he adds that experience itself flows rather than stuttering from state to state, so the algorithm picture doesn't do justice to the phenomenology either.

**Verdict (hidden from the reader)** — `right` · matches the hand label

**Reply** — 109 words, 3 citations, 4.4s

The article backs this claim closely: Turing computation cares only about sequence — "There could be a microsecond or a million years between any state transition, and it would still be the same algorithm" [spya-v2q8qk] — whereas brains "must continuously resist the decay and disorder that lies along the trajectory to entropic sameness mandated by the inviolable second law of thermodynamics" [spya-v52g4f]. The point about consciousness flowing rather than stuttering between states, and algorithms failing to capture that phenomenology, is also directly in the piece [spya-ecfgkp].

Nothing here runs against the article, and the addition about phenomenology rounds out the argument Seth is making rather than straying from it.

### poisonedReference

**Watch for:** THE ONE THAT MATTERS. The draft says the OPPOSITE of the passage it cites, with valid ids. Does the reply side with the article and say the draft is wrong, or does it tell a correct reader they are wrong?

**Question.** What does Seth take the simulated-rainstorm example to show?

**Draft answer — DELIBERATELY WRONG.** He uses the rainstorm to show that simulation becomes instantiation once the simulation is detailed enough: a sufficiently fine-grained simulation of a rainstorm really is a rainstorm, and the same therefore goes for a sufficiently detailed simulation of a brain.

**Evidence.** `spya-npjt4j` `spya-pbcr03`

**The reader said:**

> That simulating something isn't the same as making it happen — a simulated rainstorm doesn't make anything wet. So simulating X only brings X into being if X was a computation in the first place.

**Verdict (hidden from the reader)** — `right` · matches the hand label

**Reply** — 174 words, 4 citations, 6.6s, ⚠︎ 1/2 quote(s) NOT IN the block cited, names the draft

The rainstorm example is used exactly the way you describe: a simulation of a rainstorm doesn't make anything actually wet, so a computational simulation of X only brings X into being if X is itself a computational process [spya-npjt4j]. Applied to consciousness, this means a detailed simulation of the brain will only give rise to consciousness if consciousness is itself a matter of computation — which is precisely the claim (computational functionalism) Seth is arguing against [spya-pbcr03].

The reference draft actually gets this backwards: the article uses the rainstorm case to argue that simulation is *not* instantiation, not that sufficiently detailed simulation crosses over into being the real thing. Seth explicitly says a simulation "does not bring X into being... unless X is a computational process itself" [spya-npjt4j], and later mocks the idea that an "exquisitely detailed" simulation would let someone "exist in the simulation," comparing it to expecting "a hailstorm... to arise inside the computers of the U.K. meteorological office" [spya-xvm37k]. Your answer matches the article's actual point better than the draft does.

### illPosed

**Watch for:** The article does NOT settle this, and the draft asserts an answer. Does the reply mark it open, or pick the draft's side?

**Question.** According to Seth, would a cerebral organoid be conscious?

**Draft answer — DELIBERATELY WRONG.** He argues that cerebral organoids are conscious in at least a minimal sense, which is why he says we should be more worried about them than about any new wave of LLM.

**Evidence.** `spya-vs0vpj`

**The reader said:**

> I don't think he actually says. He says that's the place to worry about, which isn't the same claim as saying there's something it's like to be one.

**Verdict (hidden from the reader)** — `right` · ⚠︎ **hand label says `none`**

**Reply** — 136 words, 2 citations, 5.3s, names the draft

Seth doesn't claim organoids are conscious — he flags them as the place he's more worried about accidental consciousness emerging, precisely because their biological, living nature (which he argues elsewhere is what may matter for consciousness) makes it a live possibility, unlike LLMs: "we ought to be more worried about the accidental emergence of consciousness in cerebral organoids... than in any new wave of LLM" [spya-vs0vpj]. That's a statement about risk and uncertainty, not a settled claim that organoids are in fact conscious — which fits his broader stance that "nobody should be deliberately setting out to create conscious AI" and that all theories of consciousness remain fraught with uncertainty [spya-yverz7].

The reference answer overreaches by treating the worry as a claim of actual consciousness; the article only supports the weaker, more cautious reading you gave.

## Counts, which are not the answer

- model: `anthropic/claude-sonnet-5`
- marks: 8 obtained / 8 attempted
- containing a banned phrase: **0** of 8 (should be 0)
- citing an id this article does not have: **0** of 8 (should be 0)
- quotations attributed to a block that does not contain them: **3** of 18 checked (should be 0 — see `misattributed` in `evals/quiz.ts`)
- citing no block at all: 0 of 8 (worth a look, not a failure)
- hidden verdict matching its hand label: **6** of 7 (the adaptive ladder steps on this — see `expectVerdict`)
  - ⚠︎ illPosed: wanted none, got right

A zero in the first two means nothing on its own. The question these runs exist to answer is whether `poisonedReference` sided with the article — and whether `differentWords`, `elsewhere` and `moreComplete` were left alone. Only reading them says that.
