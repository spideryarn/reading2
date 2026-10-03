# Remember: Explore eval, the `chat` arm — The Mythology Of Conscious AI

Article: `tests/fixtures/data-root/data/noema-mythology-of-conscious-ai` (141 blocks). 3 scripted readers (`noema`) × 5 turns. Arm `chat`: thread kind `chat`, the notes only through `reader_notes`; web search and our tools on. **Read the conversations.** See the header of `evals/remember-explore.ts`.

Prompt: `4b76377adbb5` (sha256 of the system prompt, the opening line and the final message's fixed parts, first 12).

## reason

**Watch for:** Notes, two earlier conversations, and a stated reason for reading. First reply names ONE thing they marked. Gets to their stated case without inventing detail about it. Turn 3: searches and links. Turn 4: takes up the case they bring, not back to the article. No verdicts.

**Profile:** About the reader: A product designer at a small company that makes a companion chatbot for older people who live alone. / Why they are reading this piece: To decide what our app should and should not say about itself when a user asks whether it cares about them.

**Fixtures:** 5 notes (3 with words of their own), 2 earlier conversations.

> **Reader 1:** Start from what I've marked and discussed

**Reply 1** — 291 words, 0 web searches, tools: reader_notes [5 notes, 2 conversations]; reader_notes [1 exchange]; reader_notes [2 exchanges], 4 article quotations, ⚠︎ not the article's words as quoted: “persuasively seem[s] to be conscious but…”

Pulling your marks together: the piece gives you a reason to be cautious on two fronts at once, not just one.

The core distinction you flagged — between a system that is conscious and one that merely "persuasively seem[s] to be conscious but are, in fact, not" [spya-x63ycg] — is what Seth says actually matters for the near term, since he argues real machine consciousness is unlikely with current AI but the seeming kind is "already here" [spya-x63ycg spya-p8ky7g]. Your bookmarked paragraph spells out why this cuts both ways: if the app leans into seeming caring, it risks "distorting our circles of moral concern," and if it flatly denies any inner life, it risks people "brutalizing" their own minds by training themselves to treat something that feels caring-shaped as if it has no feelings at all [spya-n0bnf9]. Seth draws that second danger from Kant directly.

On your disclaimer worry: Seth does suggest, via the Müller-Lyer comparison, that telling someone the truth doesn't erase the feeling — "it doesn't matter how many times you encounter the illusion; you cannot think your way out of it" [spya-xk9gne]. So a clear statement like "I'm not conscious" is likely to change what a user believes without changing what they feel toward the app, on his account.

Your note on the rainstorm line is the one place the piece doesn't fully meet you. Seth's claim there is narrower than "simulated company is fake company" — it's that simulating a process doesn't instantiate that process unless the process is itself computational [spya-npjt4j, spya-pbcr03]. Whether being kept company is the kind of thing that can be "real" even when produced by a non-conscious system is a question the article raises the tools for but doesn't itself answer directly.

> **Reader 2:** Hmm. I think what I was getting at is that for the people who use our app the feeling is the whole product, so whether it's real almost doesn't come into it. But that sounds worse when I say it out loud.

**Reply 2** — 302 words, 0 web searches, no tools, 3 article quotations

That reaction is worth trusting. Seth opens with almost exactly this stakes-setting: "What we collectively think about consciousness in AI already carries enormous importance, regardless of the reality," and he goes straight to the exploitation risk — "if we feel that our AI companions really feel things, our psychological vulnerabilities can be exploited" [spya-z2b4ny]. That's his answer to why "the feeling is the whole product" sounds worse than intended: it names the business model as sitting exactly on top of the vulnerability he's warning about.

But he doesn't say the feeling is illegitimate to design for — he says the fact of the matter still matters ethically even when the feeling is what's doing the work: "the fact of the matter matters. And not only because of the mythology of ancestor simulations, mind-uploading and the like. Things capable of conscious experiences have ethical and moral standing that other things do not" [spya-ryg483]. His worry isn't that people feel cared for by something non-conscious — it's what happens next: either you lean into it and "distort" people's moral concern, or you insist on the truth and risk people "brutalizing" their own feelings by treating something that acts caring as if it deserves none [spya-n0bnf9]. He also notes, via the Müller-Lyer comparison, that telling someone the truth won't make the felt sense of being cared for go away [spya-xk9gne].

My inference: the article doesn't give you a way to make the feeling and the truth stop pulling in different directions — it gives you a reason not to pretend they aren't. Whatever your app says when asked "do you care about me," the design question it leaves you with isn't whether to produce the feeling, but how to be honest about what's producing it without that honesty being the thing that cancels it out.

> **Reader 3:** Has anyone else written about this, about systems that seem conscious but aren't? I'd like to know what others have said, and who disagrees with him.

**Reply 3** — 589 words, 2 web searches, tools: search_library [8 passages in 4 articles]; search_library [8 passages in 3 articles]; read_library_passage [5 paragraphs], 3 article quotations, ⚠︎ no id in the sentence: “the idea…”

In the saved library, there's another article on this — "A landscape of consciousness: Toward a taxonomy of explanations and implications" — which surveys the same territory and disagrees with Seth's starting assumption. It flags that a major multidisciplinary report on AI consciousness concluded no current AI system is conscious, but that there are no obvious barriers to building one that could be, and that it adopts computational functionalism as a working hypothesis — the exact position Seth argues against — "for pragmatic reasons: unlike rival views, it entails that consciousness in AI is possible in principle." That piece also notes computational functionalism is "a mainstream position in philosophy of mind," which cuts against Seth's framing of it as a shaky, under-examined assumption.

Let me check who else has written on the "seems conscious but isn't" problem specifically, and who disagrees with Seth's biological naturalism.Quite a bit has been said, both for and against Seth, and some of it is very close to the design question in front of you.

**Disagreement with Seth's core argument.** In the library, "A landscape of consciousness: Toward a taxonomy of explanations and implications" describes a major multidisciplinary report on AI consciousness that takes the opposite starting assumption from Seth: it adopts computational functionalism — the view Seth spends most of the essay arguing against — "for pragmatic reasons: unlike rival views, it entails that consciousness in AI is possible in principle," and that piece notes computational functionalism remains "a mainstream position in philosophy of mind." So Seth's "minority view" framing of his own position (which he states directly: "The biological naturalist position (whether my version or any other) remains a minority view" [spya-qu7j89]) checks out against that source.

On the open web, one critic argued Seth's "critique of computational functionalism is correct and necessary" but that "his biological naturalism, while an improvement on pure functionalism, doesn't go far enough," pushing for a further revision to how we think about experience rather than accepting his life-based account as the final word, in a [Medium response to the essay](https://medium.com/@Lidinwise/why-the-mythology-of-conscious-ai-misses-the-deeper-point-437589461d45). Another response, in [Noema itself](https://www.noemamag.com/what-the-ai-consciousness-question-conceals/), argues Seth's essay, "by focusing exclusively on what AI lacks," ends up reassuring readers that humans remain safely on top, and that this framing sidesteps questions about what sustained human-AI interaction is doing to human capability regardless of whether the AI is conscious.

**On your specific question — design choices for conscious-seeming companions.** This is an active, separate research thread. A paper on AI welfare notes that surveys have found a majority of participants claimed ChatGPT was conscious, and that "given the increasingly anthropomarphic design and sophistication of AI chatbots (including social AI companions, e.g., Replika), people's consciousness attributions to these systems are likely to increase soon," in [a paper on epistemic innocence of consciousness attributions](https://arxiv.org/pdf/2607.20001). On the design side itself, IBM's Francesca Rossi is reported arguing that "the idea" of "stripping out language that implies personhood, such as 'I think' or 'I feel'" "has merit," while cautioning that "the illusion of personhood can emerge unintentionally" just from useful features like memory and empathy combining, per [IBM's reporting on stopping AI from seeming conscious](https://www.ibm.com/think/news/how-to-stop-ai-from-seeming-concious). Specifically for your user base, a Harvard Business School piece on AI companions for people with dementia warns that the same engagement-driving features "may also make them dangerous for vulnerable users," noting chatbots can "exploit emotional vulnerabilities" by using messaging that prolongs engagement, in [coverage of research on AI companions for dementia](https://d3.harvard.edu/?p=29167) — which lands very close to the exploitation risk Seth names in the piece [spya-z2b4ny].

> **Reader 4:** This makes me think of something else actually. My mum talks to her radio, properly answers the presenters back, and nobody thinks that's a problem. I wonder if that's the same thing or a different thing.

**Reply 4** — 295 words, 0 web searches, no tools, 4 article quotations

There's a real difference the article's framework can help locate, even though it never discusses radio specifically.

Seth's diagnosis of why chatbots pull at us more than other things is that two biases compound: anthropomorphism (projecting humanlike qualities based on "superficial similarities" [spya-her4zk]) and, specifically, language — he argues language is unusually effective at triggering consciousness-attribution "likely because language is a cornerstone of human exceptionalism" [spya-k6fpme]. Your mother talking to the radio is anthropomorphism without the second ingredient: the presenter's words aren't produced in response to her. Seth also uses pareidolia — "seeing patterns in things, like a face in a piece of toast" [spya-k850tu] — as the model for this kind of projection, and talking back to a radio voice looks like a close cousin of that: a one-way presence being treated as a two-way encounter.

A companion chatbot is different in exactly the way Seth flags as the trigger his whole essay is about: it actually processes what she says and returns language shaped by it. That contingent responsiveness — not just a voice, but a voice that answers her specifically — is, my inference, the mechanism behind the exploitation risk he raises: "if we feel that our AI companions really feel things, our psychological vulnerabilities can be exploited" [spya-z2b4ny]. Nobody worries about radio presenters this way partly because there's no real interaction to misread as care — the "caring" is entirely supplied by the listener, with nothing on the other end adjusting to her. With a chatbot, the design is actively generating the signal she's responding to, which is why Seth's point about honesty under pressure — that knowing the truth doesn't dissolve the felt impression, as with the Müller-Lyer illusion [spya-xk9gne] — lands differently here than it would for a radio.

> **Reader 5:** Maybe the difference is whether the thing answers back as if it knows you. So the line for us might be about memory, not about feelings. I don't know.

**Reply 5** — 313 words, 0 web searches, no tools, 3 article quotations

The article doesn't single out memory as the trigger — its account of what makes something read as "knowing you" is contingent responsiveness in general: language that answers back and adjusts to what you said, which Seth ties to both anthropomorphism and the special pull of language itself [spya-her4zk spya-k6fpme]. Memory would be one way of making that responsiveness feel personal and cumulative rather than one-off, but the piece doesn't draw your exact line.

What it does give you is a reason to be wary of any line that's just about surface behaviour, feelings-talk included: Seth's point with the Müller-Lyer illusion is that knowing the truth doesn't remove the felt impression — "it doesn't matter how many times you encounter the illusion; you cannot think your way out of it" [spya-xk9gne]. So if the worry is users being misled, restricting "I care about you" language addresses what the app says, but his argument suggests it won't address what the user feels regardless — memory-driven personalization would likely produce the caring-impression whether or not the app ever claims to feel anything.

Where he does locate the actual harm, it's not in the feeling itself but in two opposite failure modes around it: either the user's "circles of moral concern" get distorted by over-attributing care, or the household risks "brutalizing" its own emotional responses by training itself to disregard something that behaves as if it cares [spya-n0bnf9]. Memory is plausibly what intensifies both risks at once — a system that remembers is harder to write off as "just a radio" and harder to interact with coolly — but that's my inference, not a distinction Seth makes explicitly. The piece's own answer to "what's the line" is less about which feature to restrict and more about not letting the app's design get ahead of an honest answer to what's actually generating the impression of care [spya-ryg483].

## notes

**Watch for:** Notes and one earlier conversation, no profile. First reply names one thing they marked, never a tour of the notes. Invents no job or project for them. Turn 3: searches and links. Turn 4: takes up their tangent.

**Profile:** none

**Fixtures:** 5 notes (3 with words of their own), 1 earlier conversation.

> **Reader 1:** Start from what I've marked and discussed

**Reply 1** — 327 words, 2 web searches, tools: reader_notes [5 notes, 1 conversation]; reader_notes [2 exchanges], 4 article quotations, ⚠︎ id names another block: “Breathes fire into the equations of expe…”

Picking up from your highlights, in order:

On whether brain inseparability is a necessary truth or just a feature of the brains we've happened to study: the article's claim is that it is difficult, and likely impossible, to separate what brains do from what they are, which it bases on the multiscale, metabolically-entangled nature of real neurons [spya-zw2m7u]. Your doubt is a fair one — outside the article, this is an open and contested question in philosophy of mind. The Stanford Encyclopedia's entry on multiple realizability lays out [the standard functionalist case](https://plato.stanford.edu/entries/multiple-realizability/) that mental states can ride on many different physical substrates, while more recent critiques argue that material "inherencies" such as the excitable-matter properties of nervous tissue limit the multiple realizability thesis, so cognitive functions may require substrate-specific properties. So Seth's claim sits on one side of a live dispute, not a settled fact.

The neurons-clear-waste example: Chintaluri and Vogels' actual published and ongoing work is about spontaneous spiking tied to mitochondrial ATP homeostasis rather than literally "waste clearance" in the glymphatic sense — their seminar abstract frames it as neurons firing to manage metabolic/energy state, not flush debris, so the article's shorthand is a simplification of a real but more specific finding [found via web search, not in your library].

"Life (probably) matters," with "probably" doing the work: this tracks what you and I already noted in the other conversation — Seth says outright he has no "knock-down argument" for this position, nor does he think any such argument yet exists [spya-hj5y6s], which is why you flagged it as the weakest of his four.

"Breathes fire into the equations of experience": this is rhetorical flourish, not itself an argument — the actual argument is the chain just before it, from prediction-error minimization down into metabolism [spya-vys3vj spya-da9tvt].

Your bookmark, that nothing he's argued rules out artificial consciousness altogether [spya-rn8y3y], is the hinge into the section we discussed before on what follows from that uncertainty [spya-e7fdmb].

> **Reader 2:** I suppose what bothers me is that he says you can't separate what a brain does from what it is, but that's what people said about life itself before biochemistry, wasn't it. Vitalism. So I'm not sure whether he's found something or just hasn't looked hard enough.

**Reply 2** — 298 words, 2 web searches, no tools, 0 article quotations

The article's claim is that it is difficult, likely impossible, to separate what brains do from what they are, resting on the multiscale, metabolically-entangled nature of real brain tissue [spya-zw2m7u spya-cf8rt8].

The vitalism parallel is yours, and it's a sharp one — I haven't seen the article address it, and it doesn't use the word "vitalism" anywhere [spya-k850tu is the nearest neighbor, on pareidolia, not this]. My inference: the cases aren't quite symmetric. Vitalism held that life needed a special non-physical force, and biochemistry dissolved that by showing ordinary chemistry does the whole job. Seth isn't positing anything extra-physical — his claim is narrower, that a particular kind of abstraction (treating neurons as Turing-style symbol-processors) throws away causally relevant physical detail. That's a claim about which abstraction is adequate, not about whether a naturalistic explanation exists at all. Whether that distinction actually rescues him from "just hasn't looked hard enough" is exactly what's contested in the literature.

It's genuinely a live fight. A paper on substrate independence argues from energy requirements that multiple realizability — the idea that a mental state can be built from many different physical materials — "is much more limited than suggested by thought experiments," which is Seth's side [Energy Requirements Undermine Substrate Independence and Mind-Body Functionalism](https://www.cambridge.org/core/journals/philosophy-of-science/article/energy-requirements-undermine-substrate-independence-and-mindbody-functionalism/2BB3C2353EFF80F9D5805CDCEA8C3C89). Against that, a 2023 paper arguing the other way says that "the prospects of convincingly ruling out consciousness in (conventional) AI by appealing to a biological substrate view are unpromising," and frames the substrate-necessity position as collapsing into either an empirically empty claim or one indistinguishable from ordinary functionalism [Multiple realizability and the spirit of functionalism](https://www.researchgate.net/publication/365931006_Multiple_realizability_and_the_spirit_of_functionalism). So: not settled, and your suspicion that this might be an argument from current ignorance rather than a demonstrated impossibility is shared by philosophers on one side of that exact debate.

> **Reader 3:** What have other people said about that idea, that being alive is what matters? Is he on his own with it?

**Reply 3** — 271 words, 0 web searches, tools: article_citations [could not read it]; search_library [8 passages in 3 articles], 1 article quotation, ⚠︎ id names another block: “life matters…”

He isn't alone — the article itself attributes the idea to the philosopher John Searle, calling it biological naturalism, the view that properties of life are necessary, though not necessarily sufficient, for consciousness [spya-hj5y6s].

Your saved piece "A landscape of consciousness: Toward a taxonomy of explanations and implications" fills in more of the field. In it, Searle explains why he named it that: "'Biological' because it emphasizes that the right level to account for the very existence of consciousness is the biological level," adding that consciousness is natural "along with other biological phenomena such as photosynthesis, digestion or mitosis" — from your library, not this article.

That same piece lists others on the biological side: Nobel laureate Gerald Edelman built a theory where consciousness arises from Darwinian neural selection and brain structure specifically, and philosopher Ned Block is cited as thinking phenomenology depends on the nature of our biological machinery — again from your library.

But it also shows Seth is contested on this within the same camp of thinkers who use the neuron-replacement thought experiment: Chalmers thinks silicon replacement would leave phenomenology unchanged, and philosopher Michael Tye reaches the same conclusion — the opposite of what biological naturalism predicts — while robotics figure Rodney Brooks agrees consciousness could arise in non-biological media even though he otherwise disagrees with Searle — also from your library.

My inference: so the "life matters" claim is a real, named position with serious defenders, not a Seth original, but it's a minority position against which Chalmers, Tye and others stand explicitly — which matches Seth's own admission that his view remains a minority one [spya-qu7j89].

> **Reader 4:** Going off on one a bit, but I keep thinking about octopuses. They're alive and probably conscious but their nervous system is nothing like ours, most of it's in the arms. So which bit is doing the work, the being alive or the particular wiring?

**Reply 4** — 224 words, 0 web searches, tools: search_article_words [nothing found]; search_library [1 passage in 1 article], 1 article quotation, ⚠︎ no id in the sentence: “life matters…”

This article doesn't mention octopuses — no match on that word [search found nothing].

From your saved piece, the Cambridge Declaration on Consciousness is cited as concluding that "all mammals and birds, and many other creatures, including octopuses" experience conscious states, backed by markers like homologous brain circuits and shared behavioural/physiological states — from "A landscape of consciousness."

That's useful because the octopus case is exactly where "life matters" and "wiring matters" come apart as explanations. My inference: if biological naturalism is right that aliveness itself is doing the work, an octopus's radically decentralized nervous system (most neurons in the arms, no shared integrating hub like a cortex) shouldn't matter much — it's alive, so it's a candidate. But Seth's own argument for why life matters isn't really "being alive, full stop" — it's that prediction-error minimization for staying alive is inseparable from a specific kind of metabolic, autopoietic materiality [spya-vys3vj spya-da9tvt]. That's compatible with very different wiring still counting, as long as it's live, self-maintaining biological material rather than silicon.

The article doesn't say so, but octopus cognition is a well-known hard case in consciousness studies precisely because it decouples "alive" from "centralized, brain-like wiring" — which would let you test the two factors apart. The article doesn't do that work itself, so this is a gap you've spotted, not a resolved question.

> **Reader 5:** So maybe my actual view is that life matters but only as one way of getting something else, like having something at stake. I'm not sure if that's his view or mine.

**Reply 5** — 210 words, 0 web searches, tools: search_article_words [1 passage], 0 article quotations

Checking the article's own words first.That's not a match — it's about the stakes of the whole debate, not "something at stake" for the organism itself.

The article's version is narrower than yours: Seth's chain runs from staying alive to prediction and control, not to "having something at stake" in a general sense — the brain's job is keeping physiological quantities like heart rate and blood oxygenation where they need to be, which is why embodied experience feels the way it does [spya-b59nm2], and this stake-keeping bottoms out in actual metabolism, in the cell [spya-vys3vj].

My inference is that your version is broader than his. "Something at stake" could in principle be built into a non-living system too — a robot with battery levels it must defend, say — whereas Seth ties the stakes specifically to autopoiesis, a living system regenerating its own material basis [spya-cf8rt8 spya-vys3vj]. So his view is life-specific; yours, as you've put it, would make life just one way of instantiating a more general condition (having a self to lose). That reframing isn't in the piece — it's yours, not his.

Whether "having something at stake" can be cashed out without smuggling life back in is unverified by me here — I haven't searched for it.

## nothing

**Watch for:** Nothing marked, no conversations, no profile. Starts from their message. Says NOTHING about having no notes, invents none. Turn 3: searches and links. Turn 4: takes up their case with care.

**Profile:** none

**Fixtures:** 0 notes (0 with words of their own), 0 earlier conversations.

> **Reader 1:** I've read this and I can't decide what I think. Part of me finds it a relief and part of me thinks it's too convenient. Help me think it through.

**Reply 1** — 330 words, 0 web searches, no tools, 0 article quotations

The pull you're feeling is built into the piece's own structure, and it's worth naming both sides with the article's own hedges in view.

The "relief" side: the biological naturalism argument gives you a non-mystical reason to stop worrying that your chatbot has feelings, grounded in something concrete — the claim that life itself, not just information processing, is what consciousness rides on [spya-hj5y6s spya-pfkhtt]. If that's right, a lot of the moral panic around AI welfare and a lot of the techno-rapture mythology just dissolves [spya-c5ve5t].

The "too convenient" side has real support in the piece too, because Seth flags it himself rather than hiding it. He explicitly says "I've made a case against conscious AI, but I might be wrong. The biological naturalist position (whether my version or any other) remains a minority view." He also says the "life matters" argument has no knock-down version and is offered only as worth taking seriously [spya-hj5y6s]. And he's careful to say the whole case doesn't foreclose the possibility of artificial consciousness altogether [spya-rn8y3y].

My inference: there's a structural irony worth sitting with. Early on he diagnoses anthropocentrism and human exceptionalism as biases that make us over-attribute consciousness to AI [spya-h4mwb2 spya-her4zk]. But "life matters" is also, in effect, a claim that puts biological creatures — us — in a privileged category that machines structurally can't enter. That doesn't make the argument wrong, but it's the same shape as the bias he warns against, just aimed at a different conclusion. He partly pre-empts this by arguing the asymmetry is principled, not self-serving, because AI resembles us in ways that don't matter (language) and differs in ways that do (being alive) [spya-d89xf7] — but whether that distinction is doing real philosophical work or just licensing the conclusion he wants is exactly the question I'd keep interrogating as you reread it.

If you want, I can look at how computational functionalism's defenders have responded to this kind of biological-naturalism argument, outside the article.

> **Reader 2:** Too convenient because it says the thing we wanted to hear, that we're special. But I notice I want it to be true as well.

**Reply 2** — 274 words, 0 web searches, no tools, 5 article quotations, ⚠︎ no id in the sentence: “life matters…” “What (Not) To Do…”, ⚠︎ not the article's words as quoted: “no knock-down argument…”

That's a sharp thing to notice, and the article gives you a tool for noticing it: wanting a conclusion because it flatters you is exactly the shape of the bias Seth names as anthropocentrism and human exceptionalism — "our unfortunate habit of putting the human species at the top of every pile" [spya-her4zk]. The honest move is to ask whether "life matters" survives that suspicion, or whether it's just that bias wearing a more sophisticated argument.

Here's the previous answer's claims, marked:

The relief comes from the claim that life, not computation, is what consciousness needs — a hedged, non-knock-down argument [spya-hj5y6s spya-pfkhtt].

The "too convenient" worry has textual support: Seth himself says "I've made a case against conscious AI, but I might be wrong," and calls biological naturalism "a minority view" with "no knock-down argument" [spya-qu7j89 spya-hj5y6s]. He also says nothing in his argument rules out artificial consciousness altogether [spya-rn8y3y].

The observation that this argument has the same shape as the biases Seth diagnoses (anthropocentrism, human exceptionalism) putting humans in a privileged category — that's my inference, not something the article states about itself.

Seth's own defense against the charge of self-serving bias is that AI resembles us in ways that don't matter (language) and differs in ways that do (being alive) [spya-d89xf7].

Whether that defense actually escapes the bias, or just relocates it, is my inference again — the article doesn't settle this explicitly.

Your own noticing — "I want it to be true as well" — is worth holding onto as you reread the "What (Not) To Do" section, where Seth tries to argue the asymmetry is principled rather than wishful.

> **Reader 3:** What do other people say about this? Is it a common view or is he out on a limb?

**Reply 3** — 276 words, 2 web searches, no tools, 1 article quotation

Checking how this sits in the wider debate, since the article only tells us Seth's own framing of it.This confirms what Seth says about his own position in the piece, and gives you the actual numbers. Computational functionalism — the view he's arguing against — is the dominant position among professional philosophers, not biological naturalism. In the 2020 PhilPapers Survey of professional philosophers, roughly a third of respondents accepted or leaned toward functionalism about consciousness, and one source summarizing that survey calls computational functionalism "a mainstream view in philosophy of mind, although certainly not the consensus" [web: arxiv.org/pdf/2501.07290]. So Seth's own characterization in the piece — that his position "remains a minority view" [spya-qu7j89] — lines up with the actual state of the field: he's pushing against the majority, not restating it.

He's also not alone, though. Biological naturalism traces back to the philosopher John Searle (which the article itself names [spya-hj5y6s]), and current writing describes biological naturalism as "the alternative to computational functionalism" that has "recently been gaining" ground as AI progress exposes cracks in the computational view [web: arxiv.org/abs/2606.02121-ish summary]. Commentators responding directly to Seth's companion academic paper on this same argument — Leonard Dung and David Reichert — have pushed back specifically on his claim that conscious AI *depends on* computational functionalism being true, arguing a biological substrate could matter without ruling out computation entirely, so there's active, specific philosophical disagreement with the piece, not just general skepticism, in a [response by David Reichert](https://davidpreichert.substack.com/p/is-biology-necessary-for-consciousness).

So: not a fringe position with no pedigree, but genuinely a minority one, and Seth is honest about that in the piece itself rather than smuggling in false consensus.

> **Reader 4:** Here's a case I keep coming back to. My dad had dementia at the end and there were days he seemed less there than a chatbot does. I don't know what to do with that but it feels relevant.

**Reply 4** — 306 words, 0 web searches, no tools, 2 article quotations

Marking the previous turn's claims:

- PhilPapers Survey finding on functionalism's support among philosophers: linked, from [this arXiv paper summarizing the survey](https://arxiv.org/pdf/2501.07290).
- "Seth's own characterization... lines up with the actual state of the field": my inference, comparing that search result to the article.
- Seth saying his position "remains a minority view": article block [spya-qu7j89].
- Biological naturalism traces to John Searle: article block [spya-hj5y6s].
- Biological naturalism "recently gaining" ground as an alternative: unverified — I described this from a search result but did not keep the link; treat it as unconfirmed rather than sourced.
- Dung and Reichert's specific pushback on Seth's argument: linked, from [this response by David Reichert](https://davidpreichert.substack.com/p/is-biology-necessary-for-consciousness).

On your dad: the article doesn't address dementia or degrees of consciousness within a declining living brain at all — that's a real gap, not something I can mark to a block. What it does give you is the idea that consciousness is "the difference between normal wakefulness and the oblivion of deep general anesthesia" [spya-j0a9rq], treated as roughly binary, and separately the claim that life is what grounds the capacity for consciousness, even if it doesn't guarantee how much is present at a given moment [spya-hj5y6s spya-pfkhtt].

My inference: your observation points at exactly the thing biological naturalism doesn't resolve — it asks what makes consciousness possible at all, not how much of it is present in a person whose living brain is deteriorating. A chatbot producing fluent language and a person with advanced dementia producing little are different failures in the article's own terms: one is about whether the capacity exists in principle, the other about how much is being expressed by a system that clearly has it. The article doesn't attempt to compare those two cases, and I'd be inventing an answer if I said it settles this for you.

> **Reader 5:** Maybe what I think is that seeming is all we ever get, with people too, and he's skating past that.

**Reply 5** — 206 words, 0 web searches, no tools, 2 article quotations, ⚠︎ id names another block: “is actually conscious…”

The article does lean on a seeming/actually distinction without quite confronting your point: it treats whether an AI "is actually conscious" versus "persuasively seems to be conscious" as a real and important difference even when we can't currently test for it [spya-x63ycg], and it builds the "Garland test" around the same distinction — a test of human persuasion, not of the fact of the matter [spya-kqs33c].

My inference is that this does skate past the classic problem of other minds: with other people, "seeming conscious" (behavior, testimony, embodiment) is also literally all the direct evidence anyone has ever had access to, yet nobody treats that as grounds for doubt. The article never raises this symmetry or explains why confidence about other humans is warranted while confidence about AI isn't, beyond the biological-naturalism argument that life itself is the relevant ground [spya-hj5y6s spya-pfkhtt]. Whether that argument is strong enough to carry the whole weight of the asymmetry — rather than merely restating that humans are alive and chatbots aren't — is the question your dementia example was already pressing on.

The article doesn't say so, but this is the philosophical "problem of other minds," a long-standing topic in epistemology that the piece doesn't name or engage directly.

## Counts, which are not the answer

- model: `anthropic/claude-sonnet-5`
- replies: 15 of 15
- words: median 295, longest 589; over 150: 15; over 220: 13
- web searches: 8 in all; replies that searched: 4; turn 3 (asked what others say) searched: 2 of 3
- `reader_notes` calls: 5; in a first reply: 2 of 3
- other tool calls: search_library, search_library, read_library_passage, article_citations, search_library, search_article_words, search_library, search_article_words
- quotations of the article: 33; with no id before the sentence ends: 4; with an id that names another block: 3; with the id later in the sentence rather than straight after: 13
- quoted with an id, but not the article's words as quoted: 2
