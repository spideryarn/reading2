/**
 * Writes the blind usefulness file for plan 261018i § How we will know it
 * works, gate 8: every origin note from the named arms beside its whole
 * passage, shuffled, numbered, with no arm named. The key goes to a file of
 * its own. Free.
 *
 *   npx tsx evals/marginalia-sources/judge-file.ts <arm>…
 */
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(import.meta.dirname, "..", "results", "margin-notes");
const HERE = import.meta.dirname;
type Note = { blockId: string; kind: string; text: string; quote: string };
type Arm = { arm: string; articles: { slug: string; notes: Note[] }[] };

const passages = new Map<string, string>();
for (const f of fs.readdirSync(path.join(HERE, "articles"))) {
  for (const line of fs.readFileSync(path.join(HERE, "articles", f), "utf8").split("\n")) {
    const tab = line.indexOf("\t");
    if (tab > 0) passages.set(line.slice(0, tab), line.slice(tab + 1));
  }
}

const rows: { arm: string; slug: string; note: Note }[] = [];
for (const name of process.argv.slice(2)) {
  const arm = JSON.parse(fs.readFileSync(path.join(OUT, `${name}.json`), "utf8")) as Arm;
  for (const a of arm.articles) for (const note of a.notes) if (note.kind === "source") rows.push({ arm: name, slug: a.slug, note });
}

/* A seeded integer shuffle (mulberry32), so the order is reproducible. */
let seed = 261018;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
for (let i = rows.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [rows[i], rows[j]] = [rows[j]!, rows[i]!];
}

const lines = rows.map(
  (r, i) => `## ${i + 1}\n\nPassage:\n> ${passages.get(r.note.blockId) ?? "?"}\n\nThe note is about: «${r.note.quote}»\n\nNote: ${r.note.text}\n`,
);
fs.writeFileSync(path.join(HERE, "judge-notes.md"), lines.join("\n"));
fs.writeFileSync(
  path.join(HERE, "judge-key.json"),
  JSON.stringify(rows.map((r, i) => ({ n: i + 1, arm: r.arm, slug: r.slug, blockId: r.note.blockId })), null, 2),
);
console.log(`${rows.length} notes written`);
