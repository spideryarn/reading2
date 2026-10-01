/**
 * **Thinking effort against quality, for Sketch, Ideas and Illustrated** — the
 * harness for plan 261001p (docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md).
 *
 *   npx tsx evals/thinking-effort/run.ts --mode sketch --arm base-a --arm low-a --slug cargocult-spya-rz663q
 *   npx tsx evals/thinking-effort/run.ts --mode sketch --mode ideas --mode illustrated --out evals/results/thinking-effort-<stamp>
 *   npx tsx evals/thinking-effort/run.ts --export-only --out <dir>      # free: write the corpus, spend nothing
 *
 * With no `--slug`, the eight articles in arms.ts; with no `--arm`, `base-a`,
 * `base-b`, `low-a`, `low-b` (arms.ts says why two of each). Hierarchy is not
 * here: it is the `smart-off` arms of evals/hierarchy-structure/, pointed at
 * the `corpus/` directory this harness writes (its README says how). Blind
 * judging materials come from lineup.ts.
 *
 * ## What it holds fixed, and how
 *
 * - **The shipping generators, never a copy of a prompt** — `generateSketch`,
 *   `generateIdeas`, `generateIllustrated`; the trap evals/hierarchy-structure/
 *   names in its header.
 * - **Full-length articles from the local Postgres store**, read with
 *   `readArticle(slug, store)` exactly as the pipeline's steps read them, over
 *   a read-only store bound to the article's current published revision. Not
 *   `data/` and not the fixture corpus, which are cut down. Block and character
 *   counts go on every row so a short article cannot slip in.
 * - **`base` is production's request, byte for byte.** Sketch and Ideas run
 *   with nothing overridden, so they send `STAGE_EFFORT` through `effortFor`;
 *   Illustrated runs with no `effort`, so it sends no `output_config` at all —
 *   which is what it sends today (GPT Sol's review, F4).
 * - **Lower arms**: Sketch and Ideas through `SPIDERYARN_PIPELINE_EFFORT`,
 *   which `effortFor` honours — process-global, so calls run one at a time,
 *   the variable is restored in a `finally`, and its absence is asserted after
 *   every run. A run started with it already set is refused. Illustrated
 *   through its `effort` option.
 * - **Generation order is counterbalanced**: per (mode, article) the arms run
 *   in a seeded shuffle, the seed recorded in `order.json` and reused on a
 *   resume, so effort is not confounded with time or provider load (F12).
 * - **What was actually sent is read off the wire, not assumed.** `fetch` is
 *   wrapped for the run, so each row records the `effort`, `thinking` and
 *   `model` the Messages request carried and the `stop_reason` the stream
 *   ended with. A wire effort that differs from the arm's stops the run: a
 *   harness bug here spends the whole budget on the wrong question.
 * - **Illustrated paints the same Sketch and is offered the same figures in
 *   every arm**: the `base-a` Sketch from this output directory (it refuses to
 *   run without one), and the paper's figures loaded the pipeline's way, their
 *   count and a fingerprint on every row (F6). **Plates are off by default** —
 *   the brief is the judged output and plate luck is not effort (F9); `--plates`
 *   draws them for real.
 * - `cacheArticle` unset, `profile: null`, Ideas `previous: null`, `power:
 *   "standard"`, in every arm.
 *
 * ## Where the numbers come from
 *
 * Tokens, thinking tokens, upstream and money are the **ledger's** records for
 * the call — `collectSpend` around each run with the same sink and `eval`
 * attribution evals/illustrated/run.ts uses, so `npm run cost` sees every
 * call. Thinking tokens are `output_tokens_details.thinking_tokens`, read by
 * src/messages-stream.ts into `reasoningTokens`, and are *inside* output
 * tokens; the same figure read off the raw stream sits beside it as a check.
 * `costUsd` is the ledger's figure (OpenRouter's settled cost, through
 * `totalSpend`); `listUsd` re-prices the same tokens with `priceAnthropicCall`
 * from src/pricing.ts. Latency is the generator's wall clock.
 *
 * Re-running into an existing `--out` skips every (mode, arm, slug) that
 * already has a row in `runs.jsonl`, failed rows included — a failure is a
 * result here, and a crash half-way through must not pay twice.
 */
import { createHash, randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Article } from "../../src/article-input.js";
import type { SpendRecord } from "../../src/ai-spend.js";
import { isMain } from "../../src/is-main.js";
import type { Effort } from "../../src/models.js";
import type { Sketch } from "../../src/sketch-scene.js";
import {
  ARM_NAMES,
  type ArmName,
  DEFAULT_ARMS,
  DEFAULT_SLUGS,
  type Level,
  levelOf,
  type Mode,
  MODES,
  seededShuffle,
} from "./arms.js";

/* The paid machinery — the generators, the store, the ledger — is imported
   inside `main`, after `.env.local` is loaded, for the reason
   evals/sketch/run.ts gives at its top. */

/**
 * What one arm sends for one mode. `override` is what the harness sets (null:
 * nothing — production's own path); `expectedOnWire` is the
 * `output_config.effort` the request must then carry (null: none at all).
 */
export interface ArmEffort {
  override: Effort | null;
  expectedOnWire: Effort | null;
}

/**
 * `production` is the mode's effort as the code resolves it today, or `null`
 * for Illustrated, which names none.
 */
export function armEffort(level: Level, production: Effort | null): ArmEffort {
  if (level === "base") return { override: null, expectedOnWire: production };
  return { override: level, expectedOnWire: level };
}

interface Options {
  modes: Mode[];
  arms: ArmName[];
  slugs: string[];
  outDir: string;
  exportOnly: boolean;
  plates: boolean;
  seed: number | null;
}

function parseArgs(argv: string[]): Options {
  const modes: Mode[] = [];
  const arms: ArmName[] = [];
  const slugs: string[] = [];
  let outDir = "";
  let exportOnly = false;
  let plates = false;
  let seed: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const next = (): string => {
      const v = argv[++i];
      if (!v) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--mode") {
      const m = next();
      if (!(MODES as readonly string[]).includes(m)) throw new Error(`--mode ${m}: not one of ${MODES.join(", ")}`);
      modes.push(m as Mode);
    } else if (a === "--arm") {
      const n = next();
      if (!(ARM_NAMES as readonly string[]).includes(n)) throw new Error(`--arm ${n}: not one of ${ARM_NAMES.join(", ")}`);
      arms.push(n as ArmName);
    } else if (a === "--slug") slugs.push(next());
    else if (a === "--out") outDir = next();
    else if (a === "--export-only") exportOnly = true;
    else if (a === "--plates") plates = true;
    else if (a === "--seed") seed = Number.parseInt(next(), 10);
    else throw new Error(`unknown argument ${a}`);
  }
  if (modes.length === 0 && !exportOnly) throw new Error("say at least one --mode (sketch, ideas, illustrated), or --export-only");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return {
    /* Sketch before Illustrated whatever order they were named in: Illustrated
       paints the `base-a` Sketch this run may be about to draw. */
    modes: MODES.filter((m) => modes.includes(m)),
    arms: arms.length > 0 ? [...new Set(arms)] : [...DEFAULT_ARMS],
    slugs: slugs.length > 0 ? [...new Set(slugs)] : [...DEFAULT_SLUGS],
    outDir: outDir || path.join("evals", "results", `thinking-effort-${stamp}`),
    exportOnly,
    plates,
    seed,
  };
}

/* ------------------------------------------------------------ the wire -- */

/** What one Messages request carried, and how its stream ended. */
export interface WireCapture {
  url: string;
  model: string | null;
  effort: string | null;
  thinking: string | null;
  maxTokens: number | null;
  stopReason: string | null;
  thinkingTokens: number | null;
}

/**
 * Read a Messages request body and its SSE stream into a `WireCapture`.
 * Exported so a test can feed it bytes; the wrapper below only plumbs.
 */
export function readCapture(url: string, body: string | null, sse: string | null): WireCapture {
  let req: Record<string, unknown> = {};
  try {
    req = body ? (JSON.parse(body) as Record<string, unknown>) : {};
  } catch {
    req = {};
  }
  const thinking = req.thinking as { type?: string } | undefined;
  const output = req.output_config as { effort?: string } | undefined;
  let stopReason: string | null = null;
  let thinkingTokens: number | null = null;
  for (const line of (sse ?? "").split("\n")) {
    if (!line.startsWith("data:")) continue;
    let event: {
      type?: string;
      delta?: { stop_reason?: string | null };
      usage?: { output_tokens_details?: { thinking_tokens?: number } };
    };
    try {
      event = JSON.parse(line.slice(5).trim()) as typeof event;
    } catch {
      continue;
    }
    if (event.type !== "message_delta") continue;
    if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
    const t = event.usage?.output_tokens_details?.thinking_tokens;
    if (typeof t === "number") thinkingTokens = t;
  }
  return {
    url,
    model: typeof req.model === "string" ? req.model : null,
    effort: output?.effort ?? null,
    thinking: thinking?.type ?? null,
    maxTokens: typeof req.max_tokens === "number" ? req.max_tokens : null,
    stopReason,
    thinkingTokens,
  };
}

/**
 * Wrap `globalThis.fetch` so every Messages request is captured.
 *
 * The SDK resolves `fetch` when a client is constructed, and
 * `messagesClient()` constructs one per call (src/messages-stream.ts), so a
 * wrapper installed before the first call sees every one of them. The
 * response is `clone()`d and the copy read to the end in the background; the
 * SDK reads the original as it always would.
 */
function installCapture(): { take: () => Promise<WireCapture[]> } {
  const original = globalThis.fetch;
  let pending: Promise<WireCapture>[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const res = await original(input, init);
    if (!/\/v1\/messages(\?|$)/.test(url)) return res;
    const body = typeof init?.body === "string" ? init.body : null;
    const copy = res.clone();
    pending.push(
      copy.text().then(
        (sse) => readCapture(url, body, sse),
        () => readCapture(url, body, null),
      ),
    );
    return res;
  }) as typeof fetch;
  return {
    take: async () => {
      const got = await Promise.all(pending);
      pending = [];
      return got;
    },
  };
}

/* ------------------------------------------------------------ the rows -- */

export interface RunRow {
  key: string;
  mode: Mode;
  arm: ArmName;
  level: Level;
  slug: string;
  /** 1-based position of this arm in its (mode, article)'s shuffled order. */
  orderIndex: number;
  startedAt: string;
  /** What the harness set: an effort, or `null` for production's own path. */
  effortOverride: Effort | null;
  /** The `output_config.effort` the request had to carry (`null`: none at all). */
  effortExpected: Effort | null;
  /** What the Messages request actually carried. */
  effortSent: string | null;
  thinkingSent: string | null;
  /** The model as sent, and as the response named it. */
  model: string | null;
  answeredBy: string | null;
  /** Which upstream served it, from the ledger row. */
  upstream: string | null;
  blocks: number;
  chars: number;
  /** Illustrated only: the paper's figures the brief was offered, and which. */
  figuresOffered?: number;
  figuresFingerprint?: string;
  valid: boolean;
  error?: string;
  stopReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Inside `outputTokens`, never added to it. */
  thinkingTokens: number | null;
  /** The same figure, read off the raw stream — a cross-check on the ledger's. */
  thinkingTokensWire: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  /** The ledger's figure for the model call(s) — OpenRouter's settled cost. */
  costUsd: number | null;
  /** The same tokens re-priced by src/pricing.ts at list price. */
  listUsd: number | null;
  /** Illustrated only: whether plates were drawn, and their separate bill. */
  plates?: "drawn" | "off";
  platesUsd?: number | null;
  platesDrawn?: number;
  platesAttempted?: number;
  /** Generator wall clock, start to finish. */
  latencyMs: number;
  /** Model-call wall clock(s), from the ledger. */
  modelMs: number | null;
  /** Ledger rows this run wrote, model and plates together. */
  ledgerRows: number;
  /** Mode-specific shape facts: Sketch nodes and faults, Ideas count and drops, … */
  detail: Record<string, unknown>;
  files: string[];
}

function sumOrNull(xs: (number | null)[]): number | null {
  const real = xs.filter((x): x is number => x !== null);
  return real.length === 0 ? null : real.reduce((a, b) => a + b, 0);
}

/* ---------------------------------------------------------- the corpus -- */

interface Loaded {
  article: Article;
  figures: import("../../src/illustrated-figures.js").ArticleFigure[];
  figureSurvey: Pick<import("../../src/illustrated-figures.js").FigureSurvey, "stored" | "skipped">;
  blocks: number;
  chars: number;
}

/**
 * The article as the pipeline reads it: `readArticle(slug, store)` over the
 * read-only store bound to its **current published revision**. The job and
 * attempt ids on the ref are fences for writes, and this store has none.
 */
async function openArticle(slug: string): Promise<Loaded> {
  const { getDb } = await import("../../src/db/client.js");
  const { currentRevisionQuery } = await import("../../src/store/pg.js");
  const { readsPgArtifacts } = await import("../../src/store/artifacts-pg.js");
  const { readArticle } = await import("../../src/article-input.js");
  const { articles } = await import("../../src/db/schema.js");
  const { eq } = await import("drizzle-orm");
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  /* **Whose article it is, asked first**, because the corpus is not all one
     owner's on the local database (`replication-crisis` belongs to another
     account there), and every read below is owner-scoped through `ownedSlug`.
     A slug two owners both hold is ambiguous and refused unless one of them is
     this environment's owner. Read-only: nothing here writes. */
  const owners = [
    ...new Set(
      (await getDb().select({ owner: articles.ownerId }).from(articles).where(eq(articles.slug, slug))).map((r) => r.owner),
    ),
  ];
  const mine = environmentOwnerId();
  const owner = owners.length === 1 ? owners[0] : owners.find((o) => o === mine);
  if (!owner) {
    throw new Error(
      owners.length === 0
        ? `${slug}: no such article in the local database`
        : `${slug}: held by ${owners.length} owners, none of them this environment's — name a different slug`,
    );
  }
  return runAsOwner(owner as import("../../src/owner.js").OwnerId, () => openOwnedArticle(slug, {
    getDb, currentRevisionQuery, readsPgArtifacts, readArticle,
  }));
}

async function openOwnedArticle(
  slug: string,
  m: {
    getDb: typeof import("../../src/db/client.js").getDb;
    currentRevisionQuery: typeof import("../../src/store/pg.js").currentRevisionQuery;
    readsPgArtifacts: typeof import("../../src/store/artifacts-pg.js").readsPgArtifacts;
    readArticle: typeof import("../../src/article-input.js").readArticle;
  },
): Promise<Loaded> {
  const { getDb, currentRevisionQuery, readsPgArtifacts, readArticle } = m;
  const [row] = await currentRevisionQuery(getDb(), slug, "article");
  if (!row) throw new Error(`${slug}: no published revision in the local database`);
  const ref = {
    slug,
    articleId: row.article.id,
    revisionId: row.revision.id,
    jobId: "thinking-effort-eval",
    attemptId: "thinking-effort-eval",
  };
  const reads = readsPgArtifacts(ref, getDb());
  const article = await readArticle(slug, reads);

  /* **The paper's figures, once per article**, so every Illustrated arm is
     offered the identical list (GPT Sol's review, F6) — and read the
     pipeline's own way (src/pipeline.ts § illustrated.run): the assets
     manifest from the store, the bytes through `blobStore()`. Free. */
  const { loadArticleFigures, MAX_FIGURE_BYTES } = await import("../../src/illustrated-figures.js");
  const { blobStore } = await import("../../src/store/blobs.js");
  const { canonicalKey } = await import("../../src/source.js");
  const assets = await reads.read(slug, "assets", "assets");
  const blobs = blobStore();
  const survey = await loadArticleFigures(article.blocks, assets, (sha256, ext) =>
    blobs.get(canonicalKey(sha256, ext), { maxBytes: MAX_FIGURE_BYTES }),
  );
  return {
    article,
    figures: survey.figures,
    figureSurvey: { stored: survey.stored, skipped: survey.skipped },
    blocks: article.blocks.length,
    chars: article.blocks.reduce((n, b) => n + b.text.length, 0),
  };
}

/**
 * Write what was read, so the run's input is on disk beside its output and the
 * Hierarchy harness can be pointed at the same bytes: `blocks.json` in the
 * shape evals/hierarchy-structure/run.ts reads, the published `tree.json`
 * (its `incumbent-disk`), and `meta.json`.
 */
async function exportCorpus(outDir: string, loaded: Loaded): Promise<void> {
  const dir = path.join(outDir, "corpus", loaded.article.slug);
  await mkdir(dir, { recursive: true });
  const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
  await writeFile(path.join(dir, "blocks.json"), json({ blocks: loaded.article.blocks }), "utf-8");
  await writeFile(path.join(dir, "tree.json"), json(loaded.article.tree), "utf-8");
  if (loaded.article.meta) await writeFile(path.join(dir, "meta.json"), json(loaded.article.meta), "utf-8");
}

/* ------------------------------------------------------- rasterising -- */

type Rasteriser = (svg: string, pngFile: string) => Promise<string | null>;

/**
 * SVG → PNG through the box's system Chrome (docs/project/browser-testing-playwright.md).
 * `rsvg-convert` is not installed here. Returns an error string rather than
 * throwing, and the README says so loudly: a run that quietly wrote no PNG
 * looks exactly like one whose pictures were fine.
 */
async function chromeRasteriser(): Promise<{ raster: Rasteriser; close: () => Promise<void> }> {
  let browser: import("playwright-core").Browser | null = null;
  let failed: string | null = null;
  const raster: Rasteriser = async (svg, pngFile) => {
    if (failed) return failed;
    try {
      if (!browser) {
        const { chromium } = await import("playwright-core");
        browser = await chromium.launch({ headless: true, executablePath: "/usr/bin/google-chrome-stable" });
      }
      const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
      try {
        await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">${svg}</body></html>`);
        const el = await page.$("svg");
        if (!el) return "no <svg> element rendered";
        await el.screenshot({ path: pngFile });
        return null;
      } finally {
        await page.close();
      }
    } catch (err) {
      failed = `could not rasterise (${(err as Error).message.split("\n")[0]})`;
      return failed;
    }
  };
  return {
    raster,
    close: async () => {
      if (browser) await (browser as import("playwright-core").Browser).close();
    },
  };
}

/* ------------------------------------------------------------- the run -- */

function extensionOf(mediaType: string | undefined): string {
  return (mediaType ?? "image/png").split("/")[1]?.split("+")[0] ?? "bin";
}

export async function readRows(file: string): Promise<RunRow[]> {
  if (!existsSync(file)) return [];
  const text = await readFile(file, "utf-8");
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as RunRow);
}

/** The one seed this output directory's generation order comes from. */
async function orderSeed(outDir: string, asked: number | null): Promise<number> {
  const file = path.join(outDir, "order.json");
  if (existsSync(file)) {
    const { seed } = JSON.parse(await readFile(file, "utf-8")) as { seed: number };
    if (asked !== null && asked !== seed) {
      throw new Error(`${file} already records seed ${seed}; --seed ${asked} would change the order mid-run`);
    }
    return seed;
  }
  const seed = asked ?? randomInt(2 ** 31);
  await writeFile(file, `${JSON.stringify({ seed }, null, 2)}\n`, "utf-8");
  return seed;
}

/**
 * A draw that paints nothing and costs nothing, for a run without `--plates`.
 * A *returning* stub rather than a throwing one, because a thrown draw marks
 * each plate failed **inside the brief** — and the brief is the judged output.
 */
const NO_PLATES = async () => ({ image: new Uint8Array([0]), mediaType: "image/png", usdCost: 0 });

async function main(opts: Options): Promise<void> {
  if (process.env.SPIDERYARN_PIPELINE_EFFORT !== undefined) {
    throw new Error(
      `SPIDERYARN_PIPELINE_EFFORT is set (${process.env.SPIDERYARN_PIPELINE_EFFORT}) — unset it. ` +
        "`base` must be production's own path, and effortFor would silently return this instead.",
    );
  }
  const { effortFor } = await import("../../src/models.js");
  /* Today's production effort as the code resolves it, with the override unset.
     Illustrated names none: its request carries no `output_config`. */
  const production: Record<Mode, Effort | null> = {
    sketch: effortFor("sketch"),
    ideas: effortFor("ideas"),
    illustrated: null,
  };

  await mkdir(opts.outDir, { recursive: true });
  const rowsFile = path.join(opts.outDir, "runs.jsonl");
  const done = new Set((await readRows(rowsFile)).map((r) => r.key));
  const seed = await orderSeed(opts.outDir, opts.seed);

  const { closeDb } = await import("../../src/db/client.js");
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const owner = environmentOwnerId();
  const capture = opts.exportOnly ? null : installCapture();
  const rasteriser = await chromeRasteriser();

  try {
    await runAsOwner(owner, async () => {
      const corpus = new Map<string, Loaded>();
      for (const slug of opts.slugs) {
        const loaded = await openArticle(slug);
        await exportCorpus(opts.outDir, loaded);
        corpus.set(slug, loaded);
        console.log(`${slug}: ${loaded.blocks} blocks, ${loaded.chars} characters, ${loaded.figures.length} figure(s) for Illustrated`);
      }
      if (opts.exportOnly || !capture) return;

      for (const mode of opts.modes) {
        await mkdir(path.join(opts.outDir, mode), { recursive: true });
        for (const slug of opts.slugs) {
          /* Shuffled over the full arm list, then filtered, so an arm's slot
             does not depend on which subset this invocation happened to name. */
          const order = seededShuffle(ARM_NAMES, seed, `${mode}/${slug}`).filter((a) => opts.arms.includes(a));
          for (const [i, arm] of order.entries()) {
            const key = `${mode}.${arm}.${slug}`;
            if (done.has(key)) {
              console.log(`${key}: already in runs.jsonl, skipped`);
              continue;
            }
            const loaded = corpus.get(slug) as Loaded;
            const effort = armEffort(levelOf(arm), production[mode]);
            const row = await runOne({
              mode, arm, slug, effort, loaded, orderIndex: i + 1,
              outDir: opts.outDir, capture, owner, raster: rasteriser.raster, plates: opts.plates,
            });
            /* The override must be gone whatever happened inside — the next
               arm's `base` depends on it. */
            if (process.env.SPIDERYARN_PIPELINE_EFFORT !== undefined) {
              throw new Error(`${key}: SPIDERYARN_PIPELINE_EFFORT was left set — refusing to run another arm`);
            }
            await appendFile(rowsFile, `${JSON.stringify(row)}\n`, "utf-8");
            done.add(key);
            console.log(
              `${key}: ${row.valid ? "valid" : `INVALID (${row.error})`} — effort sent ${row.effortSent ?? "(none)"}, ` +
                `thinking ${row.thinkingTokens ?? "?"} / output ${row.outputTokens ?? "?"} tokens, ` +
                `$${row.costUsd?.toFixed(4) ?? "?"}, ${(row.latencyMs / 1000).toFixed(0)}s, stop ${row.stopReason}`,
            );
            /* After the row is written, so the money spent is on record. */
            if (row.effortSent !== row.effortExpected) {
              throw new Error(
                `${key}: the request had to carry effort ${row.effortExpected ?? "(none)"} and carried ` +
                  `${row.effortSent ?? "(none)"}. Stopping before another call is paid for.`,
              );
            }
          }
        }
      }
    });
  } finally {
    await rasteriser.close();
    await writeReadme(opts.outDir, await readRows(rowsFile), production, seed);
    await closeDb();
  }
}

async function runOne(a: {
  mode: Mode;
  arm: ArmName;
  slug: string;
  effort: ArmEffort;
  loaded: Loaded;
  orderIndex: number;
  outDir: string;
  capture: { take: () => Promise<WireCapture[]> };
  owner: import("../../src/owner.js").OwnerId;
  raster: Rasteriser;
  plates: boolean;
}): Promise<RunRow> {
  const { collectSpend, totalSpend } = await import("../../src/ai-spend.js");
  const { costStore } = await import("../../src/store/ai-calls.js");
  const { priceAnthropicCall } = await import("../../src/pricing.js");

  const base = path.join(a.outDir, a.mode, `${a.slug}.${a.arm}`);
  const files: string[] = [];
  const write = async (suffix: string, data: string | Uint8Array) => {
    await writeFile(`${base}${suffix}`, data);
    files.push(path.relative(a.outDir, `${base}${suffix}`));
  };
  const detail: Record<string, unknown> = {};
  let figuresOffered: number | undefined;
  let figuresFingerprint: string | undefined;
  let plates: { drawn: number; attempted: number } | undefined;

  /* Illustrated's inputs, loaded before anything is paid for. */
  let sketch: Sketch | null = null;
  let figures: readonly import("../../src/illustrated-figures.js").ArticleFigure[] = [];
  if (a.mode === "illustrated") {
    const sketchFile = path.join(a.outDir, "sketch", `${a.slug}.base-a.json`);
    if (!existsSync(sketchFile)) {
      throw new Error(
        `${sketchFile} is missing. Every Illustrated arm paints the base-a Sketch, so run ` +
          `\`--mode sketch --arm base-a --slug ${a.slug} --out ${a.outDir}\` first.`,
      );
    }
    sketch = JSON.parse(await readFile(sketchFile, "utf-8")) as Sketch;
    figures = a.loaded.figures;
    figuresOffered = figures.length;
    /* Of what the brief is shown: label, block and the bytes' own hash. */
    figuresFingerprint = createHash("sha256")
      .update(JSON.stringify(figures.map((f) => [f.label, f.block, f.sha256])))
      .digest("hex")
      .slice(0, 16);
    detail.figureLabels = figures.map((f) => `${f.label} ${f.block}`);
    detail.figuresStored = a.loaded.figureSurvey.stored;
    detail.figuresSkipped = a.loaded.figureSurvey.skipped;
  }

  const startedAt = new Date();
  const t0 = performance.now();
  let valid = true;
  let error: string | undefined;
  let calls: SpendRecord[] = [];
  const saved = process.env.SPIDERYARN_PIPELINE_EFFORT;

  try {
    const spend = await collectSpend(
      async () => {
        switch (a.mode) {
          case "sketch": {
            const { generateSketch } = await import("../../src/sketch.js");
            if (a.effort.override) process.env.SPIDERYARN_PIPELINE_EFFORT = a.effort.override;
            const r = await generateSketch({ power: "standard", article: a.loaded.article, profile: null });
            await write(".json", `${JSON.stringify(r.sketch, null, 2)}\n`);
            await write(".raw.txt", r.raw);
            const { sketchSvg } = await import("../sketch/svg.js");
            const svg = sketchSvg(r.sketch);
            await write(".svg", svg);
            const failed = await a.raster(svg, `${base}.png`);
            if (failed) detail.pngError = failed;
            else files.push(path.relative(a.outDir, `${base}.png`));
            detail.score = r.score;
            detail.faults = r.report.faults.length;
            break;
          }
          case "ideas": {
            const { generateIdeas } = await import("../../src/ideas.js");
            if (a.effort.override) process.env.SPIDERYARN_PIPELINE_EFFORT = a.effort.override;
            const r = await generateIdeas({ power: "standard", article: a.loaded.article, profile: null, previous: null });
            await write(".json", `${JSON.stringify(r.ideas, null, 2)}\n`);
            detail.ideas = r.ideas.ideas.length;
            detail.byProvenance = r.ideas.ideas.reduce<Record<string, number>>((m, i) => {
              const k = i.provenance;
              m[k] = (m[k] ?? 0) + 1;
              return m;
            }, {});
            detail.dropped = r.dropped;
            break;
          }
          case "illustrated": {
            const { generateIllustrated } = await import("../../src/illustrated.js");
            const r = await generateIllustrated({
              power: "standard",
              article: a.loaded.article,
              sketch: sketch as Sketch,
              profile: null,
              figures,
              ...(a.effort.override ? { effort: a.effort.override } : {}),
              ...(a.plates ? {} : { draw: NO_PLATES }),
            });
            await write(".brief.json", `${JSON.stringify(r.illustrated, null, 2)}\n`);
            await write(".raw.txt", r.raw);
            if (a.plates) {
              for (const [i, d] of r.draws.entries()) {
                if (!d.image) continue;
                await write(`.plate-${i}-${d.sceneId.replace(/[^a-z0-9-]+/gi, "_")}.${extensionOf(d.mediaType)}`, d.image);
              }
              plates = { drawn: r.draws.filter((d) => d.image).length, attempted: r.draws.length };
              detail.plateFailures = r.draws.filter((d) => d.failed).map((d) => `${d.sceneId}: ${d.failed}`);
            }
            detail.platesInBrief = r.illustrated.plates.length;
            detail.vignettesKept = r.report.kept;
            detail.vignettesDropped = r.report.written - r.report.kept;
            detail.briefFaults = r.report.faults.map((f) => `${f.where}: ${f.what}`);
            break;
          }
        }
      },
      {
        attribution: { scopeKind: "eval", ownerId: a.owner },
        sink: (row) => costStore.record(row),
        onDone: (report) => {
          calls = report.calls;
        },
      },
    );
    calls = spend.report.calls;
  } catch (err) {
    valid = false;
    error = (err as Error).message;
    await write(".error.txt", `${(err as Error).stack ?? error}\n`);
  } finally {
    if (saved === undefined) delete process.env.SPIDERYARN_PIPELINE_EFFORT;
    else process.env.SPIDERYARN_PIPELINE_EFFORT = saved;
  }
  const latencyMs = Math.round(performance.now() - t0);

  const wire = await a.capture.take();
  /* One Messages call per run is what each of these generators makes. More
     than one is recorded joined, never averaged into one effort. */
  const join = (xs: (string | null)[]): string | null => {
    const set = [...new Set(xs)];
    if (set.length === 0) return null;
    return set.length === 1 ? (set[0] ?? null) : set.map((x) => x ?? "(none)").join("+");
  };
  const model = calls.filter((c) => c.job === a.mode);
  const plateCalls = calls.filter((c) => c.job === "illustrate");
  const usd = (rows: SpendRecord[]): number | null => {
    if (rows.length === 0) return null;
    const { nanos, unpriced } = totalSpend(rows);
    return unpriced > 0 ? null : nanos / 1e9;
  };
  const list = sumOrNull(
    model.map((c) => {
      const priced = priceAnthropicCall(
        c.model.replace(/^anthropic\//, ""),
        {
          input_tokens: c.inputTokens ?? 0,
          output_tokens: c.outputTokens ?? 0,
          cache_read_input_tokens: c.cacheReadTokens,
          cache_creation_input_tokens: c.cacheWriteTokens,
          cache_creation: { ephemeral_5m_input_tokens: c.cacheWrite5mTokens, ephemeral_1h_input_tokens: c.cacheWrite1hTokens },
          inference_geo: c.inferenceGeo,
        },
        startedAt,
      );
      return priced ? priced.totalNanos / 1e9 : null;
    }),
  );

  return {
    key: `${a.mode}.${a.arm}.${a.slug}`,
    mode: a.mode,
    arm: a.arm,
    level: levelOf(a.arm),
    slug: a.slug,
    orderIndex: a.orderIndex,
    startedAt: startedAt.toISOString(),
    effortOverride: a.effort.override,
    effortExpected: a.effort.expectedOnWire,
    effortSent: join(wire.map((w) => w.effort)),
    thinkingSent: join(wire.map((w) => w.thinking)),
    model: wire[0]?.model ?? model[0]?.model ?? null,
    answeredBy: model[0]?.answeredBy ?? null,
    upstream: join(model.map((c) => c.upstream)),
    blocks: a.loaded.blocks,
    chars: a.loaded.chars,
    ...(figuresOffered !== undefined ? { figuresOffered } : {}),
    ...(figuresFingerprint !== undefined ? { figuresFingerprint } : {}),
    valid,
    ...(error !== undefined ? { error } : {}),
    stopReason: join(wire.map((w) => w.stopReason)),
    inputTokens: sumOrNull(model.map((c) => c.inputTokens)),
    outputTokens: sumOrNull(model.map((c) => c.outputTokens)),
    thinkingTokens: sumOrNull(model.map((c) => c.reasoningTokens)),
    thinkingTokensWire: sumOrNull(wire.map((w) => w.thinkingTokens)),
    cacheReadTokens: sumOrNull(model.map((c) => c.cacheReadTokens)),
    cacheWriteTokens: sumOrNull(model.map((c) => c.cacheWriteTokens)),
    costUsd: usd(model),
    listUsd: list,
    ...(a.mode === "illustrated"
      ? a.plates
        ? { plates: "drawn" as const, platesUsd: usd(plateCalls), platesDrawn: plates?.drawn ?? 0, platesAttempted: plates?.attempted ?? 0 }
        : { plates: "off" as const }
      : {}),
    latencyMs,
    modelMs: sumOrNull(model.map((c) => c.ms)),
    ledgerRows: calls.length,
    detail: { ...detail, messagesCalls: wire.length },
    files,
  };
}

/* ------------------------------------------------------------ README -- */

async function writeReadme(
  outDir: string,
  rows: RunRow[],
  production: Record<Mode, Effort | null>,
  seed: number,
): Promise<void> {
  const n = (v: number | null | undefined) => (v === null || v === undefined ? "?" : v.toLocaleString("en-GB"));
  const money = (v: number | null | undefined) => (v === null || v === undefined ? "?" : `$${v.toFixed(4)}`);
  const pngFailures = rows.filter((r) => r.mode === "sketch" && r.valid && r.detail.pngError);
  const corpusDir = path.join(outDir, "corpus");
  const slugs = existsSync(corpusDir) ? (await readdir(corpusDir)).sort() : [];
  const lines = [
    `# Thinking effort vs quality — ${path.basename(outDir)}`,
    "",
    "Written by `evals/thinking-effort/run.ts` (plan 261001p). One row per run; the raw rows are",
    "`runs.jsonl`, the outputs are under `<mode>/<slug>.<arm>.*`, and the exact article bytes",
    "each run read are under `corpus/<slug>/`.",
    "",
    `Production effort, read from the code at run time: sketch \`${production.sketch}\`, ideas \`${production.ideas}\`, ` +
      "illustrated *none named* (no `output_config`; the API default, `high` on Sonnet 5).",
    `Arms run in a seeded shuffle per (mode, article); seed \`${seed}\` (order.json), position in \`runs.jsonl\` § orderIndex.`,
    "`effort sent` is what the Messages request carried, read off the wire. Thinking tokens are",
    "inside output tokens. `$` is the ledger's (OpenRouter's settled cost) for the model call;",
    "`list $` re-prices the same tokens with src/pricing.ts. Illustrated plates are off unless `--plates`.",
    "",
    ...(pngFailures.length > 0
      ? [
          `**WARNING: ${pngFailures.length} Sketch PNG(s) could not be rasterised** — the .svg is there; ` +
            `first error: ${String(pngFailures[0]?.detail.pngError)}`,
          "",
        ]
      : []),
    "| mode | arm | article | effort sent | thinking | output | input | $ | list $ | latency | stop | upstream | valid | blocks | chars | extra |",
    "|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|---|---:|---:|---|",
    ...rows.map((r) => {
      const extra =
        r.mode === "sketch"
          ? `${(r.detail.score as { nodes?: number } | undefined)?.nodes ?? "?"} nodes, ${String(r.detail.faults ?? "?")} faults`
          : r.mode === "ideas"
            ? `${String(r.detail.ideas ?? "?")} ideas`
            : `${String(r.detail.platesInBrief ?? "?")} plates in brief, ${r.figuresOffered ?? 0} figures offered` +
              (r.plates === "drawn" ? `, ${r.platesDrawn ?? 0}/${r.platesAttempted ?? 0} drawn (${money(r.platesUsd)})` : "");
      return [
        `| ${r.mode}`,
        r.arm,
        r.slug,
        r.effortSent ?? "(none)",
        n(r.thinkingTokens),
        n(r.outputTokens),
        `${n(r.inputTokens)}${r.cacheReadTokens || r.cacheWriteTokens ? ` (+${n(r.cacheReadTokens)} r / ${n(r.cacheWriteTokens)} w)` : ""}`,
        money(r.costUsd),
        money(r.listUsd),
        `${(r.latencyMs / 1000).toFixed(0)}s`,
        r.stopReason ?? "?",
        r.upstream ?? "?",
        r.valid ? "yes" : `**no**: ${(r.error ?? "").slice(0, 80)}`,
        n(r.blocks),
        n(r.chars),
        `${extra} |`,
      ].join(" | ");
    }),
    "",
    `Total, model calls: ${money(sumOrNull(rows.map((r) => r.costUsd)))}; plates: ${rows.some((r) => r.plates === "drawn") ? money(sumOrNull(rows.map((r) => r.platesUsd ?? null))) : "none drawn"}.`,
    "",
    "## Hierarchy",
    "",
    "Hierarchy runs through evals/hierarchy-structure/, not here, pointed at this run's corpus:",
    "",
    "```",
    `npm run eval:hierarchy-structure -- --arm incumbent --arm incumbent-repeat --arm smart-off --arm smart-off-repeat ${slugs
      .map((s) => path.join(outDir, "corpus", s))
      .join(" ")}`,
    "```",
    "",
    "Those directories are not in its corpus manifest, so `matchesManifest` is `null` there; the",
    "block counts in the table above are the record of what it read.",
    "",
  ];
  await writeFile(path.join(outDir, "README.md"), lines.join("\n"), "utf-8");
  console.log(`Wrote ${path.join(outDir, "README.md")}`);
}

if (isMain(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  const { loadEnvLocal } = await import("../../src/env.js");
  loadEnvLocal();
  await main(opts);
}
