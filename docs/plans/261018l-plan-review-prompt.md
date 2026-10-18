Review the plan docs/plans/261018l-visitors-on-a-shared-link-get-the-front-and-back-matter-folds.md (read-only review).

Context: the repo is Spideryarn. Plan 261018a built front/back matter folds for the owner. Greg has now approved (reply quoted in the plan) letting visitors on a shared link get the same folds. src/public/dto.ts is a listed security defence (docs/project/security-map.md § The allowlist has two failure directions). The public import graph must not reach the model gateway (tests/public-imports.test.ts).

Read: the plan; src/matter-step.ts (matterForReader, MATTER_PROMPT_VERSION); src/matter.ts (matterInputHash, MatterBlock); src/matter-shape.ts; src/store/pg.ts loadArticle around line 2940-3000 and blocksFor; src/store/public-reader.ts (PUBLIC_PROJECTIONS, loadArticle, publicBlocksQuery); src/public/dto.ts (publicArticle, opt); src/public-types.ts (PublicArticle); src/web/article/access.ts (resolveAccess); src/web/matter-view.ts; tests/public-imports.test.ts.

Questions: Is anything sensitive or model-written crossing? Will the hash computed on the public side agree with the owner's (sanitised blocks vs raw rows; do public blocks carry every field matterInputHash reads: id, text, kind, level, words, role)? Is the leaf move sound for the public import graph? Anything the plan misses (other public surfaces, export, head/OG page, tests that pin the projection or DTO keys)? Is there a simpler design?

Answer with numbered findings, each with severity (P1/P2/P3), file:line evidence, and a fix. End with a line "VERDICT: proceed" or "VERDICT: revise".
