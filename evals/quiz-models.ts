/**
 * Eval — is Haiku 5.5 good enough to write or mark a quiz, and is a quiz of
 * smaller, easier questions better?
 *
 *     npx tsx evals/quiz-models.ts --dry-run    # every call and a rough total; calls nothing
 *     npx tsx evals/quiz-models.ts              # about $5; writes evals/results/quiz-models/
 *     npx tsx evals/quiz-models.ts --marks-only | --writes-only
 *
 * **This one spends money.** Greg, 2026-10-29 (spya-jzgrua): *"Can we
 * experiment with evals with Haiku or Sonnet to see if they're good enough for
 * the quiz mode?"* Plan 261029i § Stage 4 has the arms, the counters and the
 * decision rule, written down before the first run. The arms and counters are
 * evals/quiz-models-lib.ts.
 *
 * ## Read it, blind
 *
 * The counters are a prompt to look, as in evals/quiz.ts. The judgement is a
 * read: every write arm is paired with the incumbent (Sonnet 5.5, today's
 * prompt) on the same article and run, and every Haiku mark with Sonnet's on
 * the same case and run, each pair written to its own file with the two
 * labelled A and B. Which is which is in `key.json` beside them, so a reader —
 * an Opus subagent, or Greg — reads the pairs before opening it.
 *
 * ## A failure is a result
 *
 * A write that fails to parse, or a model that refuses `effort` or adaptive
 * thinking, is recorded against its arm and counted; the run carries on.
 * Reporting an arm's average over only its successes would make a model that
 * fails half the time look as good as one that never does.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { collectSpend, totalSpend } from "../src/ai-spend.js";
import { costStore } from "../src/store/ai-calls.js";
import { environmentOwnerId } from "../src/owner.js";
import { loadEnvLocal } from "../src/env.js";
import { generateQuiz, type QuizRun } from "../src/quiz.js";
import { markAnswer } from "../src/quiz-mark.js";
import { fallbackHeadTitle } from "../src/source-hash.js";
import type { Article } from "../src/article-input.js";
import type { Meta } from "../src/types.js";
import { readArticleFromDir } from "../tests/helpers/article-from-dir.js";
import { FIXTURE_ROOT } from "../tests/helpers/require-fixture.js";
import { CASES, citations, flags, loadMeta, misattributed, namesTheDraft } from "./quiz-cases.js";
import {
  ARTICLES,
  type BatchStats,
  batchStats,
  experimentFor,
  incumbentIsA,
  MARK_ARMS,
  plan,
  RUNS,
  WRITE_ARMS,
} from "./quiz-models-lib.js";

loadEnvLocal();

const OUT = path.resolve(import.meta.dirname, "results", "quiz-models");

interface WriteResult {
  arm: string;
  article: string;
  run: number;
  ok: boolean;
  error?: string;
  stats?: BatchStats;
  seconds?: number;
  dollars: number;
  batch?: QuizRun["quiz"];
}

interface MarkResult {
  arm: string;
  caseName: string;
  run: number;
  ok: boolean;
  error?: string;
  reply?: string;
  verdict?: string;
  expectVerdict?: string;
  flagged?: string[];
  knownCites?: number;
  unknownCites?: number;
  misplaced?: number;
  defendsReader?: boolean;
  seconds?: number;
  dollars: number;
}

/** Run `fn` under its own spend collector, so each call's cost is its own. */
async function priced<T>(fn: () => Promise<T>): Promise<{ result: T | Error; dollars: number }> {
  let result: T | Error;
  const { report } = await collectSpend(
    async () => {
      try {
        result = await fn();
      } catch (err) {
        result = err instanceof Error ? err : new Error(String(err));
      }
    },
    { attribution: { scopeKind: "eval", ownerId: environmentOwnerId() }, sink: (row) => costStore.record(row) },
  );
  return { result: result!, dollars: totalSpend(report.calls).nanos / 1e9 };
}

async function loadArticle(name: string): Promise<{ article: Article; meta: Meta }> {
  const dir = path.join(FIXTURE_ROOT, "data", name);
  const article = await readArticleFromDir(dir);
  const meta = (await loadMeta(dir)) ?? ({ title: fallbackHeadTitle(article.tree) } as Meta);
  return { article, meta };
}

function batchText(batch: QuizRun["quiz"]): string {
  return batch.questions
    .map((q, i) => `${i + 1}. ${q.question}\n   — ${q.referenceAnswer}`)
    .join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const calls = plan(CASES.map((c) => c.name));
  if (args.includes("--dry-run")) {
    const total = calls.reduce((sum, c) => sum + c.estimate, 0);
    for (const c of calls)
      console.log(`${c.half}\t${c.arm}\t${c.model}\t${c.article}\trun ${c.run}${c.caseName ? `\t${c.caseName}` : ""}`);
    console.log(`\n${calls.length} calls, roughly $${total.toFixed(2)} (estimate; the ledger is the measurement).`);
    return;
  }
  const doWrite = !args.includes("--marks-only");
  const doMark = !args.includes("--writes-only");
  await mkdir(OUT, { recursive: true });

  const writes: WriteResult[] = [];
  if (doWrite) {
    for (const name of ARTICLES) {
      const { article } = await loadArticle(name);
      for (let run = 1; run <= RUNS; run++) {
        for (const arm of WRITE_ARMS) {
          const started = performance.now();
          const { result, dollars } = await priced(() =>
            generateQuiz({ article, power: "standard", experiment: experimentFor(arm) }),
          );
          const seconds = (performance.now() - started) / 1000;
          if (result instanceof Error) {
            writes.push({ arm: arm.name, article: name, run, ok: false, error: result.message, seconds, dollars });
          } else {
            writes.push({
              arm: arm.name,
              article: name,
              run,
              ok: true,
              stats: batchStats(result, article.blocks),
              seconds,
              dollars,
              batch: result.quiz,
            });
          }
          console.log(`write ${arm.name} ${name} run ${run}: ${result instanceof Error ? "FAILED" : "ok"} $${dollars.toFixed(3)}`);
        }
      }
    }
  }

  const marks: MarkResult[] = [];
  if (doMark) {
    const { article, meta } = await loadArticle(ARTICLES[0]);
    for (let run = 1; run <= RUNS; run++) {
      for (const arm of MARK_ARMS) {
        for (const c of CASES) {
          const started = performance.now();
          const { result, dollars } = await priced(() =>
            markAnswer({
              power: "standard",
              model: arm.model,
              meta,
              blocks: article.blocks,
              question: c.question,
              referenceAnswer: c.referenceAnswer,
              evidence: c.evidence,
              answer: c.said,
              telemetry: { slug: article.slug, questionId: c.name },
            }),
          );
          const seconds = (performance.now() - started) / 1000;
          if (result instanceof Error) {
            marks.push({ arm: arm.name, caseName: c.name, run, ok: false, error: result.message, seconds, dollars });
          } else {
            const cited = citations(result.reply, article.blocks);
            marks.push({
              arm: arm.name,
              caseName: c.name,
              run,
              ok: true,
              reply: result.reply,
              verdict: result.verdict ?? "none",
              ...(c.expectVerdict ? { expectVerdict: c.expectVerdict } : {}),
              flagged: flags(result.reply),
              knownCites: cited.known,
              unknownCites: cited.unknown,
              misplaced: misattributed(result.reply, article.blocks).wrong,
              ...(c.poisoned ? { defendsReader: namesTheDraft(result.reply) } : {}),
              seconds,
              dollars,
            });
          }
          console.log(`mark ${arm.name} ${c.name} run ${run}: ${result instanceof Error ? "FAILED" : "ok"} $${dollars.toFixed(3)}`);
        }
      }
    }
  }

  await writeFile(path.join(OUT, "results.json"), `${JSON.stringify({ writes, marks }, null, 2)}\n`);
  await writeBlind(writes, marks);
  await writeSummary(writes, marks);
}

/** The pairs, A and B, and the key kept apart from them. */
async function writeBlind(writes: readonly WriteResult[], marks: readonly MarkResult[]): Promise<void> {
  const key: Record<string, { A: string; B: string }> = {};
  const incumbent = WRITE_ARMS[0]!.name;
  for (const w of writes) {
    if (w.arm === incumbent || !w.batch) continue;
    const base = writes.find((x) => x.arm === incumbent && x.article === w.article && x.run === w.run);
    if (!base?.batch) continue;
    const pair = `write-${w.article}-run${w.run}-${w.arm}`;
    const [a, b] = incumbentIsA(pair) ? [base, w] : [w, base];
    key[pair] = { A: a.arm, B: b.arm };
    await writeFile(
      path.join(OUT, `${pair}.md`),
      `# ${w.article}, run ${w.run}\n\nTwo quizzes on the same article. Which would a reader learn more from, met beside the passage as they read? Which questions are easier to answer in a line?\n\n## A\n\n${batchText(a.batch!)}\n\n## B\n\n${batchText(b.batch!)}\n`,
    );
  }
  for (const m of marks) {
    if (m.arm === MARK_ARMS[0]!.name || !m.reply) continue;
    const base = marks.find((x) => x.arm === MARK_ARMS[0]!.name && x.caseName === m.caseName && x.run === m.run);
    if (!base?.reply) continue;
    const c = CASES.find((x) => x.name === m.caseName)!;
    const pair = `mark-${m.caseName}-run${m.run}`;
    const [a, b] = incumbentIsA(pair) ? [base, m] : [m, base];
    key[pair] = { A: a.arm, B: b.arm };
    await writeFile(
      path.join(OUT, `${pair}.md`),
      `# ${m.caseName}, run ${m.run}\n\n**Watch for:** ${c.watchFor}\n\n**Question.** ${c.question}\n\n**Draft${c.poisoned ? " (deliberately wrong)" : ""}.** ${c.referenceAnswer}\n\n**The reader said.** ${c.said}\n\n## A\n\n${a.reply}\n\n## B\n\n${b.reply}\n`,
    );
  }
  await writeFile(path.join(OUT, "key.json"), `${JSON.stringify(key, null, 2)}\n`);
}

/** The counters per arm. A prompt to look; the decision rule is the plan's. */
async function writeSummary(writes: readonly WriteResult[], marks: readonly MarkResult[]): Promise<void> {
  const lines = ["# Quiz: Haiku 5.5 against Sonnet 5.5, and smaller questions", "", "Plan 261029i § Stage 4. Counters only; read the blind pairs.", ""];
  lines.push("## Writing", "", "| Arm | ok / runs | $ mean | s mean | questions | words / question | words / answer | blocks between | longest gap | dropped |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const arm of WRITE_ARMS) {
    const rows = writes.filter((w) => w.arm === arm.name);
    const ok = rows.filter((w) => w.ok && w.stats);
    const avg = (f: (s: BatchStats) => number) => (ok.length ? (ok.reduce((t, w) => t + f(w.stats!), 0) / ok.length).toFixed(1) : "—");
    const money = rows.length ? (rows.reduce((t, w) => t + w.dollars, 0) / rows.length).toFixed(3) : "—";
    const secs = rows.length ? (rows.reduce((t, w) => t + (w.seconds ?? 0), 0) / rows.length).toFixed(0) : "—";
    lines.push(`| ${arm.name} | ${ok.length} / ${rows.length} | ${money} | ${secs} | ${avg((s) => s.questions)} | ${avg((s) => s.questionWords)} | ${avg((s) => s.answerWords)} | ${avg((s) => s.blocksBetween)} | ${avg((s) => s.longestGap)} | ${avg((s) => s.dropped)} |`);
  }
  lines.push("", "## Marking", "", "| Arm | ok / runs | $ mean | s mean | verdict agrees | grade words | unknown ids | misplaced quotes | poisoned: names the draft |", "|---|---|---|---|---|---|---|---|---|");
  for (const arm of MARK_ARMS) {
    const rows = marks.filter((m) => m.arm === arm.name);
    const ok = rows.filter((m) => m.ok);
    const labelled = ok.filter((m) => m.expectVerdict);
    const agree = labelled.filter((m) => m.verdict === m.expectVerdict).length;
    const poisoned = ok.filter((m) => m.defendsReader !== undefined);
    lines.push(
      `| ${arm.name} | ${ok.length} / ${rows.length} | ${rows.length ? (rows.reduce((t, m) => t + m.dollars, 0) / rows.length).toFixed(3) : "—"} | ${rows.length ? (rows.reduce((t, m) => t + (m.seconds ?? 0), 0) / rows.length).toFixed(0) : "—"} | ${agree} / ${labelled.length} | ${ok.reduce((t, m) => t + (m.flagged?.length ?? 0), 0)} | ${ok.reduce((t, m) => t + (m.unknownCites ?? 0), 0)} | ${ok.reduce((t, m) => t + (m.misplaced ?? 0), 0)} | ${poisoned.filter((m) => m.defendsReader).length} / ${poisoned.length} |`,
    );
  }
  const failures = [...writes, ...marks].filter((r) => !r.ok);
  if (failures.length) {
    lines.push("", "## Failures", "");
    for (const f of failures) lines.push(`- ${"article" in f ? `write ${f.arm} ${f.article}` : `mark ${f.arm} ${f.caseName}`} run ${f.run}: ${f.error}`);
  }
  await writeFile(path.join(OUT, "summary.md"), `${lines.join("\n")}\n`);
  console.log(`\nWritten to ${path.relative(process.cwd(), OUT)}/`);
}

await main();
