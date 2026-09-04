/**
 * **The structure answer survives a window that ran out** — stage 2 of
 * docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md.
 *
 * Until 2026-09-04 only the label batches were checkpointed. The structure call
 * is the most expensive thing in the pipeline — 508 seconds and about two
 * dollars on a 142-page paper — and a run that died in the label pass afterwards
 * bought it again from scratch. Now it goes through the same `checkpoints`
 * machinery the batches use.
 *
 * **Two things are actually under test, and they are the two GPT Sol's review of
 * the plan said would go wrong** (finding 4):
 *
 * 1. **The key is a digest of the request the call really makes**, assembled on
 *    the same path, not a hand-copied list of fields. The list the earlier draft
 *    proposed — system, user, model, effort, PROMPT_VERSION — omits `thinking`,
 *    `max_tokens`, the routing `streamMessage` injects, and the difference
 *    between `CAPABLE_MODEL` and the wire id `modelFor("hierarchy")` sends. A
 *    hand-maintained list is the blind spot `promptFingerprint` in
 *    src/pdf-read.ts was written to remove, and the mutation test below is
 *    written over `Object.keys` for that reason: a field added to the request
 *    tomorrow is covered without anybody remembering to add it here.
 * 2. **Only an answer that parsed and built is stored.** Storing before
 *    `parseJsonAnswer` and `buildTree` would replay a malformed-but-complete
 *    answer for ever, which is worse than paying for the call again.
 *
 * No network: `streamMessage` answers the structure call from a canned tree and
 * `generateLabels` is stubbed, exactly as tests/hierarchy-write-guard.test.ts
 * does and for the same reason — the label protocol is not what is being tested.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { CHECKPOINT_KEY_RE, type CheckpointNamespace, type CheckpointStore } from "../src/store/checkpoints.js";
import type { Block } from "../src/types.js";

/** What the structure call "returns", set per test. */
let modelAnswer = "";
/** How many times a structure call was actually made. */
let structureCalls = 0;

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: () => {
      structureCalls += 1;
      return {
        onText: () => {},
        finalMessage: async () => ({
          content: [{ type: "text", text: modelAnswer }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      };
    },
  };
});

let labelsSourceHash = "";
let labelsFor: Record<string, string> = {};
/** Set by the test that reproduces the window this whole feature exists for. */
let labelsThrow = false;

vi.mock("../src/labels.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/labels.js")>();
  return {
    ...real,
    generateLabels: async () => {
      if (labelsThrow) throw new Error("the label pass ran out of window");
      return {
      labels: labelsFor,
      file: {
        version: "test",
        generator: "test",
        slug: "structure-checkpoint",
        structureHash: "0000000000000000",
        sourceHash: labelsSourceHash,
        structureVersion: "test",
        batches: [],
        labels: labelsFor,
        dropped: [],
      },
      batches: 0,
      oversized: 0,
      resumed: 0,
      dropped: [],
      calls: 0,
      estimatedCacheable: false,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      };
    },
  };
});

const {
  canonicalStructureRequest,
  generateHierarchy,
  structureKey,
  structureRequest,
  PROMPT_VERSION,
} = await import("../src/hierarchy.js");
const { modelFor } = await import("../src/models.js");
const { MESSAGES_PROVIDER, messagesWireBody } = await import("../src/messages-stream.js");
const { isStructural } = await import("../src/block-policy.js");
const { hashBlocks } = await import("../src/source-hash.js");
const { blocksArtefact } = await import("../src/blocks.js");

const BLOCKS: Block[] = [
  { id: "spya-chk001", tag: "h2", kind: "heading", level: 2, text: "First Part", words: 2, html: "<h2>First Part</h2>", gistable: true },
  { id: "spya-chk002", tag: "p", kind: "text", text: "Some prose about turnips.", words: 4, html: "<p>Some prose about turnips.</p>", gistable: true },
  { id: "spya-chk003", tag: "p", kind: "text", text: "More prose entirely.", words: 3, html: "<p>More prose entirely.</p>", gistable: true },
];

/** One node over every block: the smallest tree `buildTree` accepts. */
const SOUND = JSON.stringify({
  root: {
    title: "The whole piece",
    gist: "One node over the whole piece, which is a shape buildTree accepts.",
    range: ["spya-chk001", "spya-chk003"],
  },
});

/** In-memory, and it refuses the keys the real store refuses. */
function memoryCheckpoints(): CheckpointStore & { entries: Map<string, unknown> } {
  const entries = new Map<string, unknown>();
  return {
    entries,
    async read<T>(_slug: string, namespace: CheckpointNamespace, keys: readonly string[]) {
      const found = new Map<string, T>();
      for (const key of keys) {
        const value = entries.get(`${namespace}:${key}`);
        if (value !== undefined) found.set(key, value as T);
      }
      return found;
    },
    async write(_slug: string, namespace: CheckpointNamespace, key: string, value: unknown) {
      if (!CHECKPOINT_KEY_RE.test(key)) throw new Error(`bad checkpoint key: ${key}`);
      entries.set(`${namespace}:${key}`, value);
    },
  };
}

beforeEach(() => {
  structureCalls = 0;
  modelAnswer = SOUND;
  labelsThrow = false;
  labelsFor = Object.fromEntries(BLOCKS.filter((b) => isStructural(b)).map((b) => [b.id, `Label ${b.id}`]));
  labelsSourceHash = hashBlocks(blocksArtefact(BLOCKS).blocks);
});

describe("the structure checkpoint's key", () => {
  const canonical = () => canonicalStructureRequest(structureRequest(BLOCKS).params);

  it("is a digest of the request the call actually makes, not a list somebody keeps", () => {
    const c = canonical();
    /* The four fields the naive list omitted, named one by one because each was
       a real hole: two requests differing only in `thinking`, in `max_tokens`,
       in the upstream routing, or in the wire spelling of the model would have
       answered each other's question. */
    const request = c.request as Record<string, unknown>;
    expect(request.thinking).toEqual({ type: "adaptive" });
    expect(request.max_tokens).toBe(structureRequest(BLOCKS).maxTokens);
    expect(request.provider).toEqual(MESSAGES_PROVIDER);
    /* `modelFor("hierarchy")`, which is the OpenRouter address the call goes to
       — NOT `CAPABLE_MODEL`, which is the same model's name and is what a
       hand-copied key would have reached for. src/models.ts § CAPABLE_MODEL. */
    expect(request.model).toBe(modelFor("hierarchy"));
    expect(c.promptVersion).toBe(PROMPT_VERSION);
  });

  it("takes the injected half from the sender, not from a copy of what it does", () => {
    /* The second-round finding: restating `provider` and `model` here would
       cover today's two fields and miss tomorrow's third in silence, because the
       mutation test below can only enumerate fields the object already has. So
       `request` is `messagesWireBody`'s own output, byte for byte — the same
       function `streamMessage` sends. ⟨GPT Sol, 2026-09-04.⟩ */
    expect(canonical().request).toEqual(messagesWireBody("hierarchy", structureRequest(BLOCKS).params));
  });

  it("moves when any field of that request moves — enumerated, not listed", () => {
    const base = canonical();
    const key = structureKey(base);
    const paths: [string, () => Record<string, unknown>][] = [];
    for (const field of Object.keys(base)) {
      paths.push([field, () => ({ ...base, [field]: "mutated" })]);
    }
    for (const field of Object.keys(base.request as Record<string, unknown>)) {
      paths.push([
        `request.${field}`,
        () => ({ ...base, request: { ...(base.request as Record<string, unknown>), [field]: "mutated" } }),
      ]);
    }
    /* Proof the loop is looking at something: if the canonical object ever
       collapses to one field, the enumeration would still "pass" vacuously. */
    expect(paths.length).toBeGreaterThan(6);
    for (const [what, mutate] of paths) {
      expect(structureKey(mutate()), `${what} did not move the key`).not.toBe(key);
    }
  });

  it("moves when the article's blocks move, ids included", () => {
    /* The ordering constraint the plan records: a lost draft re-mints every
       block id, and the ids are inside the user message, so a cached tree can
       never be replayed onto blocks it does not name. That is the property, and
       it is asserted rather than assumed. */
    const renamed = BLOCKS.map((b) => ({ ...b, id: b.id.replace("chk", "xyz") }));
    expect(structureKey(canonicalStructureRequest(structureRequest(renamed).params))).not.toBe(
      structureKey(canonical()),
    );
  });

  it("is a key the store will accept", () => {
    expect(structureKey(canonical())).toMatch(CHECKPOINT_KEY_RE);
  });
});

describe("generateHierarchy and the structure checkpoint", () => {
  it("makes the call once and reuses the answer on the next run", async () => {
    const checkpoints = memoryCheckpoints();
    const first = await generateHierarchy({ blocks: BLOCKS, slug: "structure-checkpoint", checkpoints });
    expect(structureCalls).toBe(1);
    expect([...checkpoints.entries.keys()]).toHaveLength(1);
    expect([...checkpoints.entries.keys()][0]).toMatch(/^hierarchy-structure:/);

    const second = await generateHierarchy({ blocks: BLOCKS, slug: "structure-checkpoint", checkpoints });
    expect(structureCalls, "the second run bought the structure call again").toBe(1);
    /* Same tree, not merely no call: a resumed run that quietly produced a
       different structure would be worse than one that paid twice. */
    expect(second.parts.tree).toEqual(first.parts.tree);
    expect(second.structureResumed).toBe(true);
    expect(first.structureResumed).toBe(false);
  });

  /**
   * **The window this feature exists for, reproduced** — and the case every
   * other test here would pass without.
   *
   * The runs above all succeed, so a checkpoint written *after* `generateLabels`
   * would satisfy every one of them while losing the structure answer to exactly
   * the failure the plan is about: 508 seconds of tree bought, then the label
   * pass runs out of window and the next attempt buys the tree again. ⟨GPT Sol,
   * on the code, 2026-09-04 — the gap was real and this is the test that closes
   * it.⟩
   */
  it("keeps the tree when the label pass dies after it", async () => {
    const checkpoints = memoryCheckpoints();
    labelsThrow = true;
    await expect(
      generateHierarchy({ blocks: BLOCKS, slug: "structure-checkpoint", checkpoints }),
    ).rejects.toThrow(/ran out of window/);
    expect(structureCalls).toBe(1);
    expect(checkpoints.entries.size, "the tree the failed attempt paid for was thrown away").toBe(1);

    labelsThrow = false;
    const second = await generateHierarchy({
      blocks: BLOCKS,
      slug: "structure-checkpoint",
      checkpoints,
    });
    expect(structureCalls, "the second attempt bought the tree again").toBe(1);
    expect(second.structureResumed).toBe(true);
  });

  it("stores nothing when the answer builds a tree the invariants reject", async () => {
    /* The third way an answer can be worthless, and the one that pins the write
       *after* `assertTreeSound` rather than merely after `buildTree`: an
       internal node with no gist builds fine — `buildTree` copies back whatever
       the model wrote — and has nothing to render at its own zoom level, so the
       invariants refuse it (src/tree-invariants.ts § the gist rule). Storing it
       would replay a tree that can never be published. */
    const checkpoints = memoryCheckpoints();
    modelAnswer = JSON.stringify({
      root: { title: "No gist here", range: ["spya-chk001", "spya-chk003"] },
    });
    await expect(
      generateHierarchy({ blocks: BLOCKS, slug: "structure-checkpoint", checkpoints }),
    ).rejects.toThrow();
    expect(checkpoints.entries.size).toBe(0);
  });

  it("stores nothing when the answer will not parse", async () => {
    const checkpoints = memoryCheckpoints();
    modelAnswer = "{ this is not JSON at all";
    await expect(
      generateHierarchy({ blocks: BLOCKS, slug: "structure-checkpoint", checkpoints }),
    ).rejects.toThrow();
    expect(checkpoints.entries.size, "a malformed answer would be replayed for ever").toBe(0);
  });

  it("stores nothing when the answer parses but will not build a tree", async () => {
    /* The other half, and the reason "it came back whole" is not the bar: this
       answer is complete JSON and names a block that does not exist, so
       `buildTree` throws. Keeping it would turn one bad call into a permanent
       one. */
    const checkpoints = memoryCheckpoints();
    modelAnswer = JSON.stringify({
      root: { title: "Bad", gist: "Names a block that is not there.", range: ["spya-nope01", "spya-chk003"] },
    });
    await expect(
      generateHierarchy({ blocks: BLOCKS, slug: "structure-checkpoint", checkpoints }),
    ).rejects.toThrow();
    expect(checkpoints.entries.size).toBe(0);
  });

  it("ignores a stored value of the wrong shape rather than trusting it", async () => {
    /* The store validates nothing — src/store/checkpoints.ts § What the store
       knows about a key: nothing — so the caller is the gate. A row written by
       an older format, or by something else entirely, must read as a miss. */
    const checkpoints = memoryCheckpoints();
    const key = structureKey(canonicalStructureRequest(structureRequest(BLOCKS).params));
    await checkpoints.write("structure-checkpoint", "hierarchy-structure", key, { answer: 42 });
    await generateHierarchy({ blocks: BLOCKS, slug: "structure-checkpoint", checkpoints });
    expect(structureCalls).toBe(1);
  });
});
