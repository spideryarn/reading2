/**
 * SPIKE helper (throwaway): print the local book's bounded parts, its heading
 * blocks and its opening blocks, to compare a stitched tree with the book's
 * own contents. Read-only, local database only. Prints short block openings to
 * the terminal; writes nothing.
 *
 *   npx tsx evals/long-documents/spike-peek.ts [from] [to]
 */
import { loadEnvLocal } from "../../src/env.js";

loadEnvLocal();
if (new URL(process.env.DATABASE_URL ?? "postgres://missing").hostname !== "127.0.0.1") {
  throw new Error("not the local database; refusing");
}
const { loadArticle } = await import("../../src/store/index.js");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const a: any = await loadArticle("s3-doctorow-250p-spya-jg872v");
const order = new Map<string, number>(a.blocks.map((b: { id: string }, i: number) => [b.id, i]));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nodes: any[] = Object.values(a.tree.nodes);
const from = Number(process.argv[2] ?? 0);
const to = Number(process.argv[3] ?? 60);
if (process.argv[2] === undefined) {
  for (const p of nodes.filter((n) => n.depth === 1)) {
    console.log("PART", order.get(p.range[0]), order.get(p.range[1]), p.title);
  }
  a.blocks.forEach((b: { kind: string; text: string; level?: number }, i: number) => {
    if (b.kind === "heading" && b.text.trim() !== "With a Little Help") console.log("H", i, b.level ?? "", b.text.slice(0, 70));
  });
}
a.blocks.slice(from, to).forEach((b: { kind: string; text: string }, i: number) => console.log(from + i, b.kind, b.text.slice(0, 90)));
process.exit(0);
