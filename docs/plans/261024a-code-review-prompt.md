You are reviewing code before it is pushed, in the Spideryarn repo (read CLAUDE.md for house rules). Per the house workflow, **fix what you find inside this change's scope** (edit the files directly), then report: each finding, severity, evidence (file:line), and what you changed. Report anything wider than this change for me to decide, without fixing it.

The plan, including how the build departed from it after your plan review: docs/plans/261024a-a-web-page-with-no-date-tag-gets-its-publication-date-from-its-dateline-or-its-address.md (your plan review is the -plan-review-sol.md beside it).

The diff: docs/plans/261024a-code-review.diff (src/page-date.ts is new; src/extract.ts, src/pipeline.ts, src/front-matter-authors.ts, src/types.ts, docs/project/content-extraction.md changed; tests/page-date.test.ts new; tests/publication-date.test.ts and tests/article-registry-pipeline.test.ts extended).

Check in particular:
- The address day is applied only after withArticleRegistry and only when meta has neither publishedAt nor publishedYear (src/pipeline.ts extract step; src/page-date.ts withAddressDay). Is there any other path that writes meta for a web page (e.g. keptPaperMetadata, Read this, the metadata step, backfill-registry-facts, re-extraction keeping previous facts) where the address day could be lost, double-applied, or beat a better source?
- openingHeading/openingBounds refactor in src/front-matter-authors.ts: is readOpening's behaviour byte-identical to before?
- datelineDay: any accepted form that is not a publication date, any regex that can match more than intended (case-insensitive month names like "may", "mar"), the 1990 floor, the next-UTC-day future rule.
- addressDay: path segments percent-encoded, a dashed segment that is not a date prefix, /YYYY/MM/DD followed by nothing.
- Fingerprints/freshness: only Timeline's datedArticleFingerprint reads publishedAt (src/source-hash.ts). Anything else that would now go stale or re-run paid work?
- Tests: would each new test fail if its code were wrong (silent-success)? I saw the runExtract cases and the pipeline case go red with the wiring disabled.

Run `npx vitest run tests/page-date.test.ts tests/publication-date.test.ts tests/article-registry-pipeline.test.ts tests/front-matter-authors.test.ts` and `npm run typecheck` after any edit. End with a verdict: approve / approve with changes / rework.
