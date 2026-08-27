/**
 * **The arithmetic behind Drift and Trail** — src/projection.ts.
 *
 * Everything here is testable for one reason: the two functions under test are
 * pure, and they are pure because **every way they can be wrong produces a
 * perfectly plausible picture.** A permuted result, a flipped sign, a
 * near-degenerate pair of axes that swap between runs, a k-means that landed in
 * a different local minimum — each of those renders a scatter plot of dots that
 * looks exactly like a scatter plot of dots. There is nothing to see in a
 * browser and nothing in the console. The class is
 * docs/reusable/silent-success.md, and a picture drawn from a model is the
 * worst place for it, because the reader has already been told a model was
 * involved.
 *
 * So the properties are pinned against data whose answer is known by
 * construction, rather than against a snapshot of what the code did last time.
 */
import { describe, expect, it } from "vitest";
import { clusterCount, kmeans, pca } from "../src/projection.js";

/** The generator d3-force uses, so a fixture is the same on every machine. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function unit(v: number[]): number[] {
  const n = Math.hypot(...v);
  return n === 0 ? v : v.map((x) => x / n);
}

function corr(p: readonly number[], q: readonly number[]): number {
  const mp = p.reduce((s, x) => s + x, 0) / p.length;
  const mq = q.reduce((s, x) => s + x, 0) / q.length;
  let num = 0;
  let dp = 0;
  let dq = 0;
  for (let i = 0; i < p.length; i++) {
    num += ((p[i] ?? 0) - mp) * ((q[i] ?? 0) - mq);
    dp += ((p[i] ?? 0) - mp) ** 2;
    dq += ((q[i] ?? 0) - mq) ** 2;
  }
  return dp === 0 || dq === 0 ? 0 : num / Math.sqrt(dp * dq);
}

/**
 * Points spread along two known orthogonal directions, one four times wider
 * than the other, plus a constant offset that centring has to remove.
 *
 * The answer is therefore known before the function runs: component 1 must be
 * the wide direction, component 2 the narrow one, and the variances must be in
 * roughly 16:1 proportion.
 */
function twoAxisFixture(n = 200, d = 64) {
  const rand = lcg(7);
  const vectors: number[][] = [];
  const rows: number[] = [];
  const wide: number[] = [];
  const narrow: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (rand() - 0.5) * 4;
    const b = (rand() - 0.5) * 1;
    const v = new Array<number>(d).fill(0);
    // A constant in a channel nothing else uses: pure offset, zero variance,
    // and it must not become component 1.
    v[0] = 5;
    v[3] = a;
    v[11] = b;
    for (let j = 20; j < d; j++) v[j] = (rand() - 0.5) * 0.02;
    vectors.push(v);
    rows.push(i);
    wide.push(a);
    narrow.push(b);
  }
  return { vectors, rows, wide, narrow };
}

describe("pca", () => {
  it("finds the directions the data actually varies along", () => {
    const { vectors, rows, wide, narrow } = twoAxisFixture();
    const { scores } = pca(vectors, rows);

    expect(Math.abs(corr(scores.map((s) => s[0]), wide))).toBeGreaterThan(0.99);
    expect(Math.abs(corr(scores.map((s) => s[1]), narrow))).toBeGreaterThan(0.99);
    /* And component 1 knows almost nothing about the narrow direction — which
       is what orthogonality is *for*, and the first thing a broken Gram–Schmidt
       loses. "Almost" rather than "nothing": the two coefficients are drawn
       independently but only 200 times, so their sample correlation is about
       1/√n ≈ 0.07 by chance, and PCA fits the sample it was given rather than
       the distribution it came from. 0.15 is comfortably below the 0.99 above
       and comfortably above the noise floor. */
    expect(Math.abs(corr(scores.map((s) => s[0]), narrow))).toBeLessThan(0.15);
  });

  it("puts the bigger component first, in the right proportion", () => {
    const { vectors, rows } = twoAxisFixture();
    const { variance } = pca(vectors, rows);
    expect(variance[0]).toBeGreaterThan(variance[1]);
    // 4² against 1², so about 16:1 — checked loosely, since the fixture carries
    // a little noise on purpose.
    expect(variance[0] / variance[1]).toBeGreaterThan(10);
    expect(variance[0] + variance[1]).toBeLessThanOrEqual(1.0001);
  });

  it("removes the mean, so a constant channel is not a component", () => {
    /* The offset in channel 0 is five times bigger than anything else in the
       fixture. Without centring it would dominate both components and the
       picture would be one dot's worth of information drawn 200 times. */
    const { vectors, rows, wide } = twoAxisFixture();
    const { scores } = pca(vectors, rows);
    expect(Math.abs(corr(scores.map((s) => s[0]), wide))).toBeGreaterThan(0.99);
  });

  it("gives the same answer twice", () => {
    const { vectors, rows } = twoAxisFixture();
    expect(pca(vectors, rows)).toEqual(pca(vectors, rows));
  });

  it("keeps its axes when the two components are nearly the same size", () => {
    /* **The case orthogonal iteration alone does not handle.** The plane
       converges at a rate set by the gap between the second and third
       eigenvalues, and says nothing about how the two axes are arranged
       *within* it — so when the top two are near-equal, the columns can rotate
       or swap and every well-separated fixture still passes. The Rayleigh–Ritz
       step at the end of `pca` is what decides the axes from the data.

       Two near-equal directions, and the ordering must still be by size and
       must be the same on a re-run. GPT Sol's finding, 2026-08-27. */
    const rand = lcg(3);
    const d = 48;
    const vectors: number[][] = [];
    const rows: number[] = [];
    for (let i = 0; i < 120; i++) {
      const v = new Array<number>(d).fill(0);
      v[5] = (rand() - 0.5) * 2;
      v[9] = (rand() - 0.5) * 1.98; // within 1% of the first
      for (let j = 20; j < d; j++) v[j] = (rand() - 0.5) * 0.01;
      vectors.push(v);
      rows.push(i);
    }
    const a = pca(vectors, rows);
    const b = pca(vectors, rows);
    expect(a.scores).toEqual(b.scores);
    expect(a.variance[0]).toBeGreaterThanOrEqual(a.variance[1]);
    /* **And the two axes are the eigenvectors, not any old orthonormal pair
       inside the right plane.** Determinism and ordering alone would pass for a
       rotated frame — GPT Sol's finding on the built code — and a rotated frame
       is exactly what orthogonal iteration leaves behind when the top two
       eigenvalues are close. The property that separates them is that the two
       score series are uncorrelated, which is what Rayleigh–Ritz buys. */
    expect(Math.abs(corr(a.scores.map((s) => s[0]), a.scores.map((s) => s[1])))).toBeLessThan(1e-6);
  });

  it("orients a component that tracks reading order so it runs left to right", () => {
    /* The sign of a principal component is arbitrary. Arbitrary is not stable,
       and a reader who learnt that the left of Drift is the ethics material
       should not find it on the right after a deploy.

       The fixture has to *have* a relationship with reading order for this to
       be a test of anything — on a component that drifts randomly the sign is
       settled by the fallback rule instead. So the wide coordinate here runs
       downhill with the row, and the mirror image runs uphill; both must come
       out pointing the same way. */
    const d = 32;
    const build = (direction: 1 | -1) => {
      const rand = lcg(23);
      const vectors: number[][] = [];
      const rows: number[] = [];
      for (let i = 0; i < 150; i++) {
        const v = new Array<number>(d).fill(0);
        v[4] = direction * (i / 150 - 0.5) * 4 + (rand() - 0.5) * 0.4;
        v[9] = (rand() - 0.5) * 0.6;
        vectors.push(v);
        rows.push(i);
      }
      return { vectors, rows };
    };
    const up = build(1);
    const down = build(-1);
    const a = pca(up.vectors, up.rows).scores.map((s) => s[0]);
    const b = pca(down.vectors, down.rows).scores.map((s) => s[0]);
    // Whichever way the underlying coordinate pointed, the drawn axis runs with
    // the article.
    expect(corr(a, up.rows)).toBeGreaterThan(0.5);
    expect(corr(b, down.rows)).toBeGreaterThan(0.5);
  });

  it("does not flip on a correlation that is only noise", () => {
    /* The knife edge this convention has to avoid. Two runs over data with no
       relationship to reading order must agree — the sign is then settled by
       the largest score, which is a fact about the text. */
    const { vectors, rows } = twoAxisFixture();
    const nudged = vectors.map((v, i) => {
      const c = [...v];
      // A change far too small to move a component, in a channel that is noise.
      c[40] = (c[40] ?? 0) + (i % 2 === 0 ? 1e-9 : -1e-9);
      return c;
    });
    const a = pca(vectors, rows).scores.map((s) => Math.sign(s[0]));
    const b = pca(nudged, rows).scores.map((s) => Math.sign(s[0]));
    expect(b).toEqual(a);
  });

  it("survives an article with nothing to say", () => {
    // One point, no points, and every point identical: all real inputs, and all
    // three are a division by zero if nothing guards them.
    expect(pca([], [])).toEqual({ scores: [], variance: [0, 0] });
    expect(pca([[1, 0]], [0])).toEqual({ scores: [[0, 0]], variance: [0, 0] });
    const same = pca(
      [
        [1, 0],
        [1, 0],
        [1, 0],
      ],
      [0, 1, 2],
    );
    expect(same.variance).toEqual([0, 0]);
    for (const s of same.scores) {
      expect(Number.isFinite(s[0])).toBe(true);
      expect(Number.isFinite(s[1])).toBe(true);
    }
  });
});

/** Four well-separated topics, laid out in reading order. */
function topicFixture(n = 200, d = 32, topics = 4) {
  const rand = lcg(11);
  const centres = Array.from({ length: topics }, () =>
    unit(Array.from({ length: d }, () => rand() - 0.5)),
  );
  const vectors: number[][] = [];
  const rows: number[] = [];
  const truth: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = Math.min(topics - 1, Math.floor((i / n) * topics));
    const c = centres[t] ?? [];
    vectors.push(unit(c.map((x) => x + (rand() - 0.5) * 0.12)));
    rows.push(i);
    truth.push(t);
  }
  return { vectors, rows, truth };
}

describe("kmeans", () => {
  it("recovers topics that really are there", () => {
    const { vectors, rows, truth } = topicFixture();
    const { labels } = kmeans(vectors, rows, 4);
    // Every true topic must land in exactly one lane, and no lane may hold two.
    const lanesOf = new Map<number, Set<number>>();
    labels.forEach((lane, i) => {
      const t = truth[i] ?? 0;
      (lanesOf.get(t) ?? lanesOf.set(t, new Set()).get(t))?.add(lane);
    });
    for (const lanes of lanesOf.values()) expect(lanes.size).toBe(1);
    expect(new Set(labels).size).toBe(4);
  });

  it("numbers the lanes by where the article gets to them", () => {
    /* The leftmost lane on Drift is what the piece opens with. Without this the
       lane order is whatever k-means++ happened to seed first, and the picture
       would rearrange itself between two articles that read identically. */
    const { vectors, rows, truth } = topicFixture();
    const { labels } = kmeans(vectors, rows, 4);
    const laneOf = new Map<number, number>();
    labels.forEach((lane, i) => {
      laneOf.set(truth[i] ?? 0, lane);
    });
    expect([laneOf.get(0), laneOf.get(1), laneOf.get(2), laneOf.get(3)]).toEqual([0, 1, 2, 3]);
  });

  it("gives the same answer twice", () => {
    /* k-means is the archetypal not-deterministic-by-default algorithm, and a
       picture that reshuffled between two identical loads is exactly what
       src/web/diagram-d3.ts § Determinism is about. */
    const { vectors, rows } = topicFixture();
    expect(kmeans(vectors, rows, 5)).toEqual(kmeans(vectors, rows, 5));
  });

  it("reports a distance from the centroid that means what its name says", () => {
    const { vectors, rows } = topicFixture();
    const { distances } = kmeans(vectors, rows, 4);
    for (const d of distances) {
      expect(Number.isFinite(d)).toBe(true);
      // Cosine distance over unit vectors: 0 is the topic itself, 2 is opposite.
      expect(d).toBeGreaterThanOrEqual(-1e-9);
      expect(d).toBeLessThanOrEqual(2 + 1e-9);
    }
  });

  it("fills every lane it says it has, even when the points make that hard", () => {
    /* **The test that was passing against a broken repair.** Its first version
       asked only whether the labels were integers, which is true of any answer.
       What has to hold is that `k` lanes really have `k` populations — the
       repair used to be able to hand the same point to two empty clusters, and
       to empty its donor doing it. GPT Sol's finding on the built code. */
    const rand = lcg(41);
    const d = 16;
    // Four tight blobs, and a `k` that has to find all four.
    const centres = Array.from({ length: 4 }, () =>
      unit(Array.from({ length: d }, () => rand() - 0.5)),
    );
    const vectors: number[][] = [];
    const rows: number[] = [];
    for (let i = 0; i < 40; i++) {
      const c = centres[i % 4] ?? [];
      vectors.push(unit(c.map((v) => v + (rand() - 0.5) * 0.05)));
      rows.push(i);
    }
    const { labels, k } = kmeans(vectors, rows, 4);
    const sizes = new Map<number, number>();
    for (const l of labels) sizes.set(l, (sizes.get(l) ?? 0) + 1);
    expect(k).toBe(4);
    expect(sizes.size).toBe(k);
    for (const n of sizes.values()) expect(n).toBeGreaterThan(0);
  });

  it("never returns an empty lane, and never asks for more lanes than points", () => {
    /* An empty lane is a legend chip with nothing behind it, and a `k` above `n`
       is a division by zero waiting in `recentre`. Both are reachable from a
       real article: a two-paragraph piece, or a piece whose paragraphs are all
       the same. */
    const two = kmeans(
      [
        [1, 0],
        [0, 1],
      ],
      [0, 1],
      5,
    );
    expect(new Set(two.labels).size).toBe(2);
    const identical = kmeans(
      [
        [1, 0],
        [1, 0],
        [1, 0],
        [1, 0],
      ],
      [0, 1, 2, 3],
      3,
    );
    expect(identical.labels).toHaveLength(4);
    for (const l of identical.labels) expect(Number.isInteger(l)).toBe(true);
  });

  it("returns nothing for nothing", () => {
    expect(kmeans([], [], 4)).toEqual({ labels: [], distances: [], k: 0 });
  });

  it("reports how many lanes there ARE, not how many were asked for", () => {
    /* Asked for five over two points: at most two lanes can exist, and a `k` of
       five would have the legend draw three chips for groups nobody is in —
       which reads as a bug in the naming rather than as groups that are not
       there. The labels must also be dense: 0…k-1 with no gaps, since the
       client indexes a palette and a lane's terms by them. */
    const got = kmeans(
      [
        [1, 0],
        [0, 1],
      ],
      [0, 1],
      5,
    );
    expect(got.k).toBe(2);
    expect([...new Set(got.labels)].sort()).toEqual([0, 1]);
    const { labels, k } = kmeans(
      [
        [1, 0],
        [1, 0],
        [1, 0],
        [1, 0],
      ],
      [0, 1, 2, 3],
      3,
    );
    expect(Math.max(...labels)).toBe(k - 1);
  });
});

describe("clusterCount", () => {
  it("never asks for more lanes than the band can draw, or fewer than two", () => {
    /* The cap is a fact about a 300px band rather than about the article — nine
       lanes would be 33px each — and the floor is that one lane is not a
       grouping. Both are worth pinning because both read as measurements. */
    expect(clusterCount(1)).toBe(1);
    expect(clusterCount(0)).toBe(0);
    expect(clusterCount(4)).toBeGreaterThanOrEqual(2);
    expect(clusterCount(5000)).toBe(8);
    for (const n of [0, 1, 2, 3, 20, 100, 360, 1500]) {
      expect(clusterCount(n)).toBeLessThanOrEqual(Math.max(1, n));
      expect(clusterCount(n)).toBeLessThanOrEqual(8);
    }
  });

  it("grows with the article rather than being one number", () => {
    expect(clusterCount(400)).toBeGreaterThan(clusterCount(30));
  });
});
