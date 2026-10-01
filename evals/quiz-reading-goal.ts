/**
 * **Does who is reading, and why, move the quiz towards them?**
 * docs/plans/260930j-quiz-questions-shaped-by-the-readers-reading-goal.md (the
 * reason for reading, 6Q) and
 * docs/plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md
 * (the *About you* line as well, and the balance) — § How we will know, in each.
 *
 * ```
 * npx tsx evals/quiz-reading-goal.ts parts <slug>                                   # free: the parts, numbered
 * npx tsx evals/quiz-reading-goal.ts generate --arm none-1 <slug>                   # paid
 * npx tsx evals/quiz-reading-goal.ts generate --arm goal-1 --purpose "…" <slug>     # paid
 * npx tsx evals/quiz-reading-goal.ts generate --arm about-1 --about "…" <slug>       # paid
 * npx tsx evals/quiz-reading-goal.ts generate --arm both-1 --about "…" --purpose "…" <slug>
 * npx tsx evals/quiz-reading-goal.ts report --parts 2,3 <slug>                      # free
 * npx tsx evals/quiz-reading-goal.ts blind --seed s --arms a,b,c --out d <slug>     # free: the judge's sheet
 * npx tsx evals/quiz-reading-goal.ts score --dir d <slug>                           # free: the judge's labels, per arm
 * ```
 *
 * `generate` calls production's own `generateQuiz`, with the profile rendered
 * exactly as `resolveProfile` would render it, and records which prompt wrote
 * the run — the git commit, whether `src/quiz.ts` differed from it, and a hash
 * of that file's bytes — because the before and after arms are separated in
 * time, not code (docs/project/prompting-guide.md § Measuring a prompt change),
 * and a stored run that cannot say which prompt wrote it cannot be a baseline
 * (GPT Sol, 261001c plan review F7). Runs from before 261001c carry none.
 *
 * `report` counts, per arm, the questions whose evidence sits **mostly** in the
 * named parts (by block position, matched by the part's range) — a prompt to
 * look, not a verdict. `blind` writes every question of the named arms to one
 * sheet in an order fixed by the seed (a hash of seed and question, never a
 * float generator: docs/project/prompting-guide.md has the coin that put one arm
 * on one side 94 times in 95), the key to a separate file, and prints how the
 * arms fall across the sheet's halves so a lopsided order is seen before anyone
 * judges it. `score` joins a judge's `labels.tsv` back to the key.
 *
 * Reads the article from the local database, read-only. Writes JSON under
 * `evals/results/quiz-reading-goal/<arm>/`.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../src/env.js";

const OUT = path.join(import.meta.dirname, "results", "quiz-reading-goal");
const QUIZ_SOURCE = path.join(import.meta.dirname, "..", "src", "quiz.ts");

interface ArmFile {
  arm: string;
  slug: string;
  purpose: string | null;
  /** The *About you* box, or null. */
  about?: string | null;
  at: string;
  /** Which prompt wrote it. Absent on runs from before 261001c. */
  provenance?: { gitHead: string; quizDirty: boolean; quizSourceSha256: string; model: string };
  /** Block ids in document order, so `report` needs no database. */
  order: string[];
  /** Each part's title and first/last block id. */
  parts: { title: string; range: [string, string] }[];
  dropped: Record<string, number>;
  questions: { premise?: string; question: string; referenceAnswer?: string; evidence: string[] }[];
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

type SourceProvenance = Omit<NonNullable<ArmFile["provenance"]>, "model">;

function sourceProvenance(): SourceProvenance {
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  return {
    gitHead: git("rev-parse", "HEAD"),
    quizDirty: git("status", "--porcelain", "--", QUIZ_SOURCE) !== "",
    quizSourceSha256: createHash("sha256").update(fs.readFileSync(QUIZ_SOURCE)).digest("hex"),
  };
}

async function generate(arm: string, purpose: string | null, about: string | null, slug: string): Promise<void> {
  const out = path.join(OUT, arm, `${slug}.json`);
  if (fs.existsSync(out)) throw new Error(`refusing to overwrite ${path.relative(process.cwd(), out)}`);
  /* Snapshot before importing and calling the generator: a snapshot taken
     after a long model call can name edits that the already-loaded module did
     not send. Refuse the result if the source bytes moved during the call. */
  const source = sourceProvenance();
  const { generateQuiz } = await import("../src/quiz.js");
  const { renderProfile } = await import("../src/profile.js");
  await withArticle(slug, async (article) => {
    const profile = renderProfile({ profile: about, purpose });
    console.log(`${arm}: ${slug} — ${profile ?? "no profile"}`);
    const run = await generateQuiz({ power: "standard", article, profile });
    const after = sourceProvenance();
    if (after.quizSourceSha256 !== source.quizSourceSha256) {
      throw new Error("src/quiz.ts changed during the model call; refusing to record false provenance");
    }
    const file: ArmFile = {
      arm,
      slug,
      purpose,
      about,
      at: new Date().toISOString(),
      provenance: { ...source, model: run.model },
      order: article.blocks.map((b) => b.id),
      parts: await partsOfArticle(article),
      dropped: { ...run.dropped },
      questions: run.quiz.questions.map((q) => ({
        ...(q.premise ? { premise: q.premise } : {}),
        question: q.question,
        referenceAnswer: q.referenceAnswer,
        evidence: q.evidence.map((e) => e.blockId),
      })),
    };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
    console.log(`  wrote ${path.relative(process.cwd(), out)}: ${file.questions.length} questions`);
  });
}

function readArm(arm: string, slug: string): ArmFile {
  const f = path.join(OUT, arm, `${slug}.json`);
  if (!fs.existsSync(f)) throw new Error(`no run ${path.relative(process.cwd(), f)}`);
  return JSON.parse(fs.readFileSync(f, "utf8")) as ArmFile;
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

/** One line of a TSV: tabs and line breaks inside a field become spaces. */
const tsv = (fields: (string | number)[]) => fields.map((f) => String(f).replace(/[\t\r\n]+/g, " ")).join("\t");

/**
 * The judge's sheet. Order is a sha256 of the seed and the question's own
 * coordinates, so it is fixed by the seed and blind to the arm's name only in
 * the sense that matters — the judge sees neither the arm nor its neighbours'.
 */
export function blindOrder<T extends { arm: string; index: number }>(seed: string, items: T[]): T[] {
  const keyOf = (x: { arm: string; index: number }) =>
    createHash("sha256").update(`${seed}\u0000${x.arm}\u0000${x.index}`).digest("hex");
  return [...items].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
}

function blind(slug: string, seed: string, arms: string[], dir: string): void {
  const items = arms.flatMap((arm) => readArm(arm, slug).questions.map((q, index) => ({ arm, index, q })));
  const ordered = blindOrder(seed, items);
  fs.mkdirSync(dir, { recursive: true });
  const sheet = [tsv(["id", "premise", "question", "referenceAnswer"])];
  const key = [tsv(["id", "arm", "index"])];
  for (const [i, x] of ordered.entries()) {
    const id = i + 1;
    sheet.push(tsv([id, x.q.premise ?? "", x.q.question, x.q.referenceAnswer ?? ""]));
    key.push(tsv([id, x.arm, x.index + 1]));
  }
  fs.writeFileSync(path.join(dir, "questions.tsv"), `${sheet.join("\n")}\n`);
  fs.writeFileSync(path.join(dir, "key.tsv"), `${key.join("\n")}\n`);
  /* The balance check the prompting guide asks for before judging: each arm's
     questions should fall across both halves of the sheet, not bunch in one. */
  const half = Math.ceil(ordered.length / 2);
  console.log(`${ordered.length} questions from ${arms.length} arms → ${dir}`);
  for (const arm of arms) {
    const at = ordered.flatMap((x, i) => (x.arm === arm ? [i] : []));
    console.log(`  ${arm.padEnd(16)} ${at.filter((i) => i < half).length} in the first half, ${at.filter((i) => i >= half).length} in the second`);
  }
}

/**
 * Join `labels.tsv` (`id`, then one column per label, a header row naming them)
 * to the key, and count each label's values per arm. GOAL-on questions get a
 * second table of TOPIC, because "the reason leads and who they are chooses
 * within it" is a claim about the topics *inside* the goal.
 */
function validateScoreRows(keyHead: string[], keyRows: string[][], labelHead: string[], labelRows: string[][]): void {
  if (keyHead[0] !== "id" || labelHead[0] !== "id") throw new Error("key.tsv and labels.tsv must begin with an id column");
  const keyIds = keyRows.map((r) => r[0] ?? "");
  if (new Set(keyIds).size !== keyIds.length) throw new Error("key.tsv contains a duplicate id");
  const columns = labelHead.slice(1);
  if (columns.length === 0 || new Set(columns).size !== columns.length) throw new Error("labels.tsv needs distinct label columns");
  if (labelRows.length !== keyRows.length) {
    throw new Error(`${labelRows.length} labels for ${keyRows.length} questions — the judge skipped or added some`);
  }
  const labelIds = labelRows.map((r) => r[0] ?? "");
  if (new Set(labelIds).size !== labelIds.length) throw new Error("labels.tsv contains a duplicate id");
  const labelIdSet = new Set(labelIds);
  const missing = keyIds.find((id) => !labelIdSet.has(id));
  if (missing) throw new Error(`labels.tsv is missing id ${missing}`);
}

export function score(dir: string): void {
  const rows = (f: string) =>
    fs.readFileSync(path.join(dir, f), "utf8").trim().split("\n").map((l) => l.split("\t"));
  const [keyHead, ...keyRows] = rows("key.tsv");
  const [labelHead, ...labelRows] = rows("labels.tsv");
  if (!keyHead || !labelHead) throw new Error("empty key or labels");
  validateScoreRows(keyHead, keyRows, labelHead, labelRows);
  const armOf = new Map(keyRows.map((r) => [r[0], r[1] ?? "?"]));
  const columns = labelHead.slice(1);
  const tally = new Map<string, Map<string, number>>();
  const bump = (arm: string, k: string) => {
    const t = tally.get(arm) ?? new Map<string, number>();
    t.set(k, (t.get(k) ?? 0) + 1);
    tally.set(arm, t);
  };
  for (const r of labelRows) {
    const arm = armOf.get(r[0]);
    if (!arm) throw new Error(`label for unknown id ${r[0]}`);
    if (r.length !== labelHead.length || r.slice(1).some((value) => value.trim() === "")) {
      throw new Error(`incomplete labels for id ${r[0]}`);
    }
    bump(arm, "n");
    const goalAt = columns.indexOf("GOAL");
    const topicAt = columns.indexOf("TOPIC");
    for (const [c, name] of columns.entries()) bump(arm, `${name}=${(r[c + 1] ?? "").trim()}`);
    if (goalAt >= 0 && topicAt >= 0 && r[goalAt + 1]?.trim() === "ON") bump(arm, `GOAL-ON TOPIC=${r[topicAt + 1]?.trim()}`);
  }
  for (const arm of [...tally.keys()].sort()) {
    const t = tally.get(arm)!;
    const n = t.get("n") ?? 0;
    const cells = [...t.entries()].filter(([k]) => k !== "n").sort(([a], [b]) => a.localeCompare(b));
    console.log(`\n${arm} (${n} questions)`);
    for (const [k, v] of cells) console.log(`  ${k.padEnd(28)} ${String(v).padStart(3)}  ${Math.round((100 * v) / n)}%`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  const FLAGS = ["--arm", "--purpose", "--about", "--parts", "--seed", "--arms", "--out", "--dir"];
  const flag = (name: string) => {
    const at = rest.indexOf(name);
    return at >= 0 ? rest[at + 1] : undefined;
  };
  const named = new Set(FLAGS.flatMap((n) => {
    const at = rest.indexOf(n);
    return at >= 0 ? [at, at + 1] : [];
  }));
  const slug = rest.find((_, i) => !named.has(i));
  if (cmd === "score") {
    const dir = flag("--dir");
    if (!dir) throw new Error("score needs --dir <dir>");
    score(dir);
    process.exit(0);
  }
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
  } else if (cmd === "blind") {
    const seed = flag("--seed");
    const arms = (flag("--arms") ?? "").split(",").filter(Boolean);
    const out = flag("--out");
    if (!seed || arms.length === 0 || !out) throw new Error("blind needs --seed, --arms and --out");
    blind(slug, seed, arms, out);
  } else {
    throw new Error("usage: quiz-reading-goal.ts parts|generate|report|blind|score …");
  }
}
