/** Print one case's runs, topic by topic: `npx tsx evals/shelf-topic-clusters/show.ts <case>`. Free. */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { OUT_DIR, type RunOut } from "./run.js";
const id = process.argv[2]!;
const dir = path.join(OUT_DIR, id);
for (const f of readdirSync(dir).sort()) {
  const r = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as RunOut;
  const cost = r.calls.reduce((s, c) => s + (c.costUsd ?? 0), 0) + (r.embedUsd ?? 0);
  const secs = r.calls.reduce((s, c) => s + c.latencyMs, 0) / 1000;
  console.log(`\n${f} — ${r.topics.length} topics${r.groupsFound ? ` (Louvain found ${r.groupsFound})` : ""}, $${cost.toFixed(4)}, ${secs.toFixed(1)} s${r.error ? ` ERROR ${r.error}` : ""}`);
  for (const t of r.topics) console.log(`  ${t.label} ${t.slugs.length}`);
}
