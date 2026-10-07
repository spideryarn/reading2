# Plan review: 261007c — the bottom bar rises in, and a More button gathers the lesser modes

You are reviewing a **plan**, read-only. Nothing is built yet. Do not change any file.

Repo: this worktree (TypeScript, ESM, React client under `src/web/`), branch off `dev`.

## The candidate

- Base: `ed16143cb`.
- The plan is an **untracked file**:
  `docs/plans/261007c-bottom-bar-rises-in-on-first-load-and-a-more-button-gathers-the-lesser-modes.md`.
  Read it in full first. It quotes the request (Greg's, the product owner) verbatim.

## Where to start (this does not limit scope)

- `src/web/Dock.tsx`: `MODES_UI`, `visibleModes`, `groupStarts`, `modeInSearch`, `fitSignature`,
  `Dock` (render about line 2199), `DockModes`, `DockModeLinks`, `MarginToggle`, `pressMode` /
  `activateMode`, `DockCommandBar modes={visible}`.
- `src/web/dock-fit.ts`, `src/web/styles/dock.css`, `dock-fit.css`, `narrow-window.css` (§ a small
  device, § a coarse pointer, and the `:root:has(...)` list that holds the bar home).
- `src/web/ShelfEntry.tsx` (the one Radix `DropdownMenu` in the client), `src/web/Tooltip.tsx`.
- `src/web/Metadata.tsx`, `src/web/PublicPages.tsx`, `src/web/reader/Reader.tsx` (the three mounts).
- `src/web/ModeHerald.tsx`, `src/web/CommandBar.tsx` § `subModeRows`.
- Tests that enumerate the bar, listed in the plan's References.
- `docs/project/interface-vision.md` § Decluttering the bottom bar, `docs/project/mode.md`,
  `docs/project/experimental-features.md`, `docs/project/narrow-windows.md`.

## What you can run

The tree is read-only. `/tmp` is writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`). No network, not even loopback.

## Attack it

Independently, before reading my suspicions. The questions with a floor:

1. Is each of D1 to D7 **accurate about the code** it rests on (for example: that `.dock` clips and
   transforms; that `visibleModes` feeds the command bar; that animating `translate` and `opacity`
   does not fight the hide-on-scroll rule; that a portalled Radix menu on a phone leaves
   `.dock:focus-within` false)?
2. What does the plan **not handle** that a reader can reach? Name the concrete scenario.
3. Is there a **simpler** design that gives Greg what he asked for? Say what it costs.
4. Which existing test or script would go wrong silently (still green, now asserting nothing)?
5. Is the entrance (D7) safe: under React StrictMode, with the fit ladder measuring
   `scrollWidth > clientWidth` while the bar is invisible or translated, with `visibility` in a
   keyframe, with the phone's `data-bars="hidden"`, with keyboard focus arriving during the first
   second, with Playwright scripts that click the bar straight after load?

For each finding: an ID (`PR-1`, …), a severity, established or reasoned, (a) the concrete scenario
or the contract it contradicts with file and line, (b) the smallest change to the plan that closes
it, as replacement wording.

| | |
|---|---|
| **P0** | data loss, security, or the reading view broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | prose defect |

End with one line: `VERDICT: build as planned` / `VERDICT: build with the P0/P1 fixes` /
`VERDICT: do not build`.

## My own suspicions — read last

Already my doubts, so confirming them is worth less than what you find yourself.

- D3 (open gathered mode drawn in the bar) against the alternative of More itself going "on".
- A Radix `DropdownMenu.Trigger` inside the project's `Tooltip`, and inside a `role="radiogroup"`.
- Radix's modal menu and the bar's drawer / scrim / other dialogs.
- D7 playing for every reader on every article open.

Do not change any file.
