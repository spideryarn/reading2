/**
 * **The `illustrated` step's registration, asked as effects rather than as
 * lists** — modelled on tests/quiz-step-registration.test.ts, which explains at
 * length why the two silent registration bugs (the stamp field names, and a
 * `STAMP_SOURCE` row that says the wrong thing) are invisible to every other
 * kind of test.
 *
 * This stage has a third way to be silently wrong that no other stage here has,
 * and it is the one most of this file is about: **its input is another step's
 * artefact.**
 *
 *  - **The fingerprint is the Sketch, not the article.** A forced Sketch redraw
 *    changes the scene with every article byte identical. An article-shaped
 *    stamp — which is what every neighbouring stage uses, so it is what a
 *    copy-paste produces — would leave a stale illustration reporting itself
 *    current, and the reader would go on looking at a painting of an argument
 *    nobody is making any more. That failure writes a perfectly good artefact
 *    and reddens nothing.
 *  - **The step must refuse rather than illustrate the wrong thing.**
 *    `useStepJob` posts `steps: [step]` and pipeline order pulls no
 *    prerequisites in, so a run with no Sketch has to fail with a sentence a
 *    reader can act on — not crash, and not enqueue a Sketch behind their back,
 *    which turns one press into a hidden $0.20 charge.
 *
 * Both model calls are stubbed, so the real `generateIllustrated` runs end to
 * end and nothing reaches the network.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { readArticle } from "../src/article-input.js";
import { isBodyEvidence } from "../src/block-policy.js";
import { inputFingerprint as illustratedFingerprint } from "../src/illustrated.js";
import type { Illustrated } from "../src/illustrated-plate.js";
import { STEPS, stepIsDone } from "../src/pipeline.js";
import type { StepContext } from "../src/pipeline.js";
import type { Sketch } from "../src/sketch-scene.js";
import { createFsArtifactStore } from "../src/store/artifacts-fs.js";
import { STAMP_SOURCE } from "../src/store/artifacts.js";
import type { ArtifactStore } from "../src/store/artifacts.js";
import { nullCheckpointStore } from "../src/store/checkpoints.js";

/* ------------------------------------------------------- the stubbed models -- */

/**
 * Two counters, because there are two calls and they cost different money.
 *
 * `briefCalls` is `streamMessage`, which is the one that writes the `ai_calls`
 * row for the brief — 86-89% of the bill. `plateCalls` is `openRouterImage`.
 * "Skips and spends nothing" is both being zero, measured where the charge is
 * incurred rather than by reading a ledger.
 */
const answers: string[] = [];
let briefCalls = 0;
let plateCalls = 0;

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: () => {
      briefCalls++;
      const text = answers.shift();
      if (text === undefined) throw new Error("the stub ran out of scripted answers");
      const message = {
        id: "msg_stub",
        type: "message",
        role: "assistant",
        model: "stub",
        content: [{ type: "text", text, citations: null }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
      return {
        onText: () => undefined,
        aborted: () => false,
        finalMessage: () => Promise.resolve(message),
      };
    },
  };
});

/** A real plate, so `storePlateImage`'s JPEG header walk is exercised for real. */
let PLATE: Uint8Array = new Uint8Array();

vi.mock("../src/ai-call.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/ai-call.js")>();
  return {
    ...real,
    openRouterImage: () => {
      plateCalls++;
      return Promise.resolve({ image: PLATE, mediaType: "image/jpeg" });
    },
  };
});

/**
 * **The blob store, pointed at a temp directory.**
 *
 * `storePlateImage` takes an injectable store and the pipeline step uses the
 * default, which follows the process's credentials — so without this the test
 * would write a plate into `data/_blobs/` in the checkout, or into a real
 * Supabase bucket if the machine happens to have a service key. Only
 * `blobStore` is replaced; `storeRawSource`, `CONTENT_TYPE` and the rest stay
 * the real thing, which is the whole point of putting a plate through it.
 */
let blobDir = "";
vi.mock("../src/store/blobs.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/store/blobs.js")>();
  const { fsBlobs } = await import("../src/store/blobs-fs.js");
  return { ...real, blobStore: () => fsBlobs(blobDir) };
});

/* --------------------------------------------------------------- the fixture -- */

const REPO = path.resolve(import.meta.dirname, "..");
const SLUG = "noema-mythology-of-conscious-ai";
const PLATES = path.join(REPO, "evals", "results", "illustrated-2026-09-03b");

let root = "";
let store: ArtifactStore;

function ctxFor(): StepContext {
  return {
    slug: SLUG,
    dir: path.join(root, "data", SLUG),
    htmlFile: path.join(root, "output", `${SLUG}.html`),
    report: () => undefined,
    signal: new AbortController().signal,
    cacheArticle: false,
  };
}

/**
 * A Sketch with two scenes, written straight to disk rather than through
 * `store.write`.
 *
 * Straight to disk because this fixture is the illustrated step's *input* and
 * nothing here is testing how a Sketch gets stamped — going through the store
 * would mean computing the sketch stage's own fingerprint, which is a fact
 * about a different stage. `caption` on the second scene so that the two are
 * not byte-identical.
 */
function sketchFixture(title = "Two arguments, one conclusion"): Sketch {
  return {
    version: "sketch/1",
    generator: "stub",
    slug: SLUG,
    title,
    caption: "What the piece argues, in two moves.",
    profileHash: null,
    scenes: [
      {
        id: "overview",
        title: "The whole argument",
        height: 600,
        items: [
          { kind: "node", id: "n1", shape: "box", x: 10, y: 10, w: 100, h: 40, text: "The claim", size: "md" },
        ],
      },
      {
        id: "inside",
        title: "Inside the claim",
        caption: "The same move, closer up.",
        height: 400,
        items: [
          { kind: "node", id: "n2", shape: "box", x: 10, y: 10, w: 100, h: 40, text: "The evidence", size: "md" },
        ],
      },
    ],
  } as Sketch;
}

async function writeSketch(sketch: Sketch | null): Promise<void> {
  const at = path.join(root, "data", SLUG, "sketch.json");
  if (sketch === null) {
    await rm(at, { force: true });
    return;
  }
  await writeFile(at, JSON.stringify(sketch, null, 2));
}

async function readSketch(): Promise<Sketch> {
  return JSON.parse(
    await readFile(path.join(root, "data", SLUG, "sketch.json"), "utf-8"),
  ) as Sketch;
}

/**
 * What the stubbed brief model answers: one plate per scene, each with two
 * vignettes quoting real blocks of the fixture article.
 *
 * Real quotes rather than invented ones because `readModelBrief` checks each
 * against **that block's own text** — an invented one would be dropped and the
 * plate would go with it, and the test would then be exercising the empty case
 * while appearing to exercise the full one.
 */
async function script(): Promise<void> {
  const article = await readArticle(SLUG, store);
  const usable = article.blocks.filter(isBodyEvidence).filter((b) => b.text.length > 200);
  if (usable.length < 4) throw new Error("the fixture has too few quotable blocks");
  const vignettesFrom = (from: number) =>
    usable.slice(from, from + 2).map((block) => ({
      block: block.id,
      quote: block.text.slice(0, 120),
      depicts: "A monk at a lectern, copying the passage into a margin.",
    }));
  answers.length = 0;
  answers.push(
    JSON.stringify({
      style: "An illuminated manuscript page, because the essay's own idiom is vellum and gold.",
      plates: [
        {
          sceneId: "overview",
          title: "The whole argument",
          prompt: "A single vellum page, top to bottom, with the claim at its head.",
          vignettes: vignettesFrom(0),
        },
        {
          sceneId: "inside",
          title: "Inside the claim",
          prompt: "The same hand, one panel, the evidence set out beneath the claim.",
          vignettes: vignettesFrom(2),
        },
      ],
    }),
  );
}

/** Run the stage for real and write what it produced, exactly as `jobs.ts` does. */
async function runAndWrite(): Promise<Illustrated> {
  await script();
  const ctx = ctxFor();
  const result = await STEPS.illustrated.run(ctx, store, nullCheckpointStore());
  expect(answers, "the stub ran short — the stage took a path this file did not intend").toEqual([]);
  const illustrated = result.parts?.illustrated as Illustrated;
  const stamp = await STEPS.illustrated.stamp?.(ctx, store);
  if (!stamp) throw new Error("the illustrated step's stamp answered null for a readable sketch");
  await store.write(SLUG, "illustrated", { illustrated }, stamp);
  return illustrated;
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "spya-illustrated-"));
  blobDir = path.join(root, "_blobs");
  await cp(path.join(REPO, "example"), path.join(root, "data", SLUG), { recursive: true });
  const names = (await import("node:fs/promises")).readdir;
  const jpegs = (await names(PLATES)).filter((n) => n.endsWith(".jpeg")).sort();
  const first = jpegs[0];
  if (!first) throw new Error("no plates in evals/results/illustrated-2026-09-03b/");
  PLATE = new Uint8Array(await readFile(path.join(PLATES, first)));
  store = createFsArtifactStore((slug) => ({
    dir: path.join(root, "data", slug),
    htmlFile: path.join(root, "output", `${slug}.html`),
  }));
}, 30_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  briefCalls = 0;
  plateCalls = 0;
  await rm(path.join(root, "data", SLUG, "illustrated.json"), { force: true });
  await rm(path.join(root, "data", SLUG, "steps"), { recursive: true, force: true });
  await writeSketch(sketchFixture());
});

/* ------------------------------------------------------------ the refusal -- */

describe("the step refuses rather than illustrating the wrong argument", () => {
  it("says which chip to press when there is no Sketch at all", async () => {
    await writeSketch(null);
    await script();
    await expect(STEPS.illustrated.run(ctxFor(), store, nullCheckpointStore())).rejects.toThrow(
      /Draw the Sketch first/,
    );
    /* **And nothing was spent finding out.** A stage that refused *after* the
       brief call would have cost $0.30 to say "press the other button". */
    expect(briefCalls, "the refusal must come before the brief call").toBe(0);
    expect(plateCalls).toBe(0);
  });

  it("refuses a Sketch with an empty scene list, which a hand edit can produce", async () => {
    await writeSketch({ ...sketchFixture(), scenes: [] });
    await script();
    await expect(STEPS.illustrated.run(ctxFor(), store, nullCheckpointStore())).rejects.toThrow(
      /Draw the Sketch first/,
    );
    expect(briefCalls).toBe(0);
  });

  it("does not enqueue a Sketch behind the reader's back", async () => {
    /* The tempting alternative to refusing, and the plan says why it is worse:
       one press becomes a hidden $0.20 charge and a three-minute wait nothing
       warned about. Asked as *no sketch was written* rather than as a claim
       about the code. */
    await writeSketch(null);
    await script();
    await expect(
      STEPS.illustrated.run(ctxFor(), store, nullCheckpointStore()),
    ).rejects.toThrow();
    expect(await store.read(SLUG, "sketch", "sketch")).toBeNull();
  });
});

/* -------------------------------------------------------------- the stamp -- */

describe("what the store records when the illustrated step has run", () => {
  it("names the illustrated artefact in STAMP_SOURCE, and does not say null", () => {
    expect(STAMP_SOURCE.illustrated).toBe("illustrated");
  });

  it("stamps an illustration it can read back, and the stamp is the one the step expects", async () => {
    await runAndWrite();

    const recorded = await store.stampFor(SLUG, "illustrated");
    const expected = await STEPS.illustrated.stamp?.(ctxFor(), store);

    /* Non-empty first and separately: `{}` and `{}` are deeply equal, which is
       exactly the shape of the stamp-field-name bug. */
    expect(recorded, "stampFor answered null — is there a STAMP_SOURCE row?").not.toBeNull();
    expect(recorded?.inputHash, "the artefact carries no sourceHash").toEqual(expect.any(String));
    expect(recorded?.promptVersion, "the artefact carries no version").toEqual(expect.any(String));
    expect(recorded?.model, "the artefact carries no generator").toEqual(expect.any(String));

    expect(recorded).toEqual(expected);
  });

  it("spells the three stamp fields the store's way and not the StepStamp way", async () => {
    const illustrated = (await runAndWrite()) as unknown as Record<string, unknown>;
    for (const name of ["sourceHash", "version", "generator"]) {
      expect(illustrated, `${name} is the on-disk name and must be present`).toHaveProperty(name);
    }
    for (const wrong of ["inputHash", "promptVersion", "model"]) {
      expect(illustrated, `${wrong} is the in-memory name and must not be on disk`).not.toHaveProperty(wrong);
    }
  });

  it("stamps the hash of the Sketch it was painted from", async () => {
    /* Stated directly as well as through `stampFor`, because this is the one
       value a copy-paste from a neighbouring stage gets wrong while everything
       else in this file stays green. */
    const illustrated = await runAndWrite();
    expect(illustrated.sourceHash).toBe(illustratedFingerprint(await readSketch()));
  });

  it("inherits the Sketch's profileHash rather than taking the reader's", async () => {
    await writeSketch({ ...sketchFixture(), profileHash: "abc123" });
    await script();
    const result = await STEPS.illustrated.run(ctxFor(), store, nullCheckpointStore());
    const written = result.parts?.illustrated as Illustrated | undefined;
    expect(written?.profileHash).toBe("abc123");
  });
});

/* ------------------------------------------------------------- the bytes -- */

describe("the plates", () => {
  it("puts each plate in the blob store and keeps only its hash in the artefact", async () => {
    const illustrated = await runAndWrite();
    expect(plateCalls).toBe(2);
    for (const plate of illustrated.plates) {
      expect(plate.image?.sha256, plate.sceneId).toMatch(/^[0-9a-f]{64}$/);
      expect(plate.image?.ext).toBe("jpeg");
      expect(plate.image?.bytes).toBe(PLATE.byteLength);
      /* The measured aspect of a `2:3` plate, read out of the JPEG's own SOF —
         so a header walk that landed on the wrong marker fails here too. */
      expect((plate.image?.height ?? 0) / (plate.image?.width ?? 1)).toBeCloseTo(1.5, 2);
    }
    /* **And no bytes in the artefact.** Base64 here would be dragged along by
       every read of the revision that named the column. */
    expect(JSON.stringify(illustrated)).not.toMatch(/[A-Za-z0-9+/]{500}/);
  });

  it("records the failure on the plate rather than throwing the run away", async () => {
    /* **The orphan case, from the other side.** Both plates are drawn and paid
       for; the second cannot be stored because the bytes are not a JPEG. The
       run must keep the first. */
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const good = PLATE;
    let nth = 0;
    const call = await import("../src/ai-call.js");
    const spy = vi.spyOn(call, "openRouterImage").mockImplementation(() => {
      plateCalls++;
      nth += 1;
      return Promise.resolve({
        image: nth === 1 ? good : png,
        mediaType: nth === 1 ? "image/jpeg" : "image/png",
      } as Awaited<ReturnType<typeof call.openRouterImage>>);
    });
    try {
      await script();
      const result = await STEPS.illustrated.run(ctxFor(), store, nullCheckpointStore());
      const plates = (result.parts?.illustrated as Illustrated | undefined)?.plates ?? [];
      expect(plates[0]?.image?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(plates[1]?.image).toBeUndefined();
      expect(plates[1]?.failed).toMatch(/must be image\/jpeg/);
    } finally {
      spy.mockRestore();
    }
  });
});

/* -------------------------------------------------------------- freshness -- */

describe("running the step again", () => {
  it("skips, and spends nothing, when nothing has moved", async () => {
    await runAndWrite();

    briefCalls = 0;
    plateCalls = 0;
    expect(await stepIsDone(STEPS.illustrated, ctxFor(), store)).toBe(true);
    expect(briefCalls, "deciding whether to skip must not call the model").toBe(0);
    expect(plateCalls).toBe(0);
  });

  it("does not skip when the SKETCH is redrawn and the article has not moved", async () => {
    /* **The whole reason this stage's fingerprint is not the article's.** Every
       byte of every block is identical here; only the scene has changed. An
       article-shaped stamp — which is what every neighbouring stage uses — says
       "current", and the reader goes on looking at a painting of an argument
       nobody is making. */
    await runAndWrite();
    const before = await readFile(path.join(root, "data", SLUG, "blocks.json"), "utf-8");

    await writeSketch(sketchFixture("Three arguments, one conclusion"));

    expect(await stepIsDone(STEPS.illustrated, ctxFor(), store)).toBe(false);
    expect(
      await readFile(path.join(root, "data", SLUG, "blocks.json"), "utf-8"),
      "the article must not have moved, or this test proves nothing",
    ).toBe(before);
  });

  it("stays current when the ARTICLE moves and the Sketch has not been redrawn", async () => {
    /* The negative control for the one above, and it is a real product
       decision rather than an accident: what this stage was painted from is the
       scene, so a changed article does not make the painting a painting of
       something else. The *Sketch* goes stale, its own row says so, and
       `loadIllustrated` reports that staleness to the panel — which is a
       different question from whether this step would be run again. */
    await runAndWrite();

    const at = path.join(root, "data", SLUG, "blocks.json");
    const file = JSON.parse(await readFile(at, "utf-8")) as { blocks: { text: string }[] };
    const first = file.blocks[0];
    if (!first) throw new Error("the fixture has no blocks");
    first.text = `${first.text} — and one more sentence the illustrator never saw.`;
    await writeFile(at, JSON.stringify(file, null, 2));
    try {
      expect(await stepIsDone(STEPS.illustrated, ctxFor(), store)).toBe(true);
    } finally {
      await cp(path.join(REPO, "example", "blocks.json"), at);
    }
  });
});
