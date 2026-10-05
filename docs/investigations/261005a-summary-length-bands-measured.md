# Summary's length by the length of the piece: the before/after prompt eval

Up: [investigations.md](../project/investigations.md)

Run on 2026-10-05 for
[plan 261005b](../plans/261005b-summary-length-follows-the-length-of-the-piece.md), a report from
Greg:

> The length of the summaries should somewhat reflect the length of the text. Not linearly. But a
> book will surely need (at least somewhat) longer summaries than a short article. Hopefully we can
> add a tweak to the prompts to this effect.
>
> — Greg, 2026-10-04 (`spya-gttwhn`)

## What was decided, in one paragraph

Fuller is asked for a length that depends on the piece's length, in four bands (about 250, 500,
700 and 900 words); a piece of 2,500 to 14,999 words is asked exactly what it was. Brief is asked
for about 80 words whatever the piece, as before. Two things were built, measured and dropped: a
Brief whose length also followed the piece, and a sentence telling the summary of a long piece to
cover the whole of it.

**Later the same day Brief's ask went from about 80 words to about 100**, still for every piece,
on Greg's word and a third round: [§ A slightly longer Brief](#a-slightly-longer-brief-round-three).
Everything below that says "about 80" describes the day's first two rounds.

## What was asked

1. Does the length follow the piece today? (No.)
2. With a number per band in the prompt, does it? Does any write fail on a limit?
3. Is the new length worth reading: does the longer one pad, does the shorter one lose something
   the piece needed?
4. Does a long summary spend itself on the opening, and does a sentence asking it not to help?

## How

`evals/simple/probe.ts` calls production's `generateSimpleSummary`, on Opus with the fidelity
guard on, as a press does. `evals/simple/length-bands.ts` reads its result files and calls no
model: `table` prints every number below, `pairs` builds the blind pairs, `score` puts the judge's
answers beside the key.

Six local pieces, by the words of the body the request sends:

| piece | body words | band |
|---|---:|---|
| *Keep Your Identity Small* | 879 | short |
| *Haters* | 1,398 | short |
| *Dodo* | 12,143 | standard |
| *The Scaling Hypothesis* | 12,646 | standard |
| *Race (human categorization)* | 16,744 | long |
| *Geometric Deep Learning* | 47,957 | book |

**The Rovelli book the report was filed from is not in the local database**, and a session's
production reads are refused, so *Geometric Deep Learning* stands in: about the same length, but
a technical text, not a narrative one. That is the main limit on what follows.

The arms, each a directory `evals/results/simple/high-none-<arm>/`:

| arm | prompt |
|---|---|
| `len0a`, `len0b` | before bands, twice. The second is the control |
| `len1a`, `len1b` | bands on Brief and Fuller. **Its Fuller prompts are what shipped** |
| `len1whole` | one book write, bands on both levels and the "whole piece" sentence in both |
| `len2a`, `len2b` | the long article and the book: Brief as before, Fuller banded with the sentence |

**Three early `len1a` prompt hashes are unreliable.** Identity and Haters (`short`) and Scaling
(`standard`) all record `systemsSha256` beginning `89945d81`, despite asking for different bands.
Scaling's unchanged standard pair should hash to `0653f349`, as the later standard records do.
The probe now hashes the actual band's pair (F1), but that does not repair these earlier records.
The cause is known: when those three were written the probe hashed every band's prompts together,
once a run, and the tree then still had the "whole piece" sentence in the two long bands, so the
value is a hash of a set of prompts that includes two that never shipped. Their word counts and
judge answers can be checked; their exact effective prompt bytes cannot be verified from the
saved hashes. Recovering the source snapshot or repeating those writes
would close that provenance gap. The comparison labels below retain the recorded arm names.

Two of the `len0` pairs (*Race* and *Dodo*) were written with the long bands switched off by a
one-line edit and not on the earlier commit. The standard band's prompt is the old prompt byte for
byte; this establishes the old prompt, not the old answer budget or validation limits. Those
request settings were not recorded. Their `sourceSha256` is not the old file's.

## Length

Words, two writes each except Scaling's single before write.

| piece (band) | Brief before | Brief banded | Fuller before | Fuller banded |
|---|---|---|---|---|
| *Identity* (short) | 88, 105 | 87, 94 | 402, 492 | 281, 237 |
| *Haters* (short) | 98, 94 | 83, 71 | 553, 527 | 331, 300 |
| *Dodo* (standard) | 91, 98 | 109, 118 | 534, 471 | 489, 482 |
| *Scaling* (standard) | 97 | 84, 90 | 440 | 484, 497 |
| *Race* (long) | 98, 91 | 139, 112 | 529, 509 | 620, 607 |
| *Geometric DL* (book) | 113, 95 | 159, 145 | 489, 515 | 834, 846 |

- **Before, the length did not follow the piece.** An 879-word essay got 402 and 492 words of
  Fuller, about half its own length. The book got 489 and 515.
- **Banded, Fuller does.** Asked for 250, 500, 700 and 900 it wrote about 290, 490, 610 and 840.
  It runs under the ask in the two long bands and stays inside every "never more than" but one
  (331 against 330).
- **The standard band did not move**, as its prompt did not: 440 to 534 before, 482 to 497 after.
  *Scaling* has one `len0` write here; two more of the same prompt from the day before
  (`high-none-timed500a|b`) gave 438 and 481 respectively.
- **Brief barely obeyed its band.** Asked for 60 in the short band it wrote 71 to 94, where the
  old prompt asked for 80 and got 88 to 105. Asked for 140 for the book it wrote 145 and 159.
- **No write failed**, on a limit or otherwise, in 28 recorded writes.

## The wait, and the cost

| piece | wait to Fuller before, s | banded, s |
|---|---|---|
| *Identity* | 16, 22 | 15, 18 |
| *Haters* | 41, 27 | 16, 22 |
| *Race* | 45, 32 | 54, 54 |
| *Geometric DL* | 34, 88 | 53, 47 |

The 88 was a retry the guard asked for. A longer Fuller is a longer wait for Fuller, roughly ten
to twenty seconds on a long piece; Brief was final at 9 to 26 s in these writes. Cost
follows the cache more than the prompt (a first write of the book was $0.77 to $1.01, a second
inside five minutes $0.18 to $0.29), so no cost difference can be read off these.

## Is the new length worth reading? The blind judge, round one

29 pairs: the same piece and level, old against banded (`len0a`/`len1a`, `len0b`/`len1b`), and old
against old as the control, shuffled together, sides from the tested `blindCoin`. In the 19 test
pairs the banded side was A 7 times and B 12. A fresh subagent that read only the pairs file
answered four questions a pair. For the two short essays it was given the whole essay, so it could
check an omission against the source (GPT Sol's plan review, F3); for the others, the piece's
headings.

A length change cannot be judged blind for length: the longer side is visibly longer. The judge
was told not to count length for or against, and asked what the words were spent on.

**Fuller.** Which would you rather be given before reading the piece:

| pairs | banded | old | no difference |
|---|---:|---:|---:|
| the prompt differs (short, long, book): 8 | **8** | 0 | 0 |
| the prompt is the same (standard): 3 | 0 | 1 | 2 |
| control, old against old: 5 | 2 to one side, 1 to the other, 2 none | | |

- In the eight pairs where the prompt differed, the judge called the **old** Fuller padded in
  five and the banded one in none. On the short essays its reason was the one the report implies:
  the old one *"is over half the length of an 879-word essay and reads as a retelling"*.
- It found **no essential omission** in any shortened Fuller, with the essay in front of it.
- On the long article and the book it said the banded one covered more of the piece in three
  pairs of four, and the same in the fourth.
- Slightly bent claims (a dropped hedge, a hardened verb) were found on both sides at about the
  same rate, in the control as well: old alone 3, banded alone 2, both 3 in the test pairs.

**Brief.** The same question:

| pairs | banded | old | no difference |
|---|---:|---:|---:|
| short, long, book: 8 | 1 | **6** | 1 |
| control: 4 | 3 to one side, 1 to the other | | |

- **In all four short-essay pairs the 60-word Brief left out a point the essay itself marks as
  important**, and the judge quoted the passage each time: for *Identity*, that the trouble
  follows the people and not the topic; for *Haters*, that calling someone a fraud is the mark of
  one. The old Brief had it in every pair.
- **In both book pairs the longer Brief was the one called padded**, and the old one preferred.
- The control shows the judge has a taste between two writes of one prompt (3 to 1), so 6 to 1 is
  not as strong as it looks. The four omissions, each with its source passage, are the firmer
  evidence.

So Brief's banding was taken out. It was not doing much to the length either.

## Does a long summary need telling to cover the whole piece? Round two

In round one, one pair set the first book write with the sentence (`len1whole`) against one
without, and the judge preferred the one with it: more of the middle and late chapters, and the
one without *"spends five of eleven paragraphs on sections 1-3"*. That write had also been flagged
by the guard on both tries and took 132 s. One pair settles nothing, so the sentence was measured
apart, for Fuller alone (Sol's F4 had already ruled it out of Brief, whose own rule is "at most
one other key idea"): two more writes each of the long article and the book with it (`len2a|b`),
paired against the two without (`len1a|b`), and without against without as the control. Six
pairs, a second fresh judge, headings given.

| | with the sentence | without | same |
|---|---:|---:|---:|
| preferred, 4 test pairs | 1 | 2 | 1 |
| covers more, 4 test pairs | 2 | 0 | 2 |
| suspected of a bent claim, alone | 3 | 0 | |
| control: preferred, 2 pairs | both to the same write (`len1a`) | | |

- With the sentence the long article's Fuller was 698 and 690 words, against 620 and 607
  without: nearer the 700 asked for. The book's was the same (837 and 814 against 834 and 846).
- The judge did not find either arm opening-heavy in a way that dropped later parts: *"both spend
  about half their length on sections 1 to 3"*, with or without.
- The control split as widely as the test: of two writes of the prompt without the sentence, the
  judge preferred the same one twice and said it covered more.

This did not establish an overall preference benefit. Coverage favored the sentence in two pairs,
and the long article's writes were longer; that is evidence of a possible effect, not evidence of
no effect. With only two writes per piece, variable control judgments and three claim suspicions,
the sentence was left out pending stronger evidence, keeping the simpler prompt.

## A slightly longer Brief: round three

Greg, 2026-10-05, answering whether a book should get a longer Brief anyway:

> maybe Brief could be ever so slightly longer but not much

**What shipped: Brief is asked for about 100 words and never more than 150, where it was about
80 and 130, for every piece** (`simple-prompt/10`). On the page that is about 110 words where it
was about 97. The judge's preference split was 6 to 4 with one tie. This small sample does not
establish that the change is better or no worse; the padding judgments below count against it.

Two new arms, the same six pieces, two writes each, on Opus with the guard on:
`high-none-brief90a|b` (about 90, never more than 140) and `high-none-brief100a|b` (about 100,
never more than 150). Nothing else in the prompt moved. The before side is `len0a|len0b` from
round one: Brief's prompt was the same bytes from then until this change.

### The words written are not the words asked for

| piece (band) | asked 80 (before) | asked 90 | asked 100 |
|---|---|---|---|
| *Identity* (short) | 88, 105 | 103, 106 | 94, 106 |
| *Haters* (short) | 98, 94 | 92, 99 | 96, 101 |
| *Dodo* (standard) | 91, 98 | 114, 141 | 120, 137 |
| *Scaling* (standard) | 97 | 99, 112 | 126, 102 |
| *Race* (long) | 98, 91 | 94, 91 | 91, 103 |
| *Geometric DL* (book) | 113, 95 | 90, 99 | 116, 122 |
| **mean (range)** | **97** (88 to 113) | **103** (90 to 141) | **110** (91 to 137) |

- **Twenty words more in the ask is about thirteen more on the page.** Asked for 80 the model
  already wrote 97; asked for 100 it wrote 110.
- **No write failed**, and none came near Brief's stored limit of 240 words. One went over its
  prompt's own "never more than": 141 against 140, in the 90 arm, on a second try the guard
  asked for.
- Three Briefs of the 24 new ones ran to a third paragraph (two at 90, one at 100); none of the
  eleven before did. The prompt allows it "only if the piece truly needs it".
- The longest sentence was 19 words before, 20 at 90 and 21 at 100, against "every sentence
  under 18".
- The waits in these files are not comparable with round one's: the box was badly overloaded
  while they were written.

### The blind judge

27 pairs, Brief only: each old write against the 90 and the 100 of the same letter, and old
against old as the control, shuffled together. The new side was A in 11 of the 22 test pairs and
B in 11. The first seed tried put it on B 16 times, so the next seed was taken, chosen from the
side counts alone before any pair was judged. A fresh subagent read only the pairs file; its
instructions are saved beside its answers (`judge-brief-instructions.md`). The two short essays
were given in full, the others as headings. *Scaling* has no `len0a`, so it has one test pair an
arm and no control.

Which would you rather be given before reading the piece:

| pairs | longer | old (80) | no difference |
|---|---:|---:|---:|
| asked 100: 11 | 6 | 4 | 1 |
| asked 90: 11 | 3 | 8 | 0 |
| control, old against old: 5 | 4 to one write, 1 to the other | | |

- **The control shows variation between writes.** Two writes of the old prompt split 4 to 1.
  That is not an equivalence margin for the test arms: it does not establish that 100 is no
  worse or that 90 is worse. The judge often gives content reasons, such as whether a write
  includes *"can need impossibly many examples"* or the essay's last line. Content differences
  still matter to the reader, whatever caused them.
- **Padding, the bar this had to clear.** The judge called the 100 the padded side in 5 pairs
  and the old one in 2 (both in 1, neither in 3). For the 90 it was 2 and 2. In the control it
  called one old write padded in 2 of 5. These counts are adverse evidence for 100. This small
  sample does not establish that the extra padding is chance, or that the "not padded" bar
  has been met.
- **A bent claim**: 100 alone once, old alone three times; 90 alone three times, old alone
  once, both twice. In the control one old write was flagged in 3 of 5.
- **Coverage**, on the seven pairs an arm given headings: the longer side gave the truer picture
  of the whole in 4, for both arms, and the old side in 1 (at 100) and 0 (at 90).
- **Omission**, on the four short-essay pairs an arm: the longer side left out a point the essay
  marks as important once in each arm, and the old side never. So more room did not buy the
  thing round one's 60-word Brief lost; that was already there at 80.

### Every piece, or only the long ones

| asked 100, preferred | longer | old | no difference |
|---|---:|---:|---:|
| the short essays and the standard articles: 7 | 5 | 2 | 0 |
| the long article and the book: 4 | 1 | 2 | 1 |

- **Nothing here argues for a longer Brief on long pieces alone, which is where the question
  began.** For the book the judge preferred the old Brief in all four pairs, two at each ask,
  as it did in both of round one's. Its reasons there were about content; that does not erase
  the unfavorable result. The book's two old writes split in the control too.
- A longer Brief for the shorter pieces alone is what the table leans towards. That subgroup
  is small and does not establish which pieces should get the increase.
- Keeping **one length for every piece** is the simpler product choice, but the measurement
  does not establish that increasing it for every piece is harmless. Leaving Brief alone is
  the conservative choice on this evidence.

### Why 100 and not 90

The brief for this work was: if the judge still prefers the current Brief, take the smallest
increase that is not judged worse. The judge preferred the old Brief over 90 by 8 to 3, and
100 over the old Brief by 6 to 4 with one tie. These are descriptive results, not evidence
that 90 is worse while 100 is no worse. The control cannot justify dismissing the first result
as noise and then using it to rule 90 out. The 90 arm moved the mean by six words and 100 by
thirteen; choosing 100 for that larger increase is a product judgment. The measurement has
not established that either increase clears the "not padded" bar.

### What this does not show

- That a reader prefers the longer Brief, or that it is no worse. The control shows that
  writes vary; it does not show that the judge could not distinguish a prompt effect.
- Anything about a profiled reader, a narrative book, or a piece over 50,000 words, as above.
- The four arms cost about $4.50 for 24 writes. Four writes came back unpriced by the provider
  and are estimated from their twins in the other draw.

## What reading them found

- The banded Fuller of the short essay is the essay's argument in four paragraphs: the puzzle, the
  explanation rejected, identity, the advice. The old one retold it paragraph by paragraph, notes
  included.
- The book's banded Fuller uses its room on what the old one had no room for: the applications
  chapter (the antibiotic, travel times, protein design) and a paragraph on the limits the authors
  admit. That is what Fuller's prompt says the room is for.
- One banded Brief of *Race* says *"about 94% of human variation lies within so-called racial
  groups"* where every other summary of that article gives 85% within local populations. The
  guard passed it. It was not checked against the article here; that Brief prompt did not ship.

## What this does not show

- **One judge model, two writes a cell.** The Fuller result is 8 of 8 with a stated reason in
  each; the smaller results are within what a control pair moves by.
- **Incomplete prompt provenance** for three early `len1a` writes, as noted above. The corrected
  probe applies to future writes; the raw preference tally remains a comparison of the saved prose.
- **No narrative book.** The stand-in is a mathematical survey. Whether 900 words suits *The
  Order of Time* is for Greg to see when he presses Rerun on it.
- **Nothing over 50,000 words** was run. The book band asks the same of a 200,000-word piece.
- **No profiled reader**: every write was for a reader with no profile.

## Before and after, for the book

*Geometric Deep Learning*, Fuller, one write of each (`len0a`, `len1b`). The rest are in the
result files, and `npx tsx evals/simple/probe.ts report` prints them all.

**Before, 489 words.** It gave the symmetry idea, the curse of dimensionality, the three priors,
the blueprint, the five domains in one paragraph, the LSTM result, two weak spots and the
conclusion, in eight paragraphs.

**After, 846 words, eleven paragraphs.** The same spine, with a paragraph each for: why exact
symmetry is not enough (deformation stability, Fourier against wavelets); what each of the five
domains is; how CNNs, GNNs, Deep Sets and Transformers fall out of the blueprint; the applications
chapter; and the limits, including that the LSTM result does not say a trained model transfers to
a new warping.
