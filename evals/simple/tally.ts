/**
 * **The operational table for plan 261001b's gate** — one line per probe run:
 * valid or not, wall clock, billed output and reasoning tokens, words and
 * paragraphs per level. Free; reads evals/results/simple/ only.
 *
 *   npx tsx evals/simple/tally.ts [arm-prefix...]
 */
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(import.meta.dirname, "..", "results", "simple");
const prefixes = process.argv.slice(2);

interface Row {
  arm: string;
  slug: string;
  ok: boolean;
  wallMs: number;
  costUsd: number | null;
  tokens: { output: number; reasoning: number | null } | null;
  words?: number;
  fullerWords?: number;
  paragraphs?: unknown[];
  fuller?: unknown[];
  briefWords?: number;
  brief?: unknown[];
  error?: string;
}

const rows: Row[] = [];
for (const arm of fs.readdirSync(OUT).sort()) {
  if (prefixes.length && !prefixes.some((p) => arm.startsWith(p))) continue;
  for (const f of fs.readdirSync(path.join(OUT, arm)).filter((x) => x.endsWith(".json"))) {
    rows.push(JSON.parse(fs.readFileSync(path.join(OUT, arm, f), "utf8")) as Row);
  }
}
for (const r of rows) {
  console.log(
    [
      r.arm.padEnd(22),
      r.slug.slice(0, 22).padEnd(23),
      r.ok ? "ok  " : "FAIL",
      `${(r.wallMs / 1000).toFixed(0)}s`.padStart(5),
      `$${r.costUsd?.toFixed(3) ?? "?"}`,
      `out=${r.tokens?.output ?? "?"}`.padEnd(9),
      `reason=${r.tokens?.reasoning ?? "?"}`.padEnd(12),
      `words=${r.briefWords ?? "-"}/${r.words ?? "-"}/${r.fullerWords ?? "-"}`.padEnd(18),
      `paras=${r.brief?.length ?? "-"}/${r.paragraphs?.length ?? "-"}/${r.fuller?.length ?? "-"}`,
      r.ok ? "" : (r.error ?? "").slice(0, 100),
    ].join(" "),
  );
}
const ok = rows.filter((r) => r.ok).length;
console.log(`\n${ok} of ${rows.length} valid`);
