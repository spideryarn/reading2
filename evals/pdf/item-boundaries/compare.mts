/**
 * **Cluster N's corpus comparison: pass0's page text as it is, against the same
 * text split at the line breaks pdf.js failed to mark.** No model call, no
 * network, no cost. docs/plans/260911b-pdf-item-boundaries-evidence.md
 *
 *   npx tsx evals/pdf/item-boundaries/compare.mts [--local <file.pdf>]... [--db]
 *     [--out <results.json>]
 *
 * The committed corpus is every `source.pdf` under evals/pdf. `--local` adds a
 * file that may not be committed — Kuhn's full 142 pages, whose three-page cut is
 * all the repository may hold (evals/pdf/titles/kuhn-landscape-of-consciousness/
 * LICENCE.md). `--db` adds the transcriptions already bought and sitting in the
 * local database's `pdf-chunk` checkpoints for any document in the run, matched
 * by the raw file's hash; it reads `DATABASE_URL` and writes nothing.
 *
 * For each document it reports four things, and none of them is a verdict — the
 * plan draws that:
 *
 *   1. **Fidelity of the instrument.** This module's reading of the items must
 *      equal pass0's page text on every page, or the run stops.
 *   2. **The boundary census.** Every join with no whitespace and no end-of-line
 *      marker, by kind, with the |Δy| distribution that `LINE_BREAK` is checked
 *      against.
 *   3. **Heading evidence, old against new.** What `folioOffset` + `defusedFolios`
 *      recover by vote, set beside what the item boundary shows directly.
 *   4. **Refusal reasons, old against new.** Every transcription we have, scored
 *      by the unchanged `check` twice — once over pass0's text, once over the
 *      split text — and the same again with each numbered heading corrupted, to
 *      ask what the new reading lets through that the old did not.
 *
 * Output carries numbers, never prose: a token with no digit in it is printed
 * with its letters masked, because some of these documents are not ours to quote.
 */
import { readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isMain } from "../../../src/is-main.js";
import { type Pass0, type PdfRecord, RENDERED, pass0, repeatedLines } from "../../../src/pdf.js";
import { check, defusedFolios, folioOf } from "../../../src/pdf-score.js";
import {
  type BoundaryKind,
  classify,
  headingsAtLineBreaks,
  LINE_BREAK,
  pageTextAsPass0,
  pageTextSplitAtEveryJoin,
  pageTextSplitAtLineBreaks,
  readRawPages,
  truncatedHeading,
} from "./boundaries.mjs";

const ROOT = path.join(import.meta.dirname, "..");

/** A token as it may be printed: kept if it carries a digit, otherwise its letters masked. */
export const shape = (token: string) => (/\d/u.test(token) ? token : token.replace(/\p{L}/gu, "x"));

/** The same document with its page text split at unmarked line breaks, and everything pass0 derives from text re-derived. */
export function splitPass(pass: Pass0, split: string[]): Pass0 {
  const pages = pass.pages.map((p, i) => {
    const text = split[i]!;
    return { ...p, text, words: text ? text.split(/\s+/).length : 0 };
  });
  return { ...pass, pages, furniture: repeatedLines(pages) };
}

interface Reading {
  source: string;
  records: PdfRecord[];
}

/** Did this mutation add the token, or was the same fault already present? */
export function mutationResult(before: readonly string[], after: readonly string[], token: string) {
  if (before.includes(token)) return "confounded" as const;
  return after.includes(token) ? "caught" as const : "missed" as const;
}

/** The requested pages of a reading, inferred from the pages its records claim — the same for both arms. */
const requestedOf = (records: PdfRecord[]) => [...new Set(records.map((r) => r.page))].sort((a, b) => a - b);

/** A reading scored on both arms: what changed in the gate, and what the gate said. */
function scoreBoth(records: PdfRecord[], old: Pass0, fresh: Pass0) {
  const requested = requestedOf(records);
  const a = check(records, requested, old);
  const b = check(records, requested, fresh);
  return { a, b, requested };
}

async function readingsFromDb(sha: string): Promise<Reading[]> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("--db needs DATABASE_URL (the local database); nothing was read");
  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const rows = await client.query(
      `select distinct on (k.article_id, k.key) a.slug, k.key, k.value
         from spideryarn.checkpoints k
         join spideryarn.articles a on a.id = k.article_id
         join spideryarn.article_revisions r on r.article_id = a.id
        where k.namespace = 'pdf-chunk' and r.raw_sha256 = $1`,
      [sha],
    );
    return rows.rows
      .filter((r) => r.value?.finish === "stop" && Array.isArray(r.value.records))
      .map((r) => ({ source: `db:${r.slug}/${r.key}`, records: r.value.records as PdfRecord[] }));
  } finally {
    await client.end();
  }
}

/** Transcriptions committed beside a fixture (evals/pdf/titles/<slug>/records-*.json), for the cut they were read from. */
async function readingsBeside(file: string): Promise<Reading[]> {
  const dir = path.dirname(file);
  const names = (await readdir(dir)).filter((n) => /^records-.*\.json$/u.test(n));
  return names.map((n) => ({
    source: path.relative(ROOT, path.join(dir, n)),
    records: JSON.parse(readFileSync(path.join(dir, n), "utf8")).transcript as PdfRecord[],
  }));
}

export async function compareDocument(file: string, opts: { db: boolean }) {
  const bytes = readFileSync(file);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const [raw, old] = await Promise.all([readRawPages(file), pass0(file)]);

  /* 1 — the instrument must read what pass0 reads, or nothing below means anything. */
  const mismatched = raw.map((items, i) => pageTextAsPass0(items) !== old.pages[i]!.text ? i + 1 : 0).filter(Boolean);
  if (raw.length !== old.pages.length || mismatched.length) {
    throw new Error(
      `${file}: the harness's page text differs from pass0's on page(s) ${mismatched.join(", ")} — ` +
        "nothing it says about this document would be about what pass0 produces",
    );
  }

  /* 2 — the census. */
  const kinds: Record<BoundaryKind, number> = { touching: 0, gap: 0, shift: 0, "line-break": 0 };
  const dyBins = { "0.15-0.3": 0, "0.3-0.5": 0, "0.5-0.7": 0, "0.7-1.0": 0, "1.0-2.0": 0, "2.0+": 0 };
  const lineBreakExamples: string[] = [];
  let nearestBreak = Number.POSITIVE_INFINITY;
  let largestShift = 0;
  for (const [i, items] of raw.entries()) {
    for (const b of classify(items)) {
      kinds[b.kind]++;
      if (b.dy > 0.15) {
        const bin = b.dy <= 0.3 ? "0.15-0.3" : b.dy <= 0.5 ? "0.3-0.5" : b.dy <= 0.7 ? "0.5-0.7" : b.dy <= 1 ? "0.7-1.0" : b.dy <= 2 ? "1.0-2.0" : "2.0+";
        dyBins[bin]++;
      }
      if (b.kind === "line-break") {
        nearestBreak = Math.min(nearestBreak, b.dy);
        if (lineBreakExamples.length < 12) lineBreakExamples.push(`p${i + 1} ${shape(b.left)}|${shape(b.right)} dy=${b.dy}`);
      } else largestShift = Math.max(largestShift, b.dy);
    }
  }

  /* 3 — heading evidence. Old: the elected folio stripped off a line-initial heading. New: a heading that starts at an unmarked line break. */
  const split = raw.map(pageTextSplitAtLineBreaks);
  const fresh = splitPass(old, split);
  const control = splitPass(old, raw.map(pageTextSplitAtEveryJoin));
  const headings = { both: [] as string[], oldOnly: [] as string[], newOnly: [] as string[] };
  for (const [i, items] of raw.entries()) {
    const page = i + 1;
    const before = new Set(defusedFolios(old.pages[i]!.text, folioOf(old, page)).map((h) => h.replace(/\.$/u, "")));
    const after = new Set(headingsAtLineBreaks(items).map((h) => h.replace(/\.$/u, "")));
    for (const h of before) (after.has(h) ? headings.both : headings.oldOnly).push(`p${page} ${h}`);
    for (const h of after) if (!before.has(h)) headings.newOnly.push(`p${page} ${h}`);
  }
  /* What folioOffset would still do if the split reading were adopted and it were left in. */
  const stillDefused = fresh.pages.flatMap((p) =>
    defusedFolios(p.text, folioOf(fresh, p.page))
      .filter((h) => !p.text.split(/\s+/u).includes(h))
      .map((h) => `p${p.page} ${h}`),
  );

  /* The text-level cost of the split, which is what an implementation would have to carry. */
  const text = {
    pagesChanged: split.filter((t, i) => t !== old.pages[i]!.text).length,
    newlinesAdded: split.reduce((n, t, i) => n + (t.split("\n").length - old.pages[i]!.text.split("\n").length), 0),
    wordsBefore: old.pages.reduce((n, p) => n + p.words, 0),
    wordsAfter: fresh.pages.reduce((n, p) => n + p.words, 0),
    furnitureAdded: [...fresh.furniture].filter((f) => !old.furniture.has(f)).map(shape),
    furnitureRemoved: [...old.furniture].filter((f) => !fresh.furniture.has(f)).map(shape),
  };

  /* 4 — refusal reasons, on every transcription we already own. */
  const readings = [...(await readingsBeside(file)), ...(opts.db ? await readingsFromDb(sha) : [])];
  const refusals = {
    readings: readings.length,
    verdictChanged: [] as string[],
    /* The negative control: the same readings over text split at EVERY join. */
    controlVerdictChanged: 0,
    controlFailuresChanged: 0,
    failuresChanged: [] as { source: string; oldOnly: string[]; newOnly: string[] }[],
    oldFailing: 0,
    newFailing: 0,
    invented: { oldOnly: [] as string[], newOnly: [] as string[] },
  };
  const adversarial = {
    candidates: 0,
    mutations: 0,
    caughtOld: 0,
    caughtNew: 0,
    /* A mutation cannot prove that it caused an `invented` token when the
       unmodified reading already reported that exact token. Keep those cases
       out of both the numerator and denominator instead of letting an existing
       fault masquerade as a caught mutation. */
    confounded: [] as string[],
    missedOnlyByNew: [] as string[],
    missedOnlyByOld: [] as string[],
    missedByBoth: [] as string[],
  };
  for (const reading of readings) {
    const outOfRange = reading.records.some((r) => r.page < 1 || r.page > old.pages.length);
    if (outOfRange) continue;
    const { a, b } = scoreBoth(reading.records, old, fresh);
    const c = check(reading.records, requestedOf(reading.records), control);
    if (a.ok !== c.ok) refusals.controlVerdictChanged++;
    if (a.failures.join("\n") !== c.failures.join("\n")) refusals.controlFailuresChanged++;
    if (!a.ok) refusals.oldFailing++;
    if (!b.ok) refusals.newFailing++;
    if (a.ok !== b.ok) refusals.verdictChanged.push(`${reading.source}: ${a.ok ? "pass" : "fail"} -> ${b.ok ? "pass" : "fail"}`);
    const fa = a.failures.map(maskFailure);
    const fb = b.failures.map(maskFailure);
    const oldOnly = fa.filter((f) => !fb.includes(f));
    const newOnly = fb.filter((f) => !fa.includes(f));
    if (oldOnly.length || newOnly.length) refusals.failuresChanged.push({ source: reading.source, oldOnly, newOnly });
    for (const t of a.overall.invented) if (!b.overall.invented.includes(t)) refusals.invented.oldOnly.push(`${reading.source} ${t}`);
    for (const t of b.overall.invented) if (!a.overall.invented.includes(t)) refusals.invented.newOnly.push(`${reading.source} ${t}`);

    /* The question a widened rule has to answer: corrupt one numbered heading at a time and see who still says so. */
    for (const [n, record] of reading.records.entries()) {
      if (!RENDERED.has(record.type)) continue;
      const corrupted = truncatedHeading(record.text);
      if (corrupted === null) continue;
      const token = corrupted.split(" ")[0]!.replace(/\.$/u, "");
      adversarial.candidates++;
      const mutated = reading.records.map((r, j) => (j === n ? { ...r, text: corrupted } : r));
      const m = scoreBoth(mutated, old, fresh);
      const oldResult = mutationResult(a.overall.invented, m.a.overall.invented, token);
      const newResult = mutationResult(b.overall.invented, m.b.overall.invented, token);
      if (oldResult === "confounded" || newResult === "confounded") {
        adversarial.confounded.push(`${reading.source} p${record.page} ${token}`);
        continue;
      }
      const caughtA = oldResult === "caught";
      const caughtB = newResult === "caught";
      adversarial.mutations++;
      if (caughtA) adversarial.caughtOld++;
      if (caughtB) adversarial.caughtNew++;
      if (caughtA && !caughtB) adversarial.missedOnlyByNew.push(`${reading.source} p${record.page} ${token}`);
      if (caughtB && !caughtA) adversarial.missedOnlyByOld.push(`${reading.source} p${record.page} ${token}`);
      if (!caughtA && !caughtB) adversarial.missedByBoth.push(`${reading.source} p${record.page} ${token}`);
    }
  }

  return {
    /* A file outside the repository is named by its basename alone: its path is somebody's home directory. */
    file: path.relative(process.cwd(), file).startsWith("..") ? path.basename(file) : path.relative(process.cwd(), file),
    sha: sha.slice(0, 12),
    pages: old.pages.length,
    folioOffsetOld: folioOf(old, 1) === null ? null : Number(folioOf(old, 1)) - 1,
    census: { kinds, dyBins, nearestBreak: Number.isFinite(nearestBreak) ? nearestBreak : null, largestShift, lineBreakExamples },
    headings,
    stillDefused,
    text,
    refusals,
    adversarial,
  };
}

/** A failure sentence with its quoted prose masked, so two arms' sentences can be compared and printed. */
const maskFailure = (f: string) => f.replace(/“[^”]*”/gu, (q) => shape(q));

/** One line per document; `--out` has the rest. */
function summaryLine(r: Awaited<ReturnType<typeof compareDocument>>): string {
  const k = r.census.kinds;
  return [
    `${r.file.slice(-48).padEnd(48)} ${String(r.pages).padStart(3)}pp`,
    `joins t${k.touching} g${k.gap} s${k.shift} L${k["line-break"]} (largest shift ${r.census.largestShift}, nearest break ${r.census.nearestBreak})`,
    `headings both ${r.headings.both.length} old-only ${r.headings.oldOnly.length} new-only ${r.headings.newOnly.length}`,
    `readings ${r.refusals.readings} failing ${r.refusals.oldFailing}->${r.refusals.newFailing} verdicts changed ${r.refusals.verdictChanged.length}, failure lists ${r.refusals.failuresChanged.length} (control: ${r.refusals.controlVerdictChanged} verdicts, ${r.refusals.controlFailuresChanged} failure lists)`,
    `corrupted headings caught ${r.adversarial.caughtOld}->${r.adversarial.caughtNew} of ${r.adversarial.mutations} unconfounded (${r.adversarial.confounded.length} confounded)`,
  ].join(" | ");
}

async function main() {
  const args = process.argv.slice(2);
  const local = args.flatMap((a, i) => (a === "--local" ? [args[i + 1]!] : []));
  const out = args.flatMap((a, i) => (a === "--out" ? [args[i + 1]!] : []))[0];
  const db = args.includes("--db");
  const committed = [
    ...["easy", "harder", "much-harder"].map((d) => path.join(ROOT, d, "source.pdf")),
    ...(await readdir(path.join(ROOT, "titles"), { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => path.join(ROOT, "titles", d.name, "source.pdf")),
  ];
  const results = [];
  for (const file of [...committed, ...local]) {
    const r = await compareDocument(file, { db });
    results.push(r);
    console.log(summaryLine(r));
  }
  console.log(`\nLINE_BREAK = ${LINE_BREAK}; ${results.length} documents`);
  if (out) await writeFile(out, `${JSON.stringify({ at: new Date().toISOString(), LINE_BREAK, results }, null, 2)}\n`);
}

if (isMain(import.meta.url)) void main();
