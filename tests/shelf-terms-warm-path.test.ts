/**
 * **The warm path at 1,000 articles** — what every shelf load pays once every
 * row is stored: the stored candidates come back as JSON, and the chooser runs
 * over all of them. docs/plans/260928a-shelf-facet-terms.md § Stage 2 (Sol F2
 * measured ~0.6 s for the chooser alone on a synthetic 1,000 × 200).
 *
 * Synthetic and deterministic: a fixed-seed generator draws each article's
 * 200 candidates from a Zipf-ish vocabulary of 6,000 phrases, so document
 * frequencies spread across the band the way a real shelf's do. The bound is
 * generous on purpose — this box is shared and never idle — and the time is
 * printed so a regression is visible long before it trips.
 */
import { describe, expect, it } from "vitest";
import { QueryBuilder } from "drizzle-orm/pg-core";

import { chooseTerms, type ChooseArticle } from "../src/shelf-terms/choose.js";
import type { Candidate, Extraction } from "../src/shelf-terms/extract.js";
import {
  chooseInput,
  shelfRevisionsQuery,
  type ShelfRevision,
} from "../src/store/pg-shelf-terms.js";

const ARTICLES = 1000;
const PER_ARTICLE = 200;
const VOCAB = 6000;

function shelfRevision(n: number): ShelfRevision {
  return {
    articleId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    revisionId: `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    slug: `article-${n}`,
    archived: false,
    title: null,
    titleOverride: null,
    gist: null,
  };
}

function extraction(n: number, skipped: Extraction["skipped"] = null): Extraction {
  return {
    words: 1000,
    textHash: `hash-${n}`,
    skipped,
    candidates: skipped
      ? []
      : n < 3
        ? [{ key: "shared phrase", label: "shared phrase", count: 3, bodyCount: 3, score: 3 }]
        : [],
  };
}

describe("the chooser input built from stored runs", () => {
  it("excludes skipped articles from the work count and the eight-work threshold", () => {
    const set = Array.from({ length: 8 }, (_, i) => shelfRevision(i));
    const runs = new Map(set.map((s, i) => [s.revisionId, extraction(i, i === 7 ? "not-english" : null)]));

    const input = chooseInput(set, runs);
    const result = chooseTerms(input);

    expect(input.map((a) => a.slug)).toEqual(set.slice(0, 7).map((s) => s.slug));
    expect(result.works).toBe(7);
    expect(result.terms).toEqual([]);
  });
});

describe("the owner-scoped terms set", () => {
  it("uses the same readable-revision boundary as the library shelf", () => {
    const sql = shelfRevisionsQuery(new QueryBuilder() as never, {
      archived: false,
    }).toSQL().sql;

    expect(sql).toContain('"tree" is not null');
    expect(sql).toMatch(/coalesce\(\s*"spideryarn"\."article_revisions"\."block_count"/);
    expect(sql).toContain('from "spideryarn"."revision_blocks"');
  });
});

/** mulberry32: small, seeded, good enough to spread a vocabulary. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function synthetic(): ChooseArticle[] {
  const rand = rng(260928);
  const out: ChooseArticle[] = [];
  for (let i = 0; i < ARTICLES; i++) {
    const words = 2000 + Math.floor(rand() * 8000);
    const seen = new Set<number>();
    const candidates: Candidate[] = [];
    while (candidates.length < PER_ARTICLE) {
      /* Zipf-ish: squaring a uniform draw favours the low ranks. */
      const rank = Math.floor(rand() * rand() * VOCAB);
      if (seen.has(rank)) continue;
      seen.add(rank);
      const key = rank % 3 === 0 ? `phrase${rank} word${rank % 97}` : `term${rank}`;
      const bodyCount = 1 + Math.floor(rand() * 12);
      candidates.push({ key, label: key, count: bodyCount + 1, bodyCount, score: bodyCount + 2 });
    }
    out.push({ slug: `article-${i}`, words, textHash: `hash-${i}`, candidates });
  }
  return out;
}

describe("the warm path, 1,000 articles × 200 candidates", () => {
  it("reads the stored JSON back and chooses the topics well inside the bound", () => {
    const articles = synthetic();
    /* The read, as far as it is not the database: the JSONB payload parsed. */
    const payload = JSON.stringify(articles.map((a) => a.candidates));
    const t0 = performance.now();
    const parsed = JSON.parse(payload) as Candidate[][];
    const t1 = performance.now();
    const input = articles.map((a, i) => ({ ...a, candidates: parsed[i] ?? [] }));
    const result = chooseTerms(input);
    const t2 = performance.now();

    console.log(
      `[shelf-terms warm path] ${ARTICLES} articles × ${PER_ARTICLE} candidates ` +
        `(${(payload.length / 1e6).toFixed(1)} MB JSON): parse ${(t1 - t0).toFixed(0)} ms, ` +
        `choose ${(t2 - t1).toFixed(0)} ms, ${result.terms.length} topics over ${result.works} works`,
    );
    expect(result.works).toBe(ARTICLES);
    expect(result.terms.length).toBe(30);
    /* Generous: a shared, busy box. The measured figure is in the log line. */
    expect(t2 - t0).toBeLessThan(5000);
  });
});
