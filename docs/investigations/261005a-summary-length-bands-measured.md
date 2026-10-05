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
