# PDF ingestion final code review

GPT Sol, 2026-09-07. Round two; the first attempt timed out during Mac sleep and returned no verdict.

# READY

No unresolved P0/P1 findings. Parent disposition remains for two P2s.

- **PDF-INT-010 — P2:** Bibliography word-share counts blank records as words. At [pdf-read.ts:3015](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/kuhn-pdf-integrity/src/pdf-read.ts:3015), `"".split(/\s+/).length === 1`. A synthetic final page with three lexical words plus twenty blank `reference` records was excluded from scoring, checkpointed, and published with no `meta.quality`. This does not bypass the declared three-word structural floor, but it can suppress the content retry and falsely claim that transcribed records identify a bibliography.

- **PDF-INT-011 — P2:** Post-dedup refusal overstates affected pages. [pdf-read.ts:2605](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/kuhn-pdf-integrity/src/pdf-read.ts:2605) throws with `chunk.pages`, not the exact pages from `published.verdict.issues`. A synthetic case where only page 3 remained missing reported “pages 3, 4.” It still refused and returned no HTML.

Prior findings:

- PDF-INT-001–005: resolved.
- PDF-INT-006: resolved for all three established P1 cases; PDF-INT-010 is a narrower residual quality-classification issue.
- PDF-INT-007–009: resolved.

Confirmed:

- Fresh/cached publication and checkpoints require `finish: "stop"`.
- Null, primitive, array and partial records recover through typed structural handling.
- Prototype record types are rejected.
- Recovery is context-free, page-assigned by code, bounded to two attempts, and uses existing reader/gate/accounting/cancellation.
- Post-dedup recovery never restores rejected duplicates.
- Final structural failure returns no HTML.
- Assembly preserves chunk/response order; no global model-label sort.
- Same-page, adjacent-page and three-page continuations work; gaps/backwards joins do not.
- Prompt and fingerprint are unchanged.
- Valid neighbouring checkpoints remain reusable.

Validation: permitted focused run passed **134/134 tests across four files**. No full gate, typecheck, database, source-PDF or production validation was run.

Declared residual limit: this proves page identity and minimum page presence, not exact prose. Textless scan pages remain unverified, and richer omissions remain nonfatal content warnings. The real-source replay was not independently inspected under the stated data restriction.

Against `013d05a4`, two additional fixture-only files also differ—`tests/a-429-is-asked-again.test.ts` and `tests/checkpoints-durable-resume.test.ts`; their changes only supply newly required reading fields.

## Parent disposition

All established P0/P1 findings are resolved. Both P2 findings are accepted for a small final fix:
blank records must contribute zero words to bibliography classification, and a structural
refusal should name the exact affected pages. Discovery is closed after this review.
The last fixture-parser corrections landed after the review snapshot; parent reproduced the
incorrect context-page parsing and confirmed the original durable-resume assertions green
with the corrected mock.

Sol fixed both P2s after observing their regression assertions fail. The focused integrity file
passed 28 tests, and typecheck and scoped lint passed. Bibliography words now count only
nonempty tokens; post-dedup refusals derive sorted unique pages from the structural issues.

Final narrow verification by GPT Sol: **VERIFIED**. Both accepted fixes and the three fixture
corrections were checked; the focused integrity suite passed 28/28. No new discovery round.
