# Code review 2 — Trajectory stage 2 (the client mode)

You are the reviewer **and the fixer** for this stage. The house rule: fix what is inside this stage, narrowly and red-first, and **report, do not fix**, anything wider you notice. Do not commit. Do not touch any database or the network.

## The candidate

Commit `64595ca9`. Use `git show 64595ca9 --stat` for the full list. Start with:

- `src/web/trajectory-route.ts`, `src/web/useTrajectory.ts`, `src/web/TrajectoryPanel.tsx`, `src/web/modes/trajectory/TrajectoryMode.tsx`;
- `src/web/keynav.ts`, `src/web/params.ts`, `src/web/reader/Reader.tsx`, `src/web/reader/passages.ts`, `src/web/search-hits.ts`, `src/web/TableView.tsx`, `src/web/styles/narrow-window.css`;
- the tests `tests/trajectory-route.test.ts`, `tests/trajectory-panel.test.tsx`, `tests/keynav-horizontal.test.ts`.

This list does not limit your scope. Earlier commits (`868ae017`, `669deefe`) are stage 1, already reviewed; `docs/plans/260928a-trajectory-mode-code-review-1-sol.md` has the ledger.

The spec is `docs/plans/260928a-trajectory-mode-skim-a-paper-at-increasing-depth.md` § What v1 is › The mode (client), and Stages item 2. The checklist is `docs/project/mode.md`. The precedent is FAQ's stage 2, `0e947eb4`.

## Evidence already gathered by me

- `npm run typecheck` exited 0. The 30 scoped test files passed (819 tests).
- A full `npm test` was run after the commit; its result is appended at the foot of this file if it arrived before you started.
- A browser check with Playwright at 1440, 1024×1366, 820×1180 and 420 wide, on a real article, passed items 2–8:
  - the pinned head;
  - stepping, marking and scroll-to-top;
  - depth up from the last Gist stop landing on the first new More stop;
  - Back undoing a depth change;
  - the door, and "Go round again";
  - ← / → stepping while ↑ / ↓ stay the article's;
  - at 420, the band stepping aside with an "All stops" way back;
  - no overlap on iPad widths.

  Observations from that check: tap targets are 36px, the house control height. At Most, consecutive rows often repeat the same section path ("4.1 … ×3"). A deep link opens the mode with the switch off, which is documented policy (experimental-features.md: hidden from the controls, not unreachable).

## What to attack

An independent pass first:

- the depth-change and step rules against the plan;
- history semantics (a depth change pushes, a step replaces, depth and stop written in one update, a stale `stop` falls back);
- the `PassageSlots` reset lifecycle when leaving the mode or switching article;
- the `band-away` flag: can it strand a reader with no band and no way back — for example on resize from narrow to wide, on a mode change, or when the route is rebuilt;
- the door's after-block slot in `TableView` (does it render for visitors, or in other modes?);
- the ← / → seam (a stale ref, focus in inputs, the command bar);
- auto-run and `precededBy` (spending: could anything start a paid run without a press or an open of the mode?);
- outdated/rebuild states;
- whether the card's `how` sentence is true of the code;
- a11y of the segmented control and the rows.

## Two fixes I am asking for, in-stage

1. **Remove the client copy of `sectionPathOf`.** Move the pure section-path function out of `src/trajectory.ts` into a small pure module that both the server and `src/web/` can import. `src/trajectory.ts` imports `node:crypto`, which is why the client copied it. Delete the copy and the test that pinned the two together, and keep one test of the function.
2. **Repeated section paths at Most.** When a row's section path is the same as the row above's, draw it muted or elided (e.g. a "〃"-style continuation, or the path dimmed) rather than repeated in full. Keep it readable to a screen reader. Small and CSS-first.

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0/P1. IDs continue from **F15**.

You can run pure tests yourself (`npx vitest run <file>`). Postgres-backed tests will not work in your sandbox.

## Output

For each finding: the ID, the severity, the evidence (file:line), and either **fixed** (what changed, and the red → green test) or **reported**. End with a verdict and the list of files you changed.

## My suspicions (worth less; spend most of the run elsewhere)

- `bandAway` surviving a resize to a wide window.
- The door showing in modes other than Trajectory.

## Full suite result (after the commit, before your run)

6 files failed out of 1,160. Four are environment and not ours; each needs a build this fresh worktree does not have: `cold-start-lazy-imports`, `pdf-bundle-trace`, `fleet-composed-access`, and `fleet-decisions-route`/`fleet-reports-route` ("no built client … run npm run build:fleet"). **One is ours, and is a third required fix:**

`tests/last-view.test.ts` › "has heard of every nuqs-managed key in src/web" fails with `["depth","quoteId","n","place","role","seen","current","missing"]`. `depth` (and `stop`, if it is not already listed) need a row in `REMEMBERED` or `NEVER_REMEMBERED` in `src/web/last-view.ts`, with the reason. The other six look like trajectory object keys that the test's scanner mistakes for URL params. Find out why, and fix it at the right end: either the code declares them in a shape the scanner reads as a param, which should change, or the scanner is too loose, which is a wider issue — report it, and make the smallest in-stage change that is honest.
