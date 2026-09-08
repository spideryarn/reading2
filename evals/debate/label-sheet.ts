/**
 * **D′ — the blind labelling instrument.** Turns journalled runs into a sheet a
 * person can label *before* any repaired output exists, seeing only the target,
 * the quotation and the evidence the model was shown.
 *
 * Stage D′ of
 * docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md, and the
 * specification is that plan's **F60**:
 *
 * > label every evaluable row, show the labeller only target, quote and evidence
 * > — `relation`, `lean` and `applies` hidden — and label before any repaired
 * > output exists.
 *
 * ## Why the hiding is the whole point
 *
 * The labels are ground truth for a prompt repair, and the repair changes the
 * very fields the model already answered. A labeller who can see the model's
 * answer is not producing an independent reading of the passage; they are
 * agreeing or disagreeing with a suggestion. So the four answer fields are
 * **never read out of a row by this file at all** — not read, not carried, not
 * rendered. There is no code path that could leak them, rather than a rendering
 * step that remembers not to. `tests/debate-label-sheet.test.ts` is the guard,
 * and it asserts on the rendered text, which is the surface a person sees.
 *
 * ## The two rules underneath that
 *
 * **A row with no evidence is not silently dropped.** The evidence extract is
 * the frozen packet whose `url` the row cites, and one of the 26 journalled rows
 * cites a URL no annotation returned. A sheet 25 rows long built from 26
 * reported rows, saying nothing, would be exactly the failure
 * ([silent-success.md](../../docs/reusable/silent-success.md)) this eval exists
 * to catch — a short list that reads as an honest one. Every such row goes to
 * `notEvaluable` with a sentence, and the header states the count.
 *
 * **The order is stratified, not merely shuffled.** All of one run's `direct`
 * rows in a block, in the order the model emitted them, is a pattern a labeller
 * learns from: adjacent rows share a source, a target and an argument, and the
 * third is labelled in the light of the first two. A plain seeded shuffle leaves
 * that to chance and the first draw put five rows from one run at the head, so
 * the order is **round-robin across run and pass, shuffled within each** —
 * a constraint on every seed rather than a seed picked because its draw looked
 * better, which would be choosing the outcome. The strategy and the seed are
 * both printed, so a reader knows the head of the sheet was not chosen.
 *
 * ## Separate data and rendering
 *
 * `buildLabelSheet` computes; `renderLabelSheet` prints. The labels come back
 * keyed by `LabelRow.id`, and joining them to rows means rebuilding the sheet
 * from the same journals — which is why the id may not depend on anything the
 * sort or the shuffle decides.
 */
import { createHash } from "node:crypto";
import path from "node:path";

import type { DebatePassKind } from "../../src/debate-journal.js";
import type { FrozenPacket, JournalRowsReport, ReportedPass } from "./journal-rows.js";
import { LEAN_VALUES } from "./score.js";

/**
 * The default shuffle seed — a constant, so an unparameterised regeneration
 * reproduces the sheet that was labelled. Changing it invalidates nothing but
 * the order; the ids are seed-independent by construction.
 */
export const DEFAULT_SEED = 20260908;

/** How the rows are ordered, named in the sheet so nobody has to infer it. */
export const ORDER_STRATEGY = "stratified round-robin across run and pass, shuffled within";

/**
 * **The answers the sheet asks for, generated from the type rather than typed
 * out** — `LEAN_VALUES` is `Object.values` of a total mapping over the union,
 * so a member added to or removed from `DebateLean` reaches this sentence
 * without anybody remembering it.
 *
 * The first draft of this file wrote the four options out by hand and got one of
 * them wrong: it offered `unclear`, which is a **`DebateRelation`** member, and
 * every label written with it would have arrived in a vocabulary the scorer
 * cannot join — landing as off-vocabulary in the very report F62 exists to
 * produce. An instrument that names a vocabulary must not be able to disagree
 * with the code that accepts it, and that goes for its prose as much as its
 * tables. Same class as this morning's `RELATIONS` fix in `src/debate.ts`.
 */
const OPTIONS_LINE = LEAN_VALUES.map((value) => `\`${value}\``).join(", ");

/**
 * **What the row is about**, and the only thing about it a labeller is told
 * beyond the quotation and the evidence.
 *
 * A union rather than a bag of optionals: a group-one row's target is the
 * article, a group-two row's target is one claim in it, and there is no third
 * shape. `src/types.ts` § `DebateLean` is where the two targets are defined.
 */
export type LabelTarget =
  | {
      kind: "article";
      slug: string;
      title: string | null;
      url: string | null;
      /**
       * **The words in which the source names this article** — the row's
       * `articleReferenceQuote`, which is part of stating the target rather than
       * a fifth thing beside it: without it, *"does this passage lean toward
       * this article"* is ambiguous whenever the page mentions more than one.
       *
       * It is a quotation of the **source page**, not the model's reading of it,
       * so it is not one of the hidden fields. It is the model's *transcription*
       * of that page, though — these rows are raw, so nothing here has been
       * located in the extract the way production locates it, and the sheet says
       * so. `null` where the row carried none, and the sheet says that too
       * rather than rendering a blank.
       */
      articleReferenceQuote: string | null;
    }
  | {
      kind: "claim";
      blockId: string;
      claimQuote: string;
    };

/** One frozen packet, reduced to what a labeller reads. */
export interface EvidenceExtract {
  title: string | null;
  content: string;
}

/** One row to label. **There is deliberately no field here for the model's answer.** */
export interface LabelRow {
  /**
   * Stable across regeneration and independent of order: run, pass, the row's
   * index **in the model's own answer**, and a hash of the row's URL and
   * quotation. Never the position after a sort or a shuffle, or a re-run with a
   * different seed would renumber every label collected under the old one.
   */
  id: string;
  target: LabelTarget;
  /** The row's `sourceQuote` — the passage whose leaning is being labelled. */
  sourceQuote: string;
  /**
   * Every packet whose `url` is exactly the row's `url`, in wire order.
   * Non-empty by construction: a row with none is not here at all.
   * `length > 1` is a fact about the run, and the sheet states the count.
   */
  evidence: EvidenceExtract[];
}

/** A row that cannot be labelled, and the sentence saying why. Never dropped. */
export interface NotEvaluableRow {
  id: string;
  /** Authored here, never provider prose, and never a value read off the row. */
  why: string;
}

/** The sheet, as data. `renderLabelSheet` is the only thing that turns it into text. */
export interface LabelSheet {
  /** The shuffle seed, so the order reproduces. */
  seed: number;
  /** Run names, in the order they were read. */
  runs: string[];
  /** Rows to label, **shuffled**. */
  rows: LabelRow[];
  /** Rows that could not be labelled, in stable id order, with a reason each. */
  notEvaluable: NotEvaluableRow[];
  /** Rows the journals reported, summed — `rows.length + notEvaluable.length`. */
  rowsReported: number;
  /** Frozen packets the journals held, summed across every pass. */
  packetsSeen: number;
  /**
   * **Non-empty means the journals were not a complete account of themselves.**
   * Every `JournalRowsReport.problems` entry, prefixed with its run, plus
   * anything this file found — a duplicated run name, say.
   */
  problems: string[];
}

/** A journal report together with the run it came from. */
interface NamedReport {
  run: string;
  report: JournalRowsReport;
}

/**
 * Build the sheet.
 *
 * `run` names default to the journal file's parent directory, which is what
 * `journalPath` puts them in. Pass `runs` to override — a test hands in reports
 * built from events, whose `file` is `(events)`.
 */
export function buildLabelSheet(
  reports: readonly JournalRowsReport[],
  opts: { seed?: number; runs?: readonly string[] } = {},
): LabelSheet {
  const seed = opts.seed ?? DEFAULT_SEED;
  const named: NamedReport[] = reports.map((report, index) => ({
    run: opts.runs?.[index] ?? runNameOf(report.file),
    report,
  }));

  const problems: string[] = [];
  const seen = new Set<string>();
  for (const { run } of named) {
    if (seen.has(run)) {
      problems.push(
        `two reports are both called "${run}" — their row ids collide, so labels cannot be joined back unambiguously`,
      );
    }
    seen.add(run);
  }
  for (const { run, report } of named) {
    for (const problem of report.problems) problems.push(`${run}: ${problem}`);
  }

  /* Rows paired with the stratum they came from — one stratum per run and pass,
     which is exactly the grouping the order exists to break up. */
  const strata: { key: string; row: LabelRow }[] = [];
  const notEvaluable: NotEvaluableRow[] = [];
  let rowsReported = 0;
  let packetsSeen = 0;
  for (const { run, report } of named) {
    for (const pass of report.passes) {
      packetsSeen += pass.packets.length;
      for (const [index, row] of pass.rows.entries()) {
        rowsReported += 1;
        const outcome = readRow(run, pass, index, row);
        if ("why" in outcome) notEvaluable.push(outcome);
        else strata.push({ key: `${run}/${pass.pass ?? "unknown"}`, row: outcome });
      }
    }
  }

  notEvaluable.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    seed,
    runs: named.map((n) => n.run),
    rows: stratifiedOrder(strata, seed),
    notEvaluable,
    rowsReported,
    packetsSeen,
    problems,
  };
}

/** `output/debate-runs/<run>/journal.jsonl` → `<run>`. Anything else comes back as it is. */
function runNameOf(file: string): string {
  const base = path.basename(path.dirname(file));
  return base === "" || base === "." ? file : base;
}

/**
 * Read one reported row into a sheet entry, or say why it cannot be one.
 *
 * **The four answer fields are not touched here.** The row arrives as `unknown`
 * — straight out of the fence, validated by nothing — and exactly five keys are
 * ever read off it: `url`, `sourceQuote`, `blockId`, `claimQuote` and
 * `articleReferenceQuote`. Every one of those is either the target or a
 * quotation from somebody's page; none is the model's reading. That is the
 * blinding, expressed as the absence of code.
 */
function readRow(
  run: string,
  pass: ReportedPass,
  index: number,
  row: unknown,
): LabelRow | NotEvaluableRow {
  const passName: DebatePassKind | "unknown" = pass.pass ?? "unknown";
  const isRecord = typeof row === "object" && row !== null && !Array.isArray(row);
  const record = (isRecord ? row : {}) as Record<string, unknown>;
  const url = stringOf(record.url);
  const sourceQuote = stringOf(record.sourceQuote);
  const id = rowId(run, passName, index, url, sourceQuote);

  if (!isRecord) {
    return { id, why: "the reported row is not an object, so it has no quotation to label" };
  }
  if (pass.pass === null) {
    return {
      id,
      why: "the attempt has no attempt-started, so neither its group nor its target is known",
    };
  }
  if (url === null || url === "") {
    return { id, why: "the row carried no url, so no frozen packet can be matched to it" };
  }
  if (sourceQuote === null || sourceQuote === "") {
    return { id, why: "the row carried no sourceQuote, so there is no passage to label" };
  }

  const target = targetOf(pass, record);
  if (typeof target === "string") return { id, why: target };

  const matches = pass.packets.filter((packet) => packet.url === url);
  if (matches.length === 0) {
    return {
      id,
      why: `no annotation in this pass returned ${url}, so the evidence the model was shown is not on disk`,
    };
  }
  return { id, target, sourceQuote, evidence: matches.map(extractOf) };
}

/** The row's target, or the sentence saying why it has none. */
function targetOf(pass: ReportedPass, record: Record<string, unknown>): LabelTarget | string {
  if (pass.pass === "direct") {
    const article = pass.article;
    if (!article) return "the attempt records no article, so a group-one row has no stated target";
    const names = stringOf(record.articleReferenceQuote);
    return {
      kind: "article",
      slug: article.slug,
      title: article.title,
      url: article.url,
      articleReferenceQuote: names === null || names === "" ? null : names,
    };
  }
  const blockId = stringOf(record.blockId);
  const claimQuote = stringOf(record.claimQuote);
  if (blockId === null || blockId === "") {
    return "the row names no blockId, so its target claim cannot be located";
  }
  if (claimQuote === null || claimQuote === "") {
    return "the row carried no claimQuote, so there is no target claim to label against";
  }
  return { kind: "claim", blockId, claimQuote };
}

function extractOf(packet: FrozenPacket): EvidenceExtract {
  return { title: packet.title, content: packet.content };
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * The id.
 *
 * Run, pass, the model's own row index, and eight hex of the URL and quotation
 * — **nothing the sort or the shuffle decides**, so the same journals produce
 * the same ids under any seed, and a label collected today still names its row
 * tomorrow. The hash is over two fields a labeller can see anyway, so it encodes
 * no part of the answer.
 */
function rowId(
  run: string,
  pass: string,
  index: number,
  url: string | null,
  sourceQuote: string | null,
): string {
  const digest = createHash("sha256")
    .update(`${url ?? ""}\n${sourceQuote ?? ""}`, "utf-8")
    .digest("hex")
    .slice(0, 8);
  return `${run}/${pass}/${String(index)}-${digest}`;
}

/**
 * A seeded PRNG — mulberry32, a dozen lines of arithmetic and no dependency.
 *
 * It is used for one thing, the order of a sheet, and the requirement on it is
 * reproducibility rather than statistical quality.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates in place, drawing from a caller's stream so the whole order is one sequence. */
function shuffleInPlace<T>(items: T[], random: () => number): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = items[i];
    const b = items[j];
    /* `noUncheckedIndexedAccess`: both indices are in range by construction, and
       the guard is here so the swap cannot silently write `undefined`. */
    if (a === undefined || b === undefined) continue;
    items[i] = b;
    items[j] = a;
  }
}

/**
 * **`ORDER_STRATEGY`, implemented.** One bucket per run-and-pass, each shuffled;
 * then rounds, taking one row from every bucket that still has rows, with the
 * buckets' turn order reshuffled each round.
 *
 * **Adjacency is a guarantee, not a probability.** Within a round each bucket
 * appears once, and a round that would open with the bucket that closed the last
 * one swaps its first two, so no two neighbouring rows share a run and pass for
 * as long as two buckets still have rows. The tail, once one bucket outlives the
 * others, is unavoidably from that bucket — that is a fact about the runs (one
 * pass reported eight rows and another two), not a gap in the constraint.
 */
function stratifiedOrder(entries: readonly { key: string; row: LabelRow }[], seed: number): LabelRow[] {
  const random = mulberry32(seed);
  const buckets = new Map<string, LabelRow[]>();
  const keys: string[] = [];
  for (const { key, row } of entries) {
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = [];
      buckets.set(key, bucket);
      keys.push(key);
    }
    bucket.push(row);
  }
  for (const key of keys) shuffleInPlace(buckets.get(key) ?? [], random);

  const out: LabelRow[] = [];
  let last: string | null = null;
  for (;;) {
    const live = keys.filter((key) => (buckets.get(key)?.length ?? 0) > 0);
    if (live.length === 0) break;
    shuffleInPlace(live, random);
    const first = live[0];
    const second = live[1];
    if (live.length > 1 && first !== undefined && second !== undefined && first === last) {
      live[0] = second;
      live[1] = first;
    }
    for (const key of live) {
      const next = buckets.get(key)?.shift();
      if (next === undefined) continue;
      out.push(next);
      last = key;
    }
  }
  return out;
}

/**
 * The sheet as Markdown.
 *
 * **The header declares the sheet's own completeness** — how many rows the
 * journals reported, how many are on the sheet, how many are not and why, and
 * every problem the journals raised. A sheet quietly shorter than the runs it
 * came from would be indistinguishable from an honest one.
 */
export function renderLabelSheet(sheet: LabelSheet): string {
  const lines: string[] = [];
  lines.push("# Debate-mode blind labelling sheet");
  lines.push("");
  lines.push(
    "Each entry below gives you a **target**, a **quoted passage** from an outside page, and the",
    "**extract that page was read from**. For each one, say which way the quoted passage leans",
    "toward that target, and record it in a separate file, one line per id.",
    "**The model's own reading of each passage — the fields your labels will be compared against —**",
    "**is deliberately not on this sheet**, and neither is anything computed from it.",
    "",
    `- **Answer with exactly one of:** ${OPTIONS_LINE} — and nothing else.`,
    "  Every one of those is a real answer, including the one that means the passage does not settle",
    "  it. The list is generated from the type the scorer joins your labels on, so the question you",
    "  are answering and the vocabulary that accepts your answer cannot drift apart.",
    "- The quoted passage is **the model's own transcription** of the words it says it found, taken",
    "  from the answer as written and checked against nothing. It may be spelled differently from the",
    "  extract below it, or not appear there at all. Label it anyway, and on what it says: a passage",
    "  you cannot find in the extract is a fact about the run, not a mistake of yours.",
  );
  lines.push("");
  lines.push("## What this sheet contains");
  lines.push("");
  lines.push(`- Order: **${ORDER_STRATEGY}**, seed \`${String(sheet.seed)}\`.`);
  lines.push(
    "  The order is **constrained**, not merely randomised: no two neighbouring rows come from the",
    "  same run and pass while more than one still has rows left. The head of the sheet was not chosen,",
    "  and the whole order reproduces from the seed.",
  );
  lines.push(
    `- Runs read: ${sheet.runs.length === 0 ? "none" : sheet.runs.map((r) => `\`${r}\``).join(", ")}`,
  );
  lines.push(`- Rows the journals reported: **${String(sheet.rowsReported)}**`);
  lines.push(`- Rows to label on this sheet: **${String(sheet.rows.length)}**`);
  lines.push(
    `- Rows that cannot be labelled: **${String(sheet.notEvaluable.length)}**` +
      (sheet.notEvaluable.length === 0 ? "" : " — every one is listed at the foot, with its reason"),
  );
  lines.push(`- Frozen packets seen across the runs: **${String(sheet.packetsSeen)}**`);
  const shared = sheet.rows.filter((row) => row.evidence.length > 1).length;
  lines.push(
    shared === 0
      ? "- No row's URL was returned by more than one annotation."
      : `- **${String(shared)}** row(s) cite a URL that more than one annotation returned; every matching extract is shown, and the count is stated on the row.`,
  );
  lines.push("");
  if (sheet.problems.length === 0) {
    lines.push(
      "No problems were reported by the journals — every attempt in them is accounted for.",
    );
  } else {
    lines.push(
      `**${String(sheet.problems.length)} problem(s) reported by the journals — this sheet is not a complete account of the runs:**`,
      "",
    );
    for (const problem of sheet.problems) lines.push(`- ${problem}`);
  }
  lines.push("");
  lines.push("## Rows to label");
  lines.push("");
  if (sheet.rows.length === 0) lines.push("_None._", "");
  for (const [index, row] of sheet.rows.entries()) {
    lines.push(`### ${String(index + 1)}. \`${row.id}\``);
    lines.push("");
    lines.push(...targetLines(row.target));
    lines.push("");
    lines.push("**Quoted passage — this is what you are labelling:**");
    lines.push("");
    lines.push(...quoted(row.sourceQuote));
    lines.push("");
    const n = row.evidence.length;
    for (const [i, extract] of row.evidence.entries()) {
      lines.push(
        n === 1
          ? "**The extract that page was read from:**"
          : `**Extract ${String(i + 1)} of ${String(n)} for this page:**`,
      );
      if (extract.title !== null) lines.push("", `_Page title: ${extract.title}_`);
      lines.push("");
      lines.push(...quoted(extract.content));
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }
  lines.push("## Rows that cannot be labelled");
  lines.push("");
  if (sheet.notEvaluable.length === 0) {
    lines.push("_None — every reported row is on the sheet above._");
  } else {
    lines.push(
      `These ${String(sheet.notEvaluable.length)} row(s) were reported by the runs and are **not** on the sheet.`,
      "They are listed here rather than dropped, so the sheet's length can be reconciled with the runs'.",
      "",
    );
    for (const row of sheet.notEvaluable) lines.push(`- \`${row.id}\` — ${row.why}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function targetLines(target: LabelTarget): string[] {
  if (target.kind === "article") {
    const what = target.title ?? target.slug;
    const where = target.url === null ? "" : ` — <${target.url}>`;
    const lines = [
      `**Target — the article being written about:** ${what}${where}`,
      "",
      `(slug \`${target.slug}\`)`,
      "",
    ];
    if (target.articleReferenceQuote === null) {
      /* Stated rather than left blank: a row with no such quotation is a fact
         about the row, and a labeller who sees nothing cannot tell that from a
         rendering that dropped it. */
      lines.push("**The outside page names this article**, but the row quoted no words in which it does so.");
      return lines;
    }
    lines.push(
      "**Where the outside page names this article** (the model's transcription, checked against nothing):",
      "",
    );
    lines.push(...quoted(target.articleReferenceQuote));
    return lines;
  }
  return [
    `**Target — a claim the article makes**, in block \`${target.blockId}\`:`,
    "",
    ...quoted(target.claimQuote),
  ];
}

/** A blockquote, so a stranger's page cannot break out of the Markdown around it. */
function quoted(text: string): string[] {
  const body = text === "" ? "(empty)" : text;
  return body.split("\n").map((line) => (line === "" ? ">" : `> ${line}`));
}
