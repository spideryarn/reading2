No functional owner/visitor, routing, spend, focus, count, or C1 paragraph-join bug remains. I made three narrow fixes and found three non-blocking follow-ups.

## Findings

- **C1 — P2 — FIXED** — [visitor.ts](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/visitor.ts:342)  
  The visitor empty state exposed retired storage names: “a list of citations or a debate.” A public article with none of the three artefacts therefore described the merged mode incorrectly. It now says “a Bibliography, a Reception search or a Claims list.”  
  Red/green coverage: [visitor-gaps.test.ts](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/tests/visitor-gaps.test.ts:388) and [public-network-trace.test.tsx](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/tests/public-network-trace.test.tsx:964).

- **C2 — P1 — FIXED** — [PeerReviewMode.tsx](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/modes/peer-review/PeerReviewMode.tsx:176)  
  C1’s unit tests covered the paragraph join, but none went through the real owner or visitor wrapper. Removing either production `citedIn` prop still left the prior suite green, so C1 could silently disappear from one audience. Added real-wrapper tests for both audiences and presses. I mutation-tested each production prop: each removal now fails its corresponding test.  
  Tests: [rewrite-hold.test.tsx](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/tests/rewrite-hold.test.tsx:1040) and [debate-navigation.test.tsx](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/tests/reception-navigation.test.tsx:272).

- **C3 — P2 — FIXED** — [ai-words.md](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/help/pages/ai-words.md:18), [faq-beyond-the-article.md](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/help/pages/questions/faq-beyond-the-article.md:8), [peer-review.md](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/help/pages/modes/peer-review.md:18)  
  Help falsely said Claims came entirely from the web and that every sub-mode was generated on first selection. In reality, Claims is extracted from the article, only explicit checks search the web, and Bibliography is normally queued during import. Corrected the Help pages, regenerated the Help corpus, and updated matching unprotected project docs/comments.  
  Red/green coverage: [help-page.test.tsx](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/tests/help-page.test.tsx:443), plus `tests/help-corpus.test.ts` and `tests/doc-links.test.ts`.

- **C4 — P2 — REPORTED** — [peer-review.md](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/help/pages/modes/peer-review.md:14), [help-images.ts](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/help/help-images.ts:276)  
  The Bibliography and Claims screenshots are pre-merge and their metadata still names `?mode=citations` and `?mode=debate`. They do not show the new three-chip Peer review header. Fix requires refreshing the image assets, outside this review’s narrow code scope.

- **C5 — P2 — REPORTED** — [reading-view-overview.md](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/docs/project/reading-view-overview.md:194), [url-state.md](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/docs/project/url-state.md:94)  
  Protected rule docs still say Claims is entirely web-derived, use present-tense “Debate mode,” and omit `peer-review` from the list of persistent sub-mode parameters. I left these untouched because the repository requires approval of exact before/after wording for rule-doc edits.

- **C6 — P2 — REPORTED** — [peer-review-focus.test.ts](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/tests/peer-review-focus.test.ts:15), [Reader.tsx](/var/tmp/spideryarn-worktrees/fbc2qmbg-peer-review-mode/src/web/reader/Reader.tsx:1633)  
  The pure focus rule is tested, but its Reader integration is not. If Reader stopped passing `subNav["peer-review"]` into the lifecycle effect, the unit test would remain green and a focus could stick across sub-modes. Current production wiring is correct; this is test hardening, not a present behavior bug.

The specific suspicions checked clean: hidden sub-modes do not auto-run; the default Dock press arms Citations/Bibliography; Peer review is visible with Experimental off; legacy Debate last-view URLs lift correctly; visitor C1 opens Bibliography through shared Reader state; counts, Marginalia wording, and rerun labels agree with their lists.

Verification:

- Focused peer-review suite: **415 passed, 1 skipped**
- Full rewrite-hold suite: **401 passed, 18 skipped**
- Help corpus/doc links: **24 passed, 1 skipped**
- Typecheck: **all 3,596 source files covered**
- `git diff --check`: clean
- `npm test` could not start because its global setup could not reach local Postgres at `127.0.0.1:54362`; please run `npm test` where that database is available.
- No commit made. Unrelated concurrent feedback/generated-file modifications were left untouched.

**Verdict: LAND AFTER FIXES ABOVE**