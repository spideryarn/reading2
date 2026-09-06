# Back to where you jumped from

Status as of 2026-09-06: **planned, not built** — evidence: no `jump-history.ts` in `src/web/`.

A reader clicks a glossary term, lands three thousand words away, and cannot find their way home.
On a desktop browser they press Back and it already works. Added to an iOS home screen — which is
how Greg reads — there is no Back to press.

## What Greg asked for

> When I reopen an article, I'd like it to reopen in the state & position I was last in. The same
> goes if I open Tweets or Metadata or similar that open in a new page. In fact, perhaps we can go a
> step further - I often find that if I click on something (e.g. a Glossary term) it takes me to a
> new location in the Text, and then it's hard to find my way back to where I was before (especially
> if I'm using the app where it's shared to my home screen on mobile, so there's no Back button. How
> can we improve this? I suppose we could have a Back to previous location button, perhaps with a
> dropdown that lists those previous locations. Or ask Fable if it can come up with a better
> solution. Maybe also indicate previous locations in the Spine, probably fading over time, so only
> the most recent few are really visible
>
> — Greg, 2026-09-06

Three asks, and they are in very different states.

## Ask 1 — reopen where you left it: **already built, already deployed**

[260905d](260905d-remember-where-you-were-in-an-article-and-move-the-design-link-into-admin.md)
landed it on 2026-09-05 (`a04dc7f5`, an ancestor of `origin/main`):
[`last-view.ts`](../../src/web/last-view.ts) copies the query string into `localStorage` under the
slug and replays it at a bare address. Nothing to do here.

**Three ways it can look broken, and the third is probably the one Greg is hitting:**

- A link carrying *any* article parameter beats the memory outright — deliberate, or a link you sent
  somebody would open somewhere else on their machine.
- `?mode=chat`, `?mode=diagram` and `?mode=remember` are remembered as *no mode*, because arriving
  in them starts a conversation or a paid model call.
- **iOS gives a home-screen web app storage separate from Safari's.** Our own
  [`install-hint.ts`](../../src/web/install-hint.ts) records this, for the install hint. So an
  article read in Safari and reopened from the Home Screen has no memory of the reader, and vice
  versa. No local-only design can fix it.

That third one is the argument for cross-device resume, and it is **out of scope here** — see
[§ Deliberately not in this plan](#deliberately-not-in-this-plan).

## Ask 2 — Tweets and Metadata

Half built, and the two halves are different things:

- Article → Metadata → back **already keeps your place in the article**: `carriedSearch`
  ([`router.ts`](../../src/web/router.ts)) carries `?at=` both ways
  ([`Metadata.tsx`](../../src/web/Metadata.tsx), [`Tweets.tsx`](../../src/web/Tweets.tsx)).
- Your scroll position *within* Tweets or Metadata is not remembered, and neither is which of the
  three pages you were last on — [260905d](260905d-remember-where-you-were-in-an-article-and-move-the-design-link-into-admin.md)
  deferred that explicitly. Stage D.

## Ask 3 — finding your way back after a jump

**The mechanism already exists; only the affordance is missing.** This is the central finding of the
plan and it decides its shape.

[url-state.md § Position replaces history](../project/url-state.md#position-replaces-history-deliberate-acts-push)
already draws exactly the line Greg would otherwise have to draw by hand:

- Scrolling, arrow keys ([`keynav.ts`](../../src/web/keynav.ts)) and swipe-steps
  ([`swipe.ts`](../../src/web/swipe.ts)) write `?at=` with a **debounced replace**, or write nothing
  at all. They never add a history entry.
- `jumpTo` ([`App.tsx`](../../src/web/App.tsx)) writes it with `history: "push"` and
  `limitUrlUpdates: throttle(0)`. Every "go there" in the app funnels through it as `onJump` — the
  glossary, ideas, quotes, the timeline, search hits, spine bands, gist items, `BlockRef` citations,
  the article's own internal links, the diagram.

So a browser Back **already** returns the reader to the pre-jump position, and no scroll ever
pollutes that. What is missing is a Back the reader can press in a `"display": "standalone"` shell
([`public/site.webmanifest`](../../public/site.webmanifest)).

### The decision: expose the stack that exists, do not build a second one

Fable was asked for a better shape than "button + dropdown + fading spine trail" and came back with
the same conclusion arrived at independently here: **do not build a parallel history**. A second
stack would have to re-derive which movements count as jumps — a rule this codebase already
implements, tests and documents — and the two would drift the first time somebody added a mode.

**The simpler option passed over: a `?from=` parameter.** It is the obvious way to record where you
came from, and it is wrong here for two reasons. It would ride along in every link a reader shares,
pointing a stranger's chip at a place they have never been; and it would need clearing rules of its
own at every navigation, which is a second contract beside the one `carriedSearch` already keeps.
The browser's stack already holds this fact per entry, for free, and survives a reload.

**The other option passed over: read the history stack directly.** It cannot be done — JavaScript
can see `history.length` and nothing else in it. That is why the dropdown Greg imagined needs a
record of our own, and why it is deferred rather than built: repeated presses of the chip walk the
chain backwards, which is the dropdown's function without its machinery.

### Why not the fading spine trail

Greg floated marks in the spine, fading over time. Recommended **against** in that form, and the
reason is the rail's own stated rule: it *"acquires marks when the reader asks for them and at no
other time"* ([`Spine.tsx`](../../src/web/Spine.tsx)). It is a 12px strip already carrying the
bands, the you-are-here marker and one lane per active search
([`spine-marks.ts`](../../src/web/spine-marks.ts)). A decaying trail is ambient information with no
action attached and a legend the reader would have to learn.

What is worth building is the single-mark version, and it earns its place by answering something the
chip's label cannot — *how far did I come?* **One faint tick at the block you jumped from, drawn
only while the chip is up.** Same datum as the chip, so there is nothing to keep in sync, no new
colour, no decay curve, no second lane. That is Stage C.

## Stages

Each ends green and committable. The value is front-loaded: Stage B alone solves the reported
problem.

### Stage A — the stamp

`history.state` learns which block a same-page push is leaving.

- [ ] New `src/web/jump-history.ts`: pure functions over an opaque state object — read the stamp,
      write the stamp, merge with whatever state is already there. No React, no DOM.
- [ ] `watchHistoryWrites` ([`router.ts`](../../src/web/router.ts)) substitutes the state argument
      instead of passing it through. It is already the single choke point for **both** nuqs's writes
      and `pushAddress`'s, which is why the stamp goes here and not in `jumpTo`.
- [ ] `jumpTo` deposits "the `at` I am leaving" for the wrapper to consume on the next push.
- [ ] A pathname change resets the stamp — an excursion belongs to one article.
- [ ] `replaceState` **preserves** the existing stamp rather than clearing it, or the debounced
      `?at=` write that lands 300ms after a jump would wipe it.
- [ ] Tests: `tests/jump-history.test.ts` — the merge, the reset, the preserve-on-replace. Red
      first.

**Risk to retire first:** whether nuqs puts anything of its own in `history.state`. If it does, the
stamp merges; if it also *reads* it, the merge must be non-destructive in both directions. Checked
before writing the wrapper.

### Stage B — the chip

- [ ] `src/web/ReturnChip.tsx` (or the closest existing precedent's shape): a small pill, bottom
      left, above the `Dock`, reading `↩ back to <section>`.
- [ ] Drawn **only** when the stamp names a block this article has. That gate is what makes it safe:
      a `?mode=`, `?cols=` or `?sort=` push carries no origin block, so the chip is never drawn over
      one, and pressing it can never leave the article or silently undo a column toggle. Browser
      Back keeps its fuller meaning; the chip means only *undo my jump*.
- [ ] Pressing it calls `history.back()` and **nothing else** — popstate → nuqs → `useReadingPosition`
      already does the scroll.
- [ ] It hides once the reader is back in the origin's section: the excursion is over.
- [ ] After a second jump it re-targets, so repeated presses walk the chain backwards.
- [ ] A stamped block the article no longer has (re-extraction) hides the chip rather than pointing
      at nothing — the same graceful nothing `scrollToBlock` gives a stale `?at=`.
- [ ] Tests: the gate, the label, the hide-when-home rule.
- [ ] Browser check in a Sonnet subagent, at a phone width, per
      [browser-control.md](../project/browser-control.md).

### Stage C — one tick in the spine

- [ ] A single faint mark at the origin block, drawn only while the chip is up, in the rail's
      existing mark machinery ([`spine-marks.ts`](../../src/web/spine-marks.ts)).
- [ ] It must not take a search lane or move the search marks sideways.
- [ ] Test the arithmetic, not the pixels — that is what `spine-marks.ts` is a separate module for.

### Stage D — Tweets and Metadata remember their own position

- [ ] Which of the three pages the reader was last on, and where they were within it.
- [ ] Shape to be settled at the start of the stage: it should extend
      [`last-view.ts`](../../src/web/last-view.ts) rather than add a second memory, and it must
      address content the way the rest of the app does — [block-ids.md](../project/block-ids.md),
      not a pixel offset — or a re-ingest silently lands the reader in the wrong place.
- [ ] Reopening `/read/<slug>` must still give the reader the **article**, not the metadata page.

### Docs

- [ ] [url-state.md § Position replaces history](../project/url-state.md#position-replaces-history-deliberate-acts-push)
      gains the stamp and the chip: same section, because it is the same rule.
- [ ] [reading-view-overview.md](../project/reading-view-overview.md) gains a line for the chip.
- [ ] [touch.md](../project/touch.md) if the chip needs anything said about the standalone shell.

## Deliberately not in this plan

- **A dropdown of previous locations.** Repeated presses walk the chain. Build a list only if Greg
  asks for one after using the chip.
- **The fading multi-mark trail.** Argued against above. Stage C is the part of it worth having.
- **Cross-device resume.** A schema change, and hard to reverse, so it is Greg's call rather than
  one to slip in. The design when it is wanted: a `last_view` column beside `lastOpenedAt` on the
  shelf row, written debounced from `writeLastView`, read **only** as the fallback when local
  storage has nothing. It slots under `last-view.ts` unchanged, and `REMEMBERED` /
  `NEVER_REMEMBERED` already say what may travel. Flagged because the iOS storage split above means
  this will stop being optional sooner than 260905d assumed.
- **Forward.** Untouched; the stamps live on the entries, so it keeps working on its own.

## References

- [url-state.md](../project/url-state.md) — the contract this extends, especially
  § Position replaces history and § Reopening an article where you left it.
- [260905d](260905d-remember-where-you-were-in-an-article-and-move-the-design-link-into-admin.md) —
  what shipped for ask 1, and what it deferred.
- [granularity-zoom.md](../project/granularity-zoom.md) — the spine, for Stage C.
- [block-ids.md](../project/block-ids.md) — why the stamp is a block id and not an offset.
- [reading-view-overview.md](../project/reading-view-overview.md),
  [touch.md](../project/touch.md), [keyboard.md](../project/keyboard.md).
