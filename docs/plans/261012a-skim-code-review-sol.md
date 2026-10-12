F1 — Medium — [tests/skim-purpose-line.test.tsx:297](/var/tmp/spideryarn-worktrees/qika756pt3-skim-pass-intro-public/tests/skim-purpose-line.test.tsx:297) — Fixed. The visitor test covered only Gist, so always rendering `intros[0]` passed. It now checks Gist, More, and Most. A deliberate first-intro regression made it fail.

Security review found no leakage: `publicSkim` copies only stops, optional `intros`, and `offered`. Deliberately dropping `intros` failed `public-dto`; deliberately spreading `skim` exposed `profileHash`, `dropped`, and provenance and also failed.

Verification: 112 focused unit tests passed; typecheck passed. The Postgres test could not run because no local database was available, but its exact payload assertion was inspected. No remaining stale current documentation found; historical plans/questions correctly retain their original wording.

LAND WITH FIXES