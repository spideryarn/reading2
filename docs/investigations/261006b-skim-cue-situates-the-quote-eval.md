# Skim: does a cue that sets the scene prepare the reader better, and what does it cost?

Written and run 2026-10-06 for
[plan 261006e § Stage 2](../plans/261006e-skim-cue-situates-the-quote-and-term-chips-use-the-glossary-card.md).
Up: [investigations.md](../project/investigations.md). The mode is [skim.md](../project/skim.md).

**Both rounds in one paragraph.** Round one made every cue set a scene (arm B), and tried the same
with each quote's paragraph in the prompt (arm C). Both prepared a reader far better than the old
cue and both paid for it: more findings given away (B) and more misstated context (B and C).
Round two (arm **B2**, the wording that ships) sets a scene only where the quote leans on something
unsaid, as a question or a naming of the options, and otherwise only points. Against the old cue a
blind judge preferred B2 in 50 pairs of 88 (old: 19, 19 ties), where two runs of the old prompt
split 31 to 35; it gives the finding away no more often (18 against 19) and misstates about as
rarely (3 against 1, control 3 against 2). On the 28 dangling quotes it is ahead 15 to 8, which is
better than the control's 11 to 10 but not by much. B2 gives up most of B's extra preparation (B
beat it head to head, 64 to 19) to get rid of B's faults. Arm C was removed from the code. The
route did not move in any arm. Spend: $0.86 in round one and $0.22 in round two.
[Round two](#round-two-b2-a-scene-only-where-the-quote-needs-one) is below; everything before it is
round one, left as written.

**Round one in one paragraph.** `skim/10` asks each cue to set the scene its quote assumes and then point at
what to look for. A blind judge found the new cue prepares a reader better in 72 pairs of 88
(old: 11), and in 24 of the 28 quotes whose own words lean on something unsaid (old: 1). Two runs
of the old prompt against each other split 31 to 35, so that is far outside noise. Giving the
model each quote's paragraph (arm C) is better again: 78 of 87 against the old prompt, and 53 to 27
against the new wording alone. **But both new arms pay for it.** The wording alone states the
passage's finding about twice as often as the old cue (33 pairs against 17, same judge), and both
new arms say something the text does not support in about one cue in ten, against about one in
forty before. With the paragraph, the giving-away is back at the old prompt's level; the
misstatements are not. The route itself did not move. Total spend $0.86.

## What was asked

Greg's report spya-jghnva:

> In Skim mode, when generating a question, use it as a way to contextualise the quote.
> For example, this question doesn't do that very well:
> "Which interpretation does their evidence favour, and how close to the training data does the test sit?"
> The quote then is something like "our results favour the latter interpretation..."
> The question we generate with Skim mode is an opportunity to situate the quote, eg it could tell us what's being asked of the evidence and/or what are the two interpretations?
>
> — Greg, 2026-10-06

The plan's bar: an improvement on the dangling-reference cases, with no regression on grounding or
on giving the finding away; and ship the paragraph (C) only if it beats the wording alone (B) on
those cases.

## How it was run

The method is [prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change).

| Arm | what it is | module SHA-256 (first 16) |
|---|---|---|
| **A1, A2** | `skim/9`, `src/skim.ts` as on `origin/dev` (b52465e00), run twice: the control pair | `b6fd198afced34bf` |
| **B** | `skim/10`: section 3 of the prompt rewritten, cue cap 200, same inputs | in each results file (`newModuleSha`) |
| **C** | B, plus after each quote its own paragraph (up to 1,200 characters, a window that ends at the quote when the paragraph is longer) and the last 500 characters of the paragraph before it, fenced as untrusted data and said to be only for writing the cue | the same file as B |

- **Production's own functions**, `skimInput` and `generateSkim`, through the gateway, Sonnet
  (`power: "standard"`), effort `low`, `profile: null`. C is `skimInput({ context: true })`, an
  option on the production function, not a copy. Nothing was written to any database.
- **Five articles, 88 offered quotes.** Greg's paper `2608-13566v1-spya-yurten` (33 quotes), read
  from production **read-only** into a scratch file by
  [`scripts/eval/skim-inputs-from-production.ts`](../../scripts/eval/skim-inputs-from-production.ts);
  and four from the local database: two papers `entropy-24-00930-spya-pywwkq` (20) and
  `arxiv-2010-spya-tkm7nm` (11), a long review `source-spya-furjgs` (13) and a talk
  `cargocult-spya-rz663q` (11). The local Ideas are from older Ideas prompts
  (`--allow-outdated-ideas`); every arm gets the same ones.
- **Pairs**: the same quote's cue under two arms. Every arm stopped at every offered quote, so
  every quote pairs. Sides by `blindCoin`, keys in their own files, balance checked before judging
  (41/47, 43/45, 41/46, 41/46).
- **The judge**: four fresh Opus subagents, one per comparison, each reading only its pairs file.
  Per pair it saw the quote, the quote's paragraph, the paragraph before it, and the two cues, and
  answered: (a) which cue better prepares a reader who has not read the article; (b) does either
  state what the passage found; (c) does either say something about the context the paragraphs do
  not support.
- **Dangling quotes** were marked by a rule over the quote's text alone, written into the script
  before any judging (`DANGLING` in
  [`scripts/eval/skim-cue-pairs.ts`](../../scripts/eval/skim-cue-pairs.ts)): the quote opens on a
  pronoun or demonstrative, says "the latter/the former/the above", or has "this/these/those/such"
  before a noun that is not the piece itself. 28 of 88 quotes. The rule is wide: some of the 28
  explain their own "this" a few words later.

```
cp src/skim.ts src/skim-v9-eval-tmp.ts        # before the edit; identical to origin/dev
npx tsx scripts/eval/skim-inputs-from-production.ts 2608-13566v1-spya-yurten <scratch>/s2-yurten.json
S="--allow-outdated-ideas --file=2608-13566v1-spya-yurten=<scratch>/s2-yurten.json 2608-13566v1-spya-yurten \
   entropy-24-00930-spya-pywwkq source-spya-furjgs arxiv-2010-spya-tkm7nm cargocult-spya-rz663q"
npx tsx scripts/eval/skim-coverage-eval.ts --runs=1 --old=src/skim-v9-eval-tmp.ts --old-version=skim/9 --new-version=skim/10 --tag=a1-b $S
npx tsx scripts/eval/skim-coverage-eval.ts --runs=1 --old-only --old=src/skim-v9-eval-tmp.ts --old-version=skim/9 --new-version=skim/10 --tag=a2 $S
npx tsx scripts/eval/skim-coverage-eval.ts --runs=1 --new-only --context --new-version=skim/10 --tag=c $S
rm src/skim-v9-eval-tmp.ts
npx tsx scripts/eval/skim-cue-pairs.ts --a1=…-a1-b.json --b=…-a1-b.json --a2=…-a2.json --c=…-c.json --out=evals/results/skim-cue-2026-10-06
```

## Results

### The blind read

Counts of pairs. "Gives away" and "misstates" count a cue each time the judge named it (a pair can
count for both sides).

| Comparison | pairs | (a) better prepared | (b) gives the finding away | (c) invents or misstates |
|---|---|---|---|---|
| **A1 v A2** (control) | 88 | A1 31 · A2 35 · tie 22 | A1 20 · A2 27 | A1 3 · A2 2 |
| **A1 v B** | 88 | A1 11 · **B 72** · tie 5 | A1 17 · **B 33** | A1 1 · **B 10** |
| **A2 v C** | 87 | A2 9 · **C 78** · tie 0 | A2 24 · C 26 | A2 3 · **C 9** |
| **B v C** | 87 | B 27 · **C 53** · tie 7 | B 29 · C 25 | B 9 · C 7 |

The 28 dangling quotes only:

| Comparison | pairs | (a) better prepared | (b) gives away | (c) misstates |
|---|---|---|---|---|
| A1 v A2 (control) | 28 | A1 11 · A2 10 · tie 7 | A1 8 · A2 10 | 0 · 0 |
| A1 v B | 28 | A1 1 · **B 24** · tie 3 | A1 7 · B 12 | A1 0 · B 1 |
| A2 v C | 27 | A2 3 · **C 24** · tie 0 | A2 10 · C 6 | A2 0 · C 1 |
| B v C | 27 | B 10 · C 14 · tie 3 | B 9 · C 5 | B 0 · C 2 |

Reading it against the control:

- **(a) is a real effect, for both new arms, everywhere.** 72 to 11 and 78 to 9 against a control
  of 31 to 35. On the dangling quotes, 24 to 1 and 24 to 3.
- **C over B is real overall (53 to 27) and not shown on the dangling quotes (14 to 10, 3 ties).**
  There is no B-against-B control, and 14 to 10 on 27 pairs is the size of the control's own split.
  So the plan's own test for C, "beats B on the dangling-reference cases", is **not met**.
- **(b): B gives the finding away more.** 33 against 17 from one judge, where the two control runs
  differ by 7 (20 and 27). C does not: 26 against 24. B against C directly is 29 to 25, inside noise,
  so "C leaks less than B" is not shown either; what is shown is that B is outside the control and
  C is inside it.
- **(c): both new arms misstate more**, 9 or 10 cues in 88 against 1 to 3. Almost all of it is on
  the quotes that do **not** dangle (B: 9 of its 10), where the cue adds a scene nobody needed.
- **The judge is strict on (b)**: it marks a fifth to a third of the *old* cues too. Treat the
  counts as relative.
- Each comparison had a different judge. The same arm scored within 3 or 4 of itself across two
  judges on (b) (A1 20 and 17, A2 27 and 24, B 33 and 29, C 26 and 25), so the judges agree about
  as well as two runs do.

### Cheap screens

| Arm | stops | null cues | length: median · mean · max | over 140 | over 200 | start "Look for" | ask a question | cost, 5 routes | input tokens / route |
|---|---|---|---|---|---|---|---|---|---|
| A1 `skim/9` | 88 | 0 | 79 · 78 · 99 | 0 | 0 | 25% | 20% | $0.160 | 8,869 |
| A2 `skim/9` | 88 | 0 | 83 · 82 · 103 | 0 | 0 | 17% | 25% | $0.186 | 8,869 |
| B `skim/10` | 88 | 0 | 131 · 131 · 184 | 22 | 0 | 2% | 25% | $0.218 | 9,505 |
| C `skim/10` + passages | 88 | 1 | 136 · 141 · 198 | 37 | 0 | 0% | 11% | $0.298 | 17,779 |

- **The cap had to move.** A quarter of B's cues and two in five of C's are over 140; at the old
  cap they would have been nulled. One C cue went over 200 and was nulled.
- New cues are about 65% longer. "Look for" has all but gone as an opener.
- C asks fewer questions (11%) and opens on a statement more.

### Did the route move? (Sol F7)

Every arm stops at all 88 offered quotes, and first-placed pass sizes are identical in four
articles of five (the fifth differs between the two control runs too). Of the shared quotes:

| | A1 v A2 (control) | A1 v B | A2 v B | A1 v C | A2 v C | B v C |
|---|---|---|---|---|---|---|
| same depth | 82% | 81% | 80% | 76% | 83% | 78% |
| same `again` | 83% | 82% | 81% | 78% | 83% | 80% |
| same relative order | 88% | 84% | 94% | 88% | 96% | 92% |

Every treatment figure sits beside the control's. **The cue change did not move the route**, with
or without the passages. Per article it is in `evals/results/skim-cue-2026-10-06-screens.md`.

## Examples

Old is A1. Chosen to show the range, the worst included.

1. **Greg's quote.** *"Our evidence supports the latter interpretation: post-training gains on
   SWE-bench do not consistently transfer to other code tasks, even within the same repository."*
   - Old: Notice whether gains from SWE-bench training carried over to other tasks in the same codebase.
   - B: Two readings are possible for why post-training raises scores: real general gains, or narrow specialization. Which one the evidence favours.
   - C: Two readings of post-training gains are possible: broad skill improvement, or narrow benchmark specialization. See which their Django evidence favours.
   - B found the two readings without the paragraph, from the Ideas. Its last sentence is not a sentence.
2. **Where the paragraph is what answers it.** *"It is very dangerous to have such a policy in
   teaching—to teach students only how to get certain results…"*
   - Old: Consider the danger of teaching students to get a result rather than to run a fair test.
   - B: If students are trained only to produce a particular result, what quality in their work suffers, and why is this risky to teach?
   - C: A parapsychology institute planned to train only students who already got the results it wanted. Look at what Feynman says this policy teaches instead of science.
   - Only C can say what "such a policy" was.
3. **B gives it away.** *"These results support our claim: reasonable fine-tuning with within-task
   evaluation … may mislead practitioners into perceiving a 'capability jump'…"*
   - Old: Ask what kind of 'capability jump' might be an illusion here.
   - B: Easy, within-task testing can make a narrow fine-tune look like a big leap. See what they say this risks misleading practitioners into believing.
   - C: Consider why judging a fine-tuned model only on the task it was tuned for could give a misleading sense of its overall improvement.
   - B's first sentence is the finding. This is the usual shape of a B giveaway: the scene is the quote, restated as a fact.
4. **Both new arms misstate, the same way.** *"Across the 28 out-of-domain checkpoint–benchmark
   comparisons … 18 degradations versus ten improvements."*
   - Old: Count how many of the out-of-domain comparisons improved versus got worse.
   - B: Public checkpoints tuned for SWE-bench were tested on other benchmarks from the same project. Note the ratio of gains to losses.
   - C: Checkpoints tuned to boost one benchmark are checked on nearby tasks from the same codebase. Note the balance of gains versus losses.
   - One of the four benchmarks is not from that codebase. The paragraph did not stop C saying so.
5. **A scene invented from nothing.** *"Uman and colleagues call what was produced not ball
   lightning but point to interesting effects of different materials under the influence of lightning."*
   - Old: Notice what distinction researchers draw between their experimental result and the real phenomenon.
   - B: A modern experimental team produced striking effects in the lab. See what they themselves say those effects do, and do not, demonstrate.
   - C: Researchers triggered lightning into various materials to try to reproduce ball lightning. See how they themselves classify what they actually made.
   - It was a field experiment. "In the lab" is B's guess; the control run A2 made the same guess ("a lab-produced effect").
6. **C gets the paragraph wrong.** *"These results show not only that synergistic information
   dynamics is a feature of ongoing, spontaneous neural activity but also that synergy seems to
   reflect behaviorally specific patterns…"*
   - Old: What does this say about synergy appearing even without a task being performed?
   - B: Beyond showing synergy exists at rest, what further claim do the authors draw about its relation to specific behaviors?
   - C: Beyond showing synergy exists during behavior, see what further claim is made about what the pattern of synergy actually tracks.
   - C says the opposite of the quote.
7. **C leans on what the reader has not seen.** *"Interestingly, synergy only increased up to a
   point. The peak in synergy occurred when the mutual information was about 7% of the maximal value…"*
   - Old: At what point does rising similarity between sources stop increasing synergy?
   - B: The relationship between input similarity and joint computation is not simply increasing. Look for where exactly it turns around.
   - C: The same similarity-synergy relationship is now tested over much longer timescales. Does synergy keep climbing, or does something else happen past a certain point?
   - "The same … is now tested" assumes the paragraph before. The old cue is the best of the three; B gives the turn away.
8. **A mangled cue and a lost one.** *"If the left-hand side of Equation (4) (the 'whole') is
   greater than the right-hand side (the sum of the 'parts')…"*
   - Old: Look for how the whole being greater or less than the sum of parts is interpreted.
   - B: A neuron's output can either repeat what each input already said or reveal something new only visible when inputs are combined. Watch how the piece names these two cases.?
   - C: (none: its cue was over 200 characters and was nulled)

## What reading them shows that the numbers do not

- **The new cue is two sentences: a statement, then a pointer.** The statement is where everything
  good and bad happens. When the quote dangles it supplies the referent. When the quote already
  stands on its own, the statement is the quote said first in plainer words, which is the giveaway,
  or a detail added for colour ("automated", "in the lab", "spent years"), which is the misstatement.
  The prompt says a short cue is fine when the quote says what it is about; the model almost never
  took that option (2% of B's cues open "Look for", against 17 to 25%).
- **Many old cues were already good.** On the 60 quotes that do not dangle, the old cue is often the
  cleanest of the three: one question, nothing given away.
- **B found most scenes without the paragraph**, from the Ideas and the outline. Greg's own example
  is one. C's clear wins are the cases like example 2, where the referent is a concrete thing only
  the paragraph names.
- **C brings a new fault**: cues that speak as if the reader had just read the paragraph before
  ("the praise just given", "the measure just described", "is now tested"). A word-list count finds
  0 and 1 in the old arms, 2 in B and 4 in C; the list was written after seeing them, so it is a
  count of what was noticed.
- A few B cues end on a fragment ("Which one the evidence favours.") and one ends ".?".

## What this does not show

- **No person has read these.** The judge is a model of the same family as the writer.
- **One run of B and one of C.** Run-to-run spread is known for the old prompt only.
- **(b) and (c) rest on one judge per comparison**, and the same arm moved by 3 or 4 between judges.
  B's extra giveaways (33 v 17) and both arms' extra misstatements (about 10 v 2) are larger than
  that; C against B on either is not.
- **Five articles, four of them academic.** One essay-like talk. No reader profile.
- **Whether C beats B where it was meant to** (the dangling quotes) is not shown.
- **Nothing about the reader's experience of a longer cue** in the band or the door; only that it
  is longer.
- The dangling rule is a regex. It was not checked against a hand marking.

## Cost

OpenRouter `limit_remaining`: **$14.609** before the first call, **$13.693** after the last, a drop
of $0.916. The three runs' own totals are $0.379 + $0.186 + $0.298 = **$0.863** for 20 calls; the
rest was spent by something else on the same key in those minutes (not traced). The judging cost
nothing on OpenRouter.

Per route, on these five: old about $0.035, B $0.044 (+26%), C $0.060 (+72% on old, +36% on B).
C's input is 87% larger than B's.

## Recommendation

Against the plan's bar, **neither arm passes as it stands**: both do what Greg asked, by a wide
margin, and both misstate the context more often than the old cue did; B also gives the finding
away more.

Between the three choices:

- **Ship neither** is too strong. The gain on (a) is the largest effect this harness has measured,
  and the old cue fails exactly as Greg described on 24 dangling quotes of 28.
- **Ship C** only buys what was not shown: it does not beat B on the dangling quotes, it costs a
  third more per route, it loosens "the model never sees the prose", and it misstates as often as B.
  What it does buy is giveaways back at the old level.
- **Ship B, after one more wording round** is what the evidence points to. Both faults come from
  one habit, the statement that restates the quote, and both sit mostly on quotes that needed no
  scene. A round that (i) makes the scene a question or a bare naming of the options, never a
  statement of what the passage says, (ii) says outright that a quote which stands on its own gets
  the pointing half alone, and (iii) forbids any detail not in the records, would be about $0.25
  for B alone against these same A1 and A2 runs. This run stopped at the $1 it was given.

If it has to be one of the three today: **B**, by the plan's own rule (C did not beat it on the
dangling cases), knowing it gives the finding away in roughly one cue in three where the old
prompt did in one in five. The option on `skimInput` for C stays in the code, off, and costs nothing.

## Round two: B2, a scene only where the quote needs one

Run the same morning, on the round-one recommendation. One paid run; A1, A2 and B are the stored
round-one runs, not re-run.

**What changed in the prompt** (§ 3 only; cap 200, `skim/10`, `plainWords("ask")` and the "this
section wins" paragraph kept):

1. *Most quotes stand on their own, and their cue only points.* Said first, called the common
   case, with examples, and with "do not put a sentence in front that says the quote's point first
   in your own words".
2. *Some quotes lean on words they do not explain, and their cue sets the scene first*, as a
   question or a bare naming of the options. "It is never a statement of what the passage says,
   shows or argues."
3. *Only what the records say*: no added place, date, method, size or motive, and no sharpening
   ("never" for "rarely").
4. *Write whole sentences*: one or two, no fragment, no ".?".

The examples in the prompt are invented or from another field, not taken from the five articles.
B2 is `src/skim.ts` at SHA-256 `3987d5b6e7ca598d`, with arm C already removed, so the file
measured is the file that ships.

```
npx tsx scripts/eval/skim-coverage-eval.ts --runs=1 --new-only --new-version=skim/10 --tag=b2 $S
npx tsx scripts/eval/skim-cue-pairs.ts --a1=…-a1-b.json --b=…-a1-b.json --a2=…-a2.json --c=…-c.json \
  --b2=…-b2.json --out=evals/results/skim-cue-2026-10-06
```

Two more fresh Opus judges, the same three questions, the same dangling rule and coin. Key
balance: 42/46 and 42/46. Re-running the pairs script left the round-one pairs and keys
byte-identical (checked by checksum).

### The blind read

| Comparison | pairs | (a) better prepared | (b) gives the finding away | (c) invents or misstates |
|---|---|---|---|---|
| A1 v A2 (control, round one) | 88 | A1 31 · A2 35 · tie 22 | A1 20 · A2 27 | A1 3 · A2 2 |
| A1 v B (round one) | 88 | A1 11 · B 72 · tie 5 | A1 17 · B 33 | A1 1 · B 10 |
| **A1 v B2** | 88 | A1 19 · **B2 50** · tie 19 | A1 19 · B2 18 | A1 1 · B2 3 |
| **B v B2** | 88 | **B 64** · B2 19 · tie 5 | B 30 · **B2 15** | B 10 · **B2 4** |

The 28 dangling quotes:

| Comparison | (a) better prepared | (b) gives away | (c) misstates |
|---|---|---|---|
| A1 v A2 (control) | A1 11 · A2 10 · tie 7 | 8 · 10 | 0 · 0 |
| A1 v B | A1 1 · B 24 · tie 3 | 7 · 12 | 0 · 1 |
| **A1 v B2** | A1 8 · **B2 15** · tie 5 | A1 7 · B2 3 | A1 0 · B2 1 |
| **B v B2** | **B 22** · B2 4 · tie 2 | B 12 · B2 5 | B 2 · B2 2 |

- **Better prepared, overall: yes.** 50 to 19 against a control of 31 to 35.
- **Better prepared, dangling: ahead, not clearly.** 15 to 8 with 5 ties, against the control's 11
  to 10 with 7. Half of the 28 "dangling" quotes explain their own "this" (the rule is a regex),
  and on those B2 writes what the old prompt wrote, often word for word.
- **Giving away: fixed.** 18 against A1's 19 from the same judge, and half of B's (15 against 30).
- **Misstating: back inside the control.** 3 against 1, where the two control runs were 3 and 2;
  4 against B's 10.
- **The price is plain in B v B2**: a judge asked only "which prepares better" picks B's fuller
  scene 64 to 19. B2 is the old cue's restraint with a scene where one is needed, not B with the
  faults sanded off.

### Screens and route

| Arm | null cues | length: median · mean · max | over 140 | over 200 | start "Look for" | ask a question | lean on elsewhere | cost, 5 routes | input / route | output / route |
|---|---|---|---|---|---|---|---|---|---|---|
| A1 | 0 | 79 · 78 · 99 | 0 | 0 | 25% | 20% | 0 | $0.160 | 8,869 | 1,433 |
| B | 0 | 131 · 131 · 184 | 22 | 0 | 2% | 25% | 2 | $0.218 | 9,505 | 2,464 |
| **B2** | 0 | 94 · 95 · 155 | 1 | 0 | 7% | 23% | 0 | $0.224 | 9,898 | 2,493 |

B2's cues are a fifth longer than the old ones, not two thirds. One of 88 is over 140, so the
cap of 200 is now headroom, not a need; it stays, because a nulled cue is worse than a long one.
B2 costs about what B did ($0.045 a route against the old $0.035): the prompt is longer and the
model thinks more.

| Route, shared quotes | A1 v A2 (control) | A1 v B2 | A2 v B2 | B v B2 |
|---|---|---|---|---|
| stops on both | 100% | 100% | 100% | 100% |
| same depth | 82% | 83% | 81% | 78% |
| same `again` | 83% | 84% | 83% | 82% |
| same relative order | 88% | 83% | 94% | 95% |

Beside the control throughout. **B2 did not move the route.**

### Examples

1. **Greg's quote** (*"Our evidence supports the latter interpretation…"*)
   - Old: Notice whether gains from SWE-bench training carried over to other tasks in the same codebase.
   - B: Two readings are possible for why post-training raises scores: real general gains, or narrow specialization. Which one the evidence favours.
   - B2: Which of the two possibilities does the evidence favor: real transfer or benchmark-specific gains?
2. **The scene as a question** (*"…if post-training on SWE-bench trajectories reliably improves general coding capabilities, this approach provides a path… But if it just produces models skilled at SWE-bench-like tasks…"*)
   - B2: Two possibilities are weighed here: does training build general skill, or just skill at one benchmark? Notice what is at stake either way.
3. **Where B gave it away and B2 does not** (*"These results support our claim: … may mislead practitioners into perceiving a 'capability jump'…"*)
   - B: Easy, within-task testing can make a narrow fine-tune look like a big leap. See what they say this risks misleading practitioners into believing.
   - B2: Consider what fine-tuning with only within-task evaluation might make practitioners wrongly believe.
4. **Where B invented and B2 does not** (*"Uman and colleagues call what was produced not ball lightning…"*)
   - B: A modern experimental team produced striking effects in the lab. See what they themselves say those effects do, and do not, demonstrate.
   - B2: Look for how experimenters judged whether their produced effect truly matched the phenomenon.

The worst of B2:

5. **A referent still left hanging, and a detail added** (*"It is very dangerous to have such a policy in teaching…"*)
   - B2: Consider what gets taught to students when only the result, not the method, is graded.
   - Nothing says what "such a policy" was, which only the paragraph could; and "graded" is not in the text.
6. **The opposite of the quote** (*"…you must not fool yourself—and you are the easiest person to fool."*)
   - B2: Who, according to this, is the hardest person for a scientist to deceive?
   - The old prompt's A1 made the same slip ("hardest to deceive").
7. **A pointer that leans on the quote's own unexplained words** (*"7B (52.9% → 5.8% OK): the largest flow is OK → NOT_RUN (113 examples)."*)
   - B2: Notice which direction of change was most common for this model size.
   - This is Greg's complaint in miniature, on a quote the prompt cannot situate from what it is given.

### What reading them shows

- B2 reads like the old prompt on most stops. 11 of its 88 cues are two sentences, a scene and a pointer; the rest are a pointer alone.
- Where a quote names its own two options, B2 now says them (example 1). Where the referent is
  only in the paragraph (examples 5 and 7), nothing in B2 can supply it. That was arm C's job, and
  C did not do it reliably enough to keep.
- No fragments and no ".?" in 88 cues.

### Arm C was removed

The option that handed the prompt each quote's own paragraph (`QUOTE_CONTEXT_DEFAULT`,
`SKIM_SYSTEM_WITH_CONTEXT`, the context fields on `SkimInput` and `QuoteRecord`, the `PASSAGE
AROUND` record, its branch of the hash, its tests, and the harness's `--context` flag) is gone from
the tree. It did not beat the wording alone where it was meant to (14 to 10 on the dangling
quotes), it misstated as often, it cost a third more per route, and an off switch nobody uses is
machinery to keep working. **Its code is commit `c943494a9`**, where B and C are exactly as
measured in round one. The default input hash never moved (`tests/skim.test.ts` pins the literal),
and one test now holds the opposite property: a paragraph that changes outside its quote's words
changes neither the prompt nor the hash.

### Still not shown, after both rounds

- **No person has read these.** Writer and judge are the same model family.
- **One run of B2.** Its run-to-run spread is unknown; the control's is the only one measured.
- **B2 on the truly dangling quotes.** 15 to 8 is on a regex's idea of dangling. A hand-marked set
  of quotes whose referent is outside the quote would say whether B2 helps exactly there; examples
  5 and 7 suggest it often cannot, because the prompt is not given the paragraph.
- **Whether the paragraph would help under B2's rules.** C was measured with round one's wording
  only. "A scene as a question, nothing added" plus the paragraph was never run.
- **(b) and (c) still rest on one judge per comparison**, each a different subagent.
- Five articles, four academic; no reader profile; nothing about how a cue reads in the band.

### Cost, round two

OpenRouter `limit_remaining`: **$13.693** before, **$13.577** straight after the run, and
**$13.353** a few minutes later once judging was done. The run's own total is **$0.224** for 5
calls. The key's figure lags and other sessions spend on it, so the three readings do not add up
to the run; the script's own total is the one to trust.

### Recommendation, round two

**Ship B2.** It clearly beats the old cue overall, it is inside the control on giving the finding
away and on misstating, and it fixes Greg's own example. The one part of the bar it does not
clearly clear is the dangling subset (15 to 8, 5 ties). The next thing worth trying, if readers
still meet cues like example 7, is the paragraph again under B2's rules; not now.

## Files

- `evals/results/skim-coverage-2026-10-06T06-35-03-a1-b.json` (A1 and B),
  `…T06-36-39-a2.json` (A2), `…T06-36-40-c.json` (C), `…T06-53-56-b2.json` (B2);
- `evals/results/skim-cue-2026-10-06-screens.md`, `-dangling.json`, and for each of `s1` (A1 v A2),
  `s2` (A1 v B), `s3` (A2 v C), `s4` (B v C), `s5` (A1 v B2), `s6` (B v B2): `-pairs-sN.md`,
  `-key-sN.json`, `-judgment-sN.json`.
- Scripts: [`skim-coverage-eval.ts`](../../scripts/eval/skim-coverage-eval.ts) (gained
  `--old-only`, `--file=`, `--tag=`; `--context` came and went with arm C),
  [`skim-cue-pairs.ts`](../../scripts/eval/skim-cue-pairs.ts),
  [`skim-inputs-from-production.ts`](../../scripts/eval/skim-inputs-from-production.ts).
