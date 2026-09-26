/**
 * **Is the new prompt actually plainer, and did it get vaguer on the way?**
 * docs/plans/260926a-plainer-summaries-and-glossary.md § The eval.
 *
 * ```
 * npx tsx evals/plain-words/run.ts list                                   # local slugs, free
 * npx tsx evals/plain-words/run.ts generate --arm before   <slug>...      # paid
 * npx tsx evals/plain-words/run.ts generate --arm before-2 <slug>...      # the same prompt again: the wobble
 * npx tsx evals/plain-words/run.ts generate --arm after    <slug>...
 * npx tsx evals/plain-words/run.ts report                                 # free: per arm, and each arm against `before`
 * npx tsx evals/plain-words/run.ts pairs --a before --b after             # free: a blind side-by-side, and its key
 * ```
 *
 * **The arms are separated in time, not in code.** `generate` always sends the
 * prompt production sends *now* — `structureRequest` and `generateGlossary`,
 * the same functions the pipeline calls — so `before` is run on the commit
 * before the prompt change and `after` on the commit with it. There is no copy
 * of either prompt in here to drift. `before-2` is a second sample of the same
 * prompt, so a before/after gap can be read against the gap between two runs of
 * one prompt.
 * New arms also record SHA-256 hashes of the two source files containing those
 * prompts. The first seven arms predate that guard, so their exact intermediate
 * prompt bytes are not recoverable from the result JSON alone.
 *
 * **What it reads and writes.** It reads articles from the local database,
 * read-only, and writes nothing there beyond the AI-spend rows every call
 * records. Output is JSON under `evals/results/plain-words/<arm>/`.
 *
 * **What the number cannot say.** The hard-word share rewards shorter, commoner
 * words, and a vaguer sentence has those too. So it is a screen — it must fall —
 * and never the evidence that a line is better. That comes from the blind pairs,
 * read for fidelity as well as plainness.
 *
 * Only the **structure call** is measured for summaries: it writes the root,
 * depth-1 and depth-2 gists and the root and depth-1 questions. The raw answer
 * is not assembled into a tree (no range repair), but each question goes
 * through production's own `questionFor`, so a line production would drop is
 * dropped here too. The deepening cascade (`EXPAND_SYSTEM`) gets the same rule
 * and is not exercised.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadEnvLocal } from "../../src/env.js";
import { COMMON_WORDS } from "./common-words.js";

const OUT = path.join(import.meta.dirname, "..", "results", "plain-words");

export interface Line {
  depth: number;
  /** The node's block range, `first..last` — what pairs a node across arms. */
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

interface Entry {
  name: string;
  aliases?: string[];
  senseHere?: string;
  background?: string;
}

interface ArmFile {
  arm: string;
  slug: string;
  summaries: Line[];
  glossary: Entry[];
}

/* ---------------------------------------------------------- the metric -- */

/** Unicode letters, with an inner apostrophe or hyphen: "Möbius", "non-specialist", "author's". */
const WORD = /\p{L}[\p{L}\p{M}]*(?:['’-]\p{L}[\p{L}\p{M}]*)*/gu;

export function wordsIn(text: string): string[] {
  return [...text.matchAll(WORD)].map((m) => m[0]);
}

/**
 * A word is common if it, or a plain inflection of it, is on the list. Case is
 * folded, so an acronym ("PID", "ML") is judged as the word it spells, and
 * almost none of them spell a common one. A hyphenated compound is common when
 * every part is.
 */
export function isCommon(word: string): boolean {
  const w = word.toLowerCase().replace(/’/g, "'");
  if (w.includes("-")) return w.split("-").every((p) => p !== "" && isCommon(p));
  if (COMMON_WORDS.has(w)) return true;
  const stems = [
    w.replace(/'s$/, ""),
    w.replace(/s$/, ""),
    w.replace(/es$/, ""),
    w.replace(/ies$/, "y"),
    w.replace(/ied$/, "y"),
    w.replace(/ed$/, ""),
    w.replace(/ed$/, "e"),
    w.replace(/d$/, ""),
    w.replace(/ing$/, ""),
    w.replace(/ing$/, "e"),
    w.replace(/ly$/, ""),
    w.replace(/er$/, ""),
    w.replace(/est$/, ""),
  ];
  return stems.some((s) => s !== w && s.length > 1 && COMMON_WORDS.has(s));
}

export function hardShare(texts: readonly string[]): { words: number; hard: number; share: number; top: string[] } {
  let words = 0;
  let hard = 0;
  const seen = new Map<string, number>();
  for (const t of texts) {
    for (const w of wordsIn(t)) {
      words++;
      if (!isCommon(w)) {
        hard++;
        const k = w.toLowerCase();
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
    }
  }
  const top = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w, n]) => `${w}×${n}`);
  return { words, hard, share: words === 0 ? 0 : hard / words, top };
}

/* ---------------------------------------------------------- the fields -- */

type Field = "root gist" | "d1 gist" | "d2+ gist" | "root question" | "d1 question" | "senseHere" | "background";
const FIELDS: Field[] = ["root gist", "d1 gist", "d2+ gist", "root question", "d1 question", "senseHere", "background"];

/** The ceiling each field's prompt sets, in words. The d2+ floor (22) is not checked. */
const LIMIT: Partial<Record<Field, number>> = {
  "root gist": 18,
  "d1 gist": 25,
  "d2+ gist": 32,
  "root question": 20,
  "d1 question": 20,
};

/** Every line of one field, keyed so the same node or term pairs across arms. */
function fieldLines(r: ArmFile): Map<Field, Map<string, string>> {
  const out = new Map<Field, Map<string, string>>(FIELDS.map((f) => [f, new Map()]));
  for (const l of r.summaries) {
    const key = `${r.slug} ${l.depth} ${l.range}`;
    if (l.gist) out.get(l.depth === 0 ? "root gist" : l.depth === 1 ? "d1 gist" : "d2+ gist")!.set(key, l.gist);
    if (l.question) out.get(l.depth === 0 ? "root question" : "d1 question")!.set(key, l.question);
  }
  for (const e of r.glossary) {
    const key = `${r.slug} ${normalName(e.name)}`;
    if (e.senseHere) out.get("senseHere")!.set(key, e.senseHere);
    if (e.background) out.get("background")!.set(key, e.background);
  }
  return out;
}

function normalName(n: string): string {
  return n.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function readArm(arm: string): ArmFile[] {
  const dir = path.join(OUT, arm);
  if (!fs.existsSync(dir)) throw new Error(`no arm ${arm} under ${OUT}`);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as ArmFile);
}

function armFields(arm: string): Map<Field, Map<string, string>> {
  const merged = new Map<Field, Map<string, string>>(FIELDS.map((f) => [f, new Map()]));
  for (const r of readArm(arm)) for (const [f, m] of fieldLines(r)) for (const [k, v] of m) merged.get(f)!.set(k, v);
  return merged;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function report(): void {
  const arms = fs.readdirSync(OUT).filter((d) => fs.statSync(path.join(OUT, d)).isDirectory()).sort();
  if (!arms.includes("before")) throw new Error(`no "before" arm under ${OUT}`);
  const base = armFields("before");
  for (const arm of arms) {
    const f = armFields(arm);
    console.log(`\n== ${arm}: ${readArm(arm).map((r) => r.slug).join(", ")}`);
    console.log("field          n  words/line  over-limit  hard-share  | matched to before: n  hard before→this   top hard words");
    const overs: string[] = [];
    for (const field of FIELDS) {
      const lines = [...f.get(field)!.values()];
      const h = hardShare(lines);
      const per = lines.length ? (h.words / lines.length).toFixed(1) : "-";
      const limit = LIMIT[field];
      const over = limit === undefined ? [] : lines.filter((l) => wordsIn(l).length > limit);
      for (const l of over) overs.push(`  ${field} (${wordsIn(l).length} > ${limit}): ${l}`);
      /* Matched: only the keys both arms have, so a gap is not two different sets of nodes. */
      const keys = [...f.get(field)!.keys()].filter((k) => base.get(field)!.has(k));
      const hb = hardShare(keys.map((k) => base.get(field)!.get(k)!));
      const ht = hardShare(keys.map((k) => f.get(field)!.get(k)!));
      console.log(
        `${field.padEnd(13)} ${String(lines.length).padStart(3)}  ${per.padStart(9)}  ${String(limit === undefined ? "-" : over.length).padStart(10)}  ${pct(h.share).padStart(10)}  | ${String(keys.length).padStart(20)}  ${`${pct(hb.share)}→${pct(ht.share)}`.padStart(16)}   ${h.top.join(" ")}`,
      );
    }
    glossaryScreens(arm);
    if (overs.length) console.log(`over the prompt's word limit:\n${overs.join("\n")}`);
  }
}

/**
 * **Two screens for the glossary that a gloss cannot flatter.** A share falls
 * when an entry adds common words around the same hard ones, so these count
 * instead: (i) hard word *types* in the first sentence of the field, not
 * counting the entry's own name and aliases; (ii) cross-references — how many
 * OTHER entries' names or aliases the field uses, which is Greg's complaint
 * exactly (one hard word explained with another). Zero is the target for both.
 */
function firstSentenceOverrun(field: "senseHere" | "background", name: string, first: string, words: number): string[] {
  if (words <= 20) return [];
  return [`    ${field} (${words} > 20), ${name}: ${first}`];
}

function glossaryScreens(arm: string): void {
  /* A fused name ("X and Y", "X, Y") combines separate things under one entry.
     Aliases can preserve their underlines, but not the one-entry-per-thing
     contract — glossary.md § Name the thing, not the topic. A rule that
     punishes leaning on another entry invites exactly this merge. */
  const entries = readArm(arm).flatMap((r) => r.glossary);
  const fused = entries.filter((e) => /\sand\s|,/i.test(e.name)).map((e) => e.name);
  console.log(`  entries: ${entries.length}; with background: ${entries.filter((e) => e.background).length}; fused names: ${fused.length}${fused.length ? ` (${fused.join("; ")})` : ""}`);
  for (const field of ["senseHere", "background"] as const) {
    let n = 0;
    let firstWords = 0;
    let firstHard = 0;
    let crossRefs = 0;
    let clean = 0;
    const overFirst: string[] = [];
    for (const r of readArm(arm)) {
      const others = r.glossary.map((e) => ({ e, forms: [e.name, ...(e.aliases ?? [])].map(normalName).filter((f) => f.length > 2) }));
      for (const { e } of others) {
        const text = e[field];
        if (!text) continue;
        n++;
        const own = new Set([e.name, ...(e.aliases ?? [])].flatMap((f) => wordsIn(f).map((w) => w.toLowerCase())));
        const first = text.split(/(?<=[.!?])\s+/)[0] ?? text;
        const ws = wordsIn(first);
        firstWords += ws.length;
        overFirst.push(...firstSentenceOverrun(field, e.name, first, ws.length));
        const hard = new Set(ws.map((w) => w.toLowerCase()).filter((w) => !own.has(w) && !isCommon(w)));
        firstHard += hard.size;
        const body = ` ${normalName(text)} `;
        const refs = others.filter((o) => o.e !== e && o.forms.some((f) => body.includes(` ${f} `))).length;
        crossRefs += refs;
        if (hard.size === 0 && refs === 0) clean++;
      }
    }
    if (n === 0) continue;
    console.log(
      `  ${field}: first sentence ${(firstWords / n).toFixed(1)} words, ${overFirst.length}/${n} over 20, ${(firstHard / n).toFixed(2)} hard types; ${(crossRefs / n).toFixed(2)} other entries leaned on; ${clean}/${n} clean on both`,
    );
    if (overFirst.length) console.log(`  over the first-sentence limit:\n${overFirst.join("\n")}`);
  }
}

/* ---------------------------------------------------------- the pairs -- */

/** The deterministic side shuffle used by `pairs`. */
export function blindCoin(seed = 260926): () => boolean {
  return () => {
    /* `Math.imul` keeps the multiply in 32-bit integer arithmetic. A plain
       JavaScript multiply loses the low bits here after the first draw, which
       made the old "coin" return true once and false forever. Read a high bit,
       rather than the alternating low bit of this LCG. */
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed < 0x8000_0000;
  };
}

/**
 * **A blind side-by-side of two arms**, matched by node range and term name.
 * Which side is which is decided per pair by a seeded coin, and written to a
 * separate key file so the reader of the pairs cannot see it.
 */
function pairs(a: string, b: string): void {
  const fa = armFields(a);
  const fb = armFields(b);
  const coin = blindCoin();
  const out: string[] = [
    `# Blind pairs: ${a} vs ${b}`,
    "",
    "For each pair: which line would a curious reader from OUTSIDE this field understand more easily,",
    "and did either one lose, bend or blur a claim the other makes? Answer per pair: `n: X|Y|same; fidelity: ok|X lost …|Y lost …`.",
    "",
  ];
  const key: string[] = [];
  let n = 0;
  for (const field of FIELDS) {
    out.push(`## ${field}`, "");
    for (const [k, va] of fa.get(field)!) {
      const vb = fb.get(field)!.get(k);
      if (vb === undefined) continue;
      n++;
      const flip = coin();
      out.push(`${n}. \`${k}\``, `   - X: ${flip ? vb : va}`, `   - Y: ${flip ? va : vb}`, "");
      key.push(`${n}\t${field}\tX=${flip ? b : a}\tY=${flip ? a : b}`);
    }
  }
  const unmatched = FIELDS.map((f) => `${f}: ${[...fa.get(f)!.keys()].filter((k) => !fb.get(f)!.has(k)).length} only in ${a}, ${[...fb.get(f)!.keys()].filter((k) => !fa.get(f)!.has(k)).length} only in ${b}`);
  const pairsFile = path.join(OUT, `pairs-${a}-vs-${b}.md`);
  const keyFile = path.join(OUT, `pairs-${a}-vs-${b}.key.tsv`);
  const judgedFile = path.join(OUT, `pairs-${a}-vs-${b}.judged.txt`);
  const existingOutputs = [pairsFile, keyFile, judgedFile].filter((file) => fs.existsSync(file));
  if (existingOutputs.length) {
    throw new Error(
      `refusing to overwrite an existing blind read:\n${existingOutputs.map((file) => `  ${path.relative(process.cwd(), file)}`).join("\n")}\ngenerate a new arm name instead`,
    );
  }
  fs.writeFileSync(pairsFile, `${out.join("\n")}\n`);
  fs.writeFileSync(keyFile, `${key.join("\n")}\n`);
  console.log(`${n} pairs → ${path.relative(process.cwd(), pairsFile)} (key: ${path.relative(process.cwd(), keyFile)})`);
  console.log(`unmatched:\n  ${unmatched.join("\n  ")}`);
}

/* ------------------------------------------------------------ generate -- */

async function generate(arm: string, slugs: string[]): Promise<void> {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const { questionFor, structureRequest } = await import("../../src/hierarchy.js");
  const { PROMPT_VERSION: TOC_VERSION } = await import("../../src/hierarchy-prompt.js");
  const { splitBlocks } = await import("../../src/supplement.js");
  const { streamMessage } = await import("../../src/messages-stream.js");
  const { parseJsonFrom, stripFence } = await import("../../src/parse-json.js");
  const { generateGlossary, PROMPT_VERSION: GLOSSARY_VERSION } = await import("../../src/glossary.js");
  const sourceSha256 = Object.fromEntries(
    ["hierarchy.ts", "glossary.ts"].map((file) => [
      file,
      createHash("sha256")
        .update(fs.readFileSync(path.join(import.meta.dirname, "..", "..", "src", file)))
        .digest("hex"),
    ]),
  );

  function flatten(node: ModelNode, depth: number, out: Line[]): Line[] {
    /* The question through production's own filter, so a line production would
       drop or normalise is measured the way the reader would see it. */
    const question = questionFor(node as Parameters<typeof questionFor>[0], depth);
    out.push({
      depth,
      range: `${node.range[0]}..${node.range[1]}`,
      title: node.title,
      ...(node.gist?.trim() ? { gist: node.gist.trim() } : {}),
      ...(question ? { question } : {}),
    });
    for (const c of node.children ?? []) flatten(c, depth + 1, out);
    return out;
  }

  fs.mkdirSync(path.join(OUT, arm), { recursive: true });
  await runAsOwner(environmentOwnerId(), async () => {
    for (const slug of slugs) {
      const out = path.join(OUT, arm, `${slug}.json`);
      if (fs.existsSync(out)) {
        throw new Error(`refusing to overwrite existing arm output ${path.relative(process.cwd(), out)}`);
      }
      console.log(`${arm}: ${slug} (${TOC_VERSION}, ${GLOSSARY_VERSION})`);
      const article = await loadArticle(slug);
      const summaries = async (): Promise<Line[]> => {
        const { body } = splitBlocks(article.blocks);
        const { params } = structureRequest(body);
        const message = await streamMessage("hierarchy", params, {}).finalMessage();
        const raw = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
        const { root } = parseJsonFrom<{ root: ModelNode }>(stripFence(raw), "plain-words structure answer");
        return flatten(root, 0, []);
      };
      const glossary = async (): Promise<Entry[]> => {
        const run = await generateGlossary({ article: { ...article, slug }, previous: null, profile: null });
        return run.glossary.entries.map((e) => ({
          name: e.name,
          aliases: e.aliases,
          ...(e.senseHere ? { senseHere: e.senseHere } : {}),
          ...(e.background ? { background: e.background } : {}),
        }));
      };
      const [s, g] = await Promise.all([summaries(), glossary()]);
      fs.writeFileSync(
        out,
        `${JSON.stringify({ arm, slug, tocVersion: TOC_VERSION, glossaryVersion: GLOSSARY_VERSION, sourceSha256, at: new Date().toISOString(), summaries: s, glossary: g }, null, 2)}\n`,
      );
      console.log(`  wrote ${path.relative(process.cwd(), out)}: ${s.length} nodes, ${g.length} glossary entries`);
    }
  });
}

/* ------------------------------------------------------------------ main -- */

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (name: string) => {
    const at = rest.indexOf(name);
    return at >= 0 ? rest[at + 1] : undefined;
  };
  if (cmd === "list") {
    loadEnvLocal();
    const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
    const { listArticles } = await import("../../src/store/index.js");
    await runAsOwner(environmentOwnerId(), async () => {
      for (const a of await listArticles()) console.log(a.slug, "\t", (a as { title?: string }).title ?? "");
    });
  } else if (cmd === "generate") {
    const arm = flag("--arm");
    if (!arm || !/^(before|after)(-\d+)?$/.test(arm)) throw new Error("generate needs --arm before|after[-N]");
    const at = rest.indexOf("--arm");
    const slugs = rest.filter((_, i) => i !== at && i !== at + 1);
    if (slugs.length === 0) throw new Error("generate needs at least one slug");
    await generate(arm, slugs);
  } else if (cmd === "report") {
    report();
  } else if (cmd === "pairs") {
    const a = flag("--a");
    const b = flag("--b");
    if (!a || !b) throw new Error("pairs needs --a <arm> --b <arm>");
    pairs(a, b);
  } else {
    throw new Error("usage: run.ts list | generate --arm before|after[-N] <slug>... | report | pairs --a <arm> --b <arm>");
  }
}
