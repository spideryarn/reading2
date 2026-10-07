/**
 * **The rows the Hidden text panel draws, in the order it draws them** — one
 * definition, for the panel and for the server.
 *
 * Until 2026-10-07 `ordered` and `grouped` lived inside
 * `src/web/SourceScanNotice.tsx`, because the panel was their only reader.
 * Plan 261007l gave them a second: the Opus check
 * (`src/referee-hidden-check.ts`) numbers the rows it sends, and the panel
 * shows each answer beside the row it names, so the two sides have to number
 * the rows **exactly** alike. Two copies of this would be two numberings, and the
 * first edit to one would put an opinion beside the wrong row.
 *
 * A leaf: type imports only (`injection-scan-types.js`, itself declarations
 * only), so `src/web/` may import it — tests/client-imports.test.ts lists it.
 * docs/plans/261007l-hidden-text-an-opus-check-the-reader-asks-for-over-the-flagged-fragments-only.md.
 */
import type { ScanFinding } from "./injection-scan-types.js";

/**
 * Unexplained first, labelled last, stable within each half.
 *
 * Rule 3 of the panel (src/web/SourceScanNotice.tsx): a label sorts a finding
 * last and never removes one. `sort` is not used: it would need a comparator
 * that is stable across engines to keep two runs of the same paper in the same
 * order, and two filters are both stable and obviously so.
 */
export function ordered(findings: readonly ScanFinding[]): ScanFinding[] {
  return [
    ...findings.filter((f) => f.ordinary === undefined),
    ...findings.filter((f) => f.ordinary !== undefined),
  ];
}

/**
 * **Findings that read the same are one row, with a count.**
 *
 * The key is every field a referee reads except `where`: the kind, the words,
 * the evidence, the label and the caveat. So a payload is never folded into a
 * pile of copies — its words differ from theirs, and it is a row of its own —
 * and a labelled finding is never merged with an unlabelled one, which keeps
 * rule 3's order. On the arXiv paper Greg was reading, 39 rows of one
 * zero-width space each became one. Order is first appearance, over rows
 * already `ordered`, so the unexplained still come first.
 *
 * **Two findings in one row may be two different things in the source** —
 * `text` is capped, and `where` is a four-step hint with no sibling index —
 * so a row never claims they are the same place: it says how many findings it
 * stands for, and lists every distinct source path. A path is capped only when
 * drawn: ids and classes belong to the document, so one must not fill the panel
 * and push the finding's own words out of reach.
 */
export interface ScanGroup {
  key: string;
  finding: ScanFinding;
  /** How many findings this row stands for. */
  count: number;
  /** Every distinct `where`, in order, all of them shown. */
  paths: string[];
}

export function grouped(rows: readonly ScanFinding[]): ScanGroup[] {
  const groups = new Map<string, ScanGroup>();
  for (const finding of rows) {
    const key = JSON.stringify([
      finding.kind,
      finding.text,
      finding.detail,
      finding.ordinary ?? null,
      finding.kind === "visible-instruction" ? finding.caveat : null,
    ]);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { key, finding, count: 1, paths: [finding.where] });
    } else {
      group.count++;
      if (!group.paths.includes(finding.where)) group.paths.push(finding.where);
    }
  }
  return [...groups.values()];
}

/** How many of a row's distinct source paths the Opus check sends. */
export const MAX_PATHS_SENT = 5;
/** Each sent path is cut to this many characters. The document wrote it. */
export const MAX_PATH_CHARS = 200;

/** Cut `text` to at most `max` characters, the last one an ellipsis when cut. */
export function clipField(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

/**
 * **What the Opus check was shown of one row**, as the answer carries it back.
 *
 * The group key leaves out the paths and the count, so two scans can share a
 * key and differ in what was looked at. The panel shows an opinion beside a row
 * only when every field here equals the row it is drawing (`sameInputs`) —
 * plain equality, no hashing. Plan 261007l § A judgment is bound to the
 * evidence it was made from.
 */
export interface CheckedInputs {
  key: string;
  /** The paths that were sent: the first `MAX_PATHS_SENT`, each clipped. */
  paths: string[];
  /** How many findings the row stands for. */
  count: number;
  /** How many distinct paths the row has in all. */
  totalPaths: number;
}

export function checkedInputs(group: ScanGroup): CheckedInputs {
  return {
    key: group.key,
    paths: group.paths.slice(0, MAX_PATHS_SENT).map((p) => clipField(p, MAX_PATH_CHARS)),
    count: group.count,
    totalPaths: group.paths.length,
  };
}

/** Was an opinion made from exactly what this row now shows? */
export function sameInputs(a: CheckedInputs, b: CheckedInputs): boolean {
  return (
    a.key === b.key &&
    a.count === b.count &&
    a.totalPaths === b.totalPaths &&
    a.paths.length === b.paths.length &&
    a.paths.every((p, i) => p === b.paths[i])
  );
}
