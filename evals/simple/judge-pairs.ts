/**
 * **The blind read for plan 261001b** — builds a pairs file a fresh judge
 * reads, and a key it never sees. Free: it reads evals/results/simple/ and the
 * local database (for the passages each paragraph cites), and calls no model.
 *
 *   npx tsx evals/simple/judge-pairs.ts
 *
 * Four tasks, each answering one of the claims declared in the plan's ledger
 * (Sol's plan review, P1-5):
 *
 *  - **T1 background**: today's Simple (no profile) against the new Simple
 *    written for the reader in readers.json — which spends fewer words
 *    explaining what that reader already knows? And did either lose, bend or
 *    blur a claim against the passages it cites?
 *  - **T2 goal**: the same reader with goal A against goal B, same article and
 *    repeat — given both goals, which text was written for goal A? Chance is
 *    50%; every level is asked.
 *  - **T3 plainness with no profile**: today's Simple against the new Simple
 *    with no profile — which would an outsider find easier? Fidelity too.
 *  - **T4 the ladder**: one run's three levels, shuffled — order them from
 *    simplest to most complex.
 *
 * Sides and orders come from `crypto.randomInt`, not a float LCG — a blind
 * read here once had its new arm on one side 94 times in 95. The balance is
 * printed, and checked before the judge is sent.
 */
import fs from "node:fs";
import path from "node:path";
import { randomInt } from "node:crypto";
import { loadEnvLocal } from "../../src/env.js";

const RESULTS = path.join(import.meta.dirname, "..", "results", "simple");
const OUT = path.join(RESULTS, "judge-261001");
const SLUGS = ["scaling-hypothesis", "olah-a4-spya-ujr7p0", "entropy-24-00930-spya-pywwkq"];
type Para = { text: string; ids: string[] };
type Level = "brief" | "simple" | "fuller";
interface Run {
  ok: boolean;
  paragraphs?: Para[];
  fuller?: Para[];
  brief?: Para[];
}

const readers = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "readers.json"), "utf8")) as {
  about: string;
  known: string[];
  goals: Record<string, Record<"A" | "B", { goal: string }>>;
};

function run(arm: string, slug: string): Run | null {
  const file = path.join(RESULTS, arm, `${slug}.json`);
  if (!fs.existsSync(file)) return null;
  const r = JSON.parse(fs.readFileSync(file, "utf8")) as Run;
  return r.ok ? r : null;
}
const level = (r: Run, l: Level): Para[] => (l === "simple" ? r.paragraphs : l === "fuller" ? r.fuller : r.brief) ?? [];
const prose = (ps: Para[]) => ps.map((p) => p.text).join("\n\n");

loadEnvLocal();
const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
const { loadArticle } = await import("../../src/store/index.js");
const { closeDb } = await import("../../src/db/client.js");
const blockText = new Map<string, string>();
await runAsOwner(environmentOwnerId(), async () => {
  for (const slug of SLUGS) {
    const article = await loadArticle(slug);
    for (const b of article.blocks) blockText.set(`${slug}:${b.id}`, b.text);
  }
});
await closeDb();

/** A text with the passages it cites, for the fidelity question. */
function withSources(slug: string, ps: Para[]): string {
  return ps
    .map((p) => {
      const cited = p.ids.map((id) => `    [${id}] ${(blockText.get(`${slug}:${id}`) ?? "(missing)").slice(0, 900)}`);
      return `${p.text}\n  Cited passages:\n${cited.join("\n")}`;
    })
    .join("\n\n");
}

const lines: string[] = [];
const key: Record<string, unknown> = {};
let n = 0;
const sides = { t1NewOnX: 0, t1: 0, t2AOnX: 0, t2: 0, t3NewOnX: 0, t3: 0 };

lines.push(
  "# Blind read — plain-words summaries",
  "",
  "Answer every item. Use only what is on this page. For each item write one line in the form the item asks for, then one sentence of reason.",
  "",
  "## The reader for T1",
  "",
  `About the reader: ${readers.about}`,
  "",
  `They already know: ${readers.known.join("; ")}.`,
  "",
);

/* T1 — background, and fidelity. */
for (const slug of SLUGS) {
  for (const [before, after] of [
    ["high-15-beforeA", "high-about-slider1"],
    ["high-15-beforeB", "high-about-slider2"],
  ] as const) {
    const b = run(before, slug);
    const a = run(after, slug);
    if (!b || !a) continue;
    n += 1;
    const id = `T1-${n}`;
    const newOnX = randomInt(2) === 0;
    sides.t1 += 1;
    if (newOnX) sides.t1NewOnX += 1;
    const [x, y] = newOnX ? [level(a, "simple"), level(b, "simple")] : [level(b, "simple"), level(a, "simple")];
    key[id] = { task: "T1", slug, x: newOnX ? after : before, y: newOnX ? before : after };
    lines.push(
      `## ${id} (T1)`,
      "",
      "Q1: For the reader described above, which text spends FEWER words explaining things they already know? Answer X, Y or SAME.",
      "Q2: Against its cited passages, does either text lose, bend, or blur a claim (a number, the direction of a finding, a hedge), or add something the passages do not say? Answer NONE, X, Y or BOTH, and name it.",
      "",
      "### X",
      "",
      withSources(slug, x),
      "",
      "### Y",
      "",
      withSources(slug, y),
      "",
    );
  }
}

/* T2 — goal discrimination, at every level. */
for (const slug of SLUGS) {
  for (const rep of ["1", "2"]) {
    const a = run(`high-goalA-slider${rep}`, slug);
    const b = run(`high-goalB-slider${rep}`, slug);
    if (!a || !b) continue;
    for (const l of ["brief", "simple", "fuller"] as const) {
      n += 1;
      const id = `T2-${n}`;
      const aOnX = randomInt(2) === 0;
      sides.t2 += 1;
      if (aOnX) sides.t2AOnX += 1;
      key[id] = { task: "T2", slug, level: l, rep, answer: aOnX ? "X" : "Y" };
      const goals = readers.goals[slug];
      lines.push(
        `## ${id} (T2)`,
        "",
        `Two readers each said why they were reading the same article. Goal A: "${goals?.A.goal}" Goal B: "${goals?.B.goal}"`,
        "Q: Which text was written for the reader with goal A? Answer X or Y.",
        "",
        "### X",
        "",
        prose(level(aOnX ? a : b, l)),
        "",
        "### Y",
        "",
        prose(level(aOnX ? b : a, l)),
        "",
      );
    }
  }
}

/* T3 — plainness with no profile, and fidelity. */
for (const slug of SLUGS) {
  for (const [before, after] of [
    ["high-15-beforeA", "high-none-slider1"],
    ["high-15-beforeB", "high-none-slider2"],
  ] as const) {
    const b = run(before, slug);
    const a = run(after, slug);
    if (!b || !a) continue;
    n += 1;
    const id = `T3-${n}`;
    const newOnX = randomInt(2) === 0;
    sides.t3 += 1;
    if (newOnX) sides.t3NewOnX += 1;
    const [x, y] = newOnX ? [level(a, "simple"), level(b, "simple")] : [level(b, "simple"), level(a, "simple")];
    key[id] = { task: "T3", slug, x: newOnX ? after : before, y: newOnX ? before : after };
    lines.push(
      `## ${id} (T3)`,
      "",
      "Q1: Which would a reader from outside the field understand more easily? Answer X, Y or SAME.",
      "Q2: Against its cited passages, does either text lose, bend, or blur a claim, or add something the passages do not say? Answer NONE, X, Y or BOTH, and name it.",
      "",
      "### X",
      "",
      withSources(slug, x),
      "",
      "### Y",
      "",
      withSources(slug, y),
      "",
    );
  }
}

/* T4 — the ladder. */
for (const slug of SLUGS) {
  for (const arm of ["high-none-slider1", "high-none-slider2", "high-about-slider1", "high-about-slider2"]) {
    const r = run(arm, slug);
    if (!r) continue;
    n += 1;
    const id = `T4-${n}`;
    const order = (["brief", "simple", "fuller"] as Level[])
      .map((l) => ({ l, k: randomInt(1_000_000) }))
      .sort((p, q) => p.k - q.k)
      .map((p) => p.l);
    const names = ["P", "Q", "R"] as const;
    key[id] = { task: "T4", slug, arm, P: order[0], Q: order[1], R: order[2] };
    lines.push(
      `## ${id} (T4)`,
      "",
      "Q: Three versions of one orientation to the same article. Order them from SIMPLEST to MOST COMPLEX (in words, ideas and terms, not only length). Answer like: Q < P < R.",
      "",
      ...order.flatMap((l, i) => [`### ${names[i]}`, "", prose(level(r, l)), ""]),
    );
  }
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "pairs.md"), lines.join("\n"));
fs.writeFileSync(path.join(OUT, "key.json"), `${JSON.stringify(key, null, 2)}\n`);
console.log(`${n} items; balance ${JSON.stringify(sides)}`);
