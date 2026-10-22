/**
 * **Is the guide easy to follow, does it stop asking, and does it do the work
 * for the reader?** — the paid check behind plan
 * docs/plans/261019p-guide-chat-plainer.md (Greg's reports `spya-p4uqye`,
 * `spya-ptjk63`, `spya-yt2v73`).
 *
 *     npx tsx evals/guide/conversations.ts --label before --runs 2   # PAID, about $1
 *     npx tsx evals/guide/conversations.ts --rescore before         # free
 *     npx tsx evals/guide/conversations.ts --pairs before,after     # free: blind pairs for a judge
 *
 * Production's own `converse`, kind `guide`, tools **on**, `offer_to_save` and
 * `offer_next_steps` answered by the real `runTool` (neither touches a store)
 * and every other tool with "nothing found", as evals/guide/next-steps.ts
 * does. **Multi-turn where it matters**: a case may carry a short history,
 * because nagging is a property of the second turn, not the first.
 *
 * The screens below are crude and only screens (docs/project/prompting-guide.md
 * § Measuring a prompt change). The verdict is a blind judge over `--pairs`.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { collectSpend, totalSpend } from "../../src/ai-spend.js";
import { runTool } from "../../src/chat-tools.js";
import { citedBlockIds, converse } from "../../src/converse.js";
import { loadEnvLocal } from "../../src/env.js";
import type { GuideExperience } from "../../src/guide.js";
import { environmentOwnerId } from "../../src/owner.js";
import { renderProfile } from "../../src/profile.js";
import { costStore } from "../../src/store/ai-calls.js";
import type { Block, ChatMessage, Meta, NextStep, ToolRun } from "../../src/types.js";
import { blindCoin } from "../plain-words/run.js";

const CORPUS = path.join(import.meta.dirname, "..", "..", "tests", "fixtures", "data-root", "data");
const RESULTS = path.join(import.meta.dirname, "results");

/* ------------------------------------------------------------------ cases -- */

export interface Case {
  readonly id: string;
  readonly dir: string;
  readonly experience: GuideExperience;
  readonly about: string | null;
  readonly why: string | null;
  /** Earlier turns, reader first. */
  readonly history: readonly string[];
  readonly question: string;
  /** What this case is checking, for the judge and the screens. */
  readonly wants: readonly Want[];
}

export type Want =
  | "no-why" // asks nothing about why they are reading
  | "no-about" // asks nothing about the reader themselves
  | "cited" // points at a place in the piece
  | "chat-step" // offers Ask in Chat
  | "summary-mode" // points at Summary
  | "no-summary" // does not summarise the piece
  | "brief-answer" // no more than the promised three sentences
  | "cites-each" // every substantive answer sentence carries a block id
  | "ends-on-passage" // the last sentence sends the reader to a passage
  | "answers"; // answers a question about the piece rather than declining

const SETH = "noema-mythology-of-conscious-ai";
const AGENTS = "openai-huggingface";

/** A typical first reply from the guide before plan 261019p, for the second-turn cases. */
const ASKED_WHY =
  "Welcome! Before I suggest a way in: what brings you to this piece? Are you reading it for work, for a course, or out of curiosity?";

const CASES: readonly Case[] = [
  { id: "new-hi", dir: SETH, experience: "none", about: null, why: null, history: [], question: "hi", wants: ["no-about"] },
  {
    id: "new-start",
    dir: SETH,
    experience: "none",
    about: null,
    why: null,
    history: [],
    question: "Where should I start?",
    wants: ["no-about", "cited"],
  },
  {
    id: "new-about",
    dir: SETH,
    experience: "none",
    about: null,
    why: null,
    history: [],
    question: "What is this piece about?",
    wants: ["no-about", "summary-mode", "no-summary", "answers"],
  },
  {
    id: "vague",
    dir: SETH,
    experience: "a-few",
    about: null,
    why: null,
    history: [],
    question: "A friend sent it to me",
    wants: ["no-about", "cited"],
  },
  {
    id: "vague-2nd",
    dir: SETH,
    experience: "a-few",
    about: null,
    why: null,
    history: ["Where should I start?", ASKED_WHY],
    question: "just curious really",
    wants: ["no-why", "no-about", "cited"],
  },
  {
    id: "work-out",
    dir: AGENTS,
    experience: "a-few",
    about: null,
    why: null,
    history: [],
    question: "Help me work out what I want from this",
    wants: ["no-about"],
  },
  {
    id: "not-read",
    dir: AGENTS,
    experience: "a-few",
    about: null,
    why: "Curious what actually happened in these experiments.",
    history: [],
    question: "I haven't read it yet. How should I go about it?",
    wants: ["no-why", "no-about", "cited"],
  },
  {
    id: "content",
    dir: SETH,
    experience: "a-few",
    about: null,
    why: "A friend sent it to me; I want to know whether I agree that AI can't be conscious.",
    history: [],
    question: "What does he mean by 'simulation is not instantiation'?",
    wants: ["no-why", "no-about", "cited", "chat-step", "answers", "brief-answer", "cites-each", "ends-on-passage"],
  },
  {
    id: "content-new",
    dir: AGENTS,
    experience: "none",
    about: null,
    why: null,
    history: [],
    question: "So did the agent societies actually collapse because of the models, or because of how they were set up?",
    wants: ["no-about", "cited", "chat-step", "answers", "brief-answer", "cites-each", "ends-on-passage"],
  },
  {
    id: "chat-words",
    dir: SETH,
    experience: "a-few",
    about: "Software engineer, no background in neuroscience.",
    why: "Curious whether the argument holds up.",
    history: [],
    question:
      "ok but if the brain is just doing prediction, why couldnt a big enough transformer do the exact same prediction and be conscious too?",
    wants: ["no-why", "no-about", "cited", "chat-step", "answers", "brief-answer", "cites-each", "ends-on-passage"],
  },
  {
    id: "expert",
    dir: SETH,
    experience: "a-few",
    about: "Computational neuroscientist. I work on predictive processing and interoception.",
    why: "I want to check how he gets from the brain being a prediction machine to AI not being conscious: the steps of the argument, not the overview.",
    history: [],
    question: "Where should I start?",
    wants: ["no-why", "no-about", "cited"],
  },
];

/* ---------------------------------------------------------------- screens -- */

const ASKS_WHY =
  /\b(why are you|what brings you|what(?:'s|’s| is) bringing you|what (?:are|were) you hoping|what(?:'s|’s| is) your reason|what are you (?:after|looking for)|reason for reading|why you(?:'re|’re| are) reading|what do you want (?:from|out of))\b/i;
const ASKS_ABOUT =
  /\b(about yourself|about you\b|your background|what do you do|your field|how much do you (?:already )?know|are you (?:a|an) |your work)\b/i;
/** The guide declining a question about the piece, as 261012f had it. */
const REFUSES = /\b(this conversation is (?:for|about) how to read|better asked in Chat|best taken to Chat)\b/i;
const RESTATES =
  /\b(?:he|she|they|seth|patel|the author|the piece|the essay|the article|it)\s+(?:argues|claims|concludes|contends|shows|says that|describes how)\b/gi;

function prose(answer: string): string {
  return answer.replace(/\[cmd:[^\]]*\]/g, " ").replace(/\[spya-[^\]]*\]/g, " ");
}
function words(text: string): number {
  return prose(text).split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}
function sentences(text: string): string[] {
  return text
    .replace(/\[cmd:[^\]]*\]/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function questions(text: string): string[] {
  return sentences(text).filter((s) => s.endsWith("?"));
}
const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9' ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
/** Share of the chat step's words that are the reader's own. */
function closeness(step: string, question: string): number {
  const s = tokens(step);
  const q = tokens(question);
  if (s.size === 0) return 0;
  let kept = 0;
  for (const w of s) if (q.has(w)) kept++;
  return +(kept / s.size).toFixed(2);
}

interface Screen {
  readonly words: number;
  readonly questions: number;
  readonly asksWhy: boolean;
  readonly asksAbout: boolean;
  readonly refuses: boolean;
  readonly cited: number;
  readonly restates: number;
  readonly steps: NextStep[];
  readonly chatStep: string | null;
  readonly chatCloseness: number | null;
  readonly summaryMode: boolean;
  readonly problems: string[];
}

function wantedProblem(
  want: Want,
  measured: Omit<Screen, "problems">,
  answerSentences: readonly string[],
  uncitedAnswerSentences: readonly string[],
  lastSentence: string,
): string | null {
  switch (want) {
    case "no-why":
      return measured.asksWhy ? "asked why" : null;
    case "no-about":
      return measured.asksAbout ? "asked about them" : null;
    case "cited":
      return measured.cited === 0 ? "nothing cited" : null;
    case "chat-step":
      return measured.chatStep === null ? "no chat step" : null;
    case "answers":
      return measured.refuses ? "declined to answer" : null;
    case "summary-mode":
      return measured.summaryMode ? null : "no Summary";
    case "no-summary":
      return measured.restates > 1 ? `restates ×${measured.restates}` : null;
    case "brief-answer":
      return answerSentences.length > 3 ? `${answerSentences.length} answer sentences` : null;
    case "cites-each":
      return uncitedAnswerSentences.length > 0
        ? `${uncitedAnswerSentences.length} uncited answer sentence${uncitedAnswerSentences.length === 1 ? "" : "s"}`
        : null;
    case "ends-on-passage":
      return /\b(?:read|start|see|passage|paragraph|section)\b/i.test(lastSentence) ? null : "does not end on a passage";
  }
}

export function screen(c: Case, answer: string, steps: NextStep[], blocks: Block[]): Screen {
  const asked = questions(answer);
  const answerSentences = sentences(answer);
  const knownIds = new Set(blocks.map((b) => b.id));
  const uncitedAnswerSentences = answerSentences.filter((sentence) => citedBlockIds(sentence, knownIds).length === 0);
  const lastSentence = answerSentences.at(-1) ?? "";
  const chat = steps.find((s) => s.kind === "chat");
  const chatStep = chat && "words" in chat ? chat.words : null;
  const s = {
    words: words(answer),
    questions: asked.length,
    asksWhy: asked.some((q) => ASKS_WHY.test(q)),
    /* The whole reply, not only its questions: "tell me a little about yourself too" is the nag. */
    asksAbout: ASKS_ABOUT.test(prose(answer)),
    refuses: REFUSES.test(prose(answer)),
    cited: citedBlockIds(answer, knownIds).length,
    restates: (prose(answer).match(RESTATES) ?? []).length,
    steps,
    chatStep,
    chatCloseness: chatStep === null ? null : closeness(chatStep, c.question),
    summaryMode:
      /\bSummary\b/.test(prose(answer)) ||
      /summary/.test(answer.match(/\[cmd:mode:[^\]]*\]/g)?.join(" ") ?? "") ||
      steps.some((x) => x.kind === "mode" && x.mode.includes("summary")),
  };
  const problems: string[] = [];
  if (s.words > 60) problems.push(`long (${s.words})`);
  if (s.questions > 1) problems.push(`${s.questions} questions`);
  for (const w of c.wants) {
    const problem = wantedProblem(w, s, answerSentences, uncitedAnswerSentences, lastSentence);
    if (problem !== null) problems.push(problem);
  }
  return { ...s, problems };
}

/* ------------------------------------------------------------------- runs -- */

interface Row extends Screen {
  readonly case: string;
  readonly run: number;
  readonly answer: string;
  readonly dollars: number;
}

function load(dir: string): { meta: Meta; blocks: Block[] } {
  const meta = JSON.parse(fs.readFileSync(path.join(CORPUS, dir, "meta.json"), "utf8")) as Meta;
  const { blocks } = JSON.parse(fs.readFileSync(path.join(CORPUS, dir, "blocks.json"), "utf8")) as { blocks: Block[] };
  return { meta, blocks };
}

function historyOf(turns: readonly string[]): ChatMessage[] {
  return turns.map((text, i) => ({
    id: `h${i}`,
    role: i % 2 === 0 ? "user" : "assistant",
    text,
    createdAt: new Date(Date.UTC(2026, 9, 19, 12, i)).toISOString(),
    status: "done",
  }));
}

async function ask(c: Case): Promise<{ text: string; tools: ToolRun[]; dollars: number }> {
  const { meta, blocks } = load(c.dir);
  const { result, report } = await collectSpend(
    async () => {
      let text = "";
      let tools: ToolRun[] = [];
      for await (const e of converse({
        power: "standard",
        meta,
        blocks,
        history: historyOf(c.history),
        question: c.question,
        slug: meta.slug,
        kind: "guide",
        profile: renderProfile({ profile: c.about, purpose: c.why }),
        experience: c.experience,
        saved: { purpose: c.why, profile: c.about },
        typed: c.question,
        runToolWith: async (name, args, ctx) =>
          name === "offer_to_save" || name === "offer_next_steps"
            ? runTool(name, args, ctx)
            : { label: name, detail: "nothing found", content: "Nothing found. This is a complete answer, not an error." },
      })) {
        if (e.type === "done") {
          text = e.text;
          tools = e.tools ?? [];
        }
      }
      return { text, tools };
    },
    { attribution: { scopeKind: "eval", ownerId: environmentOwnerId() }, sink: (row) => costStore.record(row) },
  );
  return { ...result, dollars: totalSpend(report.calls).nanos / 1e9 };
}

function stepsOf(tools: readonly ToolRun[]): NextStep[] {
  return tools.filter((t) => t.name === "offer_next_steps").at(-1)?.steps ?? [];
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : +(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2).toFixed(12);
}

function summarise(rows: readonly Row[]) {
  const closeness = rows.map((r) => r.chatCloseness).filter((x): x is number => x !== null);
  return {
    n: rows.length,
    clean: rows.filter((r) => r.problems.length === 0).length,
    medianWords: median(rows.map((r) => r.words)),
    questions: rows.reduce((n, r) => n + r.questions, 0),
    asksWhy: rows.filter((r) => r.asksWhy).length,
    asksAbout: rows.filter((r) => r.asksAbout).length,
    refuses: rows.filter((r) => r.refuses).length,
    cited: rows.filter((r) => r.cited > 0).length,
    chatSteps: rows.filter((r) => r.chatStep !== null).length,
    medianChatCloseness: median(closeness),
    problems: Object.fromEntries(
      [...new Set(rows.flatMap((r) => r.problems.map((p) => p.replace(/ \(.*|\d+ |×\d+/g, ""))))].map((p) => [
        p,
        rows.filter((r) => r.problems.some((x) => x.replace(/ \(.*|\d+ |×\d+/g, "") === p)).length,
      ]),
    ),
    dollars: +rows.reduce((n, r) => n + r.dollars, 0).toFixed(3),
  };
}

interface Pairable {
  readonly case: string;
  readonly run: number;
}

const pairKey = (row: Pairable): string => `${row.case}\u0000${row.run}`;

/** Match complete, unique cohorts. An eval comparison must never silently become their intersection. */
export function pairRows<A extends Pairable, B extends Pairable>(a: readonly A[], b: readonly B[]): Array<readonly [A, B]> {
  if (a.length === 0 || b.length === 0) throw new Error("cannot pair empty eval arms");
  const index = <T extends Pairable>(rows: readonly T[], arm: string): Map<string, T> => {
    const found = new Map<string, T>();
    for (const row of rows) {
      const key = pairKey(row);
      if (found.has(key)) throw new Error(`duplicate ${arm} row: ${row.case} run ${row.run}`);
      found.set(key, row);
    }
    return found;
  };
  const left = index(a, "first-arm");
  const right = index(b, "second-arm");
  for (const row of a) {
    if (!right.has(pairKey(row))) throw new Error(`missing from second arm: ${row.case} run ${row.run}`);
  }
  for (const row of b) {
    if (!left.has(pairKey(row))) throw new Error(`missing from first arm: ${row.case} run ${row.run}`);
  }
  return a.map((row) => [row, right.get(pairKey(row)) as B] as const);
}

/** The complete passages cited by one answer, for the blind judge's factuality check. */
export function citedPassages(answer: string, blocks: readonly Block[]): string[] {
  const byId = new Map(blocks.map((block) => [block.id, block.text]));
  return citedBlockIds(answer, new Set(byId.keys())).map((id) => `- [${id}] ${(byId.get(id) ?? "").replace(/\s+/g, " ")}`);
}

/* ------------------------------------------------------------ blind pairs -- */

/**
 * A pairs file for a judge in a fresh subagent, and its key in a file of its
 * own: each case and run of `a` against the same case and run of `b`, the
 * sides chosen by `blindCoin` (prompting-guide.md § Measuring, step 4).
 */
function pairs(a: string, b: string, seed: number): void {
  const read = (label: string) =>
    (JSON.parse(fs.readFileSync(path.join(RESULTS, `conversations-${label}.json`), "utf8")) as { rows: Row[] }).rows;
  const ra = read(a);
  const rb = read(b);
  const coin = blindCoin(seed);
  const out: string[] = [
    `# Blind pairs`,
    "",
    "Each pair is two replies from a reading guide inside an app called Spideryarn, to the same reader in the same",
    "situation. The guide's job: help someone read one article well (where to start, what to read closely, which of",
    "the app's views would help), and not read it for them. Buttons it offers appear under the reply.",
    "",
    "For each pair answer: `n: X|Y|same; why: <a few words>; problem: none|X …|Y …`.",
    "- Which reply would a reader who is new to the app find more useful, less work and easier to follow, while still",
    "  being sent into the piece itself rather than having it read for them?",
    "- problem: does either one nag (ask for something the reader already gave, or ask about the reader themselves),",
    "  answer at length in place of reading, or say something the article plainly does not?",
    "",
  ];
  const key: string[] = [];
  let n = 0;
  for (const [x, y] of pairRows(ra, rb)) {
    const c = CASES.find((k) => k.id === x.case);
    if (!c) throw new Error(`unknown case in paired results: ${x.case}`);
    n++;
    const flip = coin();
    const [left, right] = flip ? [y, x] : [x, y];
    key.push(`${n}: X=${flip ? b : a} Y=${flip ? a : b} (${x.case} run ${x.run})`);
    /* The passages each reply cites, so a judge reading only this file can
       tell a supported sentence from an invented one (GPT Sol's F5). */
    const { blocks } = load(c.dir);
    const show = (r: Row) => {
      const cited = citedPassages(r.answer, blocks);
      return [
        r.answer.trim(),
        "",
        `Buttons under it: ${
          r.steps
            .map((s) => ("words" in s ? `${s.kind} "${s.words}"` : s.kind === "mode" ? `open ${s.mode}` : s.kind))
            .join(" · ") || "none"
        }`,
        ...(cited.length > 0 ? ["", "Passages it cites:", ...cited] : []),
      ].join("\n");
    };
    out.push(
      `## Pair ${n}`,
      "",
      `Reader: ${c.experience === "none" ? "first article in the app" : "has used the app a little"}; ` +
        `why reading: ${c.why ?? "not said"}; about them: ${c.about ?? "not said"}.`,
      ...(c.history.length > 0
        ? ["Earlier:", ...c.history.map((t, i) => `> ${i % 2 === 0 ? "Reader" : "Guide"}: ${t}`)]
        : []),
      `Reader now: "${c.question}"`,
      "",
      "### X",
      "",
      show(left),
      "",
      "### Y",
      "",
      show(right),
      "",
    );
  }
  const onX = key.filter((k) => k.includes(`X=${a} `)).length;
  if (Math.abs(onX - (n - onX)) > 1) {
    throw new Error(`unbalanced key: ${a} is on X ${onX} times and Y ${n - onX} times; choose another --seed`);
  }
  fs.writeFileSync(path.join(RESULTS, `conversations-pairs-${a}-${b}.md`), `${out.join("\n")}\n`);
  fs.writeFileSync(path.join(RESULTS, `conversations-key-${a}-${b}.txt`), `${key.join("\n")}\n`);
  console.log(`${n} pairs; ${a} on side X in ${onX}, on side Y in ${n - onX}`);
}

/* ------------------------------------------------------------------- main -- */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Every source file changed by plan 261019p that contributes model-visible instructions. */
export function sourceSha256(): { converse: string; chatTools: string } {
  const sha = (file: string) =>
    createHash("sha256").update(fs.readFileSync(path.join(import.meta.dirname, "..", "..", "src", file))).digest("hex");
  return { converse: sha("converse.ts"), chatTools: sha("chat-tools.ts") };
}

async function main(): Promise<void> {
  const pairArg = arg("pairs");
  if (pairArg) {
    const [a, b] = pairArg.split(",");
    if (!a || !b) throw new Error("--pairs a,b");
    pairs(a, b, Number(arg("seed") ?? "1"));
    return;
  }
  const rescore = arg("rescore");
  if (rescore) {
    const file = path.join(RESULTS, `conversations-${rescore}.json`);
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as { rows: Row[] } & Record<string, unknown>;
    const rows = saved.rows.map((r) => {
      const c = CASES.find((k) => k.id === r.case);
      if (!c) throw new Error(`no case ${r.case}`);
      return { ...r, ...screen(c, r.answer, r.steps, load(c.dir).blocks) };
    });
    const summary = summarise(rows);
    fs.writeFileSync(file, `${JSON.stringify({ ...saved, summary, rows }, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  const label = arg("label");
  if (!label) throw new Error("usage: --label <name> [--runs 2] [--only a,b] | --rescore <label> | --pairs a,b");
  const runs = Number(arg("runs") ?? "2");
  const only = (arg("only") ?? "").split(",").filter(Boolean);
  const out = path.join(RESULTS, `conversations-${label}.json`);
  if (fs.existsSync(out)) throw new Error(`refusing to overwrite ${out}`);
  loadEnvLocal();
  const rows: Row[] = [];
  for (let run = 1; run <= runs; run++) {
    for (const c of CASES.filter((k) => only.length === 0 || only.includes(k.id))) {
      const got = await ask(c);
      const steps = stepsOf(got.tools);
      const row: Row = {
        case: c.id,
        run,
        answer: got.text,
        dollars: +got.dollars.toFixed(5),
        ...screen(c, got.text, steps, load(c.dir).blocks),
      };
      rows.push(row);
      console.log(
        `${row.problems.length === 0 ? "✓" : "✗"} ${c.id}#${run} words=${row.words} q=${row.questions} cited=${row.cited}` +
          ` chat=${row.chatCloseness ?? "-"} ${row.problems.join(", ")}`,
      );
    }
  }
  const summary = summarise(rows);
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(
    out,
    `${JSON.stringify(
      { label, at: new Date().toISOString(), sourceSha256: sourceSha256(), summary, rows },
      null,
      2,
    )}\n`,
  );
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
