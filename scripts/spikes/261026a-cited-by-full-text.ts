/**
 * **Who cites a piece with no DOI, from OpenAlex's full text** — the free half
 * of docs/investigations/261026a-cited-by-with-no-doi-full-text-and-web-search-recall-and-cost.md.
 *
 * ```
 * npx tsx scripts/spikes/261026a-cited-by-full-text.ts gate        # hits before and after each piece's year
 * npx tsx scripts/spikes/261026a-cited-by-full-text.ts precision   # do the top hits really cite it? (open copies, by code)
 * npx tsx scripts/spikes/261026a-cited-by-full-text.ts shown       # every row the shipped code would list, checked the same way
 * npx tsx scripts/spikes/261026a-cited-by-full-text.ts reception   # what stored Reception searches kept (local stack, read only)
 * ```
 *
 * Free: OpenAlex (with `OPENALEX_API_KEY` from .env.local when set, as a
 * header) and the open copies its records point to. No model is called. The
 * pieces are the local stack's no-DOI articles with public addresses; nothing
 * here touches production.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { loadPdfjs } from "../../src/pdf.js";

interface Piece {
  title: string;
  author?: string;
  year: number;
}

const PIECES: Piece[] = [
  { title: "Verbalizable Representations Form a Global Workspace in Language Models", year: 2026 },
  { title: "LLM Powered Autonomous Agents", author: "Weng", year: 2023 },
  { title: "Do Things that Don't Scale", author: "Graham", year: 2013 },
  { title: "More Is Different for AI", author: "Steinhardt", year: 2022 },
  { title: "Understanding LSTM Networks", author: "Olah", year: 2015 },
  { title: "Simulators", author: "janus", year: 2022 },
  { title: "Heuristics That Almost Always Work", author: "Alexander", year: 2022 },
  { title: "Why working quickly is more important than it seems", author: "Somers", year: 2015 },
  { title: "How to Do Great Work", author: "Graham", year: 2023 },
  { title: "Fashionable Problems", author: "Graham", year: 2025 },
  { title: "Normalization of deviance", author: "Luu", year: 2015 },
  { title: "Toy Models of Superposition", author: "Elhage", year: 2022 },
  { title: "A Mathematical Framework for Transformer Circuits", author: "Elhage", year: 2021 },
  { title: "Towards Monosemanticity: Decomposing Language Models With Dictionary Learning", author: "Bricken", year: 2023 },
  { title: "In-context Learning and Induction Heads", author: "Olsson", year: 2022 },
  { title: "The Scaling Hypothesis", author: "Gwern", year: 2020 },
  { title: "Meditations on Moloch", author: "Alexander", year: 2014 },
  { title: "The Bitter Lesson", author: "Sutton", year: 2019 },
];
const NOW = 2026;


function openAlexKey(): string | null {
  try {
    return readFileSync(".env.local", "utf8").match(/^OPENALEX_API_KEY=(.*)$/m)?.[1]?.trim() || null;
  } catch {
    return null;
  }
}
const KEY = openAlexKey();

async function works(params: Record<string, string>): Promise<{ count: number; results: any[] }> {
  const p = new URLSearchParams({ ...params, mailto: "greg@gregdetre.com" });
  const res = await fetch(`https://api.openalex.org/works?${p}`, { headers: KEY ? { Authorization: `Bearer ${KEY}` } : {} });
  const json = (await res.json()) as { meta?: { count: number }; results?: any[] };
  if (json.meta === undefined) throw new Error(`OpenAlex ${res.status}`);
  return { count: json.meta.count, results: json.results ?? [] };
}

const phrase = (p: Piece) => `fulltext.search:"${p.title}"`;
/** Letters and digits only: a PDF's "Rep- resentations" and an HTML title's line break both fold away. */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

async function gate(): Promise<void> {
  for (const p of PIECES) {
    const span = Math.min(10, p.year - 1990);
    const before = (await works({ filter: `${phrase(p)},publication_year:${p.year - span}-${p.year - 1}`, per_page: "1", select: "id" })).count;
    const after = (await works({ filter: `${phrase(p)},publication_year:>${p.year - 1}`, per_page: "1", select: "id" })).count;
    const rb = before / span;
    const ra = after / (NOW - p.year + 1);
    console.log(
      `${p.title.slice(0, 50).padEnd(50)} before ${String(before).padStart(7)} (${span} y)  after ${String(after).padStart(7)}  ` +
        `per year ${rb.toFixed(1)} vs ${ra.toFixed(1)}  ratio ${ra > 0 ? (rb / ra).toFixed(3) : "—"}`,
    );
  }
}

async function text(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "spideryarn-spike (mailto:greg@gregdetre.com)" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if ((res.headers.get("content-type") ?? "").includes("pdf") || (buf[0] === 0x25 && buf[1] === 0x50)) {
      const doc = await (await loadPdfjs()).getDocument({ data: buf, isEvalSupported: false } as never).promise;
      let out = "";
      for (let i = 1; i <= doc.numPages; i++) out += (await (await doc.getPage(i)).getTextContent()).items.map((x: any) => x.str ?? "").join(" ") + "\n";
      return out;
    }
    return new TextDecoder().decode(buf).replace(/<[^>]+>/g, " ");
  } catch {
    return null;
  }
}

function arxivIdOf(w: any): string | undefined {
  const places: string[] = [...Object.values((w.ids ?? {}) as Record<string, string>), ...(w.locations ?? []).map((l: any) => l.landing_page_url ?? "")];
  for (const u of places) {
    const m = /arxiv\.org\/abs\/([\w./-]+?)(v\d+)?$/i.exec(u) ?? /10\.48550\/arxiv\.([\w.]+)/i.exec(u);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

/**
 * The pieces whose lists are measured: the usable ones above, plus pieces like
 * the reported one (transformer-circuits.pub and Distill, no DOI of their own)
 * and two older blog posts. `host` is the piece's own address's host, which a
 * reference entry often carries instead of the author.
 */
const MEASURED: (Piece & { host: string })[] = [
  { title: "Verbalizable Representations Form a Global Workspace in Language Models", year: 2026, host: "transformer-circuits.pub" },
  { title: "LLM Powered Autonomous Agents", author: "Weng", year: 2023, host: "lilianweng.github.io" },
  { title: "Do Things that Don't Scale", author: "Graham", year: 2013, host: "paulgraham.com" },
  { title: "More Is Different for AI", author: "Steinhardt", year: 2022, host: "bounded-regret.ghost.io" },
  { title: "Understanding LSTM Networks", author: "Olah", year: 2015, host: "colah.github.io" },
  { title: "Toy Models of Superposition", author: "Elhage", year: 2022, host: "transformer-circuits.pub" },
  { title: "A Mathematical Framework for Transformer Circuits", author: "Elhage", year: 2021, host: "transformer-circuits.pub" },
  { title: "Towards Monosemanticity: Decomposing Language Models With Dictionary Learning", author: "Bricken", year: 2023, host: "transformer-circuits.pub" },
  { title: "In-context Learning and Induction Heads", author: "Olsson", year: 2022, host: "transformer-circuits.pub" },
  { title: "The Scaling Hypothesis", author: "Gwern", year: 2020, host: "gwern.net" },
  { title: "Meditations on Moloch", author: "Alexander", year: 2014, host: "slatestarcodex.com" },
  { title: "The Bitter Lesson", author: "Sutton", year: 2019, host: "incompleteideas.net" },
];

/** A title is the piece's own record, not a citer, when it is the piece's title with at most two words more. */
function isThePiece(workTitle: string, p: Piece): boolean {
  const w = squash(workTitle);
  const t = squash(p.title);
  if (!w.includes(t)) return false;
  const extra = workTitle.split(/\s+/).length - p.title.split(/\s+/).length;
  return extra <= 2;
}

/**
 * **Does this copy cite the piece?** Its title, with the first author's
 * surname or the piece's host within 400 characters either side — the shape
 * of a reference entry. The title alone is `title-only`: a sign, not a citation.
 */
function verdictOf(t: string, p: Piece & { host: string }): "cites" | "title-only" | "absent" {
  const flat = t.replace(/\s+/g, " ");
  const letters: number[] = [];
  let s = "";
  for (let i = 0; i < flat.length; i++) {
    const ch = flat[i]!.toLowerCase();
    if (/[a-z0-9]/.test(ch)) {
      s += ch;
      letters.push(i);
    }
  }
  const at = s.indexOf(squash(p.title));
  if (at < 0) return "absent";
  let hit = at;
  while (hit >= 0) {
    const from = Math.max(0, letters[hit]! - 400);
    const to = Math.min(flat.length, letters[hit + squash(p.title).length - 1]! + 400);
    const near = squash(flat.slice(from, to));
    if ((p.author && near.includes(squash(p.author))) || near.includes(squash(p.host))) return "cites";
    hit = s.indexOf(squash(p.title), hit + 1);
  }
  return "title-only";
}

/**
 * **The first pass**: the top hits by this file's own first-draft rules (`isThePiece`'s
 * two extra words, which drop *Response to <title>*, and `>Y-2`). Kept as the record of
 * the investigation's first two tables; `shown` is the shipped code's measure.
 */
async function precision(): Promise<void> {
  const withAuthor = process.argv.includes("--with-author");
  const top = Number(process.argv.find((a) => a.startsWith("--top="))?.slice(6) ?? 5);
  const tally = { cites: 0, "title-only": 0, absent: 0, unreachable: 0 };
  for (const p of MEASURED) {
    const filter = withAuthor && p.author ? `${phrase(p)},fulltext.search:${p.author}` : phrase(p);
    const { count, results } = await works({ filter, per_page: "50", sort: "cited_by_count:desc", select: "id,display_name,publication_year,ids,best_oa_location,locations" });
    /* Sol's consult: the piece's own records out (not every title containing it), and a year's tolerance. */
    const rows = results.filter((w) => !isThePiece(w.display_name ?? "", p) && (w.publication_year ?? 9999) >= p.year - 1).slice(0, top);
    const mine = { cites: 0, "title-only": 0, absent: 0, unreachable: 0 };
    for (const w of rows) {
      const arxiv = arxivIdOf(w);
      const urls = [arxiv ? `https://arxiv.org/pdf/${arxiv}` : null, w.best_oa_location?.pdf_url, ...(w.locations ?? []).map((l: any) => l.pdf_url), w.best_oa_location?.landing_page_url].filter(Boolean) as string[];
      let verdict: keyof typeof mine = "unreachable";
      for (const u of [...new Set(urls)].slice(0, 3)) {
        const t = await text(u);
        if (t === null || t.length < 2000) continue;
        verdict = verdictOf(t, p);
        break;
      }
      mine[verdict]++;
      console.log(`   ${verdict.padEnd(12)} ${w.publication_year} ${String(w.display_name).slice(0, 70)}`);
    }
    for (const k of Object.keys(tally) as (keyof typeof tally)[]) tally[k] += mine[k];
    console.log(
      `== ${p.title}${withAuthor && p.author ? ` + ${p.author}` : ""}: ${count} in all; of the top ${rows.length}, ` +
        `cites ${mine.cites}, title only ${mine["title-only"]}, absent ${mine.absent}, unreachable ${mine.unreachable}`,
    );
  }
  const readable = tally.cites + tally["title-only"] + tally.absent;
  console.log(`== all: cites ${tally.cites} of ${readable} readable; title only ${tally["title-only"]}; absent ${tally.absent}; unreachable ${tally.unreachable}`);
}

/**
 * **Every row the panel would show**, through the shipped code (src/citation-fulltext.ts):
 * its question, its gate, its order, its page of 25 and its own-record rule. Sol's plan
 * review, F1: the top five were not the list.
 */
async function shown(): Promise<void> {
  const fulltext = await import("../../src/citation-fulltext.js");
  const tally = { cites: 0, "title-only": 0, absent: 0, unreachable: 0 };
  /* `--only=<words>`: one piece, by a fragment of its title. */
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).toLowerCase();
  for (const p of MEASURED.filter((m) => only === undefined || m.title.toLowerCase().includes(only))) {
    const identity = { title: p.title, url: `https://${p.host}/`, ...(p.year ? { publishedYear: p.year } : {}) };
    /* The reported piece has no year on record: measured as shipped, without one. */
    const asShipped = p.host === "transformer-circuits.pub" && p.year === 2026 ? { title: p.title, url: `https://${p.host}/` } : identity;
    const q = fulltext.fulltextQuestionOf(asShipped, NOW);
    if (q === null) {
      console.log(`== ${p.title}: not asked`);
      continue;
    }
    /* The shipped addresses, so the windows measured are the shipped windows (Sol's S1-F6). */
    const get = async (url: string) =>
      (await (await fetch(url, { headers: KEY ? { Authorization: `Bearer ${KEY}` } : {} })).json()) as { meta: { count: number }; results: any[] };
    const since = q.year === undefined ? null : { from: q.year - 1, to: NOW };
    if (q.year !== undefined && since !== null) {
      const before = (await get(fulltext.openAlexFulltextUrl(q.phrase, { from: q.year - 10, to: q.year - 2 }, "count"))).meta.count;
      const after = (await get(fulltext.openAlexFulltextUrl(q.phrase, since, "count"))).meta.count;
      if (fulltext.isCommonPhrase(before, after, q.year, NOW)) {
        console.log(`== ${p.title}: common phrase (${before} before, ${after} since)`);
        continue;
      }
    }
    const url = fulltext.openAlexFulltextUrl(q.phrase, since, {
      perPage: fulltext.POSSIBLE_PER_PAGE,
      order: fulltext.orderFor(q.year, NOW),
    });
    /* The open-copy fields as well, which the panel does not ask for. */
    const json = await get(url.replace("select=", "select=ids%2Cbest_oa_location%2Clocations%2C"));
    const rows = json.results.filter((w) => !fulltext.isThePiecesOwnRecord(w.display_name ?? "", p.title));
    const mine = { cites: 0, "title-only": 0, absent: 0, unreachable: 0 };
    for (const [rank, w] of rows.entries()) {
      const arxiv = arxivIdOf(w);
      const urls = [arxiv ? `https://arxiv.org/pdf/${arxiv}` : null, w.best_oa_location?.pdf_url, ...(w.locations ?? []).map((l: any) => l.pdf_url), w.best_oa_location?.landing_page_url].filter(Boolean) as string[];
      let verdict: keyof typeof mine = "unreachable";
      for (const u of [...new Set(urls)].slice(0, 3)) {
        const t = await text(u);
        if (t === null || t.length < 2000) continue;
        verdict = verdictOf(t, p);
        break;
      }
      mine[verdict]++;
      console.log(`   ${String(rank + 1).padStart(2)} ${verdict.padEnd(12)} ${w.publication_year} ${String(w.display_name).slice(0, 70)}`);
    }
    for (const k of Object.keys(tally) as (keyof typeof tally)[]) tally[k] += mine[k];
    console.log(
      `== ${p.title}: ${json.meta.count} in all; of ${rows.length} shown, cites ${mine.cites}, title only ${mine["title-only"]}, ` +
        `absent ${mine.absent}, unreachable ${mine.unreachable}`,
    );
  }
  const readable = tally.cites + tally["title-only"] + tally.absent;
  console.log(`== all shown: cites ${tally.cites} of ${readable} readable; title only ${tally["title-only"]}; absent ${tally.absent}; unreachable ${tally.unreachable}`);
}

async function reception(): Promise<void> {
  const c = new pg.Client({ connectionString: "postgresql://postgres:postgres@127.0.0.1:54362/postgres" });
  await c.connect();
  await c.query("begin read only");
  const r = await c.query(`
    select r.title, r.doi, r.reception->'direct' direct
    from spideryarn.articles a join spideryarn.article_revisions r on r.id = a.current_revision_id
    where r.reception->>'version' in ('debate/5','debate/6','debate/7')`);
  for (const row of r.rows) {
    const rows = (row.direct?.rows ?? []) as unknown[];
    const counts = row.direct?.counts ?? {};
    console.log(`${String(row.title).slice(0, 45).padEnd(45)} doi:${row.doi ? "y" : "n"}  results ${counts.returnedSources ?? "?"}  searches ${counts.webSearches ?? "?"}  kept ${rows.length}`);
  }
  await c.query("rollback");
  await c.end();
}

const command = process.argv[2];
if (command === "gate") await gate();
else if (command === "precision") await precision();
else if (command === "reception") await reception();
else if (command === "shown") await shown();
else console.log("usage: gate | precision | shown | reception");
