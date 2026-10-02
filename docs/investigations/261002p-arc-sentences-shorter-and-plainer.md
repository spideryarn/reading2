# Arc sentences, shorter and plainer (`arc/5` → `arc/6`)

Up: [investigations.md](../project/investigations.md). For plan
[261002g](../plans/261002g-marginalia-head-in-plain-words-and-every-note-says-where-it-came-from.md) § 2.

> And in Annotations mode, that rail at the top that shows where you are - the language is too
> complex. Can you make it shorter and simpler.
>
> — Greg, 2026-10-01 (spya-g4yrew)

**Result: `arc/6` ships, with the fit criterion waived — my call, and the reason below.** Its
sentences run a median 17 words against 31–36, a blind judge found them plainer in 33 of 35 parts,
they are about as good as the old ones at saying where the argument stands (11 better, 13 worse, 11
even), and none misstated its part. **The fit criterion as declared failed**: it asked for ≥ 80% whole
in the head's *three* lines at 288px, and 7 of 35 (20%) were. I then raised the head's clamp to four
lines, where 25 of 35 (71%) fit in the judged arm and 31 of 35 (89%) in the shipped one — a
post-hoc change of measure, and two runs that straddle the bar. At the
column's narrowest none fits at either. And 10 of 35 went over the 20 words the prompt asks for.

**Why ship anyway.** The waived criterion compares against a bar the old prompt never came near (0–1
of 35 whole in three lines, 0–5 in four): every arc in production is cut mid-sentence today. The new
one is better on everything measured, cut less often and later, and complete in its card. Holding it
back for the fit bar would leave Greg with the sentence he complained about. A further round aimed at
fit (a 14-word ask, or enforcing the limit in `buildArc` and asking again) is named under § What is
still open; GPT Sol's code review raised the gap (F2), and this paragraph is the answer.

## What was wrong

Read from production (read-only): the head's part and section titles are already short ("Cats Don't
Talk › Scaling Up Brains"). The hard words are the arc's. Greg's article had:

> At stake is whether scaling a brain past ours would simply drown its workings in the computational
> irreducibility that concepts and language currently hold at bay, or whether the pockets of
> reducibility brains already exploit would keep such a mind within reach of description.

Across production's 41 arcs the median was 29–34 words at every prompt version; the shared plain-words
rule (`arc/4`) did not shorten them. And the head clamped the arc at three lines, so nearly every one
was also cut mid-sentence.

## Method

`evals/arc-length/run.ts`: production's `generateArc`, standard power, on five local articles (Greg's
*What If We Had Bigger Brains?*, *The Mythology of Conscious AI*, Gwern's *Scaling Hypothesis*,
*Antikythera mechanism*, *Cargo Cult Science*: 35 parts). The old prompt was run twice (`before`,
`before-2`) as the control. Each arm records its prompt version and a hash of `src/arc.ts`. Results
are in `evals/results/arc-length/`.

- **Length**: words per sentence, and an estimate of the lines it takes in the head: a greedy wrap at
  the head's text width in the AI face (13px IBM Plex Mono ≈ 7.8px a character; ≈33 characters a line
  at the column's 288px, ≈22 at its 200px minimum). An estimate, not a render.
- **Plainness, fidelity, usefulness**: an Opus subagent saw each part's old and new sentence as A/B in
  random order, with the part's title and gist, and judged which is plainer at a glance, whether either
  misstates the part, and which better says where the argument stands. It could not read the key.
  **Length gives the new sentence away**, so the blinding protects the fidelity call more than the
  plainness one.

Criteria, written into the plan before the first new arm was read: median ≤ 20 words; whole in the
head at 288px for ≥ 80% and at 200px for ≥ 50%; plainer in most parts; no more often wrong.

## Results

| arm | prompt | median words | p90 | over 20 | whole in 4 lines, 288px | in 3 lines, 288px | 200px |
|---|---|---|---|---|---|---|---|
| `before` | arc/5 | 31 | 41 | 31/35 | 5/35 | 1/35 | 0/35 |
| `before-2` | arc/5 | 36 | 44 | 34/35 | 0/35 | 0/35 | 0/35 |
| `after` | arc/6, first draft | 16 | 19 | 0/35 | 32/35 | 3/35 | 0/35 |
| `after-2` | arc/6, judged | 17 | 23 | 10/35 | 25/35 | 7/35 | 0/35 |
| `after-3` | **arc/6, shipped** (two phrases from `after-2`) | 18 | 21 | 6/35 | 31/35 | 6/35 | 1/35 |

`after-2` and `after-3` differ by two phrases and by six sentences on fit, which is mostly the spread
between two runs of nearly one prompt (the two runs of the old prompt differ by five) — read the fit
numbers as "about 70–90% whole in four lines at 288px", not as either figure.

Blind judgements, unblinded (each new arm against `before`):

| | plainer: new / old / even | says where the argument stands: new / old / even | wrong: new / old |
|---|---|---|---|
| `after` | 25 / 7 / 3 | **3 / 26 / 6** | 1 / 0 |
| `after-2` | 33 / 2 / 0 | 11 / 13 / 11 | 0 / 0 |

**The first draft failed, and that is the finding worth keeping.** Told only to be short and plain, the
model wrote short *gists*: what the part says rather than where the argument stands. The judge called
the old sentence better at the arc's own job in 26 of 35 parts, and one new sentence overstated its
part ("That lone bet now looks vindicated by hindsight…"). `after-2` added two rules: spend the words
on the relation (two halves around a semicolon: what is settled, what is still open), with a
bees example nowhere in the eval set, and never claim more than the article has shown so far. That
recovered the arc's job and removed the overstatement. It made the sentences a little longer.

**The second judge got one sharper instruction** ("judge the relational content, not the amount of
detail"), because the first had tended to credit length as relational. So the two "where the argument
stands" rows are not measured quite alike.

**A failure the eval caught on the way:** the first run of `after-2` died when the model returned 10
sentences for 9 parts. Most likely it split a two-halves sentence into two entries, and
`buildArc` refuses rather than guess, which in production fails the step. The prompt now says the two
halves are one string, the rerun had no refusal, and the eval records a refusal rather than crashing.
One clean run is not a rate.

Sample (*The Mythology of Conscious AI*, `after-2`):

> Before asking if machines can feel, the pull to believe they do turns out to be mostly bias, not
> evidence.

> With real machine consciousness left uncertain and probably unlikely, the sharper danger turns out
> to be machines that merely seem conscious.

## What changed with it

- **The head clamps the arc at four lines, not three.** The three-line clamp was set when the arc was in
  Geist. Since 261002f it is in the monospace AI face, about a third wider, so even a 16-word sentence
  is four lines at 288px.
- **Existing arcs are rewritten on their owner's next open** (`useArc`, `isArcOutdated`). Without that,
  none of the 41 production arcs, Greg's included, would ever see this prompt.

## What is still open

- At the column's narrowest (200px, a window about 900–1000px wide) no arc fits whole; four lines
  hold about 13 words there.
- **The next round, if fit matters more than it seems to**: ask for 14 words, or enforce the limit in
  `buildArc` and ask once more for an over-long sentence. Either needs a blind judge again, because
  the first draft showed that pushing for short is what turns an arc into a gist.
- **The judge's evidence** is in `evals/results/arc-length/judge/`: verdicts and keys for both runs,
  the pairs for the second, and the two scratch scripts that blinded and unblinded them (as `.txt`).
  The first run's pairs file was overwritten when the second was built; its key and verdicts survive.
- **The shipped prompt differs from `after-2` by two phrases**: GPT Sol's code review found the
  prompt both forbidding "next" and using it, so the example's "next, …" became "what is left is …"
  and the honest-words list lost "next". Re-measured for length only as `after-3`, not re-judged.
- The 20-word limit is prompt wording, not enforced: 10 of 35 went over, to a maximum of 25.
  `buildArc` checks only the count.
- Five articles, one run of each new arm: enough to see the first draft lose the arc's job and the
  second recover it, not to rank two close prompts.
