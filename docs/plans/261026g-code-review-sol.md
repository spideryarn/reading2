1. **P1 — Overview chat way-back opened Sources but did not land on the summary.** [SituateDossier.tsx](/var/tmp/spideryarn-worktrees/fbc5gvp0-where-it-sits-layout/src/web/SituateDossier.tsx:172) only recognised finding IDs. I added overview-ID recognition, put its ID on the summary box, and tested landing/flashing through the full chat way-back.

2. **P2 — The overview chat handler could become stale.** [Reader.tsx](/var/tmp/spideryarn-worktrees/fbc5gvp0-where-it-sits-layout/src/web/reader/Reader.tsx:3185) omitted `askOverview` from `investigateChats`’ dependencies. Added it.

3. **P2 — The paid composite’s race coverage was incomplete.** [modes-that-start-themselves.test.tsx](/var/tmp/spideryarn-worktrees/fbc5gvp0-where-it-sits-layout/tests/modes-that-start-themselves.test.tsx:649) now covers StrictMode, staggered reads, either missing artefact, failed-read retries, stored dossiers, and leaving before settlement. It confirms one POST per press and no stale rerun.

4. **P2 — The overview route test was vacuous.** [chat-origin-route.test.ts](/var/tmp/spideryarn-worktrees/fbc5gvp0-where-it-sits-layout/tests/chat-origin-route.test.ts:495) previously tested only the regex. I added a real route → database → summary round-trip plus malformed-ID refusals.

5. **P3 — Fold dependencies churned on every default-state render.** [SituateDossier.tsx](/var/tmp/spideryarn-worktrees/fbc5gvp0-where-it-sits-layout/src/web/SituateDossier.tsx:141) rebuilt the default `Set`, changing `setKindOpen` and rerunning the focus effect. It did not form an infinite render loop, but I memoised it and added dossier-reset/focus tests.

6. **P3 — Count-strip controls did not expose their fold relationship.** [SituateDossier.tsx](/var/tmp/spideryarn-worktrees/fbc5gvp0-where-it-sits-layout/src/web/SituateDossier.tsx:290) now supplies `aria-expanded` and `aria-controls`. Native `<details>/<summary>` keyboard behaviour remains intact.

7. **P3 — Comments and docs still described the old Bibliography-only/manual-search contract.** Corrected [activation.ts](/var/tmp/spideryarn-worktrees/fbc5gvp0-where-it-sits-layout/src/web/activation.ts:592), [WhereItSitsPanel.tsx](/var/tmp/spideryarn-worktrees/fbc5gvp0-where-it-sits-layout/src/web/WhereItSitsPanel.tsx:28), Sources/privacy/help docs, and related comments.

The spend path is sound: non-press navigation mints no `sources-where` token; Bibliography’s mounted auto-run watches a different token; atomic consumption prevents StrictMode duplicates; stale/outdated dossiers remain `ready`; and `precededBy: ["bibliography"]` is type-correct and produces the server-ordered `["bibliography", "situate"]` job.

Checks:

- Focused suites: 287 passed, 1 skipped.
- Typecheck: all 4,039 source files passed.
- Hook-dependency lint and `git diff --check`: passed.
- Help corpus regeneration: passed.
- Full lint remains at the repository baseline: 123 errors and 178 warnings.
- The new Postgres route test could not run because this sandbox cannot reach Docker/local Postgres (`EPERM` on port 54362). The schema and migration CHECKs were inspected and already admit the `situate` item shape.

No wider product decision is needed.

**Verdict: APPROVE WITH FIXES — no remaining correctness or money-path blocker; only the unavailable Postgres execution remains to verify.**