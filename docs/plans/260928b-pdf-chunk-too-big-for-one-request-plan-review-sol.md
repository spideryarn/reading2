1. Root cause

Yes. The trace is sound:

- The real run plans with measured page sizes at [src/pdf-read.ts:2170](/home/greg/code/spideryarn2/.claude/worktrees/pdf-chunk-big-investigation/src/pdf-read.ts:2170).
- The planner charges the previous page’s marginal bytes at [src/pdf-read.ts:587](/home/greg/code/spideryarn2/.claude/worktrees/pdf-chunk-big-investigation/src/pdf-read.ts:587), but `chunkFrom` unconditionally attaches that page at [src/pdf-read.ts:599](/home/greg/code/spideryarn2/.claude/worktrees/pdf-chunk-big-investigation/src/pdf-read.ts:599).
- `sentPages` includes it in the cut ([src/pdf-read.ts:689](/home/greg/code/spideryarn2/.claude/worktrees/pdf-chunk-big-investigation/src/pdf-read.ts:689)), then the reader base64-encodes the resulting PDF and rejects over 30 MiB ([src/pdf-read.ts:824](/home/greg/code/spideryarn2/.claude/worktrees/pdf-chunk-big-investigation/src/pdf-read.ts:824)).
- Re-running the measurement produced exactly 23.88 MiB raw / 31.85 MiB base64 for pages 6+7, versus 5.08 MiB for page 7 alone. The live run confirms page 7 succeeded after raising the guard ([log:47](/home/greg/code/spideryarn2/.claude/worktrees/pdf-chunk-big-investigation/logs/tmux-jobs/pdfbig-spike-0509-3040544.log:47)).

2. Factual corrections

- Page 6 is about **6.7×**, not “twenty times,” over the 3 MiB bound ([doc:28](/home/greg/code/spideryarn2/.claude/worktrees/pdf-chunk-big-investigation/docs/plans/260928b-pdf-chunk-too-big-for-one-request.md:28)).
- Page 7’s two JPEG streams are approximately 1.55 + 0.92 MiB; **3.81 MiB is the whole one-page PDF cut**, not the JPEGs alone ([measure.mts:9](/home/greg/code/spideryarn2/.claude/worktrees/pdf-chunk-big-investigation/data/spike-pdf-big/measure.mts:9)).
- “C removes the limit for any born-digital PDF” is too broad: weight can live outside removable large XObjects.
- The CLI log’s displayed plan is misleading because it calls `planChunks` without measured sizes ([src/pdf-read.ts:3302](/home/greg/code/spideryarn2/.claude/worktrees/pdf-chunk-big-investigation/src/pdf-read.ts:3302)); its three displayed chunks conflict with the six actually requested.

3. Ranking and recommendation

A+B, with C/D deferred, is the right ranking. I would make A **40 MiB encoded**, not 45, unless a near-boundary live probe succeeds.

OpenAI documents files **under 50 MB**, including base64 PDF inputs, but that is a file limit—not a documented OpenRouter request-body ceiling. [OpenRouter confirms native passthrough](https://openrouter.ai/docs/guides/overview/multimodal/pdfs) but publishes no relevant ingress limit. [OpenAI’s file-input documentation](https://developers.openai.com/api/docs/guides/file-inputs) therefore does not prove 45 MiB end-to-end. Forty fixes 31.85 MiB while leaving materially more JSON/proxy headroom.

4. Missed A/B risks

- B’s context predicate must also govern `bytes` initialization. Otherwise the planner charges a context page it later drops, causing unnecessary extra chunks—not oversizing ([src/pdf-read.ts:587](/home/greg/code/spideryarn2/.claude/worktrees/pdf-chunk-big-investigation/src/pdf-read.ts:587)).
- Page 7 itself is 3.81 MiB, so B also drops it as context for page 8. With corrected accounting, this likely replans the tail as `7, 8–9`; the doc understates the continuity loss.
- Missing context can lose `continues`, producing a paragraph break; seam-hyphen repair also requires `continues` ([src/pdf-read.ts:1556](/home/greg/code/spideryarn2/.claude/worktrees/pdf-chunk-big-investigation/src/pdf-read.ts:1556)). Word scoring does not make that harmless.
- No hidden invariant requires context: instruction, scoring, and checkpoint keys explicitly handle `undefined`/`null` ([src/pdf-read.ts:699](/home/greg/code/spideryarn2/.claude/worktrees/pdf-chunk-big-investigation/src/pdf-read.ts:699), [src/pdf-read.ts:1998](/home/greg/code/spideryarn2/.claude/worktrees/pdf-chunk-big-investigation/src/pdf-read.ts:1998), [src/pdf-read.ts:2980](/home/greg/code/spideryarn2/.claude/worktrees/pdf-chunk-big-investigation/src/pdf-read.ts:2980)).
- A should couple model and limit structurally: `openRouterReader` accepts arbitrary model strings ([src/pdf-read.ts:797](/home/greg/code/spideryarn2/.claude/worktrees/pdf-chunk-big-investigation/src/pdf-read.ts:797)), so two adjacent constants alone cannot prevent mismatch.