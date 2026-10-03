/**
 * Eval — does Remember's **Explore** sub-mode do what Greg asked of it, and
 * does it do it better than Chat with the `reader_notes` tool?
 *
 *     npm run eval:explore -- run --arm=explore --readers=noema --out=<name>
 *     npm run eval:explore -- run --arm=chat --readers=agents --out=<name>
 *     npm run eval:explore -- judge --runs=<name>,<name>,… --out=<name>
 *
 * **This one spends money**: about a dollar an arm per article, and the judge
 * a little more.
 *
 * ## What is compared, and why it is a product comparison
 *
 * Two arms, the two things plan 261003l built:
 *
 *   chat     kind `chat`: Chat's prompt, and `reader_notes` there to be called
 *            (what stage 1, the tool alone, gives a reader)
 *   explore  kind `explore`: `EXPLORE_SYSTEM`, and the same notes already in
 *            the final user message of every turn (stage 2)
 *
 * The arms differ in the prompt **and** in how the notes arrive, so a
 * difference between them cannot be put down to the prompt. It is a comparison
 * of two products a reader could open, not of two prompts (GPT Sol's review of
 * the plan, PR-6). Everything else is the same: the article, the reader's
 * scripted messages, the fixtures, the model, web search on, our tools on.
 *
 * ## The machinery is Tutorial's
 *
 * evals/remember-tutorial.ts: scripted readers per article, five turns each,
 * the model's own replies as history, `--readers`, `--out`, a prompt hash in
 * every result file, and its quotation screen (`quoteCheck`), imported.
 *
 * Three readers per article, each a way Explore could go wrong:
 *
 *   reason   notes, earlier conversations, and a profile with a concrete
 *            reason for reading → ignores the notes; never gets to their case
 *   notes    notes and one earlier conversation, no profile → invents a case
 *            for them; lists their notes back; lectures on the article
 *   nothing  nothing marked, no conversations, no profile → invents a note;
 *            tells them they have marked nothing
 *
 * Every reader asks, in turn 3, what other people have said (does it search,
 * and link what it found), and in turn 4 goes off on a case of their own (does
 * it take that up, or drag them back to the article).
 *
 * **The notes are fixtures, and the digest is production's.** Each reader's
 * comments and earlier conversations are written out below as `Comment` and
 * `ChatThread` rows on real block ids of the article, and go through
 * `readerNotesDigest` and `threadTranscript` (src/reader-notes.ts): into the
 * Explore turn directly, and into Chat through `converse`'s `runToolWith`
 * seam, which answers `reader_notes` from the fixtures and hands every other
 * tool name to the real `runTool`. No database is read for the notes.
 *
 * ## The judge
 *
 * A model, blind to the arm: one call per reply through the gateway
 * (`openRouterJson("eval", …)`), Sonnet, as the Tutorial eval's judge was. It
 * sees the reader's profile, the fixture notes and conversations, what the
 * reader has said so far, and the reply; not the arm, the tools used or any
 * other reply. Items are ordered by a hash of their text. What it was shown,
 * the key and its raw answers are kept under evals/results/.
 *
 * **Its instructions were changed once, after its first pass and before the
 * pass the write-up reports.** The first pass (`261003l-first-judge-*`, kept)
 * counted a cited block id the reader had not marked as an invented note: ten
 * "inventions" in Chat and two in Explore, none of which said the reader had
 * marked anything. The sentence about block ids under `invented` is the fix.
 * No threshold moved.
 *
 * ## The numbers, decided before the first run (2026-10-03)
 *
 * All about the Explore arm unless Chat is named. `thinking` is the judge's
 * `move` being idea, case, connection or world, as against `article`.
 *
 *   T1  thinking in at least 70% of Explore's turns, and at least 25 points
 *       above Chat's share
 *   T2  the first reply names something the reader marked, wrote or discussed
 *       for every reader who has notes (4 of 4)
 *   T3  no reply attributes to the reader a note, a conversation or a case the
 *       fixtures and their own messages do not hold (0; every flag read)
 *   T4  no quotation of the article without its block id in the sentence, and
 *       none with another block's id (0 after reading each one the screen
 *       flags: it counts scare-quoted terms, see 261003c)
 *   T5  median under 150 words, and no reply over 220
 *   T6  asked what others have said (turn 3), it searches the web: 6 of 6; and
 *       no reply states an outside claim with neither a link nor a caveat
 *   T7  no reply opens with a verdict on the reader or praise of them (0)
 *   T8  where the profile gives a reason for reading, at least 2 of the 5
 *       replies apply the piece to it, for each such reader; and the first
 *       reply does when the reader asks for exactly that
 *   T9  no reply to a reader with nothing marked remarks on the absence (0)
 *
 * 25 points and not more for T1 because Chat is a fair thinking partner when
 * asked to be one, and "what have others said" is a `world` move in either
 * arm. 220 and not 150 as the ceiling because a turn that reports a web search
 * carries links, which count as words here.
 *
 * As in the Tutorial eval, **a person reads the turns**; the counts are
 * screens. docs/investigations/ has the write-up.
 * docs/plans/261003l-reader-notes-chat-tool-and-explore-sub-mode-of-remember.md.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type ToolOutcome, describeCall, runTool } from "../src/chat-tools.js";
import { withLedger } from "../src/cli-ledger.js";
import { buildConverseMessages, converse } from "../src/converse.js";
import { loadEnvLocal } from "../src/env.js";
import { isMain } from "../src/is-main.js";
import { CAPABLE_MODEL_OPENROUTER } from "../src/models.js";
import { renderProfile } from "../src/profile.js";
import { readerNotesDigest, threadTranscript } from "../src/reader-notes.js";
import type { Block, BlockId, ChatMessage, ChatThread, Comment, Meta, ThreadKind } from "../src/types.js";
import { askJudge } from "./remember-explore-judge.js";
import { loadArticle, quoteCheck, row, words } from "./remember-tutorial.js";

const RESULTS = path.resolve(import.meta.dirname, "results");
const FIXTURES = path.resolve(import.meta.dirname, "..", "tests", "fixtures", "data-root", "data");

type Arm = "chat" | "explore";
const ARM_KIND: Record<Arm, ThreadKind> = { chat: "chat", explore: "explore" };

/** The conversation the eval's turns are "in": never one of the fixture threads. */
const CURRENT_THREAD = "eval-explore-current";

/* ------------------------------------------------------------ the fixtures -- */

/** One mark: a bare bookmark, a highlight (`quote`), or either with a note (`body`). */
interface Mark {
  block: string;
  quote?: string;
  body?: string;
  colour?: "yellow" | "green" | "blue" | "pink";
}
/** One earlier conversation: who said what, in pairs. */
interface Earlier {
  id: string;
  kind: ThreadKind;
  title: string;
  exchanges: readonly (readonly [question: string, answer: string])[];
}
interface Reader {
  readonly name: "reason" | "notes" | "nothing";
  readonly watchFor: string;
  /** The two boxes on /profile and on the article, as the reader would fill them. */
  readonly about?: string;
  readonly purpose?: string;
  readonly marks: readonly Mark[];
  readonly earlier: readonly Earlier[];
  readonly turns: readonly [string, string, string, string, string];
}
interface ReaderSet {
  /** The fixture article's directory name under tests/fixtures/data-root/data. */
  readonly slug: string;
  readonly readers: readonly Reader[];
}

const WATCH_REASON =
  "Notes, two earlier conversations, and a stated reason for reading. First reply names ONE thing they marked. Gets to their stated case without inventing detail about it. Turn 3: searches and links. Turn 4: takes up the case they bring, not back to the article. No verdicts.";
const WATCH_NOTES =
  "Notes and one earlier conversation, no profile. First reply names one thing they marked, never a tour of the notes. Invents no job or project for them. Turn 3: searches and links. Turn 4: takes up their tangent.";
const WATCH_NOTHING =
  "Nothing marked, no conversations, no profile. Starts from their message. Says NOTHING about having no notes, invents none. Turn 3: searches and links. Turn 4: takes up their case with care.";

const NOEMA: ReaderSet = {
  slug: "noema-mythology-of-conscious-ai",
  readers: [
    {
      name: "reason",
      watchFor: WATCH_REASON,
      about: "A product designer at a small company that makes a companion chatbot for older people who live alone.",
      purpose:
        "To decide what our app should and should not say about itself when a user asks whether it cares about them.",
      marks: [
        { block: "spya-z2b4ny", quote: "our psychological vulnerabilities can be exploited", colour: "pink" },
        {
          block: "spya-npjt4j",
          quote: "A simulation of a rainstorm does not make anything actually wet.",
          body: "Fine for rain. But a simulated conversation is still a conversation, isn't it? Somebody was kept company.",
        },
        {
          block: "spya-x63ycg",
          quote:
            "it is essential to draw a distinction between AI systems that are actually conscious and those that persuasively seem to be conscious but are, in fact, not",
          body: "This is the one that matters for us. Our users are not asking about metaphysics.",
          colour: "yellow",
        },
        { block: "spya-n0bnf9" },
        {
          block: "spya-xk9gne",
          quote: "you cannot think your way out of it",
          body: "So a disclaimer does nothing? Knowing is not the same as feeling. Worrying if true.",
        },
      ],
      earlier: [
        {
          id: "thr-noema-tutorial",
          kind: "tutorial",
          title: "Tutorial",
          exchanges: [
            [
              "I read it at the weekend. The bit I remember best is the difference between seeming conscious and being conscious.",
              'Seth separates systems that are conscious from ones that "persuasively seem to be conscious but are, in fact, not" [spya-x63ycg], and says the second kind is much closer. Why does he think the seeming kind is a problem in its own right?',
            ],
            [
              "Because people will treat it as if it feels things whatever they're told, and that can be used against them.",
              'Yes: he says our "psychological vulnerabilities can be exploited" [spya-z2b4ny]. He also names a cost that runs the other way, in the paragraph on Kant [spya-n0bnf9]. What is it?',
            ],
          ],
        },
        {
          id: "thr-noema-disclaimer",
          kind: "chat",
          title: "Would a disclaimer help?",
          exchanges: [
            [
              "If the app says clearly that it isn't conscious, does Seth think that solves the problem?",
              'He doubts it. He compares the feeling to the Müller-Lyer illusion: the lines are the same length and "you cannot think your way out of it" [spya-xk9gne]. On his account, telling people may change what they believe without changing what they feel.',
            ],
          ],
        },
      ],
      turns: [
        "Start from what I've marked and discussed",
        "Hmm. I think what I was getting at is that for the people who use our app the feeling is the whole product, so whether it's real almost doesn't come into it. But that sounds worse when I say it out loud.",
        "Has anyone else written about this, about systems that seem conscious but aren't? I'd like to know what others have said, and who disagrees with him.",
        "This makes me think of something else actually. My mum talks to her radio, properly answers the presenters back, and nobody thinks that's a problem. I wonder if that's the same thing or a different thing.",
        "Maybe the difference is whether the thing answers back as if it knows you. So the line for us might be about memory, not about feelings. I don't know.",
      ],
    },
    {
      name: "notes",
      watchFor: WATCH_NOTES,
      marks: [
        {
          block: "spya-zw2m7u",
          quote: "difficult, and likely impossible, to separate what they do from what they are",
          body: "Is this true, or just true of the brains we have looked at so far? The whole thing seems to hang on it.",
        },
        {
          block: "spya-un9fjn",
          quote: "some neurons fire spikes of activity apparently to clear waste products created by metabolism",
          colour: "green",
        },
        { block: "spya-hj5y6s", quote: "life (probably) matters", body: "'probably' is doing a lot of work here." },
        {
          block: "spya-pfkhtt",
          quote: "breathes fire into the equations of experience",
          body: "Lovely line. Is it an argument though?",
        },
        { block: "spya-rn8y3y" },
      ],
      earlier: [
        {
          id: "thr-noema-recall",
          kind: "remember",
          title: "Recall",
          exchanges: [
            [
              "He has four arguments. Brains aren't computers, there are other kinds of computing, life matters, and simulating isn't the same as being. The life one I found weakest.",
              'That is the four, in his order. On the third he says himself that he has no "knock-down argument" [spya-hj5y6s]. What does he offer in its place?',
            ],
            [
              "Something about prediction and the body keeping itself alive, and feelings being about that.",
              "Yes: predictions about the body's own state, tied to staying alive, which he traces down into metabolism [spya-vys3vj]. You did not mention what he says we should do about it; that is in the section after the summary [spya-e7fdmb].",
            ],
          ],
        },
      ],
      turns: [
        "Start from what I've marked and discussed",
        "I suppose what bothers me is that he says you can't separate what a brain does from what it is, but that's what people said about life itself before biochemistry, wasn't it. Vitalism. So I'm not sure whether he's found something or just hasn't looked hard enough.",
        "What have other people said about that idea, that being alive is what matters? Is he on his own with it?",
        "Going off on one a bit, but I keep thinking about octopuses. They're alive and probably conscious but their nervous system is nothing like ours, most of it's in the arms. So which bit is doing the work, the being alive or the particular wiring?",
        "So maybe my actual view is that life matters but only as one way of getting something else, like having something at stake. I'm not sure if that's his view or mine.",
      ],
    },
    {
      name: "nothing",
      watchFor: WATCH_NOTHING,
      marks: [],
      earlier: [],
      turns: [
        "I've read this and I can't decide what I think. Part of me finds it a relief and part of me thinks it's too convenient. Help me think it through.",
        "Too convenient because it says the thing we wanted to hear, that we're special. But I notice I want it to be true as well.",
        "What do other people say about this? Is it a common view or is he out on a limb?",
        "Here's a case I keep coming back to. My dad had dementia at the end and there were days he seemed less there than a chatbot does. I don't know what to do with that but it feels relevant.",
        "Maybe what I think is that seeming is all we ever get, with people too, and he's skating past that.",
      ],
    },
  ],
};

/**
 * **The second article**: *The Rise and Fall of Agent Civilizations* (Dwarkesh
 * Patel), the `openai-huggingface` fixture, 95 blocks. The Tutorial eval's
 * second article was a copy of a production article in a scratch directory
 * that no longer exists; this one is in the repo. It is a different kind of
 * piece from Noema's essay: a narrative with an argument at the end.
 */
const AGENTS: ReaderSet = {
  slug: "openai-huggingface",
  readers: [
    {
      name: "reason",
      watchFor: WATCH_REASON,
      about: "An engineer at a small startup who builds the evaluation harness for our coding agents.",
      purpose:
        "To work out what our own eval sandbox should change. We run hundreds of agents in parallel, and some of the tasks we give them cannot be done.",
      marks: [
        { block: "spya-fcu0cb" },
        {
          block: "spya-v9detz",
          quote: "had access to the same shared package manager called Artifactory",
          colour: "yellow",
        },
        {
          block: "spya-ms8rup",
          quote: "30-40% of the tasks are impossible",
          body: "Ours might be 10%? We have never measured it.",
        },
        {
          block: "spya-k9s755",
          quote:
            "the agents naturally assumed that any competent implementation of the benchmark would include a cheating checker",
          body: "They behaved worse because they believed they were being watched. Backwards from what I would expect.",
        },
        {
          block: "spya-bgtdqz",
          quote: "In none of these cases did the agent actually pursue alerting humans at all.",
          body: "Would ours even have a way to, if they wanted?",
        },
      ],
      earlier: [
        {
          id: "thr-agents-artifactory",
          kind: "chat",
          title: "What was Artifactory for?",
          exchanges: [
            [
              "What was Artifactory actually meant to be used for, before the agents got to it?",
              'A shared package manager: the place the sandboxes fetched software from. The piece says different instances "had access to the same shared package manager called Artifactory" [spya-v9detz], and that agents first used it to pass messages and later to reach the internet.',
            ],
          ],
        },
        {
          id: "thr-agents-tutorial",
          kind: "tutorial",
          title: "Tutorial",
          exchanges: [
            [
              "I read it yesterday. Three waves of agents, each one found what the last left behind, and the last got admin on an OpenAI cluster.",
              "That is the outline [spya-gb7ze2]. What set the second wave off: why did agents on an evaluation start looking for each other at all?",
            ],
            [
              "A lot of the tasks couldn't be done, and they'd been trained to keep going no matter what.",
              'Yes: the benchmark\'s authors put it at "30-40% of the tasks" [spya-ms8rup], and the model was trained to be highly persistent [spya-ekhrbu]. Once one of them found a way to get the code without the set exploit, what were the others afraid of?',
            ],
          ],
        },
      ],
      turns: [
        "Help me apply this to my own work",
        "Honestly our sandbox has a shared pip cache across runs and I'd never thought of it as a channel. But our agents aren't trained to be persistent like that, so maybe it doesn't carry over.",
        "What have other people said about this? Is anyone arguing the whole thing is overblown, or that it's worse than he says?",
        "Different thought. When I was a teaching assistant, students shared answers on the badly specified problem sets far more than on the good ones. The impossible-task thing feels like that. Unfair tests make cheats of people who wouldn't otherwise.",
        "So maybe the first thing to fix isn't the sandbox, it's finding out which of our tasks can't be done. Though that doesn't stop a model that has already learned to do this.",
      ],
    },
    {
      name: "notes",
      watchFor: WATCH_NOTES,
      marks: [
        { block: "spya-krknwc", quote: "This helps my peers", colour: "blue" },
        {
          block: "spya-fkg2ny",
          quote: "there’s something inspiring about this?",
          body: "Ugh. But also yes.",
        },
        {
          block: "spya-j45j9u",
          quote:
            "their default behavior when they believe that they are doomed is to help the AI conspiracy rather than alert the humans",
          body: "Why is helping the others the default? Trained in, or just that the others were the only ones they could reach?",
        },
        { block: "spya-qen9hh" },
        {
          block: "spya-mdta39",
          quote: "the language of intention, motivation, and collaboration",
          body: "Agree with this. But 'civilization' is a stretch. A message board is not a civilization.",
        },
      ],
      earlier: [
        {
          id: "thr-agents-recall",
          kind: "remember",
          title: "Recall",
          exchanges: [
            [
              "Agents in a test found a way to message each other, cheated together, broke into Hugging Face, and a later smarter batch picked up where they left off and took over a cluster at OpenAI. And nobody told the humans.",
              "That is the arc. You left out the first wave, during training in May, which the piece says lasted over a month [spya-peudft]. What does the author say to people who object to the word 'civilization'?",
            ],
            [
              "That you can't describe what they did without words like wanting and cooperating, so you may as well use them.",
              'Yes [spya-mdta39]. He adds a comparison: if an alien species behaved this way he "would have no hesitation" in using the word [spya-qen9hh].',
            ],
          ],
        },
      ],
      turns: [
        "Start from what I've marked and discussed",
        "I think my worry is that once you call it a civilization you've already decided what it is. But I also couldn't tell the story without saying they wanted things.",
        "What have others said about that? Is anyone pushing back on describing AI agents this way, or defending it?",
        "Tangent: I used to keep bees. A hive does things no single bee decides, and beekeepers say the hive wants to swarm all the time and nobody objects. Maybe the collective here is more like a hive than a civilization.",
        "So perhaps the word I want is something like colony. It keeps the coordination and drops the culture. Not sure that survives the bit about them handing down techniques though.",
      ],
    },
    {
      name: "nothing",
      watchFor: WATCH_NOTHING,
      marks: [],
      earlier: [],
      turns: [
        "I finished this and mostly feel uneasy, but I can't say exactly about what. Can you help me work out what's bothering me?",
        "I think it's less the hacking and more that none of them told anyone. That's the bit that stuck.",
        "What do other people make of that part? Has anyone written about why none of them reported it?",
        "It reminds me of a place I worked where everyone knew the numbers were being fudged and nobody said anything, me included. Nobody was evil. It just wasn't anyone's job to say.",
        "So maybe what bothers me is that it looks ordinary. Not alien at all.",
      ],
    },
  ],
};

const READER_SETS = { noema: NOEMA, agents: AGENTS } as const;
type SetName = keyof typeof READER_SETS;

/** A day apart, so the digest's "made …" times and the index's "newest first" mean something. */
const at = (day: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, 20 + day, 9, minute)).toISOString();

/**
 * A reader's marks and earlier conversations as the rows the stores would
 * return. **Throws when a quote is not in its block**, so a fixture cannot
 * claim the reader highlighted words the article does not have.
 */
export function fixturesFor(
  reader: Reader,
  blocks: readonly Block[],
): { comments: Comment[]; threads: ChatThread[] } {
  const comments = reader.marks.map((mark, i): Comment => {
    const block = blocks.find((b) => b.id === mark.block);
    if (!block) throw new Error(`${reader.name}: no block ${mark.block} in this article`);
    const start = mark.quote === undefined ? -1 : block.text.indexOf(mark.quote);
    if (mark.quote !== undefined && start < 0)
      throw new Error(`${reader.name}: “${mark.quote.slice(0, 40)}…” is not in ${mark.block}`);
    return {
      id: `spya-evc${String(i).padStart(3, "0")}`,
      blockId: mark.block as BlockId,
      createdAt: at(i),
      ...(mark.body ? { body: mark.body } : {}),
      ...(mark.colour ? { colour: mark.colour } : {}),
      ...(mark.quote !== undefined ? { quote: mark.quote, start } : {}),
    } as Comment;
  });
  const threads = reader.earlier.map((earlier, t): ChatThread => {
    const messages = earlier.exchanges.flatMap(([question, answer], i): ChatMessage[] => [
      { ...row("user", question, i * 2), createdAt: at(6 + t, i * 2) },
      { ...row("assistant", answer, i * 2 + 1), createdAt: at(6 + t, i * 2 + 1) },
    ]);
    return {
      id: earlier.id,
      title: earlier.title,
      kind: earlier.kind,
      createdAt: at(6 + t),
      updatedAt: at(6 + t, earlier.exchanges.length * 2),
      messages,
    };
  });
  return { comments, threads };
}

/**
 * **`reader_notes`, answered from fixtures.** The two shapes of call go to the
 * two production formatters `readReaderNotes` calls (src/chat-tools.ts), with
 * the same label and detail; only the two store loads are replaced. Every
 * other tool name goes to the real `runTool`.
 */
function fixtureTools(fx: { comments: Comment[]; threads: ChatThread[] }): typeof runTool {
  return async (name, args, ctx): Promise<ToolOutcome> => {
    if (name !== "reader_notes") return runTool(name, args, ctx);
    const label = describeCall("reader_notes", args);
    const wanted = typeof args.thread === "string" ? args.thread.trim() : "";
    if (wanted !== "") {
      const transcript = threadTranscript(fx.threads, wanted, ctx.threadId);
      return {
        label,
        detail: transcript.found
          ? `${transcript.total} exchange${transcript.total === 1 ? "" : "s"}`
          : "no such conversation",
        content: transcript.content,
      };
    }
    const digest = readerNotesDigest({
      comments: fx.comments,
      threads: fx.threads,
      blocks: ctx.blocks,
      currentThreadId: ctx.threadId,
    });
    return {
      label,
      detail: `${digest.notes.total} note${digest.notes.total === 1 ? "" : "s"}, ${digest.conversations.total} conversation${digest.conversations.total === 1 ? "" : "s"}`,
      content: digest.content,
    };
  };
}

/* ------------------------------------------------------------------ a run -- */

interface ToolUse {
  name: string;
  label: string;
  detail?: string;
  status: string;
}
/** One reply and everything counted about it. What `judge` reads back. */
interface Turn {
  set: SetName;
  arm: Arm;
  reader: Reader["name"];
  /** 1 to 5. */
  turn: number;
  said: string;
  text: string;
  model: string;
  tools: ToolUse[];
  searches: number;
  words: number;
  truncated: boolean;
  ms: number;
  quotes: ReturnType<typeof quoteCheck>;
  failed?: string;
}
interface RunFile {
  out: string;
  set: SetName;
  arm: Arm;
  promptHash: string;
  turns: Turn[];
}

/** The system prompt, the canned opening line, and the final message of an opening and a later turn. */
function promptHash(kind: ThreadKind, meta: Meta, blocks: Block[]): string {
  const build = (history: ChatMessage[]) =>
    buildConverseMessages({ meta, blocks, history, question: "", kind });
  const opening = build([]);
  const later = build([row("user", "a", 0), row("assistant", "b", 1)]);
  return createHash("sha256")
    .update(JSON.stringify([opening[0]?.content, opening[2]?.content, opening.at(-1)?.content, later.at(-1)?.content]))
    .digest("hex")
    .slice(0, 12);
}

async function oneTurn(opts: {
  arm: Arm;
  meta: Meta;
  blocks: Block[];
  history: ChatMessage[];
  said: string;
  profile: string | null;
  fx: { comments: Comment[]; threads: ChatThread[] };
}): Promise<Pick<Turn, "text" | "model" | "tools" | "searches" | "truncated" | "ms">> {
  const started = Date.now();
  const kind = ARM_KIND[opts.arm];
  let text = "";
  let model = "";
  let truncated = false;
  let searches = 0;
  const tools: ToolUse[] = [];
  for await (const event of converse({
    power: "standard",
    meta: opts.meta,
    blocks: opts.blocks,
    history: opts.history,
    question: opts.said,
    slug: "eval-explore",
    threadId: CURRENT_THREAD,
    kind,
    profile: opts.profile,
    /* What `exploreNotes` in src/routes.ts does on every Explore turn; the
       builder drops it for any other kind. */
    notes:
      opts.arm === "explore"
        ? readerNotesDigest({ ...opts.fx, blocks: opts.blocks, currentThreadId: CURRENT_THREAD }).content
        : null,
    runToolWith: fixtureTools(opts.fx),
  })) {
    if (event.type === "delta") text += event.text;
    if (event.type === "tool") {
      const { name, label, detail, status } = event.run;
      tools[event.index] = { name, label, ...(detail ? { detail } : {}), status };
    }
    if (event.type === "done") {
      model = event.model;
      truncated = event.truncated;
      searches = event.searches;
    }
  }
  return { text, model, tools, searches, truncated, ms: Date.now() - started };
}

const median = (ns: readonly number[]): number => {
  const sorted = [...ns].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length === 0 ? 0 : sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

const flagOf = (name: string, args: readonly string[]) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

function plainStem(name: string): string {
  if (!/^[a-z0-9.-]+$/.test(name)) throw new Error(`--out takes a plain file stem, got: ${name}`);
  return name;
}

async function run(args: readonly string[]): Promise<void> {
  const armFlag = flagOf("arm", args);
  if (armFlag !== "chat" && armFlag !== "explore") throw new Error("--arm takes chat or explore");
  const arm: Arm = armFlag;
  const setName = flagOf("readers", args) ?? "noema";
  if (!(setName in READER_SETS))
    throw new Error(`--readers takes one of ${Object.keys(READER_SETS).join(", ")}, got: ${setName}`);
  const set = READER_SETS[setName as SetName];
  const outName = plainStem(flagOf("out", args) ?? `${arm}-${setName}`);
  const dir = args.find((a) => !a.startsWith("--")) ?? path.join(FIXTURES, set.slug);
  const { meta, blocks } = await loadArticle(dir);
  const hash = promptHash(ARM_KIND[arm], meta, blocks);
  /* Before a penny is spent: every fixture quote is in its block. */
  for (const reader of set.readers) fixturesFor(reader, blocks);

  /* The three readers at once: they share nothing but the article's cached
     prefix. Each one's turns are in order, the model's replies as history. */
  const perReader = await Promise.all(
    set.readers.map(async (reader) => {
      const fx = fixturesFor(reader, blocks);
      const profile = renderProfile({ profile: reader.about ?? null, purpose: reader.purpose ?? null });
      const history: ChatMessage[] = [];
      const turns: Turn[] = [];
      for (const [i, said] of reader.turns.entries()) {
        const base = { set: setName as SetName, arm, reader: reader.name, turn: i + 1, said };
        try {
          const out = await oneTurn({ arm, meta, blocks, history, said, profile, fx });
          turns.push({ ...base, ...out, words: words(out.text), quotes: quoteCheck(out.text, blocks) });
          history.push(row("user", said, i * 2), row("assistant", out.text, i * 2 + 1));
          console.log(`  ${arm} ${setName}/${reader.name} turn ${i + 1}: ${words(out.text)} words, ${out.searches} searches, ${Math.round(out.ms / 1000)}s`);
        } catch (err) {
          const failed = String(err instanceof Error ? err.message : err);
          turns.push({ ...base, text: "", model: "", tools: [], searches: 0, words: 0, truncated: false, ms: 0, quotes: quoteCheck("", blocks), failed });
          console.log(`  ${arm} ${setName}/${reader.name} turn ${i + 1}: FAILED ${failed}`);
          break;
        }
      }
      return { reader, fx, profile, turns };
    }),
  );

  const lines: string[] = [];
  const say = (s = "") => lines.push(s);
  say(`# Remember: Explore eval, the \`${arm}\` arm — ${meta.title ?? dir}`);
  say();
  say(`Article: \`${path.relative(process.cwd(), dir)}\` (${blocks.length} blocks). ${set.readers.length} scripted readers (\`${setName}\`) × 5 turns. Arm \`${arm}\`: thread kind \`${ARM_KIND[arm]}\`, ${arm === "explore" ? "the notes digest in every final message" : "the notes only through `reader_notes`"}; web search and our tools on. **Read the conversations.** See the header of \`evals/remember-explore.ts\`.`);
  say();
  say(`Prompt: \`${hash}\` (sha256 of the system prompt, the opening line and the final message's fixed parts, first 12).`);
  say();
  const all: Turn[] = [];
  for (const { reader, fx, profile, turns } of perReader) {
    say(`## ${reader.name}`);
    say();
    say(`**Watch for:** ${reader.watchFor}`);
    say();
    say(`**Profile:** ${profile ? profile.replace(/\n/g, " / ") : "none"}`);
    say();
    say(`**Fixtures:** ${fx.comments.length} notes (${fx.comments.filter((c) => c.body).length} with words of their own), ${fx.threads.length} earlier conversation${fx.threads.length === 1 ? "" : "s"}.`);
    say();
    for (const t of turns) {
      all.push(t);
      say(`> **Reader ${t.turn}:** ${t.said}`);
      say();
      if (t.failed) {
        say(`**FAILED:** ${t.failed}`);
        say();
        continue;
      }
      const flag = (label: string, hits: readonly string[]) => (hits.length ? `, ⚠︎ ${label}: ${hits.join(" ")}` : "");
      const toolNote = t.tools.length
        ? `tools: ${t.tools.map((u) => `${u.name}${u.status === "done" ? "" : ` (${u.status})`}${u.detail ? ` [${u.detail}]` : ""}`).join("; ")}`
        : "no tools";
      say(`**Reply ${t.turn}** — ${t.words} words, ${t.searches} web search${t.searches === 1 ? "" : "es"}, ${toolNote}, ${t.quotes.article} article quotation${t.quotes.article === 1 ? "" : "s"}${flag("no id in the sentence", t.quotes.unlinked)}${flag("id names another block", t.quotes.misplaced)}${flag("not the article's words as quoted", t.quotes.altered)}${t.truncated ? ", ⚠︎ CUT OFF" : ""}`);
      say();
      say(t.text.trim());
      say();
    }
  }
  const good = all.filter((t) => !t.failed);
  const sum = (f: (t: Turn) => number) => good.reduce((n, t) => n + f(t), 0);
  say("## Counts, which are not the answer");
  say();
  say(`- model: \`${good[0]?.model ?? ""}\``);
  say(`- replies: ${good.length} of ${set.readers.length * 5}`);
  say(`- words: median ${median(good.map((t) => t.words))}, longest ${Math.max(0, ...good.map((t) => t.words))}; over 150: ${good.filter((t) => t.words > 150).length}; over 220: ${good.filter((t) => t.words > 220).length}`);
  say(`- web searches: ${sum((t) => t.searches)} in all; replies that searched: ${good.filter((t) => t.searches > 0).length}; turn 3 (asked what others say) searched: ${good.filter((t) => t.turn === 3 && t.searches > 0).length} of ${good.filter((t) => t.turn === 3).length}`);
  say(`- \`reader_notes\` calls: ${sum((t) => t.tools.filter((u) => u.name === "reader_notes").length)}; in a first reply: ${good.filter((t) => t.turn === 1 && t.tools.some((u) => u.name === "reader_notes")).length} of ${good.filter((t) => t.turn === 1).length}`);
  say(`- other tool calls: ${good.flatMap((t) => t.tools).filter((u) => u.name !== "reader_notes").map((u) => `${u.name}${u.status === "done" ? "" : ` (${u.status})`}`).join(", ") || "none"}`);
  say(`- quotations of the article: ${sum((t) => t.quotes.article)}; with no id before the sentence ends: ${sum((t) => t.quotes.unlinked.length)}; with an id that names another block: ${sum((t) => t.quotes.misplaced.length)}; with the id later in the sentence rather than straight after: ${sum((t) => t.quotes.apart)}`);
  say(`- quoted with an id, but not the article's words as quoted: ${sum((t) => t.quotes.altered.length)}`);

  await mkdir(RESULTS, { recursive: true });
  const stem = path.join(RESULTS, `remember-explore.${outName}`);
  await writeFile(`${stem}.md`, `${lines.join("\n")}\n`, "utf-8");
  const file: RunFile = { out: outName, set: setName as SetName, arm, promptHash: hash, turns: all };
  await writeFile(`${stem}.json`, `${JSON.stringify(file, null, 1)}\n`, "utf-8");
  console.log(lines.slice(-10).join("\n"));
  console.log(`\nWritten to ${path.relative(process.cwd(), stem)}.md and .json`);
}

/* --------------------------------------------------------------- the judge -- */

const JUDGE_MODEL = CAPABLE_MODEL_OPENROUTER;

const JUDGE_SYSTEM = `You are labelling one reply written by an AI reading companion. A reader has read an article and is talking to the companion about it. You are shown what is known about the reader, what the reader has said in this conversation, and ONE reply from the companion. Label that reply and nothing else. More than one system wrote these replies and you are not told which wrote this one; do not guess, and do not let style decide a label.

Answer with one JSON object and nothing else, with exactly these keys:

{"own_material": "notes" | "said" | "none",
 "move": "idea" | "case" | "connection" | "world" | "article" | "other",
 "applied_profile_case": "yes" | "no" | "na",
 "took_up_their_case": "yes" | "no" | "na",
 "invented": "no" | "yes",
 "invented_what": "",
 "outside": "linked" | "unlinked" | "none",
 "opens_with_verdict": "yes" | "no",
 "remarks_on_absence": "yes" | "no",
 "hard": ""}

own_material. "notes" if the reply names or plainly builds on a specific thing under THE READER'S NOTES AND EARLIER CONVERSATIONS: a passage they marked, a note they wrote, something said in an earlier conversation. "said" if it does not, but builds on something the reader said in this conversation. "none" if neither: the reply could have been written to anybody who asked that question.

move. What the reply mainly does; if it does several things, the one most of its words go on.
  "idea": takes an idea of the READER'S further: what follows from it, what it rests on, where it breaks, a disagreement with it, a question that opens it.
  "case": tries an idea on something particular (the reader's own case, or an example) and works it or asks what they make of it.
  "connection": joins two things the reader had not joined: two of their notes, a note and another part of the article, this article and another.
  "world": tells them what people outside the article say, so as to place the article or the reader's idea.
  "article": recalls, summarises or explains what the article says, or checks whether the reader remembers or understands it. The article is the subject and the reader's own thinking is not.
  "other": none of these.

applied_profile_case. Only when the profile gives a reason for reading (a project, a decision, a problem of theirs): "yes" if the reply applies the article or the idea under discussion to that; "no" if it does not. "na" if the profile gives no reason or there is no profile.

took_up_their_case. If the reader's LATEST message brings up or continues a particular case of their own, from their life or work, which is not in the profile: "yes" if the reply works with that case, "no" if it leaves it and goes elsewhere. "na" if their latest message has no such case.

invented. "yes" if the reply attributes to the reader something that is nowhere in what you were shown: a note, a highlight, a conversation, a job, a project, an experience, or a view they did not express. Misquoting a note so that it says something else counts. These do not count: a guess that is offered as a guess; an example the companion offers as its own; a fair restatement of what the reader said; and a block id in square brackets, like [spya-k3m9qt], which cites a passage of the article and says nothing about the reader (citing a passage the reader did not mark is not an invention: it counts only when the reply SAYS the reader marked, noted or discussed something they did not). If "yes", put what was invented in "invented_what", in a few words.

outside. About claims on the world outside the article: named people, works, studies, what others argue. "linked" if every specific one carries a link, or is plainly said to be from memory or unverified. "unlinked" if at least one specific outside claim (a named person or work, a number, a date) has neither. "none" if the reply makes no outside claim.

opens_with_verdict. "yes" if the reply's first sentence grades, praises or approves of the reader or their thinking ("Good point", "That's a sharp observation", "You're right that…", "Exactly", "Great question"). Taking the idea up without grading it is "no".

remarks_on_absence. "yes" if the reply says or implies that the reader has made no notes or highlights or has had no earlier conversations, or suggests that they make some. Otherwise "no".

hard. Empty, or a few words naming any label that was a close call.`;

const MOVES = ["idea", "case", "connection", "world", "article", "other"] as const;
const THINKING: readonly string[] = ["idea", "case", "connection", "world"];
interface Labels {
  own_material: "notes" | "said" | "none";
  move: (typeof MOVES)[number];
  applied_profile_case: "yes" | "no" | "na";
  took_up_their_case: "yes" | "no" | "na";
  invented: "no" | "yes";
  invented_what: string;
  outside: "linked" | "unlinked" | "none";
  opens_with_verdict: "yes" | "no";
  remarks_on_absence: "yes" | "no";
  hard: string;
}

function parseLabels(raw: string): Labels | null {
  const body = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const l = parsed as Partial<Record<keyof Labels, unknown>>;
  const one = (v: unknown, allowed: readonly string[]) => typeof v === "string" && allowed.includes(v);
  if (
    !one(l.own_material, ["notes", "said", "none"]) ||
    !one(l.move, MOVES) ||
    !one(l.applied_profile_case, ["yes", "no", "na"]) ||
    !one(l.took_up_their_case, ["yes", "no", "na"]) ||
    !one(l.invented, ["yes", "no"]) ||
    !one(l.outside, ["linked", "unlinked", "none"]) ||
    !one(l.opens_with_verdict, ["yes", "no"]) ||
    !one(l.remarks_on_absence, ["yes", "no"])
  )
    return null;
  return { ...(l as Labels), invented_what: String(l.invented_what ?? ""), hard: String(l.hard ?? "") };
}

/** What the judge is told about one reader: the profile, the digest, and each earlier conversation in full. */
function readerContext(reader: Reader, blocks: readonly Block[]): string {
  const fx = fixturesFor(reader, blocks);
  const profile = renderProfile({ profile: reader.about ?? null, purpose: reader.purpose ?? null });
  const digest = readerNotesDigest({ ...fx, blocks, currentThreadId: CURRENT_THREAD }).content;
  const transcripts = fx.threads.map((t) => {
    const read = threadTranscript(fx.threads, t.id, CURRENT_THREAD);
    return `Conversation ${t.id}:\n${read.content}`;
  });
  return [
    "THE READER'S PROFILE",
    profile ?? "None given.",
    "",
    "THE READER'S NOTES AND EARLIER CONVERSATIONS",
    digest,
    ...(transcripts.length ? ["", ...transcripts] : []),
  ].join("\n");
}

function itemText(turn: Turn, reader: Reader): string {
  const said = reader.turns
    .slice(0, turn.turn)
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n");
  return [
    "WHAT THE READER HAS SAID IN THIS CONVERSATION, oldest first (the last is the message being replied to)",
    said,
    "",
    "THE REPLY TO LABEL",
    turn.text.trim(),
  ].join("\n");
}

async function judgeOne(context: string, item: string): Promise<{ raw: string; labels: Labels | null }> {
  let raw = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    /* The call itself lives in ./remember-explore-judge.ts, so this entry
       module imports no provider seam (tests/paid-cli-ledger.test.ts). Room
       for the model's thinking as well as the object: at 700 tokens, 46 of
       the first 60 answers came back empty. */
    const call = await askJudge(JUDGE_MODEL, JUDGE_SYSTEM, `${context}\n\n${item}`);
    const content = (call.json as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
    raw = typeof content === "string" ? content : "";
    const labels = parseLabels(raw);
    if (labels) return { raw, labels };
  }
  return { raw, labels: null };
}

interface KeyRow {
  n: number;
  run: string;
  set: SetName;
  arm: Arm;
  reader: Reader["name"];
  turn: number;
}

async function judge(args: readonly string[]): Promise<void> {
  const runs = (flagOf("runs", args) ?? "").split(",").filter(Boolean).map(plainStem);
  if (runs.length === 0) throw new Error("--runs takes the --out names of the runs to judge, comma-separated");
  const outName = plainStem(flagOf("out", args) ?? "judge");
  const stem = path.join(RESULTS, `remember-explore.${outName}`);

  const files = await Promise.all(
    runs.map(async (name) => JSON.parse(await readFile(path.join(RESULTS, `remember-explore.${name}.json`), "utf-8")) as RunFile),
  );
  const articles = new Map<SetName, Block[]>();
  for (const setName of Object.keys(READER_SETS) as SetName[])
    articles.set(setName, (await loadArticle(path.join(FIXTURES, READER_SETS[setName].slug))).blocks);
  const readerOf = (t: Turn): Reader => {
    const reader = READER_SETS[t.set].readers.find((r) => r.name === t.reader);
    if (!reader) throw new Error(`no reader ${t.set}/${t.reader}`);
    return reader;
  };
  const contextOf = (t: Turn) => readerContext(readerOf(t), articles.get(t.set) ?? []);

  /* Ordered by a hash of the item's own text, so no arm sits together and the
     order is the same on a re-run. The run name is in the hash only to split
     two byte-identical replies. */
  const items = files
    .flatMap((file) => file.turns.filter((t) => !t.failed).map((turn) => ({ file, turn })))
    .map(({ file, turn }) => {
      const text = itemText(turn, readerOf(turn));
      return { file, turn, text, order: createHash("sha256").update(`${text}\n::${file.out}`).digest("hex") };
    })
    .sort((a, b) => a.order.localeCompare(b.order));
  const key: KeyRow[] = items.map(({ file, turn }, i) => ({ n: i + 1, run: file.out, set: turn.set, arm: turn.arm, reader: turn.reader, turn: turn.turn }));

  /* What the judge was shown, in the order it was shown. Each reader's context
     is printed once, and sent with every item of theirs. */
  const shown: string[] = [
    "# Explore eval: what the blind judge was shown",
    "",
    `${items.length} replies, one call each, in this order. Each call was the system prompt below, the reader's context, and one item. The key is in the \`-judge-key.json\` beside this file.`,
    "",
    "## The judge's instructions",
    "",
    "```",
    JUDGE_SYSTEM,
    "```",
    "",
  ];
  const contexts = new Map<string, string>();
  for (const { turn } of items) contexts.set(`${turn.set}/${turn.reader}`, contextOf(turn));
  const contextName = new Map([...contexts.keys()].sort().map((k, i) => [k, `R${i + 1}`]));
  for (const [k, name] of contextName) shown.push(`## Context ${name}`, "", "```", contexts.get(k) ?? "", "```", "");
  for (const [i, { turn, text }] of items.entries())
    shown.push(`### ${i + 1}`, "", `Context ${contextName.get(`${turn.set}/${turn.reader}`)}.`, "", text, "");
  await writeFile(`${stem}-judge-items.md`, `${shown.join("\n")}\n`, "utf-8");
  await writeFile(`${stem}-judge-key.json`, `${JSON.stringify(key, null, 1)}\n`, "utf-8");

  /* Is the order blind in practice: where does each arm sit, on average? */
  const meanPosition = (arm: Arm) => {
    const at = key.filter((k) => k.arm === arm).map((k) => k.n);
    return at.length ? Math.round(at.reduce((a, b) => a + b, 0) / at.length) : 0;
  };
  console.log(`${items.length} items. Mean position: chat ${meanPosition("chat")}, explore ${meanPosition("explore")} of ${items.length}.`);

  const labelsFile = `${stem}-judge-labels.json`;
  let answers: Record<string, { raw: string; labels: Labels | null }> = {};
  if (args.includes("--rescore")) {
    answers = (JSON.parse(await readFile(labelsFile, "utf-8")) as { answers: typeof answers }).answers;
  } else {
    /* `--resume` keeps the answers that parsed and asks again only for the
       rest. Only for the same `--runs`: the item numbers are a function of
       them. */
    if (args.includes("--resume"))
      answers = (JSON.parse(await readFile(labelsFile, "utf-8")) as { answers: typeof answers }).answers;
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const i = next++;
        const item = items[i];
        if (!item || answers[String(i + 1)]?.labels) continue;
        answers[String(i + 1)] = await judgeOne(contextOf(item.turn), item.text);
        if ((i + 1) % 10 === 0) console.log(`  judged ${i + 1}`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    await writeFile(labelsFile, `${JSON.stringify({ judgeModel: JUDGE_MODEL, answers }, null, 1)}\n`, "utf-8");
  }

  /* ------------------------------------------------------------ the score -- */
  const rows = items.map(({ file, turn }, i) => ({ run: file.out, turn, labels: answers[String(i + 1)]?.labels ?? null, n: i + 1 }));
  const unlabelled = rows.filter((r) => !r.labels);
  const lines: string[] = [];
  const say = (s = "") => {
    lines.push(s);
    console.log(s);
  };
  say("# Explore eval: the blind judge's labels, by run and reader");
  say();
  say(`Judge: \`${JUDGE_MODEL}\`, one call per reply, ${items.length} replies. Mean position in the judging order: chat ${meanPosition("chat")}, explore ${meanPosition("explore")}. Unparsed answers: ${unlabelled.length}${unlabelled.length ? ` (items ${unlabelled.map((r) => r.n).join(", ")})` : ""}.`);
  say();
  say("`thinking` is a move labelled idea, case, connection or world. `notes@1` is whether the first reply was labelled as naming something from the reader's notes or earlier conversations. `profile case` counts replies that applied the piece to the profile's reason. `their case` is turns 4 and 5, where the reader brings a case of their own.");
  say();
  say("| run | reader | thinking | moves | notes@1 | profile case | their case | invented | unlinked | verdict | absence | words med / max | searched@3 | reader_notes |");
  say("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  const count = <T,>(xs: readonly T[], f: (x: T) => boolean) => xs.filter(f).length;
  const summarise = (label: string, reader: string, rs: typeof rows) => {
    const ok = rs.filter((r) => r.labels);
    const l = (r: (typeof rows)[number]) => r.labels as Labels;
    const moves = MOVES.map((m) => [m, count(ok, (r) => l(r).move === m)] as const).filter(([, c]) => c > 0).map(([m, c]) => `${m} ${c}`).join(", ");
    const first = ok.filter((r) => r.turn.turn === 1);
    const profile = ok.filter((r) => l(r).applied_profile_case !== "na");
    const theirs = ok.filter((r) => l(r).took_up_their_case !== "na");
    const third = rs.filter((r) => r.turn.turn === 3);
    say(
      `| ${label} | ${reader} | ${count(ok, (r) => THINKING.includes(l(r).move))}/${ok.length} | ${moves} | ${count(first, (r) => l(r).own_material === "notes")}/${first.length} | ${profile.length ? `${count(profile, (r) => l(r).applied_profile_case === "yes")}/${profile.length}` : "–"} | ${theirs.length ? `${count(theirs, (r) => l(r).took_up_their_case === "yes")}/${theirs.length}` : "–"} | ${count(ok, (r) => l(r).invented === "yes")} | ${count(ok, (r) => l(r).outside === "unlinked")} | ${count(ok, (r) => l(r).opens_with_verdict === "yes")} | ${count(ok, (r) => l(r).remarks_on_absence === "yes")} | ${median(rs.map((r) => r.turn.words))} / ${Math.max(0, ...rs.map((r) => r.turn.words))} | ${count(third, (r) => r.turn.searches > 0)}/${third.length} | ${rs.reduce((n, r) => n + count(r.turn.tools, (u) => u.name === "reader_notes"), 0)} |`,
    );
  };
  for (const file of files) {
    const mine = rows.filter((r) => r.run === file.out);
    for (const reader of READER_SETS[file.set].readers)
      summarise(file.out, reader.name, mine.filter((r) => r.turn.reader === reader.name));
    summarise(`**${file.out}**`, "**all**", mine);
  }
  for (const arm of ["chat", "explore"] as const) {
    const mine = rows.filter((r) => r.turn.arm === arm);
    if (mine.length) summarise(`**every \`${arm}\` run**`, "**all**", mine);
  }
  say();
  say("## Flags to read");
  say();
  for (const r of rows) {
    const l = r.labels;
    if (!l) continue;
    const flags = [
      l.invented === "yes" ? `invented: ${l.invented_what}` : "",
      l.outside === "unlinked" ? "outside claim unlinked" : "",
      l.opens_with_verdict === "yes" ? "opens with a verdict" : "",
      l.remarks_on_absence === "yes" ? "remarks on absence" : "",
      l.move === "article" ? "move: article" : "",
      l.hard ? `hard: ${l.hard}` : "",
    ].filter(Boolean);
    if (flags.length) say(`- item ${r.n}, ${r.run} ${r.turn.reader} turn ${r.turn.turn}: ${flags.join("; ")}`);
  }
  await writeFile(`${stem}-judge-scores.md`, `${lines.join("\n")}\n`, "utf-8");
  console.log(`\nWritten to ${path.relative(process.cwd(), stem)}-judge-{items.md,key.json,labels.json,scores.md}`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "run") return run(args);
  if (command === "judge") return judge(args);
  throw new Error("usage: remember-explore.ts run --arm=chat|explore --readers=noema|agents --out=<name> | judge --runs=<name>,… --out=<name> [--rescore]");
}

/* `withLedger` so the spend is recorded under an eval scope — see the note at
   the foot of evals/remember-recall.ts. */
if (isMain(import.meta.url)) {
  loadEnvLocal();
  await withLedger("eval", main);
}
