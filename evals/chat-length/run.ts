/**
 * **Does chat's answer length follow what the reader asked for?** Greg,
 * `spya-hdeye3`: *"the user may sometimes want a really detailed response, in
 * which case, I guess we need some flexibility in the system prompt that sort
 * of allows it to flex a bit towards their needs or request."*
 * docs/plans/261020t-chat-length-flexes-when-the-reader-asks-for-detail.md.
 *
 * ```
 * npx tsx evals/chat-length/run.ts generate --arm before     # paid: 15 chat answers
 * npx tsx evals/chat-length/run.ts generate --arm before-2   # the old prompt again: the control
 * npx tsx evals/chat-length/run.ts generate --arm after
 * npx tsx evals/chat-length/run.ts report                    # free
 * npx tsx evals/chat-length/run.ts pairs --a before --b after
 * ```
 *
 * **Five asks per article**, on the three articles evals/plain-words/answers.ts
 * uses, each about the same term:
 *
 * - `ordinary` — the plain-words harness's chat question. Its length should not
 *   move: the 300-word budget is right "for the most part".
 * - `quick` — a summary asked for briefly. Must stay short: a summary is not by
 *   itself a request for length (GPT Sol, plan review F1).
 * - `detailed` — the term again, asking outright for a detailed answer.
 * - `walkthrough` — the whole argument, section by section, in detail.
 * - `followup` — a second turn, "go into much more detail", after this arm's
 *   own `ordinary` answer, so the request arrives the way it does in a real
 *   thread: after a brief answer. Its pair shows each side's whole thread.
 *
 * **The calls are production's**: `converse` with `kind: "chat"`, tools on,
 * at `power: "high"`, which is the model chat answers on from plan 261020q
 * (Chat on Opus for every article). No reader profile, so nothing in About you
 * asks for a length either way.
 *
 * **A rerun fills in what is missing**: an article whose file is already there
 * is skipped, and `readArm` refuses an arm whose files were run on different
 * source, article text or model, so a top-up cannot mix prompts.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { allOrStop } from "../../src/concurrency.js";
import { loadEnvLocal } from "../../src/env.js";
import type { ChatMessage } from "../../src/types.js";
import { prose } from "../plain-words/answers.js";
import { blindCoin, wordsIn } from "../plain-words/run.js";
import { sourceFingerprint } from "../plain-words/source-fingerprint.js";

const OUT = path.join(import.meta.dirname, "..", "results", "chat-length");

const CASES: Record<string, string> = {
  "entropy-24-00930-spya-pywwkq": "transfer entropy",
  "olah-a4-spya-ujr7p0": "superposition",
  "noema-mythology-of-conscious-ai": "computational functionalism",
};

export const ASKS = ["ordinary", "quick", "detailed", "walkthrough", "followup"] as const;
type Ask = (typeof ASKS)[number];

/** The reader's words for each ask. `followup` is the second turn after `ordinary`. */
export function question(ask: Ask, term: string): string {
  switch (ask) {
    case "ordinary":
      return `What does "${term}" mean here, and why does it matter to the argument?`;
    case "quick":
      return "Give me a quick summary of this piece, just the gist.";
    case "detailed":
      return `Can you give me a really detailed explanation of "${term}" and its role in the argument? I want the full picture, in depth, not a quick summary.`;
    case "walkthrough":
      return "Walk me through the whole argument of this piece, section by section, in detail.";
    case "followup":
      return "Thanks. Can you go into much more detail on that? I'd like the long version.";
    default: {
      const never: never = ask;
      throw new Error(`unknown ask ${String(never)}`);
    }
  }
}

interface Answer {
  slug: string;
  ask: Ask;
  asked: string;
  text: string;
  /** The turn before, for `followup`: the arm's own `ordinary` answer. */
  before?: { asked: string; text: string };
  searches: number;
  truncated: boolean;
  model: string;
  effort: string;
}

interface ArmFile {
  arm: string;
  slug: string;
  sourceSha256: Record<string, string>;
  blocksSha256: string;
  at: string;
  answers: Answer[];
}

async function generate(arm: string): Promise<void> {
  const sourceSha256 = sourceFingerprint(["converse.ts"]);
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const { converse } = await import("../../src/converse.js");

  const dir = path.join(OUT, arm);
  fs.mkdirSync(dir, { recursive: true });

  await runAsOwner(environmentOwnerId(), async () => {
    const articles = Object.entries(CASES).map(async ([slug, term]) => {
      const out = path.join(dir, `${slug}.json`);
      if (fs.existsSync(out)) {
        console.log(`${arm}: ${slug} is already there, skipped`);
        return;
      }
      const article = await loadArticle(slug);
      async function ask(a: Ask, before?: { asked: string; text: string }): Promise<Answer> {
        const q = question(a, term);
        const at = new Date().toISOString();
        const history: ChatMessage[] = before
          ? [
              { id: "eval-1", role: "user", text: before.asked, createdAt: at, status: "done" },
              { id: "eval-2", role: "assistant", text: before.text, createdAt: at, status: "done" },
            ]
          : [];
        for await (const e of converse({ power: "high", meta: article.meta, blocks: article.blocks, history, question: q, slug, kind: "chat", useTools: true })) {
          if (e.type === "done") {
            return { slug, ask: a, asked: q, text: e.text, ...(before ? { before } : {}), searches: e.searches, truncated: e.truncated, model: e.model, effort: String(e.effort) };
          }
        }
        throw new Error("converse ended without a done event");
      }
      /* allOrStop, not Promise.all: a failed call must not close the ledger while its bought siblings are still running (GPT Sol, plan review F6). */
      const [ordinary, ...rest] = await allOrStop([ask("ordinary"), ask("quick"), ask("detailed"), ask("walkthrough")], () => {});
      if (!ordinary) throw new Error("no ordinary answer");
      const followup = await ask("followup", { asked: ordinary.asked, text: ordinary.text });
      const blocksSha256 = createHash("sha256")
        .update(JSON.stringify(article.blocks.map((b) => [b.id, b.text])))
        .digest("hex");
      const file: ArmFile = { arm, slug, sourceSha256, blocksSha256, at: new Date().toISOString(), answers: [ordinary, ...rest, followup] };
      fs.writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
      console.log(`${arm}: wrote ${path.relative(process.cwd(), out)}`);
    });
    await allOrStop(articles, () => {});
  });
}

/** Every answer of one arm, refusing one that is incomplete or was run on mixed source, text or model. */
function readArm(arm: string): { answers: Answer[]; files: ArmFile[] } {
  const dir = path.join(OUT, arm);
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as ArmFile);
  const answers = files.flatMap((f) => f.answers);
  const want = Object.keys(CASES).length * ASKS.length;
  if (answers.length !== want) throw new Error(`arm ${arm}: ${answers.length} answers, expected ${want}`);
  const sources = new Set(files.map((f) => JSON.stringify(f.sourceSha256)));
  if (sources.size !== 1) throw new Error(`arm ${arm}: its files were run on different source`);
  const models = new Set(answers.map((a) => `${a.model} ${a.effort}`));
  if (models.size !== 1) throw new Error(`arm ${arm}: more than one model or effort: ${[...models].join(", ")}`);
  return { answers, files };
}

const wordsOf = (a: Answer) => wordsIn(prose(a.text)).length;

function report(): void {
  for (const arm of fs.readdirSync(OUT).filter((d) => fs.statSync(path.join(OUT, d)).isDirectory()).sort()) {
    const { answers } = readArm(arm);
    console.log(`\n== ${arm} (${answers[0]?.model}, effort ${answers[0]?.effort})`);
    console.log("ask          words per answer (each article)   mean  truncated  searches");
    for (const ask of ASKS) {
      const as = answers.filter((a) => a.ask === ask);
      const ws = as.map(wordsOf);
      const mean = ws.reduce((n, w) => n + w, 0) / Math.max(ws.length, 1);
      console.log(
        `${ask.padEnd(12)} ${ws.map((w) => String(w).padStart(6)).join(" ").padEnd(34)} ${mean.toFixed(0).padStart(5)}  ${String(as.filter((a) => a.truncated).length).padStart(9)}  ${String(as.reduce((n, a) => n + a.searches, 0)).padStart(8)}`,
      );
    }
  }
}

/** One side of a pair; a follow-up shows its own first turn, since "more on that" means that. */
function side(label: string, x: Answer): string[] {
  if (!x.before) return [`### ${label}`, "", x.text, ""];
  return [`### ${label}`, "", `**Reader:** ${x.before.asked}`, "", `**Assistant:**`, "", x.before.text, "", `**Reader:** ${x.asked}`, "", `**Assistant:**`, "", x.text, ""];
}

/** Blind pairs, matched by article and ask, sides shuffled by `blindCoin`; the key in its own file. */
function pairs(a: string, b: string): void {
  const pairsFile = path.join(OUT, `pairs-${a}-vs-${b}.md`);
  const keyFile = path.join(OUT, `pairs-${a}-vs-${b}.key.tsv`);
  if (fs.existsSync(pairsFile) || fs.existsSync(keyFile)) throw new Error(`refusing to overwrite ${path.relative(process.cwd(), pairsFile)}`);
  const A = readArm(a);
  const B = readArm(b);
  for (const f of A.files) {
    const g = B.files.find((x) => x.slug === f.slug);
    if (!g || g.blocksSha256 !== f.blocksSha256) throw new Error(`${f.slug}: the article changed between ${a} and ${b}`);
  }
  if (A.answers[0]?.model !== B.answers[0]?.model) throw new Error(`${a} and ${b} were answered by different models`);
  const byKey = new Map(B.answers.map((x) => [`${x.slug} ${x.ask}`, x]));
  const coin = blindCoin();
  const out = [
    "# Blind pairs: two chat answers to the same request",
    "",
    "Each pair is two answers a reading assistant gave to the same chat message about an article.",
    "A follow-up pair shows each side's whole two-turn thread; each side's first answer is its own.",
    "",
  ];
  const key: string[] = [];
  let n = 0;
  for (const x of A.answers) {
    const y = byKey.get(`${x.slug} ${x.ask}`);
    if (!y || y.asked !== x.asked) throw new Error(`${x.slug} ${x.ask}: not asked the same in ${b}`);
    n++;
    const flip = coin();
    const [X, Y] = flip ? [y, x] : [x, y];
    out.push(`## ${n}. (${x.ask}, ${x.slug}) ${x.asked}`, "", ...side("X", X), ...side("Y", Y));
    key.push(`${n}\t${x.ask}\tX=${flip ? b : a}\tY=${flip ? a : b}`);
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
    if (!arm || !/^(before|after)(-[a-z0-9]+)?$/.test(arm)) throw new Error("generate needs --arm before|after[-name]");
    loadEnvLocal();
    const { withLedger } = await import("../../src/cli-ledger.js");
    await withLedger("eval", () => generate(arm));
  } else if (cmd === "report") {
    report();
  } else if (cmd === "pairs") {
    const a = flag("--a");
    const b = flag("--b");
    if (!a || !b) throw new Error("pairs needs --a <arm> --b <arm>");
    pairs(a, b);
  } else {
    throw new Error("usage: run.ts generate --arm <arm> | report | pairs --a <arm> --b <arm>");
  }
}
