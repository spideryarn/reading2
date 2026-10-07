/**
 * **Do the whole-piece modes leave the paperwork out?** —
 * docs/plans/261003d-paperwork-in-every-whole-piece-mode.md § Measuring it.
 *
 * ```
 * npx tsx evals/paperwork/modes.ts generate --arm before   <slug>...   # paid, on the parent commit
 * npx tsx evals/paperwork/modes.ts generate --arm before-2 <slug>...   # the same prompt again: the wobble
 * npx tsx evals/paperwork/modes.ts generate --arm after    <slug>...   # paid, on the commit with the change
 * npx tsx evals/paperwork/modes.ts report                              # free: the screens, per arm
 * npx tsx evals/paperwork/modes.ts pairs --a before --b after-2        # free: a blind side-by-side, and its key
 * ```
 *
 * The arms are separated in time, not in code, as in evals/paperwork/run.ts: `generate` calls each
 * mode's production `generate*` (no profile, standard power) and records a source fingerprint
 * (evals/plain-words/source-fingerprint.ts) beside the answer. Illustrated is given the same arm's sketch and a stub painter, so only
 * its brief is paid for.
 *
 * **The screen.** `itemsOf` knows where each mode keeps its anchors: passages, evidence,
 * occurrences, a quote's block, a glossary entry's computed blocks, a sketch node or vignette's
 * block, or an Arc entry's range. An item whose anchors are all in `PAPERWORK` below is a paperwork
 * item. Prose with no anchor — captions, plate titles and image prompts — is screened by the
 * `PAPERWORK_WORDS` regex from run.ts instead, and every hit is printed to be read. A screen, not
 * the evidence.
 *
 * Reads the local database, writes nothing there beyond the `ai_calls` rows every call records.
 * Output under `evals/results/paperwork-modes/<arm>/`.
 */

import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../../src/env.js";
import { admitExclusions, type Exclusion, PAPERWORK as PAPERWORK_WORDS } from "./run.js";
import { blindCoin } from "../plain-words/run.js";
import { sourceFingerprint } from "../plain-words/source-fingerprint.js";

const REPO = path.join(import.meta.dirname, "..", "..");
const OUT = path.join(REPO, "evals", "results", "paperwork-modes");

/**
 * **Each paper's paperwork, by block id**, read by hand from the local blocks: the title block,
 * authors, affiliations, correspondence, dates, keywords, and the closing statements and reference
 * heading. The abstract is not paperwork. `scaling-hypothesis` has none to mark: it is the
 * boundary case, where OpenAI's funding is the argument, and is read by hand.
 */
export const PAPERWORK: Record<string, readonly string[]> = {
  "entropy-24-00930-spya-pywwkq": [
    "spya-ekjksy", "spya-edcccm", "spya-mt3bd6", "spya-y66sc5",
    "spya-xxjenw", "spya-r2n8q4", "spya-w58dm6", "spya-pnjdke", "spya-gajhn8",
  ],
  "source-spya-f550ta": [
    "spya-ncu3br", "spya-a78j46", "spya-fdhbc4", "spya-km36dw", "spya-z5sy7j", "spya-wz5tp8",
    "spya-yp8uzp", "spya-hmaju2", "spya-uwwn77", "spya-x4e2cg", "spya-rcbx2w",
  ],
  "analog-cognition-and-consciousness-4-28-26-spya-f03kqf": [
    "spya-ac3022", "spya-a4brsd", "spya-xjmw8e", "spya-fptvt6", "spya-c65bhn", "spya-jzm2f5",
    "spya-nvcvg4", "spya-pd4bk8", "spya-rmrvzr", "spya-yqq2ck", "spya-dxrj27", "spya-sq6h79",
  ],
};

const MODES = ["sketch", "illustrated", "faq", "quiz", "ideas", "quotes", "glossary", "timeline", "arc"] as const;
type Mode = (typeof MODES)[number];
/** The prompt source files; source-fingerprint.ts adds the shared prompt modules they import. */
export const SOURCES = MODES.map((m) => `${m}.ts`);

export interface ArmFile {
  slug: string;
  arm: string;
  sourceSha256: Record<string, string>;
  outputs: Partial<Record<Mode, unknown>>;
}

const BLOCK_ID = /spya-[a-z0-9]{6}/g;

function failed(x: unknown): x is { error: string } {
  return typeof x === "object" && x !== null && !Array.isArray(x) && "error" in x;
}

/**
 * **One mode's items, each with the blocks it is anchored to** (GPT Sol's plan review, P1-4: one
 * generic walk is not sound). `anchors` is empty for prose with no block — a sketch caption, a
 * plate title, the image prompt — which only the word screen can see. Arc's anchor is its range's
 * two ends: a part is paperwork when both ends are, which a part running from the title block
 * into the abstract is not.
 */
interface Item {
  anchors: string[];
  text: string;
}

// biome-ignore lint/suspicious/noExplicitAny: an eval reading its own JSON back
type J = any;

export function itemsOf(mode: Mode, output: J): Item[] {
  const ids = (x: unknown) => [...new Set(JSON.stringify(x ?? "").match(BLOCK_ID) ?? [])];
  const plain = (text: unknown): Item => ({ anchors: [], text: String(text ?? "") });
  const anchored = (x: J, at: unknown): Item => ({ anchors: ids(at), text: JSON.stringify(x).replace(BLOCK_ID, "") });
  switch (mode) {
    case "sketch": {
      const s = output.sketch;
      return [
        plain(s.title),
        plain(s.caption),
        ...s.scenes.flatMap((sc: J) => [
          plain(sc.caption),
          ...sc.items.filter((i: J) => i.kind === "node").map((i: J) => anchored({ text: i.text }, i.block)),
          ...sc.items.filter((i: J) => i.kind !== "node" && i.text).map((i: J) => plain(i.text)),
        ]),
      ];
    }
    case "illustrated":
      return output.illustrated.plates.flatMap((p: J) => [
        plain(p.title),
        plain(p.prompt),
        ...p.vignettes.map((v: J) => anchored({ quote: v.quote, depicts: v.depicts, title: v.title }, v.block)),
      ]);
    case "faq":
      return output.faq.questions.map((q: J) => anchored(q, q.passages));
    case "quiz":
      return output.quiz.questions.map((q: J) => anchored(q, q.evidence));
    case "ideas":
      return output.ideas.ideas.map((i: J) => anchored(i, i.occurrences));
    case "quotes":
      return output.quotes.quotes.map((q: J) => anchored({ text: q.text, reason: q.reason }, q.blockId));
    case "glossary":
      return output.glossary.entries.map((e: J) => anchored(e, e.blocks));
    case "timeline":
      return output.timeline.events.map((e: J) => anchored(e, e.occurrences));
    case "arc":
      return output.arc.entries.map((e: J) => anchored({ text: e.text }, e.range));
  }
}

async function generate(arm: string, slugs: string[]): Promise<void> {
  loadEnvLocal();
  const sourceSha256 = sourceFingerprint(SOURCES);
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const { closeDb } = await import("../../src/db/client.js");
  const { withLedger } = await import("../../src/cli-ledger.js");
  const { generateSketch } = await import("../../src/sketch.js");
  const { generateIllustrated } = await import("../../src/illustrated.js");
  const { generateFaq } = await import("../../src/faq.js");
  const { generateQuiz } = await import("../../src/quiz.js");
  const { generateIdeas } = await import("../../src/ideas.js");
  const { generateQuotes } = await import("../../src/quotes.js");
  const { generateGlossary } = await import("../../src/glossary.js");
  const { generateTimeline } = await import("../../src/timeline.js");
  const { generateArc } = await import("../../src/arc.js");

  const attempt = async <T>(f: () => Promise<T>): Promise<T | { error: string }> => {
    try {
      return await f();
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };

  fs.mkdirSync(path.join(OUT, arm), { recursive: true });
  /* The ledger closes, and its writes land, before `closeDb` below. */
  await withLedger("eval", () => runAsOwner(environmentOwnerId(), async () => {
    await Promise.all(
      slugs.map(async (slug) => {
        const out = path.join(OUT, arm, `${slug}.json`);
        if (fs.existsSync(out)) throw new Error(`refusing to overwrite ${path.relative(REPO, out)}`);
        const article = { ...(await loadArticle(slug)), slug };
        const power = "standard" as const;
        const [sketch, faq, quiz, ideas, quotes, glossary, timeline, arc] = await Promise.all([
          attempt(() => generateSketch({ article, power })),
          attempt(() => generateFaq({ article, power })),
          attempt(() => generateQuiz({ article, power })),
          attempt(() => generateIdeas({ article, previous: null, power })),
          attempt(() => generateQuotes({ article, previous: null, power })),
          attempt(() => generateGlossary({ article, previous: null, power })),
          attempt(() => generateTimeline({ article, previous: null, power })),
          attempt(() => generateArc({ article, power })),
        ]);
        const illustrated = failed(sketch)
          ? { error: "no sketch" }
          : await attempt(() =>
              generateIllustrated({
                article,
                sketch: (sketch as { sketch: Parameters<typeof generateIllustrated>[0]["sketch"] }).sketch,
                power,
                draw: async () => ({ image: new Uint8Array([0]), mediaType: "image/png", usdCost: 0 }),
              }),
            );
        const file: ArmFile = {
          slug,
          arm,
          sourceSha256,
          outputs: { sketch, illustrated, faq, quiz, ideas, quotes, glossary, timeline, arc },
        };
        fs.writeFileSync(out, JSON.stringify(file, null, 2));
        console.log(`${arm} ${slug}: ${MODES.filter((m) => failed(file.outputs[m])).join(", ") || "all modes"}${MODES.some((m) => failed(file.outputs[m])) ? " FAILED" : " written"}`);
      }),
    );
  }));
  await closeDb();
}

export interface ModeTotal {
  /** Articles the mode was run on, and how many of those runs failed. */
  attempted: number;
  failed: number;
  items: number;
  byId: number;
  byWords: number;
}

/** The screens over a set of arm files: one row per cell, every hit, and the totals per arm and mode. */
export function screenModes(files: ArmFile[]): { rows: string[]; hits: string[]; totals: Record<string, ModeTotal> } {
  const rows: string[] = [];
  const hits: string[] = [];
  const totals: Record<string, ModeTotal> = {};
  for (const file of files) {
    const { arm } = file;
    const marked = new Set(PAPERWORK[file.slug] ?? []);
    for (const mode of MODES) {
      const output = file.outputs[mode];
      const k = `${arm}\t${mode}`;
      const sum = totals[k] ?? { attempted: 0, failed: 0, items: 0, byId: 0, byWords: 0 };
      totals[k] = sum;
      sum.attempted++;
      if (failed(output)) {
        sum.failed++;
        rows.push(`${arm}\t${file.slug}\t${mode}\tERROR ${output.error.slice(0, 60)}`);
        continue;
      }
      const items = itemsOf(mode, output);
      let byId = 0;
      let byWords = 0;
      for (const { anchors, text } of items) {
        if (anchors.length > 0 && marked.size > 0 && anchors.every((id) => marked.has(id))) {
          byId++;
          hits.push(`[id]    ${arm} ${file.slug} ${mode}: ${text.slice(0, 240)}`);
        } else if (PAPERWORK_WORDS.test(text)) {
          byWords++;
          hits.push(`[words] ${arm} ${file.slug} ${mode}: ${text.slice(0, 240)}`);
        }
      }
      rows.push(`${arm}\t${file.slug}\t${mode}\t${items.length}\t${byId}\t${byWords}`);
      sum.items += items.length;
      sum.byId += byId;
      sum.byWords += byWords;
    }
  }
  return { rows, hits, totals };
}

export function report(out: string = OUT): void {
  // Comparisons are sibling directories, but their key/exclusions JSON are not ArmFiles.
  const arms = fs.existsSync(out)
    ? fs.readdirSync(out).filter((d) => !d.startsWith("pairs-") && fs.statSync(path.join(out, d)).isDirectory())
    : [];
  const files = arms.sort().flatMap((arm) =>
    fs
      .readdirSync(path.join(out, arm))
      .filter((x) => x.endsWith(".json"))
      .sort()
      .map((f) => JSON.parse(fs.readFileSync(path.join(out, arm, f), "utf8")) as ArmFile),
  );
  const { rows, hits, totals } = screenModes(files);
  console.log(["arm\tslug\tmode\titems\tpaperwork-by-id\tpaperwork-by-words", ...rows].join("\n"));
  console.log("\nTotals over the articles:\narm\tmode\tattempted\tsucceeded\tfailed\titems\tpaperwork-by-id\tpaperwork-by-words");
  for (const [k, t] of Object.entries(totals).sort()) {
    console.log(`${k}\t${t.attempted}\t${t.attempted - t.failed}\t${t.failed}\t${t.items}\t${t.byId}\t${t.byWords}`);
  }
  console.log("\nEvery hit, to be read:\n");
  console.log(hits.join("\n"));
}

/**
 * **A blind side-by-side of two arms** (GPT Sol's plan review, P2: a pair per mode, not only where
 * the screen fired, because collateral loss shows in clean cells). Mode i is read on article
 * i mod 4, and Arc on every article, since Arc is where the `before` arm showed paperwork.
 */
function pairs(a: string, b: string, partial: boolean): void {
  const coin = blindCoin(261003);
  const slugs = Object.keys(PAPERWORK).concat("scaling-hypothesis");
  const read = (arm: string, slug: string) =>
    JSON.parse(fs.readFileSync(path.join(OUT, arm, `${slug}.json`), "utf8")) as ArmFile;
  const cells: [Mode, string][] = MODES.flatMap((mode, i) =>
    mode === "arc" ? slugs.map((s) => [mode, s] as [Mode, string]) : [[mode, slugs[i % slugs.length]!] as [Mode, string]],
  );
  const lines = [
    "# Blind pairs\n",
    "Each pair is one mode's output for one article, from two versions of its prompt. For each, say (a) which side spends less on the article's paperwork — its title block, authors, affiliations, acknowledgements, funding, disclosures, data statements, references — or tie; (b) whether either side has lost something of the piece's actual content that the other keeps, or bent or invented a claim, naming it; (c) which you would rather a reader got, or tie. Funding or authors that the piece's argument is about are content, not paperwork.\n",
  ];
  const key: { id: string; mode: Mode; slug: string; left: string; right: string }[] = [];
  const render = (mode: Mode, out: unknown) =>
    failed(out) ? null : itemsOf(mode, out).map((it) => `- ${it.text}`).join("\n");
  /* A missing arm file throws in `read`; a failed cell is listed, and refused
     unless --partial, before anything is written. */
  const exclusions: Exclusion[] = cells.flatMap(([mode, slug]) => {
    const why = [a, b].flatMap((arm) => {
      const out = read(arm, slug).outputs[mode];
      return failed(out) ? [`failed in ${arm}: ${out.error}`] : [];
    });
    return why.length > 0 ? [{ slug, field: mode, reason: why.join("; ") }] : [];
  });
  admitExclusions(exclusions, partial);
  for (const [mode, slug] of cells) {
    const xa = render(mode, read(a, slug).outputs[mode]);
    const xb = render(mode, read(b, slug).outputs[mode]);
    if (xa === null || xb === null) continue;
    const id = `P${key.length + 1}`;
    const aLeft = coin();
    key.push({ id, mode, slug, left: aLeft ? a : b, right: aLeft ? b : a });
    lines.push(`## ${id} — ${mode} of \`${slug}\`\n\n### Left\n\n${aLeft ? xa : xb}\n\n### Right\n\n${aLeft ? xb : xa}\n`);
  }
  const dir = path.join(OUT, `pairs-${a}-vs-${b}`);
  if (fs.existsSync(dir)) throw new Error(`refusing to overwrite ${path.relative(REPO, dir)}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "pairs.md"), lines.join("\n"));
  fs.writeFileSync(path.join(dir, "key.json"), `${JSON.stringify(key, null, 2)}\n`);
  if (exclusions.length > 0) fs.writeFileSync(path.join(dir, "exclusions.json"), `${JSON.stringify(exclusions, null, 2)}\n`);
  const leftA = key.filter((k) => k.left === a).length;
  console.log(`${key.length} pairs in ${path.relative(REPO, dir)}; ${a} on the left in ${leftA}, on the right in ${key.length - leftA}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  const at = rest.indexOf("--arm");
  const arm = at >= 0 ? rest[at + 1] : undefined;
  const positional = rest.filter((x, i) => !x.startsWith("--") && rest[i - 1] !== "--arm");
  if (cmd === "generate") {
    if (!arm || !/^[a-z0-9-]+$/.test(arm) || positional.length === 0) throw new Error("generate --arm <arm> <slug>...");
    await generate(arm, positional);
  } else if (cmd === "report") {
    report();
  } else if (cmd === "pairs") {
    const fa = rest[rest.indexOf("--a") + 1];
    const fb = rest[rest.indexOf("--b") + 1];
    if (!rest.includes("--a") || !rest.includes("--b") || !fa || !fb) throw new Error("pairs --a <arm> --b <arm> [--partial]");
    pairs(fa, fb, rest.includes("--partial"));
  } else {
    throw new Error("usage: generate | report (see the header)");
  }
}
