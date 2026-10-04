# Review prompt — code for plan 261003p (write-capable: fix inside the stage, report anything wider)

**Candidate (committed):** exactly two commits on this worktree's branch, `fb30ea5d7` (stage 1) and
`ab00dc49b` (stage 2). `git show --stat fb30ea5d7 ab00dc49b` lists every path;
`git diff 8019e3549 ab00dc49b` is the whole change (nothing else landed between). The plan, with the
plan-stage review's findings F1–F5 and what was done about each, is
`docs/plans/261003p-block-chat-spinner-and-docking-in-the-marginalia-column.md`; your earlier review
is `docs/plans/261003p-review-plan-gpt-sol.md`. Continue the finding IDs from F6.

**What it is:** (1) a pending chat turn keeps a spinner until its first word (`Turn` in
`src/web/ChatPanel.tsx`); (2) the floating chat panel gets class `docked` and sits over the
Marginalia column when `chatDock` (`src/web/layout.ts`) says there is room, wired through
`src/web/reader/Reader.tsx` → `src/web/ChatDialog.tsx`, styled in `src/web/styles/dialogs.css`;
(3) the block an open panel is about wears `td.text.chat-open` (`src/web/TableView.tsx`).
Start with those files and the four new tests (`tests/chat-turn-waiting-spinner.test.tsx`,
`tests/chat-dialog-docks.test.tsx`, `tests/chat-dock-wiring.test.tsx`,
`tests/chat-open-block-mark.test.tsx`) and `tests/layout-margin.test.ts`; that list does not limit
scope.

**Your brief:**
- Attack it independently first: wrong behaviour a reader can reach, a state the code does not
  handle, a test that would pass without the feature, a doc sentence (`docs/project/comments.md`
  § Where the chat panel sits, `docs/project/marginalia.md`, `docs/project/loading-spinner.md`)
  that is not true of the code.
- **Fix what is inside this stage, narrowly, red-first** (run the one test file yourself:
  `npx vitest run tests/<file>`; these need nothing outside the tree). **Report, do not fix,**
  anything wider. Do not commit. Do not reformat files; never enable the Biome formatter.
- Evidence I ran and you cannot: a Playwright check at 1440/1180/820/390, summarised in the plan
  under *What the build found*. Treat it as my account, not as proof.

**Severity:** P0 data loss / security / charging / broadly unusable; P1 user-visible wrong
behaviour or an authoritative contract violated; P2 design or maintainability risk; P3 prose.
Say **established** or **reasoned** for each. End with a one-line verdict (land / land after fixes /
do not land) and a list of the files you changed.

**My own suspicions (already mine; spend most of the run elsewhere):**
- `td.text.chat-open::after` on a cell some other rule may already give an `::after`, or a cell in
  a layout (Structure's fold, a table block, a figure) where `right: 0` is not where I think.
- `chatDock` when `windowWidth` and `fit` are momentarily out of step during a resize.
- The docked panel beside a covering band (`fit.modeW === 0` with a band open): `margW` should be 0
  there, so no dock; check.
- The constants were changed from 272/10/12 to 256/8/8 after the build; any doc or comment still
  carrying the old numbers.
