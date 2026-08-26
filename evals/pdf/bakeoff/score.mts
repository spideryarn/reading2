/**
 * Judge the bake-off. Deterministic — no model involved.
 *
 *   npx tsx evals/pdf/bakeoff/score.mts
 *
 * READ THIS BEFORE READING ITS OUTPUT. Two reviewers found the same hole in it
 * independently: **it iterates over the pages the model claimed**, so a page
 * omitted entirely produces no row rather than a zero — which is the exact
 * failure the bake-off found, and this script did not catch it. It also folds
 * away case, punctuation and symbols that the prompt demands exactly, and
 * ignores record type, paragraph boundaries, `continues` and `uncertain`
 * altogether. It is a catastrophe detector, not a fidelity measure, and the
 * production checker is deliberately not this. See
 * docs/plans/pdf-ingestion.md#the-bake-off-and-what-it-decided-2026-08-26.
 *
 * Per page, against the pdf.js text layer minus the lines that repeat across
 * pages (running headers, footers, page numbers):
 *
 *   recall     baseline tokens found in the output      → omission, summary
 *   precision  output tokens found in the baseline      → invention
 *   order      longest common subsequence / baseline    → two columns interleaved,
 *                                                         paragraphs shuffled
 *
 * A multiset, not a set, so a duplicated paragraph cannot pay for a dropped one.
 */
import { readdir, readFile } from "node:fs/promises";

const OUT = process.env.BAKEOFF_OUT ?? "scratch-bakeoff";

const fold = (s: string) =>
  s.normalize("NFKC").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/gu, " ").toLowerCase().trim();
const tokens = (s: string) => (fold(s) ? fold(s).split(" ") : []);

function counts(list: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of list) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/** How many of `want` are present in `have`, counting duplicates properly. */
function overlap(want: string[], have: string[]): number {
  const pool = counts(have);
  let hit = 0;
  for (const t of want) {
    const n = pool.get(t) ?? 0;
    if (n > 0) { pool.set(t, n - 1); hit++; }
  }
  return hit;
}

/** LCS length, Hirschberg-free: these sequences are ~1k tokens, so O(n·m) is fine. */
function lcs(a: string[], b: string[]): number {
  let prev = new Uint32Array(b.length + 1);
  let cur = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!);
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return prev[b.length]!;
}

/** Lines that appear on three or more pages are furniture, not prose. */
function furniture(pages: { text: string }[]): Set<string> {
  const seen = new Map<string, number>();
  for (const p of pages) {
    for (const line of new Set(p.text.split("\n").map(fold).filter((l) => l.length > 3))) {
      seen.set(line, (seen.get(line) ?? 0) + 1);
    }
  }
  return new Set([...seen].filter(([, n]) => n >= 3).map(([l]) => l));
}

const files = (await readdir(OUT)).filter((f) => /\.c\d+\./.test(f));
const rows: Record<string, unknown>[] = [];

for (const doc of ["easy", "harder", "much-harder"]) {
  let pages: { page: number; text: string; words: number }[];
  try {
    pages = JSON.parse(await readFile(`${OUT}/${doc}.pass0.json`, "utf-8"));
  } catch { continue; }
  const junk = furniture(pages);
  const baselineFor = (page: number) => {
    const p = pages.find((x) => x.page === page);
    if (!p) return [];
    return p.text.split("\n").filter((l) => !junk.has(fold(l))).flatMap(tokens);
  };

  for (const file of files.filter((f) => f.startsWith(`${doc}.`))) {
    const r = JSON.parse(await readFile(`${OUT}/${file}`, "utf-8"));
    if (!r.records) continue;
    const byPage = new Map<number, string[]>();
    for (const rec of r.records) {
      const list = byPage.get(rec.page) ?? [];
      list.push(rec.text ?? "");
      byPage.set(rec.page, list);
    }
    for (const [page, texts] of [...byPage].sort((a, b) => a[0] - b[0])) {
      const base = baselineFor(page);
      const got = texts.flatMap(tokens);
      if (base.length === 0) {
        rows.push({ doc, page, reader: r.reader, base: 0, got: got.length, recall: null, precision: null, order: null });
        continue;
      }
      const common = lcs(base, got);
      rows.push({
        doc,
        page,
        reader: r.reader,
        base: base.length,
        got: got.length,
        recall: +(overlap(base, got) / base.length).toFixed(3),
        precision: got.length ? +(overlap(got, base) / got.length).toFixed(3) : 0,
        order: +(common / base.length).toFixed(3),
      });
    }
  }
}

rows.sort((a, b) => `${a.doc}${String(a.page).padStart(3, "0")}${a.reader}`.localeCompare(`${b.doc}${String(b.page).padStart(3, "0")}${b.reader}`));
console.log("doc          pg  reader                 base   got  recall  prec  order");
for (const r of rows) {
  console.log(
    `${String(r.doc).padEnd(12)} ${String(r.page).padStart(2)}  ${String(r.reader).padEnd(21)} ${String(r.base).padStart(4)}  ${String(r.got).padStart(4)}  ` +
      `${r.recall === null ? "   — " : String(r.recall).padStart(5)}  ${r.precision === null ? "  — " : String(r.precision).padStart(5)}  ${r.order === null ? "  — " : String(r.order).padStart(5)}`,
  );
}
