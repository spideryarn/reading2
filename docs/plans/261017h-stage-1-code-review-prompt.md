# Code review: 261017h Stage 1 — Open in Sources centres and flashes; a roomier list

You are reviewing AND fixing, in this worktree. The stage is commit 8160890cf (diff it against its parent: `git show 8160890cf -- src tests` for the code; docs and the spike files in it are context, not under review). Plan: docs/plans/261017h-sources-go-to-a-work-lands-and-flashes-and-a-blurb-per-cited-work.md (Stage 1, the review section F1/F2/F9, and "What the browser pass measured"). Your round-1 plan review is docs/plans/261017h-sources-blurbs-plan-review-sol.md.

What changed: src/web/item-focus.ts (useLandOnItem: scrollerOf + centreInScroller + flashElement instead of scrollIntoView nearest), src/web/styles/prose.css (band flash inset), src/web/BibliographyPanel.tsx (CITE_LIST_NOT_READ into the (i) card), src/web/threshold.ts (hiddenNote shorter, shared by six panels), and the tests.

Look for: a scroller walk that picks the wrong element or the document (e.g. a band whose list is not overflow:auto at some width; the phone layout where the band covers the prose; .mode-band boundary); centring maths wrong when the scroller has padding/borders or the row is inside a nested positioned element (offsetTop vs getBoundingClientRect); a landing that runs before layout (clientHeight 0) and is then lost because onTaken already fired; the flash class left behind or fighting a prose flash; the (i) card condition; any reader-visible regression in the six hiddenNote panels (Search and Claims show it only when hidden); tests that would pass with the old code.

Rules: fix what is inside this stage, narrowly and red-first (write the failing test, see it fail, then fix). Report — do not fix — anything wider. You have no network: run vitest on single files yourself, e.g. `npx vitest run tests/bibliography-panel.test.tsx tests/glossary-and-bibliography-ask-in-chat.test.tsx tests/glossary-band-selection.test.tsx tests/threshold.test.ts`. Do not commit.

Severity P0/P1/P2/P3, an ID on each (S1, S2…), file:line, concrete failure scenario, and for each whether you fixed it (with the test). End with one line: "ship", "ship after fixes (made)", or "do not ship".
