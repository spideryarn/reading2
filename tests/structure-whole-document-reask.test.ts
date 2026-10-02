/**
 * **A structure answer that cannot become a tree is asked for once more, inside
 * the step** — docs/plans/261001s-fb93-long-pdf-hierarchy-asks-again.md.
 *
 * A 1,041-block book failed at "Building the hierarchy" twice on 2026-10-01,
 * each time on a different local fault in a 25,000-character answer: once a
 * node with no range, once JSON that broke three characters from the end. The
 * reader pressed Retry between them, which was the retry loop. This is the
 * step doing that once itself, under four limits: only for an answer that
 * failed to become a tree (not a truncation, a refusal or a transport error),
 * at most once, only if the deadline leaves room for another call as long as
 * the first, and not after an abort.
 *
 * No network, the same way tests/structure-whole-document-checkpoint.test.ts does
 * it: `streamMessage` answers from a queue and `generateLabels` is stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECKPOINT_KEY_RE, type CheckpointNamespace, type CheckpointStore } from "../src/store/checkpoints.js";
import type { Block } from "../src/types.js";

/**
 * What each successive structure call answers, in order. `ms` is how long the
 * call "takes" on the fake clock below; `fail` makes it a transport error.
 */
let answers: { text: string; stop?: string; ms?: number; fail?: boolean; tokens?: number }[] = [];
let wholeDocumentCalls = 0;
/** Progress lines the step reported. */
let progress: string[] = [];

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: () => {
      const answer = answers[wholeDocumentCalls] ?? answers.at(-1)!;
      wholeDocumentCalls += 1;
      let onText: ((delta: string) => void) | undefined;
      return {
        onText: (fn: (delta: string) => void) => {
          onText = fn;
        },
        finalMessage: async () => {
          if (answer.fail) throw new Error("socket hang up");
          // Past the progress throttle, so the one delta below is reported.
          vi.setSystemTime(Date.now() + (answer.ms ?? 1_000));
          onText?.(answer.text);
          return {
            content: [{ type: "text", text: answer.text }],
            stop_reason: answer.stop ?? "end_turn",
            usage: { input_tokens: answer.tokens ?? 1, output_tokens: answer.tokens ?? 1 },
          };
        },
      };
    },
  };
});

let labelsFor: Record<string, string> = {};
let labelsSourceHash = "";

vi.mock("../src/labels.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/labels.js")>();
  return {
    ...real,
    generateLabels: async () => ({
      labels: labelsFor,
      file: {
        version: "test",
        generator: "test",
        slug: "structure-reask",
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
    }),
  };
});

const { generateStructure } = await import("../src/structure.js");
const { isStructural } = await import("../src/block-policy.js");
const { hashBlocks } = await import("../src/source-hash.js");
const { blocksArtefact } = await import("../src/blocks.js");

const BLOCKS: Block[] = [
  { id: "spya-rsk001", tag: "h2", kind: "heading", level: 2, text: "First Part", words: 2, html: "<h2>First Part</h2>", gistable: true },
  { id: "spya-rsk002", tag: "p", kind: "text", text: "Some prose about turnips.", words: 4, html: "<p>Some prose about turnips.</p>", gistable: true },
  { id: "spya-rsk003", tag: "p", kind: "text", text: "More prose entirely.", words: 3, html: "<p>More prose entirely.</p>", gistable: true },
];

/* A schema-valid `toc/11` answer: starts only, with all three promised levels. */
const SOUND = JSON.stringify({
  root: {
    title: "The whole piece",
    gist: "The whole piece has one part.",
    question: "The whole piece — what does it say?",
    children: [
      {
        title: "The part",
        gist: "The part covers the whole piece.",
        question: "The part — what does it say?",
        start: BLOCKS[0]!.id,
        children: [
          {
            title: "The section",
            gist: "The section covers the whole piece in detail.",
            start: BLOCKS[0]!.id,
          },
        ],
      },
    ],
  },
});
/** Broken three characters from the end, the way the book's second answer was. */
const BROKEN = `${SOUND.slice(0, -2)}]}`;
/** A child that starts at a block the article does not have — refused by the starts-only conversion. */
const INVENTED = JSON.stringify({
  root: {
    title: "The whole piece",
    gist: "A gist.",
    question: "The whole piece — what does it say?",
    children: [
      {
        title: "Part",
        gist: "A gist.",
        question: "Part — what?",
        start: "spya-zzz999",
        children: [{ title: "Section", gist: "A section gist.", start: "spya-zzz999" }],
      },
    ],
  },
});

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

const run = (extra: { deadlineAt?: number; signal?: AbortSignal; checkpoints?: CheckpointStore } = {}) =>
  generateStructure({
    power: "standard",
    blocks: BLOCKS,
    slug: "structure-reask",
    checkpoints: extra.checkpoints ?? memoryCheckpoints(),
    onProgress: (line) => progress.push(line),
    ...(extra.deadlineAt !== undefined ? { deadlineAt: extra.deadlineAt } : {}),
    ...(extra.signal ? { signal: extra.signal } : {}),
  });

beforeEach(() => {
  /* A fake clock that only the mocked calls move, so a call's length is a
     number the test chose. `toFake: ["Date"]` alone: nothing here waits. */
  vi.useFakeTimers({ toFake: ["Date"], now: 1_000_000 });
  wholeDocumentCalls = 0;
  progress = [];
  answers = [{ text: SOUND }];
  labelsFor = Object.fromEntries(BLOCKS.filter((b) => isStructural(b)).map((b) => [b.id, `Label ${b.id}`]));
  labelsSourceHash = hashBlocks(blocksArtefact(BLOCKS).blocks);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a structure answer that cannot become a tree", () => {
  it("is asked for again, and the second answer is the tree", async () => {
    answers = [{ text: BROKEN }, { text: SOUND }];
    const checkpoints = memoryCheckpoints();
    const result = await run({ checkpoints });
    expect(wholeDocumentCalls).toBe(2);
    expect(result.wholeDocumentCalls).toBe(2);
    expect(result).not.toHaveProperty("rangelessChildren");
    expect(result.parts.tree.nodes[result.parts.tree.rootId]?.title).toBe("The whole piece");
    // The answer that built is the one kept, so the next window resumes it.
    expect([...checkpoints.entries.values()]).toEqual([expect.objectContaining({ answer: SOUND })]);
  });

  it("is asked for again when it parses but does not build", async () => {
    answers = [{ text: INVENTED }, { text: SOUND }];
    const result = await run();
    expect(wholeDocumentCalls).toBe(2);
    expect(result.wholeDocumentCalls).toBe(2);
  });

  it("is asked for at most once more — a second bad answer fails the step", async () => {
    answers = [{ text: BROKEN }, { text: INVENTED }];
    const checkpoints = memoryCheckpoints();
    await expect(run({ checkpoints })).rejects.toThrow(/not in blocks\.json/);
    expect(wholeDocumentCalls).toBe(2);
    expect(checkpoints.entries.size).toBe(0);
  });

  /* The book's two calls took 129 s and 94 s, so a second call is reserved
     half as long again as the first: after a 100 s call, 150 s. GPT Sol. */
  it("is not asked for again when the deadline leaves less than half as long again", async () => {
    answers = [{ text: BROKEN, ms: 100_000 }, { text: SOUND }];
    await expect(run({ deadlineAt: Date.now() + 100_000 + 140_000 })).rejects.toThrow(/not valid JSON/);
    expect(wholeDocumentCalls).toBe(1);
  });

  it("is asked for again when the deadline leaves that much", async () => {
    answers = [{ text: BROKEN, ms: 100_000 }, { text: SOUND, ms: 130_000 }];
    await run({ deadlineAt: Date.now() + 100_000 + 160_000 });
    expect(wholeDocumentCalls).toBe(2);
  });

  it("pays for both calls in the run's totals, and says which call is talking", async () => {
    answers = [{ text: BROKEN, tokens: 10 }, { text: SOUND, tokens: 7 }];
    const result = await run();
    expect(result.inputTokens).toBe(17);
    expect(result.outputTokens).toBe(17);
    const again = progress.findIndex((l) => /asking again/.test(l));
    expect(again).toBeGreaterThan(-1);
    // Every line from the second call keeps saying so.
    const after = progress.slice(again).filter((l) => /characters of tree/.test(l));
    expect(after).not.toEqual([]);
    expect(after.every((l) => l.startsWith("asking again: "))).toBe(true);
  });

  it("is resumed, not bought a third time, by the next attempt", async () => {
    answers = [{ text: BROKEN }, { text: SOUND }];
    const checkpoints = memoryCheckpoints();
    await run({ checkpoints });
    const next = await run({ checkpoints });
    expect(wholeDocumentCalls).toBe(2);
    expect(next.wholeDocumentCalls).toBe(0);
    expect(next.wholeDocumentResumed).toBe(true);
  });

  it("is not asked for again after the step was aborted", async () => {
    answers = [{ text: BROKEN }, { text: SOUND }];
    const controller = new AbortController();
    controller.abort();
    await expect(run({ signal: controller.signal })).rejects.toThrow();
    expect(wholeDocumentCalls).toBe(1);
  });
});

describe("what is not asked for again", () => {
  it("a refusal", async () => {
    answers = [{ text: "", stop: "refusal" }, { text: SOUND }];
    await expect(run()).rejects.toThrow();
    expect(wholeDocumentCalls).toBe(1);
  });

  it("a transport error", async () => {
    answers = [{ text: "", fail: true }, { text: SOUND }];
    await expect(run()).rejects.toThrow();
    expect(wholeDocumentCalls).toBe(1);
  });

  it("a truncated answer — it would truncate again", async () => {
    answers = [{ text: SOUND.slice(0, 40), stop: "max_tokens" }, { text: SOUND }];
    await expect(run()).rejects.toThrow();
    expect(wholeDocumentCalls).toBe(1);
  });

  it("a sound answer — one call, as before", async () => {
    const result = await run();
    expect(wholeDocumentCalls).toBe(1);
    expect(result.wholeDocumentCalls).toBe(1);
  });
});
