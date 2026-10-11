/**
 * **Would smaller PDF chunks make extract faster?** Plan 261011u, stage 2.
 *
 *   npx tsx scripts/eval-pdf-chunk-size.ts <file.pdf> <label> [--max-pages N --words W] [--out f.jsonl]
 *   npx tsx scripts/eval-pdf-chunk-size.ts --ledger <slug-or-prefix%> [--out summary.json]
 *
 * The first form runs the real `runPdfExtract` once — the real reader, the
 * front-matter and authors readers exactly as `main()` in src/pdf-read.ts does,
 * `nullCheckpointStore()` so nothing is replayed — and appends one JSON line.
 * Omit both bounds for the "today" arm (`MAX_CHUNK_PAGES` / `CHUNK_WORDS`); give
 * both for an experimental one. **One run per process, on purpose**: the
 * reader's shared `WidthGate` lives in the module, so a 429 in one run would
 * otherwise start the next below width 100 (GPT Sol F4).
 *
 * Nothing in src/ is changed to measure this. The three readers are wrapped
 * here, which is how the per-call timings, the re-asks, the single-page
 * recoveries and the front-matter and authors passes' time are told apart.
 *
 * The second form reads the **local** ledger by `article_slug` (a trailing `%`
 * makes it a prefix): spend, calls, cache tokens, and any row not `ok`. Every
 * run here is attributed to its own slug for exactly that read.
 *
 * Both refuse unless DATABASE_URL is the local stack — the runs write ledger
 * rows, and the ledger read must not be quietly reading production.
 */
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { collectSpend, totalSpend } from "../src/ai-spend.js";
import { closeDb, getDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { isMain } from "../src/is-main.js";
import { modelFor } from "../src/models.js";
import { environmentOwnerId } from "../src/owner.js";
import { openRouterAuthorsReader, type AuthorsReader } from "../src/pdf-authors.js";
import { openRouterFrontMatterReader, type FrontMatterReader } from "../src/pdf-frontmatter.js";
import { openRouterReader, runPdfExtract, type PdfReader } from "../src/pdf-read.js";
import { costStore } from "../src/store/ai-calls.js";
import { nullCheckpointStore } from "../src/store/checkpoints.js";

const flag = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** Refuses anything but the local stack, and says which it is either way. */
function requireLocalDb(): void {
  const url = process.env.DATABASE_URL;
  const host = url ? new URL(url).hostname : "(none)";
  console.log(`Target: ${host} (DATABASE_URL after .env.local)`);
  if (host !== "127.0.0.1" && host !== "localhost") {
    console.error(`Refusing: ${host} is not the local database.`);
    process.exit(1);
  }
}

/** One model call the transcription reader made, in ms from the step's start. */
interface Call {
  start: number;
  end: number;
  /** The pages the instruction asked for — one page on a recovery or a 1-page chunk. */
  pages: number;
  first: number;
  ok: boolean;
}

async function run(file: string, label: string): Promise<void> {
  const maxPages = flag("--max-pages");
  const words = flag("--words");
  if ((maxPages === undefined) !== (words === undefined)) {
    throw new Error("Give both --max-pages and --words, or neither (today's plan).");
  }
  const chunking =
    maxPages === undefined ? undefined : { maxPages: Number(maxPages), words: Number(words) };
  const arm = chunking ? `p${chunking.maxPages}w${chunking.words}` : "today";
  const slug = `cs-${label}-${arm}-${Date.now()}`;
  const out = flag("--out") ?? "evals/results/pdf-chunk-size-2026-10-11/stage2.jsonl";
  const bytes = new Uint8Array(await readFile(file));

  let t0 = 0;
  const now = () => Date.now() - t0;
  const calls: Call[] = [];
  const base = openRouterReader();
  const reader: PdfReader = {
    id: base.id,
    ...(base.maxEncodedBytes === undefined ? {} : { maxEncodedBytes: base.maxEncodedBytes }),
    async read(pdf, instruction, signal) {
      /* `instructionFor` opens "Transcribe page N" or "Transcribe pages A–B". */
      const m = /^Transcribe pages? (\d+)(?:–(\d+))?/.exec(instruction);
      const first = Number(m?.[1] ?? 0);
      const call: Call = { start: now(), end: 0, pages: Number(m?.[2] ?? first) - first + 1, first, ok: false };
      calls.push(call);
      try {
        const reading = await base.read(pdf, instruction, signal);
        call.ok = true;
        return reading;
      } finally {
        call.end = now();
      }
    },
  };
  /* The two passes after the fold, timed by wrapping `ask` — the rest of each reader is untouched. */
  const aux = { frontMatterMs: 0, frontMatterCalls: 0, authorsMs: 0, authorsCalls: 0 };
  const fm = openRouterFrontMatterReader(modelFor("pdf-frontmatter", "standard"));
  const frontMatter: FrontMatterReader = {
    ...fm,
    async ask(prompt, signal) {
      const s = Date.now();
      try {
        return await fm.ask(prompt, signal);
      } finally {
        aux.frontMatterMs += Date.now() - s;
        aux.frontMatterCalls++;
      }
    },
  };
  const au = openRouterAuthorsReader(modelFor("pdf-frontmatter", "standard"));
  const authors: AuthorsReader = {
    ...au,
    async ask(prompt, signal) {
      const s = Date.now();
      try {
        return await au.ask(prompt, signal);
      } finally {
        aux.authorsMs += Date.now() - s;
        aux.authorsCalls++;
      }
    },
  };

  const progress: { at: number; pages: number[] }[] = [];
  let planned = 0;
  t0 = Date.now();
  const { result, report } = await collectSpend(
    () =>
      runPdfExtract({
        bytes,
        url: `file://${path.resolve(file)}`,
        slug,
        checkpoints: nullCheckpointStore(),
        reader,
        frontMatter,
        authors,
        ...(chunking ? { chunking } : {}),
        onProgress: (_done, total, pages) => {
          planned = total;
          progress.push({ at: now(), pages });
        },
      }),
    {
      attribution: { scopeKind: "eval", ownerId: environmentOwnerId(), articleSlug: slug },
      sink: (row) => costStore.record(row),
    },
  );
  const wallMs = now();

  /* A chunk's first call starts in the fan-out; every later call for the same
     chunk is a re-ask, and a one-page call inside a multi-page chunk is a
     recovery. Matched by first page, which is unique per chunk. */
  const chunkSize = new Map(progress.map((p) => [p.pages[0] ?? 0, p.pages.length]));
  const chunkOf = (page: number) => {
    const p = progress.find((c) => c.pages.includes(page));
    return p?.pages[0] ?? page;
  };
  const whole = calls.filter((c) => c.pages === (chunkSize.get(c.first) ?? -1));
  const recoveries = calls.filter((c) => c.pages === 1 && (chunkSize.get(chunkOf(c.first)) ?? 1) > 1);
  const asksPerChunk = new Map<number, number>();
  for (const c of whole) asksPerChunk.set(c.first, (asksPerChunk.get(c.first) ?? 0) + 1);
  const firstAsks = [...asksPerChunk.keys()].map((k) => whole.find((c) => c.first === k)!);
  const firstWaveDoneMs = Math.max(0, ...firstAsks.map((c) => c.end));
  const lastChunkMs = Math.max(0, ...progress.map((p) => p.at));
  /* `totalSpend`, not `cost.costNanos`: a BYOK call is billed upstream and reports 0 there. */
  const costNanos = Number(totalSpend(report.calls).nanos);
  const line = {
    at: new Date(t0).toISOString(),
    slug,
    arm,
    chunking: chunking ?? null,
    file: path.basename(file),
    pages: result.pages,
    plannedChunks: planned,
    wallMs,
    /** Every first ask has come back — the end of the first wave. */
    firstWaveDoneMs,
    /** The last chunk's `onProgress`; the gap to `wallMs` is the fold, phase-2 recovery and the two passes. */
    lastChunkMs,
    tailMs: wallMs - firstWaveDoneMs,
    progressMs: progress.map((p) => p.at),
    readerCalls: calls.length,
    readerCallsFailed: calls.filter((c) => !c.ok).length,
    chunksReAsked: [...asksPerChunk.values()].filter((n) => n > 1).length,
    reAsks: [...asksPerChunk.values()].reduce((s, n) => s + n - 1, 0),
    recoveredPages: new Set(recoveries.map((c) => c.first)).size,
    recoveryCalls: recoveries.length,
    /** Recovery calls that started after the last chunk reported — phase 2, in the fold. */
    recoveryCallsAfterFanOut: recoveries.filter((c) => c.start >= lastChunkMs).length,
    retries: result.retries.length,
    recall: result.recall,
    pagesChecked: result.meta.pagesChecked,
    notes: result.notes.length,
    records: result.records,
    usage: result.usage,
    frontMatterUsage: result.frontMatterUsage,
    ...aux,
    spendCalls: report.calls.length,
    spendUsd: costNanos / 1e9,
    maxRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
    callMs: calls.map((c) => [c.first, c.pages, c.start, c.end]),
  };
  await appendFile(out, `${JSON.stringify(line)}\n`, "utf-8");
  console.log(
    `${arm} ${line.file}: ${(wallMs / 1000).toFixed(1)}s, ${planned} chunks, first wave ${(firstWaveDoneMs / 1000).toFixed(1)}s, ` +
      `${line.reAsks} re-asks, ${line.recoveredPages} pages recovered, $${line.spendUsd.toFixed(3)} → ${out}`,
  );
}

/** The ledger's view of one run (or every run, with a `%` prefix), from the local `ai_calls`. */
async function ledger(pattern: string): Promise<void> {
  const { rows } = await getDb().execute<Record<string, unknown>>(sql`
    select article_slug as slug, count(*)::int as calls,
      round(sum(coalesce(credits_used_nanos,0)+coalesce(byok_upstream_nanos,0)+coalesce(computed_cost_nanos,0))/1e9, 4)::float as usd,
      sum(coalesce(cache_read_tokens,0))::int as cache_read, sum(coalesce(cache_write_tokens,0))::int as cache_write,
      count(*) filter (where outcome <> 'ok')::int as not_ok,
      count(*) filter (where failure_status = 429)::int as r429,
      count(*) filter (where cost_source = 'none')::int as unpriced
    from spideryarn.ai_calls where article_slug like ${pattern}
    group by article_slug order by min(started_at)`);
  const total = rows.reduce((s, r) => s + Number(r.usd), 0);
  const summary = { pattern, totalUsd: Math.round(total * 1e4) / 1e4, runs: rows };
  const out = flag("--out");
  if (out) await writeFile(out, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
  console.log(JSON.stringify(summary, null, 2));
}

async function main() {
  /* Before the first `await`, as tests/paid-cli-ledger.test.ts asks of a stage CLI. */
  loadEnvLocal();
  requireLocalDb();
  try {
    const pattern = flag("--ledger");
    if (pattern) return await ledger(pattern);
    const [file, label] = process.argv.slice(2);
    if (!file || !label || file.startsWith("--")) {
      console.error("Usage: eval-pdf-chunk-size.ts <file.pdf> <label> [--max-pages N --words W] [--out f.jsonl]");
      process.exit(1);
    }
    await run(file, label);
  } finally {
    await closeDb();
  }
}

if (isMain(import.meta.url)) await main();
