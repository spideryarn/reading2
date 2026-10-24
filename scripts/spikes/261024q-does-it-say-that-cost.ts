/**
 * Spike — **what one "Does it say that?" chat turn costs, and how long it takes**,
 * on real cited works in the LOCAL database. Evidence for
 * docs/plans/261024m-citation-card-streams-a-note-on-what-this-paragraph-cites-the-work-for.md;
 * the write-up is docs/investigations/261024d-does-it-say-that-cost-and-latency.md.
 *
 *   npx tsx scripts/spikes/261024q-does-it-say-that-cost.ts            # all turns
 *   npx tsx scripts/spikes/261024q-does-it-say-that-cost.ts --only 1,2 # some
 *
 * It reproduces what Reader.tsx § `checkCitedWorkInChat` sends — `askAboutBlock`
 * around `askDoesItSayThat`, on a chat anchored to the citing block — and drives
 * `converse` directly with the production tools, as evals/cost/interactions.ts
 * does. Every call lands in `ai_calls` (scope `eval`) through `withLedger`, with
 * the article and owner attributed by `withSpendAttribution`.
 *
 * **What the route adds that this does not**: the reader's profile, the
 * reading-so-far line and the other-conversations section (all in the final
 * user message, after the cache breakpoint, so small), and the `chat-gist`
 * call the route makes after the answer (~$0.0003 on production). Writes
 * nothing to the database except ledger rows: no thread, no message.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { currentSpend, totalSpend, withSpendAttribution, type SpendRecord } from "../../src/ai-spend.js";
import { withLedger } from "../../src/cli-ledger.js";
import { converse } from "../../src/converse.js";
import { loadEnvLocal } from "../../src/env.js";
import { articlePower } from "../../src/models.js";
import { environmentOwnerId, type OwnerId, runAsOwner } from "../../src/owner.js";
import { loadArticle, loadBibliography } from "../../src/store/index.js";
import { askAboutBlock, askDoesItSayThat } from "../../src/web/chat-handoff.js";
import { localTarget } from "../../evals/cost/harness.js";

interface Turn {
  n: number;
  slug: string;
  workId: string;
  blockId: string;
  kind: string;
}

/* In this order on purpose: each article's first turn is its cold touch and the
   turn(s) after it, seconds later, read the same article prefix warm. */
const TURNS: Turn[] = [
  { n: 1, slug: "scaling-hypothesis", workId: "spya-ujg0my", blockId: "spya-vn0xpd", kind: "arXiv (GPT-3 paper)" },
  { n: 2, slug: "scaling-hypothesis", workId: "spya-qtag4v", blockId: "spya-kc39vs", kind: "arXiv (MMLU)" },
  { n: 3, slug: "spider-silk-spya-ge30uz", workId: "spya-q9t6qb", blockId: "spya-ns50b2", kind: "DOI, open access (PLOS ONE)" },
  { n: 4, slug: "spider-silk-spya-ge30uz", workId: "spya-e8q3yb", blockId: "spya-ns50b2", kind: "DOI, paywalled (ACS 1994)" },
  { n: 5, slug: "antikythera-mechanism-spya-zhxrzm", workId: "spya-yncs0r", blockId: "spya-qdcw90", kind: "DOI, paywalled (Hesperia)" },
  { n: 6, slug: "antikythera-mechanism-spya-zhxrzm", workId: "spya-c6pcvs", blockId: "", kind: "book, no identifier" },
  { n: 7, slug: "antikythera-mechanism-spya-zhxrzm", workId: "spya-sdfbgd", blockId: "spya-ejygfx", kind: "arXiv (2022)" },
];

interface CallRow {
  model: string;
  usd: number | null;
  input: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  output: number | null;
  reasoning: number | null;
  webSearches: number | null;
}

function callRow(c: SpendRecord): CallRow {
  const { nanos, unpriced } = totalSpend([c]);
  return {
    model: c.model,
    usd: unpriced > 0 ? null : Number(nanos) / 1e9,
    input: c.inputTokens,
    cacheRead: c.cacheReadTokens,
    cacheWrite: c.cacheWriteTokens,
    output: c.outputTokens,
    reasoning: c.reasoningTokens,
    webSearches: c.webSearches,
  };
}

async function runTurn(t: Turn, owner: OwnerId) {
  const article = await loadArticle(t.slug);
  const { bibliography } = await loadBibliography(t.slug);
  const work = bibliography.citations.find((w) => w.id === t.workId);
  if (!work) throw new Error(`${t.slug}: no work ${t.workId}`);
  const blockId = t.blockId || work.citedAt[0];
  if (!blockId || !article.blocks.some((b) => b.id === blockId)) {
    throw new Error(`${t.slug}: block ${blockId} not in the article`);
  }
  const question = askAboutBlock({
    blockId,
    question: askDoesItSayThat({
      title: work.title,
      ...(work.authors ? { authors: work.authors } : {}),
      ...(work.year ? { year: work.year } : {}),
    }),
  });

  const before = currentSpend()?.calls.length ?? 0;
  const started = Date.now();
  let firstDeltaMs: number | null = null;
  /* When each event arrived, so a delta stream that bunches up at the end is visible. */
  const timeline: string[] = [];
  let deltas = 0;
  let lastDeltaMs = 0;
  let text = "";
  const tools = new Map<number, { name: string; detail?: string; status: string; ms?: number }>();
  let searches = 0;
  let error: string | undefined;
  try {
    await withSpendAttribution({ articleSlug: t.slug, ownerId: owner }, async () => {
      for await (const ev of converse({
        power: articlePower(article.highPowerSince),
        meta: article.meta,
        blocks: article.blocks,
        history: [],
        question,
        slug: t.slug,
        kind: "chat",
        anchor: { blockId },
        profile: null,
      })) {
        if (ev.type === "delta") {
          if (firstDeltaMs === null && ev.text.trim() !== "") firstDeltaMs = Date.now() - started;
          text += ev.text;
          deltas += 1;
          lastDeltaMs = Date.now() - started;
          if (deltas === 1 || deltas % 25 === 0) timeline.push(`${lastDeltaMs}ms delta#${deltas} (${text.length} chars)`);
        } else if (ev.type === "tool") {
          timeline.push(`${Date.now() - started}ms tool ${ev.run.name} ${ev.run.status}`);
          tools.set(ev.index, {
            name: ev.run.name,
            status: ev.run.status,
            ...(ev.run.detail ? { detail: ev.run.detail } : {}),
            ...(ev.run.ms !== undefined ? { ms: ev.run.ms } : {}),
          });
        } else if (ev.type === "done") {
          searches = ev.searches;
          text = ev.text;
        }
      }
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const totalMs = Date.now() - started;
  const calls = (currentSpend()?.calls ?? []).slice(before).map(callRow);
  const priced = calls.every((c) => c.usd !== null);
  const usd = calls.reduce((s, c) => s + (c.usd ?? 0), 0);
  return {
    n: t.n,
    slug: t.slug,
    kind: t.kind,
    work: { id: work.id, title: work.title, authors: work.authors, year: work.year, key: work.key },
    blockId,
    question,
    firstDeltaMs,
    lastDeltaMs,
    deltas,
    timeline,
    totalMs,
    usd,
    priced,
    calls,
    tools: [...tools.values()],
    searches,
    chars: text.length,
    words: text.split(/\s+/).filter(Boolean).length,
    head: text.slice(0, 300),
    answer: text,
    ...(error ? { error } : {}),
  };
}

async function main() {
  console.log(`Target: ${localTarget(process.env.DATABASE_URL)}`);
  const owner = environmentOwnerId();
  const onlyArg = process.argv.indexOf("--only");
  const only = onlyArg > 0 ? new Set((process.argv[onlyArg + 1] ?? "").split(",").map(Number)) : null;
  const results = [];
  for (const t of TURNS) {
    if (only && !only.has(t.n)) continue;
    const r = await runTurn(t, owner);
    results.push(r);
    console.log(
      `#${r.n} ${r.kind}: $${r.usd.toFixed(4)}${r.priced ? "" : " (some unpriced)"} ` +
        `first ${r.firstDeltaMs}ms total ${r.totalMs}ms, ${r.calls.length} calls, ` +
        `tools ${r.tools.map((x) => `${x.name}[${x.status}]`).join(",") || "-"}, ${r.searches} searches, ` +
        `${r.words} words${r.error ? ` ERROR ${r.error}` : ""}`,
    );
  }
  /* Gitignored: it holds the answers, which quote the article and the paper. */
  await mkdir("output/261024q-does-it-say-that", { recursive: true });
  const out = process.env.OUT ?? "output/261024q-does-it-say-that/results.json";
  await writeFile(out, JSON.stringify(results, null, 2));
  console.log(`Wrote ${out}`);
}

loadEnvLocal();
await withLedger("eval", () => runAsOwner(environmentOwnerId(), main));
