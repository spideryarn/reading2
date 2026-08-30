/**
 * The Sketch scene's reader and its score — src/sketch-scene.ts.
 *
 * This file is the *only* thing standing between a model's arithmetic and the
 * page. Every other diagram in this app computes its own geometry from the
 * tree, so a wrong number there is a bug somebody wrote; here the numbers come
 * from a model, and the failure mode is not a crash. A box 400 units off the
 * canvas, an edge to a node that is not in the scene, a `block` id that names
 * no paragraph — SVG renders all of them without complaining, and every one
 * looks like a design choice (docs/reusable/silent-success.md, and
 * docs/project/diagram.md § Two things that are wrong in a way you cannot see).
 *
 * So the rule under test throughout is: **an item survives intact or it is
 * dropped and counted.** Nothing is repaired into something plausible, because
 * a validator that patched things would report a clean run on a model that
 * cannot follow the schema — and `report.faults` is the only signal there is
 * that a prompt has drifted.
 */
import { describe, expect, it } from "vitest";
import {
  accept,
  CANVAS_W,
  cleanPath,
  layoutNodeText,
  linesNeeded,
  nodeFits,
  readSketch,
  scoreSketch,
  stripInferredOpens,
  type SketchNode,
  widthAt,
} from "../src/sketch-scene.js";

/** Ten blocks, in document order — `blockOrder` is the article's own index. */
const BLOCKS = [
  "spya-aaaaaa",
  "spya-bbbbbb",
  "spya-cccccc",
  "spya-dddddd",
  "spya-eeeeee",
  "spya-ffffff",
  "spya-gggggg",
  "spya-hhhhhh",
  "spya-jjjjjj",
  "spya-kkkkkk",
];

const opts = { blockOrder: BLOCKS };

function node(over: Record<string, unknown>): Record<string, unknown> {
  return { kind: "node", id: "n", x: 10, y: 10, w: 120, h: 40, text: "hello", ...over };
}

function scene(items: unknown[], over: Record<string, unknown> = {}) {
  return { title: "t", caption: "c", scenes: [{ id: "overview", title: "s", height: 600, items, ...over }] };
}

const read = (items: unknown[], over?: Record<string, unknown>) => readSketch(scene(items, over), opts);

describe("readSketch — what survives, and what is counted", () => {
  it("keeps a well-formed node whole", () => {
    const { sketch, report } = read([node({ block: BLOCKS[3], shape: "pill", size: "md" })]);
    expect(report.faults).toEqual([]);
    const n = sketch.scenes[0]?.items[0] as SketchNode;
    expect(n.block).toBe(BLOCKS[3]);
    expect(n.shape).toBe("pill");
    expect(n.size).toBe("md");
  });

  it("falls back rather than dropping when an enum is unrecognised", () => {
    // A value from a future version of the schema, or a hallucinated one. The
    // rule params.ts applies to every URL parameter: degrade to something real.
    const { sketch } = read([node({ shape: "trapezoid", size: "enormous" })]);
    const n = sketch.scenes[0]?.items[0] as SketchNode;
    expect(n.shape).toBe("box");
    expect(n.size).toBe("sm");
  });

  it("clamps a node that runs off the canvas, and says so", () => {
    // Clamped, not dropped: a box 20 units past the edge is a rounding error,
    // and a picture with that box deleted has a hole in it — which is the thing
    // a reader notices.
    const { sketch, report } = read([node({ x: CANVAS_W - 20, w: 300, y: 590, h: 200 })]);
    const n = sketch.scenes[0]?.items[0] as SketchNode;
    expect(n.x + n.w).toBeLessThanOrEqual(CANVAS_W);
    expect(n.y + n.h).toBeLessThanOrEqual(600);
    expect(report.faults.map((f) => f.what).join(" ")).toContain("off canvas");
  });

  it("takes the click off a node whose block the article has not got, and keeps the node", () => {
    // Two states that look identical on screen — "the model invented an id" and
    // "the model chose not to link this one" — so only the count tells them
    // apart. A node dropped for a bad id would be a hole in the picture caused
    // by a broken link.
    const { sketch, report } = read([node({ block: "spya-zzzzzz" })]);
    const n = (sketch.scenes[0]?.items ?? [])[0] as SketchNode;
    expect(n).toBeTruthy();
    expect(n.block).toBeUndefined();
    expect(report.faults).toHaveLength(1);
    expect(report.faults[0]?.what).toContain("spya-zzzzzz");
  });

  it("takes the click off a block id that is not a spideryarn id at all", () => {
    const { sketch } = read([node({ block: "#section-3" })]);
    expect(((sketch.scenes[0]?.items ?? [])[0] as SketchNode).block).toBeUndefined();
  });

  it("drops an edge naming a node this scene has not got", () => {
    // The renderer would have to invent one end of it, and an invented end is a
    // confident line to somewhere nobody meant.
    const { sketch, report } = read([
      node({ id: "a" }),
      node({ id: "b", y: 300 }),
      { kind: "edge", from: "a", to: "ghost" },
      { kind: "edge", from: "a", to: "b" },
    ]);
    const edges = sketch.scenes[0]?.items.filter((i) => i.kind === "edge") ?? [];
    expect(edges).toHaveLength(1);
    expect(report.faults.map((f) => f.what).join(" ")).toContain("ghost");
  });

  it("drops an edge from a node to itself", () => {
    // It is routed through its own node and comes out as a stub mostly hidden
    // under it, and nothing in an argument map means "depends on itself".
    const { sketch, report } = read([node({ id: "a" }), { kind: "edge", from: "a:left", to: "a:right" }]);
    expect(sketch.scenes[0]?.items.filter((i) => i.kind === "edge")).toHaveLength(0);
    expect(report.faults.map((f) => f.what).join(" ")).toContain("to itself");
  });

  it("drops the second of two nodes sharing an id, and every edge is then unambiguous", () => {
    // Not a duplicate node — an ambiguous edge. Every edge names its ends by
    // id, so a repeated id makes one of the two unreachable and quietly sends
    // its lines to the other.
    const { sketch, report } = read([
      node({ id: "a", text: "first" }),
      node({ id: "a", text: "second", y: 300 }),
    ]);
    const nodes = (sketch.scenes[0]?.items ?? []).filter((i): i is SketchNode => i.kind === "node");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.text).toBe("first");
    expect(report.faults.map((f) => f.what).join(" ")).toContain("both called");
  });

  it("drops a node with no text at all", () => {
    const { sketch, report } = read([node({ id: "a", text: "  " })]);
    expect(sketch.scenes[0]?.items).toHaveLength(0);
    expect(report.faults.map((f) => f.what).join(" ")).toContain("no text");
  });

  it("drops a shape that is not near the canvas, rather than clamping it there", () => {
    // Clamping a box at x = -1,000,000 produces a confident rectangle in the
    // corner standing for something the model put somewhere else entirely.
    const { sketch, report } = read([node({ id: "a", x: -1_000_000 })]);
    expect(sketch.scenes[0]?.items).toHaveLength(0);
    expect(report.faults.map((f) => f.what).join(" ")).toContain("not on this canvas");
  });

  it("keeps a region inside the canvas by its far edge, not by each number alone", () => {
    // x and w are each legal on a 760-wide canvas and their sum is not.
    const { sketch } = read([{ kind: "region", x: 750, y: 10, w: 100, h: 50, style: "band" }]);
    const r = sketch.scenes[0]?.items[0] as { x: number; w: number };
    expect(r.x + r.w).toBeLessThanOrEqual(CANVAS_W);
  });

  it("counts an unrecognised enum rather than defaulting in silence", () => {
    // A model that has started writing "trapezoid" on half its nodes otherwise
    // produces a picture of plain boxes and a fault list of length zero.
    const { report } = read([node({ shape: "trapezoid" })]);
    expect(report.faults.map((f) => f.what).join(" ")).toContain("trapezoid");
  });

  it("honours a side suffix when matching an edge's ends", () => {
    // `a:bottom` names node `a`. Matching on the whole string would drop every
    // edge the prompt's own example shows.
    const { sketch } = read([
      node({ id: "a", y: 10 }),
      node({ id: "b", y: 300 }),
      { kind: "edge", from: "a:bottom", to: "b:top" },
    ]);
    expect(sketch.scenes[0]?.items.filter((i) => i.kind === "edge")).toHaveLength(1);
  });

  it("removes an `opens` that names no scene, and keeps one that does", () => {
    const { sketch, report } = readSketch(
      {
        title: "t",
        caption: "c",
        scenes: [
          { id: "overview", title: "s", height: 400, items: [node({ id: "a", opens: "detail" }), node({ id: "b", opens: "nowhere" })] },
          { id: "detail", title: "d", height: 400, items: [] },
        ],
      },
      opts,
    );
    const [a, b] = (sketch.scenes[0]?.items ?? []) as SketchNode[];
    expect(a?.opens).toBe("detail");
    expect(b?.opens).toBeUndefined();
    expect(report.faults.map((f) => f.what).join(" ")).toContain("nowhere");
  });

  it("resolves an `opens` that points forwards to a scene declared later", () => {
    // Resolved after every scene has been read, not during — the overview is
    // scene 0 and everything it opens is by definition below it in the list.
    const { sketch, report } = readSketch(
      {
        title: "t",
        caption: "c",
        scenes: [
          /* Both zoom scenes opened, because an unopened one is now a fault of
             its own and this test is about forward resolution rather than that. */
          {
            id: "overview",
            title: "s",
            height: 400,
            items: [node({ id: "a", opens: "last" }), node({ id: "b", y: 200, opens: "mid" })],
          },
          { id: "mid", title: "m", height: 400, items: [] },
          { id: "last", title: "l", height: 400, items: [] },
        ],
      },
      opts,
    );
    expect(((sketch.scenes[0]?.items ?? [])[0] as SketchNode).opens).toBe("last");
    expect(report.faults).toEqual([]);
  });

  it("refuses a node that has no id or no coordinates", () => {
    const { sketch, report } = read([
      { kind: "node", x: 1, y: 1, w: 10, h: 10, text: "no id" },
      node({ id: "b", x: "left" }),
    ]);
    expect(sketch.scenes[0]?.items).toHaveLength(0);
    expect(report.faults).toHaveLength(2);
  });

  it("counts what the model wrote as well as what survived", () => {
    // `written` is the denominator a prompt is judged against. Without it a run
    // where nine items in ten were dropped and one where nothing was reads the
    // same: "1 item".
    const { report } = read([node({ id: "a" }), { kind: "elephant" }, { kind: "label" }]);
    expect(report.written).toBe(3);
    expect(report.kept).toBe(1);
  });

  it("survives a root that is not a scene list at all", () => {
    const { sketch, report } = readSketch("nope", opts);
    expect(sketch.scenes).toEqual([]);
    expect(report.faults).toHaveLength(1);
  });
});

describe("reaching a scene — the pointers that make a zoom visible at all", () => {
  /* The plainest silent success this feature produced, and it survived six real
     runs and a cross-family review: the model returns three scenes, the artefact
     says three scenes and the score says three scenes — and in four of those
     six, three of them with no `opens` anywhere, the reader could see ONE. Two
     paid-for pictures each time, drawn and unreachable, with nothing reporting
     it. Everything in this block exists because of that. */
  const zoomed = (overview: unknown[]) =>
    readSketch(
      {
        title: "t",
        caption: "c",
        scenes: [
          { id: "overview", title: "s", height: 400, items: overview },
          { id: "zoom", title: "z", height: 400, items: [node({ id: "z1" })] },
        ],
      },
      opts,
    );

  it("reports a scene that no node and no region opens", () => {
    const { sketch, report } = zoomed([node({ id: "a" })]);
    expect(report.faults.map((f) => f.what).join(" ")).toContain("no node opens this scene");
    // A fault, NOT a refusal: the overview is usually fine, and the panel lists
    // the scenes itself rather than depending on the pointer.
    expect(sketch.scenes).toHaveLength(2);
    expect(scoreSketch(sketch, report, opts).unreachable).toBe(1);
  });

  it("counts a scene a node opens as reached", () => {
    const { sketch, report } = zoomed([node({ id: "a", opens: "zoom" })]);
    expect(report.faults).toEqual([]);
    expect(scoreSketch(sketch, report, opts).unreachable).toBe(0);
  });

  it("counts a scene a REGION's label opens as reached", () => {
    /* Greg, 2026-08-30: "add a way to click on the subsection (e.g. 'Why we're
       tempted to see it') that takes to the relevant subdiagram". A region is
       the overview's own statement that these boxes are one movement of the
       piece, so it is the natural handle — and a scene reached that way is every
       bit as reachable as one reached from a box. */
    const { sketch, report } = zoomed([
      { kind: "region", x: 10, y: 10, w: 300, h: 200, label: "THE CASE", style: "band", opens: "zoom" },
      node({ id: "a", y: 40 }),
    ]);
    const region = (sketch.scenes[0]?.items ?? []).find((i) => i.kind === "region");
    expect((region as { opens?: string }).opens).toBe("zoom");
    expect(report.faults).toEqual([]);
    expect(scoreSketch(sketch, report, opts).unreachable).toBe(0);
  });

  it("drops a region's `opens` that names no scene, and keeps the region", () => {
    const { sketch, report } = read([
      { kind: "region", x: 10, y: 10, w: 300, h: 200, label: "THE CASE", style: "band", opens: "nowhere" },
    ]);
    const region = (sketch.scenes[0]?.items ?? [])[0] as { opens?: string };
    expect(region).toBeTruthy();
    expect(region.opens).toBeUndefined();
    expect(report.faults.map((f) => f.what).join(" ")).toContain("nowhere");
  });

  it("refuses a region that opens a scene and has no label to press", () => {
    // The label IS the target, so an unlabelled one is a control with nothing to
    // press — worse than none, because the scene then looks reachable.
    const { sketch, report } = read([
      { kind: "region", x: 10, y: 10, w: 300, h: 200, style: "band", opens: "zoom" },
    ]);
    expect(((sketch.scenes[0]?.items ?? [])[0] as { opens?: string }).opens).toBeUndefined();
    expect(report.faults.map((f) => f.what).join(" ")).toContain("no label to press");
  });
});

describe("inferRegionOpens — the door the model forgot to fit", () => {
  /* Greg pressed "WHY WE'RE TEMPTED TO SEE IT" and nothing happened. The region
     was there, the zoom scene was there, and nothing joined them, because the
     picture had been drawn before the prompt asked for `opens`. Redrawing fixes
     one article; deriving the link fixes every sketch already on disk and every
     future one a model forgets. The whole risk is a WRONG door — pressing a name
     and arriving somewhere else — so most of what is tested here is abstention. */

  /** A region wrapping the given blocks, and two zoom scenes to choose between. */
  function drawing(
    regions: unknown[],
    inRegion: string[],
    zoomA: string[],
    zoomB: string[],
  ): ReturnType<typeof readSketch> {
    const nodes = inRegion.map((b, i) =>
      node({ id: `r${i}`, x: 20 + i * 130, y: 60, w: 120, h: 40, block: b }),
    );
    const zoom = (id: string, blocks: string[]) => ({
      id,
      title: id,
      height: 400,
      items: blocks.map((b, i) => node({ id: `${id}${i}`, x: 20, y: 20 + i * 60, block: b })),
    });
    return readSketch(
      {
        title: "t",
        caption: "c",
        scenes: [
          { id: "overview", title: "s", height: 400, items: [...regions, ...nodes] },
          zoom("za", zoomA),
          zoom("zb", zoomB),
        ],
      },
      opts,
    );
  }

  /** A band across the top, wide enough to hold four of the nodes above. */
  const band = (over: Record<string, unknown> = {}) => ({
    kind: "region",
    x: 10,
    y: 40,
    w: 700,
    h: 90,
    label: "THE CASE",
    style: "band",
    ...over,
  });

  const regionOf = (r: ReturnType<typeof readSketch>, scene = 0) =>
    (r.sketch.scenes[scene]?.items ?? []).find((i) => i.kind === "region") as
      | { opens?: string; opensInferred?: true }
      | undefined;

  it("links the region whose blocks are a scene's, and says the link is ours", () => {
    const r = drawing([band()], [BLOCKS[0], BLOCKS[1], BLOCKS[2]] as string[], [
      BLOCKS[0],
      BLOCKS[1],
      BLOCKS[5],
    ] as string[], [BLOCKS[8]] as string[]);
    expect(regionOf(r)?.opens).toBe("za");
    expect(regionOf(r)?.opensInferred).toBe(true);
    expect(r.report.inferred).toBe(1);
  });

  it("matches on blocks, not on words — the real drawings share none", () => {
    /* "THE CORE ARGUMENT" and "Why Scale Works: The Ladder" have no word in
       common and their blocks match five to nil, which is why this is not
       string similarity between a label and a title. */
    const r = drawing(
      [band({ label: "THE CORE ARGUMENT" })],
      [BLOCKS[0], BLOCKS[1], BLOCKS[2]] as string[],
      [BLOCKS[0], BLOCKS[1], BLOCKS[2]] as string[],
      [BLOCKS[9]] as string[],
    );
    expect(regionOf(r)?.opens).toBe("za");
  });

  it("abstains when the region straddles two scenes", () => {
    // Two of three each way is not a majority anybody can act on, and a wrong
    // door is worse than none.
    const r = drawing(
      [band()],
      [BLOCKS[0], BLOCKS[1], BLOCKS[2], BLOCKS[3]] as string[],
      [BLOCKS[0], BLOCKS[1]] as string[],
      [BLOCKS[2], BLOCKS[3]] as string[],
    );
    expect(regionOf(r)?.opens).toBeUndefined();
    expect(r.report.inferred).toBe(0);
  });

  it("abstains on a bare majority with a runner-up worth more than half of it", () => {
    // 3 of 5 for one scene and 2 for the other: a majority, and still a guess.
    const r = drawing(
      [band()],
      [BLOCKS[0], BLOCKS[1], BLOCKS[2], BLOCKS[3], BLOCKS[4]] as string[],
      [BLOCKS[0], BLOCKS[1], BLOCKS[2]] as string[],
      [BLOCKS[3], BLOCKS[4]] as string[],
    );
    expect(regionOf(r)?.opens).toBeUndefined();
  });

  it("abstains when a scene covers only half the region", () => {
    // Half is not "this region drawn larger" — it is a scene that overlaps it.
    const r = drawing(
      [band()],
      [BLOCKS[0], BLOCKS[1], BLOCKS[2], BLOCKS[3]] as string[],
      [BLOCKS[0], BLOCKS[1]] as string[],
      [BLOCKS[9]] as string[],
    );
    expect(regionOf(r)?.opens).toBeUndefined();
  });

  it("abstains on a region holding one block — too little to match on", () => {
    const r = drawing([band()], [BLOCKS[0]] as string[], [BLOCKS[0]] as string[], [BLOCKS[9]] as string[]);
    expect(regionOf(r)?.opens).toBeUndefined();
  });

  it("abstains when the region holds no nodes at all", () => {
    // The band is above every node here, so nothing's centre is inside it.
    const r = drawing(
      [band({ y: 300, h: 40 })],
      [BLOCKS[0], BLOCKS[1]] as string[],
      [BLOCKS[0], BLOCKS[1]] as string[],
      [BLOCKS[9]] as string[],
    );
    expect(regionOf(r)?.opens).toBeUndefined();
  });

  it("leaves an unlabelled region shut — there is nothing to press", () => {
    const r = drawing(
      [{ kind: "region", x: 10, y: 40, w: 700, h: 90, style: "band" }],
      [BLOCKS[0], BLOCKS[1]] as string[],
      [BLOCKS[0], BLOCKS[1]] as string[],
      [BLOCKS[9]] as string[],
    );
    expect(regionOf(r)?.opens).toBeUndefined();
  });

  it("never overrules a link the model wrote itself", () => {
    // The blocks say `za` and the model says `zb`. The model wins: it knows
    // what it meant, and this is arithmetic over what it drew.
    const r = drawing(
      [band({ opens: "zb" })],
      [BLOCKS[0], BLOCKS[1], BLOCKS[2]] as string[],
      [BLOCKS[0], BLOCKS[1], BLOCKS[2]] as string[],
      [BLOCKS[9]] as string[],
    );
    expect(regionOf(r)?.opens).toBe("zb");
    expect(regionOf(r)?.opensInferred).toBeUndefined();
    expect(r.report.inferred).toBe(0);
  });

  it("gives one scene one door, and shuts the weaker claim on it", () => {
    /* Two regions both matching `za` is the same ambiguity as one region
       straddling two scenes, seen from the other side. */
    const r = readSketch(
      {
        title: "t",
        caption: "c",
        scenes: [
          {
            id: "overview",
            title: "s",
            height: 600,
            items: [
              band({ label: "STRONG" }),
              band({ label: "WEAKER", y: 200, h: 90 }),
              node({ id: "s1", x: 20, y: 60, block: BLOCKS[0] }),
              node({ id: "s2", x: 200, y: 60, block: BLOCKS[1] }),
              node({ id: "w1", x: 20, y: 220, block: BLOCKS[2] }),
              node({ id: "w2", x: 200, y: 220, block: BLOCKS[3] }),
              node({ id: "w3", x: 380, y: 220, block: BLOCKS[9] }),
            ],
          },
          {
            id: "za",
            title: "z",
            height: 400,
            items: [
              node({ id: "za0", block: BLOCKS[0] }),
              node({ id: "za1", y: 80, block: BLOCKS[1] }),
              node({ id: "za2", y: 160, block: BLOCKS[2] }),
              node({ id: "za3", y: 240, block: BLOCKS[3] }),
            ],
          },
        ],
      },
      opts,
    );
    const regions = (r.sketch.scenes[0]?.items ?? []).filter((i) => i.kind === "region") as {
      label?: string;
      opens?: string;
    }[];
    // STRONG covers 2 of 2; WEAKER covers 2 of 3.
    expect(regions.find((x) => x.label === "STRONG")?.opens).toBe("za");
    expect(regions.find((x) => x.label === "WEAKER")?.opens).toBeUndefined();
    expect(r.report.inferred).toBe(1);
  });

  it("does not offer a door back to the scene the reader is already in", () => {
    // A region inside `za` whose blocks are `za`'s own. Back is what that is for.
    const r = readSketch(
      {
        title: "t",
        caption: "c",
        scenes: [
          { id: "overview", title: "s", height: 400, items: [node({ id: "a", opens: "za" })] },
          {
            id: "za",
            title: "z",
            height: 400,
            items: [
              band({ label: "IN HERE" }),
              node({ id: "za0", x: 20, y: 60, block: BLOCKS[0] }),
              node({ id: "za1", x: 200, y: 60, block: BLOCKS[1] }),
            ],
          },
        ],
      },
      opts,
    );
    expect(regionOf(r, 1)?.opens).toBeUndefined();
  });

  it("ignores `opensInferred` written by the model — it is ours to set", () => {
    const r = drawing(
      [band({ opens: "zb", opensInferred: true })],
      [BLOCKS[0], BLOCKS[1]] as string[],
      [BLOCKS[9]] as string[],
      [BLOCKS[8]] as string[],
    );
    expect(regionOf(r)?.opens).toBe("zb");
    expect(regionOf(r)?.opensInferred).toBeUndefined();
  });

  it("keeps the derived door out of the artefact that gets written", () => {
    /* The write path runs `readSketch` too, so without the strip a door we
       worked out would be saved and read back tomorrow looking exactly like one
       the model drew — and `score.inferred` would then report 0 on a picture
       whose every door was ours. */
    const r = drawing(
      [band()],
      [BLOCKS[0], BLOCKS[1], BLOCKS[2]] as string[],
      [BLOCKS[0], BLOCKS[1], BLOCKS[2]] as string[],
      [BLOCKS[9]] as string[],
    );
    expect(regionOf(r)?.opens).toBe("za");

    const stored = stripInferredOpens(r.sketch);
    const region = (stored.scenes[0]?.items ?? []).find((i) => i.kind === "region") as {
      opens?: string;
      opensInferred?: true;
    };
    expect(region.opens).toBeUndefined();
    expect(region.opensInferred).toBeUndefined();

    // …and reading that stored picture puts the door back, from the blocks.
    const again = readSketch(JSON.parse(JSON.stringify(stored)), opts);
    const back = (again.sketch.scenes[0]?.items ?? []).find((i) => i.kind === "region") as {
      opens?: string;
      opensInferred?: true;
    };
    expect(back.opens).toBe("za");
    expect(back.opensInferred).toBe(true);
    expect(again.report.inferred).toBe(1);
  });

  it("leaves a link the model wrote alone when stripping", () => {
    const r = drawing(
      [band({ opens: "zb" })],
      [BLOCKS[0], BLOCKS[1]] as string[],
      [BLOCKS[9]] as string[],
      [BLOCKS[8]] as string[],
    );
    const stored = stripInferredOpens(r.sketch);
    const region = (stored.scenes[0]?.items ?? []).find((i) => i.kind === "region") as {
      opens?: string;
    };
    expect(region.opens).toBe("zb");
  });

  it("takes the scene off `unreachable` and puts it on `inferred`", () => {
    /* The two numbers answer different questions and both are needed: the
       reader can get there (unreachable 0), and the model did not say so
       (inferred 1). Without the second, a prompt that stopped asking for
       `opens` would look exactly like one that had not. */
    const r = drawing(
      [band()],
      [BLOCKS[0], BLOCKS[1], BLOCKS[2]] as string[],
      [BLOCKS[0], BLOCKS[1], BLOCKS[2]] as string[],
      [BLOCKS[9]] as string[],
    );
    const score = scoreSketch(r.sketch, r.report, opts);
    expect(score.unreachable).toBe(1); // `zb`, which nothing points at
    expect(score.inferred).toBe(1);
    expect(r.report.faults.map((f) => f.what).join(" ")).not.toContain("za");
  });
});

describe("cleanPath — the one string that reaches the renderer nearly as written", () => {
  it("accepts absolute M/L/C/Q/A/Z and numbers", () => {
    expect(cleanPath("M40 100 L360 100 C400 120 420 160 260 300 Z")).toBeTruthy();
    expect(cleanPath("M0 0 A50 50 0 0 1 100 100")).toBeTruthy();
  });

  it("refuses relative commands", () => {
    // They compound: one bad number moves everything after it off the canvas,
    // and there is no way to clamp the result without re-deriving the path.
    expect(cleanPath("M40 100 l20 20")).toBeNull();
    expect(cleanPath("M40 100 c1 2 3 4 5 6")).toBeNull();
  });

  it("refuses anything that is not a path", () => {
    expect(cleanPath('M0 0" onload="alert(1)')).toBeNull();
    expect(cleanPath("url(#x)")).toBeNull();
    expect(cleanPath("<script>")).toBeNull();
    expect(cleanPath("")).toBeNull();
  });

  it("refuses a path that does not begin with a move", () => {
    // A `d` starting with L has no defined current point; browsers vary.
    expect(cleanPath("L10 10 L20 20")).toBeNull();
  });

  it("refuses a path long enough to be a denial of service on its own", () => {
    expect(cleanPath(`M0 0${" L1 1".repeat(2000)}`)).toBeNull();
  });
});

describe("scoreSketch — the measures a prompt is iterated against", () => {
  const at = (i: number, y: number) => node({ id: `n${i}`, y, block: BLOCKS[i] });

  it("scores a picture that runs down the page with the article at 1", () => {
    const { sketch, report } = read([at(0, 20), at(3, 200), at(6, 400), at(9, 560)]);
    expect(scoreSketch(sketch, report, opts).flow).toBeCloseTo(1, 5);
  });

  it("scores an upside-down picture at −1", () => {
    // The failure this measure exists for: every other number is identical to
    // the case above, and the picture is unusable.
    const { sketch, report } = read([at(0, 560), at(3, 400), at(6, 200), at(9, 20)]);
    expect(scoreSketch(sketch, report, opts).flow).toBeCloseTo(-1, 5);
  });

  it("declines to score a flow it has fewer than three points for", () => {
    // Two nodes are always either in order or reversed; a tau of ±1 from two
    // points would be a confident number about nothing.
    const { sketch, report } = read([at(0, 20), at(9, 400)]);
    expect(scoreSketch(sketch, report, opts).flow).toBeNull();
  });

  it("measures the WIDEST unreached run, not the average one", () => {
    // Three marks, deliberately unevenly spread, because with one gap "widest"
    // and "average" are the same number and the test would pass either way.
    //
    // Blocks 0, 1 and 9 are linked. The unreached runs are therefore: nothing
    // before 0, nothing between 0 and 1, blocks 2–8 between 1 and 9 (SEVEN
    // blocks), and nothing after 9. Seven of ten.
    //
    // This expectation said 0.8 until 2026-08-30, which was the old
    // implementation's answer written down as if it were the right one: it
    // measured the *distance* between two marks (9 − 1 = 8) rather than the
    // count of blocks with no mark. A test that agrees with the code is not a
    // test of the code.
    const { sketch, report } = read([at(0, 20), at(1, 100), at(9, 400)]);
    expect(scoreSketch(sketch, report, opts).reach).toBeCloseTo(0.7, 5);
  });

  it("reports the whole article unreached when nothing is linked", () => {
    // The worst possible input, and the old arithmetic scored it at 0.9 —
    // better than a picture that reaches nine blocks in ten.
    const { sketch, report } = read([node({ id: "a", y: 20 })]);
    expect(scoreSketch(sketch, report, opts).reach).toBeCloseTo(1, 5);
  });

  it("takes overlap from the worst scene rather than pooling every scene", () => {
    // Two tidy zoom scenes must not dilute an overview whose boxes sit on top
    // of each other — the overview is the picture.
    const { sketch, report } = readSketch(
      {
        title: "t",
        caption: "c",
        scenes: [
          {
            id: "overview",
            title: "s",
            height: 600,
            items: [
              node({ id: "a", x: 0, y: 0, w: 100, h: 100 }),
              node({ id: "b", x: 50, y: 0, w: 100, h: 100 }),
            ],
          },
          {
            id: "zoom",
            title: "z",
            height: 600,
            items: [
              node({ id: "c", x: 0, y: 0, w: 100, h: 100 }),
              node({ id: "d", x: 400, y: 0, w: 100, h: 100 }),
            ],
          },
        ],
      },
      opts,
    );
    expect(scoreSketch(sketch, report, opts).overlap).toBeCloseTo(0.25, 5);
  });

  it("counts the run before the first node and after the last", () => {
    // A picture whose only node is in the middle reaches neither end, and a
    // reader scrolling either way finds nothing lighting up. Block 5 is linked,
    // so 0–4 is five and 6–9 is four; the widest is five of ten.
    const { sketch, report } = read([at(5, 300)]);
    expect(scoreSketch(sketch, report, opts).reach).toBeCloseTo(0.5, 5);
  });

  it("measures overlapping node area as a fraction of all node area", () => {
    const { sketch, report } = read([
      node({ id: "a", x: 0, y: 0, w: 100, h: 100 }),
      node({ id: "b", x: 50, y: 0, w: 100, h: 100 }),
    ]);
    // 50×100 of overlap against 2 × 100×100 of node.
    expect(scoreSketch(sketch, report, opts).overlap).toBeCloseTo(0.25, 5);
  });

  it("takes flow from the overview alone, not from every scene", () => {
    // A zoom scene draws one part of the article at its own scale, so its ys
    // restart from the top. Pooling them with the overview's would report a
    // scrambled picture for two pictures that are each perfectly ordered.
    const { sketch, report } = readSketch(
      {
        title: "t",
        caption: "c",
        scenes: [
          { id: "overview", title: "s", height: 600, items: [at(0, 20), at(4, 300), at(9, 560)] },
          { id: "zoom", title: "z", height: 600, items: [at(4, 20), at(5, 300), at(6, 560)] },
        ],
      },
      opts,
    );
    expect(scoreSketch(sketch, report, opts).flow).toBeCloseTo(1, 5);
  });
});

describe("nodeFits — text that will not fit its box", () => {
  const box = (over: Partial<SketchNode>): SketchNode => ({
    kind: "node",
    id: "n",
    shape: "box",
    x: 0,
    y: 0,
    w: 200,
    h: 40,
    text: "short",
    size: "sm",
    ...over,
  });

  it("passes text the box can hold", () => {
    expect(nodeFits(box({ text: "Brains are not computers" }))).toBe(true);
  });

  it("fails text the box cannot", () => {
    expect(nodeFits(box({ text: "Brains are not computers ".repeat(6), h: 30 }))).toBe(false);
  });

  it("fails a single word too long for the box, which is where the two routines used to disagree", () => {
    // The exact case that scored as fitting and rendered as `superc…`: one word
    // longer than the line. A word loop that counts spaces says one line; the
    // wrapper that actually draws it breaks the word across several.
    const long = box({ text: "supercalifragilisticexpialidocious", w: 60, h: 20 });
    expect(nodeFits(long)).toBe(false);
  });

  it("says a node fits exactly when nothing in it was cut", () => {
    // The property, rather than one example of it, across every shape — because
    // "fits" and "the drawn text is the whole text" are meant to be one
    // statement, and they were two for two rounds running.
    const cases: SketchNode[] = [
      box({ text: "short", w: 200, h: 40 }),
      box({ text: "supercalifragilisticexpialidocious", w: 60, h: 20 }),
      box({ text: "a fairly long claim about several things at once", w: 140, h: 44 }),
      box({ text: "two words", w: 90, h: 60, sub: "and a qualifier" }),
      box({ shape: "hex", text: "Twelve benefits of phrenology", w: 200, h: 90, size: "lg" }),
      box({ shape: "diamond", text: "Will anyone scale further?", w: 300, h: 90, size: "md" }),
      box({ shape: "ellipse", text: "We are more meat than machine", w: 240, h: 70 }),
      box({ shape: "pill", text: "Do not build conscious machines", w: 320, h: 76, size: "md" }),
    ];
    for (const n of cases) {
      const drawn = layoutNodeText(n);
      const whole = [drawn.lines.join(" "), drawn.sub ?? ""].join(" ");
      const wanted = [n.text, n.sub ?? ""].join(" ");
      expect(nodeFits(n)).toBe(whole.replace(/\s+/g, " ").trim() === wanted.replace(/\s+/g, " ").trim());
    }
  });

  it("measures a shape's width where the text sits, not at its widest point", () => {
    /* Their outlines cut in above and below the centre line, so text laid out
       to the bounding box sits OUTSIDE the shape while every check reports it
       fitting. Seen on the phrenology tract: a hexagon captioned
       "self-knowledge to moral perfection", the caption crossing both sloping
       sides, and `overflowing` reporting 0. */
    const n = (shape: SketchNode["shape"]) => box({ shape, w: 200, h: 100 });
    // At the centre line every shape here is its full width...
    for (const shape of ["box", "hex", "diamond", "ellipse"] as const) {
      expect(widthAt(n(shape), 0)).toBeCloseTo(200, 5);
    }
    // ...and away from it, only the box still is.
    expect(widthAt(n("box"), 40)).toBeCloseTo(200, 5);
    expect(widthAt(n("hex"), 40)).toBeLessThan(200);
    expect(widthAt(n("ellipse"), 40)).toBeLessThan(200);
    // A diamond closes to a point; an ellipse does too but more slowly.
    expect(widthAt(n("diamond"), 50)).toBeCloseTo(0, 5);
    expect(widthAt(n("diamond"), 40)).toBeLessThan(widthAt(n("ellipse"), 40));
  });

  it("catches a sub-line too long for the shape it is in", () => {
    // The sub gets one line and no wrap, so "does it fit" is a question about
    // characters rather than about height — and it was not being asked at all.
    // The real node off the phrenology tract, numbers and all — my first
    // fixture was 260 wide at `sm`, which is roomy enough that the sub fitted
    // and the test passed against the bug. The one that broke was 200 at `lg`,
    // where the sub gets 16 characters and was given 34.
    const real = box({
      shape: "hex",
      text: "Twelve benefits of phrenology",
      w: 200,
      h: 90,
      size: "lg",
    });
    expect(nodeFits(real)).toBe(true);
    expect(nodeFits({ ...real, sub: "self-knowledge to moral perfection" })).toBe(false);
  });

  it("counts the sub-line against the height", () => {
    // Two nodes that differ only in having a `sub`. Without this the sub was
    // free, and a box sized exactly to its title pushed its own second line out
    // of the bottom — where SVG draws it anyway, over whatever is below.
    const tight = { text: "Three lines of words here now", w: 120, h: 40 };
    expect(nodeFits(box(tight))).toBe(true);
    expect(nodeFits(box({ ...tight, sub: "a qualifier" }))).toBe(false);
  });

  it("needs more lines in a narrower box", () => {
    expect(linesNeeded("one two three four five six", 300, "sm")).toBeLessThan(
      linesNeeded("one two three four five six", 90, "sm"),
    );
  });
});

describe("accept — the line under which there is no picture at all", () => {
  const linked = (i: number, y: number) =>
    node({ id: `n${i}`, y, block: BLOCKS[i], x: 20 + i * 10 });

  /** Read and score in one go, the way `generateSketch` does. */
  function judge(raw: unknown) {
    const { sketch, report } = readSketch(raw, opts);
    return { verdict: accept(sketch, scoreSketch(sketch, report, opts)), sketch };
  }

  it("passes an ordinary picture", () => {
    const { verdict } = judge(scene([linked(0, 20), linked(3, 200), linked(6, 400), linked(9, 560)]));
    expect(verdict.refusals).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it("refuses an answer with no scenes at all", () => {
    // The failure this function exists for. `{"scenes": []}` came through
    // `readSketch` with ZERO faults, scored, and was written to disk as a
    // finished sketch — the reader waits two minutes, is billed, and gets a
    // blank band, with every check reporting success.
    const { verdict } = judge({ title: "t", caption: "c", scenes: [] });
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals.join(" ")).toContain("no overview");
  });

  it("refuses an overview of one or two boxes", () => {
    const { verdict } = judge(scene([linked(0, 20), linked(9, 400)]));
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals.join(" ")).toContain("fewer than");
  });

  it("refuses a picture with no caption, which is the claim a reader checks", () => {
    const { verdict } = judge({
      title: "t",
      caption: "",
      scenes: [{ id: "overview", title: "s", height: 600, items: [linked(0, 20), linked(4, 200), linked(9, 400)] }],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals.join(" ")).toContain("caption");
  });

  it("refuses a picture almost none of which can be clicked through", () => {
    // Pretty, and it is not a way into the article — which is half of what this
    // feature is for.
    const { verdict } = judge(
      scene([
        linked(0, 20),
        node({ id: "x", y: 200 }),
        node({ id: "y", y: 300 }),
        node({ id: "z", y: 400 }),
      ]),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals.join(" ")).toContain("clicked through");
  });

  it("refuses a picture drawn on top of itself", () => {
    const stack = [0, 3, 6, 9].map((i) =>
      node({ id: `n${i}`, x: 0, y: 0, w: 200, h: 200, block: BLOCKS[i] }),
    );
    const { verdict } = judge(scene(stack));
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals.join(" ")).toContain("over other nodes");
  });

  it("refuses a picture that runs the wrong way up the page", () => {
    // Every other measure is identical to the passing case above.
    const { verdict } = judge(scene([linked(0, 560), linked(3, 400), linked(6, 200), linked(9, 20)]));
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals.join(" ")).toContain("down the page");
  });

  it("does not refuse a picture merely for having too few linked nodes to score flow", () => {
    // `flow` is null under three linked nodes, and null is "we cannot tell",
    // not "it failed". The node-count and linkage rules have already had their
    // say about a picture that small.
    const { verdict } = judge(
      scene([linked(0, 20), linked(9, 400), node({ id: "j", y: 200 })]),
    );
    expect(verdict.refusals.join(" ")).not.toContain("down the page");
  });
});
