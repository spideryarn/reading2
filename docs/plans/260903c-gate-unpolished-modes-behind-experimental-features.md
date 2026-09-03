# Gate the unpolished modes behind Experimental Features

The bottom bar draws thirteen mode buttons for everybody. Greg, looking at a shared article while
signed out, 2026-09-03:

> I'm looking at https://www.spideryarn.com/read/nagel-bat?mode=ideas&at=spya-ettt2z&term=spya-ht9pey&gate=0.50
> and it seems to be showing all the modes in the bottom-bar…
>
> When a non-logged-in user reads a Public-readable article, I thin it should default to treating
> them as "Experimental Features" = false.

The switch has existed since 2026-08-31 and **nothing has ever been behind it**
([experimental-features.md](../project/experimental-features.md)). This is the piece of work that
puts the first features behind it, so the three things that doc defers to "the first real gate" all
come due here at once: one home for the answer, a line saying what is hidden, and the mid-flight
case.

## What Greg decided

**Always visible, switch off:** Plain, Structure, Summary, Glossary, Search, Ideas, Chat.
**Behind the switch:** Quotes, Timeline, Referee, Diagram, Remember.

*Structure* is the merged Hierarchy+Outline mode from
[260903b](260903b-one-structure-mode-hierarchy-and-outline-merged.md), which has not landed. Greg,
asked whether to wait for it:

> We'll want to include Structure as a default/non-experimental feature, and that agent should
> remove the now-defunct Hierarchy and Outline modes as part of its work.

So this job does **not** block on the merge. Hierarchy and Outline are today's stand-ins for
Structure and both stay default-visible; when the merge lands, `structure` inherits a default-visible
slot and the two rows go with the modes.

**Which means the numbers in this tree are eight and thirteen, not seven and twelve.** Thirteen modes
today, five hidden, eight visible with the switch off. Seven/twelve is the shape *after* the Structure
merge and no test here may assert it. (GPT Sol, reviewing this plan — the first draft had the
post-merge counts and the claim that the work was independent of the merge, which cannot both be
true.)

And, mid-run:

> And also show a button at the end of the bar to enable "Experimental Features" for logged-in users
> with tooltip to explain what this does.

## The bug underneath the request

A signed-out visitor already gets `experimental = false` — **but by accident.**
`GET /api/reader` sits behind the auth gate ([`src/routes.ts`](../../src/routes.ts), `requireUser`
before any route matching), so an anonymous request is a 401.
[`useExperimental`](../../src/web/useExperimental.ts) catches that as a *load error* and leaves `on`
at its initial `false`.

There is no leak today, and that was checked rather than assumed: no public alias for the route
([`src/public/route-names.ts`](../../src/public/route-names.ts) carries exactly one name, `article`),
the server-rendered head reads no reader row ([`src/public/page.ts`](../../src/public/page.ts)), the
offline cache is user-keyed and returns `undefined` for a null user
([`src/web/lib/offline-store.ts`](../../src/web/lib/offline-store.ts)), and the Postgres reader store
filters on `currentOwnerId()`, which **throws** inside a request scope with no owner rather than
falling back to the environment owner ([`src/owner.ts`](../../src/owner.ts)).

But the client is deriving "off" from "the request failed", which is
[silent-success.md](../reusable/silent-success.md)'s shape exactly: the answer is right and the
reasoning is not. The day the gate moves, every gated mode turns on for strangers and no test says
otherwise.

One thing found on the way and **not** fixed here: in filesystem store mode, `experimentalSince`
lives in a single unscoped `data/reader.json` ([`src/profile.ts`](../../src/profile.ts)), so every
signed-in user of a `files` deployment shares one value. Production is Postgres and the repo is
mid-move to it ([database.md](../project/database.md)), so this is a note, not a stage.

## The shared store, which the first draft of this plan declined

The first draft argued that the provider
[experimental-features.md](../project/experimental-features.md) says is due at the first gate could
be skipped, because both consumers would be inside one `Dock` and `SettingsSection` lives on
`/profile`, a page the Dock is never mounted on.

**That was wrong, and GPT Sol's review has the reproduction.** `App.tsx` is the router
([`src/web/App.tsx`](../../src/web/App.tsx):969-971 — `view === "metadata"` returns `<Metadata>`,
`view === "tweets"` returns `<Tweets>`), and each of those pages mounts **its own `Dock`**. So the
Docks replace one another as the reader moves around one article, and a per-component hook gives:

1. Experimental is off.
2. The reader turns it on in the bar. The hook updates optimistically and starts its `PATCH`.
3. Before it lands, they press Metadata.
4. The new Dock mounts a new hook, whose `GET` overtakes the `PATCH` and reads *off*.
5. The `PATCH` commits *on*, but its hook is unmounted and its answer is discarded.
6. The bar stays off, against a database that says on, until a reload.

The `apiFetch` offline cache does not soften this and the first draft was wrong about it too: it is
**network-first**, and consults IndexedDB only from the `catch` of a failed transport
([`src/web/lib/api.ts`](../../src/web/lib/api.ts):585). An online second visit is a second round
trip, not an instant one.

So: **one module-level store, and `useSyncExternalStore`** — not a React context. Context would need
a provider in the tree, and `Dock` is mounted from four production sites and four test files that
render it bare; a store that components subscribe to needs no wrapper and cannot be forgotten at a
mount site. It is also the smaller change: no new component, one new file.

```
src/web/experimental-store.ts
  announceSession(userId: string | null, known: boolean)   ← App.tsx's existing useSession drives this
  subscribe(fn) / snapshot()                               ← useSyncExternalStore
  toggle(next: boolean)                                    ← one write at a time, as today
  resetForTests()
```

`useExperimental()` keeps its name and its returned shape, and reads the store instead of fetching.
`SettingsSection` needs no change beyond that.

**`announceSession` is called in exactly one place** — an effect in `App.tsx` beside the
`useSession()` it already calls (`src/web/App.tsx:264`). Every page in the app renders inside that
component, so there is no route that can reach a Dock without passing it.

### What the store must get right

Sol's finding 3: the first draft specified the anonymous *mount* and not the session *lifecycle*, and
a single anonymous-mount test would pass with several of these broken. Each is a named case with a
test:

| Transition | Required behaviour |
|---|---|
| session loading | `loaded: false`, `on: false`, **no request** |
| loading → signed in | fetch once, keyed on `user.id` |
| signed in → signed out | synchronously `on: false`, `loaded: true`; pending load and save invalidated |
| account A → account B | never render A's setting for B — reset first, then fetch |
| a `GET`/`PATCH` landing after sign-out | discarded, not applied |
| `set()` while signed out | no `PATCH`, no state change |

The fetch effect keys on **`user.id`, not the `User` or `Session` object**. `useSession`'s own header
warns that `SIGNED_IN` is re-emitted whenever a tab regains focus, so keying on the object would
re-issue `GET /api/reader` on every alt-tab.

`loaded: true` for a signed-out reader is honest — anonymous is forcibly off, and there is nothing to
read — but *only* because the transitions above cannot leak the previous account's value.

## Stages

Three, not four. The first draft had a docs-only stage 4, which would have left
[experimental-features.md](../project/experimental-features.md) saying *"Nothing is behind it"*
through two shippable stages — against both that doc's own rule and CLAUDE.md's. **Docs land with the
stage that changes the behaviour.**

### Stage 1 — one home for the answer, and signed-out is off because we decided

`src/web/experimental-store.ts`, `useExperimental` rewired to it, `announceSession` driven from
`App.tsx`. Nothing visible changes.

*Done looks like:* a test per row of the lifecycle table above, the anonymous one asserting **no
fetch was issued**. Written first and watched red against today's hook, which issues a GET and
reports a load error. `tests/profile-settings.test.tsx` keeps passing — it mounts the real hook, so
it must now pose a signed-in session, and that edit is part of this stage.

### Stage 2 — five modes go behind the switch

- **Every** `MODES_UI` row in [`Dock.tsx`](../../src/web/Dock.tsx) gains a required
  `experimental: boolean` — not an optional flag on five rows. `ModesMissingFromDock` proves each
  mode has a row; only a required field proves each row made the decision, and
  [new-mode.md](../project/new-mode.md) says the author must make it. (Sol, finding 8.)
- `Dock` draws the non-experimental rows **plus the mode named in the URL**. The second half is not
  politeness: the mode segment is a `role="radiogroup"` and exactly one button must be checked, so
  `?mode=timeline` with the switch off and no Timeline button leaves a radiogroup with nothing
  checked. It applies to the loose-link arm on metadata and tweets too, which the first draft missed
  — those pages carry `?mode=` in their URL, so the bar there can retain it and the reader keeps the
  way back to the mode they came from.
- Turning the switch **off** while in an experimental mode leaves the reader where they are, with
  their button still drawn. The operating manual allows falling back to the default mode; staying put
  is less surprising and costs nothing.
- `fitSignature` must carry **the identities of the visible modes, not their count.** Retaining the
  current mode keeps the count at nine while swapping `?mode=quotes` for `?mode=remember`, which
  changes the row's width because the labels differ — and the fit effect would not re-run. (Sol,
  finding 4.)

**Four existing test files change deliberately, and none by weakening a count:** they hold real
invariants and Sol flagged the temptation.

| File | What it needs |
|---|---|
| `tests/public-network-trace.test.tsx` | asserts every `MODES` member has a visitor button; must turn experimental *on* to keep sweeping all thirteen |
| `tests/modes-that-start-themselves.test.tsx` | presses Timeline and Quotes from `?mode=plain`; must turn experimental on |
| `tests/dock-fit.test.ts` | expects >10 loose mode links on the metadata page; becomes a statement about the visible set |
| `tests/profile-settings.test.tsx` | already handled in stage 1 |

*New tests:* the bar draws eight mode buttons with the switch off and thirteen with it on; `?mode=timeline`
draws Timeline, checked, with the switch off; the band for a hidden mode still renders; and **a
matrix over `marked` × experimental** (Sol, finding 10) — signed-out visitor, signed-in visitor on
and off, artefact present and absent, current mode experimental, both Dock arms — proving the segment
is never empty and exactly one radio is always checked.

*Docs in this stage:* [experimental-features.md](../project/experimental-features.md) § *What is
behind it today* stops saying "Nothing"; § *The three rules* gains the signed-out rule; § *Putting a
feature behind it* loses the "before the first gate" paragraph, which this work has now done.
[new-mode.md](../project/new-mode.md) and
[reading-view-overview.md](../project/reading-view-overview.md) gain the split.

*Plus a real browser*, signed out, on a shared article.

### Stage 3 — the switch, in the bar

A button at the end of the bar, after Metadata, **for signed-in readers only**. A toggle, not a link
to `/profile`: one press, where the effect is.

- **Signed-in comes from the store, not from `Dock`'s `signedIn` prop.** That prop is documented as
  visitor-copy input and is not passed by `Metadata.tsx:899` or `Tweets.tsx:319`, so a toggle keyed
  on it would vanish when an owner pressed Metadata. (Sol, finding 2.) The store knows the user id,
  so `useExperimental()` returns `signedIn` and the question has one answer everywhere.
- Not part of the radiogroup — `aria-pressed`, not `aria-checked`. `Dock` already keeps three button
  kinds apart for exactly this reason (`DockLink` / `DockTab` / `DockModes`); this is a fourth and
  gets its own component rather than a flag on one of them.
- **The three failure states are drawn, not swallowed** (Sol, finding 6). `useExperimental` exposes
  `loadError`, `error`, `stale` and `reload` precisely because a dead or lying switch is
  unacceptable, and a static tooltip explains none of them:

  | State | What the button does |
  |---|---|
  | not loaded / saving | `disabled` — pressing a switch we have not read is how a reader silently saves a value nobody chose |
  | load failed | drawn with a warning marker, **enabled**, and a press calls `reload()` rather than toggling; the label says so |
  | save failed | the hook has already put the value back; the button says it did not save, and `aria-invalid` |
  | offline copy (`stale`) | `disabled`, and says it is showing a saved answer |

- The tooltip sentence goes in [`src/messages.ts`](../../src/messages.ts) like every other sentence a
  reader sees, and it has to say what turning it on *does* — shows modes that are still being built —
  because the button's own word cannot.
- A tooltip is not the only carrier: the label is drawn beside the icon at the wide rungs, and the
  state is in `aria-pressed` / `aria-invalid`. See `marked` in `Dock.tsx` on why hover-only
  information is not acceptable here.
- `fitSignature` gains whether the toggle is drawn.

*Done looks like:* tests that it is absent when signed out, disabled before the answer arrives, that
pressing it changes the number of mode buttons, and one per failure row above. Plus a real browser,
signed in. Docs for the new control land in this stage.

## What this plan accepts

**A flash, once per session.** A reader with the switch on sees eight mode buttons and then thirteen,
one round trip later. The store removes it on every *subsequent* view change, which the per-component
hook would not have; removing the first one needs the answer before the session resolves, and under a
bearer-token architecture there is no such moment. Drawing nothing until `loaded` trades a flash for a
jump; `localStorage` puts a second copy of a server-owned fact in the browser. Named rather than
discovered.

**The sharing inventory still lists artefacts whose mode is hidden.** A signed-out visitor may be told
a shared article carries quotes while Quotes is absent from the bar. That is the deliberate
distinction between *this data is shared* and *this unfinished control is advertised*, and
`shared-inventory.ts` stays ungated.

**Everything that resolves a mode stays total.** `MODES`, the URL parser, `MODE_LABEL`,
`OWNER_MODE_NOTE`, `POLICY`, the band branch in `App.tsx`, activation and the passage resolvers all
keep recognising thirteen modes. That is what makes *hidden means hidden from the controls, not
unreachable* true. There are no keyboard shortcuts that expose a mode independently of its button —
arrow-key mode switching was removed on 2026-08-31 — so hiding a button removes its keyboard path
with it, which is correct.

## Review

GPT Sol reviewed this plan before stage 1 and found seven must-fixes; all seven are folded in above,
and the review is kept at
[260903c-…-review-sol.md](260903c-gate-unpolished-modes-behind-experimental-features-review-sol.md).
The built code goes back to it at the end of every stage, weighted higher —
[engineering-manager.md](../reusable/engineering-manager.md).
