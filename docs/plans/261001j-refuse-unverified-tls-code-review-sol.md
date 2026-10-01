1. **P1 — constructor scan had security-relevant false negatives.** [tests/db-ssl.test.ts:302](/home/greg/code/spideryarn2/.claude/worktrees/ssl-refuse-unverified/tests/db-ssl.test.ts:302). The regex missed renamed imports and accepted arbitrary `ssl:` values or `connection.config`. **Fixed:** AST-based scanning now resolves named/default/namespace/dynamic/CommonJS imports, requires `sslDecisionFor`-derived SSL, and mutation fixtures cover aliases, variable configs, and `ssl: false` ([line 438](/home/greg/code/spideryarn2/.claude/worktrees/ssl-refuse-unverified/tests/db-ssl.test.ts:438)).

2. **P2 — documentation overstated parser behavior and described the removed health mode.** [security.md:1125](/home/greg/code/spideryarn2/.claude/worktrees/ssl-refuse-unverified/docs/project/security.md:1125), [deployment.md:683](/home/greg/code/spideryarn2/.claude/worktrees/ssl-refuse-unverified/docs/project/deployment.md:683). Installed `pg-connection-string` only makes `sslnegotiation` replace SSL when its value is `direct`; health now reports missing CA as `ssl.error` plus `TLS refused`, not an unverified mode. **Fixed** in both docs, the plan, and corresponding source comments.

No further findings:

- All earlier plan-review findings are implemented: every current `pg` constructor is guarded, migrator TLS keys are preserved for refusal, parser fallback exists, and encoded-key/scheme/migrator/runtime tests exist.
- A plain production URL produces no parsed `ssl`; the already-working production connection proves the same installed parser accepts it. With `PGSSLROOTCERT` present, it remains verified.
- Moving the deploy gate’s pool inside `try` does not change Docker-off behavior: pool construction is lazy, the query fails, cleanup runs, and the gate remains false.
- TLS refusal makes health return 503; `judgeHealth` rejects both its warning and `ssl.error`. The fleet dashboard does not consume production `/api/health`.
- “Remote verified or refused” is true for every connection in `src/` and `scripts/`.

Changed files:

- [tests/db-ssl.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/ssl-refuse-unverified/tests/db-ssl.test.ts)
- [src/db/ssl.ts](/home/greg/code/spideryarn2/.claude/worktrees/ssl-refuse-unverified/src/db/ssl.ts)
- [src/vercel-health.ts](/home/greg/code/spideryarn2/.claude/worktrees/ssl-refuse-unverified/src/vercel-health.ts)
- [docs/project/security.md](/home/greg/code/spideryarn2/.claude/worktrees/ssl-refuse-unverified/docs/project/security.md)
- [docs/project/deployment.md](/home/greg/code/spideryarn2/.claude/worktrees/ssl-refuse-unverified/docs/project/deployment.md)
- [docs/plans/261001j-refuse-unverified-tls-to-the-remote-database.md](/home/greg/code/spideryarn2/.claude/worktrees/ssl-refuse-unverified/docs/plans/261001j-refuse-unverified-tls-to-the-remote-database.md)

Checks:

- Database-free requested suites: **198 passed**.
- Documentation links: **14 passed**.
- Typecheck driver: **exit 0**, all 2,538 files covered.
- Lint on touched code: **exit 0**.
- Exact Vitest command: **exit 1**, because Docker/Postgres is inaccessible in this sandbox; `health.test.ts` could not run.
- Exact `npm run typecheck`: **exit 1**, because sandbox policy denied `tsx`’s IPC socket; the same driver via `node --import tsx` passed.
- No commit made; existing untracked review prompt untouched.

**Verdict: approve with the two fixes—remote database connections are verified or refused, with no wider issue found.**