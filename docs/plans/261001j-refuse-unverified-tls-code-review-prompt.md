Code review of a security change, with permission to fix what you find inside its scope.

The change: commit bdd6b4fa in this worktree (`git show bdd6b4fa`). The plan, with your earlier
plan review folded in: docs/plans/261001j-refuse-unverified-tls-to-the-remote-database.md. Your
plan review: docs/plans/261001j-refuse-unverified-tls-plan-review-sol.md.

Greg's constraint: "as long as the cure isn't worse than the disease". Production must not break:
it reports ssl.mode "verified" today, with PGSSLROOTCERT set and no query string on DATABASE_URL.

What to check, against the installed node_modules/pg and pg-connection-string, not from memory:
1. Can any remote connection in src/ or scripts/ still end up unverified, or refused when it
   should not be? Including the new parser check in sslDecisionFor (could parseConnectionString
   set `ssl` for an ordinary production URL with no query string? could it throw on one?).
2. Each of the plan-review findings: is it actually fixed in the code, not only in the plan?
3. The constructor-scan test in tests/db-ssl.test.ts: can it pass while a constructor is
   unguarded (e.g. a multi-line config built in a variable, `new pg.Pool`, an import alias)? It
   was mutation-checked once by removing ssl from one spike.
4. scripts/deploy.ts local-database gate: does moving the Pool construction inside the try change
   the gate's behaviour on a laptop with Docker off?
5. Health: a refusal now pushes a warning; does anything else (tests, deploy judgeHealth, the
   fleet dashboard) treat that change badly?
6. Docs (security.md § database-tls, security-map row, deployment.md, database.md): anything
   claimed that the code does not do? The conclusion too — is "verified or refused" true?

Fix what you find, within this change's files, and run the relevant tests:
  npx vitest run tests/db-ssl.test.ts tests/deploy-checks.test.ts tests/health.test.ts tests/feedback-reporter.test.ts
  npm run typecheck   (judge by exit code)
Do not commit. Report anything wider for me to decide.

Answer: numbered findings, each P0/P1/P2 with file:line and evidence, and for each whether you
fixed it. List every file you changed. End with a one-line verdict.
