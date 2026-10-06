import { readFileSync } from "node:fs";
import { PHRASES } from "../../phrases.js";

type R = { phrase: string; pick: string | null; confidence: number | null };
const load = (f: string): Map<string, R> => new Map((JSON.parse(readFileSync(new URL(f, import.meta.url), "utf8")) as R[]).map((r) => [r.phrase, r]));
const norm = (s: string | null): string => (s ?? "-").replace(/remember/g, "learn");
const b4 = load("../261004/jev-pick.json");
const b3 = load("../261003/jev-pick.json");
const a1 = load("run1-jev-pick.json");
const a2 = load("run2-jev-pick.json");
const f = (r: R | undefined): string => (r ? `${norm(r.pick)} ${r.confidence?.toFixed(2)}` : "?");
let ok = [0, 0, 0, 0];
const ids = [...a1.keys()];
for (const id of ids) {
  const p = PHRASES.find((x) => x.id === id)!;
  const hit = (r: R | undefined): boolean => !!r && p.accept.includes(norm(r.pick)) ;
  [b3.get(id), b4.get(id), a1.get(id), a2.get(id)].forEach((r, i) => { if (hit(r)) ok[i]!++; });
  const ps = [b3.get(id), b4.get(id), a1.get(id), a2.get(id)].map((r) => norm(r?.pick ?? null));
  const flag = new Set(ps).size > 1 ? "  CHANGED" : "";
  console.log(`${id} [${p.accept.join("|")}] "${p.text}"\n   0903: ${f(b3.get(id))} | 0904: ${f(b4.get(id))} | now1: ${f(a1.get(id))} | now2: ${f(a2.get(id))}${flag}`);
}
console.log("right (0903, 0904, now1, now2) of", ids.length, ok.join(", "));
const learnIds = ids.filter((id) => PHRASES.find((x) => x.id === id)!.accept.some((a) => a.includes("learn")));
console.log("learn-accepting:", learnIds.join(","));
let w = [0, 0, 0, 0];
for (const id of learnIds) { const p = PHRASES.find((x) => x.id === id)!; [b3.get(id), b4.get(id), a1.get(id), a2.get(id)].forEach((r, i) => { if (r && p.accept.includes(norm(r.pick))) w[i]!++; }); }
console.log("learn-accepting right", w.join(", "), "of", learnIds.length);
