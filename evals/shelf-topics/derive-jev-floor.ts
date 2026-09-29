/**
 * **The jev-floor arms, derived from the SAVED Jev scores** — no model call.
 *
 *     npx tsx evals/shelf-topics/derive-jev-floor.ts
 *
 * **Added after seeing the results, not predeclared** (see `DERIVED_ARMS` in
 * ./case.ts). Jev's expected score never reached 0, so planted distractors
 * scored 0.5–0.9 and the coverage greedy still took them to fill slots. For
 * each `jev-score-<run>.json`, any score below the floor becomes 0 (not a
 * topic), and production's greedy (`chooseTerms` with `quality`) picks again.
 * Writes `jev-floor-<run>.json` (floor 1.0) and `jev-floor-0.75-<run>.json`.
 * Its `call` is null because it spent nothing; the cost is Jev's.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chooseTerms } from "../../src/shelf-terms/choose.js";
import { chooseInput, DERIVED_ARMS, JEV_FLOORS, loadCases, RESULTS_DIR, type RunFile, RUNS } from "./case.js";
import { LIST_LENGTH } from "./prompt.js";

for (const c of loadCases()) {
  const input = chooseInput(c);
  const counts: string[] = [];
  for (const arm of DERIVED_ARMS) {
    const floor = JEV_FLOORS[arm];
    const lengths: number[] = [];
    for (const run of RUNS) {
      const src = path.join(RESULTS_DIR, c.id, `jev-score-${run}.json`);
      if (!existsSync(src)) continue;
      const jev = JSON.parse(readFileSync(src, "utf8")) as RunFile;
      if (jev.error || !jev.scores) continue;
      const quality = new Map(Object.entries(jev.scores).map(([k, s]) => [k, s < floor ? 0 : s]));
      const terms = chooseTerms(input, { quality }).terms.slice(0, LIST_LENGTH);
      const out: RunFile = {
        ...jev,
        arm,
        at: new Date().toISOString(),
        call: null,
        scores: Object.fromEntries(quality),
        list: terms.map((t) => ({
          key: t.key,
          label: t.label,
          count: t.articles.length,
          slugs: t.articles.map((a) => a.slug),
        })),
      };
      writeFileSync(path.join(RESULTS_DIR, c.id, `${arm}-${run}.json`), `${JSON.stringify(out, null, 1)}\n`);
      lengths.push(terms.length);
    }
    counts.push(`${arm} ${lengths.join("/")}`);
  }
  console.log(`${c.id}: topics per run — ${counts.join(", ")}`);
}
