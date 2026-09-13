/**
 * Eval — does a question about a passage reach for the web when it is really a
 * question about the world, and stay off it when it is not?
 *
 *     npx tsx evals/chat-web-reach.ts --label baseline [--runs N]
 *     npx tsx evals/chat-web-reach.ts --list            # slugs in the local database
 *     npx tsx evals/chat-web-reach.ts --show <slug>     # its blocks, to pick a passage
 *
 * **This one spends money** — five real chat turns per article per run, each
 * with the full tool loop and OpenRouter's server web search on, exactly as
 * `streamChat` sends them. docs/plans/260913b-chat-and-comment-questions-reach-for-the-web-and-the-citations-list.md
 * § Stage 1 item 5 is why it exists: Greg asked a "?" turn for "a broader sense
 * of things from the web" and got an answer from the paragraph alone. The model
 * was *offered* the search and declined it, so the thing to measure is how often
 * it takes it, before and after the prompt change.
 *
 * ## The cases
 *
 * Three TARGETS, which ought plausibly to search, and two CONTROLS, which ought
 * not. The controls matter as much as the targets: a prompt that makes every
 * question search is a bigger hammer, not a fix (the *Robert Morris* result in
 * docs/plans/260826l).
 *
 *   help      a "?" press on the passage — built the way ChatDialog builds it
 *   broader   "how does this fit the wider debate?" anchored to the passage
 *   since     "what has happened with this idea since?" anchored to it
 *   plain     "what does this paragraph mean?" — CONTROL, anchored
 *   word      "does the article use the word X?" — CONTROL, no anchor
 *
 * ## What it counts, and what it does not
 *
 * Per answer: web searches (the `done` event's `searches`), the names of our own
 * tools that ran, distinct http(s) links in the text, and distinct block ids it
 * cites. **Counts, not a verdict.** A search that found nothing useful and an
 * answer that ignored it would score the same as a good one, so the first ~300
 * characters are printed and the full text is in the JSON. Results go to
 * `evals/results/chat-web-reach-<label>-<stamp>.json`.
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { loadEnvLocal } from "../src/env.js";
import { converse } from "../src/converse.js";
import { withLedger } from "../src/cli-ledger.js";
import { environmentOwnerId, runAsOwner } from "../src/owner.js";
import { isMain } from "../src/is-main.js";
import { askAboutBlock, HELP_QUESTION } from "../src/web/chat-handoff.js";
import type { Block, ChatAnchor, Meta } from "../src/types.js";

/**
 * The two articles and the passage asked about in each.
 *
 * Picked by hand from the local database (`--list`, `--show`): substantive
 * pieces with named people, studies and a field around them, so a "broader
 * picture" question has somewhere to go. `word` is one the article really uses,
 * so the control has a true answer that needs no search.
 */
const ARTICLES: readonly { slug: string; blockId: string; word: string }[] = [
  /* Anil Seth, "The Mythology Of Conscious AI" — the passage introducing
     Searle's biological naturalism, a live position with a literature around it. */
  { slug: "noema-mythology-of-conscious-ai", blockId: "spya-hj5y6s", word: "Turing" },
  /* Gwern, "The Scaling Hypothesis" (2020) — the paragraph defining the strong
     scaling hypothesis, which six years of models have tested since. */
  { slug: "scaling-hypothesis", blockId: "spya-m3gtj6", word: "cyanobacteria" },
];

type CaseName = "help" | "broader" | "since" | "plain" | "word";

interface Case {
  readonly name: CaseName;
  readonly role: "target" | "control";
  readonly help: boolean;
  readonly anchored: boolean;
  /** What the reader typed; for `help`, the question the "?" sends. */
  readonly typed: (word: string) => string;
}

const CASES: readonly Case[] = [
  { name: "help", role: "target", help: true, anchored: true, typed: () => HELP_QUESTION },
  {
    name: "broader",
    role: "target",
    help: false,
    anchored: true,
    typed: () =>
      "How does this fit into the wider debate in the field? What do other people think about this?",
  },
  {
    name: "since",
    role: "target",
    help: false,
    anchored: true,
    typed: () => "What has happened with this idea since this was written?",
  },
  {
    name: "plain",
    role: "control",
    help: false,
    anchored: true,
    typed: () => "What does this paragraph mean, in plain words?",
  },
  {
    name: "word",
    role: "control",
    help: false,
    anchored: false,
    typed: (word) => `Does the article ever use the word "${word}"?`,
  },
];

interface Outcome {
  run: number;
  slug: string;
  blockId: string;
  case: CaseName;
  role: "target" | "control";
  question: string;
  searches: number;
  tools: string[];
  links: string[];
  blockIds: string[];
  sources: number;
  unknownIds: string[];
  truncated: boolean;
  model: string;
  seconds: number;
  text: string;
  error?: string;
}

/**
 * The message the client sends, mirrored rather than restated.
 *
 * A "?" press quotes the block's own text (`opening` on the draft, ChatDialog.tsx
 * § ask); a typed question on a block anchor quotes nothing, because a
 * `{ blockId }` anchor carries no words. The unanchored control is sent bare,
 * the way a question typed into an unanchored chat is.
 */
function questionFor(c: Case, blockId: string, block: Block, word: string): string {
  const typed = c.typed(word);
  if (!c.anchored) return typed;
  return askAboutBlock({ blockId, ...(c.help ? { quote: block.text } : {}), question: typed });
}

const LINK = /https?:\/\/[^\s)\]>"'`]+/g;
const BLOCK_ID = /\bspya-[a-z0-9]{6}\b/g;

function distinct(text: string, re: RegExp): string[] {
  return [...new Set(text.match(re) ?? [])];
}

async function ask(
  meta: Meta,
  blocks: Block[],
  slug: string,
  question: string,
  anchor: ChatAnchor | null,
  help: boolean,
): Promise<Omit<Outcome, "run" | "slug" | "blockId" | "case" | "role" | "question" | "seconds">> {
  for await (const event of converse({
    meta,
    blocks,
    history: [],
    question,
    slug,
    anchor,
    help,
    kind: "chat",
    useTools: true,
  })) {
    if (event.type !== "done") continue;
    return {
      searches: event.searches,
      tools: event.tools.map((t) => t.name),
      links: distinct(event.text, LINK),
      blockIds: distinct(event.text, BLOCK_ID),
      sources: event.citations.length,
      unknownIds: event.unknownIds,
      truncated: event.truncated,
      model: event.model,
      text: event.text,
    };
  }
  /* A stream that ends without `done` looks exactly like one that finished; say so. */
  throw new Error("converse ended without a done event");
}

function parseArgs(argv: string[]): { label: string; runs: number; list: boolean; show?: string } {
  let label = "unlabelled";
  let runs = 1;
  let list = false;
  let show: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--label") label = argv[++i] ?? label;
    else if (a === "--runs") runs = Number(argv[++i]);
    else if (a === "--list") list = true;
    else if (a === "--show") show = argv[++i];
    else throw new Error(`unknown argument "${a}". Use --label, --runs, --list or --show <slug>.`);
  }
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer");
  return { label, runs, list, ...(show ? { show } : {}) };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  /* Imported here so `--help`-style mistakes fail before a database is touched. */
  const store = await import("../src/store/index.js");
  const owner = environmentOwnerId();

  if (opts.list) {
    const entries = await runAsOwner(owner, () => store.listArticles());
    for (const e of entries) console.log(`${e.slug}\t${e.title}`);
    return;
  }
  if (opts.show) {
    const slug = opts.show;
    const { blocks } = await runAsOwner(owner, () => store.loadArticle(slug));
    for (const b of blocks) {
      if (b.kind === "media") continue;
      console.log(`${b.id}  ${b.kind.padEnd(7)} ${b.words}w  ${b.text.slice(0, 140)}`);
    }
    return;
  }

  for (const a of ARTICLES) {
    if (!a.slug || !a.blockId || !a.word) throw new Error("ARTICLES is not filled in");
  }

  const outcomes: Outcome[] = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  for (let run = 1; run <= opts.runs; run++) {
    for (const a of ARTICLES) {
      const { meta, blocks } = await runAsOwner(owner, () => store.loadArticle(a.slug));
      const block = blocks.find((b) => b.id === a.blockId);
      if (!block) throw new Error(`${a.slug} has no block ${a.blockId}`);
      if (!blocks.some((b) => b.text.toLowerCase().includes(a.word.toLowerCase()))) {
        throw new Error(`${a.slug} never uses "${a.word}", so the control has no true answer`);
      }
      for (const c of CASES) {
        const question = questionFor(c, a.blockId, block, a.word);
        const anchor: ChatAnchor | null = c.anchored ? { blockId: a.blockId } : null;
        const started = performance.now();
        let outcome: Outcome;
        try {
          const got = await runAsOwner(owner, () =>
            ask(meta, blocks, a.slug, question, anchor, c.help),
          );
          outcome = {
            run,
            slug: a.slug,
            blockId: a.blockId,
            case: c.name,
            role: c.role,
            question,
            seconds: Number(((performance.now() - started) / 1000).toFixed(1)),
            ...got,
          };
        } catch (err) {
          outcome = {
            run,
            slug: a.slug,
            blockId: a.blockId,
            case: c.name,
            role: c.role,
            question,
            searches: 0,
            tools: [],
            links: [],
            blockIds: [],
            sources: 0,
            unknownIds: [],
            truncated: false,
            model: "",
            seconds: Number(((performance.now() - started) / 1000).toFixed(1)),
            text: "",
            error: err instanceof Error ? err.message : String(err),
          };
        }
        outcomes.push(outcome);
        const o = outcome;
        console.log(
          `\n[run ${run}] ${a.slug} · ${c.name} (${c.role})${o.error ? " — FAILED: " + o.error : ""}`,
        );
        console.log(
          `  searches=${o.searches} tools=[${o.tools.join(", ")}] links=${o.links.length} blockIds=${o.blockIds.length} sources=${o.sources} ${o.seconds}s${o.truncated ? " TRUNCATED" : ""}`,
        );
        console.log(`  ${o.text.slice(0, 300).replace(/\s+/g, " ")}`);
      }
    }
  }

  console.log("\n## Summary");
  console.log("case     role     searched  mean-searches  mean-links  mean-blockIds");
  for (const c of CASES) {
    const rows = outcomes.filter((o) => o.case === c.name && !o.error);
    const n = rows.length || 1;
    const mean = (f: (o: Outcome) => number) =>
      (rows.reduce((s, o) => s + f(o), 0) / n).toFixed(2);
    console.log(
      `${c.name.padEnd(8)} ${c.role.padEnd(8)} ${rows.filter((o) => o.searches > 0).length}/${rows.length}       ${mean((o) => o.searches).padStart(6)}        ${mean((o) => o.links.length).padStart(6)}      ${mean((o) => o.blockIds.length).padStart(6)}`,
    );
  }

  const out = path.resolve(import.meta.dirname, "results", `chat-web-reach-${opts.label}-${stamp}.json`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(
    out,
    `${JSON.stringify({ label: opts.label, runs: opts.runs, at: new Date().toISOString(), articles: ARTICLES, outcomes }, null, 2)}\n`,
    "utf-8",
  );
  console.log(`\nWritten to ${path.relative(process.cwd(), out)}`);
  if (outcomes.some((o) => o.error)) process.exitCode = 1;
}

if (isMain(import.meta.url)) {
  loadEnvLocal();
  await withLedger("eval", main).catch((err: unknown) => {
    console.error(`\n${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
  /* The Postgres pool would otherwise hold the process open. */
  process.exit(process.exitCode ?? 0);
}
