/**
 * **Landing page vs the paper itself, for sources other than arXiv.**
 *
 *   npx tsx evals/paper-sources/landing-vs-paper.ts [--refetch] [--only=<source>]
 *
 * For each URL in cases.json: our real `fetchDocument` (every defence on, no
 * options), then for HTML the real stage-2 `runExtract` + `splitIntoBlocks`, for a
 * PDF only a page count (pdf-lib, no model). Free; no database. One request at
 * a time, >= 3 s between requests to the same host, results cached per URL in
 * evals/results/paper-sources-261005/cache/ so a re-run does not re-fetch.
 * A block (challenge, 403, paywall) is a result to record, never to get round.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { splitIntoBlocks } from "../../src/blocks.js";
import { runExtract } from "../../src/extract.js";
import { FetchFailure, fetchDocument } from "../../src/fetch.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../results/paper-sources-261005");
const CACHE = join(OUT, "cache");
mkdirSync(CACHE, { recursive: true });

const refetch = process.argv.includes("--refetch");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

interface Case {
  source: string;
  label: string;
  landingUrl: string;
  fullTextUrls: { url: string; expect: "html" | "pdf" }[];
}

interface Row {
  source: string;
  label: string;
  role: "landing" | "fulltext";
  expect: "html" | "pdf" | null;
  requestedUrl: string;
  outcome: "ok" | "fetch-failed" | "extract-refused";
  finalUrl?: string;
  chainHosts?: string[];
  status?: number | null;
  kind?: "html" | "pdf";
  bytes?: number;
  elapsedMs: number;
  failure?: { code: string; status: number | null; message: string };
  extractError?: string;
  title?: string;
  byline?: string;
  words?: number;
  blocks?: number;
  headings?: number;
  figures?: number;
  images?: number;
  tables?: number;
  hasReferences?: boolean;
  first200?: string;
  last200?: string;
  meta?: Record<string, string[]>;
  challenge?: string[];
  pdfPages?: number | null;
  note?: string;
}

const META_NAMES = ["citation_pdf_url", "citation_fulltext_html_url", "citation_doi", "citation_arxiv_id", "citation_title"];
const CHALLENGE = [/just a moment/i, /cf-chl/i, /captcha/i, /access denied/i, /enable javascript/i];

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag)?.slice(2).find((x) => x !== undefined);
}

function rawMeta(html: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const add = (k: string, v: string | undefined) => {
    if (!v) return;
    const list = out[k] ?? [];
    list.push(v.slice(0, 300));
    out[k] = list;
  };
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const name = (attr(m[0], "name") ?? attr(m[0], "property"))?.toLowerCase();
    if (name && (META_NAMES.includes(name) || name === "og:url")) add(name, attr(m[0], "content"));
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    if (/canonical/i.test(attr(m[0], "rel") ?? "")) add("canonical", attr(m[0], "href"));
  }
  return out;
}

const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

async function pageCount(bytes: Uint8Array): Promise<number | null> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    return (await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })).getPageCount();
  } catch {
    return null;
  }
}

async function measure(source: string, label: string, role: Row["role"], expect: Row["expect"], url: string): Promise<Row> {
  const base = { source, label, role, expect, requestedUrl: url };
  const t0 = Date.now();
  let doc: Awaited<ReturnType<typeof fetchDocument>>;
  try {
    doc = await fetchDocument(url);
  } catch (e) {
    const f = e instanceof FetchFailure ? e : null;
    return {
      ...base,
      outcome: "fetch-failed",
      elapsedMs: Date.now() - t0,
      failure: { code: f?.code ?? "unknown", status: f?.status ?? null, message: String((e as Error).message).slice(0, 200) },
    };
  }
  const row: Row = {
    ...base,
    outcome: "ok",
    finalUrl: doc.url,
    chainHosts: doc.chain.map(hostOf),
    status: doc.status,
    kind: doc.kind,
    bytes: doc.bytes.byteLength,
    elapsedMs: Date.now() - t0,
  };
  if (doc.kind === "pdf") {
    row.pdfPages = await pageCount(doc.bytes);
    return row;
  }
  const html = doc.text;
  row.meta = rawMeta(html);
  row.challenge = CHALLENGE.filter((r) => r.test(html)).map((r) => r.source);
  try {
    const out = await runExtract({ html, url: doc.url, slug: "paper-sources-eval" });
    const { blocks } = splitIntoBlocks(out.extractedHtml);
    const text = blocks.map((b) => b.text).join("\n");
    row.title = out.meta.title;
    if (out.meta.byline !== undefined) row.byline = out.meta.byline;
    row.words = blocks.reduce((n, b) => n + b.words, 0);
    row.blocks = blocks.length;
    row.headings = blocks.filter((b) => b.kind === "heading").length;
    row.figures = (out.extractedHtml.match(/<figure\b/gi) ?? []).length;
    row.images = (out.extractedHtml.match(/<img\b/gi) ?? []).length;
    row.tables = (out.extractedHtml.match(/<table\b/gi) ?? []).length;
    row.hasReferences = blocks.some((b) => b.kind === "heading" && /^\s*(\d+\.?\s*)?(references|bibliography|literature cited|works cited)\b/i.test(b.text));
    row.first200 = text.slice(0, 200);
    row.last200 = text.slice(-200);
  } catch (e) {
    row.outcome = "extract-refused";
    row.extractError = `${(e as Error).name}: ${String((e as Error).message).slice(0, 160)}`;
  }
  return row;
}

const cases: Case[] = JSON.parse(readFileSync(join(HERE, "cases.json"), "utf8"));
const lastHit = new Map<string, number>();
const rows: Row[] = [];
const todo: { c: Case; role: Row["role"]; expect: Row["expect"]; url: string }[] = [];
for (const c of cases) {
  if (only && c.source !== only) continue;
  todo.push({ c, role: "landing", expect: null, url: c.landingUrl });
  for (const f of c.fullTextUrls) todo.push({ c, role: "fulltext", expect: f.expect, url: f.url });
}

for (const [i, t] of todo.entries()) {
  const file = join(CACHE, `${createHash("sha1").update(t.url).digest("hex")}.json`);
  let row: Row;
  if (!refetch && existsSync(file)) {
    row = { ...(JSON.parse(readFileSync(file, "utf8")) as Row), source: t.c.source, label: t.c.label, role: t.role, expect: t.expect };
  } else {
    const host = hostOf(t.url);
    const wait = (lastHit.get(host) ?? 0) + 3000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    row = await measure(t.c.source, t.c.label, t.role, t.expect, t.url);
    lastHit.set(host, Date.now());
    writeFileSync(file, JSON.stringify(row));
  }
  rows.push(row);
  console.log(`[${i + 1}/${todo.length}] ${row.source} ${row.role} ${row.outcome} ${row.kind ?? row.failure?.code ?? ""} ${row.words ?? row.pdfPages ?? ""}`);
}

function note(r: Row): string {
  const n: string[] = [];
  if (r.failure) n.push(`${r.failure.code}${r.failure.status ? ` ${r.failure.status}` : ""}`);
  if (r.extractError) n.push(r.extractError.slice(0, 60));
  if (r.expect && r.kind && r.expect !== r.kind) n.push(`expected ${r.expect}, got ${r.kind}`);
  if (r.challenge?.length) n.push(`challenge-ish: ${r.challenge.join("|")}`);
  const pdf = r.meta?.citation_pdf_url?.[0];
  if (pdf) n.push("citation_pdf_url");
  if (r.chainHosts && r.chainHosts.length > 1) n.push(`via ${[...new Set(r.chainHosts)].join(">")}`);
  return n.join("; ");
}
const esc = (s: unknown) => String(s ?? "").replace(/\|/g, "/").replace(/\n/g, " ");
const md = [
  "| source | label | role | outcome | kind | words | blocks | pdf pages | note |",
  "|---|---|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.source} | ${esc(r.label)} | ${r.role} | ${r.outcome} | ${r.kind ?? ""} | ${r.words ?? ""} | ${r.blocks ?? ""} | ${r.pdfPages ?? ""} | ${esc(note(r))} |`),
];
if (!only) {
  writeFileSync(join(OUT, "results.json"), JSON.stringify(rows, null, 1));
  writeFileSync(join(OUT, "summary.md"), `${md.join("\n")}\n`);
}
console.log(`done: ${rows.length} rows`);
process.exit(0);
