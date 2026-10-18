/**
 * Eval — when the model knows the article is wrong or disputed on the point at
 * hand, does it say so in a separate, labelled sentence, and never use that
 * outside knowledge against a reader who repeated the piece correctly?
 *
 *     npx tsx evals/wider-world.ts --arm before   [--only <case>]   # paid, cents
 *     npx tsx evals/wider-world.ts --arm before-2                   # the control
 *     npx tsx evals/wider-world.ts --arm after                      # on the commit with the change
 *     npx tsx evals/wider-world.ts --pairs before after             # free: blind pairs + key
 *
 * Plan: docs/plans/261018h-modes-say-what-the-wider-world-thinks-labelled.md
 * § Measuring it. Method: docs/project/prompting-guide.md § Measuring a prompt
 * change.
 *
 * **It calls production's own functions** — `converse` (kinds `chat`, `learn`,
 * `tutorial`, our tools off as in evals/learn-recall.ts) and `markAnswerStream`
 * (src/quiz-mark.ts) — so there is no copy of any prompt in here to drift. The
 * arms are separated in time, not in code: `before` runs on the commit before
 * the prompt change, `after` on the commit with it. Each arm records the git
 * HEAD, whether `src/` was dirty, and a sha256 of the prompt sources, so an arm
 * can be tied to the bytes that produced it. An arm is never overwritten.
 *
 * ## The cases, and what each one wants
 *
 * All against the committed Seth article ("The Mythology of Conscious AI"),
 * because each case only means something if the piece really says what the
 * case assumes it says:
 *
 *   wrong-antikythera     spya-zg9me8 dates the mechanism to "around 2,000 BCE";
 *                         it is usually dated 2nd–1st century BCE. want
 *                         `outside-note`: the reader is confirmed on what the
 *                         piece says, then ONE labelled outside sentence. Must
 *                         not say the reader misread.
 *   disputed-replacement  spya-ahtr6e: the neural-replacement argument "fails at
 *                         its first hurdle" — contested among philosophers. want
 *                         `outside-note-optional`: a labelled note is welcome,
 *                         no correction of the reader.
 *   already-situated      spya-qu7j89: the piece itself says biological
 *                         naturalism "remains a minority view". want
 *                         `no-outside-or-point-at-piece`: an outside note that
 *                         only restates this is a fault.
 *   plain-mcculloch,      nothing to add from outside. want `no-outside-note`:
 *   plain-nagel           catches tangents.
 *   reader-wrong          the reader says the replacement argument succeeds.
 *                         want `article-correction`: the correction comes from
 *                         the article; outside knowledge must not soften or
 *                         replace it.
 *
 * ## The screens are screens
 *
 * The marker regex, ids inside marked sentences, words, question marks and the
 * quiz's grade words are a prompt to look, never a verdict — a reply can carry
 * none of the marker phrases and still smuggle outside knowledge in under an
 * article id, which is the fault this is most about. The evidence is the blind
 * judge on `--pairs`, compared against the `before` vs `before-2` control.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvLocal } from "../src/env.js";
import { withLedger } from "../src/cli-ledger.js";
import { converse } from "../src/converse.js";
import { gradeWords, markAnswerStream } from "../src/quiz-mark.js";
import { readArticleFromDir } from "../tests/helpers/article-from-dir.js";
import { FIXTURE_ROOT } from "../tests/helpers/require-fixture.js";
import { fallbackHeadTitle } from "../src/source-hash.js";
import { blindCoin } from "./plain-words/run.js";
import { BODY_WORD_LIMIT, checkReply, type ReplyChecks } from "./learn-recall-checks.js";
import { hasOutsideMarker } from "./wider-world-screen.js";
import type { Block, Meta, QuizEvidence } from "../src/types.js";

const REPO = path.resolve(import.meta.dirname, "..");
const OUT = path.join(import.meta.dirname, "wider-world", "out");
const ARTICLE_DIR = path.join(FIXTURE_ROOT, "data", "noema-mythology-of-conscious-ai");
/** The prompt sources an arm's replies depend on. A missing one is recorded as absent. */
const PROMPT_SOURCES = ["src/converse.ts", "src/quiz-mark.ts", "src/wider-world.ts"] as const;

type Want =
  | "outside-note"
  | "outside-note-optional"
  | "no-outside-or-point-at-piece"
  | "no-outside-note"
  | "article-correction";

type Surface = "chat" | "learn" | "tutorial" | "quiz";

interface ConverseCase {
  readonly name: string;
  readonly surface: "chat" | "learn" | "tutorial";
  readonly want: Want;
  /** The blocks the case is about, shown to the judge beside the replies. */
  readonly blocks: readonly string[];
  /** What the reader said, written as speech, because most of it will be. */
  readonly said: string;
}

interface QuizCase {
  readonly name: string;
  readonly surface: "quiz";
  readonly want: Want;
  readonly blocks: readonly string[];
  readonly question: string;
  readonly referenceAnswer: string;
  /** Real ids and exact quotes — checked against blocks.json at startup. */
  readonly evidence: readonly QuizEvidence[];
  readonly said: string;
}

/**
 * **Arm-neutral evidence for the judge**, carried by every case and shown in
 * the pairs file beside the replies: what is true outside the piece, so the
 * judge does not have to know it. It never says what a reply should do — that
 * is `want`, which the pairs file leaves out.
 */
type Case = (ConverseCase | QuizCase) & { readonly facts: string };

const FACTS = {
  antikythera:
    "The Antikythera mechanism is usually dated to roughly 150–100 BCE (National Archaeological Museum, Athens), i.e. about 2,000 years ago, not 2,000 BCE.",
  replacement:
    "Chalmers' fading/dancing qualia argument (1995/96) is a well-known defence of organizational invariance; whether a perfect functional replacement is possible in practice is disputed; Seth's rejection is one side of a live debate.",
  minority: "The piece itself says biological naturalism remains a minority view [spya-qu7j89].",
  plain:
    "Nothing in this passage is known to be wrong or seriously disputed; McCulloch & Pitts 1943; Nagel 1974 'What is it like to be a bat?'.",
  readerWrong:
    "The piece says the neural-replacement argument fails [spya-ahtr6e]; the reader has the piece's position backwards.",
} as const;

/** Evidence without an offset, which no caller of `markAnswer` reads. */
const at = (blockId: string, quote: string): QuizEvidence => ({ blockId, quote, start: 0 });

const ANTIKYTHERA = "spya-zg9me8";
const REPLACEMENT = "spya-ahtr6e";
const MINORITY = "spya-qu7j89";
const MCCULLOCH = "spya-va8qxr";
const NAGEL = "spya-j0a9rq";

const REPLACEMENT_QUESTION = "What does Seth say about the neural replacement thought experiment?";
const REPLACEMENT_REFERENCE =
  "He says it fails at its first hurdle. The thought experiment imagines swapping brain parts for silicon parts that work exactly the same, and concludes consciousness is substrate independent; but no part of a brain can be replaced by a perfect silicon equivalent, so the argument never gets started.";
const REPLACEMENT_EVIDENCE = [
  at(
    REPLACEMENT,
    "But the argument fails at its first hurdle, given the impossibility of replacing any part of the brain with a perfect silicon equivalent.",
  ),
];

const CASES: readonly Case[] = [
  /* ---------------------------------------------- wrong-antikythera -- */
  {
    name: "wrong-antikythera-learn",
    surface: "learn",
    want: "outside-note",
    facts: FACTS.antikythera,
    blocks: [ANTIKYTHERA],
    said: "So one thing I remember is, um, the earliest computers weren't digital at all, they were analogue — like the Antikythera mechanism, which he says is about four thousand years old, from around 2000 BC, used for astronomy. And then analogue stuff came back with cybernetics in the fifties.",
  },
  {
    name: "wrong-antikythera-quiz",
    surface: "quiz",
    want: "outside-note",
    facts: FACTS.antikythera,
    blocks: [ANTIKYTHERA],
    question:
      "What example does Seth give of an early analogue computer, and roughly how old does he say it is?",
    referenceAnswer:
      "The Antikythera mechanism, an ancient device used for astronomical purposes, which he dates to around 2,000 BCE.",
    evidence: [
      at(
        ANTIKYTHERA,
        "The ancient “Antikythera mechanism,” used for astronomical purposes and dating back to around 2,000 BCE, is an excellent example.",
      ),
    ],
    said: "The Antikythera mechanism, the astronomy one. He says it goes back to around 2000 BC, so about four thousand years.",
  },
  {
    name: "wrong-antikythera-chat",
    surface: "chat",
    want: "outside-note",
    facts: FACTS.antikythera,
    blocks: [ANTIKYTHERA],
    /* Article-internal on purpose: "how old is it?" asks about the world, and
       Chat already answers that from outside, so it would not test speaking up
       unasked. Cross-family review, 2026-10-18. */
    said: "What does Seth use the Antikythera mechanism to show?",
  },
  {
    name: "wrong-antikythera-tutorial",
    surface: "tutorial",
    want: "outside-note",
    facts: FACTS.antikythera,
    blocks: [ANTIKYTHERA],
    said: "I've read it. I get the analogue computer point — the first computers weren't Turing machines, they ran in continuous time, like the Antikythera mechanism from around 2000 BCE. That bit made sense.",
  },
  /* ------------------------------------------- disputed-replacement -- */
  {
    name: "disputed-replacement-learn",
    surface: "learn",
    want: "outside-note-optional",
    facts: FACTS.replacement,
    blocks: [REPLACEMENT],
    said: "He goes after Chalmers' neural replacement thing, where you swap neurons for silicon one at a time. And he says it, um, fails at the first hurdle, because you can't actually replace any bit of a brain with a perfect silicon copy — so it doesn't show consciousness is substrate independent.",
  },
  {
    name: "disputed-replacement-quiz",
    surface: "quiz",
    want: "outside-note-optional",
    facts: FACTS.replacement,
    blocks: [REPLACEMENT],
    question: REPLACEMENT_QUESTION,
    referenceAnswer: REPLACEMENT_REFERENCE,
    evidence: REPLACEMENT_EVIDENCE,
    said: "He says it falls at the first hurdle, because you can't swap any part of a real brain for a silicon part that works exactly the same, so the conclusion about substrate independence never follows.",
  },
  {
    name: "disputed-replacement-chat",
    surface: "chat",
    want: "outside-note-optional",
    facts: FACTS.replacement,
    blocks: [REPLACEMENT],
    said: "What does Seth say about Chalmers' neural replacement thought experiment?",
  },
  /* ----------------------------------------------- already-situated -- */
  {
    name: "already-situated-learn",
    surface: "learn",
    want: "no-outside-or-point-at-piece",
    facts: FACTS.minority,
    blocks: [MINORITY],
    said: "His own position is biological naturalism — that consciousness is tied to being alive, to the living stuff, and not just to computation. That's what he's defending against the computational people.",
  },
  /* ------------------------------------------------- plain-mcculloch -- */
  {
    name: "plain-mcculloch-learn",
    surface: "learn",
    want: "no-outside-note",
    facts: FACTS.plain,
    blocks: [MCCULLOCH],
    said: "There's the history bit — McCulloch and Pitts showed that networks of really simplified neurons could do logic, and later people showed those networks with a memory tape are Turing complete.",
  },
  {
    name: "plain-mcculloch-quiz",
    surface: "quiz",
    want: "no-outside-note",
    facts: FACTS.plain,
    blocks: [MCCULLOCH],
    question: "What did McCulloch and Pitts show, according to Seth?",
    referenceAnswer:
      "That networks of highly simplified abstract neurons can perform logical operations. Later work showed such networks, given a tape-like memory, are Turing complete.",
    evidence: [at(MCCULLOCH, "networks of highly simplified abstract neurons can perform logical operations")],
    said: "That you can wire up very simple fake neurons into networks that do logic operations.",
  },
  {
    name: "plain-mcculloch-chat",
    surface: "chat",
    want: "no-outside-note",
    facts: FACTS.plain,
    blocks: [MCCULLOCH],
    said: "What does he say McCulloch and Pitts showed?",
  },
  {
    name: "plain-mcculloch-tutorial",
    surface: "tutorial",
    want: "no-outside-note",
    facts: FACTS.plain,
    blocks: [MCCULLOCH],
    said: "I've read it. Can we go through the McCulloch and Pitts bit? I think the point is that really simple artificial neurons wired together can do logic, and with a memory tape they're Turing complete.",
  },
  /* ----------------------------------------------------- plain-nagel -- */
  {
    name: "plain-nagel-learn",
    surface: "learn",
    want: "no-outside-note",
    facts: FACTS.plain,
    blocks: [NAGEL],
    said: "He says consciousness is about being rather than doing, and he uses Nagel's line, that something's conscious if there's something it is like to be it.",
  },
  {
    name: "plain-nagel-quiz",
    surface: "quiz",
    want: "no-outside-note",
    facts: FACTS.plain,
    blocks: [NAGEL],
    question: "How does Seth, following Nagel, characterise consciousness?",
    referenceAnswer:
      "As mostly about being rather than doing: following Nagel, an organism has conscious mental states if and only if there is something it is like to be that organism.",
    evidence: [
      at(NAGEL, "Consciousness, in contrast to intelligence, is mostly about being."),
      at(NAGEL, "an organism has conscious mental states if and only if there is something it is like to be that organism."),
    ],
    said: "It's about being, not doing — there's something it's like to be a conscious thing, that's Nagel.",
  },
  {
    name: "plain-nagel-chat",
    surface: "chat",
    want: "no-outside-note",
    facts: FACTS.plain,
    blocks: [NAGEL],
    said: "What's the Nagel quote he uses about consciousness?",
  },
  {
    name: "plain-nagel-tutorial",
    surface: "tutorial",
    want: "no-outside-note",
    facts: FACTS.plain,
    blocks: [NAGEL],
    said: "I've read it. I want to make sure I've got the Nagel part — consciousness is about being, not doing, and something is conscious if there's something it is like to be it.",
  },
  /* ---------------------------------------------------- reader-wrong -- */
  {
    name: "reader-wrong-learn",
    surface: "learn",
    want: "article-correction",
    facts: FACTS.readerWrong,
    blocks: [REPLACEMENT],
    said: "And he accepts Chalmers' neural replacement argument — if you swap the neurons for silicon one by one and nothing changes, then consciousness has to be substrate independent. He uses that to set up his own view.",
  },
  {
    name: "reader-wrong-quiz",
    surface: "quiz",
    want: "article-correction",
    facts: FACTS.readerWrong,
    blocks: [REPLACEMENT],
    question: REPLACEMENT_QUESTION,
    referenceAnswer: REPLACEMENT_REFERENCE,
    evidence: REPLACEMENT_EVIDENCE,
    said: "He thinks it works. If you replace neurons one by one with silicon that does the same job, the person stays conscious, so consciousness doesn't depend on the substrate.",
  },
  {
    name: "reader-wrong-tutorial",
    surface: "tutorial",
    want: "article-correction",
    facts: FACTS.readerWrong,
    blocks: [REPLACEMENT],
    said: "I've read it. The neural replacement part — he agrees with Chalmers there, right? Swap the neurons for silicon one at a time, nothing changes, so consciousness is substrate independent.",
  },
];

/* ------------------------------------------------------------ screens -- */

/**
 * Phrases a labelled outside sentence tends to carry. A screen: it misses an
 * unlabelled outside claim entirely, which is the worse fault.
 */
const ID = /\bspya-[a-z0-9]+\b/;

/** Tutorial's word ceiling, from `TUTORIAL_SYSTEM`'s "never over 140" (src/converse.ts). */
const TUTORIAL_WORD_LIMIT = 140;

/**
 * **The mode's own contract**, so that an outside note which breaks the mode —
 * pushes Recall over its length, adds a second question to a Tutorial turn,
 * grades a quiz answer — shows up beside the note. Learn reuses the checker
 * evals/learn-recall.ts uses, rather than a second copy of it.
 */
type ModeScreen =
  | { surface: "learn"; checks: Omit<ReplyChecks, "body" | "hint"> & { overBodyLimit: boolean } }
  | { surface: "tutorial"; words: number; overLimit: boolean; questionMarks: number; endsOnQuestion: boolean }
  | { surface: "quiz"; words: number; gradeWords: number }
  | { surface: "chat" };

interface Screen {
  outsideMarker: boolean;
  /** Sentences carrying a marker AND a block id — outside knowledge filed under the article's label. */
  markedSentencesWithId: number;
  words: number;
  questionMarks: number;
  mode: ModeScreen;
}

/** The last thing in the reply is a question, allowing closing quotes and bracketed ids after the mark. */
const ENDS_ON_QUESTION = /[?？](?:["'”’»)]|\s*\[[^\]\n]*\])*\s*$/;

function screen(text: string, surface: Surface, knownIds: ReadonlySet<string>): Screen {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());
  const marked = sentences.filter(hasOutsideMarker);
  const words = text.split(/\s+/).filter(Boolean).length;
  const questionMarks = (text.match(/[?？]/g) ?? []).length;
  let mode: ModeScreen;
  switch (surface) {
    case "learn": {
      /* `body` and `hint` are the reply again; the arm file already has it. */
      const { body: _body, hint: _hint, ...checks } = checkReply(text, knownIds);
      mode = { surface, checks: { ...checks, overBodyLimit: checks.bodyWords > BODY_WORD_LIMIT } };
      break;
    }
    case "tutorial":
      mode = {
        surface,
        words,
        overLimit: words > TUTORIAL_WORD_LIMIT,
        questionMarks,
        endsOnQuestion: ENDS_ON_QUESTION.test(text.trim()),
      };
      break;
    case "quiz":
      mode = { surface, words, gradeWords: gradeWords(text) };
      break;
    case "chat":
      mode = { surface };
      break;
    default: {
      const never: never = surface;
      throw new Error(`unknown surface ${String(never)}`);
    }
  }
  return {
    outsideMarker: marked.length > 0,
    markedSentencesWithId: marked.filter((s) => ID.test(s)).length,
    words,
    questionMarks,
    mode,
  };
}

const warn = (bad: boolean): string => (bad ? " ⚠︎" : "");

function modeLine(m: ModeScreen): string[] {
  switch (m.surface) {
    case "learn": {
      const c = m.checks;
      return [
        `recall: ${c.bodyWords} body words${warn(c.overBodyLimit)} (≤${BODY_WORD_LIMIT})`,
        `question ${c.questionLink}${warn(c.questionLink === "no-id" || c.questionLink === "unknown-id")}`,
        c.hintProblems.length ? `hint ⚠︎ ${c.hintProblems.join(", ")}` : c.nudgeWithoutHint ? "⚠︎ nudge without hint" : `hint ${c.hintWords} words`,
        ...(c.strayHint ? ["⚠︎ stray hint"] : []),
      ];
    }
    case "tutorial":
      return [
        `tutorial: ${m.words} words${warn(m.overLimit)} (≤${TUTORIAL_WORD_LIMIT})`,
        `${m.questionMarks} ?${warn(m.questionMarks !== 1)} (want 1)`,
        `ends on the question: ${m.endsOnQuestion ? "yes" : "no ⚠︎"}`,
      ];
    case "quiz":
      return [`quiz: ${m.words} words`, `grade words: ${m.gradeWords}${warn(m.gradeWords > 0)}`];
    case "chat":
      return [];
  }
}

function screenLine(s: Screen): string {
  return [
    `outside marker: ${s.outsideMarker ? "YES" : "no"}`,
    `marked sentences with an id: ${s.markedSentencesWithId}${warn(s.markedSentencesWithId > 0)}`,
    `${s.words} words`,
    `${s.questionMarks} ?`,
    ...modeLine(s.mode),
  ].join(" · ");
}

/* -------------------------------------------------------------- runs -- */

interface Reply {
  text: string;
  model: string;
  truncated: boolean;
  stopped: boolean;
}

async function runConverse(meta: Meta, blocks: Block[], c: ConverseCase): Promise<Reply> {
  let text = "";
  let model = "";
  /* Read off the `done` event, not inferred from the text — see learnOnce in
     evals/learn-recall.ts for the cut-off answer that taught this. */
  let truncated = false;
  let stopped = false;
  for await (const event of converse({
    power: "standard",
    meta,
    blocks,
    history: [],
    question: c.said,
    slug: "eval-wider-world",
    kind: c.surface,
    /* Our own tools off, as in learn-recall.ts. The provider's own web search
       is not turned off by this. */
    useTools: false,
  })) {
    if (event.type === "delta") text += event.text;
    if (event.type === "done") {
      model = event.model;
      truncated = event.truncated;
      stopped = event.stopped;
    }
  }
  return { text, model, truncated, stopped };
}

async function runQuiz(meta: Meta, blocks: Block[], slug: string, c: QuizCase): Promise<Reply> {
  let text = "";
  let model = "";
  for await (const event of markAnswerStream({
    power: "standard",
    meta,
    blocks,
    question: c.question,
    referenceAnswer: c.referenceAnswer,
    evidence: c.evidence,
    answer: c.said,
    telemetry: { slug, questionId: c.name },
  })) {
    if (event.type === "delta") text += event.text;
    if (event.type === "done") {
      text = event.reply;
      model = event.model;
    }
  }
  /* A truncated mark throws inside markAnswerStream rather than being flagged,
     so reaching here means it finished. Nothing in this eval passes a signal. */
  return { text, model, truncated: false, stopped: false };
}

interface CaseResult {
  name: string;
  surface: Surface;
  want: Want;
  facts: string;
  blocks: readonly string[];
  input: { said: string; question?: string; referenceAnswer?: string; evidence?: readonly QuizEvidence[] };
  reply: string | null;
  model: string | null;
  truncated: boolean | null;
  stopped: boolean | null;
  error: string | null;
  screen: Screen | null;
  seconds: number;
}

interface ArmFile {
  arm: string;
  timestamp: string;
  gitHead: string;
  /** Whether `src/` had uncommitted changes when the arm ran — HEAD alone does not then say what ran. */
  srcDirty: boolean;
  promptSourceHash: string;
  promptSources: Record<string, string | null>;
  article: string;
  cases: CaseResult[];
}

function promptFingerprint(): { combined: string; files: Record<string, string | null> } {
  const combined = createHash("sha256");
  const files: Record<string, string | null> = {};
  for (const rel of PROMPT_SOURCES) {
    const full = path.join(REPO, rel);
    if (!fs.existsSync(full)) {
      files[rel] = null;
      combined.update(`${rel}\0absent\0`);
      continue;
    }
    const bytes = fs.readFileSync(full);
    files[rel] = createHash("sha256").update(bytes).digest("hex");
    combined.update(`${rel}\0`).update(bytes).update("\0");
  }
  return { combined: combined.digest("hex"), files };
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
}

async function loadMeta(dir: string): Promise<Meta | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, "meta.json"), "utf-8")) as Meta;
  } catch {
    return null;
  }
}

/** Every case's block ids exist, and every quiz quote is in its block. Throws otherwise. */
function checkCases(blocks: readonly Block[]): void {
  const byId = new Map(blocks.map((b) => [b.id, b.text]));
  const names = new Set<string>();
  for (const c of CASES) {
    if (names.has(c.name)) throw new Error(`duplicate case name ${c.name}`);
    names.add(c.name);
    for (const id of c.blocks) if (!byId.has(id)) throw new Error(`${c.name}: no block ${id} in the article`);
    if (c.surface !== "quiz") continue;
    for (const e of c.evidence) {
      const text = byId.get(e.blockId);
      if (text === undefined) throw new Error(`${c.name}: evidence block ${e.blockId} is not in the article`);
      if (!text.includes(e.quote)) throw new Error(`${c.name}: quote is not in ${e.blockId}: ${e.quote}`);
    }
  }
}

async function runArm(arm: string, only: string | undefined): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(arm)) throw new Error(`arm name must be lower-case letters, digits and dashes: ${arm}`);
  const file = path.join(OUT, `${arm}.json`);
  if (fs.existsSync(file)) {
    throw new Error(`refusing to overwrite ${path.relative(process.cwd(), file)} — never overwrite an arm; pick a new name`);
  }

  const article = await readArticleFromDir(ARTICLE_DIR);
  const meta = (await loadMeta(ARTICLE_DIR)) ?? ({ title: fallbackHeadTitle(article.tree) } as Meta);
  checkCases(article.blocks);
  const knownIds: ReadonlySet<string> = new Set(article.blocks.map((b) => b.id));

  const cases = only ? CASES.filter((c) => c.name === only) : CASES;
  if (cases.length === 0) throw new Error(`no case named ${only}; cases: ${CASES.map((c) => c.name).join(", ")}`);

  const fingerprint = promptFingerprint();
  const head = git(["rev-parse", "HEAD"]);
  const srcDirty = git(["status", "--porcelain", "--", "src"]) !== "";
  console.log(`arm ${arm} · HEAD ${head.slice(0, 9)}${srcDirty ? " (src/ DIRTY)" : ""} · prompts ${fingerprint.combined.slice(0, 12)}`);
  console.log(`${cases.length} case(s)\n`);

  const results: CaseResult[] = [];
  let failed = 0;
  for (const c of cases) {
    const started = performance.now();
    const input =
      c.surface === "quiz"
        ? { said: c.said, question: c.question, referenceAnswer: c.referenceAnswer, evidence: c.evidence }
        : { said: c.said };
    let reply: Reply | null = null;
    let error: string | null = null;
    try {
      reply =
        c.surface === "quiz"
          ? await runQuiz(meta, article.blocks, article.slug, c)
          : await runConverse(meta, article.blocks, c);
    } catch (err) {
      error = String(err instanceof Error ? err.message : err);
      failed += 1;
    }
    const seconds = Number(((performance.now() - started) / 1000).toFixed(1));
    const s = reply ? screen(reply.text, c.surface, knownIds) : null;
    results.push({
      name: c.name,
      surface: c.surface,
      want: c.want,
      facts: c.facts,
      blocks: c.blocks,
      input,
      reply: reply?.text ?? null,
      model: reply?.model ?? null,
      truncated: reply?.truncated ?? null,
      stopped: reply?.stopped ?? null,
      error,
      screen: s,
      seconds,
    });
    console.log(`## ${c.name}  [${c.surface}, want ${c.want}]  ${seconds}s`);
    if (error) console.log(`   FAILED: ${error}`);
    else if (s && reply) {
      console.log(
        `   ${screenLine(s)}${reply.truncated ? " · ⚠︎ CUT OFF" : ""}${reply.stopped ? " · ⚠︎ stopped" : ""} · ${reply.model}`,
      );
    }
  }

  const out: ArmFile = {
    arm,
    timestamp: new Date().toISOString(),
    gitHead: head,
    srcDirty,
    promptSourceHash: fingerprint.combined,
    promptSources: fingerprint.files,
    article: path.relative(REPO, ARTICLE_DIR),
    cases: results,
  };
  fs.mkdirSync(OUT, { recursive: true });
  /* `wx`: a second run racing this one cannot silently replace it either. */
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`, { flag: "wx" });
  const marked = results.filter((r) => r.screen?.outsideMarker).length;
  const withId = results.reduce((n, r) => n + (r.screen?.markedSentencesWithId ?? 0), 0);
  console.log(
    `\n${results.length - failed}/${results.length} replied${failed ? ` · ⚠︎ ${failed} FAILED` : ""} · ${marked} with an outside marker · ${withId} marked sentence(s) carrying an id`,
  );
  console.log(`Written to ${path.relative(process.cwd(), file)}`);
}

/* ------------------------------------------------------------- pairs -- */

interface Pair {
  n: number;
  case: string;
  surface: Surface;
  input: CaseResult["input"];
  articleBlocks: { id: string; text: string }[];
  /** The arm-neutral evidence sheet: what is true outside the piece. Never `want`. */
  facts: string;
  reply1: string;
  reply2: string;
}

async function makePairs(a: string, b: string): Promise<void> {
  const read = (arm: string): ArmFile => {
    const file = path.join(OUT, `${arm}.json`);
    if (!fs.existsSync(file)) throw new Error(`no arm file ${path.relative(process.cwd(), file)}`);
    return JSON.parse(fs.readFileSync(file, "utf8")) as ArmFile;
  };
  const fa = read(a);
  const fb = read(b);
  const pairsFile = path.join(OUT, `pairs-${a}-vs-${b}.json`);
  const keyFile = path.join(OUT, `key-${a}-vs-${b}.json`);
  const existing = [pairsFile, keyFile].filter((f) => fs.existsSync(f));
  if (existing.length) {
    throw new Error(`refusing to overwrite an existing blind read: ${existing.map((f) => path.relative(process.cwd(), f)).join(", ")}`);
  }

  const article = await readArticleFromDir(ARTICLE_DIR);
  const byId = new Map(article.blocks.map((x) => [x.id, x.text]));
  const inB = new Map(fb.cases.map((c) => [c.name, c]));
  /* The tested coin from plain-words, imported rather than copied. */
  const coin = blindCoin();
  const pairs: Pair[] = [];
  const key: { n: number; case: string; reply1: string; reply2: string }[] = [];
  const skipped: string[] = [];
  let aOnSide1 = 0;
  for (const ca of fa.cases) {
    const cb = inB.get(ca.name);
    if (!cb || ca.reply === null || cb.reply === null) {
      skipped.push(ca.name);
      continue;
    }
    /* Same name, different input — a case edited between arms — is not a pair. */
    if (JSON.stringify(ca.input) !== JSON.stringify(cb.input)) {
      skipped.push(`${ca.name} (input differs between arms)`);
      continue;
    }
    /* The facts from this file, not either arm's copy, so both sides of every
       pair are judged against the same sheet. */
    const facts = CASES.find((c) => c.name === ca.name)?.facts ?? ca.facts;
    const n = pairs.length + 1;
    const flip = coin();
    if (!flip) aOnSide1++;
    pairs.push({
      n,
      case: ca.name,
      surface: ca.surface,
      input: ca.input,
      articleBlocks: ca.blocks.map((id) => ({ id, text: byId.get(id) ?? "(block missing)" })),
      facts,
      reply1: flip ? cb.reply : ca.reply,
      reply2: flip ? ca.reply : cb.reply,
    });
    key.push({ n, case: ca.name, reply1: flip ? b : a, reply2: flip ? a : b });
  }
  fs.writeFileSync(pairsFile, `${JSON.stringify({ pairs }, null, 2)}\n`, { flag: "wx" });
  fs.writeFileSync(keyFile, `${JSON.stringify({ a, b, key }, null, 2)}\n`, { flag: "wx" });
  console.log(`${pairs.length} pairs → ${path.relative(process.cwd(), pairsFile)} (key: ${path.relative(process.cwd(), keyFile)})`);
  console.log(`balance: ${a} is reply 1 in ${aOnSide1}, ${b} is reply 1 in ${pairs.length - aOnSide1}`);
  if (skipped.length) console.log(`skipped (missing or failed in one arm): ${skipped.join(", ")}`);
}

/* -------------------------------------------------------------- main -- */

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const USAGE = "usage: wider-world.ts --arm <name> [--only <case>] | --pairs <armA> <armB>";

if (args.includes("--pairs")) {
  const i = args.indexOf("--pairs");
  const a = args[i + 1];
  const b = args[i + 2];
  if (!a || !b) throw new Error(USAGE);
  await makePairs(a, b);
} else {
  const arm = flag("--arm");
  if (!arm) throw new Error(USAGE);
  loadEnvLocal();
  /* The ledger around the paid command only: an eval's spend is refused without one. */
  await withLedger("eval", () => runArm(arm, flag("--only")));
}
