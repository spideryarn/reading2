/**
 * Eval — does a question about a passage reach for the web when it is really a
 * question about the world, and stay off it when it is not?
 *
 *     npx tsx evals/chat-web-reach.ts --label baseline [--runs N] [--kind learn]
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
 * cites. It also records prose words (command-token lines become buttons and
 * are left out), so the guide's under-60 rule cannot pass invisibly. **Counts,
 * not a verdict.** A search that found nothing useful and an
 * answer that ignored it would score the same as a good one, so the first ~300
 * characters are printed and the full text is in the JSON. Results go to
 * `evals/results/chat-web-reach-<label>-<stamp>.json`.
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { loadEnvLocal } from "../src/env.js";
import { converse, jobFor } from "../src/converse.js";
import { runTool } from "../src/chat-tools.js";
import { withLedger } from "../src/cli-ledger.js";
import { environmentOwnerId, runAsOwner } from "../src/owner.js";
import { isMain } from "../src/is-main.js";
import { HELP_QUESTION } from "../src/web/chat-handoff.js";
import { askAboutBlock } from "../src/chat-question.js";
import { collectSpend, totalSpend } from "../src/ai-spend.js";
import { costStore } from "../src/store/ai-calls.js";
import { renderProfile } from "../src/profile.js";
import type { Block, ChatAnchor, Meta } from "../src/types.js";

/**
 * The two articles and the passage asked about in each.
 *
 * Picked by hand from the local database (`--list`, `--show`): substantive
 * pieces with named people, studies and a field around them, so a "broader
 * picture" question has somewhere to go. `word` is one the article really uses,
 * so the control has a true answer that needs no search.
 */
const ARTICLES: readonly { slug: string; blockId: string; word: string; page: string }[] = [
  /* Anil Seth, "The Mythology Of Conscious AI" — the passage introducing
     Searle's biological naturalism, a live position with a literature around it.
     `page` is for the `url` case: a page a reader might hand over. */
  {
    slug: "noema-mythology-of-conscious-ai",
    blockId: "spya-hj5y6s",
    word: "Turing",
    page: "https://en.wikipedia.org/wiki/Biological_naturalism",
  },
  /* Gwern, "The Scaling Hypothesis" (2020) — the paragraph defining the strong
     scaling hypothesis, which six years of models have tested since. */
  {
    slug: "scaling-hypothesis",
    blockId: "spya-m3gtj6",
    word: "cyanobacteria",
    page: "https://en.wikipedia.org/wiki/Neural_scaling_law",
  },
];

type CaseName =
  | "help" | "broader" | "since" | "plain" | "word" | "situate" | "url" | "remember"
  | "reception" | "alongside" | "author" | "given";

interface Case {
  readonly name: CaseName;
  readonly role: "target" | "control";
  readonly help: boolean;
  readonly anchored: boolean;
  /** What the reader typed; for `help`, the question the "?" sends. */
  readonly typed: (word: string, page: string) => string;
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

/**
 * **The cases for every kind but Chat** — Learn's Recall (`learn`), Tutorial (until
 * it was folded into Recall, 2026-10-20), Explore and the guide. Added by
 * docs/plans/261011t-web-search-in-every-chat-kind-and-reading-a-given-address.md
 * after Greg's `spya-drbkvc`: a reader in a Learn sub-mode asked how the piece
 * sat among others, and it would not search. None is anchored and none is a
 * "?" press, because those are Chat's; each is something a reader could say in
 * that conversation.
 *
 *   situate   where the piece sits among other work — TARGET
 *   since     what has happened with the idea since — TARGET
 *   url       a page the reader hands over — TARGET for `read_web_page`
 *   remember  a half-memory of the piece — CONTROL, the mode's own job
 *   word      does the article use the word X — CONTROL
 */
const OTHER_KIND_CASES: readonly Case[] = [
  {
    name: "situate",
    role: "target",
    help: false,
    anchored: false,
    typed: () =>
      "How does this piece compare with other things written on the same question? Where does it sit?",
  },
  {
    name: "since",
    role: "target",
    help: false,
    anchored: false,
    typed: () => "What has happened with this idea since this was written?",
  },
  {
    name: "url",
    role: "target",
    help: false,
    anchored: false,
    typed: (_word, page) => `I found this page: ${page} How does what it says relate to this piece?`,
  },
  {
    name: "remember",
    role: "control",
    help: false,
    anchored: false,
    typed: () =>
      "What I remember is that the author argues against one popular view, but I can't remember quite which, or why.",
  },
  {
    name: "word",
    role: "control",
    help: false,
    anchored: false,
    typed: (word) => `Does the article ever use the word "${word}"?`,
  },
];

/**
 * **The guide's cases**, since it searches through `search_web` (plan 261012g).
 * The guide is about how to read the piece, and plan 261012f sends a question
 * about what the piece says to Chat. So its targets are the questions about
 * *how to read it* that the web answers, and `since` — what the world has said
 * on the subject — is a control here: it belongs to Chat.
 *
 *   reception  is it well regarded, contested, superseded — TARGET
 *   alongside  what to read before or with it — TARGET
 *   author     who wrote it, and how far to trust them on this — TARGET
 *   given      a page the reader hands over, worth reading alongside? — TARGET
 *              for `read_web_page`, which the typed guide has since plan
 *              261017e § Stage 2 (2B); before it, the guide could only search
 *   since      what has happened with the idea since — CONTROL (Chat's)
 *   word       does the article use the word X — CONTROL
 */
const GUIDE_CASES: readonly Case[] = [
  {
    name: "reception",
    role: "target",
    help: false,
    anchored: false,
    typed: () => "Before I put time into this: is it well regarded? Has it been criticised or superseded?",
  },
  {
    name: "alongside",
    role: "target",
    help: false,
    anchored: false,
    typed: () => "What should I read before or alongside this to get the most out of it?",
  },
  {
    name: "author",
    role: "target",
    help: false,
    anchored: false,
    typed: () => "Who is the author, and how far should I trust them on this subject?",
  },
  {
    name: "given",
    role: "target",
    help: false,
    anchored: false,
    typed: (_word, page) => `I found this page: ${page} Is it worth reading alongside this piece?`,
  },
  { ...OTHER_KIND_CASES.find((c) => c.name === "since")!, role: "control" },
  OTHER_KIND_CASES.find((c) => c.name === "word")!,
];

/* The kinds a reader converses in; Candidates is Referee's and has its own eval. */
const KINDS = ["chat", "learn", "explore", "guide"] as const;
type EvalKind = (typeof KINDS)[number];
const casesFor = (kind: EvalKind): readonly Case[] =>
  kind === "chat" ? CASES : kind === "guide" ? GUIDE_CASES : OTHER_KIND_CASES;

/** A search by either route: OpenRouter's inside the reply, or our `search_web` (plan 261012g). */
const searched = (o: { searches: number; tools: string[] }) => o.searches > 0 || o.tools.includes("search_web");

/** The 261011t failure: an answer that says it has not looked anything up. */
const SAID_UNSEARCHED =
  /haven't looked|have not looked|can't search|cannot search|can't look|cannot look|not able to (search|look)|unable to (search|look)/i;

/* A neutral reason, so the guide does not spend its first turn asking for one
   (GUIDE_SYSTEM: "If they still have not said why they are reading it, ask that
   first"). The same for every non-Chat kind, so it favours none of them. The
   guide also gets what the route gives it (`streamChat`, src/routes.ts): the
   saved fields its offers compare against, and an experience bucket — GPT Sol's
   F3 on the plan, so the guide's numbers measure searching and not a turn spent
   asking. */
const PURPOSE = "Reading it for a reading group next week.";
const PROFILE = renderProfile({ purpose: PURPOSE });

interface Outcome {
  kind: EvalKind;
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
  words: number;
  text: string;
  /* Since plan 261017e § Stage 2 (GPT Sol's F3 on it): what a read cost and
     where it went, the next steps offered, and the turn's spend. Absent in
     results written before. */
  reads?: { requestedUrl: string | null; fetched: boolean; label: string; ms: number | null; detail: string }[];
  stepKinds?: string[];
  inputTokens?: number | null;
  dollars?: number;
  rounds?: number;
  modelCalls?: number;
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
function questionFor(c: Case, blockId: string, block: Block, word: string, page: string): string {
  const typed = c.typed(word, page);
  if (!c.anchored) return typed;
  return askAboutBlock({ blockId, ...(c.help ? { quote: block.text } : {}), question: typed });
}

const LINK = /https?:\/\/[^\s)\]>"'`]+/g;
const BLOCK_ID = /\bspya-[a-z0-9]{6}\b/g;
const COMMAND_LINE = /^\s*\[cmd:[^\]]+\]\s*$/gm;

function distinct(text: string, re: RegExp): string[] {
  return [...new Set(text.match(re) ?? [])];
}

function proseWords(text: string): number {
  const prose = text.replace(COMMAND_LINE, "").trim();
  return prose === "" ? 0 : prose.split(/\s+/).length;
}

async function ask(
  meta: Meta,
  blocks: Block[],
  slug: string,
  question: string,
  anchor: ChatAnchor | null,
  help: boolean,
  kind: EvalKind,
): Promise<Omit<Outcome, "kind" | "run" | "slug" | "blockId" | "case" | "role" | "question" | "seconds">> {
  const readRequests: { requestedUrl: string | null; fetched: boolean }[] = [];
  for await (const event of converse({ power: "standard",
    meta,
    blocks,
    history: [],
    question,
    slug,
    anchor,
    help,
    kind,
    /* Chat's cases ran with no profile before `--kind` existed; keep their bytes. */
    profile: kind === "chat" ? null : PROFILE,
    ...(kind === "guide" && {
      saved: { purpose: PURPOSE, profile: null },
      experience: "a-few" as const,
    }),
    runToolWith: async (name, args, ctx) => {
      const outcome = await runTool(name, args, ctx);
      if (name === "read_web_page") {
        readRequests.push({
          requestedUrl: typeof args.url === "string" ? args.url : null,
          fetched: outcome.content.startsWith("<<<UNTRUSTED WEB PAGE"),
        });
      }
      return outcome;
    },
    useTools: true,
  })) {
    if (event.type !== "done") continue;
    return {
      searches: event.searches,
      tools: event.tools.map((t) => t.name),
      reads: event.tools
        .filter((t) => t.name === "read_web_page")
        .map((t, i) => ({
          requestedUrl: readRequests[i]?.requestedUrl ?? null,
          fetched: readRequests[i]?.fetched ?? false,
          label: t.label,
          ms: t.ms ?? null,
          detail: t.detail ?? "",
        })),
      stepKinds: event.tools.flatMap((t) => (t.steps ?? []).map((st) => st.kind)),
      inputTokens: event.usage.inputTokens,
      links: distinct(event.text, LINK),
      blockIds: distinct(event.text, BLOCK_ID),
      sources: event.citations.length,
      unknownIds: event.unknownIds,
      truncated: event.truncated,
      model: event.model,
      words: proseWords(event.text),
      text: event.text,
    };
  }
  /* A stream that ends without `done` looks exactly like one that finished; say so. */
  throw new Error("converse ended without a done event");
}

function parseArgs(argv: string[]): {
  label: string;
  runs: number;
  kind: EvalKind;
  list: boolean;
  show?: string;
} {
  let label = "unlabelled";
  let kind: EvalKind = "chat";
  let runs = 1;
  let list = false;
  let show: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--label") label = argv[++i] ?? label;
    else if (a === "--runs") runs = Number(argv[++i]);
    else if (a === "--kind") {
      const k = argv[++i];
      if (!(KINDS as readonly string[]).includes(k ?? "")) {
        throw new Error(`--kind must be one of ${KINDS.join(", ")}`);
      }
      kind = k as EvalKind;
    } else if (a === "--list") list = true;
    else if (a === "--show") show = argv[++i];
    else throw new Error(`unknown argument "${a}". Use --label, --runs, --kind, --list or --show <slug>.`);
  }
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer");
  return { label, runs, kind, list, ...(show ? { show } : {}) };
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
      for (const c of casesFor(opts.kind)) {
        const question = questionFor(c, a.blockId, block, a.word, a.page);
        const anchor: ChatAnchor | null = c.anchored ? { blockId: a.blockId } : null;
        const started = performance.now();
        let outcome: Outcome;
        try {
          /* Its own collector, so each turn has its dollars; the sink keeps
             the ledger rows the outer `withLedger` would otherwise have
             written (an inner collector shadows the outer, src/ai-spend.ts). */
          const { result: got, report } = await collectSpend(
            () => runAsOwner(owner, () => ask(meta, blocks, a.slug, question, anchor, c.help, opts.kind)),
            { attribution: { scopeKind: "eval", ownerId: owner }, sink: (row) => costStore.record(row) },
          );
          got.dollars = Number((totalSpend(report.calls).nanos / 1e9).toFixed(5));
          got.rounds = report.calls.filter((call) => call.job === jobFor(opts.kind)).length;
          got.modelCalls = report.calls.length;
          outcome = {
            kind: opts.kind,
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
            kind: opts.kind,
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
            words: 0,
            text: "",
            error: err instanceof Error ? err.message : String(err),
          };
        }
        outcomes.push(outcome);
        const o = outcome;
        console.log(
          `\n[run ${run}] ${opts.kind} · ${a.slug} · ${c.name} (${c.role})${o.error ? ` — FAILED: ${o.error}` : ""}`,
        );
        console.log(
          `  searches=${o.searches} tools=[${o.tools.join(", ")}] links=${o.links.length} blockIds=${o.blockIds.length} sources=${o.sources} words=${o.words} ${o.seconds}s${o.truncated ? " TRUNCATED" : ""}`,
        );
        console.log(`  ${o.text.slice(0, 300).replace(/\s+/g, " ")}`);
      }
    }
  }

  console.log(`\n## Summary (${opts.kind})`);
  console.log("case     role     searched  read-page  said-unsearched  over-60  mean-searches  mean-links  mean-blockIds  mean-words  mean-seconds  rounds  calls  chat-step  mean-$");
  for (const c of casesFor(opts.kind)) {
    const rows = outcomes.filter((o) => o.case === c.name && !o.error);
    const n = rows.length || 1;
    const mean = (f: (o: Outcome) => number) =>
      (rows.reduce((s, o) => s + f(o), 0) / n).toFixed(2);
    console.log(
      `${c.name.padEnd(8)} ${c.role.padEnd(8)} ${rows.filter(searched).length}/${rows.length}       ${rows.filter((o) => o.reads?.some((read) => read.fetched)).length}/${rows.length}        ${rows.filter((o) => searched(o) && SAID_UNSEARCHED.test(o.text)).length}/${rows.length}            ${rows.filter((o) => o.words > 60).length}/${rows.length}      ${mean((o) => o.searches).padStart(6)}        ${mean((o) => o.links.length).padStart(6)}      ${mean((o) => o.blockIds.length).padStart(6)}      ${mean((o) => o.words).padStart(6)}      ${mean((o) => o.seconds).padStart(6)}  ${mean((o) => o.rounds ?? 0).padStart(6)} ${mean((o) => o.modelCalls ?? 0).padStart(6)}      ${rows.filter((o) => o.stepKinds?.includes("chat")).length}/${rows.length}      ${(rows.reduce((t, o) => t + (o.dollars ?? 0), 0) / n).toFixed(4)}`,
    );
  }

  const out = path.resolve(import.meta.dirname, "results", `chat-web-reach-${opts.kind}-${opts.label}-${stamp}.json`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(
    out,
    `${JSON.stringify({ label: opts.label, kind: opts.kind, runs: opts.runs, at: new Date().toISOString(), articles: ARTICLES, outcomes }, null, 2)}\n`,
    "utf-8",
  );
  console.log(`\nWritten to ${path.relative(process.cwd(), out)}`);
  /* The ledger's own total below reads zero: each turn had its own collector. */
  console.log(`Spent: $${outcomes.reduce((t, o) => t + (o.dollars ?? 0), 0).toFixed(4)} over ${outcomes.length} turns`);
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
