# A longer Fuller, and bold and bullets: the before/after prompt eval

Up: [investigations.md](../project/investigations.md)

Run on 2026-10-04 for [plan 261004b](../plans/261004b-summary-fuller-longer-and-bold-and-bullets.md),
two reports from Greg:

> I think we want the most detailed submode of Summary to be longer and more detailed still. (I
> think it's called fuller.)
>
> — Greg, 2026-10-03 (`spya-azft06`)

> Maybe, maybe the summary submodes could make use of Markdown, like bold or bullet points, to make
> it easier to skim the summary. I suppose it's possible they could use headings, but that might be
> overkill. That could be interesting. Experiment with it.
>
> — Greg, 2026-10-03 (`spya-qzsvx4`)

**The before and after text for three articles is at the end**, which is the experiment he asked to
see. Screenshots of it in the app: [desktop](../plans/261004b-shot-desktop-fuller.png),
[iPad](../plans/261004b-shot-ipad-fuller.png), [phone](../plans/261004b-shot-phone-fuller.png),
[Brief](../plans/261004b-shot-desktop-brief.png).

## What shipped, in one paragraph

Fuller is about half as long again: a median of 374 words where it was 254, in six or seven
paragraphs where it was five. Brief and Fuller have a few key phrases in bold, and Fuller usually
has one paragraph drawn as a bulleted list. Twice as long (about 500 words) was built first and
read well, but it doubled the wait for the whole summary, Brief included, so it did not ship. That
trade is the open question for Greg below.

## What was run

- **Harness:** `evals/simple/probe.ts`, which calls production's `generateSimpleSummary` with
  `--power high` and the fidelity guard on, as a press does. `evals/simple/fuller-format.ts` makes
  the tables, the judge's files and the tallies; it calls no model.
- **Articles (3), no reader profile:** Greg's rat-rearing paper (`s41598-023-33209-9-spya-s0qydm`),
  the entropy review (`entropy-24-00930-spya-pywwkq`), and *The Scaling Hypothesis*. The article he
  filed the reports on is not in the local database.
- **Arms, separated in time, two draws each, the two draws run side by side:**
  - `fbazb1`, `fbazb2`: the old prompt (`simple-prompt/6`) on `0531fb7f`, before any edit.
  - `fbaza1`, `fbaza2` ("long"): Fuller asked for about 500 words; bold asked of all three levels.
    Commit `b56d949ce`.
  - `fbazc1`, `fbazc2` ("after", what shipped): Fuller asked for about 350 words; bold asked of
    Brief and Fuller only.
- 18 presses, about **$4.70**. Results under `evals/results/simple/high-none-fbaz*/` and
  `evals/results/simple/fuller-format-261004b/`.
- **The judge was GPT Sol**, a different family from the Opus writer, read-only, in two runs that
  each read one file.

## The numbers

| | before | long (500 asked) | **after (350 asked)** |
|---|---|---|---|
| Fuller words, median (range) | 253.5 (221–261) | 490 (464–520) | **374 (338–412)** |
| Fuller paragraphs | 5 | 7–8 | 6–7 |
| Brief words | 95–122 | 89–104 | 84–109 |
| Simple words (written, not shown) | 160–212 | 189–234 | 168–211 |
| a press, median wall time | 26.3 s | **55.1 s** | 30.9 s |
| a press, cost | $0.20–0.25 | $0.23–0.39 | $0.24–0.27 |
| guard: first answers flagged, of 18 levels | 0 | 2 (both Simple) | 1 (Simple) |
| levels stored flagged | 0 | 0 | 0 |
| bold phrases kept, Brief / Simple / Fuller, a summary | none | 2 / 2–4 / 4–6 | 2–3 / none / 3–7 |
| bold phrases refused by validation | | 2 of 51 | 1 of 44 |
| list paragraphs in a Fuller | none | 1 in each | 1 in five of six |

**Fidelity**, every Fuller sentence labelled by Sol against its paragraph's cited passages (372
sentences, 18 summaries, shuffled, no arm named):

| | words | sentences | unsupported: minor, serious | unsupported per 100 words | repeated or filler | Fullers with a serious, of 6 |
|---|---:|---:|---|---:|---:|---:|
| before (draw 1; draw 2) | 740; 754 | 39; 38 | 10, 3; 5, 5 | 1.76; 1.33 | 0 | 4 |
| long | 2,951 | 165 | 14, 6 | 0.68 | 0 | 4 |
| **after** | 2,271 | 130 | 15, 6 | **0.92** | 0 | **3** |

**Formatting, on identical words.** Each after-arm Brief and Fuller drawn twice, once with its bold
and bullets and once plain, sides balanced 3 and 3 per level. Sol was asked in which a reader with
ten seconds would find the main findings faster: **formatted 12, plain 0** (Brief 6–0, Fuller 6–0).

## Against the ship rule declared before the after-runs

The long arm first, since it was the plan as written:

- Length, the other levels, well-formed formatting, fidelity and substance: **met**.
- **The wait: failed.** 55.1 s against a ceiling of 38.3 s. Fuller is the slowest of the three
  calls and nothing is stored or shown until all three are written, so a longer Fuller makes the
  reader wait longer for Brief too. Summary opens on Brief.
- **The guard: failed.** Two first answers flagged in 18 levels, against a ceiling of one. Both were
  the Simple level, which nobody is shown, and both rewrites passed.

So the plan's declared fallback was run, with one change GPT Sol's code review asked for (F12):
the flags were in Simple, which a shorter Fuller cannot touch, so Simple is now asked for no bold.

The after arm:

1. **Length: not met as first written, by design.** The rule asked for at least 406 words (1.6 times
   the before median); the fallback asks for about 350 and gets 374, which is 1.48 times. No level
   failed validation.
2. **The other levels hold still: met.**
3. **Guard: met.** One first answer flagged in 18 (Simple, on the entropy review, with no bold asked
   of it), rewritten and passed. That paper is the one the guard was built for, so this looks like
   its ordinary rate, not an effect of the change. It is one flag in six presses, though, and the
   before arm had none.
4. **Fidelity: met.** 0.92 unsupported sentences per 100 words, under both before draws (1.76,
   1.33); 3 Fullers with a serious one, against 4.
5. **Substance: met.** No sentence was labelled repeated or filler in any arm.
6. **Well-formed: met.** 43 of 44 keys kept (98%); never more than two in a paragraph; at most one
   list a Fuller; none in Brief or Simple.
7. **Formatting helps: met**, 6–0 at each level, with the caveat below.
8. **The wait: met.** 30.9 s against 26.3 s, 4.6 s more.

**Decision: ship the after arm as `simple-prompt/7`.**

## In the browser

A Sonnet subagent regenerated the rat paper's summary through the app's own job route and checked it
at desktop (1440×900), iPad portrait and phone portrait: bold is the sentence's own face and size at
weight 700; the list draws as a lead-in and bullets with nothing clipped; no horizontal overflow; a
bulleted sentence shows the passage card on hover, jumps on click or tap, and lights up while its
passage is on screen, with and without bold in it; an older summary on another article still draws
as plain paragraphs.

## Read by hand

- **The extra words are the method, the numbers and the limits.** On the rat paper the before
  Fuller had no limits at all; the after one has a paragraph of them ("the delayed light still
  overlapped about 35.5% of rearing time"). On the essay it gained the argument for why predicting
  text would need reasoning, and what the author admits he cannot say.
- **The bullets land on things that are lists in the piece**: the three kinds of trial, four
  findings about where synergy sits. One Fuller of six had no list, which the prompt allows.
- **Bold picks the finding, the number or the term**: "77.7% to 65.7%", "2.7 times the synergy",
  "the scaling hypothesis". In Brief it is two or three phrases.
- **A lead-in costs a sentence.** "Synergy followed clear patterns in the network's wiring and
  activity." says little by itself. It is the price of a list whose text still reads as prose to
  the fidelity guard.

## Caveats

- Three articles, two draws an arm, one judge. The wait is six presses an arm on a busy box.
- **"Unsupported" here mostly means "not in the cited passages"**, not "wrong": a detail true
  elsewhere in the article, with the paragraph citing at most three passages. The same was found in
  [261002q](261002q-brief-plainer-prompt-eval.md). The numbers compare arms; they are not a fault
  rate for readers.
- **The formatting vote is a model's guess at skimming, and the judge can see which side is
  formatted.** It rules out bold that picks the wrong words; it does not show a person reads faster.
  That is Greg's eye on the text below.
- Length cannot be hidden from the fidelity judge; only which draw wrote a summary was.

## Open for Greg

**[Q-summary-fuller-length] How long should Fuller be, given what it does to the wait?**

Background: pressing Summary on a new article writes Brief and Fuller together, and shows nothing
until both are done (and a third, hidden level). So the slowest one sets the wait, and that is
Fuller. This is once an article; after that it is stored.

- **A. Keep what shipped: about 370 words, about 31 s.** Half as long again as before. The wait is
  5 s more than it was.
- **B. About 490 words, about 55 s.** Twice as long as before. Text below; it adds more of the
  method. Every first open of Summary waits about half a minute longer, and Brief waits with it.
  It is a two-number change to the prompt, and the stored limits already allow it.
- **C. About 490 words, and show Brief the moment Brief is written.** Brief would appear sooner than
  it does today, and Fuller would fill in behind it. This is the right shape, and it is real work:
  today the three levels are stored all-or-none, and the panel, the job and the public payload all
  assume that. It is the same change as the streaming question left open in
  [260930i](../plans/260930i-simple-summaries-eli15-sub-mode.md).
- **D. Stop writing the hidden Simple level.** It is written on every press, shown to nobody since
  2026-10-03, and was where every guard flag in this eval came from, each costing a rewrite. It
  would not shorten the wait much (Fuller is the slow one) but saves roughly a third of the cost.
  It combines with any of A to C.

What would decide it: if a minute's wait on first open is fine for you, B today. If the wait
matters, A now and C as its own piece of work. **Recommendation: A now, then C, with D folded into
C.** C is in the Overseer's queue.

**[Q-summary-format-keep] Bold and bullets: keep both, one, or neither?** Having looked at the text
below. Each is one line of the prompt to turn off, and summaries already written keep what they have
until rewritten.

## Before and after

Bold and bullets are shown as the reader sees them. The passage chips under each paragraph are left
out.

### Hippocampal inactivation during rearing on hind legs impairs spatial memory (a research paper)

**Fuller before** (261 words):

> This is a lab study in rats asking whether a brain area called the hippocampus needs to be working while a rat rears up on its hind legs. The hippocampus is a part of the brain long known to be essential for spatial memory, meaning memory for places and routes. The researchers switched it off only during rearing and then checked how well the rats remembered where food was.
>
> Most past work on the hippocampus and memory looked at rats walking around or resting, such as grooming or eating. Yet rats often stop and rear up to look and sniff around, which may give them better information about distant landmarks. Whether brain activity during rearing matters for memory was unknown.
>
> Rats learned a maze task: first visit four open arms for food, wait four minutes, then find food in the other four arms. A 3D camera spotted rearing and triggered a light that silenced the hippocampus through an implanted light-sensitive protein, a method called optogenetics. This was done only in the first visit, so any memory failure came from learning, not recall.
>
> Silencing during rearing cut correct choices from 77.7% to 65.7% and raised arm entries from 5.1 to 6.5. Silencing for the same time but six seconds late caused no significant drop, only a borderline rise in arm entries. Control rats without the light-sensitive protein were unaffected.
>
> The authors conclude that hippocampal activity during rearing is important for spatial memory. They suggest rearing may be when the brain updates its inner map of the surroundings, though this remains a proposal.

**Fuller after, as shipped** (368 words):

> This is a lab experiment in rats about rearing, when a rat stops and stands up on its hind legs to look and sniff around. It asks whether the hippocampus, a brain region needed for remembering places, **must be working during these moments** for the rat to form a spatial memory.
>
> Most research on the hippocampus has looked at rats walking around or resting quietly, such as grooming or eating. Rearing is common, and during it the hippocampus shows a strong 7–12 Hz brain rhythm called theta, which is tied to learning and remembering. Even so, whether rearing matters for spatial memory was unknown.
>
> Rats learned a task on a maze with eight arms. In a study phase, four arms opened and held food. After a 4-minute break, all eight opened, and only the four new arms held food. Some rats were given **halorhodopsin**, a protein that silences nerve cells when light shines on them, delivered through thin optical fibres into the hippocampus. A 3D camera spotted rearing and switched the light on, only during the study phase.
>
> Each rat ran three kinds of trials, in mixed order.
>
> - Off: no light at all, to measure normal performance.
> - Rear: light on for exactly as long as each rear lasted.
> - Delay: the same amount of light, but switched on and off 6 seconds after each rear.
>
> In the six halorhodopsin rats, Rear trials cut correct first choices from **77.7% to 65.7%**. They also needed more arm visits to find all the food, 6.5 instead of 5.1. Delay trials did not differ significantly, though arm visits showed a borderline rise. Seven control rats, without halorhodopsin, were unaffected in every condition, so light or heat alone did not cause the drop.
>
> The authors note the delayed light still overlapped about 35.5% of rearing time. Nearly all rears involved leaning on a wall, so the study cannot compare leaning and free-standing rears. It also cannot say which part of the hippocampus matters, or whether the same learning could happen without rearing.
>
> The authors conclude that hippocampal activity during rearing is **important for spatial memory**. They suggest silencing may have blocked the rat updating its mental map with what it saw while standing up.

**Brief after** (87 words; before, it was about the same length with no bold):

> Rats often stand up on their hind legs to look around, a behavior called **rearing**. This study asked whether the hippocampus, a brain area needed to remember places, matters during those moments. Most past work only looked at the brain while rats walked or rested.
>
> In an experiment with rats, the scientists briefly switched off this brain area only while rats reared. Later, the rats remembered where food was less well: **about 66% correct instead of 78%**. So brain activity while rearing seems **important for remembering places**.

### Revealing the Dynamics of Neural Information Processing with Multivariate Information Decomposition (a review)

**Fuller before** (221 words):

> This review asks how groups of brain cells, or neurons, actually combine and transform information. It introduces a math tool called partial information decomposition, or PID, and shows how the authors and others have used it on recordings of real neurons.
>
> The authors call understanding how brains process information a grand challenge of neuroscience. New tools can now record hundreds or thousands of neurons at once, but researchers still need ways to pull clear insights from that flood of data.
>
> PID splits what several input neurons tell us about a target neuron into parts. Redundant information is what any one input could tell us, and unique information is what only one input tells us. Synergistic information appears only when inputs are seen together, so the authors treat it as a sign of real computation.
>
> In mouse brain tissue grown in a dish, tightly linked hubs called rich clubs had 2.7 times more synergy than other neuron groups. Groups with more links between the input neurons had up to 50% more synergy. In monkeys, redundancy rose sharply during reaching movements, perhaps to send the move signal reliably.
>
> The main conclusion is that neurons do not just add up their inputs; they seem sensitive to the patterns those inputs form. PID shows these patterns but does not explain the biology that causes them.

**Fuller after, as shipped** (412 words):

> This review introduces **partial information decomposition, or PID**, a tool for studying how neurons combine signals from several inputs. It explains the maths step by step, then shows what PID revealed in the authors' own recordings and related work.
>
> Brains turn sensory signals into useful behaviour, but how circuits transform that information is poorly understood. The authors name two obstacles: too little data and too few ways to analyse it. New tools now record hundreds or thousands of neurons, and PID is offered as a partial fix for the analysis problem.
>
> PID takes two input neurons feeding one target neuron and splits what they reveal about the target into parts. Redundant information is what either input alone could show; unique information comes from only one input. **Synergistic information** appears only when both inputs are seen together, so the target can be thought of as computing on them jointly.
>
> The authors grew thin slices of mouse cortex in dishes and recorded hundreds of neurons with 512-channel electrode arrays. They mapped links using transfer entropy, a measure of how much one neuron's past helps predict another's next step. Across thousands of two-source, one-target triads in 25 recordings, synergy was reliably **about a quarter** of a triad's transfer entropy.
>
> Synergy followed clear patterns in the network's wiring and activity.
>
> - Triads in the rich club, the best-connected neurons that link to each other more than chance predicts, had **2.7 times the synergy** of others.
> - Fewer than 40% of neurons were in the rich club, yet its triads held about 88% of all synergy.
> - Triads whose two sources linked to each other both ways had 50% more synergy; two feedback links from the target meant 10% less.
> - Synergy rose as the sources' spiking grew more alike, but peaked when their shared information was **about 7% of its maximum**, then fell.
>
> The authors warn that cultures are not living animals, and that their pairwise network measures can overstate links. Later work in three macaque monkeys doing a multi-step task repeated the rich club and the extra synergy in well-connected neurons. Activity was mostly synergistic, but **redundancy rose sharply during movement**, perhaps to send the move signal reliably.
>
> PID has its own limits: with six input neurons there are 7,828,354 parts, most hard to interpret. It also shows statistical patterns, not the biological causes behind them. Still, the authors conclude that neurons do not just add up inputs but **respond to their patterns**, shaped by network position and behaviour.

**Brief after** (92 words; before, it was about the same length with no bold):

> This review asks how groups of brain cells work together to handle information. How the brain turns what we sense into useful behavior is still poorly understood. The authors explain a math tool that splits up what several input cells tell one receiving cell.
>
> They focus on "**synergy**": information that only shows up in the pattern of several inputs together. In studies of mouse brain tissue, tightly linked hub groups of cells held **about 88%** of it. So brain cells seem to respond to input patterns, not just add up their inputs.

### The Scaling Hypothesis (an essay)

**Fuller before** (258 words):

> This essay asks what GPT-3 tells us about the future of AI. GPT-3 is a huge program from OpenAI, released in May 2020, that learned by predicting the next word in Internet text. The author defends the "scaling hypothesis": the idea that intelligence may come from simple learning methods made very large, with lots of data and computing power.
>
> GPT-3 was over ten times bigger than any earlier network, yet its gains did not level off as many expected. It also showed meta-learning: learning a new task from a few examples, though nobody built it to do that. The author says this means far bigger models are both possible and useful, at costs small by government or business standards.
>
> A key idea is the "blessings of scale": bigger networks often learn faster, more stably and more generally. The author's guess is that a big network holds countless small sub-models, and enough hard data pushes out lazy shortcuts like memorizing. He also argues that the last, hardest bits of prediction error need real reasoning, so better prediction may demand real understanding.
>
> He claims rival labs like Google Brain and DeepMind have the money and hardware but do not believe in scaling. He also faults experts who predicted failure, gave no testable numbers, and rarely admitted being wrong.
>
> His conclusion is that, depending on investment and how fast computing grows, the 2020s may bring either a plateau or explosive progress. An appendix adds a warning: "tool" AIs may become goal-seeking agents, and filtering their training data will not prevent it.

**Fuller after, as shipped** (372 words):

> This long essay by Gwern uses GPT-3, a text-predicting AI released by OpenAI in May 2020, to argue for **the scaling hypothesis**. That is the idea that simple neural networks keep getting smarter just by being made bigger and fed more data and computing power. New abilities then appear without anyone designing them in.
>
> GPT-3 was 117 times larger than GPT-2, with 175 billion parameters, the adjustable numbers a network learns. It showed **meta-learning**: picking up a new task, like anagrams or arithmetic, from a few examples in its prompt. Gwern says this matters because the gains did not level off, and GPT-3 was cheap by government or military budget standards. So models could be made far larger.
>
> The evidence is scaling curves: error falls smoothly and predictably as size and compute grow. Error is measured as bits per character, roughly how many yes-or-no guesses the model wastes per letter. GPT-2 scored **about 3.3**; GPT-3 roughly halved that to about 1.73. Gwern projects about 1.24 with 100 to 1000 times more compute, while humans reach about 0.7.
>
> Why would predicting text create intelligence? A model first learns letter frequencies, then words, then grammar and meaning. **The last bits of error are the deepest**: they need reasoning, common sense and understanding people. Small models take shortcuts like memorizing, but enough data makes memorizing too costly, so real rules, like arithmetic, win out.
>
> Gwern admits this argument once felt like a magic trick to him. It might have needed more text than exists, or a different design, or far bigger models. He knows of no one who predicted, in numbers, where these abilities would appear, and cannot say what bigger models will learn.
>
> He argues rival labs like DeepMind hold only a weak version, building brain-like parts one by one. OpenAI, he says, bet the company on scaling. He accuses expert critics of a calm voice of authority that never makes testable forecasts or admits error.
>
> His conclusion: once skeptical, he now says the scaling advocates were right, and Hans Moravec's old compute forecasts are holding up. An appendix warns that agency, acting toward goals, may emerge even from non-human data. So tool AIs may become agent AIs, and filtering data is no fix.

**Brief after** (109 words; before, it was about the same length with no bold):

> This essay is about GPT-3, a huge computer program that learned from text across the internet. The author argues for **the scaling hypothesis**: simple programs get smarter just by being made bigger. Bigger here means more parts, more data and more computer power.
>
> GPT-3 was over 100 times bigger than the earlier GPT-2, and it kept improving as predicted. It even **learned new tasks from just a few examples**, which nobody built into it.
>
> The author says this matters because much bigger programs are affordable, so human-like AI may come sooner than experts expect. He thinks most experts dismiss scaling and have no real way to predict AI progress.

### The longer one

**Fuller at about 500 words, not shipped** (464 words), the rat paper again:

> This is a lab experiment on rats about **rearing**, which means standing up on the hind legs to look around. It asks whether the hippocampus, a brain area long known to be needed for remembering places, has to be working during rearing for that memory to form.
>
> The authors say most research has studied the hippocampus while animals walk or rest, such as grooming or eating. Rearing is common but barely studied, even though it widens what an animal can see and smell and increases in new places. During rearing the hippocampus shows stronger "theta", a 7–12 beats-per-second brain rhythm tied to forming and recalling memories. So rearing might be a moment when place memories are formed, but nobody had tested this.
>
> Rats learned a task on a maze with eight arms radiating from a central hub. In a study phase, four random arms opened, each holding food; after a 4-minute break, all eight opened, but only the other four held food. Memory was scored two ways: how many of the rat's first four choices had food, and how many arm entries it took to find all the food.
>
> A virus made hippocampus cells carry **halorhodopsin**, a light-sensitive protein that silences cells when light shines on them; a 3D camera detected rearing, and light ran in three conditions during the study phase only.
>
> - Off: no light at all, giving each rat's normal performance.
> - Rear: light on for exactly as long as each rear lasted.
> - Delay: the same amount of light, but switched on and off 6 seconds after each rear.
>
> A control group got only a glowing marker protein, not halorhodopsin, to check whether light alone affected behaviour. In the main group, silencing during rearing cut correct choices **from 77.7% to 65.7%**. Those rats also needed more arm entries, 6.5 instead of 5.1, to find all the food. Control rats showed no real change on either measure.
>
> The Delay condition did not significantly lower correct choices (72.0%), and arm entries rose only to a borderline 5.9. The authors suggest the delay did not fully separate light from rearing: light still **overlapped about 35.5% of rearing time**.
>
> The groups were small, with six rats in the main group and seven controls. Almost every rear in the narrow maze had a paw on a wall, so the study cannot tell apart rears with and without support. It also cannot say whether every rear matters, or whether the same learning could happen during other look-around behaviours like head-scanning.
>
> The authors conclude that rearing is a moment when the hippocampus forms spatial memories. They suggest silencing may have blocked the rat from updating its inner map of its surroundings. Because the maze was familiar, that update was likely about today's open arms, like remembering where you parked today.
