/**
 * **Do the summaries leave the paperwork out, lead with the takeaway, and is
 * Brief shorter?** — docs/plans/261001p-summaries-skip-the-paperwork-and-lead-with-the-takeaway.md
 * § Measuring it.
 *
 * ```
 * npx tsx evals/paperwork/run.ts generate --arm before   <slug>...   # paid
 * npx tsx evals/paperwork/run.ts generate --arm before-2 <slug>...   # the same prompt again: the wobble
 * npx tsx evals/paperwork/run.ts generate --arm after    <slug>...   # paid, on the commit with the change
 * npx tsx evals/paperwork/run.ts report                              # free: the screens, per arm
 * npx tsx evals/paperwork/run.ts pairs --a before --b after          # free: a blind side-by-side, and its key
 * ```
 *
 * **The arms are separated in time, not in code**, as in
 * evals/plain-words/run.ts: `generate` sends what production sends now — the
 * structure call (`wholeDocumentRequest`, its gists and questions, not assembled into a tree),
 * `generateSimpleSummary` (all three levels, no profile) and `generateTweets`
 * (no profile) — and records a hash of each prompt's source file beside the
 * answer. There is no copy of a prompt in here to drift.
 *
 * Reads the local database, writes nothing there beyond the `ai_calls` rows
 * every call records. Output under `evals/results/paperwork/<arm>/`.
 *
 * **What the screen cannot say.** `PAPERWORK` is a regex over the output, so it
 * counts a sentence about a funder in a piece *about* funding as paperwork too.
 * Every hit is printed so it can be read; the count is a screen, never the
 * evidence.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadEnvLocal } from "../../src/env.js";
import { blindCoin } from "../plain-words/run.js";

const REPO = path.join(import.meta.dirname, "..", "..");
/** Results folder. `--set front-matter` keeps 261003c's arms apart from 261001p's. */
let OUT = path.join(REPO, "evals", "results", "paperwork");

/**
 * **Each paper's front abstract, as a block range**, read by hand from the local
 * blocks for docs/plans/261003c-summary-and-structure-skip-the-front-matter.md:
 * from the abstract's first block to the last block before the body begins, so
 * a trailing keywords line (entropy-24) or the publisher's "Similar content" box
 * (s41598) is inside it. scaling-hypothesis's abstract is its one-paragraph
 * dek; the blockquote after it is body. A paper not listed is not counted.
 */
const ABSTRACT: Record<string, [string, string]> = {
  "analog-cognition-and-consciousness-4-28-26-spya-f03kqf": ["spya-c5z6sr", "spya-d238cn"],
  "entropy-24-00930-spya-pywwkq": ["spya-xn9j9k", "spya-y66sc5"],
  "scaling-hypothesis": ["spya-suzdvz", "spya-suzdvz"],
  "s41598-023-33209-9-spya-s0qydm": ["spya-wrnsf9", "spya-anyy22"],
};

/** Node titles that name front or back matter. A screen, printed so it can be read. */
const FRONT_OR_BACK = /\b(abstract|title|byline|keywords?|references?|bibliograph\w*|works cited|backlinks?)\b/i;
const SOURCES = ["structure.ts", "simple-summary.ts", "tweets.ts", "paperwork.ts"];

/** Words that mark a line as being about the paperwork rather than the piece. A screen. */
export const PAPERWORK =
  /\b(affiliat\w*|universit\w*|institut\w*|college|hospital|acknowledg\w*|thank\w*|fund\w*|grant\w*|conflicts? of interest|competing interests?|disclos\w*|declar\w*|honorari\w*|consult\w*|correspondence|e-?mail|ethic\w* (approval|committee)|data availab\w*)\b/i;

interface Line {
  depth: number;
  range: string;
  title: string;
  gist?: string;
  question?: string;
}

interface ModelNode {
  title: string;
  range: [string, string];
  gist?: string;
  question?: string;
  children?: ModelNode[];
}

interface ArmFile {
  arm: string;
  slug: string;
  at: string;
  sourceSha256: Record<string, string>;
  versions: { toc: string; tweets: string; simple: string };
  gists: Line[] | { error: string };
  simple: { brief: string[]; simple: string[]; fuller: string[] } | { error: string };
  /** Each paragraph's ids, per level; absent in results written before 261003c. */
  simpleIds?: { brief: string[][]; simple: string[][]; fuller: string[][] };
  /** Every block id's position in the article, for the abstract screen. */
  ordinals?: Record<string, number>;
  tweets: string[] | { error: string };
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function failed(x: unknown): x is { error: string } {
  return typeof x === "object" && x !== null && !Array.isArray(x) && "error" in x;
}

async function generate(arm: string, slugs: string[]): Promise<void> {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const { parseWholeDocumentAnswer, wholeDocumentRequest } = await import("../../src/structure.js");
  const { PROMPT_VERSION: TOC_VERSION } = await import("../../src/structure-prompt.js");
  const { splitBlocks } = await import("../../src/supplement.js");
  const { streamMessage } = await import("../../src/messages-stream.js");
  const simple = await import("../../src/simple-summary.js");
  const tweets = await import("../../src/tweets.js");
  const { collectSpend } = await import("../../src/ai-spend.js");
  const { costStore } = await import("../../src/store/ai-calls.js");
  const { closeDb } = await import("../../src/db/client.js");

  const sourceSha256 = Object.fromEntries(
    SOURCES.filter((f) => fs.existsSync(path.join(REPO, "src", f))).map((f) => [
      f,
      createHash("sha256").update(fs.readFileSync(path.join(REPO, "src", f))).digest("hex"),
    ]),
  );

  function flatten(node: ModelNode, depth: number, out: Line[]): Line[] {
    out.push({
      depth,
      range: `${node.range[0]}..${node.range[1]}`,
      title: node.title,
      ...(node.gist?.trim() ? { gist: node.gist.trim() } : {}),
      ...(node.question?.trim() ? { question: node.question.trim() } : {}),
    });
    for (const c of node.children ?? []) flatten(c, depth + 1, out);
    return out;
  }

  const attempt = async <T>(f: () => Promise<T>): Promise<T | { error: string }> => {
    try {
      return await f();
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };

  fs.mkdirSync(path.join(OUT, arm), { recursive: true });
  let costNanos = 0;
  await runAsOwner(environmentOwnerId(), async () => {
    await Promise.all(
      slugs.map(async (slug) => {
        const out = path.join(OUT, arm, `${slug}.json`);
        if (fs.existsSync(out)) throw new Error(`refusing to overwrite ${path.relative(REPO, out)}`);
        const article = await loadArticle(slug);
        const withSlug = { ...article, slug };
        const { result } = await collectSpend(
          async () => {
            const [gists, summary, thread] = await Promise.all([
              attempt(async () => {
                const { body } = splitBlocks(article.blocks);
                const { params } = wholeDocumentRequest(body);
                const message = await streamMessage("structure", params, { power: "standard" }).finalMessage();
                const raw = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
                /* Production's own parse (src/structure.ts § `parseJson`), not the
                   strict one evals/plain-words uses: the first `after` run lost two
                   structure answers to a parse production might have mended, and
                   kept nothing to tell. So the raw answer is kept when it fails. */
                try {
                  const { root } = parseWholeDocumentAnswer(raw, body);
                  return flatten(root, 0, []);
                } catch (err) {
                  fs.writeFileSync(path.join(OUT, arm, `${slug}.structure-raw.txt`), raw);
                  throw err;
                }
              }),
              attempt(async () => {
                const run = await simple.generateSimpleSummary({ article: withSlug, profile: null, power: "standard" });
                const texts = (level: "brief" | "simple" | "fuller") =>
                  run.simpleSummary.levels[level].map((p) => p.text);
                const ids = (level: "brief" | "simple" | "fuller") =>
                  run.simpleSummary.levels[level].map((p) => [...p.ids]);
                return {
                  texts: { brief: texts("brief"), simple: texts("simple"), fuller: texts("fuller") },
                  ids: { brief: ids("brief"), simple: ids("simple"), fuller: ids("fuller") },
                };
              }),
              attempt(async () => {
                const run = await tweets.generateTweets({ article: withSlug, profile: null, power: "standard" });
                return run.thread.tweets.map((t) => t.text);
              }),
            ]);
            return { gists, summary, thread };
          },
          {
            attribution: { scopeKind: "eval", ownerId: environmentOwnerId() },
            sink: (row) => costStore.record(row),
            onDone: (report) => {
              for (const c of (report as { calls: { cost: { source: string; costNanos?: number; computedCostNanos?: number } }[] }).calls) {
                costNanos += c.cost.source === "provider" ? (c.cost.costNanos ?? 0) : (c.cost.computedCostNanos ?? 0);
              }
            },
          },
        );
        const file: ArmFile = {
          arm,
          slug,
          at: new Date().toISOString(),
          sourceSha256,
          versions: {
            toc: TOC_VERSION,
            tweets: tweets.PROMPT_VERSION,
            simple: simple.SIMPLE_PROMPT_VERSION,
          },
          gists: result.gists,
          simple: failed(result.summary) ? result.summary : result.summary.texts,
          ...(failed(result.summary) ? {} : { simpleIds: result.summary.ids }),
          ordinals: Object.fromEntries(article.blocks.map((b, i) => [b.id, i])),
          tweets: result.thread,
        };
        fs.writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
        const fail = [result.gists, result.summary, result.thread].filter(failed).map((x) => x.error);
        console.log(`${arm} ${slug}: ${fail.length ? `FAILED ${fail.join(" | ")}` : "ok"}`);
      }),
    );
  });
  console.log(`spent $${(costNanos / 1e9).toFixed(3)}`);
  await closeDb();
}

function readArm(arm: string): ArmFile[] {
  const dir = path.join(OUT, arm);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as ArmFile);
}

function report(): void {
  const arms = fs.readdirSync(OUT).filter((d) => fs.statSync(path.join(OUT, d)).isDirectory()).sort();
  for (const arm of arms) {
    console.log(`\n== ${arm}`);
    for (const r of readArm(arm)) {
      const hits: string[] = [];
      let brief = "failed";
      if (!failed(r.simple)) {
        brief = `${words(r.simple.brief.join(" "))} words / ${r.simple.brief.length} paragraphs`;
        for (const level of ["brief", "simple", "fuller"] as const)
          for (const p of r.simple[level]) for (const s of p.split(/(?<=[.!?])\s+/)) if (PAPERWORK.test(s)) hits.push(`summary.${level}: ${s}`);
      }
      if (!failed(r.tweets)) for (const [i, t] of r.tweets.entries()) if (PAPERWORK.test(t)) hits.push(`tweet ${i + 1}/${r.tweets.length}: ${t}`);
      if (!failed(r.gists)) for (const g of r.gists) if (g.gist && PAPERWORK.test(g.gist)) hits.push(`gist d${g.depth}: ${g.gist}`);
      /* Results written before the prompt/shape split recorded `SIMPLE_VERSION`
         here. Do not relabel `simple/2` as a prompt stamp after the fact: the
         source hash is the only exact prompt provenance those files have. */
      const simpleVersion = r.versions.simple.startsWith("simple-prompt/")
        ? r.versions.simple
        : `Simple prompt unknown (legacy result recorded shape ${r.versions.simple})`;
      const abs = ABSTRACT[r.slug];
      let inAbstract = "abstract ids: -";
      if (abs && r.simpleIds && r.ordinals) {
        const lo = r.ordinals[abs[0]];
        const hi = r.ordinals[abs[1]];
        const at = (id: string) => r.ordinals?.[id];
        const isAbstract = (id: string) => lo !== undefined && hi !== undefined && (at(id) ?? -1) >= lo && (at(id) ?? -1) <= hi;
        const parts: string[] = [];
        for (const level of ["brief", "simple", "fuller"] as const) {
          const all = r.simpleIds[level].flat();
          const paras = r.simpleIds[level].filter((ids) => ids.some(isAbstract)).length;
          parts.push(`${level} ${all.filter(isAbstract).length}/${all.length} ids, ${paras}/${r.simpleIds[level].length} paragraphs`);
        }
        inAbstract = `abstract ids: ${parts.join("; ")}`;
      }
      /* **By position, not by title** (GPT Sol's plan review of 261003c, P2-1):
         a node that ends inside the abstract and starts at or before it covers
         only the front matter and the abstract — the nodes the rule labels. A
         node that runs on into the body is not one, whatever it is called.
         Titles are printed beside them only for front- and back-matter names. */
      const frontBack: string[] = [];
      if (!failed(r.gists)) {
        const lo = abs && r.ordinals ? r.ordinals[abs[0]] : undefined;
        const hi = abs && r.ordinals ? r.ordinals[abs[1]] : undefined;
        for (const g of r.gists) {
          if (g.depth === 0) continue;
          const [first, last] = g.range.split("..");
          const end = last && r.ordinals ? r.ordinals[last] : undefined;
          const abstractOnly = lo !== undefined && hi !== undefined && end !== undefined && end >= lo && end <= hi;
          if (!abstractOnly && !FRONT_OR_BACK.test(g.title)) continue;
          const tag = abstractOnly ? "ABSTRACT-ONLY" : "named";
          frontBack.push(`${tag} d${g.depth} "${g.title}" [${first}..${last}]${g.question ? " +question" : ""}: ${g.gist ?? "(no gist)"}`);
        }
      }
      console.log(`${r.slug} (${r.versions.toc}, ${r.versions.tweets}, ${simpleVersion}): Brief ${brief}; simple ${failed(r.simple) ? "-" : words(r.simple.simple.join(" "))}, fuller ${failed(r.simple) ? "-" : words(r.simple.fuller.join(" "))}; ${hits.length} paperwork hits`);
      console.log(`    ${inAbstract}`);
      for (const f of frontBack) console.log(`    ${f}`);
      for (const h of hits) console.log(`    ${h}`);
      for (const f of [r.gists, r.simple, r.tweets]) if (failed(f)) console.log(`    FAILED: ${f.error}`);
    }
  }
}

/** Every changed output against its peer, per article, with sides chosen by a tested coin. */
function pairs(a: string, b: string): void {
  const coin = blindCoin(261001);
  const A = new Map(readArm(a).map((r) => [r.slug, r]));
  const B = new Map(readArm(b).map((r) => [r.slug, r]));
  const lines: string[] = [
    "# Blind pairs\n",
    "For each pair, judge which side (a) spends less on publication paperwork, (b) makes the piece's conclusion or final landing clearer, and (c) better preserves every claim and caveat. For Structure, also check that paperwork-only nodes are neutral labels with no question, while substantive disclosures survive. Record ties and any lost, bent or invented claim.\n",
  ];
  const key: { id: string; left: string; right: string }[] = [];
  let n = 0;
  for (const [slug, ra] of A) {
    const rb = B.get(slug);
    if (!rb) continue;
    const structure = (r: ArmFile): string | null => {
      if (failed(r.gists)) return null;
      return r.gists
        .map((line) => {
          const indent = "  ".repeat(line.depth);
          return [
            `${indent}${line.title} [${line.range}]`,
            ...(line.gist ? [`${indent}  Gist: ${line.gist}`] : []),
            ...(line.question ? [`${indent}  Question: ${line.question}`] : []),
          ].join("\n");
        })
        .join("\n");
    };
    const fields: [string, (r: ArmFile) => string | null][] = [
      ["Structure", structure],
      ["Brief summary", (r) => (failed(r.simple) ? null : r.simple.brief.join("\n\n"))],
      ["Simple summary", (r) => (failed(r.simple) ? null : r.simple.simple.join("\n\n"))],
      ["Fuller summary", (r) => (failed(r.simple) ? null : r.simple.fuller.join("\n\n"))],
      ["Thread", (r) => (failed(r.tweets) ? null : r.tweets.map((t, i) => `${i + 1}. ${t}`).join("\n"))],
    ];
    for (const [label, get] of fields) {
      const xa = get(ra);
      const xb = get(rb);
      if (xa === null || xb === null) continue;
      n++;
      const aLeft = coin();
      const id = `P${n}`;
      key.push({ id, left: aLeft ? a : b, right: aLeft ? b : a });
      lines.push(`## ${id} — ${label} of \`${slug}\`\n\n### Left\n\n${aLeft ? xa : xb}\n\n### Right\n\n${aLeft ? xb : xa}\n`);
    }
  }
  const dir = path.join(OUT, `pairs-${a}-vs-${b}`);
  const pairFile = path.join(dir, "pairs.md");
  const keyFile = path.join(dir, "key.json");
  const existing = [pairFile, keyFile].filter((file) => fs.existsSync(file));
  if (existing.length > 0) {
    throw new Error(
      `refusing to overwrite an existing blind read:\n${existing.map((file) => `  ${path.relative(REPO, file)}`).join("\n")}\nuse new arm names instead`,
    );
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(pairFile, lines.join("\n"));
  fs.writeFileSync(keyFile, `${JSON.stringify(key, null, 2)}\n`);
  const leftA = key.filter((k) => k.left === a).length;
  console.log(`${n} pairs in ${path.relative(REPO, dir)}; ${a} on the left in ${leftA}, on the right in ${n - leftA}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (name: string) => {
    const at = rest.indexOf(name);
    return at >= 0 ? rest[at + 1] : undefined;
  };
  const positional = rest.filter((x, i) => !x.startsWith("--") && !rest[i - 1]?.startsWith("--"));
  const set = flag("--set");
  if (set) {
    if (!/^[a-z0-9-]+$/.test(set)) throw new Error("--set takes a folder name like front-matter");
    OUT = path.join(REPO, "evals", "results", set);
  }
  if (cmd === "generate") {
    const arm = flag("--arm");
    if (!arm || positional.length === 0) throw new Error("generate --arm <arm> <slug>...");
    await generate(arm, positional);
  } else if (cmd === "report") {
    report();
  } else if (cmd === "pairs") {
    const a = flag("--a");
    const b = flag("--b");
    if (!a || !b) throw new Error("pairs --a <arm> --b <arm>");
    pairs(a, b);
  } else {
    throw new Error("usage: generate | report | pairs (see the header)");
  }
}
