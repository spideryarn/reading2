/**
 * **The table oracle has to be seen to fail.**
 *
 * `evals/extraction/table-oracle.mts` exists because text recall and source
 * ordering cannot see a datum moved into the wrong row: a table can survive with
 * every character intact and every row in document order and still be wrong. An
 * instrument built for that reason is worth exactly as much as the mutations it
 * has been watched catch, so every case below takes a **real fixture table**,
 * makes one specific change to it, and asserts the oracle goes from agreeing to
 * naming that change — the counterfactual
 * [260904e § How every recogniser is proved](../docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md)
 * asks for.
 *
 * ## Why the "output" here is a clone of the source
 *
 * Under the shipped code at the time this was written, the interesting tables in
 * both fixtures were **deleted by Readability** — that is the loss the rest of
 * stage C3 is fixing. Testing the oracle by running the pipeline would therefore
 * have tested the recovery, not the oracle, and would have gone red for a reason
 * that has nothing to do with whether a swapped cell is detected. So the output
 * side is built by cloning the source table into a detached container: the
 * provenance stamps come with the clone, so it matches by id exactly as a
 * genuinely-kept table does, and the *only* difference between the two sides is
 * the one the test made.
 *
 * The container is created with `source.createElement` and never inserted, so
 * `source.querySelectorAll("table")` — which is how the oracle enumerates the
 * source side — cannot see it. If it could, every clone would be a second source
 * table with the same id and the whole comparison would be against itself.
 *
 * ## The negatives are the point as much as the mutations
 *
 * Two tests assert **agreement**: an untouched clone, and a clone whose wholly
 * empty row has been dropped. The second is declared normalisation
 * (`NORMALISATIONS` in the oracle), and without a case for it the first sign
 * that the allowance had been dropped would be a corpus run going red for a
 * reason nobody could place.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { readArticleWithProvenance, sourceRefOf } from "../src/extract.js";
import {
  NORMALISATIONS,
  compareProjections,
  ownCells,
  ownRows,
  projectTable,
  tableOracle,
  type TableDifference,
  type TableOracleResult,
} from "../evals/extraction/table-oracle.mjs";

const FIXTURES = path.join("evals", "extraction", "fixtures");

/**
 * The three fixtures, and what each is here for.
 *
 * `wiki_gdp_table` and `ar5iv` are the pages stage C3 recovers tables from, and
 * they are the two the plan names. `man_open` is here for one reason the other
 * two cannot supply: it has a **real** wholly empty row. The GDP fixture's
 * famous empty row is gone before the snapshot point — `removePlatformFurniture`
 * deletes `<tr class="mw-empty-elt">` — so testing that normalisation on it would
 * have meant inventing the row and then congratulating the oracle for ignoring
 * an invention.
 */
const PAGES = {
  gdp: {
    file: "wiki_gdp_table.html",
    url: "https://en.wikipedia.org/wiki/List_of_countries_by_GDP_(nominal)",
  },
  ar5iv: { file: "ar5iv.html", url: "https://ar5iv.labs.arxiv.org/html/1706.03762" },
  man: { file: "man_open.html", url: "https://man7.org/linux/man-pages/man2/open.2.html" },
} as const;

/** The stamped, post-`prepareDocument` source of one fixture — the snapshot the oracle compares against. */
const sources: Record<keyof typeof PAGES, Document> = {} as Record<keyof typeof PAGES, Document>;

beforeAll(async () => {
  for (const [key, page] of Object.entries(PAGES)) {
    const raw = await readFile(path.join(FIXTURES, page.file), "utf-8");
    sources[key as keyof typeof PAGES] = readArticleWithProvenance(raw, page.url).source;
  }
});

/** The source table carrying this provenance id, or a failure that says which id was missing. */
function sourceTable(page: keyof typeof PAGES, id: string): Element {
  const found = Array.from(sources[page].querySelectorAll("table")).find(
    (t) => sourceRefOf(t).id === id,
  );
  expect(found, `${PAGES[page].file} has no source table stamped ${id}`).toBeDefined();
  return found!;
}

/**
 * A stand-in for Readability's output: a detached container holding a clone of
 * one source table, stamps and all. Detached on purpose — see the header.
 */
function outputOf(page: keyof typeof PAGES, table: Element): { container: Element; clone: Element } {
  const container = sources[page].createElement("div");
  const clone = table.cloneNode(true) as Element;
  container.appendChild(clone);
  return { container, clone };
}

/** Every difference of one kind the oracle reported for the single matched table. */
function differencesOfKind<K extends TableDifference["kind"]>(
  result: TableOracleResult,
  kind: K,
): Extract<TableDifference, { kind: K }>[] {
  const first = result.matched[0];
  expect(first, "expected exactly one table to be traced back by provenance id").toBeDefined();
  return first!.differences.filter(
    (d): d is Extract<TableDifference, { kind: K }> => d.kind === kind,
  );
}

/** Run the oracle over one source table and one mutated clone of it. */
function oracleFor(page: keyof typeof PAGES, id: string, mutate: (clone: Element) => void) {
  const table = sourceTable(page, id);
  const { container, clone } = outputOf(page, table);
  mutate(clone);
  return { result: tableOracle(sources[page], container), table };
}

/**
 * The table this file mutates most. ar5iv's Table 2 — twelve rows, a `rowspan`
 * on its first header cell and four `colspan`s — is the one the plan names as
 * the case a text-only oracle would pass while the spans were being stripped.
 */
const AR5IV_TABLE_2 = "s1865";
/** The GDP fixture's regional table: fourteen rows, three columns, links in most cells. */
const GDP_REGIONAL = "s3561";

describe("the table oracle agrees when nothing changed", () => {
  it("matches ar5iv Table 2 by provenance id and reports no difference", () => {
    const { result } = oracleFor("ar5iv", AR5IV_TABLE_2, () => {});
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.sourceId).toBe(AR5IV_TABLE_2);
    expect(result.matched[0]?.how).toBe("direct");
    expect(result.matched[0]?.differences).toEqual([]);
    expect(result.matched[0]?.agrees).toBe(true);
    expect(result.matchedTablesAgreeing).toBe(1);
    expect(result.matchedTablesDisagreeing).toBe(0);
    /* Per-table row counts, which is what the plan asks the oracle to assert
       about a recovered table rather than a document total — a total is the
       number that hid a discrepancy for a day. */
    expect(result.matched[0]?.sourceRowsCompared).toBe(12);
    expect(result.matched[0]?.outputRowsCompared).toBe(12);
  });

  it("matches the GDP regional table and reports no difference", () => {
    const { result } = oracleFor("gdp", GDP_REGIONAL, () => {});
    expect(result.matched[0]?.agrees).toBe(true);
    expect(result.matched[0]?.sourceRowsCompared).toBe(14);
  });

  it("the spans it is agreeing about are really there", () => {
    /* Otherwise the two span mutations below would be deleting nothing, and a
       mutation that changes nothing is passed by an oracle that checks nothing. */
    const table = sourceTable("ar5iv", AR5IV_TABLE_2);
    expect(table.querySelectorAll("[rowspan]")).toHaveLength(1);
    expect(table.querySelectorAll("[colspan]")).toHaveLength(4);
  });

  it("ignores a wholly empty row that the output dropped — declared normalisation", () => {
    /* man_open's table s24 has two rows of which one is wholly empty. The output
       drops it; the oracle must not call that a lost row. */
    const table = sourceTable("man", "s24");
    expect(projectTable(table).emptyRowsIgnored).toBe(1);
    const { result } = oracleFor("man", "s24", (clone) => {
      for (const row of ownRows(clone)) {
        const cells = ownCells(row);
        if (cells.every((c) => (c.textContent ?? "").trim() === "")) row.remove();
      }
    });
    expect(result.matched[0]?.agrees).toBe(true);
    expect(result.matched[0]?.sourceEmptyRowsIgnored).toBe(1);
    expect(result.matched[0]?.outputEmptyRowsIgnored).toBe(0);
    expect(result.matched[0]?.sourceRowsCompared).toBe(1);
    expect(result.matched[0]?.outputRowsCompared).toBe(1);
  });

  it("ignores a wholly empty trailing row on the fixture the plan names", () => {
    /* The GDP fixture's own empty row is deleted by `removePlatformFurniture`
       before the snapshot, so this appends one to the *source* after the clone
       is taken: source 15 rows, output 14, and they must still agree. That is
       the shape the plan describes even though its evidence for it does not
       survive at the snapshot point it specifies. */
    const table = sourceTable("gdp", GDP_REGIONAL);
    const { container } = outputOf("gdp", table);
    const empty = sources.gdp.createElement("tr");
    empty.appendChild(sources.gdp.createElement("td"));
    (ownRows(table)[0]?.parentElement ?? table).appendChild(empty);
    try {
      const result = tableOracle(sources.gdp, container);
      expect(result.matched[0]?.agrees).toBe(true);
      expect(result.matched[0]?.sourceEmptyRowsIgnored).toBe(1);
      expect(result.matched[0]?.sourceRowsCompared).toBe(14);
      expect(result.matched[0]?.outputRowsCompared).toBe(14);
    } finally {
      empty.remove();
    }
  });
});

describe("the table oracle reports a cell that changed shape", () => {
  it("names the cell whose rowspan was deleted", () => {
    const { result } = oracleFor("ar5iv", AR5IV_TABLE_2, (clone) => {
      const cell = clone.querySelector("[rowspan]");
      expect(cell, "the clone should carry the source's one rowspan").not.toBeNull();
      cell?.removeAttribute("rowspan");
    });
    const found = differencesOfKind(result, "cell-rowspan-differs");
    expect(found).toHaveLength(1);
    /* Row 0, cell 0 — the `<th>Model</th>` that spans the two header rows. */
    expect(found[0]).toMatchObject({ row: 0, cell: 0, sourceRowSpan: 2, outputRowSpan: 1 });
    expect(result.matched[0]?.agrees).toBe(false);
  });

  it("names each cell whose colspan was deleted", () => {
    const { result } = oracleFor("ar5iv", AR5IV_TABLE_2, (clone) => {
      const spanned = Array.from(clone.querySelectorAll("[colspan]"));
      expect(spanned).toHaveLength(4);
      spanned[0]?.removeAttribute("colspan");
    });
    const found = differencesOfKind(result, "cell-colspan-differs");
    expect(found).toHaveLength(1);
    expect(found[0]?.sourceColSpan).toBe(2);
    expect(found[0]?.outputColSpan).toBe(1);
  });

  it("names a header cell demoted to a data cell", () => {
    const { result } = oracleFor("ar5iv", AR5IV_TABLE_2, (clone) => {
      const th = ownCells(ownRows(clone)[2]!)[0]!;
      expect(th.localName).toBe("th");
      const td = clone.ownerDocument.createElement("td");
      for (const attr of Array.from(th.attributes)) td.setAttribute(attr.name, attr.value);
      td.innerHTML = th.innerHTML;
      th.replaceWith(td);
    });
    const found = differencesOfKind(result, "cell-tag-differs");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ row: 2, cell: 0, sourceTag: "th", outputTag: "td" });
    /* And nothing else — the text, the spans and the links all survived the
       demotion, which is exactly why a text-only oracle would pass it. */
    expect(result.matched[0]?.differences).toHaveLength(1);
  });
});

describe("the table oracle reports a datum in the wrong place", () => {
  it("names both cells when two cells inside a row are swapped", () => {
    const { result } = oracleFor("gdp", GDP_REGIONAL, (clone) => {
      const cells = ownCells(ownRows(clone)[1]!);
      const [a, b] = [cells[1]!, cells[2]!];
      const held = a.innerHTML;
      a.innerHTML = b.innerHTML;
      b.innerHTML = held;
    });
    const found = differencesOfKind(result, "cell-text-differs");
    expect(found.map((d) => [d.row, d.cell])).toEqual([
      [1, 1],
      [1, 2],
    ]);
    /* The swap is visible as a swap: each cell's new digest is the other's old
       one. This is the failure the whole instrument exists for — recall is 100%
       and the ordering is untouched. */
    expect(found[0]?.outputDigest).toBe(found[1]?.sourceDigest);
    expect(found[1]?.outputDigest).toBe(found[0]?.sourceDigest);
  });

  it("names both rows when a cell moves across a row boundary", () => {
    const { result } = oracleFor("gdp", GDP_REGIONAL, (clone) => {
      const rows = ownRows(clone);
      const moved = ownCells(rows[1]!)[2]!;
      rows[2]!.appendChild(moved);
    });
    const found = differencesOfKind(result, "cells-in-row-differ");
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({ row: 1, sourceCells: 3, outputCells: 2 });
    expect(found[1]).toMatchObject({ row: 2, sourceCells: 3, outputCells: 4 });
  });
});

describe("the table oracle reports a row that came or went", () => {
  it("names a deleted non-empty row", () => {
    const { result } = oracleFor("gdp", GDP_REGIONAL, (clone) => {
      const row = ownRows(clone)[5]!;
      expect((row.textContent ?? "").trim().length).toBeGreaterThan(0);
      row.remove();
    });
    const found = differencesOfKind(result, "row-count-differs");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ sourceRows: 14, outputRows: 13 });
  });

  it("reports a lost row once, not once per cell of every row after it", () => {
    /* `compareProjections` on its own, because this is a property of the
       comparison rather than of the matching: deleting row 5 of a fourteen-row
       table shifts every row below it, and a comparison that then walked the
       misaligned pairs would bury the one real finding under thirty. */
    const table = sourceTable("gdp", GDP_REGIONAL);
    const { clone } = outputOf("gdp", table);
    ownRows(clone)[5]!.remove();
    const differences = compareProjections(projectTable(table), projectTable(clone));
    expect(differences.filter((d) => d.kind === "row-count-differs")).toHaveLength(1);
    /* The thirteen surviving rows are all three cells wide, so nothing below the
       deletion is reported as a row that changed width — the shift shows up as
       cell content, which is the honest place for it. */
    expect(differences.filter((d) => d.kind === "cells-in-row-differ")).toEqual([]);
  });

  it("names a row the source never had", () => {
    const { result } = oracleFor("gdp", GDP_REGIONAL, (clone) => {
      const row = clone.ownerDocument.createElement("tr");
      for (const value of ["Atlantis", "1,000,000", "999,999"]) {
        const cell = clone.ownerDocument.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      }
      ownRows(clone)[0]!.parentElement!.appendChild(row);
    });
    const found = differencesOfKind(result, "row-count-differs");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ sourceRows: 14, outputRows: 15 });
  });
});

describe("the table oracle reports a link that vanished leaving its text", () => {
  it("names the cell, and reports no text difference for it", () => {
    const { result } = oracleFor("gdp", GDP_REGIONAL, (clone) => {
      const anchor = ownCells(ownRows(clone)[2]!)[0]!.querySelector("a[href]");
      expect(anchor, "row 2's first cell should carry a link").not.toBeNull();
      anchor?.replaceWith(clone.ownerDocument.createTextNode(anchor.textContent ?? ""));
    });
    const links = differencesOfKind(result, "cell-links-differ");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ row: 2, cell: 0, sourceLinks: 1, outputLinks: 0 });
    /* The point of the case: the tag, the text and both spans are unchanged, so
       the four-field projection the plan specified would have called this table
       intact. */
    expect(differencesOfKind(result, "cell-text-differs")).toEqual([]);
    expect(result.matched[0]?.differences).toHaveLength(1);
  });
});

describe("the two ways a table can go unmatched are two findings", () => {
  it("a source table with no output counterpart is not an output table with no source", () => {
    /* An empty output: every source table is absent, and nothing is untraceable. */
    const empty = sources.gdp.createElement("div");
    const gone = tableOracle(sources.gdp, empty);
    expect(gone.matched).toHaveLength(0);
    expect(gone.sourceTablesWithNoOutputCounterpart).toHaveLength(gone.sourceTablesInSource);
    expect(gone.outputTablesWithNoSourceCounterpart).toEqual([]);

    /* An output table carrying no stamp anywhere: untraceable, and it does not
       reduce the count of absent source tables by one. */
    const stranger = sources.gdp.createElement("div");
    stranger.innerHTML = "<table><tr><td>not from this page</td></tr></table>";
    const alien = tableOracle(sources.gdp, stranger);
    expect(alien.matched).toHaveLength(0);
    expect(alien.outputTablesWithNoSourceCounterpart).toHaveLength(1);
    expect(alien.outputTablesWithNoSourceCounterpart[0]?.how).toBe("none");
    expect(alien.sourceTablesWithNoOutputCounterpart).toHaveLength(alien.sourceTablesInSource);
  });

  it("an output table whose id names something that is not a table is untraceable, not matched", () => {
    /* A `<tbody>`'s stamp is what `sourceRefOf`'s descendant fallback lands on
       when Readability rebuilt the table. Resolving it is honest; calling it a
       matched table would not be. */
    const table = sourceTable("gdp", GDP_REGIONAL);
    const { container, clone } = outputOf("gdp", table);
    const stamp = Array.from(clone.attributes).find((a) => a.name.startsWith("data-spya-"))!;
    clone.removeAttribute(stamp.name);
    const result = tableOracle(sources.gdp, container);
    expect(result.matched).toHaveLength(0);
    expect(result.outputTablesWithNoSourceCounterpart).toHaveLength(1);
    expect(result.outputTablesWithNoSourceCounterpart[0]?.how).toBe("descendant");
    expect(result.outputTablesWithNoSourceCounterpart[0]?.resolvedTag).not.toBe("table");
  });
});

describe("the allowed normalisation is a list, not a habit", () => {
  it("is exactly these three, so adding a fourth is a deliberate act", () => {
    expect(NORMALISATIONS.map((n) => n.name)).toEqual([
      "empty-row-may-vanish",
      "non-visible-nodes-stripped",
      "whitespace-collapsed",
    ]);
  });

  it("strips an inline stylesheet out of a cell's text, and nothing more", () => {
    /* The GDP table's cell s1029 has a 198-character `textContent` of which 194
       are a `<style>` element Readability removes. Four characters of visible
       text is the right answer; 198 would make the oracle red on every honest
       extraction of this page. */
    const big = sourceTable("gdp", "s731");
    const styled = big.querySelector("style")?.closest("td, th");
    expect(styled, "the GDP table should still contain an inline stylesheet in a cell").toBeTruthy();
    const rowIndex = ownRows(big).findIndex((r) => ownCells(r).includes(styled!));
    const cellIndex = ownCells(ownRows(big)[rowIndex]!).indexOf(styled!);
    const projected = projectTable(big).rows[rowIndex]?.[cellIndex];
    expect((styled!.textContent ?? "").length).toBeGreaterThan(150);
    expect(projected?.text.length).toBeLessThan(10);

    /* And the whole table still agrees with an untouched clone of itself, which
       is the check that this normalisation is applied to both sides. */
    const { result } = oracleFor("gdp", "s731", () => {});
    expect(result.matched[0]?.agrees).toBe(true);
    expect(result.matched[0]?.sourceRowsCompared).toBe(223);
  });

  it("does not fold case — a cell shouted at the reader is a difference", () => {
    const { result } = oracleFor("gdp", GDP_REGIONAL, (clone) => {
      const cell = ownCells(ownRows(clone)[1]!)[0]!;
      cell.textContent = (cell.textContent ?? "").toUpperCase();
    });
    expect(differencesOfKind(result, "cell-text-differs")).toHaveLength(1);
  });

  it("does fold the whitespace it says it folds", () => {
    const { result } = oracleFor("gdp", GDP_REGIONAL, (clone) => {
      const cell = ownCells(ownRows(clone)[1]!)[0]!;
      cell.textContent = `\n\t  ${(cell.textContent ?? "").trim()}  \n `;
    });
    expect(result.matched[0]?.agrees).toBe(true);
  });
});
