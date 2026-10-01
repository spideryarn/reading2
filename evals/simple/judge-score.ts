/**
 * **Scores the blind read for plan 261001b** against its key. Free.
 *
 *   npx tsx evals/simple/judge-score.ts
 *
 * Reads evals/results/simple/judge-261001/{key.json,answers.txt}.
 */
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(import.meta.dirname, "..", "results", "simple", "judge-261001");
const key = JSON.parse(fs.readFileSync(path.join(DIR, "key.json"), "utf8")) as Record<string, Record<string, string>>;
const answers = new Map(
  fs
    .readFileSync(path.join(DIR, "answers.txt"), "utf8")
    .split("\n")
    .filter((l) => /^T\d-\d+ \|/.test(l))
    .map((l) => {
      const [id, ...rest] = l.split("|").map((s) => s.trim());
      return [id ?? "", rest] as const;
    }),
);

const isNew = (arm: string | undefined) => !!arm && !arm.includes("-15-");
const side = (k: Record<string, string>, pick: string | undefined) =>
  pick === "X" ? (isNew(k.x) ? "new" : "old") : pick === "Y" ? (isNew(k.y) ? "new" : "old") : "same";

for (const task of ["T1", "T3"]) {
  const tally = { new: 0, old: 0, same: 0 };
  const fidelity = { NONE: 0, newOnly: 0, oldOnly: 0, BOTH: 0 };
  for (const [id, k] of Object.entries(key)) {
    if (k.task !== task) continue;
    const [q1, q2] = answers.get(id) ?? [];
    tally[side(k, q1) as keyof typeof tally] += 1;
    if (q2 === "NONE") fidelity.NONE += 1;
    else if (q2 === "BOTH") fidelity.BOTH += 1;
    else if (q2 === "X" || q2 === "Y") fidelity[side(k, q2) === "new" ? "newOnly" : "oldOnly"] += 1;
  }
  const q = task === "T1" ? "spends fewer words on what the reader knows" : "easier for an outsider";
  console.log(`${task} (${q}): new ${tally.new}, old ${tally.old}, same ${tally.same}`);
  console.log(`${task} fidelity flags: none ${fidelity.NONE}, new only ${fidelity.newOnly}, old only ${fidelity.oldOnly}, both ${fidelity.BOTH}`);
}

const byLevel: Record<string, { right: number; n: number }> = {};
for (const [id, k] of Object.entries(key)) {
  if (k.task !== "T2") continue;
  const level = k.level ?? "?";
  byLevel[level] ??= { right: 0, n: 0 };
  byLevel[level].n += 1;
  if ((answers.get(id) ?? [])[0] === k.answer) byLevel[level].right += 1;
}
const t2 = Object.values(byLevel).reduce((a, b) => ({ right: a.right + b.right, n: a.n + b.n }), { right: 0, n: 0 });
console.log(`T2 (which text was written for goal A): ${t2.right}/${t2.n} right — ${JSON.stringify(byLevel)}`);

let exact = 0;
let n4 = 0;
let pairsRight = 0;
for (const [id, k] of Object.entries(key)) {
  if (k.task !== "T4") continue;
  n4 += 1;
  const order = ((answers.get(id) ?? [])[0] ?? "").split("<").map((s) => s.trim());
  const levels = order.map((letter) => k[letter]);
  if (levels.join(",") === "brief,simple,fuller") exact += 1;
  const rank = (l: string) => levels.indexOf(l);
  for (const [a, b] of [["brief", "simple"], ["simple", "fuller"], ["brief", "fuller"]] as const) {
    if (rank(a) < rank(b)) pairsRight += 1;
  }
}
console.log(`T4 (the ladder): ${exact}/${n4} ordered exactly brief < simple < fuller; ${pairsRight}/${n4 * 3} pairwise orders right`);
