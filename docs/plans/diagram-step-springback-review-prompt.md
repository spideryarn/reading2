# Review: the Diagram panel's ↑ / ↓ step buttons spring back

You are reviewing a **diagnosis and a proposed fix**, before it is built. Be adversarial about
both. This is a React + TypeScript reading app (Spideryarn). Repo root has `src/web/`.

## The report, in Greg's words

> Try and fix/improve the Diagram up/down buttons (e.g. for Trail) — they don't seem to work very
> reliably. I press them, something changes, and then sometimes it seems to revert back to the
> active node it was on.

## The architecture you need

- The reading view keeps the reader's position in the URL as `?at=<blockId>`. One hook,
  `useReadingPosition`, owns it, both directions: the URL scrolls the page, and the page writes
  the URL once the reader stops moving.
- `?at=` is written by a scroll spy at **section** granularity. `buildSections` (position.ts)
  produces one `Section` per navigable item at `sectionDepth(geometry)`; each carries the
  `blockId` of the **first block** of that section.
- Diagram mode draws the article as a picture in a middle band. Three pictures: **Force**
  (sections as bubbles), **Drift** and **Trail** (scatters — **one dot per paragraph**).
- The panel is drawn from `atRow`, which is `?at=` looked up as an index into `article.blocks`.
- Under the picture is a step bar: ↑ / ↓ buttons and a `12 / 47` readout. `stepStops` builds a
  ladder of rungs, one per distinct drawn row; on a scatter each rung's `blockId` is **an
  arbitrary paragraph**, not a section start.

## The code

### `useReadingPosition` — src/web/App.tsx

```ts
}

/**
 * Reading position, both ways: the URL scrolls the page, and the page writes the
 * URL once the reader stops moving. Returns the one function anything should use
 * to jump somewhere deliberately.
 *
 * `synced` is the whole trick. Scrolling writes the URL and the URL scrolls the
 * page, so without a record of the value both sides already agree on, every
 * scroll bounces off the restore effect and scrolls again. It is set by whichever
 * side moved first; the other then recognises the value as its own and does
 * nothing.
 *
 * The pure half — which block counts as "the section you are in", and why it is
 * a section rather than an offset — is in position.ts. Written by
 * spideryarn2-cd, 2026-08-25.
 */
function useReadingPosition(sections: Section[], layoutKey: string) {
  const [at, setAt] = useQueryState("at", atParam);
  const synced = useRef<BlockId | null>(null);

  // URL → page: first load, back/forward, pasted link.
  useEffect(() => {
    if (at === synced.current) return;
    synced.current = at;
    if (at === null) window.scrollTo({ top: 0 });
    else scrollToBlock(at, "auto");
  }, [at]);

  // Page → URL, once the reader stops moving.
  useEffect(() => {
    const rows = sections.map((s) =>
      document.querySelector<HTMLElement>(`tr[data-block="${CSS.escape(s.blockId)}"]`),
    );
    let frame = 0;
    const measure = () => {
      frame = 0;
      // Above the first section there is no section to name, and saying so keeps
      // ?at= out of the URL until the reader has actually moved.
      if (window.scrollY <= stickyOffset()) {
        if (synced.current === null) return;
        synced.current = null;
        void setAt(null);
        return;
      }
      const tops = rows.map((el) =>
        el ? el.getBoundingClientRect().top : Number.POSITIVE_INFINITY,
      );
      const id = sections[activeSectionIndex(tops, stickyOffset() + 1)]?.blockId ?? null;
      if (id === null || id === synced.current) return;
      synced.current = id;
      void setAt(id);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    measure(); // a column toggle reflows every row without the reader scrolling
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sections, setAt, layoutKey]);

  /* The controls bar gets out of the way while you read forwards, on a viewport
     short enough for 44px to matter — scroll.ts § watchBarVisibility, and
     styles.css § a small device for the half that decides whether it applies.

     A second scroll listener rather than a branch inside the one above, and
     deliberately: that one exists to keep `?at=` in step with the reader and
     owns React state, this one touches nothing but a `data-` attribute and
     causes no renders at all.

     They do schedule their own rAF callbacks rather than sharing one, so on a
     short viewport this is a second frame callback per scroll — said plainly
     because an earlier version of this comment claimed the pair cost one
     between them, which was simply false (GPT Sol, 2026-08-27). It is bounded:
     the watcher attaches only while the short-viewport media query matches, so
     a laptop installs no listener and pays nothing at all.

     Mounted with no dependencies because it depends on nothing — it re-reads
     the world every frame it runs. */
  useEffect(() => watchBarVisibility(), []);

  // A jump is the one scroll that pushes history: Back must not undo scrolling,
  // but flinging yourself across the article is a deliberate act. The debounce is
  // cancelled too, so a click isn't sluggish.
  //
  // `throttle(0)`, not `undefined`: nuqs resolves this option with `??`, so an
  // explicit undefined here falls straight through to atParam's
  // `debounce(POSITION_SETTLE_MS)` and cancels nothing. throttle(0) aborts the
  // pending debounce and writes the URL on the spot. Caught by
  // exactOptionalPropertyTypes — see docs/project/typechecking.md.
  const jumpTo = useCallback(
    (blockId: BlockId) => {
      synced.current = blockId;
      void setAt(blockId, { history: "push", limitUrlUpdates: throttle(0) });
      scrollToBlock(blockId);
    },
    [setAt],
  );

  // `at` goes out as well as `jumpTo` because it is half of the answer to
  // "where should this link land" — the other half being `?note=`, which the
  // caller has and this hook does not. See arrivalTarget in scroll.ts.
```

### `buildSections` / `activeSectionIndex` — src/web/position.ts

```ts
 */
export function sectionDepth(geometry: Geometry): number {
  return Math.max(1, geometry.leafDepth - 1);
}

/**
 * Every section in document order, with the row it starts on.
 *
 * The section column already holds one cell per section with a `rowSpan`
 * covering its range, so running the spans up gives the start rows directly —
 * no second walk of the tree, and no chance of disagreeing with what is on
 * screen.
 */
export function buildSections(geometry: Geometry, blocks: Block[]): Section[] {
  const column = geometry.cells[sectionDepth(geometry)] ?? [];
  const sections: Section[] = [];
  /* `navigableItems`, not the raw cells. At the section depth the apparatus is
     one leaf cell per endnote, each with an empty title, so a reader who stops
     in the notes would have `?at=` stepping through forty nameless sections and
     the panel naming none of them. Collapsed, the notes are one section called
     "Notes" whose id is its first block — and that is the same item keynav
     steps to and the fisheye marks current, which is the agreement this
     projection exists to guarantee. src/web/tree.ts § navigableItems. */
  for (const item of navigableItems(column, geometry.supplementOf)) {
    const block = blocks[item.startRow];
    if (!block) continue;
    sections.push({
      row: item.startRow,
      blockId: block.id,
      nodeId: item.node.id,
      title: item.node.title,
    });
  }
  return sections;
}

/**
 * Which section the reader is standing in, given each section's distance from
 * the top of the viewport and the line we measure against.
 *
 * `tops` is in document order, so this is the last one that has already gone
 * past the line. Above the first section it clamps to 0 rather than returning
 * -1: there is always a section you are in, even if it hasn't reached the top
 * of the screen yet.
 */
export function activeSectionIndex(tops: number[], line: number): number {
  let active = 0;
  // `.entries()` rather than an index loop: it hands out the value already
  // typed, so there is no indexing to bounds-check.
  for (const [i, top] of tops.entries()) {
    if (top > line) break;
    active = i;
  }
  return active;
}
```

### The step bar — src/web/DiagramPanel.tsx

```ts
  /* The article's block → row index, which the step ladder needs to turn a
     node's `blockId` into a position. One pass over an array already held, and
     memoised on it, so it costs nothing per press. */
  const rowOf = useMemo(() => new Map(blocks.map((b, i) => [b.id, i])), [blocks]);

  /** The ladder the ↑ / ↓ buttons walk — see `stepStops` in diagram.ts. */
  const stops = useMemo(() => stepStops(layout?.nodes ?? [], rowOf), [layout, rowOf]);
  const starts = useMemo(() => stops.map((s) => s.row), [stops]);

  /* Where in that ladder the reader is standing, 1-based, for the readout
     between the two buttons. The same arithmetic the reading-position code
     uses, over rows rather than pixels. */
  const readerRow = atRow ?? starts[0] ?? 0;
  const rung = starts.length > 0 ? activeSectionIndex(starts, readerRow) + 1 : 0;
  /**
   * What one press moves by, in the reader's own words — **read off what is
   * drawn rather than off which toggle is pressed.**
   *
   * "Section" was hardcoded for everything that was not a scatter, which is
   * wrong twice: an article with no sub-sections, or one whose parts the reader
   * has folded away, steps by **part** while the button still says section.
   * A label that is confidently wrong about the unit is worse than no label,
   * because the readout beside it is a count of exactly that unit. GPT Sol's
   * finding, 2026-08-27.
   */
  const deepest = (layout?.nodes ?? []).reduce((d, n) => Math.max(d, n.depth), 0);
  const unit = drawingPoints ? "paragraph" : deepest >= 2 ? "section" : "part";

  /**
   * One step through the article, and the picture follows because it is drawn
   * from `atRow`.
   *
   * `stepTarget` is **keynav.ts's**, not a second copy of the rule: ↓ is always
   * the next item, and ↑ part-way into an item goes to the top of the item you
   * are in before it steps back. That is the track-skip rule from every music
   * player (docs/project/keyboard.md), and having these buttons disagree with
   * the arrow keys about what ↑ means would be worse than not having them.
   */
  const stepTo = (dir: -1 | 1) => {
    const row = stepTarget(starts, readerRow, dir);
    if (row === null) return;
    /* The stop carries its own block, rather than this asking `nodeAt` again.
       Two lookups of the same fact is how they come to disagree — and on a
       scatter they did: the ladder's row and the block that row jumps to are
       different numbers there (diagram.ts § stepStops). */
    const stop = stops.find((s) => s.row === row);
    if (!stop) return;
    setRoving(stop.id);
    onJump(stop.blockId);
  };
  const canStep = (dir: -1 | 1) =>
    starts.length > 0 && stepTarget(starts, readerRow, dir) !== null;

  /* The pointer's position, mirrored into a ref so the follow-scroll below can
     read it without re-running every time the pointer leaves the picture. */
  const hovering = useRef(false);
```

### `stepTarget` — src/web/keynav.ts

```ts
export function stepTarget(starts: number[], currentRow: number, dir: -1 | 1): number | null {
  if (starts.length === 0) return null;
  const i = activeSectionIndex(starts, currentRow);
  if (dir === 1) return starts[i + 1] ?? null;
  if (currentRow > starts[i]!) return starts[i]!;
  return starts[i - 1] ?? null;
}
```

### Relevant constants

`POSITION_SETTLE_MS = 300`; `atParam` carries `limitUrlUpdates: debounce(POSITION_SETTLE_MS)`.
`jumpTo` overrides that with `throttle(0)` so a jump writes the URL immediately and pushes history.

## My diagnosis

Pressing ↓ on a scatter calls `onJump(stop.blockId)` → `jumpTo(paragraphBlockId)`:

1. `synced.current = paragraphBlockId`; `?at=` is written immediately; the page scrolls there.
2. `atRow` becomes that paragraph's row. The picture's mark and the `n / m` readout move. **This
   is the "something changes" the reporter sees.**
3. The scroll fires the spy. `measure()` computes `id = sections[activeSectionIndex(tops, …)].blockId`
   — the **first block of the enclosing section**, which on a scatter is almost never the
   paragraph we jumped to.
4. `id !== synced.current`, so the spy writes `?at=` back to the section's first block.
5. `atRow` snaps back to the section start. The mark and the readout revert. **This is the
   "reverts back to the active node it was on".**

And it compounds: `readerRow` is now the section start again, so the *next* ↓ press computes
`stepTarget` from the section start and lands on the same rung as before. The button then
genuinely does nothing on the second press, which is the "don't work very reliably".

It is scatter-shaped because on Force a rung's `blockId` usually *is* a section start, so step 3
computes the value the URL already holds and returns early. Note I said *usually*: Force draws
parts, sections and sub-sections, and `sectionDepth(geometry)` picks one depth — so I believe
Force can spring back too whenever a rung is a sub-section start at a depth below `sectionDepth`.
**Tell me whether that second claim is right.**

## My proposed fix

Make the scroll spy **decline to overwrite a finer position that is already inside the section it
would name**. Concretely, in `useReadingPosition`:

- Add a ref `heldSection: BlockId | null` beside `synced` — *which section the URL's current value
  sits inside*, as that section's own first-block id.
- `measure()` compares the computed section id against `heldSection.current` instead of against
  `synced.current`. If they match, it returns without writing: the reader is still inside the
  section `?at=` already names, and the finer value stands.
- `jumpTo(blockId)` sets `synced.current = blockId` **and** `heldSection.current =
  sectionContaining(blockId)`.
- The URL → page effect (back/forward, pasted link) sets both the same way.
- The "above the first section" branch clears both.

`sectionContaining(blockId)` needs a block → row lookup, which the hook does not currently have —
so `useReadingPosition` would take `blocks` (or a prebuilt `Map<BlockId, number>`) as a third
argument, and compute `sections[activeSectionIndex(sections.map(s => s.row), rowOf(blockId))].blockId`.

Consequences I believe are acceptable:

- While the reader scrolls **within** one section, `?at=` no longer gets rewritten to the section
  start. It keeps whatever finer block a jump last set. Everything that reads `?at=` asks a
  containment question ("is the reader inside this range"), so the answer is unchanged.
- A scatter dot the reader stepped to stays marked while they read that section, which is what the
  picture should say anyway.

## What I want from you

1. **Is the diagnosis right?** Is there a second, independent cause I have missed — anything in
   `stepTarget`, `stepStops`, the `setRoving` / `picked` / `shown` precedence in the panel, the
   nuqs debounce vs `throttle(0)` interaction, or React batching — that would also make these
   buttons unreliable? I especially want to know if the debounce can make the spy's write land
   *after* a second button press and clobber it even with my fix in place.
2. **Does my fix break the spy anywhere?** Specific worries: (a) a jump to a block whose section
   the reader then scrolls *out of* and back *into* — does `?at=` end up stale or wrong;
   (b) `sections` changing under the hook (`layoutKey`, a column toggle, granularity change) while
   `heldSection` holds an id that is no longer a section start; (c) the `scrollY <= stickyOffset()`
   top branch; (d) back/forward, where nuqs sets `at` and the effect has to recognise it.
3. **Is there a better design?** In particular: should `?at=` simply become block-granular, with
   the spy naming the block under the line rather than the section? What would that break? I
   rejected it as too invasive but I want that judged rather than assumed.
4. **What is the failing test?** I want to watch a test go red before I fix this. Tell me the
   smallest honest one — ideally a pure test over `useReadingPosition`'s decision rather than a
   jsdom scroll simulation, which I do not trust to reproduce a real scroll. If the decision has
   to be extracted into a pure function to be testable, say so and say what its signature is.

Answer concretely, with file/function names. Where you disagree, say what you would do instead.
