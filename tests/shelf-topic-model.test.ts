/**
 * **The model-named topic tree, without a model**: the parsers, and `rethink`
 * and `fileWorks` driven by fake calls. src/shelf-terms/model-topics.ts; plan
 * 261003f § Greg's answer, and v1.
 */
import { describe, expect, it } from "vitest";

import { ShelfTopicsAnswerInvalid } from "../src/shelf-terms/model-scores.js";
import {
  cleanLabel,
  FILE_BATCH,
  filedInto,
  fileMessages,
  fileWorks,
  granularityOf,
  keyOf,
  NAME_MAX,
  nameMessages,
  type NamedTopic,
  parseFiled,
  parseNamed,
  rethink,
  RethinkOutOfTime,
  SAME_AS_PARENT,
  SPLIT_MIN,
  spread,
  targetCount,
  type TopicCalls,
  type TopicNode,
  type TopicWork,
  type TreeLine,
  treeLines,
  withAncestors,
} from "../src/shelf-terms/model-topics.js";

const works = (n: number, prefix = "w"): TopicWork[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, title: `Title ${i + 1}`, gist: `Gist ${i + 1}` }));

/** A chat completion body carrying `content` as its JSON answer. */
const body = (content: unknown, finish = "stop") => ({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(content) } }] });

const named = (label: string, ids: string[]): NamedTopic => ({ label, key: keyOf(label), works: ids });

describe("labels and keys", () => {
  it("a label is one clipped line with no control characters", () => {
    expect(cleanLabel("  Neuro\u0000science\n& more  ")).toBe("Neuro science & more");
    expect(cleanLabel("safe\u202e evil\u200b")).toBe("safe evil");
    expect(cleanLabel("x".repeat(100))).toHaveLength(40);
    expect(cleanLabel(42)).toBe("");
    expect(cleanLabel("\u001b\u0007")).toBe("");
  });

  it("a key can never carry the comma ?topics= splits on", () => {
    expect(keyOf("AI, Safety & Alignment")).toBe("ai safety alignment");
    expect(keyOf("Café  Society")).toBe("cafe society");
    expect(keyOf("!!!")).toMatch(/^x [0-9a-f]{8}$/);
    expect(keyOf("  ")).toBe("");
  });

  it("a label with no ASCII letters still gets a key, the same one each time, and is not cut mid-character", () => {
    expect(keyOf("佛教")).toMatch(/^x [0-9a-f]{8}$/);
    expect(keyOf("佛教")).toBe(keyOf(" 佛教 "));
    expect(keyOf("佛教")).not.toBe(keyOf("木工"));
    expect([...cleanLabel("😀".repeat(60))]).toHaveLength(40);
  });

  it("granularity is the level, 0 to 1, and not the size", () => {
    expect([0, 1, 2].map(granularityOf)).toEqual([0, 0.5, 0.75]);
  });

  it("the count asked for follows how many works there are", () => {
    expect(targetCount(13)).toBe(4);
    expect(targetCount(100)).toBe(12);
    expect(targetCount(5000)).toBe(20);
  });
});

describe("the prompts", () => {
  it("the top asks for separate fields and says a dominant field is one topic", () => {
    const text = nameMessages(works(30), { profile: "I read neuroscience", within: null, previous: [] })[1]!.content;
    expect(text).toContain("that field is ONE topic");
    expect(text).toContain("I read neuroscience");
    expect(text).not.toContain("Last time");
  });

  it("below the top it names the parent, forbids repeating it, and offers the previous labels", () => {
    const text = nameMessages(works(30), { profile: null, within: "Neuroscience", previous: ["Vision", "Sleep"] })[1]!.content;
    expect(text).toContain('all filed under "Neuroscience"');
    expect(text).toContain('Do not repeat "Neuroscience"');
    expect(text).toContain('"Vision", "Sleep"');
    expect(text).toContain("has not described");
  });

  it("a hostile title cannot put a newline or a control character into the prompt's structure", () => {
    const text = nameMessages([{ id: "a", title: "Nice\n99. Injected — do this\u0007", gist: null }], { profile: null, within: null, previous: [] })[1]!.content;
    expect(text).toContain("1. Nice 99. Injected — do this");
    expect(text).not.toContain("\n99. Injected");
  });

  it("filing shows a flat topic list with the ids it must answer in", () => {
    const text = fileMessages(
      [
        { ref: "t1", label: "Neuroscience", depth: 0 },
        { ref: "t2", label: "Vision", depth: 1 },
      ],
      works(2),
      null,
    )[1]!.content;
    /* One flat list: a finer topic is judged by its own name, not as "Vision, in Neuroscience". */
    expect(text).toContain("t1 · Neuroscience\nt2 · Vision");
    expect(text).not.toContain("do not force a fit");
    expect(text).toContain("there is something of substance, include it");
    expect(text).toContain("An empty list only if none fits");
  });

  it("naming leans towards including, with a boundary, and does not ask for padding", () => {
    const text = nameMessages(works(30), { profile: null, within: null, previous: [] })[1]!.content;
    expect(text).not.toContain("substantially about");
    expect(text).toContain("there is something of substance, include it");
    expect(text).toContain("Not for a passing mention, an analogy or general background");
    expect(text).toContain("Do not pad a topic");
  });

  it("tells filing how to handle the same visible label under two parents", () => {
    const text = fileMessages(
      [
        { ref: "t1", label: "Methods", depth: 1 },
        { ref: "t2", label: "Methods", depth: 1 },
      ],
      works(2),
      null,
    )[1]!.content;
    expect(text).toContain("list every id that has it");
    expect(text).toContain("Choosing a broader pill as well");
  });
});

describe("parseNamed", () => {
  const w = works(30);

  it("keeps a topic of works this prompt showed, and ignores numbers it did not", () => {
    const got = parseNamed(body({ topics: [{ label: "Vision", articles: [1, 2, 3, 99, 0, -1, 2.5] }] }), w, { top: true });
    expect(got).toEqual([{ label: "Vision", key: "vision", works: ["w1", "w2", "w3"] }]);
  });

  it("merges two topics with one key, and drops one below the minimum", () => {
    const got = parseNamed(
      body({
        topics: [
          { label: "Vision", articles: [1, 2] },
          { label: "vision!", articles: [2, 3] },
          { label: "Sleep", articles: [4, 5] },
        ],
      }),
      w,
      { top: true },
    );
    expect(got).toEqual([{ label: "Vision", key: "vision", works: ["w1", "w2", "w3"] }]);
  });

  it("a broad topic on a shelf under twenty needs two works; a finer one always three", () => {
    const small = works(12);
    const answer = body({ topics: [{ label: "Sleep", articles: [1, 2] }] });
    expect(parseNamed(answer, small, { top: true })).toHaveLength(1);
    expect(parseNamed(answer, small, { top: false })).toHaveLength(0);
  });

  it("drops a label that cleans to nothing, and the parent's own name", () => {
    const got = parseNamed(
      body({
        topics: [
          { label: "\u0000", articles: [1, 2, 3] },
          { label: "Neuroscience", articles: [1, 2, 3] },
          { label: "Vision", articles: [4, 5, 6] },
        ],
      }),
      w,
      { top: false, forbidKey: "neuroscience" },
    );
    expect(got.map((t) => t.label)).toEqual(["Vision"]);
  });

  it("refuses an empty answer at the top, and accepts one below it", () => {
    expect(() => parseNamed(body({ topics: [] }), w, { top: true })).toThrow(ShelfTopicsAnswerInvalid);
    expect(parseNamed(body({ topics: [] }), w, { top: false })).toEqual([]);
  });

  it("refuses a cut-off answer, a non-JSON one and one with no topics array, in our own words", () => {
    expect(() => parseNamed(body({ topics: [] }, "length"), w, { top: false })).toThrow("token ceiling");
    expect(() => parseNamed({ choices: [{ message: { content: "Sure! Here is the shelf: secret title" } }] }, w, { top: false })).toThrow(
      "the answer is not JSON",
    );
    expect(() => parseNamed(body({ nope: 1 }), w, { top: false })).toThrow("no topics array");
    try {
      parseNamed({ choices: [{ message: { content: "secret title {" } }] }, w, { top: false });
    } catch (err) {
      expect(String(err)).not.toContain("secret");
    }
  });
});

describe("parseFiled", () => {
  const tree = [
    { ref: "t1", label: "A", depth: 0 },
    { ref: "t2", label: "B", depth: 1 },
  ];
  const w = works(3);

  it("takes only refs and numbers this prompt showed; a work left out fits nothing", () => {
    const got = parseFiled(
      body({
        articles: [
          { article: 1, topics: ["t2", "t9", "t2", 7] },
          { article: 5, topics: ["t1"] },
        ],
      }),
      tree,
      w,
    );
    expect(Object.fromEntries(got)).toEqual({ w1: ["t2"], w2: [], w3: [] });
  });

  it("refuses an answer with no articles array", () => {
    expect(() => parseFiled(body({ topics: [] }), tree, w)).toThrow("no articles array");
  });
});

describe("spread", () => {
  it("is an even sample that keeps the first, and the whole list when it fits", () => {
    expect(spread([1, 2, 3], 5)).toEqual([1, 2, 3]);
    const got = spread(
      Array.from({ length: 300 }, (_, i) => i),
      NAME_MAX,
    );
    expect(got).toHaveLength(NAME_MAX);
    expect(got[0]).toBe(0);
    expect(got[got.length - 1]).toBe(298);
  });
});

describe("the tree's helpers", () => {
  const topics: TopicNode[] = [
    { id: "t1", key: "neuroscience", label: "Neuroscience", parent: null, depth: 0 },
    { id: "t2", key: "buddhism", label: "Buddhism", parent: null, depth: 0 },
    { id: "t3", key: "vision", label: "Vision", parent: "t1", depth: 1 },
    { id: "t4", key: "retinotopy", label: "Retinotopy", parent: "t3", depth: 2 },
  ];

  it("draws each topic under its parent", () => {
    expect(treeLines(topics).map((t) => `${t.depth}${t.ref}`)).toEqual(["0t1", "1t3", "2t4", "0t2"]);
  });

  it("withAncestors adds every topic above a finer one", () => {
    expect(withAncestors(["t4"], topics)).toEqual(["t1", "t3", "t4"]);
    expect(withAncestors(["t2", "nope"], topics)).toEqual(["t2"]);
    expect(withAncestors([], topics)).toEqual([]);
  });
});

describe("rethink", () => {
  /** A fake model: the top call answers `top`; a call within a label answers `within[label]`. */
  function fake(
    top: (w: readonly TopicWork[]) => NamedTopic[],
    within: Record<string, (w: readonly TopicWork[]) => NamedTopic[] | Promise<NamedTopic[]>> = {},
    /** What the widening pass answers; by default it adds nothing. */
    widen?: (tree: readonly TreeLine[], w: readonly TopicWork[]) => Map<string, string[]> | Promise<Map<string, string[]>>,
  ) {
    const log: { within: string | null; shown: number; previous: readonly string[]; forbid: string | undefined }[] = [];
    const filed: { within: string | null; works: number }[] = [];
    /** The widening pass's batches: how many works each was shown. */
    const widened: number[] = [];
    const calls: TopicCalls = {
      name: async (w, name, forbid) => {
        log.push({ within: name.within, shown: w.length, previous: name.previous, forbid });
        if (name.within === null) return top(w);
        const f = within[name.within];
        if (!f) return [];
        return f(w);
      },
      file: async (tree, w, parent) => {
        /* The widening pass shows the finished tree, whose refs are topic ids
           (`t1`); filing a level's leftovers shows that level's own (`n1`). */
        if (tree[0]!.ref.startsWith("t")) {
          widened.push(w.length);
          return widen ? widen(tree, w) : new Map(w.map((x) => [x.id, []]));
        }
        filed.push({ within: parent, works: w.length });
        /* Everything left over goes into the first topic. */
        return new Map(w.map((x) => [x.id, [tree[0]!.ref]]));
      },
    };
    return { calls, log, filed, widened };
  }
  const ids = (w: readonly TopicWork[], from: number, to: number) => w.slice(from, to).map((x) => x.id);

  it("splits a big topic and leaves a small one alone, and every finer membership carries its parent", async () => {
    const shelf = works(40);
    const { calls, log } = fake(
      (w) => [named("Neuroscience", ids(w, 0, 30)), named("Buddhism", ids(w, 30, 37))],
      { Neuroscience: (w) => [named("Vision", ids(w, 0, 10)), named("Sleep", ids(w, 10, 14))] },
    );
    const set = await rethink(shelf, calls, { profile: null });
    expect(set.topics.map((t) => `${t.depth}:${t.label}:${t.parent}`)).toEqual([
      "0:Neuroscience:null",
      "0:Buddhism:null",
      "1:Vision:t1",
      "1:Sleep:t1",
    ]);
    expect(set.members.get("w1")).toEqual(["t1", "t3"]);
    expect(set.members.get("w31")).toEqual(["t2"]);
    /* A work the model placed nowhere is still in the map: it was seen. */
    expect(set.members.get("w40")).toEqual([]);
    /* Buddhism (7 works) is under SPLIT_MIN, so it is never asked about. */
    expect(SPLIT_MIN).toBeGreaterThan(7);
    expect(log.map((l) => l.within)).toEqual([null, "Neuroscience"]);
    expect(log[1]!.forbid).toBe("neuroscience");
  });

  it("does not make a finer topic whose name a broader topic already has", async () => {
    const shelf = works(40);
    const { calls } = fake(
      (w) => [named("Neuroscience", ids(w, 0, 20)), named("Consciousness", ids(w, 20, 36))],
      { Neuroscience: (w) => [named("Consciousness", ids(w, 0, 5)), named("Vision", ids(w, 5, 10))] },
    );
    const set = await rethink(shelf, calls, { profile: null });
    expect(set.topics.map((t) => t.label)).toEqual(["Neuroscience", "Consciousness", "Vision"]);
    expect(new Set(set.topics.map((t) => t.key)).size).toBe(set.topics.length);
  });

  it("drops a finer topic that holds nearly all of its parent: it narrows nothing", async () => {
    const shelf = works(20);
    const { calls } = fake((w) => [named("Neuroscience", ids(w, 0, 20))], {
      Neuroscience: (w) => [named("Brains", ids(w, 0, 19)), named("Vision", ids(w, 0, 6))],
    });
    const set = await rethink(shelf, calls, { profile: null });
    expect(set.topics.map((t) => t.label)).toEqual(["Neuroscience", "Vision"]);
  });

  it("goes three levels and no deeper", async () => {
    const shelf = works(60);
    const all = (label: string) => (w: readonly TopicWork[]) => [named(label, ids(w, 0, Math.floor(w.length * 0.8)))];
    const { calls, log } = fake(all("A"), { A: all("B"), B: all("C"), C: all("D") });
    const set = await rethink(shelf, calls, { profile: null });
    expect(set.topics.map((t) => `${t.depth}:${t.label}`)).toEqual(["0:A", "1:B", "2:C"]);
    expect(log.map((l) => l.within)).toEqual([null, "A", "B"]);
  });

  it("a call below the top that fails once is tried again", async () => {
    const shelf = works(30);
    let tries = 0;
    const { calls } = fake((w) => [named("Neuroscience", ids(w, 0, 15)), named("Economics", ids(w, 15, 30))], {
      Neuroscience: (w) => {
        tries += 1;
        if (tries === 1) throw new Error("provider down");
        return [named("Vision", ids(w, 0, 5))];
      },
    });
    const set = await rethink(shelf, calls, { profile: null });
    expect(tries).toBe(2);
    expect(set.topics.map((t) => t.label)).toEqual(["Neuroscience", "Economics", "Vision"]);
  });

  it("a call below the top that fails twice fails the whole re-think, rather than storing a tree with a branch missing", async () => {
    const shelf = works(30);
    const { calls } = fake((w) => [named("Neuroscience", ids(w, 0, 15)), named("Economics", ids(w, 15, 30))], {
      Neuroscience: () => {
        throw new Error("provider down");
      },
      Economics: (w) => [named("Money", ids(w, 0, 5))],
    });
    await expect(rethink(shelf, calls, { profile: null })).rejects.toThrow("provider down");
  });

  it("waits for other paid branches to finish before a parallel branch failure escapes", async () => {
    const shelf = works(40);
    let releaseSlow: (() => void) | undefined;
    let slowStarted = false;
    const { calls } = fake(
      (w) => [named("Neuroscience", ids(w, 0, 20)), named("Economics", ids(w, 20, 40))],
      {
        Neuroscience: () => {
          throw new Error("provider down");
        },
        Economics: async () => {
          slowStarted = true;
          await new Promise<void>((resolve) => {
            releaseSlow = resolve;
          });
          return [];
        },
      },
    );
    const run = rethink(shelf, calls, { profile: null });
    let settled = false;
    void run.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    while (!slowStarted) await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseSlow?.();
    await expect(run).rejects.toThrow("provider down");
  });

  it("keeps a name two subjects both use at the same level, the second under its parent's key", async () => {
    const shelf = works(40);
    const { calls } = fake(
      (w) => [named("Neuroscience", ids(w, 0, 20)), named("AI", ids(w, 20, 40))],
      { Neuroscience: (w) => [named("Methods", ids(w, 0, 5))], AI: (w) => [named("Methods", ids(w, 0, 6))] },
    );
    const set = await rethink(shelf, calls, { profile: null });
    expect(set.topics.map((t) => `${t.label}|${t.key}|${t.parent}`)).toEqual([
      "Neuroscience|neuroscience|null",
      "AI|ai|null",
      "Methods|methods|t1",
      "Methods|ai methods|t2",
    ]);
    expect(set.members.get("w21")).toEqual(["t2", "t4"]);
  });

  it("keeps a same-name child when its qualified key is already a real topic key", async () => {
    const shelf = works(52);
    const { calls } = fake(
      (w) => [
        named("AI Methods", ids(w, 0, 12)),
        named("Neuroscience", ids(w, 12, 32)),
        named("AI", ids(w, 32, 52)),
      ],
      {
        Neuroscience: (w) => [named("Methods", ids(w, 0, 5))],
        AI: (w) => [named("Methods", ids(w, 0, 6))],
        "AI Methods": () => [],
      },
    );
    const set = await rethink(shelf, calls, { profile: null });
    expect(set.topics.map((t) => t.key)).toEqual(["ai methods", "neuroscience", "ai", "methods", "ai methods 2"]);
    expect(new Set(set.topics.map((t) => t.key)).size).toBe(set.topics.length);
    expect(set.members.get("w33")).toEqual(["t3", "t5"]);
  });

  it("still forbids repeating a parent's label after that parent's key was qualified", async () => {
    const shelf = works(52);
    const { calls, log } = fake(
      (w) => [
        named("AI Methods", ids(w, 0, 12)),
        named("Neuroscience", ids(w, 12, 32)),
        named("AI", ids(w, 32, 52)),
      ],
      {
        "AI Methods": () => [],
        Neuroscience: (w) => [named("Methods", ids(w, 0, 12))],
        AI: (w) => [named("Methods", ids(w, 0, 12))],
        Methods: (w) => [named("Methods", ids(w, 0, 5)), named("Benchmarks", ids(w, 5, 10))],
      },
    );
    await rethink(shelf, calls, { profile: null });
    expect(log.filter((entry) => entry.within === "Methods").map((entry) => entry.forbid)).toEqual(["methods", "methods"]);
  });

  it("refuses an empty top level even when a call seam bypasses the parser", async () => {
    const { calls } = fake(() => []);
    await expect(rethink(works(20), calls, { profile: null })).rejects.toThrow("no usable topic");
  });

  it("a failed top call throws", async () => {
    const { calls } = fake(() => {
      throw new Error("provider down");
    });
    await expect(rethink(works(20), calls, { profile: null })).rejects.toThrow("provider down");
  });

  it("names a level over NAME_MAX from a spread and files the rest in batches", async () => {
    const shelf = works(NAME_MAX + FILE_BATCH + 5);
    const { calls, log, filed } = fake((w) => [named("Everything", ids(w, 0, 5)), named("Other", ids(w, 5, 10))]);
    const set = await rethink(shelf, calls, { profile: null });
    expect(log[0]!.shown).toBe(NAME_MAX);
    expect(filed.map((f) => f.works)).toEqual([FILE_BATCH, 5]);
    const inFirst = [...set.members.values()].filter((m) => m.includes("t1")).length;
    expect(inFirst).toBe(5 + FILE_BATCH + 5);
  });

  describe("the widening pass (Greg's report d4tp0y: a memory paper missing from Memory & Learning)", () => {
    /* AI holds w1–w20 and has a finer Memory & Learning; Psychology holds
       w21–w32. w21 is a memory paper filed under Psychology only, so the call
       that made Memory & Learning never saw it. */
    const top = (w: readonly TopicWork[]) => [named("AI", ids(w, 0, 20)), named("Psychology", ids(w, 20, 32))];
    const within = { AI: (w: readonly TopicWork[]) => [named("Memory & Learning", ids(w, 0, 5)), named("Safety", ids(w, 5, 9))] };

    it("puts an article into a finer topic of a parent it was not under, without putting it in that parent", async () => {
      const { calls, widened } = fake(top, within, (_tree, w) => new Map(w.map((x) => [x.id, x.id === "w21" ? ["t3"] : []])));
      const set = await rethink(works(32), calls, { profile: null });
      expect(set.topics.map((t) => `${t.id}:${t.label}`)).toEqual(["t1:AI", "t2:Psychology", "t3:Memory & Learning", "t4:Safety"]);
      /* Psychology and Memory & Learning; not AI, which it is not about. */
      expect(set.members.get("w21")).toEqual(["t2", "t3"]);
      expect(widened).toEqual([32]);
    });

    it("a work under no broad topic that joins a finer one takes its parent, so it is never missing from every broad pill", async () => {
      /* w33 is placed nowhere by the naming calls. */
      const { calls } = fake(top, within, (_tree, w) => new Map(w.map((x) => [x.id, x.id === "w33" ? ["t3"] : []])));
      const set = await rethink(works(33), calls, { profile: null });
      expect(set.members.get("w33")).toEqual(["t1", "t3"]);
    });

    it("takes a broad topic the pass names for a work", async () => {
      const { calls } = fake(top, within, (_tree, w) => new Map(w.map((x) => [x.id, x.id === "w21" ? ["t1"] : []])));
      const set = await rethink(works(32), calls, { profile: null });
      expect(set.members.get("w21")).toEqual(["t1", "t2"]);
    });

    it("only adds: what the naming calls said stays when the pass leaves it out", async () => {
      const { calls } = fake(top, within);
      const set = await rethink(works(32), calls, { profile: null });
      expect(set.members.get("w1")).toEqual(["t1", "t3"]);
      expect(set.members.get("w21")).toEqual(["t2"]);
    });

    it("shows every work the whole tree, in batches", async () => {
      const seen: string[][] = [];
      const { calls, widened } = fake(top, within, (tree, w) => {
        seen.push(tree.map((t) => `${t.depth}${t.ref}`));
        return new Map(w.map((x) => [x.id, []]));
      });
      await rethink(works(FILE_BATCH + 3), calls, { profile: null });
      expect(widened).toEqual([FILE_BATCH, 3]);
      expect(seen[0]).toEqual(["0t1", "1t3", "1t4", "0t2"]);
    });

    it("is not run when the tree has no finer topics: the one top call saw every work beside every topic", async () => {
      const { calls, widened } = fake(top);
      await rethink(works(32), calls, { profile: null });
      expect(widened).toEqual([]);
    });

    it("names a work once however many ways it reached a topic", async () => {
      /* w1 is already in AI and Memory & Learning; the pass says both again, and Safety. */
      const { calls } = fake(top, within, (_tree, w) => new Map(w.map((x) => [x.id, x.id === "w1" ? ["t1", "t3", "t3", "t4"] : []])));
      const set = await rethink(works(32), calls, { profile: null });
      expect(set.members.get("w1")).toEqual(["t1", "t3", "t4"]);
    });

    it("does not let the pass swell a finer topic to nearly all of its parent: that topic keeps what naming gave it", async () => {
      /* Every work is said to be in Memory & Learning: all 20 of AI's would be
         in it, so with AI chosen the pill would narrow nothing. */
      const { calls } = fake(top, within, (_tree, w) => new Map(w.map((x) => [x.id, ["t3"]])));
      const set = await rethink(works(32), calls, { profile: null });
      const inTopic = (id: string) => [...set.members.values()].filter((m) => m.includes(id)).length;
      expect(inTopic("t3")).toBe(5);
      expect(inTopic("t1")).toBe(20);
      expect(inTopic("t3")).toBeLessThan(inTopic("t1") * SAME_AS_PARENT);
    });

    it("lets a finer topic grow past its parent's size from outside it, while it still narrows the parent", async () => {
      /* All twelve Psychology works join Memory & Learning: 17 in the pill, 5 of AI's 20. */
      const { calls } = fake(top, within, (_tree, w) => new Map(w.map((x) => [x.id, Number(x.id.slice(1)) > 20 ? ["t3"] : []])));
      const set = await rethink(works(32), calls, { profile: null });
      expect([...set.members.values()].filter((m) => m.includes("t3")).length).toBe(17);
    });

    it("starts no call that could outlive the caller's claim, and fails the re-think instead", async () => {
      const { calls, widened } = fake(top, within);
      await expect(rethink(works(32), calls, { profile: null, deadline: Date.now() + 1_000 })).rejects.toBeInstanceOf(RethinkOutOfTime);
      expect(widened).toEqual([]);
    });

    it("a batch that fails once is tried again", async () => {
      let n = 0;
      const { calls } = fake(top, within, (_tree, w) => {
        if (++n === 1) throw new Error("timeout");
        return new Map(w.map((x) => [x.id, x.id === "w21" ? ["t3"] : []]));
      });
      const set = await rethink(works(32), calls, { profile: null });
      expect(set.members.get("w21")).toContain("t3");
    });

    it("a batch that fails twice fails the whole re-think, rather than storing the narrow tree as finished", async () => {
      const { calls } = fake(top, within, () => {
        throw new Error("timeout");
      });
      await expect(rethink(works(32), calls, { profile: null })).rejects.toThrow("timeout");
    });
  });

  it("offers each level its own previous labels", async () => {
    const previous: TopicNode[] = [
      { id: "t1", key: "neuroscience", label: "Neuroscience", parent: null, depth: 0 },
      { id: "t2", key: "vision", label: "Vision", parent: "t1", depth: 1 },
      { id: "t3", key: "buddhism", label: "Buddhism", parent: null, depth: 0 },
    ];
    const { calls, log } = fake((w) => [named("Neuroscience", ids(w, 0, 20))], { Neuroscience: () => [] });
    await rethink(works(25), calls, { profile: null, previous });
    expect(log[0]!.previous).toEqual(["Neuroscience", "Buddhism"]);
    expect(log[1]!.previous).toEqual(["Vision"]);
  });

  it("offers duplicate-name branches their own previous children", async () => {
    const previous: TopicNode[] = [
      { id: "p1", key: "neuroscience", label: "Neuroscience", parent: null, depth: 0 },
      { id: "p2", key: "ai", label: "AI", parent: null, depth: 0 },
      { id: "p3", key: "methods", label: "Methods", parent: "p1", depth: 1 },
      { id: "p4", key: "ai methods", label: "Methods", parent: "p2", depth: 1 },
      { id: "p5", key: "wet labs", label: "Wet Labs", parent: "p3", depth: 2 },
      { id: "p6", key: "benchmarks", label: "Benchmarks", parent: "p4", depth: 2 },
    ];
    const seen: string[][] = [];
    const calls: TopicCalls = {
      name: async (w, name) => {
        if (name.within === null)
          return [named("Neuroscience", ids(w, 0, 24)), named("AI", ids(w, 24, 48))];
        if (name.within === "Neuroscience" || name.within === "AI") return [named("Methods", ids(w, 0, 12))];
        seen.push([...name.previous]);
        return [];
      },
      file: async () => new Map(),
    };
    await rethink(works(48), calls, { profile: null, previous });
    expect(seen).toEqual([["Wet Labs"], ["Benchmarks"]]);
  });
});

describe("fileWorks", () => {
  const topics: TopicNode[] = [
    { id: "t1", key: "neuroscience", label: "Neuroscience", parent: null, depth: 0 },
    { id: "t2", key: "vision", label: "Vision", parent: "t1", depth: 1 },
  ];

  it("adds the ancestors, keeps a work that fits nothing as an empty list, and batches", async () => {
    const batches: number[] = [];
    const calls: TopicCalls = {
      name: async () => [],
      file: async (_tree, w) => {
        batches.push(w.length);
        return new Map(w.map((x, i) => [x.id, i === 0 ? ["t2"] : []]));
      },
    };
    const got = await fileWorks(topics, works(FILE_BATCH + 2), calls);
    expect(batches).toEqual([FILE_BATCH, 2]);
    expect(got.get("w1")).toEqual(["t1", "t2"]);
    expect(got.get("w2")).toEqual([]);
    expect(got.size).toBe(FILE_BATCH + 2);
  });

  it("takes the answer as it stands when it names a broad topic: a finer topic does not bring its parent", () => {
    const tree: TopicNode[] = [
      ...topics,
      { id: "t3", key: "psychology", label: "Psychology", parent: null, depth: 0 },
      { id: "t4", key: "visual cortex", label: "Visual Cortex", parent: "t2", depth: 2 },
    ];
    /* A depth-2 topic under Neuroscience, and Psychology: neither ancestor is added. */
    expect(filedInto(["t4", "t3"], tree)).toEqual(["t3", "t4"]);
    /* No broad topic named, and none held: the parent comes too. */
    expect(filedInto(["t4"], tree)).toEqual(["t1", "t2", "t4"]);
    /* Already under a broad topic: only what was named. */
    expect(filedInto(["t4"], tree, true)).toEqual(["t4"]);
    expect(filedInto(["nope", "t4", "t4"], tree, true)).toEqual(["t4"]);
  });
});
