# Review the built code for stage 2

You reviewed the plan for this job (seven must-fixes) and stage 1's code (four more). This is
**stage 2's built code**. Weight it higher than the plan review: a plan review cannot find a filter
that is right in one arm and wrong in the other.

You are in the git worktree that holds the work. Read any file, and **run
`npx vitest run tests/dock-experimental-modes.test.tsx tests/dock-fit.test.ts tests/public-network-trace.test.tsx`
yourself** — a finding you reproduced outranks one you reasoned to.

## What stage 2 does

Five of the thirteen modes — Quotes, Timeline, Referee, Diagram, Remember — are no longer drawn in
the bottom bar unless the reader has Experimental Features on. Greg chose the split. The URL still
works: `?mode=timeline` renders its band whatever the switch says.

**The counts in this tree are 8 visible / 13 with the switch on.** Not 7/12 — that is the shape after
a not-yet-landed merge of Hierarchy and Outline into one Structure mode, and both stand-ins stay
default-visible.

## Read these

- `docs/plans/260903c-gate-unpolished-modes-behind-experimental-features.md` — the plan; § Stage 2,
  § *`Dock` is told the answer*, § *What this plan accepts*, and the stage-1 outcome notes.
- `docs/plans/260903c-stage1-code-review-sol.md` — your own review of stage 1, for what was already
  settled.
- `/tmp/claude-1000/-home-greg-code-spideryarn2/ba9c8220-9856-4dc5-832f-dd637fe6604f/scratchpad/stage2.diff`
  — the whole diff for `src/web/` and `tests/`. Two files are new and not in it:
  `tests/dock-experimental-modes.test.tsx`, `tests/helpers/experimental-fixtures.ts`.
- `src/web/Dock.tsx` — especially `visibleModes`, `modeInSearch`, `fitSignature`, `DockModes`, the
  loose-link arm, and the `DockExperimental` prop.
- `src/web/visitor.ts` — `POLICY` / `markedModes`, the **other** mechanism that decides how the bar
  draws a mode. It dims; this one removes.
- `docs/project/experimental-features.md` — rewritten in this stage.

## What I want you to attack

1. **Two mechanisms, one bar.** `marked` (dim, still pressable, visitor-facing) and `experimental`
   (not drawn at all) now both decide the mode segment's contents. Find a combination that produces
   an empty segment, a radiogroup with **nothing checked**, or two checked. Consider: signed-out
   visitor; signed-in non-owner; artefact absent; `?mode=` naming an experimental mode; `?mode=`
   naming a mode that is *also* owner's-only; a mode id in the URL that is not a mode at all.

2. **`visibleModes(on, current)` and `modeInSearch(search)`.** The reading-view arm passes `mode`;
   the loose-link arm has no `mode` prop and reads `?mode=` out of the carried search string. Is that
   the same answer in both arms? What does `modeInSearch` do with a malformed, absent, repeated, or
   URL-encoded `mode` parameter, and does `carriedSearch` guarantee the shape it assumes? Is there a
   path where the reading view draws a button the metadata page does not, or the reverse, for the
   same URL?

3. **`fitSignature`.** It now joins the visible mode ids. Is that sufficient and is it stable? Does
   anything else that changes the row's width fail to appear in it — the toggle is stage 3, but
   consider `marked`, `visitor`, `signedIn`, the comments count, and the `keepLabel` on Plain. Can the
   ladder now settle on a rung that is wrong in either direction?

4. **The required prop.** `DockExperimental` is `{ on: boolean }`, required, passed from four sites.
   `tests/dock-fit.test.ts` casts `Dock as any`. Confirm that a mount site that omitted it fails
   loudly rather than silently showing every mode, and that no code path reads it optionally.

5. **The tests.** `tests/dock-experimental-modes.test.tsx` is new and claims a matrix. Is any test
   passing for the wrong reason — asserting an end state without entering the state under test? Does
   the matrix actually cover both Dock arms? And check the four *existing* files that changed
   (`dock-fit`, `modes-that-start-themselves`, `public-network-trace`,
   `arrows-belong-to-the-article`) — were any invariants weakened rather than adapted? The rule was:
   turn the switch on to keep sweeping all thirteen, never lower a count to match.

6. **`public-network-trace.test.tsx`.** Its parity assertion moved from zero `GET /api/reader` to one
   for a signed-in reader, because `Reader` now calls `useExperimental()`. The stranger's zero must be
   untouched. Verify both, and verify the zero is proved where it is written rather than inherited.

7. **The doc.** `docs/project/experimental-features.md` now claims five rules' worth of behaviour and
   a table of why each mode is hidden. **Check every factual claim in it against the code or the doc
   it cites** — I already found one that was false (the Referee row claimed sub-modes were unbuilt;
   `referee-mode.md` says all four are built and working) and corrected it. Assume there are others.

8. **Anything stage 3 will trip over.** It adds a toggle button at the end of the bar for signed-in
   readers, with load-failure, save-failure and offline states drawn. Is there anything here that
   makes that awkward or that should have been done now?

Rank findings: **must-fix before commit**, **should**, **noted**. Be concrete about the failing case.
Do not rewrite the code.
