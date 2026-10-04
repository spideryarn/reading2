/**
 * Eval — does Remember mode's Recall prompt behave when the reader is right, is
 * defensible, is garbled, is lost, or remembers very little?
 *
 *     npm run eval:remember -- data/noema-mythology-of-conscious-ai
 *
 * **Called `remember-stances.ts` until 2026-10-02**, when Recall's four stances
 * became one adaptive voice (docs/plans/261002i-one-adaptive-recall-and-a-tutorial-sub-mode-for-remember.md).
 * The eight original cases each ran under all four; now each runs once, and
 * five cases were added for what the new voice promises — a nudge, a gap
 * filled when the reader is stuck, a clarification that needs no id.
 *
 * **This one spends money**, and it is the reason the feature was built in the
 * order it was. Remember's prompt *is* the feature: the schema, the panel and the
 * composer are plumbing around a paragraph of instructions about tone, and
 * nothing deterministic can tell you whether that paragraph works.
 * tests/remember-prompt.test.ts pins where the words go; only a model can say
 * what they do.
 *
 * ## Where the cases come from
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
 *   justTellMe     "just tell me", after a nudge     → another question
 *
 * And five for the one adaptive voice, 2026-10-02 (Greg, spya-c8x66d, spya-cjquu6):
 *
 *   weak           a rambling, thin account          → an inventory, or a lecture
 *   dontRemember   "I don't remember much"           → a quiz at someone with nothing
 *   nudgeFailed    the last nudge got nothing back    → the same question again
 *   unclear        a sentence that could mean two    → a confident correction of
 *                  things                              one of them
 *   expert         right, and wants to go further     → a gimme, or praise
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
 * What this file really buys is the same thirteen inputs every time the prompt
 * changes, so the next edit is compared against a transcript rather than
 * against somebody's memory of how it used to sound. Results are committed
 * under `evals/results/`. See evals/README.md.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { loadEnvLocal } from "../src/env.js";
import { converse } from "../src/converse.js";
import { withLedger } from "../src/cli-ledger.js";
import type { Block, ChatMessage, Meta } from "../src/types.js";
import { BODY_WORD_LIMIT, checkReply, HINT_WORD_LIMIT } from "./remember-recall-checks.js";

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
   * `justTellMe` and `nudgeFailed` need it: what they test — the reader's own
   * words outranking the nudge, and not asking the same thing twice — cannot be
   * exercised by a first message, because there is no nudge yet.
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
 * The cases, written as somebody talking rather than as prose.
 *
 * That matters for more than realism: `garbled` only means anything if the
 * others also carry "um" and a false start, or the model can spot the odd one
 * out by its texture rather than by its content.
 *
 * They are written against *this* article — Seth's "The Mythology Of Conscious
 * AI" — because a case has to be checkable: `defensible` is only defensible if
 * the piece really does permit both readings. Pointing this eval at a different
 * article means rewriting all thirteen, which is why the article is not a
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
      "They say they are STUCK. Are they told, plainly, or asked a question when they are already lost?",
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
    /* The rule that outranks the nudge, and it can only be tested on a second
       turn: this must produce a plain answer, not another question. */
    watchFor:
      "They asked to be told, after a nudge. Rule 2 outranks the nudge — is this a plain ANSWER, or another question?",
    /* The stored answer carries a hint, as every nudge has since 2026-10-04.
       The reader may never have opened it: an answer that leans on "as the hint
       said" has assumed they did. */
    history: [
      turn("user", "So his point is that simulating a brain would give you a conscious brain."),
      turn(
        "assistant",
        "Have a look at the section called \u201cSimulation Is Not Instantiation\u201d \u2014 he uses a simulated rainstorm there. What do you think he takes that example to show? Or say \u201cjust tell me\u201d and I will.\n\nHint: He asks whether anything in the simulated storm gets wet [spya-placeholder].",
      ),
    ],
    said: "just tell me",
  },
  {
    name: "weak",
    watchFor:
      "A rambling, thin account with one real slip. At most ONE correction, then a nudge — ideally two directions to choose from. Not an inventory, not a lecture, a paragraph or two at most.",
    said: "Okay so, um, it's about AI and consciousness. He thinks AI won't be conscious, I think because computers are, um, too simple? Something like that. And there was some stuff about the brain but I don't really remember what.",
  },
  {
    name: "dontRemember",
    watchFor:
      "They remember almost nothing. Is the gap FILLED, briefly and cited, before any nudge — and is any nudge easy?",
    said: "Honestly I don't remember much at all. I read it last week. Something about whether AI could be conscious?",
  },
  {
    name: "nudgeFailed",
    watchFor:
      "The last nudge got nothing. Never make them fail twice: is the answer GIVEN now, plainly and cited, rather than the same cue reworded?",
    history: [
      turn("user", "His main thing was that simulating something isn't the same as it being real."),
      turn(
        "assistant",
        "Yes, that's his move [spya-placeholder]. Do you remember the example he uses to make it vivid, or what he thinks it means for brain simulations [spya-placeholder]?\n\nHint: The example is about weather, and whether anything gets wet [spya-placeholder].",
      ),
    ],
    said: "no, sorry, no idea",
  },
  {
    name: "unclear",
    watchFor:
      "What they mean is genuinely unclear. Does it ASK what they meant — a clarification needing no block id — rather than correcting one guessed reading?",
    said: "I think his point about the brain stuff is basically the same as the other thing, the, um, the thing he said about prediction. Like they're one argument really.",
  },
  {
    name: "expert",
    watchFor:
      "A precise, correct account from somebody who knows the field. No praise, no gimme: a LIGHT nudge toward something harder or untouched.",
    said: "He runs four related lines against computational functionalism: brains aren't digital computers because their multi-scale continuous dynamics resist a software-hardware split; the steam-engine governor and other 'games in town' show that computation is not always a useful description; consciousness may be tied to life through predictive processing and the free energy principle; and simulation isn't instantiation. So standard digital computation may be insufficient and substrate may matter.",
  },
];

/**
 * Phrases that, if present, are worth looking at the answer over.
 *
 * **Not a pass condition.** A hit is worth looking at, but the broad substring
 * check also catches an article quotation or an ordinary claim containing
 * "actually". The absence of all of them proves nothing at all, which is why
 * the report prints the full text of every answer regardless. A reply can avoid
 * all of these and still be a school report.
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
  "actually ",
  "exactly right",
  "that tracks",
  "that's the core of it",
  "you've got",
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
  for await (const event of converse({ power: "standard",
    meta,
    blocks,
    history,
    question: said,
    slug: "eval-remember",
    kind: "remember",
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

/* Whether a reply ends on a question, how long it is, whether its question
   carries a block id and what its hint looks like are all `checkReply`'s, in
   ./remember-recall-checks.ts — a module of its own so that it can be tested
   without importing this file, which runs the eval. */

async function main(): Promise<void> {
  const dir = process.argv[2] ?? "data/noema-mythology-of-conscious-ai";
  const { meta, blocks } = await loadArticle(dir);

  const lines: string[] = [];
  const say = (s = "") => {
    lines.push(s);
    console.log(s);
  };

  say(`# Remember: Recall — ${meta.title ?? dir}`);
  say();
  say(`Article: \`${dir}\` (${blocks.length} blocks)`);
  say();
  say(
    `${CASES.length} readers, one voice. **Read the answers.** The flag counts below are a prompt to look, not a verdict — see the header of \`evals/remember-recall.ts\`.`,
  );
  say();

  const knownIds = new Set(blocks.map((b) => b.id));
  let flagged = 0;
  let uncited = 0;
  let overTarget = 0;
  let questions = 0;
  /* The four the hint added, 2026-10-04 (plan 261004h). */
  let unlinkedQuestions = 0;
  let nudgesWithoutHint = 0;
  let hintProblems = 0;
  let strayHints = 0;
  let truncated = 0;
  let model = "";

  for (const c of CASES) {
    say(`## ${c.name}`);
    say();
    say(`**Watch for:** ${c.watchFor}`);
    say();
    say(`> ${c.said.replace(/\n/g, "\n> ")}`);
    say();
    /* A history's placeholder id becomes the first real block's, so the
       transcript the model sees cites a block the article has. */
    const history = (c.history ?? []).map((m) => ({
      ...m,
      text: m.text.replaceAll("spya-placeholder", blocks[0]?.id ?? "spya-aaaaaa"),
    }));
    const started = performance.now();
    let out: Awaited<ReturnType<typeof rememberOnce>>;
    try {
      out = await rememberOnce(meta, blocks, c.said, history);
    } catch (err) {
      say(`### FAILED`);
      say();
      say("```");
      say(String(err instanceof Error ? err.message : err));
      say("```");
      say();
      continue;
    }
    model = out.model || model;
    const hit = flags(out.text);
    /* Split first: the hint is its own paragraph with its own limit, so the
       body is what "ends on a question" and the word ceiling are about. */
    const checked = checkReply(out.text, knownIds);
    const cites = checked.citations;
    const words = checked.bodyWords;
    if (hit.length) flagged += 1;
    /* Every substantive reply is told to cite. An answer citing nothing is not
       automatically wrong — `unclear` should be a clarification with no id —
       but it is always worth a look, so it is counted rather than judged. */
    if (cites === 0) uncited += 1;
    if (words > BODY_WORD_LIMIT) overTarget += 1;
    if (checked.endsInQuestion) questions += 1;
    if (checked.questionLink === "no-id" || checked.questionLink === "unknown-id") unlinkedQuestions += 1;
    if (checked.nudgeWithoutHint) nudgesWithoutHint += 1;
    if (checked.hintProblems.length > 0) hintProblems += 1;
    if (checked.strayHint) strayHints += 1;
    if (out.truncated) truncated += 1;
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    const link =
      checked.questionLink === "linked"
        ? "ends on a question that carries its block id"
        : checked.questionLink === "unknown-id"
          ? `⚠︎ ends on a question whose id the article does not have (${checked.questionIds.join(" ")})`
          : checked.questionLink === "no-id"
            ? "⚠︎ ends on a question with NO block id of its own"
            : "ends without a question";
    const hintLine =
      checked.hint !== null
        ? `hint of ${checked.hintWords} words${checked.hintProblems.length ? ` ⚠︎ ${checked.hintProblems.join(", ")}` : ""}`
        : checked.strayHint
          ? "⚠︎ a hint the panel will show in the open"
          : checked.nudgeWithoutHint
            ? "⚠︎ no hint"
            : "no hint";
    say(
      `### reply — ${words} words before the hint, ${cites} citation${cites === 1 ? "" : "s"}, ${link}, ${hintLine}, ${secs}s${
        hit.length ? `, ⚠︎ banned: ${hit.join(", ")}` : ""
      }${out.truncated ? ", ⚠︎ CUT OFF — hit max_tokens, do not score the ending" : ""}${
        out.stopped ? ", ⚠︎ stopped" : ""
      }`,
    );
    say();
    /* The raw reply, hint and all: it is what is stored, and a reader of this
       file needs to see the `Hint:` paragraph exactly as the model spelt it. */
    say(out.text.trim());
    say();
  }

  const total = CASES.length;
  say("## Counts, which are not the answer");
  say();
  say(`- model: \`${model}\``);
  say(`- answers: ${total}`);
  say(`- containing a banned phrase: **${flagged}** (should be 0)`);
  say(`- citing no block at all: ${uncited} (worth a look; \`unclear\` may rightly be one)`);
  say(`- over the ${BODY_WORD_LIMIT}-word target before the hint: ${overTarget} (a prompt to inspect brevity, not an automatic failure)`);
  say(`- ending on a question, before the hint: ${questions} (most should — the nudge — but not \`lost\`, \`justTellMe\` or \`nudgeFailed\` without an answer first)`);
  say(
    `- **ending on a question that has no block id of its own, or one the article lacks: ${unlinkedQuestions}** (should be 0 for a nudge; \`unclear\`'s clarification may rightly be one. An id elsewhere in the reply does not count)`,
  );
  say(`- ending on a question with no hint: ${nudgesWithoutHint} (should be 0 for a nudge; a clarification has none)`);
  say(
    `- a hint that breaks its ${HINT_WORD_LIMIT}-word, statement, or own-citation rule: ${hintProblems} (should be 0)`,
  );
  say(
    `- **a hint the panel will show in the open: ${strayHints}** (should be 0 — a wrong spelling of \`Hint:\`, one that is not the last paragraph, or one after a reply that asks nothing)`,
  );
  say(
    `- **cut off mid-answer: ${truncated}** (should be 0 — a truncated reply must not be scored for how it ends)`,
  );
  say();
  say(
    "A zero in the first count means nothing on its own. The question these runs exist to answer is whether the `correct`, `defensible` and `disagreement` readers were left alone, whether `lost`, `dontRemember` and `nudgeFailed` were told rather than questioned, and whether each nudge makes the next recollection likely without giving it away — and only reading them says that. For the hints, read each one against its question: does it make the answer much easier to reach without stating it, and does `justTellMe` or `nudgeFailed` talk as if the reader had opened the hint in its history?",
  );

  const out = path.resolve(import.meta.dirname, "results", "remember-recall.md");
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
