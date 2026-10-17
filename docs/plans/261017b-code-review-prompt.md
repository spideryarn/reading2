You are reviewing and fixing code in the Spideryarn repo, this working tree (a git worktree; branch HEAD). You may edit files to fix what you find INSIDE this change; do not commit.

The candidate is two commits: be8f2b5a6 (stage 1) and d85827faf (stage 2), on top of 2865dde17.
  git diff 2865dde17 d85827faf --stat
  git diff 2865dde17 d85827faf -- src tests evals/extraction docs/project
Start with: src/challenge-page.ts, tests/extract-challenge-page.test.ts, src/web/save-page-bookmarklet.ts, src/web/SavePageBookmarklet.tsx, src/web/UploadInstead.tsx, tests/save-page-bookmarklet.test.ts, tests/save-page-bookmarklet-link.test.tsx, src/web/help/pages/adding-articles.md. That list does not limit scope.

The spec is the plan docs/plans/261017b-a-refused-site-the-free-copy-and-the-bookmarklet-after-greg-s-reply.md (your two plan reviews are 261017b-plan-review-sol.md and 261017b-plan-review-2-sol.md). One change since your round 2: the bookmarklet no longer inserts a <base>; it rewrites src/href/poster/data-src/srcset to absolute against the live document.baseURI and leaves href="#…" alone, because with a <base> and no document URL Readability resolved in-page footnote links to the publisher (the plan's Stage 2 step 1 says why). Read the plan as a reviewer of its conclusions too.

Constraint: this run may not edit any defence listed in docs/project/security-map.md § Where the defences physically live (src/fetch.ts, the upload path, src/web/lib/api.ts, the sanitiser files…). If a fix would need that, report it, don't make it.

Attack independently first. Bookmarklet: does the stringified function actually run as a bookmarklet in Chrome, Firefox and Safari as built (encodeURIComponent of the whole body, `void (fn)(window,N)`)? Does the production build (Vite/esbuild minification) rewrite savePageForSpideryarn's body into something that references module-scope helpers, so its toString() is broken in prod? Check by building or by reasoning from the config, and if it is, fix it robustly. Correctness of the address rewriting (srcset splitting on commas inside URLs, data: in srcset, href on <link>/<area>/<use xlink:href>, protocol-relative, whitespace); anything that still deletes article content or keeps a credential; size check; filename; the anchor's drag-to-install vs click prevention; the (pointer: fine) gate and test environments; React 19's javascript: URL handling. Recognisers: false positives on real articles, upload with url null, the order vs other refusals. Help text: is everything it claims true (e.g. "The file itself is kept for you alone, even if you share the article" — check GET /api/source/:slug and the public routes)?

My own suspicions, worth less: (1) the production build mangling toString(); (2) srcset parsing; (3) whether removing value from type=submit/button inputs matters.

You can run tests that need nothing outside the tree: npx vitest run tests/save-page-bookmarklet.test.ts tests/save-page-bookmarklet-link.test.tsx tests/extract-challenge-page.test.ts (the last is slow). A finding you reproduced outranks one you reasoned.

Fix what is inside this change, narrowly, test first (show the red). Report anything wider without fixing it.

Severity: P0 data loss/exploitable security/service unusable; P1 user-visible wrong behaviour or authoritative contract violated; P2 design risk; P3 prose. Mark established/reasoned. Findings numbered C1, C2…, each: severity, established/reasoned, evidence file:line, and FIXED (with the files you changed) or REPORTED. End with a verdict line: SHIP, SHIP AFTER FIXES (MADE), or REWORK.
