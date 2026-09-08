/**
 * **The free instrument: numbers over debate output, and not one byte of IO.**
 *
 * Stage B′ of
 * docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md
 * § *The 80-20, decided 2026-09-08*. Everything here is a pure function over
 * already-parsed data: no model, no network, no database, no filesystem, no
 * clock. Reading a journal is
 * [`journal-rows.ts`](./journal-rows.ts)'s job, deliberately, so that every
 * figure below can be pinned by a unit test that constructs its own input.
 *
 * ## What this file refuses to do, as a whole
 *
 * - **It never repairs a row.** A relation this vocabulary does not know is
 *   counted as off-vocabulary and named; it is not coerced to `unclear`.
 *   Production's `RELATIONS.has` mapping is a *reading* decision and belongs in
 *   src/debate.ts, where P7 pins it.
 * - **It never filters a denominator to the rows it liked.** Every rate here
 *   prints numerator over the count of rows it was handed, and returns `null`
 *   rather than `0` when there is no denominator — because a `0` beside
 *   *"opposite pairs"* reads as *"we looked and found none"*, which is a
 *   different fact from *"there was nothing to look at"*
 *   ([silent-success.md](../../docs/reusable/silent-success.md) § *An empty
 *   list*).
 * - **It never invents a vocabulary.** The loss reasons come from
 *   [`lossesOf`](../../src/types.ts), which is the single source of truth for
 *   that list and is written so that a new `DebateLosses` field stops it
 *   compiling. Nothing here re-lists them.
 * - **It ranks nothing and colours nothing.** These are report figures. The
 *   panel's ordering rule (`DEBATE_NO_RANKING`) is not this file's business.
 */
import {
  type DebateCounts,
  type DebateLean,
  type DebateLosses,
  type DebateRelation,
  lossesOf,
} from "../../src/types.js";

/* ------------------------------------------------------------ the row shape -- */

/**
 * **The two fields every figure below reads**, and nothing else.
 *
 * `string` rather than `DebateRelation`/`DebateLean` on purpose, and it is
 * not laziness: `DirectDebateRow` and `ClaimDebateRow` are both assignable to
 * it, *and* so is a row read straight back off `article_revisions.debate`,
 * which is JSONB and is bound by no TypeScript type at all. The vocabulary
 * check therefore happens at runtime, where the data actually is —
 * `lossesOf`'s docblock makes the same argument about counters, for the same
 * reason, after the panel printed `NaN` off a stored artefact.
 */
export interface ScorableRow {
  relation: string;
  lean: string;
}

/* ------------------------------------------------------------ the vocabularies -- */

/*  The two vocabularies, written as a total mapping from the union to itself so
    that a new `DebateRelation` or `DebateLean` member is a **compile error**
    here rather than a value that quietly lands in `offVocabulary`. A bare
    `readonly DebateRelation[]` would accept a short list without complaint —
    and production's own `new Set<DebateRelation>([...])` in src/debate.ts is
    exactly that unguarded shape. */
const RELATION_KEYS: { [K in DebateRelation]: K } = {
  disputes: "disputes",
  qualifies: "qualifies",
  extends: "extends",
  corroborates: "corroborates",
  unclear: "unclear",
};
const LEAN_KEYS: { [K in DebateLean]: K } = {
  "leans-for": "leans-for",
  "leans-against": "leans-against",
  neither: "neither",
  "cannot-tell": "cannot-tell",
};

/** Every relation, in the order a table prints them. Includes `unclear`. */
export const RELATION_VALUES: readonly DebateRelation[] = Object.values(RELATION_KEYS);
/** Every lean, in the order a table prints them. Includes `cannot-tell`. */
export const LEAN_VALUES: readonly DebateLean[] = Object.values(LEAN_KEYS);

/** Is this string one of the five relations this build knows? */
export function isRelation(value: string): value is DebateRelation {
  return Object.hasOwn(RELATION_KEYS, value);
}

/** Is this string one of the four leans this build knows? */
export function isLean(value: string): value is DebateLean {
  return Object.hasOwn(LEAN_KEYS, value);
}

/* -------------------------------------------- the raw vocabulary, before coercion -- */

/**
 * **What a raw field actually was**, keeping the three ways it can fail to be a
 * word apart from each other.
 *
 * Production's `str()` maps a missing field, a number and a `null` all to `""`,
 * and then `RELATIONS.has("")` is false, so all three arrive at `unclear`
 * together. That is the right call for a *reading*; it is the wrong call for a
 * *report*, where *"the model stopped emitting the field"* and *"the model
 * emitted a word we do not know"* are different diagnoses of a prompt change.
 */
export type RawFieldKind = "word" | "empty" | "absent" | "not-a-string";

/** One raw field as it arrived, before anything looked it up. */
export interface RawField {
  /** The trimmed string, or `""` for every non-string case. */
  text: string;
  kind: RawFieldKind;
  /** A stable label for a table — the text, or `(absent)` / `(empty)` / `(not a string)`. */
  label: string;
}

/** Read one raw field off a row the fence produced, without coercing it. */
export function rawField(value: unknown): RawField {
  if (value === undefined) return { text: "", kind: "absent", label: "(absent)" };
  if (typeof value !== "string") return { text: "", kind: "not-a-string", label: "(not a string)" };
  const text = value.trim();
  if (text === "") return { text: "", kind: "empty", label: "(empty)" };
  return { text, kind: "word", label: text };
}

/* Production's own coercion, mirrored exactly: `str()` then set membership,
   falling through to the vocabulary's "we cannot tell" value rather than
   dropping the row (src/debate.ts § `readRow`). `RELATIONS`/`LEANS` are not
   exported from there, so this is a mirror rather than a reuse — but it is
   mirrored off the *types*, through `RELATION_KEYS`/`LEAN_KEYS` below, which
   a new union member cannot be added to without a compile error. Production's
   own `new Set<DebateRelation>([...])` has no such gate. */

/** What production would store for this raw relation. Never throws, never drops. */
export function coerceRelation(value: unknown): DebateRelation {
  const text = rawField(value).text;
  return isRelation(text) ? text : "unclear";
}

/** What production would store for this raw lean. Never throws, never drops. */
export function coerceLean(value: unknown): DebateLean {
  const text = rawField(value).text;
  return isLean(text) ? text : "cannot-tell";
}

/** How often one raw spelling turned up, and whether this build knows it. */
export interface RawCount {
  label: string;
  count: number;
  /** `false` means this string is coerced away — to `unclear` or to `cannot-tell`. */
  known: boolean;
}

/** The raw answer vocabulary of a set of rows, and how much of it we recognise. */
export interface VocabularyReport {
  rows: number;
  /** Every distinct raw `relation` spelling, commonest first, ties alphabetical. */
  relations: RawCount[];
  /** Every distinct raw `lean` spelling, same order. */
  leans: RawCount[];
  /** Rows whose raw `relation` is not one this build knows. */
  offVocabularyRelations: number;
  /** Rows whose raw `lean` is not one this build knows. */
  offVocabularyLeans: number;
  /** Rows where **either** field is off-vocabulary. The number a gate reads. */
  offVocabularyRows: number;
  /** Rows that were not an object at all, so neither field could be read. */
  unreadableRows: number;
}

/**
 * **The raw answer vocabulary, computed before any coercion — the check that
 * stops a destroyed field looking like a repaired one.**
 *
 * ## Why this exists, and it is the most important function in the file
 *
 * `src/debate.ts` maps an out-of-vocabulary answer to `unclear` / `cannot-tell`
 * rather than dropping the row, deliberately: those are honest answers and are
 * drawn as calmly as the rest. P7 in the plan pins that mapping. But P7 proves
 * only that the *coercion* works — **nothing anywhere proves that a prompt
 * still emits the vocabulary the coercion accepts.**
 *
 * So consider the repair this eval exists to test. Reword the lean
 * instruction, and the model starts answering `supportive` / `critical`
 * instead of `leans-for` / `leans-against`. Every row is coerced to
 * `cannot-tell`. The
 * wrong-target rows the repair was aimed at are gone — because *every* label is
 * gone. A lean-disagreement rate computed over the coerced values would
 * **improve**, and the prompt repair would report success at the exact moment
 * it destroyed the field. That is
 * [silent-success.md](../../docs/reusable/silent-success.md) in one paragraph:
 * the natural check shares an assumption with the code, namely that the words
 * coming back are the words we asked for.
 *
 * The measurement that cannot share that assumption is the raw strings, counted
 * before anything looks them up. Hence this function, and hence
 * `vocabularyProblems` beside it, so a caller can **fail** on a non-zero
 * off-vocabulary count rather than let it fold quietly into `unclear`.
 *
 * ## What it refuses to do
 *
 * - **It never coerces.** It reports what arrived. `coerceRelation` /
 *   `coerceLean` are separate and are for showing the two side by side.
 * - **It never treats an absent field as an empty one, or either as a word.**
 *   Three different prompt failures, three different labels.
 * - **It never judges a spelling.** An unknown word is `known: false`, counted
 *   and printed; whether it is a better word than ours is a person's call.
 *
 * @param rows the rows straight out of the fence — `ReportedPass.rows` from
 *   [`journal-rows.ts`](./journal-rows.ts), which validates nothing on purpose.
 */
export function vocabularyReport(rows: readonly unknown[]): VocabularyReport {
  const relations = new Map<string, RawCount>();
  const leans = new Map<string, RawCount>();
  let offVocabularyRelations = 0;
  let offVocabularyLeans = 0;
  let offVocabularyRows = 0;
  let unreadableRows = 0;

  const bump = (into: Map<string, RawCount>, field: RawField, known: boolean) => {
    const entry = into.get(field.label);
    if (entry) entry.count += 1;
    else into.set(field.label, { label: field.label, count: 1, known });
  };

  for (const row of rows) {
    if (row === null || typeof row !== "object") {
      unreadableRows += 1;
      offVocabularyRows += 1;
      bump(relations, { text: "", kind: "not-a-string", label: "(row not an object)" }, false);
      bump(leans, { text: "", kind: "not-a-string", label: "(row not an object)" }, false);
      offVocabularyRelations += 1;
      offVocabularyLeans += 1;
      continue;
    }
    const record = row as { relation?: unknown; lean?: unknown };
    const relation = rawField(record.relation);
    const lean = rawField(record.lean);
    const relationKnown = isRelation(relation.text);
    const leanKnown = isLean(lean.text);
    bump(relations, relation, relationKnown);
    bump(leans, lean, leanKnown);
    if (!relationKnown) offVocabularyRelations += 1;
    if (!leanKnown) offVocabularyLeans += 1;
    if (!relationKnown || !leanKnown) offVocabularyRows += 1;
  }

  return {
    rows: rows.length,
    relations: sortCounts(relations),
    leans: sortCounts(leans),
    offVocabularyRelations,
    offVocabularyLeans,
    offVocabularyRows,
    unreadableRows,
  };
}

function sortCounts(counts: ReadonlyMap<string, RawCount>): RawCount[] {
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * **The gate.** Non-empty means the answers did not come back in the vocabulary
 * this build reads, and **no coerced figure from this run may be believed** —
 * an arm whose words we do not know scores `unclear`/`cannot-tell` everywhere,
 * which is indistinguishable from an arm that honestly could not tell.
 *
 * Returned as sentences rather than thrown, for the reason `cost.ts` gives: the
 * money is already spent by the time anybody reads this, so the caller writes
 * its results file, prints these, and exits non-zero.
 */
export function vocabularyProblems(report: VocabularyReport): string[] {
  const problems: string[] = [];
  const unknownRelations = report.relations.filter((r) => !r.known).map((r) => r.label);
  const unknownLeans = report.leans.filter((v) => !v.known).map((v) => v.label);
  if (report.offVocabularyRelations > 0) {
    problems.push(
      `${String(report.offVocabularyRelations)} of ${String(report.rows)} row(s) used a relation this build does not know (${unknownRelations.join(", ")}) — they are coerced to "unclear", so no relation figure from this run means anything`,
    );
  }
  if (report.offVocabularyLeans > 0) {
    problems.push(
      `${String(report.offVocabularyLeans)} of ${String(report.rows)} row(s) used a lean this build does not know (${unknownLeans.join(", ")}) — they are coerced to "cannot-tell", so no lean figure from this run means anything`,
    );
  }
  if (report.unreadableRows > 0) {
    problems.push(
      `${String(report.unreadableRows)} of ${String(report.rows)} row(s) were not objects at all — neither field could be read`,
    );
  }
  return problems;
}

/** The raw vocabulary as text, with the coerced destination beside each unknown word. */
export function vocabularyLines(report: VocabularyReport): string[] {
  const block = (name: string, counts: readonly RawCount[], fallback: string) => [
    `  raw ${name} over ${String(report.rows)} row(s):`,
    ...(counts.length === 0
      ? ["    (no rows)"]
      : counts.map(
          (c) =>
            `    ${c.label.padEnd(22)} ${String(c.count).padStart(3)}` +
            (c.known ? "" : `   OFF-VOCABULARY — coerced to "${fallback}"`),
        )),
  ];
  return [...block("relation", report.relations, "unclear"), ...block("lean", report.leans, "cannot-tell")];
}

/**
 * The rows as production would store them — **only ever printed beside
 * `vocabularyReport` of the same rows**, never instead of it.
 *
 * That pairing is the whole point: on its own a coerced table cannot tell an
 * arm that answered `unclear` from an arm whose words we stopped recognising.
 */
export function coercedRows(rows: readonly unknown[]): ScorableRow[] {
  return rows.map((row) => {
    const record = (row === null || typeof row !== "object" ? {} : row) as {
      relation?: unknown;
      lean?: unknown;
    };
    return { relation: coerceRelation(record.relation), lean: coerceLean(record.lean) };
  });
}

/* ------------------------------------------------------- the loss-reason table -- */

/**
 * **Every loss counter at zero, derived rather than re-listed.**
 *
 * `lossesOf` fills an absent counter with `0` — that is what it is for, since a
 * debate artefact written before a counter existed reads back without the key.
 * So the empty table is `lossesOf` asked about nothing, and **there is no
 * second list of reasons in this file** to fall out of step with
 * `DebateLosses`. The cast is the point rather than a shortcut: it hands
 * `lossesOf` exactly the input it is documented to survive.
 */
export function zeroLosses(): DebateLosses {
  return lossesOf({} as DebateLosses);
}

/** What a set of groups lost, by reason. */
export interface LossReasonTable {
  /** One entry per `DebateLosses` key, always all of them, summed across groups. */
  byReason: DebateLosses;
  /** Every reason added up. Equal to `reportedRows - keptRows - omittedOverCap` when the groups agree. */
  total: number;
  /** How many groups contributed. Zero groups is a legal input and gives an all-zero table. */
  groups: number;
}

/**
 * Add up the loss reasons over any number of groups.
 *
 * **What it refuses to do:** it does not decide which reasons are interesting,
 * does not drop the zeros, and does not name the reasons itself — the keys are
 * whatever `lossesOf` returns, so a reason added to `DebateLosses` tomorrow
 * appears here with no edit and cannot be silently dropped. It also does not
 * check the arithmetic against `reportedRows`; that is a claim about a group's
 * internal consistency and belongs to whoever built the group.
 *
 * @param groups anything carrying `counts.lost` — a replayed `DebateGroup`, or
 *   a `DebateCounts` read off a stored artefact.
 */
export function lossReasonTable(
  groups: readonly { counts: Pick<DebateCounts, "lost"> }[],
): LossReasonTable {
  const byReason = zeroLosses();
  const keys = Object.keys(byReason) as (keyof DebateLosses)[];
  for (const group of groups) {
    const lost = lossesOf(group.counts.lost);
    for (const key of keys) byReason[key] += lost[key];
  }
  let total = 0;
  for (const key of keys) total += byReason[key];
  return { byReason, total, groups: groups.length };
}

/**
 * One line per reason, **including the zeros**.
 *
 * A report that printed only the non-zero reasons would make *"nothing was lost
 * to `unverifiedSource`"* and *"`unverifiedSource` is not a reason this build
 * knows about"* look identical, which is the failure this whole eval exists to
 * catch.
 */
export function lossReasonLines(table: LossReasonTable): string[] {
  const keys = Object.keys(table.byReason) as (keyof DebateLosses)[];
  const width = Math.max(...keys.map((k) => k.length));
  return [
    ...keys.map((key) => `  ${key.padEnd(width)}  ${String(table.byReason[key]).padStart(3)}`),
    `  ${"(total)".padEnd(width)}  ${String(table.total).padStart(3)} over ${String(table.groups)} group(s)`,
  ];
}

/* ------------------------------------------------- relation × lean, in full -- */

/** A row whose relation or lean this build has no cell for. */
export interface OffVocabularyRow {
  relation: string;
  lean: string;
}

/** The full contingency table, every cell present. */
export interface ContingencyTable {
  /** `cells[relation][lean]`. Every one of the 20 cells exists, zeros included. */
  cells: Record<DebateRelation, Record<DebateLean, number>>;
  /** Rows handed in — the denominator every rate over this table uses. */
  total: number;
  /** Rows that landed in a cell. `classified + offVocabulary.length === total`. */
  classified: number;
  /**
   * **Rows this build had no cell for, kept rather than dropped.**
   *
   * Non-empty means the answer vocabulary has moved and the table below is
   * about a subset — P7's failure, arriving from the other side. The rows are
   * carried, not just counted, because *which* unknown word turned up is the
   * whole diagnosis.
   */
  offVocabulary: OffVocabularyRow[];
  /** Per-relation totals, for the denominators the plan asks to be printed per relation. */
  byRelation: Record<DebateRelation, number>;
  /** Per-lean totals. */
  byLean: Record<DebateLean, number>;
}

/**
 * The relation × lean contingency table — **all twenty cells, always**.
 *
 * **What it refuses to do:** it does not exclude `unclear` or `cannot-tell`, does
 * not exclude any relation as "ambiguous" (round one excluded `qualifies` and
 * `extends`; Sol's F37 refused that), does not merge cells, and does not drop a
 * row whose words it does not recognise — that row goes in `offVocabulary` and
 * still counts toward `total`. Nothing here is a rate; it is a census.
 */
export function contingencyTable(rows: readonly ScorableRow[]): ContingencyTable {
  const cells = {} as Record<DebateRelation, Record<DebateLean, number>>;
  const byRelation = {} as Record<DebateRelation, number>;
  const byLean = {} as Record<DebateLean, number>;
  for (const relation of RELATION_VALUES) {
    const row = {} as Record<DebateLean, number>;
    for (const lean of LEAN_VALUES) row[lean] = 0;
    cells[relation] = row;
    byRelation[relation] = 0;
  }
  for (const lean of LEAN_VALUES) byLean[lean] = 0;

  const offVocabulary: OffVocabularyRow[] = [];
  let classified = 0;
  for (const row of rows) {
    if (!isRelation(row.relation) || !isLean(row.lean)) {
      offVocabulary.push({ relation: row.relation, lean: row.lean });
      continue;
    }
    cells[row.relation][row.lean] += 1;
    byRelation[row.relation] += 1;
    byLean[row.lean] += 1;
    classified += 1;
  }
  return { cells, total: rows.length, classified, offVocabulary, byRelation, byLean };
}

/** The table as text, one line per relation, with the off-vocabulary count said out loud. */
export function contingencyLines(table: ContingencyTable): string[] {
  const relWidth = Math.max(...RELATION_VALUES.map((r) => r.length), "(all)".length);
  const colWidth = Math.max(...LEAN_VALUES.map((v) => v.length), 5);
  const head = `  ${"".padEnd(relWidth)}  ${LEAN_VALUES.map((v) => v.padStart(colWidth)).join("  ")}      (all)`;
  const body = RELATION_VALUES.map((relation) => {
    const cols = LEAN_VALUES.map((v) => String(table.cells[relation][v]).padStart(colWidth));
    return `  ${relation.padEnd(relWidth)}  ${cols.join("  ")}  ${String(table.byRelation[relation]).padStart(9)}`;
  });
  const foot = `  ${"(all)".padEnd(relWidth)}  ${LEAN_VALUES.map((v) => String(table.byLean[v]).padStart(colWidth)).join("  ")}  ${String(table.classified).padStart(9)}`;
  const off =
    table.offVocabulary.length === 0
      ? `  off-vocabulary: none, over ${String(table.total)} row(s)`
      : `  off-vocabulary: ${String(table.offVocabulary.length)} of ${String(table.total)} row(s) — ` +
        table.offVocabulary.map((r) => `${r.relation}/${r.lean}`).join(", ");
  return [head, ...body, foot, off];
}

/* ------------------------------------------------------- the opposite-pair mark -- */

/**
 * How many rows put `relation` and `lean` on opposite signs.
 *
 * `rate` is `null` — never `0` — when there are no rows at all.
 */
export interface OppositePairMark {
  /** `disputes` + `leans-for`. */
  disputesLeansFor: number;
  /** `corroborates` + `leans-against`. */
  corroboratesLeansAgainst: number;
  /** The two added up. */
  pairs: number;
  /**
   * **Every row handed in**, classified or not.
   *
   * The denominator is deliberately not "rows with a recognised relation and
   * lean": an arm that answered `unclear`/`cannot-tell` everywhere produces no
   * opposite pairs at all, and against a classified-only denominator it would
   * come out looking *cleaner* than an arm that committed to an answer. That is
   * the reward-for-answering-less failure Sol's F36 named in a different place,
   * and it is cheap to close here.
   */
  total: number;
  /** `pairs / total`, or `null` when `total` is zero. */
  rate: number | null;
}

/**
 * **The opposite-pair mark — a sampling frame, and nothing else.**
 *
 * Counts `disputes`+`leans-for` and `corroborates`+`leans-against`.
 *
 * ## What this is, and the ruling it does not overturn
 *
 * Round one of the plan called these pairs *contradictions* and built a metric,
 * **a production coercion** and a stopping rule on them. **Sol's F35 refused
 * that and was right**, and this function does not reopen it. There are honest
 * rows in both cells, one per group:
 *
 * - *"The stated 10% is wrong; it is at least 30%, which makes the warning
 *   stronger."* — truthfully `disputes` + `leans-for`.
 * - *"The reported figures are right, but the conclusion drawn from them is
 *   indefensible."* — truthfully `corroborates` + `leans-against`.
 *
 * What the measurement of 2026-09-08 added is the other half: **all three known
 * bad lean rows are opposite pairs.** So the mark has *high recall* for the
 * wrong-target bug and *low precision*, which is exactly what F35 established.
 * A high-recall, low-precision mark is worthless as a coercion and excellent as
 * a **sampling frame** — it decides which rows a person reads before hand-
 * labelling, and it must be paired with a control sample of same-signed rows,
 * or it measures only its own bias.
 *
 * ## What it refuses to do
 *
 * - **It is not an error count.** A caller printing this as "N errors" is
 *   wrong; the printed form is `N / all rows` beside the full contingency
 *   table, per the plan.
 * - **It orders, colours and selects nothing.** No row is coerced, no row is
 *   dropped, no list is sorted by it. F35 stands.
 * - **It does not narrow its denominator.** See `total` above.
 * - **It says `null`, not `0`, when there is nothing to divide.** A `0.00` rate
 *   over an empty set reads as *"we checked, and it is clean"*.
 */
export function oppositePairs(rows: readonly ScorableRow[]): OppositePairMark {
  let disputesLeansFor = 0;
  let corroboratesLeansAgainst = 0;
  for (const row of rows) {
    if (row.relation === "disputes" && row.lean === "leans-for") disputesLeansFor += 1;
    if (row.relation === "corroborates" && row.lean === "leans-against") corroboratesLeansAgainst += 1;
  }
  const pairs = disputesLeansFor + corroboratesLeansAgainst;
  const total = rows.length;
  return {
    disputesLeansFor,
    corroboratesLeansAgainst,
    pairs,
    total,
    rate: total === 0 ? null : pairs / total,
  };
}

/**
 * The mark as the plan asks it to be printed: **`N / all rows`**, never a bare
 * percentage, and never a percentage at all when there were no rows.
 */
export function formatOppositePairs(mark: OppositePairMark): string {
  const head = `${String(mark.pairs)} / ${String(mark.total)} rows`;
  const split = `${String(mark.disputesLeansFor)} disputes+leans-for, ${String(mark.corroboratesLeansAgainst)} corroborates+leans-against`;
  const rate = mark.rate === null ? "no rows, so no rate" : `${(mark.rate * 100).toFixed(1)}%`;
  return `${head} (${split}) — ${rate}; an inspection frame, not an error count`;
}

/* --------------------------------------------------------- kept per returned -- */

/**
 * What one group kept, against the two different things "returned" can mean.
 *
 * Both ratios are named in full because the panel already learned this the hard
 * way: *"7 pages"* in the header and *"found 10 pages"* in the lead are both
 * true and are different facts. A single `keptPerReturned` number would be the
 * same collision in a results file.
 */
export interface KeptPerReturned {
  /** `DebateCounts.returnedSources` — distinct admissible pages the search returned. */
  returnedSources: number;
  /** `DebateCounts.reportedRows` — rows the model wrote, including any past the cap. */
  reportedRows: number;
  /** `DebateCounts.keptRows` — rows that survived every rule. */
  keptRows: number;
  /** Rows the cap cut before iteration stopped. */
  omittedOverCap: number;
  /** `keptRows / reportedRows`, or `null` when the model reported nothing. */
  keptPerReportedRow: number | null;
  /** `keptRows / returnedSources`, or `null` when the search returned nothing. */
  keptPerReturnedSource: number | null;
}

/**
 * Kept-per-returned for one group.
 *
 * **What it refuses to do:** it does not pool groups (a direct group and a
 * claims group have different rules and different caps, and one ratio over both
 * hides which one is failing), it does not treat an empty group as a score of
 * zero — both ratios are `null` when their denominator is — and it does not
 * judge: an honest empty group is this mode's commonest correct answer.
 */
export function keptPerReturned(
  counts: Pick<DebateCounts, "returnedSources" | "reportedRows" | "keptRows" | "omittedOverCap">,
): KeptPerReturned {
  const { returnedSources, reportedRows, keptRows, omittedOverCap } = counts;
  return {
    returnedSources,
    reportedRows,
    keptRows,
    omittedOverCap,
    keptPerReportedRow: reportedRows === 0 ? null : keptRows / reportedRows,
    keptPerReturnedSource: returnedSources === 0 ? null : keptRows / returnedSources,
  };
}

/** One line per group, with `n/a` wherever a denominator was zero. */
export function keptPerReturnedLine(name: string, kept: KeptPerReturned): string {
  const pct = (v: number | null) => (v === null ? "  n/a" : `${(v * 100).toFixed(0).padStart(3)}%`);
  return (
    `  ${name.padEnd(10)} ${String(kept.keptRows).padStart(2)} kept of ${String(kept.reportedRows).padStart(2)} reported ` +
    `(${pct(kept.keptPerReportedRow)}), over ${String(kept.returnedSources).padStart(2)} returned page(s) ` +
    `(${pct(kept.keptPerReturnedSource)})` +
    (kept.omittedOverCap > 0 ? `; ${String(kept.omittedOverCap)} over the cap` : "")
  );
}

/* -------------------------------------------------------------- gold-URL hits -- */

/**
 * **The one normalisation this file applies to a URL, and it is declared rather
 * than clever.**
 *
 * Lower-cases the host, drops the scheme (so `http` and `https` are the same
 * page), drops a leading `www.`, drops the fragment, and drops one trailing
 * slash from the path. The **query is kept**, because on plenty of sites it is
 * the article id.
 *
 * **What it refuses to do:** it does not fetch anything, does not follow
 * redirects, does not strip tracking parameters (that is a guess about a
 * stranger's routing), does not compare titles, and does not treat a different
 * path on the same host as the same page. A string it cannot parse as a URL is
 * returned trimmed and lower-cased rather than thrown away — a gold list is
 * hand-written and a typo in it must show up as a miss, not as a crash.
 */
export function normaliseGoldUrl(url: string): string {
  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed.toLowerCase();
  }
  const host = parsed.host.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname.replace(/\/$/, "");
  return `${host}${path}${parsed.search}`;
}

/** Which of the hand-verified replies the search actually found. */
export interface GoldUrlHits {
  /** Distinct expected URLs, after normalisation. Duplicates in the gold list collapse. */
  expected: number;
  /** How many of those appeared. */
  hit: number;
  /** The expected URLs that appeared, in the order they were given. */
  hits: string[];
  /** The expected URLs that did not, in the order they were given. */
  missed: string[];
  /** `hit / expected`, or `null` when the gold list is empty — an empty list scores nothing. */
  rate: number | null;
}

/**
 * How many of a hand-verified gold URL list appear among the URLs a run
 * returned.
 *
 * **What it refuses to do:** it scores **recall against the gold list only**
 * and says nothing about the URLs that were returned and are not on it — those
 * are not wrong, the list is not exhaustive, and a precision figure over a
 * hand-written list of three would be a fiction. It does not fetch, does not
 * follow redirects, and does not partially credit a same-host different-path
 * URL. And an empty gold list returns `rate: null`, not `1` — an article with
 * no verified replies has not scored perfectly, it has not been measured.
 *
 * @param expected the hand-verified URLs for this article
 * @param seen every URL the run returned — annotations, kept rows, or both;
 *   the caller decides which question it is asking and duplicates are harmless
 */
export function goldUrlHits(
  expected: Iterable<string>,
  seen: Iterable<string>,
): GoldUrlHits {
  const seenKeys = new Set<string>();
  for (const url of seen) seenKeys.add(normaliseGoldUrl(url));

  const hits: string[] = [];
  const missed: string[] = [];
  const counted = new Set<string>();
  for (const url of expected) {
    const key = normaliseGoldUrl(url);
    if (counted.has(key)) continue;
    counted.add(key);
    if (seenKeys.has(key)) hits.push(url);
    else missed.push(url);
  }
  const total = counted.size;
  return {
    expected: total,
    hit: hits.length,
    hits,
    missed,
    rate: total === 0 ? null : hits.length / total,
  };
}

/** `N / M`, with `not measured` in place of a rate over an empty gold list. */
export function formatGoldUrlHits(hits: GoldUrlHits): string {
  if (hits.expected === 0) return "no gold URLs for this article — not measured";
  const rate = `${(((hits.rate ?? 0) * 100)).toFixed(0)}%`;
  const tail = hits.missed.length === 0 ? "" : `; missed ${hits.missed.join(", ")}`;
  return `${String(hits.hit)} / ${String(hits.expected)} gold URL(s) found (${rate})${tail}`;
}
