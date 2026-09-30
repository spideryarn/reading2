Verdict: **revise before build**

1. **The single forward cursor is unsound for mixed page footnotes and endnotes.**

   The plan requires note records and markers to match in one monotonic order, while also saying an endnote searches “back to the start” ([plan:70](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/docs/plans/260930k-pdf-footnotes-shown-and-linked.md:70)). Those rules contradict each other.

   A realistic sequence is:

   ```
   page 1: marker 1 … footnote record 1
   page 2: marker 2 …                    ← endnote
   page 3: marker 3 … footnote record 3
   end:                         endnote record 2
   ```

   Record order is `1, 3, 2`; marker order is `1, 2, 3`. After matching note 3, a forward-only cursor cannot reach marker 2. Rewinding instead risks reclaiming an earlier marker unless claimed spans are tracked independently.

   Suggested fix: use separate matching streams: page-local cursors for page footnotes, and a document-wide cursor reset at the start of each contiguous endnote section, plus a global set of claimed marker spans. Add exactly this mixed sequence as a test.

2. **The matcher can confidently attach a note to common academic notation, while rejecting genuine markers in common numeric prose.**

   The “first admissible occurrence wins” rule ([plan:66](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/docs/plans/260930k-pdf-footnotes-shown-and-linked.md:66)) has broader problems than `CO2`:

   - `BRCA1`, `CD4`, `L1`, `H1`, and similar scientific names satisfy the rule.
   - Superscript numeric bibliography citations are indistinguishable from footnote markers. A `¹²` citation can be claimed by footnote 12.
   - A genuine marker after numeric punctuation is rejected: `in 2020.¹` or `n = 30,¹`, because the character before `.` or `,` is a digit.
   - Multiple markers such as `claim¹,²` lose the second marker; the comma is preceded by a digit. `claim¹²` is inherently ambiguous between note 12 and notes 1 and 2.

   A random sample of 20 links ([plan:120](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/docs/plans/260930k-pdf-footnotes-shown-and-linked.md:120)) is too weak for a rule whose costly failure is a plausible but wrong link.

   Suggested fix: always list notes, but link only when the candidate is unambiguous. Prefer a unique superscript candidate; accept a plain-digit candidate only when exactly one exists in the search window. If multiple candidates survive, leave the note unlinked. Hand-check every produced link in the measured corpus. This is simpler and follows the plan’s stated preference for misses over false links.

3. **Page-one affiliation footnotes will not be removed as the plan claims.**

   The plan says an affiliation typed `footnote` is already set aside by the front-matter pass ([plan:106](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/docs/plans/260930k-pdf-footnotes-shown-and-linked.md:106)). It cannot be:

   - `frontMatterWindow` excludes every type outside `RENDERED` ([src/pdf-frontmatter.ts:153](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/pdf-frontmatter.ts:153), [src/pdf-frontmatter.ts:167](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/pdf-frontmatter.ts:167)).
   - `footnote` is absent from `RENDERED` ([src/pdf.ts:344](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/pdf.ts:344)).
   - `setAside` can only contain indices resolved from that filtered window ([src/pdf-frontmatter.ts:263](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/pdf-frontmatter.ts:263), [src/pdf-frontmatter.ts:326](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/pdf-frontmatter.ts:326)).

   Therefore author affiliations, correspondence addresses, and “present address” footnotes will become ordinary end notes.

   Suggested fix: either expose first-page footnote records to the front-matter pass as set-aside-only candidates and test an affiliation case, or explicitly accept that they will be shown and remove the false exemption.

4. **Unmatched notes will display doubled/conflicting labels and have unstable identities.**

   The plan keeps an unmatched note’s leading label in its prose ([plan:75](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/docs/plans/260930k-pdf-footnotes-shown-and-linked.md:75)). The client nevertheless assigns every uncited note a fallback ordinal ([src/web/notes-view.ts:266](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/web/notes-view.ts:266)) and renders it in the margin ([src/web/TableView.tsx:1583](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/web/TableView.tsx:1583)). Thus `a To test…` appears as margin label `1` followed by prose beginning `a`; numeric notes appear as `1 1 Note…`.

   It also undermines stable note identity. Canonical note IDs deliberately hash the note’s prose rather than its number so renumbering does not churn IDs ([src/notes.ts:640](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/notes.ts:640), [src/notes.ts:649](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/notes.ts:649)). Under the plan, whether matching succeeds decides whether the label participates in the prose and hash. Improving the matcher later can therefore change the note ID and its block ID.

   Suggested fix: separate the parsed label from note prose for both matched and unmatched notes. Mint identity from label-free prose; make the client choose marker label, then the note’s stored label, then an ordinal. Test unmatched numeric, symbolic, letter, and verse-range labels.

5. **Keeping `RENDERED` unchanged breaks its stated scoring invariant once notes become visible.**

   `RENDERED` is documented as what the reader sees and why faults outside it do not gate publication ([src/pdf.ts:337](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/pdf.ts:337)). The scorer likewise calls it “what the reader will actually see” ([src/pdf-score.ts:739](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/pdf-score.ts:739)). Text outside it has invented values, literal markup, and replacement characters downgraded to `unshown` notes rather than failures ([src/pdf-score.ts:780](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/pdf-score.ts:780), [src/pdf-score.ts:936](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/pdf-score.ts:936)).

   Once footnotes are rendered separately, they are visible while still scored as hidden. Also, the plan’s statement that a dropped footnote is merely reported is too broad: recall and precision are computed from all records before the shown/hidden split ([src/pdf-score.ts:736](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/pdf-score.ts:736), [src/pdf-score.ts:775](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/pdf-score.ts:775)).

   Suggested fix: separate “ordinary records rendered in place” from “reader-visible records used by the score.” Add footnotes to the latter, then measure whether the stricter treatment changes retries and cost. Alternatively, explicitly accept visible-but-non-gating notes and correct the invariant and plan language.

6. **The chunk-cache claim is true; “zero per import” is not. Downstream regeneration is material.**

   `promptFingerprint()` depends only on the transcription version, system prompt, and schema ([src/pdf-read.ts:471](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/pdf-read.ts:471)); `chunkKey` includes that fingerprint plus source/chunk/model inputs, not rendered HTML ([src/pdf-read.ts:2195](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/pdf-read.ts:2195)). Therefore unchanged cached transcription chunks remain valid.

   But:

   - The front-matter pass is explicitly uncheckpointed and is repurchased on reruns ([src/pdf-read.ts:2115](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/pdf-read.ts:2115)); the authors pass follows it ([src/pdf-read.ts:2967](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/pdf-read.ts:2967), [src/pdf-read.ts:2972](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/pdf-read.ts:2972)).
   - Changed extracted HTML forces stage 3 to rerun through an exact HTML comparison ([src/pipeline.ts:1027](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/pipeline.ts:1027), [src/pipeline.ts:1034](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/pipeline.ts:1034)).
   - Existing body IDs should carry through the unstamped-to-stamped legacy bridge ([src/blocks.ts:1093](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/blocks.ts:1093)); new note blocks necessarily mint IDs.
   - Adding role-bearing supplement blocks changes `hashBlocks`, which includes every block’s id, text, role, and treatment ([src/source-hash.ts:114](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/source-hash.ts:114), [src/source-hash.ts:148](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/source-hash.ts:148)). Derived artefacts become stale.
   - A reset forces the default chain from extract onward, including hierarchy and assets ([src/jobs.ts:3107](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/jobs.ts:3107), [src/pipeline.ts:282](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/pipeline.ts:282)).

   Suggested fix: say “zero incremental transcription cost on a fresh import.” Separately cost an existing-article rerender: front-matter calls, hierarchy/assets, and any regenerated optional modes. Report body-ID churn and new note IDs before production.

7. **The canonical markup will survive stage 3, and the stamps do not introduce an XSS issue—but the trust-boundary documentation and continued-note design must change.**

   The transport works:

   - Stage 3 sanitises before splitting ([src/blocks.ts:1411](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/blocks.ts:1411)); note attributes are not forbidden by the shared policy ([src/sanitize-policy.ts:219](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/sanitize-policy.ts:219)).
   - The later reserved-attribute scrub removes only context stamps, not note stamps ([src/blocks.ts:1465](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/blocks.ts:1465)).
   - `noteFieldsFor` recognises the container and validated note ID and writes `role`, `treatment`, and `noteId` ([src/blocks.ts:475](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/blocks.ts:475)).
   - Author IDs are recorded before sanitisation, block IDs are minted, and fragment links are then repointed ([src/blocks.ts:1229](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/blocks.ts:1229), [src/blocks.ts:1365](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/blocks.ts:1365), [src/blocks.ts:1531](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/blocks.ts:1531)).
   - The carry-over key removes recognised marker/back-link controls and fingerprints their note IDs ([src/blocks.ts:724](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/blocks.ts:724)).
   - The client verifies both the note stamp and the retargeted note block before showing a preview ([src/web/notes-view.ts:344](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/web/notes-view.ts:344)).

   Security is sound if matching happens on raw record text and every emitted text segment is escaped, as `renderHtml` already does ([src/pdf-read.ts:1834](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/pdf-read.ts:1834)). The IDs are minted hex/counters rather than model text ([src/notes.ts:649](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/notes.ts:649)). `reserved.ts` already documents the same trust argument for PDF figure stamps: PDF HTML is ours and model output is escaped ([src/reserved.ts:83](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/reserved.ts:83)).

   However, stage 3 currently states as an invariant that every note stamp came through `canonicaliseNotes` ([src/blocks.ts:462](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/blocks.ts:462)); the client and citation path repeat that provenance assumption ([src/web/notes-view.ts:20](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/web/notes-view.ts:20), [src/citations.ts:611](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/citations.ts:611)). Those comments must name the PDF renderer as the second trusted writer.

   Also, `continuationTargets` treats every footnote as unrendered furniture and never assigns it a continuation target ([src/pdf-read.ts:1554](/home/greg/code/spideryarn2/.claude/worktrees/fb-69-pdf-footnotes/src/pdf-read.ts:1554)). Continued-note joining therefore needs a separate note-grouping pass; it cannot come from the existing continuation machinery while `RENDERED` remains unchanged. Use the reserved-attribute constants rather than literal names, and export/reuse `mintNoteId` rather than copying its algorithm.