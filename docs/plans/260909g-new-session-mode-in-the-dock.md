# New session as its own mode, behind a `+` at the far left of the dock

**Status as of 2026-09-09: designed, not built — nothing in this plan has been written.** Evidence:
`grep -n '"new"' tools/fleet/web/src/mode.ts` finds nothing, and `NewSessionPanel` is still mounted
from `SessionsPanel.tsx:798,834`. Paused by the Overseer before Stage 1 began: Greg has called this
low priority and the Claude weekly window was at 82% with five days to reset. A second ask arrived
while paused (Stages 4–6 below) and is recorded here rather than built.

## Goal

Greg, 2026-09-09:

> Move the "New session" button/functionality to its own "+" button far-left of the bottom-bar-dock
> as its own mode.
>
> Maybe we still have a "New session" button in the very top-right of the Sessions and/or
> Orchestrator modes, but they take you to the New-session mode.

And a second ask, relayed by the Overseer the same day, which is **behind the `+` mode** — Greg,
2026-09-09:

> add a Tell-overseer button to the Sessions list next to the New Session button, which should take
> you to the Overseer mode and put the focus on Message the Overseer input box. Oh, and that Message
> the Overseer should be moved to the top of the Overseer mode page, and should also have a
> voice-Dictation button (as should pretty much all input-message-text-boxes).

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
  change *removes* rather than moves (see below); and the machinery Stages 5–7 must reuse rather
  than reimplement: [`src/web/useDictation.ts`](../../src/web/useDictation.ts) (the capture),
  [`src/web/useDictationField.ts`](../../src/web/useDictationField.ts) (the caret and the closed
  box), wrapped for this page by
  [`tools/fleet/web/src/DictationControl.tsx`](../../tools/fleet/web/src/DictationControl.tsx) §
  `useFleetDictation`.
- [`tools/fleet/web/src/MessageOverseerCard.tsx`](../../tools/fleet/web/src/MessageOverseerCard.tsx)
  — the box Stage 5 moves and Stage 6 gives a microphone. It addresses the Overseer's *session*,
  resolved from the claim, which is what makes its dictation context an ordinary one.
- [`tools/fleet/web/src/OverseerPanel.tsx`](../../tools/fleet/web/src/OverseerPanel.tsx) `:536–590`
  — the card order Stage 5 changes, each slot carrying a comment saying why it is where it is.
- [`tools/fleet/routes-transcribe.ts`](../../tools/fleet/routes-transcribe.ts) `:242–275` — the
  context validator is an allowlist of two kinds, and `:275` is where a kind's vocabulary priming is
  decided. Stage 6 has to go through here or be refused.
- [browser-testing-playwright.md](../project/browser-testing-playwright.md) — **this box has no
  audio input device**, and Chrome's fake-microphone flags do not work headless on it. A Playwright
  check of any dictation button has to drive `MediaRecorder` from Web Audio instead.

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

### And for the second ask (Stages 4–6)

**"Tell overseer" crosses a mode boundary, so the focus request travels in the hash.** The
destination card does not exist when the button is pressed — `App.tsx` mounts `OverseerPanel` only
once the mode is `overseer` — so there is nothing to call `.focus()` on. One write,
`go("overseer", { focus: "message" })`, per `mode.ts` § `go`: a `chooseMode` followed by a `setParam`
is the closed-over-snapshot bug that file was rewritten to remove.

**And the card must clear that parameter once it has used it.** `go` carries parameters along by
design, so a `focus=message` left in the hash would follow the reader to every other tab and steal
the focus again on every reload and every press of Back. Consume it in the mount effect and
`setParam("focus", null)`. **This is the half most likely to be forgotten, because forgetting it
looks like it works.**

**Message the Overseer goes to the top of the Overseer tab, above the status card.** That demotes
the two cards whose comments at `OverseerPanel.tsx:536,541` argue for being first and second — *can
I trust this page's account of what is being watched*, and *can either subscription afford more
work*. Those comments are the record of a decision and must be rewritten rather than left standing
over a different order; a comment that argues for a position the code no longer takes is worse than
none. Greg has asked for the box at the top, so the box goes at the top and the comments say what
the order now is.

**Dictation reuses `useFleetDictation`, on the two boxes that lack it.** Four textareas exist on this
page: `SessionDetail` and `NewSessionPanel` already have a microphone; `MessageOverseerCard` and
`BroadcastCard` do not. That is what "pretty much all input-message-text-boxes" comes to today, and
the wiring is four lines each — `readOnly` and `ref` on the box, `<DictationControl>` beside the send
button, and **the submit guarded on `sendBlocked`, not on `readOnly`**, which is the mistake
`DictationControl.tsx:56` exists to warn about and which `NewSessionPanel` still got wrong once in a
closure.

**One of the two needs a new context kind; the other does not.** `routes-transcribe.ts:242` is an
allowlist of `{kind:"session",sessionId}` and `{kind:"new-session"}`, and a body outside it is
refused. `MessageOverseerCard` already resolves the Overseer's session, so it is an ordinary
`{kind:"session"}` and needs no server change. A broadcast addresses the whole fleet and is neither:
add `{kind:"fleet"}` to the validator and give it the same vocabulary priming `new-session` gets at
`:275` (every session's name), which is exactly what somebody dictating a broadcast will say.
Reusing `new-session` for it would need no server edit and would put a lie in the wire format.

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
- **Focus by a module-level "focus this next" variable instead of a hash parameter.** No parameter to
  clear, no risk of it following the reader around. Rejected: it is state outside React that a
  reload does not clear and nothing can see, and this page's whole argument for the hash is that a
  refresh must land where you were.
- **Give every textarea dictation by putting it inside a shared `<MessageBox>` component.** Tempting,
  and probably right eventually. Not now: two of the four boxes are already wired by hand and would
  have to be unpicked, which turns a four-line change into a refactor of the two write paths that
  type at real sessions. Stage 6 wires the two that are missing; the shared component is a later
  decision, taken when there is a third caller asking for it.

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

**Stage 4 — "Tell overseer", beside the New session button**

- [ ] Test first: pressing it from the Sessions tab leaves the hash at `overseer` **and** puts the
      focus on the Message-the-Overseer textarea (`document.activeElement`, not a class); and the
      `focus` parameter is gone from the hash afterwards, so switching to another tab and back does
      not steal the focus a second time. That second assertion is the one that fails silently
      without it.
- [ ] `SessionsPanel` gains an `onTellOverseer` callback prop beside `onNewSession`; `App.tsx`
      passes `() => go("overseer", { focus: "message" })`. Neither panel learns about the hash.
- [ ] `MessageOverseerCard` takes a `focusOnMount` prop (or reads the param via a prop from
      `OverseerPanel` — decide at build time, but the panel is the only thing that should know the
      param's name), focuses its box in an effect, and clears the parameter.
- [ ] Acceptance: on a phone-width window, Sessions → Tell overseer lands on the Overseer tab with
      the keyboard up and the caret in the box.

**Stage 5 — Message the Overseer moves to the top**

- [ ] Test first: on the Overseer tab, the Message-the-Overseer card is the **first** card in the
      panel — asserted by order among the panel's children, not by "it is present".
- [ ] Move the `<MessageOverseerCard>` slot above `<OverseerStatusCard>` in `OverseerPanel.tsx`, and
      **rewrite the "FIRST, because…" and "SECOND, and beside the status card…" comments** at
      `:536` and `:541` so they say what the order now is and why. See **Key decisions**.
- [ ] Check `tests/fleet-overseer-panel.test.tsx` and `fleet-overseer-message.test.tsx` for anything
      that assumes the old order.

**Stage 6 — a microphone on the message boxes that lack one**

- [ ] Test first, per box: the send button is disabled while `sendBlocked`, and the action itself
      refuses when called programmatically with the microphone armed — the guard has to live at the
      action as well as on the element, which is the finding `NewSessionPanel.tsx` carries at its
      `blocked` ref. A DOM-only assertion passes against the bug.
- [ ] Test first, server: `routes-transcribe.ts` accepts `{kind:"fleet"}` and still refuses an
      unknown kind and a body with surplus keys. The existing refusal cases must stay red-when-broken
      — extend the allowlist, don't loosen it.
- [ ] Wire `useFleetDictation` into `MessageOverseerCard` (context `{kind:"session", sessionId}` from
      the resolved claim) and into `BroadcastCard` (context `{kind:"fleet"}`), each with
      `<DictationControl>` beside its send button.
- [ ] Add the `fleet` kind to the validator at `routes-transcribe.ts:242` and its vocabulary at
      `:275`.
- [ ] Acceptance (browser, Sonnet subagent): **the box has no audio input device and Chrome's
      fake-mic flags do not work headless here** — drive `MediaRecorder` from a Web Audio
      oscillator, as in [browser-testing-playwright.md](../project/browser-testing-playwright.md).
      What is being checked is that arming the mic makes the box `readOnly` and the send button
      dead, and that stopping it puts words in the box — not the transcription quality.
- [ ] Sweep for a fifth textarea before calling this done: `grep -rn "<textarea" tools/fleet/web/src`
      is four files today, and "pretty much all" is a claim about the set rather than about the two
      I happened to find.

**Stage 7 — the paperwork**

- [ ] `docs/project/fleet-dashboard-modes.md`: a mode may now be drawn outside the segment, and the
      `--dock-mode-count` register is `SEGMENTED_MODES.length` rather than `MODES.length` — that
      register is one of the two nothing checks, and this change moves it.
- [ ] `docs/project/dictation.md`: note that the fleet launcher no longer needs the stays-mounted
      workaround and why; and that the fleet's message boxes are dictated through
      `useFleetDictation`, with the context kinds the transcribe route will accept.
- [ ] `docs/project/overseer-direction.md` or the Overseer runbook: the Overseer's message box is now
      the first thing on that tab and is reachable in one press from the Sessions list.
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
- **The `focus` parameter that is never cleared.** It works perfectly the first time and then follows
  the reader to every tab. Stage 4's second assertion is the only thing that would catch it.
- **No microphone on this box.** Every browser check of Stage 6 is against a machine with no audio
  input device, so a dictation test that "passes" may be passing because nothing was captured. The
  Web Audio route is what makes the check able to fail.
- **A crowded Sessions header.** Sessions gains two buttons at its top right in Stages 3 and 4, on a
  row that already carries the count and the ordering control, at 390px. That row wraps rather than
  clips ([narrow-windows.md](../project/narrow-windows.md)) — worth a look at phone width before
  calling Stage 4 done.
