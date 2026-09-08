/**
 * **Is the table in the output the table the source had?** — matched by
 * provenance id, compared cell by cell, with no model and no network.
 *
 *   npx tsx evals/extraction/table-oracle.mts
 *   npx tsx evals/extraction/table-oracle.mts --json out.json
 *
 * The rest of this directory measures **text recall** and **source ordering**,
 * and Sol's standing objection to both is that neither can see *a datum moved
 * into the wrong row*. A table can survive with every character intact and every
 * row in document order and still say something false: swap two figures inside a
 * row and recall is 100%, ordering is perfect, and the reader is misinformed.
 * So a claim about a table-bearing page needs an oracle of its own, and this is
 * it — see
 * [260904e § What survives of C2](../../docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md).
 *
 * ## Matched by provenance id, never by caption
 *
 * [`stampSourceIds`](../../src/extract.ts) already puts an exact identity on
 * every source element and [`sourceRefOf`](../../src/extract.ts) reads it back
 * off an output node, so "which source table is this" is a lookup rather than a
 * guess. Caption matching — the first draft's proposal — is fuzzy where it is
 * not simply absent: **the ar5iv tables have no `<caption>` at all**, their
 * labels are sibling `<figcaption>` elements, so a caption matcher would have
 * matched none of the four tables the stage exists to recover.
 *
 * An output table is accepted as a match only when the id it resolves to names a
 * `<table>` in the source. `sourceRefOf`'s fallbacks are kept — a Readability
 * wrapper resolves through its first stamped descendant — but a fallback that
 * lands on a `<tbody>` or a `<tr>` is *not* a table match and is reported
 * unmatched rather than quietly accepted.
 *
 * ## The projection is semantic, not textual
 *
 * Each cell projects to **tag name (`th` vs `td`), normalised visible text,
 * `rowSpan`, `colSpan`, and the hrefs of the links inside it**. Coordinate text
 * alone passes while `<th>`s silently become `<td>`s, spans vanish, or links
 * disappear leaving their text behind. This is concrete rather than
 * theoretical: the ar5iv Table 2 (`s1865` in the stamped source) carries one
 * `rowspan` and four `colspan`s, and stripping all five would pass a text-only
 * oracle unchanged.
 *
 * **The link list is this file's addition to the projection the plan
 * specified**, and it is there because the plan asks for a mutation case that
 * deletes a link and leaves its text — a mutation the plan's own four-field
 * projection cannot see. Tag, text and the two spans are all identical after it.
 *
 * ## What is normalised away, written down as data rather than as looseness
 *
 * `NORMALISATIONS` below is the whole list, and **anything outside it is a
 * difference this oracle reports**. Each entry is a real difference in the
 * current corpus, not a defensive maybe:
 *
 * 1. **A wholly empty row may appear on one side and not the other.** There are
 *    **five of them across five source tables in four fixtures** —
 *    `pg-greatwork`, `man-open` and three in `hn-dropbox`.
 *
 *    **The plan's evidence for this one does not hold, and the measurement is
 *    the authority.** It says the GDP fixture's regional table is *"15 source
 *    rows against 14 output rows"*; at the snapshot point the plan itself
 *    specifies — post-`prepareDocument` — the source table already has **14**,
 *    because the fifteenth is `<tr class="mw-empty-elt">` and
 *    [`removePlatformFurniture`](../../src/furniture.ts) deletes it before
 *    Readability ever sees it. Kept as a normalisation anyway: the class of
 *    difference is real, four other fixtures have one, and a rule that has to be
 *    added back the first time somebody swaps a fixture is a rule worth having
 *    now.
 * 2. **Non-visible nodes are stripped before text is read** — `<script>`,
 *    `<style>`, `<noscript>`, `<template>`. One cell of the GDP table (`s1029`)
 *    has a `textContent` of 198 characters of which 194 are an inline
 *    stylesheet that Readability removes; the visible text is four characters.
 * 3. **Whitespace**: every run of `\s` collapses to one space and the result is
 *    trimmed. No case folding — a difference in case is a difference.
 *
 * Two things are deliberately **not** normalised, so that they go red rather
 * than pass:
 *
 * - **Hidden-but-present nodes** (`hidden`, `aria-hidden="true"`, an inline
 *   `display:none`). Readability drops these in its node-prep walk, so they are
 *   a plausible legitimate difference — but there are **zero of them inside the
 *   192 tables of the corpus**, so normalising them would be widening the
 *   allowance on a case nobody has. If one ever turns up, this reports it and
 *   somebody decides then, which is the right order.
 * - **A link Readability itself unwraps.** `_fixRelativeUris` replaces a
 *   `javascript:` anchor with its own text, which this reports as a link
 *   difference. That is honest — it *is* a link that vanished leaving its text —
 *   and no corpus table has one.
 *
 * ## What it does not print
 *
 * Cell text never leaves this file. A reported text difference carries the two
 * cells' character counts and an eight-hex-digit digest, which is enough to see
 * that two cells swapped places and not enough to reconstruct a sentence.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ALL_FIXTURES } from "./corpus.mjs";
import { readArticleWithProvenance, sourceRefOf } from "../../src/extract.js";
import { RESERVED_ATTRS } from "../../src/reserved.js";
import { isMain } from "../../src/is-main.js";

/**
 * The permitted differences, as data. Read this before believing an "agrees":
 * an agreement is only as strong as this list is short.
 */
export const NORMALISATIONS = [
  {
    name: "empty-row-may-vanish",
    what:
      "A row with no cells, or whose every cell has empty text, no links and no " +
      "embedded media, is dropped from both sides before rows are lined up.",
  },
  {
    name: "non-visible-nodes-stripped",
    what: "script, style, noscript and template subtrees are removed before a cell's text is read.",
  },
  {
    name: "whitespace-collapsed",
    what: "Every run of /\\s+/u in a cell's text becomes one space, and the result is trimmed. Case is kept.",
  },
] as const;

/** Removed from a cell before its text is read — normalisation 2. */
const NON_VISIBLE = "script, style, noscript, template";

/** Content that makes a cell non-empty even with no text — see `isWhollyEmptyRow`. */
const EMBEDDED_MEDIA = "img, svg, picture, video, audio, iframe, object, embed, canvas, math";

/** Normalisation 3, and the only whitespace rule in this file. */
const normaliseText = (s: string): string => s.replace(/\s+/gu, " ").trim();

/** Eight hex digits of SHA-256 — enough to compare two cells, not enough to read one. */
const digest = (s: string): string => createHash("sha256").update(s, "utf-8").digest("hex").slice(0, 8);

/** What one cell is, for the purposes of "is this the same table". */
export interface CellProjection {
  /** `th` or `td` — a header cell silently demoted to a data cell is a real loss. */
  tag: string;
  /** Normalised visible text. **Never printed and never put in a difference.** */
  text: string;
  rowSpan: number;
  colSpan: number;
  /** Resolved hrefs of `a[href]` inside the cell, in document order. */
  links: string[];
}

/** One table, flattened to the shape the comparison actually reads. */
export interface TableProjection {
  /** Rows that survived `empty-row-may-vanish`, in document order. */
  rows: CellProjection[][];
  /** How many wholly empty rows were dropped — reported, never silent. */
  emptyRowsIgnored: number;
}

/**
 * A difference the oracle **reports**. Every variant names both sides, so a
 * reader never has to work out which number is which — `structure lost: h2 0/6`
 * was misread as "none lost" when the 0 was the number *kept*, and the fix is
 * that no field here is a bare count whose direction has to be inferred.
 *
 * `row` and `cell` are indices into the **compared** sequence, i.e. after
 * `empty-row-may-vanish` has removed rows from both sides.
 */
export type TableDifference =
  | { kind: "row-count-differs"; sourceRows: number; outputRows: number }
  | { kind: "cells-in-row-differ"; row: number; sourceCells: number; outputCells: number }
  | { kind: "cell-tag-differs"; row: number; cell: number; sourceTag: string; outputTag: string }
  | {
      kind: "cell-text-differs";
      row: number;
      cell: number;
      sourceChars: number;
      outputChars: number;
      sourceDigest: string;
      outputDigest: string;
    }
  | { kind: "cell-rowspan-differs"; row: number; cell: number; sourceRowSpan: number; outputRowSpan: number }
  | { kind: "cell-colspan-differs"; row: number; cell: number; sourceColSpan: number; outputColSpan: number }
  | {
      kind: "cell-links-differ";
      row: number;
      cell: number;
      sourceLinks: number;
      outputLinks: number;
      sourceDigest: string;
      outputDigest: string;
    };

/** One source table and the output table that claims to be it. */
export interface MatchedTable {
  /** The source element's provenance id, e.g. `s1865`. */
  sourceId: string;
  /** How the output table was traced back — `direct` is the only certain answer. */
  how: "direct" | "descendant" | "ancestor";
  sourceRowsCompared: number;
  outputRowsCompared: number;
  sourceEmptyRowsIgnored: number;
  outputEmptyRowsIgnored: number;
  sourceCellsCompared: number;
  differences: TableDifference[];
  /** No differences outside `NORMALISATIONS`. */
  agrees: boolean;
}

/** An output table that could not be traced to a source table. */
export interface UnmatchedOutputTable {
  /** What `sourceRefOf` resolved to, if anything — the id of a non-table element, or null. */
  resolvedId: string | null;
  how: "direct" | "descendant" | "ancestor" | "none";
  /** The tag of the source element that id names, when it names one. */
  resolvedTag: string | null;
}

export interface TableOracleResult {
  /** `<table>` elements in the post-`prepareDocument` stamped source. */
  sourceTablesInSource: number;
  /** `<table>` elements in what Readability returned. */
  outputTablesInOutput: number;
  /** One entry per output table that resolved to a source `<table>`. */
  matched: MatchedTable[];
  /** Of `matched`, how many had no difference outside `NORMALISATIONS`. */
  matchedTablesAgreeing: number;
  /** Of `matched`, how many reported at least one difference. */
  matchedTablesDisagreeing: number;
  /**
   * Source ids of source tables no output table claimed. **A different finding
   * from the next field** — this is a table that did not survive extraction;
   * that one is output that cannot be traced back. They must not be added up.
   */
  sourceTablesWithNoOutputCounterpart: string[];
  /** Output tables that resolved to nothing, or to something that is not a source table. */
  outputTablesWithNoSourceCounterpart: UnmatchedOutputTable[];
  /** Source ids two or more output tables both claimed — a fan-out, reported rather than hidden. */
  sourceIdsClaimedByMoreThanOneOutputTable: string[];
}

/**
 * The stamped source element with this id — used only to say *what* an
 * untraceable output table resolved to, so the report can distinguish "resolved
 * to a `<tbody>`" from "resolved to nothing".
 *
 * The pattern guard is not paranoia about the corpus — `stampSourceIds` mints
 * `s1`, `s2`, … — it is so that an id from somewhere else can never be a
 * selector fragment.
 */
function findStamped(source: Document, id: string): Element | null {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  return source.querySelector(`[${RESERVED_ATTRS.sourceRef}="${id}"]`);
}

/**
 * The `<tr>`s that belong to this table and not to one nested inside it.
 *
 * Exported with `ownCells` for `tests/table-oracle.test.ts`, which has to name
 * the cell it mutates by **the same coordinates the comparison counts in**. A
 * test that found its own row by `querySelectorAll("tr")` would drift from this
 * the first time a fixture gained a nested table, and would then assert a
 * difference at coordinates the oracle never uses.
 */
export function ownRows(table: Element): Element[] {
  return Array.from(table.querySelectorAll("tr")).filter((r) => r.closest("table") === table);
}

/** The `th`/`td` children of a row — not a nested table's cells. */
export function ownCells(row: Element): Element[] {
  return Array.from(row.children).filter((c) => c.localName === "th" || c.localName === "td");
}

/**
 * The IDL property where the DOM offers one, the attribute where it does not.
 * Both sides go through the same function, so the two agree by construction and
 * a difference is a real difference.
 */
function spanOf(cell: Element, prop: "rowSpan" | "colSpan", attr: "rowspan" | "colspan"): number {
  const idl = (cell as unknown as Record<string, unknown>)[prop];
  if (typeof idl === "number" && Number.isFinite(idl) && idl > 0) return idl;
  const parsed = Number.parseInt(cell.getAttribute(attr) ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** Absolute where the DOM resolves it, the raw attribute where it does not. */
function hrefOf(anchor: Element): string {
  const idl = (anchor as unknown as Record<string, unknown>).href;
  return typeof idl === "string" && idl.length > 0 ? idl : (anchor.getAttribute("href") ?? "");
}

function projectCell(cell: Element): CellProjection {
  const clone = cell.cloneNode(true) as Element;
  for (const el of Array.from(clone.querySelectorAll(NON_VISIBLE))) el.remove();
  return {
    tag: cell.localName,
    text: normaliseText(clone.textContent ?? ""),
    rowSpan: spanOf(cell, "rowSpan", "rowspan"),
    colSpan: spanOf(cell, "colSpan", "colspan"),
    links: Array.from(cell.querySelectorAll("a[href]")).map(hrefOf),
  };
}

/**
 * Normalisation 1's predicate, and it is deliberately narrow: a row of images
 * with empty `alt` is not an empty row, it is a row of pictures, and treating it
 * as one would let a whole band of a table vanish unreported.
 */
function isWhollyEmptyRow(row: Element, cells: CellProjection[]): boolean {
  if (cells.length === 0) return true;
  if (row.querySelector(EMBEDDED_MEDIA)) return false;
  return cells.every((c) => c.text === "" && c.links.length === 0);
}

/** One table, projected. After this the comparison never touches a DOM again. */
export function projectTable(table: Element): TableProjection {
  const rows: CellProjection[][] = [];
  let emptyRowsIgnored = 0;
  for (const row of ownRows(table)) {
    const cells = ownCells(row).map(projectCell);
    if (isWhollyEmptyRow(row, cells)) emptyRowsIgnored += 1;
    else rows.push(cells);
  }
  return { rows, emptyRowsIgnored };
}

/**
 * One cell against its counterpart. Split out of `compareProjections` so each
 * of the five things the projection carries is compared in one visible place —
 * a cell whose comparison is missing is the failure this oracle would be least
 * able to notice about itself.
 */
function compareCells(
  row: number,
  cell: number,
  a: CellProjection,
  b: CellProjection,
): TableDifference[] {
  const differences: TableDifference[] = [];
  if (a.tag !== b.tag) {
    differences.push({ kind: "cell-tag-differs", row, cell, sourceTag: a.tag, outputTag: b.tag });
  }
  if (a.text !== b.text) {
    differences.push({
      kind: "cell-text-differs",
      row,
      cell,
      sourceChars: a.text.length,
      outputChars: b.text.length,
      sourceDigest: digest(a.text),
      outputDigest: digest(b.text),
    });
  }
  if (a.rowSpan !== b.rowSpan) {
    differences.push({
      kind: "cell-rowspan-differs",
      row,
      cell,
      sourceRowSpan: a.rowSpan,
      outputRowSpan: b.rowSpan,
    });
  }
  if (a.colSpan !== b.colSpan) {
    differences.push({
      kind: "cell-colspan-differs",
      row,
      cell,
      sourceColSpan: a.colSpan,
      outputColSpan: b.colSpan,
    });
  }
  const aLinks = a.links.join("\n");
  const bLinks = b.links.join("\n");
  if (aLinks !== bLinks) {
    differences.push({
      kind: "cell-links-differ",
      row,
      cell,
      sourceLinks: a.links.length,
      outputLinks: b.links.length,
      sourceDigest: digest(aLinks),
      outputDigest: digest(bLinks),
    });
  }
  return differences;
}

/**
 * Two projections, compared. Stops descending where it has already reported the
 * shape — a row-count difference does not then also report every cell of the
 * rows that have no counterpart, because one lost row would otherwise arrive as
 * two hundred findings.
 */
export function compareProjections(
  source: TableProjection,
  output: TableProjection,
): TableDifference[] {
  const differences: TableDifference[] = [];
  if (source.rows.length !== output.rows.length) {
    differences.push({
      kind: "row-count-differs",
      sourceRows: source.rows.length,
      outputRows: output.rows.length,
    });
  }
  const rows = Math.min(source.rows.length, output.rows.length);
  for (let r = 0; r < rows; r++) {
    const src = source.rows[r] ?? [];
    const out = output.rows[r] ?? [];
    if (src.length !== out.length) {
      differences.push({
        kind: "cells-in-row-differ",
        row: r,
        sourceCells: src.length,
        outputCells: out.length,
      });
    }
    const cells = Math.min(src.length, out.length);
    for (let c = 0; c < cells; c++) {
      const a = src[c];
      const b = out[c];
      if (!a || !b) continue;
      differences.push(...compareCells(r, c, a, b));
    }
  }
  return differences;
}

/**
 * **The oracle.** `source` is the post-`prepareDocument`, stamped source
 * document — `readArticleWithProvenance().source`, and nothing earlier: two of
 * the corpus's legitimate differences are `prepareDocument`'s own work, and
 * comparing against the raw parse would report them as corruption. `output` is
 * the extracted content element from the same call.
 */
export function tableOracle(source: Document, output: Element): TableOracleResult {
  const sourceTables = new Map<string, Element>();
  for (const table of Array.from(source.querySelectorAll("table"))) {
    const { id } = sourceRefOf(table);
    if (id) sourceTables.set(id, table);
  }

  const outputTables = Array.from(output.querySelectorAll("table"));
  const matched: MatchedTable[] = [];
  const unmatchedOutput: UnmatchedOutputTable[] = [];
  const claimedBy = new Map<string, number>();

  for (const table of outputTables) {
    const { id, how } = sourceRefOf(table);
    const counterpart = id === null ? undefined : sourceTables.get(id);
    if (!id || how === "none" || !counterpart) {
      const resolved = id === null ? null : findStamped(source, id);
      unmatchedOutput.push({
        resolvedId: id,
        how,
        resolvedTag: resolved?.localName ?? null,
      });
      continue;
    }
    claimedBy.set(id, (claimedBy.get(id) ?? 0) + 1);
    const src = projectTable(counterpart);
    const out = projectTable(table);
    const differences = compareProjections(src, out);
    matched.push({
      sourceId: id,
      how,
      sourceRowsCompared: src.rows.length,
      outputRowsCompared: out.rows.length,
      sourceEmptyRowsIgnored: src.emptyRowsIgnored,
      outputEmptyRowsIgnored: out.emptyRowsIgnored,
      sourceCellsCompared: src.rows.reduce((n, row) => n + row.length, 0),
      differences,
      agrees: differences.length === 0,
    });
  }

  return {
    sourceTablesInSource: sourceTables.size,
    outputTablesInOutput: outputTables.length,
    matched,
    matchedTablesAgreeing: matched.filter((m) => m.agrees).length,
    matchedTablesDisagreeing: matched.filter((m) => !m.agrees).length,
    sourceTablesWithNoOutputCounterpart: [...sourceTables.keys()].filter((id) => !claimedBy.has(id)),
    outputTablesWithNoSourceCounterpart: unmatchedOutput,
    sourceIdsClaimedByMoreThanOneOutputTable: [...claimedBy.entries()]
      .filter(([, n]) => n > 1)
      .map(([id]) => id),
  };
}

/** One difference, in one line, with no cell text in it. */
export function describeDifference(d: TableDifference): string {
  switch (d.kind) {
    case "row-count-differs":
      return `rows: source has ${d.sourceRows}, output has ${d.outputRows}`;
    case "cells-in-row-differ":
      return `row ${d.row}: source has ${d.sourceCells} cells, output has ${d.outputCells}`;
    case "cell-tag-differs":
      return `row ${d.row} cell ${d.cell}: source <${d.sourceTag}>, output <${d.outputTag}>`;
    case "cell-text-differs":
      return (
        `row ${d.row} cell ${d.cell}: text differs — source ${d.sourceChars} chars (${d.sourceDigest}), ` +
        `output ${d.outputChars} chars (${d.outputDigest})`
      );
    case "cell-rowspan-differs":
      return `row ${d.row} cell ${d.cell}: rowSpan source ${d.sourceRowSpan}, output ${d.outputRowSpan}`;
    case "cell-colspan-differs":
      return `row ${d.row} cell ${d.cell}: colSpan source ${d.sourceColSpan}, output ${d.outputColSpan}`;
    case "cell-links-differ":
      return (
        `row ${d.row} cell ${d.cell}: links differ — source ${d.sourceLinks} (${d.sourceDigest}), ` +
        `output ${d.outputLinks} (${d.outputDigest})`
      );
    default: {
      const never: never = d;
      return String(never);
    }
  }
}

/**
 * The result, for a person. Every label says which side a number belongs to, and
 * the two unmatched lists are printed as two lines because they are two
 * findings: a source table that did not survive is not an output table that
 * cannot be traced.
 */
export function reportTableOracle(label: string, result: TableOracleResult, showAll = false): void {
  console.log(
    `\n${label}: ${result.sourceTablesInSource} tables in source, ` +
      `${result.outputTablesInOutput} in output; ` +
      `${result.matched.length} traced back by provenance id ` +
      `(${result.matchedTablesAgreeing} agree, ${result.matchedTablesDisagreeing} report a difference).`,
  );
  for (const m of result.matched) {
    if (m.agrees && !showAll) continue;
    console.log(
      `  ${m.sourceId} (${m.how}): source ${m.sourceRowsCompared} rows compared ` +
        `(${m.sourceEmptyRowsIgnored} empty ignored), output ${m.outputRowsCompared} rows compared ` +
        `(${m.outputEmptyRowsIgnored} empty ignored), ` +
        `${m.sourceCellsCompared} source cells, ` +
        `${m.agrees ? "agrees" : `${m.differences.length} differences`}`,
    );
    for (const d of m.differences.slice(0, 8)) console.log(`      ${describeDifference(d)}`);
    if (m.differences.length > 8) {
      console.log(`      … and ${m.differences.length - 8} more`);
    }
  }
  console.log(
    `  source tables the output does not contain: ` +
      `${result.sourceTablesWithNoOutputCounterpart.length}` +
      (result.sourceTablesWithNoOutputCounterpart.length
        ? ` [${result.sourceTablesWithNoOutputCounterpart.join(" ")}]`
        : ""),
  );
  console.log(
    `  output tables that trace back to no source table: ` +
      `${result.outputTablesWithNoSourceCounterpart.length}` +
      (result.outputTablesWithNoSourceCounterpart.length
        ? ` [${result.outputTablesWithNoSourceCounterpart
            .map((u) => `${u.resolvedId ?? "—"}:${u.how}${u.resolvedTag ? `:${u.resolvedTag}` : ""}`)
            .join(" ")}]`
        : ""),
  );
  if (result.sourceIdsClaimedByMoreThanOneOutputTable.length) {
    console.log(
      `  SOURCE IDS CLAIMED BY MORE THAN ONE OUTPUT TABLE: ` +
        result.sourceIdsClaimedByMoreThanOneOutputTable.join(" "),
    );
  }
}

async function main(): Promise<void> {
  const jsonAt = process.argv.indexOf("--json");
  const showAll = process.argv.includes("--all");
  const dir = path.join("evals", "extraction", "fixtures");
  const out: Array<{ name: string; result: TableOracleResult | null }> = [];

  console.log("The normalisations this oracle allows, and nothing else:");
  for (const n of NORMALISATIONS) console.log(`  ${n.name}: ${n.what}`);

  for (const entry of ALL_FIXTURES) {
    const raw = await readFile(path.join(dir, entry.file), "utf-8");
    const { article, source } = readArticleWithProvenance(raw, entry.url);
    if (!article?.content) {
      out.push({ name: entry.name, result: null });
      console.log(`\n${entry.name}: stage 2 returned nothing — no tables to compare.`);
      continue;
    }
    const result = tableOracle(source, article.content);
    if (result.sourceTablesInSource === 0 && result.outputTablesInOutput === 0) continue;
    out.push({ name: entry.name, result });
    reportTableOracle(entry.name, result, showAll);
  }

  const live = out.flatMap((o) => (o.result ? [o.result] : []));
  const sum = (f: (r: TableOracleResult) => number) => live.reduce((n, r) => n + f(r), 0);
  console.log(
    `\n${live.length} fixtures: ${sum((r) => r.matched.length)} tables traced back, ` +
      `${sum((r) => r.matchedTablesAgreeing)} agree, ` +
      `${sum((r) => r.matchedTablesDisagreeing)} report a difference; ` +
      `${sum((r) => r.sourceTablesWithNoOutputCounterpart.length)} source tables absent from the output; ` +
      `${sum((r) => r.outputTablesWithNoSourceCounterpart.length)} output tables untraceable.`,
  );

  if (jsonAt !== -1) {
    const file = process.argv[jsonAt + 1]!;
    await writeFile(file, `${JSON.stringify(out, null, 2)}\n`, "utf-8");
    console.log(`\nWritten to: ${path.resolve(file)}`);
  }
}

if (isMain(import.meta.url)) await main();
