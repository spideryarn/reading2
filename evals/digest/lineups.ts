/**
 * **Blind lineups for the judges** — plan 261009a § Stage 3.
 *
 *   npx tsx evals/digest/lineups.ts      # free: no model call
 *
 * For each article and task, the five arms' outputs under shuffled letters
 * (V–Z), each with its first line — the heading that names the arm — removed,
 * after the article itself with block ids. The judge sees the article and the
 * task, never the digest and never which model wrote what. The key goes to a
 * separate file the judges are not given.
 *
 * Writes evals/results/digest-2026-10-09/judging/<slug>.md (one file per
 * article, all four tasks, so one judge reads the article once) and key.json.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { articleWithIds } from "../../src/article-prompt.js";
import { isBodyEvidence } from "../../src/block-policy.js";
import { loadEnvLocal } from "../../src/env.js";
import { assertLocalDatabase, loadArticles, SLUGS } from "./articles.js";
import { assertJudgedInputsMatch } from "./resume.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const resultsFlag = process.argv.indexOf("--results");
if (resultsFlag !== -1 && !process.argv[resultsFlag + 1]) throw new Error("--results needs a run directory");
const RESULTS = resultsFlag === -1 ? path.join(HERE, "..", "results", "digest-2026-10-09") : path.resolve(process.argv[resultsFlag + 1]!);
const OUT = path.join(RESULTS, "judging");
const ARMS = ["A-opus", "B-sonnet", "C-sonnet+digest", "D-haiku", "E-haiku+digest"] as const;
const LETTERS = ["V", "W", "X", "Y", "Z"] as const;

const questions = JSON.parse(fs.readFileSync(path.join(HERE, "questions.json"), "utf8")) as {
  questions: Record<string, { id: string; text: string }[]>;
};

/** Deterministic shuffle from a seed string, so a rerun gives the same key. */
function shuffled<T>(items: readonly T[], seed: string): T[] {
  return [...items]
    .map((item, i) => ({ item, k: createHash("sha256").update(`${seed}:${i}`).digest("hex") }))
    .sort((a, b) => a.k.localeCompare(b.k))
    .map((x) => x.item);
}

function taskLine(slug: string, task: string): string {
  if (task === "summary-fuller") {
    return "TASK: a 'Fuller' summary — a few short paragraphs in everyday words, for someone who has not read the piece, saying what it is about, why it matters and its key ideas. Each paragraph cites the passages (block ids) it rests on.";
  }
  if (task === "ideas") {
    return "TASK: 'Ideas' — the propositions the piece assumes or depends on, each with a short explanation of why a reader needs it to follow the argument, citing the passages (block ids) where it is used.";
  }
  const q = questions.questions[slug]?.find((x) => `chat-${x.id}` === task);
  if (!q) throw new Error(`no question for ${slug} ${task}`);
  return `TASK: a chat answer to a reader's question about the piece. The question: "${q.text}"`;
}

function outputOf(slug: string, task: string, arm: string): string {
  const md = fs.readFileSync(path.join(RESULTS, slug, task, `${arm}.md`), "utf8");
  /* The first line is `# <slug> — <task> — <arm>`: it names the arm. */
  const body = md.split("\n").slice(1).join("\n").trim();
  if (body.includes(arm) || /\b(opus|sonnet|haiku)\b/i.test(body)) {
    throw new Error(`arm name may leak in ${slug}/${task}/${arm}.md`);
  }
  return body.length > 0 ? body : "(no answer: this arm returned nothing usable)";
}

async function main(): Promise<void> {
  const savedPlan = JSON.parse(fs.readFileSync(path.join(RESULTS, "preflight-run.json"), "utf8")) as { questionsHash: string };
  const questionHash = createHash("sha256").update(fs.readFileSync(path.join(HERE, "questions.json"))).digest("hex").slice(0, 16);
  if (savedPlan.questionsHash !== questionHash) throw new Error("questions differ from this run; do not relabel its outputs");
  loadEnvLocal();
  assertLocalDatabase();
  const articles = await loadArticles();
  fs.mkdirSync(OUT, { recursive: true });
  const key: Record<string, Record<string, Record<string, string>>> = {};
  const lineups = new Map<string, string>();
  for (const slug of SLUGS) {
    const article = articles.get(slug);
    if (!article) throw new Error(`missing ${slug}`);
    const meta = article.meta ?? ({ title: slug } as NonNullable<typeof article.meta>);
    const text = articleWithIds(meta, article.blocks.filter(isBodyEvidence));
    const parts = [`# Article: ${slug}\n\n${text}\n`];
    key[slug] = {};
    for (const task of ["summary-fuller", "ideas", "chat-q1", "chat-q2"]) {
      const order = shuffled(ARMS, `${slug}/${task}/261009a`);
      key[slug][task] = Object.fromEntries(order.map((arm, i) => [LETTERS[i], arm]));
      parts.push(`\n\n======== LINEUP ${task} ========\n\n${taskLine(slug, task)}\n`);
      order.forEach((arm, i) => {
        parts.push(`\n---- OUTPUT ${LETTERS[i]} ----\n\n${outputOf(slug, task, arm)}\n`);
      });
    }
    lineups.set(slug, parts.join(""));
  }
  /* Existing judges scored these exact inputs, not whichever outputs a rerun
     happened to leave under the same filenames. Check before any write. */
  for (const [slug, text] of lineups) {
    const hasJudge = ["opus", "sol"].some((j) => fs.existsSync(path.join(OUT, `${j}-${slug}.json`)));
    if (!hasJudge) continue;
    const oldKey = JSON.parse(fs.readFileSync(path.join(OUT, "key.json"), "utf8")) as typeof key;
    assertJudgedInputsMatch(slug, oldKey[slug], key[slug], fs.readFileSync(path.join(OUT, `${slug}.md`), "utf8"), text);
  }
  for (const [slug, text] of lineups) fs.writeFileSync(path.join(OUT, `${slug}.md`), text);
  fs.writeFileSync(path.join(OUT, "key.json"), `${JSON.stringify(key, null, 2)}\n`);
  console.log(`wrote ${SLUGS.length} lineup files and key.json to ${OUT}`);
}

await main();
