/**
 * **Origin notes, arm by arm** — plan 261018i § How we will know it works.
 * Free: reads the `w99-*` arms that `evals/margin-notes/run.ts generate`
 * wrote, and prints, per article, the notes by kind, every origin note in
 * full (to be checked against `cases.md`), and relation-word agreement with
 * the first control arm, for the control and for each change arm.
 *
 *   npx tsx evals/marginalia-sources/report.ts <after-arm>…
 *
 * `Why Nerds are Unpopular` was added after the first two control arms, so it
 * has control arms of its own (`w99-before-nerds`, `-2`); this reads both
 * pairs as one control.
 */
import fs from "node:fs";
import path from "node:path";

const OUT = path.join(import.meta.dirname, "..", "results", "margin-notes");

type Note = { blockId: string; kind: string; text: string; quote: string; to: string | null };
type Article = { slug: string; relations: Record<string, string>; notes: Note[]; dropped: Record<string, number> };
type Arm = { arm: string; promptVersion: string; srcSha: string; articles: Article[] };

const read = (name: string): Arm => JSON.parse(fs.readFileSync(path.join(OUT, `${name}.json`), "utf8")) as Arm;
const merged = (a: string, b: string): Arm => {
  const x = read(a);
  return { ...x, arm: `${a}+${b}`, articles: [...x.articles, ...read(b).articles] };
};

const control1 = merged("w99-before", "w99-before-nerds");
const control2 = merged("w99-before-2", "w99-before-nerds-2");
const changes = process.argv.slice(2).map(read);

function agreement(arm: Arm): string {
  let same = 0;
  let total = 0;
  for (const x of arm.articles) {
    const b = control1.articles.find((y) => y.slug === x.slug);
    if (!b) continue;
    for (const [id, r] of Object.entries(b.relations)) {
      total++;
      if (x.relations[id] === r) same++;
    }
  }
  return `${same}/${total} (${((100 * same) / Math.max(1, total)).toFixed(1)}%)`;
}

console.log("Relation words agreeing with w99-before:");
for (const arm of [control2, ...changes]) console.log(`  ${arm.arm} [${arm.promptVersion} ${arm.srcSha}]: ${agreement(arm)}`);

console.log("\nNotes per article, by kind:");
const slugs = control1.articles.map((a) => a.slug);
for (const slug of slugs) {
  const row = [control1, control2, ...changes].map((arm) => {
    const a = arm.articles.find((x) => x.slug === slug);
    if (!a) return `${arm.arm}: —`;
    const counts: Record<string, number> = {};
    for (const n of a.notes) counts[n.kind] = (counts[n.kind] ?? 0) + 1;
    return `${arm.arm}: ${JSON.stringify(counts)}`;
  });
  console.log(`- ${slug}\n    ${row.join("\n    ")}`);
}

for (const arm of changes) {
  console.log(`\n=== Origin notes, ${arm.arm}`);
  for (const a of arm.articles) {
    const origins = a.notes.filter((n) => n.kind === "source");
    const dropped = Object.entries(a.dropped).filter(([k, v]) => k.startsWith("note.") && v > 0);
    console.log(`- ${a.slug}: ${origins.length}${dropped.length ? `, article-only drops ${JSON.stringify(Object.fromEntries(dropped))}` : ""}`);
    for (const n of origins) console.log(`    ${n.blockId} «${n.quote}» → ${n.text}`);
  }
  console.log(`\n=== Article-only notes, ${arm.arm} (read for memory leaking in)`);
  for (const a of arm.articles) {
    for (const n of a.notes.filter((x) => x.kind !== "source")) console.log(`    [${n.kind}] ${a.slug.slice(0, 14)} ${n.blockId}: ${n.text}`);
  }
}
