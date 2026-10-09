/**
 * **Unblind the judges' scores and tally them by arm** — plan 261009a § Stage 3.
 *
 *   npx tsx evals/digest/tally.ts > evals/results/digest-2026-10-09/judging/tally.md   # free
 *
 * Reads every `<judge>-<slug>.json` in judging/ with key.json, and prints, per
 * judge and pooled: each arm's mean overall score (1–10) and mean of the four
 * 1–5 criteria, by task and in all; each arm's score minus Opus's on the same
 * lineup (0 = as good as Opus), with how many lineups it was within one point
 * of Opus or above; and how far the two judges agree on the arm ordering.
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dirFlag = process.argv.indexOf("--dir");
if (dirFlag !== -1 && !process.argv[dirFlag + 1]) throw new Error("--dir needs a judging directory");
const DIR = dirFlag === -1 ? path.join(HERE, "..", "results", "digest-2026-10-09", "judging") : process.argv[dirFlag + 1]!;
const ARMS = ["A-opus", "B-sonnet", "C-sonnet+digest", "D-haiku", "E-haiku+digest"] as const;
type Arm = (typeof ARMS)[number];
const CRITERIA = ["accuracy", "coverage", "nuance", "usefulness"] as const;
const tasks = ["summary-fuller", "ideas", "chat-q1", "chat-q2"];
const JUDGES = ["opus", "sol"];
const LETTERS = ["V", "W", "X", "Y", "Z"];

function exactKeys(value: unknown, expected: readonly string[], label: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\n") !== [...expected].sort().join("\n")) {
    throw new Error(`${label}: expected exactly ${expected.join(", ")}`);
  }
}

interface Score {
  accuracy: number;
  coverage: number;
  nuance: number;
  usefulness: number;
  overall: number;
  note: string;
}
interface Judgement {
  judge: string;
  slug: string;
  lineups: Record<string, { scores: Record<string, Score>; rank: unknown; separates: string }>;
}

const key = JSON.parse(fs.readFileSync(path.join(DIR, "key.json"), "utf8")) as Record<
  string,
  Record<string, Record<string, Arm>>
>;

/** One row per judge × slug × task × arm. */
interface Row {
  judge: string;
  slug: string;
  task: string;
  arm: Arm;
  score: Score;
}

function parse(file: string): Judgement {
  const raw = fs.readFileSync(path.join(DIR, file), "utf8");
  /* A Codex answer file may wrap the JSON in a fence or a sentence. */
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return JSON.parse(raw.slice(start, end + 1)) as Judgement;
}

const rows: Row[] = [];
if (!Object.keys(key).length) throw new Error("empty judging key");
const expectedFiles = Object.keys(key).flatMap((slug) => JUDGES.map((judge) => `${judge}-${slug}.json`));
exactKeys(Object.fromEntries(fs.readdirSync(DIR).filter((f) => /^(opus|sol)-.*\.json$/.test(f)).map((f) => [f, true])), expectedFiles, "judge files");
for (const [slug, keyedTasks] of Object.entries(key)) {
  exactKeys(keyedTasks, tasks, `${slug} key tasks`);
  for (const [task, letters] of Object.entries(keyedTasks)) {
    exactKeys(letters, LETTERS, `${slug}/${task} key letters`);
    if (Object.values(letters).sort().join("\n") !== [...ARMS].sort().join("\n")) throw new Error(`${slug}/${task}: key must map each arm once`);
  }
}
for (const file of expectedFiles) {
  /* Missing, partial and malformed judgements must fail the whole tally. */
  const j = parse(file);
  if (`${j.judge}-${j.slug}.json` !== file) throw new Error(`${file}: judge/slug does not match filename`);
  exactKeys(j.lineups, tasks, `${file} lineups`);
  for (const [task, lineup] of Object.entries(j.lineups)) {
    exactKeys(lineup.scores, LETTERS, `${file}/${task} scores`);
    for (const [letter, score] of Object.entries(lineup.scores)) {
      for (const criterion of [...CRITERIA, "overall"] as const) {
        const n = score?.[criterion];
        if (!Number.isFinite(n) || n < 1 || n > (criterion === "overall" ? 10 : 5)) throw new Error(`${file}/${task}/${letter}: invalid ${criterion}`);
      }
      if (typeof score.note !== "string") throw new Error(`${file}/${task}/${letter}: missing note`);
      const arm = key[j.slug]?.[task]?.[letter];
      if (!arm) throw new Error(`${file}: no key for ${j.slug} ${task} ${letter}`);
      rows.push({ judge: j.judge, slug: j.slug, task, arm, score });
    }
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN);
const f = (x: number) => (Number.isNaN(x) ? "–" : x.toFixed(2));
const judges = [...new Set(rows.map((r) => r.judge))].sort();

const out: string[] = [];
out.push("# Digest spike — the judges' scores, unblinded\n");
out.push(`Judges: ${judges.join(", ")}. Lineups judged: ${new Set(rows.map((r) => `${r.judge}/${r.slug}/${r.task}`)).size}.\n`);

/**
 * **Cells that failed for a reason that is not the writing** — scored 1 by the
 * judges, as the brief says, and shown that way above; left out of the last
 * table so a route or the harness does not stand in for quality. Each is in
 * costs.md and the write-up: two Sonnet Ideas answers refused by Azure's
 * content filter (production prefers Anthropic but allows fallback); one Sonnet chat answer
 * that wrote a web-search call as text, because chat's prompt names tools the
 * eval did not send; one Opus chat answer cut off at production's 4,000-token
 * ceiling (a real production risk, but not a judgement of its prose).
 */
const exclusionFile = path.join(DIR, "exclusions.json");
const exclusions = fs.existsSync(exclusionFile)
  ? (JSON.parse(fs.readFileSync(exclusionFile, "utf8")) as {
      cells: { slug: string; task: string; arm: Arm; rawSha256: string; reason: string }[];
    }).cells
  : [];
const NOT_THE_WRITING = new Set<string>();
for (const c of exclusions) {
  if (!key[c.slug]?.[c.task] || !ARMS.includes(c.arm)) throw new Error("exclusion has no matching lineup/arm");
  const cell = JSON.parse(fs.readFileSync(path.join(DIR, "..", c.slug, c.task, `${c.arm}.json`), "utf8")) as { raw: string };
  if (createHash("sha256").update(cell.raw).digest("hex") !== c.rawSha256) throw new Error(`${c.slug}/${c.task}/${c.arm}: exclusion is for a different output`);
  NOT_THE_WRITING.add(`${c.slug}/${c.task}/${c.arm}`);
}
const lineupsWithout = new Set([...NOT_THE_WRITING].map((c) => c.split("/").slice(0, 2).join("/")));

for (const judge of [...judges, "pooled", "pooled, without the failed lineups"]) {
  const pooled = judge.startsWith("pooled");
  const mine = rows.filter(
    (r) =>
      (pooled || r.judge === judge) &&
      !(judge === "pooled, without the failed lineups" && lineupsWithout.has(`${r.slug}/${r.task}`)),
  );
  out.push(
    `\n## ${judge === "pooled" ? "Both judges pooled" : pooled ? `Both judges pooled, without the ${lineupsWithout.size} lineups where any arm failed for a reason that is not the writing` : `Judge: ${judge}`}\n`,
  );
  out.push(`| arm | ${tasks.join(" | ")} | all (overall /10) | criteria mean /5 | vs Opus | within 1 of Opus or better |`);
  out.push(`|---|${tasks.map(() => "---").join("|")}|---|---|---|---|`);
  for (const arm of ARMS) {
    const a = mine.filter((r) => r.arm === arm);
    const byTask = tasks.map((t) => f(mean(a.filter((r) => r.task === t).map((r) => r.score.overall))));
    const deltas = a.map((r) => {
      const opus = mine.find((o) => o.judge === r.judge && o.slug === r.slug && o.task === r.task && o.arm === "A-opus");
      return opus ? r.score.overall - opus.score.overall : Number.NaN;
    });
    const close = deltas.filter((d) => d >= -1).length;
    out.push(
      `| ${arm} | ${byTask.join(" | ")} | ${f(mean(a.map((r) => r.score.overall)))} | ${f(
        mean(a.flatMap((r) => CRITERIA.map((c) => r.score[c]))),
      )} | ${arm === "A-opus" ? "0" : f(mean(deltas))} | ${arm === "A-opus" ? "–" : `${close}/${deltas.length}`} |`,
    );
  }
}

/* Agreement: for each lineup both judges scored, do they order each pair of arms the same way? */
if (judges.length === 2) {
  const [j1, j2] = judges as [string, string];
  let same = 0;
  let opposite = 0;
  let tiedOne = 0;
  for (const slug of Object.keys(key)) {
    for (const task of tasks) {
      const s1 = new Map(rows.filter((r) => r.judge === j1 && r.slug === slug && r.task === task).map((r) => [r.arm, r.score.overall]));
      const s2 = new Map(rows.filter((r) => r.judge === j2 && r.slug === slug && r.task === task).map((r) => [r.arm, r.score.overall]));
      if (s1.size === 0 || s2.size === 0) continue;
      for (let i = 0; i < ARMS.length; i++) {
        for (let k = i + 1; k < ARMS.length; k++) {
          const d1 = Math.sign((s1.get(ARMS[i]!) ?? 0) - (s1.get(ARMS[k]!) ?? 0));
          const d2 = Math.sign((s2.get(ARMS[i]!) ?? 0) - (s2.get(ARMS[k]!) ?? 0));
          if (d1 === 0 || d2 === 0) tiedOne++;
          else if (d1 === d2) same++;
          else opposite++;
        }
      }
    }
  }
  out.push(`\n## Agreement between ${j1} and ${j2}\n`);
  out.push(
    `Over every pair of arms in every lineup both judged: same order ${same}, opposite order ${opposite}, a tie from at least one judge ${tiedOne}.`,
  );
}

out.push("\n## Notes, per lineup (unblinded)\n");
for (const slug of Object.keys(key)) {
  for (const task of tasks) {
    const here = rows.filter((r) => r.slug === slug && r.task === task);
    if (here.length === 0) continue;
    out.push(`\n### ${slug} — ${task}\n`);
    for (const arm of ARMS) {
      for (const r of here.filter((x) => x.arm === arm)) {
        out.push(`- **${arm}** (${r.judge}, ${r.score.overall}/10): ${r.score.note}`);
      }
    }
  }
}

console.log(out.join("\n"));
