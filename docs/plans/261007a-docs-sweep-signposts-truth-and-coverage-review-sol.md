ship — all established P1 findings fixed. No P0 found. `tests/doc-links.test.ts` passed: **17/17**. No commits made.

Line numbers refer to the corrected files.

| ID | Severity | Doc:line | Finding and evidence | Fixed |
|---|---|---|---|---|
| R1 | P1 | security.md:382, 485, 495 | Postgres has no stored sanitiser stamp. Both readers pass `undefined` to `sanitizeStoredBlocks` and re-clean every read. Marked the file-based fast path as history. | Yes |
| R2 | P1 | auth.md:354 | Promised a beta 403. `requireUser` has no allowlist or 403 branch; credential failures return 401, verification outages 503. | Yes |
| R3 | P1 | auth.md:564; security.md:1110, 1133 | “Missing spend limit” ignored ingest quotas and the deliberate global-cap decision. Distinguished existing allowances from the absent general per-reader dollar cap. | Yes |
| R4 | P1 | security.md:1215 | “Only the page cap is built” omitted cooperative cancellation. `refuseAnOverlongPdf` passes `ctx.signal` to `countPdfPages`. | Yes |
| R5 | P1 | browser-testing.md:22; testing.md:487 | Claimed no tests inspect rendered styles/layout. Chrome tests, including `prose-marks-stay-inline-in-chrome.test.ts`, do both. Vitest’s jsdom also supplies animation frames. | Yes |
| R6 | P1 | fleet-and-overseer-overview.md:156 | Claimed 74 `overseer-*.test.ts` files; the stated glob matches 72. | Yes |
| R7 | P1 | open-questions.md:70 | Claimed every image is downloaded and hosted. `collect-assets.ts` has format/size/count caps and failure entries that remain hotlinked. | Yes |
| R8 | P1 | original-version/ai-headings.md:126; original-version/glossary.md:31 | Conflicting single-pass/per-node descriptions. `generateStructure` normally asks for the whole tree, then uses slices when it cannot fit. | Yes |
| R9 | P1 | original-version/ai-headings.md:154 | Regeneration command omitted the slug and `--force`, and claimed one file is overwritten. `scripts/stage.ts` uses draft revisions; fresh steps otherwise skip. | Yes |
| R10 | P1 | database.md:1477 | Still claimed Vercel lacked database settings, contradicting deployment.md’s recorded configuration. Replaced the stale claim with its owning signpost. | Yes |
| R11 | P1 | ai-gateway.md:967 | Stream classification was attributed to every streaming caller. `messages-stream.ts` handles the Messages wire separately. | Yes |
| R12 | P1 | ingest-queue.md:1157 | Structure plus Labels described as two calls. They are two steps, each potentially making several calls. | Yes |
| R13 | P1 | ingest-queue.md:2025 | Newly claimed fencing never takes expired claims away. `pg-jobs.ts`’s `settleExpired` settles/requeues them and clears attempt tokens. | Yes |
| R14 | P1 | prompt-caching.md:75, 152, 189 | Five shared groups and Glossary/Quotes sharing were false. `sharesArticleCache` compares effort, renderer **and output format**; no distinct stages match today. | Yes |
| R15 | P1 | setup-dev.md:373 | Generator comparisons attributed to individual stages. The pipeline’s `sameStamp` delegates model comparison to `sameGenerator`. | Yes |
| R16 | P1 | setup-dev.md:554 | Claimed everything tests read/write is in Supabase. Tests also consume filesystem fixtures; narrowed to the relational store. | Yes |
| R17 | P1 | supabase-local.md:18 | “This database and nothing else” overlooked source/image Storage in `blobs.ts`. | Yes |
| R18 | P1 | structure-step.md:1003 | Called `npm run labels` retired. package.json still dispatches it through `scripts/stage.ts`; only the standalone implementation retired. | Yes |
| R19 | P1 | worktrees.md:803 | Claimed migration-prefix protection was absent and database suites silently skipped. `db-generate.ts` checks collisions; preflight/`pgReady` now refuse missing databases. | Yes |
| R20 | P2 | content-extraction.md:474 | Bot-provider recipe instructed updating prose counts indiscriminately. Restricted this to current inventories, preserving dated measurements. | Yes |
| R21 | P1 | content-extraction.md:124 | Claimed stage CLIs bypass the queue and fetched PDFs lack its guard. `stage.ts` drives the queue; acquisition checks page count before storage. | Yes |
| R22 | P1 | reading-time.md:10 | Persistence pointer named the reading-duration calculator. Actual storage is `store/pg-reading-time.ts`. | Yes |
| R23 | P1 | quotes.md:31 | Named nonexistent `bandRows` export. The export is `quoteBandRows`; `bandRows` is a panel-local variable. | Yes |
| R24 | P1 | chat-from-a-mode.md:57 | Wrong compiler-failure sequence. `parseOrigin` becomes exhaustive over the new mode only after `ORIGIN_MODES` changes. | Yes |
| R25 | P1 | chat-from-a-mode.md:33 | Named interface `DebateClaimChats` as the lens component. The component is `Angles`. | Yes |
| R26 | P1 | chat-from-a-mode.md:95 | Named `it.each`; the cited test uses `describe.each`. | Yes |
| R27 | P1 | comments.md:1050 | Claimed every paid call uses OpenRouter, overlooking Live. Narrowed to article-analysis calls. | Yes |
| R28 | P1 | library.md:1343 | New “no fallback” correction was false. `ADDED_AT` and the printed date fall back from `fetched_at` to `created_at`. | Yes |
| R29 | P1 | design-css-overview.md:94 | Complete stylesheet-scan list omitted `styles/colourscales.css`, explicitly included by `css-tokens.test.ts`. | Yes |
| R30 | P1 | dictation.md:870 | Called Realtime the single paid call outside OpenRouter. GPT-Live also calls OpenAI directly; Live is the exceptional feature. | Yes |
| R31 | P1 | experimental-features.md:482 | Promised zero anonymous requests. The test expects a public article GET and prohibits requests outside `/api/public/` and POSTs. | Yes |

Changes made:

- Corrected the factual claims above in **25 project docs**.
- Kept all headings and Greg quotations unchanged.
- Left code, AGENTS.md and docs/reusable/ untouched.
- Checked the migration, bot-provider and phone-width recipes against source.

Wider observations and suspicions cleared:

- **No unapproved instruction changes** found in the specified rule docs.
- **Public-shelf’s robots/noindex correction is accurate** against `public/robots.txt` and `vercel.json`.
- `loadArticle` still exists in both Postgres readers; the sanitiser test pins their `READERS` list.
- Feedback’s “fifth party” correctly refers to documents addressing models.
- AGENTS.md’s “one declared exception” remains accurate **as one product feature: Live**, which has two OpenAI engines. `UNMETERED_SPEND` currently has six entries covering separate tools/evals; it is not a count of product gateway exceptions.
- Security’s stamp section would benefit from a larger historical cleanup; the current behaviour is now explicit at its entrance.