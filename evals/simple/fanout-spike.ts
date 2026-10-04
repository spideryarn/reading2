/**
 * **Simple's cost spike: how should one press's three levels share the
 * article?** — docs/plans/261001j-simple-press-cost-and-latency.md.
 *
 *   npx tsx evals/simple/fanout-spike.ts report                      # free
 *
 * **`report` only, since 2026-10-04.** The arms below were measured while a
 * press wrote three levels. The middle one is gone
 * (docs/plans/261004f-stop-writing-the-simple-summary-level.md), so an arm
 * refuses to run; what follows describes what was measured.
 *
 * Arms, each a whole press of three levels at `high` effort, no profile:
 *
 * - `parallel`        — today: three calls at once, no cache marker.
 * - `parallel-marked` — three at once with the article marked: the fan-out
 *                       the caching doc says pays three writes.
 * - `stagger-text`    — marked; Fuller first, the other two once its first
 *                       text arrives (all `MeteredCall` exposes today).
 * - `stagger-start`   — marked; the other two once Fuller's stream has begun
 *                       (`message_start`). Needs `onStart` on `MeteredCall`;
 *                       refuses to run without it.
 * - `one-call`        — one call writing all three, Fuller → Simple → Brief,
 *                       streamed; the time each level's JSON is complete is
 *                       recorded, which is when it could first be shown.
 *
 * Built from production's own pieces — the level prompts, the article
 * rendering, `streamMessage`, `buildLevel` and the fidelity checker — so
 * nothing in `src/` changes to measure it. No retries: a level that fails
 * validation is recorded as failed, because the failure rate is a result.
 * Every call is an `ai_calls` row with an `eval` scope. Runs go one at a time,
 * so the latencies are not measuring each other.
 *
 * Output: `evals/results/simple-fanout/<arm>/<slug>-<n>.json`.
 */
import fs from "node:fs";
import path from "node:path";

const REPO = path.join(import.meta.dirname, "..", "..");
const OUT = path.join(REPO, "evals", "results", "simple-fanout");
/** The levels the results on disk recorded: three, as a press then wrote. */
const LEVELS = ["brief", "simple", "fuller"] as const;
type Level = (typeof LEVELS)[number];
const ARMS = ["parallel", "parallel-marked", "stagger-text", "stagger-start", "one-call"] as const;
type Arm = (typeof ARMS)[number];

interface CallTiming {
  levels: Level[];
  startMs: number;
  firstTextMs: number | null;
  doneMs: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}
interface LevelResult {
  ok: boolean;
  error?: string;
  words?: number;
  paragraphs?: number;
  /** When this level's text was complete, from the press's start. */
  readyMs: number | null;
  check?: string;
  flags?: number;
}
interface RunFile {
  arm: Arm;
  cold: boolean;
  slug: string;
  run: number;
  at: string;
  wallMs: number;
  /** Writer calls only. Guard calls are recorded in the ledger but kept out of the arm comparison. */
  costUsd: number | null;
  calls: CallTiming[];
  levels: Partial<Record<Level, LevelResult>>;
  reasoningTokens: number | null;
  /** The paragraphs, for reading. */
  text: Partial<Record<Level, unknown>>;
}

/**
 * **The paid half is gone** (2026-10-04,
 * docs/plans/261004f-stop-writing-the-simple-summary-level.md). Every arm was a
 * press of three levels built from production's own level prompts, and the
 * middle one no longer exists, so no arm can be run as it was measured. The
 * code is in git: `git show 1698c6448:evals/simple/fanout-spike.ts`. `report`
 * still reads the results it wrote.
 */
function runArm(arm: Arm): never {
  throw new Error(
    `fanout-spike: the "${arm}" arm was a press of three levels, and the middle level was removed on 2026-10-04 ` +
      "(docs/plans/261004f-stop-writing-the-simple-summary-level.md). It cannot be re-run; `report` still works.",
  );
}

function report(): void {
  const rows: string[] = ["| arm | runs | $ / press | first level s (median) | all s (median, max) | cache read / write tokens | valid levels | flagged levels | reasoning tok (median) |", "|---|---:|---:|---:|---:|---|---:|---:|---:|"];
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length === 0 ? NaN : s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
  };
  for (const arm of [...ARMS, ...ARMS.map((a) => `cold-${a}`)]) {
    const dir = path.join(OUT, arm);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as RunFile);
    if (files.length === 0) continue;
    const costs = files.map((f) => f.costUsd).filter((c): c is number => c !== null);
    const first = files.map((f) => Math.min(...LEVELS.map((l) => f.levels[l]?.readyMs ?? Infinity)) / 1000);
    const all = files.map((f) => f.wallMs / 1000);
    const read = files.reduce((n, f) => n + f.calls.reduce((m, c) => m + c.cacheRead, 0), 0);
    const write = files.reduce((n, f) => n + f.calls.reduce((m, c) => m + c.cacheWrite, 0), 0);
    const valid = files.reduce((n, f) => n + LEVELS.filter((l) => f.levels[l]?.ok).length, 0);
    const flagged = files.reduce((n, f) => n + LEVELS.filter((l) => f.levels[l]?.check === "flagged").length, 0);
    const reasoning = files.map((f) => f.reasoningTokens).filter((r): r is number => r !== null);
    rows.push(
      `| ${arm} | ${files.length} | ${(costs.reduce((a, b) => a + b, 0) / Math.max(costs.length, 1)).toFixed(4)} | ${med(first).toFixed(1)} | ${med(all).toFixed(1)}, ${Math.max(...all).toFixed(1)} | ${Math.round(read / files.length)} / ${Math.round(write / files.length)} per press | ${valid} / ${files.length * 3} | ${flagged} | ${Math.round(med(reasoning))} |`,
    );
  }
  console.log(rows.join("\n"));
}

const [cmd, runsArg, ...slugs] = process.argv.slice(2);
if (cmd === "report") report();
else if ((ARMS as readonly string[]).includes(cmd ?? "") && Number(runsArg) > 0 && slugs.length > 0) {
  runArm(cmd as Arm);
}
else {
  console.error("usage: fanout-spike.ts report");
  process.exit(1);
}
