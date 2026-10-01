/**
 * **Simple's cost spike: how should one press's three levels share the
 * article?** — docs/plans/261001j-simple-press-cost-and-latency.md.
 *
 *   npx tsx evals/simple/fanout-spike.ts <arm> <runs> <slug>...     # paid
 *   npx tsx evals/simple/fanout-spike.ts report                      # free
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
import { randomUUID } from "node:crypto";

import { loadEnvLocal } from "../../src/env.js";

const REPO = path.join(import.meta.dirname, "..", "..");
const OUT = path.join(REPO, "evals", "results", "simple-fanout");
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

async function runArm(arm: Arm, runs: number, slugs: string[], cold: boolean): Promise<void> {
  /* `--cold`: every press opens with its own marker, so no press can read a
     cache an earlier one left (the first batch's marked arms mostly did). */
  const dirName = cold ? `cold-${arm}` : arm;
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const simple = await import("../../src/simple-summary.js");
  const { articleWithIds } = await import("../../src/article-prompt.js");
  const { isBodyEvidence } = await import("../../src/block-policy.js");
  const { streamMessage } = await import("../../src/messages-stream.js");
  const { effortFor } = await import("../../src/models.js");
  const { budgetFor } = await import("../../src/token-budget.js");
  const { parseJsonAnswer } = await import("../../src/parse-json.js");
  const { checkLevel } = await import("../../src/simple-check.js");
  const { collectSpend } = await import("../../src/ai-spend.js");
  const { costStore } = await import("../../src/store/ai-calls.js");
  const { closeDb } = await import("../../src/db/client.js");
  fs.mkdirSync(path.join(OUT, dirName), { recursive: true });

  await runAsOwner(environmentOwnerId(), async () => {
    for (const slug of slugs) {
      const article = await loadArticle(slug);
      const evidence = article.blocks.filter(isBodyEvidence);
      const evidenceIds = new Set(evidence.map((b) => b.id as string));
      const textOf = new Map(evidence.map((b) => [b.id as string, b.text]));
      const meta = article.meta ?? ({ title: slug } as never);
      const articleText = articleWithIds(meta, evidence);
      const user = simple.renderPrompt(null);
      const marked = arm !== "parallel";

      for (let n = 1; n <= runs; n++) {
        const out = path.join(OUT, dirName, `${slug}-${n}.json`);
        if (fs.existsSync(out)) {
          console.log(`skip ${path.relative(REPO, out)}`);
          continue;
        }
        const nonce = `press ${randomUUID()}`;
        const t0 = Date.now();
        const at = () => Date.now() - t0;
        const calls: CallTiming[] = [];
        const raws: Partial<Record<Level, string>> = {};
        const ready: Partial<Record<Level, number>> = {};
        let reasoning: number | null = 0;
        let costUsd: number | null = null;

        const ask = (system: string, levels: Level[], maxTokens: number, onDelta?: (all: string) => void) => {
          const timing: CallTiming = { levels, startMs: at(), firstTextMs: null, doneMs: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
          calls.push(timing);
          const call = streamMessage(
            "simple",
            {
              max_tokens: maxTokens,
              thinking: { type: "adaptive" },
              output_config: { effort: effortFor("simple") },
              system: [
                ...(cold ? [{ type: "text" as const, text: nonce }] : []),
                { type: "text" as const, text: articleText, ...(marked ? { cache_control: { type: "ephemeral" as const } } : {}) },
                { type: "text" as const, text: system },
              ],
              messages: [{ role: "user", content: user }],
            },
            { power: "standard" },
          );
          let all = "";
          type StartState = "started" | "ended" | "failed";
          let markStarted: (state: StartState) => void = () => {};
          const started = new Promise<StartState>((resolve) => {
            markStarted = resolve;
            const withStart = call as unknown as { onStart?: (l: () => void) => void };
            if (arm === "stagger-start") {
              if (!withStart.onStart) throw new Error("stagger-start needs MeteredCall.onStart");
              withStart.onStart(() => markStarted("started"));
            }
            call.onText((d) => {
              if (timing.firstTextMs === null) {
                timing.firstTextMs = at();
                if (arm !== "stagger-start") markStarted("started");
              }
              all += d;
              onDelta?.(all);
            });
          });
          const done = call.finalMessage().then((m) => {
            timing.doneMs = at();
            timing.input = m.usage.input_tokens;
            timing.cacheRead = m.usage.cache_read_input_tokens ?? 0;
            timing.cacheWrite = m.usage.cache_creation_input_tokens ?? 0;
            timing.output = m.usage.output_tokens;
            return m.content.map((b) => (b.type === "text" ? b.text : "")).join("");
          });
          /* Production releases its gate when a successful call ends without
             the expected raw event. The spike must not hang on that same path;
             a rejection also releases the timing gate so `press` can report
             the actual call failure. */
          void done.then(
            () => markStarted("ended"),
            () => markStarted("failed"),
          );
          return { started, done };
        };

        const perLevelBudget = budgetFor("simple", simple.ANSWER_TOKENS);
        const press = async () => {
          if (arm === "one-call") {
            const order: Level[] = ["fuller", "simple", "brief"];
            const system = oneCallSystem(simple.SIMPLE_SYSTEMS);
            const { done } = ask(system, order, budgetFor("simple", simple.ANSWER_TOKENS * 3), (all) => {
              /* A level is ready when the next level's key has begun, or the answer has ended. */
              for (let i = 0; i < order.length - 1; i++) {
                const lvl = order[i]!;
                if (ready[lvl] === undefined && all.includes(`"${order[i + 1]}"`)) ready[lvl] = at();
              }
            });
            const raw = await done;
            ready.brief ??= at();
            for (const l of order) ready[l] ??= at();
            let parsed: Record<string, unknown> = {};
            try {
              parsed = parseJsonAnswer<Record<string, unknown>>(raw, "one-call answer");
            } catch {
              /* left empty: every level fails validation below */
            }
            for (const l of order) raws[l] = JSON.stringify(parsed[l] ?? null);
            return;
          }
          const one = (level: Level) =>
            ask(simple.SIMPLE_SYSTEMS[level], [level], perLevelBudget).done.then((raw) => {
              raws[level] = raw;
              ready[level] = at();
            });
          if (arm === "parallel" || arm === "parallel-marked") {
            await Promise.all(LEVELS.map(one));
            return;
          }
          /* Staggered: Fuller (the slowest) first; the others when it has begun. */
          const first = ask(simple.SIMPLE_SYSTEMS.fuller, ["fuller"], perLevelBudget);
          const fullerDone = first.done.then((raw) => {
            raws.fuller = raw;
            ready.fuller = at();
          });
          const firstState = await first.started;
          /* Do not turn a failed first request into two more paid calls. */
          if (firstState === "failed") await fullerDone;
          await Promise.all([fullerDone, one("simple"), one("brief")]);
        };

        let levels: RunFile["levels"] = {};
        const text: RunFile["text"] = {};
        try {
          await collectSpend(press, {
            attribution: { scopeKind: "eval", ownerId: environmentOwnerId() },
            sink: (row) => costStore.record(row),
            onDone: (report) => {
              let nanos = 0;
              let priced = true;
              for (const c of report.calls) {
                const cost = c.cost as { source: string; costNanos?: number; computedCostNanos?: number };
                const v = cost.source === "provider" ? cost.costNanos : cost.source === "computed" ? cost.computedCostNanos : undefined;
                if (v === undefined) priced = false;
                else nanos += v;
                reasoning = c.reasoningTokens === null || reasoning === null ? null : reasoning + c.reasoningTokens;
              }
              costUsd = priced ? nanos / 1e9 : null;
            },
          });
        } catch (err) {
          levels = { brief: { ok: false, error: `press: ${String(err).slice(0, 200)}`, readyMs: null } };
        }
        const wallMs = at();

        /* Validate and check each level, outside the timed press (the guard's own
           latency is measured in 261001h and 261001i). */
        /* A separate collector keeps quick-tier checker cost out of the writer
           arm comparison while still putting every paid check in `ai_calls`.
           The original spike called these after the writer collector closed,
           so they were paid but explicitly dropped as unscoped. */
        await collectSpend(
          async () => {
            await Promise.all(
              LEVELS.map(async (level) => {
                if (levels[level]) return;
                const raw = raws[level];
                if (raw === undefined) {
                  levels[level] = { ok: false, error: "no answer", readyMs: null };
                  return;
                }
                try {
                  const paragraphs = simple.buildLevel(parseJsonAnswer<unknown>(raw, level), level, evidenceIds, simple.emptyDropped());
                  text[level] = paragraphs;
                  const checked = await checkLevel(paragraphs, textOf);
                  levels[level] = {
                    ok: true,
                    words: simple.paragraphWords(paragraphs),
                    paragraphs: paragraphs.length,
                    readyMs: ready[level] ?? null,
                    check: checked.outcome.kind === "failed" ? `failed:${checked.outcome.failure}` : checked.outcome.kind,
                    flags: checked.outcome.kind === "flagged" ? checked.outcome.flags.length : 0,
                  };
                } catch (err) {
                  levels[level] = { ok: false, error: String(err).slice(0, 200), readyMs: ready[level] ?? null };
                }
              }),
            );
          },
          {
            attribution: { scopeKind: "eval", ownerId: environmentOwnerId(), articleSlug: slug },
            sink: (row) => costStore.record(row),
          },
        );
        const file: RunFile = { arm, cold, slug, run: n, at: new Date(t0).toISOString(), wallMs, costUsd, calls, levels, reasoningTokens: reasoning, text };
        fs.writeFileSync(out, `${JSON.stringify(file, null, 1)}\n`);
        const firstReady = Math.min(...LEVELS.map((l) => levels[l]?.readyMs ?? Infinity));
        console.log(
          `${arm} ${slug} #${n}: $${(costUsd as number | null)?.toFixed(4) ?? "?"}, first level ${(firstReady / 1000).toFixed(1)}s, all ${(wallMs / 1000).toFixed(1)}s, ` +
            `cache read ${calls.map((c) => c.cacheRead).join("/")}, write ${calls.map((c) => c.cacheWrite).join("/")}, ` +
            LEVELS.map((l) => `${l}:${levels[l]?.ok ? levels[l]?.check : "FAIL"}`).join(" "),
        );
      }
    }
  });
  await closeDb();
}

/** The three level prompts as one, each version's spec under its name, and one JSON shape out. */
function oneCallSystem(systems: Record<Level, string>): string {
  const spec = (level: Level) => (systems[level].split("\n\nOUTPUT\n\n")[0] ?? "").trim();
  return `You will write THREE versions of the same orientation, each to its own specification below, in this order: "fuller", then "simple", then "brief". Each version stands alone: none refers to another.

=== VERSION "fuller" ===

${spec("fuller")}

=== VERSION "simple" ===

${spec("simple")}

=== VERSION "brief" ===

${spec("brief")}

OUTPUT

JSON only, no prose, no code fence, the three versions in this order:

{"fuller": {"paragraphs": [{"text": "...", "ids": ["spya-k3m9qt"]}]},
 "simple": {"paragraphs": [...]},
 "brief": {"paragraphs": [...]}}

Plain text in "text": no markdown, no bullet points, no headings. Never put a
real line break inside a string, and escape any straight double quote as \\".`;
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
  const cold = slugs.includes("--cold");
  await runArm(cmd as Arm, Number(runsArg), slugs.filter((x) => x !== "--cold"), cold);
}
else {
  console.error(`usage: fanout-spike.ts <${ARMS.join("|")}> <runs> <slug>... | report`);
  process.exit(1);
}
