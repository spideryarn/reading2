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

### The cross-family review, and what it changed

*Status: done. GPT Sol, `logs/tooltips/review-answer.md`, exit 0 and a fresh non-empty answer.*

**Six P0s and every one of them was the same mistake: a card asserting more than its source
establishes.** That is the rule this plan opens with, which is the point — the rule was easy to
state and I broke it six times while believing I was following it, because every sentence *felt*
quoted. Each one is fixed and each carries a comment saying what it used to claim.

The two worth reading twice:

- **A source that contradicts itself, and I quoted the wrong half.** `types.ts` says
  `claudeSessionId` is what distinguishes this agent from the one that replaced it — and then, two
  paragraphs down, that every identifier above `execution` *survives* a claude exiting and another
  starting in the same pane, that one included, because it is a launch claim written once. Both
  paragraphs are in the same doc comment. **Quoting a source is not enough when the source disagrees
  with itself**; the later, narrower paragraph is the careful one. The field comment still needs
  reconciling by whoever owns `types.ts` — flagged to the Overseer, not edited here.
- **The `ready` badge card said the page never recomputes the verdict, and the page does.**
  `badgeFor` derives the badge on the client from three axes and never reads `row.ready`. The
  server-computed thing is the *sentence under the title*. I had read the panel's header — which
  says the verdict is the server's — and attached it to the wrong element.

**An accessibility regression introduced by an accessibility improvement.** A `<button>` is a
labelable element, so wrapping `Order` in an `Explain` *inside* the `<label>` made the button the
labelled control and left the `<select>` with no accessible name.

**And a retreat I asserted was sufficient, which was not.** I argued that a phone reader still has
`row.why` — but `why` is null exactly when an item is ready, `sr-only` reaches a screen reader and
nobody else, and neither ever gives the full `qi-` id. Naming a fallback is not the same as checking
it covers the case.

**The guard was quieter than it looked.** Blanking string literals as well as comments meant that an
apostrophe in JSX text (`session's transcript`) blanked everything up to the next one — so a real
`title=` in between would have vanished. **A guard that goes quiet is worse than one that cries
wolf**, so it blanks comments only now and accepts a loud false positive. The allow-list is a count
rather than a file; the coverage floor was 60 against ~70 reachable tips, so dropping a whole map
passed it.

**Two of my own tests broke, and broke for the right change** — they asserted on phrases from the
copy the review improved. They read the sentence out of the exported map now.

### What this pass learned, that the plan did not know

**Adding an explanation is not a read-only act on the DOM.** Three of the four things that went
wrong here were caused by the *trigger*, not by the words:

- `Explain` renders a `<button>`, so a trigger has to hand over its ref and its handlers. `Chip` in
  `FeedPanel` declared four props and dropped the rest, and the resulting chip had no hover
  behaviour at all — no error, and identical to a page with no tooltips on it. It typechecks either
  way.
- A `<button>` inside a `<button>` is invalid and reads as one control, which is why the queue
  badge and short id are `Tooltip` + an `sr-only` span rather than `Explain`: they sit inside the
  row's own disclosure button.
- A button is `display: inline-block` where a `<span>` is inline, so wrapping the three handles on
  `name · $2705 · %2708` changed the wrapping objects on the one line where `break-all` is
  load-bearing (`Mono`'s comment: an unbreakable `$1643`-shaped string is what pushes a card wider
  than a phone).

**A card can trip a check that greps the page for a word**, and the trap is already documented one
file over: `Header.tsx` deliberately keeps `STALE` out of its own freshness tip, because *"an
explanation that quoted the word would satisfy that search on every page and quietly retire the
check."* The `on hold` tip hit exactly this with *not approved*.

**A check written to catch prose can read its own prose.** The `title=` scan reported a doc comment
that merely mentioned the attribute. The fix — blanking comments and strings — can just as easily
blank the thing being looked for, so it has its own test that a real attribute survives it.

**Two more, from `dashboard-design-system` working the same page in parallel**, recorded here
because they are the same lesson from the other side and it should be learned once:

- The over-long thing on a tab full of tooltips turned out to be **visible copy, not a tip** — a
  hand-written prefix restating the sentence the producer already supplied. So: check the visible
  copy alongside the cards.
- **An honest absence drawn as a fault is invisible to every test you can write.** A window whose
  reading could not be validated was mapped onto the *the source broke* state rather than the *it
  cannot be shown to be about you* state, producing red alarm cards on a tab whose verdict was
  "cannot tell". Both arms are legitimate, so everything stayed green; only the picture showed it.

The common thread is that all six were found by a picture, a peer, or a test going red — and none by
re-reading the diff.

### Stage 5 — the rest, by agreement

*Status: not started.* The Overseer tab's daemon line (`schema 2 · pid … · 351 ticks · instance
<uuid>` — six technical facts on one line, one of them explained). Usage limits, Readiness and
Deploys wait on their owners: `dashboard-design-system` restyles Usage limits first by agreement,
and tooltips go on after it rather than before.
