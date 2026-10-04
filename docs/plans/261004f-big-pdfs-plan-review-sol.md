## Findings

No P0 findings.

### F1 — P1 — Established: the plan does not test or explicitly fix the known 32 MiB fetch ceiling

The product promises 50 MiB, but URL fetching still defaults to 32 MiB. Stage 1 sends synthetic HTML directly into block building and synthetic PDF bytes directly into extraction, so it never exercises the failing fetch path. Stage 2’s expected fixes also omit it.

Evidence: [plan:66](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-limits/docs/plans/261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md:66), [uploads.ts:36](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-limits/src/uploads.ts:36), [uploads.ts:90](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/src/uploads.ts:90), [fetch.ts:763](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-limits/src/fetch.ts:763), [fetch.ts:789](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/src/fetch.ts:789), [fetch.ts:2422](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-limits/src/fetch.ts:2422).

Add a boundary test through `fetchDocument`’s `fetchImpl` seam and make the fetch default derive from the shared upload limit. Test 32 MiB + 1, 50 MiB, and 50 MiB + 1.

### F2 — P1 — Established: M4 bypasses the exact PDF failure it claims to detect

The 30 MiB encoded-request check lives inside `openRouterReader`, after base64 encoding. M4 proposes injecting a reader that answers from the text layer. `runPdfExtract` then uses that injected reader instead of `openRouterReader`, so the size guard never executes. The proposed 25 MiB one-page fixture therefore cannot reproduce `[pdf-chunk-big]`.

Evidence: [plan:75](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-limits/docs/plans/261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md:75), [plan:78](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-limits/docs/plans/261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md:78), [pdf-read.ts:801](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-limits/src/pdf-read.ts:801), [pdf-read.ts:828](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/src/pdf-read.ts:828), [pdf-read.ts:2690](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/src/pdf-read.ts:2690).

Extract the encoded-size/request-planning policy into production code that both the real reader and test call, or inject transport beneath `openRouterReader`. Do not reproduce the 30 MiB calculation in the harness; that would share the assumption being tested.

The earlier investigation already recommends raising the request allowance and retrying without overlap context. The current plan should explicitly accept, reject, or supersede that recommendation instead of leaving the known failure under “anything else the measurements expose”: [260928b plan:147](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-limits/docs/plans/260928b-pdf-chunk-too-big-for-one-request.md:147).

### F3 — P1 — Established: the stage completion rule cannot be met by the work Stage 2 defines

Stage 1 says every confirmed hypothesis receives a failing test and Stage 2 turns every such test green. But Stage 2 deliberately does not decide the structure solution, and does not commit to fixing the Messages-wire timeout, oversized response, or PDF request ceiling.

Evidence: [plan:81](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-limits/docs/plans/261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md:81), [plan:84](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-limits/docs/plans/261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md:84), [plan:117](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-limits/docs/plans/261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md:117).

Separate outcomes into:

- regression tests that Stage 2 must turn green;
- characterization measurements for intentional ceilings;
- explicit decisions or follow-up work that block the stated reliability claim.

Otherwise the plan can either never finish or declare success with confirmed user-visible failures.

### F4 — P2 — Established: parts of M1 cannot use “the real request builders”

Relations exposes its answer-token calculation, but labels computes its budget privately inside the live model call. A free harness would have to duplicate that formula, which cannot catch production drift.

Evidence: [plan:70](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/docs/plans/261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md:70), [labels.ts:1869](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/src/labels.ts:1869), [labels.ts:1879](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-limits/src/labels.ts:1879), [relations.ts:129](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/src/relations.ts:129).

Extract pure production budget/request planners for each measured mode, then call those from both production and M1.

### F5 — P2 — Established: M5 cannot straightforwardly use M2’s largest articles during Stage 1

The unbatched insert prevents M2 from storing 4,000- and 6,000-block revisions before the fix. In addition, `writeArtefacts` writes revision artifacts, while `loadArticle` reads the current published revision; the plan does not mention completing that lifecycle.

Evidence: [plan:73](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/docs/plans/261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md:73), [plan:76](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/docs/plans/261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md:76), [artifacts-pg.ts:1146](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/src/store/artifacts-pg.ts:1146), [artifacts-pg.ts:1157](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/src/store/artifacts-pg.ts:1157), [pg.ts:2776](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/src/store/pg.ts:2776).

Run M5 after batching is implemented, or explicitly create, complete, and publish each measured revision.

### F6 — P2 — Established: Stage 1 does not run every model-free import component

It omits the assets/PDF-figure path, despite the image-heavy 50 MiB document being precisely where CPU and memory risk differ from a text PDF. PDF figure recovery already has injectable `readBytes` and locator seams, so this can be exercised without a paid call.

Evidence: [plan:66](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-limits/docs/plans/261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md:66), [pdf.ts:1924](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/src/pdf.ts:1924).

Add the PDF figure-recovery/assets step to the image-heavy soak, using injected bytes and a null/deterministic locator.

### F7 — P2 — Established facts, reasoned recommendation: the option set omits the most reusable route

Option D is not greenfield: the heading-tree builder and provisional marker already exist. Conversely, merely enabling `SPIDERYARN_DEEPEN_STRUCTURE` does not solve the initial refusal, because deepening currently starts only after the same whole-document wave-one call succeeds.

Evidence: [heading-tree.ts:1](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/src/heading-tree.ts:1), [heading-tree.ts:307](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/src/heading-tree.ts:307), [structure-step.md:477](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/docs/project/structure-step.md:477), [structure-step.md:810](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/docs/project/structure-step.md:810), [structure.ts:2914](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/src/structure.ts:2914).

Add an option E: seed the existing cascade with the mechanical heading skeleton, then make bounded section calls. That reuses more existing machinery than C. For the immediate version, D is the strongest recommendation, but it still needs Greg’s consent because it visibly degrades Structure and the publication/replacement seam is unfinished.

### F8 — P2 — Reasoned: the paid experiment and total scope are too broad for an afternoon, but too narrow in diversity

A single near-limit PDF can spend most of $10 repeating what the 142-page Kuhn run already established. At the same time, the proposed run stops at ingest/labels without proving that the resulting article can be retrieved and opened.

Use a staged stop rule and two contrasting shapes if budget permits: one dense/heading-heavy document and one image-heavy or unusually large-page document. Always include the free real `GET /api/article`/reader-load check. Do not run all ten modes; use free M1 boundaries first, then at most one representative high-risk whole-document mode if its measured boundary warrants it.

Evidence: [plan:98](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-limits/docs/plans/261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md:98), [routes.ts:8644](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/src/routes.ts:8644).

## Arithmetic and hypothesis audit

1. **Fixture coverage — confirmed.** The largest committed PDF is 17 pages. The earlier Kuhn evidence is approximately 142 pages and 2,046 final blocks, not near the advertised maximum.

2. **Structure refusal — confirmed, with exact thresholds.**

   `estimateStructureTokens = 500 + 175 × nodes`, and `wholeDocumentRequest` adds 64,000 tokens of headroom against a 128,000-token model limit.

   - 321 requested sections produce 362 nodes and an estimate of 63,850: accepted.
   - 322 sections produce 363 nodes and an estimate of 64,025: total 128,025, so it throws.
   - For headingless prose, `ceil(blocks / 9)` first reaches 322 at **2,890 blocks**.
   - If the first block is a heading, the first heading-driven refusal is **322 headings**.
   - If the first block is not a heading, its initial segment counts too, so **321 headings** suffice.

   Evidence: [structure.ts:495](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/src/structure.ts:495), [structure.ts:564](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/src/structure.ts:564), [structure.ts:615](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/src/structure.ts:615), [structure.ts:655](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/src/structure.ts:655), [token-budget.ts:53](/home/greg/code/spideryarn2/.claude/worktrees/fbbac46a-big-pdfs-up-to-our-stated-limits/src/token-budget.ts:53).

   The threshold is established. Saying a dense 250-page paper necessarily crosses it is reasoned from expected block/heading density, not established for every 250-page paper.

3. **Postgres parameter ceiling — confirmed by code shape and arithmetic.**

   `revision_blocks` binds 17 values per row:

   - 3,855 rows × 17 = 65,535: fits exactly.
   - 3,856 rows × 17 = 65,552: exceeds the protocol limit.

   The preceding identity insert binds two values per row and first exceeds the limit at 32,768 rows.

   Tree, labels and assets are JSON values written in fixed-parameter updates; cost records are inserted one call at a time; checkpoint writes are one row at a time; revision cloning is `INSERT … SELECT` with fixed parameters. I found no comparable approximately-4,000-row bind explosion on the import path. Checkpoint reads use an `IN` list, but the number of checkpoint keys at the stated document sizes is nowhere near 65,535.

4. **32 MiB fetch cap — confirmed.**

5. **Single-page encoded PDF failure — confirmed in production code and prior evidence, but not measurable by M4 as written.**

6. **No call-local deadline on the Messages wire — confirmed.** The job deadline eventually aborts the work, but individual structure/labels calls have no independent stall/deadline guard.

7. **Scale risks — mixed.** The five-second block budget and buffered article response are established mismatches. Labels duration, peak-memory failure and actual Vercel response overflow at a particular block count remain measurements rather than established failures. Planning more than 100 PDF chunks is possible, but the extractor already deliberately processes work in concurrency waves; count alone is not a defect.

## Answers to the six suspicions

1. Items 2 and 3 are accurate as approximations; the exact boundaries are 2,890 headingless blocks or 321/322 headings, and 3,856 `revision_blocks` rows. I found no second import-path statement with the same per-row bind growth at relevant sizes.

2. Stage 1 misses two free checks: most importantly **fetch**, through `FetchOptions.fetchImpl`; also the image-heavy **assets/PDF-figure step**, through injected `readBytes` and locator dependencies.

3. Synthetic documents are fair for SQL width, deterministic structure rejection, block CPU/memory curves and serialized response size. They are not fair for the encoded PDF guard with the proposed reader injection, and copied mode-budget formulas would be circular. M5 measures payload size, not whether Vercel actually serves it successfully.

4. One $10 PDF is not the best design. Use a staged two-shape experiment and stop once the uncertainty is resolved. “All ten modes” is unnecessary, but the boundary should include real article retrieval/reader opening and, only if M1 identifies risk, one representative whole-document mode.

5. D is the best immediate fallback, but not so small or invisible that Greg’s product judgment is unnecessary. The missed fifth option is a mechanical heading skeleton feeding the existing scoped cascade. The current deepen flag alone does not help because it still depends on successful wave one.

6. This is not afternoon-sized as written. An afternoon-sized first slice is: exact boundary tests, fetch-cap fix, batched block inserts, a real test of the encoded-size guard plus the previously recommended recut fix, and article retrieval. Defer the broad all-mode matrix, wide performance curves and full structure redesign to a separately scoped stage.

BUILD WITH CHANGES