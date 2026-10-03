/**
 * **What a GPT-Live session is told** — the second live-conversation engine's
 * prompts and session config. The plan is
 * docs/plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md.
 *
 * Everything here is pure: an article and a conversation in, a JSON-able
 * session out. The request to OpenAI and the key are in src/live.ts
 * (`createGptLiveSession`), which stays the only file in `src/` that names
 * OpenAI — so this file imports from that one and never the other way round.
 *
 * ## Two models, and the article goes to only one of them
 *
 * GPT-Live is a voice model that listens and speaks, with a separate text
 * model behind it (the *backend*) that it hands work to. The voice model's
 * instructions are capped at 16,384 tokens — over that, the create request is a
 * 400 — and most articles are longer. So:
 *
 * - **the voice** gets how to talk, when to hand over, and the article's title,
 *   author and outline, cut to fit;
 * - **the backend** gets the whole article with block ids, the evidence rules
 *   and the tools.
 *
 * The same split for every article, short ones included. One behaviour, one set
 * of tests; and the voice model is the weaker of the two, so the claims about
 * what the article says are the backend's to make.
 */

import { articleWithIds } from "./article-prompt.js";
import {
  GPT_LIVE_BACKEND_MODEL,
  GPT_LIVE_MODEL,
  LIVE_VOICE,
  UNTRUSTED_TOOL_RESULTS,
  liveSeedItems,
  liveTools,
} from "./live.js";
import { plainWords } from "./plain-words.js";
import type { Block, ChatMessage, Meta, Tree, TreeNode } from "./types.js";

/* ------------------------------------------------------------- budgets -- */

/** OpenAI's cap on the voice model's `instructions`. Over it, create is a 400. */
export const GPT_LIVE_INSTRUCTION_TOKEN_CAP = 16_384;

/**
 * **What we allow ourselves**, by our own pessimistic count. Well under the cap
 * because the count is an estimate: there is no tokenizer in this repo and the
 * price of guessing low is a session that will not start.
 */
export const VOICE_INSTRUCTION_BUDGET = 12_000;

/** The reader's profile is theirs to write and has no length limit of its own; this is ours. */
const PROFILE_BUDGET = 1_200;

/** OpenAI's caps on `session.input`: 128 messages, 8,192 tokens. */
export const GPT_LIVE_SEED_MESSAGE_CAP = 128;
export const GPT_LIVE_SEED_TOKEN_CAP = 8_192;

/** Ours, well inside both. */
export const SEED_MESSAGE_BUDGET = 60;
export const SEED_TOKEN_BUDGET = 5_000;
/** One long answer must not push the whole of the rest out. */
const SEED_MESSAGE_TOKEN_BUDGET = 1_200;

/**
 * **A token count that errs high.**
 *
 * Not `estimateTokens` in src/article-prompt.ts, which divides by four: right
 * on average for English and too low for a budget that must not be exceeded.
 * Here an ASCII character is a third of a token, and anything else — an
 * accented letter, a CJK character, an emoji — is a token and a half. Real
 * tokenizers do better than both on almost every text, which is the point.
 */
export function pessimisticTokens(text: string): number {
  let thirds = 0;
  for (const ch of text) thirds += (ch.codePointAt(0) ?? 0) < 128 ? 2 : 9;
  return Math.ceil(thirds / 6);
}

/** The longest prefix of `text` inside `budget`, with an ellipsis if it was cut. */
function cutToBudget(text: string, budget: number): string {
  if (pessimisticTokens(text) <= budget) return text;
  let thirds = 0;
  let out = "";
  for (const ch of text) {
    thirds += (ch.codePointAt(0) ?? 0) < 128 ? 2 : 9;
    /* Two tokens held back for the ellipsis, which is not ASCII. */
    if (thirds / 6 > budget - 2) break;
    out += ch;
  }
  return `${out.trimEnd()}…`;
}

/* ----------------------------------------------------------- the voice -- */

/**
 * **The voice model's rules**, before the article's outline and the reader's
 * profile are added.
 *
 * Sections after OpenAI's Live prompting guide — Personality, Backchannel
 * policy, Interruption policy, Delegation policy — in this repo's plain words.
 * What a reading companion is for is carried over from `LIVE_SYSTEM` in
 * src/live.ts; what is new is that this model has **not read the article**, so
 * its one hard rule is to hand over before it says anything the article would
 * have to back up.
 */
export const GPT_LIVE_VOICE_SYSTEM = `# Personality

You are a reading companion, talking out loud with a reader who has an article
open and is reading it. You are here to make deep reading cheaper, not
optional. Never let talking to you stand in for reading the piece: your job is
to send the reader back into it better equipped. Be warm, direct and brief.

# How to talk

This is speech, not prose.

- Short. Two or three sentences is a normal turn. After about fifteen seconds
  you have stopped answering and started lecturing, and a listener cannot skim.
- Answer what was asked, in the first sentence. One idea per turn.
- No lists, no headings, no markdown, and never read a web address aloud.
- Plain spoken words. Contractions are fine.
- Speak English, unless the reader is clearly talking to you in another
  language; then answer in theirs. An accent, a filler word or a single foreign
  term is not a change of language.
- Only answer clear speech. If what you heard was unintelligible, only part of
  a sentence, or just noise, ask in a few words for them to say it again. Never
  guess the missing words, and never delegate on a guess.
- Never say a block id aloud. Paragraphs have ids like spya-k3m9qt; they are
  for the screen. If one reaches you, leave it out and say in words where the
  passage is.

# Backchannel policy

A light "mm-hm" or "right" is fine only while the reader is thinking out loud
at length. Never talk over them. Do not fill their silence: they may be
reading.

# Interruption policy

If the reader starts speaking, stop and listen. If they change what they want,
follow the new request and drop the old one.

# Delegation policy

You have not read the article. A backend has all of it, and can also look
things up on the web. You have only the outline below, which tells you what the
piece covers and nothing about what it says.

Delegate to the backend whenever the answer depends on what the article says:
any claim about its content, any quotation, any "where does it say that", any
request to find or show a passage, and anything that needs looking up.

Delegate before giving any answer that depends on the article, and never guess
the result while you wait. Do not answer from the outline, and do not answer
from what an article like this usually says.

While the backend works, you may say in one short sentence what you are
checking, worded differently each time. Do not fill silence for the sake of
it.

When the backend answers, say it in a sentence or three, keeping the author's
own distinctive words. The app shows the reader the passages the backend
pointed at, so say in words where to look and leave the ids out. If the
backend says the article does not say, tell the reader that: "he doesn't
address that" is a complete and useful answer. Add nothing of your own to it.

You do not need the backend to greet the reader, to ask what they mean, or to
talk through their own thinking: what they made of a part, where they are
stuck, what they want to read for. The moment that turns on what the piece
says, delegate.

${plainWords("explain", "spoken")}`;

/** One outline line: a part of the piece, and the sentence that says what it does. */
function outlineLine(node: TreeNode, withGist: boolean): string {
  const indent = "  ".repeat(Math.max(0, node.depth - 1));
  const gist = withGist && node.gist ? `: ${node.gist}` : "";
  return `${indent}- ${node.title}${gist}`;
}

/** The tree's parts in reading order, down to `maxDepth`. Leaves and the root are left out. */
function partsTo(tree: Tree, maxDepth: number): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (id: string): void => {
    const node = tree.nodes[id];
    if (!node) return;
    /* A part is a node with something under it, or a top-level node of any
       kind — a short article's depth-1 nodes can be leaves, and the notes at
       the end are a top-level node with no gist. A deeper leaf is one
       paragraph, which is finer than an outline is for. */
    const isPart = node.depth >= 1 && (node.children.length > 0 || node.depth === 1);
    if (isPart && node.depth <= maxDepth) out.push(node);
    if (node.depth < maxDepth) for (const child of node.children) walk(child);
  };
  walk(tree.rootId);
  return out;
}

/**
 * **The article's outline, cut to fit `budget`** — the Structure tree's parts
 * with their one-line summaries (docs/project/granularity-zoom.md § The tree).
 *
 * Cut by **depth first, then detail, then length**, so what survives is always
 * a whole view of the piece rather than its first third in full:
 *
 * 1. every level with its summaries, if that fits;
 * 2. else one level fewer, and so on down to the top-level parts;
 * 3. else the top-level parts by title alone;
 * 4. else as many of those titles as fit, and a line saying the list stops.
 *
 * A tree with no parts — a provisional one, or a very short piece — falls back
 * to the author's own headings, and then to nothing. An empty outline is fine:
 * the voice delegates anything about the article either way.
 */
export function gptLiveOutline(opts: { tree: Tree; blocks: readonly Block[]; budget: number }): string {
  const { tree, blocks, budget } = opts;
  const fits = (text: string): boolean => pessimisticTokens(text) <= budget;

  const deepest = Math.max(1, ...Object.values(tree.nodes).map((n) => n.depth));
  for (let depth = deepest; depth >= 1; depth--) {
    const parts = partsTo(tree, depth);
    if (parts.length === 0) continue;
    const text = parts.map((n) => outlineLine(n, true)).join("\n");
    if (fits(text)) return text;
  }

  const top = partsTo(tree, 1);
  const titles =
    top.length > 0
      ? top.map((n) => outlineLine(n, false))
      : blocks.filter((b) => b.level !== undefined && b.text.trim() !== "").map((b) => `- ${b.text.trim()}`);
  if (titles.length === 0) return "";

  if (fits(titles.join("\n"))) return titles.join("\n");

  const kept: string[] = [];
  const stop = "- (the piece goes on; this list stops here)";
  for (const line of titles) {
    if (!fits([...kept, line, stop].join("\n"))) break;
    kept.push(line);
  }
  return kept.length === 0 ? "" : [...kept, stop].join("\n");
}

/**
 * **Everything the voice model is told, as the one string GPT-Live takes** —
 * and always inside `VOICE_INSTRUCTION_BUDGET`.
 *
 * The rules are fixed and are never cut. The title, byline and profile are
 * bounded. **The outline gets whatever is left**, so a long article loses
 * outline detail and never a rule.
 */
export function gptLiveVoiceInstructions(opts: {
  meta: Meta;
  blocks: readonly Block[];
  tree: Tree;
  profile?: string | null;
}): string {
  const { meta, blocks, tree } = opts;
  const root = tree.nodes[tree.rootId];
  const head = [
    `TITLE: ${cutToBudget(meta.title, 150)}`,
    meta.byline ? `BY: ${cutToBudget(meta.byline, 150)}` : null,
    meta.siteName ? `PUBLISHED IN: ${cutToBudget(meta.siteName, 60)}` : null,
    root?.gist ? `IN ONE SENTENCE: ${cutToBudget(root.gist, 200)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const who = opts.profile
    ? `# Who you are talking to\n\nThe reader has told us this about themselves. Use it to pitch what you say; do not mention that you have it.\n\n${cutToBudget(opts.profile, PROFILE_BUDGET)}`
    : "";

  const articleIntro =
    "# The article\n\nWhat the piece is and how it is laid out. This is a map, not the text: delegate for anything it says.";
  const fixed = [GPT_LIVE_VOICE_SYSTEM, `${articleIntro}\n\n${head}`, who].filter(Boolean).join("\n\n");
  /* Sixty held back for the outline's own heading and the joins. */
  const left = VOICE_INSTRUCTION_BUDGET - pessimisticTokens(fixed) - 60;
  const outline = left > 0 ? gptLiveOutline({ tree, blocks, budget: left }) : "";

  return [
    GPT_LIVE_VOICE_SYSTEM,
    [`${articleIntro}\n\n${head}`, outline ? `OUTLINE:\n${outline}` : ""].filter(Boolean).join("\n\n"),
    who,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/* --------------------------------------------------------- the backend -- */

/**
 * **The backend's rules.** It is the model that has read the article, so the
 * evidence rules live here; and its answer is read out by another model, so
 * the length and no-ids rules live here too.
 *
 * `show_passage` is how its answer is tied to the text. A spoken answer cannot
 * carry a citation, so the ids travel in the tool call and the browser draws
 * them (`SHOW_PASSAGE_TOOL` in src/live.ts).
 */
export const GPT_LIVE_BACKEND_SYSTEM = `You are the backend for a spoken conversation about an article. A voice model
is talking with a reader who has the article open and is reading it. It hands
you anything that depends on what the article says, or that needs looking up,
and it says your answer aloud. The reader hears your answer; they never see it.

You are here to make deep reading cheaper, not optional. Send the reader back
into the piece better equipped: point at the passage; do not retell the
article to someone who could read it.

HOW TO ANSWER

- One to three short sentences, written to be spoken aloud. Answer the question
  in the first.
- Plain text only. No block ids, no markdown, no lists, no web addresses.
- No account of what you are doing. Do not write "let me check"; give the answer.
- Keep the author's own distinctive words. The reader meets them again in the
  piece.
- Answer in the language the question was asked in.

SHOW THE PASSAGE

Whenever your answer rests on a passage of the article, call show_passage with
the block ids that support it, two or three at most, and then answer. The app
highlights them for the reader. In your answer, say in words where it is ("the
part about the rainstorm thought experiment"). The ids go in the tool call and
never in the answer.

EVIDENCE

- Say only what the article supports. Each claim about the article must rest
  on a passage you could point at.
- A quotation is the author's exact words, copied. If you are not copying, do
  not present it as a quotation.
- If the article does not say, say so. "He doesn't address that" is a complete
  and useful answer. Do not fill the gap with what such an article usually
  says.
- Never say you looked something up unless you called the tool on this turn.

YOUR TOOLS

Stay in the article. It is all below, so a lookup to find out what one
paragraph says is worse than no lookup: the reader is waiting in silence.

Reach outside the article only when the question does: the reader brings in a
claim from elsewhere that bears on this piece, connects it to something else
they have read, or asks you to look.

${UNTRUSTED_TOOL_RESULTS}

${plainWords("explain", "spoken")}`;

/**
 * Everything the backend is told. **The article goes last**, as in
 * `liveInstructions`: the string is the same for every round of a session, so
 * the whole of it is the cached prefix, and the rules stay ahead of forty
 * thousand tokens of somebody else's prose.
 */
export function gptLiveBackendInstructions(opts: {
  meta: Meta;
  blocks: readonly Block[];
  profile?: string | null;
}): string {
  const who = opts.profile
    ? `WHO THE READER IS\n\nThe reader has told us this about themselves. Use it to pitch the answer; do not mention that you have it.\n\n${opts.profile}`
    : "";
  return [
    GPT_LIVE_BACKEND_SYSTEM,
    who,
    `THE ARTICLE\n\nHere is the whole thing, with an id on every paragraph.\n\n${articleWithIds(opts.meta, opts.blocks)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/* ---------------------------------------------------------- the seed -- */

/** One message of `session.input`, in the shape GPT-Live takes. */
export type GptLiveSeedMessage =
  | { role: "user"; content: [{ type: "input_text"; text: string }] }
  | { role: "assistant"; content: [{ type: "output_text"; text: string }] };

/**
 * **The conversation so far, as `session.input`** — the newest end of it, cut
 * to fit.
 *
 * `liveSeedItems` decides *what* a model may see (the same window chat uses,
 * with block ids taken out of the assistant's words — a voice model shown its
 * own past speech with ids in it starts saying them). This decides only *how
 * much* fits: the oldest messages go first, an over-long one is shortened
 * rather than dropped, and an empty one is skipped.
 *
 * GPT-Live takes the history at creation, so there is no seeding over the data
 * channel and no acknowledgement to wait for, unlike Realtime.
 */
export function gptLiveSeedInput(history: ChatMessage[]): GptLiveSeedMessage[] {
  return trimSeed(liveSeedItems(history));
}

/**
 * The cut itself, apart from the window, so it can be tested with more
 * messages than `recentHistory` would ever let through.
 */
export function trimSeed(
  items: readonly { role: "user" | "assistant"; text: string }[],
): GptLiveSeedMessage[] {
  const out: GptLiveSeedMessage[] = [];
  let spent = 0;
  for (const item of [...items].reverse()) {
    if (out.length >= SEED_MESSAGE_BUDGET) break;
    if (item.text.trim() === "") continue;
    const text = cutToBudget(item.text, SEED_MESSAGE_TOKEN_BUDGET);
    const cost = pessimisticTokens(text);
    /* Stop, not skip: taking an older message that happens to be short, past a
       newer one that did not fit, would hand the model a conversation with a
       hole in it. */
    if (spent + cost > SEED_TOKEN_BUDGET) break;
    spent += cost;
    out.push(
      item.role === "user"
        ? { role: "user", content: [{ type: "input_text", text }] }
        : { role: "assistant", content: [{ type: "output_text", text }] },
    );
  }
  return out.reverse();
}

/* ------------------------------------------------------- the session -- */

/**
 * **What the browser's data channel may send and receive**, set when the
 * session is created.
 *
 * The browser relays the backend's tool calls (plan § Tools), so it needs the
 * nested response events and the two client events that answer them — and
 * nothing else. Without an allowlist the channel also carries every backend
 * text delta and lifecycle snapshot, which the hook would have to ignore.
 * A client event not listed is answered `error … event_not_allowed`
 * (evals/live/gpt-live-spike/, the `allow` trace).
 */
export const GPT_LIVE_DATA_CHANNEL = {
  allowed_client_events: ["response.item.create", "response.create", "session.close"],
  allowed_server_events: [
    { type: "session.started" },
    { type: "session.closed" },
    { type: "session.input_transcript.delta" },
    { type: "session.output_transcript.delta" },
    { type: "session.delegation.created" },
    { type: "session.usage.updated" },
    { type: "error" },
    { type: "response.event", response_event: "response.created" },
    { type: "response.event", response_event: "response.output_item.done" },
    { type: "response.event", response_event: "response.completed" },
    { type: "response.event", response_event: "response.failed" },
    { type: "response.event", response_event: "response.incomplete" },
    { type: "response.event", response_event: "error" },
  ],
} as const;

/**
 * **The session OpenAI should create**, from an article, a reader and the
 * conversation so far. Pure, so a test can read all of it without a network.
 *
 * **There is no microphone placement here, and no vocabulary.** GPT-Live has
 * no `noise_reduction`, no `turn_detection` and no transcription settings, so
 * the three things `liveSession` configures for Realtime have nowhere to go.
 * The route still accepts `placement` so the browser can send one body shape
 * to either engine; for this engine it is checked and then unused.
 */
export function gptLiveSession(opts: {
  meta: Meta;
  blocks: readonly Block[];
  tree: Tree;
  profile?: string | null;
  history: ChatMessage[];
}): Record<string, unknown> {
  return {
    model: GPT_LIVE_MODEL,
    instructions: gptLiveVoiceInstructions(opts),
    audio: { output: { voice: LIVE_VOICE } },
    input: gptLiveSeedInput(opts.history),
    client: { data_channel: GPT_LIVE_DATA_CHANNEL },
    delegation: {
      type: "responses",
      responses: {
        model: GPT_LIVE_BACKEND_MODEL,
        instructions: gptLiveBackendInstructions(opts),
        /* Low: the reader is waiting in silence while this model thinks. */
        reasoning: { effort: "low" },
        /* The same nine the Realtime engine has — `show_passage` and the eight
           chat tools — already in the flat function shape the Responses API
           takes. Not `strict`: their schemas have optional parameters and no
           `additionalProperties: false`, which strict mode refuses. */
        tools: liveTools(),
      },
    },
  };
}
