# Footnote and citation numbers glued to words: a census of production, and what a re-import costs

Up: [investigations.md](../project/investigations.md) · the plan:
[261004j](../plans/261004j-footnote-digits-census-root-cause-and-re-import-measurement.md) · the
linker this builds on: [260930k](../plans/260930k-pdf-footnotes-shown-and-linked.md)

## What was asked

Greg's *Entropy* article stores its footnote markers as bare digits stuck to the word before them
(`remarkable28`, `memories29 ,`). Asked whether to re-import it:

> Q-footnote-digits A. but only after you've done some careful evals. this is a problem on lots of
> my articles. you can read from my production database, try and have subagents trawl through
> looking for all the places where numbers (probably corresponding to footnotes) have been weirdly
> imported, and also are not being identified correctly by Citations mode
>
> — Greg, 2026-10-04, relayed by the Overseer

Three questions: how many articles, and what are the numbers really; does a fresh import still get
it wrong; and what would re-importing cost in things Greg has anchored to those articles.

## The short answer

- **It is three different things, not one.** Of 735 unlinked glued numbers found, 144 are footnote
  or endnote markers (9 articles), 168 are *citation* numbers that a journal prints as superscripts
  (4 articles), 31 are author-affiliation marks, and 392 are not markers at all (`ResNet18`, `p38`,
  `w1`).
- **Footnotes: old imports, mostly.** Today's code links them. Rendering production's stored
  transcription of the *Entropy* paper with today's code links 61 of its 63 notes. One thing a fresh
  import still got wrong is fixed here: the model typed a whole page of that paper's endnotes as
  ordinary paragraphs, which left exactly `remarkable28` and `memories29 ,` unlinked.
- **Citations mode: a real bug, fixed here.** On a paper that cites with superscript numbers, it
  read the reference list, the model named an entry for every work, and code threw every one away
  (27 of 27, 69 of 70), because it only recognised numbers in square brackets.
- **A re-import is the wrong tool for the *Entropy* article.** A fresh import is a new reading of
  the PDF by the model. Measured: it keeps 61 of 77 block ids and loses the block under 4 of Greg's
  7 comments and passage chats. **Re-rendering the transcription production already holds keeps 76
  of 77 and loses none of them**, and links more notes. There is no button for that today.

## How it was measured

One read-only snapshot of production, 2026-10-04, in a single
`begin isolation level repeatable read read only` transaction, rolled back: 59 articles (46 with a
current revision, two owners), 9,119 blocks, 13 Citations lists, 25 comments, 54 chat threads, and
the other tables that hold a block id. The scripts are in
[`evals/footnote-digits/`](../../evals/footnote-digits/README.md); the snapshot itself is real
articles and is not kept.

**The detector** is deliberately loose: one to three digits glued to a lower-case letter, a closing
bracket or quote, or sentence punctuation, plus any superscript digits. It found 970 places; 235
were already links.

**What each one is, by reading.** Three Sonnet readers labelled all 735 unlinked places in context.
An Opus reader, working alone before the others had written anything, labelled a 100-place sample:
**100 of 100 agreed.** That is two readers agreeing about stored text, not a check against the
printed PDF.

| | count | of the 735 |
|---|---|---|
| footnote or endnote marker | 144 | 20% |
| citation number (superscript style) | 168 | 23% |
| author-affiliation mark in a byline | 31 | 4% |
| journal volume glued to its name, in one web bibliography (`Psychol.9, 133`) | 47 | 6% |
| not a marker | 345 | 47% |

So the loose pattern is 42% precise for "an unlinked marker". Nearly all the noise is two papers:
subscripts in a maths paper (184) and the protein `p38` (63).

**What the detector missed, by reading whole paragraphs.**

- 168 paragraphs from the 14 articles it flagged most: **footnote markers, 23 found and none
  missed**. **Citation numbers, 35 found and 19 missed** (65%): the second and later numbers of a
  list or range (`5,51` finds the 5), TeX superscripts (`\(^{20–24}\)`), and numbers after a capital
  or a digit (`ER34`, `HER-2.15,40`). So the citation count above is low by about a third.
- 158 paragraphs from the other 32 articles, which GPT Sol's plan review asked for because the
  first sample could not see an article the detector missed entirely: **one miss**, the tail of a
  list beside a marker that is already a link. No article is hiding.

One paper (`pnas-202123432`) cites as `(17, 18)` in round brackets. Those are not glued to anything
and are not counted here; Citations does not pair them either.

## Per article

`footnote`, `citation` and `byline` are unlinked places. *Reader's own* is comments and highlights /
chats anchored to a passage / blocks with reading time recorded.

| article | imported | source | PDF prompt | live | footnote | citation | byline | Citations list | reader's own | examples |
|---|---|---|---|---|---|---|---|---|---|---|
| `entropy-26-00481-…-naz564` | 09-24 | PDF | pdf-v3 | **live** | 62 | | | yes | 3 / 4 / 73 | `lineages¹.` `remaps21 it` `them41 [1` |
| `lawrence-kuhn-2024-…-hs82mz` | 09-04 | PDF | pdf-v2 | **live** | 54 | | | no | 0 / 2 / 0 | `adjudicate.¹` `cortex21).` |
| `nagel-bat` | 08-30 | PDF | pdf-v2 | **live** | 16 | | | yes | 0 / 1 / 0 | `reduction.¹` `intrinsically,11 to` |
| `nihms-536461-…-nr87dn` | 09-29 | PDF | pdf-v4 | archived | 3 | | 1 | no | 0 / 0 / 27 | `hypofrontal1.` `limits³.` |
| `distributed-representa…-fs7zvp` | 09-24 | PDF | pdf-v3 | **live** | 2 | | | no | 0 / 0 / 0 | `squares).⁴` |
| `2406-01506v1-…-wcc6gz` | 09-24 | PDF | pdf-v3 | **live** | 2 | | 4 | no | 0 / 0 / 0 | `product.¹` |
| `revistes-ub-30977` | 08-26 | PDF | pdf-v1 | archived | 1 | | | no | 2 / 0 / 0 | `presence’.45` |
| `arxiv-2610-…-bfrbaj` | 10-03 | PDF | pdf-v4 | archived | 1 | | 4 | no | 0 / 0 / 128 | `Model Hub²:` |
| `xanadu-…-ueuvaf` | 09-04 | web | | archived | 1 | | | no | 0 / 0 / 0 | `world4;` |
| `we-must-pace-the-frontier-…` | 10-03 | web | | archived | 1 | | | no | 0 / 0 / 31 | `coordination.1` |
| `2607-22753v1-…-nfrmw5` | 09-28 | web | | archived | 1 | | 6 | no | 0 / 0 / 81 | `community22 2` |
| `arxiv-2212-…-u5293w` | 09-28 | PDF | pdf-v4 | archived | | 82 | 3 | no | 0 / 0 / 57 | `Nigro19 in` `(see40).` |
| `jco-2005-01-libre-…-hk9cc7` | 10-01 | PDF | pdf-v4 | archived | | 44 | | yes | 0 / 0 / 62 | `mortality.¹` `treatment.³⁶` |
| `s41598-023-33209-9-…-hxekgz` | 09-27 | PDF | pdf-v4 | **live** | | 39 | 4 | no | 0 / 0 / 69 | `photostimulation44.` `et al.19` |
| `s41597-021-01033-3-…-e06dkg` | 09-28 | web | | archived | | 3 | | no | 0 / 0 / 19 | `studies206` (122 others are links) |
| `arxiv-2508-…-wrzxkg` | 09-28 | PDF | pdf-v4 | **live** | | | 5 | yes | 0 / 0 / 75 | |
| `melnikoff-bargh-2018-…` | 09-05 | PDF | pdf-v3 | archived | | | 2 | yes | 1 / 0 / 50 | |
| `pnas-202123432-…-rekvg9` | 09-29 | PDF | pdf-v4 | archived | | | 2 | yes | 0 / 0 / 57 | |

The extractor's version is the *PDF prompt* column; the code version is not stored on the revision
(`implementation_version` reads `pipeline`), so the import date is the only record of which code
rendered it. The footnote linker shipped on 2026-09-30.

Three web rows are not this bug. `we-must-pace` shows a real `<sup>1</sup>` whose page gave it no
note to link to. `xanadu` and `2607-22753v1` are one stray marker each beside working ones. The
47 glued volume numbers are one PMC bibliography whose bold volume lost its space in extraction.

## Did Citations mode identify them

GPT Sol's review split this into three questions, and the stored lists answer all three the same
way. Over the 122 glued markers in the three affected articles that have a stored list
(`entropy-26`, `jco-2005`, `nagel-bat`):

| | |
|---|---|
| the marker reaches its note | 0 — those revisions have no notes |
| the list holds the reference-list entry of the work | 0 — no row in the three lists has an entry |
| the words a row cites the work with include that number | 0 |

The stored lists were made by older versions (`citations/2` to `/5`), so the same five PDFs were
imported locally with today's code and Citations run on each:

| paper | cites as | reference list read | entries the model named | kept | thrown away as "the citing words do not carry this number" |
|---|---|---|---|---|---|
| `entropy-26` | `[13]`, `[179,180]` | 292 entries | 73 | 58 | 14 |
| `jco-2005` | `mortality.¹`, `disease.³⁻⁵` | 27 | 27 | **0** | **27** |
| `s41598-023` | `pattern5,51`, `studies15` | 69 | 70 | **0** | **69** |
| `nagel-bat`, `nihms` | author–year, footnotes | no numbered list | | | |

**That is the bug.** `markerNumbers` in [`src/citations.ts`](../../src/citations.ts) read a number
only inside square brackets. The model's own citing words did carry the number (`reduced
mortality.¹`), and code could not see it.

## Root cause, per shape

**Footnote markers: stale, with one live fault.** Production's cached transcription, rendered by
today's code with no model call:

| article | pages cached | notes shown | linked | still unlinked, and why |
|---|---|---|---|---|
| `entropy-26` | 29 of 29 | 63 | 61 | two notes with no marker in the prose |
| Kuhn | 136 of 142 | 60 | 50 | as 260930k found: markers the transcription dropped (24–26, 37), or a number that also reads as a page range |
| `nihms` | 35 of 35 | 5 | 3 | the other two are table notes with no number |
| Dhammapada | 120 of 126 | 31 | 0 | notes keyed to verse ranges (`1-2:`), which no marker rule can link |

The live fault is in a **fresh** import of the *Entropy* paper. Its 62 endnotes run over four
"Notes" pages; the model typed the second page — notes 18 to 32 — as `paragraph`, between
`footnote` records for 17 and 33. Fifteen notes came out as body paragraphs and their markers
stayed bare. Only 41 markers were linked, against 61 from the older transcription.

Fixed in `endnotesTypedAsProse` ([`src/pdf-read.ts`](../../src/pdf-read.ts)): a page is given back
to the notes only when every paragraph on it opens with the next note number, counting on from a
real footnote record. No prompt change, so no import costs more and no cached chunk goes stale.

**The stray space** (`stories9 . This`) is the model setting a superscript off from the full stop.
It is still there in a fresh `pdf-v4` reading (9 places). Removing it in the renderer was built and
taken out again: it changes the block's text, and that cost 10 of the *Entropy* article's 77 block
ids on a re-render, one under a comment. It wants closing where the block is drawn, not where it is
stored. Not done.

**Citation numbers**: the bracket-only rule above. Fixed: in an article with **no notes at all**, a
number glued to a word of three letters or more, or to sentence punctuation, counts as the citing
number, with its list and range tails (`5,51`, `³⁻⁵`). It is read inside the words the row cites
the work with, or straight after them in the paragraph. With any note in the article the old rule
stands, because a footnote number and a reference number are the same glyphs and a wrong pairing
gives a work its neighbour's authors. The model's title must still be found in the entry.

**Author-affiliation marks** are left alone. The footnote linker does not search the byline.

## What a re-import would do

"Re-import" in production is *Start this article again* on the Metadata page (a reset): it re-reads
the stored PDF, and for an article read under an older prompt that is a new, paid transcription by
the model. It also drops the article's extras (summary, glossary, quotes, Citations list and the
rest) and regenerates them. Block ids survive only where the new reading produces the same words
([block-ids.md](../project/block-ids.md)).

Five stored PDFs were fetched read-only and imported into the local database with today's code.
Their output was then split with production's full block rows as the baseline, which is what stage
3 does in production. One fresh reading is one sample of a noisy process.

| article | blocks kept | notes linked | Greg's comments and passage chats whose block is lost | reading-time blocks lost | block ids named in saved chats / searches / referee runs lost |
|---|---|---|---|---|---|
| `entropy-26` (pdf-v3 → v4) | 61 of 77 | 41 of 48 found | **4 of 7** | 15 of 73 (67 min of 174) | 4 of 22 / 4 of 15 / 7 of 29 |
| `nagel-bat` (pdf-v2 → v4) | 11 of 33 | 13 of 13 found (3 notes missing) | **1 of 1** | none recorded | 2 of 4 / 1 of 4 / 4 of 8 |
| `s41598-023` (v4 → v4) | 57 of 69 | no notes | none to lose | 12 of 69 | none |
| `nihms` (v4 → v4) | 68 of 83 | 3 of 5 | none to lose | 5 of 27 | none |
| `jco-2005` (v4 → v4) | 32 of 62 | no notes | none to lose | 30 of 62 | none |

Where a comment's block survived, its quoted words were still found in the block in every case.

**Against that, the same question for a re-render of the stored transcription** — no model, the
words do not change, only the markup:

| article | blocks kept | notes linked | Greg's comments and passage chats lost | reading-time blocks lost | ids in saved chats / searches / referee lost |
|---|---|---|---|---|---|
| `entropy-26` | **76 of 77** | **61 of 63** | **0 of 7** | 1 of 73 | 0 / 0 / 0 |
| Kuhn (6 pages not cached) | 1,847 of 2,030 | 50 of 60 | 1 of 2 | none recorded | 7 of 9 / – / – |
| `nihms` | 69 of 83 | 3 of 5 | none to lose | 8 of 27 | none |

The one *Entropy* block lost is a table, which today's code renders differently. Kuhn's and
`nihms`'s losses are paragraphs that today's code joins back together across a page break — a real
improvement that changes their text.

**Production cannot do this today.** A chunk of transcription is cached under a key that includes
the prompt version, so a reset under `pdf-v4` does not find a `pdf-v3` transcription and reads the
PDF again. And the cache is swept: 15 of the 21 PDF articles with any cached chunk no longer have
every page. The *Entropy* article's 29 pages are all still there as of this snapshot.

## Cost

Measured on the five local imports: the import itself (transcription, structure, figures) was
$0.11 to $0.22 an article; Citations another $0.05 to $0.31. A reset also regenerates every other
extra the article had, which was not totalled.

## After the fixes

**Endnotes typed as paragraphs.** The local *Entropy* import was re-extracted with the fix. All 19
chunks came from the cache, so it is the same transcription rendered twice:

| | before | after |
|---|---|---|
| notes shown | 48 | 63 |
| markers linked | 41 | 58 |
| notes 18–32, `remarkable28` and `memories29 ,` among them | body paragraphs, markers bare | notes, linked |
| block ids kept against production | 61 of 77 | 61 of 77 |

The fix changes nothing about ids: a fresh reading still loses 16 blocks.

**Citations on a superscript-citation paper.** Citations was run again on the two local papers.

| paper | run | entries the model named | kept | wrong number | title not in the entry |
|---|---|---|---|---|---|
| `s41598-023` | before | 70 | 0 | 69 (and 1 not in the list) | – |
| `s41598-023` | after | 69 | **61** | 1 | 7 |
| `jco-2005` | before | 27 | 0 | 27 | – |
| `jco-2005` | first try at the fix | 27 | 0 | 26 | 1 |
| `jco-2005` | after | 27 | **20** | 1 | 6 |

Seven of the 61 kept pairings were read by hand (every ninth): each entry's number is inside the
range its citing words carry (`spatial memory1–7` → entry 1; `delayed-win-shift task41,42` → entry
42). The eight works left without an entry include three cited as `1–7` whose titles the model
gave differently from the list.

**The first try at the fix kept nothing, and passed its tests.** It read the number only inside the
quoted citing words. On the next real run the model's quotes stopped one character short of the
superscript (`reduced mortality`, not `reduced mortality.¹`), so 26 of 27 were still thrown away.
The number is now also read from the paragraph, immediately after the quoted words. That was found
only by running the step on the paper.

**The Citations step is not steady from run to run on these papers**, fix or no fix. Of five runs
on the two papers after the first: one returned no works at all (`s41598-023`, 6,216 output tokens,
nothing counted as dropped), and one named no entry for any of 27 works (`jco-2005`). Neither is
caused by this change and neither was chased.

## What this does not show

- Labels are two models reading stored text. Nobody compared against the printed PDFs.
- One fresh import per article. A second reading would keep a different set of blocks.
- The citation count is low by about a third (the recall sample).
- Annotations made after 2026-10-04 are not in the snapshot.
