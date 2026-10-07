/**
 * **Stage-3 probe for *Investigate reads the cited paper*** —
 * docs/plans/261001a-citations-read-the-cited-paper-and-a-shared-bibliographic-lookup.md
 * § Stage 3. A measurement, not the build: nothing in `src/` imports this.
 *
 *   npx tsx scripts/probes/261001a-paper-read-probe.ts [--paid] [--slug <slug>]... [--works <n>]
 *
 * **Free part (always).** Walks the local articles (owner-scoped, as
 * 260930a's probe does) for Citations rows the paper read can aim at: a DOI or
 * arXiv link, or a stored quick-check match (a current *Look it up* page). For
 * up to `--works` of them (default 12, mixed across arXiv / DOI / matched
 * page), runs `readPaperEvidence` with the real `lookupWork` — the very pair
 * `readCitedPaper` wires in the composition root — and prints one row each:
 * state, how it matched, words, chunks, ms, the registry's answer, and the
 * process's peak RSS after the read.
 *
 * **Paid part (`--paid` only).** Up to 5 of those works (one arXiv, one DOI
 * that was read, one DOI that was not, one matched-page row, then anything
 * read), each through the real `makeInvestigateCitation` press — real reader,
 * real paper read, real passages call, real stream and quote guard — with
 * these substitutions so that **the press saves no investigation, find or
 * allowance row**:
 *
 * - `investigations` records the answer instead of saving it;
 * - `finds` keeps a *Look it up* find in memory (and the reader overlays its
 *   `lookup` onto the row), instead of saving it;
 * - `allowance` always allows, and frees nothing (no `fetch_allowance` row);
 * - the spend collector writes each call to the ledger (`ai_calls`, `eval`
 *   scope, the environment owner) — an eval's spend is refused without one —
 *   and the cost printed is read from the collector's own records.
 *
 * The write shared by both parts is stage 1's registry cache
 * (`lookupWork` caches its Crossref/DataCite answers), which is the real
 * dependency and is what a reader's press would write too.
 *
 * Budget: the paid part stops before a press once $2.50 is spent, and after
 * any press that cost more than $0.60.
 *
 * No article prose is printed. The paid part prints the start of each kept
 * paper passage and the first 300 characters of each answer.
 */
import { lookupWork, type LookupResult } from "../../src/bibliographic.js";
import { type AiRequestBody, type JsonCall, openRouterJson } from "../../src/ai-call.js";
import { collectSpend, formatNanos, totalSpend, type SpendRecord } from "../../src/ai-spend.js";
import {
  allowedQuoteTexts,
  type InvestigateCitationDeps,
  type InvestigateEvent,
  makeInvestigateCitation,
  readCitedPaper,
} from "../../src/citation-investigate.js";
import { investigateContext, matchedPageOf, type MatchedPage } from "../../src/citation-investigate-context.js";
import { keepVerified, readPassagesAnswer } from "../../src/citation-paper-passages.js";
import { closeDb } from "../../src/db/client.js";
import { loadEnvLocal } from "../../src/env.js";
import { createQuoteGuard } from "../../src/investigate-quote-guard.js";
import { CITATION_INVESTIGATE_QUOTED } from "../../src/messages.js";
import { environmentOwnerId, runAsOwner } from "../../src/owner.js";
import {
  type PaperEvidence,
  type PaperEvidenceInput,
  paperAddress,
  readPaperEvidence,
} from "../../src/paper-evidence.js";
import { runStream, type StreamRun, type StreamRunEvent } from "../../src/stream-run.js";
import { costStore } from "../../src/store/ai-calls.js";
import { citationFindStore, listArticles, loadArticle, loadCitations } from "../../src/store/index.js";
import type { CitationFind, CitationsFound, CitedWork, PaperPassage } from "../../src/types.js";

const DEFAULT_WORKS = 12;
const PAID_WORKS = 5;
const BUDGET_USD = 2.5;
const PER_PRESS_STOP_USD = 0.6;

/* ------------------------------------------------------------------ args -- */

interface Args {
  paid: boolean;
  slugs: string[];
  works: number;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { paid: false, slugs: [], works: DEFAULT_WORKS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--paid") args.paid = true;
    else if (a === "--slug") {
      const s = argv[++i];
      if (!s) throw new Error("--slug needs a value");
      args.slugs.push(s);
    } else if (a === "--works") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1) throw new Error("--works needs a positive integer");
      args.works = n;
    } else throw new Error(`unknown argument ${a}; usage: [--paid] [--slug <slug>]... [--works <n>]`);
  }
  return args;
}

/* ------------------------------------------------------------ candidates -- */

type Bucket = "arxiv" | "doi" | "matched-page";

interface Candidate {
  slug: string;
  work: CitedWork;
  matched: MatchedPage | null;
  bucket: Bucket;
}

async function candidatesOf(slug: string): Promise<Candidate[]> {
  let found: CitationsFound;
  try {
    found = await loadCitations(slug);
  } catch {
    return []; // no citations list
  }
  const out: Candidate[] = [];
  for (const work of found.citations.citations) {
    const hasLookup = work.lookup?.state === "assessed" || work.lookup?.state === "unreadable";
    const matched = hasLookup ? matchedPageOf(work, await citationFindStore.load(slug, work.id)) : null;
    const address = paperAddress(work.url, matched?.url ?? null);
    if (!address) continue;
    out.push({ slug, work, matched, bucket: address.from });
  }
  return out;
}

/** Up to `n`, round-robin over the three buckets, so one article's forty DOIs do not crowd out the rest. */
function pick(all: readonly Candidate[], n: number): Candidate[] {
  const buckets: Candidate[][] = (["arxiv", "doi", "matched-page"] as const).map((b) => all.filter((c) => c.bucket === b));
  /* Within a bucket, alternate articles too. */
  const spread = buckets.map((list) => {
    const bySlug = new Map<string, Candidate[]>();
    for (const c of list) bySlug.set(c.slug, [...(bySlug.get(c.slug) ?? []), c]);
    const queues = [...bySlug.values()];
    const out: Candidate[] = [];
    while (queues.some((q) => q.length > 0)) for (const q of queues) if (q.length > 0) out.push(q.shift() as Candidate);
    return out;
  });
  const chosen: Candidate[] = [];
  while (chosen.length < n && spread.some((l) => l.length > 0)) {
    for (const l of spread) {
      if (chosen.length >= n) break;
      const c = l.shift();
      if (c) chosen.push(c);
    }
  }
  return chosen;
}

/* ------------------------------------------------------------- free part -- */

interface FreeRow {
  c: Candidate;
  evidence: PaperEvidence;
  registry: string;
  ms: number;
  maxRssMb: number;
}

function registryWords(result: LookupResult | null, row: CitedWork): string {
  const asked = result === null ? "not asked" : result.kind === "unavailable" ? `unavailable (${result.why})` : result.kind;
  return `${asked}; row: ${row.registry?.kind ?? "—"}`;
}

async function contextFor(slug: string, work: CitedWork) {
  const article = await loadArticle(slug);
  const text = new Map(article.blocks.map((b) => [b.id as string, b.text]));
  return { article, context: investigateContext(work, (id) => text.get(id)) };
}

async function freeRead(c: Candidate): Promise<FreeRow> {
  const { context } = await contextFor(c.slug, c.work);
  let asked: LookupResult | null = null;
  const started = Date.now();
  const evidence = await readPaperEvidence(
    { work: context, matchedPageUrl: c.matched?.url ?? null },
    {
      /* The real lookup, as `readCitedPaper` hands it over; wrapped only to see its answer. */
      lookup: async (id) => {
        asked = await lookupWork(id);
        return asked;
      },
    },
  );
  const ms = Date.now() - started;
  return { c, evidence, registry: registryWords(asked, c.work), ms, maxRssMb: process.resourceUsage().maxRSS / 1024 };
}

function cell(v: string | number | null | undefined): string {
  return v === null || v === undefined ? "—" : String(v).replace(/\|/g, "/");
}

function freeTable(rows: readonly FreeRow[]): string {
  const lines = [
    `| # | slug | entry | linkFrom | address | host | state | why / matchedBy | words | sent | chunks (sel/all) | refs cut | registry | ms | peak RSS MB |`,
    `|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`,
  ];
  rows.forEach((r, i) => {
    const e = r.evidence;
    const host = "host" in e ? e.host : null;
    const detail =
      e.state === "read"
        ? e.matchedBy
        : e.state === "unreadable" || e.state === "not-confirmed"
          ? e.why
          : e.state === "identity-conflict"
            ? `registry: ${e.registryTitle.slice(0, 50)}`
            : null;
    lines.push(
      `| ${i + 1} | ${cell(r.c.slug.slice(0, 32))} | ${r.c.work.id} | ${r.c.work.linkFrom} | ${r.c.bucket} | ${cell(host)} | ${e.state} | ${cell(detail)} | ${e.state === "read" ? e.words : "—"} | ${e.state === "read" ? e.sentWords : "—"} | ${e.state === "read" ? `${e.selected.length}/${e.chunks.length}` : "—"} | ${e.state === "read" ? (e.referencesCut ? "y" : "n") : "—"} | ${cell(r.registry)} | ${r.ms} | ${r.maxRssMb.toFixed(0)} |`,
    );
  });
  return lines.join("\n");
}

/* ------------------------------------------------------------- paid part -- */

/** One of each kind the plan cares about first, then anything that was read. */
function choosePaid(rows: readonly FreeRow[]): FreeRow[] {
  const chosen: FreeRow[] = [];
  const take = (pred: (r: FreeRow) => boolean) => {
    const r = rows.find((x) => !chosen.includes(x) && pred(x));
    if (r && chosen.length < PAID_WORKS) chosen.push(r);
  };
  take((r) => r.c.bucket === "arxiv" && r.evidence.state === "read");
  if (chosen.length === 0) take((r) => r.c.bucket === "arxiv");
  take((r) => r.c.bucket === "doi" && r.evidence.state === "read");
  take((r) => r.c.bucket === "doi" && r.evidence.state !== "read");
  take((r) => r.c.work.linkFrom === "search" && r.c.matched !== null);
  take((r) => r.c.bucket === "matched-page");
  while (chosen.length < PAID_WORKS) {
    const before = chosen.length;
    take((r) => r.evidence.state === "read");
    if (chosen.length === before) break;
  }
  return chosen;
}

interface PaidRow {
  c: Candidate;
  paperState: string;
  passagesCall: string;
  kept: PaperPassage[];
  offered: number | null;
  dropped: number | null;
  ending: string;
  costs: { job: string; cost: string; ms: number }[];
  total: string;
  totalNanos: number;
  unpriced: number;
  firstTokenMs: number | null;
  streamMs: number | null;
  pressMs: number;
  answer: string;
}

/** The guard's cause, which the press only logs: the same guard, re-run over the same raw deltas. */
function guardCause(allowed: readonly string[], deltas: readonly string[]): string {
  const guard = createQuoteGuard(allowed);
  for (const d of deltas) {
    const step = guard.push(d);
    if (!step.ok) return step.cause;
  }
  const last = guard.end();
  return last.ok ? "guard passes on replay (?)" : last.cause;
}

async function paidPress(c: Candidate): Promise<PaidRow> {
  /* In-memory finds: a *Look it up* the press runs first is kept here, not saved. */
  const memoryFinds = new Map<string, CitationFind>();
  const key = (slug: string, id: string) => `${slug}\u0000${id}`;
  const overlay = async (slug: string): Promise<CitationsFound> => {
    const found = await loadCitations(slug);
    const rows = found.citations.citations.map((w) => {
      const f = memoryFinds.get(key(slug, w.id));
      return f?.lookup ? { ...w, lookup: f.lookup } : w;
    });
    return { ...found, citations: { ...found.citations, citations: rows } };
  };

  let evidence: PaperEvidence | null = null;
  let passagesJson: JsonCall | null = null;
  let passagesError: string | null = null;
  let saved: string | null = null;
  const rawDeltas: string[] = [];
  let streamStarted: number | null = null;
  let firstTokenMs: number | null = null;
  let streamEnd: Extract<StreamRunEvent, { type: "end" }> | null = null;
  let streamEndedAt: number | null = null;

  const deps: InvestigateCitationDeps = {
    reader: { loadCitations: overlay, loadArticle },
    finds: {
      load: async (slug, id) => memoryFinds.get(key(slug, id)) ?? citationFindStore.load(slug, id),
      save: async (slug, id, find) => {
        memoryFinds.set(key(slug, id), find);
      },
    },
    investigations: {
      save: async (_slug, _id, investigation) => {
        saved = investigation.answer;
      },
    },
    allowance: {
      take: async () => ({ kind: "allowed", id: "probe-261001a" }),
      finish: async () => {},
    },
    /* Since plan 261001p stage 2 a press searches the reader's library too.
       This probe is about the paper, so it searches none. */
    library: async () => ({ hits: [] }),
    readPaper: async (input: PaperEvidenceInput) => {
      evidence = await readCitedPaper(input);
      return evidence;
    },
    passagesCall: async (body: AiRequestBody, options: { signal: AbortSignal }) => {
      try {
        passagesJson = await openRouterJson("citation-paper-passages", body, options);
        return passagesJson;
      } catch (err) {
        passagesError = err instanceof Error ? err.name : "unknown";
        throw err;
      }
    },
    run: async function* (args: StreamRun) {
      streamStarted = Date.now();
      for await (const event of runStream(args)) {
        if (event.type === "delta") {
          if (firstTokenMs === null) firstTokenMs = Date.now() - streamStarted;
          rawDeltas.push(event.text);
        } else {
          streamEnd = event;
          streamEndedAt = Date.now();
        }
        yield event;
      }
    },
  };

  const investigate = makeInvestigateCitation(deps);
  const started = Date.now();
  let shown = "";
  let ending = "finished";
  const { report } = await collectSpend(async () => {
    try {
      const run = await investigate(c.slug, c.work.id, null);
      for await (const event of run.stream() as AsyncGenerator<InvestigateEvent>) {
        if (event.type === "delta") shown += event.text;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === CITATION_INVESTIGATE_QUOTED.message) {
        const fresh = (await overlay(c.slug)).citations.citations.find((w) => w.id === c.work.id) ?? c.work;
        const { article, context } = await contextFor(c.slug, fresh);
        const matched = matchedPageOf(fresh, await deps.finds.load(c.slug, c.work.id));
        ending = `stopped by the quote guard: ${guardCause(allowedQuoteTexts(article.blocks, context, matched), rawDeltas)}`;
      } else ending = `failed: ${message.slice(0, 120)}`;
    }
  }, {
    attribution: { scopeKind: "eval", ownerId: environmentOwnerId(), articleSlug: c.slug },
    sink: (row) => costStore.record(row),
  });
  const pressMs = Date.now() - started;

  /* The passages outcome, recomputed from the very answer the press read — the same two pure functions. */
  const e = evidence as PaperEvidence | null;
  let kept: PaperPassage[] = [];
  let offered: number | null = null;
  let dropped: number | null = null;
  let passagesCall = "not run";
  const pj = passagesJson as JsonCall | null;
  if (passagesError) passagesCall = `failed (${passagesError})`;
  else if (pj && e?.state === "read") {
    const read = readPassagesAnswer(pj.json);
    if (!read) passagesCall = "unreadable";
    else {
      const verified = keepVerified(e, read.claims);
      kept = verified.passages;
      offered = read.claims.length + read.malformed;
      dropped = read.malformed + verified.dropped;
      passagesCall = "answered";
    }
  }

  const costs = report.calls.map((call: SpendRecord) => ({
    job: call.job,
    cost: formatNanos(totalSpend([call]).nanos) + (totalSpend([call]).unpriced ? " (unpriced)" : ""),
    ms: call.ms,
  }));
  const total = totalSpend(report.calls);
  const end = streamEnd as Extract<StreamRunEvent, { type: "end" }> | null;
  return {
    c,
    paperState: e === null ? "not reached" : e.state === "read" ? `read (${e.matchedBy}, ${e.sentWords}/${e.words} words)` : e.state,
    passagesCall,
    kept,
    offered,
    dropped,
    ending: end && ending === "finished" ? `finished (${end.outcome.kind})` : ending,
    costs,
    total: formatNanos(total.nanos),
    totalNanos: total.nanos,
    unpriced: total.unpriced,
    firstTokenMs,
    streamMs: streamStarted === null || streamEndedAt === null ? null : streamEndedAt - streamStarted,
    pressMs,
    answer: (saved ?? shown).trim(),
  };
}

function firstWords(text: string, n: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  return words.slice(0, n).join(" ") + (words.length > n ? " …" : "");
}

function paidReport(rows: readonly PaidRow[], stopped: string | null): string {
  const lines: string[] = [];
  if (stopped) lines.push(`**Stopped early:** ${stopped}`, ``);
  lines.push(
    `| # | slug | entry | linkFrom | paper | passages call | offered | kept | dropped | ending | costs by call | total | 1st token s | stream s | press s |`,
    `|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`,
  );
  rows.forEach((r, i) => {
    lines.push(
      `| ${i + 1} | ${cell(r.c.slug.slice(0, 32))} | ${r.c.work.id} | ${r.c.work.linkFrom} | ${cell(r.paperState)} | ${r.passagesCall} | ${cell(r.offered)} | ${r.kept.length} | ${cell(r.dropped)} | ${cell(r.ending)} | ${cell(r.costs.map((x) => `${x.job} ${x.cost} ${(x.ms / 1000).toFixed(1)}s`).join("; "))} | ${r.total}${r.unpriced ? ` (+${r.unpriced} unpriced)` : ""} | ${r.firstTokenMs === null ? "—" : (r.firstTokenMs / 1000).toFixed(1)} | ${r.streamMs === null ? "—" : (r.streamMs / 1000).toFixed(1)} | ${(r.pressMs / 1000).toFixed(1)} |`,
    );
  });
  const nanos = rows.reduce((n, r) => n + r.totalNanos, 0);
  lines.push(``, `Total ${formatNanos(nanos)} over ${rows.length} presses.`, ``);
  rows.forEach((r, i) => {
    lines.push(`### ${i + 1}. ${r.c.slug} / ${r.c.work.id}`, ``);
    for (const p of r.kept) lines.push(`- ${p.chunk} p.${p.page} (${p.bears}): ${firstWords(p.text, 12)}`);
    if (r.kept.length) lines.push(``);
    lines.push("```text", r.answer.slice(0, 300) + (r.answer.length > 300 ? " …" : ""), "```", ``);
  });
  return lines.join("\n");
}

/* ------------------------------------------------------------------ main -- */

async function main(): Promise<void> {
  loadEnvLocal();
  const args = parseArgs(process.argv.slice(2));
  await runAsOwner(environmentOwnerId(), async () => {
    const slugs = args.slugs.length > 0 ? args.slugs : (await listArticles()).map((e) => e.slug);
    const all: Candidate[] = [];
    for (const slug of slugs) all.push(...(await candidatesOf(slug)));
    const counts = (b: Bucket) => all.filter((c) => c.bucket === b).length;
    console.log(
      `${slugs.length} articles; ${all.length} readable rows (arxiv ${counts("arxiv")}, doi ${counts("doi")}, matched page ${counts("matched-page")})`,
    );
    const chosen = pick(all, args.works);
    if (chosen.length === 0) {
      console.log("No row has a DOI, an arXiv id or a stored quick-check match — nothing to read.");
      return;
    }

    const free: FreeRow[] = [];
    for (const c of chosen) {
      process.stderr.write(`reading ${c.slug} ${c.work.id} (${c.bucket})…\n`);
      free.push(await freeRead(c));
    }
    console.log(`\n## Paper reads (free)\n`);
    console.log(freeTable(free));
    const states = new Map<string, number>();
    for (const r of free) states.set(r.evidence.state, (states.get(r.evidence.state) ?? 0) + 1);
    console.log(`\nStates: ${[...states].map(([s, n]) => `${s} ${n}`).join(", ")}. Peak RSS ${Math.max(...free.map((r) => r.maxRssMb)).toFixed(0)} MB.`);

    if (!args.paid) return;
    const picks = choosePaid(free);
    const paid: PaidRow[] = [];
    let spentNanos = 0;
    let stopped: string | null = null;
    for (const r of picks) {
      if (spentNanos / 1e9 >= BUDGET_USD) {
        stopped = `budget of $${BUDGET_USD} reached after ${paid.length} presses`;
        break;
      }
      process.stderr.write(`pressing Investigate on ${r.c.slug} ${r.c.work.id}…\n`);
      const row = await paidPress(r.c);
      paid.push(row);
      /* An unpriced press counts as the stop threshold, so the budget cannot be read as unspent. */
      spentNanos += row.unpriced ? PER_PRESS_STOP_USD * 1e9 : row.totalNanos;
      if (row.totalNanos / 1e9 > PER_PRESS_STOP_USD) {
        stopped = `press ${paid.length} cost ${row.total} > $${PER_PRESS_STOP_USD}`;
        break;
      }
    }
    console.log(`\n## Investigate presses (paid)\n`);
    console.log(paidReport(paid, stopped));
  });
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
