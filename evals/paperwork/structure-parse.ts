/**
 * **Does the `toc/10` structure prompt fail to parse more often than `toc/9`?**
 * docs/plans/261001p-summaries-skip-the-paperwork-and-lead-with-the-takeaway.md § Ledger.
 *
 * ```
 * npx tsx evals/paperwork/structure-parse.ts --label <label> --draws <n> <slug>...   # paid
 * npx tsx evals/paperwork/structure-parse.ts tally                                   # free
 * ```
 *
 * Only the whole-document structure call, `draws` times per article, parsed
 * with production's own `parseJsonAnswer` (what src/hierarchy.ts § `parseJson`
 * calls). Each answer is one line in `evals/results/paperwork/structure-parse/<label>.jsonl`
 * — the stamp it was sent under, ok or the parse error — and a failure's raw
 * answer is kept beside it. Like evals/paperwork/run.ts the arms are separated
 * in time: run a label on the commit whose prompt it measures.
 */

import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../../src/env.js";

const OUT = path.join(import.meta.dirname, "..", "results", "paperwork", "structure-parse");

async function run(label: string, draws: number, slugs: string[]): Promise<void> {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const { structureRequest } = await import("../../src/hierarchy.js");
  const { PROMPT_VERSION } = await import("../../src/hierarchy-prompt.js");
  const { splitBlocks } = await import("../../src/supplement.js");
  const { streamMessage } = await import("../../src/messages-stream.js");
  const { parseJsonAnswer } = await import("../../src/parse-json.js");
  const { closeDb } = await import("../../src/db/client.js");
  fs.mkdirSync(OUT, { recursive: true });
  const log = path.join(OUT, `${label}.jsonl`);
  await runAsOwner(environmentOwnerId(), async () => {
    await Promise.all(
      slugs.map(async (slug) => {
        const article = await loadArticle(slug);
        const { params } = structureRequest(splitBlocks(article.blocks).body);
        for (let i = 0; i < draws; i++) {
          let row: Record<string, unknown> = { label, toc: PROMPT_VERSION, slug, draw: i, at: new Date().toISOString() };
          try {
            const message = await streamMessage("hierarchy", params, { power: "standard" }).finalMessage();
            const raw = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
            try {
              parseJsonAnswer<{ root: unknown }>(raw, "structure answer");
              row = { ...row, ok: true, stop: message.stop_reason };
            } catch (err) {
              const kept = path.join(OUT, `${label}-${slug}-${i}.raw.txt`);
              fs.writeFileSync(kept, raw);
              row = { ...row, ok: false, parse: true, stop: message.stop_reason, error: String(err), kept: path.basename(kept) };
            }
          } catch (err) {
            row = { ...row, ok: false, parse: false, error: String(err) };
          }
          fs.appendFileSync(log, `${JSON.stringify(row)}\n`);
          console.log(`${label} ${slug} #${i}: ${row.ok ? "ok" : `FAILED ${row.parse ? "parse" : "call"}`}`);
        }
      }),
    );
  });
  await closeDb();
}

function tally(): void {
  for (const f of fs.readdirSync(OUT).filter((x) => x.endsWith(".jsonl")).sort()) {
    const rows = fs.readFileSync(path.join(OUT, f), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { ok: boolean; parse?: boolean; toc: string });
    const parsed = rows.filter((r) => r.ok || r.parse);
    const bad = rows.filter((r) => !r.ok && r.parse).length;
    console.log(`${f}: ${rows[0]?.toc}: ${bad} parse failures in ${parsed.length} answers (${rows.length - parsed.length} calls that failed before an answer, not counted)`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args[0] === "tally") {
    tally();
  } else {
    const at = (name: string) => args[args.indexOf(name) + 1];
    const label = args.includes("--label") ? at("--label") : undefined;
    const draws = Number(args.includes("--draws") ? at("--draws") : "1");
    const slugs = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
    if (!label || slugs.length === 0 || !(draws > 0)) throw new Error("--label <label> --draws <n> <slug>...  |  tally");
    await run(label, draws, slugs);
  }
}
