# Questions mode Stage 2 report

## What was built

- `tools/fleet/web/src/QuestionsPanel.tsx` is the self-contained, timer-free panel. It renders all
  three completeness arms, every gap arm and every item arm exhaustively. Dialogs resolve through
  the current fleet row; missing or questionless rows remain visible as stubs. Addressable dialogs
  reuse `QuestionCard`, send through `SteerApi`, snapshot the receipt target before awaiting, reuse
  `SteerReceipt`, make permission/hold refusals sticky, and suppress blind repeats after successful,
  partial or unknown delivery. The stateful child is keyed by item identity plus the verified
  execution token (or `unverified`). Prose remains read-only and navigates to Sessions only.
- `tools/fleet/web/src/mode.ts` appends `questions` and registers its label.
- `tools/fleet/web/src/Dock.tsx` registers `MessageCircleQuestion` with the reason for choosing it,
  adds the artefact-oriented tip, and passes `MODES.length` to the mode group as
  `--dock-mode-count`.
- `tools/fleet/web/src/tailwind.css` consumes that custom property with the old count as a fallback;
  its comment no longer asks future modes to hand-maintain a duplicate count.
- `tools/fleet/web/src/App.tsx` mounts the panel, derives `questionsAtTime(feed.state, now)` on every
  render, preserves the distinct not-reported answering state, and selects a prose session with one
  `go("sessions", { sel, selpid: null })` write.
- `tests/fleet-questions-panel.test.tsx` supplies the requested jsdom composition and rendering
  coverage. The existing bottom-bar test already asserts that dock buttons and their order are
  derived from `MODES`, so no duplicate assertion was added.

## Tests watched red before implementation

The new suite first failed to import the absent panel. With a null panel stub in place, all twelve
requested behaviours failed before the implementation: registration/label, initial-hash mount,
dock switching, the three distinct empty readings, raw-question preservation, the stale-row stub,
execution-token state lifetime, send-outcome receipts and disabled repeats, prose's no-write rule,
prose selection with stale `selpid` removal, distinct disabled/not-reported notices, and live
staleness. That established that every assertion required Stage 2 output, though the two composition
claims below received stronger mutation checks.

- For the initial-hash mount test, after the real implementation passed I changed the
  `mode === "questions"` arm to `false`. The test went red because the Questions-specific no-payload
  state disappeared, then passed again after restoration. This proves the test reaches the App
  mount rather than merely finding the dock registration.
- For live staleness, I temporarily replaced the render-time selector with the payload's parsed
  `questions` value. After advancing the existing clock three minutes without another payload, the
  masthead became stale but the panel still claimed `Nothing needs you.`; the test went red. It
  passed only after restoring `questionsAtTime(feed.state, now)`, proving that the test exercises
  render-time ageing rather than parse-time freshness.
- The GPT Sol review found one further retained-item case. Its new parser-to-DOM regression went red
  with two enabled option buttons when the current row had no `paneId`. After the panel required
  current-row addressability and exact row/target agreement, both that case and a contradictory-
  target case passed read-only. The review's narrow follow-up confirmed the P1 was closed.

## Registrations as found

`MODES` still contained eight entries and the coarse-pointer CSS still used the literal
`flex: 8 0 auto`. The concurrent Decisions session had therefore landed neither its mode nor the
shared `--dock-mode-count` mechanism in this worktree when these edits were made. I added only the
Questions registrations and the one agreed shared mechanism.

## Verification

- `npx vitest run tests/fleet-questions-panel.test.tsx tests/fleet-questions.test.ts tests/fleet-questions-client.test.ts`
  — 3 files, 53 tests passed.
- Existing derived-dock assertion in `tests/fleet-web.test.tsx`, run by exact test name — 1 passed,
  421 skipped.
- `npx vitest run tests/fleet-imports.test.ts` — 14 passed.
- `npm run build:fleet` — passed (the existing large-chunk advisory remains).
- Biome lint on the new panel and its test — clean.

The normal cross-family wrapper was attempted but could not initialise its app-server client in the
read-only sandbox. A GPT Sol review agent inspected the same scoped live diff instead; its finding,
fix and successful narrow follow-up are recorded in the adjacent Stage 2 review file.

## Plan conflicts and work left

Nothing in the binding plan proved wrong or impossible. No Stage 1 server/composer/type file needed
changing. Stage 3, queue pointers, browser work, screenshots and `docs/project/` changes remain
deliberately undone. Per the task, I did not run the full suite or project typecheck, and I did not
commit.

Another live session changed the main `260909e` plan in this worktree while Stage 2 was underway.
Those edits are unrelated to this candidate and were preserved untouched.
