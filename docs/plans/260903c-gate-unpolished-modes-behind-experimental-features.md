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

### `Dock` is told the answer; it does not go and get it

The store makes it *safe* for `Dock` to call `useExperimental()` itself — the subscription is the
store's, not the bar's. It is still the wrong shape, and **Fable arbitrated this fork against the
first draft**:

> `Dock`'s header and `Props` are explicit that the page owns fetches and the bar is told: `drawer`
> is a prop precisely so a visit to the metadata page "should not buy a drawer nobody opened", and
> `signedIn`, `visitor`, `marked` are all handed in. […] A would make `Dock` the first place in that
> file to subscribe to anything.

So the four pages that mount a `Dock` call `useExperimental()` and hand it down as a **required**
prop. The compiler then asks at every mount site, the way `ModesMissingFromDock` already asks for a
row per mode. Three of the four are compile errors if forgotten; the fourth, `tests/dock-fit.test.ts`,
casts `Dock as any` and would instead throw on a missing field — **so read `experimental.on`, never
`experimental?.on`.** A silent `undefined` there is a bar that quietly shows every mode.

It is also the better test seam. `tests/modes-that-start-themselves.test.tsx` presses Quotes and
Timeline and must turn the switch on from stage 2 onwards: as a prop that is one literal, and as a
store it would be a session announcement plus a `/api/reader` body in a test whose subject is jobs,
not auth. The fixtures (`EXPERIMENTAL_ON` / `EXPERIMENTAL_OFF`) live in a `tests/` helper — a fixture
should not ship from `Dock.tsx`.

The honest cost, which Fable named: four call sites can each pass a hand-rolled object, so the
compiler checks that *a* value arrived and not that it came from the hook. A fifth mount site
could hand-roll `{ on: true }` and show unfinished modes to strangers. One call inside `Dock` would
make that impossible by construction. Taken anyway, because the prop is the file's own contract and
the mistake is visible in review.

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

**Landed** as `cce68912`. What changed against the plan above, and why:

- **The store listens for the session itself**, rather than being told by `announceSession` from an
  effect in `App.tsx`. Sol's review of the built code: a passive effect runs *after* its children
  have rendered and committed, so an account switch drew one frame from the previous account's
  snapshot — which after stage 2 is A's experimental modes on B's screen. The store now subscribes to
  `onAuthStateChange` in the same notification pass as `useSession`, lazily on the first
  `subscribe()`. Verified against the installed SDK that a late subscriber still receives
  `INITIAL_SESSION` (`GoTrueClient.js:3638`, `_emitInitialSession(id)` per listener) — otherwise the
  store would have sat at `known: false` for ever, which looks exactly like working.
- **Three more races**, each found by review rather than by running it, and each now with a test seen
  red first: a `PATCH` that commits while an older `GET` is in flight; a `reload()` started mid-save
  doing the same through another door; and — the worst — an old epoch's `PATCH` retried under the new
  account's token, because `apiFetch` refreshes and retries a 401 with the *then-current* session, so
  A's `{ experimental: true }` could land on B's row with nothing on screen to say so. Every request
  now carries an `AbortSignal` that a session change aborts.
- **The store is lazy and stays lazy.** It asks the server only once something subscribes, so through
  stage 1 a reading view reads the switch not at all — the same as before it existed. A keep-awake
  subscriber in `App.tsx` that existed only to keep a trace assertion true was removed rather than
  kept; **stage 2 gets a real subscriber** when `App.tsx` calls `useExperimental()` to hand the answer
  to `Dock`, and `tests/public-network-trace.test.tsx` moves from zero to one there.
- One test edit the plan assigned to stage 2 belonged here: the trace file's parity assertion.

### Stage 2 — five modes go behind the switch

- **Every** `MODES_UI` row in [`Dock.tsx`](../../src/web/Dock.tsx) gains a required
  `experimental: boolean` — not an optional flag on five rows. `ModesMissingFromDock` proves each
  mode has a row; only a required field proves each row made the decision, and
  [new-mode.md](../project/new-mode.md) says the author must make it. (Sol, finding 8.)
- `Dock` gains a **required** `experimental` prop — the narrow slice of `ExperimentalSetting` it
  actually reads, widened in stage 3 to carry the failure states. `App.tsx`, `Metadata.tsx`,
  `Tweets.tsx` and `PublicPages.tsx` each call `useExperimental()` and pass it. See § *`Dock` is told
  the answer* above for why this is a prop rather than a hook call inside the bar.
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

**Built.** What changed against the plan above, and why:

- **The signed-out press sweep could not "turn experimental on", because nothing can.** The plan's
  table said `tests/public-network-trace.test.tsx` should turn the switch on to keep sweeping all
  thirteen. That works for the *signed-in* sweep in the second describe — the fixture's
  `GET /api/reader` now answers `{ experimentalSince }` and that reader gets thirteen buttons — and
  is impossible for the first, whose whole subject is a stranger and whose store issues no request
  at all for one. So the signed-out sweep runs **twice**: the buttons a stranger's bar draws, and
  then each remaining mode at its own `?mode=` address, where the retain rule guarantees its button.
  The union is still compared with `MODES` in both directions, so nothing was weakened; the second
  pass is also where *the band for a hidden mode still renders* is asserted end to end.
- **The store had to be reset between tests in that file.** It is a module singleton and
  `sessionIs` returns early when the user id has not changed — correctly, since an auth event is not
  news — so a test posing the same reader as the one before inherited that reader's answer and never
  re-asked. `resetForTests()` in `beforeEach`, imported dynamically for the same reason `App` is:
  `experimental-store.ts` pulls in `lib/api.ts`, which subscribes at module load, and a static
  import at the top of that file runs it before `authListeners` exists.
- **`fitSignature` and `visibleModes` are exported** so the identities-not-count rule can be tested
  without a DOM. `withMode` and `ModesMissingFromDock` are already exported from that file for
  test-and-survival reasons, so this is the house style rather than a new seam.
- **`tests/dock-fit.test.ts`'s "more than ten loose links" became the visible set**, asserted against
  `visibleModes(false, undefined).length` rather than against `8`, so the number moves with the rule
  instead of pinning today's count in a file whose subject is the fit ladder.
- **Two source comments were saying the old thing** and were fixed with the behaviour:
  `App.tsx`'s note that "stage 2 gets a real subscriber here" (it is in `Reader`, not `App`), and
  `SettingsSection.tsx`'s "Nothing is behind it yet".
- **The docs proposal is
  [260903c-experimental-features-doc-proposal.md](260903c-experimental-features-doc-proposal.md)** —
  five changes to the operating manual, before and after, applied and awaiting Greg's review.
- **Not done here:** the real browser pass.

**Landed.** Verified in real Chrome against `fowler-phrenology` on the local stack, all six cases:
signed out **8 buttons**; `?mode=timeline` signed out **9**, with exactly one `aria-checked`; signed
in off **8**; signed in on **13**; the metadata page **8**, and **9** arriving from `?mode=timeline`;
and `dock-fit` stepping to rung 1 at 900px with no horizontal overflow and back to rung 0 at 1400px.
(The thirteen-button bar stays on rung 1 at 1400px, which is correct — `dock-fit.ts` measured the
full thirteen-label row at 1416px.)

What changed against the plan above:

- **A weakened invariant, caught by Sol and confirmed by mutation.** `tests/dock-fit.test.ts` had
  lowered its loose-arm count from `> 10` to eight *and* asserted it against `visibleModes(false, …)`
  — the function the component itself calls, so it held however the filter behaved. Sol's surviving
  mutation was "make the loose arm always filter as Experimental off while leaving the radiogroup
  correct". Reproduced: it passes every other Dock test. The new
  *the metadata page with the switch on* counts against `MODES` instead — the vocabulary rather than
  the rule — and is the only assertion in the tree that notices the two arms disagreeing.
- **Four false claims in the rewritten docs**, three found by Sol and one by me. The table of reasons
  was written to justify a decision Greg had already made, and the rows nobody could source were the
  ones that invented deficiencies: Referee's sub-modes are all built (it is behind the switch for its
  *audience*), Quotes' verification is finished and deliberately narrow, and Diagram has four
  pictures rather than three. `reading-view-overview.md` had then restored the false umbrella —
  "why each of the five is not ready yet" — over the top of the corrected table. **Every row was
  re-checked against the doc it cites.**
- Three reference errors in the manual, one of them older than this work: the migration is
  `0037_experimental_features_and_callout_blocks.sql`, not the `0032` the doc had always named; the
  "still reachable" example used `?mode=outline`, which is default-visible and so demonstrates
  nothing; and a cross-reference to "the second rule" became the third when the anonymous rule was
  inserted above it.

Left for stage 3, on Sol's advice: `fitSignature` must carry **which toggle variant is drawn**, not
merely that a toggle exists — the warning marker and the disabled state change the row's width.

### Stage 3 — the switch, in the bar

A button at the end of the bar, after Metadata, **for signed-in readers only**. A toggle, not a link
to `/profile`: one press, where the effect is.

- **Signed-in comes from the `experimental` prop, not from `Dock`'s existing `signedIn` prop.** That
  one is documented as visitor-copy input and is not passed by `Metadata.tsx:899` or
  `Tweets.tsx:319`, so a toggle keyed on it would vanish when an owner pressed Metadata. (Sol,
  finding 2; Fable reached the same conclusion independently.) The store knows the user id, so
  `useExperimental()` returns `signedIn` — added in stage 1 — and the question has one answer
  everywhere. Two spellings of "is somebody signed in" now sit in one `Props`, which the file already
  apologises for once (`visitor` vs `drawer.visitor`); say plainly in the prop's doc which question
  each answers.
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

#### What landed

`DockExperimentalSwitch` in [`Dock.tsx`](../../src/web/Dock.tsx), last in the row, with
`toggleVariant` as the rule and `SWITCH_STATE` as what each appearance says.
`tests/dock-experimental-switch.test.tsx` is the table.

Four things went differently from the plan above, and each is a correction to it rather than a
shortcut:

- **The tooltip sentence is not in `src/messages.ts`.** The plan said it should be, "like every other
  sentence a reader sees" — but that file's own first line says it is what the reader is told **when
  something goes wrong**, and `FailureKind` decides what they should do about it. A description of a
  working control does not belong there. It went to a new
  [`experimental-copy.ts`](../../src/web/experimental-copy.ts), which `SettingsSection.tsx` now reads
  too: two controls for one setting must not tell a reader two stories, and until this stage the two
  sentences existed only inside the profile page's component.
- **`aria-disabled`, not `disabled`.** The plan's table said *disabled* for three of the states. A
  `disabled` button in Chrome fires no pointer events and takes no focus, so the tooltip explaining
  *why it will not move* is unreachable in exactly the states that need explaining — the failure
  would have been invisible on a working laptop, where none of those states occur. `styles.css §
  .dock-btn.soon` had already made this argument for buttons that were "not built yet" and had no
  user; this is its first.
- **Six appearances, not four.** The plan's four rows collapse *saving* into *not loaded* and leave
  *working* implicit. Six exclusive variants is what lets `fitSignature` carry which button is drawn
  — Sol's stage-2 note — rather than a boolean plus a handful of independent flags.
- **`aria-pressed` is dropped in two states, not set to `false`.** With no answer read, or a read
  that failed, there is no value to report, and `aria-pressed={false}` would be the button telling a
  screen reader the setting is off. That is the silent default in its most direct form, and it is
  invisible to anybody testing with their eyes. In `load-failed` the control is honestly not a toggle
  at all: the press retries the read.

**Every assertion was checked by mutation**, because a test of six failure states that has never been
red is six states nobody has visited ([silent-success.md](../reusable/silent-success.md)). Five
mutations, all caught: `aria-pressed={setting.on}` unconditionally (2 red), dropping the inert guard
in the handler (3), making the press always toggle (1), keying the fit signature on *presence* rather
than variant — Sol's exact stage-2 warning — (1), and keying the switch on `Dock`'s `signedIn` prop
rather than the store's (10).

Also done here, from Sol's stage-2 *shoulds*: two test names that claimed states the tests do not
enter were corrected rather than the tests reshaped (the bar is handed its answer; a session is
`experimental-store.test.tsx`'s subject, and `?mode=` is `App.tsx`'s), and the matrix gained the
signed-in non-owner it advertised.

#### What the review then found, and it found the two things that mattered

Five mutations of my own, all caught — and Sol found a **sixth that survived them all**: changing
`state={state}` to `state={undefined}` on the tooltip left every one of the twenty-six tests green
while deleting the entire justification for `aria-disabled`. The card is now opened for real, with
`referee-tooltips.test.tsx`'s hover mechanics, and its three paragraphs read.

Two must-fixes, both real, both checked before believing them:

- **`stale` was a dead end.** It was inert, and nothing anywhere asks the server again when the
  network returns — [`offline.ts`](../../src/web/offline.ts) listens for *going* offline and not for
  coming back, which I read rather than took on trust. So a reader whose page loaded from the cache
  had a permanently disabled switch until a full page reload. Sol reproduced it: a press called
  `reload` zero times. It is now a **retry** — the cached value still must not be moved, because
  another device may have changed it. The same hole was in `/profile`'s offline line, which said
  *"Reconnect to change it"* beside a disabled checkbox and offered nothing to press; **that is fixed
  too**, and it is older than this stage. The shared sentence lost its dead call to action.
- **The button had a moving accessible name *and* `aria-pressed`.** The APG allows one or the other,
  and this repo had already written the rule down — `DictationStrip.tsx` § *The button is an action,
  not a toggle*, where exactly this was fixed once before. The name is now fixed at "Experimental
  features" and the state is an `sr-only` description. Which also sharpened `aria-pressed`: it is
  drawn where a press **toggles**, and `stale` and `load-failed` are actions rather than toggles.
  `PRESS` is that three-way answer in one place.

And one *should*, taken: `DockExperimental` is `Pick`, not `Omit`. The two name the same nine fields
today; `Omit` would have made every field the store grows in future automatically part of the bar's
required contract.

**Browser, signed in, all six checks passed.** The switch is present on the reading view, the
metadata page and the tweets page — that last pair being the case the whole `experimental.signedIn`
decision exists for. Pressed: 8 mode buttons became 13, `aria-pressed` flipped, the button went
briefly inert while saving, and the value survived a reload. The accessible name stayed exactly
"Experimental features" in every state; the `sr-only` description resolved to the right sentence and
measured **1px wide**, so it costs the row nothing. The tooltip's three paragraphs came back in
order — state, what it does, what it does not promise. Enter toggles it and the focus ring shows.

The fit ladder, re-measured at seventeen buttons: rung 0 spells out **all seventeen labels** down to
1550px, rung 1 holds to 1100, rung 2 covers 900 and 700 with no overflow, and at 500px the bar
scrolls rather than clipping, which is the floor doing its job. "Plain" keeps its word at every
width. The cost of the new button, stated plainly: the fully-labelled row wants about a hundred
pixels more than it did, so a 1440px laptop now sits one rung lower than before.

**Two hours of that were spent measuring the wrong tree**, and it is worth writing down because
nothing about it looked wrong. This worktree's dev server died under the load of a full test run;
another worktree's vite took the port; and the probe went on signing in, loading the article and
answering — with sixteen buttons and no switch, which reads exactly like a regression I had just
introduced. What settled it was asking the server for the file rather than the page:
`curl localhost:<port>/src/web/Dock.tsx | grep -c dock-experimental` returned 0 there and 4 here. In
a tree where several agents share one Supabase and walk up the same port range, **a dev server that
answers is not evidence that it is yours.** The same trap explains an earlier "900/900, no overflow"
reading: a 150ms settle after a resize is not enough for a `ResizeObserver` plus three forced
reflows on a loaded box, and the short wait reported an overflow that a 1200ms wait does not see.

One thing the browser pass turned up that is **not this work's**: a React
*"Cannot update a component (`App`) while rendering a different component (`SignedIn`)"* warning
fires on every sign-in, before the bar is touched at all. Reproduced in isolation, pre-existing, and
worth its own look.

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

**Fable** arbitrated one fork the plan could not settle from the code alone — whether `Dock` calls
`useExperimental()` or is handed the answer — and ruled for the prop; § *`Dock` is told the answer*
records the reasoning and the cost.

GPT Sol reviewed this plan before stage 1 and found seven must-fixes; all seven are folded in above,
and the review is kept at
[260903c-…-review-sol.md](260903c-gate-unpolished-modes-behind-experimental-features-review-sol.md).
The built code goes back to it at the end of every stage, weighted higher —
[engineering-manager.md](../reusable/engineering-manager.md).
