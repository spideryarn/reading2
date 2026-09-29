/**
 * Step 2 of the shelf's filter terms: every article's candidates → the
 * shelf's topics — src/shelf-terms/choose.ts.
 * docs/plans/260928a-shelf-facet-terms.md § Step 2, § Measurements, and stage
 * 1's test list.
 *
 * Every fixture is synthetic and built here: no database, no uuids.
 */
import { describe, expect, it } from "vitest";
import {
  adjacentSharedPairs,
  type ChooseArticle,
  chooseTerms,
  passesVagueTest,
  type ShelfTerm,
  byArticleCount,
  shelfTermHeadMetrics,
  shelfTermMetrics,
  stemForOverlap,
} from "../src/shelf-terms/choose.js";
import type { Candidate } from "../src/shelf-terms/extract.js";

/**
 * An article whose candidates are `{ key: bodyCount }`. `count` and `score`
 * default to the body count; `extra` overrides any of the three per key. The
 * hash defaults to the slug, so every article is its own work unless a test
 * says otherwise.
 */
function art(
  slug: string,
  cands: Record<string, number>,
  opts: { words?: number; hash?: string; extra?: Record<string, Partial<Candidate>> } = {},
): ChooseArticle {
  return {
    slug,
    words: opts.words ?? 1000,
    textHash: opts.hash ?? `hash-${slug}`,
    candidates: Object.entries(cands).map(([key, bodyCount]) => ({
      key,
      label: key,
      count: bodyCount,
      bodyCount,
      score: bodyCount,
      ...opts.extra?.[key],
    })),
  };
}

/** `n` articles `s00`…, each with its own filler word so none is empty. */
function shelf(n: number): ChooseArticle[] {
  return Array.from({ length: n }, (_, i) => {
    const slug = `s${String(i).padStart(2, "0")}`;
    return art(slug, { [`filler${slug}`]: 5 });
  });
}

/** Give articles `slugs` the key `key` at `bodyCount`. */
function give(arts: ChooseArticle[], key: string, slugs: string[], bodyCount = 4): void {
  for (const a of arts)
    if (slugs.includes(a.slug))
      a.candidates.push({ key, label: key, count: bodyCount, bodyCount, score: bodyCount });
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `s${String(from + i).padStart(2, "0")}`);
const keysOf = (terms: ShelfTerm[]) => terms.map((t) => t.key);

describe("fewer than 8 works → no terms at all", () => {
  it("chooses nothing on a shelf of 7 works", () => {
    const arts = shelf(7);
    give(arts, "spider", range(0, 2));
    expect(chooseTerms(arts)).toEqual({ terms: [], works: 7 });
  });

  it("chooses nothing on 6 articles that are 2 works, however many articles there are", () => {
    const arts = Array.from({ length: 6 }, (_, i) =>
      art(`d${i}`, { spider: 4, web: 4 }, { hash: i < 3 ? "one" : "two" }),
    );
    expect(chooseTerms(arts)).toEqual({ terms: [], works: 2 });
  });

  it("chooses on exactly 8 works", () => {
    const arts = shelf(8);
    give(arts, "spider", range(0, 2));
    expect(keysOf(chooseTerms(arts).terms)).toEqual(["spider"]);
  });
});

describe("membership is density on bodyCount", () => {
  it("needs max(2, 0.3 per 1,000 prose words), inclusive at the edge", () => {
    const arts = shelf(10);
    /* 10,000 words needs 3; 5,000 words needs max(2, 1.5) = 2. */
    arts[0] = art("s00", { spider: 3 }, { words: 10_000 });
    arts[1] = art("s01", { spider: 2 }, { words: 10_000 });
    arts[2] = art("s02", { spider: 2 }, { words: 5_000 });
    arts[3] = art("s03", { spider: 1 }, { words: 5_000 });
    arts[4] = art("s04", { spider: 6 }, { words: 20_000 });
    arts[5] = art("s05", { spider: 5 }, { words: 20_000 });
    const t = chooseTerms(arts).terms.find((x) => x.key === "spider");
    expect(t?.articles.map((a) => a.slug).sort()).toEqual(["s00", "s02", "s04"]);
  });

  it("does not let a title-only phrase, or a high count with a low bodyCount, make a member", () => {
    const arts = shelf(10);
    give(arts, "spider", ["s00", "s01"]);
    arts[2] = art("s02", { spider: 0 }, { extra: { spider: { count: 1, score: 3 } } });
    arts[3] = art("s03", { spider: 1 }, { extra: { spider: { count: 9, score: 20 } } });
    const t = chooseTerms(arts).terms.find((x) => x.key === "spider");
    expect(t?.articles.map((a) => a.slug)).toEqual(["s00", "s01"]);
  });
});

describe("the candidate band is over works", () => {
  it("takes at most 50% of works, inclusive, and at least 2", () => {
    const arts = shelf(10);
    /* Overlapping in one article only, so no redundancy skip can be what
       keeps sixkey out — only the band. */
    give(arts, "fivekey", range(0, 4));
    give(arts, "sixkey", range(4, 9));
    give(arts, "twokey", range(6, 7));
    give(arts, "onekey", range(8, 8));
    const keys = keysOf(chooseTerms(arts).terms);
    expect(keys).toContain("fivekey");
    expect(keys).toContain("twokey");
    expect(keys).not.toContain("sixkey");
    expect(keys).not.toContain("onekey");
  });

  it("raises the floor to 3% of works on a large shelf", () => {
    /* 67 works: ceil(0.03 × 67) = ceil(2.01) = 3. */
    const arts = shelf(67);
    give(arts, "threekey", range(0, 2));
    give(arts, "twokey", range(10, 11));
    const keys = keysOf(chooseTerms(arts).terms);
    expect(keys).toContain("threekey");
    expect(keys).not.toContain("twokey");
  });
});

describe("exact duplicates are one work, shown as their physical articles (Sol F9)", () => {
  it("counts two identical-text articles once for the band", () => {
    const arts = shelf(10);
    arts[0] = art("copy-a", { spider: 4 }, { hash: "same" });
    arts[1] = art("copy-b", { spider: 4 }, { hash: "same" });
    const r = chooseTerms(arts);
    expect(r.works).toBe(9);
    expect(keysOf(r.terms)).not.toContain("spider");
  });

  it("lists both copies, with their literal counts, once the work has company", () => {
    const arts = shelf(10);
    arts[0] = art("copy-a", { spider: 4 }, { hash: "same", extra: { spider: { count: 6 } } });
    arts[1] = art("copy-b", { spider: 4 }, { hash: "same", extra: { spider: { count: 6 } } });
    arts[2] = art("other", { spider: 9 });
    const t = chooseTerms(arts).terms.find((x) => x.key === "spider");
    expect(t?.articles).toEqual([
      { slug: "other", count: 9 },
      { slug: "copy-a", count: 6 },
      { slug: "copy-b", count: 6 },
    ]);
  });

  it("does not let five copies make a five-article topic on their own", () => {
    const arts = shelf(12);
    for (let i = 0; i < 5; i++) arts[i] = art(`copy${i}`, { spider: 4 }, { hash: "same" });
    expect(keysOf(chooseTerms(arts).terms)).not.toContain("spider");
  });
});

describe("overlap is allowed", () => {
  it("puts one article in two topics", () => {
    const arts = shelf(10);
    give(arts, "spider", ["s00", "s01", "s02"]);
    give(arts, "silk", ["s00", "s03", "s04"]);
    const r = chooseTerms(arts);
    const inS00 = r.terms.filter((t) => t.articles.some((a) => a.slug === "s00"));
    expect(inS00.map((t) => t.key).sort()).toEqual(["silk", "spider"]);
  });
});

describe("redundancy skips", () => {
  it("skips a set with Jaccard above 0.7 with a chosen topic, and keeps one at exactly 0.7", () => {
    const arts = shelf(20);
    /* alpha/beta: 9 shared of 11 → 0.82. gamma/delta: 7 shared of 10 → 0.70. */
    give(arts, "alpha", range(0, 9));
    give(arts, "beta", [...range(0, 8), "s10"]);
    give(arts, "gamma", range(11, 18));
    give(arts, "delta", [...range(12, 18), "s19", "s00", "s01"].slice(0, 9));
    const keys = keysOf(chooseTerms(arts).terms);
    expect(keys.filter((k) => k === "alpha" || k === "beta")).toHaveLength(1);
    expect(keys).toContain("gamma");
    expect(keys).toContain("delta");
  });

  it("skips a phrase sharing a word above 0.3, and keeps one at exactly 0.3", () => {
    const arts = shelf(30);
    /* 2 shared of 5 → 0.4 */
    give(arts, "conscious ai", range(0, 2));
    give(arts, "ai system", ["s01", "s02", "s03", "s04"]);
    /* 3 shared of 10 → 0.3 */
    give(arts, "spider silk", range(10, 15));
    give(arts, "spider web", [...range(13, 15), "s16", "s17", "s18", "s19"]);
    const keys = keysOf(chooseTerms(arts).terms);
    expect(keys.filter((k) => k === "conscious ai" || k === "ai system")).toHaveLength(1);
    expect(keys).toContain("spider silk");
    expect(keys).toContain("spider web");
  });

  it("treats conscious and consciousness as sharing a word (Sol F4)", () => {
    expect(stemForOverlap("consciousness")).toBe(stemForOverlap("conscious"));
    expect(stemForOverlap("computational")).toBe(stemForOverlap("computation"));
    expect(stemForOverlap("neuron")).not.toBe(stemForOverlap("neural"));

    const arts = shelf(20);
    /* 3 shared of 7 → 0.43: over the shared-word 0.3, under the plain 0.7. */
    give(arts, "consciousness", range(0, 4));
    give(arts, "conscious experience", range(2, 6));
    const keys = keysOf(chooseTerms(arts).terms);
    expect(keys.filter((k) => k === "consciousness" || k === "conscious experience")).toHaveLength(
      1,
    );
  });

  it("leaves unrelated words at the same Jaccard alone", () => {
    const arts = shelf(20);
    give(arts, "spider", range(0, 4));
    give(arts, "silk", range(2, 6));
    const keys = keysOf(chooseTerms(arts).terms);
    expect(keys).toContain("spider");
    expect(keys).toContain("silk");
  });
});

describe("containment and coverage first (plan 260928d)", () => {
  it("skips a small topic sitting inside a big one it shares a word with, though their Jaccard is low", () => {
    const arts = shelf(24);
    /* ai system: 3 articles, all inside ai's 11 — Jaccard 0.27, containment 1.0 */
    give(arts, "ai", range(0, 10));
    give(arts, "ai system", range(0, 2));
    const keys = keysOf(chooseTerms(arts).terms);
    expect(keys).toContain("ai");
    expect(keys).not.toContain("ai system");
  });

  it("ranks a topic that reaches uncovered articles ahead of a bigger one that mostly repeats the first", () => {
    const arts = shelf(24);
    /* alpha first (dense). beta: 8 articles, 7 of them alpha's — Jaccard
       0.64, no shared word, so not redundant, only repetitive. gamma: 3
       articles nobody covers, its idf pulled down by stray mentions. */
    give(arts, "alpha", range(0, 9), 20);
    give(arts, "beta", [...range(0, 6), "s10"]);
    give(arts, "gamma", range(11, 13));
    give(arts, "gamma", range(14, 17), 1);
    /* the default product ranking and the lexicographic one agree here */
    for (const opts of [{}, { qualityExponent: null }]) {
      const keys = keysOf(chooseTerms(arts, opts).terms);
      expect(keys[0]).toBe("alpha");
      expect(keys).toContain("beta");
      expect(keys.indexOf("gamma")).toBeLessThan(keys.indexOf("beta"));
    }
  });

  it("gives a short work no coverage gain under minCoverageWords, though it stays a member", () => {
    const arts = shelf(10);
    for (const a of arts.slice(3, 7)) a.words = 100;
    give(arts, "alpha", range(0, 2));
    give(arts, "beta", range(3, 6));
    expect(keysOf(chooseTerms(arts).terms)[0]).toBe("beta");
    const r = chooseTerms(arts, { minCoverageWords: 500 });
    expect(keysOf(r.terms)[0]).toBe("alpha");
    expect(r.terms.find((t) => t.key === "beta")?.articles).toHaveLength(4);
  });

  it("replaces a chosen topic by a later one that contains it and shares its word, in its place", () => {
    const arts = shelf(24);
    give(arts, "zeta", range(12, 16), 20); // first: dense and uncovered
    give(arts, "ai system", range(0, 2)); // a phrase, so taken before ai
    give(arts, "ai", range(0, 10));
    const r = chooseTerms(arts, { maxTerms: 3 });
    expect(keysOf(r.terms)).toEqual(["zeta", "ai"]);
  });

  it("replaces a chosen subset even when its shared-word Jaccard with the later superset exceeds 0.3", () => {
    const arts = shelf(24);
    give(arts, "zeta", range(12, 16), 20); // first: dense and uncovered
    give(arts, "ai system", range(0, 3)); // 4/11 of ai: above shared-word Jaccard limit
    give(arts, "ai", range(0, 10));
    const r = chooseTerms(arts, { maxTerms: 3 });
    expect(keysOf(r.terms)).toEqual(["ai", "zeta"]);
    expect(r.terms[0]?.articles).toEqual(
      range(0, 10).map((slug) => ({ slug, count: 4 })),
    );
    expect(chooseTerms([...arts].reverse(), { maxTerms: 3 })).toEqual(r);
  });

  it("merges a short plural key into its singular when both are on the shelf, labelled by the singular", () => {
    const arts = shelf(12);
    const withLabels = (slug: string, cands: Record<string, [number, string]>) =>
      art(slug, Object.fromEntries(Object.entries(cands).map(([k, [n]]) => [k, n])), {
        extra: Object.fromEntries(Object.entries(cands).map(([k, [, label]]) => [k, { label }])),
      });
    arts[0] = withLabels("s00", { ai: [4, "AI"], ais: [4, "AIs"] });
    arts[1] = withLabels("s01", { ai: [4, "AI"] });
    arts[2] = withLabels("s02", { ai: [4, "AI"] });
    arts[3] = withLabels("s03", { ais: [9, "AIs"] });
    arts[4] = withLabels("s04", { ais: [9, "AIs"] });
    /* one mention of each: neither alone is membership, together they are */
    arts[5] = withLabels("s05", { ai: [1, "AI"], ais: [1, "AIs"] });
    /* bus has no bu, so it stays whole */
    give(arts, "bus", range(6, 8));
    const terms = chooseTerms(arts).terms;
    const ai = terms.find((t) => t.key === "ai");
    expect(ai?.label).toBe("AI");
    expect(ai?.articles).toEqual([
      { slug: "s03", count: 9 },
      { slug: "s04", count: 9 },
      { slug: "s00", count: 8 },
      { slug: "s01", count: 4 },
      { slug: "s02", count: 4 },
      { slug: "s05", count: 2 },
    ]);
    expect(keysOf(terms)).not.toContain("ais");
    expect(keysOf(terms)).toContain("bus");
  });

  it("leaves a short plural alone when its singular is not on the shelf", () => {
    const arts = shelf(10);
    give(arts, "ais", range(0, 2));
    give(arts, "gas", range(3, 5));
    expect(keysOf(chooseTerms(arts).terms).sort()).toEqual(["ais", "gas"]);
  });

  it("does not merge two real short words merely because one key is the other plus s", () => {
    const arts = shelf(24);
    for (const [i, [singular, endingInS]] of (
      [
        ["bu", "bus"],
        ["ga", "gas"],
        ["it", "its"],
        ["ye", "yes"],
        ["up", "ups"],
      ] as const
    ).entries()) {
      give(arts, singular, range(i * 2, i * 2 + 1));
      give(arts, endingInS, range(12 + i * 2, 13 + i * 2));
    }
    expect(keysOf(chooseTerms(arts).terms).sort()).toEqual([
      "bu",
      "bus",
      "ga",
      "gas",
      "it",
      "its",
      "up",
      "ups",
      "ye",
      "yes",
    ]);
  });

  it("measures the first few in the order given", () => {
    const t = (key: string, slugs: string[]): ShelfTerm => ({
      key,
      label: key,
      articles: slugs.map((slug) => ({ slug, count: 2 })),
    });
    const scope = ["a", "b", "c", "d", "e"];
    const terms = [t("small", ["d"]), t("big", ["a", "b", "c"]), t("inside", ["a", "b"])];
    const h = shelfTermHeadMetrics(terms, scope);
    expect(h.coverageAt5).toBe(0.8);
    /* big/inside: Jaccard 2/3, overlap 1; the other pairs 0 */
    expect(h.maxOverlap12).toBe(1);
    expect(h.maxJaccard12).toBeCloseTo(2 / 3, 10);
    expect(h.meanOverlap12).toBeCloseTo(1 / 3, 10);
    expect(keysOf(byArticleCount(terms))).toEqual(["big", "inside", "small"]);
    expect(shelfTermHeadMetrics(byArticleCount(terms).slice(0, 1), scope).coverageAt5).toBe(0.6);
  });
});

describe("vague words (plan 260929a, Greg's 4T: following, entered)", () => {
  /**
   * Each key on three 1,000-word articles of its own, so no redundancy rule
   * can be what removes it — used 3 times in each: enough for an ordinary word
   * (2), not for a vague one (max(4, 2 per 1,000) = 4).
   */
  function spread(keys: string[], uses = 3): ChooseArticle[] {
    const arts = shelf(3 * keys.length + 4);
    for (const [i, k] of keys.entries()) give(arts, k, range(3 * i, 3 * i + 2), uses);
    return arts;
  }

  it("does not count a word the norms rate abstract where it is used in passing", () => {
    const arts = spread(["following", "process", "entered", "rat", "spider"]);
    const keys = keysOf(chooseTerms(arts).terms);
    expect(keys).not.toContain("following"); // by its lemma, follow 3.4
    expect(keys).not.toContain("process"); // 3.0
    expect(keys).not.toContain("entered"); // by its lemma, enter 4.1
    expect(keys).toContain("rat"); // concrete, 6.7
    expect(keys).toContain("spider"); // 6.7
  });

  it("tries the dropped-e lemma before a different word made by stripping -ing", () => {
    /* staring → stare (4.1), not star (6.2): the latter would wrongly let a
       non-concrete participle keep the ordinary density threshold. */
    expect(passesVagueTest("staring", 4.5)).toBe(false);
  });

  it("with familiarityMin, lets an abstract word the norms rate unfamiliar keep the ordinary rule", () => {
    /* neural: concreteness 4.1, familiarity 3.9; memory: 2.9, 6.4 */
    expect(passesVagueTest("neural", 4.5)).toBe(false);
    expect(passesVagueTest("neural", 4.5, 5)).toBe(true);
    expect(passesVagueTest("memory", 4.5, 5)).toBe(false);
  });

  it("counts a vague word only where an article uses it heavily (Greg: common words must occur more often)", () => {
    const arts = shelf(12);
    /* 1,000-word articles: a vague word needs max(4, 2) = 4 uses; an ordinary one 2 */
    give(arts, "memory", range(0, 2), 6);
    give(arts, "memory", range(3, 5), 2);
    const t = chooseTerms(arts).terms.find((x) => x.key === "memory");
    expect(t?.articles.map((a) => a.slug)).toEqual(range(0, 2));
    /* the report's other design: drop the vague word outright */
    expect(keysOf(chooseTerms(arts, { vagueDensityPer1000: null }).terms)).not.toContain("memory");
    /* a concrete word keeps the ordinary threshold */
    give(arts, "rat", range(6, 8), 2);
    expect(keysOf(chooseTerms(arts).terms)).toContain("rat");
  });

  it("treats a word the norms do not rate as ordinary: technical, proper-noun-like, or everyday", () => {
    const arts = spread(["irreducibility", "wagan", "ruliology", "parent", "technology"]);
    expect(keysOf(chooseTerms(arts).terms).sort()).toEqual([
      "irreducibility",
      "parent",
      "ruliology",
      "technology",
      "wagan",
    ]);
  });

  it("leaves phrases alone, even when every word in them is abstract", () => {
    const arts = spread(["stolen generation", "natural language", "power station", "following"]);
    const keys = keysOf(chooseTerms(arts).terms);
    expect(keys).toContain("stolen generation");
    expect(keys).toContain("natural language");
    expect(keys).toContain("power station");
    expect(keys).not.toContain("following");
  });

  it("keeps everything with the rule switched off, for the report's comparison", () => {
    const arts = spread(["following", "process"]);
    expect(keysOf(chooseTerms(arts, { dropVague: false }).terms).sort()).toEqual(["following", "process"]);
  });
});

describe("a topic sharing a word with the one before it does not come next (plan 260929a R7)", () => {
  it("puts another topic between neural networks and neural activity when one adds as many new works", () => {
    const arts = shelf(30);
    give(arts, "neural network", range(0, 5), 20);
    give(arts, "neural activity", range(6, 10), 8);
    give(arts, "zeta", range(11, 15), 3);
    const unruled = keysOf(chooseTerms(arts, { adjacency: false }).terms);
    expect(unruled.slice(0, 2)).toEqual(["neural network", "neural activity"]);
    expect(keysOf(chooseTerms(arts).terms)).toEqual(["neural network", "zeta", "neural activity"]);
  });

  it("lets it come next when nothing else adds as many new works", () => {
    const arts = shelf(30);
    give(arts, "neural network", range(0, 5), 20);
    give(arts, "neural activity", range(6, 10), 8);
    give(arts, "zeta", range(11, 14), 3);
    expect(keysOf(chooseTerms(arts).terms)).toEqual(["neural network", "neural activity", "zeta"]);
  });

  it("keeps the separator after a later superset replaces an earlier topic in its place", () => {
    const arts = shelf(30);
    give(arts, "ai system", range(0, 2), 1_000);
    give(arts, "neural network", range(20, 25), 50);
    give(arts, "ai neural", range(0, 9), 4);
    give(arts, "zeta", range(10, 16), 2);

    const terms = chooseTerms(arts, { maxTerms: 4 }).terms;
    expect(keysOf(terms)).toEqual(["ai neural", "zeta", "neural network"]);
    expect(adjacentSharedPairs(terms)).toEqual([]);
  });

  it("counts neighbours sharing a stem on the list as given", () => {
    const t = (key: string): ShelfTerm => ({ key, label: key, articles: [] });
    expect(adjacentSharedPairs([t("neural network"), t("zeta"), t("neural activity")])).toEqual([]);
    expect(adjacentSharedPairs([t("zeta"), t("neural network"), t("neural activity")])).toEqual([
      ["neural network", "neural activity"],
    ]);
    /* only the first k */
    expect(adjacentSharedPairs([t("zeta"), t("neural network"), t("neural activity")], 2)).toEqual([]);
  });
});

describe("K", () => {
  it("is 30 at most, and no more than the number of works on a small shelf", () => {
    const arts = shelf(10);
    /* Every pair of the ten articles is a candidate: 45 of them, pairwise
       Jaccard at most 1/3, sharing no word — all eligible. */
    let n = 0;
    for (let i = 0; i < 10; i++)
      for (let j = i + 1; j < 10; j++)
        give(arts, `pair${String(n++).padStart(2, "0")}`, [`s0${i}`, `s0${j}`]);
    expect(chooseTerms(arts).terms).toHaveLength(10);
    expect(chooseTerms(arts, { maxTerms: 4 }).terms).toHaveLength(4);
  });
});

describe("the label", () => {
  it("is the surface form with the most occurrences across member articles", () => {
    const arts = shelf(10);
    arts[0] = art("s00", { "turing machine": 4 }, { extra: { "turing machine": { label: "Turing machine" } } });
    arts[1] = art("s01", { "turing machine": 4 }, { extra: { "turing machine": { label: "Turing machine" } } });
    arts[2] = art("s02", { "turing machine": 5 }, { extra: { "turing machine": { label: "turing machine" } } });
    const t = chooseTerms(arts).terms.find((x) => x.key === "turing machine");
    expect(t?.label).toBe("Turing machine");
  });

  it("prefers lowercase on a tie, then code point", () => {
    const arts = shelf(10);
    arts[0] = art("s00", { silk: 4 }, { extra: { silk: { label: "Silk" } } });
    arts[1] = art("s01", { silk: 4 }, { extra: { silk: { label: "silk" } } });
    arts[2] = art("s02", { zorp: 4 }, { extra: { zorp: { label: "Zorp" } } });
    arts[3] = art("s03", { zorp: 4 }, { extra: { zorp: { label: "ZORP" } } });
    const terms = chooseTerms(arts).terms;
    expect(terms.find((x) => x.key === "silk")?.label).toBe("silk");
    expect(terms.find((x) => x.key === "zorp")?.label).toBe("ZORP");
  });
});

describe("a total order everywhere (Sol F7)", () => {
  it("breaks an exactly equal gain by key", () => {
    const arts = shelf(10);
    give(arts, "zeta", range(0, 2));
    give(arts, "eta", range(3, 5));
    expect(keysOf(chooseTerms(arts, { maxTerms: 1 }).terms)).toEqual(["eta"]);
    /* and the same after reversing the input */
    expect(keysOf(chooseTerms([...arts].reverse(), { maxTerms: 1 }).terms)).toEqual(["eta"]);
  });

  it("gives the same topics however the articles and their candidates are ordered", () => {
    const rand = mulberry32(260928);
    /* Two mirror-image halves: every article in half "a" has a twin in half
       "b" with the same numbers and its words renamed. So every topic has an
       exact twin with an exactly equal gain at every step, and which of the
       two goes first — and so which later candidates a skip removes — is
       decided by the tie-break alone. Random data without that almost never
       ties, and would pass with the tie-break deleted. */
    const vocab = Array.from({ length: 40 }, (_, i) => {
      const w = `w${String(i).padStart(2, "0")}`;
      /* some phrases, sharing words with the single words, to exercise every skip */
      return i % 5 === 0 ? `${w} w${String((i + 1) % 40).padStart(2, "0")}` : w;
    });
    const arts: ChooseArticle[] = [];
    for (let a = 0; a < 18; a++) {
      const cands: Record<string, number> = {};
      for (const k of vocab) if (rand() < 0.2) cands[k] = 1 + Math.floor(rand() * 6);
      const words = 2000 + Math.floor(rand() * 8) * 1000;
      const n = String(a).padStart(2, "0");
      arts.push(art(`a${n}`, cands, { words }));
      const twin: Record<string, number> = {};
      for (const [k, v] of Object.entries(cands)) twin[k.replace(/w/g, "v")] = v;
      arts.push(art(`b${n}`, twin, { words }));
    }
    /* three exact copies, sharing a hash and identical candidates */
    for (const c of ["a00", "a01", "b02"]) {
      const src = arts.find((x) => x.slug === c);
      if (!src) throw new Error("fixture");
      arts.push({ ...src, slug: `${c}-copy`, candidates: src.candidates.map((x) => ({ ...x })) });
    }
    const base = chooseTerms(arts);
    expect(base.terms.length).toBeGreaterThan(10);
    for (let i = 0; i < 150; i++) {
      const shuffled = shuffle(arts, rand).map((a) => ({
        ...a,
        candidates: shuffle(a.candidates, rand),
      }));
      expect(chooseTerms(shuffled)).toEqual(base);
    }
  });
});

describe("shelfTermMetrics — the one definition", () => {
  const term = (key: string, slugs: string[]): ShelfTerm => ({
    key,
    label: key,
    articles: slugs.map((slug) => ({ slug, count: 2 })),
  });

  it("computes coverage, topics per article, the share with two or more, and pairwise Jaccard", () => {
    const terms = [term("x", ["a", "b"]), term("y", ["b", "c"]), term("z", ["b"])];
    const m = shelfTermMetrics(terms, ["a", "b", "c", "d"]);
    /* per article: a 1, b 3, c 1, d 0 */
    expect(m.articles).toBe(4);
    expect(m.terms).toBe(3);
    expect(m.coverage).toBe(0.75);
    expect(m.meanTermsPerArticle).toBe(5 / 4);
    expect(m.medianTermsPerArticle).toBe(1);
    expect(m.shareWithTwoOrMore).toBe(0.25);
    /* x∩y 1/3, x∩z 1/2, y∩z 1/2 */
    expect(m.meanPairwiseJaccard).toBeCloseTo((1 / 3 + 1 / 2 + 1 / 2) / 3, 10);
    expect(m.maxPairwiseJaccard).toBe(0.5);
    expect(m.uncovered).toEqual(["d"]);
  });

  it("ignores slugs outside the scope it is given", () => {
    const m = shelfTermMetrics([term("x", ["a", "zz"])], ["a"]);
    expect(m.coverage).toBe(1);
  });

  it("is zeros rather than NaN on an empty shelf or no terms", () => {
    const m = shelfTermMetrics([], []);
    expect(m).toMatchObject({
      coverage: 0,
      meanTermsPerArticle: 0,
      medianTermsPerArticle: 0,
      shareWithTwoOrMore: 0,
      meanPairwiseJaccard: 0,
      maxPairwiseJaccard: 0,
    });
  });
});

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}
