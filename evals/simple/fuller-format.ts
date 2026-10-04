/**
 * **A longer Fuller, and bold and bullets** — the measurement for
 * docs/plans/261004b-summary-fuller-longer-and-bold-and-bullets.md, written up
 * in docs/investigations/261004a-summary-fuller-longer-and-bold-and-bullets-prompt-eval.md.
 *
 *   npx tsx evals/simple/fuller-format.ts screen                    # free: the numbers per arm
 *   npx tsx evals/simple/fuller-format.ts fidelity                  # free: every Fuller, sentence by sentence, arms hidden
 *   npx tsx evals/simple/fuller-format.ts format                    # free: the same words, formatted against plain
 *   npx tsx evals/simple/fuller-format.ts tally-fidelity <verdicts> # free
 *   npx tsx evals/simple/fuller-format.ts tally-format <verdicts>   # free
 *   npx tsx evals/simple/fuller-format.ts show                      # free: before and after, for the write-up
 *
 * Reads the arms `evals/simple/probe.ts` wrote under evals/results/simple/:
 * `high-none-fbazb1|b2` (the old prompt, twice) and `high-none-fbaza1|a2` (the
 * new). Calls no model: the judge is a separate GPT Sol run over the files
 * this writes.
 *
 * **fidelity** lists every Fuller in a shuffled order with no arm named, each
 * paragraph beside its cited passages, every sentence numbered `n.k`. Length
 * still shows which prompt wrote it; what is hidden is which draw.
 *
 * **format** draws each after-arm Brief and Fuller twice from the one stored
 * answer: its keys bold and its lists bulleted (through production's
 * `paragraphShape`), and as plain paragraphs. Sides are exactly balanced within
 * each level. A summary with no key and no list has two identical sides, so it
 * is left out and counted.
 */
import fs from "node:fs";
import path from "node:path";
import { randomInt } from "node:crypto";
import { loadEnvLocal } from "../../src/env.js";
import { paragraphShape, type SimpleParagraph, type SimpleSentence } from "../../src/types.js";

const RESULTS = path.join(import.meta.dirname, "..", "results", "simple");
const OUT = path.join(RESULTS, "fuller-format-261004b");
const SLUGS = ["s41598-023-33209-9-spya-s0qydm", "entropy-24-00930-spya-pywwkq", "scaling-hypothesis"];
const BEFORE = ["fbazb1", "fbazb2"] as const;
const AFTER = ["fbaza1", "fbaza2"] as const;
const ARMS = [...BEFORE, ...AFTER] as const;
type Arm = (typeof ARMS)[number];
const LABELS = ["supported", "repeated", "filler", "unsupported-minor", "unsupported-serious"] as const;
type Label = (typeof LABELS)[number];

interface Run {
  ok: boolean;
  error?: string;
  wallMs: number;
  costUsd: number | null;
  words?: number;
  briefWords?: number;
  fullerWords?: number;
  brief?: SimpleParagraph[];
  paragraphs?: SimpleParagraph[];
  fuller?: SimpleParagraph[];
  dropped?: Record<string, number>;
  check?: { levels: Record<string, { result: string; attempts: number; stored: number }> };
}

function load(arm: Arm, slug: string): Run {
  const file = path.join(RESULTS, `high-none-${arm}`, `${slug}.json`);
  if (!fs.existsSync(file)) throw new Error(`no result for ${arm} ${slug}: run the probe first`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as Run;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** A paragraph's sentences however it is shaped; a paragraph with none is one "sentence". */
function sentencesOf(p: SimpleParagraph): SimpleSentence[] {
  const shape = paragraphShape(p);
  if (shape.kind === "text") return [{ text: p.text, id: null }];
  return shape.kind === "prose" ? shape.sentences : [shape.lead, ...shape.items];
}

/** Raw sentence entries as stored, to count the keys the model wrote against the ones kept. */
function formatCounts(ps: SimpleParagraph[]) {
  let keys = 0;
  let lists = 0;
  let maxKeysInParagraph = 0;
  for (const p of ps) {
    const shape = paragraphShape(p);
    if (shape.kind === "list") lists++;
    const inPara = sentencesOf(p).filter((s) => s.key !== undefined).length;
    keys += inPara;
    maxKeysInParagraph = Math.max(maxKeysInParagraph, inPara);
  }
  return { keys, lists, maxKeysInParagraph };
}

function screen(): void {
  const rows: string[] = [
    "| arm | article | Brief w | Simple w | Fuller w | Fuller ¶ | keys B/S/F | max keys a ¶ | lists B/S/F | keys refused | guard | wall s | $ |",
    "|---|---|---:|---:|---:|---:|---|---:|---|---:|---|---:|---:|",
  ];
  const by = new Map<string, { fuller: number[]; wall: number[]; brief: number[]; simple: number[] }>();
  for (const arm of ARMS) {
    const group = arm.startsWith("fbazb") ? "before" : "after";
    const g = by.get(group) ?? { fuller: [], wall: [], brief: [], simple: [] };
    by.set(group, g);
    for (const slug of SLUGS) {
      const r = load(arm, slug);
      if (!r.ok) {
        rows.push(`| ${arm} | ${slug.slice(0, 18)} | FAILED: ${r.error?.slice(0, 80)} |`);
        continue;
      }
      const f = [r.brief!, r.paragraphs!, r.fuller!].map(formatCounts);
      const guard = Object.entries(r.check?.levels ?? {})
        .map(([level, c]) => `${level[0]}:${c.result}${c.attempts > 1 ? `/${c.attempts}` : ""}`)
        .join(" ");
      g.fuller.push(r.fullerWords!);
      g.brief.push(r.briefWords!);
      g.simple.push(r.words!);
      g.wall.push(r.wallMs / 1000);
      rows.push(
        `| ${arm} | ${slug.slice(0, 18)} | ${r.briefWords} | ${r.words} | ${r.fullerWords} | ${r.fuller!.length} | ` +
          `${f.map((x) => x.keys).join("/")} | ${Math.max(...f.map((x) => x.maxKeysInParagraph))} | ${f.map((x) => x.lists).join("/")} | ` +
          `${r.dropped?.keys ?? r.dropped?.sentenceKeys ?? "–"} | ${guard} | ${(r.wallMs / 1000).toFixed(1)} | ${r.costUsd?.toFixed(3) ?? "–"} |`,
      );
    }
  }
  console.log(rows.join("\n"));
  for (const [group, g] of by) {
    console.log(
      `\n${group}: Fuller median ${median(g.fuller)} (${Math.min(...g.fuller)}–${Math.max(...g.fuller)}), ` +
        `Brief ${Math.min(...g.brief)}–${Math.max(...g.brief)}, Simple ${Math.min(...g.simple)}–${Math.max(...g.simple)}, ` +
        `wall median ${median(g.wall).toFixed(1)} s`,
    );
  }
}

async function blockTexts(): Promise<{ text: Map<string, string>; titles: Map<string, string> }> {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const { closeDb } = await import("../../src/db/client.js");
  const text = new Map<string, string>();
  const titles = new Map<string, string>();
  await runAsOwner(environmentOwnerId(), async () => {
    for (const slug of SLUGS) {
      const article = await loadArticle(slug);
      titles.set(slug, article.meta?.title ?? slug);
      for (const b of article.blocks) text.set(`${slug}:${b.id}`, b.text);
    }
  });
  await closeDb();
  return { text, titles };
}

function shuffle<T>(xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
  return xs;
}

async function fidelity(): Promise<void> {
  const { text, titles } = await blockTexts();
  const items = shuffle(ARMS.flatMap((arm) => SLUGS.map((slug) => ({ arm, slug }))));
  const out: string[] = [
    "# Summaries to check, sentence by sentence",
    "",
    "Each numbered summary below was written to orient a reader before they read an article. Under each",
    "paragraph are the passages of the article it cites, quoted from the article (long ones cut at 1,500",
    "characters). Every sentence has a number, `n.k`.",
    "",
    "Label EVERY sentence with exactly one of:",
    "",
    "- `supported`: its cited passages say it. Plainer wording, simplifying and leaving things out are fine.",
    "- `repeated`: it says again what an earlier sentence of the SAME summary already said, adding nothing.",
    "- `filler`: generic; it would be true of almost any piece and tells the reader nothing about this one. A short lead-in to a list (\"The paper rules out three explanations:\") is `supported`, not filler, when the list that follows is.",
    "- `unsupported-minor`: a detail the cited passages do not carry, which does not change what the piece claims.",
    "- `unsupported-serious`: it contradicts the cited passages, or states a claim, number, direction or degree of certainty they do not support.",
    "",
    "Only the cited passages count, not what you know about the subject. Answer one line per sentence and",
    "nothing else: `n.k: label` and, for either unsupported label, ` — ` and a few words saying what.",
    "",
  ];
  const key: string[] = [];
  items.forEach((it, i) => {
    const n = i + 1;
    const r = load(it.arm, it.slug);
    if (!r.ok || !r.fuller) throw new Error(`${it.arm} ${it.slug} failed; the fidelity set needs every arm`);
    out.push(`## Summary ${n}: ${titles.get(it.slug)}`, "");
    let k = 0;
    const sentenceWords: number[] = [];
    for (const p of r.fuller) {
      for (const s of sentencesOf(p)) {
        k++;
        sentenceWords.push(words(s.text));
        out.push(`${n}.${k}: ${s.text}`);
      }
      out.push("", "  Cited passages:");
      for (const id of p.ids) out.push(`    [${id}] ${(text.get(`${it.slug}:${id}`) ?? "(missing)").slice(0, 1500)}`);
      out.push("");
    }
    key.push(JSON.stringify({ n, arm: it.arm, slug: it.slug, sentences: k, words: r.fullerWords, sentenceWords }));
  });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "fidelity.md"), out.join("\n"));
  fs.writeFileSync(path.join(OUT, "fidelity-key.jsonl"), `${key.join("\n")}\n`);
  console.log(`${items.length} summaries written to ${path.relative(process.cwd(), OUT)}/fidelity.md`);
}

/** The key's first occurrence in bold, as the panel draws it. */
const bolded = (s: SimpleSentence): string => {
  if (s.key === undefined) return s.text;
  const at = s.text.indexOf(s.key);
  return at < 0 ? s.text : `${s.text.slice(0, at)}**${s.key}**${s.text.slice(at + s.key.length)}`;
};

/** One summary as the panel draws it, in Markdown. */
export function formatted(ps: SimpleParagraph[]): string {
  return ps
    .map((p) => {
      const shape = paragraphShape(p);
      if (shape.kind === "text") return p.text;
      if (shape.kind === "prose") return shape.sentences.map(bolded).join(" ");
      return `${bolded(shape.lead)}\n\n${shape.items.map((s) => `- ${bolded(s)}`).join("\n")}`;
    })
    .join("\n\n");
}
const plain = (ps: SimpleParagraph[]): string => ps.map((p) => p.text).join("\n\n");

async function format(): Promise<void> {
  const { titles } = await blockTexts();
  const out: string[] = [
    "# Pairs: the same summary, drawn two ways",
    "",
    "In every pair, X and Y are the SAME words. One is drawn as plain paragraphs. The other has a few key",
    "phrases in bold and, sometimes, a paragraph drawn as a bulleted list. A reader opens the summary to",
    "get their bearings before reading the article.",
    "",
    "For each pair: with ten seconds to look, in which would that reader find the piece's main findings",
    "faster? Count against a side whose bold picks out the wrong words, or so many that nothing stands out,",
    "or whose bullets break up reasoning that reads better as prose.",
    "",
    "Answer one line per pair and nothing else: `n: X|Y|SAME — a few words why`.",
    "",
  ];
  const key: string[] = [];
  let n = 0;
  const skipped: string[] = [];
  const balances: string[] = [];
  const all: { level: "brief" | "fuller"; arm: Arm; slug: string; f: string; p: string; flip: boolean }[] = [];
  for (const level of ["brief", "fuller"] as const) {
    const group: typeof all = [];
    for (const arm of AFTER) {
      for (const slug of SLUGS) {
        const r = load(arm, slug);
        const ps = r.ok ? r[level] : undefined;
        if (!ps) throw new Error(`${arm} ${slug} has no ${level}`);
        const f = formatted(ps);
        const p = plain(ps);
        if (f === p) skipped.push(`${level} ${arm} ${slug}`);
        else group.push({ level, arm, slug, f, p, flip: false });
      }
    }
    /* Exactly balanced within the level; an odd group leaves one side one ahead. */
    const flips = shuffle(group.map((_, i) => i < Math.floor(group.length / 2)));
    group.forEach((g, i) => {
      g.flip = flips[i]!;
    });
    balances.push(`${level}: formatted on X in ${group.filter((g) => !g.flip).length} of ${group.length}`);
    all.push(...group);
  }
  for (const g of shuffle(all)) {
    n++;
    const [x, y] = g.flip ? [g.p, g.f] : [g.f, g.p];
    out.push(`## ${n}. ${titles.get(g.slug)}`, "", "### X", "", x, "", "### Y", "", y, "");
    key.push(JSON.stringify({ n, level: g.level, arm: g.arm, slug: g.slug, formatted: g.flip ? "Y" : "X" }));
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "format-pairs.md"), out.join("\n"));
  fs.writeFileSync(path.join(OUT, "format-key.jsonl"), `${key.join("\n")}\n`);
  console.log(`${n} pairs. ${balances.join("; ")}. Left out, no formatting at all: ${skipped.length ? skipped.join(", ") : "none"}.`);
}

function readKey<T>(name: string): T[] {
  return fs
    .readFileSync(path.join(OUT, name), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function tallyFidelity(file: string): void {
  const keys = readKey<{ n: number; arm: Arm; slug: string; sentences: number; words: number }>("fidelity-key.jsonl");
  const got = new Map<string, Label>();
  const notes: string[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*(\d+)\.(\d+)\s*:\s*`?(supported|repeated|filler|unsupported-minor|unsupported-serious)`?\b(.*)$/i.exec(line);
    if (!m) continue;
    const id = `${m[1]}.${m[2]}`;
    if (got.has(id)) throw new Error(`sentence ${id} labelled twice`);
    got.set(id, m[3]!.toLowerCase() as Label);
    if (m[3]!.toLowerCase().startsWith("unsupported")) notes.push(`${id} ${m[3]}${m[4]}`);
  }
  /* Every sentence exactly once, or the tally is of something else. */
  const expected = keys.reduce((sum, k) => sum + k.sentences, 0);
  for (const k of keys) {
    for (let i = 1; i <= k.sentences; i++) {
      if (!got.has(`${k.n}.${i}`)) throw new Error(`no label for sentence ${k.n}.${i}`);
    }
  }
  if (got.size !== expected) throw new Error(`${got.size} labels for ${expected} sentences`);
  console.log(`${got.size} labels, one for each of ${expected} sentences\n`);
  console.log("| arm | Fullers | words | sentences | supported | repeated | filler | minor | serious | unsupported / 100 w | repeated+filler | Fullers with a serious |");
  console.log("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  const groups: [string, readonly Arm[]][] = [
    ["fbazb1", ["fbazb1"]],
    ["fbazb2", ["fbazb2"]],
    ["before", BEFORE],
    ["fbaza1", ["fbaza1"]],
    ["fbaza2", ["fbaza2"]],
    ["after", AFTER],
  ];
  for (const [name, arms] of groups) {
    const ks = keys.filter((k) => arms.includes(k.arm));
    const c: Record<Label, number> = { supported: 0, repeated: 0, filler: 0, "unsupported-minor": 0, "unsupported-serious": 0 };
    let withSerious = 0;
    for (const k of ks) {
      let serious = false;
      for (let i = 1; i <= k.sentences; i++) {
        const label = got.get(`${k.n}.${i}`)!;
        c[label]++;
        if (label === "unsupported-serious") serious = true;
      }
      if (serious) withSerious++;
    }
    const w = ks.reduce((s, k) => s + k.words, 0);
    const sentences = ks.reduce((s, k) => s + k.sentences, 0);
    const unsupported = c["unsupported-minor"] + c["unsupported-serious"];
    console.log(
      `| ${name} | ${ks.length} | ${w} | ${sentences} | ${c.supported} | ${c.repeated} | ${c.filler} | ${c["unsupported-minor"]} | ${c["unsupported-serious"]} | ` +
        `${((unsupported / w) * 100).toFixed(2)} | ${(((c.repeated + c.filler) / sentences) * 100).toFixed(0)}% | ${withSerious} |`,
    );
  }
  console.log(`\nUnsupported, by summary (key: ${keys.map((k) => `${k.n}=${k.arm}/${k.slug.slice(0, 8)}`).join(" ")}):`);
  for (const note of notes) console.log(`  ${note}`);
}

function tallyFormat(file: string): void {
  const keys = readKey<{ n: number; level: string; arm: Arm; slug: string; formatted: "X" | "Y" }>("format-key.jsonl");
  const got = new Map<number, string>();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*(\d+)\s*:\s*`?(X|Y|SAME)\b/i.exec(line);
    if (m) got.set(Number(m[1]), m[2]!.toUpperCase());
  }
  if (got.size !== keys.length) throw new Error(`${got.size} verdicts for ${keys.length} pairs`);
  for (const level of ["brief", "fuller", "all"]) {
    const ks = keys.filter((k) => level === "all" || k.level === level);
    let f = 0;
    let p = 0;
    let same = 0;
    for (const k of ks) {
      const v = got.get(k.n)!;
      if (v === "SAME") same++;
      else if (v === k.formatted) f++;
      else p++;
    }
    console.log(`${level}: formatted ${f} : plain ${p} : same ${same}  (of ${ks.length}; formatted was X in ${ks.filter((k) => k.formatted === "X").length})`);
  }
}

/** Before and after for the write-up: the first draw of each arm, Fuller and Brief, as drawn. */
function show(): void {
  for (const slug of SLUGS) {
    for (const arm of ["fbazb1", "fbaza1"] as const) {
      const r = load(arm, slug);
      console.log(`\n===== ${slug} · ${arm} · Fuller, ${r.fullerWords} words =====\n`);
      console.log(formatted(r.fuller ?? []));
      console.log(`\n===== ${slug} · ${arm} · Brief, ${r.briefWords} words =====\n`);
      console.log(formatted(r.brief ?? []));
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "screen") screen();
  else if (cmd === "fidelity") await fidelity();
  else if (cmd === "format") await format();
  else if (cmd === "tally-fidelity" && arg) tallyFidelity(arg);
  else if (cmd === "tally-format" && arg) tallyFormat(arg);
  else if (cmd === "show") show();
  else throw new Error("usage: screen | fidelity | format | tally-fidelity <verdicts> | tally-format <verdicts> | show");
}
