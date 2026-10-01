Code review of commit 50f38e48 (`git show 50f38e48`), built from docs/plans/261001g-exa-upstream-label.md. Read the plan first, especially "After the plan review — the fix that was built". The raw probe output is docs/plans/261001g-exa-upstream-probe-results.jsonl, and scripts/probes/261001g-exa-upstream-probe.mjs produced it.

The change: chat-wire calls send `X-OpenRouter-Metadata: enabled` (prepare/send in src/ai-call.ts). `Meter.sawRoute` records the `selected` endpoint from `openrouter_metadata` and then ignores the frame's `provider`. On an explicit-Exa request (`frameProviderTrusted`), the frame's provider is never believed, so a reply without metadata records null. New tests are at the end of tests/ai-call.test.ts.

You may fix what you find inside this change (src/ai-call.ts, src/openrouter-stream.ts, tests/ai-call.test.ts, docs/project/ai-gateway.md, the plan). Report anything wider for me to decide. Run `npx vitest run tests/ai-call.test.ts` and `npm run typecheck` after any edit.

Look especially for:
- any chat seam or caller that bypasses prepare/send, or a wire that now gets the header but was never probed with it;
- whether order matters: a frame provider after the metadata, metadata on an earlier chunk, several attempts within one meter;
- whether the header could change cost, routing or caching (it was measured to change none, but check what the evidence actually shows);
- whether ai-gateway.md's claims and its SQL predicate are exactly true. Check my conclusion, not just the code.

Reply with numbered findings, severity P0-P3, what you changed, and a verdict.
