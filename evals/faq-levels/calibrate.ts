/**
 * **Where the FAQ's bar should start.** Free: reads the `after` arms written by
 * run.ts and prints, for each candidate bar, the share of questions shown —
 * per article, and averaged over a calibration half and a held-out half.
 *
 *   npx tsx evals/faq-levels/calibrate.ts
 *
 * The target is predeclared in the plan (260929g § Stage 1, F10): **at least
 * 80% shown on average** — Greg, 2026-09-12, *"most of the entries are coming
 * in by default"*, with the Glossary's 87% as the reference. Chosen on the
 * calibration half, then checked on the held-out half.
 */
import fs from "node:fs";
import path from "node:path";
import { visibleQuestions } from "../../src/web/faq-order.js";

const OUT = path.join(import.meta.dirname, "..", "results", "faq-levels");
const CALIBRATION = ["entropy-24-00930-spya-pywwkq", "noema-mythology-of-conscious-ai", "spider-silk-spya-ge30uz"];
const CANDIDATES = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3];

interface ArmFile {
  slug: string;
  questions: { difficulty?: number; centrality?: number }[];
}

const files: (ArmFile & { arm: string })[] = [];
for (const arm of ["after", "after-2"]) {
  for (const f of fs.readdirSync(path.join(OUT, arm)).filter((n) => n.endsWith(".json"))) {
    files.push({ arm, ...(JSON.parse(fs.readFileSync(path.join(OUT, arm, f), "utf8")) as ArmFile) });
  }
}

const share = (f: ArmFile, bar: number) => visibleQuestions(f.questions, bar).visible.length / f.questions.length;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

console.log(`bar   calibration  held-out   (share shown, mean over ${files.length} lists)`);
for (const bar of CANDIDATES) {
  const cal = files.filter((f) => CALIBRATION.includes(f.slug)).map((f) => share(f, bar));
  const held = files.filter((f) => !CALIBRATION.includes(f.slug)).map((f) => share(f, bar));
  const min = Math.min(...files.map((f) => share(f, bar)));
  console.log(
    `${bar.toFixed(2)}  ${(mean(cal) * 100).toFixed(0).padStart(5)}%      ${(mean(held) * 100).toFixed(0).padStart(5)}%    lowest single list ${(min * 100).toFixed(0)}%`,
  );
}
