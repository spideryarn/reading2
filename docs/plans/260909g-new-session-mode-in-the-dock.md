# New session as its own mode, behind a `+` at the far left of the dock

**Status as of 2026-09-09: designed, not built — nothing in this plan has been written.** Evidence:
`grep -n '"new"' tools/fleet/web/src/mode.ts` finds nothing, and `NewSessionPanel` is still mounted
from `SessionsPanel.tsx:798,834`. Paused by the Overseer before Stage 1 began: Greg has called this
low priority and the Claude weekly window was at 82% with five days to reset.

## Goal

Greg, 2026-09-09:

> Move the "New session" button/functionality to its own "+" button far-left of the bottom-bar-dock
> as its own mode.
>
> Maybe we still have a "New session" button in the very top-right of the Sessions and/or
> Orchestrator modes, but they take you to the New-session mode.

Today the launcher is a `Card` with its own open/close toggle, drawn **inside** the Sessions tab
above the list — twice, in fact: once in the three-empty-pages arm and once in the normal one
(`SessionsPanel.tsx:798` and `:834`). It costs a strip of vertical space on the tab that is read
most, and it hides the thing it is for behind a disclosure button that is itself inside another tab.

Afterwards: `#new` is a mode of its own, its dock button is a `+` sitting to the **left of the
segmented mode group**, the panel opens flat with no disclosure, and Sessions and Overseer each
carry a small "New session" button at their top right that switches to it.

## References

- [fleet-dashboard-modes.md](../project/fleet-dashboard-modes.md) — the checklist. **Six places in
  three files, two of them checked by nothing**: `MODES`/`MODE_LABELS` (`mode.ts`),
  `MODE_ICONS`/`MODE_TIPS` (`Dock.tsx`), the mount in `App.tsx` (a ternary, so unchecked), and
  `.dock-modes { flex: … }` under `@media (pointer: coarse)` in `tailwind.css`.
- [`tools/fleet/web/src/mode.ts`](../../tools/fleet/web/src/mode.ts) — `MODES`, the hash, and the
  `go`/`setParams` rule (one write, never two).
- [`tools/fleet/web/src/Dock.tsx`](../../tools/fleet/web/src/Dock.tsx) — the bar, `DockMode`, the
  `--dock-mode-count` custom property, and the `.dock-app` cluster that Refresh lives in.
- [`tools/fleet/web/src/NewSessionPanel.tsx`](../../tools/fleet/web/src/NewSessionPanel.tsx) — the
  launcher itself: three launch states, the four-minute give-up, and the dictation box.
- [`tools/fleet/web/src/fit.ts`](../../tools/fleet/web/src/fit.ts) — the measured fit ladder. Adding
  a button widens the row, so this is the thing most likely to be quietly wrong afterwards.
- [`tools/fleet/web/src/tailwind.css`](../../tools/fleet/web/src/tailwind.css) § dock (from ~line
  364) — `.dock-modes`, the hairlines, the two rungs, and the coarse-pointer share count.
- [`tests/fleet-web.test.tsx`](../../tests/fleet-web.test.tsx) § "the bottom bar" (~line 1977) —
  `modeButtons()` reads `.dock-modes` and compares against `MODES` **in order**, so it goes red the
  moment one mode is drawn outside that group. It has to be taught the distinction.
- [tooltips.md](../project/tooltips.md) and
  [`tests/fleet-tooltip-copy.test.ts`](../../tests/fleet-tooltip-copy.test.ts) — a new mode needs a
  `Tip` whose `how` is not its `what` again, and whose words describe the artefact rather than the
  gesture.
- [dictation.md](../project/dictation.md) — the microphone-outlives-its-panel hazard, which this
  change *removes* rather than moves (see below).

## Key decisions

**It is a real mode, in `MODES`.** Not a button with a bit of local state. That buys the hash
(`#new` survives the reload iOS forces on a phone), the browser's Back button, and the compiler's
`Record<Mode, …>` check across the four maps. It is what Greg asked for in the same words.

**Its dock button is drawn outside `.dock-modes`.** "Far-left of the dock" is to the left of the
segmented group, and the segment is a `role="radiogroup"` of mutually exclusive views. So `MODES`
gains a companion:

```ts
/** The one mode drawn as a loose button rather than inside the segment. */
export const LOOSE_MODE = "new" as const;
/** The modes inside the segmented group, in bar order. */
export const SEGMENTED_MODES: readonly Mode[] = MODES.filter((m) => m !== LOOSE_MODE);
```

`Dock.tsx` maps `SEGMENTED_MODES` inside the group and renders the `+` before it;
`--dock-mode-count` becomes `SEGMENTED_MODES.length`, because that property exists to weight the
segment against the loose buttons beside it and would now be counting a button that is not in it.

**The `+` is not a `role="radio"`.** A radio outside its radiogroup is a lie to a screen reader, and
splitting the group across the DOM to include it would put a frame round the `+` as well. It is an
ordinary button with `aria-label="New session"`, `aria-current="page"` when it is the live mode, and
the `.dock-btn.on` class — which is exactly the inset-cap marker the bar's non-segment buttons
already use to mean "this is the page you are on".

**Icon only, at every rung.** A `+` is the one glyph on this bar that needs no word, and the label
would eat the leftmost 60px on a 390px phone, which is where this bar is actually read. `Lucide`'s
`Plus`, at the house 16px / 1.75. The mode's name is still stated — in `aria-label`, in the tooltip
card, and in the panel's own heading.

**The panel loses its disclosure.** `NewSessionPanel`'s `open` state, its Close button, and the
`useEffect` that stops the microphone when `open` goes false all go: a mode *is* the disclosure, and
switching away unmounts the component, which runs `useDictation`'s own unmount cleanup
(`src/web/useDictation.ts:1332`) — `abort`, the track released, the tape cancelled. That is a
stronger guarantee than the effect it replaces, and it is why this change makes the documented
"closing it unmounts nothing" hazard go away rather than relocating it. **Verify it rather than
assume it**: a test that mounts the page on `#new`, arms the dictation, switches mode, and asserts
the capture stopped.

**Both entry points, not "and/or".** Sessions and Overseer each get one — the two tabs somebody is
looking at when they decide to start an agent. One line each, `onClick={() => go("new")}`, passed in
as a prop rather than reaching for the hash, so neither panel learns about routing.

### The simpler options passed over

- **Leave it where it is and just collapse it by default.** Cheapest, and it is what exists. It does
  not answer the ask, and it keeps the launcher inside a tab whose job is a list.
- **Put the `+` inside the segmented group as the first mode.** One less concept — no `LOOSE_MODE`,
  no split map, and `tests/fleet-web.test.tsx` needs no teaching. Rejected because Greg said *far
  left of the dock*, and because inside the frame a `+` reads as a fourteenth view rather than as an
  action, which is the distinction the segment's hairlines exist to make.
- **A floating action button over the corner of the page.** The obvious phone idiom, and it sits
  over the content the page exists to show. The dock is already the place a thumb goes here.
- **Keep the disclosure inside the new mode.** Would leave the mic effect in place unchanged, i.e. a
  smaller diff. Rejected: a tab whose entire content is one button that reveals the content is a tab
  that wastes a tap every single time.

## Stages

Each stage ends with `npm test` (or the named files) and `npm run typecheck`, per
[code-quality-overview.md](../project/code-quality-overview.md), and the whole plan goes to GPT Sol
before Stage 1 and the built code goes back afterwards
([codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md)).

**Preparatory**

- [ ] Merge `origin/dev` first — several agents are in this tree.
- [ ] Send this doc to GPT Sol read-only (`--sandbox review`) and fold in the findings.
- [ ] Work in a worktree (`EnterWorktree`, then `npm run worktree:setup`); this is code, not a doc
      edit. Spawn any subagents *after* entering it.

**Stage 1 — the mode exists and its panel draws**

- [ ] Test first, and watch each go red: (a) `MODES` contains `"new"`; (b) `#new` renders the
      launcher — the `App.tsx` mount is the registration nothing type-checks, and this assertion is
      the only thing that would notice it missing; (c) an unknown hash still falls back to Sessions.
- [ ] `mode.ts`: add `"new"` to `MODES` (first, so the array reads left-to-right as the bar draws),
      `MODE_LABELS.new = "New session"`, and export `LOOSE_MODE` / `SEGMENTED_MODES`.
- [ ] `Dock.tsx`: `MODE_ICONS.new = Plus`, and a `MODE_TIPS.new` whose `how` says the non-obvious
      half — that a launch is a 202 the page then polls, and that it says so honestly when it never
      finds out.
- [ ] `App.tsx`: mount `<NewSessionPanel api={newSession} />` in a `max-w-3xl` column, like the
      other single-column tabs.
- [ ] Acceptance: `#new` shows the launcher; every other tab is unchanged.

**Stage 2 — the `+` at the far left, and the bar still fits**

- [ ] Test first: the `+` renders as a direct child of `.dock` *before* `.dock-modes`; clicking it
      writes `#new`; it carries `aria-current="page"` only when the mode is `new`; and
      `modeButtons()` in `tests/fleet-web.test.tsx` is retaught to compare against
      `SEGMENTED_MODES` rather than `MODES` — with a second assertion that the two differ by exactly
      the loose mode, so the retaught test cannot pass by having forgotten what it was checking.
- [ ] Render it in `Dock.tsx`; set `--dock-mode-count` from `SEGMENTED_MODES.length`.
- [ ] Feed the fit ladder: `useDockFit`'s `content` string in `App.tsx` is the list of everything
      that changes the row's width. Adding a permanent icon-only button changes the width once and
      not per-render, so the string likely needs nothing — **check it by measuring, not by
      reasoning**, at 390px and 1280px.
- [ ] Acceptance (browser, in a Sonnet subagent per
      [browser-control.md](../project/browser-control.md) — Playwright against system Chrome on this
      box): screenshots at 390px and 1280px showing the `+` at the far left, the segment unclipped,
      and the active-mode cap where it belongs. Ask the subagent for the conclusion, not the dumps.

**Stage 3 — the launcher moves out of Sessions**

- [ ] Test first: the Sessions tab no longer renders the launcher in *either* arm — the empty/
      collecting arm is a separate `return` and is the one a render test misses; and each of Sessions
      and Overseer has a "New session" button that switches the mode to `new`.
- [ ] Delete both `<NewSessionPanel …>` mounts from `SessionsPanel.tsx` and the `newSession` prop
      with them (and from `App.tsx`'s pass-through, keeping the injectable seam at the `App`
      boundary for the new mount).
- [ ] Add the top-right button to `SessionsPanel`'s `ListControls` header row and to
      `OverseerPanel`, each taking an `onNewSession` callback prop.
- [ ] Strip `open` / the Close button / the `!open && armed` effect from `NewSessionPanel`, and add
      the unmount test described under **Key decisions**.
- [ ] Check `tests/fleet-new-session-mic.test.tsx` and `tests/fleet-web.test.tsx` for anything that
      drives the old toggle.

**Stage 4 — the paperwork**

- [ ] `docs/project/fleet-dashboard-modes.md`: a mode may now be drawn outside the segment, and the
      `--dock-mode-count` register is `SEGMENTED_MODES.length` rather than `MODES.length` — that
      register is one of the two nothing checks, and this change moves it.
- [ ] `docs/project/dictation.md`: note that the fleet launcher no longer needs the stays-mounted
      workaround, and why.
- [ ] `npm run check` (~26 min, silent until done — commit on the fast gates and read its verdict
      after).
- [ ] GPT Sol on the built code (`--sandbox workspace-write`, it fixes what it finds in-stage);
      check the exit code *and* that the answer file is fresh.
- [ ] Push to `dev`, then `npm run worktree:check` before removing the worktree.

## Risks

- **The unchecked `App.tsx` mount.** A mode in all four maps with no arm there draws a button,
  switches the hash and shows an empty page. Stage 1's test (b) is the only guard.
- **The fit ladder.** One more button on a bar that already carries ten modes. The ladder makes the
  overflow honest rather than clipped, so the failure is ugly rather than silent — but the
  coarse-pointer share count is a real number that a wrong value gets wrong quietly.
- **Two mounts, one deletion.** `NewSessionPanel` appears twice in `SessionsPanel`. Deleting the one
  a test happens to reach and leaving the other is exactly the shape of
  [silent-success.md](../reusable/silent-success.md).
