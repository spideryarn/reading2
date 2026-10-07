/**
 * **The numbers in docs/investigations/261007b-help-chat-model-and-refusals.md**,
 * from the result files `run.ts` wrote. Free: reads files, calls nothing.
 *
 * ```
 * npx tsx evals/help-chat/summarise.ts
 * ```
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Row } from "./run.js";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "results", "261007b");

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? Number.NaN : (s[Math.floor((s.length - 1) / 2)] ?? Number.NaN);
};

for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()) {
  const rows = JSON.parse(readFileSync(path.join(DIR, file), "utf8")) as Row[];
  const cold = rows.filter((r) => (r.cachedTokens ?? 0) === 0);
  const warm = rows.filter((r) => (r.cachedTokens ?? 0) > 0);
  const cost = (rs: Row[]): string => (rs.length ? `$${median(rs.map((r) => r.costUsd ?? 0)).toFixed(5)}` : "-");
  const providers = [...new Set(rows.map((r) => r.provider))].join(", ");
  console.log(
    [
      `${file.replace(".json", "").padEnd(16)} n=${rows.length}`,
      `cold=${cold.length} (median ${cost(cold)})`,
      `warm=${warm.length} (median ${cost(warm)})`,
      `total $${rows.reduce((s, r) => s + (r.costUsd ?? 0), 0).toFixed(4)}`,
      `ttft median ${median(rows.map((r) => r.ttftMs ?? Number.NaN))} ms, max ${Math.max(...rows.map((r) => r.ttftMs ?? 0))} ms`,
      `total median ${median(rows.map((r) => r.ms))} ms`,
      `out median ${median(rows.map((r) => r.completionTokens ?? 0))} tok`,
      `reasoning max ${Math.max(...rows.map((r) => r.reasoningTokens ?? 0))}`,
      `bad links ${rows.filter((r) => r.badLinks.length).map((r) => r.id).join(",") || "none"}`,
      `upstreams: ${providers}`,
    ].join(" | "),
  );
}
