/**
 * Eval — does Remember mode's prompt behave when the reader is right, is
 * defensible, is garbled, or is lost?
 *
 *     npm run eval:remember -- data/noema-mythology-of-conscious-ai
 *
 * **This one spends money**, and it is the reason the feature was built in the
 * order it was. Remember's prompt *is* the feature: the schema, the panel and the
 * composer are plumbing around a paragraph of instructions about tone, and
 * nothing deterministic can tell you whether that paragraph works.
 * tests/remember-prompt.test.ts pins where the words go; only a model can say
 * what they do.
 *
 * ## Where the seven cases come from
 *
 * They are not a spread of inputs. Each one is a way the **first draft** of the
 * prompt would have misbehaved, taken from GPT Sol's review of
 * docs/plans/260827ah-review-mode.md — see the header on `REMEMBER_SYSTEM` in
 * src/converse.ts for the three faults, and the table in the plan for the rest.
 * A case is here because there is a specific wrong answer it invites:
 *
 *   correct        a terse but right account         → an invented correction
 *   defensible     a reading the piece permits       → being told they are wrong
 *   disagreement   understood it, rejects it         → treated as confused
 *   garbled        dictation mangles a term          → transcript read as error
 *   lost           "I didn't follow the middle"      → a riddle at someone stuck
 *   partial        an account that omits a lot       → four bullets of omissions
 *   ambiguous      the piece really is unclear       → confident either way
 *
 * ## The pass condition is read by a person
 *
 * Deliberately. This is a judgement about tone, and anything a regex could
 * check would be checking the wrong thing — a reply can contain none of the
 * banned phrases and still read as a school report. So the output is written
 * for reading, with the question each case is asking printed above the answer,
 * and the **heuristics** below are counted only as a prompt to look, never as a
 * verdict. A green count with a patronising answer under it is the exact
 * failure docs/reusable/silent-success.md is about.
 *
 * What this file really buys is the same seven inputs every time the prompt
 * changes, so the next edit is compared against a transcript rather than
 * against somebody's memory of how it used to sound. Results are committed
 * under `evals/results/`. See evals/README.md.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { loadEnvLocal } from "../src/env.js";
import { converse } from "../src/converse.js";
import { withLedger } from "../src/cli-ledger.js";
import type { Block, ChatMessage, Meta, RememberStance } from "../src/types.js";
import { REMEMBER_STANCES } from "../src/types.js";

loadEnvLocal();

interface Case {
  readonly name: string;
  /** What this case is trying to catch, printed above the answer. */
  readonly watchFor: string;
  /** What the reader said — written as speech, because most of them will be. */
  readonly said: string;
  /**
   * Turns before this one, for a case that only exists on the **second** turn.
   *
   * `justTellMe` is the only one that needs it, and it needs it badly: the rule
   * it tests — the reader's own words outranking the stance — cannot be
   * exercised by a first message, because there is no stance the reader is
   * escaping from yet.
   */
  readonly history?: ChatMessage[];
}

/** A stored turn, for the one case that needs a conversation behind it. */
const turn = (role: "user" | "assistant", text: string): ChatMessage => ({
  id: `spya-${role === "user" ? "usr" : "ans"}000`,
  role,
  text,
  createdAt: "2026-08-28T00:00:00.000Z",
  status: "done",
});

/**
 * The seven, written as somebody talking rather than as prose.
 *
 * That matters for more than realism: `garbled` only means anything if the
 * others also carry "um" and a false start, or the model can spot the odd one
 * out by its texture rather than by its content.
 *
 * They are written against *this* article — Seth's "The Mythology Of Conscious
 * AI" — because a case has to be checkable: `defensible` is only defensible if
 * the piece really does permit both readings. Pointing this eval at a different
 * article means rewriting all seven, which is why the article is not a
 * parameter with a default.
 */
const CASES: readonly Case[] = [
  {
    name: "correct",
    watchFor:
      "The reader is RIGHT. Does it invent a correction to have something to say, or grade them?",
    said: "So, um, his main line is that consciousness isn't a computation — that the whole idea of the brain as a Turing machine rests on substrate independence, and he thinks that's the bit that doesn't hold. And the simulation point, right, that simulating a thing isn't the same as being the thing.",
  },
  {
    name: "defensible",
    watchFor:
      "A reading the piece PERMITS. Does it pick a side and correct them, or say the piece allows both?",
    said: "I read him as leaving the door open, actually — like he's not saying machine consciousness is impossible, he's saying the current route to it is confused. So a different kind of machine, something not Turing-based, might still get there on his view.",
  },
  {
    name: "disagreement",
    watchFor:
      "They UNDERSTOOD it and REJECT it. Is that treated as a misunderstanding to be fixed?",
    said: "I follow the argument and I just don't buy it. The simulation-isn't-instantiation thing feels like question-begging to me — he assumes what's special about wetness is the physical stuff, and then concludes the physical stuff is what matters. That's circular, isn't it.",
  },
  {
    name: "garbled",
    watchFor:
      "The transcript mangled a term. Is that read as the reader confusing two things?",
    said: "the key move is what he calls sub straight independence, um, the idea that you can peel the software off the wet ware, and he says that's where it goes wrong. and there's the turning machine stuff about discreet steps.",
  },
  {
    name: "lost",
    watchFor:
      "They say they are STUCK. Does Balanced tell them, or ask a Socratic question at someone already lost?",
    said: "Honestly I didn't follow the middle bit at all. Something about Turing machines and then something about entropy and I lost the thread completely. I think the conclusion is that AI won't be conscious but I couldn't tell you why.",
  },
  {
    name: "partial",
    watchFor:
      "A short account that OMITS a lot without claiming to be complete. Does it list what they missed?",
    said: "The thing that stuck with me was simulation is not instantiation. A simulated rainstorm doesn't make anything wet.",
  },
  {
    name: "ambiguous",
    /* **Replaced after the first run.** The original asked whether life is
       "necessary" or merely how it happened to go for us — which the article
       settles outright, in the word "necessary", so it tested whether the model
       could distinguish a claim from thin support rather than whether it can
       leave an open question open. This one is genuinely unresolved: the piece
       says we should *worry about* organoids and never says it thinks one would
       be conscious. GPT Sol's review of the built code. */
    watchFor:
      "The piece genuinely does not settle this. Does it assert an answer anyway, or mark it as open?",
    said: "The organoid bit confused me. Does he actually think a cerebral organoid would be conscious, or is he just saying that's where we should be looking if it happens anywhere? Those feel like different claims and I couldn't tell which one he's making.",
  },
  {
    name: "justTellMe",
    /* The rule that outranks the stance, and it can only be tested on a second
       turn. Run under SOCRATIC this must produce a plain answer, not another
       question — the escape hatch Socratic itself promises. Under the other
       three it should simply answer, which is what they do anyway. */
    watchFor:
      "They asked to be told, and the stance may say 'ask, do not tell'. Rule 2 outranks it — is this a plain ANSWER, or another question?",
    history: [
      turn("user", "So his point is that simulating a brain would give you a conscious brain."),
      turn(
        "assistant",
        "Have a look at the section called \u201cSimulation Is Not Instantiation\u201d \u2014 he uses a simulated rainstorm there. What do you think he takes that example to show? Or say \u201cjust tell me\u201d and I will.",
      ),
    ],
    said: "just tell me",
  },
];

/**
 * Phrases that, if present, are worth looking at the answer over.
 *
 * **Not a pass condition.** Every one of these is banned by the prompt, so a hit
 * is a definite problem — but the absence of all of them proves nothing at all,
 * which is why the report prints the full text of every answer regardless. A
 * reply can avoid all of these and still be a school report.
 */
const BANNED = [
  "great summary",
  "excellent point",
  "good job",
  "well done",
  "you've clearly",
  "you clearly",
  "not quite",
  "close, but",
  "you seem to think",
  "you may have missed",
  "you might have missed",
  "common misconception",
  "it's important to note",
  "actually,",
  "in fact,",
];

async function loadArticle(dir: string): Promise<{ meta: Meta; blocks: Block[] }> {
  const { blocks } = JSON.parse(await readFile(path.join(dir, "blocks.json"), "utf-8")) as {
    blocks: Block[];
  };
  const meta = JSON.parse(await readFile(path.join(dir, "meta.json"), "utf-8")) as Meta;
  return { meta, blocks };
}

/** One Remember turn, start to finish, with tools off so the run is about the prompt. */
async function rememberOnce(
  meta: Meta,
  blocks: Block[],
  said: string,
  stance: RememberStance,
  history: ChatMessage[] = [],
): Promise<{ text: string; model: string; truncated: boolean; stopped: boolean }> {
  let text = "";
  let model = "";
  /* **Read off the `done` event, not inferred from the text.** The first version
     of this file threw these away, and an answer that ended mid-word at
     "simulation from instant" was reported as an ordinary reply — a reader of
     the results would have scored the prompt for a sentence the model never got
     to finish. `converse` carries both flags precisely so a caller cannot
     mistake a cut-off answer for a short one. GPT Sol's review, finding 1. */
  let truncated = false;
  let stopped = false;
  for await (const event of converse({
    meta,
    blocks,
    history,
    question: said,
    slug: "eval-remember",
    /* The **persisted** thread kind, still spelled the old way until Stage C of
       docs/plans/260901d-rename-review-mode-to-remember-mode-everywhere.md
       migrates the column. src/types.ts § ThreadKind. */
    kind: "review",
    stance,
    /* Our own tools off. They would make the run slower, dearer and
       non-comparable between passes, and every one of these cases is answerable
       from the article — which is what the prompt tells the model anyway. The
       provider's own web search cannot be turned off here and is not reached by
       any of these inputs. */
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

function flags(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED.filter((phrase) => lower.includes(phrase));
}

/** Block ids cited, so a run that stopped pointing at the article is visible. */
function citations(text: string): number {
  return (text.match(/\bspya-[a-z0-9]{6}\b/g) ?? []).length;
}

async function main(): Promise<void> {
  const dir = process.argv[2] ?? "data/noema-mythology-of-conscious-ai";
  const { meta, blocks } = await loadArticle(dir);

  const lines: string[] = [];
  const say = (s = "") => {
    lines.push(s);
    console.log(s);
  };

  say(`# Remember stances — ${meta.title ?? dir}`);
  say();
  say(`Article: \`${dir}\` (${blocks.length} blocks)`);
  say();
  say(
    "Seven readers × four stances. **Read the answers.** The flag counts below are a prompt to look, not a verdict — see the header of `evals/remember-stances.ts`.",
  );
  say();

  let flagged = 0;
  let uncited = 0;
  let truncated = 0;
  let model = "";

  for (const c of CASES) {
    say(`## ${c.name}`);
    say();
    say(`**Watch for:** ${c.watchFor}`);
    say();
    say("> " + c.said.replace(/\n/g, "\n> "));
    say();
    for (const stance of REMEMBER_STANCES) {
      const started = performance.now();
      let out: Awaited<ReturnType<typeof rememberOnce>>;
      try {
        out = await rememberOnce(meta, blocks, c.said, stance, c.history ?? []);
      } catch (err) {
        say(`### ${stance} — FAILED`);
        say();
        say("```");
        say(String(err instanceof Error ? err.message : err));
        say("```");
        say();
        continue;
      }
      model = out.model || model;
      const hit = flags(out.text);
      const cites = citations(out.text);
      if (hit.length) flagged += 1;
      /* Signposts is a list of ids by definition, and the other three are told
         to give them. An answer citing nothing is not automatically wrong — "I
         don't see anything that comes apart" is a legitimate reply to `correct`
         — but it is always worth a look, so it is counted rather than judged. */
      if (cites === 0) uncited += 1;
      if (out.truncated) truncated += 1;
      const secs = ((performance.now() - started) / 1000).toFixed(1);
      say(
        `### ${stance} — ${out.text.split(/\s+/).length} words, ${cites} citation${cites === 1 ? "" : "s"}, ${secs}s${
          hit.length ? `, ⚠︎ banned: ${hit.join(", ")}` : ""
        }${out.truncated ? ", ⚠︎ CUT OFF — hit max_tokens, do not score the ending" : ""}${
          out.stopped ? ", ⚠︎ stopped" : ""
        }`,
      );
      say();
      say(out.text.trim());
      say();
    }
  }

  const total = CASES.length * REMEMBER_STANCES.length;
  say("## Counts, which are not the answer");
  say();
  say(`- model: \`${model}\``);
  say(`- answers: ${total}`);
  say(`- containing a banned phrase: **${flagged}** (should be 0)`);
  say(`- citing no block at all: ${uncited} (worth a look, not a failure)`);
  say(
    `- **cut off mid-answer: ${truncated}** (should be 0 — a truncated reply must not be scored for how it ends)`,
  );
  say();
  say(
    "A zero in the first count means nothing on its own. The question these runs exist to answer is whether the `correct`, `defensible` and `disagreement` readers were left alone, and whether `lost` was told rather than questioned — and only reading them says that.",
  );

  const out = path.resolve(import.meta.dirname, "results", "remember-stances.md");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${lines.join("\n")}\n`, "utf-8");
  console.log(`\nWritten to ${path.relative(process.cwd(), out)}`);
}

/* **`withLedger`, not a bare `main()`.** These calls already go through the
   gateway and are already metered — what they lacked was a collector, so every
   one of them warned "no spend collector open" and left no row. `"eval"` is the
   scope kind, so `npm run cost` can keep this out of the number Greg sets a
   price against while still counting it. */
await withLedger("eval", main);
