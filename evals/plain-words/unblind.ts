/**
 * **Record a blind judge's verdicts, then unblind them against the key.**
 *
 * ```
 * npx tsx evals/plain-words/unblind.ts <pairs-base> <judge> "<X|Y|same per pair, space-separated>" "<n=X- n=Y- …>" [--suffix opus]
 * ```
 *
 * `<pairs-base>` is the path without extension (…/pairs-before-vs-after-3). It writes
 * `<base>.judged[-suffix].txt` — refusing to overwrite — and prints who won, by field, and whose
 * lines the fidelity flags fell on. The judge never sees the key; this is the only place the two meet.
 */
import fs from "node:fs";

const [base, judge, verdicts, flags, ...rest] = process.argv.slice(2);
if (!base || !judge || !verdicts || flags === undefined) throw new Error("usage: unblind.ts <pairs-base> <judge> <verdicts> <flags> [--suffix s]");
const at = rest.indexOf("--suffix");
const suffix = at >= 0 ? `-${rest[at + 1]}` : "";

const key = fs.readFileSync(`${base}.key.tsv`, "utf-8").trim().split("\n").map((l) => l.split("\t"));

/* `@file` reads the judge's own lines — `<n> plain=X fid=Y- term=ok [why]` — rather than a
   hand-copied string: a long read copied by hand is where a verdict gets shifted by one. */
let fidFlags = flags;
let termFlags = "";
let v: string[];
if (verdicts.startsWith("@")) {
  const lines = fs.readFileSync(verdicts.slice(1), "utf-8").split("\n").filter((l) => /^\d+ plain=/.test(l.trim()));
  const byN = new Map(lines.map((l) => [Number(l.trim().split(" ")[0]), l.trim()]));
  if (byN.size !== key.length) throw new Error(`${byN.size} judged lines for ${key.length} pairs`);
  v = key.map((_, i) => byN.get(i + 1)?.match(/plain=(X|Y|same)/)?.[1] ?? "missing");
  fidFlags = [...byN].flatMap(([n, l]) => (l.match(/fid=([XY])-/) ? [`${n}=${l.match(/fid=([XY])-/)![1]}-`] : [])).join(" ");
  termFlags = [...byN].flatMap(([n, l]) => (l.match(/term=([XY])-/) ? [`${n}=${l.match(/term=([XY])-/)![1]}-`] : [])).join(" ");
} else {
  v = verdicts.trim().split(/\s+/);
}
if (v.length !== key.length) throw new Error(`${v.length} verdicts for ${key.length} pairs`);
if (v.some((x) => !["X", "Y", "same"].includes(x))) throw new Error("verdicts must be X, Y or same");

const out = `${base}.judged${suffix}.txt`;
if (fs.existsSync(out)) throw new Error(`refusing to overwrite ${out}`);
fs.writeFileSync(out, `# ${judge}, blind (read only the pairs file; sides shuffled). Line 2: plain winner per pair. Line 3: fidelity flags (the worse side).\n${v.join(" ")}\nfid: ${fidFlags.trim()}\nterm: ${termFlags.trim()}\n`);

/* Keys are `n, <group columns…>, X=arm, Y=arm`: found by label, so a key with one group
   column (answers, run.ts) and one with two (artefacts: generator, field) both read right. */
const arm = (row: string[], side: "X" | "Y") => {
  const cell = row.find((c) => c.startsWith(`${side}=`));
  if (!cell) throw new Error(`no ${side}= column in key row ${row.join(" ")}`);
  return cell.slice(2);
};
const groupOf = (row: string[]) => row.slice(1).filter((c) => !/^[XY]=/.test(c)).join(" ");
const total = new Map<string, number>();
const byField = new Map<string, Map<string, number>>();
key.forEach((row, i) => {
  const w = v[i]!;
  const winner = w === "same" ? "same" : arm(row, w as "X" | "Y");
  total.set(winner, (total.get(winner) ?? 0) + 1);
  const g = groupOf(row).split(" ")[0]!;
  const f = byField.get(g) ?? new Map<string, number>();
  f.set(winner, (f.get(winner) ?? 0) + 1);
  byField.set(g, f);
});
const worse = new Map<string, number>();
for (const m of fidFlags.matchAll(/(\d+)=([XY])-/g)) {
  const row = key[Number(m[1]) - 1];
  if (!row) throw new Error(`flag on pair ${m[1]}, which does not exist`);
  const a = arm(row, m[2] as "X" | "Y");
  worse.set(a, (worse.get(a) ?? 0) + 1);
}
const fmt = (m: Map<string, number>) => [...m].map(([k, n]) => `${k} ${n}`).join(", ");
console.log(`plainer: ${fmt(total)}`);
for (const [f, m] of byField) console.log(`  ${f}: ${fmt(m)}`);
console.log(`fidelity flags against: ${fmt(worse) || "none"}`);
console.log(`wrote ${out}`);
