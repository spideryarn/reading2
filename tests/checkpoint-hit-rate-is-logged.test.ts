/**
 * **Every checkpoint read says how many it asked for and how many it found** —
 * on the miss as loudly as on the hit.
 *
 * This is recommendation 2 of
 * docs/postmortems/260904a-a-retry-minted-a-fresh-name-so-the-checkpoints-could-never-be-found.md.
 * Chunk checkpointing was inert for the whole life of the feature — a retry
 * minted a fresh article, so every lookup missed — and the instrumentation
 * written to catch exactly that never fired. Both ends were pointed at the
 * interesting case being **present**: `storedChunks` (src/pdf-read.ts) warned
 * only when the read *threw*, and the read never threw; it succeeded and
 * returned an empty map. `generateLabels`' sibling read had the same shape, and
 * `LabelRun.resumed` was printed only when it was greater than zero.
 *
 * A dead cache and a cache nobody has wired up produce identical output under
 * that design, and the only other symptom is a larger bill.
 * docs/reusable/silent-success.md.
 *
 * ## What each test would fail on
 *
 * The `found: 0` cases are the ones that matter, and they are the ones the old
 * code could not produce: put the logging back inside the `catch`, or behind an
 * `if (found > 0)`, and they go red while the `found: N` cases stay green. Both
 * halves are here so that a change which reports only hits is caught, and so
 * that the counts are known to track something rather than being two constants.
 *
 * `info`, not `debug`: `level()` in src/log.ts is `info` in production, so a
 * `debug` line is a line that does not exist on the only machine the question
 * gets asked about.
 */
import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * **`LOG_LEVEL` before the imports.** `level()` in src/log.ts is read once at
 * that module's load and vitest sets `NODE_ENV=test`, which makes it `silent`.
 * A hoisted block is the only thing that runs early enough, and it cannot call
 * anything imported. tests/helpers/log-capture.ts § 1.
 */
const HOISTED = vi.hoisted(() => {
  const previousLevel = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = "info";
  return { previousLevel };
});

import {
  CASCADE_RECIPE,
  UNMEASURED_OVERHEAD,
  planExpansionBatches,
  type ExpansionBatch,
  type ExpansionTarget,
} from "../src/hierarchy-cascade.js";
import { renderFrozenOutline, type OutlineEntry } from "../src/hierarchy-expand.js";
import { runExpansionWave, type FrozenSeed } from "../src/hierarchy-deepen.js";
import { structureHash } from "../src/source-hash.js";
import { generateLabels } from "../src/labels.js";
import type { Pass0, PdfRecord } from "../src/pdf.js";
import { pass0 } from "../src/pdf.js";
import { type PdfReader, runPdfExtract } from "../src/pdf-read.js";
import type { Block, NodeId, Tree, TreeNode } from "../src/types.js";
import { logLinesWhile } from "./helpers/log-capture.js";
import { memoryCheckpoints, type MemoryCheckpoints } from "./helpers/memory-checkpoints.js";

afterAll(() => {
  if (HOISTED.previousLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = HOISTED.previousLevel;
});

const EASY = new URL("../evals/pdf/easy/source.pdf", import.meta.url);

/** The lines of `text` that carry every one of `needles`. */
function lines(text: string, ...needles: string[]): string[] {
  return text.split("\n").filter((line) => needles.every((n) => line.includes(n)));
}

/* ----------------------------------------------------------- the pdf half -- */

/**
 * A reader that transcribes each requested page out of the PDF's own text
 * layer — the same stub shape as tests/pdf-read.test.ts, so the stage's own
 * check is real and only the model is not.
 */
function honestReader(pass: Pass0): PdfReader {
  return {
    id: "test/honest",
    async read(_pdf, instruction) {
      const asked = [...instruction.matchAll(/\d+/g)].map(Number);
      const sent = instruction.includes("included only so you can see") ? asked.slice(1) : asked;
      const wanted = new Set(sent);
      const records: PdfRecord[] = [];
      for (const page of pass.pages) {
        if (!wanted.has(page.page)) continue;
        for (const line of page.text.split("\n")) {
          if (line.trim()) {
            records.push({
              page: page.page,
              type: "paragraph",
              text: line,
              continues: false,
              uncertain: false,
            });
          }
        }
      }
      return {
        records,
        stripped: 0,
        finish: "stop",
        usage: { input: 100, output: 200 },
        ms: 1,
      };
    },
  };
}

async function extractInto(store: MemoryCheckpoints): Promise<void> {
  const bytes = new Uint8Array(await readFile(EASY));
  const pass = await pass0(bytes);
  await runPdfExtract({
    frontMatter: null,
    bytes,
    url: "https://example.test/paper.pdf",
    checkpoints: store,
    slug: "paper",
    reader: honestReader(pass),
  });
}

describe("the pdf chunk checkpoints", () => {
  it("says what it asked for and what it found when it finds nothing", async () => {
    const store = memoryCheckpoints({ slug: "paper", articleId: "article-paper" });
    const written = await logLinesWhile(async () => {
      await extractInto(store);
    });

    /* The capture has to have caught something, or every assertion below is
       satisfied by an empty string. tests/helpers/log-capture.ts § 2. */
    expect(written).toContain("pdf-chunk");
    const said = lines(written, "pdf-chunk", '"found":0');
    expect(said).toHaveLength(1);
    /* Not merely "there is an `asked`": a run that planned no chunks would
       report zero asked and zero found and look identical to a working one. */
    expect(said[0]).toMatch(/"asked":[1-9]/);
  });

  it("says what it found when it finds everything, so the two counts track", async () => {
    const store = memoryCheckpoints({ slug: "paper", articleId: "article-paper" });
    await extractInto(store);

    const written = await logLinesWhile(async () => {
      await extractInto(store);
    });

    expect(written).toContain("pdf-chunk");
    const said = lines(written, "pdf-chunk", '"found":');
    expect(said).toHaveLength(1);
    /* Every chunk the first attempt paid for, found by the second. */
    const asked = Number(/"asked":(\d+)/.exec(said[0] ?? "")?.[1]);
    const found = Number(/"found":(\d+)/.exec(said[0] ?? "")?.[1]);
    expect(asked).toBeGreaterThan(0);
    expect(found).toBe(asked);
  });
});

/* -------------------------------------------------------- the labels half -- */

/**
 * One root, one section, three paragraphs — the smallest thing `planBatches`
 * will make a batch out of. Nothing here is about the labels themselves, only
 * about the read that happens before the first one is asked for.
 */
function tinyFixture(): { tree: Tree; blocks: Block[] } {
  const blocks: Block[] = Array.from({ length: 3 }, (_, i) => {
    const id = `spya-${String(i).padStart(6, "0")}`;
    return {
      id,
      tag: "p",
      kind: "text",
      text: `Paragraph ${i} says something about the matter at hand.`,
      words: 9,
      html: `<p id="${id}">Paragraph ${i}</p>`,
      gistable: true,
    };
  });
  const nodes: Record<NodeId, TreeNode> = {};
  const leafIds: NodeId[] = blocks.map((b, i) => {
    const id: NodeId = `n${String(i + 3).padStart(4, "0")}`;
    nodes[id] = { id, depth: 2, parent: "n0002", children: [], range: [b.id, b.id], title: "" };
    return id;
  });
  nodes.n0002 = {
    id: "n0002",
    depth: 1,
    parent: "n0001",
    children: leafIds,
    range: [blocks[0]!.id, blocks[2]!.id],
    title: "Section 0",
    gist: "Section 0 argues something.",
  };
  nodes.n0001 = {
    id: "n0001",
    depth: 0,
    parent: null,
    children: ["n0002"],
    range: [blocks[0]!.id, blocks[2]!.id],
    title: "Whole piece",
    gist: "The article argues something.",
  };
  return {
    tree: { version: "test", generator: "test", slug: "test", rootId: "n0001", nodes },
    blocks,
  };
}

/**
 * Run `fn` with every credential the SDK would accept removed — the same
 * guard, for the same reason, as tests/labels-batching.test.ts § `noAuth`.
 * `loadEnvLocal()` leaks into vitest, so without this the batch below would be
 * a real paid call on Greg's machine and a throw everywhere else.
 */
async function noAuth(fn: () => Promise<void>): Promise<void> {
  const saved = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.OPENROUTER_API_KEY;
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v !== undefined) process.env[k] = v;
    }
  }
}

describe("the label batch checkpoints", () => {
  it("says what it asked for and what it found when it finds nothing", async () => {
    const store = memoryCheckpoints({ slug: "test", articleId: "article-under-test" });
    const { tree, blocks } = tinyFixture();

    const written = await logLinesWhile(async () => {
      /* With nothing stored the run goes to the model, and there is no
         credential here, so it throws — after the read, which is the line under
         test. The rejection is asserted rather than swallowed: a version that
         somehow resumed would make this pass for the wrong reason. */
      await noAuth(async () => {
        await expect(
          generateLabels({ tree, blocks, slug: "test", checkpoints: store }),
        ).rejects.toThrow();
      });
    });

    expect(written).toContain("hierarchy-labels");
    const said = lines(written, "hierarchy-labels", '"found":0');
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/"asked":[1-9]/);
  });
});

/* --------------------------------------------------- the scoped expansions -- */

/**
 * One parent of twelve paragraphs, one call, one answer that divides it in two.
 *
 * Nothing here is about what a good division looks like — the protocol's own
 * tests are tests/hierarchy-deepen.test.ts — only about the read that happens
 * before the first call goes out.
 */
function expansionFixture(): {
  batches: ExpansionBatch[];
  blocks: Block[];
  seed: FrozenSeed;
  ancestorsOf: () => readonly OutlineEntry[];
  answer: string;
} {
  const id = (i: number): string => `spya-e${"abcdefghjkmn"[i]}0000`;
  const blocks: Block[] = Array.from({ length: 12 }, (_, i) => ({
    id: id(i),
    tag: "p",
    kind: "text",
    text: `Paragraph ${i} carries the argument a little further along.`,
    words: 9,
    html: `<p id="${id(i)}">Paragraph ${i}</p>`,
    gistable: true,
  }));
  const target: ExpansionTarget = {
    node: { title: "The Long Middle", gist: "It makes its case at length.", range: [id(0), id(11)], status: "pending" },
    where: "root > child 1",
  };
  const batches = planExpansionBatches([target], blocks, CASCADE_RECIPE, UNMEASURED_OVERHEAD).filter(
    (call): call is ExpansionBatch => call.kind === "batch",
  );
  /* `structureHash` of a tree the wave-1 call would have produced. Its shape is
     irrelevant here; that it is frozen is the point, and it is a constant. */
  const seed: FrozenSeed = {
    outline: renderFrozenOutline({
      title: "The Whole Work",
      gist: "It argues one thing.",
      range: [id(0), id(11)],
      children: [{ title: "The Long Middle", gist: "It makes its case at length.", range: [id(0), id(11)] }],
    }),
    hash: structureHash({
      version: "test",
      generator: "test",
      slug: "deepen-log",
      rootId: "n0001",
      nodes: {
        n0001: { id: "n0001", depth: 0, parent: null, children: [], range: [id(0), id(11)], title: "The Whole Work" },
      },
    }),
  };
  const answer = JSON.stringify({
    sections: [
      {
        section: 1,
        children: [
          { start: id(0), title: "The first half", gist: "It opens the case.", verdict: "finished" },
          { start: id(6), title: "The second half", gist: "It closes the case.", verdict: "finished" },
        ],
      },
    ],
  });
  return { batches, blocks, seed, ancestorsOf: () => [], answer };
}

/**
 * **The third caller**, added with the namespace on 2026-09-05.
 *
 * A wave of scoped expansion calls is the most likely of the three to be running
 * with a dead cache and nobody the wiser: the calls are cheap individually, so
 * the symptom of every lookup missing is a bill that is merely larger rather
 * than a step that visibly fails. Its read reports a third number as well —
 * `usable`, the rows that were for this question **and still normalise** — so
 * `found - usable` names the rows that existed and were re-bought anyway, which
 * is the number a poisoned row shows up in.
 *
 * The `found: 0` case is again the one the old design could not produce, and it
 * runs against a fake executor rather than against no credential, because this
 * caller has a seam for exactly that.
 */
describe("the scoped expansion checkpoints", () => {
  it("says what it asked for, what it found and what it could use, on a cold cache", async () => {
    const store = memoryCheckpoints({ slug: "deepen-log", articleId: "article-deepen-log" });
    const { batches, blocks, seed, ancestorsOf, answer } = expansionFixture();

    const written = await logLinesWhile(async () => {
      await runExpansionWave({
        slug: "deepen-log",
        checkpoints: store,
        execute: async () => answer,
        batches,
        ancestorsOf,
        blocks,
        seed,
        recipe: CASCADE_RECIPE,
      });
    });

    expect(written).toContain("hierarchy-deepen");
    const said = lines(written, "hierarchy-deepen", '"found":0');
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/"asked":[1-9]/);
    expect(said[0]).toMatch(/"usable":0/);
  });

  it("says what it found and what it used when everything is already paid for", async () => {
    const store = memoryCheckpoints({ slug: "deepen-log", articleId: "article-deepen-log" });
    const { batches, blocks, seed, ancestorsOf, answer } = expansionFixture();
    const run = async (): Promise<void> => {
      await runExpansionWave({
        slug: "deepen-log",
        checkpoints: store,
        execute: async () => answer,
        batches,
        ancestorsOf,
        blocks,
        seed,
        recipe: CASCADE_RECIPE,
      });
    };
    await run();

    const written = await logLinesWhile(run);
    expect(written).toContain("hierarchy-deepen");
    const said = lines(written, "hierarchy-deepen", '"found":');
    expect(said).toHaveLength(1);
    /* All three track something, which is what stops the pair of tests passing
       on two constants. */
    const n = (field: string): number =>
      Number(new RegExp(`"${field}":(\\d+)`).exec(said[0] ?? "")?.[1]);
    expect(n("asked")).toBeGreaterThan(0);
    expect(n("found")).toBe(n("asked"));
    expect(n("usable")).toBe(n("asked"));
  });
});
