No P0 findings. I fixed three P1s and three P2s, all within the allowed Stage 1 files.

## Findings

1. **P1 — PDF text could close its own prompt fence**  
   [src/paper-metadata.ts:100](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/paper-metadata.ts:100)

   A hostile `</pdf_text>` inside the document escaped the intended fence. The extractor now breaks closing tags case- and whitespace-insensitively before interpolation. Added a regression test at [tests/paper-metadata.test.ts:215](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/tests/paper-metadata.test.ts:215).

2. **P1 — Some malformed/refused model answers could look successful**  
   [src/paper-metadata.ts:154](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/paper-metadata.ts:154)

   The parser did not explicitly reject abnormal finish reasons or a refusal accompanying valid-looking JSON, and silently dropped non-string author entries. It now rejects:

   - missing choices or content;
   - token-limit and content-filter stops;
   - provider/model refusals;
   - unexpected fields and non-string author entries;
   - malformed or incomplete objects.

   Output is bounded to a 500-character title, 50 authors of 120 characters, a 5,000-character abstract, and a 296-character DOI. DOI validation now matches the bibliographic store’s printable, URL-safe shape before it can become a key or link. Tests are at [tests/paper-metadata.test.ts:64](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/tests/paper-metadata.test.ts:64).

3. **P1 — Short real text layers were silently classified as “no text”**  
   [src/paper-metadata.ts:251](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/paper-metadata.ts:251)

   The former 200-character heuristic could turn a short title/byline page into filename metadata without calling the model. Only zero non-whitespace characters now count as no text. Added both no-text and short-text behavioral tests at [tests/paper-metadata.test.ts:166](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/tests/paper-metadata.test.ts:166).

4. **P1 — The eval’s “ship DeepSeek” verdict was stronger than its evidence**  
   [paper-metadata-2026-10-01.md:76](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/evals/results/paper-metadata-2026-10-01.md:76)

   The matched run had 37 exact DeepSeek titles plus one close result, versus Luna’s 39 exact; the focused rerun reproduced the catalogue-byline error in 3/4 DeepSeek answers versus 0/3 Luna answers. I changed the verdict to: the fallback route passes, but the model-quality gate needs Greg’s decision.

5. **P2 — Eval reporting obscured route, cost, latency, and corpus limitations**  
   [score.mts:14](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/evals/pdf/minimal-metadata/score.mts:14) and [paper-metadata-2026-10-01.md:3](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/evals/results/paper-metadata-2026-10-01.md:3)

   Corrected the production-route description, identified latency as the final provider attempt excluding retry backoff, corrected the fallback cost comparison to about 23% below Luna rather than half, and disclosed that 13 files contain only 11 distinct first-two-page inputs. The scorer applies identical matching rules to both arms and reports exact versus close separately.

6. **P2 — Failure behavior and public documentation lacked coverage**  
   [tests/paper-metadata.test.ts:266](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/tests/paper-metadata.test.ts:266)

   Added tests showing malformed PDF bytes, pdf.js errors, password errors, provider refusal, timeout, malformed answers, and empty answers all throw rather than returning plausible empty metadata. Updated the model route documentation and privacy disclosure at [setup-dev.md:314](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/docs/project/setup-dev.md:314) and [PrivacyPage.tsx:422](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/web/PrivacyPage.tsx:422).

## ZDR and cost audit

The ZDR route is correct and needed no code change:

- `outgoing()` spreads the caller body first and writes the route’s provider block afterward, so runtime-supplied `provider` settings cannot override it: [src/ai-call.ts:1470](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/ai-call.ts:1470).
- `only` limits eligibility to Fireworks, DeepInfra, and Together; `order` prefers them in that order; `zdr: true` excludes non-ZDR endpoints even during fallback; `allow_fallbacks: true` permits another eligible endpoint. This agrees with OpenRouter’s documented [ZDR](https://openrouter.ai/blog/insights/zero-data-retention/) and [provider failover](https://openrouter.ai/blog/insights/reliability-failover/) semantics.
- The request is capped at 4,000 completion tokens.
- The gateway meter records the call on success, refusal, or abort; the job-step collector writes it to the ledger. `paper-metadata` is correctly classified as step-driven at [src/cost-categories.ts:240](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/cost-categories.ts:240).

## Checks

- Requested Vitest command: **5 files passed, 119 tests passed**.
- `npm run typecheck`: could not start because this sandbox denies `tsx`’s `/tmp` IPC socket.
- Equivalent `node --import tsx scripts/typecheck.ts`: source, web, and fleet projects passed. The test project has seven concurrent billing errors and one unrelated existing error at [chat-empty-reads-from-the-top.test.tsx:126](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/tests/chat-empty-reads-from-the-top.test.tsx:126); no Stage 1 errors.
- Biome lint: no errors; one existing informational complexity warning in `pdf.ts`’s out-of-scope `pass0`.
- Full `npm test` could not reach local PostgreSQL/Docker in the sandbox.
- No commits or index-changing commands were made.

Wider issues left unchanged: the plan’s point 5 still describes the superseded Fireworks-only route; Together answered none of the 26 fallback-route eval calls, so its task quality remains unmeasured; and choosing DeepSeek despite the repeatable title regression is now explicitly a product decision.

**Verdict: the implementation and ZDR routing pass review, but Stage 1 does not pass its model-choice gate until Greg accepts the documented DeepSeek title regression or chooses Luna.**