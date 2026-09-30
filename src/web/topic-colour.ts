/**
 * **Which colour a shelf topic wears**: a stop on the hue ring, never a colour.
 *
 * Greg, 2026-09-29 (report 5N): *"similar topics would get similar colours, and
 * it would be easier to see which topics are related and which stand out"*, and
 * without asking a model: *"we could look at the correlations … which articles
 * they occur frequently in"*. Until then a topic's colour was keyed to its rank
 * and meant nothing.
 *
 * **The clue is overlap, and the client already has it.** Each topic arrives
 * with its full member list (`LibraryTermsResponse.terms[].articles`), so two
 * topics are close when they pick out the same articles: binary cosine,
 * `|A∩B| / √(|A|·|B|)`. That is computed over the full lists, never the live
 * narrowed counts, so a colour does not move when you choose a topic or type
 * in search. It needs no fetch, no stored state and no model.
 *
 * **One line, then the hue arc** (plan 260930b, after GPT Sol's review):
 *
 *  1. Average-link clustering, merging the closest pair each time. At each
 *     merge the half holding the better server rank goes first, so the leaves
 *     come out in an order where related topics sit side by side, and the
 *     server's top topic is always at the start of the arc.
 *  2. The gap between two neighbours in that order grows with the height at
 *     which they were joined: `GAP_FLOOR + height²`. A tight cluster packs
 *     into a few neighbouring hues ("they might all be shades of pink"), and
 *     topics that share nothing are a full step apart, so outliers spread
 *     across the arc instead of piling up on one hue.
 *  3. The cumulative gaps are normalised to 0…1 and rounded to the nearest of
 *     HUE_STOPS stops.
 *
 * Classical MDS to one dimension was the first plan and was dropped: with
 * several topics sharing no articles with anything, it puts them all at one
 * coordinate, and its top eigenvalue is then repeated, so the answer is
 * arbitrary. A dendrogram's leaf order is deterministic and needs no
 * eigensolver. Sol R1–R3, plan 260930b.
 *
 * The hues are `--hue-N` in styles/colourscales.css: this file says *which
 * stop*, the stylesheet says *what colour* (docs/project/colour-scales.md).
 */
import type { CSSProperties } from "react";

/** How many stops the ring has: `--hue-0` … `--hue-31`. */
export const HUE_STOPS = 32;

/** The gap between two topics that were joined at height 0 (identical member sets). */
const GAP_FLOOR = 0.1;

/** Two average distances closer than this are a tie, broken by server rank. */
const EPS = 1e-9;

interface TopicMembers {
  key: string;
  articles: readonly { slug: string }[];
}

/** 1 − binary cosine over two member sets; 1 when either is empty. */
function distance(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 1;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const s of small) if (large.has(s)) shared++;
  return 1 - shared / Math.sqrt(a.size * b.size);
}

/** A run of topics in their final order, and the best (lowest) rank among them. */
interface Cluster {
  leaves: number[];
  best: number;
}

/** Average-link distance: the mean over every pair across the two clusters. */
function linkage(A: Cluster, B: Cluster, dist: (i: number, j: number) => number): number {
  let sum = 0;
  for (const i of A.leaves) for (const j of B.leaves) sum += dist(i, j);
  return sum / (A.leaves.length * B.leaves.length);
}

/**
 * The two closest clusters. `clusters` is sorted by `best`, so the first pair
 * seen at a given distance is the one holding the better ranks — the
 * tie-break — and only a strictly smaller distance displaces it.
 */
function closestPair(
  clusters: readonly Cluster[],
  dist: (i: number, j: number) => number,
): { a: number; b: number; h: number } | null {
  let pick: { a: number; b: number; h: number } | null = null;
  for (let a = 0; a < clusters.length; a++) {
    for (let b = a + 1; b < clusters.length; b++) {
      const A = clusters[a];
      const B = clusters[b];
      if (!A || !B) continue;
      const h = linkage(A, B, dist);
      if (!pick || h < pick.h - EPS) pick = { a, b, h };
    }
  }
  return pick;
}

/**
 * The leaves in dendrogram order, and for each leaf the height of the join to
 * the leaf after it. Clusters are only ever concatenated, never reversed, so
 * the join made at a merge is between the same two leaves for good — which is
 * why the height can be recorded against the leaf on its left.
 */
function dendrogramOrder(
  n: number,
  dist: (i: number, j: number) => number,
): { order: number[]; gapAfter: Map<number, number> } {
  let clusters: Cluster[] = Array.from({ length: n }, (_, i) => ({ leaves: [i], best: i }));
  const gapAfter = new Map<number, number>();
  while (clusters.length > 1) {
    const pick = closestPair(clusters, dist);
    const A = pick && clusters[pick.a];
    const B = pick && clusters[pick.b];
    if (!pick || !A || !B) break;
    /* A holds the better rank (the list is sorted by `best`), so it goes first. */
    const last = A.leaves[A.leaves.length - 1];
    if (last !== undefined) gapAfter.set(last, pick.h);
    const merged = { leaves: [...A.leaves, ...B.leaves], best: A.best };
    clusters = clusters.filter((_, i) => i !== pick.a && i !== pick.b);
    clusters.push(merged);
    clusters.sort((x, y) => x.best - y.best);
  }
  return { order: clusters[0]?.leaves ?? [], gapAfter };
}

/**
 * Each topic's hue stop, by key, from which articles the topics share. The
 * order of `terms` is the server's rank, and that is what breaks ties.
 * Deterministic: the same terms give the same stops.
 */
export function topicHueStops(terms: readonly TopicMembers[]): Map<string, number> {
  /* `chooseTerms` produces unique keys. Defensively keep the better-ranked
     occurrence if malformed input repeats one; otherwise a phantom duplicate
     would both overwrite its Map entry and distort every topic's spacing. */
  const seen = new Set<string>();
  const ranked = terms.filter((term) => {
    if (seen.has(term.key)) return false;
    seen.add(term.key);
    return true;
  });
  const sets = ranked.map((t) => new Set(t.articles.map((a) => a.slug)));
  /* The matrix is symmetric. Computing only its upper half matters more than
     the clustering at shelf size because each distance scans article slugs. */
  const d: number[][] = Array.from({ length: sets.length }, () => Array<number>(sets.length).fill(0));
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i];
      const b = sets[j];
      if (!a || !b) continue;
      const value = distance(a, b);
      d[i]![j] = value;
      d[j]![i] = value;
    }
  }
  const { order, gapAfter } = dendrogramOrder(ranked.length, (i, j) => d[i]?.[j] ?? 1);

  /* Cumulative position along the line: GAP_FLOOR + height² per join. */
  const at: number[] = [];
  let total = 0;
  for (const [k, leaf] of order.entries()) {
    at.push(total);
    if (k < order.length - 1) {
      /* Every join records its gap, so this is always found. If it were not,
         a full step is the harmless answer: this is decoration in the shelf's
         render path, and a throw here would take the shelf down with it. */
      const h = gapAfter.get(leaf) ?? 1;
      total += GAP_FLOOR + h * h;
    }
  }
  const out = new Map<string, number>();
  for (const [k, leaf] of order.entries()) {
    const key = ranked[leaf]?.key;
    if (key === undefined) continue;
    const p = total > 0 ? (at[k] ?? 0) / total : 0;
    out.set(key, Math.round(p * (HUE_STOPS - 1)));
  }
  return out;
}

/**
 * The style that puts a stop's colour in `--topic`, for a `tw:bg-[var(--topic)]`
 * (or border) class beside it. A palette *reference*, never a colour value —
 * the same shape as `--cat-rgb` in SearchPanel.tsx.
 */
export function topicColourStyle(stop: number): CSSProperties {
  return { "--topic": `var(--hue-${stop})` } as CSSProperties;
}
