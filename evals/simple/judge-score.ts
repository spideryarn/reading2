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
const answerRows = fs
  .readFileSync(path.join(DIR, "answers.txt"), "utf8")
  .split("\n")
  .filter((l) => /^T\d-\d+ \|/.test(l))
  .map((l) => {
    const [id, ...rest] = l.split("|").map((s) => s.trim());
    return [id ?? "", rest] as const;
  });
const answers = new Map(answerRows);

/* A partial answer sheet used to score successfully: missing T1/T3 picks became
   `same`, missing T2 picks merely lowered the result, and a duplicate id kept
   only its last line. Refuse those shapes before printing a plausible score. */
const keyed = Object.keys(key).sort();
const answered = [...answers.keys()].sort();
if (answers.size !== answerRows.length) throw new Error("The judge answer sheet contains a duplicate id");
if (JSON.stringify(answered) !== JSON.stringify(keyed)) {
  const missing = keyed.filter((id) => !answers.has(id));
  const extra = answered.filter((id) => !(id in key));
  throw new Error(`The judge answer sheet does not match the key (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"})`);
}
for (const [id, k] of Object.entries(key)) {
  const fields = answers.get(id)!;
  if (k.task === "T1" || k.task === "T3") {
    if (!fields[0] || !["X", "Y", "SAME"].includes(fields[0])) throw new Error(`${id} has no valid comparison answer`);
    if (!fields[1] || !["X", "Y", "NONE", "BOTH"].includes(fields[1])) throw new Error(`${id} has no valid fidelity answer`);
  } else if (k.task === "T2") {
    if (!fields[0] || !["X", "Y"].includes(fields[0])) throw new Error(`${id} has no valid goal answer`);
  } else if (k.task === "T4") {
    const order = (fields[0] ?? "").split("<").map((s) => s.trim());
    if (order.length !== 3 || new Set(order).size !== 3 || order.some((letter) => !["P", "Q", "R"].includes(letter))) {
      throw new Error(`${id} has no valid three-level order`);
    }
  } else {
    throw new Error(`${id} has unknown task ${k.task ?? "(missing)"}`);
  }
}

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
