Verdict: revise the plan before building. The matcher and owner-side re-match are basically sound, but the card handoff, hidden-entry propagation, public re-match, and export coverage need changes.

## High severity

1. The one-shot “Dig deeper on arrival” can be lost or run invisibly.

The lookup controller exists only while the Glossary band is mounted: [`GlossaryMode.tsx:90`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/modes/glossary/GlossaryMode.tsx:90), and Reader mounts that band only in Glossary mode at [`Reader.tsx:2038`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/reader/Reader.tsx:2038). The card is outside the band and exists in every mode at [`Reader.tsx:2939`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/reader/Reader.tsx:2939).

There are three concrete failures:

- `look()` silently returns when another lookup owns `lookLive`: [`useGlossary.ts:632`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/useGlossary.ts:632). If the band consumes and clears the one-shot anyway, the press is lost.
- Closing the band aborts and forgets the client-side lookup while the server deliberately continues and saves it: [`useGlossary.ts:624`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/useGlossary.ts:624), [`useGlossary.ts:709`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/useGlossary.ts:709). A card shown after closing therefore cannot truthfully know whether a lookup is busy and may start a duplicate paid call.
- Opening a term does not guarantee its row is visible. `useGlossaryMode` immediately clears a selected term below the active threshold: [`GlossaryMode.tsx:174`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/modes/glossary/GlossaryMode.tsx:174). The lookup may run while the row that should display it remains absent.

Concrete fix: move the non-polling lookup state—`look`, busy/admission, draft, kept answer, and failure—into the always-mounted owner read/controller beside `useGlossaryRead`, which already mounts at [`ArticlePage.tsx:457`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/article/ArticlePage.tsx:457). Keep job polling in the conditional band. Then the card can directly invoke the shared lookup and open the band; no one-shot is needed. Explicit opening must also lower/bypass the threshold enough to expose that row.

If the one-shot remains, `look()` should return whether admission succeeded, the band must acknowledge only an admitted request, and busy state must be lifted to the card. Test busy-before-arrival, band remount, and a target below the gate.

2. Hidden terms still appear in Skim and can reopen a missing Glossary row.

Owner Skim receives the complete owner glossary at [`Reader.tsx:2316`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/reader/Reader.tsx:2316). Its stop-card builder scans every entry without considering `hidden`: [`stop-card.ts:154`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/stop-card.ts:154). The result renders both the term chip and “Open in Glossary”: [`SkimPanel.tsx:779`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/SkimPanel.tsx:779).

The plan also needs more than a late panel filter:

- Main counts, sort options and threshold currently use the raw `all` array: [`GlossaryPanel.tsx:251`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/GlossaryPanel.tsx:251), [`GlossaryPanel.tsx:282`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/GlossaryPanel.tsx:282), [`GlossaryPanel.tsx:397`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/GlossaryPanel.tsx:397).
- `?term=` is currently cleared only for a threshold-hidden selection in prioritised order, not for a personally hidden term in every ordering: [`GlossaryMode.tsx:170`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/modes/glossary/GlossaryMode.tsx:170).
- The entire closed row is already a `<button>`: [`GlossaryPanel.tsx:1289`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/GlossaryPanel.tsx:1289). The trash button must be a sibling, not nested inside it.

Concrete fix: define one owner-visible entry list and feed it to prose marks, hover cards, TermJump, Skim, main list, sorting, counts and the gate. Retain the raw list only for Hidden/Unhide and lookup reconciliation. Defensively exclude hidden terms in `stop-card.ts` and `canOpenFromStopCard`. Clear a personally hidden `?term=` independently of sort/gate.

The G key itself will then behave correctly: it derives candidates from rendered marks, not stored blocks, at [`TermJump.tsx:22`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/TermJump.tsx:22).

3. The new table will fail the export-coverage gate.

Every article-scoped table must be declared for both rollback and reader bundle exports: [`article-rows.ts:90`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/store/article-rows.ts:90). The test discovers new schema tables automatically and fails if one is absent: [`store-export-covers-tables.test.ts:243`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/tests/store-export-covers-tables.test.ts:243).

The plan’s “Hidden entries in the export” deferral does not satisfy that gate. “The glossary entry is still exported” and “the reader’s hide preference is exported” are separate questions.

Concrete fix: decide this in Stage 2. Prefer exporting the preference alongside reading time, whose precedent is declared at [`article-rows.ts:193`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/store/article-rows.ts:193). If intentionally deferred, still add explicit `{ exported: false, why: ... }` coverage for both destinations.

4. The public-reader clause leaves the original underline bug unfixed.

The plan says to re-match publicly only “if its read already holds block text”, otherwise a future Find more will fix it. The public read definitely has ordered block IDs and text: [`public-reader.ts:643`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/store/public-reader.ts:643), and it currently forwards the stored glossary unchanged at [`public-reader.ts:799`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/store/public-reader.ts:799). Visitors have no Find more machinery: [`GlossaryMode.tsx:104`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/modes/glossary/GlossaryMode.tsx:104).

Because `termMarks` only searches the stored `entry.blocks`: [`annotate.ts:880`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/annotate.ts:880), owner-only re-matching would leave visitors with the same missing underlines indefinitely.

Concrete fix: make public re-matching mandatory when the stored glossary fingerprint matches the current revision. Extract occurrence matching and ordering into a small public-safe, type-only module used by the writer, owner read and public read. Do not expose freshness in the public DTO; the existing field-by-field projection already prevents private attached fields crossing: [`dto.ts:361`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/public/dto.ts:361).

## Medium severity

5. The proposed optimistic hide can be overwritten or rolled back out of order.

`useGlossaryRead` commits a whole GET response into state: [`useGlossary.ts:268`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/useGlossary.ts:268). An earlier GET may therefore land after the optimistic flip. Rapid Hide → Unhide also permits PUT and DELETE responses—or their rollback handlers—to complete in the opposite order.

The planned card action closes before the mutation settles, following the current card action shape at [`ProseHoverCard.tsx:587`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/ProseHoverCard.tsx:587), while the existing glossary error surface lives only in the band at [`GlossaryPanel.tsx:401`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/GlossaryPanel.tsx:401). A failed card hide could therefore show no sentence.

Concrete fix: use the simpler pessimistic mutation in v1—disable that entry’s action, await the write, then call the ordered read’s `refresh()` and close the card only on success. This serialises opposing writes and gives the card somewhere to show failure. If optimism is retained, it needs a per-entry desired-state/version overlay applied over every GET, plus superseded-response handling.

6. The owner check should live in the store, and PUT should reject invented entry IDs.

The correct ownership primitive is `articleIdForOwned`, which validates the slug, scopes by the ambient owner and returns 404 for another owner: [`pg.ts:293`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/store/pg.ts:293). Reading time calls it inside its store methods: [`pg-reading-time.ts:28`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/store/pg-reading-time.ts:28). Route `article: "first-capture"` is only spend attribution, not authorization: [`routes.ts:10132`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/routes.ts:10132).

A format check alone lets an owner create unlimited orphan rows for arbitrary `spya-*` IDs.

Concrete fix: dedicated store methods should call `articleIdForOwned`. PUT should validate the Spideryarn ID and require that it exists in the current stored glossary before inserting. DELETE can remain idempotent so old orphan rows are removable. Test own article, another owner’s slug, malformed ID and well-formed nonexistent ID.

## Low severity

7. Hyphen/space matching is safe, except longest-first ordering now has an edge case.

The boundary and suffix arrangement is correct: the whole alternation remains inside `BEFORE … SUFFIX … AFTER` at [`term-match.ts:103`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/term-match.ts:103). Matching directly against rendered text means `match.index` and `match[0].length` remain valid rendered-text offsets: [`annotate.ts:895`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/annotate.ts:895). No offset conversion is introduced.

The edge case is sorting by raw form length before every separator run becomes the same `+` pattern: [`term-match.ts:95`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/term-match.ts:95). For example, `alpha----------beta` can sort ahead of `alpha beta gamma`, after which the first alternative can consume only `alpha beta`; `AFTER` accepts the following space, so the longer phrase loses.

Concrete fix: canonicalise each interior separator run to one placeholder before deduplication and length sorting, then compile. Add an overlapping-form regression with repeated separators.

Otherwise the deliberate exclusions are sensible: no en dash, soft hyphen, minus sign or hyphen-against-nothing. `SUFFIX` retains its existing false positives such as `bus` → `buss`.

One wording claim should be softened: sharing `termPattern` does not make server and client incapable of disagreement. The server scans `block.text` at [`glossary.ts:684`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/glossary.ts:684), while the client scans rendered text from HTML. The documentation explicitly records those as different strings: [`glossary.md:304`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/docs/project/glossary.md:304).

8. Give the shared re-match helper the type it actually needs.

`findOccurrences` and `inDocumentOrder` currently require full mutable `Block[]`: [`glossary.ts:684`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/glossary.ts:684), [`glossary.ts:708`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/glossary.ts:708). `blockHashQuery` returns only ID, text, role and treatment: [`pg.ts:1606`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/store/pg.ts:1606).

Concrete fix: define the pure helper over `readonly { id: BlockId; text: string }[]`. Avoid casting fingerprint rows to `Block[]`.

## Direct answers

1. Hyphen/space equivalence is safe with the lookarounds, suffix and rendered-text offsets. The real bug is raw-length ordering after separator normalisation.

2. Owner-side recomputation is sound when not stale. It reproduces write-time occurrence semantics: `buildGlossary` performs the same locate-and-order sequence at [`glossary.ts:781`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/glossary.ts:781), and `blockHashQuery` returns every revision block in ordinal order. It should mutate only the returned copy, not the stored artifact. Hashes, drafts and exports do not depend on that returned copy. Chat does consume `loadGlossary` and caps the document-ordered list, so its first 40 entries may improve/change: [`chat-tools.ts:1368`](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/chat-tools.ts:1368). Public readers should also re-match, and have enough data to do so.

3. The separate table and owner-read attachment are the right basic design. Use `articleIdForOwned` in the store. Public reads will not leak hides if kept off the public query/projection. Export coverage, Skim, counts and all `?term=` orderings need explicit handling.

4. The one-shot design is not robust enough. Busy admission, unmount/remount and threshold-hidden rows all break its promise. An always-mounted lookup controller with a direct card call is simpler.

5. The simplest version is: one pure shared re-match helper; a small owner-only hide table with pessimistic, serialised mutations; one canonical visible-entry projection; and lookup state lifted just high enough for both card and band. `hidden_at` can be omitted unless chronology or support tooling has a stated use.

I made no edits. `src/term-match.ts` and `tests/glossary.test.ts` changed concurrently during the review; I treated those changes only as implementation evidence.