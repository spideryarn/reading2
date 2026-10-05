/**
 * **Can someone who has not read the piece follow its Fuller summary?** — the
 * measurement for
 * docs/plans/261005h-fuller-summary-written-for-someone-who-has-not-read-the-piece.md.
 *
 *   npx tsx evals/simple/new-reader.ts table    # free: words, guard, cost and prompt hash per arm
 *   npx tsx evals/simple/new-reader.ts audit    # free: every Fuller alone, shuffled, and its key
 *   npx tsx evals/simple/new-reader.ts pairs    # free: the blind pairs and their key
 *   npx tsx evals/simple/new-reader.ts grounded # free: each piece beside its Fullers, and the key
 *   npx tsx evals/simple/new-reader.ts score    # free: the three judges' answers, unblinded
 *
 * Reads the arms `evals/simple/probe.ts` wrote under evals/results/simple/, as
 * `high-<reader>-<tag>`. Calls no model.
 *
 *  - `new0a`, `new0b` — Fuller's prompt before the change, twice. The second
 *    is the control: how far two writes of one prompt differ.
 *  - `new1a`, `new1b` — with the section written for someone who has not read
 *    the piece, and the narrowed profile sentence.
 *  - `new2a` — the simpler option the plan passed over: the old rules plus two
 *    bullets (a name the piece introduces is a term; no reference to what the
 *    summary has not introduced) and the same paragraph after the profile.
 *
 * **Arms are separated in time, not in code**: `new0` is written with
 * src/simple-summary.ts as it was at `d1eec9994`, `new2` with the variant
 * recorded in the investigation. Each result file carries a hash of that file
 * and of the system prompts it sent, and `table` refuses two prompts under
 * one hash.
 *
 * The reader is `about` (evals/simple/readers.json), a synthetic technical
 * reader, because the report came from a reader with a profile; `new0a` and
 * `new1a` are also written with no profile.
 *
 * **audit** — each Fuller on its own, under a random id, for a judge that has
 * not read the pieces: list what could not be followed from the summary alone.
 * The score is the count. **pairs** — same piece, same reader: old against new
 * (the test), old against old (the control), and the one sentence against the
 * section, shuffled together, sides from the tested `blindCoin`
 * (evals/plain-words/run.ts).
 *
 * **grounded** — the two judges above hold only summaries, so neither can
 * see a finding both sides left out (GPT Sol's plan review, F3). Here a judge
 * is given one piece in full and every Fuller of it, shuffled, and lists for
 * each: a main finding omitted, a claim bent or blurred, and, for the profiled
 * reader, an explanation of something readers.json says they already know.
 * `table` also prints the fidelity guard's verdict on each Fuller, which is
 * production's own check against the cited passages.
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../../src/env.js";
import { blindCoin } from "../plain-words/run.js";

const RESULTS = path.join(import.meta.dirname, "..", "results", "simple");
const OUT = path.join(RESULTS, "new-reader-261005h");
const SLUGS = [
  "arxiv-2010-spya-tkm7nm",
  "entropy-24-00930-spya-pywwkq",
  "fd-src-nihms-536461-spya-nr87dn-spya-en7r25",
  "s41598-023-33209-9-spya-s0qydm",
  "levin-self-improvising-memory-spya-gj60pu",
] as const;
const ARMS = [
  "about-new0a",
  "about-new0b",
  "about-new1a",
  "about-new1b",
  "about-new2a",
  "none-new0a",
  "none-new1a",
] as const;
type Arm = (typeof ARMS)[number];
type Para = { text: string; ids: string[]; list?: boolean };
interface Run {
  ok: boolean;
  error?: string;
  bodyWords: number;
  band?: string;
  systemsSha256?: string;
  wallMs: number;
  costUsd: number | null;
  fullerWords?: number;
  fullerReadyMs?: number;
  fuller?: Para[];
  check?: { levels: Record<string, { result: string; attempts: number }> };
}

/** The "never more than" a `standard` piece's Fuller is asked; all five pieces are in that band. */
const NEVER = 600;

const readers = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "readers.json"), "utf8")) as {
  about: string;
  known: string[];
};
const READER: Record<"about" | "none", string> = {
  about: `The reader says of themselves: "${readers.about}" They have not read the piece.`,
  none: "The reader is a bright first-year university student who has not studied this field. They have not read the piece.",
};
const readerOf = (arm: Arm): "about" | "none" => (arm.startsWith("about") ? "about" : "none");
const promptOf = (arm: Arm): "old" | "new" | "sentence" => (arm.includes("new0") ? "old" : arm.includes("new1") ? "new" : "sentence");

function load(arm: Arm, slug: string): Run | null {
  const file = path.join(RESULTS, `high-${arm}`, `${slug}.json`);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Run) : null;
}

/** A Fuller as a reader sees it: a list paragraph as its lead-in and bullets is beyond a judge's need; prose will do. */
const prose = (run: Run): string => (run.fuller ?? []).map((p) => p.text).join("\n\n");

function table(): void {
  console.log("| piece | arm | prompt | band | Fuller words | over the ask's 'never' | paragraphs | wait to Fuller s | guard on Fuller | $ | prompts sent (sha) |");
  console.log("|---|---|---|---|---:|---|---:|---:|---|---:|---|");
  const sent: Record<string, Set<string>> = {};
  for (const slug of SLUGS) {
    for (const arm of ARMS) {
      const r = load(arm, slug);
      if (!r) continue;
      if (!r.ok) {
        console.log(`| ${slug} | ${arm} | ${promptOf(arm)} | ${r.band ?? "-"} | **failed**: ${r.error} |`);
        continue;
      }
      const c = r.check?.levels.fuller;
      const guard = c ? `${c.result}${c.attempts > 1 ? " (2 tries)" : ""}` : "-";
      const sha = r.systemsSha256?.slice(0, 8) ?? "?";
      (sent[promptOf(arm)] ??= new Set()).add(`${r.band}:${sha}`);
      console.log(
        `| ${slug} | ${arm} | ${promptOf(arm)} | ${r.band ?? "-"} | ${r.fullerWords} | ${(r.fullerWords ?? 0) > NEVER ? "**yes**" : "no"} | ${r.fuller?.length} | ${((r.fullerReadyMs ?? 0) / 1000).toFixed(1)} | ${guard} | ${r.costUsd?.toFixed(3) ?? "?"} | ${sha} |`,
      );
    }
  }
  /* Three prompts, so three hashes a band: one hash under two prompts, or two
     under one, is an arm that sent the wrong prompt. */
  console.log("");
  for (const [prompt, hashes] of Object.entries(sent)) console.log(`${prompt}: ${[...hashes].sort().join(", ")}`);
  const all = Object.values(sent).flatMap((s) => [...s]);
  if (new Set(all).size !== all.length) throw new Error("two prompts share one hash: an arm sent the wrong prompt");
  for (const [prompt, hashes] of Object.entries(sent)) {
    if (new Set([...hashes].map((h) => h.split(":")[0])).size !== hashes.size) {
      throw new Error(`the "${prompt}" arms sent more than one prompt for one band`);
    }
  }
}

/** Every item in a seeded random order. */
function shuffled<T>(items: T[], coin: () => boolean): T[] {
  const keyed = items.map((item) => ({ item, k: Array.from({ length: 12 }, () => (coin() ? "1" : "0")).join("") }));
  keyed.sort((x, y) => (x.k < y.k ? -1 : x.k > y.k ? 1 : 0));
  return keyed.map((x) => x.item);
}

function audit(): void {
  const coin = blindCoin(26100508);
  const items: { arm: Arm; slug: string; run: Run }[] = [];
  for (const slug of SLUGS) {
    for (const arm of ARMS) {
      const run = load(arm, slug);
      if (!run) continue;
      if (!run.ok) throw new Error(`failed run for ${slug} ${arm}: write it again before auditing`);
      items.push({ arm, slug, run });
    }
  }
  const lines = [
    "# Summaries, one at a time",
    "",
    "Each section is one summary of a piece of writing. You have not read any of the pieces, and you are not given them. The same piece is summarised more than once; judge each summary as if it were the only one you had seen, and never use one summary to understand another.",
    "",
  ];
  const key: Record<string, string>[] = [];
  shuffled(items, coin).forEach(({ arm, slug, run }, i) => {
    const id = `S${String(i + 1).padStart(2, "0")}`;
    lines.push(`## ${id}`, "", READER[readerOf(arm)], "", prose(run), "");
    key.push({ id, arm, slug });
  });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "audit.md"), `${lines.join("\n")}\n`);
  fs.writeFileSync(path.join(OUT, "audit-key.json"), `${JSON.stringify(key, null, 2)}\n`);
  console.log(`${key.length} summaries.`);
}

interface Pair {
  kind: "test" | "control" | "sentence";
  slug: string;
  left: Arm;
  right: Arm;
}

function pairs(): void {
  const wanted: Pair[] = [];
  for (const slug of SLUGS) {
    wanted.push({ kind: "test", slug, left: "about-new0a", right: "about-new1a" });
    wanted.push({ kind: "test", slug, left: "about-new0b", right: "about-new1b" });
    wanted.push({ kind: "test", slug, left: "none-new0a", right: "none-new1a" });
    wanted.push({ kind: "control", slug, left: "about-new0a", right: "about-new0b" });
    wanted.push({ kind: "sentence", slug, left: "about-new2a", right: "about-new1a" });
  }
  const coin = blindCoin(26100509);
  const lines = [
    "# Pairs of summaries of the same piece",
    "",
    "Each pair is two summaries of one piece. You have not read the piece and are not given it. The sides are in a random order. Judge each pair on its own.",
    "",
  ];
  const key: Record<string, string>[] = [];
  /* Which side the newer prompt landed on, per kind: a judge with a side
     preference looks like a prompt effect (prompting-guide.md § Measuring, 4). */
  const sides: Record<string, { A: number; B: number }> = {};
  let n = 0;
  for (const w of shuffled(wanted, coin)) {
    const l = load(w.left, w.slug);
    const r = load(w.right, w.slug);
    if (!l || !r) {
      console.log(`no pair for ${w.slug} ${w.left}/${w.right}: one side was never written`);
      continue;
    }
    if (!l.ok || !r.ok) throw new Error(`failed run for ${w.slug} ${w.left}/${w.right}`);
    n += 1;
    const id = `P${String(n).padStart(2, "0")}`;
    const flip = coin();
    const [a, b] = flip ? [r, l] : [l, r];
    const [aArm, bArm] = flip ? [w.right, w.left] : [w.left, w.right];
    (sides[w.kind] ??= { A: 0, B: 0 })[flip ? "A" : "B"] += 1;
    lines.push(`## ${id}`, "", READER[readerOf(w.left)], "", "### Summary A", "", prose(a), "", "### Summary B", "", prose(b), "");
    key.push({ id, kind: w.kind, slug: w.slug, A: aArm, B: bArm });
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "pairs.md"), `${lines.join("\n")}\n`);
  fs.writeFileSync(path.join(OUT, "pairs-key.json"), `${JSON.stringify(key, null, 2)}\n`);
  console.log(`${n} pairs. The right-hand arm of each kind is on side:`);
  for (const [kind, s] of Object.entries(sides)) console.log(`  ${kind}: A ${s.A}, B ${s.B}`);
}

/**
 * One file a piece: its body in full, then every Fuller of it under a random
 * id. A judge reads one file, so no piece's summaries teach it another's.
 */
async function grounded(): Promise<void> {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const { isBodyEvidence } = await import("../../src/block-policy.js");
  const { closeDb } = await import("../../src/db/client.js");
  const coin = blindCoin(26100510);
  const key: Record<string, string>[] = [];
  fs.mkdirSync(OUT, { recursive: true });
  let n = 0;
  await runAsOwner(environmentOwnerId(), async () => {
    for (const slug of SLUGS) {
      const article = await loadArticle(slug);
      const body = article.blocks.filter(isBodyEvidence);
      const items: { arm: Arm; run: Run }[] = [];
      for (const arm of ARMS) {
        const run = load(arm, slug);
        if (!run) continue;
        if (!run.ok) throw new Error(`failed run for ${slug} ${arm}: write it again first`);
        items.push({ arm, run });
      }
      const lines = [
        `# One piece, and ${items.length} summaries of it`,
        "",
        `## The piece: ${article.meta?.title ?? slug}`,
        "",
        body.map((b) => b.text).join("\n\n"),
        "",
        "## What one of the readers says they already know",
        "",
        `Some summaries were written for this reader: "${readers.about}" They already know:`,
        "",
        ...readers.known.map((k) => `- ${k}`),
        "",
        "# The summaries",
        "",
      ];
      for (const { arm, run } of shuffled(items, coin)) {
        n += 1;
        const id = `G${String(n).padStart(2, "0")}`;
        const who = readerOf(arm) === "about" ? "Written for the reader described above." : "Written for a reader with no stated background.";
        lines.push(`## ${id}`, "", who, "", prose(run), "");
        key.push({ id, arm, slug });
      }
      fs.writeFileSync(path.join(OUT, `grounded-${slug}.md`), `${lines.join("\n")}\n`);
    }
  });
  await closeDb();
  fs.writeFileSync(path.join(OUT, "grounded-key.json"), `${JSON.stringify(key, null, 2)}\n`);
  console.log(`${n} summaries across ${SLUGS.length} pieces.`);
}

/** One `## <id>` section of a judge's file, or a throw: a missing section is never a zero. */
function section(judged: string, id: string, prefix: string): string {
  const start = judged.indexOf(`## ${id}\n`);
  if (start < 0) throw new Error(`the judge has no section for ${id}`);
  const next = judged.indexOf(`\n## ${prefix}`, start + 1);
  return judged.slice(start, next < 0 ? undefined : next);
}

/**
 * **score** — the two judges' files beside their keys.
 *
 * `audit-judge.md`: under each `## S01`, one `- ` line for each thing the
 * judge could not follow, then `count: N`. The count must equal the lines, so
 * a judge that summarised instead of listing is refused, not averaged.
 *
 * `pairs-judge.md`: under each `## P01`, `follow:`, `more:`, `padded:`,
 * `down:` and `prefer:`, each starting with `A`, `B`, `same`, `both` or
 * `neither`.
 *
 * `grounded-judge-<slug>.md`, one a piece: under each `## G01`, a line for
 * each fault, starting `- omitted:`, `- bent:` or `- known:`, then
 * `faults: N`, which must equal the lines.
 */
function score(): void {
  const mean = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : "-");

  const auditKey = JSON.parse(fs.readFileSync(path.join(OUT, "audit-key.json"), "utf8")) as { id: string; arm: Arm; slug: string }[];
  const audited = fs.readFileSync(path.join(OUT, "audit-judge.md"), "utf8");
  const counts = new Map<string, number>();
  for (const k of auditKey) {
    const s = section(audited, k.id, "S");
    const m = /^count: *(\d+)\s*$/m.exec(s);
    if (!m) throw new Error(`${k.id}: no count`);
    const listed = s.split("\n").filter((line) => line.startsWith("- ")).length;
    if (listed !== Number(m[1])) throw new Error(`${k.id}: count says ${m[1]} and ${listed} are listed`);
    counts.set(`${k.arm} ${k.slug}`, listed);
  }
  console.log("## Audit: things a reader who has not read the piece could not follow, per Fuller\n");
  console.log(`| piece | ${ARMS.join(" | ")} |`);
  console.log(`|---|${ARMS.map(() => "---:").join("|")}|`);
  for (const slug of SLUGS) console.log(`| ${slug} | ${ARMS.map((arm) => counts.get(`${arm} ${slug}`) ?? "-").join(" | ")} |`);
  const armCounts = (arm: Arm) => SLUGS.map((slug) => counts.get(`${arm} ${slug}`)).filter((n): n is number => n !== undefined);
  console.log(`| **mean** | ${ARMS.map((arm) => mean(armCounts(arm))).join(" | ")} |`);

  /* The plan's first criterion, as a number: the old-to-new drop in the mean
     count against how far two writes of the old prompt differ. */
  const oldA = armCounts("about-new0a");
  const oldB = armCounts("about-new0b");
  const newBoth = [...armCounts("about-new1a"), ...armCounts("about-new1b")];
  if (oldA.length && oldB.length && newBoth.length) {
    const m = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const oldMean = m([...oldA, ...oldB]);
    const drop = oldMean - m(newBoth);
    const noise = Math.abs(m(oldA) - m(oldB));
    console.log(`\nProfiled reader: old mean ${oldMean.toFixed(1)}, new mean ${m(newBoth).toFixed(1)}, drop ${drop.toFixed(1)}; two old writes differ by ${noise.toFixed(1)}. ${drop > noise ? "PASSES" : "FAILS"} the audit criterion.`);
  }

  const pairsKey = JSON.parse(fs.readFileSync(path.join(OUT, "pairs-key.json"), "utf8")) as {
    id: string;
    kind: Pair["kind"];
    slug: string;
    A: Arm;
    B: Arm;
  }[];
  const judged = fs.readFileSync(path.join(OUT, "pairs-judge.md"), "utf8");
  const QUESTIONS = ["follow", "more", "padded", "down", "prefer"] as const;
  const tallies: Record<string, Record<string, number>> = {};
  console.log("\n## Pairs\n");
  console.log(`| pair | kind | piece | A | B | ${QUESTIONS.join(" | ")} |`);
  console.log(`|---|---|---|---|---|${QUESTIONS.map(() => "---").join("|")}|`);
  for (const k of pairsKey) {
    const s = section(judged, k.id, "P");
    const cells = QUESTIONS.map((q) => {
      const m = new RegExp(`^${q}: *(A|B|[Ss]ame|[Bb]oth|[Nn]either)\\b`, "m").exec(s);
      if (!m) throw new Error(`${k.id}: no answer to "${q}"`);
      const raw = m[1]!;
      /* A side becomes the prompt that wrote it; in a control, the arm. */
      const verdict = raw === "A" || raw === "B" ? (k.kind === "control" ? k[raw] : promptOf(k[raw])) : raw.toLowerCase();
      const group = `${k.kind} ${q}`;
      (tallies[group] ??= {})[verdict] = (tallies[group][verdict] ?? 0) + 1;
      return verdict;
    });
    console.log(`| ${k.id} | ${k.kind} | ${k.slug} | ${k.A} | ${k.B} | ${cells.join(" | ")} |`);
  }
  console.log("");
  for (const group of Object.keys(tallies).sort()) {
    console.log(`${group}: ${Object.entries(tallies[group]!).map(([v, n]) => `${v} ${n}`).join(", ")}`);
  }
  /* The second criterion: at least 7 of the 10 profiled old/new pairs. */
  const profiled = pairsKey.filter((k) => k.kind === "test" && readerOf(k.A) === "about");
  const forNew = profiled.filter((k) => {
    const m = /^prefer: *(A|B)\b/m.exec(section(judged, k.id, "P"));
    return m !== null && promptOf(k[m[1] as "A" | "B"]) === "new";
  }).length;
  console.log(`\nProfiled old/new pairs preferring the new prompt: ${forNew} of ${profiled.length}. ${profiled.length === 10 && forNew >= 7 ? "PASSES" : "FAILS"} the pairs criterion (7 of 10).`);

  const groundedKey = JSON.parse(fs.readFileSync(path.join(OUT, "grounded-key.json"), "utf8")) as { id: string; arm: Arm; slug: string }[];
  const KINDS = ["omitted", "bent", "known"] as const;
  const faults: Record<string, Record<(typeof KINDS)[number], number>> = {};
  console.log("\n## Against the piece: main findings omitted, claims bent or blurred, known things explained\n");
  console.log("| summary | piece | arm | omitted | bent | known |");
  console.log("|---|---|---|---:|---:|---:|");
  for (const k of groundedKey) {
    const file = fs.readFileSync(path.join(OUT, `grounded-judge-${k.slug}.md`), "utf8");
    const s = section(file, k.id, "G");
    const m = /^faults: *(\d+)\s*$/m.exec(s);
    if (!m) throw new Error(`${k.id}: no faults line`);
    const bullets = s.split("\n").filter((line) => line.startsWith("- "));
    const of = (kind: string) => bullets.filter((line) => line.startsWith(`- ${kind}:`)).length;
    const row = { omitted: of("omitted"), bent: of("bent"), known: of("known") };
    if (row.omitted + row.bent + row.known !== bullets.length) throw new Error(`${k.id}: a fault line is none of omitted, bent or known`);
    if (bullets.length !== Number(m[1])) throw new Error(`${k.id}: faults says ${m[1]} and ${bullets.length} are listed`);
    console.log(`| ${k.id} | ${k.slug} | ${k.arm} | ${row.omitted} | ${row.bent} | ${row.known} |`);
    const total = (faults[promptOf(k.arm)] ??= { omitted: 0, bent: 0, known: 0 });
    for (const kind of KINDS) total[kind] += row[kind];
  }
  console.log("");
  for (const [prompt, t] of Object.entries(faults)) {
    const writes = groundedKey.filter((k) => promptOf(k.arm) === prompt).length;
    console.log(`${prompt} (${writes} summaries): omitted ${t.omitted}, bent ${t.bent}, known explained ${t.known}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  if (cmd === "table") table();
  else if (cmd === "audit") audit();
  else if (cmd === "pairs") pairs();
  else if (cmd === "grounded") await grounded();
  else if (cmd === "score") score();
  else throw new Error("usage: table | audit | pairs | grounded | score");
}
