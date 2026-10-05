/**
 * The slice note, measured: the same slice with and without `SLICE_NOTE`
 * (src/structure-slices.ts), on three kinds of stretch. Plan 261005a, review F19.
 *
 *  a. slice 2 of the real book (the spike's plan), where a story had been cut
 *     into scenes at the top level. The no-note answer is the spike's own
 *     `slice-2-answer.json`, reused rather than bought again.
 *  b. the first 900 body blocks of a paper.
 *  c. slice 3 of the book with every heading block turned into a paragraph.
 *
 *   npx tsx evals/long-documents/note-comparison.ts
 *
 * Paid: five calls. Reads the local database only and writes no row: spend is
 * collected by `collectSpend` and kept in the results file. Results hold ids,
 * titles and gists, never block prose.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { collectSpend, totalSpend } from "../../src/ai-spend.js";
import { loadEnvLocal } from "../../src/env.js";
import { MAX_BATCH } from "../../src/labels.js";
import { finishedText, streamMessage } from "../../src/messages-stream.js";
import { estimateStructureTokens, parseWholeDocumentAnswer, STRUCTURE_HEADROOM, wholeDocumentRequest } from "../../src/structure.js";
import { promotedSections, SLICE_NOTE, withSliceNote } from "../../src/structure-slices.js";
import { splitBlocks } from "../../src/supplement.js";
import type { Block } from "../../src/types.js";

const BOOK = "s3-doctorow-250p-spya-jg872v";
const PAPER = "s3-gdl-45mb-spya-cc9kr8";
const OUT = path.resolve("evals/results/long-documents-2026-10-05");

loadEnvLocal();
if (new URL(process.env.DATABASE_URL ?? "postgres://missing").hostname !== "127.0.0.1") {
  throw new Error("not the local database; refusing");
}
const { loadArticle } = await import("../../src/store/index.js");
const bodyOf = async (slug: string): Promise<Block[]> =>
  splitBlocks(((await loadArticle(slug)) as unknown as { blocks: Block[] }).blocks).body;

const book = await bodyOf(BOOK);
const paper = await bodyOf(PAPER);
const plan = (JSON.parse(readFileSync(path.join(OUT, "plan.json"), "utf8")).plans[0].slices as { lo: number; hi: number }[]);
const unheaded = (blocks: Block[]): Block[] =>
  blocks.map((b) => {
    if (b.kind !== "heading") return b;
    const { level: _level, ...rest } = b;
    return { ...rest, tag: "p", kind: "text" as const };
  });

const cases: { name: string; blocks: Block[]; reuseNoNote?: string }[] = [
  { name: "book-slice-2", blocks: book.slice(plan[2]!.lo, plan[2]!.hi + 1), reuseNoNote: "slice-2-answer.json" },
  { name: "paper-first-900", blocks: paper.slice(0, 900) },
  { name: "book-slice-3-headingless", blocks: unheaded(book.slice(plan[3]!.lo, plan[3]!.hi + 1)) },
];

interface Row {
  case: string;
  note: boolean;
  blocks: number;
  headingBlocks: number;
  reused: boolean;
  ok: boolean;
  error?: string;
  seconds: number | null;
  dollars: number | null;
  topLevel: number;
  sectionlessTopLevel: number;
  sectionlessOverBatch: number;
  sections: { title: string; blocks: number; sections: number }[];
}

function describe(answer: string, blocks: Block[]): Pick<Row, "topLevel" | "sectionlessTopLevel" | "sectionlessOverBatch" | "sections"> {
  const at = new Map(blocks.map((b, i) => [b.id, i]));
  const top = promotedSections(parseWholeDocumentAnswer(answer, blocks).root, blocks);
  const sections = top.map((s) => ({
    title: s.title,
    blocks: at.get(s.range[1])! - at.get(s.range[0])! + 1,
    sections: s.children?.length ?? 0,
  }));
  return {
    topLevel: sections.length,
    sectionlessTopLevel: sections.filter((s) => s.sections === 0).length,
    sectionlessOverBatch: sections.filter((s) => s.sections === 0 && s.blocks > MAX_BATCH).length,
    sections,
  };
}

async function one(c: (typeof cases)[number], note: boolean): Promise<Row> {
  const base = { case: c.name, note, blocks: c.blocks.length, headingBlocks: c.blocks.filter((b) => b.kind === "heading").length };
  const empty = { topLevel: 0, sectionlessTopLevel: 0, sectionlessOverBatch: 0, sections: [] };
  const reuse = !note && c.reuseNoNote ? path.join(OUT, c.reuseNoNote) : null;
  if (reuse && existsSync(reuse)) {
    return { ...base, reused: true, ok: true, seconds: null, dollars: null, ...describe(readFileSync(reuse, "utf8"), c.blocks) };
  }
  const request = wholeDocumentRequest(c.blocks);
  const params = note ? withSliceNote(request.params, request.user) : request.params;
  const began = Date.now();
  const { result, report } = await collectSpend(
    async () => {
      try {
        const message = await streamMessage("structure", params, { power: "standard", signal: AbortSignal.timeout(400_000) }).finalMessage();
        return { answer: finishedText(message, "table of contents", request.maxTokens, estimateStructureTokens(c.blocks), STRUCTURE_HEADROOM) };
      } catch (err) {
        return { error: (err as Error).message.slice(0, 200) };
      }
    },
    { attribution: { scopeKind: "eval", articleSlug: c.name.startsWith("paper") ? PAPER : BOOK }, sink: async () => {} },
  );
  const spent = { seconds: Math.round((Date.now() - began) / 100) / 10, dollars: totalSpend(report.calls).nanos / 1e9 };
  if ("error" in result) return { ...base, reused: false, ok: false, error: result.error, ...spent, ...empty };
  writeFileSync(path.join(OUT, `note-${c.name}-${note ? "with" : "without"}-answer.json`), result.answer);
  try {
    return { ...base, reused: false, ok: true, ...spent, ...describe(result.answer, c.blocks) };
  } catch (err) {
    return { ...base, reused: false, ok: false, error: (err as Error).message.slice(0, 200), ...spent, ...empty };
  }
}

const rows = await Promise.all(cases.flatMap((c) => [one(c, false), one(c, true)]));
const dollars = rows.reduce((a, r) => a + (r.dollars ?? 0), 0);
writeFileSync(path.join(OUT, "note-comparison.json"), `${JSON.stringify({ note: SLICE_NOTE, dollars, rows }, null, 1)}\n`);
for (const r of rows) {
  console.log(
    `${r.case.padEnd(26)} note=${String(r.note).padEnd(5)} blocks=${r.blocks} top=${r.topLevel} sectionless=${r.sectionlessTopLevel} ` +
      `(>${MAX_BATCH}: ${r.sectionlessOverBatch}) ${r.seconds ?? "reused"}s $${r.dollars?.toFixed(4) ?? "0 (reused)"}${r.ok ? "" : ` FAILED ${r.error}`}`,
  );
  for (const s of r.sections) console.log(`    ${String(s.blocks).padStart(4)} ${String(s.sections).padStart(3)}  ${s.title}`);
}
console.log(`total $${dollars.toFixed(4)}`);
process.exit(0);
