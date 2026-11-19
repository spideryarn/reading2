/**
 * **Two calls, one list** — the union of two arm-runs' answers, written as one
 * more arm-run for score.ts to read. Free: no model is called. It asks whether
 * running the same call twice in parallel and merging (production's own folds
 * de-duplicate the rows) catches what one run stops short of.
 *
 *   npx tsx evals/citations-recall/union.ts H2-1 H2-2      # writes 261101a/U-H2-1+H2-2/
 *
 * Dollars add; elapsed time is the longer of the two, since they would run at once.
 */
import fs from "node:fs";
import path from "node:path";
import { OUT, type RawResult } from "./run.js";

const [a, b] = process.argv.slice(2);
if (!a || !b) throw new Error("usage: union.ts <arm-run> <arm-run>");
const dir = path.join(OUT, `U-${a}+${b}`);
fs.mkdirSync(dir, { recursive: true });
for (const file of fs.readdirSync(path.join(OUT, a))) {
  const other = path.join(OUT, b, file);
  if (!fs.existsSync(other)) continue;
  const ra = JSON.parse(fs.readFileSync(path.join(OUT, a, file), "utf8")) as RawResult;
  const rb = JSON.parse(fs.readFileSync(other, "utf8")) as RawResult;
  const ok = (r: RawResult) => r.answer !== null && r.stopReason === "end_turn";
  const works = [ra, rb].filter(ok).flatMap((r) => (JSON.parse(r.answer!) as { works: unknown[] }).works);
  const capped = [ra, rb].filter(ok).some((r) => (JSON.parse(r.answer!) as { capped?: boolean }).capped === true);
  const merged: RawResult = {
    ...ra,
    arm: `U-${a}+${b}`,
    elapsedMs: Math.max(ra.elapsedMs, rb.elapsedMs),
    usage: {
      input: ra.usage.input + rb.usage.input,
      output: ra.usage.output + rb.usage.output,
      cacheRead: ra.usage.cacheRead + rb.usage.cacheRead,
      cacheWrite: ra.usage.cacheWrite + rb.usage.cacheWrite,
    },
    stopReason: [ra, rb].some(ok) ? "end_turn" : ra.stopReason,
    answer: JSON.stringify({ capped, works }),
    dollars: (ra.dollars ?? 0) + (rb.dollars ?? 0),
  };
  fs.writeFileSync(path.join(dir, file), `${JSON.stringify(merged, null, 2)}\n`);
}
console.log(`wrote ${path.relative(process.cwd(), dir)}`);
