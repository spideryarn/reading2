/**
 * **Re-think one real shelf with the shipped code, and say how inclusive the
 * topics came out** — PAID, about a cent a run:
 *
 *     npx tsx evals/shelf-topic-clusters/replay-shelf.ts --shelf <file.json> --out <result.json> [--find levin]
 *
 * `<file.json>` is what `stored-tree.ts --json` writes: a reader's profile and
 * each article's title and gist, read from production read-only. Nothing is
 * written to any database (the call is recorded in the local `ai_calls`
 * ledger, as every eval's is).
 *
 * It calls `rethink` from src/shelf-terms/model-topics.ts, so what it measures
 * is what ships on the commit it is run on. **Run it on the commit before a
 * prompt change and again on the commit with it, each to its own `--out`**
 * (docs/project/prompting-guide.md § Measuring a prompt change), and twice on
 * the first, because two runs of one prompt differ.
 *
 * What it prints: the tree with each topic's size; how many topics the average
 * article is in; how many are in none; and, with `--find`, each matching
 * article's topics. Written for docs/plans/261004j (Greg's report d4tp0y).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { withLedger } from "../../src/cli-ledger.js";
import { loadEnvLocal } from "../../src/env.js";
import type { TopicWork } from "../../src/shelf-terms/model-topics.js";

loadEnvLocal();

/* The shipped module, or `--impl <file>` for the before arm (see hier.ts). */
const implAt = process.argv.indexOf("--impl");
const { realCalls, rethink, TOPIC_SET_PROMPT_VERSION } = (await import(
  implAt >= 0 && process.argv[implAt + 1] ? path.resolve(process.argv[implAt + 1]!) : "../../src/shelf-terms/model-topics.js"
)) as typeof import("../../src/shelf-terms/model-topics.js");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const file = arg("shelf");
  const out = arg("out");
  if (!file || !out) throw new Error("--shelf <file.json> and --out <result.json> are required");
  const find = arg("find")?.toLowerCase();
  const shelf = JSON.parse(readFileSync(file, "utf8")) as { profile: string | null; works: { id: string; title: string | null; gist: string | null }[] };
  const works: TopicWork[] = shelf.works.map((w) => ({ id: w.id, title: w.title ?? "", gist: w.gist }));

  const t0 = performance.now();
  const set = await rethink(works, realCalls(), { profile: shelf.profile });
  const seconds = (performance.now() - t0) / 1000;

  const size = new Map<string, number>(set.topics.map((t) => [t.id, 0]));
  for (const ids of set.members.values()) for (const id of ids) size.set(id, (size.get(id) ?? 0) + 1);
  const per = [...set.members.values()].map((ids) => ids.length);
  const mean = per.reduce((a, b) => a + b, 0) / Math.max(1, per.length);
  const none = per.filter((n) => n === 0).length;

  console.log(`Prompt v${TOPIC_SET_PROMPT_VERSION}; ${works.length} works; ${set.topics.length} topics; ${seconds.toFixed(0)} s.`);
  const walk = (parent: string | null): void => {
    for (const t of set.topics.filter((x) => x.parent === parent)) {
      console.log(`${"  ".repeat(t.depth)}${t.label}  (${size.get(t.id) ?? 0})`);
      walk(t.id);
    }
  };
  walk(null);
  /* The two numbers that say "too inclusive": a finer pill that is most of its
     parent narrows nothing, and so does a pill that is most of the shelf. */
  const ratios = set.topics.filter((t) => t.parent).map((t) => (size.get(t.id) ?? 0) / Math.max(1, size.get(t.parent!) ?? 0));
  const maxChildShare = ratios.length ? Math.max(...ratios) : 0;
  const maxShelfShare = Math.max(...set.topics.map((t) => (size.get(t.id) ?? 0) / works.length));
  console.log(
    `\nTopics per article: mean ${mean.toFixed(2)}; in no topic: ${none}. Largest finer topic as a share of its parent: ${maxChildShare.toFixed(2)}; largest topic as a share of the shelf: ${maxShelfShare.toFixed(2)}.`,
  );
  const labelOf = new Map(set.topics.map((t) => [t.id, t.label]));
  if (find)
    for (const w of works.filter((x) => x.title.toLowerCase().includes(find)))
      console.log(`\n${w.title}\n  in: ${(set.members.get(w.id) ?? []).map((id) => labelOf.get(id)).join(" · ") || "(no topic)"}`);

  writeFileSync(
    out,
    JSON.stringify(
      {
        promptVersion: TOPIC_SET_PROMPT_VERSION,
        works: works.length,
        seconds,
        meanTopicsPerArticle: mean,
        inNoTopic: none,
        maxChildShare,
        maxShelfShare,
        topics: set.topics.map((t) => ({ ...t, size: size.get(t.id) ?? 0 })),
        members: Object.fromEntries([...set.members].map(([id, ids]) => [works.find((w) => w.id === id)?.title ?? id, ids.map((x) => labelOf.get(x))])),
      },
      null,
      1,
    ),
  );
}

await withLedger("eval", main);
