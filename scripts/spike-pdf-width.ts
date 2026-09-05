/**
 * **How wide can the PDF fan-out go before the upstream pushes back?**
 *
 * The measurement behind `CHUNK_CONCURRENCY` going 16 → 100 on 2026-09-04 and
 * behind `WidthGate` existing at all — docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md
 * § Stage 9. Kept rather than thrown away because what it measures is a fact
 * about *this account's configuration at this provider*, which can change
 * without telling us: the width-100 probe moved `byok_usage_daily` and left
 * `limit_remaining` untouched, so the ceiling is Greg's own tier rather than a
 * pool shared with every OpenRouter customer. When that changes, this is how we
 * find out on purpose instead of through a failed ingest.
 *
 * **It deliberately bypasses the gateway**, which is why it is declared in
 * src/spend-declarations.ts § `pdf-width-spike`. `openRouterJson` is exactly the
 * wrong thing to measure through: it retries a 429, converts a status into a
 * `ProviderRefused`, and imposes one `provider` policy — and the raw status, the
 * raw timing and the raw concurrency *are* the experiment. The request body,
 * route and provider block below are copied from `openRouterReader` and the
 * `pdf` row of `AI_JOB_ROUTE` so that what is measured is the wire the real
 * stage uses.
 *
 * Four modes, one file, because they differ only in what they send:
 *
 *     npx tsx scripts/spike-pdf-width.ts quota
 *     npx tsx scripts/spike-pdf-width.ts pages    <width> [startPage]
 *     npx tsx scripts/spike-pdf-width.ts chunks   <width> [limitChunks]
 *     npx tsx scripts/spike-pdf-width.ts overload <width> [...more widths]
 *
 * `chunks` is the honest one — the real `planChunks` output, cut from the real
 * source — because single pages understate the payload by roughly six times, and
 * payload into one upstream is what a rate limit usually counts. `overload`
 * climbs until something refuses; on 2026-09-04 nothing did, at 150, 250 or 400.
 *
 * **This costs real money.** The width-100 `pages` run was $0.35.
 */
import { readFile } from "node:fs/promises";

import { loadEnvLocal } from "../src/env.js";
import { PDF_READER_MODEL } from "../src/models.js";
import {
  type Chunk,
  instructionFor,
  openPdfCuts,
  planChunks,
  SCHEMA,
  SYSTEM,
} from "../src/pdf-read.js";
import { pass0 } from "../src/pdf.js";

loadEnvLocal();

/** Overridable so this is not welded to one machine's home directory. */
const SOURCE =
  process.env.SPIKE_PDF ??
  "/home/greg/uploads/Lawrence Kuhn (2024) - A landscape of consciousness_ Toward a taxonomy of explanations and implications.pdf";

const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error("OPENROUTER_API_KEY is not set — see docs/project/setup-dev.md.");

interface Shot {
  label: string;
  status: number;
  ms: number;
  /** When it was dispatched, relative to the start of the wave. */
  offset: number;
  retryAfter: string | null;
  outcome: "ok" | "http" | "body-error" | "transport";
  detail: string;
  cost: number;
}

/**
 * One request, and every raw fact about what came back.
 *
 * `status: 0` is a transport failure and `-1` a 200 carrying an `error` object,
 * which OpenRouter does — a refusal that does not look like an HTTP error.
 */
async function shoot(label: string, instruction: string, data: string, t0: number): Promise<Shot> {
  const started = performance.now();
  const offset = Math.round(started - t0);
  const bad = (status: number, ms: number, retryAfter: string | null, detail: string): Shot => ({
    label,
    status,
    ms,
    offset,
    retryAfter,
    outcome: status === 0 ? "transport" : status === -1 ? "body-error" : "http",
    detail,
    cost: 0,
  });
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: PDF_READER_MODEL,
        max_tokens: 32_000,
        provider: { require_parameters: true, allow_fallbacks: false },
        usage: { include: true },
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: instruction },
              {
                type: "file",
                file: { filename: "source.pdf", file_data: `data:application/pdf;base64,${data}` },
              },
            ],
          },
        ],
        plugins: [{ id: "file-parser", pdf: { engine: "native" } }],
        response_format: {
          type: "json_schema",
          json_schema: { name: "transcription", strict: true, schema: SCHEMA },
        },
      }),
    });
    const retryAfter = res.headers.get("retry-after");
    const text = await res.text();
    const ms = Math.round(performance.now() - started);
    if (!res.ok) return bad(res.status, ms, retryAfter, text.slice(0, 200));
    const json = JSON.parse(text) as {
      error?: unknown;
      usage?: { cost?: number };
      choices?: { finish_reason?: string }[];
    };
    if (json.error) return bad(-1, ms, retryAfter, JSON.stringify(json.error).slice(0, 200));
    return {
      label,
      status: 200,
      ms,
      offset,
      retryAfter,
      outcome: "ok",
      detail: json.choices?.[0]?.finish_reason ?? "?",
      cost: json.usage?.cost ?? 0,
    };
  } catch (err) {
    return bad(
      0,
      Math.round(performance.now() - started),
      null,
      err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    );
  }
}

/** Fire them all at once and say what happened, with peak memory. */
async function wave(
  what: string,
  width: number,
  jobs: { label: string; instruction: string; data: string }[],
): Promise<void> {
  let peak = 0;
  const watch = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 250);

  const shots: Shot[] = [];
  const t0 = performance.now();
  let next = 0;
  /* A plain semaphore rather than p-queue: fewer moving parts in a measurement,
     and at width >= jobs.length this is simply "all at once". */
  const worker = async () => {
    for (;;) {
      const at = next++;
      const job = jobs[at];
      if (!job) return;
      shots.push(await shoot(job.label, job.instruction, job.data, t0));
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, worker));
  const elapsed = Math.round(performance.now() - t0);
  clearInterval(watch);

  const by = new Map<string, number>();
  for (const s of shots) {
    const name = s.outcome === "ok" ? `ok(${s.detail})` : `${s.outcome} ${s.status}`;
    by.set(name, (by.get(name) ?? 0) + 1);
  }
  const times = shots.map((s) => s.ms).sort((a, b) => a - b);
  const offs = shots.map((s) => s.offset).sort((a, b) => a - b);
  const at = (q: number) => times[Math.min(times.length - 1, Math.floor(times.length * q))];

  console.log(`\n=== ${what}, width ${width}, ${jobs.length} request(s) ===`);
  console.log(`wall           ${(elapsed / 1000).toFixed(1)}s`);
  console.log(`outcomes       ${JSON.stringify(Object.fromEntries(by))}`);
  console.log(`latency ms     p50 ${at(0.5)}  p95 ${at(0.95)}  max ${times.at(-1)}`);
  console.log(`dispatch ms    min ${offs[0]}  max ${offs.at(-1)}`);
  console.log(`peak RSS       ${Math.round(peak / 1024 / 1024)} MB`);
  console.log(`cost           $${shots.reduce((t, s) => t + s.cost, 0).toFixed(4)}`);
  for (const s of shots.filter((s) => s.outcome !== "ok").slice(0, 12)) {
    console.log(`   ! ${s.label} ${s.outcome} ${s.status} ra=${s.retryAfter} ${s.ms}ms ${s.detail}`);
  }
}

/** What the account itself says its limits are, and which pocket pays. */
async function quota(): Promise<void> {
  const res = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${key}` },
  });
  console.log(res.status, JSON.stringify(await res.json(), null, 2));
}

/** `width` single pages, which is cheap and says whether the fan-out is real. */
async function pages(width: number, start: number): Promise<void> {
  const cuts = await openPdfCuts(new Uint8Array(await readFile(SOURCE)));
  const jobs = [];
  for (let i = 0; i < width; i++) {
    const page = start + i;
    jobs.push({
      label: `p${page}`,
      instruction: `Transcribe page ${page} of the attached PDF.`,
      data: Buffer.from(await cuts.cut([page])).toString("base64"),
    });
  }
  await wave("single pages", width, jobs);
}

/** The shape the stage actually sends: the real chunk plan, really cut. */
async function chunks(width: number, limit: number): Promise<void> {
  const source = new Uint8Array(await readFile(SOURCE));
  console.log("pass0…");
  const pass = await pass0(source, { maxPages: 250 });
  const cuts = await openPdfCuts(source);
  console.log("measuring pages…");
  const sizes = await cuts.measurePages();
  /* `pageBytes`, not `sizes` — the first draft of this script used the wrong key
     name, so `MAX_CHUNK_BYTES` silently never applied and it planned a chunk
     production would have split. `tsx` does not typecheck, so it ran and
     reported a plausible number; `npm run typecheck` found it the moment this
     file moved into `scripts/`. */
  const all: Chunk[] = planChunks(pass, { pageBytes: sizes });
  const wanted = limit ? all.slice(0, limit) : all;
  console.log(`${all.length} chunk(s) planned, sending ${wanted.length}`);

  const jobs = [];
  for (const chunk of wanted) {
    const send = chunk.context ? [chunk.context, ...chunk.pages] : chunk.pages;
    jobs.push({
      label: `pages ${chunk.pages.join(",")}`,
      instruction: instructionFor(chunk),
      data: Buffer.from(await cuts.cut(send)).toString("base64"),
    });
  }
  const mb = jobs.reduce((t, j) => t + j.data.length, 0) / 1024 / 1024;
  console.log(`encoded payload ${mb.toFixed(1)} MB total`);
  await wave("real chunks", width, jobs);
}

/**
 * Climb until something refuses, cycling twenty pages so the width can exceed
 * the document's page count and nothing is served from a cache keyed on bytes.
 */
async function overload(widths: number[]): Promise<void> {
  const cuts = await openPdfCuts(new Uint8Array(await readFile(SOURCE)));
  const pool: string[] = [];
  for (let page = 30; page < 50; page++) {
    pool.push(Buffer.from(await cuts.cut([page])).toString("base64"));
  }
  for (const width of widths) {
    const jobs = Array.from({ length: width }, (_, i) => ({
      label: `#${i}`,
      instruction: "Transcribe the attached page.",
      data: pool[i % pool.length]!,
    }));
    await wave("overload", width, jobs);
  }
}

const [mode, ...rest] = process.argv.slice(2);
const nums = rest.map(Number);
switch (mode) {
  case "quota":
    await quota();
    break;
  case "pages":
    await pages(nums[0] ?? 16, nums[1] ?? 20);
    break;
  case "chunks":
    await chunks(nums[0] ?? 16, nums[1] ?? 0);
    break;
  case "overload":
    await overload(nums.length ? nums : [150, 250, 400]);
    break;
  default:
    console.error(
      "Usage: tsx scripts/spike-pdf-width.ts quota | pages <width> [start] |" +
        " chunks <width> [limit] | overload <width>...",
    );
    process.exit(1);
}
