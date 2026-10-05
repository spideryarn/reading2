/**
 * **Does each paper source's rule fetch the paper, on the real sites?**
 *
 *   npx tsx evals/paper-sources/resolve-live.ts [--out=<file>] [--only=<source>]
 *
 * For each landing address of the sources plan 261005m builds (the arXiv
 * mirrors, ACL Anthology, PMLR, NeurIPS, CVF, JMLR): `resolvePaperSource`, then
 * the fetch step's own loop, `fetchFirstCandidate`, over the real
 * `fetchDocument` with every defence on. It prints which source answered, how
 * many candidates were asked, what arrived, and the check the plan's rule G1
 * needs: **`urlKey` of the address the fetch ended on equals the paper's key**,
 * so the article is found again by a second paste.
 *
 * Free: no model, no database. One request at a time, at least 3 s between
 * requests to one host, and a paper whose candidates were already fetched is
 * not fetched again (several pasted shapes name one arXiv PDF). What a site
 * sends is data to measure, never anything to act on.
 *
 * The landing addresses come from cases.json, the measurement behind
 * docs/research/261005e-where-a-reader-s-paper-link-points-the-other-sources-measured-and-ranked.md,
 * plus `EXTRA` below: the shapes that measurement did not cover (GPT Sol's G9).
 *
 * Exit code 1 when any row does not end on a PDF with the key check true.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchDocument } from "../../src/fetch.js";
import { urlKey } from "../../src/ingest.js";
import { declaredFailure } from "../../src/job-failure.js";
import { codeOfMessage } from "../../src/messages.js";
import { resolvePaperSource } from "../../src/paper-sources.js";
import { fetchFirstCandidate } from "../../src/pipeline.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

/** cases.json's name for a source → the registry's. */
const MEASURED: Record<string, string> = {
  "huggingface-papers": "arxiv",
  alphaxiv: "arxiv",
  aclanthology: "acl",
  pmlr: "pmlr",
  neurips: "neurips",
  cvf: "cvf",
  jmlr: "jmlr",
};

interface Case {
  label: string;
  wants: string;
  url: string;
}

const NEURIPS = "https://proceedings.neurips.cc/paper_files/paper";

/** What the first measurement did not cover. */
const EXTRA: Case[] = [
  { label: "alphaXiv /overview/", wants: "arxiv", url: "https://www.alphaxiv.org/overview/1706.03762" },
  { label: "ACL old-style id by its DOI", wants: "acl", url: "https://doi.org/10.18653/v1/N19-1423" },
  { label: "ACL old-style id, lower case", wants: "acl", url: "https://aclanthology.org/n19-1423/" },
  {
    label: "NeurIPS 2023 -Conference",
    wants: "neurips",
    url: `${NEURIPS}/2023/hash/0001ca33ba34ce0351e4612b744b3936-Abstract-Conference.html`,
  },
  {
    label: "NeurIPS 2023 -Datasets_and_Benchmarks",
    wants: "neurips",
    url: `${NEURIPS}/2023/hash/00ba06ba5c324efdfb068865ca44cf0b-Abstract-Datasets_and_Benchmarks.html`,
  },
  {
    label: "NeurIPS old host and path",
    wants: "neurips",
    url: "https://papers.nips.cc/paper/2017/hash/3f5ee243547dee91fbd053c1c4a845aa-Abstract.html",
  },
  { label: "PMLR flat layout, by its PDF", wants: "pmlr", url: "https://proceedings.mlr.press/v37/ioffe15.pdf" },
  { label: "JMLR on www.", wants: "jmlr", url: "https://www.jmlr.org/papers/v12/pedregosa11a.html" },
  { label: "JMLR numbered name", wants: "jmlr", url: "https://jmlr.org/papers/v22/20-1061.html" },
];

const measured = (
  JSON.parse(readFileSync(join(HERE, "cases.json"), "utf8")) as { source: string; label: string; landingUrl: string }[]
)
  .filter((c) => c.source in MEASURED)
  .map((c): Case => ({ label: c.label, wants: MEASURED[c.source] as string, url: c.landingUrl }));

const cases = [...measured, ...EXTRA].filter((c) => only === undefined || c.wants === only);

const lastAsked = new Map<string, number>();
const GAP_MS = 3_000;

/** The real fetcher, after waiting out the gap for the candidate's host. */
async function politeFetch(url: string, options: { signal: AbortSignal }) {
  const host = new URL(url).host;
  const wait = (lastAsked.get(host) ?? 0) + GAP_MS - Date.now();
  if (wait > 0) await new Promise((done) => setTimeout(done, wait));
  try {
    return await fetchDocument(url, options);
  } finally {
    lastAsked.set(host, Date.now());
  }
}

interface Outcome {
  tried: number;
  result: string;
  ok: boolean;
}

/** One fetch per paper: keyed by the candidates, which is what would be asked for. */
const fetched = new Map<string, Outcome>();

async function outcomeFor(key: string, candidates: readonly { url: string; expect: "html" | "pdf" }[]): Promise<Outcome> {
  const signal = new AbortController().signal;
  let asked = 0;
  try {
    const { doc, tried } = await fetchFirstCandidate(candidates, {
      signal,
      fetchDocument: (url, options) => {
        asked += 1;
        return politeFetch(url, options);
      },
    });
    const bytes = doc.kind === "pdf" ? doc.bytes.byteLength : Buffer.byteLength(doc.text);
    const same = urlKey(doc.url) === key;
    return {
      tried,
      ok: doc.kind === "pdf" && same,
      result: `${doc.kind} ${bytes} bytes; ended on ${doc.url}; urlKey(end) === key: ${same}`,
    };
  } catch (err) {
    const code = codeOfMessage(declaredFailure(err)?.message ?? "") ?? "undeclared";
    return { tried: asked, ok: false, result: `FAILED [${code}] ${(err as Error).message}` };
  }
}

const lines: string[] = [
  `resolve-live, ${new Date().toISOString()}`,
  "pasted address | source | candidates asked | what arrived | does urlKey of the address it ended on equal the paper's key",
  "",
];
let bad = 0;

for (const c of cases) {
  const paper = resolvePaperSource(c.url);
  let line: string;
  if (paper === null || paper.source !== c.wants) {
    bad += 1;
    line = `NOT OK  ${c.label}\n        ${c.url}\n        resolved to ${paper?.source ?? "nothing"}, wanted ${c.wants}`;
  } else {
    const id = paper.candidates.map((candidate) => candidate.url).join(" ");
    const seen = fetched.get(id);
    const outcome = seen ?? (await outcomeFor(paper.key, paper.candidates));
    fetched.set(id, outcome);
    if (!outcome.ok) bad += 1;
    line =
      `${outcome.ok ? "ok    " : "NOT OK"}  ${c.label}\n` +
      `        ${c.url}\n` +
      `        source ${paper.source}; key ${paper.key}; slug ${paper.slug}\n` +
      `        asked ${outcome.tried} of ${paper.candidates.length}${seen ? " (the same candidates as a row above: not fetched again)" : ""}\n` +
      `        ${outcome.result}`;
  }
  console.log(line);
  lines.push(line);
}

const verdict = `\n${cases.length} cases, ${cases.length - bad} ok, ${bad} not ok`;
console.log(verdict);
lines.push(verdict);
if (out !== undefined) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${lines.join("\n")}\n`);
}
process.exitCode = bad === 0 ? 0 : 1;
