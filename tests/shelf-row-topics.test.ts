/**
 * **Every topic each article is in, and the first three of them** — the data
 * behind the pills on a shelf card and table row, and behind the paper card.
 * Plan docs/plans/261005a-topic-pills-on-each-shelf-card-and-table-row.md.
 * What the page draws from it is in tests/shelf-topics.test.tsx.
 */
import { describe, expect, it } from "vitest";
import { articleTopics, NO_ARTICLE_TOPICS, ROW_TOPICS, rowTopics } from "../src/web/article-topics.js";
import { topicHueStops } from "../src/web/topic-colour.js";

const named = (label: string, granularity: number | undefined, ...slugs: string[]) => ({
  key: label.toLowerCase(),
  label,
  articles: slugs.map((slug) => ({ slug })),
  ...(granularity === undefined ? {} : { granularity }),
});

const TERMS = [
  named("Neuroscience", 0, "a", "b"),
  named("Business", 0, "a", "c"),
  named("Memory", 0.5, "a"),
  named("Mnemonics", 0.75, "a", "b"),
  named("phrase", undefined, "c"),
];

describe("articleTopics", () => {
  const topics = articleTopics(TERMS);

  it("lists every topic an article is in, in the server's rank order", () => {
    expect(topics.bySlug.get("a")?.map((t) => t.label)).toEqual(["Neuroscience", "Business", "Memory", "Mnemonics"]);
    expect(topics.bySlug.get("b")?.map((t) => t.label)).toEqual(["Neuroscience", "Mnemonics"]);
    expect(topics.bySlug.get("nowhere")).toBeUndefined();
  });

  it("gives each topic the hue the Topics row gives it", () => {
    const hues = topicHueStops(TERMS);
    expect([...topics.hues]).toEqual([...hues]);
    for (const t of topics.bySlug.get("a") ?? []) expect(t.slot).toBe(hues.get(t.key ?? ""));
  });

  it("marks a finer topic, and puts only a model's label in the model's voice", () => {
    expect(topics.bySlug.get("a")?.map((t) => Boolean(t.finer))).toEqual([false, false, true, true]);
    expect(topics.bySlug.get("c")?.map((t) => t.voice)).toEqual(["ai", undefined]);
  });

  it("is the one empty value for no topics", () => {
    expect(articleTopics([])).toBe(NO_ARTICLE_TOPICS);
  });
});

describe("rowTopics", () => {
  const all = articleTopics(TERMS).bySlug.get("a") ?? [];

  const five = [...all, { label: "Fifth", slot: 0 }];

  it("shows the first three of five or more, and counts the rest", () => {
    expect(ROW_TOPICS).toBe(3);
    const { shown, more } = rowTopics(five);
    expect(shown.map((t) => t.label)).toEqual(["Neuroscience", "Business", "Memory"]);
    expect(more).toBe(2);
    expect(rowTopics([...five, ...five]).more).toBe(7);
  });

  it("shows all of four or fewer: a +1 would take the room of the pill it hides", () => {
    for (const n of [1, 2, 3, 4]) {
      const { shown, more } = rowTopics(all.slice(0, n));
      expect(shown).toHaveLength(n);
      expect(more).toBe(0);
    }
  });
});
