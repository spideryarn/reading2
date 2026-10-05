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
 * `audit`, `pairs`, `grounded` and `score` take `2` for the second round
 * (`ROUND`, below).
 *
 * Reads the arms `evals/simple/probe.ts` wrote under evals/results/simple/, as
 * `high-<reader>-<tag>`. Calls no model.
 *
 *  - `new0a`, `new0b` — Fuller's prompt before the change, twice. The second
 *    is the control: how far two writes of one prompt differ.
 *  - `new1a`, `new1b` — with the section written for someone who has not read
 *    the piece, and the paragraph after the profile rules.
 *  - `new2a` — the simpler option the plan passed over: the old rules plus two
 *    bullets (a name the piece introduces is a term; no reference to what the
 *    summary has not introduced) and the same paragraph after the profile.
 *
 * **Arms are separated in time, not in code**: `new0` is written with
 * src/simple-summary.ts as it was at `d1eec9994`, `new2` with the two-bullet variant
 * specified in plan 261005h, whose source and rendered-system hashes go in the
 * investigation after the run. Each result file carries a hash of that file
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
 * (the test), old against old (the control), and the two bullets against the
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
import { createHash } from "node:crypto";
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
const ALL_ARMS = [
  "about-new0a",
  "about-new0b",
  "about-new1a",
  "about-new1b",
  "about-new2a",
  "none-new0a",
  "none-new1a",
  /* Round two, below. */
  "about-new2b",
  "none-new0b",
  "none-new1b",
  "none-new2a",
] as const;
type Arm = (typeof ALL_ARMS)[number];

/**
 * **Two rounds.** Round one is the plan's: the profiled reader, old against
 * new twice over, with one no-profile draw of each and one draw of the
 * two-bullet arm. It left two things open, so round two was written after it
 * was scored: with no profile the pairs judge preferred the *old* prompt in
 * four pairs of five, on one draw a side, and the two-bullet arm did as well
 * as the section for the profiled reader. Round two is the reader with no
 * profile: a second old draw (the control round one lacked), a second draw of
 * the section, and the two-bullet arm; and a second profiled two-bullet draw.
 * Its files carry `-r2`, and round one's are never rewritten.
 *
 * **Round three is pairs only, and no new writes**: the two-bullet arm against
 * the old prompt for the profiled reader, both draws. Rounds one and two only
 * ever set the two-bullet arm against the section for that reader, so "as
 * good as the section, which beat the old prompt" was an inference; this is
 * the pair itself.
 */
const ROUND: 1 | 2 | 3 = process.argv[3] === "3" ? 3 : process.argv[3] === "2" ? 2 : 1;
const ARMS: readonly Arm[] =
  ROUND === 1
    ? ["about-new0a", "about-new0b", "about-new1a", "about-new1b", "about-new2a", "none-new0a", "none-new1a"]
    : ["none-new0a", "none-new0b", "none-new1a", "none-new1b", "none-new2a", "about-new2b"];
/** A judge file's name in this round: `audit.md`, or `audit-r2.md`. */
const named = (file: string): string => (ROUND === 1 ? file : file.replace(/(\.[a-z]+)$/, `-r${ROUND}$1`));
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
const promptOf = (arm: Arm): "old" | "new" | "two-bullets" => (arm.includes("new0") ? "old" : arm.includes("new1") ? "new" : "two-bullets");

function load(arm: Arm, slug: string): Run | null {
  const file = path.join(RESULTS, `high-${arm}`, `${slug}.json`);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Run) : null;
}

/**
 * A run a judge file is built from, or a throw. A missing arm is never
 * skipped: a partial experiment once scored as PASSES on three summaries (GPT
 * Sol's code review, F3).
 */
function need(arm: Arm, slug: string): Run {
  const run = load(arm, slug);
  if (!run) throw new Error(`missing run for ${slug} ${arm}: write the complete arm before building judge files`);
  if (!run.ok) throw new Error(`failed run for ${slug} ${arm}: write it again before building judge files`);
  return run;
}

/**
 * A blind file with its own id on its second line. The judge copies the line,
 * the key holds it, and `score` refuses an answer to any other shuffle: ids
 * like `P01` are the same in every shuffle, so nothing else ties an answer
 * file to the file it was written from (Sol's code review, F2).
 */
function blind(lines: string[]): { text: string; blindId: string } {
  const body = lines.join("\n");
  const blindId = createHash("sha256").update(body).digest("hex").slice(0, 12);
  const [title, ...rest] = lines;
  return { text: `${[title, "", `blind-id: ${blindId}`, ...rest].join("\n")}\n`, blindId };
}

/** A Fuller as a reader sees it: a list paragraph as its lead-in and bullets is beyond a judge's need; prose will do. */
const prose = (run: Run): string => (run.fuller ?? []).map((p) => p.text).join("\n\n");

function table(): void {
  console.log("| piece | arm | prompt | band | Fuller words | over the ask's 'never' | paragraphs | wait to Fuller s | guard on Fuller | $ | prompts sent (sha) |");
  console.log("|---|---|---|---|---:|---|---:|---:|---|---:|---|");
  const sent: Record<string, Set<string>> = {};
  for (const slug of SLUGS) {
    for (const arm of ALL_ARMS) {
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
  const coin = blindCoin(ROUND === 1 ? 26100508 : 26100511);
  const items: { arm: Arm; slug: string; run: Run }[] = [];
  for (const slug of SLUGS) {
    for (const arm of ARMS) {
      items.push({ arm, slug, run: need(arm, slug) });
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
  const { text, blindId } = blind(lines);
  fs.writeFileSync(path.join(OUT, named("audit.md")), text);
  fs.writeFileSync(path.join(OUT, named("audit-key.json")), `${JSON.stringify({ blindId, items: key }, null, 2)}\n`);
  console.log(`${key.length} summaries.`);
}

interface Pair {
  /* `test`: old against the section. `two-bullets`: the two-bullet arm against
     the section. `old-two-bullets`: old against the two-bullet arm. */
  kind: "test" | "control" | "two-bullets" | "old-two-bullets";
  slug: string;
  left: Arm;
  right: Arm;
}

function pairs(): void {
  const wanted: Pair[] = [];
  for (const slug of ROUND === 3 ? SLUGS : []) {
    wanted.push({ kind: "old-two-bullets", slug, left: "about-new0a", right: "about-new2a" });
    wanted.push({ kind: "old-two-bullets", slug, left: "about-new0b", right: "about-new2b" });
  }
  for (const slug of ROUND === 2 ? SLUGS : []) {
    wanted.push({ kind: "control", slug, left: "none-new0a", right: "none-new0b" });
    wanted.push({ kind: "test", slug, left: "none-new0b", right: "none-new1b" });
    wanted.push({ kind: "old-two-bullets", slug, left: "none-new0a", right: "none-new2a" });
    wanted.push({ kind: "two-bullets", slug, left: "none-new2a", right: "none-new1b" });
    wanted.push({ kind: "two-bullets", slug, left: "about-new2b", right: "about-new1b" });
  }
  for (const slug of ROUND === 1 ? SLUGS : []) {
    wanted.push({ kind: "test", slug, left: "about-new0a", right: "about-new1a" });
    wanted.push({ kind: "test", slug, left: "about-new0b", right: "about-new1b" });
    wanted.push({ kind: "test", slug, left: "none-new0a", right: "none-new1a" });
    wanted.push({ kind: "control", slug, left: "about-new0a", right: "about-new0b" });
    wanted.push({ kind: "two-bullets", slug, left: "about-new2a", right: "about-new1a" });
  }
  /* Round two's seed is the first from 26100512 whose sides came out no
     worse than three to two in every kind; 26100512 itself put two kinds on
     one side four times in five. Chosen before any judge read a pair. */
  const coin = blindCoin(ROUND === 1 ? 26100509 : ROUND === 2 ? 26100520 : 26100530);
  const lines = [
    "# Pairs of summaries of the same piece",
    "",
    "Each pair is two summaries of one piece. You have not read the piece and are not given it. The sides are in a random order. Judge each pair on its own.",
    "",
  ];
  const key: Record<string, string>[] = [];
  /* Which side the newer prompt landed on, per kind and reader, so the ten
     profiled test pairs the criterion counts have their own line: a judge
     with a side preference looks like a prompt effect (prompting-guide.md §
     Measuring, 4). */
  const sides: Record<string, { A: number; B: number }> = {};
  let n = 0;
  for (const w of shuffled(wanted, coin)) {
    const l = need(w.left, w.slug);
    const r = need(w.right, w.slug);
    n += 1;
    const id = `P${String(n).padStart(2, "0")}`;
    const flip = coin();
    const [a, b] = flip ? [r, l] : [l, r];
    const [aArm, bArm] = flip ? [w.right, w.left] : [w.left, w.right];
    (sides[`${w.kind}/${readerOf(w.left)}`] ??= { A: 0, B: 0 })[flip ? "A" : "B"] += 1;
    lines.push(`## ${id}`, "", READER[readerOf(w.left)], "", "### Summary A", "", prose(a), "", "### Summary B", "", prose(b), "");
    key.push({ id, kind: w.kind, slug: w.slug, A: aArm, B: bArm });
  }
  fs.mkdirSync(OUT, { recursive: true });
  const { text, blindId } = blind(lines);
  fs.writeFileSync(path.join(OUT, named("pairs.md")), text);
  fs.writeFileSync(path.join(OUT, named("pairs-key.json")), `${JSON.stringify({ blindId, items: key }, null, 2)}\n`);
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
  const coin = blindCoin(ROUND === 1 ? 26100510 : 26100513);
  const key: Record<string, string>[] = [];
  const blindIds: Record<string, string> = {};
  fs.mkdirSync(OUT, { recursive: true });
  let n = 0;
  await runAsOwner(environmentOwnerId(), async () => {
    for (const slug of SLUGS) {
      const article = await loadArticle(slug);
      const body = article.blocks.filter(isBodyEvidence);
      const items: { arm: Arm; run: Run }[] = [];
      for (const arm of ARMS) items.push({ arm, run: need(arm, slug) });
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
      const { text, blindId } = blind(lines);
      blindIds[slug] = blindId;
      fs.writeFileSync(path.join(OUT, named(`grounded-${slug}.md`)), text);
    }
  });
  await closeDb();
  fs.writeFileSync(path.join(OUT, named("grounded-key.json")), `${JSON.stringify({ blindIds, items: key }, null, 2)}\n`);
  console.log(`${n} summaries across ${SLUGS.length} pieces.`);
}

/**
 * A judge's file as its sections, or a throw. It must open with the blind id
 * of the file it answers, and its `## X01` headings must be exactly the key's
 * ids, in the key's order: a missing, extra, repeated or reordered section is
 * refused, never read as a zero or silently passed over.
 */
function sections(file: string, prefix: "S" | "P" | "G", ids: string[], blindId: string): Map<string, string> {
  const judged = fs.readFileSync(path.join(OUT, named(file)), "utf8");
  const first = judged.split("\n").find((line) => line.trim() !== "");
  if (first?.trim() !== `blind-id: ${blindId}`) {
    throw new Error(`${file}: does not open with "blind-id: ${blindId}", so it answers a different shuffle or none`);
  }
  const heads = [...judged.matchAll(new RegExp(`^## (${prefix}\\d+)[ \\t]*$`, "gm"))];
  const found = heads.map((h) => h[1]!);
  if (JSON.stringify(found) !== JSON.stringify(ids)) {
    throw new Error(`${file}: its sections are [${found.join(", ")}] and the key's are [${ids.join(", ")}]`);
  }
  return new Map(heads.map((h, n) => [h[1]!, judged.slice(h.index, heads[n + 1]?.index)]));
}

/** The one line in a section that starts `<word>:`, or a throw on none or two. */
function once(section: string, word: string, where: string): string {
  const lines = section.split("\n").filter((line) => line.startsWith(`${word}:`));
  if (lines.length !== 1) throw new Error(`${where}: ${lines.length} "${word}:" lines, and there must be one`);
  return lines[0]!.slice(word.length + 1).trim();
}

/**
 * **score** — the three judges' files beside their keys. Each file opens with
 * the `blind-id:` line copied from the file it answers.
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
  if (ROUND === 3) return scorePairs();
  const wantedRuns = scoreAudit();
  scorePairs();
  scoreGrounded(wantedRuns);
}

function scoreAudit(): string[] {
  const mean = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : "-");

  const auditKey = JSON.parse(fs.readFileSync(path.join(OUT, named("audit-key.json")), "utf8")) as {
    blindId: string;
    items: { id: string; arm: Arm; slug: string }[];
  };
  /* Every piece under every arm, once: a verdict is for the whole experiment. */
  const wantedRuns = SLUGS.flatMap((slug) => ARMS.map((arm) => `${arm} ${slug}`)).sort();
  if (JSON.stringify(auditKey.items.map((k) => `${k.arm} ${k.slug}`).sort()) !== JSON.stringify(wantedRuns)) {
    throw new Error("audit-key.json is not every piece under every arm exactly once: build it again from a complete set of runs");
  }
  const audited = sections("audit-judge.md", "S", auditKey.items.map((k) => k.id), auditKey.blindId);
  const counts = new Map<string, number>();
  for (const k of auditKey.items) {
    const s = audited.get(k.id)!;
    const said = once(s, "count", k.id);
    if (!/^\d+$/.test(said)) throw new Error(`${k.id}: count is "${said}", not a number`);
    const listed = s.split("\n").filter((line) => line.startsWith("- ")).length;
    if (listed !== Number(said)) throw new Error(`${k.id}: count says ${said} and ${listed} are listed`);
    counts.set(`${k.arm} ${k.slug}`, listed);
  }
  console.log("## Audit: things a reader who has not read the piece could not follow, per Fuller\n");
  console.log(`| piece | ${ARMS.join(" | ")} |`);
  console.log(`|---|${ARMS.map(() => "---:").join("|")}|`);
  for (const slug of SLUGS) console.log(`| ${slug} | ${ARMS.map((arm) => counts.get(`${arm} ${slug}`) ?? "-").join(" | ")} |`);
  const armCounts = (arm: Arm) =>
    SLUGS.map((slug) => {
      const n = counts.get(`${arm} ${slug}`);
      if (n === undefined) throw new Error(`no audit count for ${slug} ${arm}`);
      return n;
    });
  console.log(`| **mean** | ${ARMS.map((arm) => mean(armCounts(arm))).join(" | ")} |`);

  if (ROUND === 1) {
    /* The plan's first criterion, as a number: the old-to-new drop in the mean
       count against how far two writes of the old prompt differ. */
    const oldA = armCounts("about-new0a");
    const oldB = armCounts("about-new0b");
    const newBoth = [...armCounts("about-new1a"), ...armCounts("about-new1b")];
    const m = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const oldMean = m([...oldA, ...oldB]);
    const drop = oldMean - m(newBoth);
    const noise = Math.abs(m(oldA) - m(oldB));
    console.log(`\nProfiled reader: old mean ${oldMean.toFixed(1)}, new mean ${m(newBoth).toFixed(1)}, drop ${drop.toFixed(1)}; two old writes differ by ${noise.toFixed(1)}. ${drop > noise ? "PASSES" : "FAILS"} the audit criterion.`);
  }

  return wantedRuns;
}

function scorePairs(): void {
  const pairsFile = JSON.parse(fs.readFileSync(path.join(OUT, named("pairs-key.json")), "utf8")) as {
    blindId: string;
    items: { id: string; kind: Pair["kind"]; slug: string; A: Arm; B: Arm }[];
  };
  const pairsKey = pairsFile.items;
  const judged = sections("pairs-judge.md", "P", pairsKey.map((k) => k.id), pairsFile.blindId);
  /* Each question's answers, as its brief allows them and no wider. */
  const WHICH = ["A", "B", "same"];
  const EITHER = ["A", "B", "both", "neither"];
  const QUESTIONS = ["follow", "more", "padded", "down", "prefer"] as const;
  const ALLOWED: Record<(typeof QUESTIONS)[number], string[]> = { follow: WHICH, more: WHICH, padded: EITHER, down: EITHER, prefer: WHICH };
  const answer = (id: string, q: (typeof QUESTIONS)[number]): string => {
    const word = /^[A-Za-z]+/.exec(once(judged.get(id)!, q, id))?.[0] ?? "";
    const raw = word === "A" || word === "B" ? word : word.toLowerCase();
    if (!ALLOWED[q].includes(raw)) throw new Error(`${id}: "${q}: ${word}" is not one of ${ALLOWED[q].join(", ")}`);
    return raw;
  };
  const tallies: Record<string, Record<string, number>> = {};
  console.log("\n## Pairs\n");
  console.log(`| pair | kind | piece | A | B | ${QUESTIONS.join(" | ")} |`);
  console.log(`|---|---|---|---|---|${QUESTIONS.map(() => "---").join("|")}|`);
  for (const k of pairsKey) {
    const cells = QUESTIONS.map((q) => {
      const raw = answer(k.id, q);
      /* A side becomes the prompt that wrote it; in a control, the arm. */
      const verdict = raw === "A" || raw === "B" ? (k.kind === "control" ? k[raw] : promptOf(k[raw])) : raw;
      const group = `${k.kind}/${readerOf(k.A)} ${q}`;
      (tallies[group] ??= {})[verdict] = (tallies[group][verdict] ?? 0) + 1;
      return verdict;
    });
    console.log(`| ${k.id} | ${k.kind} | ${k.slug} | ${k.A} | ${k.B} | ${cells.join(" | ")} |`);
  }
  console.log("");
  for (const group of Object.keys(tallies).sort()) {
    console.log(`${group}: ${Object.entries(tallies[group]!).map(([v, n]) => `${v} ${n}`).join(", ")}`);
  }
  if (ROUND === 1) {
    /* The second criterion: at least 7 of the 10 profiled old/new pairs. */
    const profiled = pairsKey.filter((k) => k.kind === "test" && readerOf(k.A) === "about");
    if (profiled.length !== 10) throw new Error(`${profiled.length} profiled old/new pairs in the key, and the criterion is over 10`);
    const forNew = profiled.filter((k) => {
      const raw = answer(k.id, "prefer");
      return (raw === "A" || raw === "B") && promptOf(k[raw]) === "new";
    }).length;
    console.log(`\nProfiled old/new pairs preferring the new prompt: ${forNew} of 10. ${forNew >= 7 ? "PASSES" : "FAILS"} the pairs criterion (7 of 10).`);
  }

}

function scoreGrounded(wantedRuns: string[]): void {
  const groundedFile = JSON.parse(fs.readFileSync(path.join(OUT, named("grounded-key.json")), "utf8")) as {
    blindIds: Record<string, string>;
    items: { id: string; arm: Arm; slug: string }[];
  };
  const groundedKey = groundedFile.items;
  if (JSON.stringify(groundedKey.map((k) => `${k.arm} ${k.slug}`).sort()) !== JSON.stringify(wantedRuns)) {
    throw new Error("grounded-key.json is not every piece under every arm exactly once");
  }
  const groundedSections = new Map<string, string>();
  for (const slug of SLUGS) {
    const ids = groundedKey.filter((k) => k.slug === slug).map((k) => k.id);
    const blindId = groundedFile.blindIds[slug];
    if (!blindId) throw new Error(`grounded-key.json has no blind id for ${slug}`);
    for (const [id, text] of sections(`grounded-judge-${slug}.md`, "G", ids, blindId)) groundedSections.set(id, text);
  }
  const KINDS = ["omitted", "bent", "known"] as const;
  const faults: Record<string, Record<(typeof KINDS)[number], number>> = {};
  console.log("\n## Against the piece: main findings omitted, claims bent or blurred, known things explained\n");
  console.log("| summary | piece | arm | omitted | bent | known |");
  console.log("|---|---|---|---:|---:|---:|");
  for (const k of groundedKey) {
    const s = groundedSections.get(k.id)!;
    const said = once(s, "faults", k.id);
    if (!/^\d+$/.test(said)) throw new Error(`${k.id}: faults is "${said}", not a number`);
    const bullets = s.split("\n").filter((line) => line.startsWith("- "));
    const of = (kind: string) => bullets.filter((line) => line.startsWith(`- ${kind}:`)).length;
    const row = { omitted: of("omitted"), bent: of("bent"), known: of("known") };
    if (row.omitted + row.bent + row.known !== bullets.length) throw new Error(`${k.id}: a fault line is none of omitted, bent or known`);
    if (bullets.length !== Number(said)) throw new Error(`${k.id}: faults says ${said} and ${bullets.length} are listed`);
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
  if (process.argv[3] !== undefined && process.argv[3] !== "2" && process.argv[3] !== "3") throw new Error("the round is 2 or 3, or left out for round one");
  if (ROUND === 3 && cmd !== "pairs" && cmd !== "score") throw new Error("round three is pairs and score only");
  if (cmd === "table") table();
  else if (cmd === "audit") audit();
  else if (cmd === "pairs") pairs();
  else if (cmd === "grounded") await grounded();
  else if (cmd === "score") score();
  else throw new Error("usage: table | audit [2] | pairs [2] | grounded [2] | score [2]");
}
