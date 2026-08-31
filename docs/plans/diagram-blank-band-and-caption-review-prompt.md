# Review: the Diagram band's permanent blank, and moving the scatter caption off its own line

You are reviewing **built code**, not a plan. Two changes landed together in
`src/web/DiagramPanel.tsx`. Weigh the first one heavily — it is a bug fix for something that was
live on production — and the second on its own terms.

Repo conventions worth knowing: comments in this codebase carry the reasoning, and a comment that
states something false about the code is treated as a defect in its own right. Docs live under
`docs/project/`. Tests are vitest; `tests/diagram-panel-hover.test.tsx` mounts the real component in
jsdom.

## 1. The bug: a blank band that reported success

**Symptom, on production.** Open `?mode=diagram&diagram=sketch`, then press Drift or Trail. The
picture area is an empty rectangle for ever. The strip above it says *"155 paragraphs, 17 too short
or not prose to place. This is a flattened view…"*, the step readout below says `—`, and the console
is clean. Reproduced by me in a real browser, twice, before and after the fix.

**Cause.** The panel lays its picture out against a measured box:

```tsx
const scroller = useRef<HTMLDivElement>(null);
useLayoutEffect(() => {
  const el = scroller.current;
  if (!el) return;
  … measure(); new ResizeObserver(…).observe(el)
}, []);
```

`Sketch` became a fourth chip earlier the same day and **replaces the whole subtree below the chip
row**, `.diag-scroll` included. So a panel whose *first* render is a Sketch measures a `null` ref,
returns early, and with `[]` deps never runs again. `box` stays `null`, which is the branch that
renders `<div class="diag-measuring">` — an empty div with `min-height: 100%`. All three pictures
are affected; Sketch itself is fine.

**Fix.** A callback ref, so the observer attaches to whichever element exists.

## 2. The change: the scatter's caveat moves into a card

Greg, 2026-08-30:

> It uses up valuable vertical real estate. Hide it behind a tooltip or warning icon or something.

It was a `<p class="diag-note" role="status">` above the picture — four lines of 10.5px prose in a
400px band. It is now an `Info` icon at the right-hand end of the `.diag-opts` control row (which is
drawn anyway, so the change costs **no** vertical space), carrying the same words in the panel's
existing `ControlTip` hover card, plus a `.sr-only` `role="status"` copy of the whole sentence so the
live announcement survives, plus the counts in the button's `aria-label`.

`kept()` was changed from returning one string to returning `{ what, how }` — the two paragraphs
`ControlTip` wants.

## What I want from you

Be adversarial. In particular:

1. **Is the callback ref actually correct?** Ordering of the `null` call vs. the replacement call
   across React versions, StrictMode double-invocation, the `rAF` handle now living in a ref shared
   between attachments, whether `observer.current?.disconnect()` can leak or double-disconnect,
   whether anything else still reads `scroller.current` and could now see a stale or null value
   (there is a follow-scroll effect keyed on `here` that does).
2. **Is there a second instance of the same class of bug in this file or nearby?** Any other `[]`-dep
   effect reading a ref, or any other state that persists across the Sketch/picture split and is now
   stale rather than absent — e.g. `box` keeping a Sketch-era measurement, `roving`, `hover`,
   `collapsed`.
3. **Did the caption move lose anything?** Specifically: is the `role="status"` still announced when
   it should be and only once; does anything now depend on `.diag-note` existing for a scatter; is
   `cursor: help` on a real `<button>` the right call, or should it not be a button at all; does
   `margin-left: auto` inside a `flex-wrap: wrap` row do something bad on Drift, which has two
   `Choice` groups that can wrap.
4. **Are the tests real?** Three new ones for the caption, one for the ref. I mutation-checked the
   live-region one (removed the `<p class="sr-only">`, watched it go red) and watched the ref test go
   red before the fix. Tell me which of the others could pass on broken code.
5. **Are any of the new comments false about the code they sit on?**

Answer with findings, most serious first, each with the file and what specifically is wrong. Say
plainly if a section is fine.

---

## The diff (src/web/DiagramPanel.tsx and tests/diagram-panel-hover.test.tsx)

```diff
diff --git a/src/web/DiagramPanel.tsx b/src/web/DiagramPanel.tsx
index 81d7f11..4a09933 100644
--- a/src/web/DiagramPanel.tsx
+++ b/src/web/DiagramPanel.tsx
@@ -53,11 +53,12 @@
  * hover card (docs/project/tooltips.md); the spine is 1.5rem wide and has nowhere
  * to put a strip.
  */
-import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
+import { useCallback, useEffect, useMemo, useRef, useState } from "react";
 import {
   ChartScatter,
   ChevronDown,
   ChevronUp,
+  Info,
   LoaderCircle,
   Network,
   PenLine,
@@ -402,7 +403,7 @@ export function DiagramPanel({ slug, root, kind, onKind, atRow, onJump, blocks,
   const [roving, setRoving] = useState<NodeId | null>(null);
   /** Whether focus is genuinely inside the picture, so the card can say so. */
   const [hasFocus, setHasFocus] = useState(false);
-  const scroller = useRef<HTMLDivElement>(null);
+  const scroller = useRef<HTMLDivElement | null>(null);
 
   /* **The picture is laid out against a measured box, not a computed one.**
      The band's width is decided by `fitMode` in layout.ts and could be threaded
@@ -415,8 +416,41 @@ export function DiagramPanel({ slug, root, kind, onKind, atRow, onJump, blocks,
      `null` until the first measure, which is one frame with an empty box —
      see the `diag-measuring` branch for why that is the cheaper mistake. */
   const [box, setBox] = useState<{ w: number; h: number } | null>(null);
-  useLayoutEffect(() => {
-    const el = scroller.current;
+  /**
+   * **A callback ref, because the element it measures is not always there.**
+   *
+   * This was a `useLayoutEffect` with `[]` deps reading `scroller.current`, and
+   * that is only correct while the scroller is in the *first* render. Sketch
+   * arrived on 2026-08-30 and replaces everything below the chips, this element
+   * included — so a panel whose first render was a Sketch measured a `null`
+   * ref, returned early, and with empty deps never ran again. Pressing Drift or
+   * Trail afterwards left `box` at `null` for good, which is the `diag-measuring`
+   * branch: an empty `<div>`, no spinner, no words, and a strip above it
+   * cheerfully reporting a projection that had landed. Reproduced on production
+   * the same day; `tests/diagram-panel-hover.test.tsx` § switching away from
+   * Sketch holds it.
+   *
+   * A callback ref fires **when the element mounts, whenever that turns out to
+   * be**, and again with `null` when it goes — so the observer is attached to
+   * the element that exists rather than to the one that existed at mount. The
+   * measure stays synchronous inside it for the reason below, and the whole
+   * teardown moves in here with it.
+   *
+   * `useCallback` with `[]` is load-bearing: a new function identity on every
+   * render would make React detach and reattach the ref each time, which is a
+   * disconnect and a fresh `ResizeObserver` per render.
+   */
+  const observer = useRef<ResizeObserver | null>(null);
+  const raf = useRef(0);
+  const attachScroller = useCallback((el: HTMLDivElement | null) => {
+    scroller.current = el;
+    /* The previous element's observer, if there is one. React calls this with
+       `null` before it calls it with a replacement, but not in every version
+       and not through every transition, so the release is unconditional. */
+    observer.current?.disconnect();
+    observer.current = null;
+    cancelAnimationFrame(raf.current);
+    raf.current = 0;
     if (!el) return;
 
     /**
@@ -453,24 +487,20 @@ export function DiagramPanel({ slug, root, kind, onKind, atRow, onJump, blocks,
        agent to expect. Measuring here also removes the one blank frame. */
     store(measure());
 
-    let raf = 0;
     const ro = new ResizeObserver(() => {
       /* The resize path keeps the frame, and needs to: ResizeObserver fires
          *during* layout, and setting state straight from it is how you get
          "loop completed with undelivered notifications". Same guard the spine
          uses. A resize implies a visible tab, so the background-tab problem
          above cannot reach this half. */
-      if (raf) return;
-      raf = requestAnimationFrame(() => {
-        raf = 0;
+      if (raf.current) return;
+      raf.current = requestAnimationFrame(() => {
+        raf.current = 0;
         store(measure());
       });
     });
     ro.observe(el);
-    return () => {
-      ro.disconnect();
-      cancelAnimationFrame(raf);
-    };
+    observer.current = ro;
   }, []);
 
   /**
@@ -1067,6 +1097,34 @@ export function DiagramPanel({ slug, root, kind, onKind, atRow, onJump, blocks,
               },
             ]}
           />
+          {/* **What the two scatters have to say, on the row that is already
+              there.** It was four lines of 10.5px prose above the picture, and
+              in a band 400px wide that is about fifty pixels of the reader's
+              vertical space spent on a caveat they have read once. Greg,
+              2026-08-30: *"It uses up valuable vertical real estate. Hide it
+              behind a tooltip or warning icon or something."*
+
+              So it moves into this row rather than getting a shorter version of
+              its own line: `margin-left: auto` puts it at the right-hand end of
+              a row that exists whether or not it is there, which is the only
+              arrangement that costs **no** height at all.
+
+              **The words themselves do not change**, and that is the part worth
+              guarding. Two components out of 1,024 throw away most of what the
+              model saw, so a scatter that does not say so is the silent-success
+              shape with a picture on it, and the number alone is worse than
+              useless to a reader who does not know what "variance" means. The
+              card says the thing a percentage cannot — *the projection can only
+              ever pull dots together, never push them apart* — and `ScatterNote`
+              keeps a `role="status"` copy for a screen reader, which is what
+              the strip was doing before and is the half a tooltip cannot do.
+
+              **Only when there is a picture to describe.** Waiting and failing
+              belong to `Waiting` inside the scroller, where the picture is
+              missing; a second voice up here would say it twice. */}
+          {drawingPoints && projection.status === "ready" && (
+            <ScatterNote projection={projection} />
+          )}
         </div>
       )}
 
@@ -1140,27 +1198,6 @@ export function DiagramPanel({ slug, root, kind, onKind, atRow, onJump, blocks,
           The error branch is not decoration either: without it a failed request
           would leave a picture that quietly draws four kinds where five were
           promised, and nothing on screen would be wrong. */}
-      {/* What the two scatters have to say out loud, and the reason it is not
-          in a tooltip. Two components out of 1,024 throw away most of what the
-          model saw, so a scatter plot that does not say so is the
-          silent-success shape with a picture on it — and the number alone is
-          worse than useless to a reader who does not know what "variance"
-          means. So it is one sentence in ordinary words, and it says the thing
-          a percentage cannot: **the projection can only ever pull dots
-          together, never push them apart.** GPT Sol's finding, 2026-08-27.
-
-          **Only when there is a picture to describe.** Waiting and failing used
-          to be reported here too, back when a fallback picture was drawn
-          underneath and something had to explain it. There is no fallback any
-          more, so those two states belong to `Waiting` inside the scroller —
-          where the picture is missing — and a strip that also announced them
-          would say the same thing twice in two places. */}
-      {drawingPoints && projection.status === "ready" && (
-        <p className="diag-note" role="status">
-          {kept(projection)}
-        </p>
-      )}
-
       {kind === "force" && similar.status !== "idle" && (
         <p className="diag-note" role="status">
           {/* **The spinner, in the strip rather than over the picture.** Greg,
@@ -1212,7 +1249,7 @@ export function DiagramPanel({ slug, root, kind, onKind, atRow, onJump, blocks,
         </p>
       )}
 
-      <div className="diag-scroll" ref={scroller}>
+      <div className="diag-scroll" ref={attachScroller}>
         {root === null ? (
           <p className="diag-quiet">
             This article has no usable tree, so there is nothing to draw. Run <code>npm run toc</code>{" "}
@@ -1757,16 +1794,19 @@ function Choice<T extends string>({
  * span does not, so quoting them separately would be quoting the least stable
  * half of the answer. GPT Sol's finding, 2026-08-27.
  */
-function kept(p: UseProjection): string {
+function kept(p: UseProjection): { what: string; how: string } {
   /* **A picture too thin to describe.** The *empty* case no longer reaches
      here — no dots means no picture, and `Waiting` says so where the picture is
      missing. What is left is the article that placed exactly **one** paragraph:
-     there is a dot, so this strip renders, and the general wording below would
-     report what percentage of the differences a flat view keeps of a view with
-     nothing to be different from. GPT Sol's finding, 2026-08-27, and the reason
-     the threshold is 2 rather than 1. */
+     there is a dot, so this renders, and the general wording below would report
+     what percentage of the differences a flat view keeps of a view with nothing
+     to be different from. GPT Sol's finding, 2026-08-27, and the reason the
+     threshold is 2 rather than 1. */
   if (p.blocks < 2) {
-    return "Not enough prose here to place — a paragraph needs a dozen words before the model can say what it is about.";
+    return {
+      what: "Not enough prose here to place — a paragraph needs a dozen words before the model can say what it is about.",
+      how: "There is a dot, and one dot has nothing to be far from, so nothing here says how far apart two paragraphs are.",
+    };
   }
   const held = Math.round((p.variance[0] + p.variance[1]) * 100);
   const short = p.skipped.tooShort + p.skipped.nonProse;
@@ -1777,8 +1817,70 @@ function kept(p: UseProjection): string {
      together with a dash and a "so", which made the asymmetry — the only real
      content here — the tail of a sentence about a percentage. Fable's rewrite,
      2026-08-27, and it is better: how many dots, how flat the view is, and then
-     the two halves of what flatness costs, each given its own full stop. */
-  return `${p.blocks} paragraphs${missing}${capped}. This is a flattened view — it keeps about ${held}% of the differences the model saw. Far-apart dots really do differ. Close-together dots may not: their differences may be in what the flattening dropped.${by}`;
+     the two halves of what flatness costs, each given its own full stop.
+
+     **The split into two is where the card's two paragraphs come from**, and it
+     is the split `ControlTip` already asks for everywhere else in this panel:
+     what it is, then the thing a reader could not have worked out by looking.
+     How many dots there are is the first; what a flat view costs is the second,
+     and it is the whole reason any of this is on screen. */
+  return {
+    what: `${p.blocks} paragraphs${missing}${capped}.`,
+    how: `This is a flattened view — it keeps about ${held}% of the differences the model saw. Far-apart dots really do differ. Close-together dots may not: their differences may be in what the flattening dropped.${by}`,
+  };
+}
+
+/**
+ * **The picture's own caveat, as an icon on the controls row.**
+ *
+ * It was four lines of prose above the picture until 2026-08-30. Greg:
+ *
+ * > It uses up valuable vertical real estate. Hide it behind a tooltip or
+ * > warning icon or something.
+ *
+ * Two things it keeps, because a hover card on its own would drop both.
+ *
+ * **A `role="status"`, still.** The strip announced itself when the projection
+ * landed, and that announcement is the only way a reader who cannot see the
+ * picture learns that a fifth of the article is not in it. A tooltip is reached
+ * by pointing or by Tab, so it announces nothing. The sentence is therefore
+ * still in the DOM and still live — it is only invisible, which is what
+ * `.sr-only` is for.
+ *
+ * **And the counts are in the button's name**, not just in the card. "Info" or
+ * "About this picture" would make the one hard number — how many paragraphs are
+ * missing — reachable only by opening something, and a control whose label is a
+ * noun is a control a screen reader cannot skim.
+ *
+ * `Info` rather than a warning triangle: paragraphs going unplaced is the
+ * ordinary case (headings and one-line list items are not embedded — see
+ * src/article-vectors.ts), and an alarm on the ordinary case is an alarm nobody
+ * reads by the second article.
+ */
+function ScatterNote({ projection }: { projection: UseProjection }) {
+  const { what, how } = kept(projection);
+  return (
+    <>
+      <Tooltip
+        placement="bottom"
+        /* Same finding as the chips beside it: the card is far wider than this
+           icon and the icon sits at the right-hand end of a 400px band, so
+           without this the card is thrown sideways onto the controls the reader
+           just came from. Tooltip.tsx § keepSide. */
+        keepSide
+        className="tip-soon"
+        content={<ControlTip head="What is drawn" what={what} how={how} />}
+      >
+        <button type="button" className="diag-about" aria-label={`About this picture: ${what}`}>
+          <Info size={13} aria-hidden="true" />
+        </button>
+      </Tooltip>
+      {/* The whole sentence, spoken once when the projection lands — the job the
+          visible strip used to do. Not `aria-label` on the button above: that is
+          heard on focus, and this has to be heard on arrival. */}
+      <p className="sr-only" role="status">{`${what} ${how}`}</p>
+    </>
+  );
 }
 
 /**
diff --git a/tests/diagram-panel-hover.test.tsx b/tests/diagram-panel-hover.test.tsx
index 94a7855..864a808 100644
--- a/tests/diagram-panel-hover.test.tsx
+++ b/tests/diagram-panel-hover.test.tsx
@@ -816,3 +816,115 @@ describe("the controls explain themselves", () => {
     }
   });
 });
+
+/**
+ * **The measure has to happen whenever the scroller mounts, not once.**
+ *
+ * `Sketch` replaces everything below the chips, `.diag-scroll` included
+ * (DiagramPanel.tsx § Sketch replaces everything below the chips). So a panel
+ * whose first render is a Sketch runs its measuring layout effect against a
+ * `ref` that is still `null`, returns early — and with `[]` deps never runs
+ * again. Press Drift or Trail afterwards and `box` is still `null`, which is
+ * the branch that renders `.diag-measuring`: an empty `<div>` with
+ * `min-height: 100%`, no spinner, no words, nothing in the console. The step
+ * readout says "—" because there is no layout to count, and the strip above
+ * still reports a projection that landed perfectly well.
+ *
+ * Reproduced on production on 2026-08-30 — open `?diagram=sketch`, press Trail,
+ * wait — and the fix is a **callback ref**: it fires when the element mounts,
+ * whenever that turns out to be.
+ */
+describe("switching away from Sketch", () => {
+  it("measures the scroller that arrives after the first render", () => {
+    mount("sketch");
+    expect(host.querySelector(".diag-scroll"), "Sketch drew a scroller").toBeNull();
+    mount("force");
+    /* The tell, and it is the *absence* of a picture rather than any message:
+       `.diag-measuring` is the one branch of this panel that says nothing at
+       all, so a reader gets a blank band and no reason for it. */
+    expect(
+      host.querySelector(".diag-measuring"),
+      "the panel is still waiting for a width it will never measure",
+    ).toBeNull();
+    expect(host.querySelector("svg.diag-svg"), "no picture after leaving Sketch").not.toBeNull();
+  });
+});
+
+/**
+ * **The scatter's caveat, after it stopped being four lines above the picture.**
+ *
+ * Greg, 2026-08-30: *"It uses up valuable vertical real estate. Hide it behind a
+ * tooltip or warning icon or something."* So it is an icon at the end of a
+ * control row that was already drawn, and the words are in its card.
+ *
+ * The risk in a change like that is not that the icon fails to appear. It is
+ * that **the sentence stops being said at all** to a reader who cannot see the
+ * picture: a hover card is reached by pointing or by Tab, so it announces
+ * nothing when the projection lands, and the strip it replaced was a live
+ * region. That is the silent half, and it is the half these pin.
+ */
+describe("what a scatter says about itself", () => {
+  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
+
+  /** Two placed paragraphs and three that were not — enough to have a caveat. */
+  const PLACED = {
+    model: "voyageai/voyage-4",
+    blocks: 2,
+    k: 1,
+    variance: [0.1, 0.06],
+    skipped: { tooShort: 2, nonProse: 1, capped: 0 },
+    points: [
+      { id: "spya-b0", x: -0.2, y: 0.1, c: 0 },
+      { id: "spya-b2", x: 0.3, y: -0.1, c: 0 },
+    ],
+  };
+
+  const placedProjection = () =>
+    vi.stubGlobal("fetch", async (url: RequestInfo | URL) =>
+      String(url).includes("/api/projection/")
+        ? new Response(JSON.stringify(PLACED), { status: 200 })
+        : new Response(JSON.stringify({ model: "m", blocks: 2, eligible: 2, omitted: 0, pairs: [] }), { status: 200 }),
+    );
+
+  it("costs no line of its own", async () => {
+    placedProjection();
+    mount("drift");
+    await settle();
+    /* `.diag-note` is the strip — one line of 10.5px prose per line of it. Force
+       still grows one while it buys the dotted lines; a scatter must not, which
+       is the whole of the change. Asserted as an absence because the height it
+       used to take is exactly what a regression would hand back. */
+    expect(host.querySelector(".diag-note"), "the scatter grew a strip again").toBeNull();
+    expect(host.querySelector(".diag-about"), "nothing says where the picture came from").not.toBeNull();
+  });
+
+  it("still says it out loud when the picture lands", async () => {
+    placedProjection();
+    mount("drift");
+    await settle();
+    /* One live region, and it carries the whole sentence — the counts *and* the
+       thing a percentage cannot say. A card that only opens on hover would
+       leave a reader who cannot see the picture with no way to learn that three
+       paragraphs are not in it. */
+    const live = [...host.querySelectorAll('[role="status"]')];
+    expect(live).toHaveLength(1);
+    const said = live[0]?.textContent ?? "";
+    expect(said, "the counts are gone").toContain("2 paragraphs");
+    expect(said, "the paragraphs that were left out are gone").toContain("3 too short");
+    expect(said, "the asymmetry — the only real content — is gone").toContain("Close-together dots");
+    expect(live[0]?.className, "the sentence is visible again, taking the space it used to").toBe("sr-only");
+  });
+
+  it("names the counts on the control itself, not only inside the card", async () => {
+    /* "Info" is a noun, and a control whose whole accessible name is a noun is
+       one a screen reader cannot skim. The one hard number here — how much of
+       the article is not drawn — must not be reachable only by opening
+       something. */
+    placedProjection();
+    mount("drift");
+    await settle();
+    const name = host.querySelector(".diag-about")?.getAttribute("aria-label") ?? "";
+    expect(name).toContain("2 paragraphs");
+    expect(name).toContain("3 too short");
+  });
+});
```

## The one CSS hunk that is mine

The rest of `src/web/styles.css`'s working-tree diff belongs to another agent working in the same
tree; ignore it. This is the whole of my change, in context:

```css
  gap: 0.3rem 0.7rem;
  padding: 0.3rem 0.7rem;
  border-bottom: 1px solid var(--rule);
}
.diag-opt { display: inline-flex; align-items: center; gap: 0.25rem; }
/* **The scatter's caveat, parked at the end of a row that already exists.**
   `margin-left: auto` is the whole point of putting it here: the row is drawn
   whether or not this icon is on it, so the counts and the flattening warning
   cost the reader **no** vertical space at all — where the strip they replaced
   ran to four lines of 10.5px prose in a 400px band. See DiagramPanel.tsx
   § ScatterNote, and note that the sentence itself is still in the DOM as an
   `.sr-only` live region: this is a change to where it is *shown*, not to
   whether it is said.

   `cursor: help` rather than `pointer`, because pressing it does nothing —
   the card is the whole of it. Sized to the row rather than to a thumb: it is
   chrome beside three chips, and what this panel offers a finger is the step
   bar. */
.diag-about {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  padding: 0.1rem 0.15rem;
  border: 0;
  background: none;
  color: var(--ink-faintest, var(--ink-faint));
  cursor: help;
}
.diag-about:hover, .diag-about:focus-visible { color: var(--ink-soft); }
.diag-opt-set { display: inline-flex; align-items: center; gap: 0.15rem; }
```

## Evidence

- `npm test` — full suite, exit 0, after the change.
- `npx tsc --noEmit -p tsconfig.json` — clean.
- Production repro, before the fix, via the extension:
  `document.querySelector('.diag-scroll').innerHTML` → `<div class="diag-measuring" aria-hidden="true"></div>`,
  `.diag-step-at` → `—`, `.diag-note` → the full "155 paragraphs…" sentence. Scroller was 399×225, so
  the element had a real width; only the measurement never happened.
- The same page loaded directly on `?diagram=trail` draws 155 dots and 152 chain links, which is what
  made the bug look like it was about the picture rather than about the mount order.

## The postmortem

`docs/postmortems/the-scroller-that-mounted-after-the-measure.md` is written. Tell me if its account
of the cause is wrong or if the "what would have caught the class" section is weaker than it should
be.
