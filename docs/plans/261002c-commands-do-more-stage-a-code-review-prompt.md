# Code review (review AND fix): 261002c Stage A, plus the Stage D eval's spend declaration

You are a reviewer-fixer in this worktree. The plan is `docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md` (read Stage A and the Review ledger F1–F10 — your own earlier plan review is `docs/plans/261002c-commands-do-more-plan-review-sol.md`).

**Candidate (committed):**
- `ad2249afc` — Stage A. `git show --stat ad2249afc`; diff `git diff ad2249afc~1 ad2249afc`. Start with src/web/CommandBar.tsx, src/web/command-match.ts, src/web/rerun-commands.ts (new), src/web/PageContents.tsx (useRevealOnArrival), src/web/Metadata.tsx, src/web/params.ts, src/web/last-view.ts, src/web/useStepJob.ts (stepRunRequest), src/web/router.ts, and the tests tests/command-bar-rerun-and-find.test.tsx, tests/command-match-rerun-and-find.test.ts, tests/metadata-section-param.test.tsx. The list does not limit scope.
- `6f88653b0` — Stage D, a paid eval. Review only `src/spend-declarations.ts`'s new `command-pick-jev` declaration and `evals/command-pick/jev.ts` for whether spend is declared and recorded correctly (compare `shelf-topics-jev`).
- Uncommitted in the tree: docs/project/reading-view-overview.md § The command bar has new paragraphs describing Stage A (check they are true); docs/project/chat-llm-help-commands-vision.md (new, untracked) — check only its factual claims about the code.

**What I want:** an independent attack first. Does each Stage A item do what the plan says, and does anything report success while doing nothing (a press with no visible effect, a reveal that silently gives up, a refusal that vanishes)? Can one press make two POSTs, or a POST with the wrong body (compare exactly with what Metadata's RerunRow sends via useStepJob.start)? Is `?section=` safe as a URL anyone can link to (it must never start work)? Is `find <words>` correctly encoded into the URL (special characters, &, #, quotes, unicode) and does Search actually read it on arrival? Types: is the outcome union exhaustive, is anything optional that should be required?

**Fix what is inside this stage**, narrowly, red-first (write or adjust a test, watch it fail, fix, watch it pass). **Report, do not fix**, anything wider. You can run jsdom/vitest test files that need nothing outside the tree: `npx vitest run tests/command-bar-rerun-and-find.test.tsx tests/command-match-rerun-and-find.test.ts tests/metadata-section-param.test.tsx tests/command-bar.test.tsx tests/command-match.test.ts tests/last-view.test.ts` and `npm run typecheck`. Do not commit; do not run git commands that change history or the index.

Severity (by consequence): P0 data loss / exploitable security / incorrect charging / broadly unusable; P1 user-visible wrong behaviour or an authoritative contract violated; P2 design/maintainability risk; P3 prose. Every finding gets an ID continuing from F10 (F11, F12, …), severity, established or reasoned, evidence with file:line, and what you did (fixed + test name / reported). End with a verdict and the list of files you changed.

## My own suspicions (worth less — spend most of the run elsewhere)

1. If the reader presses Escape while the POST is out, the navigation to Metadata still happens on success (it is inside `run`). Should a closed bar still navigate? I lean: no navigation if the bar was dismissed, but the run has started, so something must still say so — or keep navigating. Your call; justify.
2. CommandBar holds a quiet `useJobs` — does it re-render the open bar on every job-list change, and does mounting it change polling for the whole page?
3. `withSection` and `findRow` edit the query string as text.
4. `useRevealOnArrival`: flushSync + MutationObserver + a 15 s give-up — races, leaks, or a reveal on every later mutation?
