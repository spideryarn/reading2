import { readFileSync } from "node:fs";
type R = { phrase: string; pick: string | null; confidence: number | null };
const L = (f: string) => new Map((JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8")) as R[]).map((r) => [r.phrase, r]));
const b = L("../261004/jev-pick.json"), a1 = L("run1-jev-pick.json"), a2 = L("run2-jev-pick.json");
let m12 = 0, m1b = 0, m2b = 0;
let w = "";
for (const [id, r] of a1) {
  const c1 = r.confidence ?? 0, c2 = a2.get(id)?.confidence ?? 0, c0 = b.get(id)?.confidence ?? 0;
  m12 = Math.max(m12, Math.abs(c1 - c2));
  m1b = Math.max(m1b, Math.abs(c1 - c0));
  m2b = Math.max(m2b, Math.abs(c2 - c0));
  if (Math.max(Math.abs(c1 - c0), Math.abs(c2 - c0)) > 0.1) w += ` ${id}:${Math.abs(c1 - c0).toFixed(2)}/${Math.abs(c2 - c0).toFixed(2)}`;
}
console.log("max |run1-run2|", m12.toFixed(2), "max |run1-1004|", m1b.toFixed(2), "max |run2-1004|", m2b.toFixed(2), "over 0.1 vs 1004:", w);
