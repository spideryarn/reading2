/**
 * **What the authors pass reads off arXiv HTML title blocks, and what it costs.**
 *
 * Fetches each paper's live `arxiv.org/html/<id>`, reads its title block
 * (`latexmlTitleBlock`), runs the PDF path's authors reader over it
 * (`readArxivAffiliations`) and prints the verdict, the affiliations per name
 * and the ledger's cost per paper. Every call is recorded (`collectSpend` with
 * the cost store's sink), as docs/project/cost-tracking.md requires.
 *
 *   npx tsx evals/arxiv-affiliations/measure.ts [--power=standard|high] <arxiv id>...
 *
 * docs/plans/261009m-arxiv-html-affiliations-by-the-authors-pass.md § Measured.
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { collectSpend, formatNanos, totalSpend } from "../../src/ai-spend.js";
import { readArxivAffiliations } from "../../src/arxiv-affiliations.js";
import { loadEnvLocal } from "../../src/env.js";
import { latexmlTitleBlock } from "../../src/latexml.js";
import { modelFor } from "../../src/models.js";
import { environmentOwnerId } from "../../src/owner.js";
import { openRouterAuthorsReader } from "../../src/pdf-authors.js";
import { costStore } from "../../src/store/ai-calls.js";

loadEnvLocal();
const args = process.argv.slice(2);
const power = args.find((a) => a.startsWith("--power="))?.slice("--power=".length) === "high" ? "high" : "standard";
const ids = args.filter((a) => !a.startsWith("--"));
let total = 0n;
let calls = 0;
for (const id of ids) {
  const url = `https://arxiv.org/html/${id}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`${id}: HTTP ${res.status}`);
    continue;
  }
  const doc = new JSDOM(await res.text(), { url: res.url, virtualConsole: new VirtualConsole() }).window.document;
  const block = latexmlTitleBlock(doc);
  if (!block) {
    console.log(`${id}: no title block the names reader accepts — no call`);
    continue;
  }
  const reader = openRouterAuthorsReader(modelFor("pdf-frontmatter", power));
  let verdict: Awaited<ReturnType<typeof readArxivAffiliations>> | Error = new Error("not run");
  const { report } = await collectSpend(
    async () => {
      try {
        verdict = await readArxivAffiliations(block, reader);
      } catch (err) {
        verdict = err as Error;
      }
    },
    { attribution: { scopeKind: "eval", ownerId: environmentOwnerId() }, sink: (row) => costStore.record(row) },
  );
  const spend = totalSpend(report.calls);
  total += BigInt(spend.nanos);
  calls += report.calls.length;
  const { input, output } = reader.usage();
  console.log(`\n${id}: ${block.names.length} names · ${formatNanos(spend.nanos)} · ${input} in / ${output} out`);
  const v = verdict as Awaited<ReturnType<typeof readArxivAffiliations>> | Error;
  if (v instanceof Error) console.log(`  ERROR ${v.message}`);
  else if (v.authors === null) console.log(`  refused: ${v.note}`);
  else for (const a of v.authors) console.log(`  ${a.name} — ${a.affiliations.join(" | ") || "(none)"}`);
}
console.log(`\n${calls} call(s), ${formatNanos(Number(total))} in all, recorded in ${costStore.describe()}`);
