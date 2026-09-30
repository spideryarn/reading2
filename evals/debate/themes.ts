/**
 * **Run Debate's third call over stored debates, and print what it said** —
 * the measurement behind
 * [260930j](../../docs/plans/260930j-debate-themes-and-key-sources.md).
 *
 * Input is a JSON array of stored `Debate` documents (read out of the database
 * by hand, read-only); one call per distinct slug, the last one in the file
 * winning. No search runs, so a pass over ten debates costs cents, not dollars.
 * It calls production's own `synthesiseDebate`, never a copy.
 *
 *     npx tsx evals/debate/themes.ts <debates.json> [--out <file.json>]
 *
 * Prints each debate's sources and, under them, the themes and key sources
 * with the row each one points at, so a reader can judge the grouping against
 * the passages rather than against the labels.
 */
import fs from "node:fs";

import { synthesiseDebate } from "../../src/debate.js";
import { loadEnvLocal } from "../../src/env.js";
import { modelFor } from "../../src/models.js";
import type { Debate, DebateSynthesis } from "../../src/types.js";

async function main(): Promise<void> {
  loadEnvLocal();
  const [file, flag, out] = process.argv.slice(2);
  if (!file) throw new Error("usage: themes.ts <debates.json> [--out <file.json>]");
  const all = JSON.parse(fs.readFileSync(file, "utf8")) as Debate[];
  const bySlug = new Map(all.map((d) => [d.slug, d]));
  const model = modelFor("debate", "standard");
  const results: { slug: string; synthesis: DebateSynthesis }[] = [];
  for (const debate of bySlug.values()) {
    const rows = [...debate.direct.rows, ...debate.claims.rows];
    const synthesis = await synthesiseDebate({ rows, model });
    results.push({ slug: debate.slug, synthesis });
    console.log(`\n=== ${debate.slug} — ${rows.length} rows, ${synthesis.kind}`);
    for (const row of rows) {
      console.log(`  [${row.id}] ${new URL(row.url).hostname} — ${row.title ?? "(no title)"}`);
    }
    if (synthesis.kind !== "made") continue;
    for (const theme of synthesis.themes) {
      console.log(`  THEME ${theme.label} — ${theme.gist}\n        ${theme.rowIds.join(", ")}`);
    }
    for (const key of synthesis.key) {
      console.log(`  KEY ${key.rowId} ${key.role} — ${key.why}`);
    }
  }
  if (flag === "--out" && out) fs.writeFileSync(out, JSON.stringify(results, null, 2));
}

await main();
