/**
 * **What a cold start costs**, before any of our code has run.
 *
 *     npm run build:api && npx tsx scripts/bench-cold-start.ts
 *
 * `api/index.js` does `await import("../api-dist/vercel.js")` — a 3.4 MB
 * unminified server bundle — and the server's own request clock starts *after*
 * that. So every `GET /api/library` line in production says ~10 ms while the
 * reader waits for module initialisation nobody has ever measured. This times
 * that import, and each heavy dependency it pulls in at module scope, so Stage 4
 * of docs/plans/260903g-faster-shelf-load-and-tidier-homepage-controls.md has a
 * before and an after rather than an opinion.
 *
 * **This box is not production**, and nothing here claims to be: no Vercel
 * credential exists on the remote box, so these are local, cold-file-cache-ish,
 * directional numbers on a machine several agents share. What they settle is
 * which import is worth attacking, not what a reader in London waits.
 *
 * What it said on 2026-09-03 — Node v22 on the Hetzner box, 3 fresh processes per
 * import, median, at a load average of 108 on 16 cores. **Read the load line
 * before the table**: this was the least contended of three runs and the box was
 * still eight times oversubscribed, so every figure is an upper bound. GPT Sol
 * timed the same bundle at ~2.61 s on a quiet machine, about 3.5× faster, and
 * the ordering below is what survives across every run rather than the absolute
 * values.
 *
 * ```
 *   api-dist/vercel.js (the whole bundle)   9139 ms   230 MB
 *   jsdom                                   3865 ms   154 MB
 *   drizzle-orm/node-postgres               2755 ms   281 MB
 *   drizzle-orm/pg-core                     1823 ms   253 MB
 *   @sentry/node-core/light                  420 ms    84 MB
 *   pdf-lib                                  244 ms    67 MB
 *   stripe                                   237 ms    78 MB
 *   undici                                   195 ms    75 MB
 *   @anthropic-ai/sdk                        128 ms    64 MB
 *   mdast-util-from-markdown                  88 ms    62 MB
 *   @supabase/supabase-js                     83 ms    56 MB
 *   pg                                        66 ms    56 MB
 *   fflate / p-queue / @mozilla/readability / dompurify   under 30 ms each
 * ```
 *
 * Two things in there were not on anyone's list before it ran: **`drizzle-orm/pg-core`
 * is a second cost beside `node-postgres`**, and **`@sentry/node-core/light`
 * outranks Stripe**. That is what the harness is for.
 *
 * ## The one way this could report a lie, and what stops it
 *
 * **A module can only be imported once per process.** Time it twice in the same
 * process and the second reading is microseconds — which reads exactly like
 * "we made it fast". That is docs/reusable/silent-success.md in its purest form:
 * the natural check (a number came back, and it is small) shares the bug's
 * assumption. So every measurement runs in a **fresh child process**, and the
 * harness checks the observable outcome of that — distinct pids, none of them
 * this process's — rather than trusting that it spawned them.
 *
 * **It throws rather than shrugging**, which is the rule scripts/bench-shelf-reads.ts
 * already follows and had this exact hole found in review. A missing bundle, a
 * bundle older than `src/`, a child that died, a child that printed nothing, a
 * reading below `MIN_PLAUSIBLE_MS` — every way this could report nothing is an
 * error, not a row.
 *
 * tests/bench-cold-start.test.ts holds one case per refusal.
 */
import { spawnSync } from "node:child_process";
import { type Dirent, readdirSync, statSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isMain } from "../src/is-main.js";

/** The repository root, from this file's own location. */
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Where `npm run build:api` puts the thing production actually imports. */
const BUNDLE = path.join("api-dist", "vercel.js");

/**
 * Small enough that nothing real could be this size.
 *
 * A zero-byte or truncated `vercel.js` is present, importable, and instant —
 * a perfect zero-cost cold start, and completely false. The real one is ~3.4 MB.
 */
export const MIN_BUNDLE_BYTES = 100_000;

/**
 * Under this, a reading is not a measurement.
 *
 * A second import inside one process comes back in tens of *micro*seconds, and
 * so does a timer that never started. The cheapest thing on the list below
 * (`fflate`) is comfortably above 1 ms on a cold process, so this floor
 * separates the two without needing a per-import threshold nobody would keep up
 * to date.
 */
export const MIN_PLAUSIBLE_MS = 1;

/** How many fresh processes each import gets. The reported figure is the median. */
const RUNS = 3;

/**
 * Everything `api-dist/vercel.js` imports at **module scope** from outside the
 * repo, which is the set that a cold start pays for whatever the request is.
 *
 * Taken from `grep '^import' api-dist/vercel.js` rather than from memory, and
 * worth re-taking after any change to the import graph: this list going stale is
 * how a new 900 ms dependency would arrive unnoticed. Node built-ins are left
 * out — they are already in the process.
 */
export const HEAVY_IMPORTS = [
  "jsdom",
  "drizzle-orm/node-postgres",
  "drizzle-orm/pg-core",
  "pg",
  "stripe",
  "@anthropic-ai/sdk",
  "@supabase/supabase-js",
  "@sentry/node-core/light",
  "pdf-lib",
  "@mozilla/readability",
  "mdast-util-from-markdown",
  "dompurify",
  "undici",
  "p-queue",
  "fflate",
] as const;

/** One import, timed in one process that had never seen it. */
export interface Reading {
  specifier: string;
  ms: number;
  pid: number;
  rssBytes: number;
}

/** What `spawnSync` gives back, narrowed to the parts that decide anything. */
export interface ChildResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/**
 * The prefix the child puts in front of its one line of JSON.
 *
 * Not "parse the whole of stdout": a dependency is free to print a deprecation
 * notice on its way in, and a harness that then reported a parse failure — or,
 * worse, silently skipped the import — would be blaming the wrong thing.
 */
const SENTINEL = "__BENCH__";

/**
 * The program each child runs. One import, one number, one line.
 *
 * `process.memoryUsage().rss` rather than `process.resourceUsage().maxRSS`,
 * which is genuinely the *peak* and is genuinely what you want — and whose unit
 * is **kilobytes on Linux and bytes on macOS**. A benchmark that reports a
 * thousandfold difference between Greg's Mac and this box, with no error and no
 * warning, is the exact shape this file exists to refuse. RSS at the end of the
 * import is a smaller claim that is the same on both.
 */
function childProgram(specifier: string): string {
  return [
    "const t0 = performance.now();",
    `await import(${JSON.stringify(specifier)});`,
    "const ms = performance.now() - t0;",
    `process.stdout.write("${SENTINEL}" + JSON.stringify({`,
    "  ms, pid: process.pid, rssBytes: process.memoryUsage().rss",
    '}) + "\\n");',
  ].join("\n");
}

/**
 * **The bundle exists, is the real one, and is not older than what built it.**
 *
 * Staleness is the quiet failure: a bundle from before your change imports
 * happily and reports the number you were trying to move, so a Stage 4 "after"
 * would be an "before" with a new label on it. The comparison is against every
 * file under `src/` plus the build config — `src/web/` included, because it
 * reaches the API build through the compiled client shell.
 *
 * @param root the repository root, so this can be pointed at a fixture
 */
export function assertBundleReady(root: string): { path: string; bytes: number } {
  const bundle = path.join(root, BUNDLE);
  let bytes: number;
  let builtAt: number;
  try {
    const stat = statSync(bundle);
    bytes = stat.size;
    builtAt = stat.mtimeMs;
  } catch {
    throw new Error(
      `no ${BUNDLE} to measure — run \`npm run build:api\` first, or this harness measures nothing`,
    );
  }
  if (bytes < MIN_BUNDLE_BYTES) {
    throw new Error(
      `${BUNDLE} is ${bytes} bytes, which is not the real bundle — run \`npm run build:api\``,
    );
  }

  const newer = newestSourceAfter(root, builtAt);
  if (newer) {
    throw new Error(
      `${BUNDLE} is stale: ${path.relative(root, newer)} is newer than it. ` +
        "Run `npm run build:api`, or every number below is about the previous build.",
    );
  }
  return { path: bundle, bytes };
}

/** The first source file found that is newer than `builtAt`, or null. */
function newestSourceAfter(root: string, builtAt: number): string | null {
  const candidates = [path.join(root, "vite.api.config.ts")];
  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) candidates.push(full);
    }
  };
  walk(path.join(root, "src"));

  for (const file of candidates) {
    try {
      if (statSync(file).mtimeMs > builtAt) return file;
    } catch {
      /* Deleted under us by another agent's worktree work — not this harness's
         business, and not a reason to refuse. */
    }
  }
  return null;
}

/**
 * **A child's output, or an error saying why there is no number.**
 *
 * Split out from the spawning so every refusal has a test that does not have to
 * start a process to reach it.
 */
export function readingFrom(specifier: string, result: ChildResult): Reading {
  if (result.signal !== null) {
    throw new Error(`measuring ${specifier}: the child was killed by ${result.signal}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `measuring ${specifier}: the child exited ${result.status}\n${result.stderr.trim()}`,
    );
  }

  const line = result.stdout.split("\n").find((l) => l.startsWith(SENTINEL));
  if (line === undefined) {
    throw new Error(
      `measuring ${specifier}: the child exited 0 with no reading on stdout — ` +
        "it imported nothing, or printed somewhere else",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(SENTINEL.length));
  } catch (err) {
    throw new Error(
      `measuring ${specifier}: could not parse the child's reading — ${(err as Error).message}`,
    );
  }

  const { ms, pid, rssBytes } = (parsed ?? {}) as Record<string, unknown>;
  for (const [name, value] of [
    ["ms", ms],
    ["pid", pid],
    ["rssBytes", rssBytes],
  ] as const) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(
        `measuring ${specifier}: the child's \`${name}\` is ${String(value)}, not a number`,
      );
    }
  }

  if ((ms as number) < MIN_PLAUSIBLE_MS) {
    throw new Error(
      `measuring ${specifier}: ${ms} ms is implausibly small (floor ${MIN_PLAUSIBLE_MS} ms). ` +
        "That is what a module already loaded in this process reports, so this is not a measurement.",
    );
  }

  return {
    specifier,
    ms: ms as number,
    pid: pid as number,
    rssBytes: rssBytes as number,
  };
}

/**
 * **Every reading came from its own, fresh process.**
 *
 * The outcome, not the intent. "I called `spawnSync` each time" is a
 * restatement of the code; distinct pids that are none of them this process's
 * is something that would be false if the discipline broke.
 */
export function assertFreshProcesses(readings: readonly Reading[]): void {
  if (readings.length === 0) throw new Error("no readings at all — this measured nothing");
  const seen = new Map<number, string>();
  for (const reading of readings) {
    if (reading.pid === process.pid) {
      throw new Error(
        `${reading.specifier} was measured in the harness's own process (pid ${reading.pid}) — ` +
          "a module imported here is already loaded and would time as zero",
      );
    }
    const previous = seen.get(reading.pid);
    if (previous !== undefined) {
      throw new Error(
        `${reading.specifier} and ${previous} share pid ${reading.pid} — the same process ` +
          "measured both, so the second one is a cache hit rather than an import",
      );
    }
    seen.set(reading.pid, reading.specifier);
  }
}

/** One fresh child, one import, one reading. */
function measure(specifier: string): Reading {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", childProgram(specifier)],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.error) throw new Error(`measuring ${specifier}: ${result.error.message}`);
  return readingFrom(specifier, {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  });
}

/**
 * **How busy the box was**, printed beside every run.
 *
 * This is the Hetzner box, which several agents and their test suites share, and
 * the difference is not a rounding error: the same bundle timed 2.6 s for GPT Sol
 * on a quiet machine and 11.6 s here at a load average of 126 on 16 cores. A
 * number taken under that and presented bare is a lie by omission, and the two
 * places it would do damage are exactly the two this harness is for — a Stage 4
 * "after" measured on a quiet box against a "before" measured on a busy one, and
 * a reader deciding whether 2.6 s is worth attacking.
 *
 * It does **not** refuse a contended run, because on this box that would mean
 * refusing nearly every run. It reports the contention and lets the reader
 * discount the numbers, which is the honest half of the same job.
 */
function loadNote(): string {
  const cores = cpus().length;
  const one = loadavg()[0] ?? 0;
  const per = one / cores;
  const verdict =
    per > 1.5 ? " — CONTENDED, treat these as upper bounds" : " — quiet enough to compare";
  return `load ${one.toFixed(1)} over ${cores} cores (${per.toFixed(2)}/core)${verdict}`;
}

/** The middle reading of a sorted run. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

/** A fixed-width table, widest column first, sorted by cost. */
export function formatTable(rows: { label: string; ms: number; rssBytes: number }[]): string {
  const width = Math.max(...rows.map((r) => r.label.length));
  return rows
    .sort((a, b) => b.ms - a.ms)
    .map(
      (r) =>
        `  ${r.label.padEnd(width)}  ${`${Math.round(r.ms)} ms`.padStart(8)}  ` +
        `${`${Math.round(r.rssBytes / 1_000_000)} MB`.padStart(7)}`,
    )
    .join("\n");
}

async function main(): Promise<void> {
  const bundle = assertBundleReady(ROOT);
  console.log(
    `${BUNDLE}: ${(bundle.bytes / 1_000_000).toFixed(2)} MB, ${RUNS} fresh processes per import`,
  );
  console.log(`${loadNote()}\n`);

  /* The bundle by its file URL rather than a bare specifier, because a bare
     `api-dist/vercel.js` is not a package and would resolve to nothing. */
  const targets: { label: string; specifier: string }[] = [
    { label: `${BUNDLE} (the whole bundle)`, specifier: pathToFileURL(bundle.path).href },
    ...HEAVY_IMPORTS.map((specifier) => ({ label: specifier, specifier })),
  ];

  const all: Reading[] = [];
  const rows: { label: string; ms: number; rssBytes: number }[] = [];
  for (const target of targets) {
    const runs: Reading[] = [];
    for (let i = 0; i < RUNS; i++) runs.push(measure(target.specifier));
    all.push(...runs);
    rows.push({
      label: target.label,
      ms: median(runs.map((r) => r.ms)),
      rssBytes: median(runs.map((r) => r.rssBytes)),
    });
  }

  /* After everything, so a single reused process anywhere in the run fails the
     whole thing rather than one row of it. */
  assertFreshProcesses(all);

  console.log(formatTable(rows));
  console.log(
    "\nNot additive: the bundle's own figure already contains every dependency below it.",
  );
}

if (isMain(import.meta.url)) await main();
