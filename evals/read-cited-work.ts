/**
 * Eval — asked *does this work say what this passage cites it for?*, does chat
 * call `read_cited_work`, does the paper get read, and does the answer keep
 * "the passages shown do not say it" apart from "the paper does not"?
 *
 *     npx tsx evals/read-cited-work.ts --list                     # candidate citations in the local database
 *     npx tsx evals/read-cited-work.ts --label v1 [--max N]       # ask about up to N of them
 *
 * **This one spends money**: one real chat turn per case, with the full tool
 * loop and web search on, exactly as `streamChat` sends them, and a real PDF
 * read. Plan docs/plans/261011w-does-the-cited-work-say-that-at-the-citing-sentence.md,
 * stage 2 — GPT Sol's S6 made it a gate: a tool the model never calls is a
 * feature that does nothing while looking built.
 *
 * Each case is the press the card's button makes: a chat anchored on the
 * citing paragraph, the question `askAboutBlock(askDoesItSayThat(work))`.
 * Counts, not a verdict; the answer's opening is printed and the whole of it is
 * in `evals/results/read-cited-work-<label>-<stamp>.json`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { withLedger } from "../src/cli-ledger.js";
import { converse } from "../src/converse.js";
import { loadEnvLocal } from "../src/env.js";
import { isMain } from "../src/is-main.js";
import { environmentOwnerId, runAsOwner } from "../src/owner.js";
import type { BibliographyFound, CitedWork } from "../src/types.js";
import { askAboutBlock, askDoesItSayThat } from "../src/web/chat-handoff.js";

interface Candidate {
  slug: string;
  work: CitedWork;
  blockId: string;
}

function option(argv: string[], name: string): string | null {
  const at = argv.indexOf(name);
  if (at < 0) return null;
  const value = argv[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

async function candidates(): Promise<Candidate[]> {
  const store = await import("../src/store/index.js");
  const out: Candidate[] = [];
  for (const entry of await store.listArticles()) {
    let found: BibliographyFound;
    try {
      found = await store.loadBibliography(entry.slug);
    } catch {
      continue;
    }
    if (found.stale) continue;
    for (const work of found.bibliography.citations) {
      if (work.linkFrom !== "arxiv" && work.linkFrom !== "doi") continue;
      const blockId = work.citedAt[0];
      if (!work.citedInBody || !blockId) continue;
      out.push({ slug: entry.slug, work, blockId });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const list = argv.includes("--list");
  const label = option(argv, "--label") ?? "unlabelled";
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(label)) {
    throw new Error("--label must be 1–41 lowercase letters, numbers, or hyphens");
  }
  const maxValue = option(argv, "--max");
  const max = maxValue === null ? 6 : Number(maxValue);
  if (!Number.isInteger(max) || max < 1) throw new Error("--max must be a positive integer");
  const owner = environmentOwnerId();
  const all = await runAsOwner(owner, candidates);
  /* One per article first, arXiv before DOI: an arXiv PDF is the likeliest read. */
  const seen = new Set<string>();
  const picked = [...all]
    .sort((a, b) => Number(b.work.linkFrom === "arxiv") - Number(a.work.linkFrom === "arxiv"))
    .filter((c) => {
      if (seen.has(c.slug)) return false;
      seen.add(c.slug);
      return true;
    })
    .slice(0, max);
  if (list) {
    console.log(`${all.length} candidates in ${new Set(all.map((c) => c.slug)).size} articles; would ask:`);
    for (const c of picked) console.log(`${c.slug}  ${c.work.linkFrom}  ${c.work.title}`);
    return;
  }
  if (picked.length === 0) throw new Error("no eligible cited works; no eval was run");
  const store = await import("../src/store/index.js");
  const results = [];
  for (const c of picked) {
    const { meta, blocks } = await runAsOwner(owner, () => store.loadArticle(c.slug));
    const question = askAboutBlock({
      blockId: c.blockId,
      question: askDoesItSayThat({
        title: c.work.title,
        ...(c.work.authors ? { authors: c.work.authors } : {}),
        ...(c.work.year ? { year: c.work.year } : {}),
      }),
    });
    const started = Date.now();
    let done = null;
    await runAsOwner(owner, async () => {
      for await (const event of converse({
        power: "standard",
        meta,
        blocks,
        history: [],
        question,
        slug: c.slug,
        anchor: { blockId: c.blockId },
        kind: "chat",
        useTools: true,
      })) {
        if (event.type === "done") done = event;
      }
    });
    if (!done) throw new Error("converse ended without a done event");
    const d = done as { text: string; tools: { name: string; detail?: string }[]; searches: number };
    const row = {
      slug: c.slug,
      work: c.work.title,
      linkFrom: c.work.linkFrom,
      seconds: Math.round((Date.now() - started) / 1000),
      tools: d.tools.map((t) => `${t.name}${t.detail ? ` (${t.detail})` : ""}`),
      calledTool: d.tools.some((t) => t.name === "read_cited_work"),
      read: d.tools.some((t) => t.name === "read_cited_work" && /^read \d/.test(t.detail ?? "")),
      searches: d.searches,
      text: d.text,
    };
    results.push(row);
    console.log(`\n== ${c.slug} · ${c.work.title} (${c.work.linkFrom}) · ${row.seconds}s`);
    console.log(`tools: ${row.tools.join(", ") || "none"} · searches ${row.searches}`);
    console.log(row.text.slice(0, 700));
  }
  const called = results.filter((r) => r.calledTool).length;
  const read = results.filter((r) => r.read).length;
  console.log(`\ncalled read_cited_work ${called}/${results.length}; paper read ${read}/${results.length}`);
  const dir = path.join("evals", "results");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `read-cited-work-${label}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify(results, null, 2));
  console.log(`wrote ${file}`);
}

if (isMain(import.meta.url)) {
  loadEnvLocal();
  await withLedger("eval", main).catch((err: unknown) => {
    console.error(`\n${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
  /* The Postgres pool would otherwise hold the process open. */
  process.exit(process.exitCode ?? 0);
}
