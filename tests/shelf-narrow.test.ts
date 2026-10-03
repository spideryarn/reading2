/**
 * **The shelf's narrowing and the one count formula**, as pure functions.
 *
 * Plan 260928a § The UI, and GPT Sol's F6 and F11 on it: one narrowing
 * function for both the active and the archived list, in the order
 * scope → search → Unread → topics; and every chip's count is
 * `|visible ∩ its articles|` where `visible = scope ∩ search ∩ Unread ∩ every
 * selected topic` — so a selected chip's count equals the number shown.
 */
import { describe, expect, it } from "vitest";
import type { LibraryEntry } from "../src/types.js";
import {
  availableTopics,
  chosenTopics,
  isArchived,
  isModelNamed,
  MAX_TOPIC_DEPTH,
  narrowBeforeTopics,
  narrowShelf,
  tagFacets,
  topicCounts,
  topicDepth,
  topicMembers,
  withinChosenFirst,
  type ShelfTerm,
} from "../src/web/shelf-narrow.js";

function entry(slug: string, over: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    slug,
    title: `Title ${slug}`,
    addedAt: "2026-09-01T00:00:00.000Z",
    words: 1000,
    minutes: 5,
    blocks: 10,
    parts: 1,
    sections: 1,
    comments: 0,
    opens: 1,
    has: { arc: false, tweets: false, glossary: false },
    ...over,
  } as LibraryEntry;
}

const term = (key: string, ...slugs: string[]): ShelfTerm => ({
  key,
  label: key,
  articles: slugs.map((slug, i) => ({ slug, count: 10 - i })),
});

const SHELF = [
  entry("a", { title: "Memory and the brain", opens: 0 }),
  entry("b", { title: "Neurons firing" }),
  entry("c", { title: "Memory palaces", opens: 0 }),
  entry("d", { title: "Startups" }),
];

const TERMS = [term("memory", "a", "c", "b"), term("neuron", "a", "b"), term("startup", "d")];

describe("narrowShelf", () => {
  it("applies search, then Unread, then every chosen topic (AND)", () => {
    const members = topicMembers(TERMS, ["memory", "neuron"]);
    expect(narrowShelf(SHELF, { query: "", unread: false, topics: members }).map((e) => e.slug)).toEqual(["a", "b"]);
    expect(narrowShelf(SHELF, { query: "", unread: true, topics: members }).map((e) => e.slug)).toEqual(["a"]);
    expect(narrowShelf(SHELF, { query: "neurons", unread: false, topics: members }).map((e) => e.slug)).toEqual(["b"]);
  });

  it("with no topics chosen is search and Unread alone", () => {
    expect(narrowShelf(SHELF, { query: "memory", unread: false, topics: [] }).map((e) => e.slug)).toEqual(["a", "c"]);
    expect(narrowBeforeTopics(SHELF, { query: "", unread: true }).map((e) => e.slug)).toEqual(["a", "c"]);
  });

  it("ignores a key that is not among the topics rather than emptying the shelf", () => {
    const members = topicMembers(TERMS, ["gone"]);
    expect(members).toEqual([]);
    expect(narrowShelf(SHELF, { query: "", unread: false, topics: members })).toHaveLength(4);
  });
});

describe("chosenTopics", () => {
  it("applies nothing before the topics have loaded", () => {
    expect(chosenTopics(["memory"], null)).toEqual([]);
  });

  it("keeps only keys that are among the loaded topics, in the order asked", () => {
    expect(chosenTopics(["neuron", "gone", "memory"], TERMS)).toEqual(["neuron", "memory"]);
  });
});

describe("topicCounts — the one formula", () => {
  const all = SHELF.map((e) => e.slug);

  it("counts each topic's articles among those visible", () => {
    const counts = topicCounts(all, [], TERMS);
    expect(Object.fromEntries(counts)).toEqual({ memory: 3, neuron: 2, startup: 1 });
  });

  it("narrows by every selected topic first, so a selected chip equals the number shown", () => {
    const selected = ["memory", "neuron"];
    const counts = topicCounts(all, selected, TERMS);
    const shown = narrowShelf(SHELF, { query: "", unread: false, topics: topicMembers(TERMS, selected) });
    expect(counts.get("memory")).toBe(shown.length);
    expect(counts.get("neuron")).toBe(shown.length);
    expect(counts.get("startup")).toBe(0);
  });

  it("respects search and Unread through `visibleBeforeTopics`", () => {
    const visible = narrowBeforeTopics(SHELF, { query: "", unread: true }).map((e) => e.slug);
    expect(Object.fromEntries(topicCounts(visible, [], TERMS))).toEqual({ memory: 2, neuron: 1, startup: 0 });
  });

  it("counts physical slugs, not works — and ignores members outside the scope", () => {
    const copies = [term("ball lightning", "x1", "x2", "x3", "elsewhere")];
    expect(topicCounts(["x1", "x2", "x3"], [], copies).get("ball lightning")).toBe(3);
  });

  it("keeps a selected chip at zero when nothing visible has it", () => {
    const counts = topicCounts(["d"], ["memory"], TERMS);
    expect(counts.get("memory")).toBe(0);
    expect(counts.get("startup")).toBe(0);
  });
});

describe("availableTopics (plan 260929a, report 4Y)", () => {
  const ranked = [term("a"), term("b"), term("c"), term("d")];
  const count = (n: Record<string, number>) => (k: string) => n[k] ?? 0;

  it("drops a topic at zero, keeping the server's rank order", () => {
    const got = availableTopics(ranked, count({ a: 2, b: 0, c: 5, d: 1 }), new Set());
    expect(got.map((t) => t.key)).toEqual(["a", "c", "d"]);
  });

  it("keeps a chosen topic at zero, so it can be removed", () => {
    const got = availableTopics(ranked, count({ a: 2 }), new Set(["c"]));
    expect(got.map((t) => t.key)).toEqual(["a", "c"]);
  });
});

/* Topics a model named as a broad-to-fine tree — plan 261003f. Greg,
   2026-10-03: "if I pick neuroscience, then it'll hide all of the
   non-neuroscience-related topic pills. And then I can easily filter down
   within those at sort of increasing levels of granularity." */
describe("a three-level tree of model-named topics", () => {
  /* No `count` on a member: there is no phrase to count. The server's order,
     broad first. a–c are neuroscience, d–e are AI, and c is both. */
  const named = (key: string, granularity: number, within: string | undefined, ...slugs: string[]): ShelfTerm => ({
    key,
    label: key,
    articles: slugs.map((slug) => ({ slug })),
    granularity,
    ...(within === undefined ? {} : { within }),
  });
  const TREE = [
    named("neuroscience", 0, undefined, "a", "b", "c"),
    named("ai", 0, undefined, "c", "d", "e"),
    named("cooking", 0, undefined, "f"),
    named("vision", 0.5, "neuroscience", "a", "b"),
    named("learning", 0.5, "ai", "c", "d"),
    named("retinotopy", 0.75, "vision", "a"),
  ];
  const ALL = ["a", "b", "c", "d", "e", "f"];
  const offered = (selected: string[]) => {
    const counts = topicCounts(ALL, selected, TREE);
    return availableTopics(TREE, (k) => counts.get(k) ?? 0, new Set(selected));
  };
  const keys = (terms: readonly ShelfTerm[]) => terms.map((t) => t.key);

  it("hiding zeros alone drops the unrelated subject, but leaves an overlapping one ahead of the finer topics", () => {
    /* What the row did before `withinChosenFirst`: *cooking* goes, but *ai*
       and *learning* share article c with neuroscience, so *ai* still sits
       between the chosen pill and the next step down. */
    expect(keys(offered(["neuroscience"]))).toEqual(["neuroscience", "ai", "vision", "learning", "retinotopy"]);
  });

  it("moves the topics directly inside the chosen one to just after it", () => {
    const chosen = new Set(["neuroscience"]);
    expect(keys(withinChosenFirst(offered(["neuroscience"]), chosen))).toEqual([
      "neuroscience",
      "vision",
      "ai",
      "learning",
      "retinotopy",
    ]);
  });

  it("goes a level down when the finer topic is chosen too, and the pressed pill does not move", () => {
    /* A wider tree, so something survives to be ordered: g is neuroscience,
       memory and ai at once. */
    const wide = [
      named("neuroscience", 0, undefined, "a", "b", "g"),
      named("ai", 0, undefined, "a", "g"),
      named("vision", 0.5, "neuroscience", "a", "b"),
      named("memory", 0.5, "neuroscience", "a", "g"),
      named("retinotopy", 0.75, "vision", "a"),
    ];
    const one = new Set(["neuroscience"]);
    expect(keys(withinChosenFirst(wide, one))).toEqual(["neuroscience", "vision", "memory", "ai", "retinotopy"]);
    /* Vision stays second; what is inside it joins the group, broad first. */
    const two = new Set(["neuroscience", "vision"]);
    expect(keys(withinChosenFirst(wide, two))).toEqual(["neuroscience", "vision", "memory", "retinotopy", "ai"]);
  });

  it("leaves a finer topic chosen on its own where the server ranked it", () => {
    const got = withinChosenFirst(TREE, new Set(["vision"]));
    expect(keys(got)).toEqual(["neuroscience", "ai", "cooking", "vision", "retinotopy", "learning"]);
  });

  it("never puts a finer topic ahead of the chosen topic it is inside", () => {
    /* *ai* is ranked second: what is ahead of it stays ahead. */
    expect(keys(withinChosenFirst(offered(["ai"]), new Set(["ai"])))).toEqual(["neuroscience", "ai", "learning"]);
  });

  it("is the identity with nothing chosen, and for phrase topics", () => {
    expect(withinChosenFirst(TREE, new Set())).toEqual(TREE);
    const phrases = [term("a"), term("b"), term("c")];
    expect(withinChosenFirst(phrases, new Set(["b"]))).toEqual(phrases);
  });

  it("reads a topic's depth off the within chain, capped, and 0 for a phrase", () => {
    const byKey = new Map(TREE.map((t) => [t.key, t]));
    const depth = (key: string) => topicDepth(byKey.get(key) as ShelfTerm, byKey);
    expect(["neuroscience", "vision", "retinotopy"].map(depth)).toEqual([0, 1, 2]);
    expect(topicDepth(term("phrase", "a"), byKey)).toBe(0);
    /* A finer topic whose parent did not arrive is still not a broad subject. */
    expect(topicDepth(named("orphan", 0.5, "gone", "a"), byKey)).toBe(1);
    /* A chain that loops ends at the cap rather than spinning. */
    const loop = new Map([
      ["x", named("x", 0.5, "y", "a")],
      ["y", named("y", 0.5, "x", "a")],
    ]);
    expect(topicDepth(loop.get("x") as ShelfTerm, loop)).toBe(MAX_TOPIC_DEPTH);
  });

  it("says model-named only when a topic carries a granularity", () => {
    expect(isModelNamed(TREE)).toBe(true);
    expect(isModelNamed(TERMS)).toBe(false);
    expect(isModelNamed([])).toBe(false);
  });
});

describe("isArchived", () => {
  it("reads the server's archivedAt, and nothing else", () => {
    expect(isArchived(entry("x", { archivedAt: "2026-09-20T00:00:00.000Z" }))).toBe(true);
    expect(isArchived(entry("x"))).toBe(false);
  });
});

/* The reader's own tags as facets — plan 261003d. */
describe("tagFacets", () => {
  const shelf = [
    entry("a", { tags: ["ai", "memory"] }),
    entry("b", { tags: ["ai"] }),
    entry("c", { tags: ["buddhism"] }),
    entry("d"), // a row cached before tags existed: none
  ];

  it("makes one facet per tag in scope, most-used first, then by name", () => {
    expect(tagFacets(shelf).map((t) => [t.key, t.articles.map((a) => a.slug)])).toEqual([
      ["ai", ["a", "b"]],
      ["buddhism", ["c"]],
      ["memory", ["a"]],
    ]);
  });

  it("narrows with topics by the one AND rule", () => {
    const tags = tagFacets(shelf);
    const topic: ShelfTerm = {
      key: "t",
      label: "t",
      articles: [
        { slug: "b", count: 1 },
        { slug: "c", count: 1 },
      ],
    };
    const members = [...topicMembers([topic], ["t"]), ...topicMembers(tags, ["ai"])];
    expect(narrowShelf(shelf, { query: "", unread: false, topics: members }).map((e) => e.slug)).toEqual([
      "b",
    ]);
  });

  it("ignores a chosen tag no article in scope carries, rather than emptying the shelf", () => {
    expect(chosenTopics(["ai", "gone"], tagFacets(shelf))).toEqual(["ai"]);
  });
});
