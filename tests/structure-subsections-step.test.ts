/**
 * **Stage 2 inside the structure step** — on by default, off by its switch,
 * never beside the deepening wave, and a failure keeps stage 1's tree. Plan
 * docs/plans/261101d-structure-fourth-level-staged-second-call.md.
 *
 * No network: stage 1's `streamMessage` answers a fixed tree, `generateLabels`
 * is stubbed, and stage 2's executor is passed in.
 */
import { describe, expect, it, vi } from "vitest";
import type { SubsectionsRequest } from "../src/structure-subsections.js";
import type { Block, Tree } from "../src/types.js";

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: () => ({
      onText: () => {},
      finalMessage: async () => ({ content: [{ type: "text", text: STAGE1 }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }),
    }),
  };
});

vi.mock("../src/labels.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/labels.js")>();
  return {
    ...real,
    generateLabels: async () => {
      throw new Error("the structure step must not label");
    },
  };
});

const { generateStructure } = await import("../src/structure.js");
const { nullCheckpointStore } = await import("../src/store/checkpoints.js");

const spec = [
  "h2:Part A", "Part A opens.", "h3:Section one", "It begins.", "h4:Sub a", "Sub a prose.", "h4:Sub b", "Sub b prose.",
  "h3:Section two", "Two prose.", "h2:Part B", "Part B opens.", "h3:Section three", "Three prose.",
];
const BLOCKS: Block[] = spec.map((s, n) => {
  const m = /^h(\d):(.*)$/.exec(s);
  const text = m ? m[2]! : s;
  return {
    id: `spya-stp${n.toString().padStart(3, "0")}`,
    tag: m ? `h${m[1]}` : "p",
    kind: m ? "heading" : "text",
    ...(m ? { level: Number(m[1]) } : {}),
    text,
    words: text.split(" ").length,
    html: `<p>${text}</p>`,
    gistable: true,
  } as Block;
});

const STAGE1 = JSON.stringify({
  root: {
    title: "The piece",
    gist: "The piece has two parts.",
    question: "The piece — what does it say?",
    children: [
      {
        title: "Part A",
        gist: "Part A has two sections.",
        question: "Part A — what?",
        start: 0,
        children: [
          { title: "Section one", gist: "Section one has two sub-sections in it.", start: 0 },
          { title: "Section two", gist: "Section two is short.", start: 8 },
        ],
      },
      {
        title: "Part B",
        gist: "Part B has two sections.",
        question: "Part B — what?",
        start: 10,
        children: [
          { title: "Part B opening", gist: "Part B opens.", start: 10 },
          { title: "Section three", gist: "Section three is short.", start: 12 },
        ],
      },
    ],
  },
});

const GIST = "A gist that is long enough to pass the floor of words.";
const answer = (r: SubsectionsRequest) =>
  JSON.stringify({ sections: r.plans.map((p, i) => ({ section: i + 1, subsections: p.children.map(() => ({ title: "Opening", gist: GIST })) })) });

const run = (extra: Partial<Parameters<typeof generateStructure>[0]>) =>
  generateStructure({ power: "standard", blocks: BLOCKS, slug: "stage2-step", checkpoints: nullCheckpointStore(), ...extra });

const depth3 = (t: Tree) => Object.values(t.nodes).filter((n) => n.depth === 3 && n.children.length > 0);

describe("stage 2 in the structure step", () => {
  it("runs by default and adds the sub-sections under the section", async () => {
    let calls = 0;
    const result = await run({ subsectionsExecutor: async (r) => (calls++, answer(r)) });
    expect(calls).toBe(1);
    expect(result.subsectionPass).toMatchObject({ eligible: 1, made: 1, added: 3 });
    expect(result.subsectionPassFailed).toBe(false);
    expect(depth3(result.parts.tree).map((n) => n.title)).toEqual(["Opening", "Sub a", "Sub b"]);
  });

  it("is off when asked, and the tree is stage 1's", async () => {
    const result = await run({ subsections: false, subsectionsExecutor: async () => { throw new Error("not called"); } });
    expect(result.subsectionPass).toBeNull();
    expect(depth3(result.parts.tree)).toHaveLength(0);
  });

  it("does not run beside the deepening wave", async () => {
    let called = false;
    const result = await run({
      deepen: true,
      expansionExecutor: async () => {
        throw new Error("no wave answer in this test");
      },
      subsectionsExecutor: async (r) => ((called = true), answer(r)),
    });
    expect(called).toBe(false);
    expect(result.subsectionPass).toBeNull();
  });

  it("keeps stage 1's tree when every call fails, and says so on the run", async () => {
    const result = await run({ subsectionsExecutor: async () => { throw new Error("upstream down"); } });
    expect(result.subsectionPass).toMatchObject({ made: 0, failedCalls: 1, failedSections: 1 });
    expect(depth3(result.parts.tree)).toHaveLength(0);
  });
});
