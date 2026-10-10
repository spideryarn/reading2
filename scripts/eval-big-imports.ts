/**
 * Do big documents import, up to the limits the upload dialog states?
 *
 * Stage 1 of docs/plans/261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md:
 * a free, offline measurement of every part of an import that needs no model.
 * "The limits" are `MAX_UPLOAD_BYTES` and `MAX_PAGES` in src/uploads.ts.
 *
 *   npx tsx scripts/eval-big-imports.ts [--only m1,m2,m3,m4,m5,fetch] [--scratch <dir>] [--out <file.json>]
 *
 * - M1  at what size does each model step refuse before calling (budgets)
 * - M2  does the Postgres store take a long document (local database only)
 * - M3  does the `blocks` step scale
 * - M4  does the PDF front half cope at the caps (one child process per case)
 * - M5  how big is the body `GET /api/article/:slug` returns
 * - fetch  what a PDF fetched by address is told at 50 MiB and at 50 MiB + 1
 *
 * **It makes no paid call and reaches no network.** `fetch` is replaced before
 * anything else runs and refuses every host but this machine, and PDF
 * extraction goes through `PdfExtractOptions.reader` with a reader that answers
 * from the PDF's own text layer. What that seam bypasses is written into the
 * results beside each number rather than left to be inferred.
 *
 * **It writes to the local database and nowhere else**: it refuses any
 * `DATABASE_URL` whose host is not this machine, prints the one it reached, and
 * deletes every article it made, on failure too.
 *
 * Results: evals/results/big-imports-2026-10-04/results.json. `--only` replaces
 * just the sections it ran and keeps the rest of the file — so a re-run after a
 * fix overwrites the measurement that showed the fault. `--out <name>.json`
 * writes this run's sections to that file in the same directory instead and
 * leaves results.json alone (results-after-batching.json is M2 and M5 again,
 * once `writeBlocks` batched its inserts).
 */
import { spawnSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { eq, like, sql } from "drizzle-orm";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import { isBodyEvidence } from "../src/block-policy.js";
import { blocksArtefact, runBlocks } from "../src/blocks.js";
import { answerTokens as crossrefsAnswerTokens, linkCap } from "../src/crossrefs.js";
import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, blockIdentities, jobs, revisionBlocks } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { DEFAULTS as FETCH_DEFAULTS, fetchDocument } from "../src/fetch.js";
import { buildHeadingTree } from "../src/heading-tree.js";
import { mintId } from "../src/ids.js";
import { readerFailureOf } from "../src/job-failure.js";
import { collectPdfFigures } from "../src/collect-pdf-figures.js";
import { type CompletedLabelsFile, oversizedSets, planBatches } from "../src/labels.js";
import { PDF_READER_MODEL } from "../src/models.js";
import { type OwnerId, runAsOwner } from "../src/owner.js";
import { type PdfRecord, countPdfPages, pass0, refuseTooManyPages } from "../src/pdf.js";
import {
  CHUNK_CONCURRENCY,
  maxEncodedBytesFor,
  openPdfCuts,
  openRouterReader,
  planChunks,
  runPdfExtract,
} from "../src/pdf-read.js";
import {
  answerTokens as relationsAnswerTokens,
  eligibleParagraphs,
} from "../src/relations.js";
import { hashBlocks, structureHash } from "../src/source-hash.js";
import { pgArtifactsIn } from "../src/store/artifacts-pg.js";
import type { BlobHead, PutResult, RawSourceStore } from "../src/store/blobs.js";
import { loadArticle } from "../src/store/index.js";
import { mintAttempt } from "../src/store/jobs.js";
import { openOrBeginJobDraft, publishRevision } from "../src/store/pg-revisions.js";
import { estimateStructureTokens, STRUCTURE_HEADROOM, wholeDocumentRequest } from "../src/structure.js";
import { splitBlocks } from "../src/supplement.js";
import { MODEL_MAX_TOKENS, THINKING_HEADROOM, budgetFor } from "../src/token-budget.js";
import type { Block, JobStep } from "../src/types.js";
import { MAX_PAGES, MAX_UPLOAD_BYTES, uploadLimits, uploadProblem } from "../src/uploads.js";
import { memoryCheckpoints } from "../tests/helpers/memory-checkpoints.js";
import {
  DENSITIES,
  plainBlocks,
  rng,
  sentence,
  words,
} from "../tests/helpers/synthetic-blocks.js";

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), "..");
const OUT_DIR = path.join(ROOT, "evals", "results", "big-imports-2026-10-04");
const DEFAULT_OUT_FILE = path.join(OUT_DIR, "results.json");

/** Vercel's limit on a function's response body. Theirs, not a constant of ours: nothing in src/ names it. */
const VERCEL_RESPONSE_LIMIT_BYTES = 4.5 * 1024 * 1024;

// ───────────────────────────────────────────────────────── no network

const realFetch = globalThis.fetch;
const refusedHosts: string[] = [];
/** Every request but one to this machine is refused, so no model provider can be reached from here. */
function forbidTheNetwork(): void {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const host = new URL(url).hostname;
    if (host === "127.0.0.1" || host === "localhost" || host === "::1") return realFetch(input, init);
    refusedHosts.push(host);
    throw new Error(`eval-big-imports: refused a network call to ${host} — this harness is offline by rule`);
  }) as typeof fetch;
}

// ───────────────────────────────────────────────────────── arguments

function argValue(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}
/** A bare file name, so a run cannot be pointed out of the results directory. */
const OUT_FILE = path.join(OUT_DIR, path.basename(argValue("--out") ?? DEFAULT_OUT_FILE));
const SCRATCH = path.resolve(argValue("--scratch") ?? path.join(tmpdir(), "spya-eval-big-imports"));
const invokedAs = `npx tsx scripts/eval-big-imports.ts ${process.argv.slice(2).join(" ")}`.trim();

// ───────────────────────────────────────────────────────── synthetic documents

/* The seeded generator and the plain documents are tests/helpers/synthetic-blocks.ts,
   shared with tests/stated-limits.test.ts. */

/** The mixed article M3 uses: headings at two levels, paragraphs, quotes, figures, note-ish lists. */
function richHtml(n: number, seed = 11): string {
  const rand = rng(seed);
  const parts: string[] = ["<article>"];
  for (let i = 0; i < n; i++) {
    if (i % 12 === 0) parts.push(`<h${i % 36 === 0 ? 2 : 3}>${sentence(rand, 5).slice(0, -1)} ${i}</h${i % 36 === 0 ? 2 : 3}>`);
    else if (i % 15 === 7) parts.push(`<blockquote><p>${sentence(rand, 40)}</p></blockquote>`);
    else if (i % 25 === 9)
      parts.push(
        `<figure><img src="https://example.test/figure-${i}.png" alt="${words(rand, 4)}">` +
          `<figcaption>Figure ${i}. ${sentence(rand, 14)}</figcaption></figure>`,
      );
    else if (i % 40 === 21)
      parts.push(`<ol><li>${sentence(rand, 18)}</li><li>${sentence(rand, 18)}</li><li>${sentence(rand, 18)}</li></ol>`);
    else
      parts.push(
        `<p>${sentence(rand, 30)} <a href="https://example.test/ref-${i}">${words(rand, 3)}</a> ` +
          `${sentence(rand, 30)} <em>${words(rand, 2)}</em> ${sentence(rand, 26)}</p>`,
      );
  }
  parts.push("</article>");
  return parts.join("\n");
}

// ───────────────────────────────────────────────────────── helpers

const ms = (from: number): number => Math.round(performance.now() - from);
const mb = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 100) / 100;

interface Failure {
  name: string;
  message: string;
  readerMessage: string;
  readerKind: string;
  causes: string[];
}

function failureOf(err: unknown, step: string): Failure {
  const causes: string[] = [];
  let cause: unknown = (err as { cause?: unknown } | null)?.cause;
  for (let depth = 0; cause && depth < 5; depth++) {
    const c = cause as { name?: string; message?: string; code?: string; cause?: unknown };
    causes.push(`${c.name ?? "Error"}${c.code ? ` [${c.code}]` : ""}: ${String(c.message ?? cause).slice(0, 400)}`);
    cause = c.cause;
  }
  const reader = readerFailureOf(err, step);
  const e = err as { name?: string; message?: string };
  return {
    name: e?.name ?? "Error",
    /* Capped: a failed multi-row insert's message is the whole statement, megabytes of it. */
    message: String(e?.message ?? err).slice(0, 600),
    readerMessage: reader.message,
    readerKind: reader.kind,
    causes,
  };
}

function table(rows: (string | number)[][]): string {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, String(cell).length)));
  return rows
    .map((row) =>
      row
        .map((cell, i) => (typeof cell === "number" ? String(cell).padStart(widths[i] ?? 0) : String(cell).padEnd(widths[i] ?? 0)))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

/** First `n` in `(lo, hi]` for which `fails(n)`, given `!fails(lo)` and `fails(hi)`. */
async function bisect(lo: number, hi: number, fails: (n: number) => Promise<boolean> | boolean): Promise<number> {
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (await fails(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

// ───────────────────────────────────────────────────────── M1: budgets

type Verdict =
  | { accepts: true; maxTokens: number }
  | { accepts: false; error: string; readerMessage: string };

function verdict(step: string, fn: () => number): Verdict {
  try {
    return { accepts: true, maxTokens: fn() };
  } catch (err) {
    const f = failureOf(err, step);
    return { accepts: false, error: `${f.name}: ${f.message}`, readerMessage: f.readerMessage };
  }
}

function structureVerdict(blocks: Block[]) {
  const { body } = splitBlocks(blocks);
  const answerEstimate = estimateStructureTokens(body);
  let inputChars: number | null = null;
  const v = verdict("structure", () => {
    const request = wholeDocumentRequest(body);
    inputChars = request.system.length + request.user.length;
    return request.maxTokens;
  });
  return { ...v, answerEstimate, inputChars, estimatedInputTokens: inputChars === null ? null : Math.ceil(inputChars / 4) };
}

/** `generateRelations`' own two lines (src/relations.ts), composed here because it makes the call straight after. */
const relationsVerdict = (blocks: Block[]) => {
  const paragraphs = eligibleParagraphs(blocks).length;
  return { paragraphs, ...verdict("relations", () => budgetFor("relations", relationsAnswerTokens(paragraphs))) };
};

/** `generateCrossrefs`' own three lines (src/crossrefs.ts), composed here for the same reason. */
const crossrefsVerdict = (blocks: Block[]) => {
  const cap = linkCap(blocks.filter(isBodyEvidence).length);
  return { cap, ...verdict("crossrefs", () => budgetFor("crossrefs", crossrefsAnswerTokens(cap))) };
};

/**
 * Labels: how the batches would be cut, and nothing about their budget.
 *
 * `planBatches` is the real function, over `buildHeadingTree`'s tree (no
 * model), which is NOT the tree the structure step would have built. The
 * per-batch `max_tokens` is computed privately inside `runBatch`
 * (src/labels.ts), straight before the paid call, so it is not measured here:
 * copying its formula would share the assumption under test.
 */
function labelsPlan(blocks: Block[]) {
  const tree = buildHeadingTree(blocks, "eval-big-imports-synthetic").tree;
  const batches = planBatches(tree, blocks);
  return {
    batches: batches.length,
    largestBatch: batches.reduce((most, b) => Math.max(most, b.blocks.length), 0),
    blocksInBatches: batches.reduce((sum, b) => sum + b.blocks.length, 0),
    oversizedSiblingSets: oversizedSets(batches).length,
    budget: "not measurable without a src change: extract the answer estimate and budgetFor call out of runBatch (src/labels.ts)",
  };
}

const BUDGET_CALLERS = [
  { file: "src/structure.ts", exercised: "yes: wholeDocumentRequest, the real request builder" },
  { file: "src/relations.ts", exercised: "partly: eligibleParagraphs and answerTokens are the real exported functions, but the line that hands them to budgetFor is inside generateRelations and is re-typed here (no formula copied, one composition is). A pure relationsRequest(blocks) would close it" },
  { file: "src/crossrefs.ts", exercised: "partly, as relations: linkCap and answerTokens are real, the composition is re-typed; capped by MAX_LINKS so it cannot refuse on length" },
  { file: "src/labels.ts", exercised: "no: the budget is two lines inside runBatch, straight before the call. Needs a pure export (say labelBatchBudget(count, headroom)) that runBatch also calls. planBatches was run for the batch count only" },
  { file: "src/structure-expand.ts", exercised: "no: needs a real tree's section targets (expectedChildren); off by default behind SPIDERYARN_DEEPEN_STRUCTURE as far as the plan says" },
  { file: "src/arc.ts", exercised: "no: 300 + parts × 80 is inline in generateArc, and parts come off a model-built tree" },
  { file: "src/tweets.ts", exercised: "no: inline in the generator; the answer is capped by suggestedLength" },
  { file: "src/glossary.ts", exercised: "no: 600 + count × 340 is inline in the generator" },
  { file: "src/ideas.ts", exercised: "no: 400 + count × 420 is inline in the generator" },
  { file: "src/quotes.ts", exercised: "no: answerTokensFor(count) is exported but count is settled inside the generator" },
  { file: "src/bibliography.ts", exercised: "no: answerEstimate() is a closure inside the generator" },
  { file: "src/faq.ts", exercised: "no: a constant answer (ANSWER_TOKENS), so it cannot refuse on length" },
  { file: "src/skim.ts", exercised: "no: a constant answer" },
  { file: "src/simple-summary.ts", exercised: "no: a constant answer" },
  { file: "src/timeline.ts", exercised: "no: a constant answer" },
  { file: "src/sketch.ts", exercised: "no: a constant answer (12,000)" },
  { file: "src/illustrated.ts", exercised: "no: a constant answer (32,000)" },
  { file: "src/quiz.ts", exercised: "no: a module constant, QUIZ_MAX_TOKENS" },
  { file: "src/referee-claims-run.ts", exercised: "no: a module constant" },
  { file: "src/referee-criteria-run.ts", exercised: "no: two module constants" },
] as const;

async function m1() {
  const pagesGrid = [100, 142, 180, 200, 250];
  const grid: Record<string, unknown>[] = [];
  const thresholds: Record<string, unknown>[] = [];

  for (const density of DENSITIES) {
    /* One long stream per density, long enough that the structure request
       refuses its whole length; every cell and every bisection step is a prefix. */
    let length = Math.round(250 * density.blocksPerPage);
    let stream = plainBlocks(length, density).blocks;
    while (structureVerdict(stream).accepts) {
      if (length > 40_000) throw new Error(`${density.name}: still accepted at ${length} blocks`);
      length *= 2;
      stream = plainBlocks(length, density).blocks;
    }
    const headingsIn = (n: number) => stream.slice(0, n).filter((b) => b.kind === "heading").length;

    for (const pages of pagesGrid) {
      const n = Math.round(pages * density.blocksPerPage);
      const blocks = stream.slice(0, n);
      const structure = structureVerdict(blocks);
      grid.push({
        density: density.name,
        pages,
        blocks: n,
        headings: headingsIn(n),
        structure,
        relations: relationsVerdict(blocks),
        crossrefs: crossrefsVerdict(blocks),
        labels: labelsPlan(blocks),
      });
    }

    const firstRefused = await bisect(1, stream.length, (n) => !structureVerdict(stream.slice(0, n)).accepts);
    const at = structureVerdict(stream.slice(0, firstRefused));
    const before = structureVerdict(stream.slice(0, firstRefused - 1));
    const relationsFirst = relationsVerdict(stream).accepts
      ? null
      : await bisect(1, stream.length, (n) => !relationsVerdict(stream.slice(0, n)).accepts);
    thresholds.push({
      density: density.name,
      structureFirstRefusedAtBlocks: firstRefused,
      headingsAtThatPoint: headingsIn(firstRefused),
      pagesAtThatPoint: Math.round((firstRefused / density.blocksPerPage) * 10) / 10,
      lastAccepted: { blocks: firstRefused - 1, ...before },
      firstRefused: at,
      relationsFirstRefusedAtBlocks: relationsFirst,
      relationsPagesAtThatPoint:
        relationsFirst === null ? null : Math.round((relationsFirst / density.blocksPerPage) * 10) / 10,
      streamLengthSearched: stream.length,
    });
  }

  /* The instrument, shown reporting an accept: a ten-block document. Every
     threshold above is the same instrument reporting a refusal. */
  const tiny = structureVerdict(plainBlocks(10, DENSITIES[0]!).blocks);

  return {
    question: "At what size does each model step refuse before calling?",
    command: invokedAs,
    constants: { MODEL_MAX_TOKENS, STRUCTURE_HEADROOM, THINKING_HEADROOM, MAX_PAGES },
    densities: DENSITIES,
    contextWindow:
      "No constant for the structure model's context window exists in src/. Input tokens below are " +
      "characters / 4 of system + user, an estimate. The one real figure: Kuhn's whole-document call " +
      "reported 365,930 input tokens at 2,025 blocks (src/structure.ts § STRUCTURE_HEADROOM), about 181 a block.",
    budgetCallers: BUDGET_CALLERS,
    grid,
    thresholds,
    instrumentCheck: { tenBlockDocument: tiny },
    cannotDetect:
      "Whether a request the budget ACCEPTS fits the model's context window or finishes inside its " +
      "max_tokens: the budget functions and this measurement share the same estimate of the answer, " +
      "and no model is called. The labels columns are a batch count over a heading tree, not the tree the " +
      "model would build, and say nothing about the labels budget. Relations and crossrefs re-type one line of composition.",
  };
}

function printM1(r: Awaited<ReturnType<typeof m1>>): void {
  console.log("\nM1 — budgets (structure = wholeDocumentRequest; ✗ = refused before the call)");
  const rows: (string | number)[][] = [
    ["density", "pages", "blocks", "headings", "structure", "max_tokens", "~input tok", "relations", "labels batches", "largest"],
  ];
  for (const cell of r.grid) {
    const s = cell.structure as ReturnType<typeof structureVerdict>;
    const rel = cell.relations as ReturnType<typeof relationsVerdict>;
    const lab = cell.labels as ReturnType<typeof labelsPlan>;
    rows.push([
      String(cell.density),
      Number(cell.pages),
      Number(cell.blocks),
      Number(cell.headings),
      s.accepts ? "accepts" : "✗ REFUSES",
      s.accepts ? s.maxTokens : `answer≈${s.answerEstimate}`,
      s.estimatedInputTokens ?? "-",
      rel.accepts ? `ok ${rel.maxTokens}` : "✗ REFUSES",
      lab.batches,
      lab.largestBatch,
    ]);
  }
  console.log(table(rows));
  console.log("\nM1 — where the structure request starts refusing (bisection over the real function)");
  const t: (string | number)[][] = [["density", "first refused at blocks", "headings", "≈pages", "relations first refused at blocks", "≈pages"]];
  for (const row of r.thresholds) {
    t.push([
      String(row.density),
      Number(row.structureFirstRefusedAtBlocks),
      Number(row.headingsAtThatPoint),
      Number(row.pagesAtThatPoint),
      row.relationsFirstRefusedAtBlocks === null ? "not within the stream" : Number(row.relationsFirstRefusedAtBlocks),
      row.relationsPagesAtThatPoint === null ? "-" : Number(row.relationsPagesAtThatPoint),
    ]);
  }
  console.log(table(t));
  const refusal = r.thresholds.map((row) => row.firstRefused as ReturnType<typeof structureVerdict>).find((v) => !v.accepts);
  if (refusal && !refusal.accepts) console.log(`\nThe reader sees: ${refusal.readerMessage}`);
}

// ───────────────────────────────────────────────────────── M2 + M5: the store, and the response

const OWNER = ADMIN_USER_ID_LOCAL as OwnerId;
const SLUG_PREFIX = "eval-big-imports-";
/** What stands where a labels run's version and model would: it names itself as nobody's. */
const LABELS_STAND_IN = { version: "eval-big-imports/no-labels", generator: "eval-big-imports/no-model" } as const;
const FIXTURE_STEPS: JobStep[] = [{ name: "blocks", label: "Reading the page", status: "pending" }];

interface Made {
  slug: string;
  jobId: string;
  articleId: string | null;
}
const made: Made[] = [];

/** Which database, proven before anything is written: the URL's host, then the server's own answer. */
async function proveTheDatabaseIsLocal(): Promise<Record<string, unknown>> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("No DATABASE_URL. Link .env.local, then: npm run db:start");
  const parsed = new URL(url);
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error(`DATABASE_URL points at ${parsed.hostname}, which is not this machine. Refusing to write.`);
  }
  const answer = await getDb().execute(
    sql`select current_database() as database, inet_server_addr()::text as addr, inet_server_port() as port`,
  );
  const row = (answer as unknown as { rows: Record<string, unknown>[] }).rows[0] ?? {};
  const target = { host: parsed.hostname, urlPort: parsed.port, ...row };
  console.log(`Target: ${JSON.stringify(target)} (local Supabase; nothing remote is reachable from this script)`);
  return target;
}

async function removeArticle(m: Made): Promise<void> {
  const db = getDb();
  await db.delete(jobs).where(eq(jobs.id, m.jobId));
  /* By slug too: a job this harness did not start but caused. */
  await db.delete(jobs).where(eq(jobs.slug, m.slug));
  const [article] = await db.select({ id: articles.id }).from(articles).where(eq(articles.slug, m.slug)).limit(1);
  const id = m.articleId ?? article?.id;
  if (!id) return;
  await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
  await db.delete(articleRevisions).where(eq(articleRevisions.articleId, id));
  await db.delete(articles).where(eq(articles.id, id));
}

async function removeEverything(): Promise<Record<string, number>> {
  for (const m of made.splice(0)) {
    try {
      await removeArticle(m);
    } catch (err) {
      console.error(`could not remove ${m.slug}: ${(err as Error).message}`);
    }
  }
  const db = getDb();
  const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? -1;
  const left = {
    articles: await count(
      db.select({ n: sql<number>`count(*)::int` }).from(articles).where(like(articles.slug, `${SLUG_PREFIX}%`)),
    ),
    jobs: await count(db.select({ n: sql<number>`count(*)::int` }).from(jobs).where(like(jobs.slug, `${SLUG_PREFIX}%`))),
  };
  return left;
}

interface StoreRun {
  blocks: number;
  slug: string;
  wrote: boolean;
  writeBlocksMs: number | null;
  writeStructureMs: number | null;
  publishMs: number | null;
  /** Did publishing queue a follow-on job (which a worker could claim and pay for)? Must be false. */
  successorQueued: boolean | null;
  loadMs: number | null;
  loadedBlocks: number | null;
  orderPreserved: boolean | null;
  responseBytes: number | null;
  responseGzipBytes: number | null;
  error: (Failure & { during: string }) | null;
}

/** One article of `n` blocks: write as the `blocks` step, then as `structure`, publish, load. */
async function storeOne(n: number, opts: { blocksOnly?: boolean } = {}): Promise<StoreRun> {
  const density = DENSITIES[0]!;
  const { blocks, html } = plainBlocks(n, density);
  const slug = `${SLUG_PREFIX}${n}-${mintId().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8)}`;
  const tree = buildHeadingTree(blocks, slug).tree;
  const out: StoreRun = {
    blocks: n,
    slug,
    wrote: false,
    writeBlocksMs: null,
    writeStructureMs: null,
    publishMs: null,
    successorQueued: null,
    loadMs: null,
    loadedBlocks: null,
    orderPreserved: null,
    responseBytes: null,
    responseGzipBytes: null,
    error: null,
  };

  const job = { id: mintId(), attemptId: mintAttempt() };
  const record: Made = { slug, jobId: job.id, articleId: null };
  made.push(record);
  let during = "starting the job";
  try {
    await runAsOwner(OWNER, async () => {
      const db = getDb();
      await db.insert(jobs).values({
        id: job.id,
        ownerId: OWNER,
        slug,
        steps: FIXTURE_STEPS,
        status: "running",
        attemptId: job.attemptId,
        leaseExpiresAt: new Date(Date.now() + 600_000),
        workKey: `eval-big-imports-${job.id}`,
      });
      during = "opening the draft";
      const draft = await openOrBeginJobDraft({ slug, job });
      record.articleId = draft.articleId;
      const ref = { slug, articleId: draft.articleId, revisionId: draft.revisionId, jobId: job.id, attemptId: job.attemptId };

      during = "the blocks step's write (writeArtefacts → writeBlocks)";
      let t = performance.now();
      await db.transaction(async (tx) => {
        const store = pgArtifactsIn(ref, tx);
        const attempt = await store.beginStep(slug, "blocks");
        await store.write(slug, "blocks", { blocks: blocksArtefact(blocks), stampedHtml: html }, {});
        await store.finishStep(slug, "blocks", attempt);
      });
      out.writeBlocksMs = ms(t);
      out.wrote = true;
      if (opts.blocksOnly) return;

      during = "the structure step's write (blocks again, tree, labels manifest)";
      const sourceHash = hashBlocks(blocks);
      /* **A completed manifest with no labels in it, on purpose.** The honest
         shape for "no run produced these" is a `PendingLabelsFile`, and
         publishing a revision that carries one queues a `labels` job
         (`enqueueSuccessorIn`, src/store/pg-revisions.ts) which any worker on
         this shared database may claim and PAY for. The first run of this
         harness did exactly that: four jobs queued, two claimed by somebody's
         dev server before the articles were deleted (both failed before a
         call; the ledger was checked). A completed manifest publishes as
         `ready`, and nothing is queued. `successorQueued` below is the check. */
      const labels: CompletedLabelsFile = {
        slug,
        sourceHash,
        structureHash: structureHash(tree),
        structureVersion: tree.version,
        labels: {},
        batches: [],
        version: LABELS_STAND_IN.version,
        generator: LABELS_STAND_IN.generator,
      };
      t = performance.now();
      await db.transaction(async (tx) => {
        const store = pgArtifactsIn(ref, tx);
        const attempt = await store.beginStep(slug, "structure");
        await store.write(
          slug,
          "structure",
          { blocks: blocksArtefact(blocks), tree, labels },
          { inputHash: sourceHash, promptVersion: LABELS_STAND_IN.version, model: LABELS_STAND_IN.generator },
        );
        await store.finishStep(slug, "structure", attempt);
      });
      out.writeStructureMs = ms(t);

      during = "publishing";
      t = performance.now();
      const published = await publishRevision({ slug, revisionId: draft.revisionId, job });
      out.publishMs = ms(t);
      out.successorQueued = published.successor !== null || published.regenerated.length > 0;
      if (out.successorQueued) {
        /* Never leave work for a paid worker: take it back before anything else. */
        await db.delete(jobs).where(eq(jobs.slug, slug));
      }

      during = "loadArticle (what GET /api/article/:slug sends)";
      t = performance.now();
      const article = await loadArticle(slug);
      out.loadMs = ms(t);
      out.loadedBlocks = article.blocks.length;
      out.orderPreserved = article.blocks.length === blocks.length && article.blocks.every((b, i) => b.id === blocks[i]?.id);
      /* Exactly what `send` in src/routes.ts does with it. */
      const body = JSON.stringify(article);
      out.responseBytes = Buffer.byteLength(body);
      out.responseGzipBytes = gzipSync(body).length;
    });
  } catch (err) {
    out.error = { during, ...failureOf(err, "blocks") };
  } finally {
    await removeArticle(record).catch((err: unknown) => console.error(`cleanup of ${slug}: ${(err as Error).message}`));
    const at = made.indexOf(record);
    if (at >= 0) made.splice(at, 1);
  }
  return out;
}

async function m2m5() {
  const target = await proveTheDatabaseIsLocal();
  const sizes = [1000, 2000, 3000, 3800, 3900, 4000, 6000];
  const runs: StoreRun[] = [];
  let boundary: Record<string, unknown> | null = null;
  let leftBehind: Record<string, number> = {};
  let parametersPerBlockRow = 0;
  let parametersPerIdentityRow = 0;
  try {
    /* Counted off the statement Drizzle builds for one row, not assumed. */
    const one = plainBlocks(1, DENSITIES[0]!).blocks[0]!;
    const nil = "00000000-0000-4000-8000-000000000000";
    parametersPerBlockRow = getDb()
      .insert(revisionBlocks)
      .values({
        articleId: nil,
        revisionId: nil,
        blockId: one.id,
        ordinal: 0,
        tag: one.tag,
        kind: one.kind,
        level: one.level ?? null,
        text: one.text,
        words: one.words,
        html: one.html,
        gistable: one.gistable,
        note: null,
        role: null,
        treatment: null,
        noteId: null,
        contextId: null,
        contextType: null,
      })
      .toSQL().params.length;
    parametersPerIdentityRow = getDb().insert(blockIdentities).values({ articleId: nil, blockId: one.id }).toSQL().params.length;

    for (const n of sizes) {
      const run = await storeOne(n);
      runs.push(run);
      console.log(
        `  M2 ${n} blocks: ${run.error ? `FAILED during ${run.error.during}` : `ok, write ${run.writeBlocksMs} ms, load ${run.loadMs} ms`}`,
      );
    }

    const lastOk = runs.filter((r) => r.wrote).map((r) => r.blocks).sort((a, b) => b - a)[0];
    const firstBad = runs.filter((r) => !r.wrote).map((r) => r.blocks).sort((a, b) => a - b)[0];
    if (lastOk !== undefined && firstBad !== undefined && lastOk < firstBad) {
      const first = await bisect(lastOk, firstBad, async (n) => !(await storeOne(n, { blocksOnly: true })).wrote);
      const at = await storeOne(first, { blocksOnly: true });
      const under = await storeOne(first - 1, { blocksOnly: true });
      boundary = {
        firstFailingBlocks: first,
        parametersAtFirstFailure: first * parametersPerBlockRow,
        lastPassingBlocks: first - 1,
        parametersAtLastPass: (first - 1) * parametersPerBlockRow,
        lastPassWrote: under.wrote,
        error: at.error,
      };
    }
  } finally {
    leftBehind = await removeEverything();
    console.log(`  cleanup: rows left under ${SLUG_PREFIX}*: ${JSON.stringify(leftBehind)}`);
  }

  const smallest = runs.find((r) => r.responseBytes !== null);
  return {
    m2: {
      question: "Does the store take a long document?",
      command: invokedAs,
      target,
      parametersPerBlockRow,
      parametersPerIdentityRow,
      postgresParameterLimit: 65_535,
      runs: runs.map(({ responseBytes: _a, responseGzipBytes: _b, ...rest }) => rest),
      boundary,
      otherWrites:
        "Read, not run: the only multi-row inserts on the import path are the two in writeBlocks " +
        "(block_identities, 2 parameters a row; revision_blocks), batched since 2026-10-04 " +
        "(src/db/insert-batches.ts). The tree, labels, assets and arc are " +
        "one jsonb column each (src/store/artifact-storage.ts), and a checkpoint is one row per write. " +
        "The structure step's write was exercised here (it calls writeBlocks again, plus the tree and a " +
        "pending labels manifest). Unbatched, block_identities alone would have passed 65,535 at 32,768 " +
        "blocks; never run, because revision_blocks failed long before.",
      leftBehind,
      instrumentCheck:
        (boundary
          ? "The instrument is seen both passing and failing in this same run (see runs and boundary); a load "
          : "No size failed in this run, so it shows the instrument passing only; it is seen failing at 3,856 " +
            "blocks in results.json, the run made before writeBlocks batched its inserts. A load ") +
"is counted only when every block id comes back in the order written. successorQueued is false on " +
        "every published run: publishing queued no job a worker could have paid for.",
      cannotDetect:
        "Anything about production's Postgres that differs from the local one (statement timeouts, the " +
        "pooler in front of it, row-size limits under real load), and any write a model step makes that " +
        "this did not call. Blocks here are ~90-word paragraphs; a block with a very large html is not tried.",
    },
    m5: {
      question: "Does the reader get the article back?",
      command: invokedAs,
      limitBytes: VERCEL_RESPONSE_LIMIT_BYTES,
      lifecycle:
        "jobs row → openOrBeginJobDraft → pgArtifactsIn(ref, tx).beginStep/write/finishStep for `blocks` then " +
        "`structure` → publishRevision → loadArticle (src/store/index.ts, what the route calls) → JSON.stringify, " +
        "which is all send() in src/routes.ts does.",
      rows: runs
        .filter((r) => r.responseBytes !== null)
        .map((r) => ({
          blocks: r.blocks,
          responseBytes: r.responseBytes,
          responseMb: mb(r.responseBytes ?? 0),
          gzipBytes: r.responseGzipBytes,
          overLimit: (r.responseBytes ?? 0) > VERCEL_RESPONSE_LIMIT_BYTES,
        })),
      noRowFor: runs.filter((r) => r.responseBytes === null).map((r) => r.blocks),
      missing:
        "These articles have a heading tree with no gists, questions or nav labels, no arc, no assets and " +
        "almost no meta, so a real article of the same block count is larger. Blocks are plain ~90-word " +
        "paragraphs: no links, maths, tables or figures in their html. send() in src/routes.ts does not " +
        "compress; whether Vercel counts the body before or after its own compression was not checked.",
      instrumentCheck: smallest
        ? {
            note: "the same comparison against a 100 KB limit, to show it can say 'over'",
            blocks: smallest.blocks,
            overA100KbLimit: (smallest.responseBytes ?? 0) > 100 * 1024,
          }
        : "no article loaded, so the comparison was never seen passing",
      cannotDetect:
        "What Vercel actually does with a body over its limit, and the size of a real article: this measures " +
        "bytes of a synthetic one on this machine.",
    },
  };
}

function printM2M5(r: Awaited<ReturnType<typeof m2m5>>, raw: boolean): void {
  if (raw) {
    console.log(`\nM2 — the store (${r.m2.parametersPerBlockRow} parameters a block row, limit 65,535)`);
    const rows: (string | number)[][] = [["blocks", "blocks write ms", "structure write ms", "publish ms", "load ms", "loaded", "in order", "result"]];
    for (const run of r.m2.runs) {
      rows.push([
        run.blocks,
        run.writeBlocksMs ?? "-",
        run.writeStructureMs ?? "-",
        run.publishMs ?? "-",
        run.loadMs ?? "-",
        run.loadedBlocks ?? "-",
        run.orderPreserved === null ? "-" : String(run.orderPreserved),
        run.error ? `✗ ${run.error.during}: ${run.error.causes[0] ?? run.error.message.slice(0, 120)}` : "ok",
      ]);
    }
    console.log(table(rows));
    if (r.m2.boundary) console.log(`boundary: ${JSON.stringify({ ...r.m2.boundary, error: undefined })}`);
    const bad = r.m2.runs.find((run) => run.error);
    if (bad?.error) console.log(`The reader sees (${bad.error.readerKind}): ${bad.error.readerMessage}`);
  }
  console.log("\nM5 — the article response against Vercel's 4.5 MB");
  const rows: (string | number)[][] = [["blocks", "response MB", "gzip MB", "over 4.5 MB"]];
  for (const row of r.m5.rows) {
    rows.push([row.blocks, row.responseMb, row.gzipBytes === null ? "-" : mb(row.gzipBytes), String(row.overLimit)]);
  }
  console.log(table(rows));
  console.log(`no row (the store refused the write, so there was nothing to load): ${r.m5.noRowFor.join(", ") || "none"}`);
}

// ───────────────────────────────────────────────────────── M3: the blocks step

function m3() {
  runBlocks({ slug: "eval-big-imports-warmup", extractedHtml: richHtml(200), previous: undefined });
  const rows: Record<string, unknown>[] = [];
  for (const n of [500, 1000, 2000, 4000, 6000]) {
    const html = richHtml(n);
    let t = performance.now();
    const fresh = runBlocks({ slug: "eval-big-imports-m3", extractedHtml: html, previous: undefined });
    const freshMs = ms(t);
    /* The second run is a re-import: every id has to be found again in `previous`. */
    t = performance.now();
    const again = runBlocks({ slug: "eval-big-imports-m3", extractedHtml: html, previous: fresh.blocks });
    const againMs = ms(t);
    const kinds: Record<string, number> = {};
    for (const b of fresh.blocks) kinds[b.kind] = (kinds[b.kind] ?? 0) + 1;
    rows.push({
      elements: n,
      blocks: fresh.blocks.length,
      htmlBytes: Buffer.byteLength(html),
      freshMs,
      freshMsPerBlock: Math.round((freshMs / fresh.blocks.length) * 1000) / 1000,
      rerunMs: againMs,
      rerunMsPerBlock: Math.round((againMs / again.blocks.length) * 1000) / 1000,
      rerunStats: again.stats,
      idsCarried: again.blocks.every((b, i) => b.id === fresh.blocks[i]?.id),
      kinds,
    });
  }
  const per = (row: Record<string, unknown> | undefined, key: string) => Number(row?.[key] ?? 0);
  const growth = {
    freshPerBlockAt6000OverAt1000: Math.round((per(rows[4], "freshMsPerBlock") / per(rows[1], "freshMsPerBlock")) * 100) / 100,
    rerunPerBlockAt6000OverAt1000: Math.round((per(rows[4], "rerunMsPerBlock") / per(rows[1], "rerunMsPerBlock")) * 100) / 100,
  };
  let emptyRefusal: Failure | null = null;
  try {
    runBlocks({ slug: "eval-big-imports-m3", extractedHtml: "<article></article>", previous: undefined });
  } catch (err) {
    emptyRefusal = failureOf(err, "blocks");
  }
  return {
    question: "Does the blocks step scale?",
    command: invokedAs,
    rows,
    growth,
    worseThanLinear: growth.freshPerBlockAt6000OverAt1000 > 1.5 || growth.rerunPerBlockAt6000OverAt1000 > 1.5,
    note:
      "One run per size on a shared box, so a ratio near 1 is 'linear within noise', not a precise slope. " +
      "The plan's 36 s on 2,046 blocks was a real PDF's HTML in production, which this is not.",
    profile: {
      command: "npx tsx --cpu-prof --cpu-prof-dir=<scratch>/prof scripts/eval-big-imports.ts --only m3 (2026-10-04, load average 13)",
      finding:
        "86% of samples inside splitIntoBlocks. Largest self time, 22%: jsdom's HTMLCollection proxy " +
        "(getOwnPropertyDescriptor, generated/idl/HTMLCollection.js), which is what an indexed read of a live " +
        "collection costs; by inclusive time collectElements (src/blocks.ts) 30% and sanitizeInPlace " +
        "(src/sanitize.ts) 22%. tsx compiles each file to one line, so the profile names functions, not lines.",
    },
    instrumentCheck: { emptyArticleIsRefused: emptyRefusal },
    cannotDetect:
      "A cost that depends on what real extracted HTML contains and this does not: deep nesting, tables, " +
      "maths, thousands of footnote links, a PDF transcript's markup; and a re-import whose text has CHANGED " +
      "(here the second run's text is identical, the easy case for carrying ids).",
  };
}

function printM3(r: ReturnType<typeof m3>): void {
  console.log("\nM3 — the blocks step (runBlocks, mixed synthetic HTML)");
  const rows: (string | number)[][] = [["elements", "blocks", "fresh ms", "ms/block", "re-run ms", "ms/block", "ids carried"]];
  for (const row of r.rows) {
    rows.push([
      Number(row.elements),
      Number(row.blocks),
      Number(row.freshMs),
      Number(row.freshMsPerBlock),
      Number(row.rerunMs),
      Number(row.rerunMsPerBlock),
      String(row.idsCarried),
    ]);
  }
  console.log(table(rows));
  console.log(`per-block cost at 6,000 over 1,000: ${JSON.stringify(r.growth)}; worse than linear: ${r.worseThanLinear}`);
}

// ───────────────────────────────────────────────────────── M4: the PDF front half

type PdfCase = "a" | "b" | "c" | "d";
const PDF_CASES: Record<PdfCase, string> = {
  a: `${MAX_PAGES} pages of embedded text, ~450 words a page`,
  b: `${MAX_PAGES + 1} pages of embedded text (must be refused)`,
  c: `${MAX_PAGES} pages, each with a JPEG and ~90 words, just under 50 MiB`,
  d: "3 pages, the middle one carrying a ~25 MiB JPEG",
};
const pdfPath = (which: PdfCase) => path.join(SCRATCH, `case-${which}.pdf`);

/**
 * A real JPEG of exactly `target` bytes: noise encoded by the canvas, then
 * padded with APP15 segments (which a decoder skips). The padding is what makes
 * the size exact; the bytes are incompressible either way.
 */
async function jpegOfSize(target: number, seed: number): Promise<Uint8Array> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const side = 256;
  const canvas = createCanvas(side, side);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(side, side);
  const rand = rng(seed);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = Math.floor(rand() * 256);
    image.data[i + 1] = Math.floor(rand() * 256);
    image.data[i + 2] = Math.floor(rand() * 256);
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const base = canvas.toBuffer("image/jpeg", 80);
  if (base.length >= target) return new Uint8Array(base);
  const pieces: Buffer[] = [base.subarray(0, 2)];
  let need = target - base.length;
  while (need > 0) {
    /* A segment is marker (2) + length (2) + data; the length counts itself. */
    const data = Math.max(0, Math.min(65_533, need - 4));
    const segment = Buffer.alloc(4 + data);
    segment[0] = 0xff;
    segment[1] = 0xef;
    segment.writeUInt16BE(data + 2, 2);
    for (let i = 4; i < segment.length; i++) segment[i] = Math.floor(rand() * 256);
    pieces.push(segment);
    need -= segment.length;
  }
  pieces.push(base.subarray(2));
  return new Uint8Array(Buffer.concat(pieces));
}

async function generatePdf(which: PdfCase): Promise<Record<string, unknown>> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const started = performance.now();
  const doc = await PDFDocument.create();
  doc.setTitle(`Synthetic long document, case ${which}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const rand = rng(100 + which.charCodeAt(0));

  const textPage = (pageNumber: number, paragraphs: number, image?: { bytes: Uint8Array }) => {
    const page = doc.addPage([612, 792]);
    let y = 740;
    if (pageNumber % 5 === 1) {
      page.drawText(`${Math.ceil(pageNumber / 5)}. ${sentence(rand, 4).slice(0, -1)}`, { x: 72, y, size: 14, font: bold });
      y -= 26;
    }
    for (let p = 0; p < paragraphs; p++) {
      /* Eight lines of eleven words: ~88 words a paragraph. */
      for (let line = 0; line < 8; line++) {
        const text = words(rand, 11) + (line === 7 ? "." : "");
        page.drawText(line === 0 ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text, { x: 72, y, size: 8, font });
        y -= 11;
      }
      y -= 8;
    }
    return { page, y, image };
  };

  if (which === "a" || which === "b") {
    const pages = which === "a" ? MAX_PAGES : MAX_PAGES + 1;
    for (let n = 1; n <= pages; n++) textPage(n, 5);
  } else if (which === "c") {
    /* Aim a little under the cap: pdf-lib's own objects are a few hundred bytes a page. */
    const perPage = Math.floor((MAX_UPLOAD_BYTES - 1_500_000) / MAX_PAGES) - 1_200;
    for (let n = 1; n <= MAX_PAGES; n++) {
      const { page, y } = textPage(n, 1);
      const jpg = await doc.embedJpg(await jpegOfSize(perPage, 1000 + n));
      page.drawImage(jpg, { x: 72, y: y - 320, width: 300, height: 300 });
      page.drawText(captionFor(n), { x: 72, y: y - 340, size: 8, font });
    }
  } else {
    textPage(1, 5);
    const { page, y } = textPage(2, 1);
    const jpg = await doc.embedJpg(await jpegOfSize(25 * 1024 * 1024, 4242));
    page.drawImage(jpg, { x: 72, y: y - 320, width: 300, height: 300 });
    textPage(3, 5);
  }

  const bytes = await doc.save();
  await mkdir(SCRATCH, { recursive: true });
  await writeFile(pdfPath(which), bytes);
  return { case: which, what: PDF_CASES[which], file: pdfPath(which), bytes: bytes.length, mb: mb(bytes.length), generateMs: ms(started) };
}

/** The caption case (c) prints under page `n`'s picture, and the one its figure marker carries. */
const captionFor = (n: number): string => `Figure ${n}. Synthetic plate number ${n} of the series.`;

/** Pages a chunk's instruction asks to be transcribed (not its context page). */
function pagesAsked(instruction: string): number[] {
  const one = /Transcribe page (\d+)/.exec(instruction)?.[1];
  if (one) return [Number(one)];
  const range = /Transcribe pages (\d+)–(\d+)/.exec(instruction);
  if (!range) return [];
  const from = Number(range[1]);
  return Array.from({ length: Number(range[2]) - from + 1 }, (_, at) => from + at);
}

async function measurePdf(which: PdfCase): Promise<Record<string, unknown>> {
  let peakRss = process.memoryUsage().rss;
  const sample = () => {
    const now = process.memoryUsage().rss;
    if (now > peakRss) peakRss = now;
    return now;
  };
  const timer = setInterval(sample, 20);
  const baselineRss = sample();
  const out: Record<string, unknown> = { case: which, what: PDF_CASES[which], baselineRssMb: mb(baselineRss) };
  try {
    const bytes = new Uint8Array(await readFile(pdfPath(which)));
    out.fileBytes = bytes.length;
    out.fileMb = mb(bytes.length);
    out.uploadProblem = uploadProblem({ name: `case-${which}.pdf`, type: "application/pdf", size: bytes.length });

    /* What `refuseAnOverlongPdf` (src/pipeline.ts, not exported) does: count, then refuse. */
    let t = performance.now();
    const pages = await countPdfPages(bytes);
    out.pages = pages;
    out.countPagesMs = ms(t);
    try {
      refuseTooManyPages(pages, MAX_PAGES);
      out.pageCountRefusal = null;
    } catch (err) {
      out.pageCountRefusal = failureOf(err, "fetch");
    }
    out.rssAfterCountMb = mb(sample());

    t = performance.now();
    let pass: Awaited<ReturnType<typeof pass0>> | null = null;
    try {
      pass = await pass0(bytes, { maxPages: MAX_PAGES });
      out.pass0 = {
        ms: ms(t),
        pages: pass.pages.length,
        isScan: pass.isScan,
        words: pass.pages.reduce((sum, p) => sum + p.words, 0),
        nonEmptyLines: pass.pages.reduce((sum, p) => sum + p.text.split("\n").filter((l) => l.trim()).length, 0),
      };
    } catch (err) {
      out.pass0 = { ms: ms(t), refused: failureOf(err, "extract") };
    }
    out.rssAfterPass0Mb = mb(sample());

    if (pass) {
      t = performance.now();
      const cuts = await openPdfCuts(bytes);
      const pageBytes = await cuts.measurePages();
      const sizes = [...pageBytes.values()];
      const chunks = planChunks(pass, { pageBytes });
      out.plan = {
        ms: ms(t),
        chunks: chunks.length,
        CHUNK_CONCURRENCY,
        moreChunksThanConcurrency: chunks.length > CHUNK_CONCURRENCY,
        largestChunkPages: chunks.reduce((most, c) => Math.max(most, c.pages.length), 0),
        withContextPage: chunks.filter((c) => c.context !== undefined).length,
        largestMeasuredPageMb: mb(sizes.reduce((most, x) => Math.max(most, x), 0)),
        smallestMeasuredPageMb: mb(sizes.reduce((least, x) => Math.min(least, x), sizes[0] ?? 0)),
      };
      out.rssAfterPlanMb = mb(sample());
    }

    /* The whole stage, through the REAL reader with only its wire replaced
       (`ask`, since stage 2), so the request-size refusal, the request body and
       the width gate all run. The wire answers from the text layer and records
       what each request carried, encoded, as the provider would receive it. */
    const handed: { pages: number[]; carriesContextPage: boolean; encodedBytes: number }[] = [];
    let inFlight = 0;
    let mostInFlight = 0;
    const layer = pass?.pages ?? [];
    const reader = openRouterReader(PDF_READER_MODEL, undefined, {
      async ask(_job, body) {
        inFlight += 1;
        mostInFlight = Math.max(mostInFlight, inFlight);
        const user = (body.messages as { content: unknown }[])[1]?.content as [{ text: string }, { file: { file_data: string } }];
        const instruction = user[0].text;
        const asked = pagesAsked(instruction);
        handed.push({
          pages: asked,
          carriesContextPage: instruction.includes("The FIRST page of the attached file is page"),
          encodedBytes: user[1].file.file_data.length - "data:application/pdf;base64,".length,
        });
        sample();
        await new Promise((resolve) => setTimeout(resolve, 5));
        const wanted = new Set(asked);
        const records: PdfRecord[] = [];
        for (const page of layer) {
          if (!wanted.has(page.page)) continue;
          for (const line of page.text.split("\n")) {
            if (line.trim()) records.push({ page: page.page, type: "paragraph", text: line, continues: false, uncertain: false });
          }
        }
        inFlight -= 1;
        return {
          json: { choices: [{ message: { content: JSON.stringify({ records }) }, finish_reason: "stop" }], usage: {} },
          answeredBy: null,
          generationId: null,
        };
      },
    });
    t = performance.now();
    try {
      const result = await runPdfExtract({
        bytes,
        filename: `case-${which}.pdf`,
        checkpoints: memoryCheckpoints({ slug: `eval-big-imports-${which}`, articleId: `article-${which}` }),
        slug: `eval-big-imports-${which}`,
        reader,
        frontMatter: null,
        authors: null,
      });
      const blocks = runBlocks({ slug: `eval-big-imports-${which}`, extractedHtml: result.extractedHtml, previous: undefined });
      out.extract = {
        ms: ms(t),
        pages: result.pages,
        chunks: result.chunks,
        records: result.records,
        isScan: result.isScan,
        recall: result.recall,
        retries: result.retries.length,
        notes: result.notes.slice(0, 5),
        sentWithoutContextPage: result.notes.filter((note) => note.includes("as context")),
        htmlBytes: Buffer.byteLength(result.extractedHtml),
        blocksFromThisHtml: blocks.blocks.length,
      };
    } catch (err) {
      out.extract = { ms: ms(t), refused: failureOf(err, "extract") };
    }
    out.rssAfterExtractMb = mb(sample());
    handed.sort((a, b) => b.encodedBytes - a.encodedBytes);
    out.reader = {
      asks: handed.length,
      mostInFlight,
      largestChunks: handed.slice(0, 3).map((h) => ({ ...h, encodedMb: mb(h.encodedBytes) })),
      totalEncodedMb: mb(handed.reduce((sum, h) => sum + h.encodedBytes, 0)),
      requestSizeGuard:
        `EXERCISED. The reader is the real openRouterReader(${PDF_READER_MODEL}) with its wire (\`ask\`) replaced, so ` +
        `every request here passed the production allowance of ${mb(reader.maxEncodedBytes ?? 0)} MB encoded ` +
        `(maxEncodedBytesFor, src/pdf-read.ts), or the import was refused with [pdf-chunk-big] above. A chunk over ` +
        "it only because of its context page is sent without that page: extract.sentWithoutContextPage.",
      allowanceEncodedMb: mb(maxEncodedBytesFor(PDF_READER_MODEL)),
    };
  } finally {
    clearInterval(timer);
    sample();
    out.peakRssMb = mb(peakRss);
    out.networkCallsRefused = refusedHosts.length;
  }
  return out;
}

/** An in-memory `RawSourceStore`, the shape tests/collect-pdf-figures.test.ts uses: nothing reaches Storage. */
function memoryBlobs(): RawSourceStore & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async head(key): Promise<BlobHead | null> {
      const there = objects.get(key);
      return there ? { bytes: there.byteLength, contentType: null } : null;
    },
    async get(key): Promise<Uint8Array | null> {
      return objects.get(key) ?? null;
    },
    async putIfAbsent(key, value): Promise<PutResult> {
      if (objects.has(key)) return "already-there";
      objects.set(key, value);
      return "stored";
    },
    async remove(key): Promise<void> {
      objects.delete(key);
    },
  };
}

/**
 * PDF figure recovery (the `assets` step's PDF half) on a generated PDF: one
 * marker a page, the caption that page prints, no locator, blobs in memory.
 * `collectPdfFigures` directly, not `recoverPdfFigures` in src/pipeline.ts,
 * which wants a store holding a raw manifest.
 */
async function measureFigures(which: PdfCase): Promise<Record<string, unknown>> {
  let peakRss = process.memoryUsage().rss;
  const sample = () => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  };
  const timer = setInterval(sample, 20);
  const out: Record<string, unknown> = { case: which, baselineRssMb: mb(peakRss) };
  try {
    const pdf = new Uint8Array(await readFile(pdfPath(which)));
    const pages = await countPdfPages(pdf);
    /* The ref's shape is tests/collect-pdf-figures.test.ts § `marker`. */
    const markers = Array.from({ length: pages }, (_, i) => {
      const page = i + 1;
      const ref = `pdffig1-${String(page).padStart(2, "0")}01${"0".repeat(28)}`;
      return { ref: `${ref}.${page}.1`, page, ordinal: 1 };
    });
    const blobs = memoryBlobs();
    const t = performance.now();
    try {
      const run = await collectPdfFigures({
        markers,
        pdf,
        captions: new Map(markers.map((m) => [m.ref, captionFor(m.page)])),
        locate: null,
        blobs,
      });
      const reasons: Record<string, number> = {};
      for (const entry of run.entries) {
        const key = entry.status === "failed" ? `failed: ${entry.reason}` : entry.status;
        reasons[key] = (reasons[key] ?? 0) + 1;
      }
      out.figures = {
        ms: ms(t),
        markers: markers.length,
        entries: run.entries.length,
        stored: run.stored,
        drawn: run.drawn,
        failed: run.failed,
        deduped: run.deduped,
        storedMb: mb(run.bytes),
        elapsedMs: run.elapsedMs,
        storageErrors: run.storageErrors.length,
        outcomes: reasons,
        blobsHeld: blobs.objects.size,
      };
    } catch (err) {
      out.figures = { ms: ms(t), refused: failureOf(err, "assets") };
    }
  } finally {
    clearInterval(timer);
    sample();
    out.peakRssMb = mb(peakRss);
    out.networkCallsRefused = refusedHosts.length;
  }
  return out;
}

/**
 * A PDF fetched by address, through `fetchDocument`'s own `fetchImpl` seam: a
 * body of each size, and what the reader would be told. No socket is opened;
 * the address resolves, by injection, to a public documentation IP.
 */
async function fetchCap() {
  const sizes = [
    /* 32 MiB was the fetch's own cap until 2026-10-04; kept as a size that
       used to be the boundary and must now simply be accepted. */
    { name: "32 MiB + 1 (over the old cap)", bytes: 32 * 1024 * 1024 + 1 },
    { name: "50 MiB (the stated limit)", bytes: MAX_UPLOAD_BYTES },
    { name: "50 MiB + 1", bytes: MAX_UPLOAD_BYTES + 1 },
  ];
  const rows: Record<string, unknown>[] = [];
  for (const declared of [true, false]) {
    for (const size of sizes) {
      const body = new Uint8Array(size.bytes);
      body.set(Buffer.from("%PDF-1.4\n"));
      let asked = 0;
      const t = performance.now();
      const row: Record<string, unknown> = { size: size.name, bytes: size.bytes, contentLengthDeclared: declared };
      try {
        const got = await fetchDocument("https://example.com/long.pdf", {
          attempts: 1,
          sleep: async () => {},
          resolve: async () => ["93.184.216.34"],
          fetchImpl: async () => {
            asked += 1;
            return new Response(body, {
              status: 200,
              headers: {
                "content-type": "application/pdf",
                ...(declared ? { "content-length": String(size.bytes) } : {}),
              },
            });
          },
        });
        row.accepted = true;
        row.kind = got.kind;
        row.gotBytes = got.bytes.length;
      } catch (err) {
        row.accepted = false;
        row.failure = failureOf(err, "fetch");
      }
      row.ms = ms(t);
      row.fetchImplCalls = asked;
      rows.push(row);
    }
  }
  return {
    question: "Does a PDF fetched by address get the 50 MB the dialog states?",
    command: invokedAs,
    statedLimit: uploadLimits(),
    fetchDefaultMaxBytes: FETCH_DEFAULTS.maxBytes,
    uploadMaxBytes: MAX_UPLOAD_BYTES,
    rows,
    cannotDetect:
      "Anything about a real server: a slow body, a redirect chain, a wrong content-type. And whether the " +
      "pipeline passes fetchDocument a larger maxBytes somewhere: this calls it with the default, as read.",
  };
}

function printFetch(r: Awaited<ReturnType<typeof fetchCap>>): void {
  console.log(`\nFetch — a PDF by address, default cap ${mb(r.fetchDefaultMaxBytes)} MiB against the stated ${mb(r.uploadMaxBytes)} MiB`);
  const rows: (string | number)[][] = [["body", "content-length", "result", "the reader is told"]];
  for (const row of r.rows) {
    const failure = row.failure as Failure | undefined;
    rows.push([
      String(row.size),
      row.contentLengthDeclared ? "declared" : "absent",
      row.accepted ? "accepted" : `✗ ${failure?.name}`,
      failure ? `(${failure.readerKind}) ${failure.readerMessage}` : "-",
    ]);
  }
  console.log(table(rows));
}

function child(args: string[], timeoutMs: number): Record<string, unknown> {
  const started = performance.now();
  const run = spawnSync("npx", ["tsx", SELF, ...args, "--scratch", SCRATCH], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
  });
  const line = run.stdout?.split("\n").find((l) => l.startsWith("RESULT "));
  if (run.status !== 0 || !line) {
    return {
      childFailed: true,
      status: run.status,
      signal: run.signal,
      wallMs: ms(started),
      stderrTail: (run.stderr ?? "").slice(-1500),
      stdoutTail: (run.stdout ?? "").slice(-500),
    };
  }
  return { ...(JSON.parse(line.slice("RESULT ".length)) as Record<string, unknown>), childWallMs: ms(started) };
}

function m4() {
  const cases: { generated: Record<string, unknown>; measured: Record<string, unknown>; figures?: Record<string, unknown> }[] = [];
  for (const which of Object.keys(PDF_CASES) as PdfCase[]) {
    console.log(`  M4 case ${which}: ${PDF_CASES[which]}`);
    const generated = child(["--child", "gen", "--case", which], 15 * 60_000);
    const measured = generated.childFailed ? { skipped: "the PDF could not be generated" } : child(["--child", "run", "--case", which], 20 * 60_000);
    /* Figure recovery, on the image-heavy document only, in a process of its own. */
    const figures = which === "c" && !generated.childFailed ? child(["--child", "fig", "--case", which], 15 * 60_000) : undefined;
    cases.push({ generated, measured, ...(figures ? { figures } : {}) });
  }
  return {
    question: "Does the PDF front half cope at the caps?",
    command: invokedAs,
    caps: {
      uploadLimits: uploadLimits(),
      MAX_PAGES,
      MAX_UPLOAD_BYTES,
      fetchMaxBytes: FETCH_DEFAULTS.maxBytes,
      uploadAtTheCap: uploadProblem({ name: "x.pdf", type: "application/pdf", size: MAX_UPLOAD_BYTES }),
      uploadOneByteOver: uploadProblem({ name: "x.pdf", type: "application/pdf", size: MAX_UPLOAD_BYTES + 1 }),
    },
    vercelMemory:
      "vercel.json sets maxDuration (800) and no memory for api/**, so the function's memory ceiling is " +
      "whatever the plan's default is: not readable from the repo, not measured.",
    cases,
    cannotDetect:
      "Anything the model does: a slow, short or wrong transcription, a provider's own size or page limit, " +
      "rate limits at this width. Peak RSS is sampled every 20 ms in a Node process on this box, so a short " +
      "spike can be missed, and it is not the memory of a Vercel function. The fake reader returns in 5 ms, " +
      "so nothing about a 740 s step deadline is tested.",
  };
}

function printM4(r: ReturnType<typeof m4>): void {
  console.log("\nM4 — the PDF front half (each case in its own process; the real reader, its wire answering from the PDF's own text layer)");
  const rows: (string | number)[][] = [["case", "MB", "pages", "page-cap", "pass0 ms", "chunks", "extract ms", "blocks", "peak RSS MB", "largest request MB, encoded", "result"]];
  for (const c of r.cases) {
    const g = c.generated;
    const m = c.measured;
    if (g.childFailed || m.childFailed || m.skipped) {
      rows.push([String(g.case ?? "?"), "-", "-", "-", "-", "-", "-", "-", "-", "-", `child failed: ${JSON.stringify(g.childFailed ? g : m).slice(0, 200)}`]);
      continue;
    }
    const pass = m.pass0 as Record<string, unknown>;
    const plan = m.plan as Record<string, unknown> | undefined;
    const extract = m.extract as Record<string, unknown>;
    const reader = m.reader as { largestChunks: { encodedMb: number }[] };
    const refused = (extract.refused ?? pass.refused) as Failure | undefined;
    rows.push([
      String(m.case),
      Number(m.fileMb),
      Number(m.pages),
      m.pageCountRefusal ? `refused in ${m.countPagesMs} ms` : "ok",
      Number(pass.ms),
      plan ? Number(plan.chunks) : "-",
      Number(extract.ms),
      extract.blocksFromThisHtml === undefined ? "-" : Number(extract.blocksFromThisHtml),
      Number(m.peakRssMb),
      reader.largestChunks[0]?.encodedMb ?? "-",
      refused ? `✗ ${refused.readerMessage.slice(0, 90)}` : "ok",
    ]);
  }
  console.log(table(rows));
  console.log(`the request-size guard ([pdf-chunk-big]) IS exercised: the real reader, allowance ${mb(maxEncodedBytesFor(PDF_READER_MODEL))} MB encoded; see reader.requestSizeGuard in the results`);
  for (const c of r.cases) {
    if (c.figures) console.log(`figure recovery on case ${String(c.generated.case)}: ${JSON.stringify(c.figures)}`);
  }
}

// ───────────────────────────────────────────────────────── main

async function main(): Promise<void> {
  forbidTheNetwork();
  loadEnvLocal();

  const childKind = argValue("--child");
  if (childKind) {
    const which = argValue("--case") as PdfCase;
    if (!(which in PDF_CASES)) throw new Error(`unknown case ${which}`);
    const result =
      childKind === "gen" ? await generatePdf(which) : childKind === "fig" ? await measureFigures(which) : await measurePdf(which);
    console.log(`RESULT ${JSON.stringify(result)}`);
    return;
  }

  const only = new Set((argValue("--only") ?? "m1,m2,m3,m4,m5,fetch").split(",").map((s) => s.trim().toLowerCase()));
  await mkdir(OUT_DIR, { recursive: true });
  let results: Record<string, unknown> = {};
  try {
    results = JSON.parse(await readFile(OUT_FILE, "utf8")) as Record<string, unknown>;
  } catch {
    /* First run: nothing to keep. */
  }
  const stamp = { ranAt: new Date().toISOString() };

  if (only.has("m1")) {
    const r = await m1();
    results.m1 = { ...stamp, ...r };
    printM1(r);
  }
  if (only.has("m3")) {
    const r = m3();
    results.m3 = { ...stamp, ...r };
    printM3(r);
  }
  if (only.has("m2") || only.has("m5")) {
    try {
      const r = await m2m5();
      if (only.has("m2")) results.m2 = { ...stamp, ...r.m2 };
      results.m5 = { ...stamp, ...r.m5 };
      printM2M5(r, only.has("m2"));
    } finally {
      await closeDb();
    }
  }
  if (only.has("fetch")) {
    const r = await fetchCap();
    results.fetch = { ...stamp, ...r };
    printFetch(r);
  }
  if (only.has("m4")) {
    await mkdir(SCRATCH, { recursive: true });
    const r = m4();
    results.m4 = { ...stamp, ...r };
    printM4(r);
    for (const which of Object.keys(PDF_CASES) as PdfCase[]) {
      const size = await stat(pdfPath(which)).then((s) => s.size, () => null);
      if (size !== null) console.log(`  kept for inspection: ${pdfPath(which)} (${mb(size)} MB)`);
    }
  }

  results.about = {
    plan: "docs/plans/261004f-big-pdfs-and-long-documents-import-reliably-up-to-our-stated-limits.md",
    harness: "scripts/eval-big-imports.ts",
    statedLimits: uploadLimits(),
    paidCalls: 0,
    networkCallsRefusedInTheParent: refusedHosts,
  };
  await writeFile(OUT_FILE, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`\nwrote ${path.relative(ROOT, OUT_FILE)}`);
}

process.on("SIGINT", () => {
  void removeEverything().finally(() => process.exit(130));
});

await main();
