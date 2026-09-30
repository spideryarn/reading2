# Simple — the stage-1 probe, 2026-09-30

Stage 1 of [260930i-simple-summaries-eli15-sub-mode.md](../../docs/plans/260930i-simple-summaries-eli15-sub-mode.md)
§ *Measuring it*. Production's own `generateSimpleSummary`, on three local articles of different
difficulty, at `medium` and `high` effort, and at a fifteen-year-old's pitch (what ships) against a
twelve-year-old's (the probe's only). Made by [probe.ts](probe.ts); the raw answers, with a hash of
`src/simple-summary.ts` beside each, are under `evals/results/simple/<arm>/`. There is no
`dongetal25` on this box, so the paper is `entropy-24-00930` (a dense neuroscience methods review).

| article | what it is | body words |
|---|---|---:|
| `cargocult-spya-rz663q` | Feynman's *Cargo Cult Science*, a talk — easy | 3,822 |
| `noema-mythology-of-conscious-ai` | Anil Seth's Noema essay — middling, argumentative | 8,283 |
| `entropy-24-00930-spya-pywwkq` | a neuroscience paper on partial information decomposition — hard | 8,580 |

Two prompt rounds. **v1** asked for "under 250 words" (15) or "under 150" (12). **v2**, what ships,
asks for about 200 words and never more than 250 (15; 130 and 180 at 12), and caps every sentence
(25 words; 18 at 12). Nine calls a round; about **$0.70 in all**.

## What it found

1. **The model runs a third over any total it is given.** v1 at 15 wrote 261–339 words against
   "under 250", and **two of three `high` runs failed** the 320-word ceiling (327 and 339) — nothing
   stored, as designed. v1 at 12 wrote 189–208 against "under 150". v2's lower ask and the sentence
   cap brought 15 to 239–289 (no failures in six runs) — but 289 is only 10% under the ceiling.
   **Watch item**: if failures show up in the ledger, either raise `MAX_WORDS` or ask for three
   paragraphs rather than "two to four" (the model always takes four).
2. **`medium` and `high` cost the same and take the same time** here: 10–12 s against 11–12 s,
   2–5 cents each, 680–920 output tokens (thinking included). The answer is short, so adaptive
   thinking has little to spend. The plan's reason for `medium` — a shorter wait — does not hold.
3. **`high` was more faithful on the paper.** Both `medium` runs at 15 (and both at 12) turned the
   paper's "recurrent connections" between source neurons, which it finds *raise* synergy, into
   "feedback loops" — and the same paper reports that *feedback* connections go with *reduced*
   synergy (block `spya-sd9fzd`). A plainer word that bends a finding: exactly what plainer-means-
   equally-specific forbids. `high-15-v2` wrote "loop-like (recurrent) connections between the two
   source neurons", keeping the author's term. One article, one term: evidence, not a distribution.
4. **Otherwise faithful.** Read against the passages each paragraph names: Feynman's Millikan
   example, Young's rat experiment and "you must not fool yourself" are right wherever an arm
   includes them; so are Seth's intelligence/consciousness distinction, his case against
   computational functionalism and the "seems conscious" danger. No outside
   knowledge presented as the piece's that I could find; the author's name comes from the head
   (`BY:`). Numbers were mostly dropped rather than bent — the rich club's 2.7× synergy and the 7%
   peak became "higher" and "moderately similar", which is fair for an orientation.
5. **Every paragraph kept a door.** No paragraph was dropped for want of an id in eighteen
   successful runs; the ids dropped (0–5 a run) were almost all a fourth id past the cap of three.
6. **ELI12 against ELI15**, for Greg: 12 is shorter (190–208 words, three paragraphs usually) and
   reads more simply, and on the paper it made the same "feedback loops" slip. It does not lose
   more than 15 did at `medium`; its cost is detail (the Millikan and ESP examples compress to a
   clause). Both are below.

**Recommendation: `high`.** Same wait, same cost, and the one fidelity difference found went its
way. `STAGE_EFFORT.simple` is `high`, which puts it in the `ideas` … `sketch` cache group, so it
sits beside `faq` in `STEP_ORDER` as the plan first had it.

## The numbers and every output

| arm | article | body words | ok | wall s | $ | out tokens | words | paras | ids dropped | paras dropped |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| high-15 | cargocult-spya-rz663q | 3822 | yes | 10.6 | 0.0258 | 932 | 287 | 4 | 1 | 0 |
| high-15 | entropy-24-00930-spya-pywwkq | 8580 | **no** | 16.0 | ? | ? | - | - | - | - |
| high-15 | noema-mythology-of-conscious-ai | 8283 | **no** | 13.2 | ? | ? | - | - | - | - |
| high-15-v2 | cargocult-spya-rz663q | 3822 | yes | 12.1 | 0.0257 | 920 | 277 | 4 | 3 | 0 |
| high-15-v2 | entropy-24-00930-spya-pywwkq | 8580 | yes | 12.2 | 0.0484 | 872 | 239 | 4 | 2 | 0 |
| high-15-v2 | noema-mythology-of-conscious-ai | 8283 | yes | 11.4 | 0.0464 | 845 | 246 | 4 | 5 | 0 |
| medium-12 | cargocult-spya-rz663q | 3822 | yes | 8.4 | 0.0230 | 659 | 189 | 3 | 1 | 0 |
| medium-12 | entropy-24-00930-spya-pywwkq | 8580 | yes | 8.7 | 0.0450 | 542 | 205 | 4 | 1 | 0 |
| medium-12 | noema-mythology-of-conscious-ai | 8283 | yes | 12.9 | 0.0450 | 714 | 208 | 3 | 3 | 0 |
| medium-12-v2 | cargocult-spya-rz663q | 3822 | yes | 8.4 | 0.0219 | 533 | 196 | 4 | 0 | 0 |
| medium-12-v2 | entropy-24-00930-spya-pywwkq | 8580 | yes | 9.1 | 0.0461 | 642 | 190 | 3 | 1 | 0 |
| medium-12-v2 | noema-mythology-of-conscious-ai | 8283 | yes | 8.2 | 0.0447 | 675 | 198 | 3 | 2 | 0 |
| medium-15 | cargocult-spya-rz663q | 3822 | yes | 10.0 | 0.0231 | 662 | 271 | 4 | 2 | 0 |
| medium-15 | entropy-24-00930-spya-pywwkq | 8580 | yes | 10.4 | 0.0467 | 712 | 299 | 4 | 2 | 0 |
| medium-15 | noema-mythology-of-conscious-ai | 8283 | yes | 12.7 | 0.0466 | 870 | 261 | 4 | 1 | 0 |
| medium-15-v2 | cargocult-spya-rz663q | 3822 | yes | 12.3 | 0.0240 | 747 | 289 | 4 | 4 | 0 |
| medium-15-v2 | entropy-24-00930-spya-pywwkq | 8580 | yes | 11.6 | 0.0477 | 804 | 259 | 4 | 1 | 0 |
| medium-15-v2 | noema-mythology-of-conscious-ai | 8283 | yes | 10.2 | 0.0448 | 681 | 263 | 4 | 1 | 0 |

## cargocult-spya-rz663q

### high-15

This is a speech Richard Feynman, a physicist, gave to a graduating class in 1974. He talks about things that look like science but aren't really science at all. He calls this "Cargo Cult Science," named after islanders who built fake airports and control towers hoping planes full of supplies would land again, copying the outward form without understanding what actually made it work.

<sub>spya-f6b5fs spya-wv9g0v spya-fd2muf</sub>

Feynman says this matters because many people believe in things like UFOs, astrology, or mind-reading, and even fields that claim to be scientific, like some education or criminal-justice methods, never actually check whether their ideas work. He argues the missing piece in fake science isn't obvious, like better equipment; it's a kind of honesty scientists are supposed to have but rarely get taught directly.

<sub>spya-bcgpc3 spya-re4634 spya-afgs74</sub>

The key idea is scientific integrity: you must report everything that might prove your own result wrong, not just the evidence that supports it, and you must always publish results whether they support your idea or not. He gives examples, like how early measurements of the electron's charge crept slowly toward the correct number over years because scientists distrusted results that differed too much from the first measurement, and a careful 1937 experiment by a researcher named Young, who painstakingly ruled out every possible clue rats could use to find food, yet other scientists later ignored his careful method and kept running sloppy experiments anyway.

<sub>spya-s9msxy spya-uj9v2h spya-yzzxkw</sub>

Feynman's main lesson is: the first rule is not to fool yourself, since you're the easiest person to fool, and only after that can you be honest with others. He ends by wishing the graduates the freedom to keep that kind of honesty even when their job or funding might tempt them not to.

<sub>spya-ed9mzv spya-ndyj3t</sub>

### high-15-v2

This is a 1974 graduation speech by physicist Richard Feynman. It is about telling real science apart from fake science that only looks like the real thing. He calls the fake kind "Cargo Cult Science," after islanders who built fake airports hoping planes would land, copying the look of an airport without understanding what actually makes planes come.

<sub>spya-f6b5fs spya-wv9g0v spya-fd2muf</sub>

Feynman says this matters because many people believe in things like UFOs, ESP, and key-bending psychics, even though none of it holds up when tested. Worse, some fields that call themselves scientific, like certain teaching methods or ways of handling criminals, keep being used even though they do not seem to actually work. He worries this pseudoscience makes ordinary people doubt their own good sense.

<sub>spya-bcgpc3 spya-aww976 spya-re4634</sub>

His key idea is scientific integrity: leaning over backwards to be honest, even about things that hurt your own case. That means reporting anything that might prove you wrong, not just the evidence that supports you, and publishing results whichever way they turn out. He points out that even real scientists have fooled themselves this way, like early measurements of an electron's charge that stayed wrong for years because people didn't trust results too different from the first one.

<sub>spya-afgs74 spya-rxj5wa spya-jk7mj4</sub>

He also gives an example of good science: a researcher named Young who carefully tested every possible clue a rat might use to find food, until he ruled them all out one by one. Feynman contrasts this with weaker studies, like ESP experiments where the effect keeps shrinking the more carefully it's checked. His main message: the first and hardest rule of science is not fooling yourself, since you are the easiest person to fool.

<sub>spya-rndcqw spya-yzzxkw spya-rbpppq</sub>

### medium-12

This is a speech given by physicist Richard Feynman to college graduates in 1974. He talks about the difference between real science and "pseudoscience" — things that look like science but aren't. He calls this fake kind "Cargo Cult Science," after island people who built fake airports hoping planes would land, copying the look of things without understanding what actually makes them work.

<sub>spya-f6b5fs spya-wv9g0v spya-fd2muf</sub>

Feynman says this matters because so many people believe in things that never really work, like ESP or certain teaching methods, and this can intimidate people with good common sense into doubting themselves. He argues that real science needs something extra: total honesty with yourself, even when it's inconvenient.

<sub>spya-re4634 spya-g2cwvy spya-ed9mzv</sub>

His key idea is "scientific integrity": reporting everything that might prove you wrong, not just the evidence that supports you, and always publishing results no matter how they turn out. He gives examples, like scientists slowly correcting Millikan's electron measurement over years instead of admitting the first number was off right away, and a rat experiment where a researcher named Young had to remove every possible clue (sight, smell, sound) before rats stopped finding food by cheating.

<sub>spya-rxj5wa spya-s9msxy spya-uj9v2h</sub>

### medium-12-v2

This is a 1974 graduation speech by physicist Richard Feynman. He talks about what he calls Cargo Cult Science: research that copies the outward form of science but misses something important, so it doesn't really work.

<sub>spya-f6b5fs spya-fd2muf</sub>

Feynman says this matters because many things people call science, like some teaching methods or ways of handling criminals, never actually improve even though experts keep studying them. He thinks ordinary people are wrongly made to feel their own good ideas are less valid than these unproven expert methods.

<sub>spya-aww976 spya-re4634</sub>

His main idea is scientific integrity: being brutally honest about your own work, even the parts that make you look wrong. That means reporting every flaw you find, publishing results whether they support your idea or not, and not fooling yourself, since he says you are the easiest person to fool.

<sub>spya-rxj5wa spya-jk7mj4 spya-ed9mzv</sub>

He gives examples: scientists who kept measuring an electron's charge close to an old wrong answer because they didn't trust readings that differed from it, and a rat experiment that carefully ruled out every possible clue a rat could use to find its way. He contrasts these with parapsychology, where effects shrink away under closer testing but are never abandoned.

<sub>spya-s9msxy spya-npdc6n spya-rbpppq</sub>

### medium-15

This is a 1974 graduation speech by physicist Richard Feynman, about how easy it is for scientists to fool themselves. He calls bad science that just copies the outward form of real science, without the substance that makes it work, "Cargo Cult Science" — named after islanders who built fake runways and control towers hoping planes would land, because they copied the look of what they'd seen without the thing that actually made it work.

<sub>spya-fd2muf</sub>

Feynman says this matters because fields like education research and criminal justice keep using methods that never actually improve results, yet are treated as scientific — and ordinary people with common sense get talked out of their own good judgment by this fake authority.

<sub>spya-re4634 spya-g2cwvy</sub>

His main idea is scientific integrity: when you report an experiment, you must also report everything that might prove you wrong, not just the evidence that supports you. He gives examples, like scientists who kept measuring the electron's charge close to an old, slightly wrong number for years because they subconsciously threw out results that seemed too different, and only trusted ones close to the expected answer.

<sub>spya-rxj5wa spya-s9msxy spya-uj9v2h</sub>

He also praises a rat experiment where the researcher carefully removed every possible clue (smell, sound, sight) to make sure the rats were learning what he intended, calling it a model of careful science — even though later researchers ignored his methods anyway. Feynman ends by saying the first rule is not to fool yourself, since you are the easiest person to fool, and he wishes his listeners the freedom to keep this kind of honesty even when institutions or money pressure them not to.

<sub>spya-npdc6n spya-yzzxkw spya-wye8g6</sub>

### medium-15-v2

This is a speech by physicist Richard Feynman, given at a college graduation in 1974. It is about spotting fake science, things that look and sound scientific but are not. He calls this "Cargo Cult Science," named after island cultures that built fake airport runways and control towers hoping planes full of goods would land, copying the look of the real thing without understanding why it worked.

<sub>spya-arxt8r spya-f6b5fs spya-wv9g0v</sub>

Feynman says this matters because many things treated as scientific, like methods for teaching reading, or handling criminals, never actually get checked to see if they work. He compares this to old-fashioned cures that never got properly tested. Ordinary people with common sense get talked out of their own good ideas by so-called experts using these fake-scientific methods.

<sub>spya-aww976 spya-re4634 spya-g2cwvy</sub>

His main idea is that real science needs a kind of strict honesty, especially honesty with yourself, since you are the easiest person to fool. Scientists should report everything that might prove their own idea wrong, not just the evidence that supports it. He gives an example: measurements of the charge of an electron kept creeping up over time because early scientists quietly ignored results too different from a famous earlier measurement, instead of just reporting all their data.

<sub>spya-afgs74 spya-rxj5wa spya-s9msxy</sub>

He also describes good and bad examples from research. A scientist named Young carefully ruled out every possible clue rats could use to find food, which was excellent science, but later researchers ignored his careful methods. Meanwhile, some studies of ESP (reading minds or predicting the future) kept shrinking in their results as they got better tested, yet were still defended. Feynman ends by wishing listeners the freedom to keep this kind of honesty, even when their job or funding might tempt them not to.

<sub>spya-npdc6n spya-wye8g6 spya-rbpppq</sub>

## entropy-24-00930-spya-pywwkq

### high-15

Failed: The model wrote 339 words and the limit is 320. Nothing is kept rather than a cut-down version.

### high-15-v2

This is a review article about how brains process information. It explains a math tool called partial information decomposition, or PID, which breaks down how neurons combine signals from other neurons. The authors use it to study real recordings of brain cells to see how information gets combined into new patterns.

<sub>spya-xn9j9k spya-gzwbsr</sub>

Figuring out how neurons process information is one of neuroscience's biggest open questions. Older tools could track information moving between neurons, but not show how neurons truly combine or transform it. PID lets researchers see three things at once: information repeated across sources (redundant), information only one source has (unique), and information that only shows up when sources are combined (synergistic).

<sub>spya-rxcze4 spya-s0db2g spya-wer4cd</sub>

Synergy, the combined kind of information, turned out to matter most for understanding computation. Studies of brain cell cultures found synergy was higher in "rich clubs," tightly connected groups of well-linked neurons, and in triads with more loop-like (recurrent) connections between the two source neurons. Synergy also depended on how similar the two incoming signals were: it rose with similarity up to a point, then fell as redundancy took over instead.

<sub>spya-fud8q3 spya-sd9fzd spya-hkhpex</sub>

The same patterns showed up in monkeys performing tasks, not just in lab cultures, and synergy shifted depending on what the brain was doing at the moment. The article also covers practical tips for using PID, its limits, such as needing huge amounts of data, and newer extensions like decomposing information across time or multiple targets.

<sub>spya-wr7f6y spya-t8fayf spya-aby2dp</sub>

### medium-12

This article is about how brain cells work together to process information. Scientists want to know how neurons take in signals and combine them to make decisions, like whether to fire or not.

<sub>spya-rxcze4 spya-h5dz45</sub>

This matters because just watching one neuron at a time, or two neurons passing signals, doesn't show the full picture. The authors argue that a method called partial information decomposition, or PID, can reveal when neurons are doing real 'computation' by combining inputs in ways that create brand new information, not found in any single input alone.

<sub>spya-s0db2g spya-wer4cd spya-e94ury</sub>

PID splits the information neurons share into parts: redundant (the same information available from more than one source), unique (only from one source), and synergistic (only visible when you look at sources together). Synergy is the exciting one, since it shows neurons are sensitive to patterns, not just totals.

<sub>spya-h5jzvm spya-e94ury</sub>

Using real recordings of brain cells, the authors found synergy shows up more in densely connected 'rich club' neurons, grows with more feedback loops between input neurons, and peaks when input signals are moderately, but not too, similar to each other. In monkeys doing tasks, the balance of synergy and redundancy shifted depending on what the brain was doing, like planning a movement versus executing it.

<sub>spya-fud8q3 spya-sd9fzd spya-ybmve2</sub>

### medium-12-v2

This article is a science review about how brain cells, called neurons, handle information. It explains a math tool called partial information decomposition, or PID, which breaks down how neurons combine signals from other neurons. The tool separates information into parts: information repeated across sources, information unique to one source, and information that only appears when sources are combined, called synergy.

<sub>spya-xn9j9k spya-u0wm5e</sub>

Understanding this matters because scientists still don't know exactly how brain circuits transform incoming signals into useful actions. New recording tools now capture activity from thousands of neurons at once, but making sense of that flood of data needs better methods. PID offers a way to see not just whether neurons talk to each other, but how they combine signals to compute something new.

<sub>spya-rxcze4 spya-s9kmxa spya-gzwbsr</sub>

Using recordings from mouse brain cells and monkeys performing tasks, the authors found synergy (joint, combined information) is common in real neural circuits. It was especially strong in well-connected "rich club" neurons, in circuits with more feedback loops among neurons, and where input signals were moderately, but not too, similar. In monkeys, synergy also shifted depending on the task, showing information processing changes with behavior.

<sub>spya-fud8q3 spya-sd9fzd spya-hkhpex</sub>

### medium-15

This article is about how scientists try to figure out what brains are actually doing when they 'process information.' Brains take in signals from the world and turn them into behavior, but how neurons combine signals from many sources into something new is still poorly understood. The authors introduce a tool called partial information decomposition, or PID, which helps break down how neurons share and combine information.

<sub>spya-rxcze4 spya-gzwbsr</sub>

This matters because just watching information flow from one neuron to another does not tell you how neurons actually combine and transform that information. The authors say a new approach was needed to reveal the difference between neurons that simply relay signals and neurons that truly compute something new from multiple inputs at once.

<sub>spya-s0db2g spya-u5ra3d</sub>

The key idea is that when two source neurons send signals to one target neuron, their combined information can be split into pieces: redundant information (the same message told twice), unique information (something only one source knows), and synergistic information (something you can only learn by looking at both sources together, a kind of higher-level pattern). Synergy is treated as a sign that a neuron is doing real 'computation,' not just adding up inputs. Using recordings from mouse brain cell cultures and from monkeys performing tasks, the researchers found that synergy is common, is higher in tightly connected 'rich club' neurons, grows with more feedback loops between source neurons, and changes depending on what behavior the animal is doing.

<sub>spya-h5jzvm spya-e94ury spya-fud8q3</sub>

The piece also walks through practical issues: choosing how to measure 'redundancy,' picking software tools, and dealing with the fact that this math becomes extremely complex as more neurons are added. It ends by pointing to newer extensions of the method and open questions for future research, such as studying animals as they behave rather than only in dishes.

<sub>spya-rc76qn spya-aby2dp spya-cds6mm</sub>

### medium-15-v2

This article is a review about how scientists study 'information processing' in the brain: how groups of neurons take in signals and turn them into something new. It introduces a tool called partial information decomposition, or PID, which breaks down how much neurons together tell us about another neuron's future activity.

<sub>spya-xn9j9k spya-gzwbsr</sub>

This matters because brains take in signals from the world and use them to guide behavior, but how they actually transform that information is poorly understood. Simple tools like measuring how one neuron's past activity predicts another's future (called information flow) show that information moves through circuits, but not how neurons combine different signals into something new.

<sub>spya-rxcze4 spya-s0db2g</sub>

PID splits the total information two source neurons give about a target into three parts: redundant (told by either source alone), unique (only from one source), and synergistic (only clear when looking at both together). Synergy is treated as a sign of real computation, since it means the target reacts to patterns, not just totals. Studies of neurons grown in dishes found synergy was higher in densely connected 'rich club' neurons, in circuits with more feedback loops between the two sources, and when the two sources' activity was moderately, but not too, similar.

<sub>spya-h5jzvm spya-fud8q3 spya-sd9fzd</sub>

Similar patterns showed up in monkeys performing a task, where synergy shifted depending on the stage of the task, such as rising sharply during movement in the motor brain area. The article ends by pointing to open challenges, like handling huge numbers of neurons at once and extending PID to track information over time and across multiple targets.

<sub>spya-t8fayf spya-aby2dp spya-cds6mm</sub>

## noema-mythology-of-conscious-ai

### high-15

Failed: The model wrote 327 words and the limit is 320. Nothing is kept rather than a cut-down version.

### high-15-v2

This essay asks whether artificial intelligence could ever be truly conscious, meaning it actually feels or experiences things, not just acts smart. The author, a neuroscientist, argues that being intelligent (able to do clever things) and being conscious (having real inner experience) are not the same, and that AI having one does not mean it has the other.

<sub>spya-tgnssb spya-q23td7 spya-nj888h</sub>

The question matters because if AI ever became conscious, it would deserve moral concern and maybe rights, and could suffer. It also matters even if AI is not conscious: believing machines feel things when they do not can warp our ethics, our emotions, and how we treat real living things.

<sub>spya-e68t9h spya-z2b4ny spya-sge6a2</sub>

The author explains why we are tempted to see consciousness in AI: human biases like assuming machines that talk like us must think and feel like us, plus hype about exponential progress and fantasies of AI as god-like or immortal. He then argues that consciousness likely requires computation is not enough. Brains are not really computers, since living biology, timing, and material stuff seem to matter in ways abstract programs do not.

<sub>spya-cvaqgs spya-cke6sj spya-v4sduf</sub>

He suggests consciousness may be tied to being alive, not just to processing information, and that simulating a brain on a computer is not the same as actually creating one, the way simulating rain does not make anything wet. His conclusion: real conscious AI is unlikely with current computers, but AI that merely seems conscious is already here, and that illusion is dangerous on its own.

<sub>spya-hj5y6s spya-cqh5wq spya-npjt4j</sub>

### medium-12

This essay by a neuroscientist asks a big question: could artificial intelligence, like chatbots, ever actually be conscious — meaning there is something it feels like to be them, the way there is something it feels like to be you? He argues that most claims that AI is already conscious, or soon will be, rest on shaky thinking.

<sub>spya-tgnssb spya-gjy45p spya-j0a9rq</sub>

This matters because conscious things deserve moral concern and could suffer, so wrongly building or wrongly ignoring conscious machines would both be serious mistakes. It also matters because if we start believing machines feel things when they don't, it can warp how we treat real feelings, including our own.

<sub>spya-e68t9h spya-z2b4ny spya-sge6a2</sub>

The author separates being smart (intelligence) from being able to feel (consciousness) — they are not the same thing, even though humans have both. He argues brains are not really like computers running programs, so making a machine "think" the way software runs may not create real experience. He also suggests being alive, not just processing information, might be necessary for consciousness, and that simulating a brain is not the same as actually building one. His conclusion: real conscious AI is unlikely with today's computers, but AI that merely seems conscious is already a serious problem we must think carefully about.

<sub>spya-nj888h spya-a8jgf4 spya-hj5y6s</sub>

### medium-12-v2

This essay by a neuroscientist asks a big question: could artificial intelligence (AI) ever truly be conscious, meaning there is something it feels like to be that machine? It looks at why so many people, including top AI experts, now think machine consciousness might already be here or coming soon.

<sub>spya-tgnssb spya-gjy45p spya-epw4h3</sub>

The author says this question matters a lot. If AI really became conscious, it could suffer and might deserve rights, which would make it hard to control or switch off. But even if AI only seems conscious without truly being so, treating it as if it feels things (or coldly ignoring it) can warp our ethics and hurt our own minds.

<sub>spya-e68t9h spya-z2b4ny spya-yverz7</sub>

The author argues intelligence, meaning the ability to do clever things, is not the same as consciousness, meaning the ability to actually feel or experience. He questions the popular assumption that running the right computer program is enough to create consciousness, pointing out that brains are messy, living, biological things, unlike computers, and that simulating a mind is not the same as truly creating one. His conclusion: real conscious AI looks very unlikely with today's technology, but AI that merely seems conscious is already a serious problem.

<sub>spya-nj888h spya-cv97j7 spya-cqh2pq</sub>

### medium-15

This essay by neuroscientist Anil Seth asks a big question: could artificial intelligence (AI) ever actually be conscious, meaning it truly feels or experiences things, not just acts smart? He looks at chatbots and other AI systems and asks whether anyone is really "home" inside them.

<sub>spya-tgnssb spya-gjy45p spya-q23td7</sub>

Seth says this question matters a lot. If AI really were conscious, it could suffer, and we might owe it rights and moral care. But even if AI only seems conscious without really being conscious, treating it as if it has feelings (or coldly treating it as if it doesn't) can warp our ethics and even harm our own minds.

<sub>spya-e68t9h spya-z2b4ny spya-n0bnf9</sub>

Seth argues we're tricked into overestimating AI by natural human biases: we assume intelligence and consciousness go together, we favor humans above all else, and we project human qualities onto machines that merely act humanlike, especially when they use language. His main technical argument is against "computational functionalism" — the idea that just running the right kind of program is enough to create consciousness. He argues brains aren't really computers: living neurons are messy, biological, and tied to time and metabolism in ways computer programs are not, so simulating a brain isn't the same as building a conscious one.

<sub>spya-cvaqgs spya-wepmnr spya-a8jgf4</sub>

He separates two dangers: AI that is truly conscious (which he thinks is very unlikely with today's technology) and AI that merely seems conscious (which is already here and causing real confusion). His conclusion: nobody should try to build genuinely conscious machines, and we must think clearly now, or we'll misjudge both the machines and ourselves.

<sub>spya-x63ycg spya-yverz7 spya-qwvjwn</sub>

### medium-15-v2

This essay asks whether artificial intelligence could ever be truly conscious — able to actually feel or experience things, not just act smart. It's written by a neuroscientist who studies consciousness, and it pushes back against the growing idea that chatbots or AI systems already have, or soon will have, real inner experience.

<sub>spya-gjy45p spya-e68t9h</sub>

The question matters because if AI really were conscious, it would deserve moral concern and maybe even rights, and we couldn't just switch it off. But it also matters if we wrongly believe AI is conscious when it isn't: we might get manipulated, care about the wrong things, or treat real suffering as unimportant. Either way, how we think about this changes how we understand ourselves too.

<sub>spya-e68t9h spya-z2b4ny spya-sge6a2</sub>

The author argues we're biased to see consciousness in AI because we mix up two different things: intelligence (being able to do clever tasks) and consciousness (actually feeling or experiencing anything at all). We assume they go together because in humans they do, but that's not necessarily true elsewhere. He also argues brains aren't really like computers — they're living, changing, and tied to time in ways computers running programs are not, so simply running the right program probably isn't enough to create real experience.

<sub>spya-nj888h spya-j0a9rq spya-a8jgf4</sub>

His conclusion: real conscious AI is unlikely with today's computers, but AI that merely seems conscious is already here, and that's its own serious problem. He warns against ever deliberately trying to build conscious machines, and says society should think carefully now about how to treat convincing but possibly unfeeling AI, rather than getting swept up in hype.

<sub>spya-c5ve5t spya-vs0vpj spya-x63ycg</sub>

