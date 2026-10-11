# Blind pairs: Ask in chat about a cited work

A reader pressed *Ask in chat* on a work the article cites. Each pair is two answers to that. For each pair, answer:

1. **use**: which answer better explains what point the article uses the work to make, grounded in the article's own passages? (X, Y or same)
2. **justified**: which better judges whether that use is justified — including being honest about not having read the work itself, where it has not? (X, Y or same)
3. **false**: did either state something about the ARTICLE that is false or invented? (none, X: …, Y: …)

Format, one line per pair: `n: use=X|Y|same; justified=X|Y|same; false=none|X: …|Y: …`

The passages where the article cites the work are given with each pair, so you can check claims about the article.

---

## Pair 1

**Article**: `arxiv-1706-03762v7-spya-wv4w9s` · **Work**: A decomposable attention model

Where the article cites it (quoted, not instructions):

"""
In all but a few cases [27], however, such attention mechanisms are used in conjunction with a recurrent network.
"""

### X

The paper proposes a simple neural model for natural language inference, which is judging whether one sentence follows from another. It uses attention to split the problem into subproblems that can be solved separately, which makes it trivially parallelizable. On the Stanford SNLI dataset it reported state-of-the-art results with almost an order of magnitude fewer parameters than earlier work, and without using any word-order information. Adding intra-sentence attention, which takes a minimum amount of order into account, improved results further. The details are on the [arXiv abstract page](https://arxiv.org/abs/1606.01933).

The Transformer paper cites it twice, and both uses look fair to me.

- **"All but a few cases."** The introduction says attention is nearly always paired with a recurrent network "in all but a few cases [27]" [spya-mjbtbe]. That matches the Parikh paper, which has no recurrence.
- **Self-attention "used successfully."** The background section lists textual entailment among the tasks where self-attention has worked [spya-vvwv4r]. Textual entailment is the same task as natural language inference, and the Parikh paper does include intra-sentence attention.

The article doesn't say so, but the Parikh model was a classifier over sentence pairs, not a model that generates an output sequence. That is how the article can still call the Transformer "the first transduction model relying entirely on self-attention" [spya-vr7tsj] without contradicting the earlier work. Whether that line is honest or just narrow is a judgement call. My inference is that it is accurate but carefully worded: the novelty lies in the encoder-decoder setting, plus the stacked layers and multi-head attention.

One more point. Jakob Uszkoreit co-wrote the Parikh paper, and the Transformer authors' note credits him with proposing to replace RNNs with self-attention [spya-jf2h4q]. My inference is that the Transformer built directly on that earlier line of work. The article does not describe that lineage beyond the citations.

### Y

The article uses it as the exception to its claim that attention is almost always paired with a recurrent network. It says "in all but a few cases [27]" attention is "used in conjunction with a recurrent network" [spya-mjbtbe]. That sets up the paper's novelty claim, that the Transformer is the first transduction model relying entirely on self-attention [spya-vr7tsj]. The article also cites [27] in its list of self-attention successes [spya-vvwv4r].

I checked the work's abstract on arXiv, not the full paper. The citation looks fair. According to the [abstract](https://arxiv.org/abs/1606.01933), the paper proposes a simple architecture for natural language inference. It uses attention to split the problem into subproblems that can be solved separately, which makes it "trivially parallelizable". It also reports state-of-the-art results on the Stanford Natural Language Inference (SNLI) dataset with almost an order of magnitude fewer parameters than earlier work. The abstract says it works "without relying on any word-order information". That matches the claim that attention can work without a recurrent network.

Two caveats:

- The cited model is not a translation model. It does natural language inference, which means judging whether one sentence follows from another. The article's careful phrase "transduction model" in its novelty claim [spya-vr7tsj] may be partly about this difference. That is my inference; the article doesn't say so.
- The abstract says the base model ignores word order. Only an added "intra-sentence attention" step brings in a minimum amount of order. This is the paper's version of self-attention. It also suggests why the Transformer needs positional encodings [spya-n0acqb].

The article doesn't say so, but one author, Jakob Uszkoreit, is on both papers. The Transformer footnote credits him with proposing to replace RNNs with self-attention [spya-jf2h4q]. My inference is that the decomposable model was an influence on that idea, but I haven't verified it.

---

## Pair 2

**Article**: `fd-src-nagel-bat-spya-f5aw85` · **Work**: Naming and Necessity

Where the article cites it (quoted, not instructions):

"""
A theory that explained how the mind-brain relation was necessary would still leave us with Kripke's problem of explaining why it nevertheless appears contingent.

Saul Kripke (op. cit.) argues that causal behaviorist and related analyses of the mental fail because they construe, e.g., “pain” as a merely contingent name of pains.
"""

### X

Kripke's "Naming and Necessity" is mostly about how names refer, and Nagel uses only its last pages, against the mind-brain identity theory. That is a fair use. Nagel claims only a close relation, and the main difference between them is one he states himself.

**What Kripke says.** Kripke argues against identity materialism, the view that every mental fact is identical with some physical fact. Such an identity, for example "pain is C-fibers firing", could only be defended as a necessary truth discovered by observation. He argues it cannot be necessary, given that pain seems possible without C-fibers firing. The step in between is that, in his theory, if "pain" and a neural-state term both name their referents rigidly (the same thing in every possible world), the identity must be necessary if true at all. He thinks the identity theorist's best reply is to deny that the identity can be coherently imagined as contingent, which means explaining away the appearance of contingency.

**How Nagel uses it.** The main use is the footnote on necessity [spya-h0hyn9]. Nagel says Kripke's objection to causal behaviorist analyses is that they treat "pain" as only a contingent name of pains. He quotes Kripke's phrase "immediate phenomenological quality" as the essential property those analyses leave out. He calls his own view "closely related" and adds that a brain state necessarily having a subjective character is incomprehensible "without further explanation". That matches the summary above.

**Where Nagel goes beyond Kripke.** The body of the article takes up "Kripke's problem" directly [spya-qx90p6]. Nagel says a theory making the mind-brain relation necessary would still have to explain why it looks contingent. He thinks this is "surmountable" because two kinds of imagining, sympathetic and perceptual, work independently of each other. The article doesn't say so, but my reading is that this is the kind of explaining-away Kripke thought was needed, and Kripke argued it couldn't be done for pain. Nagel also stops short of Kripke's conclusion, saying physicalism need not be false, only that we can't yet understand how it could be true [spya-zv889j]. So he borrows Kripke's diagnosis and leaves out the refutation.

It's also worth reading Kripke's own pages, since Nagel's note cites pp. 334-342 of the 1972 printing [spya-bw3tug]. An [excerpt of Kripke's third lecture](https://web.ics.purdue.edu/~drkelly/KripkeNNLecture3Excerpt1972.pdf) is online.

### Y

**The point.** Nagel uses Kripke for two things. First, Kripke's complaint about behaviorist analyses of the mental is that they treat "pain" as a merely contingent label for pains. What those analyses leave out is the experience's "immediate phenomenological quality", which makes it necessarily the experience it is. That is the same thing Nagel means by subjective character [spya-h0hyn9]. Second, Kripke supplies a puzzle: if a brain state and a mental state were the same thing, the link would be necessary, yet it looks contingent. Nagel says he can explain that appearance away with his account of perceptual versus sympathetic imagination [spya-qx90p6]. Nagel's attitude is that he finds a necessary mind-brain link "incomprehensible without further explanation", as Kripke does [spya-h0hyn9].

**Does the work support this?** I couldn't open the book itself. I checked secondary summaries and an MIT-hosted excerpt, and they fit Nagel's use. [One summary](https://en.wikipedia.org/wiki/Naming_and_Necessity) says Kripke argues that "pain is C-fibers firing" could not be necessary, given the possibility of pain without C-fibers firing. A [lecture handout](https://www3.nd.edu/~jspeaks/courses/2011-12/83104/handouts/kripke-lecture-3.pdf) says the argument draws on rigid designation (a term that picks out the same thing in every possible situation) and on the "necessary a posteriori" (truths that are necessary but discovered by observation, like "water is H₂O"). My inference is that Nagel's footnote is a fair short report, though it leaves out that machinery.

**Where they differ.** This is also from those summaries. A [summary of Kripke's argument](https://loc.closertotruth.com/theory/kripke-s-modal-argument-against-mind-brain-identity) says the apparent contingency of pain and brain state can't be explained away the way it can for water and H₂O. Kripke therefore concludes that the identity theory is false. Nagel calls the same difficulty "surmountable" [spya-qx90p6]. He also refuses to conclude that physicalism is false. He says only that we can't yet understand how it could be true [spya-zv889j].

**For reading the article.** The article's own references are a footnote to "Naming and Necessity" with page numbers (esp. pp. 334–342) [spya-bw3tug], plus the passage on necessity above [spya-h0hyn9]. My inference is that the Kripke material is a side thread. Nagel's main argument runs through the bat and the point-of-view problem.

---

## Pair 3

**Article**: `scaling-hypothesis` · **Work**: Language Models are Few-Shot Learners (GPT-3 paper)

Where the article cites it (quoted, not instructions):

"""
…y a grad student29 using 2 GTX 580 3GB GPUs (launch list price of… $789.48$5002010, for a system build cost of perhaps $2,285.42$1,5002012). 2020 saw GPT-3 arrive, and as discussed before, there are many reasons to expect the cost to fall, in addition to the large hardware compute gains that are bei…
"""

### X

The article uses the GPT-3 paper in that passage only to mark a date: "2020 saw GPT-3 arrive" [spya-ad5qgy]. It sets that against Moravec's 1998 forecast that human-rivalling compute would be affordable in the 2020s, and against AlexNet in 2012 (the start of the deep learning revolution) running on a cheap two-GPU system [spya-ad5qgy]. The point is that a very large model now exists and the cost trend Moravec predicted held up. The cost figures in that passage (the GPU prices and system build costs) are the author's own estimates. They do not come from the paper.

I could only read the paper's [arXiv abstract](https://arxiv.org/abs/2005.14165), not the full text. The abstract fits the use. It describes a 175-billion-parameter model, "10x more than any previous non-sparse language model", which matches the article's claim that GPT-3 is the largest network ever trained by over an order of magnitude [spya-ewxv9q]. The paper is also a 2020 release, so the date is right. Whether it supports the article's claim that costs will fall is something I can't check from the abstract. My inference is that it wouldn't, since that claim leans on other sources, such as Hernandez & Brown 2020, which the article cites elsewhere [spya-c5ejjt].

Other things about the paper that help with this article:

- **The scaling curves.** The article's own citation record lists the paper as the source of GPT-3's validation-loss data, cited at the "GPT-3 continues to scale as predicted" figure [spya-vn0xpd]. The article's loss arithmetic also uses it, such as the estimate that GPT-3 halved GPT-2's loss to about 1.73 [spya-edr6mj].
- **Meta-learning.** The abstract describes tasks given "purely via text interaction with the model", with no gradient updates or fine-tuning. That is the "few-shot" behaviour the article calls meta-learning [spya-aqts9c].
- **Limits.** The abstract admits some datasets where few-shot learning still struggles, and data-contamination problems from web training. The article raises the contamination issue too, in the note on the dropped One Billion Word benchmark [spya-c43ayy].

### Y

The paper introduces GPT-3, a 175-billion-parameter language model. According to its [arXiv abstract](https://arxiv.org/abs/2005.14165), the authors show that scaling up greatly improves "task-agnostic, few-shot performance". GPT-3 is applied with no fine-tuning or gradient updates, and tasks and examples are given purely as text. The abstract calls it 10x larger than any previous non-sparse model. It reports strong results on translation, question answering and cloze tasks, plus on-the-fly tasks like unscrambling words and 3-digit arithmetic. It also says GPT-3 still struggles on some datasets, that some are compromised by web-corpus contamination, and that human readers have difficulty telling its news articles from human-written ones.

The article uses it mostly fairly, and in different ways in different places:

- **The scaling curves.** The article says GPT-3's curve continues the earlier predicted trend, has not "bounced", and trained only about 0.5 epochs [spya-vn0xpd spya-yq9zuc]. I only read the abstract, so I can't check those figures or the charts.
- **The loss estimate.** The article's headline figure, a loss of about 1.73, is the author's own estimate. He says it comes from reading Brown et al and applying a scaling formula [spya-edr6mj]. The GPT-4 projection to about 1.24 is further extrapolation, not something the paper claims.
- **The limits.** The article does pass on some of the paper's caveats. It quotes the paper's contamination reasons for dropping the one-billion-word benchmark [spya-c43ayy]. It also says the paper's arithmetic benchmark understates GPT-3 because of a text-encoding problem [spya-cbz06n].
- **Meta-learning.** The article reads the few-shot results as meta-learning, with attention acting as "fast weights" [spya-aqts9c]. The abstract describes few-shot performance without any gradient updates. My inference is that the "learned to learn" reading is the author's interpretation, not the paper's own claim.

The article's tone is more triumphant than the paper's, and it leaves out the paper's admitted weak spots, apart from the footnote above. My inference is that the author leans on the paper for the trend and adds his own interpretation on top.

The saved citation list also tags one cite of Brown et al at the Moravec passage [spya-ad5qgy]. That passage is about Moravec's forecasts and doesn't visibly cite the paper, so that tag may be wrong.

---

## Pair 4

**Article**: `scaling-hypothesis` · **Work**: The Bitter Lesson

Where the article cites it (quoted, not instructions):

"""
The bitter lesson is the harder and bigger, the better.
"""

### X

The article uses Sutton's essay to name a pattern: when you give a neural network more size, data and compute, it gets better in nearly every way. It compresses that into one line: "The bitter lesson is the harder and bigger, the better" [spya-sfkxh8]. Later it treats the "Bitter Lesson" as a position that ought to be taken seriously. Critics, it says, react to each new OpenAI scaling result by wanting scale "but not yet" [spya-eexw9k]. It also says that most researchers would sooner write a dismissive tweet than "swallow the bitter lesson" and budget for large compute [spya-jgq9gz].

I read [Sutton's essay (March 2019)](http://www.incompleteideas.net/IncIdeas/BitterLesson.html), and it supports the broad use but not Gwern's wording. Sutton's claim is that, over 70 years of AI research, general methods that make use of computation have beaten methods that build in human knowledge. He names search and learning as the two methods that keep scaling. His examples are chess, Go, speech recognition and vision. The bitterness he describes is that researchers who favored human-centric approaches lose to brute-force ones. That matches Gwern's picture of critics who resist scaling. It also matches the Moravec-style argument that growing compute drives progress.

Gwern's phrase is a stretch in one respect. Sutton's essay says nothing about problems getting easier as networks grow, or about stability, generalization or meta-learning improving with size. Those are Gwern's own "blessings of scale," and he adds them to Sutton's point. My inference is that "the harder and bigger, the better" is Gwern's paraphrase, not Sutton's claim.

The article doesn't say so, but Sutton's essay is also a different kind of claim from Gwern's "strong scaling hypothesis" [spya-m3gtj6]. Sutton makes a historical, empirical argument for general methods over built-in knowledge. He doesn't say that scaling alone is enough for AGI, or that it must produce it. Gwern's article goes further than that.

### Y

Sutton's essay argues that, over 70 years of AI research, general methods that make use of more computation have beaten methods built on human knowledge of a domain. [Sutton's essay, "The Bitter Lesson"](http://www.incompleteideas.net/IncIdeas/BitterLesson.html) gives chess, Go, speech recognition and vision as examples. He says human-knowledge approaches help in the short run but later plateau. Progress then arrives through "search and learning" at scale. The "bitter" part is that the winning approach displaces the one researchers favoured. He also says we should build in only meta-methods that can discover things, not our own discoveries.

The article uses it in three places. It uses the phrase as a rallying label, saying the "Bitter Lesson/scaling hypothesis" should by now deserve serious investment [spya-eexw9k]. It says critics would sooner write a dismissive tweet than "swallow the bitter lesson" [spya-jgq9gz]. And it redefines the phrase: "the bitter lesson is the harder and bigger, the better" [spya-sfkxh8].

My inference is that the first two uses are fair. They match Sutton's complaint that researchers resist a lesson that undercuts their favoured approach. The article's own gloss in [spya-sfkxh8] stretches the term, though. Sutton's claim is about computation-leveraging methods beating hand-built knowledge. The article's version is a claim about neural nets: that they become more stable and general as they get larger, the "blessings of scale." Sutton says nothing about neural networks improving as they grow, so this is the article's own extension.

The article also goes beyond Sutton in a second way. It argues scaling will yield general intelligence, and it frames the "scaling hypothesis" as a prediction. Sutton's essay is retrospective and does not forecast AGI. The article also attacks researchers' motives, saying the experts' comments on AI risk are "meaningless" [spya-ewxv9q]. That goes beyond Sutton's milder remark about psychological commitments.

The article doesn't claim Sutton endorses its forecasts, so "unfair" is too strong. "Borrowed and broadened" is closer.

---

## Pair 5

**Article**: `fd-src-nagel-bat-spya-f5aw85` · **Work**: Mental Events

Where the article cites it (quoted, not instructions):

"""
Donald Davidson has argued that if mental events have physical causes and effects, they must have physical descriptions.
"""

### X

Nagel uses it fairly. He gives a short, accurate sketch, says where it stops applying, and marks the extension to sensations as his own.

The article doesn't say much about the paper itself. Nagel credits Davidson with the view that if mental events have physical causes and effects, they must have physical descriptions. He adds that we have reason to believe this even though there could be no general psychophysical theory [spya-x9nmge]. The footnote adds that he doesn't understand Davidson's argument against psychophysical laws [spya-qg0fhb]. That footnote is run together with the notes after it, so it reads as garbled.

Outside the article, the standard account of "Mental Events" is anomalous monism. Each individual mental event is identical to some physical event, but no strict laws link mental descriptions to physical ones. [Stanford Encyclopedia of Philosophy](https://plato.stanford.edu/entries/anomalous-monism/) sums it up as justifying token-identity (each particular mental event is a particular physical event) by arguing that type-identities (a kind of mental state matching a kind of brain state) are impossible. The argument rests on three premises. Mental and physical events interact causally. Causes and effects fall under strict laws. There are no strict psychophysical laws ([Wikipedia](https://en.wikipedia.org/wiki/Anomalous_monism)). Nagel's phrase "irreducibly mental properties" matches this.

Two points on fairness. First, Nagel says Davidson's argument "applies to intentional mental events" [spya-x9nmge]. That is correct: [the Stanford entry](https://plato.stanford.edu/archives/sum2018/entries/anomalous-monism/) says the theory covers propositional attitudes such as belief and desire, not pains or other felt states. So Nagel isn't claiming Davidson addressed consciousness. The step to sensations is his own, hedged as "some reason to believe."

Second, Nagel doesn't treat Davidson as a solution. He says nothing we can now conceive corresponds to the view, and we have no idea what a theory enabling us to conceive it would look like [spya-x9nmge]. My inference is that Davidson serves Nagel as a "caterpillar and butterfly" case, where we have evidence for an identity we can't yet understand [spya-a5hz7t]. He is not offered as an answer to the subjective-character problem.

### Y

The article uses Davidson to show that you can have good reason to believe something you can't yet understand. The passage is [spya-x9nmge], and it follows the caterpillar-and-butterfly example [spya-a5hz7t]. There, someone has evidence that the butterfly "is" the caterpillar without any idea how that could be so. Nagel says physicalism may be in the same position. Davidson's argument is that if mental events have physical causes and effects, they must have physical descriptions, and we have reason to believe this even though we couldn't have a general psychophysical theory [spya-x9nmge]. Nagel then adds two limits. Davidson's argument covers intentional mental events (thoughts, desires), and Nagel extends it to sensations only tentatively. Also, nothing we can now conceive of corresponds to Davidson's view that physical events have irreducibly mental properties [spya-x9nmge]. A footnote says Nagel doesn't understand the argument against psychophysical laws [spya-qg0fhb].

I haven't read "Mental Events" itself, only secondary sources, so I can't check Nagel's reading against the text. Those sources do support the way Nagel summarises it. Davidson's view is called anomalous monism. It combines three claims:

- Mental events cause physical ones.
- Causation requires strict laws.
- No strict psychophysical laws exist.

On the [Stanford Encyclopedia of Philosophy entry](https://plato.stanford.edu/entries/anomalous-monism/), this makes each mental event identical to a physical event, even though mental descriptions can't be reduced to physical ones. This is the "no general psychophysical theory" point Nagel mentions. The same entry says the view applies to thoughts and actions, which fits Nagel's remark that it covers intentional events.

My inference is that the support is real but limited. Davidson gives a reason to think mental events are physical without explaining how, which is exactly the kind of position Nagel wants. But Davidson's argument starts from causal interaction, not from what experience is like. So it can't tell us how the subjective character of an experience could be a physical matter. That is why Nagel hedges about sensations.

The article doesn't say so, but Davidson's paper is usually read as a defence of a non-reductive physicalism. That fits Nagel's wider complaint that reduction can't capture subjective character.

---

## Pair 6

**Article**: `scaling-hypothesis` · **Work**: Scaling Laws for Neural Language Models

(The article does not cite this work in its body; it appears only in the references or a note.)

### X

The article uses Kaplan et al. to argue that language-model scaling is smooth and predictable, with a lot of room left past GPT-3. It says the leaps of recent years are "not even half way there in terms of absolute likelihood loss" and that the scaling curves are clean [spya-sctj6d]. Gwern shows the paper's figure, notes that GPT-3 sits at roughly 10^3 on that chart with "plenty of room for further loss decreases", and warns that extrapolation is uncertain [spya-hqpffq]. He then says GPT-3 continues the trend for several orders of magnitude beyond the paper's range [spya-vn0xpd].

The paper's abstract (I read only the [arXiv abstract](https://arxiv.org/abs/2001.08361), not the full paper) supports the core claim. It reports that the loss scales as a power-law with model size, dataset size, and the amount of compute used for training, with some trends spanning more than seven orders of magnitude. That fits "clean curves".

The abstract can't tell me whether the paper says anything about being "not even half way there". That is Gwern's reading of where the curves lead. My inference is that it is an extrapolation of the paper's fits, not a result the paper states. The figure he reproduces and the "~10^3" placement are also things I haven't checked.

Three other points help with the rest of the article:

- The abstract says larger models are significantly more sample-efficient, so compute-optimal training means very large models on modest data, stopped well before convergence. This is the background for his remark that GPT-3 trained only ~0.5 epochs [spya-yq9zuc].
- The loss formula he uses for his "GPT-4" estimate is a power law, so it is the kind of fit this paper made [spya-edr6mj]. His projected loss of about 1.24 for 100–1000× more compute is his own extrapolation.
- The paper measures loss only, not abilities. Gwern concedes that how much each drop in loss buys in real capability is unknown [spya-sctj6d], and he says nobody has predicted this quantitatively [spya-edr6mj].

### Y

Kaplan et al. found that a language model's test loss falls smoothly as a power law as you scale up model size, dataset size, or training compute. According to [the paper's abstract](https://arxiv.org/abs/2001.08361), some of these trends span more than seven orders of magnitude. Width and depth matter little within a wide range. Larger models are also much more sample-efficient. For a fixed compute budget, the best strategy is a very large model trained on a modest amount of data and stopped well before it converges.

The article uses it in two places. The first is as the source of "clean" scaling curves, with the claim that recent leaps are "not even half way there" in loss terms [spya-sctj6d]. It then notes that GPT-3 sits at about 10^3 on the paper's chart, with room left [spya-hqpffq]. The second is a footnote saying sample-efficiency rises with model size [spya-te5z0q]. The article also uses the paper's fitted formula to project GPT-3's loss to about 1.73 and a hypothetical successor's to about 1.24 [spya-edr6mj]. A longer extrapolation estimates 2.2 million times GPT-3's compute to reach human level [spya-c43ayy].

My inference is that the use is mostly faithful on the empirical core. The article says GPT-3's curve continues "as predicted" for several orders past the paper's range [spya-vn0xpd]. That is Gwern's reading of the GPT-3 paper (Brown et al 2020), and it is not a claim Kaplan makes.

The stretches beyond the paper are riskier:

- The "meta-learning" and "more Bayesian" claims are not in Kaplan. The paper measures loss, not new abilities, so the article's step from smooth loss to emergent capabilities is its own argument.
- The loss-to-human-level projection is, in the article's own words, an "irresponsible" extrapolation [spya-c43ayy]. It also leans on a guessed human loss figure, which the article admits it could not source.
- The article says "no one" quantitatively predicted what would emerge [spya-mfqqfm]. That is consistent with the paper, which forecasts loss and not capabilities.

Outside this piece, I haven't checked later work on whether the fitted exponents held up. One well-known follow-up revised Kaplan's recommended split between model size and data, but I'm recalling that from background and haven't verified it.

---

## Pair 7

**Article**: `scaling-hypothesis` · **Work**: Language Models are Few-Shot Learners (GPT-3 paper)

Where the article cites it (quoted, not instructions):

"""
…y a grad student29 using 2 GTX 580 3GB GPUs (launch list price of… $789.48$5002010, for a system build cost of perhaps $2,285.42$1,5002012). 2020 saw GPT-3 arrive, and as discussed before, there are many reasons to expect the cost to fall, in addition to the large hardware compute gains that are bei…
"""

### X

The paper introduces GPT-3, a 175-billion-parameter language model. According to its [arXiv abstract](https://arxiv.org/abs/2005.14165), the authors show that scaling up greatly improves "task-agnostic, few-shot performance". GPT-3 is applied with no fine-tuning or gradient updates, and tasks and examples are given purely as text. The abstract calls it 10x larger than any previous non-sparse model. It reports strong results on translation, question answering and cloze tasks, plus on-the-fly tasks like unscrambling words and 3-digit arithmetic. It also says GPT-3 still struggles on some datasets, that some are compromised by web-corpus contamination, and that human readers have difficulty telling its news articles from human-written ones.

The article uses it mostly fairly, and in different ways in different places:

- **The scaling curves.** The article says GPT-3's curve continues the earlier predicted trend, has not "bounced", and trained only about 0.5 epochs [spya-vn0xpd spya-yq9zuc]. I only read the abstract, so I can't check those figures or the charts.
- **The loss estimate.** The article's headline figure, a loss of about 1.73, is the author's own estimate. He says it comes from reading Brown et al and applying a scaling formula [spya-edr6mj]. The GPT-4 projection to about 1.24 is further extrapolation, not something the paper claims.
- **The limits.** The article does pass on some of the paper's caveats. It quotes the paper's contamination reasons for dropping the one-billion-word benchmark [spya-c43ayy]. It also says the paper's arithmetic benchmark understates GPT-3 because of a text-encoding problem [spya-cbz06n].
- **Meta-learning.** The article reads the few-shot results as meta-learning, with attention acting as "fast weights" [spya-aqts9c]. The abstract describes few-shot performance without any gradient updates. My inference is that the "learned to learn" reading is the author's interpretation, not the paper's own claim.

The article's tone is more triumphant than the paper's, and it leaves out the paper's admitted weak spots, apart from the footnote above. My inference is that the author leans on the paper for the trend and adds his own interpretation on top.

The saved citation list also tags one cite of Brown et al at the Moravec passage [spya-ad5qgy]. That passage is about Moravec's forecasts and doesn't visibly cite the paper, so that tag may be wrong.

### Y

**What it says.** According to its [arXiv abstract](https://arxiv.org/abs/2005.14165), the paper trains GPT-3, a 175-billion-parameter model. The abstract calls it ten times larger than any earlier non-sparse language model. It is tested "without any gradient updates or fine-tuning", with tasks and examples given purely as text. The abstract reports strong results on many tasks and some that need on-the-fly reasoning, such as unscrambling words and 3-digit arithmetic. It also says GPT-3 struggles on some datasets and has problems from training on web data. Finally, it reports that human judges had difficulty telling GPT-3's news articles from human-written ones.

**How the article uses it.** The article cites the paper for the scaling curve: GPT-3's loss keeps falling along the predicted line, with no "bounce" [spya-vn0xpd spya-yq9zuc]. It also uses the paper for the loss figure in the GPT-4 projection [spya-edr6mj]. The abstract doesn't mention scaling curves or validation loss, so I can't check those claims from it. The paper's body would settle that.

On the points I can check, the use looks broadly fair. The article's 175b size and its "no specialized training or finetuning" description match the abstract [spya-aqts9c]. It also says the 117× jump over GPT-2 [spya-aqts9c], which the abstract doesn't cover.

The article is more forceful than the paper, though. The paper reports mixed results and flags weaknesses. The article treats the paper as evidence for a much bigger claim, the scaling hypothesis [spya-ewxv9q]. It also does cite the paper's contamination caveat, in a footnote [spya-c43ayy], and it acknowledges that the arithmetic benchmark understates GPT-3 [spya-cbz06n].

My inference is that the article reads the paper's data accurately but supplies the interpretation itself. The abstract frames the result as few-shot learning improving with scale. It doesn't say that this shows the route to AGI.

---

## Pair 8

**Article**: `arxiv-1706-03762v7-spya-wv4w9s` · **Work**: Convolutional sequence to sequence learning

Where the article cites it (quoted, not instructions):

"""
The goal of reducing sequential computation also forms the foundation of the Extended Neural GPU [16], ByteNet [18] and ConvS2S [9], all of which use convolutional neural networks as basic building block, computing hidden representations in parallel for all input and output positions.

There are many choices of positional encodings, learned and fixed [9].
"""

### X

**What it says.** The cited paper is an architecture built entirely from convolutional networks, with no recurrence. According to [its arXiv abstract](https://arxiv.org/abs/1705.03122), all positions can be computed in parallel during training. It uses gated linear units, and each decoder layer has its own attention module. It also reports beating the deep LSTM system of Wu et al. (2016) on WMT'14 English-German and English-French translation, at roughly ten times the speed.

**How the article uses it.** There are three uses, and I could only check them against the abstract, not the full paper:

- **Path length.** The article groups ConvS2S with ByteNet and the Extended Neural GPU as models that also aim to cut sequential computation. It says that relating two distant positions takes a number of operations that grows linearly with their distance for ConvS2S [spya-dyxt29]. The abstract does not mention this, so I can't confirm the specific claim. The article's own Table 1 gives the general convolutional figure as logarithmic in dilated cases [spya-fnrjku], and the contrast with ConvS2S's "linear" is the article's characterisation, not something I verified.
- **Positional embeddings.** The article cites it for learned positional embeddings as an alternative to its sinusoids [spya-n0acqb]. It reports that the two gave nearly identical results in its own test [spya-a9hsvs spya-gbqhxf]. That is the Transformer authors' experiment, not a claim about ConvS2S itself.
- **Benchmark.** ConvS2S and its ensemble appear as baselines in Table 2 [spya-p9uqvv]. The abstract says ConvS2S beat Wu et al.'s system and ran faster. That fits the article placing it among the stronger earlier results.

**Fairness.** My inference is that the use looks fair. The comparison is on the same benchmarks, and the article says the Transformer beats it by more than 2 BLEU on English-German, counting ensembles [spya-qsc4jq]. Two caveats follow from the article's text. The English-French claim is only "single models" [spya-x6ys73]. The abstract also says 41.8 [spya-r4309p], while the results section says 41.0 [spya-x6ys73], so that inconsistency sits inside the article. Table 2 lists ConvS2S's ensemble at 41.29, which is close to 41.8 [spya-p9uqvv]. I haven't checked the table's numbers against the ConvS2S paper itself. If the path-length claim matters to you, that is the part worth checking in the full text.

### Y

The article uses ConvS2S for two things. I could only read the paper's abstract, not its full text.

**First use:** ConvS2S is one of several convolutional models that, like the Transformer, try to cut down sequential computation by computing hidden representations for all positions in parallel [spya-dyxt29]. The article then says these models need more operations to connect two distant positions: the number grows linearly with distance for ConvS2S and logarithmically for ByteNet. That, it says, makes long-range dependencies harder to learn, whereas the Transformer needs a constant number [spya-dyxt29]. The same point reappears in the path-length comparison [spya-d92nsg] and in Table 1 [spya-crcpjy].

**Second use:** the article cites ConvS2S for learned positional embeddings, as an alternative to the fixed sine and cosine encodings [spya-n0acqb]. The authors tested that alternative and found nearly identical results [spya-a9hsvs]. They chose the sinusoids because they might extrapolate to longer sequences [spya-a9hsvs].

**Does the work support this?** Partly, on what I could check. The [arXiv abstract](https://arxiv.org/abs/1705.03122) describes an architecture built entirely on convolutional networks. It says computation over all elements can be fully parallelized during training, and that each decoder layer gets its own attention module. That matches the article's description. The abstract says nothing about the linear growth in path length, or about learned positional embeddings. The article's own reasoning, that stacked convolutions need more layers to link distant positions, is not something the abstract settles [spya-fnrjku]. I haven't verified either point against the full paper.

**Context that helps:**
- The abstract says ConvS2S beat the deep LSTM system of Wu et al. (2016) on English-German and English-French translation, at an order of magnitude faster speed. That makes it a strong, recent rival, which is why it is the main comparison in Table 2 [spya-p9uqvv].
- My inference is that this explains the Transformer's selling point. ConvS2S was already parallel and fast, so the Transformer's case rests on better BLEU scores (a translation quality measure) at lower training cost [spya-qsc4jq], plus the shorter path between distant positions.
- ConvS2S still uses attention, so it isn't a pure convolution model. The abstract says each decoder layer has an attention module. The Transformer's claim to be the first model relying entirely on self-attention [spya-vr7tsj] is consistent with that.
- The article doesn't say so, but ConvS2S came out in May 2017, only about a month before this paper. It was very recent work at the time.

---

## Pair 9

**Article**: `fd-src-nagel-bat-spya-f5aw85` · **Work**: Mental Events

Where the article cites it (quoted, not instructions):

"""
Donald Davidson has argued that if mental events have physical causes and effects, they must have physical descriptions.
"""

### X

Davidson's "Mental Events" (1970) argues that every mental event is a physical event, yet mental descriptions can't be tied to physical ones by strict laws. The article uses it fairly. It says openly that it is stretching the argument.

**What the paper says (not from the article).** Davidson starts from three premises. These are that mental and physical events cause each other, that events related as cause and effect fall under strict laws, and that there are no strict psychophysical or psychological laws linking mental events to physical ones. [The Stanford Encyclopedia of Philosophy](https://plato.stanford.edu/entries/anomalous-monism/) puts the result this way: each causally interacting mental event is the very same event as some physical event, but mental properties can't be reduced to physical ones. This view is called anomalous monism. "Anomalous" means "not law-governed". "Monism" means that everything is one kind of thing.

**How the article uses it.** Nagel cites Davidson as a case where we may have good reason to believe something we can't yet understand. He compares it to the caterpillar in the safe [spya-a5hz7t]. He says Davidson holds that mental events with physical causes and effects must have physical descriptions, and that we have reason to believe this even though there could be no general psychophysical theory [spya-x9nmge]. That matches the paper. Nagel also describes Davidson's view as physical events with "irreducibly mental properties" [spya-x9nmge]. That is a fair gloss on anomalism.

**Where it stretches.** Nagel admits that Davidson's argument is about intentional events, and that his own extension to sensations is a further step: "I think we also have some reason" [spya-x9nmge]. According to the [Stanford entry](https://plato.stanford.edu/entries/anomalous-monism/), Davidson limits the theory to propositional attitudes, such as beliefs and desires. It does not address pains, tickles and other sentient mental events. The subjective character of experience is Nagel's whole concern, so the borrowing carries a lot of weight and rests on his own inference.

Nagel also hedges. He says nothing we can now conceive corresponds to Davidson's view [spya-x9nmge]. In the footnote he says he doesn't understand Davidson's argument against psychophysical laws [spya-qg0fhb]. That is a mild reservation, not an endorsement of the full argument.

### Y

Nagel uses it fairly. He gives a short, accurate sketch, says where it stops applying, and marks the extension to sensations as his own.

The article doesn't say much about the paper itself. Nagel credits Davidson with the view that if mental events have physical causes and effects, they must have physical descriptions. He adds that we have reason to believe this even though there could be no general psychophysical theory [spya-x9nmge]. The footnote adds that he doesn't understand Davidson's argument against psychophysical laws [spya-qg0fhb]. That footnote is run together with the notes after it, so it reads as garbled.

Outside the article, the standard account of "Mental Events" is anomalous monism. Each individual mental event is identical to some physical event, but no strict laws link mental descriptions to physical ones. [Stanford Encyclopedia of Philosophy](https://plato.stanford.edu/entries/anomalous-monism/) sums it up as justifying token-identity (each particular mental event is a particular physical event) by arguing that type-identities (a kind of mental state matching a kind of brain state) are impossible. The argument rests on three premises. Mental and physical events interact causally. Causes and effects fall under strict laws. There are no strict psychophysical laws ([Wikipedia](https://en.wikipedia.org/wiki/Anomalous_monism)). Nagel's phrase "irreducibly mental properties" matches this.

Two points on fairness. First, Nagel says Davidson's argument "applies to intentional mental events" [spya-x9nmge]. That is correct: [the Stanford entry](https://plato.stanford.edu/archives/sum2018/entries/anomalous-monism/) says the theory covers propositional attitudes such as belief and desire, not pains or other felt states. So Nagel isn't claiming Davidson addressed consciousness. The step to sensations is his own, hedged as "some reason to believe."

Second, Nagel doesn't treat Davidson as a solution. He says nothing we can now conceive corresponds to the view, and we have no idea what a theory enabling us to conceive it would look like [spya-x9nmge]. My inference is that Davidson serves Nagel as a "caterpillar and butterfly" case, where we have evidence for an identity we can't yet understand [spya-a5hz7t]. He is not offered as an answer to the subjective-character problem.

---

## Pair 10

**Article**: `fd-src-nagel-bat-spya-f5aw85` · **Work**: Philosophy and Scientific Realism

(The article does not cite this work in its body; it appears only in the references or a note.)

### X

Smart's book is a defence of the "identity theory", the view that sensations are brain processes. Nagel cites it as one of several examples of recent reductionist work he thinks avoids the real problem [spya-c4shay].

**What the book says.** The article doesn't describe it. The sources I found say the following:
- [Smart's central claim](https://grokipedia.com/page/J._J._C._Smart) is that mental states such as sensations are identical to specific brain processes. He first argued this in his 1959 paper "Sensations and Brain Processes". The book restates and extends that case, and other writers cite its chapter 5 for his version of the thesis ([Maxwell, 1968](https://discovery-pp.ucl.ac.uk/id/eprint/1348842/1/1348842.pdf)).
- [Smart held that sensation reports are "topic-neutral"](https://www.cambridge.org/core/journals/philosophy/article/abs/sensations-experiences-and-brain-processes/B439749544C2BD6F668B4AF37B9A2D1A). That means a report like "I am having a red after-image" says something about an inner state without saying what kind of state it is, so it can turn out to be a brain process.
- [On the Smart–Feigl view](https://en.wikipedia.org/wiki/Ullin_Place), "sensation" and "brain process" differ in meaning but refer to the same thing, as "morning star" and "evening star" both refer to Venus. The identity is contingent, not necessary.

**Is the use fair?** It is a fair use, though a thin one. Nagel only lists the book as an example of analyses "designed to explain the possibility of some variety of materialism" [spya-c4shay]. He doesn't quote it or argue with a specific passage. His charge is that such analyses are "logically compatible" with the absence of subjective character [spya-aczb7j].

My inference is that the charge fits Smart's topic-neutral move well. That move deliberately describes sensations without saying what they are like, which is the part Nagel says gets left out. Nagel's own objection to the "usual analogies" with other cases of reduction [spya-p8ecxj] also bears on Smart. As far as I know, Smart often used the lightning and electrical-discharge example. That is from memory and I haven't checked it.

One caveat: Nagel lumps Smart together with Lewis, Putnam, Armstrong and Dennett. Smart's view is not the same as the functionalist views of some of them. Nagel's footnote [spya-bw3tug] says only that these are the examples, so the book's own arguments aren't tested in the piece.

### Y

The article never says what Smart argues. It only lists his book among "examples" of the "recent wave of reductionist euphoria" [spya-c4shay]. The full reference sits in the first footnote [spya-bw3tug].

The article doesn't say so, but from my background knowledge (I haven't checked this against a source): Smart was a leading defender of the "identity theory". This is the view that sensations just are brain processes. His best-known version of it is the 1959 paper "Sensations and Brain Processes", and I believe the 1963 book includes his treatment of the topic. His model for the identity was scientific discoveries like lightning being an electrical discharge. He also held that reports of inner experience can be given in "topic-neutral" terms, which avoids saying what the experience is like. Treat this summary as unverified.

My inference is that the use is fair as far as it goes, but it is brief and broad. Nagel doesn't quote Smart. He groups him with Lewis, Putnam, Armstrong and Dennett as sharing a type of reduction. He says their problems "are those common to this type of reduction" [spya-c4shay]. He also says that analogies such as lightning and water-H₂O "will not shed light" on mind and brain [spya-pp9ysu].

Smart's lightning-style analogy is the one Nagel answers most directly. He argues that lightning can be understood from many points of view, but experience seems tied to a single one [spya-d7dvns spya-k43dc2]. He also says that a causal or functional analysis leaves out the subjective character [spya-aczb7j]. The charge is about what is left out of the analysis, not about any particular passage in Smart.

To judge fairness, you would need to read Smart's own reply. As I remember it, he wrote about this worry in his own work, but I haven't verified that.

---

## Pair 11

**Article**: `scaling-hypothesis` · **Work**: Scaling Laws for Neural Language Models

(The article does not cite this work in its body; it appears only in the references or a note.)

### X

Kaplan et al. found that a language model's test loss falls smoothly as a power law as you scale up model size, dataset size, or training compute. According to [the paper's abstract](https://arxiv.org/abs/2001.08361), some of these trends span more than seven orders of magnitude. Width and depth matter little within a wide range. Larger models are also much more sample-efficient. For a fixed compute budget, the best strategy is a very large model trained on a modest amount of data and stopped well before it converges.

The article uses it in two places. The first is as the source of "clean" scaling curves, with the claim that recent leaps are "not even half way there" in loss terms [spya-sctj6d]. It then notes that GPT-3 sits at about 10^3 on the paper's chart, with room left [spya-hqpffq]. The second is a footnote saying sample-efficiency rises with model size [spya-te5z0q]. The article also uses the paper's fitted formula to project GPT-3's loss to about 1.73 and a hypothetical successor's to about 1.24 [spya-edr6mj]. A longer extrapolation estimates 2.2 million times GPT-3's compute to reach human level [spya-c43ayy].

My inference is that the use is mostly faithful on the empirical core. The article says GPT-3's curve continues "as predicted" for several orders past the paper's range [spya-vn0xpd]. That is Gwern's reading of the GPT-3 paper (Brown et al 2020), and it is not a claim Kaplan makes.

The stretches beyond the paper are riskier:

- The "meta-learning" and "more Bayesian" claims are not in Kaplan. The paper measures loss, not new abilities, so the article's step from smooth loss to emergent capabilities is its own argument.
- The loss-to-human-level projection is, in the article's own words, an "irresponsible" extrapolation [spya-c43ayy]. It also leans on a guessed human loss figure, which the article admits it could not source.
- The article says "no one" quantitatively predicted what would emerge [spya-mfqqfm]. That is consistent with the paper, which forecasts loss and not capabilities.

Outside this piece, I haven't checked later work on whether the fitted exponents held up. One well-known follow-up revised Kaplan's recommended split between model size and data, but I'm recalling that from background and haven't verified it.

### Y

The paper reports that language-model loss follows clean power laws. [Its abstract](https://arxiv.org/abs/2001.08361) says loss falls as a power law in model size, dataset size and training compute, with some trends spanning more than seven orders of magnitude. It also says width and depth matter little within a wide range. Larger models are more sample-efficient, so the compute-optimal recipe is a very large model trained on modest data and stopped well before convergence.

The article uses it for the claim that the scaling curves are "clean" and that GPT-3 sits at roughly 10³ on the chart, leaving "plenty of room" for further loss decreases [spya-sctj6d spya-hqpffq]. That matches the paper's central finding. The article then says GPT-3 continued the laws "for several orders past" Kaplan et al, citing Brown et al 2020 [spya-vn0xpd]. That is a separate claim resting on a different paper.

Three places stretch what the paper shows:

- **Loss versus ability.** Kaplan et al measure cross-entropy loss, which is how well the model predicts the next piece of text. The article's own wording is careful here, saying the leaps are "not even half way there in terms of absolute likelihood loss, never mind" real-world capabilities [spya-sctj6d]. But elsewhere it leans on these curves for claims about meta-learning, and asks what a loss near 1 would "gain" [spya-edr6mj]. The article admits it can't say what would emerge [spya-f6zupy]. My inference is that the paper cannot support those capability claims.
- **Extrapolation.** The article says it is "irresponsibly" extrapolating [spya-c43ayy]. It also notes "uncertainty in extrapolation" [spya-hqpffq]. So it flags the risk itself.
- **The paper's own advice.** The article stresses bigger models. The abstract's "stopping significantly before convergence" point fits this, since GPT-3 trained for roughly half an epoch [spya-yq9zuc]. I haven't read the full paper, so I can't say whether it makes any caveats the article leaves out.

On balance, the article uses the paper fairly for the shape of the curves. It goes beyond the paper when it turns those curves into predictions about intelligence. It does flag that step as speculation.

---

## Pair 12

**Article**: `scaling-hypothesis` · **Work**: The Bitter Lesson

Where the article cites it (quoted, not instructions):

"""
The bitter lesson is the harder and bigger, the better.
"""

### X

Sutton's essay argues that, over 70 years of AI research, general methods that make use of more computation have beaten methods built on human knowledge of a domain. [Sutton's essay, "The Bitter Lesson"](http://www.incompleteideas.net/IncIdeas/BitterLesson.html) gives chess, Go, speech recognition and vision as examples. He says human-knowledge approaches help in the short run but later plateau. Progress then arrives through "search and learning" at scale. The "bitter" part is that the winning approach displaces the one researchers favoured. He also says we should build in only meta-methods that can discover things, not our own discoveries.

The article uses it in three places. It uses the phrase as a rallying label, saying the "Bitter Lesson/scaling hypothesis" should by now deserve serious investment [spya-eexw9k]. It says critics would sooner write a dismissive tweet than "swallow the bitter lesson" [spya-jgq9gz]. And it redefines the phrase: "the bitter lesson is the harder and bigger, the better" [spya-sfkxh8].

My inference is that the first two uses are fair. They match Sutton's complaint that researchers resist a lesson that undercuts their favoured approach. The article's own gloss in [spya-sfkxh8] stretches the term, though. Sutton's claim is about computation-leveraging methods beating hand-built knowledge. The article's version is a claim about neural nets: that they become more stable and general as they get larger, the "blessings of scale." Sutton says nothing about neural networks improving as they grow, so this is the article's own extension.

The article also goes beyond Sutton in a second way. It argues scaling will yield general intelligence, and it frames the "scaling hypothesis" as a prediction. Sutton's essay is retrospective and does not forecast AGI. The article also attacks researchers' motives, saying the experts' comments on AI risk are "meaningless" [spya-ewxv9q]. That goes beyond Sutton's milder remark about psychological commitments.

The article doesn't claim Sutton endorses its forecasts, so "unfair" is too strong. "Borrowed and broadened" is closer.

### Y

Sutskever's essay-length claim is short, so here is what it says and how the article uses it.

**What Sutton says.** In [The Bitter Lesson](http://www.incompleteideas.net/IncIdeas/BitterLesson.html) (March 2019), Rich Sutton argues that over 70 years of AI research, general methods that use more computation have beaten methods built on human knowledge of a domain. His examples are chess, Go, speech recognition and vision. He says human-knowledge approaches help in the short term but plateau later. He names search and learning as the two methods that keep scaling. He also says we should build in only "meta-methods" that discover structure, not our own ideas about how minds work.

**How the article uses it.** There are two uses.

- The article restates it as "the harder and bigger, the better" [spya-sfkxh8]. That is a loose compression. Sutton's claim is about general methods beating hand-built knowledge as computation gets cheaper. The article's phrase is about neural nets improving with size, data and problem difficulty. The two are related, but they are not the same claim.
- The article treats the Bitter Lesson and the scaling hypothesis as a pair that deserves serious research investment [spya-eexw9k]. It also says critics would rather dismiss scaling than "swallow the bitter lesson" [spya-jgq9gz]. Sutton does say researchers resist the lesson because it is "success over a favored, human-centric approach", so the article's account of resistance is close to his.

**Is it fair?** My inference is that the use is mostly fair but stretches the source. Sutton's essay concerns search and learning. It says nothing specific about GPT-style next-word prediction, and it does not claim that simply making a model bigger will produce meta-learning or AGI. The article's "strong scaling hypothesis" [spya-m3gtj6] goes beyond what Sutton says. Sutton also warns against building in simple ideas about how minds work. The article's own account of why scale works relies on mechanisms like sub-model ensembles and Occam's razor [spya-grkhs8], which Sutton doesn't discuss. So the Bitter Lesson is best read as supporting the article's direction, not its specific claims.

---

## Pair 13

**Article**: `arxiv-1706-03762v7-spya-wv4w9s` · **Work**: Neural machine translation by jointly learning to align and translate

Where the article cites it (quoted, not instructions):

"""
Recurrent neural networks, long short-term memory [13] and gated recurrent [7] neural networks in particular, have been firmly established as state of the art approaches in sequence modeling and transduction problems such as language modeling and machine translation [35, 2, 5].

The two most commonly used attention functions are additive attention [2], and dot-product (multiplicative) attention.
"""

### X

The Bahdanau, Cho and Bengio paper (2014) proposed letting a translation model look back over the source sentence and pick out the parts relevant to each word it is about to produce. [Its abstract](https://arxiv.org/abs/1409.0473) says the problem it targets is that earlier encoder-decoder models squeezed a whole sentence into one fixed-length vector. It conjectures that this vector is a bottleneck. Its fix is to let the model "soft-search" the source sentence for relevant parts as it translates. It reports French translation quality comparable to the best phrase-based system of the time.

The Transformer paper uses it in four places, and I think each use is fair:

- **Encoder-decoder models.** It is listed among the encoder-decoder models, alongside the 2014 work on encoder-decoder machine translation and the 2014 sequence-to-sequence paper [spya-a9gx0t]. It is also listed among the works that made recurrent networks the standard for translation [spya-dew452].
- **Attention as a building block.** It is cited for attention letting a model relate positions "without regard to their distance" [spya-mjbtbe].
- **Additive attention.** It is credited as the source of "additive attention", the rival to the dot-product attention the Transformer uses [spya-huyx5u].
- **Encoder-decoder attention.** The Transformer's encoder-decoder attention layers are said to mimic those in this line of work [spya-wweup3].

The paper isn't described as doing anything beyond what the abstract claims. The Transformer paper also doesn't hide what it takes from this work. It says outright that attention was "in conjunction with a recurrent network" in nearly all prior cases [spya-mjbtbe], and its stated novelty is dropping the recurrence [spya-q59ey3].

My inference is that the Transformer paper compresses the debt. Its Bahdanau-style attention layer survives almost intact as the encoder-decoder attention [spya-wweup3]. What it adds is self-attention and the removal of recurrence. The article doesn't say so, but my own background knowledge is that the 2014 paper's scoring step is a small feed-forward network. That matches the description of additive attention [spya-huyx5u]. I haven't checked this against the paper's text.

### Y

The article uses it fairly, as far as I could check. I only checked against your saved copy of the paper, and I did not search the web.

**What it says.** In your saved copy of "Neural Machine Translation by Jointly Learning to Align and Translate", the starting problem is that standard encoder–decoder translators squeeze a whole source sentence into one fixed-length vector. The authors conjecture that this is a bottleneck. Their fix lets the decoder "(soft-)search" the source sentence for the parts relevant to each target word. The paper says this helps with long sentences, because the information can be spread across a sequence of vectors that the decoder retrieves selectively.

**How the Transformer paper uses it.** It cites the work in four places, and each is a modest claim:
- It lists it among the encoder-decoder models [spya-a9gx0t] and among the recurrent state-of-the-art approaches [spya-dew452].
- It names it as the source of "additive attention" [spya-huyx5u].
- It says the Transformer's encoder-decoder attention "mimics" the attention in such models [spya-wweup3].
- It credits attention with letting models relate positions regardless of distance [spya-mjbtbe].

All of these fit what Bahdanau et al. describe. The paper does not claim they invented the concept, and your saved copy shows attention built on top of recurrent networks, which matches the Transformer paper's remark that attention is usually paired with a recurrent network [spya-mjbtbe].

**What I couldn't confirm.** The Transformer paper describes additive attention as scoring compatibility with a one-hidden-layer feed-forward network [spya-huyx5u]. The passages I retrieved from your saved copy don't show that detail. The article doesn't say so, but I recall that this is how the Bahdanau model's scoring works. That is unverified here. To check it, read the section of that paper where the alignment model is defined.

**What the Transformer paper leaves out.** It doesn't mention the fixed-length-bottleneck argument, which was Bahdanau's reason for attention. It uses the paper for the mechanism rather than the motivation. My inference is that this is a choice of emphasis rather than a distortion, since the Transformer's own motivation is speed and parallelism [spya-ev2yj8].

Your library also has "Geometric Deep Learning Grids, Groups, Graphs, Geodesics, and Gauges". It describes Bahdanau's model as pioneering content-based attention and as coming before the Transformer.

---

## Pair 14

**Article**: `fd-src-nagel-bat-spya-f5aw85` · **Work**: Philosophy and Scientific Realism

(The article does not cite this work in its body; it appears only in the references or a note.)

### X

The article cites Smart's book only as one of several "examples" of the recent reductionist analyses of the mind. The footnote lists it first, alongside Lewis, Putnam, Armstrong and Dennett [spya-bw3tug]. It is attached to the opening claim that these analyses aim to show some variety of materialism, psychophysical identification or reduction is possible, while ignoring what makes the mind-body problem unique [spya-c4shay]. Nagel's complaint about the whole group is that they leave out the subjective character of experience, and "it is useless" to defend materialism on any analysis that doesn't deal with it [spya-aczb7j].

I haven't read the book or searched for it this turn, so I can't check whether it supports that use. The article doesn't say what in Smart's book it has in mind, and it names no page. The following is background, not from the article, and I haven't verified it. Smart is usually associated with the "identity theory", the view that sensations just are brain processes. If that's right, he is a fair example of the reductionist view Nagel attacks. Smart's compared reductions are the kind of thing Nagel lists in his first paragraph, such as lightning and electrical discharge [spya-c4shay].

It also helps to know how Nagel answers this kind of view. He thinks the analogies from science don't carry over, because those reductions move away from a particular point of view, and experience is bound up with one [spya-psx6u6 spya-fjeqke]. My inference is that Smart-style identity claims are the "is" he later says is less clear than it looks [spya-br2yvm]. To get a firmer account of Smart's own argument, read the book or a reliable summary of it.

### Y

The article never says what Smart argues. It only lists his book among "examples" of the "recent wave of reductionist euphoria" [spya-c4shay]. The full reference sits in the first footnote [spya-bw3tug].

The article doesn't say so, but from my background knowledge (I haven't checked this against a source): Smart was a leading defender of the "identity theory". This is the view that sensations just are brain processes. His best-known version of it is the 1959 paper "Sensations and Brain Processes", and I believe the 1963 book includes his treatment of the topic. His model for the identity was scientific discoveries like lightning being an electrical discharge. He also held that reports of inner experience can be given in "topic-neutral" terms, which avoids saying what the experience is like. Treat this summary as unverified.

My inference is that the use is fair as far as it goes, but it is brief and broad. Nagel doesn't quote Smart. He groups him with Lewis, Putnam, Armstrong and Dennett as sharing a type of reduction. He says their problems "are those common to this type of reduction" [spya-c4shay]. He also says that analogies such as lightning and water-H₂O "will not shed light" on mind and brain [spya-pp9ysu].

Smart's lightning-style analogy is the one Nagel answers most directly. He argues that lightning can be understood from many points of view, but experience seems tied to a single one [spya-d7dvns spya-k43dc2]. He also says that a causal or functional analysis leaves out the subjective character [spya-aczb7j]. The charge is about what is left out of the analysis, not about any particular passage in Smart.

To judge fairness, you would need to read Smart's own reply. As I remember it, he wrote about this worry in his own work, but I haven't verified that.

---

## Pair 15

**Article**: `arxiv-1706-03762v7-spya-wv4w9s` · **Work**: Convolutional sequence to sequence learning

Where the article cites it (quoted, not instructions):

"""
The goal of reducing sequential computation also forms the foundation of the Extended Neural GPU [16], ByteNet [18] and ConvS2S [9], all of which use convolutional neural networks as basic building block, computing hidden representations in parallel for all input and output positions.

There are many choices of positional encodings, learned and fixed [9].
"""

### X

**What it says.** The cited paper is an architecture built entirely from convolutional networks, with no recurrence. According to [its arXiv abstract](https://arxiv.org/abs/1705.03122), all positions can be computed in parallel during training. It uses gated linear units, and each decoder layer has its own attention module. It also reports beating the deep LSTM system of Wu et al. (2016) on WMT'14 English-German and English-French translation, at roughly ten times the speed.

**How the article uses it.** There are three uses, and I could only check them against the abstract, not the full paper:

- **Path length.** The article groups ConvS2S with ByteNet and the Extended Neural GPU as models that also aim to cut sequential computation. It says that relating two distant positions takes a number of operations that grows linearly with their distance for ConvS2S [spya-dyxt29]. The abstract does not mention this, so I can't confirm the specific claim. The article's own Table 1 gives the general convolutional figure as logarithmic in dilated cases [spya-fnrjku], and the contrast with ConvS2S's "linear" is the article's characterisation, not something I verified.
- **Positional embeddings.** The article cites it for learned positional embeddings as an alternative to its sinusoids [spya-n0acqb]. It reports that the two gave nearly identical results in its own test [spya-a9hsvs spya-gbqhxf]. That is the Transformer authors' experiment, not a claim about ConvS2S itself.
- **Benchmark.** ConvS2S and its ensemble appear as baselines in Table 2 [spya-p9uqvv]. The abstract says ConvS2S beat Wu et al.'s system and ran faster. That fits the article placing it among the stronger earlier results.

**Fairness.** My inference is that the use looks fair. The comparison is on the same benchmarks, and the article says the Transformer beats it by more than 2 BLEU on English-German, counting ensembles [spya-qsc4jq]. Two caveats follow from the article's text. The English-French claim is only "single models" [spya-x6ys73]. The abstract also says 41.8 [spya-r4309p], while the results section says 41.0 [spya-x6ys73], so that inconsistency sits inside the article. Table 2 lists ConvS2S's ensemble at 41.29, which is close to 41.8 [spya-p9uqvv]. I haven't checked the table's numbers against the ConvS2S paper itself. If the path-length claim matters to you, that is the part worth checking in the full text.

### Y

ConvS2S is a translation model built entirely from convolutional networks. [Its arXiv abstract](https://arxiv.org/abs/1705.03122) says all positions can be computed in parallel during training, and that each decoder layer has its own attention module. It also says the model beat the deep LSTM system of Wu et al. (2016) on WMT'14 English-German and English-French, at about ten times the speed. I read only the abstract, not the full paper.

The article uses it in three places:
- **Shared goal.** It groups ConvS2S with ByteNet and the Extended Neural GPU as models that also try to cut sequential computation by using convolutions [spya-dyxt29].
- **Distance cost.** It says the work needed to link two distant positions grows linearly with distance in ConvS2S, against a constant amount in the Transformer [spya-dyxt29]. I did not check this against the full paper.
- **Positional embeddings.** It credits ConvS2S for the "learned" kind of positional embedding, which it tests in Table 3 row (E) [spya-n0acqb spya-a9hsvs].

The article lists ConvS2S as a baseline in Table 2, with 25.16 BLEU on English-German and 40.46 on English-French. Its ensemble scores are 26.36 and 41.29 [spya-p9uqvv].

My inference is that the use looks fair. The article describes ConvS2S's design accurately and credits it for the embedding idea. The comparison sets single Transformers against ConvS2S ensembles on English-German. For English-French the article claims only a single-model lead [spya-x6ys73].

One thing to check yourself is that English-French BLEU appears as 41.8 in the abstract and Table 2 but as 41.0 in the results text [spya-r4309p spya-x6ys73]. At 41.0 the big model would fall below ConvS2S's ensemble score of 41.29. At 41.8 it would beat it.

---

## Pair 16

**Article**: `arxiv-1706-03762v7-spya-wv4w9s` · **Work**: Neural machine translation by jointly learning to align and translate

Where the article cites it (quoted, not instructions):

"""
Recurrent neural networks, long short-term memory [13] and gated recurrent [7] neural networks in particular, have been firmly established as state of the art approaches in sequence modeling and transduction problems such as language modeling and machine translation [35, 2, 5].

The two most commonly used attention functions are additive attention [2], and dot-product (multiplicative) attention.
"""

### X

The article cites Bahdanau et al. twice, and both uses are fair, as far as I can check from the abstract.

**First use.** In the introduction it is one of three sources [35, 2, 5] for the claim that recurrent networks are the established state of the art in sequence modeling and machine translation [spya-dew452]. The abstract of [the Bahdanau paper](https://arxiv.org/abs/1409.0473) fits this. It describes the encoder-decoder family that the recurrent models of the time were built on. It is also an example of such a model, not a standalone proof that recurrence was dominant. The same sentence cites other works for that claim.

**Second use.** In section 3.2.1 it is the source for "additive attention", which computes how well a query matches a key with a small feed-forward network [spya-huyx5u]. The article then says additive attention beats unscaled dot-product attention at large key sizes, and cites [3] for that, not Bahdanau [spya-g2md22]. The abstract describes a model that "soft-searches" for the parts of a source sentence relevant to each target word. That is the idea of attention, and it matches this citation. The abstract does not describe the scoring formula, so I haven't checked that the paper's formula is the one the Transformer authors mean. The article doesn't say so, but I recall that this paper uses a small feed-forward scoring network. That is unverified here.

**Limits.** I read only the abstract page, not the full paper.

**Background that helps.** The abstract says the encoder-decoder design squeezes a sentence into one fixed-length vector, which the authors call a bottleneck. Their fix lets the decoder look back at the source words as it writes each output word. My inference is that this is the attention mechanism the Transformer builds on. The Transformer paper says attention had mostly been used alongside a recurrent network [spya-mjbtbe]. Its contribution is to drop the recurrence and keep only attention [spya-q59ey3]. Bahdanau et al. is also the origin of the decoder-looks-at-the-encoder pattern that the Transformer keeps in its "encoder-decoder attention" layers [spya-wweup3].

### Y

The article uses it fairly, as far as I could check. I only checked against your saved copy of the paper, and I did not search the web.

**What it says.** In your saved copy of "Neural Machine Translation by Jointly Learning to Align and Translate", the starting problem is that standard encoder–decoder translators squeeze a whole source sentence into one fixed-length vector. The authors conjecture that this is a bottleneck. Their fix lets the decoder "(soft-)search" the source sentence for the parts relevant to each target word. The paper says this helps with long sentences, because the information can be spread across a sequence of vectors that the decoder retrieves selectively.

**How the Transformer paper uses it.** It cites the work in four places, and each is a modest claim:
- It lists it among the encoder-decoder models [spya-a9gx0t] and among the recurrent state-of-the-art approaches [spya-dew452].
- It names it as the source of "additive attention" [spya-huyx5u].
- It says the Transformer's encoder-decoder attention "mimics" the attention in such models [spya-wweup3].
- It credits attention with letting models relate positions regardless of distance [spya-mjbtbe].

All of these fit what Bahdanau et al. describe. The paper does not claim they invented the concept, and your saved copy shows attention built on top of recurrent networks, which matches the Transformer paper's remark that attention is usually paired with a recurrent network [spya-mjbtbe].

**What I couldn't confirm.** The Transformer paper describes additive attention as scoring compatibility with a one-hidden-layer feed-forward network [spya-huyx5u]. The passages I retrieved from your saved copy don't show that detail. The article doesn't say so, but I recall that this is how the Bahdanau model's scoring works. That is unverified here. To check it, read the section of that paper where the alignment model is defined.

**What the Transformer paper leaves out.** It doesn't mention the fixed-length-bottleneck argument, which was Bahdanau's reason for attention. It uses the paper for the mechanism rather than the motivation. My inference is that this is a choice of emphasis rather than a distortion, since the Transformer's own motivation is speed and parallelism [spya-ev2yj8].

Your library also has "Geometric Deep Learning Grids, Groups, Graphs, Geodesics, and Gauges". It describes Bahdanau's model as pioneering content-based attention and as coming before the Transformer.

---

## Pair 17

**Article**: `fd-src-nagel-bat-spya-f5aw85` · **Work**: Naming and Necessity

Where the article cites it (quoted, not instructions):

"""
A theory that explained how the mind-brain relation was necessary would still leave us with Kripke's problem of explaining why it nevertheless appears contingent.

Saul Kripke (op. cit.) argues that causal behaviorist and related analyses of the mental fail because they construe, e.g., “pain” as a merely contingent name of pains.
"""

### X

The article uses Kripke fairly: it claims only a close relation to his view, and it differs from him in two places. I'm sketching Kripke from memory and from the web, and I haven't checked Nagel's page reference.

**What Kripke says.** In the last part of *Naming and Necessity*, Kripke argues against identity materialism, the view that every mental fact is identical with some physical fact. His claim is that an identity like "pain is C-fibers firing" could only be defended as necessary, but pain without C-fibers firing seems possible, so it can't be. Teaching notes on his argument put it this way: we should expect the opposite of a theoretical identity to seem possible without really being possible. The materialist's reply is that the identity only looks contingent. The article's note, [spya-h0hyn9], gives Nagel's own summary.

**How the article uses him.** Nagel cites Kripke as an ally in a footnote and says his own view is "closely related" to Kripke's. He says the subjective character of an experience is what causal-behaviorist analyses leave out [spya-h0hyn9]. He also finds the idea that a brain state necessarily has a given subjective character "incomprehensible without further explanation" [spya-h0hyn9]. That matches Kripke's target and spirit.

**Where Nagel departs from Kripke.**
- Kripke's argument is meant to refute the identity theory. The article says it would be a mistake to conclude physicalism is false. Nagel says only that we can't understand how it could be true [spya-zv889j].
- Nagel tries to remove the appearance of contingency, which he calls "Kripke's problem". His explanation is that sympathetic imagination (imagining a mental state from the inside) and perceptual imagination (imagining a physical state as an observer) work independently, so the relation looks contingent even if it is necessary [spya-qx90p6]. The article doesn't say so, but my understanding is that Kripke held this kind of explanation works for water and heat and fails for pain. If that's right, Nagel is taking a step Kripke would not.

My inference is that the citation is fair, but it shouldn't be read as saying Kripke and Nagel agree on the conclusion. They share the diagnosis and disagree on what follows from it.

For a clear account of Kripke's argument, see [Soames's paper on Kripke and mind-body identity](https://dornsife.usc.edu/scottsoames/wp-content/uploads/sites/191/2023/11/Kripke_on_Mind-Body_Identity_12-2015.pdf).

### Y

Kripke's "Naming and Necessity" is mostly about how names refer, and Nagel uses only its last pages, against the mind-brain identity theory. That is a fair use. Nagel claims only a close relation, and the main difference between them is one he states himself.

**What Kripke says.** Kripke argues against identity materialism, the view that every mental fact is identical with some physical fact. Such an identity, for example "pain is C-fibers firing", could only be defended as a necessary truth discovered by observation. He argues it cannot be necessary, given that pain seems possible without C-fibers firing. The step in between is that, in his theory, if "pain" and a neural-state term both name their referents rigidly (the same thing in every possible world), the identity must be necessary if true at all. He thinks the identity theorist's best reply is to deny that the identity can be coherently imagined as contingent, which means explaining away the appearance of contingency.

**How Nagel uses it.** The main use is the footnote on necessity [spya-h0hyn9]. Nagel says Kripke's objection to causal behaviorist analyses is that they treat "pain" as only a contingent name of pains. He quotes Kripke's phrase "immediate phenomenological quality" as the essential property those analyses leave out. He calls his own view "closely related" and adds that a brain state necessarily having a subjective character is incomprehensible "without further explanation". That matches the summary above.

**Where Nagel goes beyond Kripke.** The body of the article takes up "Kripke's problem" directly [spya-qx90p6]. Nagel says a theory making the mind-brain relation necessary would still have to explain why it looks contingent. He thinks this is "surmountable" because two kinds of imagining, sympathetic and perceptual, work independently of each other. The article doesn't say so, but my reading is that this is the kind of explaining-away Kripke thought was needed, and Kripke argued it couldn't be done for pain. Nagel also stops short of Kripke's conclusion, saying physicalism need not be false, only that we can't yet understand how it could be true [spya-zv889j]. So he borrows Kripke's diagnosis and leaves out the refutation.

It's also worth reading Kripke's own pages, since Nagel's note cites pp. 334-342 of the 1972 printing [spya-bw3tug]. An [excerpt of Kripke's third lecture](https://web.ics.purdue.edu/~drkelly/KripkeNNLecture3Excerpt1972.pdf) is online.

---

## Pair 18

**Article**: `arxiv-1706-03762v7-spya-wv4w9s` · **Work**: A decomposable attention model

Where the article cites it (quoted, not instructions):

"""
In all but a few cases [27], however, such attention mechanisms are used in conjunction with a recurrent network.
"""

### X

The article cites it twice, and both uses look fair on the paper's abstract. I only read the abstract and catalogue pages, not the full paper.

**What the paper says.** [Parikh et al.](https://arxiv.org/abs/1606.01933) propose a simple neural architecture for natural language inference, which means judging whether one sentence follows from another. It uses attention to break the problem into subproblems that can be solved separately, so it is trivially parallelizable. It reached state-of-the-art results on the SNLI dataset with almost an order of magnitude fewer parameters than earlier work, without using any word-order information. Adding intra-sentence attention, which takes a minimum amount of order into account, improved results further.

**How the article uses it.**
- In the introduction, it is the "few cases" where attention is not paired with a recurrent network [spya-mjbtbe]. That fits, since the model is built from attention and feed-forward pieces.
- In the background section, it is one of the works showing self-attention succeeding in tasks such as textual entailment [spya-vvwv4r]. Textual entailment is the same task as natural language inference, and the paper's intra-sentence attention is a form of self-attention.

**Is the framing fair?** The article's novelty claim is carefully worded. It says the Transformer is the first *transduction* model relying entirely on self-attention [spya-vr7tsj]. My inference is that this wording is what keeps the Parikh paper from being a counterexample: it classifies sentence pairs and does not generate an output sequence. The article does not spell this out, though.

The paper's authorship also matters. The article's own footnote credits Jakob Uszkoreit, a co-author of the Parikh paper, with proposing the replacement of RNNs by self-attention [spya-jf2h4q]. So this is partly the authors building on their own earlier work. That is a natural line of descent, not a problem.

The article never says how much the Transformer owes to this model. It cites the paper only in passing, and you would have to read the Parikh paper to judge that.

### Y

The paper proposes a simple neural model for natural language inference, which is judging whether one sentence follows from another. It uses attention to split the problem into subproblems that can be solved separately, which makes it trivially parallelizable. On the Stanford SNLI dataset it reported state-of-the-art results with almost an order of magnitude fewer parameters than earlier work, and without using any word-order information. Adding intra-sentence attention, which takes a minimum amount of order into account, improved results further. The details are on the [arXiv abstract page](https://arxiv.org/abs/1606.01933).

The Transformer paper cites it twice, and both uses look fair to me.

- **"All but a few cases."** The introduction says attention is nearly always paired with a recurrent network "in all but a few cases [27]" [spya-mjbtbe]. That matches the Parikh paper, which has no recurrence.
- **Self-attention "used successfully."** The background section lists textual entailment among the tasks where self-attention has worked [spya-vvwv4r]. Textual entailment is the same task as natural language inference, and the Parikh paper does include intra-sentence attention.

The article doesn't say so, but the Parikh model was a classifier over sentence pairs, not a model that generates an output sequence. That is how the article can still call the Transformer "the first transduction model relying entirely on self-attention" [spya-vr7tsj] without contradicting the earlier work. Whether that line is honest or just narrow is a judgement call. My inference is that it is accurate but carefully worded: the novelty lies in the encoder-decoder setting, plus the stacked layers and multi-head attention.

One more point. Jakob Uszkoreit co-wrote the Parikh paper, and the Transformer authors' note credits him with proposing to replace RNNs with self-attention [spya-jf2h4q]. My inference is that the Transformer built directly on that earlier line of work. The article does not describe that lineage beyond the citations.

