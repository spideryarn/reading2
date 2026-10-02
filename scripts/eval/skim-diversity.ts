/**
 * **How often does a Skim walk show the reader something again?** — plan
 * 260929e, from Greg's SPIDERYARN-READING2-4P: *"it's a bit annoying for the
 * more detailed levels of granularity to reuse the same snippets as the coarser
 * levels if I've just read the coarser level … The main thing is to ensure that
 * there's diversity within levels, and perhaps ideally between them."*
 *
 *     npx tsx scripts/eval/skim-diversity.ts [slug …]
 *
 * Reads the stored route, Quotes, Ideas and article of each slug (the six
 * local articles that had a route on 2026-09-29 when none is named). **No model call, nothing written
 * to the database**; the report goes to stdout and
 * `evals/results/skim-diversity-<ts>.json`.
 *
 * ## Two ways of walking the same stored route
 *
 * - **nested** — today: depth *d* walks every stop with `depth ≤ d`, so More
 *   walks the Gist stops again and Most walks both.
 * - **added** — depth *d* walks only the stops with `depth === d`, the ones the
 *   deeper pass adds. The reader who goes Gist → More → Most meets each stop
 *   once.
 *
 * ## What is counted, per pass, for a reader who walked the shallower passes first
 *
 * - **seen again** — stops in this pass's walk the reader already stood at.
 * - **restates** — a stop new to the reader whose words overlap a stop already
 *   walked (content-word Jaccard ≥ `NEAR`), listed for reading by eye.
 * - **idea again** — a new stop that carries no Idea except ones an earlier
 *   stop (this pass or before) already carried.
 * - **within the pass**: pairs of stops that carry the same Idea, pairs whose
 *   words overlap ≥ `NEAR`, and consecutive stops whose blocks are at most two
 *   apart in the article.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { loadEnvLocal } from "../../src/env.js";

loadEnvLocal();

const { closeDb } = await import("../../src/db/client.js");
const { pgArticleReader } = await import("../../src/store/pg.js");
const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
const { blockIndex, sectionPathOf } = await import("../../src/section-path.js");
const { skimInput } = await import("../../src/skim.js");

import type { Quote, SkimDepth, SkimStop } from "../../src/types.js";

/** Content-word Jaccard at or over this is listed as a possible restatement. */
const NEAR = 0.2;

const STOP = new Set(
  (
    "the a an and or but of to in on at for from by with as is are was were be been being this that these those it its " +
    "we our they their there here which who whom what when where how why not no nor so than then also into over under " +
    "can could would should may might must will shall do does did done has have had having such more most less very " +
    "just only one two all any each both between about through during before after above below other some same own"
  ).split(" "),
);

function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z][a-z-]+/g) ?? []) {
    if (raw.length < 4 || STOP.has(raw)) continue;
    out.add(raw.replace(/(ing|ed|es|s)$/, ""));
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

type Policy = "nested" | "added";
const walkOf = (stops: readonly SkimStop[], d: SkimDepth, p: Policy) =>
  stops.filter((s) => (p === "nested" ? s.depth <= d : s.depth === d));

interface StopInfo {
  label: string;
  quote: Quote;
  at: number;
  top: string;
  carries: string[];
  beside: string[];
  bag: Set<string>;
}

interface PassRow {
  policy: Policy;
  depth: SkimDepth;
  walk: number;
  seenAgain: number;
  restates: { stop: string; of: string; j: number }[];
  ideaAgain: number;
  sameIdeaPairs: number;
  nearPairs: { a: string; b: string; j: number }[];
  closeConsecutive: number;
  sameSectionConsecutive: number;
  meanQuoteChars: number;
}

const slugArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));

try {
  await runAsOwner(environmentOwnerId(), async () => {
    /* Every local article with a stored route on 2026-09-29. */
    const slugs =
      slugArgs.length > 0
        ? slugArgs
        : [
            "antikythera-mechanism-spya-zhxrzm",
            "cargocult-spya-rz663q",
            "entropy-24-00930-spya-pywwkq",
            "source-spya-furjgs",
            "the-mythology-of-conscious-ai-spya-rn5m0q",
            "vb-spya-vu3xen",
          ];

    const report: unknown[] = [];
    const totals = new Map<string, { walk: number; seenAgain: number; restates: number; ideaAgain: number; sameIdeaPairs: number; nearPairs: number; closeConsecutive: number; sameSectionConsecutive: number }>();

    for (const slug of slugs) {
      let found: Awaited<ReturnType<typeof pgArticleReader.loadSkim>>;
      try {
        found = await pgArticleReader.loadSkim(slug);
      } catch (err) {
        console.log(`${slug}: no route (${err instanceof Error ? err.message : String(err)})`);
        continue;
      }
      const article = await pgArticleReader.loadArticle(slug);
      const quotes = (await pgArticleReader.loadQuotes(slug)).quotes;
      let ideas = null;
      try {
        ideas = (await pgArticleReader.loadIdeas(slug)).ideas;
      } catch {
        ideas = null;
      }
      const input = skimInput({ quotes, blocks: article.blocks, tree: article.tree, ideas });
      const carriesById = new Map(input.records.map((r) => [r.quote.id, r.carries]));
      const besideById = new Map(input.records.map((r) => [r.quote.id, r.beside]));
      const idx = blockIndex(article.blocks);
      const byId = new Map(quotes.quotes.map((q) => [q.id, q]));
      const stops = found.skim.stops.filter((s) => byId.has(s.quoteId));
      const info = new Map<string, StopInfo>();
      stops.forEach((s, i) => {
        const q = byId.get(s.quoteId)!;
        info.set(s.quoteId, {
          label: `#${i + 1}(d${s.depth})`,
          quote: q,
          at: idx.get(q.blockId) ?? -1,
          top: sectionPathOf(q.blockId, idx, article.tree)[0] ?? "(none)",
          carries: carriesById.get(q.id) ?? [],
          beside: besideById.get(q.id) ?? [],
          bag: words(q.text),
        });
      });

      console.log(`\n=== ${slug} · ${found.skim.version} · ${stops.length} stops · visible ${found.skim.visible.join("/")}${found.stale ? " · STALE" : ""}`);
      const rows: PassRow[] = [];
      for (const policy of ["nested", "added"] as const) {
        const seen = new Set<string>();
        const ideasMet = new Set<string>();
        for (const depth of [1, 2, 3] as const) {
          const walk = walkOf(stops, depth, policy).map((s) => info.get(s.quoteId)!);
          if (walk.length === 0) continue;
          const row: PassRow = {
            policy,
            depth,
            walk: walk.length,
            seenAgain: 0,
            restates: [],
            ideaAgain: 0,
            sameIdeaPairs: 0,
            nearPairs: [],
            closeConsecutive: 0,
            sameSectionConsecutive: 0,
            meanQuoteChars: Math.round(walk.reduce((n, s) => n + s.quote.text.length, 0) / walk.length),
          };
          const before = [...seen].map((id) => info.get(id)!);
          for (const s of walk) {
            if (seen.has(s.quote.id)) {
              row.seenAgain++;
              continue;
            }
            let best: { of: string; j: number } | null = null;
            for (const b of before) {
              const j = jaccard(s.bag, b.bag);
              if (j >= NEAR && (!best || j > best.j)) best = { of: b.label, j };
            }
            if (best) row.restates.push({ stop: s.label, of: best.of, j: +best.j.toFixed(2) });
            if (s.carries.length > 0 && s.carries.every((c) => ideasMet.has(c))) row.ideaAgain++;
            for (const c of s.carries) ideasMet.add(c);
          }
          for (let i = 0; i < walk.length; i++) {
            for (let k = i + 1; k < walk.length; k++) {
              const a = walk[i]!;
              const b = walk[k]!;
              if (a.carries.some((c) => b.carries.includes(c))) row.sameIdeaPairs++;
              const j = jaccard(a.bag, b.bag);
              if (j >= NEAR) row.nearPairs.push({ a: a.label, b: b.label, j: +j.toFixed(2) });
            }
            if (i > 0) {
              const p = walk[i - 1]!;
              const s = walk[i]!;
              if (Math.abs(p.at - s.at) <= 2) row.closeConsecutive++;
              if (p.top === s.top) row.sameSectionConsecutive++;
            }
          }
          for (const s of walk) seen.add(s.quote.id);
          rows.push(row);
          const key = `${policy} d${depth}`;
          const t = totals.get(key) ?? { walk: 0, seenAgain: 0, restates: 0, ideaAgain: 0, sameIdeaPairs: 0, nearPairs: 0, closeConsecutive: 0, sameSectionConsecutive: 0 };
          t.walk += row.walk;
          t.seenAgain += row.seenAgain;
          t.restates += row.restates.length;
          t.ideaAgain += row.ideaAgain;
          t.sameIdeaPairs += row.sameIdeaPairs;
          t.nearPairs += row.nearPairs.length;
          t.closeConsecutive += row.closeConsecutive;
          t.sameSectionConsecutive += row.sameSectionConsecutive;
          totals.set(key, t);
          console.log(
            `${policy.padEnd(6)} d${depth}: walk ${row.walk}, seen again ${row.seenAgain}, restates ${row.restates.length}` +
              ` ${row.restates.map((r) => `${r.stop}~${r.of}:${r.j}`).join(" ")}, idea again ${row.ideaAgain},` +
              ` same-idea pairs ${row.sameIdeaPairs}, near pairs ${row.nearPairs.length} ${row.nearPairs.map((r) => `${r.a}~${r.b}:${r.j}`).join(" ")},` +
              ` close consecutive ${row.closeConsecutive}, same-section consecutive ${row.sameSectionConsecutive}, mean chars ${row.meanQuoteChars}`,
          );
        }
      }
      console.log("route:");
      for (const s of stops) {
        const i = info.get(s.quoteId)!;
        console.log(`  ${i.label} [${i.top.slice(0, 30)}] @${i.at} ${i.carries.join(",") || "-"} :: ${i.quote.text.slice(0, 110).replace(/\s+/g, " ")}`);
      }
      /* Every stop in full, so a semantic read of the passes can be made — and
         checked — from this file alone (Sol, plan review F6). */
      const snapshot = stops.map((s) => {
        const i = info.get(s.quoteId)!;
        return {
          label: i.label,
          quoteId: s.quoteId,
          depth: s.depth,
          cue: s.cue ?? s.role,
          section: sectionPathOf(i.quote.blockId, idx, article.tree).join(" › "),
          at: i.at,
          carries: i.carries,
          beside: i.beside,
          text: i.quote.text,
        };
      });
      const ideaNames = ideas ? ideas.ideas.map((d, k) => `I${k + 1} · ${d.name}`) : null;
      report.push({ slug, version: found.skim.version, stale: found.stale, visible: found.skim.visible, ideas: ideaNames, stops: snapshot, rows });
    }

    console.log("\n=== totals over all routes");
    for (const [key, t] of totals) {
      console.log(
        `${key}: walk ${t.walk}, seen again ${t.seenAgain} (${Math.round((100 * t.seenAgain) / t.walk)}%), restates ${t.restates},` +
          ` idea again ${t.ideaAgain}, same-idea pairs ${t.sameIdeaPairs}, near pairs ${t.nearPairs},` +
          ` close consecutive ${t.closeConsecutive}, same-section consecutive ${t.sameSectionConsecutive}`,
      );
    }
    mkdirSync("evals/results", { recursive: true });
    const out = `evals/results/skim-diversity-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(out, JSON.stringify({ near: NEAR, report, totals: Object.fromEntries(totals) }, null, 2));
    console.log(`wrote ${out}`);
  });
} finally {
  await closeDb();
}
