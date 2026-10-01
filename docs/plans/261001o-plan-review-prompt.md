You are reviewing a small plan before it is built. Read-only: do not edit files.

Plan: docs/plans/261001o-route-the-cheap-model-metadata-spike-through-the-gateway.md
The file it fixes: evals/pdf/minimal-metadata/cheap-model-spike.mts (currently a raw fetch to OpenRouter; tests/no-undeclared-spend.test.ts flags it).
The plan whose spike this is: docs/plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md (see the "cheap model on the text of pages 1-2" bullet for its recorded figures).
Relevant code: src/ai-call.ts (openRouterJson, outgoing, CHAT_REASONING's `eval` row, AI_JOB_ROUTE's `eval` row, Meter.saw and BYOK handling), src/spend-declarations.ts, evals/declared-spend.ts (observe.openRouter), evals/extraction/tidy.mts and evals/shelf-topics/run-arms.ts (existing seam users), src/cli-ledger.ts (withLedger).

Questions:
1. Is the plan's choice (the seam with job "eval", losing reasoning effort low) right, versus a declared metered bypass that keeps effort low? Check the plan's two claims behind it yourself: (a) outgoing() strips a caller's `reasoning` for the `eval` row; (b) observe.openRouter in the declared path would record a BYOK call as cost 0 with a provider cost source, while the seam's Meter records the upstream figure.
2. Will the `eval` route's provider block (require_parameters: true, allow_fallbacks: false) plus response_format json_object route for openai/gpt-5.6-luna? Is there evidence in the repo either way?
3. Anything else the rewritten script must keep or must not do (e.g. a ledger needing a database, loadEnvLocal, BYOK cost reporting in its printed total).
Reply with numbered findings, each with severity (P0-P3) and evidence (file:line). Keep it short.
