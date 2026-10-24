## Findings fixed

- **M1 — P1: untrusted source URLs bypassed the HTTP(S) guard.** The margin used `source.url` directly as `href`; current React blocked the tested `javascript:` URL, but the sink still violated the protocol allowlist. It now applies `isWebUrl` and renders rejected addresses as plain text: [MarginaliaColumn.tsx](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/web/marginalia/MarginaliaColumn.tsx:725). Red-first regression: [marginalia-literature.test.tsx](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/tests/marginalia-literature.test.tsx:260).

- **M2 — P1: finding focus competed with Investigate’s automatic chat reopening.** Arriving from Marginalia could flash the requested finding while simultaneously reopening the newest conversation; an existing `?thread=` was also retained. Finding arrival now suppresses automatic reopening, and the destination press clears an open thread: [InvestigatePanel.tsx](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/web/InvestigatePanel.tsx:199), [Reader.tsx](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/src/web/reader/Reader.tsx:1812). Red-first regression: [situate-dossier.test.tsx](/var/tmp/spideryarn-worktrees/fbw95xmq-sources-situate/tests/situate-dossier.test.tsx:323).

No remaining in-scope P0–P3 findings or wider findings.

Checks:

- Requested suite, every `marginalia*` test, and the relevant Investigate integration: **19 files, 392 passed, 1 skipped**.
- Final focus follow-up: **46 passed**.
- Typecheck: **green**, using `node --import tsx scripts/typecheck.ts`; ordinary `npm run typecheck` hit the sandbox’s `tsx` pipe `EPERM`.
- Scoped lint: no errors; only existing advisory complexity/style findings.
- `git diff --check`: green.
- Full `npm test` was attempted but could not start because the sandbox forbids connecting to the local Postgres/Docker port `127.0.0.1:54362`.

Verdict: **approve after fixes**. The owner/switch/read-only gates, stale and quote placement checks, one-line grouping, tooltip provenance, and focus handback contracts are now covered and behaving as planned. No commit, push, deployment, production access, or paid call was made.