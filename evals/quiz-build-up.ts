/**
 * **Did the quiz get easier per question, and does it build up?**
 * docs/plans/260930c-quiz-questions-that-build-up-to-the-takeaways.md § Measuring it.
 *
 * ```
 * npx tsx evals/quiz-build-up.ts generate --arm before   <slug>...   # paid
 * npx tsx evals/quiz-build-up.ts generate --arm before-2 <slug>...   # the same prompt again: the wobble
 * npx tsx evals/quiz-build-up.ts generate --arm after    <slug>...
 * npx tsx evals/quiz-build-up.ts report                               # free: the screens, per arm
 * npx tsx evals/quiz-build-up.ts pairs --a before --b after           # free: a blind side-by-side, and its key
 * ```
 *
 * The method is docs/project/prompting-guide.md § Measuring a prompt change,
 * and the shape is evals/plain-words/run.ts's. **The arms are separated in
 * time, not in code**: `generate` calls production's own `generateQuiz`, so
 * `before` is run on the commit before the prompt change and `after` on the
 * commit with it, and each arm records a hash of src/quiz.ts.
 *
 * **A pair is a whole quiz, not a question.** What changed is the shape of the
 * batch — how many, how small, and whether each leans on the last — and a
 * question lifted out of its sequence cannot show that. The price is that the
 * number of pairs is the number of articles, so this is a handful of reads, and
 * the question count alone will often tell a judge which arm is which. The
 * screens below are there to be read beside it, not instead.
 *
 * Reads articles from the local database, read-only. Writes JSON under
 * `evals/results/quiz-build-up/<arm>/`.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadEnvLocal } from "../src/env.js";
import { blindCoin } from "./plain-words/run.js";

const OUT = path.join(import.meta.dirname, "results", "quiz-build-up");

interface ArmQuestion {
  question: string;
  referenceAnswer: string;
  evidence: string[];
  /** Present on the old prompt's output only. */
  band?: string;
  value?: number;
}

interface ArmFile {
  arm: string;
  slug: string;
  promptVersion: string;
  sourceSha256: string;
  at: string;
  dropped: Record<string, number>;
  questions: ArmQuestion[];
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
/** Sentences, roughly: a terminal mark followed by space or the end. */
const sentences = (s: string) => (s.match(/[.!?](\s|$)/g) ?? []).length || 1;

function readArm(arm: string): ArmFile[] {
  const dir = path.join(OUT, arm);
  if (!fs.existsSync(dir)) throw new Error(`no arm ${arm} under ${path.relative(process.cwd(), OUT)}`);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as ArmFile);
}

/* ------------------------------------------------------------- report -- */

function report(): void {
  const arms = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((d) => fs.statSync(path.join(OUT, d)).isDirectory()) : [];
  for (const arm of arms.sort()) {
    console.log(`\n== ${arm}`);
    console.log("slug\tn\tq words (mean)\tref words (mean)\tref >2 sentences\tq with ' and '");
    for (const f of readArm(arm)) {
      const qs = f.questions;
      const mean = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : "-");
      console.log(
        [
          f.slug,
          qs.length,
          mean(qs.map((q) => words(q.question))),
          mean(qs.map((q) => words(q.referenceAnswer))),
          qs.filter((q) => sentences(q.referenceAnswer) > 2).length,
          qs.filter((q) => / and /.test(q.question)).length,
        ].join("\t"),
      );
    }
  }
}

/* -------------------------------------------------------------- pairs -- */

function pairs(a: string, b: string): void {
  const fa = new Map(readArm(a).map((f) => [f.slug, f]));
  const fb = new Map(readArm(b).map((f) => [f.slug, f]));
  const coin = blindCoin(260930);
  const render = (f: ArmFile) =>
    f.questions
      .map((q, i) => `  ${i + 1}. ${q.question}\n     — ${q.referenceAnswer}`)
      .join("\n");
  const out: string[] = [
    `# Blind pairs: two quizzes on each article`,
    "",
    "Each pair is two whole quizzes, X and Y, set on the same article, in the order a reader would meet",
    "them. The reader answers from memory, without the article, having read it once. Judge each pair on:",
    "",
    "1. **effort** — which quiz asks less of the reader per question: answerable in a sentence or two,",
    "   without having to stop and work something out? (X|Y|same)",
    "2. **build** — which quiz builds up: each question leaning on what earlier ones established, so",
    "   that by the end the reader has worked their way to the piece's key takeaways and why they hold?",
    "   (X|Y|same)",
    "3. **fidelity** — does either quiz ask something the article does not settle, or carry a reference",
    "   answer that bends, overstates or blurs what the article says? Name the question number. (ok|X- …|Y- …)",
    "4. **giveaway** — does either quiz put a question's own answer inside the question? (ok|X- …|Y- …)",
    "",
    "Answer one line per pair: `<n> effort=X|Y|same build=X|Y|same fid=ok|X-|Y- give=ok|X-|Y- [why, briefly]`.",
    "",
  ];
  const key: string[] = [];
  let n = 0;
  for (const [slug, qa] of fa) {
    const qb = fb.get(slug);
    if (!qb) continue;
    n++;
    const flip = coin();
    const [x, y] = flip ? [qb, qa] : [qa, qb];
    out.push(`## ${n}. ${slug}`, "", "### X", "", render(x), "", "### Y", "", render(y), "");
    key.push(`${n}\t${slug}\tX=${x.arm}\tY=${y.arm}`);
  }
  const base = path.join(OUT, `pairs-${a}-vs-${b}`);
  for (const f of [`${base}.md`, `${base}.key.tsv`]) {
    if (fs.existsSync(f)) throw new Error(`refusing to overwrite ${path.relative(process.cwd(), f)}`);
  }
  fs.writeFileSync(`${base}.md`, `${out.join("\n")}\n`);
  fs.writeFileSync(`${base}.key.tsv`, `${key.join("\n")}\n`);
  const xIsB = key.filter((l) => l.includes(`X=${b}`)).length;
  console.log(`${n} pairs → ${path.relative(process.cwd(), base)}.md; ${b} is X in ${xIsB} of ${n} (check the coin)`);
}

/* ----------------------------------------------------------- generate -- */

async function generate(arm: string, slugs: string[]): Promise<void> {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../src/owner.js");
  const { loadArticle } = await import("../src/store/index.js");
  const { generateQuiz, PROMPT_VERSION } = await import("../src/quiz.js");
  const sourceSha256 = createHash("sha256")
    .update(fs.readFileSync(path.join(import.meta.dirname, "..", "src", "quiz.ts")))
    .digest("hex");
  fs.mkdirSync(path.join(OUT, arm), { recursive: true });
  await runAsOwner(environmentOwnerId(), async () => {
    for (const slug of slugs) {
      const out = path.join(OUT, arm, `${slug}.json`);
      if (fs.existsSync(out)) throw new Error(`refusing to overwrite ${path.relative(process.cwd(), out)}`);
      console.log(`${arm}: ${slug} (${PROMPT_VERSION})`);
      const article = await loadArticle(slug);
      const run = await generateQuiz({ article: { ...article, slug } });
      const file: ArmFile = {
        arm,
        slug,
        promptVersion: PROMPT_VERSION,
        sourceSha256,
        at: new Date().toISOString(),
        dropped: { ...run.dropped },
        questions: run.quiz.questions.map((q) => {
          const extra = q as unknown as { band?: string; value?: number };
          return {
            question: q.question,
            referenceAnswer: q.referenceAnswer,
            evidence: q.evidence.map((e) => e.blockId),
            ...(extra.band ? { band: extra.band } : {}),
            ...(typeof extra.value === "number" ? { value: extra.value } : {}),
          };
        }),
      };
      fs.writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
      console.log(`  wrote ${path.relative(process.cwd(), out)}: ${file.questions.length} questions, ${run.outputTokens} output tokens`);
    }
  });
}

/* --------------------------------------------------------------- main -- */

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (name: string) => {
    const at = rest.indexOf(name);
    return at >= 0 ? rest[at + 1] : undefined;
  };
  if (cmd === "generate") {
    const arm = flag("--arm");
    if (!arm || !/^(before|after)(-\d+)?$/.test(arm)) throw new Error("generate needs --arm before|after[-N]");
    const at = rest.indexOf("--arm");
    const slugs = rest.filter((_, i) => i !== at && i !== at + 1);
    if (slugs.length === 0) throw new Error("generate needs at least one slug");
    await generate(arm, slugs);
    process.exit(0);
  } else if (cmd === "report") {
    report();
  } else if (cmd === "pairs") {
    const a = flag("--a");
    const b = flag("--b");
    if (!a || !b) throw new Error("pairs needs --a <arm> --b <arm>");
    pairs(a, b);
  } else {
    throw new Error("usage: quiz-build-up.ts generate --arm before|after[-N] <slug>... | report | pairs --a <arm> --b <arm>");
  }
}
