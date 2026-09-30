/**
 * A shelf topic's hue from which articles it shares with the others —
 * src/web/topic-colour.ts, plan 260930b, report 5N.
 *
 * The shelves here are the shape Greg described and GPT Sol turned into a
 * fixture: one cluster of related topics (his nine on AI and interpretability)
 * and a crowd of topics that share nothing with anything (Buddhism, post-Kantian
 * literature). The first plan, 1-D MDS, gave the crowd a handful of colours
 * between them; these tests are what says it no longer does.
 */
import { describe, expect, it } from "vitest";
import { HUE_STOPS, topicColourStyle, topicHueStops } from "../src/web/topic-colour.js";

/** A topic whose members are these article slugs. */
const topic = (key: string, slugs: string[]) => ({ key, articles: slugs.map((slug) => ({ slug })) });

/** `count` topics that each pick out the same core articles, plus a few of their own. */
function cluster(prefix: string, count: number): ReturnType<typeof topic>[] {
  const core = [`${prefix}-a`, `${prefix}-b`, `${prefix}-c`, `${prefix}-d`];
  return Array.from({ length: count }, (_, i) => topic(`${prefix}${i}`, [...core, `${prefix}-own${i}`]));
}

/** `count` topics, each with articles no other topic has. */
function loners(count: number): ReturnType<typeof topic>[] {
  return Array.from({ length: count }, (_, i) => topic(`lone${i}`, [`lone${i}-x`, `lone${i}-y`, `lone${i}-z`]));
}

const spread = (stops: number[]) => Math.max(...stops) - Math.min(...stops);

describe("topicHueStops", () => {
  it("packs a related cluster close together and spreads the unrelated ones apart", () => {
    // The cluster ranks first, as Greg's AI topics would on his shelf.
    const terms = [...cluster("ai", 9), ...loners(21)];
    const stops = topicHueStops(terms);
    const ai = terms.slice(0, 9).map((t) => stops.get(t.key)!);
    const lone = terms.slice(9).map((t) => stops.get(t.key)!);

    // The cluster gets a narrow band of neighbouring hues…
    expect(spread(ai)).toBeLessThanOrEqual(4);
    // …and the 21 loners are all told apart, over the rest of the arc.
    expect(new Set(lone).size).toBe(21);
    expect(Math.max(...lone)).toBe(HUE_STOPS - 1);
    for (const s of lone) expect(s).toBeGreaterThan(Math.max(...ai));
  });

  it("gives two unrelated clusters two separate bands, each tighter than the gap between them", () => {
    const terms = [...cluster("ai", 5), ...cluster("zen", 5)];
    const stops = topicHueStops(terms);
    const ai = terms.slice(0, 5).map((t) => stops.get(t.key)!);
    const zen = terms.slice(5).map((t) => stops.get(t.key)!);
    const between = Math.min(...zen) - Math.max(...ai);
    expect(between).toBeGreaterThan(spread(ai));
    expect(between).toBeGreaterThan(spread(zen));
  });

  it("keeps a cluster together even when its members are ranked apart", () => {
    // The server interleaves them; the hues should not.
    const [a0, a1, a2] = cluster("ai", 3);
    const [l0, l1, l2] = loners(3);
    const terms = [a0!, l0!, a1!, l1!, a2!, l2!];
    const stops = topicHueStops(terms);
    const ai = [a0!, a1!, a2!].map((t) => stops.get(t.key)!);
    const lone = [l0!, l1!, l2!].map((t) => stops.get(t.key)!);
    expect(spread(ai)).toBeLessThan(Math.min(...lone.map((s) => Math.min(...ai.map((a) => Math.abs(s - a))))));
  });

  it("puts the server's top topic at the start of the arc", () => {
    for (const terms of [[...loners(5), ...cluster("ai", 4)], [...cluster("ai", 4), ...loners(5)]]) {
      expect(topicHueStops(terms).get(terms[0]!.key)).toBe(0);
    }
  });

  it("is deterministic, and does not depend on the order of each topic's members", () => {
    const terms = [...cluster("ai", 6), ...loners(6), ...cluster("zen", 3)];
    const again = terms.map((t) => ({ ...t, articles: [...t.articles].reverse() }));
    expect([...topicHueStops(terms)]).toEqual([...topicHueStops(again)]);
  });

  it("spreads a shelf with no overlap at all evenly, in rank order", () => {
    const terms = loners(5);
    expect(terms.map((t) => topicHueStops(terms).get(t.key))).toEqual([0, 8, 16, 23, 31]);
  });

  it("answers for tiny and empty inputs", () => {
    expect(topicHueStops([]).size).toBe(0);
    expect([...topicHueStops([topic("one", ["a"])])]).toEqual([["one", 0]]);
    const two = topicHueStops([topic("x", ["a", "b"]), topic("y", ["c"])]);
    expect([two.get("x"), two.get("y")]).toEqual([0, HUE_STOPS - 1]);
    // A topic with no members is distance 1 from everything, not NaN.
    const empty = topicHueStops([topic("x", ["a"]), topic("none", []), topic("y", ["a"])]);
    expect([...empty.values()].every((s) => Number.isInteger(s) && s >= 0 && s < HUE_STOPS)).toBe(true);
  });

  it("names a stop on the ring, never a colour", () => {
    expect(topicColourStyle(7)).toEqual({ "--topic": "var(--hue-7)" });
  });
});
