Found and fixed two P1 issues. No P0, P2, or P3 findings.

- **S5-F1 — P1 — real one-word titles could disappear.** `titleIsOnlyByline("Putnam", "Putnam", "1975")` returned true, hiding the title. The predicate now requires an author–year label containing both author and year tokens. Evidence: [WhereItSitsPanel.tsx:375](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/web/WhereItSitsPanel.tsx:375). Fixed red-first; regression: [where-it-sits.test.tsx:317](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/tests/where-it-sits.test.tsx:317).

- **S5-F2 — P1 — an empty legacy Claims result showed no count.** When Claims had no standalone list but Reception’s stored Claims section had zero rows, the tool omitted `0`, making “read and empty” look unread. The predicate now recognizes any read Reception result. Evidence: [SourcesMode.tsx:275](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/web/modes/sources/SourcesMode.tsx:275). Fixed red-first; regression: [reception-lens-in-chat.test.tsx:1076](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/tests/reception-lens-in-chat.test.tsx:1076).

The remaining attack areas held:

- The automatic Not cited request is GET-only; it reaches `relatedWorkAnswer`, which only reads loaded database state. OpenAlex is reachable only through the explicit POST handler. Back/Forward and remount coverage records no POST/job. [routes.ts:13094](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/routes.ts:13094), [related-work.ts:751](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/related-work.ts:751).
- Related-work state is slug-keyed, and the whole owned reader remounts on slug changes, preventing previous-article counts. [useRelatedWork.ts:129](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/web/useRelatedWork.ts:129), [ArticlePage.tsx:272](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/web/article/ArticlePage.tsx:272).
- The planner’s year only affects list order; headlines print `articleYear`. [WhereItSitsPanel.tsx:256](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/web/WhereItSitsPanel.tsx:256), [situate-dossier.ts:109](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/web/situate-dossier.ts:109).
- Finding passages remain native anchors with `?at=`, click-to-jump, keyboard access, and author-face styling. [SituateDossier.tsx:284](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/web/SituateDossier.tsx:284).
- Guess first exposes no kind-bearing class, attribute, count, or ordering before reveal. Both experiments retain state locally and send nothing.
- Evidence first’s radios are all `tabIndex={0}` with no arrow handler, matching the project’s deliberate keyboard contract. [SourcesExperiments.tsx:237](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/web/SourcesExperiments.tsx:237).
- Each tool retains its own part-switcher outline; the crumb CSS yields and ellipsizes while preserving chip width. [reception.css:465](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/web/styles/reception.css:465).

Validation:

- Focused jsdom suites: 4 files, 93 tests passed.
- Including the keyboard sweep: 5 files, 109 tests passed.
- Full typecheck: passed.
- Touched-file lint and `git diff --check`: passed.
- Chrome layout test could not reach its assertion: Chrome exits during sandboxed launch with `setsockopt: Operation not permitted`/SIGTRAP.
- Full `npm test` could not start because the local PostgreSQL/Docker service is inaccessible in this sandbox.

Four tracked files are modified; the pre-existing untracked Stage 5 prompt/answer files were untouched.