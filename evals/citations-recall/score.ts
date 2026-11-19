/**
 * **Scores what run.ts wrote against the ground truth** — free, re-runnable.
 * Plan docs/plans/261101a-citations-every-work-cheaply-with-haiku.md § Scoring.
 *
 *   npx tsx evals/citations-recall/score.ts [arm-run …]          # every arm-run on disk by default
 *   npx tsx evals/citations-recall/score.ts -v H1-1              # and every unmatched row and missed work
 *   npx tsx evals/citations-recall/score.ts --json               # also write the table as JSON
 *
 * Each answer goes through production's own `buildBibliography` — place
 * verification, both folds, code's author–year fill — three ways:
 *
 * - **model**: the folded list with no cap, code's rows (`listedBy: "text"`)
 *   left out — what the model itself found.
 * - **reader@80**: production today, the 80 cap and code's fill included.
 * - **reader@300**: the same with the candidate's ceiling.
 *
 * Rows are matched to the truth's works (`evals/results/citations-recall/
 * 261101a-truth/<slug>.json`) one-to-one, by maximum matching with the exact
 * edges first (the same reference block, one that is the work's alone, or an
 * alias's; the same PDF-list entry number), then first-author surname and year
 * in the row's verified metadata or anchored quotes (accent-folded,
 * whole-word surname). A row's bare year may stand for a lettered work only
 * where the truth marks no ambiguity. Sol's plan review, 1–3.
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../../src/env.js";
import { fold } from "../../src/citation-author-year.js";
import type { Block } from "../../src/types.js";
import { LECUN, LECUN_FILE, OUT, type RawResult, referenceListFor } from "./run.js";
import type { NumberedReferenceList } from "../../src/citation-reference-list.js";

const TRUTH = path.join(import.meta.dirname, "..", "results", "citations-recall", "261101a-truth");

export interface TruthWork {
  key: string;
  surname: string | null;
  year: string | null;
  number?: number | null;
  refBlock?: string | null;
  aliases?: { number?: number | null; refBlock?: string | null }[];
  ambiguous?: boolean;
  citedIn: string[];
  citingWords?: string;
}
interface Truth {
  slug: string;
  works: TruthWork[];
  listOnly?: { surname: string | null; year: string | null; refBlock?: string | null }[];
}

/** The parts of a row the matcher reads. */
export interface Row {
  title: string;
  authors?: string;
  year?: string;
  /* `CitationPlace` names its block `blockId`; reading `block` here matched nothing, silently, on the first scoring. */
  reference?: { blockId: string; quote: string };
  mentions: { blockId: string; quote: string }[];
  entry?: string;
  listedBy?: "text";
}

const words = (s: string | undefined) => new Set(fold(s ?? "").split(/[^a-z0-9]+/u).filter(Boolean));
const bareYear = (y: string) => y.replace(/[a-z]$/u, "");
const lastWord = (s: string) => fold(s).split(/[^a-z0-9]+/u).filter(Boolean).pop() ?? "";

function surnameYear(row: Row, surname: string | null, year: string | null, ambiguous: boolean): boolean {
  if (!surname || !year) return false;
  const last = lastWord(surname);
  const places = [row.reference, ...row.mentions];
  const evidence = [row.authors, row.title, ...places.map((p) => p?.quote)].filter(
    (s): s is string => s !== undefined,
  );
  if (!last || !new Set(evidence.flatMap((s) => [...words(s)])).has(last)) return false;
  const wy = fold(year).trim();
  const ys = [
    row.year,
    ...evidence.flatMap(
      (s) =>
        s.match(/\b(?:1[5-9]|20)\d\d[a-z]?\b|\bforthcoming\b|\bin press\b|\bn\.?\s?d\.?(?=\s|[),;:]|$)/giu) ?? [],
    ),
  ]
    .filter((y): y is string => !!y)
    .map((y) => fold(y).trim());
  return ys.some((y) => y === wy || (!ambiguous && y === bareYear(wy)));
}

function blocksOfWork(w: TruthWork): string[] {
  /* The truth builder deliberately repeats the primary number/block in
     `aliases`. It is still one owner: counting it twice silently disables the
     exact-reference edge that this uniqueness check exists to protect. */
  return [...new Set([w.refBlock, ...(w.aliases ?? []).map((a) => a.refBlock)].filter((b): b is string => !!b))];
}
function numbersOfWork(w: TruthWork): number[] {
  return [w.number, ...(w.aliases ?? []).map((a) => a.number)].filter((n): n is number => typeof n === "number");
}
/** A PDF row's entry starts with its number: "8. Chen, J. …" or "[8] …". */
function entryNumber(row: Row): number | null {
  const m = row.entry ? /^\s*\[?(\d{1,4})[\]).\s]/u.exec(row.entry) : null;
  return m ? Number(m[1]) : null;
}

export interface MatchResult<R extends Row = Row> {
  covered: Set<string>;
  unmatched: R[];
  /** The globally one-to-one row assigned to each covered truth key. */
  matched: Map<string, R>;
}

/** Maximum one-to-one matching, exact edges first, then surname-and-year edges, by augmenting paths. */
export function match<R extends Row>(rows: readonly R[], works: readonly TruthWork[]): MatchResult<R> {
  const blockOwners = new Map<string, number>();
  for (const w of works) for (const b of blocksOfWork(w)) blockOwners.set(b, (blockOwners.get(b) ?? 0) + 1);
  const exact = (r: Row, w: TruthWork) =>
    (r.reference !== undefined && blockOwners.get(r.reference.blockId) === 1 && blocksOfWork(w).includes(r.reference.blockId)) ||
    (entryNumber(r) !== null && numbersOfWork(w).includes(entryNumber(r)!));
  const loose = (r: Row, w: TruthWork) => surnameYear(r, w.surname, w.year, w.ambiguous === true);
  const workOf = new Map<number, number>(); // row → work
  const rowOf = new Map<number, number>(); // work → row
  const augment = (edges: (r: Row, w: TruthWork) => boolean) => {
    const adj = rows.map((r) => works.flatMap((w, j) => (edges(r, w) ? [j] : [])));
    const tryRow = (i: number, seen: Set<number>): boolean => {
      for (const j of adj[i] ?? []) {
        if (seen.has(j)) continue;
        seen.add(j);
        const holder = rowOf.get(j);
        if (holder === undefined || tryRow(holder, seen)) {
          workOf.set(i, j);
          rowOf.set(j, i);
          return true;
        }
      }
      return false;
    };
    rows.forEach((_, i) => {
      if (!workOf.has(i)) tryRow(i, new Set());
    });
  };
  augment(exact);
  augment((r, w) => exact(r, w) || loose(r, w));
  const matched = new Map([...rowOf].map(([j, i]) => [works[j]!.key, rows[i]!]));
  return {
    covered: new Set(matched.keys()),
    unmatched: rows.filter((_, i) => !workOf.has(i)),
    matched,
  };
}

/** "15. Lever, C., Burton, S. & … (2006)." → Lever, 2006. */
export function fromEntry(entry: string | undefined): { surname: string | null; year: string | null } {
  if (!entry) return { surname: null, year: null };
  const surname = /^\s*\[?\d{1,4}[\]).]?\s+([^,]+),/u.exec(entry)?.[1]?.trim() ?? null;
  const years = entry.match(/\b(1[5-9]|20)\d\d[a-z]?\b/gu);
  return { surname, year: years?.[years.length - 1] ?? null };
}

function isListOnly(r: Row, truth: Truth): boolean {
  return (truth.listOnly ?? []).some(
    (l) => (l.refBlock && r.reference?.blockId === l.refBlock) || surnameYear(r, l.surname, l.year, false),
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const verbose = args.includes("-v");
  const wanted = args.filter((a) => !a.startsWith("-"));
  const sets = (wanted.length > 0 ? wanted : fs.readdirSync(OUT).filter((d) => fs.statSync(path.join(OUT, d)).isDirectory()))
    .filter((d) => !d.endsWith("-99"))
    .sort();

  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const store = await import("../../src/store/index.js");
  const { closeDb } = await import("../../src/db/client.js");
  const { buildBibliography, emptyDrops, noScoreDrops } = await import("../../src/bibliography.js");
  const { parseJsonAnswer } = await import("../../src/parse-json.js");

  const loaded = new Map<string, { blocks: Block[]; list: NumberedReferenceList | null }>();
  const load = async (slug: string) => {
    const hit = loaded.get(slug);
    if (hit) return hit;
    let value: { blocks: Block[]; list: NumberedReferenceList | null };
    if (slug === LECUN) {
      value = { blocks: (JSON.parse(fs.readFileSync(LECUN_FILE, "utf8")) as { blocks: Block[] }).blocks, list: null };
    } else {
      const article = await store.loadArticle(slug);
      value = { blocks: article.blocks, list: await referenceListFor(slug, article.meta?.source) };
    }
    loaded.set(slug, value);
    return value;
  };

  const out: Record<string, unknown>[] = [];
  const pct = (a: number, b: number) => `${Math.round((100 * a) / Math.max(1, b))}%`;
  console.log(["set", "slug", "truth", "model rows", "model", "unmatched", "list-only", "reader@80", "reader@300", "prompt tok", "out tok", "$", "s", "stop"].join("\t"));
  await runAsOwner(environmentOwnerId(), async () => {
    for (const set of sets) {
      const t = { truth: 0, model: 0, r80: 0, r300: 0, dollars: 0, unmatched: 0, rows: 0, failed: 0 };
      for (const file of fs.readdirSync(path.join(OUT, set)).sort()) {
        const raw = JSON.parse(fs.readFileSync(path.join(OUT, set, file), "utf8")) as RawResult;
        const truthFile = path.join(TRUTH, `${raw.slug}.json`);
        if (!fs.existsSync(truthFile)) {
          console.log(`${set}\t${raw.slug}\t(no truth file)`);
          continue;
        }
        const truth = JSON.parse(fs.readFileSync(truthFile, "utf8")) as Truth;
        const { blocks, list } = await load(raw.slug);
        /* A PDF's numbered work has no reference block; its surname and year come from its own entry. */
        if (list !== null) for (const w of truth.works) if (w.number != null && !w.surname) Object.assign(w, fromEntry(list.entries.get(w.number)));
        const n = truth.works.length;
        t.truth += n;
        t.dollars += raw.dollars ?? 0;
        /* A failed, refused or truncated call is zero recall, not a gap in the average (Sol, 8). */
        let parsed: { works?: unknown; capped?: unknown } | null = null;
        if (raw.answer !== null && raw.stopReason === "end_turn") {
          try {
            parsed = parseJsonAnswer<{ works?: unknown; capped?: unknown }>(raw.answer, "answer");
          } catch {
            parsed = null;
          }
        }
        if (parsed === null) {
          t.failed++;
          console.log(`${set}\t${raw.slug.slice(0, 28)}\t${n}\tFAILED: ${raw.error ?? raw.stopReason}\t$${(raw.dollars ?? 0).toFixed(3)}`);
          out.push({ set, slug: raw.slug, truth: n, failed: raw.error ?? raw.stopReason, dollars: raw.dollars });
          continue;
        }
        if ((list === null) !== (raw.referenceList === null)) throw new Error(`${raw.slug}: the reference list read now differs from the run's`);
        const build = (cap: number) =>
          buildBibliography(parsed!, {
            slug: raw.slug, blocks, sourceHash: "eval", power: "standard", elapsedMs: 0, inherit: null,
            drops: emptyDrops(), scores: noScoreDrops(), referenceList: list, cap,
          }).citations as unknown as Row[];
        let uncapped: Row[];
        let at80: Row[];
        let at300: Row[];
        try {
          uncapped = build(Number.POSITIVE_INFINITY);
          at80 = build(80);
          at300 = build(300);
        } catch (err) {
          /* Valid JSON can still be an invalid bibliography (`{}`, or a
             non-array `works`). That is a failed answer and zero recall, not a
             scorer crash that removes the arm from the aggregate. */
          const failed = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          t.failed++;
          console.log(`${set}\t${raw.slug.slice(0, 28)}\t${n}\tFAILED: ${failed}\t$${(raw.dollars ?? 0).toFixed(3)}`);
          out.push({ set, slug: raw.slug, truth: n, failed, dollars: raw.dollars });
          continue;
        }
        const modelRows = uncapped.filter((r) => r.listedBy === undefined);
        const m = match(modelRows, truth.works);
        const listOnly = m.unmatched.filter((r) => isListOnly(r, truth));
        const unmatched = m.unmatched.filter((r) => !isListOnly(r, truth));
        const r80 = match(at80, truth.works).covered.size;
        const r300 = match(at300, truth.works).covered.size;
        t.model += m.covered.size;
        t.r80 += r80;
        t.r300 += r300;
        t.unmatched += unmatched.length;
        t.rows += modelRows.length;
        const prompt = raw.usage.input + raw.usage.cacheRead + raw.usage.cacheWrite;
        console.log(
          [set, raw.slug.slice(0, 28), n, modelRows.length, `${m.covered.size} ${pct(m.covered.size, n)}`, unmatched.length,
            listOnly.length, pct(r80, n), pct(r300, n), prompt, raw.usage.output, (raw.dollars ?? 0).toFixed(3),
            Math.round(raw.elapsedMs / 1000), `${raw.stopReason}${parsed.capped === true ? " capped" : ""}`].join("\t"),
        );
        out.push({
          set, slug: raw.slug, truth: n, modelRows: modelRows.length, modelCovered: m.covered.size,
          unmatched: unmatched.map((r) => ({ title: r.title, authors: r.authors, year: r.year, quote: (r.reference ?? r.mentions[0])?.quote })),
          listOnly: listOnly.length, reader80: r80, reader300: r300, promptTokens: prompt, outputTokens: raw.usage.output,
          dollars: raw.dollars, seconds: Math.round(raw.elapsedMs / 1000), capped: parsed.capped === true,
          missed: truth.works.filter((w) => !m.covered.has(w.key)).map((w) => w.key),
        });
        if (verbose) {
          for (const r of unmatched) {
            console.log(`    unmatched: ${r.authors ?? "-"} | ${r.year ?? "-"} | ${r.title.slice(0, 60)} | ${(r.reference ?? r.mentions[0])?.quote?.slice(0, 50)}`);
          }
          for (const w of truth.works.filter((w) => !m.covered.has(w.key))) {
            console.log(`    missed: ${w.key} | ${w.citingWords ?? ""} | ${w.citedIn[0] ?? ""}`);
          }
        }
      }
      console.log(
        `${set}\tALL\t${t.truth}\t${t.rows}\t${t.model} ${pct(t.model, t.truth)}\t${t.unmatched}\t\t${pct(t.r80, t.truth)}\t${pct(t.r300, t.truth)}\t\t\t${t.dollars.toFixed(2)}\t\t${t.failed ? `${t.failed} failed` : ""}`,
      );
    }
  });
  if (args.includes("--json")) {
    fs.writeFileSync(path.join(OUT, "scores.json"), `${JSON.stringify(out, null, 2)}\n`);
  }
  await closeDb();
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) await main();
