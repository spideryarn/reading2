/**
 * **Plan 261101c stage 2, arm N2: a second Haiku pass that writes only the
 * notes** — paid, eval only. Reads a finished result set (stage 1's `P-2`),
 * and for each work the model listed sends Haiku the work's title, authors and
 * year and the text of the body blocks that cite it. Those are production's
 * resolved `citedAt` blocks plus body author–year citations for the same first
 * author and year; the model's own places are only a fallback. Writes a new
 * result set in run.ts's format, so score.ts and notes-pairs.ts read it unchanged.
 *
 *   npx tsx evals/citations-recall/notes-pass.ts <from-set> <run> [slug …]   # writes N2-<run>/
 *
 * **The join is checked, not trusted** (GPT Sol's plan review 261101c, 8):
 * every batch's answer must name exactly the ids it was sent, each once, with a
 * `why` and a number. A batch that does not keeps the first pass's notes for
 * its rows, and is counted (`batchesKept`). Nothing but `why` and `relevance`
 * is written, so the rows, their places and their ids are the first pass's, and
 * the script asserts that before it writes.
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../../src/env.js";
import type { Block } from "../../src/types.js";
import { HAIKU, LECUN, LECUN_FILE, OUT, type RawResult, resultPath } from "./run.js";

export const BATCH = 40;
const IN_FLIGHT = 3;
const BLOCK_CHARS = 900;
const MAX_BLOCKS = 2;

interface Place { block: string; quote: string }
interface Work { title: string; authors?: string; year?: string; why: string; relevance: number; mentions?: Place[]; reference?: Place; [k: string]: unknown }

export const NOTES_SYSTEM = `You are writing a short note on each work an article cites, for a reader of that article.

For each work below you are given its title, authors and year as the article gives them, and the
text of the passages of the article that cite it (or, when the body never cites it, its entry in
the article's reference list). Read the passages, then write:

"why" — one plain sentence, at most 160 characters: what THIS article uses the work for, as the
passages show it — the finding it builds on, the claim it supports, the view it argues against.
Not a summary of the work. Add nothing the passages do not say: no details from your own memory
of the work, its methods or its data. Do not begin "The article", "The author" or "This work".
If the passages only list the work among others, say what the list is for.

"relevance" 0-1 — how much the article's argument leans on the work, as the passages show it.
1: the article is built on it. 0.5: it carries one step of the argument. 0.1: a passing mention,
one of several in a list, or further reading. Most works in a long list are 0.1 to 0.3.

Answer for every id you are given, each once, and no others.

OUTPUT

JSON only, no prose, no code fence: {"notes": [{"id": "w1", "why": "...", "relevance": 0.3}]}`;

const NOTES_SCHEMA = {
  type: "object",
  properties: {
    notes: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, why: { type: "string" }, relevance: { type: "number" } },
        required: ["id", "why", "relevance"],
        additionalProperties: false,
      },
    },
  },
  required: ["notes"],
  additionalProperties: false,
} as const;

/**
 * One work's lines for the prompt: who it is, and the text of up to two blocks
 * that cite it — the body blocks code resolved (`citing`), falling back to the
 * model's own places, then to the reference entry if neither exists.
 */
export function workLines(id: string, w: Work, blocks: ReadonlyMap<string, Block>, citing: readonly string[] = []): string {
  const body = citing.length > 0 ? [...citing] : (w.mentions ?? []).map((m) => m.block);
  const ids = [...new Set(body.length > 0 ? body : w.reference ? [w.reference.block] : [])]
    .filter((b) => blocks.has(b))
    .slice(0, MAX_BLOCKS);
  const said = [w.title, w.authors, w.year].filter(Boolean).join(" · ");
  const passages = ids.map((b) => `  passage: ${blocks.get(b)!.text.slice(0, BLOCK_CHARS)}`).join("\n");
  return `[${id}] ${said}\n${passages || "  passage: (none)"}`;
}

/** Is this batch's answer exactly one note per id sent? */
export function checkedNotes(sent: readonly string[], answer: unknown): Map<string, { why: string; relevance: number }> | null {
  const notes = (answer as { notes?: unknown })?.notes;
  if (!Array.isArray(notes) || notes.length !== sent.length) return null;
  const out = new Map<string, { why: string; relevance: number }>();
  for (const n of notes as { id?: unknown; why?: unknown; relevance?: unknown }[]) {
    if (typeof n.id !== "string" || !sent.includes(n.id) || out.has(n.id)) return null;
    if (typeof n.why !== "string" || n.why.trim() === "") return null;
    if (typeof n.relevance !== "number" || !(n.relevance >= 0 && n.relevance <= 1)) return null;
    out.set(n.id, { why: n.why.trim(), relevance: n.relevance });
  }
  return out.size === sent.length ? out : null;
}

async function main(): Promise<void> {
  const [from, runArg, ...rest] = process.argv.slice(2);
  const run = Number(runArg);
  if (!from || !Number.isInteger(run) || run < 1) throw new Error("usage: notes-pass.ts <from-set> <run ≥ 1> [slug …]");
  const slugs = rest.length > 0 ? rest : fs.readdirSync(path.join(OUT, from)).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/u, ""));
  const arm = "N2";
  const existing = slugs.map((s) => resultPath(arm, run, s)).filter((f) => fs.existsSync(f));
  if (existing.length > 0) throw new Error(`refusing to overwrite:\n${existing.join("\n")}`);

  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const store = await import("../../src/store/index.js");
  const { closeDb } = await import("../../src/db/client.js");
  const { withMessagesJsonSchema } = await import("../../src/messages-structured-output.js");
  const { streamMessage } = await import("../../src/messages-stream.js");
  const { collectSpend, totalSpend } = await import("../../src/ai-spend.js");
  const { costStore } = await import("../../src/store/ai-calls.js");
  const { plainWords } = await import("../../src/plain-words.js");
  const { buildBibliography, emptyDrops, noScoreDrops, bodyAuthorYearCites } = await import("../../src/bibliography.js");
  const { surnameKey } = await import("../../src/citation-author-year.js");
  const { firstAuthor } = await import("../../src/scholar-search.js");
  fs.mkdirSync(path.dirname(resultPath(arm, run, "x")), { recursive: true });

  await runAsOwner(environmentOwnerId(), async () => {
    for (const slug of slugs) {
      const first = JSON.parse(fs.readFileSync(path.join(OUT, from, `${slug}.json`), "utf8")) as RawResult;
      if (first.answer === null) throw new Error(`${from} has no answer for ${slug}`);
      const answer = JSON.parse(first.answer) as { capped: boolean; works: Work[] };
      const list: Block[] = slug === LECUN
        ? (JSON.parse(fs.readFileSync(LECUN_FILE, "utf8")) as { blocks: Block[] }).blocks
        : (await store.loadArticle(slug)).blocks;
      const blocks = new Map(list.map((b) => [b.id, b]));
      /* Where code says each work is cited in the body, keyed by title and
         year back to the model's rows. A row the folds merged or renamed
         falls back to its own places. */
      const built = buildBibliography(answer, {
        slug, blocks: list, sourceHash: "eval", power: "standard", elapsedMs: 0, inherit: null,
        drops: emptyDrops(), scores: noScoreDrops(), referenceList: null, cap: Number.POSITIVE_INFINITY,
      });
      /* The body's author–year citations, by first surname and year. Code's
         places for a row can be its reference entry alone even when the body
         cites it author–year (Butlin: `citedAt` = the reference block, no
         mentions), and the reference entry is not a block with a reference
         role there. So a row's body passages are its non-reference places
         plus every body block whose author–year citation names its first
         author and year — the second N2 run's flaw. */
      const refBlocks = new Set(built.citations.flatMap((c) => (c.reference ? [c.reference.blockId] : [])));
      const ayBlocks = new Map<string, string[]>();
      for (const { block, cite } of bodyAuthorYearCites(list)) {
        const key = `${surnameKey(cite.surnames[0] ?? "")}|${cite.year}`;
        const had = ayBlocks.get(key) ?? [];
        if (!had.includes(block.id)) ayBlocks.set(key, [...had, block.id]);
      }
      const bodyOf = new Map<string, string[]>();
      const rawKeyCounts = new Map<string, number>();
      for (const w of answer.works) {
        const key = `${w.title}|${w.year ?? ""}`;
        rawKeyCounts.set(key, (rawKeyCounts.get(key) ?? 0) + 1);
      }
      for (const c of built.citations) {
        if (c.listedBy === "text") continue;
        const key = `${c.title}|${c.year ?? ""}`;
        /* A title/year shared by two raw rows is not an identity. Attaching one
           built row's passages to both would silently give at least one work
           the wrong evidence; let each fall back to its own places instead. */
        if (rawKeyCounts.get(key) !== 1) continue;
        const places = c.citedAt.filter((b) => !refBlocks.has(b) && blocks.get(b)?.role !== "reference");
        const ay = ayBlocks.get(`${surnameKey(firstAuthor(c.authors))}|${c.year ?? ""}`) ?? [];
        bodyOf.set(key, [...new Set([...places, ...ay])]);
      }
      let resolved = 0;
      const ids = answer.works.map((_, i) => `w${i + 1}`);
      const batches: number[][] = [];
      for (let i = 0; i < answer.works.length; i += BATCH) batches.push(ids.slice(i, i + BATCH).map((_, j) => i + j));

      const started = Date.now();
      let input = 0, output = 0, batchesKept = 0;
      const replaced = answer.works.map((w) => ({ ...w }));
      const { report } = await collectSpend(async () => {
        let next = 0;
        const worker = async () => {
          while (next < batches.length) {
            const batch = batches[next++]!;
            const sent = batch.map((i) => ids[i]!);
            try {
              const call = streamMessage(
                "bibliography",
                withMessagesJsonSchema({
                  max_tokens: 32_000,
                  thinking: { type: "adaptive" as const },
                  output_config: { effort: "high" as const },
                  system: [{ type: "text" as const, text: `${NOTES_SYSTEM}\n\n${plainWords("explain")}` }],
                  messages: [{ role: "user" as const, content: batch.map((i) => {
                    const w = answer.works[i]!;
                    const citing = bodyOf.get(`${w.title}|${w.year ?? ""}`) ?? [];
                    if (citing.length > 0) resolved++;
                    return workLines(ids[i]!, w, blocks, citing);
                  }).join("\n\n") }],
                }, NOTES_SCHEMA),
                { power: "standard", model: HAIKU },
              );
              const message = await call.finalMessage();
              input += message.usage.input_tokens;
              output += message.usage.output_tokens;
              const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
              const notes = message.stop_reason === "end_turn" ? checkedNotes(sent, JSON.parse(text)) : null;
              if (notes === null) { batchesKept++; continue; }
              for (const i of batch) {
                const n = notes.get(ids[i]!)!;
                replaced[i] = { ...replaced[i]!, why: n.why, relevance: n.relevance };
              }
            } catch (err) {
              batchesKept++;
              console.log(`${slug}: a batch failed, its rows keep the first pass's notes: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        };
        await Promise.all(Array.from({ length: IN_FLIGHT }, worker));
      }, { attribution: { scopeKind: "eval", ownerId: environmentOwnerId() }, sink: (row) => costStore.record(row) });

      /* Only the notes moved: every other field of every row is the first pass's. */
      for (const [i, w] of replaced.entries()) {
        const { why: _w, relevance: _r, ...rest2 } = w;
        const { why: _w0, relevance: _r0, ...rest0 } = answer.works[i]!;
        if (JSON.stringify(rest2) !== JSON.stringify(rest0)) throw new Error(`${slug}: row ${i} changed beyond its notes`);
      }
      const passDollars = totalSpend(report.calls).nanos / 1e9;
      const record: RawResult & { notesPass: Record<string, number> } = {
        ...first,
        arm,
        run,
        at: new Date().toISOString(),
        elapsedMs: first.elapsedMs + (Date.now() - started),
        usage: { ...first.usage, input: first.usage.input + input, output: first.usage.output + output },
        answer: JSON.stringify({ ...answer, works: replaced }),
        dollars: (first.dollars ?? 0) + passDollars,
        calls: (first.calls ?? 0) + report.calls.length,
        notesPass: { batches: batches.length, batchesKept, resolved, works: answer.works.length, input, output, dollars: passDollars, ms: Date.now() - started },
      };
      fs.writeFileSync(resultPath(arm, run, slug), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
      console.log(`${arm}-${run} ${slug}: ${resolved}/${answer.works.length} with body passages from code, ${batches.length} batches, ${batchesKept} kept · +$${passDollars.toFixed(4)} · +${Math.round((Date.now() - started) / 1000)}s`);
    }
  });
  await closeDb();
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) await main();
