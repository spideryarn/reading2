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
  narrowBeforeTopics,
  narrowShelf,
  topicCounts,
  topicMembers,
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

describe("isArchived", () => {
  it("reads the server's archivedAt, and nothing else", () => {
    expect(isArchived(entry("x", { archivedAt: "2026-09-20T00:00:00.000Z" }))).toBe(true);
    expect(isArchived(entry("x"))).toBe(false);
  });
});
