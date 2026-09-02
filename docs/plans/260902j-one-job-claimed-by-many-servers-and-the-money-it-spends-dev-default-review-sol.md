No P0s. I would fix two P1s before landing.

## Findings

- **P1 — the probe has no deadline and can hang startup forever.** [`assertStoreReachable()`](vite.config.ts:55) awaits the shared pool, whose [`Pool` configuration](src/db/client.ts:109) has no `connectionTimeoutMillis`. Stopped local Docker gives immediate `ECONNREFUSED`, but a blackholed address or stalled handshake never reaches your helpful error. Add a finite connection deadline. I would not retry: `supabase start` waits for readiness, and rerunning dev is sufficient for the narrow race.

- **P1 — the documented filesystem escape hatch does not work under the normal setup.** `.env.local` deliberately beats inherited variables ([`src/env.ts`](src/env.ts:123)), and the setup docs explicitly say command prefixes do not override it ([setup-dev.md](docs/project/setup-dev.md:183)). Since `.env.example` supplies `SPIDERYARN_STORE=postgres`, a normal fresh checkout makes `SPIDERYARN_STORE=files npm run dev` still run Postgres. That makes both the probe’s recovery instruction ([vite.config.ts](vite.config.ts:70)) and the decision record’s “still wins” claim false. Either document “edit `.env.local` and restart”, or add a dedicated override applied after `loadEnvLocal()`.

- **P2 — `dev:pretty` masks startup failure with exit code 0.** [`vite | pino-pretty`](package.json:27) returns the last pipeline process’s status under npm’s POSIX shell. I verified a Vite startup failure was visible but `npm run dev:pretty` exited 0. This predates the change structurally, but the new refusal now relies on it.

- **P2 — preview has not actually moved defaults.** The probe correctly runs from `configurePreviewServer`, but only `dev` and `dev:pretty` set the variable. Direct `vite preview` still defaults to files and is then refused by the production files-store guard. Add a `preview` script with the default, or change the plan/database wording that says preview moved.

- **P2 — the cost correction contains two remaining factual errors.** The summary storm began about **15h20m after** the final hierarchy storm completed, not nineteen hours. Also `$31.22` excludes 39 unpriced rows, which the cited baseline calls “unknown, not zero”; say “a third of recorded/priced spend,” not “everything we have ever spent.” The dollar totals, fifth group, and 7/4 ceiling correction otherwise check out.

- **P2 — the safety property has no persistent regression test.** The hand mutation is good evidence, but none of the named tests exercises either the package-script default or boot probe. Removing either later would leave the suite green—the exact safety regression this change prevents.

## Answers to your questions

1. `createApiMiddleware` is the right lifecycle seam, and one `select 1` is the right size. Do not skip it for worktrees, CI, preview, or `NODE_ENV=test` when a real Postgres-backed Vite server is starting. Bound it; don’t retry it.

2. `${SPIDERYARN_STORE:-postgres}` is acceptable for this Mac/Linux repo and remains useful when `.env.local` is silent. It is not a reliable one-command override when the file names a store.

3. Worktrees safely share the atomic Postgres queue. Disk-only slugs and filesystem CLI output become invisible to the default server. One additional known behavioral loss is glossary “start over,” which still answers 501 in Postgres ([`src/store/live.ts`](src/store/live.ts:183)). Direct preview behavior is unchanged. I could not independently enumerate the 22/20 slug overlap because this review sandbox blocks loopback database access.

4. Leaving `storeFromEnv` alone is the correct scoped decision. Flipping it would be the separate, much larger migration you described. The temporary split is preferable, but it means an unset-store paid CLI run can write a result the default dev server cannot see.

5. The plan needs the escape-hatch and preview wording corrected. The postmortem needs the elapsed-time and “everything spent” wording corrected; its arithmetic otherwise holds.