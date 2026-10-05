# Fuller, written for someone who has not read the piece: the before/after prompt eval

Up: [investigations.md](../project/investigations.md)

Run on 2026-10-05 for
[plan 261005h](../plans/261005h-fuller-summary-written-for-someone-who-has-not-read-the-piece.md),
a report from Greg:

> The brief summary is quite good, but the fuller summary often is hard for me to understand. And I
> think it's because, I mean, it's fine that it uses some jargon from the article, but you have to
> write it as if it's for someone who has not yet read the article. So I guess if you're going to
> use jargon, you have to define it.
>
> Realty though they key principle is to write the fuller summary for someone who hasn't read it yet
> rather than for someone who has.
>
> — Greg, 2026-10-05 (`spya-rntjxu`)

## What was decided, in one paragraph

Fuller's prompt gains two bullets and a paragraph (`simple-prompt/10`): a name the piece
introduces is a term and is said in everyday words where it first appears; nothing is referred to
before the summary has introduced it; and the reader's stated background does not cover a term
merely because it claims the piece's field. **A larger change was built first and is not what
shipped**: a whole section, "Written for someone who has not read the piece", with eight bullets
and a closing check. For a reader with a profile, which is the reader the report came from, the
section passed both tests declared beforehand (preferred in 9 pairs of 10; the places a reader
could not follow down from 1.3 a summary to 0.6). But the plan had also declared that if the two
bullets did as well as the section, the two bullets would ship, and set directly against each
other they split 5 pairs to 5 with the same count. So the two bullets shipped. **For a reader
with no profile no improvement is claimed for either.**

## What was asked

Declared in the plan before any summary was written:

1. Can a reader who has not read the piece follow the new Fuller better than the old one?
2. Does the new one lose a main finding, bend a claim, or stop to explain what the reader said
   they know?
3. Does it run over its length, or fail to write?
4. Does the simpler change, two bullets, do as well as the whole section?

## How

`evals/simple/probe.ts` calls production's `generateSimpleSummary`, on Opus with the fidelity guard
on, as a press does. `evals/simple/new-reader.ts` reads its result files and calls no model. The
three judges' briefs are [`evals/simple/new-reader-judges.md`](../../evals/simple/new-reader-judges.md),
and each went word for word to a fresh subagent told nothing else.

**Five local pieces**, picked because each coins names of its own, all in the `standard` length
band (asked for about 500 words, never more than 600):

| piece | slug |
|---|---|
| the Vision Transformer paper | `arxiv-2010-spya-tkm7nm` |
| an information-decomposition paper | `entropy-24-00930-spya-pywwkq` |
| *A Matched Filter Hypothesis for Cognitive Control* | `fd-src-nihms-536461-spya-nr87dn-spya-en7r25` |
| the hippocampus-and-rearing paper | `s41598-023-33209-9-spya-s0qydm` |
| Levin's *Self-Improvising Memory* | `levin-self-improvising-memory-spya-gj60pu` |

**The article the report was filed from is not among them.** It is only in production, which a
session cannot read. That is the main limit on what follows.

**Two readers.** `about`, from `evals/simple/readers.json`: a synthetic technical reader shaped
like the admin's own profile ("CTO of a small software company. Background in cognitive science
and machine learning…"). And `none`: no profile.

**Three prompts, separated in time and not in code.** `src/simple-summary.ts` was swapped for the
length of each run, and each result file records a hash of that file and of the system prompts it
sent; `new-reader.ts table` refuses two prompts under one hash.

| prompt | arms (`evals/results/simple/high-<arm>/`) | source sha | prompts sha |
|---|---|---|---|
| **old**, `simple-prompt/9`, the file at `d1eec9994` | `about-new0a`, `about-new0b`, `none-new0a`, `none-new0b` | `ea4e45d2` | `0653f349` |
| **new**, the section and the paragraph ([its text](../plans/261005h-fuller-summary-written-for-someone-who-has-not-read-the-piece.md#the-section-that-was-built-first-and-not-shipped)) | `about-new1a`, `about-new1b`, `none-new1a`, `none-new1b` | `4d23cf8f` | `2ef1eb6f` |
| **two bullets**, which is what shipped: the section cut to its first and fifth bullets, no heading, no opening paragraph, no closing check; the paragraph after the profile rules kept | `about-new2a`, `about-new2b`, `none-new2a` | `8d2804f6` | `c5fa0839` |

**In every table below, "new" is the section**, the larger change, which is not what shipped;
"two bullets" is what shipped.

Fifty-five writes, $9.61. None failed, and the fidelity guard passed every Fuller (four on a
second try: one old, one new, two of the two-bullet arm).

**Three rounds.** Round one is the plan's. It left two things open, so rounds two and three were
added after it was scored, and that order matters when reading them: they were chosen knowing
round one's answer.

- **Round one**: the profiled reader, old against new twice over; one no-profile draw of each;
  one draw of the two-bullet arm. Audit, pairs, and the check against the piece.
- **Round two**: the reader with no profile. A second old draw (the control round one lacked), a
  second draw of the new prompt, the two-bullet arm; and a second profiled two-bullet draw.
  Audit, pairs, and the check against the piece.
- **Round three**: no new writes. The two-bullet arm against the old prompt for the profiled
  reader, which the first two rounds had only inferred. Pairs only.

**Three kinds of judge.**

- **The audit.** Each Fuller alone, under a random id, for a judge that has not read the pieces:
  list every place you could not follow from the summary alone. The score is the count.
- **The pairs.** Same piece, same reader, two summaries, sides from the tested `blindCoin`:
  which could you follow more easily, which tells you more, is either padded, does either talk
  down, which would you rather have.
- **Against the piece.** One judge a piece, given the piece in full and every Fuller of it,
  shuffled: a main finding omitted, a claim bent, or something the profiled reader already knows
  explained.

Sides were checked before any judge read a pair. Round two's first seed put two kinds of pair on
one side four times in five; the seed was changed, before judging, to the first that gave three
to two or better in every kind.

## Results

### 1. The profiled reader: the section passes both declared tests

**Audit, places a reader could not follow, per Fuller** (round one):

| piece | old a | old b | new a | new b | two bullets a |
|---|---:|---:|---:|---:|---:|
| Vision Transformer | 1 | 2 | 0 | 0 | 1 |
| information decomposition | 1 | 1 | 0 | 0 | 1 |
| matched filter | 2 | 3 | 2 | 1 | 1 |
| hippocampus | 0 | 0 | 1 | 0 | 0 |
| Levin | 1 | 2 | 2 | 0 | 0 |
| **mean** | 1.0 | 1.6 | 1.0 | 0.2 | 0.6 |

Old mean 1.3, new mean 0.6: a drop of 0.7, against 0.6 between the two old draws. **It passes,
narrowly**, and the two new draws differ from each other (1.0 and 0.2) by more than the two old
ones do. The counts are small to begin with: on these five pieces the old prompt's fault is real
and mild, one or two places a summary.

**Pairs, old against new** (round one, ten pairs):

| | new | old | same |
|---|---:|---:|---:|
| easier to follow | 6 | 0 | 4 |
| tells you more | 4 | 1 | 5 |
| would rather have | **9** | 1 | – |

Padded: neither, in all ten. Talks down: one summary each way. **9 of 10 against a bar of 7.**
The control, old against old, split 4 to 1 for one draw over the other, so a single pair says
little; nine of ten is outside that.

The one pair the old summary won, and the one place the new prompt was marked for talking down,
are the same thing: the new Vision Transformer summary told a reader who builds on language
models that a Transformer is "the architecture behind today's language models". The judge
against the piece, which had the reader's list of what they know, did not count it (no `known`
fault in any of the 20 new and two-bullet summaries written for that reader). It is one clause, and it is the direction the new
paragraph could over-reach in.

### 2. Nothing the old prompt kept was lost

**Against the piece**, both rounds: 25 judgments each of old and new, covering 20 distinct
summaries in each (five `none-new0a` and five `none-new1a` were judged in both rounds); 15
judgments of 15 two-bullet summaries:

| | old | new | two bullets (15) |
|---|---:|---:|---:|
| main finding omitted | 9 | 5 | 1 |
| claim bent or blurred | 6 | 2 | 3 |
| explained what the reader knows | 0 | 0 | 0 |

**Every omission in a new summary is one an old summary of the same piece also made**: the
hybrid models' result (Vision Transformer), the unsettled choice of redundancy measure
(information decomposition), the two competing learning systems (matched filter), polycomputing
(Levin). So the plan's test, "no major omission or distortion that the old prompt's summaries of
the same piece do not also have", holds for omissions. Of the two bent claims in new summaries,
one ("no one had tested whether rearing matters") is in the old summaries word for word. **The
other is new**: a summary saying ViT overtook ResNets "only with JFT-300M" where the paper says
"with the larger datasets". No old summary said that, though one got the same comparison wrong
in a different way. It was judged too small to fail the test, and that is a judgement, not a
clean pass. Nothing was disputed enough to send to a second judge.

The two-bullet arm's four faults: one omission an old summary of the same piece also made (the
hybrid models), and three bent claims of its own. It says ViT and ResNets "roughly match" on
ImageNet-21k, where the paper says that of two sizes of ViT. It says mutual information tracks
"how activity spreads between two neurons", where the paper says it is undirected. And it has
brain extract "injected near a trained sea slug's nerves", where the extract came from trained
animals and went into untrained ones. Three in fifteen, against six in twenty-five for the old
prompt: not a difference these counts can show, and not nothing.

The numbers favour the new prompt, and that is not claimed as an effect: the judges were five
different subagents each round, and the same summary judged twice (`none-new0a`, in both rounds)
was given a different list each time.

### 3. Length: a little longer, four of twenty over the ask

| prompt | Fuller words, range | mean | over 600 | median wait to Fuller |
|---|---|---:|---:|---|
| old (20 writes) | 454–581 | 515 | 0 | 32–53 s |
| new (20 writes) | 473–633 | 557 | 4 | 35–52 s |
| two bullets (15 writes) | 486–596 | 537 | 0 | 37–64 s |

The section writes about 40 words more, and four of its twenty Fullers went past the "never
more than 600" it is asked for: 607, 615, 620 and 633. None is near the stored limit of 1,400,
so no write can fail on it. The section tells the model to "stay inside the length below", and
on this evidence it mostly does and sometimes does not. No judge called any new-prompt summary padded, in the
35 pairs it was one side of. Brief was written by all three prompts at 84 to 125 words; its prompt
is the same bytes.

### 4. Two bullets or the section: they tie, so the two bullets ship

The plan said, before anything was written: *if the two-bullet change does as well as the
section, the two bullets ship and the section does not.*

**Set directly against each other**, same piece, same reader:

| reader | prefer two bullets | prefer the section |
|---|---:|---:|
| with a profile (ten pairs, rounds one and two) | 5 | 5 |
| with no profile (five pairs, round two) | 4 | 1 |

**Audit, places that could not be followed**, for the profiled reader: two bullets 0.6 and 0.8
(two draws, two judges); the section 0.6.

**Length**: none of the fifteen two-bullet Fullers went past 600 words; four of the section's
twenty did.

That is "as well", so the two bullets ship.

**One comparison goes the other way, and it does not overturn that.** Round three set the
two-bullet arm against the *old* prompt for the profiled reader:

| | two bullets | old | same |
|---|---:|---:|---:|
| easier to follow | 6 | 1 | 3 |
| tells you more | 4 | 6 | – |
| would rather have | 6 | 4 | – |

The section, against the old prompt, was preferred in 9 of 10. So measured against the old
prompt the section looks stronger, and the first draft of this write-up shipped the section on
that. GPT Sol's review of the conclusion (R1) called it what it was: a rescue of the version
already built. No bar against the old prompt was declared for choosing between the two; round
three was designed after the direct tie was known; and the two comparisons with the old prompt
were different rounds and different judges. The declared rule was the direct comparison, and the
direct comparison is a tie.

What round three does show is that the two bullets are as much easier to follow as the section
was (6 to 1, against the section's 6 to 0), which is what the report asked for, and that the
judge more often found the old summary told it more. **So the improvement that shipped is
followability, on a preference of 6 pairs in 10, which is not on its own outside what a control
does.** The 9 of 10 belongs to a prompt that is not in the source.

### 5. The reader with no profile: mixed; no improvement claimed

**Audit** (round two, one judge for all 30):

| | old a | old b | section a | section b | two bullets a |
|---|---:|---:|---:|---:|---:|
| **mean** | 3.0 | 2.4 | 2.0 | 1.0 | 3.2 |

**Pairs against the old prompt**, would rather have:

| | new | old |
|---|---:|---:|
| the section (ten pairs, rounds one and two) | 3 | 7 |
| two bullets (five pairs, round two) | 3 | 2 |

**For the two bullets, which shipped: no change shown either way.** The count is no better than
the old prompt's (3.2 against 2.7) and the pairs split 3 to 2, as the control for this reader
did.

**For the section, the two instruments disagreed.** Its count fell (2.7 to 1.5; round one's
judge gave the two it saw 2.6 and 1.4), and the pairs judge preferred the old summary 7 times in
10, and found it easier to follow 6 times to 2. Its reasons were about weight, not about
anything undefined: the section's summary "drops in engram, process philosophy and 'mnemonic
improvisation' quickly"; the old one is "shorter and lighter on model names and benchmark
figures". The section keeps more of the piece's names, each explained, and gives more of what a
finding was compared with: a gain for a reader with the background, more to carry for a
first-year student with none. Seven of ten is a real signal that the controls (3 to 2 here, 4
to 1 for the profiled reader) do not erase, and it is one more reason the section did not ship.

Whether Fuller can be made easier for a reader with no profile is open, and has its own queue
entry (`qi-4meqvjr4`).

## What it cannot show

- **Five pieces, all academic papers.** An essay or a news piece coins fewer names and may show
  nothing either way.
- **Not the article the report came from**, and not the reader: a synthetic profile.
- **Judges that are models of the writer's family.** No pair or omission was disputed in a way
  that went to a cross-family judge, so none was used.
- **Rounds two and three were designed after round one was read.** They answer questions round
  one raised, and they are weaker evidence than a test declared in advance.
- **Counts this small move by one.** The section's whole audit effect for the profiled reader is
  seven fewer places across ten summaries.
- **One round-one judge against the piece listed nine main findings**, where its brief said five
  to eight. Its only omission finding was made again by the round-two judge.
- **The measured arm is the shipped prompt, to the byte.** `npx tsx evals/simple/prompt-hashes.ts`
  prints `c5fa0839…` for the source's standard pair, which is the `systemsSha256` in every
  `high-*-new2*` result file.

## Reading them

The session read the old Fuller, the section's and the two-bullet arm's for each piece. The
plainest case is Levin's essay for the profiled reader. The old summary uses "the same voltage-changing drug, Monensin", "an
intelligence ratchet" and "through Anthrobots into rats", none of which the summary says
anything about. The section's drops Monensin and the Anthrobots, and where it keeps a coined name
it says what it is: "a series of Selflets, slices of
self perhaps a few hundred milliseconds thick", "polycomputing, where one physical process serves
different functions depending on which of many layered agents interprets it". It is also 52
words longer, and over its ask. The two-bullet arm's does the same with the names it keeps,
inside its length: "a series of Selflets: thin slices of the self, each probably a few hundred
milliseconds long", "a feature he calls mnemonic improvisation: actively rebuilding memory
content to fit the present". It leaves "process philosophy" and "gene-network models" unsaid,
which the audit judge listed.

## Reproducing it

```
# old arms: src/simple-summary.ts as at d1eec9994, then restored
npx tsx evals/simple/probe.ts run --arm high-about-new0a --power high <the five slugs>
# … and each other arm with its prompt in place
npx tsx evals/simple/new-reader.ts table
npx tsx evals/simple/new-reader.ts audit      # then pairs, grounded; `2` and `3` for the later rounds
npx tsx evals/simple/new-reader.ts score      # and `score 2`, `score 3`
```

The judges' inputs, keys and answers are in `evals/results/simple/new-reader-261005h/`. `score`
refuses a judge file that is not for the shuffle its key holds. **The ten `grounded-<slug>.md`
inputs are not committed**: each holds a whole paper. `grounded` and `grounded 2` rebuild them
from the local database, and the blind id in each key says whether the rebuilt file is the one
the judge read.
