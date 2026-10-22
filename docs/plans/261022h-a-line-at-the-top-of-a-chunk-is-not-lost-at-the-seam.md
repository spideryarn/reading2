# A line at the top of a chunk is not lost at the seam

Report `spya-rg5kk6` (#614, SPIDERYARN-READING2-K5, queue item `qi-kybxcdkg`), from Greg,
2026-10-19, at block `spya-ucb0pc` of *The Order of Time* (a PDF):

> Somehow this paragraph has been cut off.

## What is wrong

Confirmed. `spya-ucb0pc` ends *"…and the moment at which Einstein"*. In the PDF the sentence ends
at the top of the next page:

```
p. 42 (last line)   we agreed to synchronize clocks and the moment at which Einstein
p. 43 (first line)  realized that it was impossible to do so exactly.
p. 43               For millennia before clocks, our only regular way of measuring time …
```

That line is nowhere in the article, and it has been missing in all 17 revisions since the first
import on 2026-10-04, so this is not 261018d. (Read from production, read-only, by the feedback
sweep; the source PDF and the blocks are in this worktree's `data/fbrg5kk6-prod-read/`, which is not
committed.)

## Where it went

Page 43 is the **first page of a chunk**: the PDF reader plans `42|43–48`, so the chunk is sent
pages 42–48 and told *"the FIRST page … is page 42, included only so you can see what continues
onto the next page. DO NOT emit any record for it."* (`instructionFor`, src/pdf-read.ts). The line
that finishes page 42's paragraph is easy for a model to treat as page 42's.

What production's reading held cannot be seen without its checkpoint, and this session was not
given production. Everything after the model call was measured instead, on the real PDF:

| what | result |
|---|---|
| that chunk read again with the production model, 3 times, plus once in a full read of all 37 chunks | the line emitted every time, `page: 43`, `continues: true` |
| the real stage (`runPdfExtract`) on pages 37–48, and the full read replayed through it | the paragraph comes out whole |
| the reading with that one record **removed** (the model omitted it) | line lost; **the gate passes the chunk** |

So the renderer and the join are right, and production's reading was a sample in which the model
left the line out. (That reading differs elsewhere too: it split "…the others." / "There are
chemical mechanisms…" into two blocks and dropped the note marker `41`, where every sample here
keeps them as one record with the marker.) **The silent pass is the fault worth fixing**, because
the model will do it again on another book.

Two other shapes were considered. A record **labelled page 42** is not one: `checkChunk` checks
the raw reading's labels before the fold, calls it structural and re-reads the page (GPT Sol, plan
review F3). A record that carries **page 42's half and the line together**, labelled 43, can be
dropped whole by `withoutRepeats`' context-page rule (Sol, F4); the real chunk's joined form is
kept (measured), and the rule below catches the case where it is not, because it runs after the
fold.

### Why the gate let it through

`check` in src/pdf-score.ts fails a chunk on a missing run only when it is at least 8 words
(`MIN_SPAN`) **and** at least 3 of them (`LOST_WORDS`) appear nowhere in the chunk's output. The
second condition is there so that a two-column page, which pdf.js often hands over out of order, is
not called lossy when every word is present. *"realized that it was impossible to do so exactly"*
is nine common words; across six pages of output every one of them occurs somewhere, so the run
counts as text that moved. The per-page table does show it (`missing runs 9` on page 43) and
nothing reads that row.

**The class:** text at a chunk seam that belongs to the context page's paragraph, lost at the one
place the prompt tells the model not to transcribe, by a check whose "moved, not lost" allowance is
widest exactly where the text is shortest.

## The fix

**One new content failure in `check`: a chunk that opens mid-sentence must open with the page's
first words** (`seamHead`, src/pdf-score.ts). It applies when:

1. the chunk has a context page (every chunk but the first), and its first requested page has a
   baseline (not a scan, not blank);
2. the context page's text layer **stops mid-sentence**: its last baseline line does not end a
   sentence, by the `ENDS_A_SENTENCE` rule `continuationTargets` uses (moved to src/pdf.ts so both
   files share one definition);
3. the in-order alignment of the whole chunk's output (`alignedMask`, the one the score already
   computes) leaves **at least two** of the first page's opening baseline words uncovered
   (`PageScore.head`, `SEAM_HEAD`).

**Positional, with no "lost" count.** The first draft required one of the words to be absent from
the output altogether; Sol (F1) pointed out that the target case has none, since every one of the
nine recurs later. A line transcribed further down the page now fires too, which is right: the
reader still gets the paragraph cut at the seam.

A content failure is already handled: the chunk is asked once more, and a second miss is published
with a quality note. No new path.

**Measured** (scratch scripts, uncommitted, scoring as `checkChunk` does): 44 real seams across
Rovelli (35), `harder` (5), `much-harder` (2), `easy` (1) and the Kuhn excerpt (1). It fires on the
production shape, the Rovelli reading with page 43's first record removed ("Page 43 opens with 9
word(s) … “realized that it was impossible to do so exactly”"). It fires on no correct reading. The only other fires are
Rovelli's index pages 139–140 in readings that labelled every record "page 2", which are already
structural failures and go to recovery; five fresh reads of those two chunks, correctly labelled,
give a head of 0.

**Why two words, not one.** With one, it fired on three eval seams, each a single token the page
prints and the model rightly writes otherwise: the second half of a word hyphenated across the turn
(`dis-` / `patcher`), a folio pass 0 did not call furniture (`66`), a note marker fused to a word
(`30certain`). The price is that a sentence missing only its last word is not caught.

**Why "stops mid-sentence", and its limits.** It narrows the rule to a paragraph carried across
the seam, so page-top text the model is right to leave out (a running head pass 0 missed) does not
buy a second call. It is a heuristic (Sol, F5): a footnote under the paragraph ends the layer with
a full stop (a miss), and a two-column page stored out of reading order can end on either column (a
miss or a needless second call). Written into the code comment.

**Phase 2** (Sol, F6). The seam rule also runs on the published records (`checkEmitted`), so if
cross-chunk deduplication removes a chunk's opening record after phase 1 passed it, the article
gets a quality note but no second call. That needs a 20-word exact repeat between chunks; accepted
and not built.

## What this does not do, and the simpler options passed over

- **A prompt change** ("text at the top of the first page that finishes the context page's
  paragraph belongs to that first page: emit it, with `continues`"). It aims at the cause, but it is
  a request to the model rather than a check, and the model already gets this right most of the
  time. A change to `SYSTEM` re-keys every checkpoint; a change to `instructionFor` alone would
  *not*, since it is not in `promptFingerprint` (Sol, F7), so it would need a version bump. Kept in
  reserve if the new failure fires often.
- **Filling the line from the text layer.** Deterministic and free, but it would put pdf.js's text,
  not the model's, in front of the reader for the first time in this pipeline (ligatures, TeX,
  spacing all differ), and `mendSeamHyphens` deliberately uses the text layer only as evidence.
- **Relabelling a record the model labelled with the context page.** Structural recovery already
  re-reads that page (F3).
- **Lowering `LOST_WORDS` everywhere.** The general hole (a short run of common words dropped
  mid-page) is real but wider, and loosening it without the seam's evidence brings back the
  two-column false failures it was set to avoid. Not here.
- **Existing articles are not mended by a Refresh** (Sol, F2). A Refresh replays the stored chunk
  readings, and a cached reading that fails a *content* check is published with a note, not read
  again: only structural failures re-read. So Greg's article keeps the hole after this ships. To
  mend it: delete that article's one `pdf-chunk` checkpoint row for chunk `42|43–48` in production,
  then Refresh, which reads that chunk again (about a cent) under the new rule. A production write,
  so Greg's call. Re-reading cached chunks that fail content checks would mend every such article
  on Refresh, but means cutting pages inside the fan-out, which `openPdfCuts` says not to do; not
  built. Versioning the checker into the checkpoint key would re-buy every chunk of every PDF.

## Stages

1. Failing test, tests/pdf-seam-head.test.ts: the omission and a two-word tail red against the old
   gate, which raised nothing at all; the line put further down, the F4 joined-record drop,
   and the quiet cases (a context page that ends its sentence, one uncovered word, the first chunk).
2. `seamHead` and `PageScore.head` in src/pdf-score.ts; `ENDS_A_SENTENCE` moved to src/pdf.ts.
3. Measured on the 44 seams (above); `npm test`, `npm run typecheck`.
4. A line in content-extraction.md beside the seam paragraphs.
5. GPT Sol code review, push to `dev`, the note in docs/user-feedback/.

## Code review

GPT Sol, SHIP WITH THE FIXES MADE
([code-review-sol](261022h-a-line-at-the-top-of-a-chunk-is-not-lost-at-the-seam-code-review-sol.md)).
It found the LCS can align a repeated opening phrase (`For now / For now`) to its later copy and
report the first as missing, and anchored `headOf` on the transcription starting where the page
starts. It anchored on one word; that is now `SEAM_HEAD` words, since a lost line and the paragraph
after it can both open with "the" (test added, red on one word). It added a test for a blank first
page. Its note that the scratch `measure.mts` also counts the "page 2" index readings is right:
the script skips the structural check, and those readings are recovered in the stage (above).
