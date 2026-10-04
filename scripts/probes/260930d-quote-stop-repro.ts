/**
 * **What did the model put in quotation marks?** — a one-off repro for a quote
 * guard stop seen in a real browser press of Citations' *Investigate*
 * (docs/plans/260930d-citations-one-button-look-it-up-and-investigate-merged.md).
 * The production log line carries only the stop's cause, never the span, so
 * this rebuilds EXACTLY the production request and allowed texts for one row
 * and replays the reading step, keeping the raw model text the guard never
 * released.
 *
 *   npx tsx scripts/probes/260930d-quote-stop-repro.ts list <slug>
 *   npx tsx scripts/probes/260930d-quote-stop-repro.ts run <slug>:<id> [<slug>:<id> ...]
 *
 * READ ONLY against the local store (the loading is the 260930a investigate probe's, since deleted).
 * The request, the allowed texts and the matched page come from the exported
 * functions `prepare()` in src/citation-investigate.ts uses; the call goes
 * through `runStream` under job `citation-investigate`, profile null. The
 * *Look it up* first step is NOT re-run: the row's stored lookup/find is used
 * as it stands, which is what the reading step saw after a no-match.
 *
 * Budget: stops before a call once $0.80 has been spent.
 */
import { loadEnvLocal } from "../../src/env.js";
import { environmentOwnerId, runAsOwner } from "../../src/owner.js";
import { citationFindStore, loadArticle, loadCitations } from "../../src/store/index.js";
import { closeDb } from "../../src/db/client.js";
import { modelFor } from "../../src/models.js";
import { runStream } from "../../src/stream-run.js";
import {
  INVESTIGATE_STALL_MS,
  INVESTIGATE_TIMEOUT_MS,
  allowedQuoteTexts,
  investigateRequest,
} from "../../src/citation-investigate.js";
import { investigateContext, matchedPageOf } from "../../src/citation-investigate-context.js";
import { createQuoteGuard } from "../../src/investigate-quote-guard.js";

const BUDGET = 0.8;

async function oneRun(slug: string, id: string): Promise<number> {
  const { citations } = await loadCitations(slug);
  const current = citations.citations.find((w) => w.id === id);
  if (!current) throw new Error(`no citation ${id} in ${slug}`);
  const { investigation: _earlier, ...work } = current;
  const article = await loadArticle(slug);
  const text = new Map(article.blocks.map((b) => [b.id as string, b.text]));
  const context = investigateContext(work, (bid) => text.get(bid));
  const matched = matchedPageOf(work, work.lookup ? await citationFindStore.load(slug, id) : null);
  const model = modelFor("citation-investigate", "standard");
  const request = investigateRequest({ meta: article.meta, blocks: article.blocks, context, profile: null, matched, model });
  const allowed = allowedQuoteTexts(article.blocks, context, matched);

  console.log(`\n==================== ${slug}:${id} ====================`);
  console.log(`title:     ${JSON.stringify(context.title)}`);
  console.log(`authors:   ${JSON.stringify(context.authors)}`);
  console.log(`year:      ${JSON.stringify(context.year)}`);
  console.log(`reference: ${JSON.stringify(context.reference)}`);
  console.log(`linkFrom:  ${context.linkFrom}  url: ${context.url}`);
  console.log(`lookup:    ${work.lookup?.state ?? "none"}  matched: ${matched ? matched.url : "null"}`);

  const guard = createQuoteGuard(allowed);
  let raw = "";
  let released = "";
  let stop: { cause: string; at: number } | null = null;
  let cost = 0;
  let end: { evidence: { url: string; title?: string | null }[] | null; finish: string | null; model: string } | null =
    null;
  for await (const event of runStream({
    job: "citation-investigate",
    request,
    timeoutMs: INVESTIGATE_TIMEOUT_MS,
    stallMs: INVESTIGATE_STALL_MS,
    collectEvidence: true,
  })) {
    if (event.type === "end") {
      cost = typeof (event.usage as { cost?: number } | undefined)?.cost === "number" ? (event.usage as { cost: number }).cost : 0;
      end = {
        evidence: (event.evidence ?? []) as { url: string; title?: string | null }[],
        finish: event.finishReason,
        model: event.model,
      };
      /* The raw text in full, even after a stop — the whole point. */
      raw = event.text;
      continue;
    }
    if (stop) continue; // keep draining so the full raw text and the evidence arrive
    const before = raw.length;
    raw += event.text;
    const step = guard.push(event.text);
    released += step.text;
    if (!step.ok) stop = { cause: step.cause, at: before + event.text.length };
  }
  if (!stop && end) {
    const last = guard.end();
    released += last.text;
    if (!last.ok) stop = { cause: `${last.cause} (at end)`, at: raw.length };
  }

  console.log(`model: ${end?.model}  finish: ${end?.finish}  cost: $${cost.toFixed(4)}`);
  console.log(`result titles (evidence):`);
  for (const e of end?.evidence ?? []) console.log(`  - ${JSON.stringify(e.title ?? null)}  <${e.url}>`);
  if (stop) {
    /* Everything pushed but not released is exactly what the guard held. */
    const held = raw.slice(released.length, stop.at);
    console.log(`STOPPED: cause=${stop.cause}`);
    console.log(`HELD SPAN: ${JSON.stringify(held)}`);
  } else {
    console.log(`NOT STOPPED`);
  }
  console.log(`----- raw model text -----\n${raw}\n----- end raw -----`);
  return cost;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const [mode, ...args] = process.argv.slice(2);
  await runAsOwner(environmentOwnerId(), async () => {
    if (mode === "list") {
      const slug = args[0];
      if (!slug) throw new Error("list <slug>");
      const { citations } = await loadCitations(slug);
      for (const c of citations.citations)
        console.log(`${c.id}\t${c.linkFrom}\t${c.lookup?.state ?? "-"}\t${c.title}\t| ${c.authors ?? ""} | ${c.year ?? ""}`);
      return;
    }
    if (mode !== "run") throw new Error("mode: list | run");
    let spent = 0;
    for (const arg of args) {
      if (spent >= BUDGET) {
        console.log(`budget of $${BUDGET} reached; stopping`);
        break;
      }
      const [slug, id] = arg.split(":");
      if (!slug || !id) throw new Error(`bad arg ${arg}`);
      spent += await oneRun(slug, id);
      console.log(`spent so far $${spent.toFixed(4)}`);
    }
  });
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
