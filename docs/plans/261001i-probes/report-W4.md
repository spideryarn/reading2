# Report W4: data, AI and billing docs

(Returned as text — the harness refused the subagent's own write — and saved here by the orchestrator.)

## What changed

- `database.md`: present tense about the filesystem store moved to the past, with pointers to 260831b
  and 260903f; copied counts (migrations, owner FKs — 17 RESTRICT and 4 CASCADE, so "all restrict" was
  also wrong) replaced by where to look; new **Where to look for an article's data** (schema
  `spideryarn`, artefacts as `jsonb` columns on `article_revisions`, `checkpoints` is a cache); the
  six-job cap; Greg's 2026-08-25 RLS quote restored; two migration traps (hand-run DDL writes no ledger
  row and wedged `db:migrate` on 2026-09-28; a hand-written `.sql` leaves no snapshot).
- `prompting-guide.md`: new § What the model writes back (260903f, 260906b, 260924a ×2); the blind-read
  shuffle check (260926a, `blindCoin`).
- `cost-tracking.md`: new § Spend that keeps going (260902c, 260905d, 260912a).
- `ai-gateway.md`: the evals-in-the-ledger contradiction resolved against the code (they are, as
  `scope_kind='eval'`); copied wire lists replaced by citations of `PIPELINE_TASKS` / `TASK_WIRE` /
  `AI_JOB_WIRE`; `Provider` corrected.
- `setup-dev.md`: the model table says it is not the inventory and cites `TASK_TIER` /
  `NON_TASK_MODELS`; two missing env-var rows added; counts replaced by citations.
- `readiness.md`: § Three ways it nearly lied, linking 260909a–c.
- `billing.md`, `deployment.md`, `overseer-direction.md`: Greg's quotes restored (trawl D E1, E4, E7,
  E8, E9).
- `hierarchy.md` § Schema: `src/types.ts` `Tree` / `TreeNode` named canonical; the copy marked abridged.
- `ingest-queue.md`: a lead block, **Where a job's life is decided**, by symbol in `src/jobs.ts`;
  "there are sixteen" replaced by `STEP_ORDER` / `STEPS`; outputs as artefact kinds.
- `email.md`: where a reader's address comes from (`user.email` in a request;
  `accountEmail(ownerId)` in `src/store/admin-accounts.ts` elsewhere), and `sendEmail` / `notifyAdmin`
  / `SendResult`.
- `high-powered-ai.md`: links `src/high-power-model.ts`.

## Two edits that widened a rule — reverted by the orchestrator, now proposals

W4 generalised two `database.md` sentences ("fall back to files" → "to something else"; "the rule still
holds for any fallback somebody is tempted to add"). Under the plan review's R3 that is rule wording,
so the orchestrator restored the original words and the generalisation is proposal **D1** in
`proposals.md`.

## Found, left for others

- `database.md` still ~1,410 lines; `ingest-queue.md`'s history sections; size cuts in `billing.md`,
  `overseer-direction.md`, `hierarchy.md`.
- `ai-gateway.md` heading "One gateway, five wires" — six counting `realtime`; kept for inbound anchors.
- `STEP_READS` (`src/web/auto-modes.ts`) is named in no doc.
- Code comments still describe two stores: `src/store/uploads.ts`, `src/store/contracts.ts` headers.
