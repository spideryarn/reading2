# Quiz — the batch after the prompt was leaned easier, 2026-09-05

**One generation run** (`npm run eval:quiz -- --generate-only`) of `quiz/3` as it stands in the tree,
the prompt edited for SPIDERYARN-READING2-21 — *"The quiz questions are too hard. Certainly, they
should start much, much easier. And they should focus on what's most important."*
docs/plans/260905g-mark-every-visible-quote-and-make-the-quiz-start-easier.md.

**The before is `evals/results/quiz.md`**, the full 2026-09-01 run of `quiz/2` on the same article
with the same model. Neither side is a measurement — one run each, one article — but both halves of
the report moved and they moved the same way twice (see the footnote):

| | `quiz/2`, 2026-09-01 | `quiz/3`, 2026-09-05 |
|---|---|---|
| questions | 11 | 12 |
| bands | 4 easy · 3 medium · 4 hard | **6 easy** · 3 medium · 3 hard |
| value 4 or 5 | 5 of 11 | **9 of 12** |
| dropped | none | none |
| elapsed | 62.8s | 44.7s |

**The first six questions the reader now meets are all easy**, which is the ask; under `quiz/2` it
was four, and the fourth was already about Blake Lemoine, which nothing in the argument rests on.

**One thing to watch, and it is not new.** Questions 2 and 7 each join two questions with "and" —
*"What is computational functionalism, and why is it central to the idea of conscious AI?"* The
prompt bans that shape outright (§ ONE QUESTION MARK, ONE THING ASKED) and banned it before this
edit, so it is drift rather than damage. But a question that would have been `medium` on its own may
be reaching `easy` by having its easy half welded on, which is the specific way this edit could go
wrong. Worth reading for on the next run.

**Run twice.** An earlier version of this edit asked for five easy and *two* hard; a cross-family
review put the hard end back to three, because `missingBandEnds` measures what survived validation
and two leaves no margin — the failure of 260903c wearing a different number. That first run returned
the same 6 / 3 / 3, 10 of 12 at value 4-or-5, and three pieces of evidence dropped as unquoted; this
run dropped nothing, so that counter was noise. Two runs of two nearly-identical prompts is
consistency, not a measurement, and `evals/quiz.ts` says why these counts are a prompt to look rather
than a verdict.

Only the generation half was run, so there is no marking section below: the marking prompt did not
change, and paying for eight more calls to reprint an unchanged answer is not evidence. The harness
writes its own copy to `evals/results/quiz.md` and that copy was put back, because it is the
2026-09-01 full run and the only record of the eight marking cases.

---

## The batch

Read for what the prompt bans and the spike found anyway: a question about where something sits in the piece, two questions joined by “and”, a reference answer that is one semicolon-spliced sentence, a batch bunched in the middle of the band scale.

12 questions — 6 easy, 3 medium, 3 hard. `claude-sonnet-5`, 44.7s, 21616 in / 4583 out.

Dropped: 0 unanchored, 0 bad ids, 0 unquoted, 0 malformed, 0 duplicates, 0 over the evidence cap, 0 over the question cap.

### 1. How does Seth distinguish intelligence from consciousness?

`easy  ` · value 5 · spya-j0a9rq spya-nj888h

Intelligence is about doing — achieving complex goals by flexible means — while consciousness is about being, the subjective experience of what it is like to be something (as Nagel put it). The two can come apart, so a system can be intelligent without necessarily being conscious.

> an organism has conscious mental states if and only if there is something it is like to be that organism.  `spya-j0a9rq`
> A useful general definition of intelligence is the ability to achieve complex goals by flexible means.  `spya-nj888h`

### 2. What is computational functionalism, and why is it central to the idea of conscious AI?

`easy  ` · value 5 · spya-wepmnr

It's the assumption that implementing the right kind of computation or information processing is sufficient for consciousness to arise, regardless of the physical material doing the computing. Seth argues the whole idea of conscious AI rests on this largely unexamined assumption, and if it's wrong, real machine consciousness is off the table for standard digital computers.

> This assumption, which philosophers call computational functionalism, is so deeply ingrained that it can be difficult to recognize it as an assumption at all.  `spya-wepmnr`

### 3. What are the three psychological biases Seth says lead people to bundle intelligence and consciousness together?

`easy  ` · value 4 · spya-h4mwb2 spya-her4zk

Anthropocentrism (seeing things through a human lens as the definitional case), human exceptionalism (placing humans above all other things), and anthropomorphism (projecting humanlike qualities onto nonhuman things based on superficial similarities).

> The first is anthropocentrism.  `spya-h4mwb2`
> The second is human exceptionalism  `spya-her4zk`

### 4. What does Seth say we should never deliberately do, regardless of uncertainty about AI consciousness?

`easy  ` · value 4 · spya-yverz7

He says nobody should deliberately set out to create conscious AI, whether for a techno-rapture or any other reason, because doing so would introduce new moral subjects and new potential for suffering into the world, possibly at an exponential pace.

> nobody should be deliberately setting out to create conscious AI, whether in the service of some poorly thought-through techno-rapture, or for any other reason.  `spya-yverz7`

### 5. Why does Seth object to describing AI errors as "hallucinations" rather than "confabulations"?

`easy  ` · value 3 · spya-t29n67

He argues that calling AI errors 'hallucinations' implicitly confers on the system a capacity for conscious experience, since human hallucinations are experiences that have lost their grip on reality. 'Confabulate' would be more accurate because it describes making things up without implying any experience — it's about doing, not experiencing.

> When we say that AI systems “hallucinate,” we implicitly confer on them a capacity for experience.  `spya-t29n67`

### 6. What kind of 'soul' does Seth say actually matters, as opposed to the Cartesian soul evoked by silicon-rapture dreams?

`easy  ` · value 3 · spya-w8z40d

Not a disembodied, human-exceptionalist, undying rational essence separable from the body, but something closer to the ancient idea of soul as breath or a felt sense of simply being alive — more embodied feeling than pure thought, and more 'meat' than machine.

> Not any disembodied human-exceptionalist undying essence of you or of me. Perhaps what makes us us harks even further back, to Ancient Greece and to the plains of India, where our innermost essence arises as an inchoate feeling of just being alive  `spya-w8z40d`

### 7. What is the difference between simulation and instantiation, and why does it matter for mind-uploading dreams?

`medium` · value 5 · spya-npjt4j

A simulation of a process (like digestion or a rainstorm) reproduces its pattern without having its causal powers or actually being that process — a simulated rainstorm doesn't make anything wet. Applied to brain uploading, a computational simulation of a brain will only actually be conscious if computational functionalism is true, so uploading dreams already assume the very thing in question.

> In general, a computational simulation of X does not bring X into being — does not instantiate X — unless X is a computational process (specifically, an algorithm) itself.  `spya-npjt4j`

### 8. Why does Seth think the 'neural replacement' thought experiment fails to prove consciousness is substrate-independent?

`medium` · value 4 · spya-un9fjn

He points to research showing some neurons fire partly to clear metabolic waste products, meaning a perfect silicon replacement would require inventing an entirely new silicon-based metabolism — something silicon isn't suited for. Since a biological neuron can't be seamlessly replaced by a non-biological equivalent, the thought experiment's premise of frictionless substitution doesn't hold.

> Coming up with a perfect silicon replacement for these neurons would require inventing a whole new silicon-based metabolism, too, which just isn’t the kind of thing silicon is suitable for.  `spya-un9fjn`

### 9. How does Seth connect predictive processing theories of perception to the idea that life matters for consciousness?

`medium` · value 4 · spya-xhvztm spya-vys3vj

He argues perception, including of the self and body, works by the brain making best guesses (predictions) about causes of sensory signals, and this same prediction-error-minimization process underlies control of the body's physiology and even reaches into cellular metabolism. Because this process is deeply tied to the self-sustaining, living nature of biological material, consciousness may be inseparable from being alive rather than purely from information processing.

> Conscious experience in this light is a kind of controlled hallucination: a top-down inside-out perceptual inference in which the brain’s predictions about what’s going on are continually calibrated by sensory signals coming from the bottom-up  `spya-xhvztm`
> This drive to stay alive doesn’t bottom out anywhere in particular. It reaches deep into the interior of each cell, into the molecular furnaces of metabolism.  `spya-vys3vj`

### 10. Why does Seth argue that the deep multiscale integration of biological brains undermines the brain-as-computer metaphor?

`hard  ` · value 5 · spya-zw2m7u

He argues that in brains, unlike in digital computers, there's no clean separation between 'software' and 'hardware' — activity is interwoven across scales from cortical territories down to molecular metabolism, so what a brain does can't be cleanly separated from what it materially is. This lack of a hardware/software split undercuts the idea that a brain's consciousness-producing function could be abstracted away and run on any substrate.

> Unlike computers, even computers running neural network algorithms, brains are the kinds of things for which it is difficult, and likely impossible, to separate what they do from what they are.  `spya-zw2m7u`

### 11. Why does Seth think it's important to distinguish AI that is actually conscious from AI that merely seems conscious?

`hard  ` · value 5 · spya-n0bnf9

He argues each poses distinct ethical risks: giving rights to systems that only seem conscious could needlessly restrict our ability to control them, while treating genuinely conscious-seeming systems as if they lack feelings risks distorting our moral priorities or brutalizing our own minds. Since there's no definitive test for consciousness, we're stuck navigating both risks at once.

> either we decide to care about conscious-seeming AI, distorting our circles of moral concern, or we decide not to, and risk brutalizing our minds.  `spya-n0bnf9`

### 12. Why does Seth say the sense that we're always on the cusp of a major AI breakthrough is misleading?

`hard  ` · value 3 · spya-cke6sj

He explains that exponential growth curves create the illusion that we're always at a critical inflection point, since what's ahead always looks impossibly steep and what's behind looks flat, no matter where on the curve you actually are. This makes it tempting to feel we're on the verge of real machine consciousness even though the feeling itself is just an artifact of exponential curves.

> Exponential growth has the psychologically destabilizing property that what’s ahead seems impossibly steep, and what’s behind seems irrelevantly flat.  `spya-cke6sj`
