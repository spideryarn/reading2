/**
 * **Each arm's authors against today's, name by name**, from a `measure.ts`
 * results file: same, different (both printed), or only one side has a list.
 *
 *   npx tsx evals/front-matter/compare.ts <results.json>
 */
import { readFileSync } from "node:fs";
import type { Author } from "../../src/types.js";

type Row = { input: { name: string }; today?: Author[] | null; skipped?: boolean; error?: string } & Record<string, unknown>;
const rows = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as Row[];
const fmt = (a: Author) => `${a.name}${a.affiliations.length ? ` — ${a.affiliations.join(" | ")}` : ""}`;
const keys = [...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => /^(haiku|deepseek)(#\d+)?$/u.test(k))))].sort();
for (const arm of keys) {
  console.log(`\n# ${arm}`);
  for (const row of rows) {
    if (row.error || row.skipped) continue;
    const v = row[arm] as { authors?: Author[] | null; note?: string; error?: string } | undefined;
    if (!v) continue;
    /* What import would store: the arm's list, or the declared names alone when it refused. */
    const declared = row.declaredNames as string[] | null | undefined;
    const got = v.authors ?? (declared?.length ? declared.map((name) => ({ name, affiliations: [] })) : null);
    const today = row.today ?? null;
    let verdict: string;
    if (!got && !today) verdict = "both none";
    else if (!got) verdict = `ARM NONE (before had ${today!.length}): ${v.note ?? v.error}`;
    else if (!today) verdict = `ARM ONLY: ${got.map(fmt).join(" ; ")}`;
    else {
      const diffs = got
        .map((a, i) => (today[i] && fmt(today[i]!) === fmt(a) ? null : `  arm: ${fmt(a)}\n  today: ${today[i] ? fmt(today[i]!) : "(missing)"}`))
        .filter(Boolean);
      verdict = got.length !== today.length ? `LENGTH ${got.length} vs ${today.length}` : diffs.length ? `DIFF${v.authors ? "" : ` (refused: ${v.note ?? v.error})`}\n${diffs.join("\n")}` : "same";
    }
    console.log(`${row.input.name}: ${verdict}`);
  }
}
