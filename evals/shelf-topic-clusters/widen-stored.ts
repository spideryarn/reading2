/**
 * **File every article of a real shelf into the tree it already has, and say
 * what each topic gains** — PAID, well under a cent:
 *
 *     npx tsx evals/shelf-topic-clusters/widen-stored.ts --shelf <file.json> [--find levin] [--impl <module>]
 *
 * `<file.json>` is what `stored-tree.ts --json` writes: the reader's stored
 * topics, each article's stored topic ids, its title and gist. This holds the
 * tree still, so the one thing that varies is the filing prompt: the question
 * a whole re-think cannot answer, because every re-think names a different
 * tree. It calls `fileWorks`, the same call the re-think's widening pass and a
 * new arrival's filing make. Nothing is written anywhere but the local ledger.
 * Written for docs/plans/261004j.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { withLedger } from "../../src/cli-ledger.js";
import { loadEnvLocal } from "../../src/env.js";
import type { TopicNode, TopicWork } from "../../src/shelf-terms/model-topics.js";

loadEnvLocal();

const implAt = process.argv.indexOf("--impl");
const { fileWorks, realCalls } = (await import(
  implAt >= 0 && process.argv[implAt + 1] ? path.resolve(process.argv[implAt + 1]!) : "../../src/shelf-terms/model-topics.js"
)) as typeof import("../../src/shelf-terms/model-topics.js");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const file = arg("shelf");
  if (!file) throw new Error("--shelf <file.json> is required");
  const find = arg("find")?.toLowerCase();
  const shelf = JSON.parse(readFileSync(file, "utf8")) as {
    topics: TopicNode[];
    works: { id: string; title: string | null; gist: string | null; stored: string[] | null }[];
  };
  const works: TopicWork[] = shelf.works.map((w) => ({ id: w.id, title: w.title ?? "", gist: w.gist }));
  const filed = await fileWorks(shelf.topics, works, realCalls());

  const before = new Map<string, Set<string>>(shelf.topics.map((t) => [t.id, new Set<string>()]));
  const after = new Map<string, Set<string>>(shelf.topics.map((t) => [t.id, new Set<string>()]));
  for (const w of shelf.works) {
    for (const id of w.stored ?? []) {
      before.get(id)?.add(w.id);
      after.get(id)?.add(w.id);
    }
    for (const id of filed.get(w.id) ?? []) after.get(id)?.add(w.id);
  }
  const walk = (parent: string | null): void => {
    for (const t of shelf.topics.filter((x) => x.parent === parent)) {
      console.log(`${"  ".repeat(t.depth)}${t.label}  ${before.get(t.id)?.size ?? 0} → ${after.get(t.id)?.size ?? 0}`);
      walk(t.id);
    }
  };
  walk(null);
  const total = (m: Map<string, Set<string>>) => [...m.values()].reduce((n, s) => n + s.size, 0);
  console.log(`\nTopics per article: ${(total(before) / works.length).toFixed(2)} → ${(total(after) / works.length).toFixed(2)}.`);
  const labelOf = new Map(shelf.topics.map((t) => [t.id, t.label]));
  if (find)
    for (const w of shelf.works.filter((x) => (x.title ?? "").toLowerCase().includes(find))) {
      const gained = (filed.get(w.id) ?? []).filter((id) => !(w.stored ?? []).includes(id));
      console.log(`\n${w.title}\n  was in: ${(w.stored ?? []).map((id) => labelOf.get(id)).join(" · ")}\n  gains:  ${gained.map((id) => labelOf.get(id)).join(" · ") || "(nothing)"}`);
    }
}

await withLedger("eval", main);
