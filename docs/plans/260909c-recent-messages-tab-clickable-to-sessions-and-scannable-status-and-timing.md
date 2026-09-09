# Recent messages: clickable through to the session, scannable at a glance

Status: **in progress**. Worktree `feed-clickable`, queue item `qi-eaeksef5`.

> can we make "Recent messages" much more clickable (e.g. click to be taken to that session in
> Sessions) and scannable (e.g. to see at a glance the status and human-readable timing of each)
>
> — Greg, 2026-09-09

The tab itself landed the night before —
[260909b](260909b-recent-messages-tab-a-rolling-window-across-all-agents.md), and everything it is
entitled to claim is [fleet-recent-messages.md](../project/fleet-recent-messages.md). This is the
follow-up: the window is honest, and now it has to be *usable* — a row you can act on, and a list
you can read without opening anything.

## What this is for

Eighteen sessions on the box. The feed answers *what is the fleet saying*, and right now every
answer it gives is a dead end: you read a line that worries you, and then you go to Sessions, find
the row by name among thirty, and open it. Two of the three costs of that are avoidable.

And it is currently a wall of near-identical rows. Each carries a session name, a speaker, and a raw
ISO timestamp on the box's clock — `2026-09-09T04:17:22.118Z` — which is a string you *parse*, not
one you *scan*. What you cannot see at a glance is the two things you came for: whether that session
is still working, and how long ago it spoke.

## The design

### 1. Clickable — through the hash that already carries both

**The hash can already carry a mode and a selection**: `#sessions?sel=%241643` is what the Sessions
list writes when you pick a row ([mode.ts](../../tools/fleet/web/src/mode.ts) § the hash), and
`FeedRow.sessionId` **is** `FleetRow.id` — [routes-recent-feed.ts:596](../../tools/fleet/routes-recent-feed.ts)
sets `sessionId: row.id`, the same tmux handle `sel` holds. So there is nothing to design at the
addressing level and no second navigation mechanism to build. Good.

What is missing is one **atomic** write. `chooseMode(mode)` keeps the current params and changes the
mode; `setParam(key, value)` keeps the current mode and changes a param. Calling both is the exact
bug mode.ts already carries a warning about: each closes over the same captured snapshot, so the
second overwrites the first and the selection is silently dropped. So:

```ts
go(mode, changes)   // one write: a mode AND a set of parameter changes
```

`chooseMode` and `setParams` both become one-line calls to it, so there is one write path rather
than a third. **This does not make the general hazard go away** — Sol's P2, and it is a fair
correction to an earlier draft of this paragraph: two wrappers called in sequence still close over
one render's snapshot. The rule is *call `go` once whenever the mode and a parameter change
together*, not *the stale-composition problem is solved*.

**Back returns to the feed with its filters intact, for free.** `write` assigns
`window.location.hash`, which pushes a history entry, and `go` carries the existing params through —
so the filter keys (`mq`, `ms`, `mw`, `mt`, `mn`) survive the trip out and the browser's own back
button restores `#messages?…` with all of them. Nothing to store, nothing to serialise.

**The session name becomes the button, not the whole row.** The row body already holds two
controls ("Show the rest of this message" / "Collapse"), and the text is agent prose a reader
selects and copies. A whole-row click target swallows both. The session name is what a reader
points at when they mean "that one", it is already drawn first on the row, and making it a button
keeps the row's other affordances working.

**A session that has since gone is not a broken link.** `SessionsPanel` already draws
`MissingSession` for a `sel` it cannot find, which is the right answer here: the feed's census is up
to a minute older than the session list, so a row for a dead session is an ordinary state.

**Scroll, and focus with it.** One rule for both widths: when the selection changes, the *detail* is
focused (`preventScroll`) and then scrolled into view (`block: "start"`), **instantly, from a
callback ref**. Both of those qualifications are browser findings rather than design:

- `behavior: "smooth"` is an animation, and this one was being cut short by the mode switch and a
  container re-measurement landing on top of it. From a feed scrolled to the bottom of a 1280×600
  window the page moved 25px of the ~90 it owed and stopped, leaving the detail's status badge 68px
  *above* the viewport — the reader in the middle of a card with nothing saying whose it was. A
  half-finished animation looks exactly like a scroll that never fired.
- An effect keyed to `selectedId` is spent too early. The detail renders into one of two branches
  chosen by a *measured* width, and not at all until there are rows to list, so the element can
  attach a render or two after the selection changed. A callback ref fires when the node actually
  attaches; a `scrolledFor` ref keeps it to once per selection, so a later re-attach — a resize
  crossing the two-pane threshold — does not yank a reader who has since scrolled somewhere else.
- **The top of the viewport is not the top of the page.** `.masthead` is `position: sticky`, so
  `block: "start"` aligns the detail to the scroll box and the header then paints over it: the badge
  landed 27.92px under a 116.92px header at 1280, and 107px under a 255.375px one at 390 — a
  non-negative number that still means *hidden*. The target now carries a `scroll-margin-top` equal
  to the masthead's **measured** height, because those two numbers differ by more than a whole
  header and any constant would be wrong at one of them. The fallback is zero, which is the
  behaviour this replaces. At 390 there is one pane
and the detail has replaced the list, so this is "go to the top of what I just opened". At 1280 there
are two panes and the detail is the right-hand column, so this puts the thing the click was *for* on
screen; the selected card keeps its existing `selected` highlight so it is findable in the list
afterwards. Focus has to move too, and Sol was right that scrolling alone is not enough: the control
that was activated is on a tab that has just been swapped out, so a keyboard or screen-reader user
would be left holding a button that no longer exists while the page quietly scrolled elsewhere.

The alternative — scroll the *card* into view — is what the brief's wording suggests and I passed it
over: `block: "start"` on a card halfway down the left column pushes the detail's top off screen, and
the reader clicked to read the session rather than to look at its card. (I also wrote that
`block: "nearest"` on an over-tall element *always* aligns its bottom edge; Sol is right that it
depends which edges are outside. The choice stands, the reason was overstated.) Verified in the
browser at both widths, including from a feed scrolled to the bottom — § Stage 3.

### 2. Scannable — the same status, from the same field

**The status comes from the live session list, not from a second reading.** `App` already holds
`feed.state.rows` — the `FleetRow[]` the Sessions tab renders — so the feed panel is handed that
array and looks a row up by `sessionId`. It then draws `<StatusPill status={row.status} />`: the
identical component the Sessions list and the detail pane draw, with the same tone map and the same
tooltips. There is **no status field on `/api/feed`**, and structurally no way for the two tabs to
disagree — which is the requirement in
[overseer-direction.md § `idle` is the bug](../project/overseer-direction.md).

**But the handles have to name the same world before they may be compared, and that DID need a
server field.** A `sessionId` on the feed is a tmux session handle, and `$1643` means nothing outside
one tmux server — the argument [collect.ts](../../tools/fleet/collect.ts) already makes about
comparing two snapshots. `/api/feed` was discarding the snapshot's `tmuxServerPid`, so after a tmux
restart a feed row would take an unrelated new `$1643`'s status **and a click on it would open the
wrong conversation**, both looking entirely normal. That is GPT Sol's P0 on this plan and it is
right. So one additive field goes on the payload, and the join is gated on it.

**But not knowing and knowing otherwise are two different arms**, and the first version of this
collapsed them. A browser check found out how badly: a fixture server that had not been given the new
field turned *every row on the page* into a refusal — no statuses, no links, the whole feature
silently off. That is what any server predating the field would do, which is the "warning that never
clears, and one nobody reads" that
[fleet-recent-messages.md](../project/fleet-recent-messages.md) already names as this tab's
characteristic failure. So: a **missing** pid says *status not checked* and **keeps the link** — the
destination pane prints the session's own name and handle, so being wrong is bounded and visible —
while two pids that actually **disagree** say *cannot be matched to a session* and drop the link,
because that is proof rather than ignorance.

**Five arms, and none of the four silences is calm.** The first draft of this plan had three; Sol's
partition is the one built:

| what is true | what the row says |
|---|---|
| no state payload at all | *session list has not arrived* |
| a payload, but `collectedAt === null` | *no session census yet* |
| one side did not say which tmux server it read | *status not checked* — **and the name stays a link** |
| the two `tmuxServerPid`s actually disagree | *cannot be matched to a session* — and the name stops being a link |
| a finished census, no such row, `unreadableRows > 0` | *not in the readable session list* |
| a finished census, no such row, none dropped | *not in the current session list* |
| a row is there | its pill, verbatim |

The second arm is the one that would have shipped wrong: the server answers a perfectly good payload
with no rows for the ten seconds a first collection takes, and reading "not in the session list" off
that calls **every session on the box** absent. It is the distinction `SessionsPanel` already draws
between "No sessions." and "Collecting…", and `App` builds the reading arm by arm so `rows: []`
cannot stand in for either silence.

**The age.** `turn.at` is an ISO timestamp on **the box's clock**, so the age is
`now − shiftMsToBrowserClock(Date.parse(at), skew)` through `formatDuration` → `4m ago`, `2h ago`.
That is the one clock discipline this page has (`ClockSkew` in types.ts), and it is a *subtraction*,
which is the case the shift is for.

**The absolute time is NOT shifted**, and this is the trap. `withClockSkew` in messages-client.ts
carries GPT Sol's K4 in its comment: shifting a string that is *printed as a wall clock* asserts an
absolute instant nothing happened at. So the hover shows `zonedLine(turn.at)` — UTC · London ·
Athens, the box's own instant, exactly as `UsagePanel` and `DeploysPanel` print theirs. Age shifted,
timestamp not; both from one `at`. It is memoised on the timestamp: the page re-renders every
second, `zonedLine` runs three `Intl.DateTimeFormat`s, and at the 200-message limit that is 600 of
them a second for a string that cannot have changed — the Deploys panel measured the same
un-memoised work at 110–126 ms per second.

**And an age has three answers, not one.** Two of them exist because this is a subtraction across
*two* clocks rather than within one, which is what makes clamping — the right answer for `uptime` —
the wrong one here:

- **`unplaceable`** — no timestamp, or one this page cannot parse. The literal `formatDuration(now −
  NaN)` the first draft implied returns `—`, so the row would have read `— ago`. The raw string is
  shown instead.
- **`ahead`** — stamped more than `CLOCK_SKEW_NOTICE_MS` into the future. A real minute of
  disagreement between two clocks is a finding, and "0s ago" is the most reassuring words on the row
  to hide it behind. Under that threshold it rounds to now, because the skew being corrected by is
  itself understated by one-way latency.
- **`aged`**, hedged to *"about 4m ago"* while the skew is unknown. This tab has its own route and
  can be on screen before any state payload — and the masthead prints its clock note only once one
  has arrived, so nothing else on the page would qualify the number. One word is the difference
  between a reading and a guess.

**Grouping: flat, newest-first, keeping the session chip.** Considered and rejected: grouping the
rows by session. The tab's entire premise is *one global ordering across agents* — that is what the
exact-merge proof and the four coverage premises in
[fleet-recent-messages.md](../project/fleet-recent-messages.md) are for — and grouping by session
throws that ordering away to rebuild, badly, the per-session view that already exists one tab over.
What the flat list needed was not grouping but a **left edge in the session's status tone**, the
same `tone.edge` a `SessionCard` carries: it makes "which of these are from working sessions" a
colour you sweep rather than a word you read, at no cost to the ordering.

## What I passed over

- **A `status` field on `/api/feed`.** It would be a second reading of the same tmux output, on a
  different cadence, with nothing keeping the two in step — and the route is not mine. The live
  `rows` are already in the page.
- **A router.** `hashchange` is the one navigation event a browser gives for free, and the hash
  already carries everything. mode.ts § the hash argues this at length.
- **Making the whole row a click target.** See above: it swallows the expand control and text
  selection.
- **A relative-time formatter of its own.** `formatDuration` is the page's one, and every other age
  on screen is derived from it.

## Stages

### Stage 1 — clickable

**Done.** The four tests went red first; the Back one was mutation-checked by swapping `write` for a
`history.replaceState` and watching it fail, which is the only way to know it is testing a push
rather than the absence of one. Two of the four passed vacuously on the first run — `opener(…)?.click()`
on a missing button is a no-op, so "the filters survived" was true of a page that had navigated
nowhere. The helper now throws.

- [x] `mode.ts`: `go(mode, changes)`, with `chooseMode`/`setParams` rewritten onto it.
- [x] `App.tsx`: `onOpenSession` passed to `FeedPanel`.
- [x] `FeedPanel.tsx`: the session name is a button.
- [x] `SessionsPanel.tsx`: focus and scroll the detail when the selection changes.
- [x] Tests, red first: a full-`App` mount on `#messages` with filters set, a click on the session
      name, and an assertion that the hash carries **both** `sessions` and `sel` **and** every filter
      key; a real Back regression; and — after Sol's P2 — a mount holding real fleet state, proving
      the detail actually opens and takes focus rather than merely that the URL changed.

### Stage 2 — scannable

**Done**, and larger than planned: Sol's review turned three status arms into five plus a
`tmuxServerPid` gate, and one age into three.

- [x] `wire.ts` + `routes-recent-feed.ts`: `tmuxServerPid` on the feed payload (one additive field,
      the only server change).
- [x] `feed-client.ts`: `SessionListReading`, `sessionStatusOf`, `turnAge`.
- [x] `FeedPanel.tsx`: `sessions`, `now`, `skew` props; the pill, the age, the zoned hover
      (memoised), the tone edge, and the way in withheld on an unjoinable row.
- [x] Tests, red first: every status arm including the two pid refusals; the age shifted and the
      timestamp not, off one skew — the K4 regression made concrete; the future stamp; the hedge.

### Stage 3 — the browser, the gates, the docs

- [x] A Sonnet subagent at 1280 and 390 — see below.
- [x] `npm run typecheck`; lint on the touched files adds no new finding (all four `biome` warnings
      on these files were checked against `HEAD` copies and pre-date this branch).
- [ ] `npm test` in full.
- [ ] One GPT Sol code review over the whole scoped diff.
- [ ] `fleet-recent-messages.md` gains a section on what a row is now entitled to claim about a
      session's status.

## What the reviews found

### GPT Sol on the plan, before any code

Three P0s, and every one of them was a claim the page would have made and could not support. The
first two are in "The design" above: the missing `tmuxServerPid` gate, and a status partition that
collapsed *no payload*, *no finished census* and *no such row* into two arms. The third was the age:
`formatDuration(NaN)` renders `—`, so the literal formula in the plan would have drawn `— ago`, and
an unknown skew before the first state payload is an uncorrected cross-clock subtraction with
nothing on the page to qualify it.

Two more, both taken: focus must move with the scroll, and `zonedLine` must be memoised.

I recorded one P1 as out of scope — `SessionsPanel` returning its empty-state page before rendering a
detail, so a `sel` naming the only session on the box shows "No sessions." and swallows the selection
— on the grounds that it predates this work. **The code review overruled that, and was right:** the
branch that hands out the links owns where they lead. It is fixed below.

### GPT Sol on the code, and the P0 that made the first P0 cosmetic

The second review is the one that mattered, exactly as
[AGENTS.md](../../AGENTS.md) says it would — *"weight this second one higher, because a plan-stage
review can't find a `PATCH` that writes one field and then rejects the request"*. Here it could not
find that **the pid gate did not survive the click**.

`sessionStatusOf` proved the handle and the session list named one tmux server, and then
`onOpenSession` handed over the bare handle. The destination matched `$1643` against whatever world
it was looking at by the time it rendered — and the pane it opened would print a handle that agreed
with the one clicked, so nothing on screen would contradict it. The guard was real and the
navigation went round it. So `selpid` now travels with `sel`, `SessionsPanel` declines to resolve one
against a snapshot of the other, and a feed that named no tmux server reaches the Sessions tab
**without selecting anything** rather than selecting on trust. A missing `selpid` — a tap on the
list, a hand-typed URL, every bookmark that already exists — resolves exactly as before, because not
knowing is not evidence.

Four more, all taken:

- **`MissingSession` is now reachable from an empty list**, per the overruled P1 above.
- **The `ahead` tolerance was the wrong constant.** `CLOCK_SKEW_NOTICE_MS` governs whether a masthead
  mentions a *measured* clock disagreement; borrowing it made a turn 59 seconds in the future read
  "0s ago" on a row whose formatter prints seconds under five minutes. It is now its own named 5s,
  justified by the latency in the measurement, and tested either side of the boundary.
- **"About" was a hedge, not a label.** An unknown skew is not a small error, it is one nobody has
  bounded, so "about 2m ago" quietly promised something. The row now prints the age and says
  *clocks not compared* beside it. `skew` also stopped being a defaulted prop: a default is how a
  future caller sits permanently unmeasured without ever deciding to.
- **`Date.parse` is not a validator** — `Date.parse("0")` is January 2000, which would have drawn a
  confident age twenty-six years old. The timestamp is now checked for canonical ISO, the way
  types.ts already checks `servedAt`.

And two of my own comments were simply wrong, both corrected in place: an unverified click's failure
is **not** "bounded and visible" — the pane it opens prints a handle that matches — and the one-way
latency argument does not justify a minute of slack when the latency is milliseconds.

### The browser, at 1280 and 390

Against a throwaway fixture server rather than the live box — a static serve of `dist/` with canned
`/api/state` and `/api/feed`, so nothing live was read. **It took four rounds and found three things
the tests did not**, all written up above: the pid gate refusing every row against a payload without
the field, the smooth scroll finishing 68px short, and the sticky masthead painting over the top of
where the scroll landed. None was reachable from jsdom — one needed a *stale server*, and the other
two needed a *viewport*.

**The scroll is the part worth reading twice, because it passed three times before it was right.**

1. The first pass reported it passing. At 1280×900 the fixture's list fits on one screen and there
   was nothing to scroll: the check had been run against a page that could not fail it.
2. Told to force overflow, the agent shrank the window to 1280×600 and measured
   `getBoundingClientRect().top` on the detail's own status badge: −68px. A half-finished smooth
   scroll, indistinguishable from one that never fired.
3. Instant scrolling moved that to +27.92px, which reads like a pass. It is not: the agent checked
   `document.elementFromPoint` at that spot and found the **masthead** painting there, not the badge.
   A non-negative number that still means hidden.

Each round the check got stricter and the previous round's "pass" stopped being one. What made the
difference was never a screenshot — it was a number, and then a second number to say what the first
one meant.

Everything else passed: the click-through writes `#sessions?sel=%241643` and opens the detail; Back
returns to `#messages?mq=merging` with the input's DOM value still `merging` and the count still
"1 of 7"; `scrollWidth === clientWidth === 390` both collapsed and expanded. The age tooltip shows
`06:13 UTC · 07:13 London · 09:13 Athens`, and no row says "about", which is right — the fixture's
state payload carries a `servedAt`, so the skew is measured.

Two cosmetic findings, neither fixed and both deliberate:

- **The `idle` left edge is nearly invisible** — `oklch(0.82 0 0)` on an `oklch(0.985 0 0)` page. It
  is the shared `toneClasses("idle").edge` that every `SessionCard` uses, so changing it changes the
  Sessions list too. It is also arguably right: the rows that must catch the eye — needs-you,
  working, unknown — do.
- **The tooltip has a 240 ms open delay and its fallback text is `sr-only`**, so a sighted mouse user
  gets nothing instant and a touch user gets nothing at all. That is `Tooltip.tsx`, shared by every
  tooltip on the page, and `dashboard-tooltips` owns it.

The fourth round passed all three scroll cases, and `elementFromPoint` at the badge's centre returns
the badge rather than the masthead in each: badge top 119.92 against a 116.92 masthead at 1280×600
scrolled to the bottom, 168.92 at 1280×900 unscrolled, 320.16 against a 255.375 masthead at 390.

**Screenshots: [`260909c-shots/`](260909c-shots/)** — two of the eight the browser passes produced,
the ones showing the thing Greg asked about: a row at 1280 and at 390. The rest are the numbers
above, which are better evidence anyway. There is no "before" shot; the tab was never photographed
until this change was already on screen.

I wrote here that these were the first images ever committed under `docs/` — `git ls-files docs |
grep .png` was empty when I checked. **That stopped being true while this branch was open**:
`dashboard-design-system` landed `260909c-dashboard-design-system-screenshots/` on `dev` in the
meantime, so a convention I was being careful not to establish alone already exists. Left as a note
rather than deleted, because the shape of the mistake is worth keeping: a fact about a shared repo,
measured once and then quoted for four hours as though a measurement were a property.

## The merge with `dev`, which had moved 38 commits

`dashboard-tooltips` and `dashboard-design-system` had been in `FeedPanel.tsx` and
`SessionsPanel.tsx` the whole time this was being built. Two conflicts, both in `FeedPanel.tsx`, and
**both sides had independently attacked the same complaint from opposite ends**: that
`2026-09-09T05:51:02.547Z` on a row is *"unreadable as a time of day, in a city, by a person"*
([instant.ts](../../tools/fleet/web/src/instant.ts)). `dev` kept the ISO visible and put the three
zones on a hover card; this branch put a human age in front and the zones behind it.

The resolution keeps both sides' better half rather than picking a winner:

- **The age wins the row**, because that is what Greg asked for — and because `instant.ts`'s own
  header already says the relative age *"is the right thing to read at a glance"*.
- **`instantTip` wins the card.** This branch had hand-rolled the same three-zone tooltip inline; the
  shared helper is better written, gives every instant on the dashboard one heading, and is the only
  part of the collision that would otherwise exist twice. The inline `zonedLine` call is gone.
- **`SPEAKER_TIPS` on the speaker label is kept from `dev`** — this branch had the label bare.

Checked in the browser afterwards, because the row's markup changed and a green suite is not evidence
about a layout. At 1280 the four elements still sit on one line with room to spare. At 390 the merge
made the wrapping **milder**, measured by bounding box rather than by eye: four of six rows fit
entirely on one line, one drops only its age, and the sixth wraps for a reason that predates all of
this (`not in the current session list` is a phrase, not a pill). `scrollWidth === clientWidth === 390`
still, collapsed and expanded.

## Coordination

Live in neighbouring files: `dashboard-tooltips`, `dashboard-design-system`, `deploys-ui`,
`readiness-tab`, `claude-agents-dashboard`. `FeedPanel.tsx`, `feed-client.ts` and their tests are
mine; `App.tsx` and `mode.ts` are additive; `SessionsPanel.tsx` gets the minimum needed to accept an
external selection.
