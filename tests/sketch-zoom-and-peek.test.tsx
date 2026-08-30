// @vitest-environment jsdom
/**
 * **Saying that a part opens, and getting into it** —
 * docs/plans/sketch-zoomable-subsections.md, src/web/SketchView.tsx.
 *
 * The overview's regions have opened their zoom scenes since
 * `inferRegionOpens` landed, and nothing on the picture said so: a dotted
 * underline on text drawn at five pixels, and half a pixel of extra stroke on a
 * node. This file is about the three things that replaced it — the mark, the
 * peek and the zoom — and about the one of them that can break the other two.
 *
 * **The animation is decoration and the navigation is not.** `goTo` swaps the
 * scene synchronously and only then arranges an entrance, precisely so that a
 * missing `Element.animate`, an unmounted element or a `finished` promise that
 * never settles cannot swallow the press. jsdom has no `Element.animate` at
 * all, so most of this file is already running the fallback — and the test that
 * matters most installs one that never finishes, which is the shape of the
 * failure a real browser would produce.
 * docs/reusable/silent-success.md.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CANVAS_W } from "../src/sketch-scene.js";
import type { Block, BlockId } from "../src/types.js";
import { SketchView } from "../src/web/SketchView.js";

const BLOCKS: Block[] = [
  { id: "spya-b0" as BlockId, tag: "p", kind: "text", text: "one two three", words: 3, html: "<p>one two three</p>", gistable: true },
  { id: "spya-b1" as BlockId, tag: "p", kind: "text", text: "four five six", words: 3, html: "<p>four five six</p>", gistable: true },
];

/**
 * An overview with a region that opens a zoom scene, and the zoom scene it
 * opens — the shape every real drawing so far has, with the `opens` written
 * rather than inferred so this file is testing the panel and not
 * `inferRegionOpens`.
 */
const SKETCH = {
  version: 1,
  title: "The shape of it",
  caption: "What the argument does",
  scenes: [
    {
      id: "overview",
      title: "The shape of it",
      height: 600,
      items: [
        { kind: "region", x: 20, y: 100, w: 700, h: 220, style: "band", label: "WHY WE ARE TEMPTED", opens: "inside" },
        { kind: "node", id: "claim", shape: "box", x: 60, y: 150, w: 200, h: 60, text: "a claim", size: "sm", block: "spya-b0" },
        { kind: "node", id: "far", shape: "box", x: 300, y: 400, w: 200, h: 60, text: "elsewhere", size: "sm", block: "spya-b1" },
      ],
    },
    {
      id: "inside",
      title: "The first support",
      height: 500,
      items: [
        /* **A region of its own, and it is here for one reason.** `peek` is an
           index into the painted regions, and a scene with no regions makes a
           stale index harmless by accident — so a test written against it
           passes whether or not the peek is cleared on the way in. With a
           region at the same index, a peek left standing draws a ghost of one
           part over another part nobody pointed at. */
        { kind: "region", x: 20, y: 250, w: 700, h: 200, style: "band", label: "AND UNDER THAT", opens: "deeper" },
        { kind: "node", id: "s1", shape: "box", x: 60, y: 40, w: 200, h: 60, text: "a support", size: "sm", block: "spya-b0" },
        { kind: "node", id: "s2", shape: "box", x: 400, y: 40, w: 200, h: 60, text: "another", size: "sm", block: "spya-b1" },
        /* Not a box: if the ghost ever goes back to drawing rounded rects for
           everything, the polygon this paints is what disappears. */
        { kind: "node", id: "s3", shape: "diamond", x: 230, y: 300, w: 200, h: 60, text: "so this", size: "sm", block: "spya-b1" },
        /* A labelled edge and a dashed one, because the peek hides text and an
           edge label is words sitting on a page-coloured PLATE — hiding only
           the words left the plate as a blank hole in the middle of a
           connector, a shape the model never drew. ⟨Sol⟩, 2026-08-30. */
        { kind: "edge", from: "s1", to: "s3", via: "curve", line: "solid", arrow: "end", label: "because" },
        { kind: "edge", from: "s2:bottom", to: "s3:top", via: "curve", line: "dashed", arrow: "end" },
      ],
    },
    {
      id: "deeper",
      title: "Under that again",
      height: 400,
      items: [
        { kind: "node", id: "d1", shape: "box", x: 60, y: 40, w: 200, h: 60, text: "the bottom", size: "sm", block: "spya-b1" },
      ],
    },
  ],
};

let host: HTMLDivElement;
let root: Root;

function serving() {
  vi.stubGlobal("fetch", async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes("/api/sketch/")) {
      return new Response(
        JSON.stringify({ sketch: SKETCH, stale: false, outdated: false, profileChanged: false }),
        { status: 200 },
      );
    }
    if (u.includes("/advance")) {
      return new Response(JSON.stringify({ job: null, ran: null, busy: false, done: true }), { status: 200 });
    }
    if (u.includes("/api/jobs")) return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    return new Response(JSON.stringify({}), { status: 200 });
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ shouldAdvanceTime: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/* Two flushes, for the reason tests/sketch-view-drawing.test.tsx gives:
   `apiFetch` asks for a token before it sends, so the sketch and the job list
   land on different microtasks. */
async function mount() {
  await act(async () => {
    root.render(<SketchView slug="s" blocks={BLOCKS} atRow={0} onJump={() => {}} />);
    await new Promise((r) => setTimeout(r, 0));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const openScene = () => host.querySelector(".sk-scene.on")?.textContent ?? null;
const region = () => host.querySelector<SVGGElement>(".sk-region-open");
/**
 * **React's own names for these are not the DOM's.** `onMouseEnter` is
 * synthesised from a delegated `mouseover`/`mouseout` pair and `onFocus` from
 * `focusin`/`focusout` — so dispatching a bare `mouseenter` or `focus` reaches
 * the DOM, changes nothing, and the assertion after it fails while looking like
 * the component is broken. It cost this file two red tests before the component
 * was even suspected.
 */
const fire = (el: Element, what: "enter" | "leave" | "focus" | "blur") =>
  act(() => {
    const type = { enter: "mouseover", leave: "mouseout", focus: "focusin", blur: "focusout" }[what];
    el.dispatchEvent(
      what === "enter" || what === "leave"
        ? new MouseEvent(type, { bubbles: true, relatedTarget: what === "enter" ? null : document.body })
        : new FocusEvent(type, { bubbles: true }),
    );
  });

describe("the picture says which parts open", () => {
  it("draws a region that opens a scene hotter than one that does not, and marks its name", async () => {
    serving();
    await mount();
    expect(host.querySelector("svg.sk-svg"), "no picture, so nothing below means anything").not.toBeNull();
    /* The two always-on signals, and they do different jobs at different sizes.
       The contrast is the one that survives the band, because an alpha and a
       `non-scaling-stroke` are the same at any scale where every *distance*
       halves; the mark says why, once the picture is big enough to read it.
       A browser pass killed the version that had this the other way round. */
    expect(host.querySelector(".sk-region-opens"), "the region that opens looks like one that does not").not.toBeNull();
    expect(host.querySelector(".sk-region-more"), "no mark beside the name that opens").not.toBeNull();
  });

  it("keeps the mark inside the same group as the name, so pressing it presses the name", async () => {
    serving();
    await mount();
    expect(region()?.querySelector(".sk-region-more"), "the mark is not part of the control").not.toBeNull();
  });
});

describe("the peek", () => {
  it("shows a ghost of the scene inside the region, on hover and on focus", async () => {
    serving();
    await mount();
    const r = region();
    if (!r) throw new Error("no pressable region");
    expect(host.querySelector(".sk-peek"), "peeking before anything was pointed at").toBeNull();

    await fire(r, "enter");
    const peek = host.querySelector(".sk-peek");
    expect(peek, "hovered the name and nothing appeared").not.toBeNull();
    /* **The real scene, painted by the one painter**, in a nested viewport
       scaled to the region — not a simplified redraw of it. So what is in
       here is `.sk-shape` and `.sk-edge`, the same classes the picture itself
       uses, and the shapes are the shapes the model chose. */
    const port = peek?.querySelector("svg");
    expect(port, "no nested viewport, so nothing was scaled or clipped").not.toBeNull();
    expect(port?.getAttribute("viewBox"), "the ghost is not the scene's own canvas").toBe(
      "0 0 760 500",
    );
    expect(port?.getAttribute("preserveAspectRatio"), "a stretched ghost is a different argument").toBe(
      "xMidYMid meet",
    );
    // Three nodes and two edges, which is what the scene it opens contains.
    expect(port?.querySelectorAll(".sk-shape")).toHaveLength(3);
    expect(port?.querySelectorAll(".sk-edge")).toHaveLength(2);
    /* It is a picture of a picture: the scene row already says what is there,
       and the peek is decoration on top of it. */
    expect(peek?.getAttribute("aria-hidden")).toBe("true");
    expect(peek?.querySelector(".sk-peek-scrim"), "no scrim, so the ghost is drawn into a thicket").not.toBeNull();

    await fire(r, "leave");
    expect(host.querySelector(".sk-peek"), "the ghost stayed after the pointer left").toBeNull();

    /* Focus, because a keyboard reader has no pointer and the peek is the only
       thing that says what a part holds before you go into it. */
    await fire(r, "focus");
    expect(host.querySelector(".sk-peek"), "focused the name and nothing appeared").not.toBeNull();
    await fire(r, "blur");
    expect(host.querySelector(".sk-peek")).toBeNull();
  });

  it("goes away when the reader goes into the part it was previewing", async () => {
    serving();
    await mount();
    const r = region();
    if (!r) throw new Error("no pressable region");
    await fire(r, "enter");
    expect(host.querySelector(".sk-peek")).not.toBeNull();
    await act(() => {
      r.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    /* The scene the reader has just entered has a region of its own at the
       same index, so a peek left standing draws a ghost over a part nobody
       pointed at — a preview that appeared by itself. */
    expect(host.querySelector(".sk-region-open"), "nothing at that index to draw a stale ghost on").not.toBeNull();
    expect(host.querySelector(".sk-peek"), "the ghost followed the reader into the next part").toBeNull();
  });
});

describe("the zoom, and the navigation it must never swallow", () => {
  it("opens the part when the name is pressed, with no Element.animate anywhere", async () => {
    serving();
    await mount();
    /* jsdom has none, which is the fallback path — and the one every other test
       in this repo runs on. */
    expect(typeof (host.querySelector("svg") as unknown as { animate?: unknown })?.animate).not.toBe("function");
    expect(openScene()).toBe("The shape of it");
    const r = region();
    if (!r) throw new Error("no pressable region");
    await act(() => {
      r.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(openScene(), "pressed the name and went nowhere").toBe("The first support");
  });

  /**
   * **The failure this ordering exists to prevent.**
   *
   * An animation whose `finished` never settles is what a backgrounded tab, a
   * cancelled animation and an element unmounted mid-flight all look like. If
   * the swap ever moves behind that promise, a reader presses a region's name
   * and lands nowhere — with no error, which is the whole of
   * docs/reusable/silent-success.md.
   */
  it("opens the part even when the animation never finishes", async () => {
    serving();
    let started = 0;
    const never = {
      cancel() {},
      finished: new Promise<never>(() => {}),
    };
    (Element.prototype as unknown as { animate: () => unknown }).animate = () => {
      started += 1;
      return never;
    };
    try {
      await mount();
      const r = region();
      if (!r) throw new Error("no pressable region");
      await act(() => {
        r.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(openScene(), "the navigation went behind the animation").toBe("The first support");
      expect(started, "no entrance was even attempted, so this proved nothing").toBeGreaterThan(0);
    } finally {
      delete (Element.prototype as unknown as { animate?: unknown }).animate;
    }
  });

  it("comes back out, from a press and from Escape", async () => {
    serving();
    await mount();
    const r = region();
    if (!r) throw new Error("no pressable region");
    await act(() => {
      r.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(openScene()).toBe("The first support");

    const back = host.querySelector<HTMLButtonElement>(".sk-up");
    expect(back, "no way back out of a part").not.toBeNull();
    await act(() => {
      back?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(openScene(), "Back did not come back").toBe("The shape of it");

    /* And by the row, which is the way in that does not depend on an anchor —
       going back from there has no box to zoom out to, and must still work. */
    const chip = [...host.querySelectorAll<HTMLButtonElement>(".sk-scene")].find(
      (b) => b.textContent === "The first support",
    );
    await act(() => {
      chip?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(openScene()).toBe("The first support");
    await act(() => {
      host
        .querySelector(".sk-svg")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(openScene(), "Escape out of a part reached with no anchor").toBe("The shape of it");
  });
});

/**
 * **The article Greg actually pressed.**
 *
 * `data/noema-mythology-of-conscious-ai/sketch.json` has no `opens` on any
 * item: both of the overview's doors exist only because `inferRegionOpens`
 * works them out from the blocks
 * (docs/plans/sketch-diagram.md § The door the model forgot to fit). Every test
 * above uses a hand-written `opens`, so every one of them could pass while the
 * one real artefact went on being a picture with no visible way into it — the
 * corpus-missing-the-field pattern docs/reusable/silent-success.md is about.
 * ⟨Sol⟩, 2026-08-30.
 *
 * The fixture is a copy rather than a read of `data/`, which is gitignored: a
 * test that reads it passes here and fails structurally wherever the tree has
 * not been ingested.
 */
describe("the real drawing, whose doors are all inferred", () => {
  /* `fileURLToPath` rather than passing the URL straight to `readFileSync`:
     under the jsdom environment `import.meta.url` is not a `file:` URL, and the
     read throws before a single test in this file runs. */
  const REAL = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sketch-noema.json"), "utf8"),
  ) as { blockOrder: BlockId[]; sketch: unknown };

  const realBlocks: Block[] = REAL.blockOrder.map((id) => ({
    id,
    tag: "p",
    kind: "text",
    text: "x",
    words: 1,
    html: "<p>x</p>",
    gistable: true,
  }));

  function servingReal() {
    vi.stubGlobal("fetch", async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/api/sketch/")) {
        return new Response(
          JSON.stringify({ sketch: REAL.sketch, stale: false, outdated: false, profileChanged: false }),
          { status: 200 },
        );
      }
      if (u.includes("/advance")) {
        return new Response(JSON.stringify({ job: null, ran: null, busy: false, done: true }), { status: 200 });
      }
      if (u.includes("/api/jobs")) return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    });
  }

  async function mountReal() {
    await act(async () => {
      root.render(<SketchView slug="s" blocks={realBlocks} atRow={0} onJump={() => {}} />);
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }

  it("carries no `opens` of its own, or this file is testing the wrong thing", () => {
    const has = (o: unknown): boolean =>
      Array.isArray(o)
        ? o.some(has)
        : typeof o === "object" && o !== null
          ? "opens" in o || Object.values(o).some(has)
          : false;
    expect(has(REAL.sketch), "the fixture was written with a door in it").toBe(false);
  });

  it("marks both inferred doors exactly as it would mark written ones", () => {
    servingReal();
    return mountReal().then(() => {
      expect(host.querySelector("svg.sk-svg"), "no picture at all").not.toBeNull();
      /* Two of the overview's regions get a door from the blocks, and two do
         not — inferRegionOpens abstains rather than guessing, because a wrong
         door is worse than none. */
      expect(host.querySelectorAll(".sk-region-open")).toHaveLength(2);
      expect(host.querySelectorAll(".sk-region-opens")).toHaveLength(2);
      expect(host.querySelectorAll(".sk-region-more")).toHaveLength(2);
      /* **Both of this overview's regions, and it has exactly two.**
         `inferRegionOpens` abstains on three of the six regions across the two
         real drawings — but the three it abstains on are in the *other*
         article, and this one's two both earn a door. So this asserts
         completeness rather than discrimination, and the abstaining case is
         covered where it can be: the painter tests, where a region with no
         `opens` is drawn as the ordinary kind. */
      expect(host.querySelectorAll(".sk-region")).toHaveLength(2);
    });
  });

  it("opens the part the region names, and previews it first", async () => {
    servingReal();
    await mountReal();
    const first = host.querySelector<SVGGElement>(".sk-region-open");
    if (!first) throw new Error("no inferred door on the real drawing");
    expect(first.getAttribute("aria-label")).toBe("Open WHY WE'RE TEMPTED TO SEE IT");

    await fire(first, "enter");
    const port = host.querySelector(".sk-peek svg");
    expect(port, "no preview of the part").not.toBeNull();
    /* The scene that region opens is nine nodes, and the ghost is the real
       painting of it — so a ghost of the wrong scene would show a different
       number of shapes. */
    expect(port?.querySelectorAll(".sk-shape").length).toBeGreaterThan(5);

    await act(() => {
      first.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector(".sk-scene.on")?.textContent).toBe("Why We're Tempted");
    /* And focus went with the reader, rather than falling to the body when the
       group holding it unmounted. */
    expect(document.activeElement).toBe(host.querySelector(".sk-svg"));
  });
});

/**
 * **The animation, watched rather than assumed.**
 *
 * Every other test in this file runs the fallback path, because jsdom has no
 * `Element.animate` — which proves the navigation survives without an
 * animation and says nothing at all about whether the zoom is right. ⟨Sol⟩,
 * 2026-08-30. So this one installs an `animate` that records what it was asked
 * to play, and checks the arithmetic that reaches it.
 */
describe("what the entrance is actually asked to play", () => {
  interface Played {
    frames: Keyframe[];
    cancelled: boolean;
  }
  let played: Played[] = [];

  /**
   * **Make the scroll correction reachable at all.**
   *
   * jsdom lays nothing out, so `getBoundingClientRect().width` is 0, the
   * pixels-per-unit is 0, and `goTo`'s correction declines every time — which
   * means the tests that "composed the transforms" were composing uncorrected
   * ones and could never have caught the sign error in the outgoing direction.
   * GPT Sol, 2026-08-30. This stubs a real width and a scrollable container so
   * the arithmetic runs.
   */
  function laidOut(unitPx: number) {
    const svg = host.querySelector<SVGSVGElement>(".sk-svg");
    const box = host.querySelector<HTMLElement>(".sk-scroll");
    if (!svg || !box) throw new Error("no picture to lay out");
    svg.getBoundingClientRect = () =>
      ({ width: CANVAS_W * unitPx, height: 0, x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {} }) as DOMRect;
    return box;
  }

  /**
   * **The scroll jumping across the swap, which is the thing being corrected
   * for and which jsdom will not do.**
   *
   * In a browser the overview is 1150 units tall and the scene it opens is 500,
   * so the moment the shorter picture is in the DOM the browser clamps
   * `scrollTop` to what it can offer. jsdom lays nothing out and clamps
   * nothing, so the two reads that `goTo` and the layout effect make would
   * return the same number and the correction would be zero — which is how the
   * outgoing sign error survived a test that composed the two transforms.
   *
   * So the clamp is modelled where it actually shows: the **first** read, which
   * is `goTo`'s and happens before the swap, returns `before`; every read after
   * it returns `after`.
   */
  function scrollJumps(box: HTMLElement, before: number, after: number) {
    let read = 0;
    Object.defineProperty(box, "scrollTop", {
      configurable: true,
      get: () => (read++ === 0 ? before : after),
      set: () => {},
    });
  }

  function recording() {
    played = [];
    (Element.prototype as unknown as { animate: (f: Keyframe[]) => unknown }).animate = (frames) => {
      const p: Played = { frames, cancelled: false };
      played.push(p);
      return { cancel: () => { p.cancelled = true; }, finished: new Promise(() => {}) };
    };
  }

  afterEach(() => {
    delete (Element.prototype as unknown as { animate?: unknown }).animate;
  });

  /**
   * The `transform` the last entrance started from, as numbers — **or a throw**.
   *
   * Returning a union and narrowing it at each call site was the first version,
   * and it typechecked as `possibly undefined` on every field: a regex group is
   * `string | undefined` however sure the shape looks. Throwing here keeps the
   * numbers numbers, and a transform that is not an anchored one is a failure
   * anyway.
   */
  function startedAt(at = played.length - 1): { tx: number; ty: number; s: number } {
    const t = String(played[at]?.frames[0]?.transform ?? "");
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(t);
    if (!m?.[1] || !m[2] || !m[3]) throw new Error(`not an anchored transform: ${t || "(none played)"}`);
    return { tx: Number(m[1]), ty: Number(m[2]), s: Number(m[3]) };
  }

  it("grows the part out of the box that was pressed, and shrinks back into it", async () => {
    serving();
    recording();
    await mount();
    const r = region();
    if (!r) throw new Error("no pressable region");
    await act(() => {
      r.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const going = startedAt();
    // Small, and inside the region it was pressed on (x 20..720, y 100..320).
    expect(going.s).toBeLessThan(0.9);
    expect(going.tx).toBeGreaterThanOrEqual(20);
    expect(going.ty).toBeGreaterThanOrEqual(100);

    await act(() => {
      host.querySelector<HTMLButtonElement>(".sk-up")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const coming = startedAt();
    /* The exact undoing: the overview starts magnified about the same box and
       pulls back. Two transforms that each look plausible can compose to
       something that is not the identity, and on screen that is a picture that
       comes back a little further left every time. */
    expect(coming.s * going.s).toBeCloseTo(1, 8);
    expect(coming.tx + coming.s * going.tx).toBeCloseTo(0, 6);
    expect(coming.ty + coming.s * going.ty).toBeCloseTo(0, 6);
  });

  it("shifts the entrance by however far the picture scrolled across the swap", async () => {
    serving();
    recording();
    await mount();
    const box = laidOut(0.4);
    const dy = 100 / 0.4;

    // A move with the scroll standing still: the plain anchor, both ways.
    scrollJumps(box, 0, 0);
    const r = region();
    if (!r) throw new Error("no pressable region");
    await act(() => {
      r.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const plainIn = startedAt();

    scrollJumps(box, 0, 0);
    await act(() => {
      host.querySelector<HTMLButtonElement>(".sk-up")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const plainOut = startedAt();

    // And now with 100px appearing between the two reads, which is the clamp.
    scrollJumps(box, 0, 100);
    const r2 = region();
    if (!r2) throw new Error("the region went away");
    await act(() => {
      r2.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(startedAt().ty - plainIn.ty, "the entrance ignored the scroll").toBeCloseTo(dy, 4);

    scrollJumps(box, 0, 100);
    await act(() => {
      host.querySelector<HTMLButtonElement>(".sk-up")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const shiftedOut = startedAt();
    /* **The same +dy, not dy through the magnification.** Folded into `ty`
       before the inverse it came out as −dy/s — about −900 for a +250
       correction on this region, and the overview entering from far above the
       part it was pulling out of. ⟨Sol⟩, 2026-08-30. */
    expect(
      shiftedOut.ty - plainOut.ty,
      "the outgoing correction is on the wrong side of the inverse",
    ).toBeCloseTo(dy, 4);
    expect(shiftedOut.ty - plainOut.ty).not.toBeCloseTo(-dy / plainIn.s, 2);
  });

  it("fades rather than zooms when there is no box to zoom from", async () => {
    serving();
    recording();
    await mount();
    /* The scene row is the way in that never depended on the model wiring an
       `opens`, and pressing a chip means "show me that part", not "zoom into
       this box". Claiming an origin it does not have would be the picture
       lying about where the reader came from. */
    const chip = [...host.querySelectorAll<HTMLButtonElement>(".sk-scene")].find(
      (b) => b.textContent === "The first support",
    );
    await act(() => {
      chip?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(played).toHaveLength(1);
    expect(String(played[0]?.frames[0]?.transform)).toBe("scale(0.96)");
  });

  it("cancels the one in flight rather than running two at once", async () => {
    serving();
    recording();
    await mount();
    const r = region();
    if (!r) throw new Error("no pressable region");
    await act(() => {
      r.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(() => {
      host.querySelector<HTMLButtonElement>(".sk-up")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(played).toHaveLength(2);
    expect(played[0]?.cancelled, "the first entrance was left running under the second").toBe(true);
    expect(played[1]?.cancelled).toBe(false);
  });

  it("plays nothing at all for a reader who has asked for less motion", async () => {
    serving();
    recording();
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("prefers-reduced-motion"),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }));
    await mount();
    const r = region();
    if (!r) throw new Error("no pressable region");
    await act(() => {
      r.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(played, "animated anyway").toHaveLength(0);
    // And the navigation still happened, which is the half that is not optional.
    expect(openScene()).toBe("The first support");
  });
});

/**
 * The three things GPT Sol found on the built code that the tests above could
 * not have caught, 2026-08-30 — each one a path that was green for a reason
 * other than the one it claimed.
 */
describe("the paths a passing test was not reaching", () => {
  it("keeps the ghost the model's own drawing, shapes and dashes and all", async () => {
    serving();
    await mount();
    const r = region();
    if (!r) throw new Error("no pressable region");
    await fire(r, "enter");
    const port = host.querySelector(".sk-peek svg");
    if (!port) throw new Error("no ghost");
    /* A diamond stays a diamond. The first version of the peek painted a
       rounded rect for every node whatever its shape — which threw away the
       diamond one real zoom scene opens with, and the bands that make another
       read as parallel tracks. */
    expect(port.querySelectorAll("polygon").length, "the diamond became a box again").toBeGreaterThan(0);
    // A dashed edge is still dashed: line style is structure, not decoration.
    expect(port.querySelector(".sk-edge-dashed"), "the dashes went").not.toBeNull();
    /* And no orphaned label plate. The plate is a page-coloured rect the words
       sit on, so hiding the words alone leaves a blank hole punched through a
       connector — a shape nobody drew, which is the one thing a ghost may never
       invent. It is hidden by the stylesheet, which jsdom does not apply, so
       what is asserted is that the rule has something to bite on and that the
       class is still the one the rule names. */
    expect(port.querySelectorAll(".sk-label-plate").length).toBeGreaterThan(0);
    /* And the corner mark of a region INSIDE the previewed scene. `paintScene`
       keeps an opening region's label out of `front` because the panel draws it
       in a pressable group of its own, so the peek has to ask for those
       separately — without that, a part with parts of its own previewed as one
       that had none. ⟨Sol⟩, 2026-08-30. */
    expect(
      port.querySelectorAll(".sk-region-more").length,
      "the nested door vanished from the preview",
    ).toBeGreaterThan(0);
  });

  it("lands focus on the picture when a region opened by the KEYBOARD unmounts", async () => {
    /* The earlier test clicked, and a click sets the same flag — so it passed
       whether or not focus survived an activated, unmounting control. This one
       focuses the control first, so the element losing focus is the element
       that was holding it. ⟨Sol⟩, 2026-08-30. */
    serving();
    await mount();
    const r = region();
    if (!r) throw new Error("no pressable region");
    r.focus();
    expect(document.activeElement, "the region never took focus, so this proves nothing").toBe(r);
    await act(() => {
      r.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(openScene()).toBe("The first support");
    /* The picture is the listbox and the scene's one tab stop, and its
       `aria-label` is the scene's title and caption — so being focused is the
       announcement. Falling to `<body>` is a keyboard reader left nowhere. */
    expect(document.activeElement, "focus fell off the picture").toBe(host.querySelector(".sk-svg"));
  });

  it("swallows the arrows on a focused region name outright, defaults and all", async () => {
    /* `stopPropagation` alone stopped them walking the listbox marker behind
       this group and left the browser's own default — scrolling the picture. So
       the selection stopped moving and the picture started. */
    serving();
    await mount();
    const r = region();
    if (!r) throw new Error("no pressable region");
    r.focus();
    const ev = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    await act(() => {
      r.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented, "the browser is still free to scroll the picture").toBe(true);
    // And the selection behind it did not move either.
    expect(host.querySelector(".sk-node[aria-selected='true']")).toBe(
      host.querySelectorAll(".sk-node")[0],
    );
  });

  it("stops an entrance that is still running when the drawing is replaced", async () => {
    /* The animation lived only in the layout effect's closure, so it was
       cancelled when the next navigation replaced it and at no other time — and
       a reload mid-flight left the reused group wearing the old scene's
       transform while its contents changed underneath. ⟨Sol⟩, 2026-08-30. */
    serving();
    let cancels = 0;
    (Element.prototype as unknown as { animate: () => unknown }).animate = () => ({
      cancel: () => { cancels += 1; },
      finished: new Promise(() => {}),
    });
    try {
      await mount();
      const r = region();
      if (!r) throw new Error("no pressable region");
      await act(() => {
        r.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(cancels, "nothing was playing, so this proves nothing").toBe(0);

      // A different sketch arrives, mid-flight.
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await new Promise((res) => setTimeout(res, 0));
      });
      root.render(<SketchView slug="other" blocks={BLOCKS} atRow={0} onJump={() => {}} />);
      await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
      await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
      expect(cancels, "the entrance was left running over a new drawing").toBeGreaterThan(0);
    } finally {
      delete (Element.prototype as unknown as { animate?: unknown }).animate;
    }
  });
});
