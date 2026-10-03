Reviewed and fixed the three scoped files. No P0 findings.

1. **P1 — Both plan commands will fail with the production app role.** They use an email, but that role cannot read `auth.users`. I changed the failure to roll back cleanly and explicitly request the UUID. The `.env.prod` extraction itself matches the current file format. The wider plan commands still need `--owner <uuid>`.

2. **P1 — Proposed input counted articles, not distinct works.** Exact copies could consume the 150-item cap and appear multiple times in the prompt. Changed to deduplicate by stored text hash, cap at 150 works, use the newest copy’s reader-visible title and gist/abstract, then expand memberships back to every shelf card.

3. **P1 — Invalid stored score maps were applied.** Scores outside integer `0–3`, or incomplete stored result rows, could disagree with the route. Added the route’s validity checks and program-list fallback.

4. **P1 — Small shelves and model failures behaved incorrectly.** Shelves below eight works still triggered a paid call, while failed calls prevented the comparison from printing. Small shelves now skip the call; failures print today’s list beside an explicit failure, expose no provider text, and exit nonzero.

5. **P1 — Untrusted titles/model labels could emit terminal control characters.** Added sanitisation before printing labels and `--members` titles.

6. **P2 — Output could mislead.** Fixed truncated table captions and changed missing cost data from `$0.0000` to `cost not reported`.

Safety checks confirmed verified TLS refusal behavior, password redaction, import-only execution without opening a database pool, no spend sink/database write, and query order `begin read only → reads → rollback`.

Verification: typecheck passed; 150 focused tests passed; mocked normal, empty, below-eight, invalid-score, failed-call, exact-copy, and sensitive-output paths passed. Full `npm test` could not start database lanes because sandbox networking returned `EPERM`. The changes remain uncommitted because the shared Git directory is read-only and cannot create `index.lock`; unrelated working-tree changes were untouched.

Safe for Greg to run against production? **Yes—use the owner UUID; the email commands will safely refuse.**