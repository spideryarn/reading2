/**
 * **Blind pairs of `why`s for the same work** — Sonnet's (S0-1) and Haiku's
 * (H2-1), for a fixed sample: the first four works both lists share in each
 * non-PDF article, in the truth's order, plus the citing block's text. Layfield
 * is absent because this script does not re-read its PDF reference list, so its
 * numbered rows cannot be matched. Which side is which is decided by a hash of
 * the work's key, and the answer key is written to a separate file, so the
 * judge never sees it. Free.
 *
 *   npx tsx evals/citations-recall/why-pairs.ts     # writes 261101a/why-pairs.json and why-key.json
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadEnvLocal } from "../../src/env.js";
import type { Block } from "../../src/types.js";
import { LECUN, LECUN_FILE, OUT, type RawResult } from "./run.js";
import { match, type Row, type TruthWork } from "./score.js";

const TRUTH = path.join(import.meta.dirname, "..", "results", "citations-recall", "261101a-truth");
const PER_ARTICLE = 4;

loadEnvLocal();
const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
const store = await import("../../src/store/index.js");
const { closeDb } = await import("../../src/db/client.js");
const { buildBibliography, emptyDrops, noScoreDrops } = await import("../../src/bibliography.js");

type Cited = Row & { why?: string; relevance?: number; influence?: number };
const pairs: unknown[] = [];
const key: Record<string, { A: string; B: string }> = {};
await runAsOwner(environmentOwnerId(), async () => {
  for (const file of fs.readdirSync(path.join(OUT, "S0-1")).sort()) {
    const slug = file.replace(/\.json$/u, "");
    const blocks: Block[] =
      slug === LECUN ? (JSON.parse(fs.readFileSync(LECUN_FILE, "utf8")) as { blocks: Block[] }).blocks : (await store.loadArticle(slug)).blocks;
    const truth = JSON.parse(fs.readFileSync(path.join(TRUTH, file), "utf8")) as { works: TruthWork[] };
    const rowsOf = (set: string): Cited[] => {
      const raw = JSON.parse(fs.readFileSync(path.join(OUT, set, file), "utf8")) as RawResult;
      /* Layfield's list is a PDF's and needs the store; its rows are left out here rather than re-read. */
      return (buildBibliography(JSON.parse(raw.answer!), {
        slug, blocks, sourceHash: "eval", power: "standard", elapsedMs: 0, inherit: null,
        drops: emptyDrops(), scores: noScoreDrops(), referenceList: null, cap: Number.POSITIVE_INFINITY,
      }).citations as unknown as Cited[]).filter((r) => r.listedBy === undefined);
    };
    const s = rowsOf("S0-1");
    const h = rowsOf("H2-1");
    /* Match the complete lists once. Calling `match([row], [work])` here made a
       compound reference block look unique merely because every other truth
       work had been removed from the uniqueness check. */
    const sByWork = match(s, truth.works).matched;
    const hByWork = match(h, truth.works).matched;
    let taken = 0;
    for (const w of truth.works) {
      if (taken >= PER_ARTICLE) break;
      const rs = sByWork.get(w.key);
      const rh = hByWork.get(w.key);
      if (!rs?.why || !rh?.why) continue;
      const block = blocks.find((b) => b.id === w.citedIn[0]);
      const id = `${slug.slice(0, 12)}:${w.key}`;
      const sonnetIsA = createHash("sha256").update(id).digest()[0]! % 2 === 0;
      const [a, b] = sonnetIsA ? [rs, rh] : [rh, rs];
      pairs.push({
        id,
        work: `${w.surname ?? ""} ${w.year ?? ""} — ${(rs.title ?? "").slice(0, 100)}`,
        citingPassage: block?.text.slice(0, 1200) ?? "",
        A: { why: a.why, relevance: a.relevance, influence: a.influence ?? null },
        B: { why: b.why, relevance: b.relevance, influence: b.influence ?? null },
      });
      key[id] = sonnetIsA ? { A: "sonnet", B: "haiku" } : { A: "haiku", B: "sonnet" };
      taken++;
    }
  }
});
fs.writeFileSync(path.join(OUT, "why-pairs.json"), `${JSON.stringify(pairs, null, 2)}\n`);
fs.writeFileSync(path.join(OUT, "why-key.json"), `${JSON.stringify(key, null, 2)}\n`);
console.log(`${pairs.length} pairs`);
await closeDb();
