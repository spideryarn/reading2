# Borrow the reading app's machinery for the fleet dashboard

Queue item `qi-czanp63a`. Owner doc: [fleet-dashboard-modes.md](../project/fleet-dashboard-modes.md).

> In general, borrow more machinery from Spideryarn, e.g. it has a nice interface for columns in the
> main reading app (where the mode shows in the left-hand column, and the main text shows in the
> right) - we could use this for the Sessions mode, where the sessions show in a list or as cards
> with rich tooltips in the left-hand column, with the Session detail for the active session in the
> main/right-hand column-pane. Also it has nice machinery for handling urls, back buttons, state,
> etc. This might require a bigger rewrite, but let's try and borrow/reuse the best ideas and
> machinery and approaches from it where it makes sense to do so.
>
> — Greg, 2026-09-09

**Status: plan revised after GPT Sol's review; building.**

## What the inventory found (stage 0, done 2026-10-06)

Two read-only inventories, one per application. The headline is that **most of what Greg asked for
landed between his message and today**, so this is not the bigger rewrite it was queued as.

| Area | Reading app (`src/web/`) | Dashboard (`tools/fleet/web/src/`) today | Gap |
|---|---|---|---|
| Columns | `layout.ts`: pure arithmetic, band beside prose, columns given up in JS not CSS | `SessionsPanel.tsx` + `fit.ts` § `choosePanes`: list in a 340px left column, detail in the right pane, measured at 740px; on a phone the detail replaces the list with "← All sessions" | **none** for Sessions |
| Tooltips | `Tooltip.tsx` (floating-ui, leaf), `useHoverCard.ts` | `Tooltip.tsx`, a reduced port; used on badges, chips, band headings | **no card on a session card itself** — and in the left column the card is `compact`, so it has dropped the question's options and material |
| Narrow windows | `dock-fit.ts` ladder, wrap-don't-shrink, measure-don't-guess | `fit.ts`, ported; no width media queries at all | **none** |
| URL / Back / state | real query string via nuqs; history assigned **per parameter**: position and text debounce and replace, selections replace, deliberate acts push; Back never crawls | `mode.ts`: the hash, one writer, **every write is a push** | **this is the real gap** |
| Mode registry | a shared vocabulary and compiler-checked records, with catalogue copy, labels and dock presentation separately owned | four registers in two files plus an unchecked mount ([fleet-dashboard-modes.md § What this costs](../project/fleet-dashboard-modes.md#what-this-costs)) | known cost, never fixed |

What every write being a push costs, concretely:

- **Typing in the Recent messages text filter pushes one history entry per keystroke**
  (`FeedPanel.tsx` `onChange` → `onFilters` → `setParams` → `window.location.hash =`). Typing
  "overseer" and pressing Back removes one letter.
- Clicking through ten sessions in the left column makes ten entries; Back walks all ten before it
  leaves the tab.
- "← All sessions" on a phone **pushes** a list entry rather than going back, so list → A → list is
  three entries and Back from the list reopens A.
- The list's scroll position is not kept: on a phone, opening a session forty rows down and coming
  back lands wherever the detail left the page.

### What does not carry over, and why

- **The code itself.** `tests/fleet-imports.test.ts` lets `tools/` import only leaf, browser-only,
  product-agnostic `src/` modules, because the dashboard must run with the product absent.
  `params.ts`, `router.ts`, `jump-history.ts` and `position.ts` are coupled to slugs, block ids and
  routes; `layout.ts` type-imports the product's mode list. So what carries over is the **rule**, not
  the module.
- **The real query string and nuqs.** The reading app left the hash because a hash target scrolls the
  page by itself and because a hash beside a query is two state systems. Neither applies here: the
  dashboard's fragment never names an element, and it has no query. A real query string would work
  here too (the server strips it before resolving a file), but the fragment already supports
  bookmarks, parsing and navigation, and migrating it buys nothing. Simpler option taken: keep it.
- **`interface-vision.md`'s three columns.** Not decided in the product either.
- **Importing the product's `Tooltip.tsx` instead of the port.** It is a true leaf and could be
  allowlisted, which would end the drift between the two copies. Not in this plan: it swaps a
  282-line port for a 673-line module plus a second stylesheet on the page the Overseer relies on,
  for no change a reader sees. Reported in the debrief as a separate proposal.

### Composing with the landing surface (`qi-thd98yqw`) and Questions / Decisions

The landing surface is still a proposal nobody has authorised, so nothing here builds it. What this
plan must not do is make it harder:

- Stage 3 names "which mode an empty hash opens" as one constant, so a landing mode that
  **replaces** Sessions as the first screen is that line plus its registers.
- Stage 1's history rule is stated per *kind of write*, not per panel, so Questions' and Decisions'
  `go("sessions", { sel })` (a deliberate jump: push) need no special case, and Back from the session
  returns to the question that sent you.

## Stages

Ordered by value over effort. Each ends green and committable; any can be dropped without stranding
the others. **Revised 2026-10-06 after GPT Sol's plan review** (verdict: do not build as first
written; findings F1–F9 in
[the review](261006l-borrow-the-reading-app-s-machinery-plan-review-sol.md), dispositions under
[§ Plan review](#plan-review)).

### Stage 1 — Back undoes the last deliberate act (history discipline in `mode.ts`)

The reading app assigns history per parameter: a deliberate act pushes, a selection or a continuous
value replaces. The table below is the **dashboard's own** assignment, borrowed in spirit:

| Write | History |
|---|---|
| a mode change (`chooseMode`, `go` to another mode) | **push** |
| opening a session from the list (`sel`: none → id) | **push** |
| switching session while one is open (`sel`: A → B) | **replace** |
| closing the detail (`sel`: id → none) | **replace** |
| order, limit, every feed filter, text included | **replace** |

So browser Back from an open session returns to the list, Back never walks sessions or letters, and
"← All sessions" keeps every preference set while the detail was open. The cost accepted for v1:
list → open A → "← All sessions" leaves two identical list entries, so one Back press there does
nothing visible. (Sol's F2: closing with `history.back()` would instead silently undo an order
changed inside the detail.)

Mechanism, all inside `useHashState`:

- `historyKindFor(prev, next): "push" | "replace"`, pure, exported, unit-tested. The kind is derived
  in one place from the before and after states, so no panel can pick the wrong one and call sites
  keep calling `go` / `setParams` unchanged.
- **Owned writes go through the History API, both kinds**: `history.pushState(history.state, "",
  spelled)` and `history.replaceState(history.state, "", spelled)`. Neither fires `hashchange` or
  `popstate`, so the page's own writes never come back as events. (Sol's F10, round two: with push
  left as `window.location.hash =`, its queued `hashchange` re-read a stale address after a replace
  that threw and undid the newer selection.)
- The latest logical state lives in a ref, updated before the address write; later writes and their
  history kind are derived from the ref, not from a render. Writes are **synchronous**, so every
  existing test that reads `window.location.hash` straight after a control still holds (F1).
- **No debounce.** The first draft had a 300 ms trailing debounce and Sol showed (F3) that it needs a
  real protocol against pushes and traversals. All it bought was staying under Safari's limit of 100
  History API calls per 30 s, which only sustained fast typing in the feed's text filter can reach.
  Instead both calls are wrapped in try/catch: a throw keeps the logical state and the rendered view
  and leaves the address at its last successful value; the next owned write that succeeds persists
  the whole latest state. **Known and accepted:** while writes keep failing the address is stale, and
  a reload in that window restores the older address.
- `hashchange` and `popstate` are both listened to for **incoming** navigation (Back, Forward, a
  hand-edited address): re-read the actual location and adopt it into the ref and React state. An
  explicit incoming navigation supersedes a local change that was never persisted.

Scroll, in `SessionsPanel` rather than the hook (F5), because only the panel knows the measured
one-pane layout and when the list has mounted again: capture `window.scrollY` when a session is
opened from the one-pane list; when the selection clears and the list has mounted, restore it and
return focus with `preventScroll`. Used for both "← All sessions" and browser Back, and it runs after
any attempt the browser makes, toward the same position. With nothing saved (a deep link), no
restoration is attempted.

Simpler option passed over: *replace everything except mode changes*. On a phone Back from a session
detail would then leave the Sessions tab instead of returning to the list, which is the Back press a
phone reader makes most.

Done when: red-first tests for each row of the table (history length, and what Back lands on), the
keystroke case, the F10 regression (push A, a throwing replace to B before queued events drain,
drain, B is still shown; then recovery persists the whole state), Back and Forward adopting their
destinations, and the one-pane scroll restore; existing hash assertions unchanged.

### Stage 2 — A preview card on each session in the left column

When a session is open, the left column's cards are `compact`: the question drops its options and
material ("3 options — open it to read them"). Hovering one should show what was dropped, so the
reader can decide whether to switch without switching. (Descriptions clamp at both widths; the
preview shows them unclamped.)

- Trigger: the card's existing title button (`.session-open`, already stretched over the card).
  `mouseOnly`, as on the dock: a tap there already selects, and a card would land over the pane the
  tap just opened. Focus still opens it.
- Content: **presentational, built from the row's data and the existing formatters, with no
  `Explain` buttons and nothing focusable** (F6: the tooltip surface is `pointer-events: none` with
  `role="tooltip"`, so a control inside it could not be reached). Name, status and its detail, the
  full description, where it runs, the question's prompt and its option labels. Height bounded; what
  does not fit is said to be one click away, never silently cut.
- **No new data, no new read**: everything is on the pushed row.
- Only when `compact`.

Larger option passed over: a preview of the session's recent messages, which needs a per-session
transcript read on hover. Left as a question for Greg.

Done when: tests that the card opens on hover and on focus of a compact card and names the options
the compact card dropped, holds no focusable element, bounds a long question and says so, does not
exist on a full-width card, and does not open on touch; a browser check at desktop, iPad and phone
widths.

### Stage 3 — A mount the compiler checks, and the doc made true

Replace `App.tsx`'s ten ternaries with one `switch (mode)` ending in a `never` check, so a mode with
no panel is a compile error rather than an empty page; name `DEFAULT_MODE` in `mode.ts`, the one
line a landing surface would change. Then correct fleet-dashboard-modes.md, which still says the
coarse-pointer share count is a literal `3` (it has come from `MODES.length` through
`--dock-mode-count` for some time) and that the mount is unchecked.

**Dropped from the first draft:** folding the four registers into one table. Sol's F7: a table with
icons in it makes lucide a dependency of every pure hash test through `mode.ts`'s re-exports, and
F8: the reading app does not have one table either — vocabulary, catalogue copy, labels and dock
presentation are separately owned on purpose. The three `Record<Mode, …>` maps are already
compiler-checked; the mount was the only real hole.

Done when: typecheck fails on a mode removed from the mount (seen, then restored); the doc's table of
registers matches the code.

## Plan review

GPT Sol, 2026-10-06, read-only, on the first draft. Inventory confirmed accurate by harness.

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| F1 | P1 | debouncing discrete controls breaks existing synchronous hash assertions | accepted: all writes synchronous |
| F2 | P1 | close-by-`back()` silently undoes preferences changed inside the detail | accepted: close replaces |
| F3 | P2 | "flush or cancel" is not a debounce protocol | accepted further than proposed: no debounce at all |
| F4 | P2 | a boolean history mark does not prove "this page's life" | moot: the mark is gone with F2 |
| F5 | P2 | scroll restore needs a rendering boundary | accepted: lives in `SessionsPanel` |
| F6 | P2 | card parts with `Explain` buttons cannot go in a `pointer-events: none` tooltip | accepted: presentational preview |
| F7 | P2 | a combined table does not keep lucide out of hash tests | accepted: consolidation dropped |
| F8 | P3 | product inventory overstated one table and uniform debounce | accepted: wording corrected |
| F9 | P3 | static hosting does not require a fragment | accepted: rationale corrected |
| F10 | P1 | round two: after a throwing replace, the queued `hashchange` of an earlier push undoes the newer state | accepted: owned pushes use `pushState`, state held in a ref |

Round two's verdict: build with the listed changes. Discovery on the plan is closed.

## Reviews

Plan: GPT Sol, read-only. Each stage: GPT Sol, write-capable, two rounds at most. Browser check by a
Sonnet subagent after stages 1 and 2 against a private port, never `:8787`.

## Log

- 2026-10-06 — inventories done; plan written; two rounds of Sol on the plan (F1–F10).
- 2026-10-06 — **Stage 3 landed.** `App.tsx` mounts through one exhaustive `switch`; `DEFAULT_MODE`
  named in `mode.ts`; fleet-dashboard-modes.md and its two signposts now say five places in three
  files, each compiler-checked. Seen red both ways: before, a fake mode in all four registers with
  no arm typechecked clean; after, deleting `case "ideas"` fails with TS2322 `'"ideas"' is not
  assignable to type 'never'`. The inventory table above describes the state before this stage.
  Noticed, not changed: `overseer-queue.md` still lists the `.dock-modes` share count as open work
  (closed 2026-09-09 in `3ac70cc21`) — reported to the Overseer, who owns that file's queue.
- 2026-10-06 — **Stage 1 landed.** `historyKindFor` in `mode.ts`; `useHashState` writes with
  `pushState` / `replaceState` in a try/catch, from a ref of the latest state, and adopts
  `hashchange` and `popstate`. `SessionsPanel` restores the one-pane list's scroll and returns focus
  to the row. Tests in `tests/fleet-history.test.tsx`, seen red first; no existing test changed.
  Differences from the plan, and things found:
  - **The ref retires the closed-over-snapshot bug for every writer**, not only inside `go`:
    `setParam` twice, or `chooseMode` then `setParam`, in one handler now compose (two tests). The
    writers' identities are stable as a result. `go` and `setParams` stay the one-write, one-entry
    way to say it.
  - **The F10 test only has teeth with both clicks before any `await`.** An awaited `act` drains
    jsdom's queued events, and the first version passed against a push deliberately reverted to
    `window.location.hash =`. With two synchronous `act`s that mutation goes red.
  - **After a refused write the kind is still derived from the ref**, as planned, so a refused
    *push* is not retried as a push: the next write replaces, and Back from that session leaves the
    Sessions tab. Deriving the kind from the address instead would trade that for the opposite
    error after a refused close. Left as planned.
  - Scroll is captured only for a row opened in `SessionsPanel`'s own list. A card opened from the
    "needs you" panel above it at one pane saves nothing, so closing restores nothing.
  - jsdom has no `window.scrollTo`, so the existing 390px open-and-close test in
    `tests/fleet-web.test.tsx` now prints one `Not implemented: Window's scrollTo()` line. It passes.
  - Not checked in a real browser: that the restore lands after Safari's own scroll restoration on
    Back, and the `SecurityError` limit itself.
- 2026-10-06 — **Stage 2 built; no browser check yet.** `SessionPreview.tsx` (new) is the card;
  `SessionsPanel.tsx` § `PreviewOn` wraps the title button in the existing `Tooltip`
  (`placement="right"`, `mouseOnly`). `Tooltip.tsx` and the stylesheet are untouched. Tests in
  `tests/fleet-session-preview.test.tsx`: seven red first (`Error: no preview is open`), the two
  absence tests proved by mutation instead. No existing test changed. Differences from the plan:
  - **Not on the selected card either**, only on the other compact ones. Its detail is the whole
    right-hand pane, and this is also what takes the preview down when its session is clicked —
    otherwise it would sit over the detail the click just opened until the pointer left.
  - **Cut in the data, not with `line-clamp`.** A clamp cannot know whether it clipped, so it cannot
    say so. Description and prompt are cut at 600 characters, options at 6, each with a line saying
    the rest is in the session. Material is never shown; one line says so when there is some.
  - **The button remounts when a card gains or loses its preview**, because `Tooltip` cannot be
    switched off in place. Harmless today: a selection moves focus to the detail, and the scroll
    restore finds the row by `data-session` after the commit. An `enabled` prop on `Tooltip` would
    remove it; not done, since the stage excludes changing `Tooltip`.
  - Focus opens it in jsdom because Floating UI skips its `:focus-visible` test there. That a tap's
    focus does not open it in a real browser is therefore untested here, and is for the browser check
    — as is the placement over the detail pane at desktop and iPad widths.
