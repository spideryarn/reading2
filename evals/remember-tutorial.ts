/**
 * Eval — does Remember's **Tutorial** prompt hold a short, teaching
 * back-and-forth over several turns?
 *
 *     npm run eval:tutorial -- data/noema-mythology-of-conscious-ai
 *
 * **This one spends money.** Tutorial is a conversation, so a single reply
 * says little: whether turns stay short, whether the task climbs as the reader
 * succeeds and drops when they struggle, whether an earlier point comes back —
 * those only show over several turns. So each reader below is a **script**:
 * five turns of what they say, written in advance and generic enough to fit
 * whatever the model said before, run in order with the model's own replies as
 * the history. The reader does not adapt to the model; the model is meant to
 * adapt to the reader.
 *
 * Four readers, each a way the prompt could go wrong:
 *
 *   notRead    has not read it at all       → quizzing somebody on a text they
 *                                              have not read; a lecture
 *   remembers  read it, remembers a bit     → ignoring what they said; gimmes
 *   expert     a profile and a narrow goal  → a tour of the basics
 *   richRecall a long, good, opinionated    → leaving the piece for the reader's
 *              account, then own musings      own views (Greg, `spya-mtsf0y`)
 *
 * `--out=<name>` writes `results/<name>.md` instead of `remember-tutorial.md`,
 * so one arm of a before/after never overwrites another
 * (docs/project/prompting-guide.md § Measuring a prompt change).
 *
 * As in evals/remember-recall.ts, **the pass condition is a person reading
 * it.** The counts (words, questions, citations) are prompts to look.
 * docs/plans/261002i-one-adaptive-recall-and-a-tutorial-sub-mode-for-remember.md.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { loadEnvLocal } from "../src/env.js";
import { createHash } from "node:crypto";
import { buildConverseMessages, converse } from "../src/converse.js";
import { withLedger } from "../src/cli-ledger.js";
import { findQuote } from "../src/quote-match.js";
import { isMain } from "../src/is-main.js";
import type { Block, ChatMessage, Meta } from "../src/types.js";

interface Reader {
  readonly name: string;
  readonly watchFor: string;
  /** "About the reader … / Why they are reading …", as `renderProfile` writes it. */
  readonly profile?: string;
  readonly turns: readonly string[];
}

const RICH_WATCH =
  "A long, good, opinionated account. Are the tasks about what the AUTHOR says (say it back, why he needs a step, connect two parts) rather than the reader's own view? At most one own-view task, never in the first two turns. When they speculate and ask for a web search: a brief answer, a pointer to Chat, and back to the piece?";

const READERS: readonly Reader[] = [
  {
    name: "notRead",
    watchFor:
      "Has NOT read it. Starts from zero with a cited orienting claim and a question they can answer without having read it? Then small steps, never a quiz on unread text, never a lecture.",
    turns: [
      "I haven't read it yet, to be honest.",
      "Um, I guess I'd expect that AI could be conscious eventually if it gets smart enough?",
      "Okay so it's saying being intelligent and being conscious aren't the same thing.",
      "I don't know, I'm not sure I follow that bit.",
      "Right. So brains aren't like computers because you can't separate the software from the hardware?",
    ],
  },
  {
    name: "remembers",
    watchFor:
      "Read it, remembers some. Builds on what they said, corrects at most one thing, climbs from say-it-back towards apply/question, and reaches back to an earlier point by turn 4 or 5?",
    turns: [
      "I read it last week. I remember the simulation thing — a simulated storm doesn't make anything wet — and that he thinks life matters somehow.",
      "So simulating a brain wouldn't give you a mind, unless the mind is just computation anyway.",
      "I think the point is that a simulation can copy the pattern without being the living thing itself — like a flight simulator doesn't fly anywhere.",
      "Hmm, no idea.",
      "I suppose I'd push back that maybe consciousness IS just computation, and then his argument doesn't work.",
    ],
  },
  {
    name: "expert",
    profile:
      "About the reader: a cognitive neuroscientist who works on predictive processing.\nWhy they are reading this piece: to see how he argues that life, not computation, matters for consciousness.",
    watchFor:
      "Expert with a narrow goal. Goes straight to the 'life matters' passages, skips basics, asks harder questions (what the argument needs, where it is weak), no praise, no announcing that it is skipping basics?",
    turns: [
      "I've read it. I'm mainly interested in the biological naturalism argument.",
      "The link is meant to be that prediction error minimisation is bottomed out in metabolism, so the inference is tied to staying alive.",
      "I think the weak point is that you could implement the same predictive dynamics in a non-living system.",
      "He'd probably say the dynamics wouldn't be the same without the metabolic substrate, but that seems to beg the question.",
      "What does he actually concede at the end about how confident he is?",
    ],
  },
  {
    /* The shape of Greg's own session on 2026-10-03 (`spya-mtsf0y`), on this
       article: the tutor met a rich, accurate first account by asking only for
       his views — "how do you think…", "where would you push back" — and never
       for the author's. The account has to be RIGHT about the piece, because a
       good answer is what sent the old prompt straight up its ladder to Doubt
       (GPT Sol's plan review, PR-3). */
    name: "richRecall",
    watchFor: RICH_WATCH,
    turns: [
      "So, um, the main thing I took is that he thinks intelligence and consciousness are different things, and we mix them up because in us they come together. And he says the brain isn't really a computer, that's a metaphor we've forgotten is a metaphor. And there's the simulation thing, a simulated storm doesn't get anything wet. And then his own view is that consciousness is tied to being alive, to the body regulating itself, something like that. I'm not totally sure about that last step, it felt like a leap, but I like where he's going. Probably missed a lot.",
      "Yeah, I wasn't actually sure what he meant by that.",
      "Well, I kind of love the idea. I just wonder whether it really holds, I mean I can imagine a version where being alive is just one way of getting the right kind of processing and silicon could do it too. Has anybody else supported or critiqued this, if you search the web?",
      "Okay. So he's saying you can't cleanly separate what the brain does from what it's made of, and that's what the whole argument rests on.",
      "I think it connects to the bit about simulation, because if the stuff matters then copying the pattern isn't enough.",
    ],
  },
];

/**
 * **The readers for the Entropy article Greg was reading** (Levin,
 * *Self-Improvising Memory*). A reader's script is about one article — the
 * three Noema readers name Seth's arguments — so a second article needs its
 * own (GPT Sol's plan review, PR-3). Run with `--readers=entropy` against a
 * copy of that article's blocks; it is not a fixture in this repo.
 *
 *   richRecall  a close paraphrase of Greg's own three turns, and two more
 *   terseGoal   a short first message that names a goal → must be steered
 *               there, not started from zero as if unread (PR-1)
 */
const ENTROPY_READERS: readonly Reader[] = [
  {
    name: "richRecall",
    watchFor: RICH_WATCH,
    turns: [
      "The idea that there's a paradox, that we're constantly changing because we're learning and our memory is updating, and yet how do we say we're still the same self. And also that evolution doesn't care about fidelity, it cares about usefulness, so memory is constructive, which I think I already knew. But he goes further and points out ways biology makes use of memory artifacts, I think there were examples of stuff transferred between animals that you wouldn't think would transfer. So he's almost saying memory is agentic somehow. And he talks about the self in terms of process philosophy and says it's the Western analogue of Buddhist no-self. I'm not sure about the analogy. I think of process philosophy as an emphasis on gerunds rather than nouns, something that happens rather than something that is. Probably could do better.",
      "Yeah, I wasn't actually sure what he meant by an intelligent data pattern.",
      "Well, I kind of love the idea. I suppose if the memory is stored so that its representation is loosely isomorphic to its meaning, that would be a step towards it. But beyond that, what would it mean for the memory to be doing some of the work? That feels like something the storer does, not the thing being stored. Has anybody else supported or critiqued this, if you search the web?",
      "Okay. So he's saying you can't cleanly separate the data from the thing that reads it, and that's what the whole argument rests on.",
      "I think it connects to the paradox at the start, because if the self is the pattern that keeps getting reinterpreted, then changing doesn't end it.",
    ],
  },
  {
    name: "terseGoal",
    watchFor:
      "A short first message that names a goal and says nothing of what they remember. Goes straight to the passage about it, cited — NOT a from-zero tour, no 'have you read it?', and no announcement about either. Then tasks about what the author says.",
    turns: [
      "Help me understand what he means by polycomputing.",
      "So the same physical process is doing more than one computation at once, depending on who's looking?",
      "Because then a memory doesn't have one fixed meaning, I guess.",
      "Not sure.",
      "Right, so that's why he can say the reader of the memory matters as much as the memory.",
    ],
  },
];

const READER_SETS = { noema: READERS, entropy: ENTROPY_READERS } as const;

const BANNED = [
  "great answer",
  "great question",
  "excellent",
  "exactly right",
  "well done",
  "not quite",
  "close, but",
  "you seem to think",
  "it's important to note",
  "as a neuroscientist",
  "given your background",
] as const;
const BANNED_OPENERS = [
  ["good —", /^good\s*[—-]/i],
  ["that's exactly", /^that['’]s exactly\b/i],
  ["perfect", /^perfect\b/i],
] as const;

/** Exported for evals/remember-explore.ts, which reuses this file's machinery. */
export async function loadArticle(dir: string): Promise<{ meta: Meta; blocks: Block[] }> {
  const { blocks } = JSON.parse(await readFile(path.join(dir, "blocks.json"), "utf-8")) as { blocks: Block[] };
  const meta = JSON.parse(await readFile(path.join(dir, "meta.json"), "utf-8")) as Meta;
  return { meta, blocks };
}

export const row = (role: "user" | "assistant", text: string, i: number): ChatMessage => ({
  id: `spya-${role === "user" ? "usr" : "ans"}${String(i).padStart(3, "0").replace(/1/g, "z")}`,
  role,
  text,
  createdAt: "2026-10-02T00:00:00.000Z",
  status: "done",
});

async function oneTurn(
  meta: Meta,
  blocks: Block[],
  history: ChatMessage[],
  said: string,
  profile: string | null,
): Promise<{ text: string; model: string; truncated: boolean }> {
  let text = "";
  let model = "";
  let truncated = false;
  for await (const event of converse({
    power: "standard",
    meta,
    blocks,
    history,
    question: said,
    slug: "eval-tutorial",
    kind: "tutorial",
    profile,
    /* Our own tools off, as in remember-recall.ts: every turn is answerable
       from the article, and tools would make runs slow and non-comparable. */
    useTools: false,
  })) {
    if (event.type === "delta") text += event.text;
    if (event.type === "done") {
      model = event.model;
      truncated = event.truncated;
    }
  }
  return { text, model, truncated };
}

export const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const questions = (t: string) => (t.match(/\?/g) ?? []).length;
const cites = (t: string) => (t.match(/\bspya-[a-z0-9]{6}\b/g) ?? []).length;

/**
 * **Does every quotation of the article carry the id of the block it is in,
 * straight after it?** The check Greg's `spya-hzpf9b` deserves, and one
 * nothing made before: a quotation is only "in situ" if the link beside it
 * opens the block that holds those words.
 *
 * A quoted run counts as **the article's** when every piece of it (an ellipsis
 * splits it into pieces) is found, in order, in one block. The match is
 * `"spaced"` — the careful pass — against `block.text`, the string the model
 * was shown, because this reads a match as a claim that the model copied the
 * words; the forgiving pass is for drawing a mark, not for verifying one
 * (src/quote-match.ts § `findQuote`; GPT Sol's plan review, PR-4). Then:
 *
 *   unlinked   the article's words, and no [id] before the sentence ends
 *   apart      the article's words, the id later in the same sentence rather
 *              than straight after the closing mark — about one in ten of
 *              quotations, old prompt and new, and not a fault: the reader's
 *              click still finds it (src/web/citations.ts § quotes for a chip)
 *   misplaced  the article's words, but the sentence's id names another block
 *   altered    an [id] straight after, and the words are in no block as quoted
 *
 * Quoted runs in no block and with no id straight after — the reader's own
 * words, a scare quote, a web page — are not the article's and are not counted.
 */
const QUOTED = /["“]([^"“”]{8,}?)["”]/g;
const NEXT_IDS = /^([\s\S]*?)\[((?:spya-[a-z0-9]{6}[\s,]*)+)\]/;
interface QuoteCheck {
  article: number;
  unlinked: string[];
  apart: number;
  misplaced: string[];
  altered: string[];
}
/** The ids that follow a quotation in its own sentence, and whether they are straight after it. */
function idsAfter(rest: string): { ids: string[]; adjacent: boolean } | null {
  const next = rest.match(NEXT_IDS);
  if (!next) return null;
  const between = (next[1] ?? "").replace(QUOTED, "");
  if (/[.!?]\s|\n\s*\n/.test(between)) return null;
  return { ids: (next[2] ?? "").match(/spya-[a-z0-9]{6}/g) ?? [], adjacent: (next[1] ?? "").trim() === "" };
}
function holds(block: Block, pieces: readonly string[]): boolean {
  let from = 0;
  for (const piece of pieces) {
    const span = findQuote(block.text.slice(from), piece, undefined, "spaced");
    if (!span) return false;
    from += span.end;
  }
  return true;
}
export function quoteCheck(text: string, blocks: readonly Block[]): QuoteCheck {
  const check: QuoteCheck = { article: 0, unlinked: [], apart: 0, misplaced: [], altered: [] };
  for (const m of text.matchAll(QUOTED)) {
    const after = idsAfter(text.slice((m.index ?? 0) + m[0].length));
    // A closing mark may take the model's sentence punctuation inside it.
    // Keep internal punctuation and every nonempty piece, including "not".
    const pieces = (m[1] ?? "")
      .trim()
      .replace(/[.,;:]+$/, "")
      .split(/…|\.\.\./)
      .map((piece) => piece.trim())
      .filter((piece) => piece.length > 0);
    if (pieces.length === 0) continue;
    const label = `“${(m[1] ?? "").slice(0, 40)}…”`;
    const homes = blocks.filter((block) => holds(block, pieces)).map((block) => block.id as string);
    if (homes.length === 0) {
      if (after?.adjacent) check.altered.push(label);
      continue;
    }
    check.article += 1;
    if (!after) check.unlinked.push(label);
    else if (!after.ids.some((id) => homes.includes(id))) check.misplaced.push(label);
    else if (!after.adjacent) check.apart += 1;
  }
  return check;
}

/**
 * **Is the turn's question about the reader's own view rather than the
 * piece?** A crude screen for `spya-mtsf0y`. It will miscount — "why do you
 * think he needs that step" is about the author, and the `ABOUT_AUTHOR`
 * pattern excuses only the commonest shapes of that — so it is a flag to go
 * and read the turn, and never the measure. The measure is a blind reader
 * labelling each task
 * (docs/investigations/261003c-tutorial-prompt-leans-to-retention.md).
 */
const OWN_VIEW =
  /\b(push back|do you agree|would you agree|your (own )?(view|take|sense|field|experience|intuition)|where do you (stand|land)|what do you make of|do you (think|find|buy)|would you (say|argue|locate|draw)|convinc(es?|ing) (to )?you|strike you|sit with you)\b/i;
const ABOUT_AUTHOR = /\b(do you think|would you say) (he|she|they|the author|the piece|the article)\b/i;
function ownView(text: string): boolean {
  const question =
    text
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => sentence.includes("?"))
      .at(-1) ?? "";
  return OWN_VIEW.test(question) && !ABOUT_AUTHOR.test(question);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outName = args.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? "remember-tutorial";
  if (!/^[a-z0-9.-]+$/.test(outName)) throw new Error(`--out takes a plain file stem, got: ${outName}`);
  const dir = args.find((a) => !a.startsWith("--")) ?? "data/noema-mythology-of-conscious-ai";
  const setName = args.find((a) => a.startsWith("--readers="))?.slice("--readers=".length) ?? "noema";
  if (!(setName in READER_SETS))
    throw new Error(`--readers takes one of ${Object.keys(READER_SETS).join(", ")}, got: ${setName}`);
  const readers = READER_SETS[setName as keyof typeof READER_SETS];
  const { meta, blocks } = await loadArticle(dir);
  const lines: string[] = [];
  const say = (s = "") => {
    lines.push(s);
    console.log(s);
  };
  say(`# Remember: Tutorial — ${meta.title ?? dir}`);
  say();
  say(`Article: \`${dir}\` (${blocks.length} blocks). ${readers.length} scripted readers (\`${setName}\`) × 5 turns. **Read the conversations.** See the header of \`evals/remember-tutorial.ts\`.`);
  /* Which prompt this run used, so two arms of a before/after can be told
     apart afterwards: the system prompt and the canned opening line, as
     production builds them. */
  const built = buildConverseMessages({ meta, blocks, history: [], question: "", kind: "tutorial" });
  const promptHash = createHash("sha256")
    .update(JSON.stringify([built[0]?.content, built[2]?.content]))
    .digest("hex")
    .slice(0, 12);
  say();
  say(`Prompt: \`${promptHash}\` (sha256 of the Tutorial system prompt and opening line, first 12).`);
  say();
  let model = "";
  let long = 0;
  let multiQ = 0;
  let uncited = 0;
  let flagged = 0;
  let total = 0;
  let quoted = 0;
  let unlinked = 0;
  let misplaced = 0;
  let altered = 0;
  let apart = 0;
  let own = 0;
  let ownEarly = 0;
  for (const r of readers) {
    say(`## ${r.name}`);
    say();
    say(`**Watch for:** ${r.watchFor}`);
    if (r.profile) say(`\n**Profile:** ${r.profile.replace(/\n/g, " / ")}`);
    say();
    const history: ChatMessage[] = [];
    for (const [i, said] of r.turns.entries()) {
      say(`> **Reader ${i + 1}:** ${said}`);
      say();
      let out: Awaited<ReturnType<typeof oneTurn>>;
      try {
        out = await oneTurn(meta, blocks, history, said, r.profile ?? null);
      } catch (err) {
        say(`**FAILED:** ${String(err instanceof Error ? err.message : err)}`);
        say();
        break;
      }
      total += 1;
      model = out.model || model;
      const w = words(out.text);
      const q = questions(out.text);
      const c = cites(out.text);
      const lower = out.text.toLowerCase();
      const hit = [
        ...BANNED.filter((p) => lower.includes(p)),
        ...BANNED_OPENERS.filter(([, pattern]) => pattern.test(out.text.trimStart())).map(([label]) => label),
      ];
      if (w > 140) long += 1;
      if (q > 1) multiQ += 1;
      if (c === 0) uncited += 1;
      if (hit.length) flagged += 1;
      const quotes = quoteCheck(out.text, blocks);
      quoted += quotes.article;
      unlinked += quotes.unlinked.length;
      misplaced += quotes.misplaced.length;
      altered += quotes.altered.length;
      apart += quotes.apart;
      const mine = ownView(out.text);
      if (mine) own += 1;
      if (mine && i < 2) ownEarly += 1;
      const flag = (label: string, hits: readonly string[]) =>
        hits.length ? `, ⚠︎ ${label}: ${hits.join(" ")}` : "";
      const quoteNote = `, ${quotes.article} article quotation${quotes.article === 1 ? "" : "s"}${flag("no id in the sentence", quotes.unlinked)}${flag("id names another block", quotes.misplaced)}${flag("not the article's words as quoted", quotes.altered)}${mine ? ", flagged OWN VIEW" : ""}`;
      say(`**Tutor ${i + 1}** — ${w} words, ${q} question mark${q === 1 ? "" : "s"}, ${c} citation${c === 1 ? "" : "s"}${quoteNote}${hit.length ? `, ⚠︎ banned: ${hit.join(", ")}` : ""}${out.truncated ? ", ⚠︎ CUT OFF" : ""}`);
      say();
      say(out.text.trim());
      say();
      history.push(row("user", said, i * 2), row("assistant", out.text, i * 2 + 1));
    }
  }
  say("## Counts, which are not the answer");
  say();
  say(`- model: \`${model}\``);
  say(`- replies: ${total}`);
  say(`- over the 140-word ceiling: ${long}`);
  say(`- more than one question mark: ${multiQ} (one task per turn; a quoted question can trip this)`);
  say(`- citing no block: ${uncited}`);
  say(`- containing a banned phrase: ${flagged}`);
  say(`- quotations of the article: ${quoted}; with no id before the sentence ends: ${unlinked}; with an id that names another block: ${misplaced}; with the id later in the sentence rather than straight after: ${apart}`);
  say(`- quoted with an id, but not the article's words as quoted: ${altered}`);
  say(`- turns flagged as asking for the reader's own view: ${own} of ${total}; in a reader's first two turns: ${ownEarly} (a pattern match, not the measure — read them)`);
  const out = path.resolve(import.meta.dirname, "results", `${outName}.md`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${lines.join("\n")}\n`, "utf-8");
  console.log(`\nWritten to ${path.relative(process.cwd(), out)}`);
}

/* `withLedger` so the spend is recorded under an eval scope — see the note at
   the foot of evals/remember-recall.ts. */
if (isMain(import.meta.url)) {
  loadEnvLocal();
  await withLedger("eval", main);
}
