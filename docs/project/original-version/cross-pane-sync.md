# Keeping two views of one document in sync

The best-documented failure-and-recovery in that codebase, and the one whose lesson we most directly
depend on. It ran in three episodes over a week: an automatic behaviour that worked and was killed
on purpose, a mechanism that broke when the layout changed, and a fix that only worked once the
architecture changed underneath it.

Ours is the same problem — the [spine](../granularity-zoom.md#the-spine-a-birds-eye-rail), the
columns and the URL must all agree about where the reader is — so this is worth reading before
touching [`position.ts`](../../../src/web/position.ts) or [`scroll.ts`](../../../src/web/scroll.ts).

## Episode one: auto-scroll worked, and they killed it anyway

`docs/planning/finished/250530d_toc_visible_headings_indication.md`

They built a hook (`useTocAutoScroll`) that scrolled the table of contents to follow whichever
heading was visible in the article, using an Intersection Observer. Along the way they found and
fixed four real bugs: a container-ref timing problem, an arbitrary element being picked out of a
`Set`'s unordered iteration, silent failures with no logging, and missing bounds-clamping.

The mechanism ended up correct. **Then they removed the feature**, for reasons that have nothing to
do with correctness:

> **Competing Scroll Intentions**: Auto-scroll fought with user's manual ToC scrolling, creating
> jarring experiences
>
> **Unpredictable Behavior**: Users couldn't predict when ToC would auto-scroll, leading to
> disorientation
>
> **False Triggers**: Rapid document scrolling caused excessive ToC movement
>
> **Content Reading Interruption**: Auto-scroll moved ToC focus away from where users were looking

And the conclusion they drew:

> User agency and predictability often trump automation convenience. Automatic behaviors should
> enhance, not replace, user control. Complex interactions need extensive user testing before
> implementation. Simple solutions often provide better user experience than clever ones.

They replaced it with a **click-triggered** version: click something in the article, and the ToC
scrolls to the nearest heading. The reader asks, and it answers.

### Why this matters here, specifically

**Our spine does the thing they abandoned.** It is a proportional rail with a you-are-here band that
follows the reader continuously ([granularity-zoom.md](../granularity-zoom.md#the-spine-a-birds-eye-rail)).

The difference is what moves. Their ToC **scrolled its own content** to keep up, so the list under
the reader's eye kept sliding away — that is what "moved ToC focus away from where users were
looking" means. Our rail is the **height of the viewport and never scrolls**; only a band inside it
moves. Nothing the reader is looking at gets pulled out from under them, and there is no competing
scroll to fight with, because the rail has no scroll of its own.

That is a real design difference and it is the reason we can have the continuous behaviour they
couldn't. Worth writing down, because the obvious "improvement" — making the rail scrollable so it
can show more labels — would reintroduce their exact bug. **The rail must not scroll.** If labels
don't fit, they get dropped, which is already what happens.

## Episode two: the layout changed and the wiring broke

When three panes became two with tabs ([reading-view-ui.md](reading-view-ui.md)), the click-triggered
sync stopped working. Their own root-cause note:

> In the old 3-pane layout, there were separate components (`TableOfContents` and `DocumentViewer`)
> that had direct communication. The new unified layout breaks this connection … The ToC is now
> inside `UnifiedLeftPane` and not directly accessible.

The attempted fix reached across the gap imperatively — find the nearest heading by scanning a
sorted array, then:

```js
setTimeout(() => {
  const tocElement = document.querySelector(`[data-heading-id="${nearestHeading.id}"]`)
  if (tocElement) tocElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
}, 100)
```

It didn't work, and — this is the telling part — **they could not tell which of four possible
reasons it was**: DOM timing across component boundaries, id mapping, scroll-container conflicts, or
missing state synchronisation. The plan records it as `⚠️ ATTEMPTED - UNSUCCESSFUL`.

A `setTimeout(100)` plus a raw `document.querySelector` is the recognisable signature of two
components coordinating without a shared owner. The delay isn't fixing a race; it is hiding one.

## Episode three: the fix was architectural

`docs/planning/finished/250605b_cross_pane_communication_refactor.md`,
`docs/reference/CROSS_PANE_COMMUNICATION_MESSAGING_ARCHITECTURE.md`

They stopped patching the handler and replaced the mechanism. The old flow:

```
Document click → CustomEvent('doc-heading-click') → UnifiedLeftPane listener → ToC scroll
```

The new one:

```
Document click → setCurrentPosition() → context state update → ToC useEffect → ToC scroll
```

A React Context — `DocumentCommunicationContext` — owning the shared state above both panes:

```ts
interface DocumentCommunicationState {
  currentPosition: DocumentPosition | null
  highlightedTerm: string | null
  activeTabId: string
}
```

The old DOM-event system was deleted rather than left running in parallel, which is the right call
and rarer than it should be.

### The sentence that explains the whole arc

Their doc's own heading over the deciding analysis:

> **Key Insight: You Need State Management, Not Just Events**

An event fires once and is forgotten. The requirement was that the ToC be correct **when the reader
switches to its tab**, possibly long after the scroll happened — and a component that wasn't mounted
never heard the event. No amount of better event plumbing fixes that; only something that
*remembers* does. They had also evaluated a typed event bus and noted, before building it, that it
would suit side effects rather than state — then built the state container.

Zustand was rejected as overkill; Context was chosen for six stated reasons, of which the
load-bearing one is *"Document position needs to persist across tab switches"*.

## What we take from this

**We already hold the right shape, and now we know why it is the right shape.**
[`position.ts`](../../../src/web/position.ts) owns where the reader is; the spine, the columns and
the URL all *read* it. Nothing pushes a scroll at anything, and no component tells another component
to move.

Three rules this episode justifies:

1. **One owner for reader position, above everything that cares.** Not an event, not a ref, not a
   `querySelector`. If a second thing ever needs to know where the reader is — a minimap, a progress
   bar, a comments list — it reads from the same place.
2. **A `setTimeout` to make coordination work is a bug report.** It says two components are racing
   and nobody owns the outcome. The answer is a shared value, not a delay.
3. **Continuous following is a privilege, not a default.** It is safe for us only because the thing
   that follows doesn't scroll. Any new follower — a highlighted row in a scrollable list, say —
   inherits their problem rather than our exemption.

## The gap neither of us has filled

**Nothing in that app remembers where you were on a previous visit.** Position sync is
within-session only, declared out of scope from the start — *"Reset on page reload is fine, but
maintain during session"* — and still listed as unbuilt future work.

We are ahead here: `?at=` holds the section's block id and survives reload and re-extraction
([url-state.md § The unit is a section](../url-state.md#the-unit-is-a-section-not-a-position)). But
that only helps a reader who kept the URL. **Coming back to an article you were half-way through and
landing where you left off is not built here either** — and with a library page arriving, it is the
obvious next thing to want. The pieces already exist: a block id, a per-article JSON artefact, and a
card to show it on.

## See also

- [overview.md](overview.md) — the map to that codebase
- [reading-view-ui.md](reading-view-ui.md) — the layout change that broke it
- [structure-panel.md](structure-panel.md) — the ToC that was being kept in sync
- [../granularity-zoom.md#the-spine-a-birds-eye-rail](../granularity-zoom.md#the-spine-a-birds-eye-rail) — our rail, and why it must not scroll
- [../url-state.md](../url-state.md) — where our reader position lives
