Review this plan before it is built: docs/plans/261007o-openrouter-spend-the-ledger-does-not-record.md, in the repo you are in. Read-only: do not edit anything.

Context: the dev OpenRouter key spent ~$120 in October 2026 that the local cost ledger (spideryarn.ai_calls) has no row for. About $79 of that is evals and probes that called models through the gateway (src/ai-call.ts, src/messages-stream.ts) with no persisting spend collector open (src/ai-spend.ts: `collectSpend`, `beginSpend`, `recordSpend`, `persistingSpend`, `write`). The plan proposes that `beginSpend` throw when no persisting collector is open AND the process's entry file (process.argv[1]) is under evals/ or scripts/.

Please read src/ai-spend.ts, the two gateways' calls to `beginSpend` (src/ai-call.ts Meter constructor ~line 1558, src/messages-stream.ts ~646), src/cli-ledger.ts, src/spend-declarations.ts (the `unscoped` kind and its test tests/no-undeclared-spend.test.ts), tests/setup/no-provider-calls.ts, and docs/project/cost-tracking.md.

Questions:
1. Is throwing in `beginSpend` safe at both call sites — is it before any network I/O, and does any caller catch-and-continue in a way that would turn the refusal into a silent skip or, worse, a call that proceeds unmetered? Are there other gateway entry points that spend without going through `beginSpend` (embeddings, images, transcription, decisions wires)?
2. Is "entry file under evals/ or scripts/" the right discriminator? What processes run with such an entry that legitimately call the gateway with no persisting collector — e.g. scripts/stage.ts or anything under scripts/ that runs the job worker, the dev server, a deploy, readiness loops, the overseer? Would any of them break? Is there a better discriminator that is still not a flag somebody must remember?
3. Does `persistingSpend()` mean what the plan needs (a sink present and not closed)? A sink that only pushes to an in-memory array passes it — the plan handles that by converting those evals, but say if that is a hole worth closing differently.
4. Anything the plan misses or gets wrong, and anything simpler that would do the same job.

Answer with numbered findings, each with file:line evidence and a severity, then a one-line verdict.
