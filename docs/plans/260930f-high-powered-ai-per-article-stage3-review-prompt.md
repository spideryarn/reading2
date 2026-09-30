# Code review, Stage 3: 260930f high-powered AI per article

CANDIDATE: the client and docs half of commit 8784aeee (parent 9b611dfe). `git show --stat 8784aeee`
lists every path; the server files in it (labels.ts, hierarchy-*.ts, models.ts and their tests) were
YOUR fixes from the previous round and are not under review again. Review: src/web/HighPowerSwitch.tsx,
src/web/Metadata.tsx (the mount in RerunSection), tests/metadata-high-power-switch.test.tsx,
docs/project/high-powered-ai.md, the docs signposts, docs/user-feedback/awaiting-approval.md's 6C line,
and the plan's Stage 3 and § Deferred. Plan: docs/plans/260930f-high-powered-ai-per-article.md. The
server contract it talks to: `PUT /api/admin/article/:slug/high-power` in src/routes.ts, and
`highPowerSince` on ArticleMetadata (src/types.ts).

## What to attack (independent pass first)

1. The switch: visible only to the admin; shows the server's answer, not the click; race between a
   save and the page's refresh; double click; failure path; accessibility (label, aria-live).
2. Does the reader-facing copy on the page (and in the doc) claim anything the server does not do?
   E.g. which modes move, "nothing re-runs by itself", the cost claim.
3. docs/project/high-powered-ai.md: every claim traced against the code (file, function, behaviour).
4. The deferred billing write-up (plan § Deferred): accurate to docs/project/billing.md and
   src/store/pg-billing.ts? Does "one-time charge of one extra article, half if public" actually
   produce Greg's arithmetic (two docs private, one public)?
5. Anything simpler.

## Fix, narrowly

Fix what is inside this stage, red-first where it is behaviour. Report, do not fix, anything wider.
Run `node --import tsx scripts/typecheck.ts` and the pure test files you touch. Do not commit.

## Output

Findings with IDs (F1…; continue numbering from nothing — this round's IDs are S3-F1…), severity
(P0 data loss/exploitable security/incorrect charging/broadly unusable; P1 user-visible wrong behaviour
or authoritative contract violated; P2 design risk; P3 prose), file:line evidence, fixed or not (files
touched). Refuse only on an established P0/P1. End with `VERDICT: ship` or `VERDICT: fix-first`.
