/**
 * **Is Brief plainer for a reader in a hurry?** — the measurement for
 * docs/plans/261002h-brief-summary-plainer-for-a-reader-in-a-hurry.md, written
 * up in docs/investigations/261002q-brief-plainer-prompt-eval.md.
 *
 *   npx tsx evals/simple/brief-plain.ts screen     # free: the numbers per arm
 *   npx tsx evals/simple/brief-plain.ts pairs      # free: the blind pairs and their key
 *
 * Reads the arms `evals/simple/probe.ts` wrote under evals/results/simple/:
 * `high-<reader>-fb9pb1|b2` (the old prompt, twice) and `…-fb9pa1|a2` (the new),
 * for readers `none` and `about`. Calls no model.
 *
 * **screen** — per arm and reader: Brief's words, its share of words outside
 * the 6,000 commonest (`hardShare`, evals/plain-words/run.ts), Flesch–Kincaid
 * grade, and Simple's and Fuller's words as the check that they did not move.
 * Screens only (prompting-guide.md § Measuring a prompt change, step 7).
 *
 * **pairs** — Brief against Brief, same article, reader and draw: the test set
 * (b1 vs a1, b2 vs a2) and the control (b1 vs b2), shuffled together so the
 * judge cannot tell which is which, sides from `crypto.randomInt`. Each side
 * carries its cited passages for the fidelity question. The key goes to its
 * own file, and the side balance is printed before anyone is sent to judge.
 */
import fs from "node:fs";
import path from "node:path";
import { randomInt } from "node:crypto";
import { loadEnvLocal } from "../../src/env.js";
import { hardShare, wordsIn } from "../plain-words/run.js";

const RESULTS = path.join(import.meta.dirname, "..", "results", "simple");
const OUT = path.join(RESULTS, "brief-plain-261002h");
const SLUGS = [
  /* Greg's own article (spya-rpqqxb), imported locally from nature.com. */
  "s41598-023-33209-9-spya-s0qydm",
  "entropy-24-00930-spya-pywwkq",
  "source-spya-f550ta",
  "scaling-hypothesis",
  "analog-cognition-and-consciousness-4-28-26-spya-f03kqf",
];
const READERS = ["none", "about"] as const;
const ARMS = ["fb9pb1", "fb9pb2", "fb9pa1", "fb9pa2"] as const;
type Para = { text: string; ids: string[] };
interface Run {
  ok: boolean;
  error?: string;
  brief?: Para[];
  paragraphs?: Para[];
  fuller?: Para[];
}

function load(reader: string, arm: string, slug: string): Run | null {
  const file = path.join(RESULTS, `high-${reader}-${arm}`, `${slug}.json`);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as Run) : null;
}
const prose = (ps: Para[] | undefined) => (ps ?? []).map((p) => p.text).join("\n\n");
const count = (ps: Para[] | undefined) => wordsIn(prose(ps)).length;

/** Vowel groups, a rough syllable count — enough for a screen. */
function syllables(word: string): number {
  const w = word.toLowerCase().replace(/e$/, "");
  return Math.max(1, (w.match(/[aeiouy]+/g) ?? []).length);
}
function fkGrade(text: string): number {
  const sentences = Math.max(1, (text.match(/[.!?](\s|$)/g) ?? []).length);
  const words = wordsIn(text);
  if (words.length === 0) return 0;
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  return 0.39 * (words.length / sentences) + 11.8 * (syl / words.length) - 15.59;
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f1 = (x: number) => x.toFixed(1);

function screen(): void {
  const rows: string[] = [
    "| reader | arm | ok | Brief words (mean, range) | hard share | FK grade | Simple words | Fuller words |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const reader of READERS) {
    for (const arm of ARMS) {
      const runs = SLUGS.map((s) => load(reader, arm, s)).filter((r): r is Run => r !== null);
      const ok = runs.filter((r) => r.ok && r.brief);
      if (runs.length === 0) continue;
      const bw = ok.map((r) => count(r.brief));
      const hs = hardShare(ok.map((r) => prose(r.brief)));
      rows.push(
        `| ${reader} | ${arm} | ${ok.length}/${runs.length} | ${f1(mean(bw))} (${Math.min(...bw)}–${Math.max(...bw)}) | ${(hs.share * 100).toFixed(1)}% | ${f1(mean(ok.map((r) => fkGrade(prose(r.brief)))))} | ${f1(mean(ok.map((r) => count(r.paragraphs))))} | ${f1(mean(ok.map((r) => count(r.fuller))))} |`,
      );
    }
  }
  console.log(rows.join("\n"));
  console.log("\nHardest words, Brief, per side (old = b1+b2, new = a1+a2):");
  for (const side of [["fb9pb1", "fb9pb2"], ["fb9pa1", "fb9pa2"]] as const) {
    const texts = READERS.flatMap((r) => side.flatMap((a) => SLUGS.map((s) => load(r, a, s)))).filter(
      (r): r is Run => r?.ok === true,
    );
    console.log(`  ${side.join("+")}: ${hardShare(texts.map((r) => prose(r.brief))).top.join(", ")}`);
  }
}

async function pairs(): Promise<void> {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const { closeDb } = await import("../../src/db/client.js");
  const blockText = new Map<string, string>();
  const titles = new Map<string, string>();
  await runAsOwner(environmentOwnerId(), async () => {
    for (const slug of SLUGS) {
      const article = await loadArticle(slug);
      titles.set(slug, article.meta?.title ?? slug);
      for (const b of article.blocks) blockText.set(`${slug}:${b.id}`, b.text);
    }
  });
  await closeDb();
  const withSources = (slug: string, ps: Para[]) =>
    ps
      .map((p) => {
        const cited = p.ids.map((id) => `    [${id}] ${(blockText.get(`${slug}:${id}`) ?? "(missing)").slice(0, 900)}`);
        return `${p.text}\n  Cited passages:\n${cited.join("\n")}`;
      })
      .join("\n\n");

  type Item = { slug: string; reader: string; a: string; b: string; set: "test" | "control" };
  const items: Item[] = [];
  for (const slug of SLUGS) {
    for (const reader of READERS) {
      items.push({ slug, reader, a: "fb9pb1", b: "fb9pa1", set: "test" });
      items.push({ slug, reader, a: "fb9pb2", b: "fb9pa2", set: "test" });
      items.push({ slug, reader, a: "fb9pb1", b: "fb9pb2", set: "control" });
    }
  }
  /* Fisher–Yates with the crypto coin, so test and control are interleaved. */
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  const out: string[] = [
    "# Blind pairs: two short summaries of the same article",
    "",
    "Each pair is two versions of the shortest summary level, written to orient a reader before they read the piece.",
    "Its intended reader is someone from OUTSIDE the field, in a hurry. For each pair answer:",
    "",
    "- Q1 plain: which would that reader understand faster and more fully? X, Y or SAME.",
    "- Q2 fidelity: against its cited passages, does either lose, bend or blur a claim (a number, the direction of a finding, a hedge), or add something the passages do not say? NONE, X, Y or BOTH, and name it.",
    "- Q3 shape: which more clearly opens on what the piece set out to do and ends on its conclusion or takeaway? X, Y or SAME.",
    "",
    "Answer one line per pair: `n: Q1=X|Y|SAME; Q2=NONE|X|Y|BOTH (what); Q3=X|Y|SAME`.",
    "",
  ];
  const key: string[] = [];
  let n = 0;
  let testPairs = 0;
  const usable = items.filter((it) => {
    const ra = load(it.reader, it.a, it.slug);
    const rb = load(it.reader, it.b, it.slug);
    return ra?.ok && rb?.ok && ra.brief && rb.brief;
  });
  if (usable.length !== items.length) {
    throw new Error(
      `cannot build the blind set: ${items.length - usable.length} of ${items.length} pairs have a missing or failed arm`,
    );
  }
  /* **Exactly balanced sides**, within each set: half swapped, in a shuffled
     order. A fair coin put the new arm on X in 6 of 20 on the first draw, and a
     judge's side preference would then read as a prompt effect. */
  const sides = new Map<Item, boolean>();
  const balances: string[] = [];
  for (const set of ["test", "control"] as const) {
    const group = usable.filter((it) => it.set === set);
    if (group.length % 2 !== 0) {
      throw new Error(`cannot exactly balance ${set}: ${group.length} usable pairs is odd`);
    }
    const flips = group.map((_, i) => i < Math.floor(group.length / 2));
    for (let i = flips.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [flips[i], flips[j]] = [flips[j]!, flips[i]!];
    }
    group.forEach((it, i) => {
      sides.set(it, flips[i]!);
    });
    balances.push(
      `${set}: ${group.length / 2} ${set === "test" ? "new" : "b2"} arms on X of ${group.length}`,
    );
  }
  for (const it of usable) {
    const ra = load(it.reader, it.a, it.slug)!;
    const rb = load(it.reader, it.b, it.slug)!;
    n++;
    const swap = sides.get(it)!;
    const [x, xArm, y, yArm] = swap ? [rb, it.b, ra, it.a] : [ra, it.a, rb, it.b];
    if (it.set === "test") {
      testPairs++;
    }
    out.push(`## ${n}. ${titles.get(it.slug)}`, "", "### X", "", withSources(it.slug, x.brief!), "", "### Y", "", withSources(it.slug, y.brief!), "");
    key.push(JSON.stringify({ n, slug: it.slug, reader: it.reader, set: it.set, X: xArm, Y: yArm }));
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "pairs.md"), out.join("\n"));
  fs.writeFileSync(path.join(OUT, "key.jsonl"), `${key.join("\n")}\n`);
  console.log(`${n} pairs (${testPairs} test). ${balances.join("; ")}.`);
}

const cmd = process.argv[2];
if (cmd === "screen") screen();
else if (cmd === "pairs") await pairs();
else throw new Error("usage: brief-plain.ts screen | pairs");
