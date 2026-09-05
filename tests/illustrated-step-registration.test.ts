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
 *
 * ## The store here is a fake, and it always was one
 *
 * Until 2026-09-05 it was a `createFsArtifactStore` over a copy of `example/`,
 * with the Sketch written straight to `sketch.json` beside it. Nothing here is a
 * claim about files: the store appears so that a stage has somewhere to read its
 * input from and somewhere to record a stamp — the `store-agnostic-fake` verdict
 * in [store-migration-registry.ts](store-migration-registry.ts). It is
 * `memoryArtefactsFrom` now, so stage G of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * can delete `src/store/artifacts-fs.ts` without this file noticing.
 *
 * **Two cases changed meaning rather than moving, and this is the reason to read
 * this paragraph.** *does not skip when the SKETCH is redrawn* and *stays current
 * when the ARTICLE moves* both used to edit `blocks.json` on the disk and assert
 * about it. With the store in memory a disk edit reaches nothing, so the first
 * one's control would have become a constant — *the article has not moved* said
 * of a file nothing was ever going to touch — and the second would have asserted
 * that an article which never moved is still current. Both now move the blocks
 * **in the store**, which is where the stage reads them.
 *
 * **And moving them in the store was not enough, which the review caught and the
 * paragraph above did not.** The memory fake handed back its own object until
 * later the same day, so `read`, edit a block, `plant` it back was editing the
 * store at the *edit* and the `plant` was decoration. Measured: with the aliasing
 * in place, deleting the `plant` line from this file **and** from
 * `quiz-step-registration` left all 28 cases across the two files green. The fake
 * detaches now (helpers/memory-artefacts.ts § `detach`) — and *stays current when
 * the ARTICLE moves* needed one more thing on top of that, because its assertion
 * is `true` and an article that never moved answers `true` as well. It carries a
 * positive control now, asking the store what it actually holds. With both fixes
 * in, deleting the two `plant` lines reddens one case in each file.
 *
 * **Mutation.** Run 2026-09-05. (1) `inputFingerprint` in src/illustrated.ts made
 * to hash `{ slug }` instead of the whole Sketch — the article-shaped stamp this
 * file exists to forbid: **1 of 22 red**, and it is exactly *does not skip when
 * the SKETCH is redrawn and the article has not moved*. One red rather than
 * several is the right answer here; that single case is the whole of the claim.
 * (2) `memoryArtefacts().forget` made a no-op, so *taking the Sketch away* stops
 * working: **2 red** — *says which chip to press when there is no Sketch at all*
 * and *does not enqueue a Sketch behind the reader's back*, both because the
 * step then finds a Sketch and succeeds. That is the refusal half of the file
 * proving it depends on the absence rather than on the stub. (3) Added
 * 2026-09-05 after the review: with the fake detaching and the new positive
 * control in place, deleting the `store.plant` line from *stays current when the
 * ARTICLE moves* reddens it — *the article must really have moved in the store*.
 * Before the detach the same deletion left it green, which is what "the plant
 * was decoration" means as a measurement rather than a claim. (4) Round 2 of the
 * review found the same shape in three more cases, and it did not come from the
 * conversion: the Sketch-freshness block's three **negative** controls — stale,
 * profile-changed, and no Sketch at all — each expect `false`, and `beforeEach`'s
 * own Sketch is *already* not current because it carries this file's `"stub"`
 * generator. So deleting any of the three `writeSketch` setup lines left the
 * case green. Each now asserts what the store actually holds first — the bogus
 * `sourceHash`, the foreign `profileHash`, `null` — and deleting the setup line
 * reddens all three, on their own preconditions rather than on `stepIsDone`.
 *
 * **Blind to.** Where an artefact physically lives; and the *blob* half stays a
 * real filesystem store on purpose — `fsBlobs` is out of this migration's scope
 * (src/store/blobs-fs.ts is selected by credentials, not by the flag), and
 * putting a real JPEG through `storePlateImage` is the point of that mock.
 */
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { readArticle } from "../src/article-input.js";
import { readerFailureOf } from "../src/job-failure.js";
import { isBodyEvidence } from "../src/block-policy.js";
import { inputFingerprint as illustratedFingerprint } from "../src/illustrated.js";
import { hashProfile, profileIsStale } from "../src/profile.js";
import {
  inputFingerprint as sketchFingerprint,
  isStale as sketchIsStale,
} from "../src/sketch.js";
import type { Illustrated } from "../src/illustrated-plate.js";
import { STEPS, stepIsDone } from "../src/pipeline.js";
import type { StepContext } from "../src/pipeline.js";
import type { Sketch } from "../src/sketch-scene.js";
import { memoryArtefactsFrom } from "./helpers/memory-artefacts.js";
import { STAMP_SOURCE } from "../src/store/artifacts.js";
import type { MemoryArtifactStore } from "./helpers/memory-artefacts.js";
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
let store: MemoryArtifactStore;

function ctxFor(): StepContext {
  return {
    slug: SLUG,
    report: () => undefined,
    signal: new AbortController().signal,
    cacheArticle: false,
  };
}

/**
 * A Sketch with two scenes, planted rather than written through `store.write`.
 *
 * Planted because this fixture is the illustrated step's *input* and nothing
 * here is testing how a Sketch gets stamped — going through `write` would mean
 * computing the sketch stage's own fingerprint, which is a fact about a
 * different stage, and would refuse the two cases that hand it an empty scene
 * list. `caption` on the second scene so that the two are not byte-identical.
 */
/**
 * **`sourceHash` is the real one, over the fixture article's own blocks and
 * tree.** The step refuses a *stale* Sketch as well as an absent one, so a
 * placeholder here would make every case in this file refuse for a reason that
 * has nothing to do with what it is asking.
 */
let SKETCH_HASH = "";

function sketchFixture(title = "Two arguments, one conclusion"): Sketch {
  return {
    version: "sketch/1",
    generator: "stub",
    slug: SLUG,
    sourceHash: SKETCH_HASH,
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

/**
 * Put the sketch the `illustrated` step will read, or take it away.
 *
 * `plant` rather than `write`, because two cases below hand this a sketch with
 * **no scenes** — `SHAPE.sketch` refuses one, and `write` is what applies it. On
 * the filesystem the equivalent was a `writeFile` going round the store, which
 * is the same escape hatch spelt differently.
 */
function writeSketch(sketch: Sketch | null): void {
  if (sketch === null) store.forget(SLUG, "sketch", "sketch");
  else store.plant(SLUG, "sketch", "sketch", sketch);
}

async function readSketch(): Promise<Sketch> {
  const sketch = await store.read(SLUG, "sketch", "sketch");
  if (!sketch) throw new Error("the store has no sketch to read back");
  return sketch;
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
  store = await memoryArtefactsFrom(root, SLUG);
  const article = await readArticle(SLUG, store);
  SKETCH_HASH = sketchFingerprint(article.blocks, article.tree, article.meta ?? null);
}, 30_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  briefCalls = 0;
  plateCalls = 0;
  /* **A fresh store per case, read off the untouched copy of `example/`.** It
     replaces two lines of cleanup — delete `illustrated.json`, delete the
     `steps/` markers — that existed because the store and the fixture were the
     same directory. They are not any more. */
  store = await memoryArtefactsFrom(root, SLUG);
  writeSketch(sketchFixture());
});

/* ------------------------------------------------------------ the refusal -- */

/** Run something that must throw, and hand back what it threw. */
async function threw(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error("expected that to fail, and it did not");
}

/**
 * **What the band actually shows**, which is not `Error.message`.
 *
 * The three refusals below were written for a reader — the comment at their
 * throw site says so, and says the sentence names the chip rather than the step
 * *"because it is read by somebody looking at a band and not at a pipeline"*.
 * It reached the reader as `stepGaveUp`'s generic copy until 2026-09-03, since
 * the form it was thrown through treats its argument as a log-only diagnostic,
 * and asserting on what was thrown could not see that.
 * docs/plans/260903k-pdf-page-cap-refused-with-no-reason-given.md § Bug 1.
 */
const shownFor = async (run: () => unknown): Promise<string> =>
  readerFailureOf(await threw(run), "Painting the argument").message;

/**
 * **No mutation of its own: the header's second arm is this block's.** Making
 * `memoryArtefacts().forget` a no-op — so the Sketch cannot be taken away —
 * reddens two of its cases, which is the refusal half of the file proving it
 * depends on an absent Sketch rather than on a stub that never answers.
 */
describe("the step refuses rather than illustrating the wrong argument", () => {
  it("says which chip to press when there is no Sketch at all", async () => {
    writeSketch(null);
    await script();
    expect(
      await shownFor(() => STEPS.illustrated.run(ctxFor(), store, nullCheckpointStore())),
    ).toMatch(/Draw the Sketch first/);
    /* **And nothing was spent finding out.** A stage that refused *after* the
       brief call would have cost $0.30 to say "press the other button". */
    expect(briefCalls, "the refusal must come before the brief call").toBe(0);
    expect(plateCalls).toBe(0);
  });

  it("refuses a Sketch with an empty scene list, which a hand edit can produce", async () => {
    writeSketch({ ...sketchFixture(), scenes: [] });
    await script();
    expect(
      await shownFor(() => STEPS.illustrated.run(ctxFor(), store, nullCheckpointStore())),
    ).toMatch(/Draw the Sketch first/);
    expect(briefCalls).toBe(0);
  });

  it("refuses a Sketch the article has moved underneath", async () => {
    /* **Refused rather than painted, and the reason is the reader's money.**
       `loadIllustrated` reports `stale` when the Sketch is stale as well as
       when the plates are, so a picture painted from a superseded scene is born
       stale: $0.30 and three minutes for something the panel labels out of date
       the moment it lands. */
    writeSketch({ ...sketchFixture(), sourceHash: "a-hash-of-some-other-article" });
    await script();
    expect(
      await shownFor(() => STEPS.illustrated.run(ctxFor(), store, nullCheckpointStore())),
    ).toMatch(/out of date/);
    expect(briefCalls, "the refusal must come before the brief call").toBe(0);
  });

  it("refuses a Sketch drawn for a different reader profile", async () => {
    /* **Without this the panel loops.** The picture inherits the Sketch's
       `profileHash`, the route answers `profileChanged: true` against the
       reader's current profile, the panel offers to paint again, and the next
       paint inherits the same hash and reports the same thing — one press of a
       $0.30 button per circuit, for ever. */
    writeSketch({ ...sketchFixture(), profileHash: hashProfile("somebody else") });
    await script();
    const ctx = { ...ctxFor(), profile: "I am a different reader" };
    expect(await shownFor(() => STEPS.illustrated.run(ctx, store, nullCheckpointStore()))).toMatch(
      /different reader profile/,
    );
    expect(briefCalls).toBe(0);
  });

  it("does not refuse a Sketch drawn deliberately without a profile", async () => {
    /* The negative control for the case above, and it is the three-state rule
       rather than an equality: `null` means *written deliberately without a
       profile*, which is not a mismatch with anything. Refusing it would make
       every unprofiled Sketch unpaintable by a reader who has a profile — which
       is most of them. src/profile.ts § `profileIsStale`. */
    writeSketch(sketchFixture());
    await script();
    const ctx = { ...ctxFor(), profile: "I am a reader with a profile" };
    await expect(
      STEPS.illustrated.run(ctx, store, nullCheckpointStore()),
    ).resolves.toBeTruthy();
  });

  it("does not enqueue a Sketch behind the reader's back", async () => {
    /* The tempting alternative to refusing, and the plan says why it is worse:
       one press becomes a hidden $0.20 charge and a three-minute wait nothing
       warned about. Asked as *no sketch was written* rather than as a claim
       about the code. */
    writeSketch(null);
    await script();
    await expect(
      STEPS.illustrated.run(ctxFor(), store, nullCheckpointStore()),
    ).rejects.toThrow();
    expect(await store.read(SLUG, "sketch", "sketch")).toBeNull();
  });
});

/* -------------------------------------------------------------- the stamp -- */

/**
 * **No mutation of its own** — it is the `STAMP_SOURCE` half, and the argument
 * for it is `tests/quiz-step-registration.test.ts`, which carries the measured
 * arm: setting that table's row to `null` reddens the equivalent cases there.
 * The same edit here would be the same experiment twice.
 */
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
    writeSketch({ ...sketchFixture(), profileHash: "abc123" });
    await script();
    const result = await STEPS.illustrated.run(ctxFor(), store, nullCheckpointStore());
    const written = result.parts?.illustrated as Illustrated | undefined;
    expect(written?.profileHash).toBe("abc123");
  });
});

/* ------------------------------------------------------------- the bytes -- */

/**
 * **No mutation involving the artefact store: this block is about the *blob*
 * store.** Its subject is that each plate's bytes go into the content-addressed
 * blob store and only the hash into the artefact, and `fsBlobs` is out of this
 * migration's scope. Neither arm in the header touches it.
 */
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
       for; the second cannot be stored because it is neither of the two formats
       a plate may be — a GIF, since 2026-09-04, when PNG stopped being the
       refusable case and became the ordinary one. The run must keep the first. */
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00]);
    const good = PLATE;
    let nth = 0;
    const call = await import("../src/ai-call.js");
    const spy = vi.spyOn(call, "openRouterImage").mockImplementation(() => {
      plateCalls++;
      nth += 1;
      return Promise.resolve({
        image: nth === 1 ? good : gif,
        mediaType: nth === 1 ? "image/jpeg" : "image/gif",
      } as Awaited<ReturnType<typeof call.openRouterImage>>);
    });
    try {
      await script();
      const result = await STEPS.illustrated.run(ctxFor(), store, nullCheckpointStore());
      const plates = (result.parts?.illustrated as Illustrated | undefined)?.plates ?? [];
      expect(plates[0]?.image?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(plates[1]?.image).toBeUndefined();
      expect(plates[1]?.failed).toMatch(/must be image\/jpeg or image\/png/);
    } finally {
      spy.mockRestore();
    }
  });

  /**
   * **A PNG plate goes all the way through the step**, which is the whole of
   * report -12's storage half seen from the pipeline: the illustrator we
   * switched to on 2026-09-04 returns PNG whatever `output_format` asks for, so
   * if any link in this chain still assumed JPEG the feature would come back
   * with two failure sentences and no pictures.
   */
  it("stores a PNG plate end to end and records it as one", async () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(png.buffer).setUint32(16, 848);
    new DataView(png.buffer).setUint32(20, 1264);
    const call = await import("../src/ai-call.js");
    const spy = vi.spyOn(call, "openRouterImage").mockImplementation(() => {
      plateCalls++;
      return Promise.resolve({ image: png, mediaType: "image/png" } as Awaited<
        ReturnType<typeof call.openRouterImage>
      >);
    });
    try {
      await script();
      const result = await STEPS.illustrated.run(ctxFor(), store, nullCheckpointStore());
      const plates = (result.parts?.illustrated as Illustrated | undefined)?.plates ?? [];
      expect(plates.length).toBeGreaterThan(0);
      for (const plate of plates) {
        expect(plate.failed, plate.sceneId).toBeUndefined();
        expect(plate.image?.ext, plate.sceneId).toBe("png");
        expect(plate.image?.width, plate.sceneId).toBe(848);
      }
    } finally {
      spy.mockRestore();
    }
  });
});

/* -------------------------------------------------------------- freshness -- */

/**
 * **No mutation of its own: the header's first arm is this block's.** Hashing
 * `{ slug }` instead of the whole Sketch in `inputFingerprint` reddens exactly
 * one case here — *does not skip when the SKETCH is redrawn* — and that is the
 * claim the block exists for. Its two neighbours also had to change how they
 * move the article, which the header explains.
 */
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
    /* **Read out of the store, not off the disk.** Since 2026-09-05 the store is
       in memory and the copy of `example/` is never written to, so a disk read
       here would be a constant — it would say "the article has not moved" no
       matter what the case did, which is the control passing by construction. */
    const before = JSON.stringify(await store.read(SLUG, "hierarchy", "blocks"));

    writeSketch(sketchFixture("Three arguments, one conclusion"));

    expect(await stepIsDone(STEPS.illustrated, ctxFor(), store)).toBe(false);
    expect(
      JSON.stringify(await store.read(SLUG, "hierarchy", "blocks")),
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

    /* **The article moves in the store**, which is where the stage reads it —
       and it needs no putting back, because `beforeEach` builds a fresh store
       off the untouched copy of `example/`. The `finally` that restored
       `blocks.json` went with the disk. */
    const file = await store.read(SLUG, "hierarchy", "blocks");
    const first = file?.blocks?.[0];
    if (!first) throw new Error("the fixture has no blocks");
    const before = first.text;
    first.text = `${first.text} — and one more sentence the illustrator never saw.`;
    store.plant(SLUG, "hierarchy", "blocks", file);

    /* **The positive control, and this case is worth nothing without it.** The
       assertion below is `true`, and an article that never moved also answers
       `true` — so with the move silently not happening, this would pass while
       testing the opposite thing. That is not hypothetical: until the memory
       store was made to hand back copies (helpers/memory-artefacts.ts §
       `detach`), deleting the `plant` above left this green, and so did leaving
       it in. Ask the store what it now holds, rather than trusting the two
       lines that were supposed to change it.
       The sibling case above needs the mirror image of this — *the article must
       NOT have moved* — for exactly the same reason. */
    expect(
      (await store.read(SLUG, "hierarchy", "blocks"))?.blocks?.[0]?.text,
      "the article must really have moved in the store, or this case asserts nothing",
    ).not.toBe(before);

    expect(await stepIsDone(STEPS.illustrated, ctxFor(), store)).toBe(true);
  });
});

/* ------------------------------------------ one press that draws and paints -- */

/**
 * **The assumption the one-press button rests on, asked of the server rather
 * than believed.**
 *
 * `IllustratedView`'s three refusal states each offer *"Draw the Sketch, then
 * paint"*, which posts one job naming `["sketch", "illustrated"]` — **unforced**.
 * For `absent` that plainly draws a Sketch. For `stale` and `profile-changed`
 * there already **is** a Sketch, and the whole feature turns on `stepIsDone`
 * refusing to call it current: adopt it, and the reader pays $0.27–$0.40 to
 * paint the very picture the panel has just told them is out of date, with
 * every check passing while it happens.
 *
 * *"The stamp will notice"* is exactly the shared assumption
 * docs/reusable/silent-success.md is about, so it is measured here — in both
 * halves, and at the seam between them:
 *
 *  - the **panel's** question: `sketchIsStale` and `profileIsStale`, the two
 *    functions behind the `stale` and `profileChanged` fields of
 *    `GET /api/sketch/:slug` that `useSketchReadiness` branches on;
 *  - the **step's** question: `stepIsDone(STEPS.sketch, …)`, which is what
 *    decides whether the Sketch half of that job spends anything.
 *
 * They agree for a structural reason rather than a lucky one, and that is worth
 * knowing before relying on it: `STAMP_SOURCE.sketch` is `"sketch"`, so
 * `stampFor` reads the stamp **out of the artefact itself** — `sourceHash` and
 * `profileHash` — which are the same two fields the route compares. There is no
 * second recorded copy of either that could drift from the first.
 *
 * **The first test is the control, and it is not decoration.** Every assertion
 * below it is `false`, and `stepIsDone` answers `false` for a dozen reasons that
 * have nothing to do with staleness — a missing artefact, an interrupted step, a
 * `generator` that is not today's model. Without a case that comes out `true`,
 * this whole block would pass against a Sketch that nothing could ever make
 * current.
 *
 * **No mutation of its own** — its subject is `STEPS.sketch`'s freshness rather
 * than the illustrated step's, and it builds its Sketch from that step's own
 * stamp. Neither of the header's arms is aimed at it; what would redden it is a
 * change to `sketchIsStale`, which is `tests/stage-stamp-agreement.test.ts`'s
 * territory.
 */
describe("one press that draws and then paints", () => {
  /**
   * The Sketch as the step would have written it a moment ago: stamped with
   * exactly what `STEPS.sketch.stamp` produces for this article and this reader.
   *
   * Built from the step's own stamp rather than from hand-typed values, because
   * two of the four fields — the prompt version and the model — are facts about
   * the configuration this test is not about, and typing them would make the
   * control fail for a reason that has nothing to do with the question. The
   * self-reference that buys is bounded, and paid off at the call site: the
   * control checks the `sourceHash` independently against `SKETCH_HASH`, which
   * this file computed from the real article with the route's own fingerprint.
   */
  async function stampedNow(ctx: StepContext): Promise<Sketch> {
    const want = await STEPS.sketch.stamp?.(ctx, store);
    if (!want) throw new Error("the sketch step's stamp answered null for the fixture article");
    return {
      ...sketchFixture(),
      sourceHash: want.inputHash as string,
      version: want.promptVersion as string,
      generator: want.model as string,
      profileHash: (want.profileHash ?? null) as string | null,
    } as Sketch;
  }

  /** The three inputs the panel's own staleness question is asked against. */
  async function articleNow() {
    const a = await readArticle(SLUG, store);
    return { blocks: a.blocks, tree: a.tree, meta: a.meta ?? null };
  }

  it("adopts a Sketch that is genuinely current, and does not redraw it at $0.20", async () => {
    const ctx = ctxFor();
    const sketch = await stampedNow(ctx);
    /* Independently of the stamp it was built from: this is the route's own
       fingerprint over the real fixture article, computed in `beforeAll`. */
    expect(sketch.sourceHash, "the control Sketch is not this article's").toBe(SKETCH_HASH);
    writeSketch(sketch);

    const { blocks, tree, meta } = await articleNow();
    expect(sketchIsStale(sketch, blocks, tree, meta), "the panel would call this one stale").toBe(
      false,
    );
    expect(
      await stepIsDone(STEPS.sketch, ctx, store),
      "a current Sketch is redrawn anyway — one press would buy a $0.20 model call for nothing",
    ).toBe(true);
  });

  it("redraws a Sketch the panel calls stale, rather than painting from it", async () => {
    const ctx = ctxFor();
    /* The article having moved underneath it, which is what the panel's `stale`
       means and what its sentence tells the reader. */
    const sketch = {
      ...(await stampedNow(ctx)),
      sourceHash: "the fingerprint of an article this is no longer about",
    } as Sketch;
    writeSketch(sketch);
    /* **The store is holding *this* Sketch and not `beforeEach`'s.** Without
       this line the case is satisfied by the setup never having happened: the
       fixture Sketch left behind is already not-current, so `false` arrives
       either way and the `writeSketch` above is decoration. See the block
       header for why that shape keeps appearing here. */
    expect(
      (await store.read(SLUG, "sketch", "sketch"))?.sourceHash,
      "the stale Sketch never reached the store, so `false` below means nothing",
    ).toBe(sketch.sourceHash);

    const { blocks, tree, meta } = await articleNow();
    expect(
      sketchIsStale(sketch, blocks, tree, meta),
      "the panel would NOT show the stale refusal here, so this proves nothing",
    ).toBe(true);
    expect(
      await stepIsDone(STEPS.sketch, ctx, store),
      "the Sketch half would skip — the press would pay to paint the out-of-date picture the panel just refused",
    ).toBe(false);
  });

  it("redraws a Sketch the panel calls profile-changed", async () => {
    /* **The reader has a profile now, and it is not the one the Sketch was
       drawn for.** Both halves of that matter: `profileIsStale` answers false
       when *either* side is null (src/profile.ts), so a case with no current
       profile is a case the panel never shows this refusal for. */
    const ctx = { ...ctxFor(), profile: "I read for the evidence, not the history." };
    const sketch = {
      ...(await stampedNow(ctx)),
      profileHash: hashProfile("Somebody else entirely."),
    } as Sketch;
    writeSketch(sketch);
    /* The same precondition as the stale case, on the field that differs here:
       `beforeEach`'s Sketch carries `profileHash: null`, so a store that never
       received this one answers `false` for the wrong reason. */
    expect(
      (await store.read(SLUG, "sketch", "sketch"))?.profileHash,
      "the profile-changed Sketch never reached the store, so `false` below means nothing",
    ).toBe(sketch.profileHash);

    expect(
      profileIsStale(sketch.profileHash, hashProfile(ctx.profile)),
      "the panel would NOT show the profile-changed refusal here, so this proves nothing",
    ).toBe(true);
    expect(
      await stepIsDone(STEPS.sketch, ctx, store),
      "the Sketch half would skip — the painting would inherit the profile the reader has moved on from",
    ).toBe(false);
    /* And it is the profile that made it re-run, not the article. */
    const { blocks, tree, meta } = await articleNow();
    expect(sketchIsStale(sketch, blocks, tree, meta), "the article moved too").toBe(false);
  });

  /**
   * **The control for the case above, differing in one field.**
   *
   * The control at the top of this block has no profile on either side, so it
   * and the profile-changed case differ in two things at once — which reader
   * the context carries, and which reader the artefact was stamped for. This
   * one holds the context still and moves only `profileHash`, so a `false`
   * there is attributable to the profile and to nothing else.
   */
  it("adopts a Sketch drawn for the profile the reader still has", async () => {
    const ctx = { ...ctxFor(), profile: "I read for the evidence, not the history." };
    const sketch = await stampedNow(ctx);
    expect(sketch.profileHash, "the fixture is not stamped for this reader").toBe(
      hashProfile(ctx.profile),
    );
    writeSketch(sketch);

    expect(profileIsStale(sketch.profileHash, hashProfile(ctx.profile))).toBe(false);
    expect(
      await stepIsDone(STEPS.sketch, ctx, store),
      "a Sketch drawn for this very reader is redrawn anyway",
    ).toBe(true);
  });

  it("draws one when there is no Sketch at all", async () => {
    writeSketch(null);
    /* The sharpest instance of the three: `beforeEach` plants a Sketch that is
       *also* not current, so without this the case passes whether or not the
       taking-away worked, and it is the taking-away that is the whole subject. */
    expect(
      await store.read(SLUG, "sketch", "sketch"),
      "the Sketch was not taken away, so `false` below is about staleness rather than absence",
    ).toBeNull();
    expect(await stepIsDone(STEPS.sketch, ctxFor(), store)).toBe(false);
  });
});
