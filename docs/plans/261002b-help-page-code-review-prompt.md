# Code review (write-capable): 261002b, the Help page

Repo: the current working directory, a git worktree of Spideryarn (React client in src/web). Review
the three commits `886812f5a..HEAD` (run `git diff 886812f5a..HEAD`). The plan is
docs/plans/261002b-help-page.md — its last section, "After GPT Sol's plan review", is the design as
built (your own plan review is docs/plans/261002b-help-page-plan-review-sol.md; check its eight
findings were actually honoured). Doc for the page: docs/project/help-page.md.

What was built: `/help` (src/web/help/*: anchors, typed content as Record<HelpTopic|Mode|FaqId,…>,
HelpPage with a grouped contents list, search via page-search.ts with a custom synonym table,
fragment arrival on mount + hashchange with scroll and flash, retired-anchor aliases); a footer link;
a route; flash.ts § scrollToAndFlash extracted from PageContents; a Help link in the Dock and a Help
row in the command bar going to the current mode's section; ~12.8k words of reader-facing content;
docs and a new deploy step in docs/project/overseer.md § Deploying (step 4).

**You may fix what you find inside this change**: narrowly, red-first where a test can show it (write
the failing test, see it fail, fix). Do not commit. Do not refactor beyond the change. Anything wider
you notice: report it, do not fix it. You have no network: tests that need Postgres will not run for
you; the ones here should be jsdom-only — run `npx vitest run tests/help-page.test.tsx
tests/dock-help-link.test.tsx tests/page-search.test.ts tests/command-bar.test.tsx
tests/site-footer.test.tsx tests/router.test.ts` and `npm run typecheck` yourself.

Look hardest at:
1. Correctness of arrival/hash handling (HelpPage.tsx): direct load, hashchange, same-hash click,
   alias rewrite, SPA navigation from the Dock (navigate() scrolls to top, then the lazy page mounts),
   Back/Forward, effects cleaned up on unmount, nothing scrolling twice.
2. Search: does it find what a reader types? Any ranking surprises? Does the generalised
   searchSections keep Metadata's behaviour exactly?
3. **Content accuracy**: sample at least 12 factual claims across src/web/help/help-topics.tsx,
   help-modes.tsx and help-faq.tsx (prefer the spine section, the gutter, waiting/cost and
   allowance claims, sharing/visitors, experimental features, keyboard shortcuts) and verify each
   against the code. A false sentence to readers is a P1. Fix wrong sentences (or delete them).
4. Accessibility: headings order, the two contents lists (only one displayed), the search status
   line, `#` links' labels, the Dock link's tooltip/aria.
5. The anchor-permanence test (PINNED_ANCHORS) and the type link from code to anchors: can a link to
   a missing anchor still slip through anywhere?
6. Docs: does help-page.md/overseer.md step 4 say anything false about the code or the changelog
   process (docs/project/changelog.md)?

Severity: P0 (harmful/wrong, must fix), P1 (should fix before landing), P2 (worth doing), P3 (nit).
Give each finding an ID (C1, C2, …), severity, file:line, and whether you FIXED it or are REPORTING
it. End with: the list of files you changed, the test commands you ran with their raw pass/fail
counts, and a one-line verdict.
