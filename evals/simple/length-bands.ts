/**
 * **Does Summary's length follow the piece's, and is the new length worth
 * reading?** — the measurement for
 * docs/plans/261005b-summary-length-follows-the-length-of-the-piece.md, written
 * up in docs/investigations/261005a-summary-length-bands-measured.md.
 *
 *   npx tsx evals/simple/length-bands.ts table    # free: words, waits and cost per arm
 *   npx tsx evals/simple/length-bands.ts pairs    # free: the blind pairs and their key
 *   npx tsx evals/simple/length-bands.ts score    # free: the judge's answers, unblinded
 *
 * Reads the arms `evals/simple/probe.ts` wrote under evals/results/simple/:
 * `high-none-len0a|len0b` (the prompt before bands, twice) and
 * `high-none-len1a|len1b` (with bands), and `high-none-len1whole`, the one
 * book write that carried the "cover the whole of it" sentence the plan
 * dropped. Calls no model.
 *
 * **Four of the `len0` files were written with the long bands switched off by a
 * one-line edit rather than on the commit before** (race and dodo, both
 * draws): the standard band's prompt is the old prompt byte for byte, so with
 * every piece forced into it sends the old prompt. The files do not record
 * its answer budget or limits. Their
 * `sourceSha256` is therefore not the pre-change file's.
 *
 * **pairs** — same article, same level: the test (before `a` against after
 * `a`, `b` against `b`) and the control (before `a` against before `b`),
 * shuffled together, sides from the tested `blindCoin`
 * (evals/plain-words/run.ts). A length change cannot be judged blind *for
 * length*, since the longer side is visibly longer; the judge is asked what
 * the length was spent on instead. A short piece's pairs carry its whole
 * body, so an omission can be checked against the source (GPT Sol's plan
 * review, F3); a longer piece's carry its headings, for coverage.
 *
 * **The arms, in the order they were written.** `len1a|len1b` banded Brief as
 * well as Fuller and carried no "cover the whole of it" sentence; the judge
 * preferred the old Brief, so what shipped bands Fuller alone. `len2a|len2b`
 * are the long article and the book again with that sentence in Fuller;
 * that sentence did not ship. Their Brief is the old prompt's. `pairs sentence` and
 * `score sentence` are the second round: Fuller with the sentence (`len2`)
 * against without (`len1`), and `len1a` against `len1b` as its control.
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../../src/env.js";
import { blindCoin } from "../plain-words/run.js";

const RESULTS = path.join(import.meta.dirname, "..", "results", "simple");
const OUT = path.join(RESULTS, "length-bands-261005b");
const SLUGS = [
  "identity-spya-k8x09v",
  "fh-spya-s3fq0d",
  "dodo-spya-nyc4ud",
  "scaling-hypothesis",
  "race-human-categorization-spya-rpwc59",
  "s3-gdl-45mb-spya-cc9kr8",
] as const;
const ARMS = ["len0a", "len0b", "len1a", "len1b", "len1whole", "len2a", "len2b"] as const;
type Arm = (typeof ARMS)[number];
type Level = "brief" | "fuller";
type Para = { text: string; ids: string[] };
interface Run {
  ok: boolean;
  error?: string;
  bodyWords: number;
  band?: string;
  wallMs: number;
  costUsd: number | null;
  briefWords?: number;
  fullerWords?: number;
  briefReadyMs?: number;
  fullerReadyMs?: number;
  brief?: Para[];
  fuller?: Para[];
  check?: { levels: Record<string, { result: string; attempts: number }> };
}

function load(arm: Arm, slug: string): Run | null {
  const file = path.join(RESULTS, `high-none-${arm}`, `${slug}.json`);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Run) : null;
}

function table(): void {
  console.log("| piece | body words | arm | band asked | Brief words | Fuller words | Fuller paragraphs | wait to Brief s | wait to Fuller s | guard, Brief / Fuller | $ |");
  console.log("|---|---:|---|---|---:|---:|---:|---:|---:|---|---:|");
  for (const slug of SLUGS) {
    for (const arm of ARMS) {
      const r = load(arm, slug);
      if (!r) continue;
      if (!r.ok) {
        console.log(`| ${slug} | ${r.bodyWords} | ${arm} | ${r.band ?? "-"} | **failed**: ${r.error} |`);
        continue;
      }
      const guard = (level: Level) => {
        const c = r.check?.levels[level];
        return c ? `${c.result}${c.attempts > 1 ? " (2 tries)" : ""}` : "-";
      };
      /* A `len0` file has no band, or the forced one: it was asked the old prompt. */
      const asked = arm.startsWith("len0") ? "none (old prompt)" : (r.band ?? "-");
      console.log(
        `| ${slug} | ${r.bodyWords} | ${arm} | ${asked} | ${r.briefWords} | ${r.fullerWords} | ${r.fuller?.length} | ${((r.briefReadyMs ?? 0) / 1000).toFixed(1)} | ${((r.fullerReadyMs ?? 0) / 1000).toFixed(1)} | ${guard("brief")} / ${guard("fuller")} | ${r.costUsd?.toFixed(3) ?? "?"} |`,
      );
    }
  }
}

interface Pair {
  id: string;
  kind: "test" | "control" | "whole";
  slug: string;
  level: Level;
  left: Arm;
  right: Arm;
}

async function pairs(round: "" | "-sentence"): Promise<void> {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const { isBodyEvidence } = await import("../../src/block-policy.js");
  const { closeDb } = await import("../../src/db/client.js");

  const wanted: Omit<Pair, "id">[] = [];
  for (const slug of round === "-sentence" ? (["race-human-categorization-spya-rpwc59", "s3-gdl-45mb-spya-cc9kr8"] as const) : []) {
    wanted.push({ kind: "test", slug, level: "fuller", left: "len1a", right: "len2a" });
    wanted.push({ kind: "test", slug, level: "fuller", left: "len1b", right: "len2b" });
    wanted.push({ kind: "control", slug, level: "fuller", left: "len1a", right: "len1b" });
  }
  for (const slug of round === "" ? SLUGS : []) {
    const band = load("len1b", slug)?.band;
    /* Brief only where its prompt changed; Fuller everywhere, the standard
       band's pairs being a second control (same prompt on both sides). */
    const levels: Level[] = band === "standard" ? ["fuller"] : ["brief", "fuller"];
    for (const level of levels) {
      wanted.push({ kind: "test", slug, level, left: "len0a", right: "len1a" });
      wanted.push({ kind: "test", slug, level, left: "len0b", right: "len1b" });
      wanted.push({ kind: "control", slug, level, left: "len0a", right: "len0b" });
    }
  }
  /* The one question the dropped sentence leaves: with it or without. */
  if (round === "") wanted.push({ kind: "whole", slug: "s3-gdl-45mb-spya-cc9kr8", level: "fuller", left: "len1whole", right: "len1b" });

  /* Shuffle the order with the same tested generator, then flip sides. */
  const coin = blindCoin(round === "" ? 261005 : 261006);
  const order = wanted.map((w) => ({ w, k: [coin(), coin(), coin(), coin(), coin(), coin(), coin(), coin()].join("") }));
  order.sort((x, y) => (x.k < y.k ? -1 : x.k > y.k ? 1 : 0));

  const sources = new Map<string, string>();
  await runAsOwner(environmentOwnerId(), async () => {
    for (const slug of SLUGS) {
      const article = await loadArticle(slug);
      const body = article.blocks.filter(isBodyEvidence);
      const words = body.reduce((n, b) => n + b.words, 0);
      const title = article.meta?.title ?? slug;
      if (words < 2_500) {
        sources.set(slug, `**The piece, in full** ("${title}", ${words} words):\n\n${body.map((b) => b.text).join("\n\n")}`);
      } else {
        const headings = body.filter((b) => /^h[1-4]$/.test(b.tag)).map((b) => `${"  ".repeat(Number(b.tag[1]) - 1)}- ${b.text}`);
        sources.set(slug, `**The piece's headings, in order** ("${title}", ${words} words):\n\n${headings.join("\n")}`);
      }
    }
  });
  await closeDb();

  const lines: string[] = [
    "# Pairs of summaries of the same piece",
    "",
    "Each pair is two summaries of one piece, written for a reader about to read it. The sides are in a random order. Judge each pair on its own.",
    "",
  ];
  const key: Record<string, unknown>[] = [];
  let n = 0;
  const sideCount = { after: { A: 0, B: 0 } };
  for (const { w } of order) {
    const l = load(w.left, w.slug);
    const r = load(w.right, w.slug);
    /* Scaling has no `len0a`; its a test and control are omitted. Earlier
       same-prompt writes are reported separately, not substituted here. */
    if (!l || !r) {
      console.log(`no pair for ${w.slug} ${w.level} ${w.left}/${w.right}: one side was never written`);
      continue;
    }
    if (!l.ok || !r.ok) throw new Error(`failed run for ${w.slug} ${w.left}/${w.right}`);
    n += 1;
    const id = `P${String(n).padStart(2, "0")}`;
    const flip = coin();
    const [a, b] = flip ? [r, l] : [l, r];
    const [aArm, bArm] = flip ? [w.right, w.left] : [w.left, w.right];
    if (w.kind === "test") sideCount.after[flip ? "A" : "B"] += 1;
    const prose = (run: Run) => (run[w.level] ?? []).map((p) => p.text).join("\n\n");
    lines.push(`## ${id}`, "", sources.get(w.slug) ?? "", "", "### Summary A", "", prose(a), "", "### Summary B", "", prose(b), "");
    key.push({ id, kind: w.kind, slug: w.slug, level: w.level, A: aArm, B: bArm });
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `pairs${round}.md`), `${lines.join("\n")}\n`);
  fs.writeFileSync(path.join(OUT, `key${round}.json`), `${JSON.stringify(key, null, 2)}\n`);
  console.log(`${n} pairs. In the test pairs the new prompt is side A ${sideCount.after.A} times and side B ${sideCount.after.B} times.`);
}

/**
 * **score** — the judge's answers (judge.md, written by a subagent that read
 * only pairs.md) put beside the key. Each answer's first word is its verdict
 * (`A`, `B`, `both`, `neither`, `same`, `no`); the side is turned back into
 * the arm that wrote it. Prints one row a pair and the tallies.
 */
function score(round: "" | "-sentence"): void {
  const key = JSON.parse(fs.readFileSync(path.join(OUT, `key${round}.json`), "utf8")) as {
    id: string;
    kind: string;
    slug: string;
    level: Level;
    A: Arm;
    B: Arm;
  }[];
  const judged = fs.readFileSync(path.join(OUT, `judge${round}.md`), "utf8");
  const QUESTIONS = ["pad", "bent", "omit", "coverage", "prefer"] as const;
  /* Round one: the banded prompt against the old. Round two: with the sentence against without. */
  const isNew = (arm: Arm) => (round === "" ? arm === "len1a" || arm === "len1b" : arm === "len2a" || arm === "len2b");
  /** A verdict as the arm(s) it names: `old`, `new`, `both`, `neither`, or the arm's name outside a test pair. */
  const named = (verdict: string, k: (typeof key)[number]): string => {
    if (verdict !== "A" && verdict !== "B") return verdict;
    const arm = k[verdict];
    return k.kind === "test" ? (isNew(arm) ? "new" : "old") : arm;
  };
  const tallies: Record<string, Record<string, number>> = {};
  console.log("| pair | kind | piece | level | A | B | pad | bent | omit | coverage | prefer |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const k of key) {
    const start = judged.indexOf(`## ${k.id}\n`);
    if (start < 0) throw new Error(`the judge has no section for ${k.id}`);
    const next = judged.indexOf("\n## P", start + 1);
    const section = judged.slice(start, next < 0 ? undefined : next);
    const cells = QUESTIONS.map((q) => {
      const m = new RegExp(`^${q}: *(A|B|[Bb]oth|[Nn]either|[Ss]ame|[Nn]o)\\b`, "m").exec(section);
      if (!m) return "-";
      const verdict = named(m[1]!.length === 1 ? m[1]! : m[1]!.toLowerCase(), k);
      const group = `${k.kind} ${k.level} ${q}`;
      tallies[group] ??= {};
      tallies[group][verdict] = (tallies[group][verdict] ?? 0) + 1;
      return verdict;
    });
    if (cells.filter((c) => c === "-").length !== 1) {
      throw new Error(`${k.id}: expected every question but one of omit/coverage, got ${cells.join(", ")}`);
    }
    console.log(`| ${k.id} | ${k.kind} | ${k.slug} | ${k.level} | ${k.A} | ${k.B} | ${cells.join(" | ")} |`);
  }
  console.log("");
  for (const group of Object.keys(tallies).sort()) {
    console.log(`${group}: ${Object.entries(tallies[group]!).map(([v, n]) => `${v} ${n}`).join(", ")}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  const round = process.argv[3] === "sentence" ? "-sentence" : "";
  if (cmd === "table") table();
  else if (cmd === "pairs") await pairs(round);
  else if (cmd === "score") score(round);
  else throw new Error("usage: table | pairs [sentence] | score [sentence]");
}
