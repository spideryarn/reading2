Reviewed commit `0742284f9e3f2b610318ca9351ab2461b6ca1510`, read-only. No files changed.

The plan needs revision mainly because its proposed measurements can overstate citation coverage and re-import safety.

1. **F1 — P1, established: the recall sample cannot establish recall across the census.**  
   Stage 1 samples whole blocks only from “affected articles” ([plan:69](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/docs/plans/261004j-footnote-digits-census-root-cause-and-re-import-measurement.md:69)). Articles where the detector misses *every* marker never enter that sample. Reading whole blocks helps find missed occurrences within selected articles, but cannot expose that selection failure.

   Sample independently across all articles, including articles with zero candidates. Define whether precision means A alone or A+B, and whether a range counts as one occurrence or several referenced numbers. Report class-specific results and adjudicated uncertainties. Agreement between two readers is useful, but is not accuracy against the source PDF. Distinguish recall over stored text from transcription recall against the original source.

2. **F2 — P1, established: “did Citations link it?” measures three different things as one.**  
   For A, the existence of a reachable note measures footnote navigation, not whether Citations identified any work inside it. For B, a work’s mention being somewhere in the same block does not prove that it covers the candidate occurrence. A paragraph can contain several numbers and several citations.

   The implementation stores exact mention quotes and starts, limits mentions to three per work, expands note references through `noteMarkers`/`placesOf`, and draws citation marks only when a quote resolves in rendered text. See [citations.ts:708](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/bibliography.ts:708), [citations.ts:749](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/bibliography.ts:749), and [annotate.ts:1079](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/web/annotate.ts:1079).

   Record separately: correct note destination; correct bibliographic work/entry; and coverage of the exact marker occurrence by a rendered citation mark. Treat absent lists, stale lists, capped mentions, and unsuccessful pairing separately. Two implementations of the proposed block-level join would agree while sharing its mistaken definition.

3. **F3 — P1, established: “the marker did not resolve to a note” is an unsafe permission to widen citation pairing.**  
   The linker deliberately leaves genuine footnotes unresolved: ambiguous candidates, unsupported labels, excluded record types, and unsuccessful page/cursor matching. It also omits unmatched notes on the first page. Thus, failure to resolve is evidence of neither citation identity nor absence of footnotes. The exact paths are [findMarkers:2232](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/pdf-read.ts:2232) and [renderNotes:2305](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/pdf-read.ts:2305).

   Remove that alternative from the condition. A smaller first condition is an independently verified article with numbered references, superscript numeric citation style, and **no numbered footnotes in the source**. Even then, recognize specific citation occurrences rather than every glued number: `log2`, names, quantities, and affiliations remain possible.

   Today `markerNumbers` receives only quote strings; it cannot inspect whether a particular occurrence carries a canonical note link ([verifyEntry:368](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/bibliography.ts:368)). Any occurrence-level exclusion needs verified block/span context. The existing title-in-entry check should remain, but cannot establish what an ambiguous digit means.

4. **F4 — P1, established: stored Citations lists cannot replay the pairing decisions the proposed change would alter.**  
   Failed entry claims are discarded, and successful `entryNumber` values are removed before storage. A stored list therefore lacks rejected model claims needed to test a widened verifier. See [readDraft:665](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/bibliography.ts:665) and [buildCitations:1590](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/bibliography.ts:1590).

   Also, an ordinary import does not run Citations; it is an extra. `markerNumbers` helps only when a reference list exists and the model actually proposes an entry. HTML articles and scans get no PDF reference list, and the splitter can return a partial list or none. See [pipeline.ts:307](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/pipeline.ts:307), [pipeline.ts:1854](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/pipeline.ts:1854), and [citation-reference-list.ts:130](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/citation-reference-list.ts:130).

   Use captured raw model responses plus the actual parsed reference lists for a controlled verifier comparison, then explicitly run Citations on a small representative subset. Require known correct marker→entry pairs and negative cases. Replace “measurement is clean” with stated acceptance criteria, including wrong pairings.

5. **F5 — P1, established: the reader-state inventory misses block references inside JSON and saved conversations.**  
   Beyond the three named tables, `src/db/schema.ts` contains:

   | Table | Block-dependent state omitted |
   |---|---|
   | `search_runs` | `hits[].blockId`, quote and start — [schema:3978](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/db/schema.ts:3978) |
   | `referee_criteria` | `results` with block/quote anchors — [schema:1800](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/db/schema.ts:1800) |
   | `referee_claims` | `claims`, including anchored claims and passages — [schema:1938](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/db/schema.ts:1938) |
   | `chat_messages` | `passages[].blockIds`; answer text can also contain block-id citations — [schema:3772](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/db/schema.ts:3772) |
   | `link_summaries` | Owner-scoped `block_id` — [schema:6493](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/db/schema.ts:6493) |

   Distinguish irreplaceable reader writing and saved work from regenerable caches. Unanchored chat threads can still contain answers pointing to lost blocks. Consequently, zero comments, anchored threads, and reading-time rows is not sufficient to claim “nothing of Greg’s” is affected.

6. **F6 — P1, established: retained ids do not prove retained selection anchors.**  
   Carry-over permits punctuation/case normalization and ignores certain note controls. A block can keep its id while its literal quoted text changes. Comments and chat selections depend on that quote as well as the id; the client’s comment matcher uses exact text and can return no mark. See [foldedKey:950](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/blocks.ts:950), [CommentAnchor:3130](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/types.ts:3130), and [annotate.ts:389](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/web/annotate.ts:389).

   Measure both missing block ids and failed quote resolution in surviving blocks, using the relevant consumer’s matching rules. Inspect affected destinations too: id-set intersection alone cannot detect an id retained on the wrong repeated passage.

7. **F7 — P1, reasoned: separate fresh imports can confound a code improvement with transcription variance.**  
   Stages 2 and 3 do not specify reuse of the same transcription. If each makes a fresh read, a newly linked marker may result from different model text rather than the fix. Conversely, a repeated local import may hit its own checkpoints and falsely appear to be an independent second sample. Chunk reads are cached by article and input key ([pdf-read.ts:2659](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/pdf-read.ts:2659), [checkpoints schema:5191](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/db/schema.ts:5191)).

   Capture one transcription and replay it through before/after renderers for the code comparison. Separately obtain independent fresh samples where id-risk decisions warrant them, recording cache hits and misses. Each sample must compare against the same production baseline. Two samples reveal variability; they do not guarantee production survival.

8. **F8 — P1, established: `BEGIN READ ONLY` does not guarantee the promised single snapshot.**  
   Read-only controls writes, not snapshot consistency. At PostgreSQL’s usual Read Committed isolation, successive statements can observe different published revisions or annotation states. The repository already uses Repeatable Read explicitly for a consistent article export ([article-rows.ts:684](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/store/article-rows.ts:684)); [isolation.ts](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/store/isolation.ts) explains the default.

   Specify one connection and `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, with all census reads inside that transaction. Otherwise, blocks, citations and annotations can disagree while both subsequent joins operate perfectly on the inconsistent saved data.

9. **F9 — P2, established: the linker’s miss inventory needs correction before choosing fixes.**  
   `stories9 .`, `word9?`, and `word9[` already satisfy `candidatesIn`; those suffixes are not rejected ([pdf-read.ts:2176](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/pdf-read.ts:2176)). They need actual failing examples before being called root causes.

   Additional current limitations worth classifying:

   - Markers preceded by whitespace, including superscripts; plain digits after uppercase letters.
   - Markers in headings, captions, table cells, and note bodies.
   - Bracketed/parenthesized note labels such as `[1]` or `1)`, letter labels, and unsupported symbols.
   - Repeated calls to one note: same-page ambiguity rejects them; endnotes take only the first eligible occurrence.
   - Notes emitted out of marker order, and endnotes on pages containing body prose.
   - Flattened lists/ranges that link only their first number.
   - Unmatched genuine first-page notes disappearing entirely.

   These follow from `NOTE_LABEL`, `CITING`, the forward cursors and `renderNotes`. Classify them rather than automatically widening every rule; several exclusions deliberately prevent wrong links.

10. **F10 — P1, established: a local id comparison is conditionally faithful, but does not measure the whole production operation.**  
    Production starts a draft by copying the published revision’s complete block rows, then passes those rows to `runBlocks` ([pg-revisions.ts:1085](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/store/pg-revisions.ts:1085), [pipeline.ts:2606](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/pipeline.ts:2606)). Replaying the same extraction with those complete records is faithful to carry-over. Seeding ids alone is insufficient: matching uses tag, text and HTML. Putting old ids into the new HTML would bypass the matching being measured.

    A real reset additionally drops revision extras, including Citations, and optionally regenerates them ([pg-revisions.ts:1426](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/store/pg-revisions.ts:1426)). A plain forced extraction has different artefact-retention semantics. Reset also reuses stored source bytes rather than fetching the current URL ([jobs.ts:3244](/home/greg/code/spideryarn2/.claude/worktrees/footnote-digits-census/src/jobs.ts:3244)).

    Choose the proposed production operation explicitly. Report artefacts removed or made stale, regenerated entry identities and attached lookups, and total downstream cost—not just transcription cost. A local rehearsal cannot predict later transcription variance, annotations added after the snapshot, or production job/publication outcomes.

The smaller implementation is a consistent snapshot, an occurrence-level census, controlled renderer/verifier replays, and `runBlocks` against complete production baseline records. Keep broader citation recognition conditional on that evidence, and keep “safe whatever changes” out of the recommendation.

*revise before build*