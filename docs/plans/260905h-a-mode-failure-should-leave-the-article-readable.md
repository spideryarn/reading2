# A mode failure should leave the article readable

Status: **built.** Stage 0 recorded, stage 1 committed (`d86810ed`), stage 2 done — the Dock focus
correction and the docs. Worktree `a2-mode-failure-containment`, branch
`worktree-a2-mode-failure-containment`, off `6eecb377f24d92446086a006d5b3103daae40aef`
(2026-09-05T22:04+01:00).

This is item **A2** of
[the main app architecture review](260905e-main-app-architecture-review.md#a2-a-mode-failure-should-leave-the-article-readable),
plus the smallest slice of **A1** that A2 needs, plus the **A6** Dock focus audit — together, that
review's checklist under *Stage: Establish the behavioural baseline and contain one mode failure*.
That checklist is the authority; this doc is how it gets built.

## The problem, in one paragraph

[`main.tsx`](../../src/web/main.tsx) wraps `<App />` in the one
[`AppBoundary`](../../src/web/AppBoundary.tsx), whose fallback **replaces its children**. So a render
exception anywhere — including inside one mode's panel — takes the prose, the spine, the dock and
every route with it, and the reader is left with three sentences of apology on an empty page. Nothing
is known to throw there today; the point is the blast radius, not a live bug.

There is a second, quieter cost. `Dock` arms an activation token before changing mode
([`activation.ts`](../../src/web/activation.ts)), and `useAutoRun` claims it **in an effect**. If the
target controller's *initial render* throws, that effect never runs, so the token is left with
`owner: null` — unclaimed, un-retired, and spendable by whichever mount of that band comes next. A
later Back can therefore start a paid job that nobody pressed for, which is exactly the bug
`owner` was introduced on 2026-09-02 to close.

## What gets built

Three things, in three stages.

1. **The Ideas controller moves out of `App.tsx`** into `src/web/modes/ideas/IdeasMode.tsx` —
   `IdeasBand`, `VisitorIdeasBand` and `useIdeasMode`, byte-for-byte where possible, with no change
   to props, sorting, effects or lifecycle. `App.tsx` re-exports `IdeasBand` so
   `tests/passage-mode-cleanup.test.tsx` keeps working while its import is moved in the same stage.
   This is the A1 slice A2 needs: the boundary has to enclose the controller's own computation
   (`useIdeasMode`'s memos and layout effect), and a boundary cannot catch a throw from the module
   scope of the component that renders it — the controller has to be a child.

2. **A reader-owned `FeatureBoundary`** wraps *the controller and its panel* — that is,
   `<IdeasBand>`/`<VisitorIdeasBand>` at the composition point in `Reader`, not the `IdeasPanel`
   element inside them. Its fallback names the feature, offers a working **return to Plain** and an
   explicit **retry**, keeps the article and `?at=`, reports through the existing sanitised path
   (`captureClientFailure` + `recordLog`), and shows no exception text and no article prose.

3. **An exact-token retirement seam in `activation.ts`.** A new
   `retireActivation(slug, target, identity)` — compare-and-retire, deleting only when **both** the
   stored `nonce` and the stored `sessionEpoch` match — called from the boundary's
   `componentDidCatch` with the pending identity captured at the seam *before* the failing render.
   It cannot erase a newer press (different nonce), a different reader's press (different epoch) or
   another target's token (different key). The epoch is in the identity because the authoritative
   contract in A2 is `(sessionEpoch, slug, target, nonce)`, not because a nonce collision is likely.

All three land in **one commit**. There is deliberately no stopping point at which the local fallback
exists and retirement does not — see § Why stages 1 and 2 are one stage.

And, separately from those, the **A6 Dock audit**: establish what the drawer's interaction contract
actually is, reproduce any defect, apply the smallest correction.

## Design decisions

### Where the boundary goes, and what resets it

`Reader`'s JSX renders each band as a sibling. The boundary is one wrapper element around the two
Ideas branches at that point. It is **not** put inside `IdeasBand` (a boundary cannot catch its own
render) and **not** around `IdeasPanel` (that would let `useIdeasMode` escape).

Four things reset it, and nothing else:

- **the reset key** — `` `${slug}|${owner ? "owner" : "visitor"}` ``;
- **the retry button**, which clears `broken` — it bumped an internal generation used as the child's
  key until Sol's F14 pointed out that the broken render has already unmounted the child, so the key
  reset nothing further;
- **a fresh press**, which is the F1 fix below;
- and, structurally, **unmounting**.

Scrolling, typing and `?at=` edits appear in none of them.

Two honest limits on that key, because an earlier draft of this paragraph called it more than it is
(Sol F6). `owner`/`visitor` is an access **class**, not an access identity: owner A → owner B on the
same slug does not change it. That is safe today only because `ArticlePage` remounts `Reader` when
the reader changes, so the boundary is destroyed structurally rather than reset — and the stage tests
that, rather than asserting it. And the key carries no mode term at all: the boundary is mounted only
while `mode === "ideas"`, so `mode` cannot change during its lifetime, and a feature with a genuine
sub-mode (Remember's `?remember=`, Diagram's picture chips) would not change the top-level `mode`
either — so it appends **that sub-mode's own identity**, which is the real extension point. The
three-part key documented the wrong one; Sol F18, 2026-09-06.

A retry that fails again must land back on the same actionable fallback rather than loop: the retry
clears `broken`, the child mounts and throws again, and the boundary is broken again. There is no automatic retry and no timer, so "loop" can only mean the reader pressing
the button repeatedly.

### A fresh press must not be parked behind the fallback (Sol F1)

`Dock`'s mode button arms a token on **every** press, including a press on the mode you are already
in — [`Dock.tsx`](../../src/web/Dock.tsx) § the radiogroup's `onClick`, and A2 says so outright
(*"pressing the mode you are already in mints something new"*). So without this rule the design has a
hole that survives everything else in it:

> press Ideas → it throws → `N1` is retired → fallback → **press Ideas again** → `N2` is armed, but
> the boundary is broken and renders no controller, so nothing claims it and nothing retires it →
> press Plain → press Back → the fresh controller claims `N2` and starts a paid job.

The rule: **while the fallback is showing, a changed exact press identity is a fresh Dock activation,
and it resets the boundary once** so the controller can claim that press immediately. If that render
fails, `componentDidCatch` retires that same identity; if it succeeds, ordinary `useAutoRun`
semantics apply. Merely changing the boundary's props must never leave a new press parked behind the
fallback.

Implemented as `getDerivedStateFromProps` comparing the incoming nonce against the last one the
boundary reset for — recorded whether or not the boundary was broken at the time, so a press made
*before* a failure cannot cause a spurious reset after it. A `null` press never resets anything,
which is what stops the retirement in `componentDidCatch` from immediately un-breaking the boundary.

Both outcomes are tested: fallback → press active Ideas → throws again → Plain → Back gives zero
POSTs; fallback → press active Ideas → succeeds gives exactly one POST attributable to that click.

### Why stages 1 and 2 are one stage (Sol F2)

Splitting them would have committed the charging bug that the second half exists to prevent. Before
the local boundary, a throw took the whole app down and there was no navigation left to press — so
"Dock press → throw → Plain → Back → paid job" was **unreachable**. A commit that adds a usable local
fallback without retirement makes it reachable. So the boundary and the retirement land together, and
the Dock-press → throw → Plain → Back test is red before either change and green before the commit.

### `Reader`'s per-mode state stays outside, but a failure must still clear the marks

`ideaFound` / `openOccurrence` live in `Reader` and feed `passages`, which feeds the marks in
`TableView`. They stay there: moving them inside the boundary would put the prose's mark input inside
something whose fallback replaces its children, which is the opposite of the goal.

But **they must not be left at their last value** (Sol F4). While `mode === "ideas"`, those two feed
the washed passages and the selected ring, so a controller that publishes real occurrences and then
throws on a later render would leave the prose marked for a panel that is no longer there — misleading
state, not merely reduced function. A2 requires a failed controller to follow its existing cleanup
policy, and `useIdeasMode` already has exactly the right one: an unmount-only effect that calls
`onFound([])` and `onOpenKey(null)`. React runs effect cleanups for the subtree an error boundary
destroys, so unmounting the failed controller clears both.

So the requirement is: **a previously committed Ideas controller that fails is unmounted and its
existing cleanup clears both values; once the fallback settles, the prose is readable with no stale
Ideas marks and no selected ring.** Tested by publishing and selecting a real occurrence first, then
throwing on a later render, then asserting the marks and the ring are gone while the fallback, the
prose and the dock remain. Asserting only that prose exists would not prove it.

### The retirement seam, and why it is a prop rather than a lookup

The boundary is handed `press: { nonce, sessionEpoch } | null`. A small **function** wrapper does the
reading and renders the class boundary inside itself, so the subscription lives in a component that
only exists in this mode rather than in `Reader`, which renders in every mode. It subscribes exactly
the way `useAutoRun` does — `useSyncExternalStore` over `subscribeActivations`, with the existing
primitive `pendingActivation(slug, target)` as the snapshot, because a snapshot that returned a fresh
object every call would loop — and then derives the full identity with a plain read of the stored
token's own epoch. Reading the store during render is a read; `retireActivation` is called only from
`componentDidCatch`, which is commit phase. Nothing mutates the store during render and nothing
depends on the failed child's effects. `children` is the same element reference across those
re-renders, so React bails out of re-rendering the feature when only the press changes.

Why not have the boundary look the token up itself at catch time? Because by then a *newer* press may
have arrived, and retiring that one is precisely the thing A2 forbids. The captured `nonce` is the
identity of the press that was pending when the render that threw began.

`retireActivation` deletes regardless of `owner`, because both cases are wrong to leave: unclaimed
(the effect never ran) and claimed-by-a-dead-mount (a later render threw after the effect). The
existing `claimActivation` already retires the second case when a *different* mount asks; doing it at
the point of failure is earlier and does not depend on a later mount arriving.

Boundary retry grants no new spend intent: it does not call `armActivation`, and the token it might
have spent is gone.

### The Dock drawer's real contract (A6)

Established from source before any change, and to be confirmed in a browser:

- `.dock-scrim` is `position: fixed; inset: 0; z-index: 92`.
- `.dock-drawer` is `z-index: 95`.
- `.dock` is `z-index: 96` — **above the scrim**.

So the bar stays clickable with the drawer open, by construction, while the rest of the reader does
not. The drawer is therefore **modeless with respect to the dock and pointer-blocking over the
reader beneath it** — the scrim is fixed across the whole viewport, so the prose *and* the other
reader chrome below `z-index: 92` are behind it, and only pointer input is intercepted; nothing
behind it is inert or hidden from keyboard or assistive-technology navigation (GPT Sol, F22 and F26
on the Stage 2 reviews, which are where "modal with respect to the prose" overstated it and "only
the prose is behind the dim" then understated it) — and
`aria-modal="true"` is a false statement about it: that attribute tells assistive technology to hide
everything outside the dialog, including a bar that is visually present and operable, and there is no
focus containment in the file to make the claim true the other way.

There is a second half, and without it the first is untestable (Sol F5). **Nothing moves focus into
the drawer when it opens** — `DockTab` only calls `onPanel` — and the drawer is rendered *before* the
dock in DOM order. So after opening with Enter, focus is still on the Comments button and Tab goes
forward into the rest of the bar, never into the dialog. "Does Tab leave the drawer?" cannot be asked
of a drawer focus never entered.

Expected correction, subject to the reproduction: **drop `aria-modal`, keep the labelled
`role="dialog"`, record the opener, move focus to the drawer's close button when it opens, leave
focus untrapped, and restore the opener on every close path** — Escape, the scrim, the close button,
and pressing the same dock tab again. Escape handling itself, the scrim, and the capture-phase race
with `CommentDialog` are left exactly as they are. No other overlay is touched: Lightbox,
FeedbackDialog and IllustratedView are real native `<dialog>` modals already and are out of scope.

The interaction test covers Enter-to-open, focus landing inside the drawer, Tab *not* being trapped,
and the opener getting focus back on each of the four close paths.

## Stages

Each ends green, committed, with this doc updated in the same commit, and with a GPT Sol review
(two rounds, then settled here).

### Stage 0 — the behavioural baseline (**done**)

Recorded in [260905h-baseline.md](260905h-baseline.md): base SHA, twelve test files run **one at a
time** on this box (a batched red here is contention, not evidence), 179 tests, all green, so
anything red later is ours. It also holds a 25-line description of the `public-network-trace`
harness — its mocks, its fake server, its `open`/`settle`/`remount` helpers — so the new shell test
can copy it without reading 2,759 lines, and the names of the owner-side Plain / Ideas / Chat request
traces that already exist.

**The named tests are regression coverage, and they are not a before/after trace diff** — an earlier
draft of this paragraph said they were, and Sol F9 established otherwise by reading them: Plain's
queue test accepts any positive number of `/api/jobs` calls, the private-hooks test uses `toContain`,
Ideas checks its own GET happened but rejects no additional ones, and the Chat tests assert DOM and
URL rather than a request sequence. An extraction that added an Ideas GET to Plain, or duplicated a
Chat GET, would leave every one of them green.

So the real thing: **capture and retain the harness's normalised `{url, method, auth}` trace** for
owner Plain arrival, Ideas arrival plus explicit activation, and Chat arrival on the fixture article,
before the extraction and again after, and **diff them**. The only normalisation permitted is
collapsing the deliberately variable job-poll repetitions, and that normalisation is written down
where the traces are. **The stage is not done until the diff is empty.** The captures live in
[260905h-traces.md](260905h-traces.md).

### Stage 1 — extract Ideas, contain it, and retire its press

One stage and one commit, for the reason in § Why stages 1 and 2 are one stage.

- Move `IdeasBand`, `VisitorIdeasBand`, `useIdeasMode` to `src/web/modes/ideas/IdeasMode.tsx`
  unchanged. Re-export `IdeasBand` from `App.tsx` for the duration; move
  `tests/passage-mode-cleanup.test.tsx`'s import to the new path in this same stage and delete the
  re-export at the end of it. Re-run the named owner traces: unchanged.
- **Write the failing shell-level tests first**, in
  `tests/a-broken-mode-leaves-the-article-readable.test.tsx`, on the harness the baseline describes:
  `vi.mock` the Ideas module so the controller throws during its own render, mount the reader at
  `?mode=ideas`, and watch them go red against the current tree.
- **Every containment assertion carries a positive control** (Sol F8). Each test asserts: the
  throwing mock actually ran, counted; the Ideas fallback is on screen, matched on its bracketed
  code and not its prose; the root `[render]` fallback is **absent**; the sanitised report was made
  once with no message text; and the prose and the dock are still there and Plain still works. A
  disconnected mock must not be able to pass.
- Add `src/web/FeatureBoundary.tsx` and wrap the two Ideas branches. Watch them go green.
- A second throw site: `vi.mock` `IdeasPanel` so the panel throws while the real controller's hooks
  run. Both must be contained.
- **The stale-marks case** (Sol F4): publish and select a real occurrence, then throw on a later
  render, then assert the passage marks and the selected ring are gone.
- Add `retireActivation(slug, target, identity)` to `activation.ts` — nonce **and** `sessionEpoch` —
  with its own docstring in the register of that file, and wire the captured press through the
  boundary.
- Activation tests, same file or a sibling: Dock press → initial render throw → Plain → Back gives
  **zero** job POSTs; **fallback → press the active Ideas button again → throws → Plain → Back also
  gives zero POSTs**, and **→ succeeds gives exactly one POST**; a newer press arriving before
  failure handling survives; another target's token survives; a press from a previous session epoch
  is not retired by a later one. The throwing controller has no effects at all, so nothing in these
  depends on the failed child's effects.
- Retry and identity: pressing retry re-renders and settles back to the fallback, not a loop and not
  a stuck fallback; owner A → owner B on the same slug is tested and shown to reset **structurally**,
  by `Reader` remounting (Sol F6); neither causes a job POST.

Done: `npm test`, `npm run typecheck`, `npm run check` green; `tests/modes-that-start-themselves.test.tsx`
green **unchanged**; every new test red before the change and green after, with the red output kept.

#### What landed

| File | |
|---|---|
| `src/web/modes/ideas/IdeasMode.tsx` | new, 279 lines. The controller, moved byte-for-byte — one `export` keyword the compiler required is the only textual change |
| `src/web/FeatureBoundary.tsx` | new, 271 lines. An exported function wrapper that reads the press, and a module-private class boundary |
| `src/web/activation.ts` | +91. `ActivationIdentity`, `activationIdentity(slug, target, nonce)`, `retireActivation`, and a paragraph in the header's *What else retires a token* |
| `src/web/App.tsx` | −281/+41, almost all of it the deletion. One `FeatureBoundary` at the composition point |
| `tests/a-broken-mode-leaves-the-article-readable.test.tsx` | new, 963 lines, 17 tests, full `App` under a real `<StrictMode>` **and** the root `AppBoundary`, plus one case that mounts `FeatureBoundary` alone |
| `tests/the-ideas-extraction-changed-no-requests.test.tsx` | new. `toEqual` on the whole request array — the only shape an *extra* request cannot survive |

#### And what the code review sent back

GPT Sol **refused** the stage on five findings — [260905h-code-review-sol.md](260905h-code-review-sol.md)
— all five closed on 2026-09-06:

- **F10 (P1)** — `throw null` in a controller reached `componentDidCatch` as `null`, `error.name`
  raised a `TypeError` out of the handler, retirement never ran and `AppBoundary` replaced the whole
  reader: the containment failing in exactly the case it exists for. Retirement now goes **first**,
  before any diagnostic touches the error, and the log name is derived defensively. `AppBoundary`
  had the same two lines and the same defect, with nothing above it to catch the second throw, so it
  was fixed too.
- **F11 (P1)** — the request-trace test mounted `NuqsAdapter → App` while `main.tsx` mounts
  `StrictMode → … → AppBoundary → App`, so a StrictMode-only duplicate could pass all three
  exact-sequence assertions. Mounted as production does, and **both** trees re-captured;
  [260905h-traces.md](260905h-traces.md) carries the new traces and says the first capture was not
  the production lifecycle. The base/candidate diff is still empty in all three.
- **F12 (P1)** — the racing-newer-press claim was only tested by calling `retireActivation`
  directly, which bypasses the boundary. Now tested at the React level, with the newer press armed
  during the failing render; proved red by making `componentDidCatch` look the token up at catch
  time.
- **F13 (P2)** — a retry that *succeeds* is now tested, which is the only arrangement in which a
  token wrongly armed by `retry` could survive to be spent.
- **F14 (P2)** — `generation` and its keyed `Fragment` removed; they reset nothing the unmount had
  not already reset.

**The red, kept, because a test that was never red proves nothing.** With the boundary removed and
everything else identical: `9 failed | 5 passed (14)`, six of them
`expected 'Something in Spideryarn broke while d…' to contain '[mode-render]'` — the root boundary
eating the page, which is the bug. With the boundary in but retirement disabled:
`4 failed | 10 passed`, `Back spent the retired press: expected [ { url: '/api/jobs', … } ] to
deeply equal []`. That is the charging bug of F2, reproduced and then closed.

**Two corrections made after the build, by me rather than by review:**

- The boundary was first written **unmounted from nothing** — the element rendered in all fourteen
  modes with `false` children, so a live activation subscription sat in the other thirteen. Now gated
  on `mode === "ideas"`. The `mode` term stayed in `resetKey` at the time, on the reasoning that a
  feature with a sub-mode would extend it; Sol F18 established that it would not, and it is gone —
  see § Where the boundary goes, and what resets it.
- `IdeasMode.tsx` cited the plan as a markdown link with a `../../../../` target, which turned
  `tests/doc-links.test.ts` red: that test resolves any `*.md` token in a source file against `.`,
  `docs/project` and `docs/reusable` only, and a link's *text* ends in `.md`. **In a file under
  `src/`, cite a doc by its bare repo-relative path** — `src/web/activation.ts`'s own header is the
  model.

**One fixture trap found on the way**, worth knowing before it makes something vacuous: `spya-idea01`
is not a valid block id — `i` and `1` are outside the id alphabet ([block-ids.md](../project/block-ids.md)) — so
`?idea=spya-idea01` silently selects nothing. The stale-marks test passed for that reason until it
was given a real id. `tests/public-network-trace.test.tsx` and
`tests/the-ideas-extraction-changed-no-requests.test.tsx` both carry the same invalid id; harmless
there, because neither ever selects it.

### Stage 2 — the Dock focus contract, and the docs

- Reproduce in a browser subagent: with the drawer open, is the dock operable by pointer? **Where is
  focus after opening with Enter** — still on the dock tab, per Sol F5? Where does Tab go from there?
  Where does focus land when the drawer closes? Screenshot and transcript, not reasoning from the CSS.
- Apply the smallest correction the reproduction justifies, with a red interaction test first in
  `tests/the-dock-drawer-is-not-a-modal.test.tsx`.
- Update [web-client.md](../project/web-client.md) (the boundary and the new `modes/` directory),
  [copy.md](../project/copy.md) (the fallback's words and its bracketed code) and
  [comments.md](../project/comments.md) (the drawer's interaction contract, since that is the panel
  it holds). Tick only this job's boxes in the review doc.
- Fix [logging.md § The browser: nothing, yet](../project/logging.md), which the work turned up as
  stale: it says `src/web/` has no logger, that browser errors are invisible in production, and that
  an error boundary reporting somewhere is a thing we *would* build. All three stopped being true —
  `AppBoundary` reports through `captureClientFailure` and `recordLog`, and `main.tsx` calls
  `watchUncaughtErrors`. A small, local correction to that one section; the rest of the file is left
  alone.

Done: as above, plus a browser transcript in this doc.

#### What landed

The reproduction below is what the correction was cut to fit, and it is **both halves and nothing
else**: `aria-modal="true"` is gone from the drawer (the labelled `role="dialog"` stays), the drawer
records the opener and moves focus to its close button when it opens, and every close path — Escape,
the scrim, the ×, the same tab pressed again — puts focus back. One effect in `Dock` does both
halves, because they are one fact. **No focus trap**: the bar behind is operable and Tab-reachable,
which is exactly why the `aria-modal` claim was false. The capture-phase Escape handler and its
race with `CommentDialog`, the scrim, the z-indexes and every other overlay are untouched.

**The red, kept.** Against the unchanged tree,
`tests/the-dock-drawer-is-not-a-modal.test.tsx` gave `6 failed | 2 passed (8)`:
`does not claim the rest of the page away` (*expected true to be false* — the attribute was there),
`moves into the drawer when it opens with Enter` (*expected false to be true* — the drawer did not
contain `document.activeElement`), and all four close paths, each *expected `<button …>` to be
`<button …>`* with focus on `<body>` or on the close button rather than the opener. The two that
passed are the two the browser had already established as true: the labelled dialog, and Tab not
being trapped.

**Three of those four close-path tests were green in a first draft**, and the reason is worth
keeping: jsdom's `.click()` does not focus the button it lands on, so with focus never entering the
drawer the opener still held it at close time and the assertion passed over a contract nothing kept
— [silent-success.md](../reusable/silent-success.md) in miniature. Each now asserts that focus is
*inside* the drawer first, and clicks the way a pointer does.

Docs corrected in the same stage: [web-client.md](../project/web-client.md) (rows for both
boundaries and `src/web/modes/`, plus § A mode that breaks does not take the article with it),
[copy.md](../project/copy.md) (`[mode-render]` and `[render]` as the third exception to
`src/messages.ts`), [comments.md](../project/comments.md) (§ The drawer, which is where this focus
contract lives), [ideas.md](../project/ideas.md) (its code list still pointed `IdeasBand` at
`App.tsx`), and [logging.md § The browser](../project/logging.md#the-browser-nothing-yet), which
still said `src/web/` had no logger, that browser errors were invisible in production, and that a
reporting error boundary was something we might build.

## The simpler option passed over

**Leave the boundary where it is and add nothing.** The counter is that the review's own acceptance
criterion — *one independently failing feature, still a usable reader* — is unreachable from one root
boundary, and every mode added after this one inherits the same blast radius.

**A boundary around each `*Panel.tsx` instead of at the composition point.** Cheaper to add (no
extraction) and it is what a reader would reach for first. Rejected because the mode's own
computation — `useIdeasMode`'s resolution memo and its layout effect, which is where a throw is
actually likely — runs in the *controller*, outside such a boundary. It would contain the least
likely half.

**Retire the token from the fallback's render or from a `useEffect` in the fallback.** Rejected: a
store mutation during render, or a dependency on effects in a subtree that has just failed. A2 names
both.

## Spikes

**`componentDidCatch` commits once under `<StrictMode>` when props are unchanged.** Measured
2026-09-05 in this worktree with a throwaway `tests/` file (deleted): a class boundary given a
constant `press={41}` around a child that throws on its first render recorded `[41]` — one entry, not
two — and rendered its fallback.

**That is all it establishes** (Sol F7). With a constant prop, "the props of the render that threw"
and "the props at catch time" are the same number, so the experiment cannot tell them apart, and an
earlier draft of this paragraph claimed it could. Sol's own React 19 harness saw three failing child
renders, four `getDerivedStateFromError` calls and one `componentDidCatch`; its attempt to make a
concurrent render delete a *newer* token failed because React restarted against the newer props
before committing. The distinguishable case is therefore proved by the stage's own tests rather than
by a spike: the racing-press test arms `N1`, throws, arms `N2` before the failure is handled, and
asserts that `N2` survives. And a double invocation would be harmless either way, since
`retireActivation` compares nonce and epoch and a second delete finds nothing.

## Review log

### Round 1 — the plan, GPT Sol, 2026-09-05

Prompt: [260905h-plan-review-prompt.md](260905h-plan-review-prompt.md). Answer:
[260905h-plan-review-sol.md](260905h-plan-review-sol.md). **Verdict: refuse as written**, on two
established P0s. All eight findings accepted; nothing overruled.

| ID | Severity | Finding | Disposition |
|----|----------|---------|-------------|
| F1 | P0 | A press made while the fallback is showing is parked behind it and spendable on a later Back | Fixed — § A fresh press must not be parked behind the fallback. **Verified in source first:** `Dock.tsx`'s radiogroup calls `armActivationForMode` on every press, the already-active mode included |
| F2 | P0 | Stage 1 as written commits the charging bug stage 2 exists to prevent | Fixed — stages merged into one commit; § Why stages 1 and 2 are one stage |
| F3 | P1 | The retirement identity omitted `sessionEpoch`, which A2 names | Fixed — identity is `{nonce, sessionEpoch}`, both compared |
| F4 | P1 | The plan accepted stale Ideas marks after a failure | Fixed — § a failure must still clear the marks. **Verified in source:** `useIdeasMode` already has the unmount-only clear, so this is a test to write rather than a mechanism to build |
| F5 | P1 | The Dock correction omitted focus *on opening*, making "does Tab leave?" vacuous | Fixed — record the opener, focus the close button on open, restore on all four close paths |
| F6 | P2 | `owner`/`visitor` is an access class, not an access identity; no sub-mode in the key | Fixed — both limits stated outright, and owner A → owner B is tested as a structural remount |
| F7 | P2 | The `componentDidCatch` spike overclaimed | Fixed — conclusion narrowed to what a constant prop can show; the distinguishable case moves into the stage's racing-press test |
| F8 | P2 | Two checks could pass without proving their claims | Fixed — positive controls listed. Its before/after trace diff I tried to narrow away; see F9 |

### Round 2 — the revised plan, GPT Sol, 2026-09-05

Prompt: [260905h-plan-review-prompt-2.md](260905h-plan-review-prompt-2.md). Answer:
[260905h-plan-review-sol-2.md](260905h-plan-review-sol-2.md). **Verdict: refuse as written**, on one
established P1. Accepted; nothing overruled. Discovery is now closed.

| ID | Severity | Finding | Disposition |
|----|----------|---------|-------------|
| F9 | P1 | The F8 narrowing was wrong: the named tests do not reject *additional* requests, so they are not a diff | Fixed — a real capture-and-diff, retained in [260905h-traces.md](260905h-traces.md). Sol established this by reading the four tests, not by inference, and it was my narrowing that was at fault |

It cleared three things it had been asked to attack, and those clearances are worth recording because
they are what the design now rests on:

- **The F1 reset-on-fresh-press rule holds.** Sol built a React 19.2.8 `<StrictMode>` probe of the
  proposed `getDerivedStateFromProps` bookkeeping: a nonce observed while healthy is committed to
  `pressSeen`; when that same render throws, error recovery *retains* the updated `pressSeen`;
  `componentDidCatch` commits once; a later changed nonce clears `broken` once and remounts the child.
- **A press for a different target is invisible here.** Activation notifications are global, but
  `pendingActivation(slug, target)` is keyed on both, so a Quotes press leaves the Ideas snapshot
  unchanged and `useSyncExternalStore` does not wake the Ideas boundary.
- **The primitive snapshot in F3 is sound.** A stored token's epoch cannot change after minting — the
  token is private to the module, only `owner` is ever mutated, and the job engine's epoch is
  monotonic. One implementation note taken from it: the plain identity reader takes the observed
  nonce and returns `null` if the slot has changed since, rather than reading whatever is there now.

### Round 3 — the code, GPT Sol, 2026-09-06

Prompt: [260905h-code-review-prompt.md](260905h-code-review-prompt.md). Answer:
[260905h-code-review-sol.md](260905h-code-review-sol.md). **Verdict: refuse**, on three established
P1s. All five accepted; nothing overruled. This is the round that earned its keep — a plan review
cannot find a boundary whose own handler throws.

| ID | Severity | Finding | Disposition |
|----|----------|---------|-------------|
| F10 | P1 | **A non-`Error` throw broke the handler itself.** `throw null` reaches `componentDidCatch` as `null`; `error.name` then throws a `TypeError`, `retireActivation` is never reached, and `AppBoundary` replaces the whole reader — the containment failing in exactly the case it exists for | Fixed: retire **first**, then report, then derive the log name defensively. A `throw null` case added. **And the same two lines fixed in `AppBoundary.tsx`**, which had the identical defect with no outer boundary to catch the secondary throw |
| F11 | P1 | The request-trace test mounted `NuqsAdapter → App`, but production mounts under `StrictMode` and `AppBoundary`, so a StrictMode-only duplicate passed every exact-sequence assertion | Fixed, and **both** trees re-captured. The traces changed a great deal — Plain 9 → 12, Ideas 12 → 16, Chat 11 → 16 — and the base/candidate diff is still empty in all three, now over a wider change since the candidate also carries the boundary |
| F12 | P1 | The racing-newer-press claim was a direct unit test of `retireActivation`, so the load-bearing claim about `this.props.press` was untested — all 14 tests would have stayed green had the handler looked the token up at catch time | Fixed with a React-level test, proved red against exactly that mutation |
| F13 | P2 | Retry-that-*succeeds* was untested, so a `retry` that wrongly armed a token would have had it retired by the second throw and the zero-POST assertion would still pass | Fixed |
| F14 | P2 | `generation` and its keyed `Fragment` were redundant — the broken render has already unmounted the child, so clearing `broken` necessarily mounts a fresh one | Fixed; fewer parts, which is the house preference |

#### One thing the fixes taught us, which the plan had slightly wrong

The retirement comment used to say it retires *the press pending when the render that threw began*.
Not quite. React answers a throw in a concurrent render by re-rendering the whole root synchronously
and letting it throw again, so **the render that is finally caught need not be the first that threw**,
and `this.props` in `componentDidCatch` is the caught one's. The guarantee survives intact, because
the gap is unreachable: a press is armed by a real `onClick`, and a click cannot interleave with
React's synchronous recovery pass. The comment now says this exactly rather than nearly. Found by the
implementing agent while making Sol's own suggested test shape work — Sol's one-shot version does not
catch anything, because a child that throws only once is re-rendered successfully on the recovery
pass.

### Round 4 — the code, second pass, GPT Sol, 2026-09-06

Prompt: [260905h-code-review-prompt-2.md](260905h-code-review-prompt-2.md). Answer:
[260905h-code-review-sol-2.md](260905h-code-review-sol-2.md). **Verdict: refuse**, on one established
P1. No charging defect and no P0 found. All four accepted; nothing overruled. **Discovery closes
here** — two rounds on the plan and two on the code.

| ID | Severity | Finding | Disposition |
|----|----------|---------|-------------|
| F15 | P1 | The `AppBoundary` half of the F10 fix had **no regression test** — reverting that file alone left all 17 containment tests green, because `FeatureBoundary` succeeds and the root boundary never sees the `null` | Fixed: its own red-then-green test |
| F16 | P2 | The racing-press probe's stated claim was false — see below | Fixed: the claim narrowed to what the test actually shows |
| F17 | P2 (reasoned) | Retirement is now the one operation that can throw out of `componentDidCatch`: `retireActivation` calls `emit()`, which invokes subscribers uncontained, and a throwing subscriber would skip the report and escape into `AppBoundary` | Fixed: retirement wrapped, its own failure reported. The same class as F10 — a handler that can itself throw is not a handler |
| F18 | P2 | The `mode` term in `resetKey` is dead (the boundary is mounted only in that mode) **and documents the wrong extension point** — a sub-mode would not change the top-level `mode` either | Fixed: key is `slug\|access`, and the comment now names the real requirement |

**F16 is worth reading twice, because it is a check that looked stronger than it was.** The probe arms
a new token on *every* render attempt, so at the caught render the props hold `Nk` while the store
already holds `Nk+1` — and `retireActivation(Nk)` therefore matches nothing and deletes nothing. So
the test does not show the boundary retiring the press its failed render was holding; it shows only
that a **newer** token is not deleted. That is a real property and the important half of failure mode
(b), and it is why the catch-time-lookup mutation fails it — but the name claimed more than the test
did, which is [silent-success.md](../reusable/silent-success.md) wearing a green tick. The claim is
now narrowed, and the ordinary page cases are what prove a matching token is actually retired.

Sol also confirmed the production argument for React 19.2.8: once a render throws, React performs
synchronous recovery **in the same JavaScript task**, so a browser click cannot enter that gap.

## Stage 2 — the Dock's real focus contract, reproduced

Playwright against system Chrome on the box, 2026-09-06, signed-out visitor on
`/read/cargocult-spya-rz663q`. Screenshot `.playwright-mcp/a6d-drawer-open.png` (gitignored).

| Question | What the browser did |
|---|---|
| Is the **dock** operable with the drawer open? | **Yes.** Clicking the Hierarchy radio changed the mode and the drawer stayed open. `elementFromPoint` over a dock button returns the button, not the scrim — `.dock` at `z-index: 96` really is above the scrim at 92 |
| Is the **prose** operable? | **No.** `elementFromPoint` over both a gutter permalink and the paragraph text returns `<button class="dock-scrim">`, and a real click times out with *"dock-scrim intercepts pointer events"* |
| Where is focus after opening with Enter? | **Still on the dock's Comments button.** Nothing moves it into the drawer |
| Tab ×3 from there? | Tweets → Metadata → `<body>`. Focus **never enters the drawer** and does visit background dock controls. No trap |
| Focus on close? | Escape: stays on Comments (it never left). Scrim: `<body>`. The X button: `<body>`. Same tab again: stays on Comments |
| Background hidden? | No `inert` anywhere; `aria-hidden` only on 61 decorative icon `<svg>`s, never on an ancestor of the prose |

**So the verdict is settled, and it is the one A6 asked for.** The drawer is **modeless in every
observable respect except appearance**: the only modal-like behaviour is the scrim blocking pointer
input *to the prose*, and even that leaves the dock fully operable. `aria-modal="true"` is **not a
true statement** about it — that attribute tells assistive technology the rest of the page does not
exist, while the bar behind it is visually present, operable by pointer, and reachable by Tab.

This also settles Sol F5: asking "does Tab leave the drawer?" was vacuous, because focus never
enters it. The correction is therefore both halves — the declaration and the focus.

### Round 5 — Stage 2, GPT Sol, 2026-09-06

Prompt: [260905h-stage2-review-prompt.md](260905h-stage2-review-prompt.md). Answer:
[260905h-stage2-review-sol.md](260905h-stage2-review-sol.md). **Verdict: refuse**, on one established
P1. All four accepted; nothing overruled.

| ID | Severity | Finding | Disposition |
|----|----------|---------|-------------|
| F19 | P1 | **Selecting a comment hands focus back to the dock instead of into the dialog.** Open Comments → Tab to a question → activate it: `App` closes the drawer and opens `CommentDialog` in the same interaction, the drawer's cleanup focuses the Comments button, and `CommentDialog` has no focus effect — so the dialog that just opened gets nothing, and the next Tab goes onward through Tweets/Metadata rather than into the comment. **Not a regression**: before Stage 2 focus never left the Comments button either, so the end state is unchanged. Moving focus properly is what made the gap visible | Fixed — `CommentDialog` gets the same modeless-dialog lifecycle, with its own red-first test |
| F20 | P3 | The docs say **two** error boundaries; there are three. `ChunkBoundary` inside `LazyPage` (`[chunk]`) arrived in this tree from the lazy-route job while this one was running | Fixed in `copy.md` and `logging.md` |
| F21 | P3 | My own correction to `logging.md` replaced one wrong statement with another: "`src/web/` has no logger" is false in a file that describes `recordLog`, a ring buffer and redaction — what it lacks is **Pino and a continuous remote stream** — and of the 11 grep matches, three are comments, so eight are executable calls. A textual grep is not a call counter | Fixed |
| F22 | P3 | "Modal with respect to the prose" overstates it: only *pointer* input is intercepted; the prose is not inert, not hidden, and focus is deliberately free to leave | Fixed wherever the phrase was copied to |

Three things it cleared, which are what the design now rests on:

- **Dropping `aria-modal` while keeping a labelled `role="dialog"` is the right call.** `aria-modal`
  would claim every external surface is unavailable, contradicting a deliberately operable dock; a
  real trap would make the contradiction worse unless the dock moved inside the modal scope.
- **The `open`-only dependency is safe**: `Panel` has exactly one legal non-null value, so `?panel=`
  cannot switch between two open panels.
- The new focus effect does not fight the capture-phase Escape handler or the scrim.

**F21 is the one to learn from.** It is the second time in this job that a correction to a stale doc
introduced a fresh inaccuracy — the first was the trace-diff narrowing in F9. Both times the new
sentence was written from a plausible reading rather than from a measurement, and both times the
reviewer simply went and looked. When replacing a false statement about the code, run the command.

### Round 6 — Stage 2, second pass, GPT Sol, 2026-09-06

Prompt: [260905h-stage2-review-prompt-2.md](260905h-stage2-review-prompt-2.md). Answer:
[260905h-stage2-review-sol-2.md](260905h-stage2-review-sol-2.md). **Verdict: refuse**, on two
established P1s, both reproduced in a harness of its own. All five accepted; nothing overruled.
**This is the last round on Stage 2** — two rounds, as the cadence says.

| ID | Severity | Finding | Disposition |
|----|----------|---------|-------------|
| F23 | P1 | **Selecting another comment from the drawer bypasses the dialog's mount-only effect.** `App` swaps comment A → B with no `key`, so the dialog stays mounted, the empty-dep effect never re-runs, focus stays outside, and `openerRef` still describes A's opening path — so closing B could restore an obsolete gutter control | Fixed: a second effect keyed on the comment id, bailing out when focus is already inside so prev/next and delete-to-neighbour are untouched |
| F24 | P1 | **Deleting a gutter-opened comment with no neighbour drops focus on `<body>`.** The gutter button and the focused Delete button both vanish in the same commit, `isConnected` is false, the cleanup deliberately does nothing, and the reader loses their place | Fixed: fall back to the dock's Comments button when the recorded opener has gone |
| F25 | P3 | The console-inventory command I wrote down **does not do what it says** — it claims to exclude the preview pages and does not, so it returns 18, not 11 | Fixed, and the corrected command run before writing it down |
| F26 | P3 | "Only the prose is behind the dim" is too narrow: the scrim is fixed across the viewport at z-index 92, the comment and chat dialogs are at 70, so most of the reader is behind it | Fixed in `Dock.tsx` and `comments.md` |
| F27 | P3 | The close button is **not** first in the dialog's tab order — Previous and Next precede it when navigation is shown | Fixed |

**Neither P1 is a regression**, and that is worth stating plainly: before this job nothing moved
focus at all, so the end state of both sequences was exactly the same. They are pre-existing gaps
that doing focus properly made reachable. Closing them is the "default to doing it now" rule, not
repair work.

**And F25 is the third time in this job** that correcting a stale statement about the code produced a
fresh inaccuracy — after F9's trace-diff narrowing and F21's "no logger". Every one was written from a
plausible reading rather than from running the thing, and every one was caught by a reviewer who
simply ran it. The lesson has earned its place in this doc: **when you replace a false sentence about
the code, run the command first, and paste what it actually printed.**
