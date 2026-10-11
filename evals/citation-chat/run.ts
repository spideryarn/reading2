/**
 * Eval — does *Ask in chat* on a cited work answer about the article's use of
 * it, rather than only about the work?
 *
 *     npx tsx evals/citation-chat/run.ts list                     # slugs with a stored citations list
 *     npx tsx evals/citation-chat/run.ts show <slug>              # its works, mentions and citing sentences
 *     npx tsx evals/citation-chat/run.ts run --arm old-a|old-b|new  # SPENDS MONEY: one Chat turn per case
 *     npx tsx evals/citation-chat/run.ts pairs                    # blind pairs + key, balance checked
 *     npx tsx evals/citation-chat/run.ts tally                    # unblind pairs.judged.txt
 *
 * Plan: docs/plans/261011ab-ask-in-chat-about-a-citation-leads-with-how-the-article-uses-it.md.
 * Method: docs/project/prompting-guide.md § Measuring a prompt change.
 *
 * Greg (spya-xv3q97) found the answers to the Bibliography's *Ask in chat*
 * were mostly about the work out in the world. The change adds the sentences
 * that cite the work to the seed, and a question that asks first what the
 * article uses the work to say.
 *
 * ## The arms
 *
 *   old-a, old-b  the seed as it was before the change: the work fenced, then
 *                 "What does it say, and does the article use it fairly?".
 *                 Built from today's `askAboutCitedWork(work)` with no citing
 *                 sentences — which is byte-for-byte the old function's output —
 *                 with the question swapped back. Two runs, so the control can
 *                 say how much one seed disagrees with itself.
 *   new           `askAboutCitedWork(work, citingSentences(work.mentions, …))`.
 *
 * Each answer is a first question in a fresh Chat thread, sent the way the
 * route sends it (src/routes.ts § the `converse` call): kind `chat`, no anchor,
 * no help flag, no history, tools on, so the web search is whatever Chat has by
 * default. The route also passes the reader's profile and their other threads;
 * here both are `null`, as in evals/chat-web-reach.ts, so neither arm is
 * steered by one reader's history.
 *
 * Results: evals/citation-chat/results/<arm>.json (never overwritten), with
 * a hash of each seed and of the chat-handoff and converse sources.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadEnvLocal } from "../../src/env.js";
import { isMain } from "../../src/is-main.js";
import { askAboutCitedWork, citingSentences, CITED_WORK_QUESTION } from "../../src/web/chat-handoff.js";
import { blindCoin } from "../plain-words/run.js";
import type { CitedWork } from "../../src/types.js";

const OUT = path.join(import.meta.dirname, "results");
const ARMS = ["old-a", "old-b", "new"] as const;
type Arm = (typeof ARMS)[number];

/** The question before plan 261011ab, verbatim from `git show HEAD:src/web/chat-handoff.ts`. */
const OLD_QUESTION = "What does it say, and does the article use it fairly?";

/**
 * The cases: an article and a work in its stored list, by title prefix (ids
 * would do, but a title says what the case is). Picked with `list` and `show`:
 * one humanities essay with author–year citations, one numbered-citation
 * paper, one more essay; one work per article with no body mention, so the new
 * seed's no-fence path is measured too.
 */
const CASES: readonly { slug: string; title: string }[] = [
  /* Nagel, "What Is It Like to Be a Bat?" (1974): author-name citations, footnotes. */
  { slug: "fd-src-nagel-bat-spya-f5aw85", title: "Naming and Necessity" },
  { slug: "fd-src-nagel-bat-spya-f5aw85", title: "Mental Events" },
  { slug: "fd-src-nagel-bat-spya-f5aw85", title: "Philosophy and Scientific Realism" }, // no body mention
  /* Vaswani et al., "Attention Is All You Need": numbered citations. */
  { slug: "arxiv-1706-03762v7-spya-wv4w9s", title: "Neural machine translation by jointly learning" },
  { slug: "arxiv-1706-03762v7-spya-wv4w9s", title: "Convolutional sequence to sequence learning" },
  { slug: "arxiv-1706-03762v7-spya-wv4w9s", title: "A decomposable attention model" },
  /* Gwern, "The Scaling Hypothesis": an essay citing by link and name. */
  { slug: "scaling-hypothesis", title: "The Bitter Lesson" },
  { slug: "scaling-hypothesis", title: "Language Models are Few-Shot Learners" },
  { slug: "scaling-hypothesis", title: "Scaling Laws for Neural Language Models" }, // no body mention
];

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

function seedFor(arm: Arm, work: CitedWork, text: (id: string) => string | undefined): string {
  if (arm === "new") return askAboutCitedWork(work, citingSentences(work.mentions, text));
  const now = askAboutCitedWork(work);
  if (!now.endsWith(CITED_WORK_QUESTION)) throw new Error("askAboutCitedWork no longer ends on CITED_WORK_QUESTION");
  return now.slice(0, -CITED_WORK_QUESTION.length) + OLD_QUESTION;
}

async function withStore<T>(fn: (store: typeof import("../../src/store/index.js")) => Promise<T>): Promise<T> {
  loadEnvLocal();
  const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");
  const store = await import("../../src/store/index.js");
  return runAsOwner(environmentOwnerId(), () => fn(store));
}

async function list(): Promise<void> {
  await withStore(async (store) => {
    for (const a of await store.listArticles()) {
      let works: CitedWork[];
      try {
        works = (await store.loadBibliography(a.slug)).bibliography.citations;
      } catch {
        continue;
      }
      if (works.length === 0) continue;
      const withMentions = works.filter((w) => w.mentions.length > 0).length;
      console.log(`${a.slug}\t${works.length} works\t${withMentions} with mentions\t${a.title}`);
    }
  });
}

async function show(slug: string): Promise<void> {
  await withStore(async (store) => {
    const { blocks } = await store.loadArticle(slug);
    const text = new Map(blocks.map((b) => [b.id, b.text]));
    const works = (await store.loadBibliography(slug)).bibliography.citations;
    for (const w of works) {
      const citing = citingSentences(w.mentions, (id) => text.get(id));
      console.log(`\n${w.title} — ${w.authors ?? "?"}, ${w.year ?? "?"}  [rel ${w.relevance ?? "-"}] mentions=${w.mentions.length} citing=${citing.length}`);
      for (const c of citing) console.log(`   > ${c.slice(0, 200)}`);
    }
  });
}

interface Outcome {
  arm: Arm;
  slug: string;
  workId: string;
  title: string;
  citing: number;
  seed: string;
  seedHash: string;
  text: string;
  searches: number;
  tools: string[];
  model: string;
  truncated: boolean;
  usd: number;
  seconds: number;
  error?: string;
}

async function run(arm: Arm): Promise<void> {
  if (CASES.length === 0) throw new Error("CASES is empty; pick them with list and show");
  const file = path.join(OUT, `${arm}.json`);
  if (fs.existsSync(file)) throw new Error(`${file} exists; arms are never overwritten`);
  const { converse } = await import("../../src/converse.js");
  const { collectSpend, totalSpend } = await import("../../src/ai-spend.js");
  const { costStore } = await import("../../src/store/ai-calls.js");
  const { environmentOwnerId } = await import("../../src/owner.js");
  const root = path.resolve(import.meta.dirname, "../..");
  const sources = Object.fromEntries(
    ["src/web/chat-handoff.ts", "src/converse.ts", "src/chat-prompt.ts"]
      .filter((f) => fs.existsSync(path.join(root, f)))
      .map((f) => [f, sha(fs.readFileSync(path.join(root, f), "utf-8"))]),
  );
  const outcomes: Outcome[] = [];
  let total = 0;
  await withStore(async (store) => {
    for (const c of CASES) {
      const { meta, blocks } = await store.loadArticle(c.slug);
      const text = new Map(blocks.map((b) => [b.id, b.text]));
      const work = (await store.loadBibliography(c.slug)).bibliography.citations.find((w) =>
        w.title.startsWith(c.title),
      );
      if (!work) throw new Error(`${c.slug} has no work titled "${c.title}…"`);
      const seed = seedFor(arm, work, (id) => text.get(id));
      const citing = citingSentences(work.mentions, (id) => text.get(id)).length;
      const started = performance.now();
      const base = { arm, slug: c.slug, workId: work.id, title: work.title, citing, seed, seedHash: sha(seed) };
      try {
        const { result, report } = await collectSpend(
          async () => {
            for await (const event of converse({
              power: "standard",
              meta,
              blocks,
              history: [],
              question: seed,
              slug: c.slug,
              anchor: null,
              help: false,
              kind: "chat",
              profile: null,
              useTools: true,
            })) {
              if (event.type === "done") return event;
            }
            throw new Error("converse ended without a done event");
          },
          { attribution: { scopeKind: "eval", ownerId: environmentOwnerId() }, sink: (row) => costStore.record(row) },
        );
        const usd = totalSpend(report.calls).nanos / 1e9;
        total += usd;
        outcomes.push({
          ...base,
          text: result.text,
          searches: result.searches,
          tools: result.tools.map((t) => t.name),
          model: result.model,
          truncated: result.truncated,
          usd,
          seconds: Number(((performance.now() - started) / 1000).toFixed(1)),
        });
      } catch (err) {
        outcomes.push({
          ...base,
          text: "",
          searches: 0,
          tools: [],
          model: "",
          truncated: false,
          usd: 0,
          seconds: Number(((performance.now() - started) / 1000).toFixed(1)),
          error: err instanceof Error ? err.message : String(err),
        });
      }
      const o = outcomes.at(-1)!;
      console.log(
        `${arm} · ${c.slug} · ${work.title.slice(0, 50)} — citing=${citing} searches=${o.searches} $${o.usd.toFixed(3)} ${o.seconds}s ${o.text.length} chars${o.error ? ` FAILED: ${o.error}` : ""}`,
      );
      if (total > 2) throw new Error(`arm ${arm} passed $2 (${total.toFixed(2)}); stopping`);
    }
  });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ arm, at: new Date().toISOString(), sources, usd: total, outcomes }, null, 2)}\n`);
  console.log(`\n${arm}: $${total.toFixed(3)} — ${path.relative(process.cwd(), file)}`);
}

function load(arm: Arm): Outcome[] {
  return (JSON.parse(fs.readFileSync(path.join(OUT, `${arm}.json`), "utf-8")) as { outcomes: Outcome[] }).outcomes;
}

const COMPARISONS = [
  ["old-a", "old-b", "control"],
  ["old-a", "new", "test"],
] as const;

/**
 * Both comparisons in one shuffled file, so the judge cannot tell the control
 * from the test by position. The article's citing passages are shown once per
 * pair, from the article, so the judge can check claims about the article
 * whichever seed the answer came from.
 */
function pairs(): void {
  const coin = blindCoin(261011);
  const items: { kind: string; a: Outcome; b: Outcome; aArm: Arm; bArm: Arm }[] = [];
  for (const [x, y, kind] of COMPARISONS) {
    const ys = load(y);
    for (const a of load(x)) {
      const b = ys.find((o) => o.slug === a.slug && o.workId === a.workId);
      if (!b || a.error || b.error) continue;
      items.push({ kind, a, b, aArm: x, bArm: y });
    }
  }
  /* A seeded shuffle of the order, so pair n says nothing about which comparison it is. */
  for (let i = items.length - 1; i > 0; i--) {
    let j = 0;
    for (let bit = 0; bit < 5; bit++) j = j * 2 + (coin() ? 1 : 0);
    j %= i + 1;
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  /* **Balanced sides by construction.** With nine pairs a fair coin put the
     new arm on X seven times in nine on its first draw, so each comparison gets
     an equal share of flips (one over for an odd count), dealt by the coin. */
  const draw = (k: number): number => {
    let j = 0;
    for (let bit = 0; bit < 8; bit++) j = j * 2 + (coin() ? 1 : 0);
    return j % k;
  };
  const flips = new Map<(typeof items)[number], boolean>();
  for (const kind of new Set(items.map((it) => it.kind))) {
    const these = items.filter((it) => it.kind === kind);
    const deck = these.map((_, i) => i % 2 === 0);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = draw(i + 1);
      [deck[i], deck[j]] = [deck[j]!, deck[i]!];
    }
    these.forEach((it, i) => flips.set(it, deck[i]!));
  }
  const newSeeds = new Map(load("new").map((o) => [`${o.slug}|${o.workId}`, o.seed]));
  const out: string[] = [
    "# Blind pairs: Ask in chat about a cited work",
    "",
    "A reader pressed *Ask in chat* on a work the article cites. Each pair is two answers to that. For each pair, answer:",
    "",
    "1. **use**: which answer better explains what point the article uses the work to make, grounded in the article's own passages? (X, Y or same)",
    "2. **justified**: which better judges whether that use is justified — including being honest about not having read the work itself, where it has not? (X, Y or same)",
    "3. **false**: did either state something about the ARTICLE that is false or invented? (none, X: …, Y: …)",
    "",
    "Format, one line per pair: `n: use=X|Y|same; justified=X|Y|same; false=none|X: …|Y: …`",
    "",
    "The passages where the article cites the work are given with each pair, so you can check claims about the article.",
    "",
  ];
  const key: string[] = [];
  const sides: Record<string, Record<string, number>> = {};
  items.forEach((it, i) => {
    const n = i + 1;
    const flip = flips.get(it)!;
    const [x, y] = flip ? [it.b, it.a] : [it.a, it.b];
    const [xArm, yArm] = flip ? [it.bArm, it.aArm] : [it.aArm, it.bArm];
    const seed = newSeeds.get(`${it.a.slug}|${it.a.workId}`) ?? "";
    const where = seed.includes("Where the article cites it")
      ? seed.slice(seed.indexOf("Where the article cites it")).split(CITED_WORK_QUESTION)[0]!.trim()
      : "(The article does not cite this work in its body; it appears only in the references or a note.)";
    out.push(
      `---`,
      "",
      `## Pair ${n}`,
      "",
      `**Article**: \`${it.a.slug}\` · **Work**: ${it.a.title}`,
      "",
      where,
      "",
      `### X`,
      "",
      x.text.trim(),
      "",
      `### Y`,
      "",
      y.text.trim(),
      "",
    );
    key.push(`${n}\t${it.kind}\t${it.a.slug}\t${it.a.title}\tX=${xArm}\tY=${yArm}`);
    sides[it.kind] ??= {};
    sides[it.kind]![`${xArm}@X`] = (sides[it.kind]![`${xArm}@X`] ?? 0) + 1;
  });
  fs.writeFileSync(path.join(OUT, "pairs.md"), `${out.join("\n")}\n`);
  fs.writeFileSync(path.join(OUT, "pairs.key.tsv"), `${key.join("\n")}\n`);
  console.log(`${items.length} pairs written. Which arm sat on X:`);
  for (const [kind, s] of Object.entries(sides)) console.log(`  ${kind}: ${JSON.stringify(s)}`);
  const total = (kind: string) => items.filter((it) => it.kind === kind).length;
  for (const [kind, s] of Object.entries(sides)) {
    const most = Math.max(...Object.values(s));
    if (most > Math.ceil(total(kind) / 2)) throw new Error(`${kind} is unbalanced: ${JSON.stringify(s)}`);
  }
}

function tally(): void {
  const key = new Map(
    fs
      .readFileSync(path.join(OUT, "pairs.key.tsv"), "utf-8")
      .trim()
      .split("\n")
      .map((l) => l.split("\t"))
      .map((f) => [Number(f[0]), { kind: f[1]!, slug: f[2]!, title: f[3]!, X: f[4]!.slice(2), Y: f[5]!.slice(2) }]),
  );
  const judged = fs.readFileSync(path.join(OUT, "pairs.judged.txt"), "utf-8");
  const t: Record<string, Record<string, Record<string, number>>> = {};
  const falses: string[] = [];
  for (const line of judged.split("\n")) {
    const m = /^\s*(\d+):\s*use=(\w+);\s*justified=(\w+);\s*false=(.*)$/.exec(line);
    if (!m) continue;
    const k = key.get(Number(m[1]));
    if (!k) continue;
    for (const [q, v] of [
      ["use", m[2]!],
      ["justified", m[3]!],
    ] as const) {
      const who = v === "X" ? k.X : v === "Y" ? k.Y : "same";
      t[k.kind] ??= {};
      t[k.kind]![q] ??= {};
      t[k.kind]![q]![who] = (t[k.kind]![q]![who] ?? 0) + 1;
    }
    const f = m[4]!.trim();
    if (f !== "none") falses.push(`${k.kind} ${k.slug} / ${k.title.slice(0, 40)}: ${f.replace(/\bX\b/, k.X).replace(/\bY\b/, k.Y)}`);
  }
  console.log(JSON.stringify(t, null, 2));
  console.log(falses.length ? `False claims about the article:\n  ${falses.join("\n  ")}` : "No false claims flagged.");
}

if (isMain(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === "list") await list();
    else if (cmd === "show") await show(rest[0] ?? "");
    else if (cmd === "run") {
      const arm = rest[rest.indexOf("--arm") + 1] as Arm;
      if (!ARMS.includes(arm)) throw new Error(`--arm must be one of ${ARMS.join(", ")}`);
      await run(arm);
    } else if (cmd === "pairs") pairs();
    else if (cmd === "tally") tally();
    else throw new Error("usage: list | show <slug> | run --arm old-a|old-b|new | pairs | tally");
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}
