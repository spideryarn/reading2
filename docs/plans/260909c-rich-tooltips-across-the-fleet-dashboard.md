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

### Stage 1 — the survey, and the groundwork it turned up

*Status: done. Landed as `5db4c023`, on `dev` at `ac48cb43`.*

- [x] Fixture server on 8811, bind line confirmed against this worktree's `dist/`.
- [x] Browser survey of all eight tabs plus session detail, at 1280 and 390 — `logs/tooltips/survey.md`,
      18 screenshots in `logs/tooltips/shots/`.
- [x] Source census: every `Explain`/`Tooltip` site and every rendered-but-unexplained string, with
      the doc comment or wire type that holds the truth for each.
- [x] The three things the census made obvious, built.

#### What the two surveys found

**Coverage was real but wildly uneven.** 46 cards across 20 files — and *Box health* is close to
complete while *Recent messages* had **one** tooltip on the whole tab and *Queued ideas* had two,
neither on a row. So the work is not "add tooltips", it is "these two tabs, and the terms of art
nobody defined anywhere".

| What | Where | Why it was the first thing to fix |
|---|---|---|
| Three native `title=` attributes | `SessionsPanel.tsx` ×2, `ReadinessPanel.tsx` ×1 | Hover-only text on a page read on a phone. Shows under a mouse, so it passes every check a laptop can make. `Tooltip.tsx`'s header states the rule and they had accumulated anyway |
| `SectionHeading` could not take a tip | `ui.tsx` | Structurally no way to explain a heading. `Undated`, `History`, `Recently settled`, `The tree` are all words chosen for brevity, read by somebody who has never seen the tab |
| `source` drawn under the label `plan`, and `plan` never drawn | `QueuePanel.tsx` | The row named a field it was not showing and hid the one the label promised. Two genuinely different things: where the idea came from, and the plan the dispatched session wrote |

**The recurring unexplained shapes**, across tabs: short shas (`447d70f4`, `8985e7b`), tmux pane and
window ids (`$2705`, `%2708`), queue ids (`3v9879qs`), raw ISO timestamps
(`2026-09-09T05:51:02.547Z`), and snake_case window names (`nimbus_quill`, `seven_day`). Each is a
truncation or an internal spelling with the full value one card away — Greg's *"extra
detail/information that might be valuable"*, and it needs no new prose.

**Where the truth was missing.** Twenty-odd elements had **no source of truth anywhere** — the six
`QueueProblemKind` strings had no comment at all despite being rendered verbatim in a red alarm
card, and `QueueRow`'s `waitingOn`/`size`/`source`/`runs`/`areas` were bare fields. For those the
copy is quoted down from the **producer** (`tools/overseer/idea-queue.ts`, where each problem is
emitted beside its own sentence) rather than invented.

### Stage 2 — Recent messages

*Status: built, verifying in the browser.*

- [x] `SPEAKER_TIPS` in `Turn.tsx` — one card per speaker, quoted down from `transcript.ts` §
      `TurnSpeaker`. Used on the per-message badge (`Explain`, opens under a finger) and on the
      filter chips (`mouseOnly`, because a tap there toggles a filter).
- [x] `instant.ts` — the three-clock reading behind any instant the page prints, over `zones.ts`.
      Wired to the raw ISO on every message row.
- [x] `tests/fleet-speaker-tips.test.tsx`.
- [ ] Browser verification at 1280 and 390.

**The bug this introduced and had to fix, because it is the documented one.** `Chip` in `FeedPanel`
declared four props and dropped the rest, so a `Tooltip` around one handed it a ref and hover
handlers that went nowhere — `Tooltip.tsx`'s header names it exactly: *"a trigger that swallows the
ref opens nothing at all — with no error, and looking exactly like a page with no tooltips on it."*
It typechecks either way. Only the browser can tell.

### Stage 3 — Queued ideas

*Status: built, verifying in the browser.*

- [x] `BADGE_TIPS` — all eight badges, the tab's own point. `PROBLEM_TIPS` — the six ways the queue
      *file* can be broken. `FACT_TIPS` — the row's fields, spelled as the CLI's own flags.
- [x] The full `qi-` id behind the eight characters the row prints; `History` and `Recently settled`
      headings; `source` and `plan` separated.
- [x] `tests/fleet-queue-badge-tips.test.tsx` — enumerates by **reachability**, driving `badgeFor`
      over the cross-product of its three axes, rather than by a `Record` that would compile while
      explaining four of the eight.
- [ ] Browser verification at 1280 and 390.

**A card can trip a check that greps the page for a word.** The `on hold` tip quoted the phrase
*not approved* while explaining why that phrase used to be wrong — and an existing test asserts a
queue held by a broken file never says those words anywhere on the page. It went red. This is the
same trap `Header.tsx` already documents about `STALE`: *"an explanation that quoted the word would
satisfy that search on every page and quietly retire the check."*

### Stage 4 — the masthead and the Sessions list

*Status: built, verifying in the browser.*

These are the elements on screen the most: the masthead is on every tab, and the handles line is on
every card on the biggest one.

- [x] The masthead's four counts. **`quiet` appears on no row anywhere** — a reader looking for a
      `quiet` badge in the list below will not find one, because the row says `idle`, `shell`,
      `waiting 4m` or `no agent`. That is the single thing the card exists to say.
- [x] The Overseer line, all four states — including that *no Overseer session* is what the box
      looks like after a reboot rather than a rendering gap.
- [x] `HANDLE_TIPS` — the five handles on `bwj-quotes · $2705 · %2708`, which nothing anywhere
      defined. They are not interchangeable and the differences are load-bearing: `steer.ts` checks
      the pane's **pid** before typing, because that is the one thing that changes when a pane is
      respawned under the same `%`; and only the conversation uuid survives an agent exiting and
      another starting in the same pane.
- [x] The three band headings, through `SectionHeading`'s new `tip` — `Everything else` says nothing
      at all about what is in it and is the biggest band on a quiet box — and the `Order` control.
- [ ] Browser verification.

**The copy guard now covers 60+ tips** and asserts a floor on that number, because the three rules
it enforces are worth exactly what the size of the list is: an import dropped in a refactor would
leave every assertion passing over a shorter one.

### Stage 5 — the rest, by agreement

*Status: not started.* The Overseer tab's daemon line (`schema 2 · pid … · 351 ticks · instance
<uuid>` — six technical facts on one line, one of them explained). Usage limits, Readiness and
Deploys wait on their owners: `dashboard-design-system` restyles Usage limits first by agreement,
and tooltips go on after it rather than before.
