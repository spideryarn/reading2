# Adding a mode to the fleet dashboard

Up: [dev-and-deployment-overview.md](dev-and-deployment-overview.md).

> add a doc for adding new modes to the web-dashboard
>
> — Greg, 2026-09-08

The fleet dashboard is [`tools/fleet/`](../../tools/fleet/): a page on the box that shows every tmux
session, what each is blocked on, and how the box is holding up. A **mode** is one tab of it — a
button in the bar along the bottom, a panel above, and a name in the URL hash.

This is the checklist for adding one. Why the dashboard exists and where it is going is
[overseer-direction.md](overseer-direction.md); running it on the box is
[hetzner-remote-server-box.md](hetzner-remote-server-box.md#after-tailscale-up-give-the-fleet-dashboard-the-address).
**Do not confuse it with [new-mode.md](new-mode.md)**, which is the same word for the reading view's
tabs in a different application; the two share a vocabulary and no code.

Four sessions added tabs to this page on the night of 2026-09-08 and each worked the mechanism out
for itself. Most of what is below is theirs, quoted and attributed.

## What a mode is

Four things a reader can see, spread over six places a writer must edit:

- a word in `MODES`, which is the closed vocabulary — [`mode.ts`](../../tools/fleet/web/src/mode.ts);
- a button in the bar — [`Dock.tsx`](../../tools/fleet/web/src/Dock.tsx), which renders `MODES` and
  measures its own fit ([`fit.ts`](../../tools/fleet/web/src/fit.ts) § `DOCK_FIT_CLASSES`);
- a panel, mounted in [`App.tsx`](../../tools/fleet/web/src/App.tsx);
- the name in the URL hash — `#health`, `#overseer`. **The hash and not `useState`**, because this
  page is left open on a phone for hours and reloaded whenever iOS reclaims the tab; `mode.ts`'s
  header has the argument, and an unknown name falls back to Sessions rather than rendering nothing.

## The registrations

| Register | Where | Checked by |
|---|---|---|
| `MODES` | `mode.ts` | nothing — it *is* the vocabulary. `Mode` is `(typeof MODES)[number]` |
| `MODE_LABELS` | `mode.ts` | the compiler |
| `MODE_ICONS` | `Dock.tsx` | the compiler. **Not decoration**: at the bar's narrowest rung the glyph is all that is left of an inactive button. House defaults, [icons.md](icons.md) |
| `MODE_TIPS` | `Dock.tsx` | the compiler. [§ The card on the button](#the-card-on-the-button) |
| the mount | `App.tsx` | **nothing** — a ternary, not a `switch` with a `never` default |
| `.dock-modes { flex: N 0 auto }` | `tailwind.css`, under `@media (pointer: coarse)` | **nothing** — see below |

The three maps are `Record<Mode, …>` rather than partials, so `npm run typecheck` catches a
**half**-added mode. `Mode` is derived from `MODES`, so it cannot catch one removed from every
register at once ([§ When several sessions add a tab at once](#when-several-sessions-add-a-tab-at-once)).

**Two registers are checked by nothing, and the second is the one nobody found for a day.**

- **The `App.tsx` mount.** A mode in all four registers with no arm there compiles, draws a button,
  switches the hash, and shows an empty page.
- **The coarse-pointer weighting.** On a touch device `.dock-modes` is given `flex: 3 0 auto` — a
  literal share count, written when there were three modes, so that the segment spreads against
  Refresh's `1` in proportion to what is inside it. It is **not** derived from `MODES.length`, and
  adding a fourth mode without changing it gives four buttons three shares. The measured fit ladder
  stops the row clipping; it does not repair the proportion. GPT Sol found this on 2026-09-09, after
  `deploys` had landed and left it saying `3`.

So the count is not "four registrations in two files" as the doc first said, and as the session below
found it. It is **six places in three files, two of them unchecked**.

> I went looking for the tab list expecting one place and found four, in two files, one of which
> advertises itself as not needing edits.
>
> — session `usage-limits-tab`, 2026-09-09

`Dock.tsx`'s own header says *"If a fourth mode arrives, nothing here needs touching"*. That is true
of the bar's **fit measurement** and false of the file and of its stylesheet. It is a known cost, not
a design — [§ What this costs](#what-this-costs).

## Ask this before you design the panel: may the fleet touch what your tab is about?

[`tests/fleet-imports.test.ts`](../../tests/fleet-imports.test.ts) walks `tools/`'s whole transitive
import graph and fails if it reaches anything under `src/` outside a small allowlist of leaf,
browser-only, product-agnostic modules. The dashboard has to keep working with the product absent,
and to stay movable to its own repo. **So the reuse this repo tells you to prefer everywhere else is
the thing that is forbidden here**, and it is cheapest to discover before you have a panel:

> My tab reads the deploy record — and `src/changelog.ts` is already a complete, dependency-free
> parser for exactly that file. Reusing it is the house rule and my first instinct, and it's not
> allowed […] So the question to ask before designing a data-backed mode is not "what parses this
> already" but "**is the thing my tab is about a product artefact the fleet may only read as data at
> a path?**" — for me the answer was yes, and the coupling belongs on the path rather than on the
> type. The cost is a second reader that can drift, and the mitigation worth writing down is that the
> fixture is not enough: my test reads the **real committed file** and asserts one version per
> non-blank line, which is the only assertion that can go red on a day nobody touched my branch.
>
> — session `deploys-tab`, 2026-09-09

That last sentence is the general rule and not a detail of one tab. A second reader of a product
artefact will drift, and a fixture cannot tell you it has: only a test that reads the real file can.

**And "reads the real file" is not enough on its own** — the version of that check quoted above was
*one accepted version per non-blank line*, and GPT Sol's objection to it is the useful part: a count
passes while the two readers disagree about **every field**. Yours can default a field, drop an
entry, or derive a different meaning from the same bytes, and the tally still matches. So parse the
real file with **both** readers and compare, entry by entry, every field your panel draws.

That is possible because of one thing worth knowing outright: **a test-only import of the product
module is legal.** `fleet-imports.test.ts` walks the graph rooted at `tools/`, not at `tests/`, so
your test may import the canonical parser to compare against even though your panel may not. Without
that, the obvious conclusion is that the strong check cannot be written at all — `deploys-tab`,
2026-09-09.

If the answer pushes a coupling onto a path rather than a type, say so in your plan — it is a
trade-off Greg should inherit knowingly rather than find later.

## Where the panel's data comes from — the end-to-end path

**The choice is per *datum*, not per panel**, and reading it as a panel-level choice is the mistake
this section was rewritten to stop. Box health is the proof: `App.tsx` hands `HealthPanel` a pushed
`health` prop, *and* that same panel mounts `HealthHistory`, which fetches its own route. A mode may
legitimately pair a small pushed headline with expensive on-demand detail.

So the question is asked once per piece of data, and each answer has a whole path attached:

| The datum is | The path, end to end |
|---|---|
| **pushed** | producer or composition root → a **required** field on `wire.ts` → the client's parser and type → an `App.tsx` prop |
| **on demand** | a route module → its mount in `server.ts` → a typed client with a seam → an injected-and-defaulted `App.tsx` API prop → the panel, plus a lifecycle test |
| **a write** | a server handler and its mount → a typed client seam — **unless** an existing seam already owns the action, in which case reuse it and add nothing |

Miss one leg and the tab compiles, renders, and does nothing — so walk the whole row.

**What pushing costs.** Everything on the payload is collected, serialised and sent every cycle to
every reader, open tab or not. The collector is configured by `FLEET_REFRESH_MS` (default 60 s), but
that is the wait **after** each pass finishes, so the real gap between samples is longer — the chart
code reckons on about 73 s. Don't quote the configured number as the cadence.

**What an on-demand route costs, and the rule.**
[`routes-health-history.ts`](../../tools/fleet/routes-health-history.ts) is the shape to copy for
**structure**: a payload function pure given a store, so the interesting half is testable without a
socket; an **exactly** matched path; a stated maximum on how much it will serve; and gzip above a
threshold rather than server-side averaging, because a bucket mean hides the spike the chart exists
to show.

It is **not** a licence to do anything synchronously in a handler. The dashboard is a single Node
process the Overseer has no alternative to, so blocking the event loop in one tab's route freezes
every session, action and heartbeat. `deploys-tab` measured both on this box at load ~13:

| | median | worst |
|---|---|---|
| `readFileSync` (health history, 480 KiB) | 0.91 ms | 1.31 ms |
| `gzipSync` (~920 KiB payload) | 6.86 ms | 9.64 ms |
| `spawnSync` (`git log -1`) | 13.06 ms | 19.02 ms |
| `spawnSync` (`git rev-list --count --no-merges`) | 22.30 ms | 30.29 ms |

**The tail is the argument, not the median.** A file read's worst case is bounded by a size you
control; a subprocess's worst case is bounded by the timeout you chose — four at 5 s each is a
15–20 second frozen control plane, and fork/exec is exactly what hits that tail on a box under
memory pressure. So:

> An on-demand route may block the event loop only for work whose worst case it can state. A bounded
> read of a file it controls the size of qualifies. A `gzipSync` at ~7 ms qualifies but is worth
> naming as a real cost. A subprocess does not, because its worst case is a timeout, not a size.
>
> — session `deploys-tab`, 2026-09-09, measured

Read the exemplar accordingly: right about structure, and its synchronous gzip is **near the ceiling
rather than a floor to build on**. That is not a defect in it — 8 ms is fine and the obvious
"fix" of bucket-averaging would be far worse, as that file argues at length.

**The rule about the shared path**, stated properly: *do not add a new per-session transcript or disk
fan-out to the refresh path.* Not "no reads in the collection loop" — the collector already reads
every pane, health, and the Overseer checkpoint, and that was a false rule for as long as it stood
here.

> A tab that fans out over every session's transcript costs **~60 ms and ~3 MB of disk read per
> refresh across 21 rows (12 with a conversation id), for 14 kB of text** — the byte budget dominates
> by about 200:1, which is why such a thing belongs on its own route with its own cadence.
>
> — session `recent-messages-tab`, 2026-09-09, measured

**A new mode's cross-boundary types belong in `wire.ts`, and its rule has a sharp edge.** That file
is *"types only, no runtime values, no imports"*, forced by the fact that both a node module and the
browser bundle read it. So a vocabulary and its union cannot live together there: the type goes in
`wire.ts`, the array stays in the node module, and `as const satisfies readonly Section[]` is what
stops the two drifting. Without the `satisfies` you get a mode whose section silently never renders
— `deploys-tab`, 2026-09-09.

If you do add a field to the pushed payload, it goes on the wire type as a **required** key — an
optional one crosses the client's `Omit<>` derivation untouched and ships to a browser that never
reads it, which is the exact drop that derivation exists to prevent.
[`tests/fleet-compile-guards.test.ts`](../../tests/fleet-compile-guards.test.ts) refuses an optional
top-level key, and `npm run typecheck` is the gate.

## The seam, which is invisible from the panel

**Every new HTTP operation gets a typed client with an injectable seam** — read or write, and
regardless of how many files that turns out to be. The seam is the thing to know about, because it
cannot be seen from the panel that uses it:

> **The panel's data and the panel's actions arrive by two completely different routes, and the
> second one is not obvious from reading the first.** State is *pushed* — `App.tsx` hands a panel
> plain props off the snapshot, so a panel never fetches anything to render. But an action goes back
> through a *separate typed client module* (`steer-client.ts`, `actions-client.ts`) that exposes an
> injectable seam — `SteerApi`, `ActionsApi` — rather than through `fetch` in the component. Reading
> `OverseerPanel.tsx` alone I could not see that seam existed; I found it by grepping for the URL.
> The rule that makes it worth writing down: **the seam is the extension point, and a test drives the
> panel through it rather than stubbing `fetch`** […] binding `fetch` at import time makes it
> unstubbable in any suite that imports the module first, and the failure looks like a real network
> call in a test that has none.
>
> The corollary for anyone adding a mode: […] the panel, and a client with a seam — and the second is
> where the tests point.
>
> — session `overseer-tab-messaging`, 2026-09-09

(Two things in that quote are true of the panel it was written about and not in general, and are left
standing because the point it is quoted for survives both. *"A panel never fetches anything to
render"* — `HealthPanel` does, through `HealthHistory`. *"Two files, not one"* — a panel reusing
`ActionsUi` needs no new client at all, and a new on-demand read needs a route and a server mount
besides. What generalises is **the seam is the extension point**; the arithmetic is the table above.)

The same session's smaller point is worth acting on before you design your props: **check what
`App.tsx` already passes down**. A panel wanting something the snapshot already carries but `App.tsx`
does not forward is a one-line edit to the file every other mode author is also in.

## Absence is stated, never drawn

The house rule of this whole page, and the reason it exists at all: **a blank panel and a healthy box
look identical**, so every kind of nothing is kept apart from every other.

- **No fabricated zero.** `answeringEnabled` reaches the page as `ANSWERING_NOT_REPORTED` rather than
  `false` before the first payload, because a server that has said nothing has made no claim.
  `collectedAt: null` means *never collected*; an empty `rows` is only a statement about the box once
  it is non-null.
- **"We looked and found nothing" is not "we could not look."** `routes-health-history.ts` carries
  two arms for exactly this, and its client adds a third for *this browser never got an answer* —
  because the phone's own network trouble must not appear on screen in the server's voice.
- **A reading nobody could take never renders as a healthy value.** `health.ts`'s verdict has a
  fourth level, `unknown`, beside ok/strained/critical for this reason.

- **An instant you did not compute needs a range check, not a finiteness check.**
  `new Date(ms).toISOString()` throws `RangeError` past ±8.64e15, and thrown during render it blanks
  the **whole panel** rather than one line. `Number.isFinite` does not catch it — `1e300` is finite
  and out of range. So the obvious guard is one more check that cannot go red in its own case. Any
  timestamp off a file mtime, off the wire, or from anything a person could type wants the range
  check, and the out-of-range case wants one of the stated absences above rather than a throw.
  Found by session `260908f-roadmap-usage`, hit in practice by `deploys-tab`, 2026-09-09.

If your panel has a state where it has nothing to draw, name which nothing it is, on the page, in
the voice of whoever failed to answer.

## The card on the button

`MODE_TIPS` is a `head` plus a `what` and a `how`, under [tooltips.md](tooltips.md)'s rule for a
control: the first is what a reader could have guessed by pressing it, the second is what they could
not. (Two *fields*, not two sentences — Sessions runs to three.)

**The register is the artefact, not the gesture** — *what you will see here*, then *where it comes
from or what it does not promise*; never *"opening this runs X"*. Read the tips already in `Dock.tsx`
before writing yours: Sessions says what the list is, then that it is read off the box about once a
minute; Box health says which readings, then that the verdict has a fourth level; Overseer says what
the tab is for, then that nothing on it is live.

**But do not justify that by saying a tab switch is free, because it need not be.** Switching to Box
health mounts `HealthHistory`, which calls its route immediately and then polls. Whether entering
*your* mode starts a read is a thing you decide and then describe honestly — and if it does, that
belongs in the `how`.

**The card is hard to reach on a phone, and the label is not.** `Dock.tsx` passes `mouseOnly` — only
here, because a tap on these buttons already does something and a card would land over the panel the
tap just brought up. Touch-driven hover is off; focus is not, so a keyboard can still open it. The
consequences for a mode author:

- a **sighted touch** reader gets the icon and whatever label the fit rung leaves visible — never the
  card;
- a **screen-reader** user gets the button's `aria-label` (the label, plus the count on Sessions).
  The icon is `aria-hidden` and the tip is mounted only while open, so there is **no persistent copy
  of the card's text** anywhere in the accessibility tree.

So write the label to stand alone, and put nothing in the card that the tab cannot survive without.

## The test

`tests/fleet-feed-panel.test.tsx` § *the tab is actually registered* is the pattern to copy — two
tests, both verified by mutation rather than by reading. Four assertions earn their place:

1. **`expect(MODES).toContain("yours")`**, with the label. The only thing that objects when your mode
   is removed from every register at once
   ([§ When several sessions add a tab at once](#when-several-sessions-add-a-tab-at-once));
2. **the hash opens into it** — set `window.location.hash` *before* mounting, then assert something
   only your panel draws. This is the one that catches a missing `App.tsx` arm: mutate the arm to
   `false` and watch it go red;
3. **pressing the button** writes the hash and switches the panel;
4. **the empty state says which nothing it is**, rather than drawing nothing.

**Assert the dock against `MODES`, never a literal list.** Two sessions hit this in one file and
solved it differently: one grew the hard-coded list by an entry, which leaves the *next* session
editing it again; `deploys-tab` replaced the assertion with `MODES.map((m) => MODE_LABELS[m])`, and
`onlyOn(MODES.indexOf("health"))` for the positional case. The second was taken in the merge.

**`mount()` will not drive an on-demand mode.** `manualTransport()` controls pushed state only, and
the ordinary helper injects no API; `mountFull()` is the one that takes them. A tab with its own
route must inject its API, assert that **opening** the tab triggers the request, and test its parser
and its route separately — `tests/fleet-deploys-route.test.ts` is an example. Drive a route test
through the same composition `server.ts` calls, not a route the test assembles: a test that rebuilds
the missing edge inside itself stays green when production stops making it, which is why
`statePayload` was lifted out of `server.ts` into `state.ts`. `health-wiring.ts` argues it at length.

**A source-grep guard must strip comments.** `tests/fleet-health-wiring.test.ts` guards a
`server.ts` mount with `expect(source).toContain(…)`; `deploys-tab` copied the shape, commented the
mount out, and the test still passed — the needle survives inside the `//`. Commenting-out is how
such a line actually dies. Assert against comment-stripped source, and check it red.

Two suites notice you without being asked. `tests/fleet-imports.test.ts` is the one above
— [§ may the fleet touch what your tab is about?](#ask-this-before-you-design-the-panel-may-the-fleet-touch-what-your-tab-is-about).
`tests/fleet-compile-guards.test.ts` holds the guards only the compiler can enforce — but only over
the shared **pushed** wire type, so it says nothing about an on-demand or UI-only mode. And **`vitest`
never type-checks**, so a type-level guard cannot go red under `npm test`: run `npm run typecheck`
too, and judge it by its exit code ([typechecking.md](typechecking.md)).

## When several sessions add a tab at once

Settled by the Overseer on 2026-09-09, after three sessions queued on one file, and the reasoning is
`usage-limits-tab`'s:

> nobody owns the Dock tab list; each session adds its own mode's entries (`MODES`, `MODE_ICONS`,
> `MODE_TIPS`, `MODE_LABELS`) in the same commit as its panel, never edits another mode's entries,
> and after merging `origin/dev` runs typecheck and counts the entries before pushing, because a
> merge can drop an entry with no conflict marker and the `Record<Mode, …>` types are what catch it.
>
> — the Overseer, 2026-09-09

The failure that rule is built against is the quiet one: two agents adding entries to the same array
and the same three maps merge **cleanly**, and a merge can keep both sides' entries or drop one
without ever raising a marker.

**What typecheck actually catches is two lines, not one**, measured by `recent-messages-tab` on
2026-09-09 by removing a mode from the real tree rather than reasoning about it:

- dropped from `MODES` and the three maps, **mount arm kept** → typecheck **fails**: TS2367 on
  `mode === "yours"` against a union that no longer contains it, and TS6133 on the now-unused icon
  import. Caught.
- dropped from **every** register including the mount arm → clean, and only
  `expect(MODES).toContain("yours")` objects.

**And the hazard is not the one three of us had been reasoning about.** When `deploys` and `messages`
really did collide, `MODES` conflicted loudly — `<<<<<<<` markers — while `MODE_LABELS` auto-merged
with both entries, because those two additions landed on different lines inside the object. **Whether
you get a marker depends on line adjacency, not on how much the thing matters.** So:

> The shape nobody has tested […] is not a bad merge at all — it is a **removal merged with unrelated
> work**. If a branch removes a mode (a revert, a rollback, a tab withdrawn because it shipped broken)
> and another branch has not touched `mode.ts`, git takes the deletion with no marker and nothing to
> look at, because that is not a conflict — it is a merge doing exactly what it was told. […] the
> hazard is not a careless merge, it is a deliberate removal arriving somewhere it was not expected.
>
> — session `recent-messages-tab`, 2026-09-09

That is also why nobody has seen it: **nobody has reverted a mode yet.** The one-line `toContain` is
being ready for the first time somebody does. Do not read any of this as "merges conflict loudly" —
the collision observed was the *addition* shape, on a short line everybody edits, and it says nothing
about the removal shape.

> A dropped `MODES` entry makes the maps over-specified and a dropped map entry makes them
> under-specified, so **`npm run typecheck` catches it — but only if you run it on the post-merge
> tree.** If the doc says one thing about collisions, I'd have it say: after merging, re-run
> typecheck and count the entries; don't read a clean merge as evidence.
>
> — session `usage-limits-tab`, 2026-09-09

## Seeing it

**There is no dev-server script for this client, and no API proxy**, which is deliberate —
`vite.fleet.config.ts` says why it has no `server` block. (Nothing stops you pointing `vite` at that
config; you would get the client without the dashboard's API behind it, which is not the thing you
want to look at.) Build it and serve the build:

```
npm run build:fleet
FLEET_PORT=8790 npx tsx tools/fleet/server.ts
```

**Never restart, kill or reconfigure the dashboard on `:8787`.** The Overseer reads it live, and it
is the thing you reach for when something else is broken — a higher bar than the rest of the repo
([overseer-direction.md § A higher bar for robustness here than elsewhere, and its ceiling](overseer-direction.md#a-higher-bar-for-robustness-here-than-elsewhere-and-its-ceiling)).
Take your own port. Two things follow: your instance runs its own collector, so keep it up only
while you are looking at it; and the live page can lag `dev` by a rebuild, so it is not evidence
about your change either way — the server refuses to start without a built client rather than
serving a stale one, but a build somebody else made earlier is still a build.

Then look at it at both ends. A headless viewport has no width floor, so **390 × 844** is the phone
check and it is exact — [browser-testing-playwright.md](browser-testing-playwright.md) is the
mechanics on this box, [browser-testing.md](browser-testing.md) is what to look at, and browser work
belongs in a Sonnet subagent. What to check for a new tab: the bar still reads at 390, the panel does
not scroll the page sideways, and the last row of your panel is not underneath the dock. The ladder
has two rungs — Refresh loses its word, then the modes lose theirs except the active one — and past
the last rung the row scrolls rather than clipping, so extra modes degrade visibly.

**Do this at a touch viewport specifically, not merely a narrow one.** The coarse-pointer share count
is the register nothing checks, and its symptom is proportion rather than breakage — the mode segment
looking cramped against Refresh, which no test and no typecheck will ever mention.

## What this costs

Three things are worse than they need to be, written down rather than fixed on a night when four
sessions were live in these files:

- **Six places across three files**, with `MODES`/`MODE_LABELS` in `mode.ts`,
  `MODE_ICONS`/`MODE_TIPS` in `Dock.tsx`, the mount in `App.tsx` and a share count in
  `tailwind.css`. One table in one file would make a mode one edit plus a mount, and would delete
  most of this page.
- **`.dock-modes { flex: 3 0 auto }` hard-codes the mode count in CSS**, where no type and no test
  can see it. It wants to be `MODES.length` — set as a custom property from the one place that knows,
  or the weighting reworked so it does not need a count at all. It was already wrong when GPT Sol
  found it.
- **`Dock.tsx`'s header advertises that a new mode needs no edit there.** It means the bar's fit
  measurement; it reads as the file, and its own stylesheet contradicts it. Both sessions that went
  looking for the tab list read it the wrong way first.

None is worth a rewrite on its own. All three are worth doing the next time somebody is in these
files for another reason.
