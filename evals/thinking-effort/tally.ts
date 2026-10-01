/**
 * **Unblind the judges and apply plan 261001p's decision rule** — free, no
 * model calls.
 *
 *   npx tsx evals/thinking-effort/tally.ts --results <dir> --mode sketch|ideas|illustrated
 *
 * Reads the two verdicts in `<dir>/judging/<mode>/` — `verdict-rank.json` (the
 * ranking judge) and `verdict-score.json` (the scoring judge) — and the keys
 * beside them, and prints, per judge, the per-article U and the mode's mean U,
 * then the saving from `runs.<mode>.jsonl`. The rule is the plan's, restated
 * here only as numbers so that nobody can move it after seeing the results:
 * docs/plans/261001p-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md
 * § The measure, and the decision rule.
 *
 * U, per article: of the four (candidate, base) pairs, how many the candidate
 * wins, a tie counting ½. "Candidate" is whichever non-base level the lineup
 * holds (low, or medium in a second round).
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { isMain } from "../../src/is-main.js";

/** The plan's thresholds. Do not edit after the results are in. */
export const CLEAR_LOSS = 1.1;
export const POSSIBLE_LOSS = 1.5;
export const MIN_SAVING = 1 / 3;
export const TYPICAL_MAX_CHARS = 100_000;

type Key = Record<string, string>; // label -> arm, e.g. { W: "low-a" }

/** U from a quality value per arm (higher is better). */
export function uStatistic(quality: Record<string, number>): number {
  const arms = Object.keys(quality);
  const base = arms.filter((a) => a.startsWith("base-"));
  const cand = arms.filter((a) => !a.startsWith("base-"));
  if (base.length !== 2 || cand.length !== 2) {
    throw new Error(`expected two base and two candidate arms, got ${arms.join(", ")}`);
  }
  let u = 0;
  for (const c of cand) {
    for (const b of base) {
      const qc = quality[c] as number;
      const qb = quality[b] as number;
      u += qc > qb ? 1 : qc === qb ? 0.5 : 0;
    }
  }
  return u;
}

/** A ranking (best tier first) as a quality value per label: higher is better. */
export function qualityFromRanking(ranking: string[][]): Record<string, number> {
  const q: Record<string, number> = {};
  ranking.forEach((tier, i) => {
    for (const label of tier) q[label] = -i;
  });
  return q;
}

export function verdictOf(meanU: number): "clear loss" | "possible loss" | "no visible loss" {
  if (meanU <= CLEAR_LOSS) return "clear loss";
  if (meanU <= POSSIBLE_LOSS) return "possible loss";
  return "no visible loss";
}

function relabel(q: Record<string, number>, key: Key): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [label, value] of Object.entries(q)) {
    const arm = key[label];
    if (!arm) throw new Error(`label ${label} is not in the key`);
    out[arm] = value;
  }
  if (Object.keys(out).length !== Object.keys(key).length) {
    throw new Error(`the verdict names ${Object.keys(out).length} candidates, the key ${Object.keys(key).length}`);
  }
  return out;
}

interface RankVerdict {
  articles: { slug: string; ranking: string[][] }[];
}
interface ScoreVerdict {
  articles: { slug: string; candidates: Record<string, { scores: Record<string, number> }> }[];
}
interface Row {
  mode: string;
  arm: string;
  slug: string;
  chars: number;
  valid: boolean;
  thinkingTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  listUsd?: number | null;
  latencyMs: number;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf-8")) as T;
}

async function keyFor(dir: string, slug: string): Promise<Key> {
  return readJson<Key>(path.join(dir, "keys", `key-${slug}.json`));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const results = argv[argv.indexOf("--results") + 1];
  const mode = argv[argv.indexOf("--mode") + 1];
  if (!results || !mode || argv.indexOf("--results") < 0 || argv.indexOf("--mode") < 0) {
    throw new Error("usage: tally.ts --results <dir> --mode <mode> [--judging <subdir>]");
  }
  /* `--judging <subdir>` for a second round kept beside the first, e.g.
     `judging/illustrated-low/` next to the medium round's `judging/illustrated/`. */
  const judgingAt = argv.indexOf("--judging");
  const dir = path.join(results, "judging", judgingAt >= 0 ? (argv[judgingAt + 1] ?? mode) : mode);
  const out: Record<string, unknown> = { mode };
  const lines: string[] = [`# ${mode}`, ""];

  const judges: [string, () => Promise<Record<string, Record<string, number>>>][] = [
    [
      "rank",
      async () => {
        const v = await readJson<RankVerdict>(path.join(dir, "verdict-rank.json"));
        const per: Record<string, Record<string, number>> = {};
        for (const a of v.articles) per[a.slug] = relabel(qualityFromRanking(a.ranking), await keyFor(dir, a.slug));
        return per;
      },
    ],
    [
      "score",
      async () => {
        const v = await readJson<ScoreVerdict>(path.join(dir, "verdict-score.json"));
        const per: Record<string, Record<string, number>> = {};
        for (const a of v.articles) {
          const q: Record<string, number> = {};
          for (const [label, c] of Object.entries(a.candidates)) {
            const s = Object.values(c.scores);
            if (s.length !== 5 || s.some((x) => !Number.isInteger(x) || x < 1 || x > 5)) {
              throw new Error(`${a.slug} ${label}: incomplete or out-of-range scores`);
            }
            q[label] = s.reduce((x, y) => x + y, 0);
          }
          per[a.slug] = relabel(q, await keyFor(dir, a.slug));
        }
        return per;
      },
    ],
  ];

  const verdicts: string[] = [];
  for (const [name, load] of judges) {
    let per: Record<string, Record<string, number>>;
    try {
      per = await load();
    } catch (err) {
      lines.push(`**${name}**: not available — ${(err as Error).message}`, "");
      out[name] = null;
      verdicts.push("undecided");
      continue;
    }
    const us = Object.entries(per).map(([slug, q]) => ({ slug, u: uStatistic(q), q }));
    if (us.length !== 8) lines.push(`**${name}: ${us.length} articles, not 8 — undecided.**`);
    const mean = us.reduce((s, x) => s + x.u, 0) / us.length;
    const verdict = us.length === 8 ? verdictOf(mean) : "undecided";
    verdicts.push(verdict);
    out[name] = { meanU: mean, verdict, articles: us };
    lines.push(`**${name}**: mean U = ${mean.toFixed(2)} → ${verdict}`, "");
    lines.push("| article | U | quality by arm |", "|---|---:|---|");
    for (const x of us) {
      lines.push(
        `| ${x.slug} | ${x.u} | ${Object.entries(x.q)
          .sort()
          .map(([a, v]) => `${a} ${v}`)
          .join(", ")} |`,
      );
    }
    lines.push("");
  }
  const order = ["undecided", "clear loss", "possible loss", "no visible loss"];
  const combined = verdicts.reduce((w, v) => (order.indexOf(v) < order.indexOf(w) ? v : w), "no visible loss");
  out.combined = combined;
  lines.push(`**Combined (worse of the two)**: ${combined}`, "");

  // Savings and validity.
  const rowsFile = path.join(results, `runs.${mode}.jsonl`);
  const rows = (await readFile(rowsFile, "utf-8"))
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Row)
    .filter((r) => r.mode === mode);
  /* The candidate level is whatever the judged lineups held — read off their
     keys, never guessed from which rows exist: the JSONL keeps every round, so
     "any low rows → low" reported low's cost under the medium round's verdict
     (GPT Sol, decision review D2). */
  const someKey = await keyFor(dir, (await readJson<RankVerdict>(path.join(dir, "verdict-rank.json"))).articles[0]?.slug ?? "");
  const candidateArms = Object.values(someKey).filter((a) => !a.startsWith("base-"));
  const candPrefix = candidateArms[0]?.replace(/-[ab]$/, "-") ?? "low-";
  const judgedArms = new Set(Object.values(someKey));
  const bySlug = new Map<string, Row[]>();
  for (const r of rows.filter((x) => judgedArms.has(x.arm))) bySlug.set(r.slug, [...(bySlug.get(r.slug) ?? []), r]);
  const invalid = rows.filter((r) => !r.valid && judgedArms.has(r.arm)).map((r) => `${r.slug} ${r.arm}`);
  const mean = (xs: (number | null)[]): number | null =>
    xs.some((x) => x == null) || xs.length === 0 ? null : (xs as number[]).reduce((a, b) => a + b, 0) / xs.length;
  lines.push("| article | chars | arm | thinking (mean) | output (mean) | $ (mean) | latency s (mean) |", "|---|---:|---|---:|---:|---:|---:|");
  const reductions: (number | null)[] = [];
  const perArticle: unknown[] = [];
  for (const [slug, rs] of bySlug) {
    const group = (p: string) => rs.filter((r) => r.arm.startsWith(p));
    const cand = candPrefix;
    const stats = (p: string) => {
      const g = group(p);
      return {
        thinking: mean(g.map((r) => r.thinkingTokens)),
        output: mean(g.map((r) => r.outputTokens)),
        usd: mean(g.map((r) => r.costUsd)),
        latency: mean(g.map((r) => r.latencyMs / 1000)),
      };
    };
    const b = stats("base-");
    const c = stats(cand);
    const chars = rs[0]?.chars ?? 0;
    for (const [name, s] of [["base", b], [cand.slice(0, -1), c]] as const) {
      lines.push(
        `| ${slug} | ${chars} | ${name} | ${s.thinking?.toFixed(0)} | ${s.output?.toFixed(0)} | ${s.usd?.toFixed(3)} | ${s.latency?.toFixed(0)} |`,
      );
    }
    const reduction = b.thinking && c.thinking != null ? 1 - c.thinking / b.thinking : null;
    if (chars < TYPICAL_MAX_CHARS) reductions.push(reduction);
    perArticle.push({ slug, chars, base: b, candidate: c, thinkingReduction: reduction });
  }
  const typical = reductions.filter((x): x is number => x != null).sort((a, b) => a - b);
  const median =
    reductions.some((x) => x == null) || typical.length === 0
      ? null
      : typical.length % 2
        ? (typical[(typical.length - 1) / 2] as number)
        : ((typical[typical.length / 2 - 1] as number) + (typical[typical.length / 2] as number)) / 2;
  out.savings = { perArticle, medianTypicalThinkingReduction: median, invalid };
  lines.push(
    "",
    `**Median thinking reduction, articles under ${TYPICAL_MAX_CHARS / 1000}k characters**: ${
      median == null ? "missing → gate fails" : `${(median * 100).toFixed(0)}%`
    } (gate: ≥ ${(MIN_SAVING * 100).toFixed(0)}%)`,
    `**Invalid draws**: ${invalid.length ? invalid.join("; ") : "none"}`,
    "",
  );
  /* Validity, two ways. The plan's first wording ("every candidate draw
     validated") turned out to fail production's own effort too, which the run
     found before any judging; the plan's mid-run note (19:47) fixed the reading
     to "no more invalid candidate draws than base draws". Both are printed, so
     the literal one is never quietly dropped. */
  const invalidCand = invalid.filter((x) => !x.includes(" base-")).length;
  const invalidBase = invalid.length - invalidCand;
  const saving = median != null && median >= MIN_SAVING;
  const literal = saving && invalidCand === 0;
  const compared = saving && invalidCand <= invalidBase;
  out.gatesPass = { literal, compared, invalidCandidate: invalidCand, invalidBase };
  lines.push(
    `**Hard gates**: literal (no invalid candidate draw) ${literal ? "pass" : "FAIL"}; ` +
      `compared (candidate ${invalidCand} invalid ≤ base ${invalidBase}) ${compared ? "pass" : "FAIL"}`,
  );

  await writeFile(path.join(dir, "tally.json"), `${JSON.stringify(out, null, 2)}\n`);
  await writeFile(path.join(dir, "tally.md"), `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
