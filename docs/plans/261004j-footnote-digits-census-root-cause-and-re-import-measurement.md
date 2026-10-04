# Footnote digits glued to words: census, root cause, and what a re-import would cost

**Status: plan, awaiting GPT Sol's plan review.** Nothing here writes to production. The re-import
itself is stage 4 and is not run by this job.

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
  [`src/citations.ts`](../../src/citations.ts)). A journal that cites with a superscript, which
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

## Results

*(filled in as each stage lands)*
