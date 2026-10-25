/**
 * **How many cited works with no note get a web note, under the rule as it
 * stands** — the before-and-after for plan 261025b (a looser page rule, Greg's
 * reply on q-x9srvv). docs/investigations/261025b-citation-web-note-looser-rule-yield.md
 * is the write-up.
 *
 *     npx tsx evals/citation-web-note-yield.ts --fixture <bibliographies.json> --slug <slug> \
 *       --production <production-<slug>.json> --article <local slug> --owner <uuid> \
 *       --label <before|after> --work <dir>
 *
 * It drives the shipped `makeCitationWebNote` (src/citation-web-note.ts) — the
 * free refusals, the identifier, the writer, every code clause and the check —
 * once for every row the `production` phase of evals/citation-blurbs-spike.ts
 * left without a note, with the stores in memory: the allowance always
 * grants, and nothing is written to any database but the ledger's rows. The
 * article being read (for the *not the article* refusal) is the local copy
 * named by `--article`, read as `--owner`.
 *
 * **This spends money**: about 0.8 ¢ a searched row, through the gateway and
 * the ledger, as an eval. `<work>/web-notes-<label>.json` keeps each row's
 * page extract for a judge; it is article data and not committed. The
 * committed results file (evals/results/) keeps titles, hosts, URLs and notes.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { loadEnvLocal } from "../src/env.js";

loadEnvLocal();

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i === -1 ? undefined : process.argv[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} needs a value`);
  return value;
}

const { withLedger } = await import("../src/cli-ledger.js");
const { runAsOwner } = await import("../src/owner.js");
const store = await import("../src/store/index.js");
const { makeCitationWebNote } = await import("../src/citation-web-note.js");
const { citationEvidenceDeps } = await import("../src/citation-evidence.js");
const { openRouterJson } = await import("../src/ai-call.js");
const { collectSearchEvidence } = await import("../src/openrouter-stream.js");
type CitationWebNote = import("../src/types.js").CitationWebNote;

const fixturePath = arg("fixture");
const slug = arg("slug");
const label = arg("label");
const work = arg("work");
const owner = arg("owner");
const localArticle = arg("article");

const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as { slug: string; bibliography: import("../src/types.js").Bibliography }[];
const entry = fixture.find((a) => a.slug === slug);
if (!entry) throw new Error(`no ${slug} in the fixture`);
const produced = JSON.parse(await readFile(arg("production"), "utf8")) as { rows: { id: string; outcome: { kind: string } | null }[] };
const noted = new Set(produced.rows.filter((r) => r.outcome?.kind === "blurb").map((r) => r.id));
const citations = entry.bibliography.citations.map((row) => (noted.has(row.id) ? { ...row, blurb: {} as never } : row));
const bibliography = { ...entry.bibliography, citations };
const article = await runAsOwner(owner as never, () => store.loadArticle(localArticle));

const saved = new Map<string, CitationWebNote>();
/* Every result each writer call returned, by entry, so the judge can see the extract a note rests on. */
let current = "";
const picked = new Map<string, string | null>();
const results = new Map<string, Map<string, import("../src/types.js").SearchEvidence>>();
const press = makeCitationWebNote({
  reader: { loadBibliography: async () => ({ bibliography, stale: false, outdated: false }), loadArticle: async () => article },
  notes: {
    read: async (_slug, id) => {
      const row = citations.find((w) => w.id === id);
      return row ? { row, note: saved.get(id) ?? null } : null;
    },
    save: async (_slug, id, note) => {
      saved.set(id, note);
    },
  },
  allowance: { take: async () => ({ kind: "allowed", id: "eval" }) as never, finish: async () => {} },
  evidence: citationEvidenceDeps,
  call: async (job, body, options) => {
    const answered = await openRouterJson(job, body, options);
    if (job === "citation-web-note") {
      const found = new Map<string, import("../src/types.js").SearchEvidence>();
      const choice = (answered.json as { choices?: { message?: { annotations?: never } }[] } | null)?.choices?.[0];
      collectSearchEvidence(choice?.message?.annotations, found);
      results.set(current, found);
      /* Which result the writer named, so a *none* can be explained page by page. */
      try {
        const content = (answered.json as { choices?: { message?: { content?: string } }[] } | null)?.choices?.[0]?.message?.content ?? "";
        const named = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1)) as { url?: unknown };
        picked.set(current, typeof named.url === "string" ? named.url : null);
      } catch {
        picked.set(current, null);
      }
    }
    return answered;
  },
});

const out: Record<string, unknown>[] = [];
await withLedger("eval", async () => {
  for (const row of citations) {
    if (noted.has(row.id)) continue;
    current = row.id;
    const started = Date.now();
    const base = { id: row.id, title: row.title, authors: row.authors ?? null, year: row.year ?? null, linkFrom: row.linkFrom ?? null };
    try {
      const run = await press(slug, row.id);
      let done: unknown = null;
      for await (const event of run.stream()) if (event.type === "done") done = event.done;
      const note = saved.get(row.id);
      const found = [...(results.get(row.id)?.values() ?? [])].map((p) => ({ url: p.url, title: p.title ?? null, excerpt: p.excerpt ?? null }));
      out.push({ ...base, outcome: done, stored: note ?? null, picked: picked.get(row.id) ?? null, results: found, ms: Date.now() - started });
    } catch (err) {
      const e = err as { status?: number; reason?: string; message?: string };
      out.push({ ...base, refused: { status: e.status ?? null, reason: e.reason ?? null, message: e.message ?? String(err) }, ms: Date.now() - started });
    }
    const last = out[out.length - 1] as { outcome?: { outcome?: string; why?: string }; refused?: { reason?: string | null; status?: number | null } };
    console.log(`${row.id}  ${last.outcome ? `${last.outcome.outcome}${last.outcome.why ? `:${last.outcome.why}` : ""}` : `refused:${last.refused?.reason ?? last.refused?.status}`}  ${row.title.slice(0, 70)}`);
  }
});

const tally: Record<string, number> = {};
for (const r of out as { outcome?: { outcome: string; why?: string }; refused?: { reason: string | null; status: number | null } }[]) {
  const key = r.outcome ? (r.outcome.outcome === "note" ? "note" : `none:${r.outcome.why}`) : `refused:${r.refused?.reason ?? r.refused?.status}`;
  tally[key] = (tally[key] ?? 0) + 1;
}
const summary = { slug, label, works: citations.length, withAbstractNote: noted.size, pressed: out.length, tally };
await mkdir(work, { recursive: true });
await writeFile(path.join(work, `web-notes-${label}.json`), JSON.stringify({ summary, rows: out }, null, 2));
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
await writeFile(
  path.join("evals/results", `citation-web-note-yield-${label}-${stamp}.json`),
  /* Without the extracts: those are other sites' text, kept only in --work. */
  JSON.stringify({ summary, rows: out.map((r) => ({ ...r, results: ((r.results as { url: string; title: string | null }[] | undefined) ?? []).map((p) => ({ url: p.url, title: p.title })) })) }, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
process.exit(0);
