/**
 * **The byline eval, by hand** — every case in `bylines/cases.json` through
 * `verifyAuthors`, and, given a second module, the same through that one, side
 * by side. Free and offline: the answers are fixed in the cases.
 *
 *   npx tsx evals/pdf/bylines.mts                         # this tree
 *   npx tsx evals/pdf/bylines.mts --old=src/pdf-authors-old.ts
 *
 * For `--old`, put a copy of an earlier `src/pdf-authors.ts` beside it (its
 * relative imports must resolve), e.g.
 * `git show <sha>:src/pdf-authors.ts > src/pdf-authors-old.ts`, and delete it
 * afterwards. Plan 261001l § The eval; scoring in `bylines-score.ts`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { verifyAuthors } from "../../src/pdf-authors.js";
import { type BylineCase, type CaseScore, scoreCase, type Verify } from "./bylines-score.js";

const cases = JSON.parse(readFileSync(new URL("bylines/cases.json", import.meta.url), "utf8")) as BylineCase[];
const oldArg = process.argv.find((a) => a.startsWith("--old="))?.slice("--old=".length);

const arms: { name: string; verify: Verify }[] = [];
if (oldArg) {
  const mod = (await import(resolve(oldArg))) as { verifyAuthors: Verify };
  arms.push({ name: "old", verify: mod.verifyAuthors });
}
arms.push({ name: "new", verify: verifyAuthors });

const scores = arms.map((arm) => ({ arm: arm.name, rows: cases.map((c) => scoreCase(arm.verify, c)) }));

const pad = (s: string, n: number) => s.padEnd(n);
console.log(pad("case", 32) + scores.map((s) => pad(s.arm, 30)).join(""));
for (const [i, c] of cases.entries()) {
  const cell = (r: CaseScore) => pad(`${r.positive}${r.silentDrops.length ? ` DROPS ${r.silentDrops.length}/${r.dropsTried}` : ""}`, 30);
  console.log(pad(c.id, 32) + scores.map((s) => cell(s.rows[i]!)).join(""));
}
console.log();
for (const s of scores) {
  const count = (o: string) => s.rows.filter((r) => r.positive === o).length;
  const drops = s.rows.flatMap((r) => r.silentDrops.map((d) => `${r.id}: ${d}`));
  const tried = s.rows.reduce((n, r) => n + r.dropsTried, 0);
  console.log(
    `${s.arm}: ${count("list")} list, ${count("names")} names only, ${count("refused")} refused of ${s.rows.length}; ` +
      `silent drops ${drops.length} of ${tried}`,
  );
  for (const d of drops) console.log(`  drop: ${d}`);
}
const last = scores.at(-1)!;
for (const r of last.rows.filter((r) => r.positive === "refused")) console.log(`  ${last.arm} refused ${r.id}: ${r.refusal}`);
