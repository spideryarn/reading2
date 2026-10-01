You are reviewing a PLAN (read-only) for the Spideryarn repo in the current directory. Read CLAUDE.md for house rules.

The plan: docs/plans/261001l-quieter-experimental-switch-tooltips-on-the-vertical-lines-readers-only-filter-in-admin-feedback.md — three small admin suggestions (quieter Experimental switch in the bottom bar; tooltips on vertical lines beside blocks; a readers-only filter in /admin/feedback).

Relevant code: src/web/Dock.tsx § DockExperimentalSwitch and SWITCH_LOOK, src/web/styles/dock.css (.dock-btn.on, .dock-switch), tests/dock-experimental-switch.test.tsx; src/web/BlockGutter.tsx (.blk-read span), src/web/styles/gutter.css § reading time (.blk-gutter > span.blk-read and its ::after), docs/project/reading-time.md, src/web/annotations/AnnotationsColumn.tsx and src/web/styles/marginalia.css (.marg-question); src/admin.ts (isAdmin, ADMIN_USER_IDS), src/store/pg-admin-feedback.ts (listFeedbackAcrossOwners), src/store/contracts.ts, src/routes.ts (GET /api/admin/feedback, and the /api/admin gate), src/web/useAdminFeedback.ts, src/web/AdminPage.tsx § AdminFeedbackPage, tests/admin-feedback-store.test.ts and whatever route tests cover /api/admin/feedback.

Check especially:
1. Is the plan's reading of which line Greg means plausible, and is the CSS analysis of the reading-time hover strip correct (does the strip really not cover the line)? Is the proposed geometry fix right, and does it collide with the gutter's controls' hit areas or with the ".." open state?
2. Dropping `.on` from the Experimental button: does anything else (fit ladder dock-fit.css, fitSignature, tests) depend on that class on this button?
3. The admin filter: correctness of keyset paging with a NOT IN predicate; the 400 on unknown `from`; does the client correctly reset/carry the cursor and race between toggle and an in-flight loadMore (useAdminFeedback uses a busy ref which would DROP a toggle-triggered reload while a page is in flight — is that a bug to design around?); any security implication (it must not change who reaches /admin).
4. Anything simpler we missed, or a silent-success shape.

Output: a numbered list of findings, each with severity (P0/P1/P2), the evidence (file:line), and the concrete change to the plan. Be concise. End with a one-line verdict.
