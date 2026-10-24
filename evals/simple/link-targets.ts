/**
 * **Where do a summary's links land: on the passage that lays a point out, or
 * on the article's own summary of it?** — the measurement for
 * docs/plans/261024x-summary-links-the-body-that-argues-a-point-not-the-abstract.md
 * (report spya-hnw9xq).
 *
 *   npx tsx evals/simple/link-targets.ts table   # free: links into the front summary, guard, words, per arm
 *   npx tsx evals/simple/link-targets.ts pairs   # free: Fuller pairs with each linked passage, blind, and the key
 *   npx tsx evals/simple/link-targets.ts score <answers.json>   # free: the judge's answers, unblinded
 *
 * Reads the arms `evals/simple/probe.ts` wrote under evals/results/simple/ as
 * `high-none-<arm>`, and each article's blocks from the LOCAL database,
 * read-only. Calls no model.
 *
 *  - `link0a`, `link0b` — the prompt before the change (`simple-prompt/12`),
 *    twice; the second is the control.
 *  - `link1a`, `link1b` — with the rule that a link is where the reader goes
 *    for the detail (`simple-prompt/13`).
 *
 * **The front summary** of each paper is marked by hand, by block index in
 * the local copy: its abstract, and an executive summary where it has one.
 * The essay has none and is there as a control for harm.
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../../src/env.js";
import { inputFingerprint } from "../../src/simple-summary.js";
import { blindCoin } from "../plain-words/run.js";

const RESULTS = path.join(import.meta.dirname, "..", "results", "simple");
const OUT = path.join(RESULTS, "link-targets-261024x");
const ARMS = ["link0a", "link0b", "link1a", "link1b"] as const;
type Arm = (typeof ARMS)[number];

/** Block-index ranges, inclusive, of each paper's own summary of itself. */
const FRONT: Record<string, [number, number][]> = {
  "arxiv-2308-08708-spya-w598t3": [[2, 3], [39, 53]],
  "arxiv-2307-09288v2-spya-smdqsk": [[71, 72]],
  "nber-w31161-spya-dkgc83": [[5, 6]],
  "jmlr-v15-srivastava14a-spya-sd3uzs": [[3, 4]],
  "greatwork-spya-yw4d3t": [],
};
const SLUGS = Object.keys(FRONT);

interface Sentence { text: string; id: string | null; key?: string | null }
interface Paragraph { text: string; ids: string[]; sentences?: Sentence[] }
interface ArmFile {
  ok: boolean;
  error?: string;
  sourceSha256: string;
  systemsSha256?: string;
  version: string;
  costUsd: number | null;
  briefWords?: number;
  fullerWords?: number;
  brief?: Paragraph[];
  fuller?: Paragraph[];
  articleHash: string;
  dropped?: Record<string, number>;
  check?: { levels?: Record<string, { result: string; attempts: number; retriedAfterFlag?: boolean }> };
}

function readArm(arm: Arm, slug: string): ArmFile | null {
  const file = path.join(RESULTS, `high-none-${arm}`, `${slug}.json`);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as ArmFile) : null;
}

interface ArticleBlocks {
  articleHash: string;
  index: Map<string, number>;
  text: Map<string, string>;
}

async function blocksOf(): Promise<Map<string, ArticleBlocks>> {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const { loadArticle } = await import("../../src/store/index.js");
  const { closeDb } = await import("../../src/db/client.js");
  const out = new Map<string, ArticleBlocks>();
  await runAsOwner(environmentOwnerId(), async () => {
    for (const slug of SLUGS) {
      const a = await loadArticle(slug);
      out.set(slug, {
        articleHash: inputFingerprint(a.blocks, a.tree, a.meta),
        index: new Map(a.blocks.map((b, i) => [b.id as string, i])),
        text: new Map(a.blocks.map((b) => [b.id as string, b.text])),
      });
    }
  });
  await closeDb();
  return out;
}

function assertSameArticle(f: ArmFile, article: ArticleBlocks, arm: Arm, slug: string): void {
  if (f.articleHash !== article.articleHash) {
    throw new Error(`${arm} ${slug}: result article ${f.articleHash} does not match the local revision ${article.articleHash}`);
  }
}

const inFront = (slug: string, i: number | undefined) =>
  i !== undefined && (FRONT[slug] ?? []).some(([a, b]) => i >= a && i <= b);

/** One level of one write, counted every way the plan's gates read it (GPT Sol's plan review, F3). */
interface Counts {
  idsFront: number; ids: number;
  parasFront: number; firstFront: number; paras: number;
  sentencesFront: number; sentencesLinked: number; sentences: number;
}
const ZERO: Counts = { idsFront: 0, ids: 0, parasFront: 0, firstFront: 0, paras: 0, sentencesFront: 0, sentencesLinked: 0, sentences: 0 };

function count(paras: Paragraph[], front: (id: string) => boolean): Counts {
  const c = { ...ZERO };
  for (const p of paras) {
    c.paras += 1;
    c.ids += p.ids.length;
    c.idsFront += p.ids.filter(front).length;
    if (p.ids.some(front)) c.parasFront += 1;
    if (p.ids[0] !== undefined && front(p.ids[0])) c.firstFront += 1;
    for (const s of p.sentences ?? []) {
      c.sentences += 1;
      if (s.id !== null) c.sentencesLinked += 1;
      if (s.id !== null && front(s.id)) c.sentencesFront += 1;
    }
  }
  return c;
}

const add = (a: Counts, b: Counts): Counts =>
  Object.fromEntries(Object.keys(a).map((k) => [k, a[k as keyof Counts] + b[k as keyof Counts]])) as unknown as Counts;

async function table(): Promise<void> {
  const blocks = await blocksOf();
  const totals: Record<string, Record<"brief" | "fuller", Counts>> = {};
  const rows: string[] = [
    "| arm | article | prompt | level | ids in front | ¶ with any | ¶ first chip | sentences to front | sentences linked | guard | words | dropped | $ |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  const hashes = new Map<string, string>();
  for (const arm of ARMS) {
    for (const slug of SLUGS) {
      const f = readArm(arm, slug);
      if (!f) continue;
      /* The prompt source each arm ran; the system hash differs by length band, so the source is the one to compare. */
      hashes.set(arm, f.sourceSha256);
      if (!f.ok) {
        rows.push(`| ${arm} | ${slug.slice(0, 22)} | ${f.version} | failed: ${f.error ?? "?"} |||||||||`);
        continue;
      }
      const article = blocks.get(slug)!;
      assertSameArticle(f, article, arm, slug);
      const ix = article.index;
      const paper = (FRONT[slug] ?? []).length > 0;
      const front = (id: string) => {
        const blockIndex = ix.get(id);
        if (blockIndex === undefined) throw new Error(`${arm} ${slug}: linked block ${id} is absent from the local revision`);
        return inFront(slug, blockIndex);
      };
      const dropped = Object.entries(f.dropped ?? {}).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(", ") || "0";
      for (const level of ["brief", "fuller"] as const) {
        const c = count(f[level] ?? [], front);
        if (paper) {
          totals[arm] ??= { brief: { ...ZERO }, fuller: { ...ZERO } };
          totals[arm][level] = add(totals[arm][level], c);
        }
        const g = f.check?.levels?.[level];
        const guard = g ? `${g.result}${g.attempts > 1 ? `×${g.attempts}` : ""}` : "off";
        const fr = (n: number, d: number) => (paper ? `${n} / ${d}` : `— / ${d}`);
        rows.push(
          `| ${arm} | ${slug.slice(0, 22)} | ${f.version} | ${level} | ${fr(c.idsFront, c.ids)} | ${fr(c.parasFront, c.paras)} | ${fr(c.firstFront, c.paras)} | ${fr(c.sentencesFront, c.sentences)} | ${c.sentencesLinked} / ${c.sentences} | ${guard} | ${level === "brief" ? f.briefWords : f.fullerWords} | ${dropped} | ${level === "brief" ? (f.costUsd?.toFixed(3) ?? "?") : ""} |`,
        );
      }
    }
  }
  console.log(rows.join("\n"));
  const pct = (n: number, d: number) => `${n}/${d} (${Math.round((100 * n) / Math.max(1, d))}%)`;
  console.log("\nTotals over the four papers:");
  for (const arm of ARMS) {
    const t = totals[arm];
    if (!t) continue;
    for (const level of ["brief", "fuller"] as const) {
      const c = t[level];
      console.log(
        `  ${arm} ${level.padEnd(6)} ids ${pct(c.idsFront, c.ids)} · ¶ with any ${pct(c.parasFront, c.paras)} · ¶ first chip ${pct(c.firstFront, c.paras)} · sentences to front ${pct(c.sentencesFront, c.sentences)} · sentences linked ${pct(c.sentencesLinked, c.sentences)}`,
      );
    }
  }
  console.log("\nsrc/simple-summary.ts hash per arm (sourceSha256):");
  for (const [arm, h] of hashes) console.log(`  ${arm}: ${h.slice(0, 12)}`);
}

const PASSAGE_CHARS = 300;
type Level = "brief" | "fuller";

function render(f: ArmFile, level: Level, texts: Map<string, string>): string {
  const out: string[] = [];
  for (const p of f[level] ?? []) {
    const n = new Map(p.ids.map((id, i) => [id, i + 1]));
    const sentences = (p.sentences ?? [{ text: p.text, id: null }])
      .map((s) => `${s.text}${s.id && n.has(s.id) ? ` [${n.get(s.id)}]` : ""}`)
      .join(" ");
    out.push(sentences, "");
    p.ids.forEach((id, i) => {
      const passage = texts.get(id);
      if (passage === undefined) throw new Error(`linked block ${id} is absent from the local revision`);
      const t = passage.replace(/\s+/g, " ");
      out.push(`> [${i + 1}] ${t.length > PASSAGE_CHARS ? `${t.slice(0, PASSAGE_CHARS)}…` : t}`);
    });
    out.push("");
  }
  return out.join("\n");
}

/* The first seed from 26102424 that put every kind's newer (or `link0b`) arm
   on each side no worse than 6–4 in ten and 3–2 in five; 26102424 itself put
   the Fuller control on one side five times in five. Chosen before any judge
   read a pair (prompting-guide.md § Measuring, 4). */
const SEED = 26102440;

async function pairs(): Promise<void> {
  const blocks = await blocksOf();
  const wanted: { kind: "test" | "control"; level: Level; slug: string; left: Arm; right: Arm }[] = [];
  for (const level of ["brief", "fuller"] as const) {
    for (const slug of SLUGS) {
      wanted.push({ kind: "test", level, slug, left: "link0a", right: "link1a" });
      wanted.push({ kind: "test", level, slug, left: "link0b", right: "link1b" });
      wanted.push({ kind: "control", level, slug, left: "link0a", right: "link0b" });
    }
  }
  /* Shuffle the order and the sides with the tested coin; the seed is fixed before any judge reads a pair. */
  const coin = blindCoin(Number(process.env.LINK_TARGETS_SEED ?? SEED));
  const order = wanted.map((w) => ({ w, r: Array.from({ length: 12 }, () => coin()).reduce((n, b) => n * 2 + (b ? 1 : 0), 0) }));
  order.sort((a, b) => a.r - b.r);
  const lines = [
    "# Pairs of summaries of the same piece, with what each paragraph links to",
    "",
    "Each pair is two summaries of one piece. Each summary is written as paragraphs; after a paragraph come the passages of the piece it links to, numbered, and a sentence's [n] says which passage that sentence links to. A reader presses a link to go to that passage in the piece. The sides are in a random order. Judge each pair on its own.",
    "",
  ];
  const key: { id: string; kind: string; level: Level; slug: string; A: Arm; B: Arm }[] = [];
  /* Failed writes are listed, not silently replaced (GPT Sol's plan review, F4). */
  const missing: string[] = [];
  const byLevel: Record<Level, string[]> = { brief: [], fuller: [] };
  const sides: Record<string, { A: number; B: number }> = {};
  let i = 0;
  for (const { w } of order) {
    const l = readArm(w.left, w.slug);
    const r = readArm(w.right, w.slug);
    if (!l?.ok || !r?.ok) {
      missing.push(`${w.kind} ${w.level} ${w.slug}: ${w.left}${l?.ok ? "" : " failed"} / ${w.right}${r?.ok ? "" : " failed"}`);
      continue;
    }
    const article = blocks.get(w.slug)!;
    assertSameArticle(l, article, w.left, w.slug);
    assertSameArticle(r, article, w.right, w.slug);
    i += 1;
    const id = `P${String(i).padStart(2, "0")}`;
    const flip = coin();
    const [a, b] = flip ? [r, l] : [l, r];
    const [aArm, bArm] = flip ? [w.right, w.left] : [w.left, w.right];
    const sideKey = `${w.kind}/${w.level}`;
    sides[sideKey] ??= { A: 0, B: 0 };
    sides[sideKey][flip ? "A" : "B"] += 1;
    const texts = article.text;
    byLevel[w.level].push(`## ${id}`, "", "### Summary A", "", render(a, w.level, texts), "### Summary B", "", render(b, w.level, texts));
    key.push({ id, kind: w.kind, level: w.level, slug: w.slug, A: aArm, B: bArm });
  }
  fs.mkdirSync(OUT, { recursive: true });
  /* One file per level, for one judge each: the Fuller pairs alone are most of the words. */
  for (const level of ["brief", "fuller"] as const) {
    fs.writeFileSync(path.join(OUT, `pairs-${level}.md`), [...lines.slice(0, 4), ...byLevel[level]].join("\n"));
  }
  fs.writeFileSync(path.join(OUT, "pairs-key.json"), `${JSON.stringify(key, null, 2)}\n`);
  console.log(`${i} pairs → ${path.relative(process.cwd(), OUT)}/pairs-{brief,fuller}.md. The right-hand arm of each kind is on side:`);
  for (const [kind, s] of Object.entries(sides)) console.log(`  ${kind}: A ${s.A}, B ${s.B}`);
  for (const m of missing) console.log(`  not paired: ${m}`);
}

/** One pair's answer. `unsupportedA`/`B`: links whose passage does not support, or only relates to, its sentence. */
interface Answer { id: string; links: "A" | "B" | "same"; unsupportedA: number; unsupportedB: number; faultA: string | null; faultB: string | null }

function score(file: string): void {
  const key = JSON.parse(fs.readFileSync(path.join(OUT, "pairs-key.json"), "utf8")) as { id: string; kind: string; level: Level; slug: string; A: Arm; B: Arm }[];
  const answers = JSON.parse(fs.readFileSync(file, "utf8")) as Answer[];
  const by = new Map(answers.map((a) => [a.id, a]));
  const tally: Record<string, Record<string, number>> = {};
  /* Per arm family, old (`link0*`) and new (`link1*`): unsupported links and claim faults named, over test pairs only. */
  const harm: Record<"old" | "new", { unsupported: number; faults: number }> = { old: { unsupported: 0, faults: 0 }, new: { unsupported: 0, faults: 0 } };
  const faults: string[] = [];
  for (const k of key) {
    const a = by.get(k.id);
    if (!a) {
      console.log(`${k.id}: no answer`);
      continue;
    }
    const won = a.links === "same" ? "same" : a.links === "A" ? k.A : k.B;
    const label = k.kind === "test" ? (won === "same" ? "same" : won.startsWith("link1") ? "new" : "old") : won;
    const tallyKey = `${k.kind}/${k.level}`;
    tally[tallyKey] ??= {};
    const t = tally[tallyKey];
    t[label] = (t[label] ?? 0) + 1;
    for (const [side, arm] of [["A", k.A], ["B", k.B]] as const) {
      const fault = side === "A" ? a.faultA : a.faultB;
      const unsupported = side === "A" ? a.unsupportedA : a.unsupportedB;
      if (k.kind === "test") {
        const family = arm.startsWith("link1") ? "new" : "old";
        harm[family].unsupported += unsupported;
        if (fault) harm[family].faults += 1;
      }
      if (fault || unsupported) faults.push(`${k.id} ${k.level} ${k.slug} ${arm}: ${unsupported} unsupported${fault ? `; ${fault}` : ""}`);
    }
  }
  console.log("Whose links more often land where the piece lays the point out:");
  for (const [kind, t] of Object.entries(tally)) console.log(`  ${kind}: ${JSON.stringify(t)}`);
  console.log(`\nIn test pairs: old arms ${harm.old.unsupported} unsupported links, ${harm.old.faults} claim faults; new arms ${harm.new.unsupported}, ${harm.new.faults}.`);
  console.log("\nWhat the judge named (unblinded):");
  for (const f of faults) console.log(`  ${f}`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "table") await table();
else if (cmd === "pairs") await pairs();
else if (cmd === "score" && arg) score(arg);
else {
  console.error("usage: link-targets.ts table | pairs | score <answers.json>");
  process.exit(2);
}
