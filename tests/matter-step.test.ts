/**
 * **The `matter` step's own halves** — src/matter-step.ts (plan 261018a,
 * Stage 2, review F2): what it stores when the call answers, when the call
 * fails and when there is nothing to read; and the read boundary that hands
 * the reading view a stored value only when it is about the blocks on the
 * payload. No network: the gateway is stood in for.
 *
 * tests/matter-step-pg.test.ts is the database half: the owner's article read
 * and the publication that queues the step.
 */
import { describe, expect, it } from "vitest";

import type { MatterGateway } from "../src/matter.js";
import { MATTER_PROMPT_VERSION, matterForReader, matterInputHash } from "../src/matter-current.js";
import { isMatterDocument } from "../src/matter-shape.js";
import {
  LABELS_ONLY_GENERATOR,
  MATTER_GENERATOR,
  buildMatter,
  matterSettled,
} from "../src/matter-step.js";
import type { Block, Matter } from "../src/types.js";

const wordsOf = (t: string) => t.split(/\s+/u).filter(Boolean).length;
const PROSE =
  "We argue that the question is open, and that it has been studied for decades by people who disagree about what the evidence shows and why it matters for the rest of the field.";
const REF = (i: number) => `Author ${i}, A. (2019). A study of things. Journal of Studies, 12, 1–10. doi:10.1000/x${i}`;

let counter = 0;
const block = (text: string, kind: Block["kind"] = "text", level?: number): Block => ({
  id: `spya-s${String(counter++).padStart(5, "0")}`,
  kind,
  ...(level === undefined ? {} : { level }),
  tag: kind === "heading" ? `h${level ?? 2}` : "p",
  text,
  words: wordsOf(text),
  html: `<p>${text}</p>`,
  gistable: true,
});

/** A body of prose under headings, then a "References" heading and 30 entries. */
function paper(): Block[] {
  const blocks: Block[] = [block("A paper about things")];
  for (let s = 0; s < 8; s++) {
    blocks.push(block(`${s + 1} Section ${s + 1}`, "heading", 2));
    for (let k = 0; k < 20; k++) blocks.push(block(`${PROSE} Paragraph ${s}.${k}.`));
  }
  blocks.push(block("References", "heading", 2));
  for (let r = 0; r < 30; r++) blocks.push(block(REF(r)));
  return blocks;
}

const body = (content: string) => ({ choices: [{ finish_reason: "stop", message: { content } }] });
const answering =
  (content: string): MatterGateway =>
  async () => ({ json: body(content), answeredBy: null, generationId: null }) as Awaited<ReturnType<MatterGateway>>;
const failing: MatterGateway = async () => {
  throw new Error("boom");
};

const okValue = (blocks: Block[], stretches: { from: string; to: string }[]): Matter => ({
  status: "ok",
  version: MATTER_PROMPT_VERSION,
  generator: MATTER_GENERATOR,
  sourceHash: matterInputHash(blocks),
  stretches: stretches.map((s) => ({ ...s, kinds: ["references"] })),
});

describe("buildMatter", () => {
  it("stores the union of both sources, named for both, when the call answers", async () => {
    const blocks = paper();
    const refs = blocks.findIndex((b) => b.text === "References");
    const answer = JSON.stringify({ stretches: [{ type: "section", heading: blocks[refs]!.id, kinds: ["references"] }] });
    const { matter } = await buildMatter({ blocks, meta: { title: "A paper about things" } }, { gateway: answering(answer) });
    expect(matter.status).toBe("ok");
    if (matter.status !== "ok") return;
    expect(matter.generator).toBe(MATTER_GENERATOR);
    expect(matter.modelUnavailable).toBeUndefined();
    expect(matter.sourceHash).toBe(matterInputHash(blocks));
    expect(matter.stretches.some((s) => s.kinds.includes("references"))).toBe(true);
    expect(isMatterDocument(matter)).toBe(true);
  });

  it("still folds what the labels rule finds when the call fails, and says why in a closed code", async () => {
    const blocks = paper();
    const { matter } = await buildMatter({ blocks, meta: null }, { gateway: failing });
    expect(matter).toMatchObject({ status: "ok", generator: LABELS_ONLY_GENERATOR, modelUnavailable: "call-failed" });
    if (matter.status !== "ok") return;
    /* The "References" heading is a label the free rule knows. */
    expect(matter.stretches.some((s) => s.kinds.includes("references"))).toBe(true);
    expect(isMatterDocument(matter)).toBe(true);
  });

  it("calls a refused answer invalid, never quoting it", async () => {
    const { matter } = await buildMatter({ blocks: paper(), meta: null }, { gateway: answering("I would rather not") });
    expect(matter).toMatchObject({ status: "ok", modelUnavailable: "invalid-answer" });
    expect(JSON.stringify(matter)).not.toContain("rather not");
  });

  it("stores unavailable only for a failure of the step itself: no blocks", async () => {
    const { matter } = await buildMatter({ blocks: [], meta: null }, { gateway: failing });
    expect(matter).toEqual({ status: "unavailable", version: MATTER_PROMPT_VERSION, sourceHash: matterInputHash([]), reason: "no-blocks" });
    expect(isMatterDocument(matter)).toBe(true);
  });

  it("rethrows the caller's abort rather than storing it", async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(buildMatter({ blocks: paper(), meta: null }, { gateway: failing, signal: ctl.signal })).rejects.toThrow();
  });
});

describe("matterForReader — the stretches reach the reading view only about these blocks", () => {
  const blocks = paper();
  const a = blocks[blocks.length - 30]!.id;
  const b = blocks[blocks.length - 1]!.id;

  it("hands on a valid value about these blocks, an empty list included", () => {
    expect(matterForReader(okValue(blocks, [{ from: a, to: b }]), blocks)).toEqual([{ from: a, to: b, kinds: ["references"] }]);
    expect(matterForReader(okValue(blocks, []), blocks)).toEqual([]);
  });

  it("withholds a value written by an older safety rule", () => {
    expect(matterForReader({ ...okValue(blocks, [{ from: a, to: b }]), version: "matter/1" }, blocks)).toBeUndefined();
  });

  it("still folds a value from a version that only lacked a source of candidates (matter/2, plan 261024h)", () => {
    expect(MATTER_PROMPT_VERSION).not.toBe("matter/2");
    const legacyBlocks: Block[] = [
      { id: "spya-aaaaaa", kind: "text", tag: "p", text: "A", words: 1, html: "<p>A</p>", gistable: true },
      { id: "spya-bbbbbb", kind: "text", tag: "p", text: "B", words: 1, html: "<p>B</p>", gistable: true },
    ];
    /* Pinned from matter/2's m1 `[id,text,kind,level,words,role]` contract,
       rather than made with today's hash and merely relabelled as old. */
    const legacy: Matter = {
      status: "ok",
      version: "matter/2",
      generator: MATTER_GENERATOR,
      sourceHash: "m1:06756ee7e3eebb0e",
      stretches: [{ from: "spya-aaaaaa", to: "spya-bbbbbb", kinds: ["references"] }],
    };
    expect(matterForReader(legacy, legacyBlocks)).toEqual(legacy.stretches);
  });

  it("withholds a value carried over blocks that have since changed", () => {
    const stored = okValue(blocks, [{ from: a, to: b }]);
    const edited = blocks.map((x, i) => (i === 5 ? { ...x, text: `${x.text} And one more.` } : x));
    expect(matterForReader(stored, edited)).toBeUndefined();
    /* A paragraph turned into a heading moves the hash too (review F1). */
    const retyped = blocks.map((x, i) => (i === 5 ? { ...x, kind: "heading" as const, level: 3 } : x));
    expect(matterForReader(stored, retyped)).toBeUndefined();
    /* matter/3's free contents source reads links from html. Keeping the same
       words and ids while removing one must not keep a carried fold current. */
    const relinked = blocks.map((x, i) =>
      i === 5 ? { ...x, html: `<p><a href="#${blocks[10]!.id}">${x.text}</a></p>` } : x,
    );
    expect(matterForReader(stored, relinked)).toBeUndefined();
  });

  it("withholds a value copied from another article, whatever its ids", () => {
    const other = paper();
    expect(matterForReader(okValue(other, [{ from: a, to: b }]), blocks)).toBeUndefined();
  });

  it("withholds an id that is not a block here, a backwards range and stretches out of order", () => {
    expect(matterForReader(okValue(blocks, [{ from: "spya-zzzzzz", to: b }]), blocks)).toBeUndefined();
    expect(matterForReader(okValue(blocks, [{ from: b, to: a }]), blocks)).toBeUndefined();
    const c = blocks[2]!.id;
    const d = blocks[3]!.id;
    expect(matterForReader(okValue(blocks, [{ from: a, to: b }, { from: c, to: d }]), blocks)).toBeUndefined();
    expect(matterForReader(okValue(blocks, [{ from: c, to: a }, { from: d, to: b }]), blocks)).toBeUndefined();
  });

  it("withholds an invalid shape, an unknown kind, and an unavailable value", () => {
    const hash = matterInputHash(blocks);
    expect(matterForReader(null, blocks)).toBeUndefined();
    expect(matterForReader({ status: "ok", version: MATTER_PROMPT_VERSION, sourceHash: hash, stretches: [] }, blocks)).toBeUndefined();
    expect(
      matterForReader(
        { status: "ok", version: MATTER_PROMPT_VERSION, generator: "x", sourceHash: hash, stretches: [{ from: a, to: b, kinds: ["appendix"] }] },
        blocks,
      ),
    ).toBeUndefined();
    expect(
      matterForReader({ status: "ok", version: MATTER_PROMPT_VERSION, generator: "x", sourceHash: hash, stretches: [], modelUnavailable: "the model said no" }, blocks),
    ).toBeUndefined();
    expect(matterForReader({ status: "unavailable", version: MATTER_PROMPT_VERSION, sourceHash: hash, reason: "step-failed" }, blocks)).toBeUndefined();
  });
});

describe("matterSettled — whether a publication still needs the step", () => {
  const blocks = paper();
  it("is settled by any stored value about these blocks, a failure included, and by nothing else", () => {
    expect(matterSettled(null, blocks)).toBe(false);
    expect(matterSettled(okValue(blocks, []), blocks)).toBe(true);
    expect(matterSettled({ status: "unavailable", version: MATTER_PROMPT_VERSION, sourceHash: matterInputHash(blocks), reason: "step-failed" }, blocks)).toBe(true);
    expect(matterSettled(okValue(paper(), []), blocks)).toBe(false);
  });

  it("queues a successor when the stored value belongs to an older rule", () => {
    expect(matterSettled({ ...okValue(blocks, []), version: "matter/1" }, blocks)).toBe(false);
    expect(matterSettled({ status: "unavailable", version: "matter/1", sourceHash: matterInputHash(blocks), reason: "step-failed" }, blocks)).toBe(false);
    /* Readable is not settled: a matter/2 value still folds, and the next run replaces it. */
    expect(matterSettled({ ...okValue(blocks, []), version: "matter/2" }, blocks)).toBe(false);
  });
});
