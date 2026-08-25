# The structure panel — a granularity slider over a heading tree

**The closest thing in that codebase to [granularity zoom](../granularity-zoom.md).** They shipped a
ToC that could be filtered by depth with a single slider, lived with it, and left a list of things
they knew were wrong with it. That list is the useful part.

Reference doc: `docs/reference/UNIFIED_LEFT_PANE_TABBED_NAVIGATION.md`. Code:
`components/heading-tree.tsx`, `components/tools/StructurePanel.tsx`. Planning:
`docs/planning/finished/250529b_table_of_contents_expand_collapse_granularity.md`.

## What it does

The left pane shows the document's headings as a collapsible tree. One slider sets a **depth
cut-off** — show levels 1–2, or 1–3, and so on. When the filter hides a node's children, the parent
grows a **"+N hidden"** badge, so the reader can see that there is more down there without seeing
what it is.

That is the same bargain our left-right axis makes, expressed as a single control: one number, and
the whole outline gets coarser or finer at once. It is worth being clear about the difference —
**theirs filters a list, ours renders a grid.** Their slider chooses which rows to show; our columns
show every level at once and let the reader's eye move between them
([granularity-zoom.md § The tabular view](../granularity-zoom.md#the-tabular-view)). Theirs is
cheaper and less ambitious, and it is real evidence that the basic move — one control, whole-document
granularity — is usable.

## How it was built

`buildHeadingTree()` turns a flat array of headings into a tree with a monotonic stack, in one pass:

```ts
export function buildHeadingTree(headings: Heading[]): HeadingNode[] {
  const roots: HeadingNode[] = []
  const stack: { node: HeadingNode; level: number }[] = []

  for (const heading of headings) {
    const node: HeadingNode = { ...heading, children: [] }
    // Pop items from stack that are at the same level or higher
    while (stack.length > 0 && stack[stack.length - 1]!.level >= heading.level) {
      stack.pop()
    }
    if (stack.length === 0) roots.push(node)
    else stack[stack.length - 1]!.node.children.push(node)
    stack.push({ node, level: heading.level })
  }
  return roots
}
```

Worth noting that it **self-corrects skipped levels** — an `h1` followed by an `h3` just attaches,
with no special case. Real articles skip levels constantly, and this is the cheapest correct
handling of it. Our tree comes from the model rather than from source headings, but the same
tolerance is needed wherever we read an author's heading levels
([table-of-contents.md](../table-of-contents.md#building-the-tree-over-a-flat-article)).

A node is `{ id, text, level, elementId, children }`, and `elementId` is the `syr-*` id — commented
in their source as being there "for reliable lookup". Same instinct as
[block-ids.md](../block-ids.md): the display object carries the stable id, and every lookup goes
through it rather than through text.

**Filtering is unmounting, not collapsing.** Two separate mechanisms share the panel:

```ts
if (node.level > granularityLevel) return null   // granularity: whole subtree gone
const isExpanded = !collapsedIds.has(node.id)    // manual collapse: children gated
```

So a node can be hidden in two different ways, and they compose. That distinction is worth keeping
if we ever add a depth control: *"too deep to show"* and *"I closed this"* are different states and
should not share a variable.

The "+N hidden" count is two mutually-recursive walks — one counting a fully-hidden subtree, one
recursing into partially-visible children — then capped for display:

```ts
const hiddenCount = countHiddenDescendants(node, granularityLevel)
const displayHiddenCount = hiddenCount > 0
  ? (hiddenCount > 99 ? '99+' : hiddenCount.toString())
  : null
```

Both counters run fresh on every render for every visible node, with no memoisation. Fine at ToC
scale; the critique below flagged it, and they accepted it.

State lives in `StructurePanel.tsx` as `collapsedIds: Set<string>` and `granularityLevel: number`.
Both are **memory-only** — deliberately, and documented as a known gap.

## What they knew was wrong with it

All of these are recorded in the repo as deliberate calls or listed limitations, not discovered by
us:

- **State is not persisted.** Collapse a section, navigate away, come back — it's open again. Known,
  not fixed, and a reviewer had already handed them the shape that would have made it easy.
- **Tooltips fetch summaries for headings the granularity filter has hidden.** Real money spent
  generating text nobody can see. They flagged it and did not fix it.
- **No keyboard navigation and no animation** on expand/collapse. Deferred.

## The critique-before-implementation pattern

An o3 critique was appended to the plan **before** implementation, and most of it was acted on. It
is worth reading as a worked example of what one review round actually buys, because the hit rate is
unusually legible here — the shipped code either follows each point or visibly doesn't.

**Acted on:**

- *"A `HeadingList` that lives inside each tab will unmount every time the user switches tabs … If
  expand/collapse state is stored inside `HeadingList` you will lose it on every tab switch."* State
  was lifted above the tab. This is the same insight that later fixed
  [cross-pane-sync.md](cross-pane-sync.md) — twice in one codebase, the answer was *own the state
  higher up*.
- *"As soon as you need 'hide children of collapsed parent', '(+N hidden)' counts, granularity
  filtering, traversing by level becomes brittle and O(n²)ish … Consider normalising once into a
  simple tree."* That is `buildHeadingTree()` above, in a `useMemo`.
- *"If a user collapses a node and then changes the granularity slider so that all its descendants
  are filtered out anyway, you might show '(+0 hidden)'. Consider suppressing the badge when the
  count is 0 … cap it at '99+'."* Both shipped verbatim.
- *"When AI headings are regenerated the list object identity changes; clear the corresponding
  `expandedHeadings` set so you don't try to expand ids that no longer exist."* Collapsed state now
  clears when switching modes.
- *"The new component might be better called `HeadingTree` … 'HeadingList' suggests a flat list."*
  Renamed, word for word.

**Not acted on, and worth knowing which:**

- **Accessibility, half-done.** Real `<button>`s with `aria-expanded` shipped; `role="tree"` and
  `role="treeitem"` did not, and the limitations section doesn't mention the gap. A silent miss.
- **Windowing for very long documents.** Not built; pairs with the unmemoised counters above.
- **A persistence-ready state shape** (`TocViewState { expandedIds, granularity }`) "so saving to
  localStorage later is a one-liner". Never adopted, and the state is still memory-only — the door
  was pointed at and not walked through.
- **Duplicate heading text producing duplicate ids.** o3 predicted it; it shipped as an accepted
  limitation — *"No support for duplicate heading text in original headings."* Our
  [block-ids.md](../block-ids.md) makes that impossible by construction, which is the whole argument
  for minted ids over derived ones ([ids.md](ids.md)).

The pattern to copy is not "get a review". It is **write the plan, get one critique from a different
model, fold it in, and keep the critique beside the plan.** Five real defects for one round. See
[process-and-docs.md](process-and-docs.md#the-critique-habit-worth-stealing).

## What we take from this

**Rebuild the "+N hidden" badge idea, not the slider.** Our columns already give the reader every
level at once, so a depth cut-off is redundant — but the badge answers a question our view currently
doesn't: *how much am I not seeing?* A section that collapses 40 paragraphs and one that collapses 3
look identical in our L2 column. That is a genuine information gap, and their answer is a cheap one.

Concretely, three things worth doing here:

1. **Put "how much is under this" on a gist cell.** A count, a length, or a weight — the spine
   already computes measured pixel heights per section
   ([granularity-zoom.md § The spine](../granularity-zoom.md#the-spine-a-birds-eye-rail)), so the
   number exists.
2. **Persist collapse state in the URL, not in memory.** They didn't, and regretted it. We already
   hold view state in the URL ([url-state.md](../url-state.md)), so the mechanism is there — this is
   the outline-mode analogue of what `cols=` already does.
3. **Never generate text for a row that is filtered out.** Their tooltip bug is exactly the failure
   our pipeline makes hard: gists are generated once, ahead of time, per node
   ([architecture.md § Pipeline](../architecture.md#pipeline)), so there is no per-hover call to
   waste. Keep it that way — the moment a hover triggers a model call, this bug becomes possible
   here too. Our tooltips read from `tree.json` ([tooltips.md](../tooltips.md)); that is a property
   worth defending, not an accident.

### Where they landed, 2026-08-26

Points 1 and 2 both shipped in the **summary mode** ([../summaries.md](../summaries.md)), and point 3
is still true and still defended.

- The paragraph count on every row is "how much is under this" — `18¶`, from the same range the
  panel already resolves. The "+N sections" badge is here too, capped at `99+` and suppressed at
  zero exactly as their reviewer asked, and it is a **control** when the reader closed those sections
  and a **fact** when the depth cut-off hid them.
- The two ways to be hidden are two variables, which is this page's best single sentence.
- The depth cut-off is in the URL (`?deep=`). **Per-node open/closed is not**, and that is a partial
  decline of the advice above rather than a repeat of their mistake: the only way to write that set
  down is a list of node ids, and node ids here are positional — a re-run of `npm run toc` renumbers
  them, so a shared link would open a set of sections that are no longer the ones you opened. The
  depth is the stable half. See [../summaries.md](../summaries.md).

## See also

- [../summaries.md](../summaries.md) — the mode that took the badge, the cut-off and the two-variable rule
- [overview.md](overview.md) — the map to that codebase
- [../granularity-zoom.md](../granularity-zoom.md) — our version of this idea, taken much further
- [../table-of-contents.md](../table-of-contents.md) — our tree and what a row is for
- [reading-view-ui.md](reading-view-ui.md) — the pane this panel lived in, and what consolidating panes cost
- [summaries.md](summaries.md) — the summaries its tooltips were fetching
