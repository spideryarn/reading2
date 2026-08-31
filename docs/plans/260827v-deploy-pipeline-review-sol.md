Verdict: revise before build. The overall migration-first, push-and-verify shape is defensible, but several checks are not pinned to the deployment they claim to verify.

## Design-changing findings

1. **Critical — the captured SHA is not actually pinned end to end.**

The plan captures a SHA, then later runs plain `git push origin main` ([plan lines 197–203](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827v-deploy-pipeline.md:197>), [249–260](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827v-deploy-pipeline.md:249>)). Another agent can commit during the 30-second test run or migration. The push then ships the new `main`, while the gates, migrations, and polling still refer to the old SHA.

Also, querying deployments only by SHA can select an older deployment or redeployment of that SHA.

Do this instead:

- Serialize deploy commands with a local lock.
- Keep the worktree through migration.
- Read and apply migration files from that worktree, not the changing main tree.
- Push the captured object explicitly: `git push origin "$sha":refs/heads/main`.
- Require the returned deployment to have been created after this push.
- Capture the previously serving deployment ID before any migration.
- Stamp and verify `VERCEL_DEPLOYMENT_ID`, not only the SHA.

2. **High — the proposed build command does not feed the stamp to both builds.**

This assignment:

```sh
SPIDERYARN_BUILD_COMMIT=... npm run build && npx vite build ...
```

only exports the variable to `npm run build`. The API build after `&&` does not inherit it ([plan lines 364–375](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827v-deploy-pipeline.md:364>)).

The fallback also fails for working-tree deployments: `.git` is excluded from uploads ([.vercelignore line 12](</Users/greg/Dropbox/dev/experim/spideryarn2/.vercelignore:12>)), so the remote build need not have a repository for `git rev-parse HEAD`. Worse, the build may continue with an empty value.

Use a small build wrapper which:

- resolves commit once and fails if unavailable;
- resolves `VERCEL_DEPLOYMENT_ID` once;
- resolves `builtAt` once;
- invokes both Vite builds with the same explicit environment.

For Git deployments, the underlying premise is fine: Vercel uses a real shallow clone, and `VERCEL_GIT_COMMIT_SHA` is available at build time. [Vercel build documentation](https://vercel.com/docs/builds/configure-a-build), [system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables).

For direct `vercel deploy`, decide whether the stamp means HEAD or the uploaded working tree. HEAD is not truthful when the tree is dirty.

3. **High — the worktree protects committed source, but the proposed gate is neither hermetic nor harmless to the shared tree.**

Git itself is fine: linked worktrees have separate `HEAD` and index files, so `--detach` does not alter the main index or create a branch. It does write shared administrative state under `.git/worktrees/`. A live worktree is not prunable; `git worktree add --lock` explicitly closes the creation/prune race. [Git worktree documentation](https://git-scm.com/docs/git-worktree).

The symlinks are the problem ([plan lines 205–220](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827v-deploy-pipeline.md:205>)):

- A shared `node_modules` can represent a different lockfile. At review time, `package.json` and `package-lock.json` are both modified, proving this window is real.
- Another agent can change `node_modules` during the gate.
- Vite and `.bin` symlink resolution should work mechanically; dependency identity is what is unsound.
- Symlinking `data/` lets tests write into and delete from the main tree. Tests explicitly create and remove directories under `process.cwd()/data` ([api.test.ts line 177](</Users/greg/Dropbox/dev/experim/spideryarn2/tests/api.test.ts:177>), [store-import-convergence.test.ts line 81](</Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-import-convergence.test.ts:81>)).

Use `npm ci` in a lockfile-keyed isolated dependency tree, and copy the 25 MB `data/` snapshot instead of symlinking it.

The `.env.local` compromise is high risk as a gate. Several database suites silently become `describe.skip` when the local database is unavailable ([db-transaction-errors.test.ts lines 32–52](</Users/greg/Dropbox/dev/experim/spideryarn2/tests/db-transaction-errors.test.ts:32>)). A deploy run can therefore say “green” while omitting the database tests. Deploy mode must turn those skips into failures, or report and gate on an expected test/skip count.

4. **High — migration-first is right only under a contract the plan does not enforce.**

I found no already-written migration whose actual historical rollout proves the ordering wrong. Migration `0014` shows why “additive” is not enough, though: it adds `jobs.work_key text NOT NULL` without a default ([0014 line 26](</Users/greg/Dropbox/dev/experim/spideryarn2/drizzle/0014_uploads_and_job_work_key.sql:26>)). It was safe only because the table was measured empty. The same statement against an old writer would break it immediately.

Since Greg rejected a destructive-SQL gate, add a different gate: every pending migration must carry an explicit old-and-new-code compatibility attestation. That preserves his decision without treating syntax as compatibility.

The ledger check is also too weak. Drizzle reads only the latest `created_at`, ignores applied hashes, and then applies everything newer ([dialect.js lines 56–70](</Users/greg/Dropbox/dev/experim/spideryarn2/node_modules/drizzle-orm/pg-core/dialect.js:56>)). “Count moved by N” can pass over a divergent history. Verify that every applied `(created_at, hash)` is an exact prefix of the SHA’s journal and SQL files before migrating.

Add a database advisory lock too; two deploy processes can otherwise both discover the same pending set.

If migration succeeds and the Vercel build fails, the script must not print a generic failure. It should say:

> SCHEMA ADVANCED; CODE NOT DEPLOYED. Production still serves deployment X. Do not roll the schema back; fix forward or redeploy this SHA.

That half-deployment is the correct trade only because the migration was backward-compatible.

5. **High — several smoke checks can still vouch for the historical failure modes.**

The most important changes to §6:

- `/api/health`: also require the existing runtime `commit`, compiled `build.commit`, and `build.deploymentId` to match expectations; require `sawUrl === "/api/health"` and `region === "lhr1"`. The endpoint already reports these fields ([vercel-health.ts lines 505–524](</Users/greg/Dropbox/dev/experim/spideryarn2/src/vercel-health.ts:505>), except the proposed deployment ID).
- Client environment: `builtAt` proves only that a build happened. It does not prove `VITE_SUPABASE_*` was present. Make the client build fail when those variables are absent, using safe dummy values in the local gate.
- Multi-segment API routing: neither `/api/library` nor `/api/jobs` exercises it. Add an unauthenticated request such as `/api/__deploy-smoke__/<deploymentId>` and expect the application’s JSON 401. That simultaneously proves the catch-all, auth, and logging paths.
- Body probe: `bytes > 0` is too weak. Require status 200, `ok:true`, the exact byte count, exact `contentLength`, `parsedAsJson:true`, `helpersDisabled:true`, and `truncated:false`.
- Root: require HTML content type, `<title>Spideryarn</title>`, `#root`, and at least one JS asset. A zero-asset extraction must fail.
- Asset scan: assert a non-empty set and recursively include emitted chunks if code splitting appears.
- `robots.txt`: require the expected `Disallow: /` body, not merely `text/plain`.

`/build.json` will not be swallowed by the SPA rewrite: Vercel gives real filesystem files precedence over rewrites. [Vercel configuration documentation](https://vercel.com/docs/project-configuration/vercel-json).

Caching can still confuse a same-SHA redeploy. Include the unique deployment ID in `build.json`, request it with a deployment-ID query parameter, and compare the body’s deployment ID. Vercel exposes that ID at build time. [Vercel system variables](https://vercel.com/docs/environment-variables/system-environment-variables).

I am not concerned that a genuinely old compiled API could magically report a newer compiled literal. If implemented as a literal, staleness fails closed. Test that by building with stamp A, running with runtime environment B, and requiring A.

6. **High — the log check misses this application’s Pino errors.**

Pino writes through one synchronous stdout destination ([log.ts line 150](</Users/greg/Dropbox/dev/experim/spideryarn2/src/log.ts:150>)). Therefore `log.error(...)` is still stdout. Vercel classifies log level from stdout/stderr, not from the JSON body’s `level` field. An application Pino error can consequently have outer Vercel level `info`. [Vercel runtime-log rules](https://vercel.com/docs/logs/runtime).

The script must inspect all three:

- outer Vercel `level`;
- request status, especially 5xx;
- parsed inner Pino JSON `message.level`.

Use the native `--deployment <id>` filter rather than querying the project and filtering afterwards. [Current CLI documentation](https://vercel.com/docs/cli/logs).

“No rows” must be a failed verification, not a pass or ordinary warning. Retry for ingestion delay and require the unique smoke path’s 401 log to appear. Report the overall state as “deployed, log verification failed.”

Finally, do not run `vercel@latest` in a release path. Pin the measured version as a dev dependency; otherwise the deployment tool changes without a repository change.

7. **The rollback state and red baseline must be preflight blockers.**

Printing the rollback warning after failure is too late ([plan lines 310–312](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827v-deploy-pipeline.md:310>)). Check auto-assignment before migrations. If it is off, abort before touching the database.

Vercel confirms rollback disables it and that promoting a deployment re-enables it. [Instant rollback documentation](https://vercel.com/docs/instant-rollback). The project API appears to expose `autoAssignCustomDomains`, but I did not verify that field against the live API because network access from the shell was unavailable. `vercel rollback status` documents pending rollback status; I am not sure it reliably reports the persistent post-rollback disabled state.

The red-baseline sequence is coherent for development, but not for activation. Do not add/document `npm run deploy` until tests and typecheck are green in the same landing unit. Otherwise the first use necessarily teaches `--force-gate`. The plan itself recognizes the contradiction ([lines 142–153](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827v-deploy-pipeline.md:142>)).

## Questions the plan should put to Greg

- Must deployment be serialized, with the exact captured SHA pushed even if another agent commits meanwhile?
- Is a per-migration old/new compatibility declaration acceptable, distinct from the rejected destructive-SQL gate?
- Should “deployed but verification/log collection failed” exit non-zero?
- Is direct working-tree `vercel deploy` expected to carry a truthful content identity, or may its commit field be explicitly null?
- Must database-test skips fail a deploy gate?
- Should rollback recovery be automatic promotion, or should deploy stop and print the explicit recovery command?
- Must fixing the red baseline and activating `npm run deploy` land together?

No files were modified.