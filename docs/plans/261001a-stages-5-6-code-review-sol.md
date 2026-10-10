Verdict: **pass after fixes**. No unresolved release-blocking findings. I did not commit.

Findings:

- **F1 — High — weak identity checks could attach the wrong registry record.** Exact generic titles such as “Editorial,” parent-title prefixes for supplements, and publisher paths ending in `.s001` could pass. I added distinctive-title requirements, supplement/correction/chapter qualifiers, subordinate DOI rejection, and exact returned identifier/DOI validation in [citation-registry.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/src/citation-registry.ts:80) and [debate-registry.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/src/reception-registry.ts:50).

- **F2 — Medium — concurrency two did not bound wall time.** Eighty slow lookups could occupy a pipeline step for many minutes. New lookups now stop after 60 seconds; the two already running finish under `lookupWork`’s bounds. Budget omissions and elapsed time are logged, and the citation/debate lists remain intact.

- **F3 — Medium — Debate fallback and provenance were inaccurate.** A registry record with no authors erased extracted authors, while missing registry fields could still be labelled “Authors and year from Crossref/DataCite.” Fields now fall back independently and attribution names exactly which fields came from the registry in [DebatePanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/src/web/ReceptionAndClaimsPanel.tsx:1813).

- **F4 — Low — the dependency-identity test could pass if pipeline enrichment were removed entirely.** Added [registry-pipeline-wiring.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/citations-read-the-paper/tests/registry-pipeline-wiring.test.ts:1), which verifies both registered steps enrich after generation and before returning their artefacts.

Verified separately:

- Public DTOs rebuild registry records field-by-field. Citation conflicts and injected extra/owner-only fields do not cross.
- Stamps, prompt versions and model inputs remain unchanged.
- Lookup failures and budget exhaustion cannot drop the list or fail the step.
- Registry strings and author counts remain capped.
- arXiv version suffixes remain intentionally normalized by the committed shared lookup to the arXiv work identity; the stored metadata is DataCite’s work-level record, not a version snapshot.

Checks:

- 271 affected core tests passed across seven suites.
- Citation hover-card suite: 14 passed.
- `node --import tsx scripts/typecheck.ts`: passed all projects.
- `git diff --check`: passed.
- Targeted Biome lint found no new errors; only two existing unrelated advisories in `src/pipeline.ts`.
- The normal `npm run typecheck` wrapper hit sandbox IPC `EPERM`; the requested direct-node fallback passed.