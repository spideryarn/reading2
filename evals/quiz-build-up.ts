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
 * commit with it, and each arm records a hash of src/quiz.ts and of the shared prompt
 * modules it imports (evals/plain-words/source-fingerprint.ts).
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
import { loadEnvLocal } from "../src/env.js";
import { blindCoin } from "./plain-words/run.js";
import { sourceFingerprint } from "./plain-words/source-fingerprint.js";

const OUT = path.join(import.meta.dirname, "results", "quiz-build-up");

interface ArmQuestion {
  /** Present on the new prompt's output only. */
  premise?: string;
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
  /** src/quiz.ts alone. */
  sourceSha256: string;
  /** quiz.ts and the shared prompt modules it imports. Absent on arms from before 2026-10-04. */
  promptSourceSha256?: Record<string, string>;
  at: string;
  dropped: Record<string, number>;
  /** Missing on the two `before` arms, which were run before this was recorded. */
  outputTokens?: number;
  elapsedMs?: number;
  maxTokens?: number;
  questions: ArmQuestion[];
}

/** The five articles the plan names. A comparison over fewer is refused. */
const PLANNED = [
  "cargocult-spya-rz663q",
  "entropy-24-00930-spya-pywwkq",
  "greatwork-spya-yw4d3t",
  "noema-mythology-of-conscious-ai",
  "olah-a4-spya-ujr7p0",
];

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
    .map((f) => {
      const file = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as ArmFile;
      /* The file says which arm it is; a copy dropped into the wrong folder is
         the silent way to compare a prompt with itself. */
      if (file.arm !== arm) throw new Error(`${arm}/${f} says it is arm ${file.arm}`);
      if (`${file.slug}.json` !== f) throw new Error(`${arm}/${f} says it is ${file.slug}`);
      if (!Array.isArray(file.questions)) throw new Error(`${arm}/${f} has no questions array`);
      /* The budget evidence is required of every arm run after it was
         recorded (GPT Sol's R2-5); the two `before` arms and the `after-1`
         probe predate it, and say so as a dash rather than a guess. */
      const predates = ["before", "before-2", "after-1"].includes(arm);
      if (!predates && (file.outputTokens === undefined || file.maxTokens === undefined || file.elapsedMs === undefined)) {
        throw new Error(`${arm}/${f} is missing outputTokens, maxTokens or elapsedMs`);
      }
      return file;
    });
}

/**
 * **Refuse a partial comparison** rather than inner-joining one (GPT Sol's F6
 * on the plan): an arm that is missing an article, or has an extra one, would
 * otherwise produce a plausible three-pair file calling itself the five.
 */
function checkedArm(arm: string): ArmFile[] {
  const files = readArm(arm);
  const slugs = files.map((f) => f.slug).sort();
  if (JSON.stringify(slugs) !== JSON.stringify([...PLANNED].sort())) {
    throw new Error(`arm ${arm} has ${slugs.join(", ")}; the plan names ${PLANNED.join(", ")}`);
  }
  return files;
}

/* ------------------------------------------------------------- report -- */

function report(): void {
  const arms = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter((d) => fs.statSync(path.join(OUT, d)).isDirectory()) : [];
  for (const arm of arms.sort()) {
    console.log(`\n== ${arm}`);
    console.log("slug\tn\tq words (mean)\tref words (mean)\tref >2 sentences\tq with ' and '\twith premise\tgaps\tdropped\tout tokens\ts");
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
          qs.filter((q) => q.premise).length,
          f.dropped.gaps ?? "-",
          Object.entries(f.dropped).filter(([k, v]) => k !== "gaps" && v).map(([k, v]) => `${k}:${v}`).join(",") || "0",
          f.outputTokens ?? "-",
          f.elapsedMs ? Math.round(f.elapsedMs / 1000) : "-",
        ].join("\t"),
      );
    }
  }
}

/* -------------------------------------------------------------- pairs -- */

async function pairs(a: string, b: string): Promise<void> {
  const fa = new Map(checkedArm(a).map((f) => [f.slug, f]));
  const fb = new Map(checkedArm(b).map((f) => [f.slug, f]));
  /* A control compares a prompt with ITSELF, so two arms both called `before`
     that were run on different prompt bytes are not a control. */
  /* Only `before` is a control: the `after-N` arms are successive prompt
     drafts, so theirs differ on purpose. */
  if (a.startsWith("before") && b.startsWith("before")) {
    for (const [slug, qa] of fa) {
      const qb = fb.get(slug);
      const wide = (f: ArmFile) => JSON.stringify(Object.entries(f.promptSourceSha256 ?? {}).sort());
      const movedThroughAnImport = qb?.promptSourceSha256 && qa.promptSourceSha256 && wide(qa) !== wide(qb);
      if (qb && (qa.sourceSha256 !== qb.sourceSha256 || movedThroughAnImport || qa.promptVersion !== qb.promptVersion)) {
        throw new Error(`${a} and ${b} differ in prompt on ${slug}: not a control`);
      }
    }
  }

  /* **The source pack** (GPT Sol's F5): a judge who has only the two quizzes
     cannot tell a settled question from a plausible one, or the piece's
     takeaways from a quiz's guess at them. So each pair carries the article's
     outline with its gists, and every passage either quiz cites. */
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../src/owner.js");
  const { loadArticle } = await import("../src/store/index.js");
  const { partsOf } = await import("../src/arc.js");
  const packs = new Map<string, string>();
  await runAsOwner(environmentOwnerId(), async () => {
    for (const slug of fa.keys()) {
      const article = await loadArticle(slug);
      const byId = new Map(article.blocks.map((bl) => [bl.id, bl.text]));
      const cited = new Set([...(fa.get(slug)?.questions ?? []), ...(fb.get(slug)?.questions ?? [])].flatMap((q) => q.evidence));
      const outline = partsOf(article.tree)
        .map((p, i) => `  PART ${i + 1}: ${p.title}\n    ${p.gist ?? "(no gist)"}`)
        .join("\n");
      const passages = article.blocks
        .filter((bl) => cited.has(bl.id))
        .map((bl) => `  [${bl.id}] ${byId.get(bl.id)}`)
        .join("\n\n");
      packs.set(slug, `### The article's outline\n\n${outline}\n\n### Every passage either quiz cites, in article order\n\n${passages}`);
    }
  });

  const coin = blindCoin(260930);
  /* As a reader who skipped every question would meet them: every premise
     shown. That is the worst case for a premise giving something away, which
     is the case worth judging. */
  const render = (f: ArmFile) =>
    f.questions
      .map((q, i) => {
        const premise = q.premise ? `     (premise: ${q.premise})\n` : "";
        return `${premise}  ${i + 1}. ${q.question}\n     — ${q.referenceAnswer}  [${q.evidence.join(" ")}]`;
      })
      .join("\n");
  const out: string[] = [
    `# Blind pairs: two quizzes on each article`,
    "",
    "Each pair is two whole quizzes, X and Y, set on the same article, in the order a reader meets them.",
    "The reader answers from memory, without the article, having read it once. A '(premise: …)' line is",
    "shown above a question when the reader has not just answered the step before it correctly; it states",
    "something an earlier question established. The source pack before each pair is the article's outline",
    "and every passage either quiz cites. Judge each pair on:",
    "",
    "1. **effort** — which quiz asks less of the reader per question: answerable in a sentence or two,",
    "   without having to stop and work something out? (X|Y|same)",
    "2. **build** — which quiz builds up: each question leaning on what earlier ones established, so that",
    "   by the end the reader has worked their way to the piece's key takeaways (judge against the source",
    "   pack) and why they hold? (X|Y|same)",
    "3. **fidelity** — does either quiz ask something the article does not settle, or carry a reference",
    "   answer that bends, overstates or blurs what the cited passages say? Name question numbers.",
    "4. **giveaways**, three kinds, naming question numbers: (a) a question or its premise contains its",
    "   OWN answer; (b) a premise reveals the answer to an earlier question in a way that would spoil it",
    "   for a reader scanning ahead; (c) a premise bolted onto a step that is still a big leap; (d) a premise",
    "   that goes beyond restating the previous answer and states this question's answer or next step.",
    "5. **alone** — a reader who got the previous question right sees a question WITHOUT its premise line.",
    "   For each quiz with premises: is every question understandable with its premise hidden? Name those",
    "   that are not (e.g. 'why does that follow?'). (ok|X- …|Y- …)",
    "",
    "Answer one line per pair:",
    "`<n> effort=X|Y|same build=X|Y|same fid=ok|X-|Y-|XY- give=ok|X-|Y-|XY- alone=ok|X-|Y-|XY- [why, briefly, with question numbers]`.",
    "",
  ];
  const key: string[] = [];
  let n = 0;
  for (const [slug, qa] of fa) {
    const qb = fb.get(slug);
    if (!qb) throw new Error(`unreachable: ${slug} passed checkedArm but is missing from ${b}`);
    n++;
    const flip = coin();
    const [x, y] = flip ? [qb, qa] : [qa, qb];
    out.push(`## ${n}. ${slug}`, "", packs.get(slug) ?? "", "", "### X", "", render(x), "", "### Y", "", render(y), "");
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

/** The prompt source file; source-fingerprint.ts adds the shared prompt modules it imports. */
export const SOURCES = ["quiz.ts"];

async function generate(arm: string, slugs: string[]): Promise<void> {
  loadEnvLocal();
  const promptSourceSha256 = sourceFingerprint(SOURCES);
  const sourceSha256 = promptSourceSha256["quiz.ts"]!;
  const { environmentOwnerId, runAsOwner } = await import("../src/owner.js");
  const { loadArticle } = await import("../src/store/index.js");
  const { generateQuiz, PROMPT_VERSION, QUIZ_MAX_TOKENS } = await import("../src/quiz.js");
  fs.mkdirSync(path.join(OUT, arm), { recursive: true });
  await runAsOwner(environmentOwnerId(), async () => {
    for (const slug of slugs) {
      const out = path.join(OUT, arm, `${slug}.json`);
      if (fs.existsSync(out)) throw new Error(`refusing to overwrite ${path.relative(process.cwd(), out)}`);
      console.log(`${arm}: ${slug} (${PROMPT_VERSION})`);
      const article = await loadArticle(slug);
      const run = await generateQuiz({ power: "standard", article: { ...article, slug } });
      const file: ArmFile = {
        arm,
        slug,
        promptVersion: PROMPT_VERSION,
        sourceSha256,
        promptSourceSha256,
        at: new Date().toISOString(),
        dropped: { ...run.dropped },
        outputTokens: run.outputTokens,
        elapsedMs: run.elapsedMs,
        maxTokens: QUIZ_MAX_TOKENS,
        questions: run.quiz.questions.map((q) => {
          const extra = q as unknown as { band?: string; value?: number };
          return {
            ...(q.premise ? { premise: q.premise } : {}),
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
    await pairs(a, b);
    process.exit(0);
  } else {
    throw new Error("usage: quiz-build-up.ts generate --arm before|after[-N] <slug>... | report | pairs --a <arm> --b <arm>");
  }
}
