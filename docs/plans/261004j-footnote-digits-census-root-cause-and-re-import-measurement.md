# Footnote digits glued to words: census, root cause, and what a re-import would cost

**Status: done to stage 4, which is a stop** (2026-10-04). Plan reviewed by GPT Sol, two fixes
built and code-reviewed, § Results at the foot. Nothing here wrote to production; the re-import, or
the re-render that measured better, is Greg's to decide.

## What this is for

Greg's *Entropy* article stores its footnote markers as bare digits stuck to the word before them,
some with a stray space before the punctuation: `remarkable28`, `memories29 ,`. They are not links,
and nothing says what note they point at. Asked whether to re-import that article
([Q-footnote-digits], option A), Greg, 2026-10-04, relayed by the Overseer:

> Q-footnote-digits A. but only after you've done some careful evals. this is a problem on lots of
> my articles. you can read from my production database, try and have subagents trawl through
> looking for all the places where numbers (probably corresponding to footnotes) have been weirdly
> imported, and also are not being identified correctly by Citations mode
>
> — Greg, 2026-10-04

So: measure first, across every article; find out what a fresh import still gets wrong and fix
that; then say, per article, what a re-import would improve and what of Greg's it would put at
risk. **The re-import is a production write and comes back to Greg.**

## Background, in plain words

- **A block** is one paragraph, heading or list item, with a stable id
  ([block-ids.md](../project/block-ids.md)). A re-import re-reads the source; a block whose words
  come out the same keeps its id, and one whose words changed gets a new id. Anything a reader
  anchored to the old id (a highlight, a comment, a chat about a passage) then points at a block the
  article no longer has.
- **A PDF is read by a model**, page by page, into records ([`src/pdf-read.ts`](../../src/pdf-read.ts)).
  The model copies a superscript `28` as plain `28` glued to its word. Since 2026-09-30
  ([260930k](260930k-pdf-footnotes-shown-and-linked.md)) code finds which glued digits are footnote
  markers and links them to the note. Articles imported before that never got it.
- **A re-read of the same PDF is not the same text.** Measured in block-ids.md: 32 of 43 ids kept on
  one paper. And a PDF read under an older prompt (`pdf-v1`–`v3`) has no cached transcription under
  today's `pdf-v4`, so re-importing it is a new, paid transcription.
- **Citations mode** pairs a work with its entry in a PDF's numbered reference list only when the
  citing words carry the number in brackets, `[8]` (`markerNumbers` in
  [`src/citations.ts`](../../src/bibliography.ts)). A journal that cites with a superscript, which
  arrives as `studies206` or `rearing⁵⁷`, gives it nothing to pair on.

## What a first look found (2026-10-04, one read-only snapshot of production)

59 articles, 46 with a current revision, 9,119 blocks. A loose pattern (1–3 digits glued to a
lower-case letter, closing bracket or sentence punctuation, plus superscript digits) finds 970
places, 733 of them neither a link nor a `<sup>`. Reading a few per article, they are four different
things, and only the first is what [Q-footnote-digits] asked about:

| | shape | example | where |
|---|---|---|---|
| A | PDF footnote or endnote marker, unlinked | `lineages¹.` `stories9 .` `Martians7` | *Entropy* 26, Kuhn, Nagel, 2 smaller |
| B | PDF **citation** number printed as a superscript | `photostimulation44.` `rearing⁵⁷` `ischemia.²⁸,²⁹` | s41598, arxiv-2212, jco-2005, nihms |
| C | author affiliation marks in the byline paragraph | `Kiho Park1 , Yo Joong Choe2` | ~8 PDFs |
| D | not a marker at all | `ResNet18`, `fsaverage6`, `log2`, `o4-mini` | everywhere |

Two web articles also show up (`pmc13013618`, `s41597-021-01033-3`) with a few unlinked numeric
citations and a reference list whose volume number is glued to the journal (`Psychol.9, 133`).

## Stages

### Stage 1 — Census (read-only)

One snapshot, taken once with a script that runs every statement inside `begin read only` and rolls
back, saved outside the repo. Subagents read the snapshot, never production.

1. **Classify every candidate** as A, B, C or D by reading it in context (Sonnet subagents, the
   articles split between them, each writing a verdict per candidate).
2. **Measure the detector's precision** from those verdicts, and its **recall** by having a
   subagent read a sample of whole blocks from affected articles and list markers the pattern
   missed. A second, independent reader (Opus) re-labels a 100-candidate sample blind, so the
   agreement rate is a number and not a hope.
3. **For each marker, did Citations mode link it?** For shape A: is there a note it could reach.
   For shape B: does the stored Citations list have a work whose mention is in that block and whose
   entry carries that number. Counted by code from the snapshot, with a second join built a
   different way to check the first.
4. Per article: counts by shape, three short examples, import date, source kind, the extractor's
   model and prompt version, whether it is archived, whether it has a Citations list.

Written up in
[261004d](../investigations/261004d-glued-footnote-and-citation-digits-census-across-production-articles.md).
Done when every article has a row and the precision and recall figures are stated with their
sample sizes.

### Stage 2 — Root cause, and a fix for what a fresh import still gets wrong

For three to five affected sources (the stored PDF or HTML fetched read-only from the bucket to a
local scratch directory), import locally with today's code and compare with what production stores.
Two questions, answered separately per shape:

- **Old imports only?** If today's code links it, the stored article is merely stale.
- **Still wrong today?** Each shape today's code misses becomes a failing test built from the real
  text, then a fix. Known suspects before measuring: the stray space (`stories9 .`), a marker
  before `?` or `[`, superscript ranges (`¹²⁻¹⁴`), a paper whose *citations* are superscript numbers
  (which rule 2 of 260930k reads as footnote markers when the paper also has footnotes), and
  Citations' bracket-only `markerNumbers`.

**The simpler option, named:** leave Citations' pairing rule alone and fix only footnote linking.
It is passed over only if stage 1 shows shape B is common, which the first look says it is (4 PDFs,
~240 places). Widening `markerNumbers` to glued and superscript numbers is the risky half: a
footnote number and a reference number look the same, and a wrong pairing gives a work its
neighbour's authors. So it is taken only where the number is unambiguous (the paper has no numbered
footnotes of its own, or the marker did not resolve to a note), and measured on the stored lists
before it is kept. **If the measurement is not clean it stops at the write-up**, and that is a
legitimate ending.

Red test first for every fix; GPT Sol code review (write-capable, in this worktree); `npm test`
and `npm run typecheck`.

### Stage 3 — What a re-import would do, measured locally

For the same sources, after stage 2's fixes, import a local copy seeded with production's block ids
(so stage 3's carry-over runs against the real baseline) and measure per article:

- markers that became links, markers still glued;
- blocks whose id is kept, blocks minted new, blocks that disappear;
- of Greg's anchored things in production — comments and highlights (`comments.block_id`), passage
  chats (`chat_threads.anchor_block_id`), reading time (`reading_time.block_id`) — how many sit on a
  block that would change. Counted read-only from the snapshot.

For the PDFs not imported locally, the same annotation count against the *whole* article, as the
upper bound: an article with nothing of Greg's on it is safe whatever changes.

Written into the same investigation.

### Stage 4 — Stop

Back to the Overseer and Greg with: the list of articles; per article what improves and what is at
risk; the cost of a fresh transcription where the cache will not serve; and a recommendation,
probably "A where nothing of Greg's sits on a changing block". **Not run.**

## What this does not do

No production write of any kind. No deploy. No prompt change to the PDF reader unless stage 2 shows
code cannot do it (a `PROMPT_VERSION` bump makes every cached chunk stale and every import dearer;
it would go to Greg as a question). No fix for shape C or D beyond making sure the footnote linker
does not mistake them.

## Privacy

The snapshot holds real articles and Greg's own annotations. It lives in the session's scratch
directory, is not committed, and is deleted at the end. The write-up carries slugs, counts and
examples of a few words each; no credentials, no annotation text.

## The plan review, and what was done with it

GPT Sol, read-only, 2026-10-04, of commit `0742284f9` —
[261004j-footnote-digits-plan-review-sol.md](261004j-footnote-digits-plan-review-sol.md). Verdict
*"revise before build"*, ten findings. Each was checked against the code. **Where a finding and the
stages above disagree, this table is the plan.**

| | Finding | Done |
|---|---|---|
| F1 | The recall sample is drawn only from articles the detector already flagged, so an article where it misses everything is never sampled | A second recall sample over the other 32 articles. Precision and recall are stated per class (footnote, citation), over the stored text, not against the source PDF |
| F2 | "Did Citations link it" folds three questions into one | Reported as three: does the marker reach its note; does the list hold the work's reference entry; do the cited words of any mention cover that marker |
| F3 | "The marker did not resolve to a note" is no evidence that a digit is a citation; the linker leaves real footnotes unresolved on purpose | That alternative is removed. Citations pairing is not widened in this job (F4) |
| F4 | A stored Citations list has already thrown away the model's rejected entry claims, so a wider verifier cannot be replayed on it | Accepted. Widening `markerNumbers` needs raw model responses and known-correct pairs. It is written up as a proposal with what it would need, not built |
| F5 | Block ids also live in `search_runs.hits`, `referee_criteria.results`, `referee_claims.claims`, `chat_messages` and `link_summaries` | All five are in the snapshot and in the per-article count, reader's own writing kept apart from regenerable results |
| F6 | A block can keep its id while the quoted words a comment hangs on change | For every comment and passage chat on a surviving block, the stored quote is looked for in the new block's text |
| F7 | Two fresh imports confound a code change with the model reading differently | Code is compared on one transcription: production's cached records, rendered by today's renderer. A fresh import is a separate sample and is called one |
| F8 | `begin read only` is not one snapshot | Re-taken in one `begin isolation level repeatable read read only` transaction. Blocks, citations and annotations were byte-identical to the first read |
| F9 | `stories9 .`, `word9?` and `word9[` already pass `candidatesIn` | Removed from the suspects. Misses are taken from what the replay leaves unlinked, not guessed |
| F10 | Seeding ids is not what production does; and a reset also drops the article's extras | The baseline handed to `splitIntoBlocks` is production's full block rows (tag, text, html). The write-up names the production operation, what it drops, and what it costs to regenerate |

## Results

**The code review** (GPT Sol, write-capable, of `8f576723b` —
[261004j-footnote-digits-code-review-sol.md](261004j-footnote-digits-code-review-sol.md)) fixed
four P1s itself, red first: C1 numbered body lists retyped as endnotes, C2 notes continued across a
page, C3 a quote ending inside a number, C4 maths read as numbers. Its diff was read and kept. It
left **C5** open as wider work: `hasNotes` cannot see a note the extraction dropped. C5 was then
narrowed with `citesMostOfListGlued` (glued numbers count only when they match at least half the
reference list's numbers) and a red test.

**Round two** (read-only, that one fix —
[261004j-footnote-digits-code-review-2-sol.md](261004j-footnote-digits-code-review-2-sol.md)):
C5 *still open*. C7, a paper that cites by superscript and has one unrecognised numbered footnote;
C8, labels such as `sample1–20` opening the gate; C9, docs that said "closed". C9 is fixed.
**Sol still objects to C7 and C8; overruled, after an Opus arbitration (option A of three), because**
refusing glued numbers loses every reference entry on every superscript-citing paper, measured at
27 of 27 and 69 of 70, while the wrong case needs a dropped footnote and the model naming that
entry with its own title, and yields a row for a work the bibliography does list, first cited at
the wrong sentence. No guard computable from the blocks removes C7. What would is extraction
recording whether the source had notes at all (the [postmortem](../postmortems/261004m-local-evidence-cannot-prove-an-article-wide-classification.md)'s
countermeasure 4): not built, and named here so it is not mistaken for done.

The numbers, the method and the per-article table are in
[261004d](../investigations/261004d-glued-footnote-and-citation-digits-census-across-production-articles.md).
What changed about the plan as it ran:

- **Stage 1** landed as written, with the review's changes. 735 unlinked glued numbers: 144
  footnote markers, 168 citation numbers, 31 byline marks, 392 not markers.
- **Stage 2** found two things a fresh import still gets wrong, and both are fixed with a red test
  first: a page of endnotes typed as paragraphs (`endnotesTypedAsProse`, `src/pdf-read.ts`), and
  Citations reading a reference number only in square brackets (`gluedNumbers`, `markersInBlock`,
  `hasNotes`, `src/citations.ts`). The review's F4 said the Citations change could not be judged on
  stored lists; it was judged instead by running the step on two real papers locally, which is also
  what showed the first version of the fix kept nothing.
- **Built and taken out:** dropping the stray space after a linked marker. It cost 10 block ids on
  the *Entropy* article.
- **Stage 3** changed the recommendation. A re-import (a fresh reading) of the *Entropy* article
  loses the block under 4 of Greg's 7 anchored comments and chats; re-rendering the transcription
  production already holds loses none and links more notes. Production has no such operation.
- **Stage 4**: stopped, as planned. Nothing was written to production.

**Passed over, with the reason:** a marker rule for author-affiliation marks (they sit in the
byline, which is not prose); linking Kuhn's ten remaining notes (the transcription dropped the
markers); a `PROMPT_VERSION` bump to make the model type endnotes reliably (every import would pay,
every cached chunk would go stale, and the code rule covers the measured case).

**For Greg to decide** (asked through the Overseer, not built): whether to build the re-render
operation — an extract that reuses a stored transcription made under an older prompt — and run it
on the *Entropy* article, rather than re-import.

## Greg's decision on the old articles, 2026-10-04

> I don't mind too much about fixing old articles, but I do want this fixed going forwards. If
> there's an easyish fairly low-risk low-complexity fix for the old articles, great

So the re-render operation (option a) is **not** built, and the Entropy article is not re-imported.
Going forwards is covered by the two fixes above, once deployed. For the old articles, only the
steps that change no passage: *Citations: make it again* on the three superscript-citing papers
(s41598-023, jco-2005, arxiv-2212), and a re-import of the two whose footnotes carry nothing of
Greg's (distributed-representations, 2406-01506v1). Everything else is left as it is.
