/**
 * **Blind pairs of notes for plan 261101c stage 2** — free. Three commands:
 *
 *   npx tsx evals/citations-recall/notes-pairs.ts manifest              # once, before any stage-2 arm runs
 *   npx tsx evals/citations-recall/notes-pairs.ts pairs <set> [<vs>]    # <set> against <vs> (default S0-1)
 *   npx tsx evals/citations-recall/notes-pairs.ts tally <set> <judge>   # unblind one judge's verdicts
 *
 * **The manifest is frozen** (GPT Sol's plan review 261101c, 6): eight truth
 * works per non-PDF article, in the truth's order, each one today's Sonnet list
 * (S0-1) and stage 1's list (P-2) both describe. Written once, never over an
 * existing file. Every arm is judged on exactly these keys, and a key an arm
 * has no row or no `why` for is still a pair, with that side empty, so the
 * judge scores it a loss and an error: an arm cannot win by dropping the hard
 * rows. The first four per article are 261101a's 24 pairs, which informed N1's
 * rules; `half` says which half a pair is in, so the result can be read on the
 * held-out half alone.
 *
 * Sides are randomised by a hash of the set name and the key, and the answer
 * key is written apart from the pairs, so a judge never sees it. Layfield is
 * absent for why-pairs.ts's reason: its numbered rows need its PDF list.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadEnvLocal } from "../../src/env.js";
import type { Block } from "../../src/types.js";
import { LECUN, LECUN_FILE, OUT, type RawResult } from "./run.js";
import { match, type Row, type TruthWork } from "./score.js";

const TRUTH = path.join(import.meta.dirname, "..", "results", "citations-recall", "261101a-truth");
export const NOTES_OUT = path.join(import.meta.dirname, "..", "results", "citations-recall", "261101c");
const MANIFEST = path.join(NOTES_OUT, "manifest.json");
const PER_ARTICLE = 8;
const FIRST_HALF = 4;
const PDF = "fd-src-s41598-023-33209-9-spya-hxekgz-spya-pwtq9e";

type Cited = Row & { why?: string; relevance?: number; influence?: number | null };
interface ManifestEntry { slug: string; key: string; half: "seen" | "held-out"; work: string; citedIn: string }

loadEnvLocal();
const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
const store = await import("../../src/store/index.js");
const { closeDb } = await import("../../src/db/client.js");
const { buildBibliography, emptyDrops, noScoreDrops } = await import("../../src/bibliography.js");

const blocksCache = new Map<string, Block[]>();
async function blocksOf(slug: string): Promise<Block[]> {
  const had = blocksCache.get(slug);
  if (had) return had;
  const blocks: Block[] =
    slug === LECUN ? (JSON.parse(fs.readFileSync(LECUN_FILE, "utf8")) as { blocks: Block[] }).blocks : (await store.loadArticle(slug)).blocks;
  blocksCache.set(slug, blocks);
  return blocks;
}
const truthOf = (slug: string): TruthWork[] =>
  (JSON.parse(fs.readFileSync(path.join(TRUTH, `${slug}.json`), "utf8")) as { works: TruthWork[] }).works;

/** The model's own rows for one article in one result set, matched to the truth, by truth key. A failed call is an empty map. */
async function rowsByKey(set: string, slug: string): Promise<Map<string, Cited>> {
  const file = path.join(OUT, set, `${slug}.json`);
  if (!fs.existsSync(file)) throw new Error(`${set} has no result for ${slug}`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as RawResult;
  if (raw.answer === null) return new Map();
  const rows = (buildBibliography(JSON.parse(raw.answer), {
    slug, blocks: await blocksOf(slug), sourceHash: "eval", power: "standard", elapsedMs: 0, inherit: null,
    drops: emptyDrops(), scores: noScoreDrops(), referenceList: null, cap: Number.POSITIVE_INFINITY,
  }).citations as unknown as Cited[]).filter((r) => r.listedBy === undefined);
  /* The whole list at once: matching one row against one work makes a shared reference block look unique (why-pairs.ts). */
  return match(rows, truthOf(slug)).matched as Map<string, Cited>;
}

const slugsOf = (set: string) =>
  fs.readdirSync(path.join(OUT, set)).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/u, "")).filter((s) => s !== PDF).sort();

async function manifest(): Promise<void> {
  if (fs.existsSync(MANIFEST)) throw new Error(`refusing to overwrite the frozen manifest ${MANIFEST}`);
  const out: ManifestEntry[] = [];
  for (const slug of slugsOf("S0-1")) {
    const s = await rowsByKey("S0-1", slug);
    const p = await rowsByKey("P-2", slug);
    const blocks = await blocksOf(slug);
    let taken = 0;
    for (const w of truthOf(slug)) {
      if (taken >= PER_ARTICLE) break;
      if (!s.get(w.key)?.why || !p.get(w.key)?.why) continue;
      const block = blocks.find((b) => b.id === w.citedIn[0]);
      out.push({
        slug,
        key: w.key,
        half: taken < FIRST_HALF ? "seen" : "held-out",
        work: `${w.surname ?? ""} ${w.year ?? ""} — ${(s.get(w.key)?.title ?? "").slice(0, 100)}`,
        citedIn: block?.text.slice(0, 1200) ?? "",
      });
      taken++;
    }
  }
  fs.mkdirSync(NOTES_OUT, { recursive: true });
  fs.writeFileSync(MANIFEST, `${JSON.stringify(out, null, 2)}\n`, { flag: "wx" });
  console.log(`${out.length} works in the manifest`);
}

async function pairs(set: string, vs: string): Promise<void> {
  const entries = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as ManifestEntry[];
  const out: unknown[] = [];
  const key: Record<string, { A: string; B: string; half: string }> = {};
  const bySlug = new Map<string, { a: Map<string, Cited>; b: Map<string, Cited> }>();
  for (const e of entries) {
    if (!bySlug.has(e.slug)) bySlug.set(e.slug, { a: await rowsByKey(set, e.slug), b: await rowsByKey(vs, e.slug) });
    const { a: mine, b: theirs } = bySlug.get(e.slug)!;
    const side = (r: Cited | undefined) =>
      r?.why ? { why: r.why, relevance: r.relevance ?? null, influence: r.influence ?? null } : { why: "(no row for this work)", relevance: null, influence: null };
    const id = `${e.slug.slice(0, 12)}:${e.key}`;
    const setIsA = createHash("sha256").update(`${set}|${id}`).digest()[0]! % 2 === 0;
    const [A, B] = setIsA ? [side(mine.get(e.key)), side(theirs.get(e.key))] : [side(theirs.get(e.key)), side(mine.get(e.key))];
    out.push({ id, work: e.work, citingPassage: e.citedIn, A, B });
    key[id] = setIsA ? { A: set, B: vs, half: e.half } : { A: vs, B: set, half: e.half };
  }
  const pairsFile = path.join(NOTES_OUT, `${set}-vs-${vs}-pairs.json`);
  const keyFile = path.join(NOTES_OUT, `${set}-vs-${vs}-key.json`);
  const existing = [pairsFile, keyFile].filter((file) => fs.existsSync(file));
  if (existing.length > 0) throw new Error(`refusing to overwrite blind-pair artifacts:\n${existing.join("\n")}`);
  fs.writeFileSync(pairsFile, `${JSON.stringify(out, null, 2)}\n`, { flag: "wx" });
  fs.writeFileSync(keyFile, `${JSON.stringify(key, null, 2)}\n`, { flag: "wx" });
  console.log(`${out.length} pairs`);
}

/** A judge's verdicts: `[{ id, better: "A"|"B"|"tie", errorA, errorB, relevanceOffA, relevanceOffB }]`. */
interface Verdict { id: string; better: "A" | "B" | "tie"; errorA: boolean; errorB: boolean; relevanceOffA: boolean; relevanceOffB: boolean }
interface Pair { id: string; A: { why: string }; B: { why: string } }

function tally(pairsName: string, judge: string): void {
  const key = JSON.parse(fs.readFileSync(path.join(NOTES_OUT, `${pairsName}-key.json`), "utf8")) as Record<string, { A: string; B: string; half: string }>;
  const pairs = JSON.parse(fs.readFileSync(path.join(NOTES_OUT, `${pairsName}-pairs.json`), "utf8")) as Pair[];
  const verdicts = JSON.parse(fs.readFileSync(path.join(NOTES_OUT, `${pairsName}-${judge}.json`), "utf8")) as Verdict[];
  const expected = Object.keys(key);
  const pairById = new Map(pairs.map((p) => [p.id, p]));
  const verdictById = new Map(verdicts.map((v) => [v.id, v]));
  const exactIds = (ids: readonly string[], unique: number, what: string) => {
    const missing = expected.filter((id) => !ids.includes(id));
    const extra = ids.filter((id) => key[id] === undefined);
    if (ids.length !== expected.length || unique !== ids.length || missing.length > 0 || extra.length > 0) {
      throw new Error(`${what} ids do not exactly match the ${expected.length} keys (missing ${missing.length}, extra ${extra.length}, duplicates ${ids.length - unique})`);
    }
  };
  exactIds(pairs.map((p) => p.id), pairById.size, "pair");
  exactIds(verdicts.map((v) => v.id), verdictById.size, "verdict");
  for (const v of verdicts) {
    if (!["A", "B", "tie"].includes(v.better) ||
        [v.errorA, v.errorB, v.relevanceOffA, v.relevanceOffB].some((x) => typeof x !== "boolean")) {
      throw new Error(`invalid verdict for ${v.id}`);
    }
  }
  for (const half of ["all", "held-out"] as const) {
    const t: Record<string, { preferred: number; errors: number; relevanceOff: number }> = {};
    let ties = 0;
    for (const v of verdicts) {
      const k = key[v.id]!;
      if (half === "held-out" && k.half !== "held-out") continue;
      const pair = pairById.get(v.id)!;
      const missingA = pair.A.why === "(no row for this work)";
      const missingB = pair.B.why === "(no row for this work)";
      const better = missingA && missingB ? "tie" : missingA ? "B" : missingB ? "A" : v.better;
      for (const s of [k.A, k.B]) t[s] ??= { preferred: 0, errors: 0, relevanceOff: 0 };
      if (better === "tie") ties++;
      else t[better === "A" ? k.A : k.B]!.preferred++;
      if (missingA || v.errorA) t[k.A]!.errors++;
      if (missingB || v.errorB) t[k.B]!.errors++;
      if (v.relevanceOffA) t[k.A]!.relevanceOff++;
      if (v.relevanceOffB) t[k.B]!.relevanceOff++;
    }
    console.log(`${pairsName} · ${judge} · ${half}: ${JSON.stringify(t)} · ties ${ties}`);
  }
}

const [cmd, a, b] = process.argv.slice(2);
await runAsOwner(environmentOwnerId(), async () => {
  if (cmd === "manifest") await manifest();
  else if (cmd === "pairs" && a) await pairs(a, b ?? "S0-1");
  else if (cmd === "tally" && a && b) tally(a, b);
  else throw new Error("usage: notes-pairs.ts manifest | pairs <set> [<vs>] | tally <set>-vs-<vs> <judge>");
});
await closeDb();
