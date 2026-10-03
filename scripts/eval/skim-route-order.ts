/**
 * **How far does a Skim route, and each walk through it, follow the article's
 * own order?** For plan 261003l § Stage 2, round two, where the prompt was
 * told to mix the depths in one order: did that turn the Gist walk around?
 *
 *     npx tsx scripts/eval/skim-route-order.ts <results.json> [<results.json> …]
 *
 * Reads results files from scripts/eval/skim-coverage-eval.ts and the
 * articles they name (through `pgArticleReader`, to place each stop's
 * paragraph in the article). **No model call, nothing written anywhere**; the
 * report goes to stdout. A "step forward" is a stop that sits later in the
 * article than the stop walked before it. Arms are labelled by file: `1:old`,
 * `1:new`, `2:new`, ….
 */
import { readFileSync } from "node:fs";
import { loadEnvLocal } from "../../src/env.js";
loadEnvLocal();
const { closeDb } = await import("../../src/db/client.js");
const { pgArticleReader } = await import("../../src/store/pg.js");
const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");

interface Stop { depth: number; again?: number[]; paragraph: string }
interface Run { slug: string; arm: string; run: number; stops: Stop[] }
const files = process.argv.slice(2);
if (files.length === 0) throw new Error("usage: skim-route-order.ts <results.json> [<results.json> …]");
const runs = files.flatMap((file, i) =>
  (JSON.parse(readFileSync(file, "utf8")) as { results: Run[] }).results.map((r) => ({ ...r, arm: `${i + 1}:${r.arm}` })),
);
const forward = (xs: number[]): [number, number] => {
  let f = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i]! > xs[i - 1]!) f++;
  return [f, Math.max(0, xs.length - 1)];
};
try {
  await runAsOwner(environmentOwnerId(), async () => {
    const pos = new Map<string, Map<string, number>>();
    for (const slug of new Set(runs.map((r) => r.slug))) {
      const article = await pgArticleReader.loadArticle(slug);
      pos.set(slug, new Map(article.blocks.map((b, i) => [b.text.replace(/\s+/g, " "), i])));
    }
    const tally = new Map<string, { routeF: number; routeN: number; gistF: number; gistN: number; gistMono: number; routeMono: number; moreF: number; moreN: number; runs: number }>();
    for (const r of runs) {
      const at = (s: Stop) => {
        const i = pos.get(r.slug)!.get(s.paragraph);
        if (i === undefined) throw new Error(`${r.slug}: paragraph not found`);
        return i;
      };
      const route = forward(r.stops.map(at));
      const gist = forward(r.stops.filter((s) => s.depth === 1).map(at));
      const more = forward(r.stops.filter((s) => s.depth === 2 || (s.again ?? []).includes(2)).map(at));
      const t = tally.get(r.arm) ?? { routeF: 0, routeN: 0, gistF: 0, gistN: 0, gistMono: 0, routeMono: 0, moreF: 0, moreN: 0, runs: 0 };
      t.runs++;
      t.routeF += route[0]; t.routeN += route[1];
      t.gistF += gist[0]; t.gistN += gist[1];
      t.moreF += more[0]; t.moreN += more[1];
      if (gist[0] === gist[1]) t.gistMono++;
      if (route[0] === route[1]) t.routeMono++;
      tally.set(r.arm, t);
      console.log(`${r.arm} ${r.slug.split("-")[0]}#${r.run}: route forward ${route[0]}/${route[1]}, gist ${gist[0]}/${gist[1]}, more ${more[0]}/${more[1]}`);
    }
    for (const [arm, t] of tally) {
      console.log(`${arm}: route steps forward ${t.routeF}/${t.routeN}; routes wholly in article order ${t.routeMono}/${t.runs}; gist steps forward ${t.gistF}/${t.gistN}; gist walks wholly in article order ${t.gistMono}/${t.runs}; more-walk steps forward ${t.moreF}/${t.moreN}`);
    }
  });
} finally {
  await closeDb();
}
