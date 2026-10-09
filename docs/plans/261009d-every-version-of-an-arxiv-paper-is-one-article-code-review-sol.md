No P1 or P2 findings.

1. **P3 — Misleading source contract comments** — [src/paper-sources.ts:34](/var/tmp/spideryarn-worktrees/fbn50aft-arxiv-dedupe/src/paper-sources.ts:34), [src/paper-sources.ts:43](/var/tmp/spideryarn-worktrees/fbn50aft-arxiv-dedupe/src/paper-sources.ts:43). The interface implied arXiv was the only source and that every source literally builds its key from `workId`. Changed it to describe the registry generally and scope the versionless-key rule to arXiv.

2. **P3 — Tracking comment overstated its guarantee** — [src/ingest.ts:67](/var/tmp/spideryarn-worktrees/fbn50aft-arxiv-dedupe/src/ingest.ts:67). `mkt_tok` and `oly_*` are audience identifiers that can support personalization, so “nothing uses [them] for content” was too absolute. Changed the comment to accurately call the additions vendor-specific attribution/audience parameters rather than page selectors. No parameter was removed: the names are consistent with their documented purposes and the existing `mc_eid`/`vero_id` policy. [Google](https://support.google.com/analytics/answer/16479993?hl=en), [Adobe](https://experienceleague.adobe.com/en/docs/marketo-developer/marketo/javascriptapi/leadtracking/lead-tracking), [Omeda](https://knowledgebase.omeda.com/omedaclientkb/cdp-olytics-overview).

The arXiv implementation and tests are otherwise sound: versions retain distinct fetch candidates, canonical URLs, and slugs while sharing the versionless key; DOI, Hugging Face, and alphaXiv aliases resolve consistently. The DB regression would fail before the fix because its stored `v1` final URL could not match the plain or `v2` key.

Checks:

- Pure focused suites: **373 passed**.
- Exact requested command: blocked before collection because the sandbox cannot access the Docker-backed test database on port 54362; `find-article.test.ts` therefore did not run here.
- `npm run typecheck`: blocked by the sandbox’s `tsx` IPC restriction; the equivalent `node --import tsx scripts/typecheck.ts` passed all **596 files**.
- `git diff --check`: passed.
- No commit made.

**Verdict:** Approve; functional behavior is correct, with only two corrected comment-level findings.