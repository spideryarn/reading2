Code review of commit a686acdb (`git show a686acdb`) against its plan, docs/plans/261001n-trajectory-question-above-quote-and-highlight-on-screen-block-links.md (which includes your own plan review's findings and what was done with each, in docs/plans/261001n-plan-review-sol.md).

You may edit files: fix what you find inside this change (src/web/on-screen.ts, src/web/OnScreenLinksStyle.tsx, src/web/useReadingTime.ts, src/web/reading-time.ts, src/web/reader/Reader.tsx where OnScreenLinksStyle is mounted, src/web/styles/prose.css, src/web/TrajectoryPanel.tsx, and the tests tests/on-screen.test.ts, tests/on-screen-links-style.test.tsx, tests/trajectory-panel.test.tsx). Do not commit. Report anything wider for me to decide. After any edit run `npm run typecheck` and `npx vitest run tests/on-screen.test.ts tests/on-screen-links-style.test.tsx tests/use-reading-time.test.tsx tests/reading-time.test.ts tests/trajectory-panel.test.tsx`.

Look especially at:
- whether the move of rowsOnScreen/freshRows out of useReadingTime.ts preserved behaviour exactly (cache staleness, isConnected checks);
- OnScreenLinksStyle: effect lifecycle, the `enabled` gate in Reader (`bandOpen && fit.modeW > 0`), whether `table.zoom` exists when the effect runs (first mount, article loading, mode switches), setState after unmount, whether a key string can collide;
- the generated CSS: specificity against per-mode link styles (e.g. .cite .block-ref, .clm-jump, .crit-jump, .sk-card-jump, .summ-title, .quotes-where, .faq-jump in src/web/styles/*.css) — does the wash actually show on each, and does `opacity:1` fight a hover rule or a missing-link rule (`.block-ref-missing`) in a way that looks wrong? Should a missing (span) link be excluded?
- whether the tests would fail if the feature broke (e.g. a test that cannot go red).

Give findings P0/P1/P2 with file:line, what you changed for each, and a verdict.
