/**
 * **What the blind judge reads**, free: `npx tsx evals/shelf-topic-clusters/make-pairs.ts`
 * → `results/pairs/<case>.json` and `results/pairs-key.json`.
 *
 * Per case: the shelf (profile, titles, gists) and three pairs of lists from
 * run 1 — induce vs production, cluster vs production, induce vs cluster —
 * each topic with every member title. Which list is A is decided by a hash of
 * the case and pair, so it is fixed but not guessable from the file; the key
 * is the only place the arms are named, and the judge never reads it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { loadCases, RESULTS_DIR, type RunFile } from "../shelf-topics/case.js";
import { OUT_DIR, type RunOut, type Topic } from "./run.js";

const PAIRS = [
  ["induce", "production"],
  ["cluster", "production"],
  ["induce", "cluster"],
] as const;

const key: Record<string, Record<string, { A: string; B: string }>> = {};
mkdirSync(path.join(OUT_DIR, "pairs"), { recursive: true });

for (const c of loadCases()) {
  const title = new Map(c.articles.map((a) => [a.slug, a.title]));
  const list = (arm: string): Topic[] | null => {
    if (arm === "production") {
      const f = path.join(RESULTS_DIR, c.id, "luna-score-1.json");
      if (!existsSync(f)) return null;
      return (JSON.parse(readFileSync(f, "utf8")) as RunFile).list.map((t) => ({ label: t.label, slugs: t.slugs }));
    }
    const f = path.join(OUT_DIR, c.id, `${arm}-1.json`);
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as RunOut).topics : null;
  };
  const show = (ts: Topic[]) => ts.map((t) => ({ topic: t.label, articles: t.slugs.map((s) => title.get(s) ?? s) }));
  const pairs: unknown[] = [];
  key[c.id] = {};
  for (const [x, y] of PAIRS) {
    const lx = list(x);
    const ly = list(y);
    if (!lx || !ly) continue;
    const id = `${x}-vs-${y}`;
    const flip = createHash("sha256").update(`${c.id}:${id}`).digest()[0]! % 2 === 1;
    const pid = `pair-${pairs.length + 1}`;
    key[c.id]![pid] = flip ? { A: y, B: x } : { A: x, B: y };
    pairs.push({ pair: pid, A: show(flip ? ly : lx), B: show(flip ? lx : ly) });
  }
  writeFileSync(
    path.join(OUT_DIR, "pairs", `${c.id}.json`),
    `${JSON.stringify({ case: c.id, profile: c.profile, shelf: c.articles.map((a) => ({ title: a.title, gist: a.gist })), pairs }, null, 2)}\n`,
  );
}
writeFileSync(path.join(OUT_DIR, "pairs-key.json"), `${JSON.stringify(key, null, 2)}\n`);
console.log("wrote pairs");
