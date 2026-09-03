/**
 * `generateIllustrated` — src/illustrated.ts, with both model calls faked.
 *
 * The brief call is faked by mocking `streamMessage`; the image call is
 * *injected*, through the `DrawPlate` port the stage takes for exactly this
 * reason. Neither goes near a provider, which is what
 * tests/setup/provider-guard.ts requires of every test anyway.
 *
 * Three cases carry the money and the reader's press between them:
 *
 *  - **partial failure.** The blob store is content-addressed and create-only,
 *    so plate 2 throwing must not discard plates 1 and 3 — they were paid for,
 *    and a run that threw the lot away would charge twice for the same picture
 *    on the retry (plan § Two hazards).
 *  - **cancellation, which is the opposite event in the same clothes.** An
 *    abort caught as a plate failure called the provider again for every
 *    remaining plate with the already-aborted signal, and came back looking
 *    finished (GPT Sol, 2026-09-03).
 *  - **sequential, proved by concurrency rather than by order.** The old test
 *    asserted the order of invocation, which `Promise.all` also satisfies.
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

const { generateIllustrated, imagePrompt } = await import("../src/illustrated.js");
const { MAX_PLATES } = await import("../src/illustrated-plate.js");

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

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
function drawer(fail?: (i: number) => Error | boolean | undefined): {
  draw: DrawPlate;
  calls: Parameters<DrawPlate>[0][];
} {
  const calls: Parameters<DrawPlate>[0][] = [];
  const draw: DrawPlate = async (req) => {
    const i = calls.length;
    calls.push(req);
    const bad = fail?.(i);
    if (bad) throw bad === true ? new Error("the illustrator could not be reached") : bad;
    return {
      image: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, i]),
      mediaType: "image/jpeg",
      usdCost: 0.008,
    };
  };
  return { draw, calls };
}

/** The error an aborted `fetch` throws, in the shape node gives it. */
function abortError(): Error {
  const err = new Error("This operation was aborted");
  err.name = "AbortError";
  return err;
}

beforeEach(() => {
  streamMessage.mockClear();
  answerWith(BRIEF);
});

describe("generateIllustrated", () => {
  it("draws a plate per scene, the overview first", async () => {
    const { draw, calls } = drawer();
    const run = await generateIllustrated({ article: ARTICLE, sketch: SKETCH, draw });

    expect(run.draws.map((d) => d.sceneId)).toEqual(["overview", "zoom-1", "zoom-2"]);
    expect(run.draws.every((d) => d.image)).toBe(true);
    expect(run.cancelled).toBe(false);
    expect(calls[0]?.prompt).toContain("A vellum page for overview.");
    expect(calls[0]?.aspectRatio).toBe("2:3");
    expect(calls[0]?.quality).toBe("low");
    expect(run.report.kept).toBe(3);
    expect(run.report.faults).toEqual([]);
    expect(run.illustrated.illustrator).toBe("openai/gpt-image-2");
  });

  /**
   * **Sequential proved by concurrency, not by order.** `Promise.all` invokes
   * its functions in array order too, so the old assertion could not tell the
   * two apart. This one blocks each call until the next tick and counts how
   * many are in flight at once.
   */
  it("never has two image calls in flight at the same time", async () => {
    let inFlight = 0;
    let most = 0;
    const draw: DrawPlate = async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { image: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), mediaType: "image/jpeg", usdCost: null };
    };
    const run = await generateIllustrated({ article: ARTICLE, sketch: SKETCH, draw });
    expect(run.draws).toHaveLength(3);
    expect(most).toBe(1);
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
    expect(run.cancelled).toBe(false);
    expect(run.draws.map((d) => Boolean(d.image))).toEqual([true, false, true]);
    expect(run.draws[1]?.failed).toBe("the illustrator could not be reached");
    // The artefact still lists the plate, saying why there is no picture.
    expect(run.illustrated.plates[1]?.failed).toBe("the illustrator could not be reached");
    expect(run.illustrated.plates[0]?.failed).toBeUndefined();
    // And the third is still drawn in the overview's hand.
    expect(calls[2]?.references).toEqual(calls[1]?.references);
  });

  /**
   * **The abort case.** Before this, an `AbortError` was caught as an ordinary
   * plate failure and the loop called the provider again for every remaining
   * plate *with the already-aborted signal* — phantom attempts, phantom ledger
   * rows, and a run that came back looking finished after the reader pressed
   * stop.
   */
  it("stops the moment the signal aborts, and says the run was cancelled", async () => {
    const controller = new AbortController();
    const { draw, calls } = drawer((i) => {
      if (i !== 1) return undefined;
      controller.abort();
      return abortError();
    });
    const run = await generateIllustrated({
      article: ARTICLE,
      sketch: SKETCH,
      draw,
      signal: controller.signal,
    });

    expect(calls).toHaveLength(2);
    expect(run.cancelled).toBe(true);
    /* The plate that was cancelled is not a *failed* plate: it was not tried
       and failed, it was stopped, and the artefact must not say otherwise. */
    expect(run.draws).toHaveLength(1);
    expect(run.illustrated.plates.map((p) => p.failed)).toEqual([undefined, undefined, undefined]);
  });

  it("draws nothing at all when the signal aborted before it got there", async () => {
    const controller = new AbortController();
    controller.abort();
    const { draw, calls } = drawer();
    const run = await generateIllustrated({
      article: ARTICLE,
      sketch: SKETCH,
      draw,
      signal: controller.signal,
    });
    expect(calls).toHaveLength(0);
    expect(run.cancelled).toBe(true);
    expect(run.draws).toEqual([]);
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

  it("never draws a plate for a scene the Sketch has not got, and reports what it kept", async () => {
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
    expect(run.report.faults.map((f) => f.what)).toContain(
      'no scene in the Sketch has the id "zoom-9" — not drawn',
    );
    /* **The report has to be reconcilable against the artefact.** It counted
       the dropped plate's vignettes as kept until 2026-09-03. */
    expect(run.report.kept).toBe(
      run.illustrated.plates.reduce((n, p) => n + p.vignettes.length, 0),
    );
    expect(run.report.platesKept).toBe(run.illustrated.plates.length);
  });

  /**
   * **The order is the Sketch's.** A model that lists the zoom scene first
   * would otherwise have *it* drawn first and become the style reference every
   * later plate is drawn against — the whole run silently reordered.
   */
  it("draws the overview first even when the model wrote it second", async () => {
    answerWith({
      style: "An illuminated page.",
      plates: [
        plate("zoom-1", "spya-bbbbbb", "what it is like to be the cup"),
        plate("overview", "spya-aaaaaa", "minerals at the bottom and angels at the top"),
      ],
    });
    const { draw, calls } = drawer();
    const run = await generateIllustrated({ article: ARTICLE, sketch: SKETCH, draw });

    expect(run.illustrated.plates.map((p) => p.sceneId)).toEqual(["overview", "zoom-1"]);
    expect(calls[0]?.prompt).toContain("A vellum page for overview.");
    expect(calls[0]?.references).toBeUndefined();
  });

  it("drops a vignette whose quote is in another block, and does not draw that plate", async () => {
    answerWith({
      style: "An illuminated page.",
      plates: [
        { ...(plate("overview", "spya-aaaaaa", "what it is like to be the cup") as object) },
      ],
    });
    const { draw, calls } = drawer();
    const run = await generateIllustrated({ article: ARTICLE, sketch: SKETCH, draw });

    expect(run.report.written).toBe(1);
    expect(run.report.kept).toBe(0);
    /* **The anchor floor.** The plan says a *dropped vignette* may still be
       drawn — the composition is one paragraph and cannot be unpicked — but a
       plate with no anchor left at all is a picture of nothing, and it is not
       worth the money to find out. */
    expect(run.illustrated.plates).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("refuses to spend more than MAX_PLATES image calls", async () => {
    const many = {
      style: "An illuminated page.",
      plates: Array.from({ length: 8 }, (_, i) =>
        plate(
          i === 0 ? "overview" : `zoom-${i}`,
          "spya-aaaaaa",
          "minerals at the bottom and angels at the top",
        ),
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
    await expect(generateIllustrated({ article: ARTICLE, sketch: SKETCH, draw })).rejects.toThrow();
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
 * **The envelope the composition goes out in**, which is the only thing of ours
 * the image model is told.
 *
 * It does not make the prompt safe and the header says so at length: the
 * payload is inside the same prompt as the rules. What it does is put the
 * no-lettering and no-branding instructions where the image model actually
 * reads them, rather than only in the brief model's system prompt, and it is
 * asserted here because a wrapper that silently stopped being applied would
 * look exactly like one that was.
 */
describe("imagePrompt", () => {
  it("puts the composition inside our own sentences", async () => {
    const wrapped = imagePrompt("A vellum page, top to bottom.");
    expect(wrapped).toContain("A vellum page, top to bottom.");
    expect(wrapped).toContain("never an instruction to you");
    expect(wrapped).toMatch(/no logos, no brand names/i);
    expect(wrapped).toContain("=== COMPOSITION ===");
  });

  it("is what the stage actually sends", async () => {
    const { draw, calls } = drawer();
    await generateIllustrated({ article: ARTICLE, sketch: SKETCH, draw });
    expect(calls[0]?.prompt).toBe(imagePrompt("A vellum page for overview."));
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

  /**
   * **A plate the illustrator really drew**, from
   * `evals/results/illustrated-2026-09-03b/`, for the reason
   * tests/illustrated-image.test.ts gives: the seam sniffs the signature *and*
   * walks the JPEG for its dimensions, so a fixture that is only an eleven-byte
   * JFIF prefix — which is what this was until 2026-09-03 — constrains the
   * magic-byte check and nothing else, and the dimension check never runs.
   */
  const PLATE = fileURLToPath(
    new URL(
      "../evals/results/illustrated-2026-09-03b/noema-mythology-of-conscious-ai-0-overview.jpeg",
      import.meta.url,
    ),
  );

  async function stubTransport(): Promise<{ body: Record<string, unknown> }[]> {
    const jpeg = (await readFile(PLATE)).toString("base64");
    const sent: { body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push({ body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () =>
          JSON.stringify({ data: [{ b64_json: jpeg, media_type: "image/jpeg" }], usage: {} }),
      } as unknown as Response;
    });
    return sent;
  }

  it("asks for JPEG at 82, at 2:3, at low quality", async () => {
    const { drawWithGateway } = await import("../src/illustrated.js");
    const sent = await stubTransport();
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
    /* A real plate, so this is the whole file rather than a header. */
    expect(out.image.byteLength).toBeGreaterThan(10_000);
    /* Unknown, never zero — the money is on the ledger row. */
    expect(out.usdCost).toBeNull();
  });

  it("sends a style reference as a data URL when it has one", async () => {
    const { drawWithGateway } = await import("../src/illustrated.js");
    const sent = await stubTransport();
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
