/**
 * **Does a reason for reading move the quiz towards it?**
 * docs/plans/260930j-quiz-questions-shaped-by-the-readers-reading-goal.md § How we will know.
 *
 * ```
 * npx tsx evals/quiz-reading-goal.ts parts <slug>                                   # free: the parts, numbered
 * npx tsx evals/quiz-reading-goal.ts generate --arm none-1 <slug>                   # paid
 * npx tsx evals/quiz-reading-goal.ts generate --arm goal-1 --purpose "…" <slug>     # paid
 * npx tsx evals/quiz-reading-goal.ts generate --arm about-1 --about "…" <slug>       # paid: the control
 * npx tsx evals/quiz-reading-goal.ts report --parts 2,3 <slug>                      # free
 * ```
 *
 * `generate` calls production's own `generateQuiz`, with the purpose rendered
 * exactly as `resolveProfile` would render it for a reader with no *About you*
 * box. `report` counts, per arm, the questions whose evidence sits **mostly**
 * in the named parts (by block position, matched by the part's range), and
 * prints each question beside the part it draws on — read those, the count is
 * a prompt to look, not a verdict. Two runs per arm, because one run of an
 * identical quiz prompt wobbles (docs/project/quiz.md § The rule is counted).
 *
 * Reads the article from the local database, read-only. Writes JSON under
 * `evals/results/quiz-reading-goal/<arm>/`.
 */

import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../src/env.js";

const OUT = path.join(import.meta.dirname, "results", "quiz-reading-goal");

interface ArmFile {
  arm: string;
  slug: string;
  purpose: string | null;
  /** The *About you* box, for the control arm that has one and no purpose. */
  about?: string | null;
  at: string;
  /** Block ids in document order, so `report` needs no database. */
  order: string[];
  /** Each part's title and first/last block id. */
  parts: { title: string; range: [string, string] }[];
  dropped: Record<string, number>;
  questions: { premise?: string; question: string; evidence: string[] }[];
}

async function withArticle<T>(slug: string, fn: (a: import("../src/article-input.js").Article) => Promise<T>) {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../src/owner.js");
  const { loadArticle } = await import("../src/store/index.js");
  return runAsOwner(environmentOwnerId(), async () => fn({ ...(await loadArticle(slug)), slug }));
}

async function partsOfArticle(article: import("../src/article-input.js").Article) {
  const { partsOf } = await import("../src/arc.js");
  return partsOf(article.tree).map((p) => ({ title: p.title, range: p.range as [string, string] }));
}

async function generate(arm: string, purpose: string | null, about: string | null, slug: string): Promise<void> {
  const out = path.join(OUT, arm, `${slug}.json`);
  if (fs.existsSync(out)) throw new Error(`refusing to overwrite ${path.relative(process.cwd(), out)}`);
  const { generateQuiz } = await import("../src/quiz.js");
  const { renderProfile } = await import("../src/profile.js");
  await withArticle(slug, async (article) => {
    const profile = renderProfile({ profile: about, purpose });
    console.log(`${arm}: ${slug} — ${profile ?? "no profile"}`);
    const run = await generateQuiz({ power: "standard", article, profile });
    const file: ArmFile = {
      arm,
      slug,
      purpose,
      about,
      at: new Date().toISOString(),
      order: article.blocks.map((b) => b.id),
      parts: await partsOfArticle(article),
      dropped: { ...run.dropped },
      questions: run.quiz.questions.map((q) => ({
        ...(q.premise ? { premise: q.premise } : {}),
        question: q.question,
        evidence: q.evidence.map((e) => e.blockId),
      })),
    };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
    console.log(`  wrote ${path.relative(process.cwd(), out)}: ${file.questions.length} questions`);
  });
}

/** Which part a block is in, by position — `-1` for one outside every part. */
function partOf(file: ArmFile, blockId: string): number {
  const at = file.order.indexOf(blockId);
  return file.parts.findIndex((p) => {
    const lo = file.order.indexOf(p.range[0]);
    const hi = file.order.indexOf(p.range[1]);
    return at >= lo && at <= hi;
  });
}

function report(slug: string, target: number[]): void {
  if (!fs.existsSync(OUT)) throw new Error("nothing generated yet");
  for (const arm of fs.readdirSync(OUT).sort()) {
    const f = path.join(OUT, arm, `${slug}.json`);
    if (!fs.existsSync(f)) continue;
    const file = JSON.parse(fs.readFileSync(f, "utf8")) as ArmFile;
    let hits = 0;
    const lines: string[] = [];
    for (const [i, q] of file.questions.entries()) {
      const parts = q.evidence.map((id) => partOf(file, id) + 1);
      const inTarget = parts.filter((p) => target.includes(p)).length;
      const hit = inTarget * 2 > parts.length;
      if (hit) hits++;
      lines.push(`  ${hit ? "●" : "○"} ${String(i + 1).padStart(2)}. [part ${parts.join(",")}] ${q.question}`);
    }
    const n = file.questions.length;
    console.log(
      `\n${arm} — ${file.purpose ?? "(no purpose)"}${file.about ? ` / about: ${file.about}` : ""}\n` +
        `  ${hits} of ${n} questions (${n ? Math.round((100 * hits) / n) : 0}%) draw mostly on part ${target.join(",")}`,
    );
    for (const l of lines) console.log(l);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (name: string) => {
    const at = rest.indexOf(name);
    return at >= 0 ? rest[at + 1] : undefined;
  };
  const named = new Set(["--arm", "--purpose", "--about", "--parts"].flatMap((n) => {
    const at = rest.indexOf(n);
    return at >= 0 ? [at, at + 1] : [];
  }));
  const slug = rest.find((_, i) => !named.has(i));
  if (!slug) throw new Error("name a slug");
  if (cmd === "parts") {
    await withArticle(slug, async (article) => {
      for (const [i, p] of (await partsOfArticle(article)).entries()) console.log(`${i + 1}. ${p.title}`);
    });
    process.exit(0);
  } else if (cmd === "generate") {
    const arm = flag("--arm");
    if (!arm) throw new Error("generate needs --arm <name>");
    await generate(arm, flag("--purpose") ?? null, flag("--about") ?? null, slug);
    process.exit(0);
  } else if (cmd === "report") {
    const parts = (flag("--parts") ?? "").split(",").map(Number).filter((n) => n > 0);
    if (parts.length === 0) throw new Error("report needs --parts 1,2");
    report(slug, parts);
  } else {
    throw new Error("usage: quiz-reading-goal.ts parts|generate|report …");
  }
}
