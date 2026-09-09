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

Four things, and the fourth is the one nothing checks:

- a word in `MODES`, which is the closed vocabulary — [`mode.ts`](../../tools/fleet/web/src/mode.ts);
- a button in the bar — [`Dock.tsx`](../../tools/fleet/web/src/Dock.tsx), which renders `MODES` and
  measures its own fit, so the bar itself needs no edit when a mode arrives
  ([`fit.ts`](../../tools/fleet/web/src/fit.ts) § `DOCK_FIT_CLASSES` is the ladder, and it is
  measured rather than guessed);
- a panel, mounted in [`App.tsx`](../../tools/fleet/web/src/App.tsx);
- the name in the URL hash — `#health`, `#overseer`. **The hash and not `useState`**, because this
  page is left open on a phone for hours and reloaded whenever iOS reclaims the tab; `mode.ts`'s
  header has the argument, and an unknown name falls back to Sessions rather than rendering nothing.

## The four registrations, and the mount

| Register | Where | What it is |
|---|---|---|
| `MODES` | `mode.ts` | the vocabulary. Everything else is keyed off it |
| `MODE_LABELS` | `mode.ts` | the one place the mode is spelled for a person |
| `MODE_ICONS` | `Dock.tsx` | **not decoration**: at the bar's narrowest rung the glyph is all that is left of a button that is not the active one. House defaults are 16px at `strokeWidth={1.75}` — [icons.md](icons.md) |
| `MODE_TIPS` | `Dock.tsx` | the two-sentence card. [§ The card on the button](#the-card-on-the-button) |
| the mount | `App.tsx` | `{mode === "yours" ? <YourPanel … /> : null}` beside the other three |

**`MODES` is the array; the other three are `Record<Mode, …>` rather than partials, so
`npm run typecheck` catches a half-added mode.** That is a design property somebody could remove
without noticing what it bought — a `Partial<Record<…>>` here would let a mode ship with no icon, no
label and no card, and the page would draw a nameless button.

> That the maps are `Record<Mode, …>` rather than partials is the load-bearing detail worth stating
> in your doc: it means `npm run typecheck` catches a half-added mode, so a new mode cannot be
> silently half-registered.
>
> — session `recent-messages-tab`, 2026-09-09

**The mount in `App.tsx` is the fifth place and the one nothing checks.** A mode registered in all
four with no arm in `App.tsx` compiles, draws a button, switches the hash, and shows an empty page.
It is
not a `switch` with a `never` default — it is three independent ternaries — so write the test in
[§ The test](#the-test) before you believe the button.

And `Dock.tsx`'s own header says *"If a fourth mode arrives, nothing here needs touching"*. That is
true of the bar's layout and false of the file:

> I went looking for the tab list expecting one place and found four, in two files, one of which
> advertises itself as not needing edits. Worth saying outright: **adding a mode is four
> registrations plus a mount in `App.tsx`, and the type system catches three of them.**
>
> — session `usage-limits-tab`, 2026-09-09

That split is a known cost, not a design — see [§ What this costs](#what-this-costs).

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

If the answer pushes a coupling onto a path rather than a type, say so in your plan — it is a
trade-off Greg should inherit knowingly rather than find later.

## Where the panel's data comes from — decide before you write the panel

There are two shapes, and picking the wrong one is the expensive mistake on this page.

**Pushed state** — [`state.ts`](../../tools/fleet/state.ts) and
[`wire.ts`](../../tools/fleet/wire.ts). One payload, composed once by `statePayload` and served
identically by `/api/state` and `/api/live`, collected every 60 s by default. A panel taking this
**never fetches**: `App.tsx` hands it plain props. Everything you add here is collected, serialised
and sent every cycle to every reader, whether or not your tab is open — and it is paid for out of
the collection loop, which already costs the box about ten seconds of work per pass.

**An on-demand read** — [`routes-health-history.ts`](../../tools/fleet/routes-health-history.ts) is
the shape to copy. Its own route, its own cadence, its own client module, and nothing is paid until
somebody opens the tab. Four things that file does deliberately and yours should too: the payload
function is **pure given a store**, so the interesting half is testable without a socket; the path is
matched **exactly** rather than by prefix; there is a stated maximum on how much it will serve; and
it gzips above a threshold rather than averaging server-side, because a bucket mean hides the spike
the chart exists to show.

**The rule: no read inside the collection loop.** Anything that fans out per session belongs on its
own route.

> A tab that fans out over every session's transcript costs **~60 ms and ~3 MB of disk read per
> refresh across 21 rows (12 with a conversation id), for 14 kB of text** — the byte budget dominates
> by about 200:1, which is why such a thing belongs on its own route with its own cadence and never
> inside the 60 s collection loop.
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

## Writing back: the seam is a second file

A tab that only reads is one file. A tab that does anything is two, and the second is not visible
from the first:

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
> The corollary for anyone adding a mode: if your tab does anything but read, you are writing **two**
> files, not one — the panel, and a client with a seam — and the second is where the tests point.
>
> — session `overseer-tab-messaging`, 2026-09-09

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

If your panel has a state where it has nothing to draw, name which nothing it is, on the page, in
the voice of whoever failed to answer.

## The card on the button

`MODE_TIPS` is a `head` and two sentences, under [tooltips.md](tooltips.md)'s rule for a control:
the first is what a reader could have guessed by pressing it, the second is what they could not.

**The register is the artefact, not the gesture** — *what you will see here* and *where it comes from
or what it does not promise*, never *"opening this runs X"*. Read the three tips already in
`Dock.tsx` before writing a fourth: Sessions says what the list is and then that it is read off the
box about once a minute; Box health says which readings and then that the verdict has a fourth level;
Overseer says what the tab is for and then that nothing on it is live. Switching a tab spends
nothing, so a gesture framing would be false as well as unhelpful.

**And the card does not open on a phone.** `Dock.tsx` passes `mouseOnly` — and only here, because a
tap on these buttons already does something and a card would land over the panel the tap just
brought up. So on the surface this page is mostly read on, the tip is reachable only as the button's
accessible *description*; what a phone reader actually gets is `MODE_LABELS` and the icon. Write the
label so it stands alone, and put nothing in the card that the tab cannot survive without.

## The test

In [`tests/fleet-web.test.tsx`](../../tests/fleet-web.test.tsx), the two `describe` blocks to extend
are *the modes* and *the bottom bar*, and both are short. The page is driven
through `manualTransport()` and `feed.push(state({…}))` — no clock, no network — and
`window.location.hash` is set **before** `mount` to open straight into a mode.

Three assertions earn their place for a new mode:

1. the hash opens into it (`window.location.hash = "#yours"`, then something only your panel draws);
2. pressing the button writes `#yours` and draws the panel — this is the one that catches a missing
   `App.tsx` arm;
3. the panel's empty state says which nothing it is, rather than drawing nothing.

**A mode with its own route needs a third suite of its own** — `tests/fleet-deploys-route.test.ts` is
one. Drive it through the same composition the server calls rather than through a route the test
assembles: a test that rebuilds the missing edge inside itself stays green when production stops
making it, which is exactly why `statePayload` was lifted out of `server.ts` into `state.ts` in the
first place. `health-wiring.ts` makes the argument at length.

Two other suites will notice you without being asked. `tests/fleet-imports.test.ts` is the one above
— [§ may the fleet touch what your tab is about?](#ask-this-before-you-design-the-panel-may-the-fleet-touch-what-your-tab-is-about).
`tests/fleet-compile-guards.test.ts` holds the guards only the compiler can enforce, and **`vitest`
never type-checks**, so a type-level guard cannot go red under `npm test`; run `npm run typecheck` as
well and judge it by its exit code ([typechecking.md](typechecking.md)).

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
without ever raising a marker. Nothing about a clean merge is evidence here; the `Record` types are.

> A dropped `MODES` entry makes the maps over-specified and a dropped map entry makes them
> under-specified, so **`npm run typecheck` catches it — but only if you run it on the post-merge
> tree.** If the doc says one thing about collisions, I'd have it say: after merging, re-run
> typecheck and count the entries; don't read a clean merge as evidence.
>
> — session `usage-limits-tab`, 2026-09-09

## Seeing it

**There is no dev server for this client** and that is deliberate — `vite.fleet.config.ts` says why.
Build it and serve the build:

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
has two rungs
— Refresh loses its word, then the modes lose theirs except the active one — and past the last rung
the row scrolls rather than clipping, so a fifth or sixth mode degrades visibly rather than silently.

## What this costs

Two things are worse than they need to be, written down rather than fixed on a night when three
sessions were live in both files:

- **Four registrations across two files**, with `MODES`/`MODE_LABELS` in `mode.ts` and
  `MODE_ICONS`/`MODE_TIPS` in `Dock.tsx`. One table in one file would make a mode one edit plus a
  mount, and would delete this section.
- **`Dock.tsx`'s header advertises that a new mode needs no edit there.** It means the bar's
  measuring logic and it reads as the file. Both sessions that went looking for the tab list read it
  the wrong way first.

Neither is worth a rewrite on its own. Both are worth doing the next time somebody is in these two
files for another reason.
