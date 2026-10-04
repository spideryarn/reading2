/**
 * **The same question as run.ts, for the answers a reader asks for**: chat,
 * Explain, and the glossary's *Check the web* (which is Explain on the term's
 * own words — src/term-lookup.ts). docs/plans/260926a-plainer-summaries-and-glossary.md
 * § Stage 2.
 *
 * ```
 * npx tsx evals/plain-words/answers.ts generate --arm before     # paid: 18 answers
 * npx tsx evals/plain-words/answers.ts generate --arm before-2   # the old prompts again: the control
 * npx tsx evals/plain-words/answers.ts generate --arm after
 * npx tsx evals/plain-words/answers.ts report                    # free
 * npx tsx evals/plain-words/answers.ts pairs --a before --b after
 * ```
 *
 * `--keep-unfinished` on `generate` keeps a `term` answer that *Check the web*
 * would discard (a truncated one, say) instead of failing the arm, and `report`
 * counts them. For a length comparison, where the answer cut off at the token
 * cap is the one that matters most — docs/plans/260930g-briefer-chat-and-explain-answers.md.
 *
 * **The calls are production's**: `explainStream` and `converse` with
 * `kind: "chat"` and tools on, exactly as the routes make them. Web search stays
 * on because it is part of what an answer is; `report` says how often it was
 * used, and the `before-2` control is what separates its variance from the
 * prompt's effect.
 *
 * **The cases are fixed** (`CASES` below): per article, two glossary terms,
 * each asked about three ways — Explain on the bare term (the *Check the web*
 * shape), Explain on the sentence around it, and a chat question naming it. The
 * sentence is found in the article at run time, so it is always the article's.
 *
 * **Where it differs from production** (GPT Sol, stage-2 plan review E4):
 * *Check the web* finds its quote with `anchorIn`'s whole-name matcher; this
 * takes the first case-insensitive substring, which for these six terms is the
 * same words. The `term` arm does apply *Check the web*'s accepted endings
 * (`refuseUnfinished` in src/term-lookup.ts), so an answer production would
 * throw away is not scored. No reader profile is sent, so every answer is
 * pitched at the default reader.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../../src/env.js";
import { blindCoin, hardShare, isCommon, wordsIn } from "./run.js";
import { sourceFingerprint } from "./source-fingerprint.js";

const OUT = path.join(import.meta.dirname, "..", "results", "plain-words", "answers");

/** Terms from the three eval articles that the old glossary defined with other hard words. */
const CASES: Record<string, string[]> = {
  "entropy-24-00930-spya-pywwkq": ["transfer entropy", "synergistic"],
  "olah-a4-spya-ujr7p0": ["superposition", "monosemantic"],
  "noema-mythology-of-conscious-ai": ["computational functionalism", "autopoiesis"],
};

const KINDS = ["term", "sentence", "chat"] as const;
type Kind = (typeof KINDS)[number];

/** The exact cases an arm must have: every fixed term, asked every fixed way. */
const EXPECTED_KEYS = new Set(
  Object.entries(CASES).flatMap(([slug, terms]) =>
    terms.flatMap((term) => KINDS.map((kind) => `${slug} ${kind} ${term}`)),
  ),
);
const EXPECTED = EXPECTED_KEYS.size;

/** *Check the web*'s accepted endings — src/term-lookup.ts § `refuseUnfinished`. */
const CHECK_THE_WEB_KEEPS = new Set(["finished", "unknown-finish-reason", "wants-tools"]);

export interface Answer {
  slug: string;
  term: string;
  kind: Kind;
  asked: string;
  text: string;
  searches: number;
  /** Explain's `done.ending`; absent on chat, and on the `before` arms, which predate it. */
  ending?: string;
}

interface ArmFile {
  arm: string;
  slug: string;
  /** The article's block ids and text, digested — absent on the `before` arms, which predate it. */
  blocksSha256?: string;
  answers: Answer[];
}

/**
 * The words a reader reads: block citations (`[spya-k3m9qt]`) and link targets
 * stripped, so a change in how many ids an answer cites cannot pass for a
 * change in its vocabulary (GPT Sol, E5).
 */
export function prose(text: string): string {
  return text
    .replace(/\[(?:spya-[a-z0-9]{6}[\s,]*)+\]/g, " ")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/https?:\/\/\S+/g, " ");
}

/** The first block containing the term, and the sentence in it that does. */
function locate(blocks: { id: string; text: string }[], term: string): { blockId: string; quote: string; sentence: string } {
  const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  for (const b of blocks) {
    const m = b.text.match(re);
    if (!m || m.index === undefined) continue;
    const sentences = b.text.split(/(?<=[.!?])\s+/);
    const sentence = sentences.find((s) => re.test(s)) ?? b.text;
    return { blockId: b.id, quote: m[0], sentence };
  }
  throw new Error(`"${term}" appears in no block — pick another case`);
}

/** The prompt source files; source-fingerprint.ts adds the shared prompt modules they import. */
export const SOURCES = ["explain.ts", "converse.ts"];

async function generate(arm: string, keepUnfinished: boolean): Promise<void> {
  loadEnvLocal();
  const sourceSha256 = sourceFingerprint(SOURCES);
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const { explainStream } = await import("../../src/explain.js");
  const { converse } = await import("../../src/converse.js");

  type Req = Parameters<typeof explainStream>[0];
  async function explainOnce(meta: Req["meta"], blocks: Req["blocks"], blockId: string, quote: string) {
    for await (const e of explainStream({ power: "standard", meta, blocks, blockId, quote })) {
      if (e.type === "done") return { text: e.answer, searches: e.searches, ending: e.ending as string };
    }
    throw new Error("explainStream ended without a done event");
  }

  fs.mkdirSync(path.join(OUT, arm), { recursive: true });
  await runAsOwner(environmentOwnerId(), async () => {
    for (const [slug, terms] of Object.entries(CASES)) {
      const out = path.join(OUT, arm, `${slug}.json`);
      if (fs.existsSync(out)) throw new Error(`refusing to overwrite ${path.relative(process.cwd(), out)}`);
      const article = await loadArticle(slug);
      const jobs: Promise<Answer>[] = [];
      for (const term of terms) {
        const { blockId, quote, sentence } = locate(article.blocks, term);
        jobs.push(
          explainOnce(article.meta, article.blocks, blockId, quote).then((r) => {
            if (!keepUnfinished && !CHECK_THE_WEB_KEEPS.has(r.ending)) throw new Error(`${slug} "${quote}": Check the web would discard this answer (ending ${r.ending})`);
            return { slug, term, kind: "term" as const, asked: quote, ...r };
          }),
          explainOnce(article.meta, article.blocks, blockId, sentence).then((r) => ({ slug, term, kind: "sentence" as const, asked: sentence, ...r })),
          (async () => {
            const question = `What does "${quote}" mean here, and why does it matter to the argument?`;
            for await (const e of converse({ power: "standard", meta: article.meta, blocks: article.blocks, history: [], question, slug, kind: "chat", useTools: true })) {
              if (e.type === "done") return { slug, term, kind: "chat" as const, asked: question, text: e.text, searches: e.searches };
            }
            throw new Error("converse ended without a done event");
          })(),
        );
      }
      const answers = await Promise.all(jobs);
      const blocksSha256 = createHash("sha256")
        .update(JSON.stringify(article.blocks.map((b) => [b.id, b.text])))
        .digest("hex");
      fs.writeFileSync(out, `${JSON.stringify({ arm, slug, sourceSha256, blocksSha256, at: new Date().toISOString(), answers }, null, 2)}\n`);
      console.log(`${arm}: wrote ${path.relative(process.cwd(), out)} (${answers.length} answers)`);
    }
  });
}

const keyOf = (a: Answer) => `${a.slug} ${a.kind} ${a.term}`;

/** Refuse an arm that is incomplete or has a case twice (GPT Sol, E2). */
export function assertCompleteArm(arm: string, answers: readonly Answer[]): void {
  const keys = new Set(answers.map(keyOf));
  const missing = [...EXPECTED_KEYS].filter((key) => !keys.has(key));
  const unexpected = [...keys].filter((key) => !EXPECTED_KEYS.has(key));
  if (answers.length !== EXPECTED || keys.size !== EXPECTED || missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      [
        `arm ${arm}: ${answers.length} answers, ${keys.size} distinct cases; expected ${EXPECTED} of each`,
        ...(missing.length > 0 ? [`missing: ${missing.join(", ")}`] : []),
        ...(unexpected.length > 0 ? [`unexpected: ${unexpected.join(", ")}`] : []),
      ].join("\n"),
    );
  }
}

/** Every answer of one arm, refusing an arm that is incomplete or has a case twice (GPT Sol, E2). */
function readArm(arm: string): { answers: Answer[]; blocks: Map<string, string | undefined> } {
  const dir = path.join(OUT, arm);
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as ArmFile);
  const answers = files.flatMap((f) => f.answers);
  assertCompleteArm(arm, answers);
  return { answers, blocks: new Map(files.map((f) => [f.slug, f.blocksSha256])) };
}

function report(): void {
  for (const arm of fs.readdirSync(OUT).filter((d) => fs.statSync(path.join(OUT, d)).isDirectory()).sort()) {
    const { answers } = readArm(arm);
    console.log(`\n== ${arm} (${answers.length} answers)`);
    console.log("kind        n  words/answer  unfinished  searches/answer  hard-share  hard types per 100 words (not counting the term)");
    for (const kind of ["term", "sentence", "chat"] as const) {
      const as = answers.filter((a) => a.kind === kind);
      const h = hardShare(as.map((a) => prose(a.text)));
      const searches = as.reduce((n, a) => n + a.searches, 0) / Math.max(as.length, 1);
      /* Explain answers only: chat records no ending, and arms before `--keep-unfinished` never kept one. */
      const unfinished = as.filter((a) => a.ending !== undefined && !CHECK_THE_WEB_KEEPS.has(a.ending)).length;
      let types = 0;
      let words = 0;
      for (const a of as) {
        const own = new Set(wordsIn(a.term).map((w) => w.toLowerCase()));
        const ws = wordsIn(prose(a.text));
        words += ws.length;
        types += new Set(ws.map((w) => w.toLowerCase()).filter((w) => !own.has(w) && !isCommon(w))).size;
      }
      console.log(
        `${kind.padEnd(9)} ${String(as.length).padStart(3)}  ${(h.words / Math.max(as.length, 1)).toFixed(0).padStart(12)}  ${String(unfinished).padStart(10)}  ${searches.toFixed(1).padStart(15)}  ${`${(h.share * 100).toFixed(1)}%`.padStart(10)}  ${((types / Math.max(words, 1)) * 100).toFixed(2).padStart(8)}   ${h.top.slice(0, 10).join(" ")}`,
      );
    }
  }
}

/** A blind side-by-side, matched by article, kind and term; sides shuffled by `blindCoin`. */
function pairs(a: string, b: string): void {
  const pairsFile = path.join(OUT, `pairs-${a}-vs-${b}.md`);
  const keyFile = path.join(OUT, `pairs-${a}-vs-${b}.key.tsv`);
  if (fs.existsSync(pairsFile) || fs.existsSync(keyFile)) throw new Error(`refusing to overwrite ${path.relative(process.cwd(), pairsFile)}`);
  const A = readArm(a);
  const B = readArm(b);
  for (const [slug, sha] of A.blocks) {
    const other = B.blocks.get(slug);
    if (sha && other && sha !== other) throw new Error(`${slug}: the article changed between ${a} and ${b}`);
  }
  const fb = new Map(B.answers.map((x) => [keyOf(x), x]));
  const coin = blindCoin();
  const out = [
    "# Blind pairs: two answers to the same request",
    "",
    "Each pair is two answers a reading assistant gave to the same request about an article (a selection to explain, or a chat question).",
    "Judge: which would a curious reader from OUTSIDE the field understand more easily, and did either lose, bend or blur what the other gets right?",
    "",
  ];
  const key: string[] = [];
  let n = 0;
  for (const x of A.answers) {
    const y = fb.get(keyOf(x));
    if (!y) throw new Error(`${keyOf(x)} is in ${a} and not in ${b}`);
    if (x.asked !== y.asked) throw new Error(`${keyOf(x)}: the two arms asked different things`);
    n++;
    const flip = coin();
    const [X, Y] = flip ? [y, x] : [x, y];
    out.push(`## ${n}. ${x.kind === "chat" ? "Chat question" : "Explain this selection"}: ${x.asked}`, "", "### X", "", X.text, "", "### Y", "", Y.text, "");
    key.push(`${n}\t${x.kind}\tX=${flip ? b : a}\tY=${flip ? a : b}`);
  }
  fs.writeFileSync(pairsFile, `${out.join("\n")}\n`);
  fs.writeFileSync(keyFile, `${key.join("\n")}\n`);
  console.log(`${n} pairs → ${path.relative(process.cwd(), pairsFile)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (name: string) => {
    const at = rest.indexOf(name);
    return at >= 0 ? rest[at + 1] : undefined;
  };
  if (cmd === "generate") {
    const arm = flag("--arm");
    if (!arm || !/^(before|after)(-\d+)?$/.test(arm)) throw new Error("generate needs --arm before|after[-N]");
    await generate(arm, rest.includes("--keep-unfinished"));
  } else if (cmd === "report") {
    report();
  } else if (cmd === "pairs") {
    const a = flag("--a");
    const b = flag("--b");
    if (!a || !b) throw new Error("pairs needs --a <arm> --b <arm>");
    pairs(a, b);
  } else {
    throw new Error("usage: answers.ts generate --arm <arm> [--keep-unfinished] | report | pairs --a <arm> --b <arm>");
  }
}
