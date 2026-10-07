# Plan review: 261007k, a chatbot on the Help pages

You are reviewing a plan before it is built, in the Spideryarn repo (this worktree). Read-only.

Read `docs/plans/261007k-help-chatbot.md` first. Then check its claims against the code:
`src/routes.ts` (the dispatch before `requireUser` around `isPublicNamespace` and `WEBHOOK_PATH`;
`/api/command-pick` and its route-table entry), `src/command-pick-call.ts`, `src/stream-run.ts`,
`src/ai-call.ts` (job policies), `src/models.ts` (`AiJob`, `AI_JOB_WIRE`, `NON_TASK_MODELS`),
`src/cost-categories.ts`, `src/dig-deeper.ts` (`DIG_DEEPER_RATE_POLICY`, `admitDig`),
`src/store/contracts.ts` (`RateBucket`, `RatePolicy`, `FetchAllowanceStore`), `src/db/schema.ts`
(`rate_limit_events`), `src/web/help/` (the Help pages, `help-pages.ts`), and
`docs/project/security-map.md`, `docs/project/ai-gateway.md` § What stops a reader spending our
money, `docs/project/billing.md`, `docs/project/prompting-guide.md`, `docs/project/prompt-caching.md`.

The constraint on this work (from the brief, not my choice): no edit to any defence listed in
security-map.md § Where the defences physically live; such a part is written up for Greg instead.
The decisions in the plan (signed-in only for v1, an allowance with a global fuse, not storing
conversations, Help pages only and not docs/project, a generated corpus file) are MY decisions,
not Greg's; Greg's words are only those quoted in the plan.

Tell me:
1. Anything in the design that is wrong against the code (a registration it will miss, a seam that
   does not exist as described, caching that will not hold with this request shape).
2. Security: whether v1 as described edits a listed defence after all; how an abuser could turn it
   into a general-purpose free LLM, and whether the design's bounds are enough; risks in rendering
   the model's answer.
3. Whether the options for Greg (A/B/C) are fairly and correctly described, and anything missing
   (e.g. Vercel's own firewall rate limiting, how the client IP is obtained on Vercel).
4. Anything simpler that would do.

Findings numbered F1…, each with severity, evidence (file:line), and the change you recommend.
End with a verdict line: `VERDICT: build | build with changes | rethink`.
