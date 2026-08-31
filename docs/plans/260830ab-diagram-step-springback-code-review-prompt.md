# Second review: the built fix for the `?at=` springback

You reviewed the plan for this earlier today and found two things the first design got wrong: the
smooth-jump fly-through, and caching the derived section as state. This is the code built from your
answer. **Weight this review higher than the plan-stage one** — a plan review cannot see a guard
that is in the wrong order or a dependency array that makes an effect re-run at the wrong moment.

Your earlier verdict, for reference, is in `docs/plans/260830z-diagram-step-springback-review-sol.md`, and
the original prompt in `docs/plans/260830ac-diagram-step-springback-review-prompt.md`.

## What I built

Your design, as far as I understood it:

- `positionToWrite` in `src/web/position.ts` — pure, takes everything the spy knows, returns
  `{ at }` to write or `null` to leave the address alone.
- `jumpInFlight` is a parameter rather than a `glideTarget()` call in the caller, so the guard has
  a test. It is checked before the top-of-the-article branch, as you said.
- The section containing the held value is derived on every measurement by `sectionContaining`,
  not remembered.
- `synced` is back to a single `BlockId | null`, exactly as it was before my first attempt.
- `DiagramBand` now takes `at` as a prop instead of reading `location.search`.

I also proved each of the three clauses is load-bearing by deleting it and watching a test go red:
removing the section comparison reddens 4 tests, removing the glide guard reddens 3, and moving the
glide guard after the top branch reddens 1.

## The diff

```diff
diff --git a/src/web/App.tsx b/src/web/App.tsx
index ef0d42a..80367c5 100644
--- a/src/web/App.tsx
+++ b/src/web/App.tsx
@@ -115,6 +115,7 @@ import {
 } from "./params.js";
 import {
   arrivalTarget,
+  glideTarget,
   isBlockOnScreen,
   scrollToBlock,
   stickyOffset,
@@ -122,8 +123,8 @@ import {
 } from "./scroll.js";
 import { orderComments, positionOf, stepComment } from "./comment-nav.js";
 import {
-  activeSectionIndex,
   buildSections,
+  positionToWrite,
   sectionDepth,
   type Section,
 } from "./position.js";
@@ -922,9 +923,14 @@ function useWindowWidth(): number {
  * a section rather than an offset — is in position.ts. Written by
  * spideryarn2-cd, 2026-08-25.
  */
-function useReadingPosition(sections: Section[], layoutKey: string) {
+function useReadingPosition(sections: Section[], blocks: Block[], layoutKey: string) {
   const [at, setAt] = useQueryState("at", atParam);
   const synced = useRef<BlockId | null>(null);
+  /* The article's block → row index. The spy needs it to ask which section the
+     address's current value lies in, which is no longer the same question as
+     what the value *is*: a jump may have put a paragraph there. One pass over
+     an array the caller already holds. */
+  const rowOf = useMemo(() => new Map(blocks.map((b, i) => [b.id, i])), [blocks]);
 
   // URL → page: first load, back/forward, pasted link.
   useEffect(() => {
@@ -942,21 +948,23 @@ function useReadingPosition(sections: Section[], layoutKey: string) {
     let frame = 0;
     const measure = () => {
       frame = 0;
-      // Above the first section there is no section to name, and saying so keeps
-      // ?at= out of the URL until the reader has actually moved.
-      if (window.scrollY <= stickyOffset()) {
-        if (synced.current === null) return;
-        synced.current = null;
-        void setAt(null);
-        return;
-      }
-      const tops = rows.map((el) =>
-        el ? el.getBoundingClientRect().top : Number.POSITIVE_INFINITY,
-      );
-      const id = sections[activeSectionIndex(tops, stickyOffset() + 1)]?.blockId ?? null;
-      if (id === null || id === synced.current) return;
-      synced.current = id;
-      void setAt(id);
+      /* Every rule this makes is in position.ts, and it is pure so that the one
+         that matters can be watched failing — an untested guard against a race
+         is the shape silent-success.md is about. */
+      const next = positionToWrite({
+        sections,
+        rowOf,
+        tops: rows.map((el) =>
+          el ? el.getBoundingClientRect().top : Number.POSITIVE_INFINITY,
+        ),
+        line: stickyOffset() + 1,
+        jumpInFlight: glideTarget() !== null,
+        atTop: window.scrollY <= stickyOffset(),
+        held: synced.current,
+      });
+      if (next === null) return;
+      synced.current = next.at;
+      void setAt(next.at);
     };
     const onScroll = () => {
       if (!frame) frame = requestAnimationFrame(measure);
@@ -967,7 +975,7 @@ function useReadingPosition(sections: Section[], layoutKey: string) {
       window.removeEventListener("scroll", onScroll);
       if (frame) cancelAnimationFrame(frame);
     };
-  }, [sections, setAt, layoutKey]);
+  }, [sections, rowOf, setAt, layoutKey]);
 
   /* The controls bar gets out of the way while you read forwards, on a viewport
      short enough for 44px to matter — scroll.ts § watchBarVisibility, and
@@ -1236,7 +1244,7 @@ function Reader({
   // sideways: the rail's width is taken out of the prose column's, so hiding it
   // rewraps every paragraph in the article and every row changes height.
   const layoutKey = `${fit.columns.join(",")}|${proseOn}|${windowWidth}|${fit.modeW}|${fit.spine}`;
-  const { at, jumpTo } = useReadingPosition(sections, layoutKey);
+  const { at, jumpTo } = useReadingPosition(sections, article.blocks, layoutKey);
 
   /**
    * Where the reader is, for the outline band — the same sampler the gist
@@ -2281,7 +2289,7 @@ function Reader({
         <VisitorSummaryBand article={article} summaries={artefacts.summary} onJump={jumpTo} />
       )}
       {owner && mode === "diagram" && (
-        <DiagramBand slug={slug} article={article} onJump={jumpTo} />
+        <DiagramBand slug={slug} article={article} at={at} onJump={jumpTo} />
       )}
       {owner && mode === "ideas" && (
         <IdeasBand
@@ -3483,10 +3491,24 @@ function useSummaryMode(article: Article, summaries: { entries: SummaryEntry[] }
 function DiagramBand({
   slug,
   article,
+  at,
   onJump,
 }: {
   slug: string;
   article: Article;
+  /**
+   * Where the reader is, **from `useReadingPosition`'s own state rather than
+   * from `location.search`.**
+   *
+   * The other bands read the address at render time, and that is fine for them.
+   * It is not fine here, because this panel has buttons that *move* the reader
+   * and then compute their next move from where they think the reader is.
+   * `jumpTo` writes the URL with `throttle(0)`, which lands on the next task —
+   * so a render triggered by the state change can still see the old
+   * `location.search`, and a second press inside that window steps from the
+   * stale row and lands on the rung it has just used. GPT Sol, 2026-08-30.
+   */
+  at: BlockId | null;
   onJump(id: BlockId): void;
 }) {
   useRenderCount("DiagramBand");
@@ -3508,12 +3530,9 @@ function DiagramBand({
     [article.tree, article.blocks],
   );
 
-  /* Read, never written — `?at=` is tracked by useReadingPosition in the
-     parent, so this re-renders when it changes. Same read-at-render trick
-     SummaryBand uses, and turned into a row index for the same reason: the
-     question is "which node contains the reader", and containment is a
-     comparison of row indices. Block ids carry no order. */
-  const at = new URLSearchParams(location.search).get("at");
+  /* Turned into a row index because the question is "which node contains the
+     reader", and containment is a comparison of row indices. Block ids carry no
+     order. */
   const atRow = useMemo(() => {
     if (at === null) return null;
     const i = article.blocks.findIndex((b) => b.id === at);
diff --git a/src/web/position.ts b/src/web/position.ts
index bbc5cea..6fd59ee 100644
--- a/src/web/position.ts
+++ b/src/web/position.ts
@@ -107,3 +107,84 @@ export function activeSectionIndex(tops: number[], line: number): number {
   }
   return active;
 }
+
+/**
+ * **The section a block sits inside** — that section's own first block, which
+ * is the id the address uses for it.
+ *
+ * `rowOf` is the article's block → row index. A block it does not know is not a
+ * position we can place, and the answer is `null` rather than a guess: an id
+ * the article no longer has must not pin the reader's position forever.
+ */
+export function sectionContaining(
+  sections: Section[],
+  rowOf: ReadonlyMap<BlockId, number>,
+  blockId: BlockId | null,
+): BlockId | null {
+  if (blockId === null) return null;
+  const row = rowOf.get(blockId);
+  if (row === undefined) return null;
+  return sections[activeSectionIndex(sections.map((s) => s.row), row)]?.blockId ?? null;
+}
+
+/**
+ * **What the scroll spy should write into `?at=`, or `null` for "leave the
+ * address alone".**
+ *
+ * An object means write `at` — where `at: null` is the top of the article, and
+ * is why this cannot simply return the id: `null` has to mean two different
+ * things and only one of them is a value.
+ *
+ * Three rules, and the middle one is the fix for a reported bug.
+ *
+ * **A jump of ours in flight writes nothing at all.** `glide` (scroll.ts)
+ * animates by calling `window.scrollTo` on every frame, so a long jump fires
+ * exactly the scroll events a reader's own hand would. Without this the spy
+ * names every section the page flies *over* on the way, and lands holding the
+ * destination's section rather than the block the jump was aimed at. This is
+ * not the "was that scroll mine or theirs?" guess the rest of this app refuses
+ * to make: `glideTarget()` is the animation's own handle, and the reader taking
+ * over with a wheel or a finger clears it (scroll.ts § cancel). It comes
+ * **before** the top-of-the-article branch, because a jump that passes near the
+ * top would otherwise clear the address on its way past. GPT Sol, 2026-08-30.
+ *
+ * **A reader still inside the section the address already names has not gone
+ * anywhere the address needs to say**, so a finer value stands. That is the
+ * whole of the springback fix: `?at=` is a section, but a jump is allowed to
+ * put a *paragraph* there — the diagram panel's ↑ / ↓ buttons do, because on
+ * Trail and Drift a rung is one paragraph (diagram.ts § stepStops). Comparing
+ * the measured section against the *held value* rather than against the section
+ * the held value is *in* found them different, wrote the section's first block
+ * over the paragraph a fifth of a second after the button had set it, and left
+ * the next press computing from the top of the section again — so it moved
+ * nothing. tests/reading-position.test.ts § two presses.
+ *
+ * **The section is derived here, every time, rather than remembered.** A
+ * remembered one goes stale the moment `sections` changes under it — a column
+ * toggle, a granularity change, a re-extraction — and a stale section is a spy
+ * that has quietly stopped writing. Also GPT Sol, same review.
+ */
+export function positionToWrite(opts: {
+  sections: Section[];
+  rowOf: ReadonlyMap<BlockId, number>;
+  /** Each section's distance from the top of the viewport, in document order. */
+  tops: number[];
+  /** The line we measure against — under the sticky bars. */
+  line: number;
+  /** Whether a jump we started is still animating. `glideTarget() !== null`. */
+  jumpInFlight: boolean;
+  /** Whether the reader is above the first section, where nothing is named. */
+  atTop: boolean;
+  /** What `?at=` says now. */
+  held: BlockId | null;
+}): { at: BlockId | null } | null {
+  const { sections, rowOf, tops, line, jumpInFlight, atTop, held } = opts;
+  if (jumpInFlight) return null;
+  // Above the first section there is no section to name, and saying so keeps
+  // ?at= out of the URL until the reader has actually moved.
+  if (atTop) return held === null ? null : { at: null };
+  const visible = sections[activeSectionIndex(tops, line)]?.blockId ?? null;
+  if (visible === null) return null;
+  if (visible === sectionContaining(sections, rowOf, held)) return null;
+  return { at: visible };
+}
```

## The test

```ts
/**
 * **The reading position the scroll spy is not allowed to overwrite.**
 *
 * Greg, 2026-08-30:
 *
 * > Try and fix/improve the Diagram up/down buttons (e.g. for Trail) — they
 * > don't seem to work very reliably. I press them, something changes, and then
 * > sometimes it seems to revert back to the active node it was on.
 *
 * `?at=` is a *section* (position.ts, the top of the file), and the spy that
 * writes it names the section under the sticky line. The diagram panel's ↑ / ↓
 * buttons are not sections: on Trail and Drift a rung is one paragraph
 * (diagram.ts § stepStops), so a press jumps to a block in the middle of a
 * section. The spy then saw a paragraph in the address, computed the enclosing
 * section, found the two different, and wrote the section's first block back
 * over it — a fifth of a second after the button had moved the mark.
 *
 * The flicker is the half you can see. The half you can measure is worse: the
 * address is now back at the top of the section, so the *next* press computes
 * its target from there and lands on the rung it has already used. The button
 * stops moving anything, which is what "don't work very reliably" is, and
 * § two presses is the test that says so.
 *
 * ## The second bug is the one a fix invents
 *
 * Suppressing the write while the reader is inside the section the address
 * names is not enough on its own, and GPT Sol found the hole before it shipped
 * (2026-08-30): `glide` (scroll.ts) animates a jump by calling `window.scrollTo`
 * on every frame, so a jump across several sections fires exactly the scroll
 * events a hand would. The spy names each section flown *over*, and the last of
 * those writes replaces the block the jump was aimed at. § a jump in flight is
 * that case, and it is the reason `positionToWrite` takes `jumpInFlight` rather
 * than the caller checking `glideTarget()` where no test could reach it.
 */
import { describe, expect, it } from "vitest";

import type { BlockId } from "../src/types.js";
import { stepTarget } from "../src/web/keynav.js";
import { positionToWrite, sectionContaining, type Section } from "../src/web/position.js";

/* Thirty blocks, ids in the real shape because these are the values that go in
   the URL (docs/project/block-ids.md). */
const block = (row: number) => `spya-blk${String(row).padStart(3, "0")}` as BlockId;

/** Every block of the article, so a paragraph id can be placed. */
const ROW_OF = new Map<BlockId, number>(Array.from({ length: 30 }, (_, i) => [block(i), i]));

/* Three sections over those thirty blocks. **A section's id is one of the
   article's own blocks** — its first — which is the fact the whole mechanism
   rests on, so the fixture is built that way rather than out of invented ids. */
const SECTION_ROWS = [0, 10, 25];
const SECTIONS: Section[] = SECTION_ROWS.map((row, i) => ({
  row,
  blockId: block(row),
  nodeId: `n000${i}`,
  title: `Section ${i + 1}`,
}));
const [, MIDDLE, LAST] = SECTIONS.map((s) => s.blockId) as [BlockId, BlockId, BlockId];

/**
 * Section tops as the spy measures them, for a reader standing in `row`.
 *
 * One notional pixel per row with the line at zero: a section already passed
 * sits at a negative offset. The comparison `top > line` is the one the real
 * arithmetic does, over a simpler ruler.
 */
function topsFor(row: number): number[] {
  return SECTION_ROWS.map((start) => start - row);
}
const LINE = 0;

/** The spy's decision, with everything quiet unless a case says otherwise. */
function spy(row: number, held: BlockId | null, over: Partial<Parameters<typeof positionToWrite>[0]> = {}) {
  return positionToWrite({
    sections: SECTIONS,
    rowOf: ROW_OF,
    tops: topsFor(row),
    line: LINE,
    jumpInFlight: false,
    atTop: false,
    held,
    ...over,
  });
}

describe("which section a position lies in", () => {
  it("places a paragraph on the section it is inside", () => {
    expect(sectionContaining(SECTIONS, ROW_OF, block(14))).toBe(MIDDLE);
  });

  it("places a section's own first block on itself", () => {
    expect(sectionContaining(SECTIONS, ROW_OF, MIDDLE)).toBe(MIDDLE);
  });

  it("refuses to place an id the article does not have", () => {
    expect(sectionContaining(SECTIONS, ROW_OF, "spya-gone11" as BlockId)).toBeNull();
  });

  it("has nowhere to put the top of the article", () => {
    expect(sectionContaining(SECTIONS, ROW_OF, null)).toBeNull();
  });
});

describe("what the scroll spy writes", () => {
  it("names the section on the first measurement, when the address says nothing", () => {
    expect(spy(14, null)).toEqual({ at: MIDDLE });
  });

  it("leaves a paragraph the reader was sent to alone while they are still in its section", () => {
    expect(spy(14, block(14))).toBeNull();
  });

  it("still leaves it alone as they read on through that section", () => {
    for (const row of [10, 12, 18, 24]) expect(spy(row, block(14))).toBeNull();
  });

  it("replaces it when they cross into another section", () => {
    expect(spy(26, block(14))).toEqual({ at: LAST });
  });

  it("clears the address above the first section, and only once", () => {
    expect(spy(0, block(14), { atTop: true })).toEqual({ at: null });
    expect(spy(0, null, { atTop: true })).toBeNull();
  });

  it("writes nothing at all while an unplaceable id stands", () => {
    /* A re-extraction can leave an id in a pasted link that the article no
       longer has. It is not a position, so the next section the reader reaches
       replaces it rather than the spy going quiet forever. */
    expect(spy(14, "spya-gone11" as BlockId)).toEqual({ at: MIDDLE });
  });
});

describe("a jump in flight", () => {
  /* The reader is in section 1 and presses a dot in section 3. `glide` takes
     about 200ms to get there and fires a scroll event every frame on the way. */
  const AIMED_AT = block(27);

  it("writes nothing while the page is still flying over section 1", () => {
    expect(spy(2, AIMED_AT, { jumpInFlight: true })).toBeNull();
  });

  it("writes nothing while it passes section 2 either", () => {
    expect(spy(14, AIMED_AT, { jumpInFlight: true })).toBeNull();
  });

  it("does not clear the address when the jump starts from the very top", () => {
    /* The guard is before the top branch on purpose: a jump that begins at the
       top of the article would otherwise have its own target wiped by the first
       frame of its own animation. */
    expect(spy(0, AIMED_AT, { jumpInFlight: true, atTop: true })).toBeNull();
  });

  it("leaves the aimed-at paragraph standing once it lands", () => {
    expect(spy(27, AIMED_AT)).toBeNull();
  });

  it("and the reader's own scroll out of that section still writes", () => {
    expect(spy(14, AIMED_AT)).toEqual({ at: MIDDLE });
  });
});

describe("two presses of the diagram's ↓ button move twice", () => {
  /* Trail's ladder: one rung per paragraph, which is what makes this visible
     there and not on a picture whose rungs are sections. */
  const RUNGS = Array.from({ length: 30 }, (_, i) => i);

  /** One press: step from where the address says we are, then let the spy run. */
  function press(held: BlockId): BlockId {
    const target = stepTarget(RUNGS, ROW_OF.get(held) ?? 0, 1);
    if (target === null) return held;
    /* The jump puts its own block in the address, then the scroll it caused is
       measured — from the destination, because one rung never leaves the
       section it started in by more than one. */
    const next = spy(target, block(target));
    return next === null ? block(target) : (next.at ?? block(target));
  }

  it("does not spring back to the top of the section between presses", () => {
    let held = block(14);
    const landed: number[] = [];
    for (let i = 0; i < 4; i++) {
      held = press(held);
      landed.push(ROW_OF.get(held)!);
    }
    expect(landed).toEqual([15, 16, 17, 18]);
  });
});
```

## What I want from you

1. **Is the guard order right, and is the guard in the right place at all?** `glideTarget()` is
   read in `measure()`, which runs on a `requestAnimationFrame` scheduled by a scroll event. Is
   there a window where the glide has finished (so `glideTarget()` is null) but a scroll event it
   caused is still queued, so the spy measures a mid-flight position and writes it? `glide` calls
   `cancel()` on its last frame, and `cancel()` sets `aiming = null`. Walk that timing.
2. **The dependency array.** The spy effect gained `rowOf`. `rowOf` is `useMemo` on `blocks`, and
   `blocks` is `article.blocks`. Does that re-run the effect more than it used to, and does
   re-running it lose anything — the effect re-queries every section's `tr` element and calls
   `measure()` once on mount. Is that immediate `measure()` now able to do something wrong that it
   could not do before, given `synced.current` may hold a paragraph?
3. **`sectionContaining` allocates `sections.map(s => s.row)` on every animation frame.** The
   caller already allocates a `tops` array of the same length per frame, so I judged this not worth
   avoiding, and I preferred one copy of the `activeSectionIndex` rule over two. Do you agree, or is
   this the hook that performance.md already names as the Reader's largest render source and
   therefore worth the awkwardness?
4. **What did I get wrong that the tests do not cover?** Specifically: back/forward through history;
   `?note=` arrival (`arrivalTarget` in scroll.ts scrolls the page without going through `jumpTo`,
   so nothing sets `synced`); the `layoutKey` reflow path, which now calls `measure()` with a
   paragraph held and will decline to correct `?at=` where it used to; and `reducedMotion()`, where
   `scrollToBlock` takes the instant path and no glide exists at all.
5. **Is anything in the doc changes wrong?** I edited `docs/project/url-state.md`
   (§ The unit is a section, not a position) and `docs/project/diagram.md` (§ And then they sprang
   back). Read them in the working tree. I have written down your correction about Force — that it
   is capped at depth 2 while the spy uses `leafDepth - 1`, so it coincides on a normal three-deep
   tree and springs back on a shallow depth-2 one. Check I have not garbled it.

Concrete answers, file and line. Where you disagree, say what you would write instead.
