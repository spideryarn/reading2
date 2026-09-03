/**
 * `generateIllustrated` — src/illustrated.ts, with both model calls faked.
 *
 * The brief call is faked by mocking `streamMessage`; the image call is
 * *injected*, through the `DrawPlate` port the stage takes for exactly this
 * reason. Neither goes near a provider, which is what
 * tests/setup/provider-guard.ts requires of every test anyway.
 *
 * The case with the money in it is **partial failure**. The blob store is
 * content-addressed and create-only, so plate 2 throwing must not discard
 * plates 1 and 3 — they were paid for, and a run that threw the lot away would
 * charge twice for the same picture on the retry
 * (docs/plans/260903c-illustrated-diagram-sub-mode.md § Two hazards).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const finalMessage = vi.fn();
const streamMessage = vi.fn(() => ({
  onText: (_: (delta: string) => void) => {},
  finalMessage,
  aborted: () => false,
}));

vi.mock("../src/messages-stream.js", () => ({
  streamMessage,
  wasRefused: () => false,
}));

const { generateIllustrated } = await import("../src/illustrated.js");
const { MAX_PLATES } = await import("../src/illustrated-plate.js");

import type { Article } from "../src/article-input.js";
import type { DrawPlate } from "../src/illustrated.js";
import type { Sketch, SketchScene } from "../src/sketch-scene.js";
import type { Block, Tree } from "../src/types.js";

const TEXT: Record<string, string> = {
  "spya-aaaaaa": "Aristotle's Scala Naturae put minerals at the bottom and angels at the top.",
  "spya-bbbbbb": "Seth picks up a coffee cup and asks what it is like to be the cup.",
  "spya-cccccc": "A brain in a jar would still be having a bad afternoon, on this account.",
};

function block(id: string): Block {
  const text = TEXT[id] as string;
  return {
    id,
    tag: "p",
    kind: "text",
    text,
    words: text.split(/\s+/).length,
    html: `<p>${text}</p>`,
    gistable: true,
    isStructural: false,
  } as Block;
}

const ARTICLE: Article = {
  slug: "noema",
  blocks: Object.keys(TEXT).map(block),
  tree: { slug: "noema", rootId: "r", nodes: { r: { id: "r", children: [] } } } as unknown as Tree,
  meta: null,
};

function scene(id: string, nodeId: string, blockId: string): SketchScene {
  return {
    id,
    title: `Scene ${id}`,
    height: 600,
    items: [
      {
        kind: "node",
        id: nodeId,
        shape: "box",
        x: 10,
        y: 10,
        w: 100,
        h: 40,
        text: "A claim",
        size: "md",
        block: blockId,
      },
    ],
  };
}

const SKETCH: Sketch = {
  version: "sketch/1",
  title: "Three things",
  caption: "A funnel into a converge.",
  scenes: [
    scene("overview", "n1", "spya-aaaaaa"),
    scene("zoom-1", "n2", "spya-bbbbbb"),
    scene("zoom-2", "n3", "spya-cccccc"),
  ],
};

function plate(sceneId: string, blockId: string, quote: string): unknown {
  return {
    sceneId,
    title: `Plate of ${sceneId}`,
    prompt: `A vellum page for ${sceneId}.`,
    vignettes: [{ node: "n1", block: blockId, quote, depicts: "A gilded ladder." }],
  };
}

/** What the brief model "answered", as a message the stage will accept. */
function answerWith(body: unknown, over: Record<string, unknown> = {}): void {
  finalMessage.mockResolvedValue({
    content: [{ type: "text", text: JSON.stringify(body) }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1000, output_tokens: 6302 },
    ...over,
  });
}

const BRIEF = {
  style: "An illuminated page.",
  plates: [
    plate("overview", "spya-aaaaaa", "minerals at the bottom and angels at the top"),
    plate("zoom-1", "spya-bbbbbb", "what it is like to be the cup"),
    plate("zoom-2", "spya-cccccc", "would still be having a bad afternoon"),
  ],
};

/** A `draw` that succeeds, remembering what it was asked. */
function drawer(fail?: (i: number) => boolean): {
  draw: DrawPlate;
  calls: Parameters<DrawPlate>[0][];
} {
  const calls: Parameters<DrawPlate>[0][] = [];
  const draw: DrawPlate = async (req) => {
    const i = calls.length;
    calls.push(req);
    if (fail?.(i)) throw new Error("the illustrator could not be reached");
    return {
      image: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, i]),
      mediaType: "image/jpeg",
      usdCost: 0.008,
    };
  };
  return { draw, calls };
}

beforeEach(() => {
  streamMessage.mockClear();
  answerWith(BRIEF);
});

describe("generateIllustrated", () => {
  it("draws a plate per scene, the overview first and sequentially", async () => {
    const { draw, calls } = drawer();
    const run = await generateIllustrated({ article: ARTICLE, sketch: SKETCH, draw });

    expect(run.draws.map((d) => d.sceneId)).toEqual(["overview", "zoom-1", "zoom-2"]);
    expect(run.draws.every((d) => d.image)).toBe(true);
    expect(calls[0]?.prompt).toBe("A vellum page for overview.");
    expect(calls[0]?.aspectRatio).toBe("2:3");
    expect(calls[0]?.quality).toBe("low");
    expect(run.report.kept).toBe(3);
    expect(run.report.faults).toEqual([]);
    expect(run.illustrated.illustrator).toBe("openai/gpt-image-2");
  });

  /**
   * The style-continuity finding of 2026-09-03: without the overview going
   * along, separately drawn plates come back looking like different books.
   * The overview itself is drawn with no reference — the plan's other finding,
   * that the *Sketch's* rendered SVG buys nothing and costs 2.5×.
   */
  it("passes the overview's bytes to every later plate and nothing to the first", async () => {
    const { draw, calls } = drawer();
    await generateIllustrated({ article: ARTICLE, sketch: SKETCH, draw });

    expect(calls[0]?.references).toBeUndefined();
    const overview = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]).toString("base64");
    expect(calls[1]?.references).toEqual([{ dataUrl: `data:image/jpeg;base64,${overview}` }]);
    // The same reference on the third, not the second plate's own bytes.
    expect(calls[2]?.references).toEqual(calls[1]?.references);
  });

  it("keeps the plates that were paid for when one in the middle fails", async () => {
    const { draw, calls } = drawer((i) => i === 1);
    const run = await generateIllustrated({ article: ARTICLE, sketch: SKETCH, draw });

    expect(calls).toHaveLength(3);
    expect(run.draws.map((d) => Boolean(d.image))).toEqual([true, false, true]);
    expect(run.draws[1]?.failed).toBe("the illustrator could not be reached");
    // The artefact still lists the plate, saying why there is no picture.
    expect(run.illustrated.plates[1]?.failed).toBe("the illustrator could not be reached");
    expect(run.illustrated.plates[0]?.failed).toBeUndefined();
    // And the third is still drawn in the overview's hand.
    expect(calls[2]?.references).toEqual(calls[1]?.references);
  });

  /**
   * If the overview itself fails there is no first plate to be the hand, so the
   * earliest picture there *is* becomes it. A run whose plates look like
   * different books reads as broken whichever one went missing.
   */
  it("falls back to the first plate that came back as the style reference", async () => {
    const { draw, calls } = drawer((i) => i === 0);
    const run = await generateIllustrated({ article: ARTICLE, sketch: SKETCH, draw });

    expect(run.draws[0]?.failed).toBeTruthy();
    expect(calls[1]?.references).toBeUndefined();
    const second = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]).toString("base64");
    expect(calls[2]?.references).toEqual([{ dataUrl: `data:image/jpeg;base64,${second}` }]);
  });

  it("never draws a plate for a scene the Sketch has not got", async () => {
    answerWith({
      style: "An illuminated page.",
      plates: [
        plate("overview", "spya-aaaaaa", "minerals at the bottom and angels at the top"),
        plate("zoom-9", "spya-bbbbbb", "what it is like to be the cup"),
      ],
    });
    const { draw, calls } = drawer();
    const run = await generateIllustrated({ article: ARTICLE, sketch: SKETCH, draw });

    expect(calls).toHaveLength(1);
    expect(run.illustrated.plates.map((p) => p.sceneId)).toEqual(["overview"]);
    expect(run.report.faults.map((f) => f.where)).toContain("zoom-9");
  });

  it("drops a vignette whose quote is in another block, and still draws", async () => {
    answerWith({
      style: "An illuminated page.",
      plates: [
        {
          ...(plate("overview", "spya-aaaaaa", "what it is like to be the cup") as object),
        },
      ],
    });
    const { draw } = drawer();
    const run = await generateIllustrated({ article: ARTICLE, sketch: SKETCH, draw });

    expect(run.report.written).toBe(1);
    expect(run.report.kept).toBe(0);
    expect(run.illustrated.plates[0]?.vignettes).toEqual([]);
    // The picture is still drawn — the prompt is the model's, and the plan says
    // so out loud rather than pretending a drop keeps it out of the picture.
    expect(run.draws[0]?.image).toBeTruthy();
  });

  it("refuses to spend more than MAX_PLATES image calls", async () => {
    const many = {
      style: "An illuminated page.",
      plates: Array.from({ length: 8 }, (_, i) =>
        plate(i === 0 ? "overview" : `zoom-${i}`, "spya-aaaaaa", "minerals at the bottom and angels at the top"),
      ),
    };
    answerWith(many);
    const big: Sketch = {
      ...SKETCH,
      scenes: [
        scene("overview", "n1", "spya-aaaaaa"),
        ...Array.from({ length: 7 }, (_, i) => scene(`zoom-${i + 1}`, `n${i + 2}`, "spya-aaaaaa")),
      ],
    };
    const { draw, calls } = drawer();
    const run = await generateIllustrated({ article: ARTICLE, sketch: big, draw });

    expect(calls.length).toBe(MAX_PLATES);
    expect(run.illustrated.plates).toHaveLength(MAX_PLATES);
  });

  /**
   * The 2026-09-03 spike lost a whole pass to `max_tokens` at 8,000. A half
   * brief is not half a picture, so it fails rather than being read.
   */
  it("fails loudly on a truncated brief rather than reading half of one", async () => {
    answerWith(BRIEF, { stop_reason: "max_tokens" });
    const { draw, calls } = drawer();
    await expect(
      generateIllustrated({ article: ARTICLE, sketch: SKETCH, draw }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("reports the brief call's tokens and time separately from the plates'", async () => {
    const { draw } = drawer();
    const run = await generateIllustrated({ article: ARTICLE, sketch: SKETCH, draw });
    expect(run.outputTokens).toBe(6302);
    expect(run.inputTokens).toBe(1000);
    expect(run.draws.reduce((n, d) => n + (d.usdCost ?? 0), 0)).toBeCloseTo(0.024, 5);
    expect(run.briefMs).toBeLessThanOrEqual(run.elapsedMs);
  });
});

/**
 * **What the default port actually puts on the wire.**
 *
 * Every test above injects `draw`, which is the right way to test the stage and
 * says nothing at all about the one adapter that is not injected. This is the
 * gap that check leaves: `drawWithGateway` is a translation between two shapes
 * — this file's `DrawPlate` and `ImageRequest` in src/ai-call.ts — and a
 * translation that drops a field is invisible from either side. It has already
 * been wrong once: the first version spelled the keys the way the wire does
 * (`aspect_ratio`, `input_references`), which `ImageRequest` silently ignores.
 *
 * The JPEG pair is the one worth pinning. `output_format` is **not** in this
 * model's `supported_parameters`, so nothing upstream will complain if it stops
 * being sent — the plate simply comes back as a 3.5 MB PNG instead of a 160 KB
 * JPEG, twenty-two times the bytes, with every test still green.
 */
describe("drawWithGateway", () => {
  beforeEach(() => vi.stubEnv("OPENROUTER_API_KEY", "sk-test-key"));
  afterEach(() => vi.unstubAllGlobals());

  /** A one-pixel JPEG, so `readPlate` reads a real signature rather than a claim. */
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);

  function stubTransport(): { body: Record<string, unknown> }[] {
    const sent: { body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push({ body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () =>
          JSON.stringify({
            data: [{ b64_json: JPEG.toString("base64"), media_type: "image/jpeg" }],
            usage: {},
          }),
      } as unknown as Response;
    });
    return sent;
  }

  it("asks for JPEG at 82, at 2:3, at low quality", async () => {
    const { drawWithGateway } = await import("../src/illustrated.js");
    const sent = stubTransport();
    const out = await drawWithGateway({
      prompt: "an illuminated page of the argument",
      aspectRatio: "2:3",
      quality: "low",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toMatchObject({
      model: "openai/gpt-image-2",
      aspect_ratio: "2:3",
      quality: "low",
      output_format: "jpeg",
      output_compression: 82,
    });
    /* No references on a first plate, and absent rather than `[]` — the range
       is 0-16 and an empty array is a value nothing has been measured against. */
    expect(sent[0]?.body).not.toHaveProperty("input_references");
    /* From the bytes' own signature, which is why this port adds no check of
       its own: one place decides what a plate is. */
    expect(out.mediaType).toBe("image/jpeg");
    /* Unknown, never zero — the money is on the ledger row. */
    expect(out.usdCost).toBeNull();
  });

  it("sends a style reference as a data URL when it has one", async () => {
    const { drawWithGateway } = await import("../src/illustrated.js");
    const sent = stubTransport();
    await drawWithGateway({
      prompt: "the second plate, in the same hand",
      aspectRatio: "2:3",
      quality: "low",
      references: [{ dataUrl: "data:image/jpeg;base64,AAAA" }],
    });
    expect(sent[0]?.body.input_references).toEqual([
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } },
    ]);
  });
});
