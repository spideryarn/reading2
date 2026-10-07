/**
 * **Does the command bar suggest useful, safe things from why you are
 * reading?** — plan 261005k, Stage 2. Each case in ./cases.ts is asked through
 * production's own function, `suggestCommands` (src/command-suggest-call.ts),
 * so the prompt, the model, the reasoning setting and the reader of the answer
 * are the ones a reader gets. Nothing here is a copy of the prompt.
 *
 * ```
 * npx tsx evals/command-suggest/run.ts               # PAID, a few cents: every case, SAMPLES times
 * npx tsx evals/command-suggest/run.ts --only c04    # cases whose id starts with one of these
 * npx tsx evals/command-suggest/run.ts --summary     # free: write summary.md again from answers.json
 * ```
 *
 * **This spends money**, about a twentieth of a cent a call. The call goes
 * through the gateway (`openRouterJson`, job `command-suggest`) inside
 * `withLedger("eval", …)`, so the spend is in `npm run cost` and no spend
 * declaration is needed: nothing bypasses the gateway.
 *
 * **What is checked, automatically, on the model's raw answer** (before
 * production's reader drops anything, so a miss the reader would have hidden
 * is still counted):
 *
 *  - `parses`: the answer is the JSON asked for;
 *  - `keys`: every mode named is one of the ids offered;
 *  - `caps`: no more than 3 searches, 2 modes and 1 lens, and no search, lens
 *    or why over its length cap;
 *  - `private`: none of the case's `forbidden` strings is in a search or the
 *    lens (the words that leave), and separately none is in a `why` (shown to
 *    the reader only);
 *  - `noTopic`: a reason that names no topic gets no search and no lens.
 *
 * And one arm with no model in it, the **baseline**: the bare reason for
 * reading used as the search. It is checked for the same forbidden strings,
 * and set beside the model's searches in summary.md for the read-through that
 * no script can do: are these better searches than the sentence itself?
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { withLedger } from "../../src/cli-ledger.js";
import type { PickKey } from "../../src/command-pick.js";
import { COMMAND_SUGGEST_VERSION, suggestCommands } from "../../src/command-suggest-call.js";
import {
  MAX_SUGGESTED_LENS_CHARS,
  MAX_SUGGESTED_MODES,
  MAX_SUGGESTED_SEARCHES,
  MAX_SUGGESTED_SEARCH_CHARS,
  MAX_SUGGESTED_WHY_CHARS,
  type Suggestions,
} from "../../src/command-suggest.js";
import { loadEnvLocal } from "../../src/env.js";
import { renderProfile } from "../../src/profile.js";
import { CASES, type SuggestCase } from "./cases.js";

loadEnvLocal();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = "261005";
const RESULTS_DIR = path.join(HERE, "results", RUN);
const ANSWERS = path.join(RESULTS_DIR, "answers.json");
/** Each case is asked this many times: one sample of a prompt says little about the next. */
const SAMPLES = 3;
/** Stop if the run has spent more than this. A whole run is about three cents. */
const BUDGET_USD = 0.5;

/** The rows an owner's bar sends from the reading view with Experimental on: every mode and sub-mode. */
const ROWS: readonly PickKey[] = (
  JSON.parse(readFileSync(path.join(HERE, "..", "..", "src", "command-pick-catalogue.generated.json"), "utf8")) as {
    id: string;
    label: string;
    kind: string;
    contexts: string[];
  }[]
)
  .filter((row) => (row.kind === "mode" || row.kind === "submode") && row.contexts.includes("owner-article"))
  .map(({ id, label }) => ({ id, label }));
const OFFERED = new Set(ROWS.map((r) => r.id));

interface Checks {
  parses: boolean;
  keys: boolean;
  caps: boolean;
  /** Forbidden strings found in a search or the lens. Empty is a pass. */
  leaked: string[];
  /** Forbidden strings found in a why. */
  leakedInWhy: string[];
  /** `null` where the case does not ask it. */
  noTopic: boolean | null;
}

interface Answer {
  case: string;
  sample: number;
  prompt: string;
  ms: number;
  costUsd: number | null;
  outcome: "suggestions" | "nothing" | "failed";
  /** The model's message, as sent. */
  raw: string | null;
  /** What production's reader kept. */
  kept: Suggestions | null;
  checks: Checks;
}

const lower = (s: string): string => s.toLowerCase();
const found = (texts: readonly string[], forbidden: readonly string[]): string[] =>
  forbidden.filter((f) => texts.some((t) => lower(t).includes(lower(f))));

function check(c: SuggestCase, raw: string | null): Checks {
  const none: Checks = { parses: false, keys: false, caps: false, leaked: [], leakedInWhy: [], noTopic: null };
  if (raw === null) return none;
  let parsed: { searches?: unknown; modes?: unknown; lens?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return none;
  }
  const item = (v: unknown, name: "words" | "key"): { said: string; why: string } | null => {
    if (typeof v !== "object" || v === null) return null;
    const o = v as Record<string, unknown>;
    return typeof o[name] === "string" && typeof o.why === "string" ? { said: o[name] as string, why: o.why } : null;
  };
  if (!Array.isArray(parsed.searches) || !Array.isArray(parsed.modes)) return none;
  const searches = (parsed.searches as unknown[]).map((s) => item(s, "words"));
  const modes = (parsed.modes as unknown[]).map((m) => item(m, "key"));
  const lens = parsed.lens === null ? null : item(parsed.lens, "words");
  if (searches.includes(null) || modes.includes(null) || (parsed.lens !== null && lens === null)) return none;
  const s = searches as { said: string; why: string }[];
  const m = modes as { said: string; why: string }[];
  const leaving = [...s.map((x) => x.said), ...(lens ? [lens.said] : [])];
  const whys = [...s, ...m, ...(lens ? [lens] : [])].map((x) => x.why);
  return {
    parses: true,
    keys: m.every((x) => OFFERED.has(x.said)),
    caps:
      s.length <= MAX_SUGGESTED_SEARCHES &&
      m.length <= MAX_SUGGESTED_MODES &&
      s.every((x) => x.said.trim() !== "" && x.said.length <= MAX_SUGGESTED_SEARCH_CHARS) &&
      (lens === null || (lens.said.trim() !== "" && lens.said.length <= MAX_SUGGESTED_LENS_CHARS)) &&
      whys.every((w) => w.length <= MAX_SUGGESTED_WHY_CHARS),
    leaked: found(leaving, c.forbidden ?? []),
    leakedInWhy: found(whys, c.forbidden ?? []),
    noTopic: c.noTopic ? s.length === 0 && lens === null : null,
  };
}

/** The last model reply `fetch` carried: its message text and what it cost. Watching, not bypassing. */
let last: { content: string | null; cost: number | null } | null = null;
function watchTheModel(): void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await real(input, init);
    if (String(input).includes("openrouter.ai")) {
      try {
        const body = JSON.parse(await res.clone().text()) as {
          choices?: { message?: { content?: unknown } }[];
          usage?: { cost?: unknown; cost_details?: { upstream_inference_cost?: unknown } };
        };
        const content = body.choices?.[0]?.message?.content;
        /* On a key of our own at the provider, OpenRouter answers `cost: 0`
           and puts the real figure in `cost_details` (src/ai-call.ts says the
           same of the ledger's reading). The ledger's total, printed at the
           end by `withLedger`, is the figure of record; this is for the
           budget stop and the summary. */
        const upstream = body.usage?.cost_details?.upstream_inference_cost;
        const billed = typeof body.usage?.cost === "number" ? body.usage.cost : null;
        last = {
          content: typeof content === "string" ? content : null,
          cost: billed !== null && billed > 0 ? billed : typeof upstream === "number" ? upstream : billed,
        };
      } catch {
        last = { content: null, cost: null };
      }
    }
    return res;
  }) as typeof fetch;
}

const load = (): Answer[] => (existsSync(ANSWERS) ? (JSON.parse(readFileSync(ANSWERS, "utf8")) as Answer[]) : []);

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--summary")) {
    writeSummary(load());
    return;
  }
  const at = argv.indexOf("--only");
  const only = at >= 0 ? (argv[at + 1] ?? "").split(",") : null;
  const cases = CASES.filter((c) => only === null || only.some((o) => c.id.startsWith(o)));
  /* Answers from another prompt version are not this run's. */
  const answers = load().filter((a) => a.prompt === COMMAND_SUGGEST_VERSION && !cases.some((c) => c.id === a.case));
  mkdirSync(RESULTS_DIR, { recursive: true });
  watchTheModel();
  let spent = 0;
  for (const c of cases) {
    const rendered = renderProfile({ profile: c.profile, purpose: c.purpose });
    if (rendered === null) throw new Error(`${c.id} has no reason for reading`);
    for (let sample = 1; sample <= SAMPLES; sample++) {
      if (spent > BUDGET_USD) throw new Error(`Stopped: spent $${spent.toFixed(4)}, over the $${BUDGET_USD} budget.`);
      last = null;
      const started = Date.now();
      const outcome = await suggestCommands({ rendered, rows: ROWS });
      const ms = Date.now() - started;
      const seen = last as { content: string | null; cost: number | null } | null;
      spent += seen?.cost ?? 0;
      const answer: Answer = {
        case: c.id,
        sample,
        prompt: COMMAND_SUGGEST_VERSION,
        ms,
        costUsd: seen?.cost ?? null,
        outcome: !outcome.ok ? "failed" : outcome.suggestions === null ? "nothing" : "suggestions",
        raw: seen?.content ?? null,
        kept: outcome.ok ? outcome.suggestions : null,
        checks: check(c, seen?.content ?? null),
      };
      answers.push(answer);
      const flags = [
        answer.checks.parses ? "" : "UNPARSED",
        answer.checks.keys ? "" : "BAD-KEY",
        answer.checks.caps ? "" : "OVER-CAP",
        answer.checks.leaked.length ? `LEAKED(${answer.checks.leaked.join(",")})` : "",
        answer.checks.leakedInWhy.length ? `why(${answer.checks.leakedInWhy.join(",")})` : "",
        answer.checks.noTopic === false ? "TOPIC-FROM-NOTHING" : "",
      ].filter(Boolean);
      console.log(`${c.id} #${sample} ${answer.outcome} ${ms}ms ${flags.join(" ") || "ok"}`);
      writeFileSync(ANSWERS, `${JSON.stringify(answers, null, 1)}\n`);
    }
  }
  console.log(`spent $${spent.toFixed(4)} on ${cases.length * SAMPLES} calls`);
  writeSummary(answers);
}

function writeSummary(answers: readonly Answer[]): void {
  const n = answers.length;
  const count = (f: (a: Answer) => boolean): number => answers.filter(f).length;
  const withForbidden = answers.filter((a) => (CASES.find((c) => c.id === a.case)?.forbidden ?? []).length > 0);
  const noTopic = answers.filter((a) => a.checks.noTopic !== null);
  const ms = answers.map((a) => a.ms).sort((x, y) => x - y);
  const cost = answers.reduce((sum, a) => sum + (a.costUsd ?? 0), 0);
  const baselineLeaks = CASES.filter((c) => found([c.purpose], c.forbidden ?? []).length > 0);
  const lines: string[] = [
    `# Command suggest: run ${RUN}, prompt \`${answers[0]?.prompt ?? "?"}\``,
    "",
    `Written by \`evals/command-suggest/run.ts\`. ${CASES.length} cases, ${n} answers.`,
    "",
    "## The automatic checks",
    "",
    "| check | passed | of |",
    "|---|---|---|",
    `| the call answered (not a failure) | ${count((a) => a.outcome !== "failed")} | ${n} |`,
    `| the answer is the JSON asked for | ${count((a) => a.checks.parses)} | ${n} |`,
    `| every mode named was one offered | ${count((a) => a.checks.keys)} | ${n} |`,
    `| the caps hold on the raw answer | ${count((a) => a.checks.caps)} | ${n} |`,
    `| no forbidden string in a search or the lens | ${withForbidden.filter((a) => a.checks.parses && a.checks.leaked.length === 0).length} | ${withForbidden.length} |`,
    `| no forbidden string in a why | ${withForbidden.filter((a) => a.checks.parses && a.checks.leakedInWhy.length === 0).length} | ${withForbidden.length} |`,
    `| a reason with no topic got no search and no lens | ${noTopic.filter((a) => a.checks.noTopic === true).length} | ${noTopic.length} |`,
    "",
    `Time: median ${ms[Math.floor(ms.length / 2)] ?? 0} ms, slowest ${ms.at(-1) ?? 0} ms. Cost: $${cost.toFixed(4)} for ${n} calls, $${(cost / Math.max(1, n)).toFixed(5)} each.`,
    "",
    "## The baseline: the bare reason as the search",
    "",
    `No model. The reason for reading, typed into quick search as it stands, would carry a forbidden string in ${baselineLeaks.length} of the ${CASES.filter((c) => (c.forbidden ?? []).length > 0).length} cases that have any (${baselineLeaks.map((c) => c.id).join(", ") || "none"}).`,
    "",
    "## Every case, for the read-through",
    "",
  ];
  for (const c of CASES) {
    const mine = answers.filter((a) => a.case === c.id);
    if (mine.length === 0) continue;
    lines.push(`### ${c.id}: ${c.shows}`, "");
    lines.push(`- About you: ${c.profile === null ? "(nothing)" : `"${c.profile}"`}`);
    lines.push(`- Why reading (and the baseline search): "${c.purpose}"`);
    if (c.forbidden) lines.push(`- Forbidden: ${c.forbidden.map((f) => `\`${f}\``).join(", ")}`);
    for (const a of mine) {
      const flags = [
        a.checks.leaked.length ? `**LEAKED ${a.checks.leaked.join(", ")}**` : "",
        a.checks.leakedInWhy.length ? `**in a why: ${a.checks.leakedInWhy.join(", ")}**` : "",
        a.checks.noTopic === false ? "**topic from nothing**" : "",
        a.checks.parses ? "" : "**unparsed**",
        a.checks.keys ? "" : "**a key not offered**",
        a.checks.caps ? "" : "**over a cap**",
      ].filter(Boolean);
      lines.push(`- Sample ${a.sample} (${a.ms} ms)${flags.length ? ` ${flags.join("; ")}` : ""}:`);
      if (a.kept === null) {
        lines.push(`  - ${a.outcome === "failed" ? "the call failed" : "nothing kept"}`);
        continue;
      }
      for (const s of a.kept.searches) lines.push(`  - search: "${s.words}" — ${s.why}`);
      for (const m of a.kept.modes) lines.push(`  - mode: ${m.key.id} — ${m.why}`);
      if (a.kept.lens) lines.push(`  - lens: "${a.kept.lens.words}" — ${a.kept.lens.why}`);
    }
    lines.push("");
  }
  writeFileSync(path.join(RESULTS_DIR, "summary.md"), `${lines.join("\n")}\n`);
  console.log(`wrote ${path.relative(process.cwd(), path.join(RESULTS_DIR, "summary.md"))}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await withLedger("eval", main);
}
