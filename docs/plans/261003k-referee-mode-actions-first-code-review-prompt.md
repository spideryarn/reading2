# Code review: Referee mode puts the actions first (261003k)

You are GPT Sol, reviewing built code in the implementer's worktree. You may write.

**Fix what is inside this stage**, narrowly, each finding with a test that reproduces it and that
you have seen fail first. **Report, do not fix, anything wider** you notice, so the caller decides.
You cannot commit from a linked worktree; leave your changes in the working tree. Do not touch
`src/store/`, any route handler, a prompt or the database: another session is working there.

## What to read

1. The plan: `docs/plans/261003k-referee-mode-puts-the-actions-first-and-the-notices-behind-one-button.md`.
   Your own plan review is `docs/plans/261003k-referee-mode-actions-first-plan-review-sol.md`; its
   table in the plan says what was taken from each finding. Check those claims against the code.
2. The diff of the stage: `git diff origin/dev...HEAD -- src tests docs/project docs/user-feedback`
   (the branch has merged `origin/dev`, so use the three-dot form or you will read other people's
   work as this stage's). The files that matter:
   - `src/web/modes/referee/RefereeMode.tsx` (`RefereeBand`, the new `RefereeFrame`, `RefereeAbout`)
   - `src/web/SourceScanNotice.tsx` (`sourceScanOpens`)
   - `src/web/activation.ts` (`REFEREE_TARGET`)
   - `src/web/CandidatesPanel.tsx` (the top line, **Try again**, `onReload`)
   - `src/web/CriteriaPanel.tsx`, `src/web/ClaimsPanel.tsx` (two empty-state lines removed)
   - `src/messages.ts` (`REFEREE_CANDIDATES_REACHES_SEARCH` reworded; the `_SHORT` constant removed)
   - `src/web/styles/referee.css` (`.ref-top`, `.ref-notices-btn`, `.ref-lead`; the how-card rules removed)
   - deleted: `src/web/RefereeCard.tsx`, `src/web/referee-card.ts`, `tests/referee-how-card.test.tsx`
   - tests: `tests/referee-notices.test.tsx` (new), `tests/referee-band-fits.test.ts`,
     `tests/pressing-a-chip-arms-it.test.tsx`, `tests/command-bar-sub-modes.test.tsx`,
     `tests/referee-candidates-panel.test.tsx`, `tests/mode-surface-changes-no-markup.test.tsx`,
     `tests/every-mode-draws-its-surface.test.tsx`
3. `docs/project/referee-mode.md` § What the band looks like, since 2026-10-03, and the sections it
   says are now history.

## What I want checked

1. **Mutations.** For each new or changed test, name a one-line change to the source that should
   make it fail, make it, and confirm it fails. In particular: `noticesChoice ?? sourceScanOpens(scan)`
   → `?? false`; the scan moved below the notice inside `.ref-brief`; `candidates` put back in
   `REFEREE_TARGET`; the **Try again** button calling `onStart` instead of `onReload`; the lead line
   moved out of `.ref-panel`. Report any mutation that leaves the suite green.
2. **Candidates with nothing arming it.** Trace `CandidatesBand` on mount for: no thread, a stored
   thread, a failed read then **Try again**, and a failed read then a successful one. Is there any
   path that starts a turn without a press on *Build the reviewer brief* or the composer? Is there a
   state with no control at all? `tests/referee-candidates-press.test.tsx` mocks a GET that always
   succeeds; if the failed-read path needs a test at the band level and not only the panel level,
   write it.
3. **The command bar.** `subModeTarget`, `subModeGenerates` and `bandTarget` for
   `{ mode: "referee", view: "candidates" }`; anything else that still assumes Candidates generates
   on open (the add page's auto-modes, `modeGenerates`, `MODE_CATALOG`'s `how` sentence for referee,
   the Help page's text about Referee, `docs/project/help-page.md`'s rule that Help stays true).
   Read `src/mode-catalog.ts` § referee: its `how` says "the sub-modes inside arm themselves". Is
   that still true enough, given Claims still does? Report; do not reword a published sentence.
4. **Stale words.** Anything in `src/` or `tests/` comments, or in `docs/project/`, that still says
   the notice has its own collapse, that a line sits above the chips, that the How card is in the
   band, or that the chip starts Candidates, and that a reader would now be misled by. Fix comments
   in files this stage already touches; list the rest.
5. **Accessibility of the top row.** The Notices button is a sibling of the radiogroup; it has
   `aria-expanded` and no `aria-controls` (the box is not rendered while shut). The (i) is first in
   the band's tab order. Is anything announced wrongly or unreachable by keyboard?
   `tests/arrows-belong-to-the-article.test.tsx` sweeps every `role="radio"`; does the new button
   swallow any key?
6. **What I may have deleted that something still needs**: `REFEREE_TEXT_ALREADY_SENT_SHORT`,
   `useHowCard`, the `spya.refereeHow.dismissed` key (nothing reads it now; it stays in browsers
   that had it, which I think is harmless), `tests/store-migration-witness.json`'s entry for the
   deleted test file.
7. Anything else that is wrong.

## Running things

You can run a single test file that needs no database or network:
`npx vitest run tests/<one>.test.tsx`. Do not run `npm test` or `npm run typecheck`; the caller runs
those. A red test inside your sandbox is not yet a finding: say which file and I will re-run it.

## What I ran

`npm run typecheck` green. The thirteen Referee-related test files green. The full suite and a
browser pass at 1280×800, 820×1180, 390×844, 1280×720 and 900×337 were running when this was
written; their results are in the plan's § After if it is filled in.

## Answer with

A verdict in one line (land / land after fixes / do not land). Then the findings, numbered and
ranked, each with file and line, the evidence, and whether you fixed it. Then a separate list of
wider things you noticed and did not fix. Then the list of files you changed.
