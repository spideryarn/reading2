# Rich tooltips across the fleet dashboard

Up: [plans.md](../project/plans.md). The component is
[Tooltip.tsx](../../tools/fleet/web/src/Tooltip.tsx); the copy rule is
[tooltips.md](../project/tooltips.md); the register a new tab must fill is
[fleet-dashboard-modes.md § The card on the button](../project/fleet-dashboard-modes.md#the-card-on-the-button).

> look through the web-dashboard, and add rich tooltips to anything that the user might require
> explanation of, and/or to provide extra detail/information that might be valuable
>
> — Greg, 2026-09-09

Queue item `qi-3v9879qs`. Session `dashboard-tooltips`, worktree `dashboard-tooltips`.

## What this is not

**It is not a greenfield tooltip pass.** The page already carries roughly 47 `Explain`/`Tooltip`
sites across 20 files — every session status, every health tile, the dock's eight tabs, the
masthead's age. So this plan is a **gap-filling** pass, and its first job is to find what is *not*
covered rather than to re-cover what is.

Greg's sentence has two halves and they are different pieces of work:

1. **"anything that the user might require explanation of"** — a term of art, a badge, a status word,
   a unit. The answer is a definition plus, where the field's wire comment earns it, what its
   *unknown* arm means.
2. **"extra detail/information that might be valuable"** — the untruncated value behind a truncated
   one. A relative time's absolute instant in
   [UTC, London and Athens](../../tools/fleet/zones.ts); a short sha in full; a session's tmux id and
   Claude session id; the raw reason behind a rendered verdict. This half needs no new prose at all —
   it surfaces data the page already holds and throws away.

## Rules this pass works under

- **The copy describes the artefact, not the gesture.** A tooltip is read on hover, on tap, by a
  screen reader as `aria-describedby`, and in this file — *"click to X"* is false on three of the
  four. [tooltips.md](../project/tooltips.md).
- **A tooltip never asserts more than the field's wire comment claims.** No "healthy" over an
  *I could not tell* arm. The truth lives in [`wire.ts`](../../tools/fleet/wire.ts)'s headers,
  [`types.ts`](../../tools/fleet/web/src/types.ts), and the panels' own doc comments — the copy is
  **quoted down from those**, never invented.
- **No `mouseOnly` except where a tap must do something else** (today: only the dock). Everywhere
  else a finger opens the card.
- **Nothing paid, nothing fetched on hover.** A card renders data already on the page.
- **`Explain` writes the same sentence into the accessible name**, so the card is never the only
  copy of the words.

## The simpler option passed over

Adding a plain `title=` attribute to each uncovered element. Rejected: `title` is invisible on a
phone (this page is read one-handed), unstyled, delayed by the OS rather than by us, and cannot hold
the two-paragraph *what / how* shape the rest of the page already uses. The component exists and is
already the page's idiom; a second mechanism would be the "two ways to do one thing" AGENTS.md
forbids.

## Coordination

Other sessions are live in `tools/fleet/web/src/` right now. Agreed order, per the Overseer
(2026-09-09):

| File / area | Session | Order |
|---|---|---|
| `DeploysPanel.tsx` | `deploys-ui` | after theirs lands, or by agreement |
| `ReadinessPanel.tsx` | `readiness-tab` | after theirs lands |
| `ActionButtons.tsx`, the steer parts of `SessionDetail.tsx` | `claude-agents-dashboard` | not mine |
| every tab, restyle | `dashboard-design-system` | **tooltips first on a tab I have started; their restyle first on a tab I have not.** Land tab by tab so the handover is per tab |

Not mine at all: server files, `wire.ts`, `tools/overseer/**`, `src/web/**`.

## How this is verified

**A fixture server, not the live dashboard.** `logs/tooltips/fixture-server.mjs` serves this
worktree's own `tools/fleet/web/dist/` over a frozen capture of 8787's GET routes, on
`127.0.0.1:8811`, confirmed from its own bind line rather than by curling the port
([memory: curling a port cannot tell two servers apart](#)). That gives before/after screenshots
that differ only by the diff, and it touches no live session: the real server collects, describes
with a paid model, and runs a delivery drain that types at real panes, none of which is wanted for a
screenshot.

`logs/` is gitignored, so neither the fixtures nor the shots are committed.

## Stages

### Stage 1 — the survey

*Status: in progress.*

- [x] Fixture server on 8811, bind line confirmed against this worktree's `dist/`.
- [ ] Browser survey of all eight tabs plus session detail, at 1280 and 390 (Sonnet subagent,
      read-only, Playwright on system Chrome).
- [ ] The census table below: element · tab · what it needs · which doc or wire comment holds the
      truth.

#### The census

*To be filled from the survey.*

### Stage 2 — the cheap, high-value half: absolute detail behind truncated values

*Status: not started.*

### Stage 3 — definitions, tab by tab

*Status: not started.*

### Stage 4 — verification and review

*Status: not started.*
