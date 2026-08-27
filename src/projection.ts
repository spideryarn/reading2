/**
 * **The article's paragraphs as points on a plane**, from their embeddings.
 *
 * Greg, 2026-08-27:
 *
 * > Each block is a point … do a principle components (or some other dimension
 * > reduction/clustering) on the semantic embeddings … Hopefully this will give
 * > us a rough sense of how the article progresses, which sections are similar
 * > to one another, etc.
 *
 * Two pictures use this — Drift (down the page is the article, sideways is what
 * it is talking about) and Trail (both axes are meaning, and the line joining
 * the dots is the article). docs/plans/embedding-scatter-diagrams.md is the
 * design; this file is the arithmetic.
 *
 * ## Everything here happens on the server, and that is the seam
 *
 * A 360-block article at 1024 dimensions is about 3MB of JSON. Sending that to
 * a browser so it can do a matrix multiply is the wrong side of the seam by two
 * orders of magnitude — the same argument [similar.ts](similar.ts) makes for
 * returning pairs rather than vectors. What crosses the wire is two floats and
 * a small integer per block: about 18KB on the longest article in the corpus.
 *
 * ## No dependency, and the reason is not thrift
 *
 * Principal components on n ≤ 1500 vectors is forty lines of arithmetic, and
 * the alternatives that would have justified a package — UMAP, t-SNE — are
 * rejected on a *claim* rather than on a cost. Their distances do not mean
 * anything: the gaps in a UMAP plot are an artefact of its own neighbour graph,
 * so a reader asking "are those two paragraphs nearly the same?" would be
 * reading a picture that cannot answer.
 *
 * ## What a projection can and cannot promise, which is one direction only
 *
 * The tempting sentence — *two dots close together really are close in the
 * model's space* — **is false, and it was in the first draft of this file.**
 * An orthogonal projection can only ever *shorten* a distance, so:
 *
 * - two dots **far apart** really were at least that far apart. Sound.
 * - two dots **close together** may be a pair of passages whose entire
 *   difference lay in one of the 1,022 directions this threw away.
 *
 * That asymmetry is the whole honest content of the picture, and no percentage
 * of variance rescues the second half — a figure for the *whole* article says
 * nothing about any particular pair. So the reader is told it in words rather
 * than left to infer it from a number. GPT Sol's finding, 2026-08-27.
 *
 * ## What this cannot know
 *
 * These vectors are about *subject matter*. An article arguing against
 * something talks about it in the words it would use to argue for it, and
 * nothing here can tell the two apart. Same class of caveat
 * docs/project/diagram.md records for the vocabulary edges, and it is worth
 * more here because this one costs money and involves a model, which together
 * read as authority.
 */
import type { Block, ProjectionResponse } from "./types.js";
import { articleVectors } from "./article-vectors.js";
import { hashBlocks } from "./source-hash.js";
import { log } from "./log.js";

/**
 * How many rounds of subspace iteration, at most.
 *
 * With an early exit this is a ceiling rather than a cost: on real articles the
 * two components stop moving after twenty or thirty. It is here so that a
 * pathological input cannot spin.
 */
const PCA_ROUNDS = 80;

/** When the subspace stops turning by more than this, it has converged. */
const PCA_EPS = 1e-9;

/**
 * How strong the relationship with reading order has to be before it is allowed
 * to decide a component's sign.
 *
 * 0.2, which is well clear of the ≈1/√n a sample correlation reaches by chance
 * on an article of any length worth drawing. Below it the tie is broken by the
 * data instead — see `orient`.
 *
 * **No sign convention is stable for an article that has no relationship with
 * reading order at all**, and this does not pretend otherwise; what it does is
 * move the knife edge from "always" to "rarely", and make the fallback a
 * property of the text rather than of the rounding. For identical input the
 * answer is identical either way, which is what the tests pin.
 */
const ORIENT_MIN_R = 0.2;

/** k-means restarts, and rounds within a restart. Both bounded — see `kmeans`. */
const KMEANS_RESTARTS = 3;
const KMEANS_ROUNDS = 25;

/** How many topics to ask for, and why the ceiling is not about the data. */
export function clusterCount(n: number): number {
  /* The usual rule of thumb (√(n/2)) would say thirteen topics for a 360-block
     article. Eight is a fact about a 300px band — nine lanes are 33px each —
     not a measurement of the article, and it is written down here so nobody
     later reads it as one. */
  /* **The clamp to `n` is on the outside, and the order matters.** Written the
     other way round — `max(2, min(8, min(n, …)))` — a one-paragraph article
     asks for two topics, which `kmeans` then silently clamps back while the
     response still reports `k: 2` and the legend draws two chips for one dot.
     Found by the test below rather than by looking. */
  return Math.min(n, Math.max(2, Math.min(8, Math.round(Math.sqrt(n / 4)))));
}

/* ── principal components ─────────────────────────────────────────────────── */

export interface Pca {
  /** `[component 1, component 2]` per input vector, in input order. */
  scores: [number, number][];
  /** What fraction of the total variance each component holds. 0–1. */
  variance: [number, number];
}

/**
 * The top two principal components, by subspace iteration.
 *
 * **No covariance matrix is ever formed.** At 1024 dimensions that is a million
 * entries and n·d² to fill; the iteration below needs neither, because
 * `Cq = (1/n) Σᵢ xᵢ (xᵢ·q)` can be accumulated in one pass over the data at
 * 2·n·d per component. On the longest article in the corpus that is about 90M
 * multiply-adds for the whole run — tens of milliseconds, once, then cached.
 *
 * Both components are iterated together with a Gram–Schmidt step between
 * rounds, which is ordinary orthogonal iteration: the pair converges to the
 * dominant two-dimensional invariant subspace, and the Gram–Schmidt ordering is
 * what sorts the two within it.
 *
 * `rows` is the document position of each vector, and it is here only to fix
 * the **sign**. See below — it does not affect what is computed.
 */
export function pca(
  vectors: readonly (readonly number[])[],
  rows: readonly number[],
): Pca {
  const n = vectors.length;
  const d = vectors[0]?.length ?? 0;
  if (n < 2 || d === 0) {
    return { scores: vectors.map(() => [0, 0] as [number, number]), variance: [0, 0] };
  }

  /* Flat and typed. This is the one place in the app doing real numeric work,
     and an array of arrays of boxed numbers is several times slower for it. */
  const x = new Float64Array(n * d);
  for (let i = 0; i < n; i++) {
    const v = vectors[i];
    if (!v) continue;
    for (let j = 0; j < d; j++) x[i * d + j] = v[j] ?? 0;
  }
  /* Centred, after the vectors were normalised upstream (article-vectors.ts).
     That order matters and is the conventional one: normalising is about the
     *geometry the model was trained for*, centring is about what varies within
     this one article. Centring first and normalising after would rescale each
     deviation to length 1 and throw away exactly the magnitudes PCA is looking
     for. */
  const mean = new Float64Array(d);
  for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) mean[j] = (mean[j] ?? 0) + (x[i * d + j] ?? 0);
  for (let j = 0; j < d; j++) mean[j] = (mean[j] ?? 0) / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) x[i * d + j] = (x[i * d + j] ?? 0) - (mean[j] ?? 0);

  let total = 0;
  for (let i = 0; i < n * d; i++) total += (x[i] ?? 0) ** 2;
  total /= n;

  /* Deterministic start. A fixed pseudo-random vector rather than a data point,
     because a data point can lie almost exactly in the space of another and
     start the two columns nearly parallel — which is slow to converge and,
     worse, converges to whichever of them the rounding favoured. The generator
     is the same trick d3-force uses to be reproducible without Math.random. */
  const rand = lcg(0x2f6e2b1);
  let q1 = normalise(Float64Array.from({ length: d }, () => rand() - 0.5));
  let q2 = normalise(Float64Array.from({ length: d }, () => rand() - 0.5));

  for (let round = 0; round < PCA_ROUNDS; round++) {
    const [p1, p2] = applyBoth(x, n, d, q1, q2);
    const next1 = normalise(p1);
    // Modified Gram–Schmidt: the second column keeps only what the first does
    // not hold, and it is re-orthogonalised once because one pass loses
    // orthogonality when the two are nearly parallel.
    project(p2, next1);
    project(p2, next1);
    const next2 = normalise(p2);

    /* **Converged when the PLANE stops turning, not when the two vectors do.**
       The pair is only determined up to a rotation within the plane, so a test
       on each vector can report "still moving" forever while the subspace has
       been settled for fifty rounds — and can report "converged" on a round
       where they happened to line up. The projector `QQᵀ` is the same for every
       basis of the same plane, so `‖Q'Q'ᵀ − QQᵀ‖` asks the question that has an
       answer. GPT Sol's finding, 2026-08-27. */
    const moved = projectorGap(q1, q2, next1, next2);
    q1 = next1;
    q2 = next2;
    if (moved < PCA_EPS) break;
  }

  /* **Rayleigh–Ritz: the plane is settled, now decide the two axes inside it.**
     Orthogonal iteration converges to the *subspace* at a rate set by the gap
     between the second and third eigenvalues — it says nothing about how the
     two columns are arranged within it. When the first two eigenvalues are
     close, the columns can rotate, swap, or crawl, and every test over a
     well-separated fixture passes anyway. So the 2×2 matrix `Qᵀ C Q` is
     eigendecomposed in closed form and `Q` is rotated by its eigenvectors,
     which makes "component 1" a property of the data rather than of how many
     rounds we happened to run.

     What this does NOT fix, and nothing can: when the top two eigenvalues are
     genuinely almost equal, the two axes are close to arbitrary — a hair of
     difference in the text can rotate them. That is a fact about the article
     and it is written into docs/project/diagram.md rather than papered over. */
  {
    const [c1, c2] = applyBoth(x, n, d, q1, q2);
    const a = dot(q1, c1) / n;
    const b = dot(q1, c2) / n;
    const c = dot(q2, c2) / n;
    const [[u1, u2], [w1, w2]] = eig2(a, b, c);
    const r1 = new Float64Array(d);
    const r2 = new Float64Array(d);
    for (let j = 0; j < d; j++) {
      r1[j] = u1 * (q1[j] ?? 0) + u2 * (q2[j] ?? 0);
      r2[j] = w1 * (q1[j] ?? 0) + w2 * (q2[j] ?? 0);
    }
    q1 = normalise(r1);
    q2 = normalise(r2);
  }

  const scores: [number, number][] = [];
  let v1 = 0;
  let v2 = 0;
  for (let i = 0; i < n; i++) {
    let a = 0;
    let b = 0;
    const off = i * d;
    for (let j = 0; j < d; j++) {
      const v = x[off + j] ?? 0;
      a += v * (q1[j] ?? 0);
      b += v * (q2[j] ?? 0);
    }
    scores.push([a, b]);
    v1 += a * a;
    v2 += b * b;
  }

  orient(scores, 0, rows);
  orient(scores, 1, rows);

  return {
    scores,
    variance: [total > 0 ? v1 / n / total : 0, total > 0 ? v2 / n / total : 0],
  };
}

/**
 * **The sign of a principal component is arbitrary, and arbitrary is not the
 * same as stable.**
 *
 * Left unfixed, the same article can come back mirrored on a different process,
 * and a reader who learnt that the left-hand side of Drift is where the ethics
 * material lives would find it on the right after a deploy.
 *
 * So each component is flipped, if it needs it, to run *with* the article:
 * positive covariance with the row index, which reads as the piece moving left
 * to right. It does not make the axis mean anything — it makes it the same
 * every time.
 *
 * The fallback matters more than it looks. On a component with no relationship
 * to reading order at all the correlation is a hair either side of zero, and
 * flipping on its sign would be flipping on rounding noise — two articles that
 * differ by a comma could come out mirrored. Below `ORIENT_MIN_R` the tie is
 * broken by the largest score instead, which is a property of the data.
 *
 * **What is honestly left**: an article whose correlation sits right on the
 * threshold, or whose largest score has a near-twin of the opposite sign, can
 * still mirror between two nearly-identical runs. There is no convention
 * without such a case; this one has moved it somewhere unlikely and said where.
 */
function orient(scores: [number, number][], axis: 0 | 1, rows: readonly number[]): void {
  const n = scores.length;
  if (n === 0) return;

  /* A real Pearson correlation, not a covariance with an ad-hoc denominator.
     The first version compared `|cov|` against a scale of its own invention and
     took any ratio above 1e-6 as decisive — which for a component with *no*
     relationship to reading order is a coin flip on rounding noise, since the
     sample correlation of two independent series is about 1/√n by chance. That
     is precisely the failure GPT Sol named. */
  let meanRow = 0;
  let meanScore = 0;
  for (let i = 0; i < n; i++) {
    meanRow += rows[i] ?? i;
    meanScore += scores[i]?.[axis] ?? 0;
  }
  meanRow /= n;
  meanScore /= n;

  let cov = 0;
  let varRow = 0;
  let varScore = 0;
  for (let i = 0; i < n; i++) {
    const dr = (rows[i] ?? i) - meanRow;
    const ds = (scores[i]?.[axis] ?? 0) - meanScore;
    cov += dr * ds;
    varRow += dr * dr;
    varScore += ds * ds;
  }
  const denom = Math.sqrt(varRow * varScore);
  const r = denom > 0 ? cov / denom : 0;

  let flip: boolean;
  if (Math.abs(r) >= ORIENT_MIN_R) {
    flip = r < 0;
  } else {
    /* No usable relationship with reading order — the article does not move
       through this axis as it goes. Take the largest-magnitude score and make
       it positive: deterministic, and a property of the data rather than of the
       arithmetic. Ties go to the earliest row, which is why this scans rather
       than sorts. */
    let best = 0;
    for (let i = 1; i < n; i++) {
      if (Math.abs(scores[i]?.[axis] ?? 0) > Math.abs(scores[best]?.[axis] ?? 0)) best = i;
    }
    flip = (scores[best]?.[axis] ?? 0) < 0;
  }
  if (!flip) return;
  for (const s of scores) s[axis] = -s[axis];
}

/* ── clustering ───────────────────────────────────────────────────────────── */

export interface Clustering {
  /** Which cluster each input vector is in, 0-based and already lane-ordered. */
  labels: number[];
  /** How far each vector is from its own centroid, 0 (identical) upwards. */
  distances: number[];
  k: number;
}

/**
 * **Spherical k-means** over the unit vectors — cosine, not Euclidean.
 *
 * The vectors arrive normalised (article-vectors.ts), so `1 − x·c` is the
 * cosine distance and the mean of a cluster only has to be re-normalised each
 * round for its centroid to stay on the sphere. That is the whole difference
 * from ordinary k-means, and it is the right one: these embeddings were trained
 * for angle, and the length of a mean vector says how *agreed* a cluster is
 * rather than where it sits.
 *
 * **Deterministic by construction**, which k-means is not by default: k-means++
 * seeding draws from a seeded generator, restarts are ordered, and ties are
 * broken by index rather than by whichever comparison ran first. A picture that
 * reshuffles between two identical loads is the bug the whole determinism story
 * in src/web/diagram-d3.ts is about.
 *
 * `rows` orders the finished clusters left to right by their **median** row, so
 * the leftmost lane is what the article opens with. Median rather than first
 * appearance: one stray early paragraph should not drag a whole lane to the
 * front.
 */
export function kmeans(
  vectors: readonly (readonly number[])[],
  rows: readonly number[],
  k: number,
): Clustering {
  const n = vectors.length;
  const d = vectors[0]?.length ?? 0;
  if (n === 0 || d === 0 || k < 1) return { labels: [], distances: [], k: 0 };
  const kk = Math.max(1, Math.min(k, n));

  const x = new Float64Array(n * d);
  for (let i = 0; i < n; i++) {
    const v = vectors[i];
    if (!v) continue;
    for (let j = 0; j < d; j++) x[i * d + j] = v[j] ?? 0;
  }

  let bestLabels: number[] = new Array(n).fill(0);
  let bestDist: number[] = new Array(n).fill(0);
  let bestInertia = Number.POSITIVE_INFINITY;

  for (let restart = 0; restart < KMEANS_RESTARTS; restart++) {
    /* A different seed per restart, fixed per index — so the three restarts are
       three different starts and the same three every time. */
    const rand = lcg(0x9e3779b1 + restart * 0x85ebca6b);
    const centres = plusPlus(x, n, d, kk, rand);
    const labels = new Array<number>(n).fill(0);
    const dist = new Array<number>(n).fill(0);

    for (let round = 0; round < KMEANS_ROUNDS; round++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        let best = 0;
        let bestSim = Number.NEGATIVE_INFINITY;
        for (let c = 0; c < kk; c++) {
          const sim = dotAt(x, i * d, centres, c * d, d);
          // `>` not `>=`: the first centroid wins a tie, which makes the
          // assignment a function of the data rather than of the loop order.
          if (sim > bestSim) {
            bestSim = sim;
            best = c;
          }
        }
        if (labels[i] !== best) moved = true;
        labels[i] = best;
        dist[i] = 1 - bestSim;
      }
      recentre(x, n, d, kk, labels, dist, centres);
      if (!moved && round > 0) break;
    }

    let inertia = 0;
    for (const v of dist) inertia += v;
    if (inertia < bestInertia - 1e-12) {
      bestInertia = inertia;
      bestLabels = [...labels];
      bestDist = [...dist];
    }
  }

  return orderLanes(bestLabels, bestDist, rows, kk);
}

/**
 * k-means++ seeding: the first centre is drawn uniformly, each later one with
 * probability proportional to its squared distance from the nearest centre
 * already chosen.
 *
 * Worth having rather than picking k at random: plain random seeding on
 * embeddings routinely lands two centres inside the same dense topic, and the
 * result is one lane holding two thirds of the article and a lane holding four
 * paragraphs. That failure looks like a finding.
 */
function plusPlus(
  x: Float64Array,
  n: number,
  d: number,
  k: number,
  rand: () => number,
): Float64Array {
  const centres = new Float64Array(k * d);
  const first = Math.min(n - 1, Math.floor(rand() * n));
  for (let j = 0; j < d; j++) centres[j] = x[first * d + j] ?? 0;

  /* **This holds `1 − cos`, and that already IS the squared distance** — up to
     a factor of two, which cancels in the weighting below. For unit vectors
     `‖a − b‖² = 2(1 − a·b)`, so squaring this again would weight by the fourth
     power of the distance: the common wrong implementation of k-means++, and
     one that makes the seeding far greedier than the algorithm it is named
     after. GPT Sol's finding, 2026-08-27. */
  const nearest = new Float64Array(n);
  for (let i = 0; i < n; i++) nearest[i] = 1 - dotAt(x, i * d, centres, 0, d);

  for (let c = 1; c < k; c++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.max(0, nearest[i] ?? 0);
    let pick = n - 1;
    if (sum > 0) {
      let target = rand() * sum;
      for (let i = 0; i < n; i++) {
        target -= Math.max(0, nearest[i] ?? 0);
        if (target <= 0) {
          pick = i;
          break;
        }
      }
    } else {
      // Every point is already on a centre — spread the rest deterministically
      // rather than stacking them all on the last index.
      pick = Math.min(n - 1, c);
    }
    for (let j = 0; j < d; j++) centres[c * d + j] = x[pick * d + j] ?? 0;
    for (let i = 0; i < n; i++) {
      const dd = 1 - dotAt(x, i * d, centres, c * d, d);
      if (dd < (nearest[i] ?? 0)) nearest[i] = dd;
    }
  }
  return centres;
}

/**
 * Move every centroid to the (re-normalised) mean of its members, repairing any
 * cluster that has ended up with nobody in it.
 */
function recentre(
  x: Float64Array,
  n: number,
  d: number,
  k: number,
  labels: number[],
  dist: number[],
  centres: Float64Array,
): void {
  const counts = new Array<number>(k).fill(0);
  const sums = new Float64Array(k * d);
  for (let i = 0; i < n; i++) {
    const c = labels[i] ?? 0;
    counts[c] = (counts[c] ?? 0) + 1;
    for (let j = 0; j < d; j++) sums[c * d + j] = (sums[c * d + j] ?? 0) + (x[i * d + j] ?? 0);
  }

  /* **Fill the empty clusters first, and keep the books straight while doing
     it.** The obvious version repairs each empty cluster inside the same loop
     that recomputes the centroids, which gets two things wrong and neither is
     visible: it can hand the *same* worst point to two empty clusters in a row,
     so one of them is still empty; and it leaves `counts` and `sums` describing
     an arrangement that no longer exists, so a donor's centroid is computed
     from a point that has left it — and a donor holding exactly one point is
     now empty itself, undetected. GPT Sol's finding, 2026-08-27.

     So: donations happen here, each point can be donated only once, and the
     donor's own totals are decremented as it goes. A cluster whose last point
     would be taken is skipped, so a repair cannot create the problem it exists
     to fix. */
  const donated = new Set<number>();
  for (let c = 0; c < k; c++) {
    if ((counts[c] ?? 0) > 0) continue;
    let worst = -1;
    for (let i = 0; i < n; i++) {
      if (donated.has(i)) continue;
      // Never empty a cluster to fill one: that is the same problem, moved.
      if ((counts[labels[i] ?? 0] ?? 0) <= 1) continue;
      if (worst === -1 || (dist[i] ?? 0) > (dist[worst] ?? 0)) worst = i;
    }
    /* Fewer distinct points than clusters. There is no honest repair, and
       `orderLanes` compacts the empty lane away rather than letting the legend
       draw a chip for a group nobody is in. */
    if (worst === -1) continue;
    const from = labels[worst] ?? 0;
    counts[from] = (counts[from] ?? 0) - 1;
    counts[c] = 1;
    for (let j = 0; j < d; j++) {
      const v = x[worst * d + j] ?? 0;
      sums[from * d + j] = (sums[from * d + j] ?? 0) - v;
      sums[c * d + j] = v;
    }
    labels[worst] = c;
    dist[worst] = 0;
    donated.add(worst);
  }

  for (let c = 0; c < k; c++) {
    if ((counts[c] ?? 0) === 0) continue;
    let norm = 0;
    for (let j = 0; j < d; j++) norm += (sums[c * d + j] ?? 0) ** 2;
    norm = Math.sqrt(norm);
    for (let j = 0; j < d; j++) {
      centres[c * d + j] = norm > 0 ? (sums[c * d + j] ?? 0) / norm : (centres[c * d + j] ?? 0);
    }
  }
}


/**
 * Relabel so lane 0 is the one the article opens with, and **so a lane nobody
 * is in stops existing**.
 *
 * The ordering is the visible half: the leftmost column on Drift should be what
 * the piece opens with, or the picture rearranges itself between two articles
 * that read the same way.
 *
 * The compaction is the quiet half. `k` is what we *asked* for; k-means can hand
 * back fewer non-empty groups than that (`recentre` repairs an empty cluster by
 * stealing a point, and stealing can empty another). A lane index nobody uses
 * would still get a legend chip, drawn beside seven that mean something and
 * naming nothing — which reads as a bug in the naming rather than as a group
 * that is not there. So the returned `k` is **how many lanes there actually
 * are**, and the caller reports that rather than what it asked for.
 */
function orderLanes(
  labels: readonly number[],
  distances: readonly number[],
  rows: readonly number[],
  k: number,
): Clustering {
  const members: number[][] = Array.from({ length: k }, () => []);
  labels.forEach((c, i) => {
    members[c]?.push(rows[i] ?? i);
  });
  const used = members
    .map((m, c) => ({ c, m }))
    .filter((e) => e.m.length > 0)
    .map((e) => {
      const sorted = [...e.m].sort((a, b) => a - b);
      return { c: e.c, at: sorted[Math.floor(sorted.length / 2)] ?? 0 };
    });
  // The old cluster index is the tie-break, so two lanes with the same median
  // come out in the same order on every run.
  used.sort((a, b) => a.at - b.at || a.c - b.c);
  const rank = new Map(used.map((m, i) => [m.c, i]));
  return {
    labels: labels.map((c) => rank.get(c) ?? 0),
    distances: [...distances],
    k: used.length,
  };
}

/* ── the answer ───────────────────────────────────────────────────────────── */

/**
 * `${slug}:${hash}` → the finished answer.
 *
 * **The vectors being cached is not enough**, which the first draft assumed:
 * the arithmetic over them is 290ms on a 276-block article, measured, and
 * every reader who presses the toggle would pay it again on a warm process.
 * Small — a few hundred numbers per article — so this one is capped by count.
 * GPT Sol's finding, 2026-08-27.
 */
const CACHE = new Map<string, ProjectionResponse>();
const INFLIGHT = new Map<string, Promise<ProjectionResponse>>();
const MAX_CACHED = 12;

/**
 * Embed the article if it has not been embedded, then project and cluster it.
 *
 * ## What it costs, measured rather than estimated
 *
 * On `constitution` (360 blocks, 276 of them embeddable), 2026-08-27:
 * **4.5s and $0.0015** for the embeddings on a cold article, then **290ms** of
 * arithmetic — 137ms of principal components and 81ms of k-means on a synthetic
 * run of the same size. Both are cached afterwards.
 *
 * **That 290ms is synchronous, and on a single-process dev server it is 290ms
 * nothing else runs in.** At the `MAX_BLOCKS` ceiling of 1,500 it would be
 * nearer a second. The loops are not interruptible; what they do have is a
 * yield between the phases, so an event loop with other work waiting gets two
 * chances at it rather than none. Said out loud rather than described as "tens
 * of milliseconds", which is what the plan claimed before anybody ran it.
 */
export async function projectArticle(
  slug: string,
  blocks: readonly Block[],
): Promise<ProjectionResponse> {
  const key = `${slug}:${hashBlocks(blocks)}`;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const flying = INFLIGHT.get(key);
  if (flying) return flying;
  const work = compute(slug, blocks, key).finally(() => INFLIGHT.delete(key));
  INFLIGHT.set(key, work);
  return work;
}

async function compute(
  slug: string,
  blocks: readonly Block[],
  key: string,
): Promise<ProjectionResponse> {
  const got = await articleVectors(slug, blocks);
  const rows = got.rows.map((r) => r.row);
  if (got.rows.length < 2) {
    /* One dot has no plane to sit on and no topic to be typical of. Zeros
       rather than an error: an article of two paragraphs is a real article, and
       the picture that draws one dot in the middle is the correct picture of
       it. */
    const thin: ProjectionResponse = {
      model: got.model,
      blocks: got.rows.length,
      skipped: got.skipped,
      variance: [0, 0],
      k: 0,
      points: got.rows.map((r) => ({ id: r.id, x: 0, y: 0, c: 0 })),
    };
    remember(key, thin);
    return thin;
  }

  const started = Date.now();
  const { scores, variance } = pca(got.vectors, rows);
  // One yield between the two long loops. It does not make either of them
  // interruptible; it stops them being one uninterrupted block of main thread.
  await new Promise((resolve) => setImmediate(resolve));
  const asked = clusterCount(got.rows.length);
  /* `k` from the answer, not from the question. See `orderLanes`: k-means can
     come back with fewer non-empty groups than it was asked for, and reporting
     the request would have the legend draw a chip for a lane nobody is in. */
  const { labels, k } = kmeans(got.vectors, rows, asked);

  log("model")
    .child({ slug })
    .debug(
      {
        blocks: got.rows.length,
        k,
        pc1: Number(variance[0].toFixed(4)),
        pc2: Number(variance[1].toFixed(4)),
        ms: Date.now() - started,
      },
      "projected an article",
    );

  const answer: ProjectionResponse = {
    model: got.model,
    blocks: got.rows.length,
    skipped: got.skipped,
    variance,
    k,
    points: got.rows.map((r, i) => ({
      id: r.id,
      // Five decimals: these are cosine-scale numbers, and full float64 would
      // triple the payload to say nothing a 340px picture could draw.
      x: round5(scores[i]?.[0] ?? 0),
      y: round5(scores[i]?.[1] ?? 0),
      c: labels[i] ?? 0,
    })),
  };
  remember(key, answer);
  return answer;
}

function remember(key: string, answer: ProjectionResponse): void {
  CACHE.set(key, answer);
  while (CACHE.size > MAX_CACHED) {
    const oldest = CACHE.keys().next().value;
    if (oldest === undefined) break;
    CACHE.delete(oldest);
  }
}


/* ── small arithmetic ─────────────────────────────────────────────────────── */

/**
 * A seeded linear congruential generator — the same one d3-force carries, and
 * for the same reason: `Math.random()` would make every cold start a different
 * picture of the same article, and that is not reproducible, not testable, and
 * not what the reader expects from pressing a toggle twice.
 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * `Cq` for both columns at once, where `C` is the (unformed) covariance —
 * one pass over the data rather than two, since the pass is the cost.
 *
 * Not divided by `n`: every use of this either normalises the result or divides
 * once at the end, and dividing here would be `2d` extra operations per round
 * to change nothing.
 */
function applyBoth(
  x: Float64Array,
  n: number,
  d: number,
  q1: Float64Array,
  q2: Float64Array,
): [Float64Array, Float64Array] {
  const p1 = new Float64Array(d);
  const p2 = new Float64Array(d);
  for (let i = 0; i < n; i++) {
    let a = 0;
    let b = 0;
    const off = i * d;
    for (let j = 0; j < d; j++) {
      const v = x[off + j] ?? 0;
      a += v * (q1[j] ?? 0);
      b += v * (q2[j] ?? 0);
    }
    for (let j = 0; j < d; j++) {
      const v = x[off + j] ?? 0;
      p1[j] = (p1[j] ?? 0) + v * a;
      p2[j] = (p2[j] ?? 0) + v * b;
    }
  }
  return [p1, p2];
}

/** Subtract from `v` whatever lies along the unit vector `u`. In place. */
function project(v: Float64Array, u: Float64Array): void {
  const overlap = dot(v, u);
  for (let j = 0; j < v.length; j++) v[j] = (v[j] ?? 0) - overlap * (u[j] ?? 0);
}

/**
 * How far apart two planes are, as the difference of their projectors.
 *
 * `‖QQᵀ − Q'Q'ᵀ‖²_F` for orthonormal 2-frames works out as `2·(2 − ‖QᵀQ'‖²_F)`,
 * which is four dot products rather than a `d × d` matrix. Zero when the two
 * frames span the same plane, whatever basis each is written in.
 */
function projectorGap(
  a1: Float64Array,
  a2: Float64Array,
  b1: Float64Array,
  b2: Float64Array,
): number {
  const m = dot(a1, b1) ** 2 + dot(a1, b2) ** 2 + dot(a2, b1) ** 2 + dot(a2, b2) ** 2;
  return Math.max(0, 2 * (2 - m));
}

/**
 * The eigenvectors of the symmetric 2×2 `[[a, b], [b, c]]`, larger eigenvalue
 * first, as two unit rows.
 *
 * Closed form rather than another iteration: at this size the quadratic *is*
 * the answer, and an iterative solver here would reintroduce exactly the
 * ordering ambiguity this exists to remove.
 */
function eig2(a: number, b: number, c: number): [[number, number], [number, number]] {
  // Already diagonal (or as near as makes no difference): the axes are the
  // frame itself, ordered by which eigenvalue is bigger. Guarding this is what
  // stops a zero-length eigenvector when `b` is 0.
  if (Math.abs(b) < 1e-14) {
    return a >= c ? [[1, 0], [0, 1]] : [[0, 1], [1, 0]];
  }
  const mid = (a + c) / 2;
  const half = Math.sqrt(((a - c) / 2) ** 2 + b * b);
  const big = mid + half;
  const small = mid - half;
  const norm1 = Math.hypot(b, big - a);
  const norm2 = Math.hypot(b, small - a);
  return [
    [b / norm1, (big - a) / norm1],
    [b / norm2, (small - a) / norm2],
  ];
}

function normalise(v: Float64Array): Float64Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += (v[i] ?? 0) ** 2;
  const n = Math.sqrt(sum);
  if (!Number.isFinite(n) || n === 0) return v;
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = (v[i] ?? 0) / n;
  return out;
}

function dot(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

/** A dot product between two rows of two flat arrays, without slicing either. */
function dotAt(a: Float64Array, ao: number, b: Float64Array, bo: number, d: number): number {
  let sum = 0;
  for (let j = 0; j < d; j++) sum += (a[ao + j] ?? 0) * (b[bo + j] ?? 0);
  return sum;
}

function round5(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 1e5) / 1e5 : 0;
}
