/**
 * **The shipped fidelity checker, run over saved Simple levels** —
 * docs/plans/261001p-simple-on-opus-with-and-without-the-fidelity-guard.md.
 * A measurement, not the build: nothing in `src/` imports this.
 *
 *   npx tsx scripts/probes/261001p-check-saved-levels.ts <arm-prefix>...   # paid, ~$0.003 a run
 *
 * For every saved, successful arm under `evals/results/simple/` whose name
 * starts with a given prefix, sends each of its three levels, on every article
 * it wrote, to production's own `checkLevel` (src/simple-check.ts) — the call a press
 * makes with `--guard on`, without the writer — with a run's levels in
 * parallel. So it says how often the guard would fire on text the writer
 * produced with the guard off, and on which levels.
 *
 * The spend collector has no sink, so **no `ai_calls` row is written**; cost is
 * read from the collector's records. One JSONL line per level to
 * `docs/plans/261001p-check-saved-levels.jsonl`; a level already there is never
 * called again.
 */

import fs from "node:fs";
import path from "node:path";
import { collectSpend, totalSpend } from "../../src/ai-spend.js";
import { loadEnvLocal } from "../../src/env.js";

const REPO = path.join(import.meta.dirname, "..", "..");
const RESULTS = path.join(REPO, "evals", "results", "simple");
const OUT = path.join(REPO, "docs", "plans", "261001p-check-saved-levels.jsonl");
const LEVELS = [
  ["brief", "brief"],
  ["simple", "paragraphs"],
  ["fuller", "fuller"],
] as const;

type Para = { text: string; ids: string[] };

const prefixes = process.argv.slice(2);
if (prefixes.length === 0) throw new Error("usage: <arm-prefix>...");
loadEnvLocal();
const { checkLevel } = await import("../../src/simple-check.js");
const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
const { loadArticle } = await import("../../src/store/index.js");
const { isBodyEvidence } = await import("../../src/block-policy.js");
const { closeDb } = await import("../../src/db/client.js");

const done = new Set(
  fs.existsSync(OUT)
    ? fs
        .readFileSync(OUT, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const r = JSON.parse(l) as { arm: string; slug: string; level: string };
          return `${r.arm}/${r.slug}/${r.level}`;
        })
    : [],
);

await runAsOwner(environmentOwnerId(), async () => {
  const textOfs = new Map<string, Map<string, string>>();
  const textOfSlug = async (slug: string) => {
    let t = textOfs.get(slug);
    if (!t) {
      const article = await loadArticle(slug);
      t = new Map(article.blocks.filter(isBodyEvidence).map((b) => [b.id as string, b.text]));
      textOfs.set(slug, t);
    }
    return t;
  };
  const arms = fs
    .readdirSync(RESULTS)
    .filter((a) => prefixes.some((p) => a.startsWith(p)))
    .sort();
  for (const arm of arms) for (const name of fs.readdirSync(path.join(RESULTS, arm)).sort()) {
    const slug = name.replace(/\.json$/, "");
    const file = path.join(RESULTS, arm, name);
    const textOf = await textOfSlug(slug);
    const run = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown> & { ok: boolean };
    if (!run.ok) continue;
    const lines = await Promise.all(
      LEVELS.filter(([level]) => !done.has(`${arm}/${slug}/${level}`)).map(async ([level, field]) => {
        const paragraphs = run[field] as Para[] | undefined;
        if (!paragraphs) return null;
        const started = Date.now();
        const { result, report } = await collectSpend(() => checkLevel(paragraphs as never, textOf));
        const outcome = result.outcome;
        return {
          arm,
          slug,
          level,
          ms: Date.now() - started,
          usd: totalSpend(report.calls).nanos / 1e9,
          kind: outcome.kind,
          ...(outcome.kind === "flagged" ? { flags: outcome.flags } : {}),
          ...(outcome.kind === "failed" ? { failure: outcome.failure } : {}),
        };
      }),
    );
    for (const l of lines) {
      if (!l) continue;
      fs.appendFileSync(OUT, `${JSON.stringify(l)}\n`);
      console.log(`${l.arm} ${l.slug} ${l.level}: ${l.kind} ${(l.ms / 1000).toFixed(1)}s $${l.usd.toFixed(4)}`);
    }
  }
});
await closeDb();
