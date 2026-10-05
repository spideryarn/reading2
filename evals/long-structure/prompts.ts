/**
 * The three prompts the staged arms need that production does not have.
 * Plan 261005j § Stage 2.
 *
 *  - `TOP_SYSTEM` (arms B and C, call 1): read the whole document, return only
 *    its top-level parts and the root's two lines.
 *  - `SECTIONS_SYSTEM` (arm C, round 2): divide one part into sections, starts
 *    and titles only.
 *  - `GISTS_SYSTEM` (arm C, round 3): write one gist for each section that
 *    already exists.
 *
 * Arm B's round 2 is not here: it is the scoped expansion prompt, unchanged
 * (src/structure-expand.ts § `EXPAND_SYSTEM`).
 *
 * **What a part, a title, a gist and a question are is not written here.**
 * Those paragraphs are cut out of the two production prompts by their section
 * names, so an eval arm cannot drift from the rules every article is cut by,
 * and a prompt edit there that moves a section name fails here loudly (`cut`).
 * What is written here is only what each call is asked to return.
 */
import { withMessagesJsonSchema } from "../../src/messages-structured-output.js";
import type { MessagesBody } from "../../src/messages-stream.js";
import { paperwork } from "../../src/paperwork.js";
import { plainWords } from "../../src/plain-words.js";
import { EXPAND_SYSTEM } from "../../src/structure-expand.js";
import { PRODUCTION_EFFORT, renderBlocks } from "../../src/structure-prompt.js";
import { STRUCTURE_HEADROOM, SYSTEM } from "../../src/structure.js";
import { budgetFor, THINKING_HEADROOM } from "../../src/token-budget.js";
import type { Block } from "../../src/types.js";

export const TOP_PROMPT_VERSION = "long-top/1";
export const SECTIONS_PROMPT_VERSION = "long-sections/1";
export const GISTS_PROMPT_VERSION = "long-section-gists/1";

/** The text of `prompt` from `from` up to (not including) `to`. Throws if either marker has moved. */
function cut(prompt: string, from: string, to: string): string {
  const a = prompt.indexOf(from);
  const b = prompt.indexOf(to, a + from.length);
  if (a === -1 || b === -1) throw new Error(`A production prompt no longer has "${from}" before "${to}".`);
  return prompt.slice(a, b).trimEnd();
}

/* From the whole-document prompt (`toc/12`), whole sections, unchanged. */
const TOC_TITLES = cut(SYSTEM, "TITLES (internal nodes)", "GISTS (internal nodes)");
const TOC_GISTS = cut(SYSTEM, "GISTS (internal nodes)", "QUESTIONS (the root and depth-1 nodes only)");
const TOC_QUESTIONS = cut(SYSTEM, "QUESTIONS (the root and depth-1 nodes only)", "OUTPUT\n");

/* From the scoped expansion prompt (`expand/8`), unchanged. */
const EXPAND_BOUNDARIES = cut(EXPAND_SYSTEM, "BOUNDARIES\n", "TITLES AND GISTS");
const EXPAND_TITLE_RULES = cut(EXPAND_SYSTEM, "- title: 2-6 words", "- gist: exactly ONE sentence");
const EXPAND_GIST_RULES = cut(EXPAND_SYSTEM, "- gist: exactly ONE sentence", "- Your titles must distinguish");
const EXPAND_DISTINCT = cut(EXPAND_SYSTEM, "- Your titles must distinguish", "QUESTIONS\n");

/* ------------------------------------------------------- call 1: the top -- */

export const TOP_SYSTEM = `You are starting a nested table of contents for a long document. Other calls
will divide each part into sections afterwards. Your job is the top level only:
the document's parts, and two lines about the whole document.

You receive the document as a numbered list of blocks. Each block has an id
(e.g. spya-k3m9qt), a tag, and its text. Some are marked NOT-GISTABLE.

PARTS

- Divide the whole document into consecutive parts. Give each part one
  "start": the id of the first block it covers. Do not give an end: a part ends
  where the next one starts, and the last part ends at the last block.
- The first part must start at the first block. List parts in document order;
  each "start" must occur strictly later than the previous part's start.
- Where the document has chapters or other major divisions of its own, make
  each part one whole chapter or division, however few or many that gives.
  Where it has none, aim for 5-9 parts and put each boundary at a genuine
  shift of topic.
- The document's own headings are HARD boundaries. A part must begin at a
  heading block wherever one exists.
- Do NOT divide a part further. Return no sections.

In the rules below, the root is the whole document and a depth-1 node is one
part. You write nothing deeper, so the lines about deeper nodes do not apply.

${TOC_TITLES}

${TOC_GISTS}

${TOC_QUESTIONS}

OUTPUT

JSON only, no prose, no code fence:

{"gist": "...", "question": "...",
 "parts": [{"start": "<blockId>", "title": "...", "gist": "...",
            "question": "...", "sourceHeading": "..."}]}

"gist" and "question" at the top are the root's. Omit "sourceHeading" where the
author gave the part no heading. Use only block ids that appear in the input.
Do not invent ids.

${plainWords()}

${paperwork("structure")}`;

const str = { type: "string" } as const;

const TOP_SCHEMA = {
  type: "object",
  properties: {
    gist: str,
    question: str,
    parts: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: { start: str, title: str, gist: str, question: str, sourceHeading: str },
        required: ["start", "title", "gist", "question"],
        additionalProperties: false,
      },
    },
  },
  required: ["gist", "question", "parts"],
  additionalProperties: false,
} as const;

/** About what one part costs in the answer: a start, a title, a 30-word gist and a 20-word question. */
const TOKENS_PER_PART = 150;
const TOP_ENVELOPE_TOKENS = 300;

export interface BuiltRequest {
  params: MessagesBody;
  maxTokens: number;
  answerTokens: number;
  headroom: number;
}

/**
 * Call 1's request. `expectedParts` sizes the answer: the caller passes how
 * many parts the headings tree has, and this allows twice that and never
 * fewer than 40, since a refused budget costs nothing and a cut-short answer
 * costs the call.
 */
export function topRequest(body: Block[], expectedParts: number): BuiltRequest {
  const answerTokens = TOP_ENVELOPE_TOKENS + Math.max(40, expectedParts * 2) * TOKENS_PER_PART;
  const maxTokens = budgetFor("table of contents top level", answerTokens, STRUCTURE_HEADROOM);
  return {
    maxTokens,
    answerTokens,
    headroom: STRUCTURE_HEADROOM,
    params: withMessagesJsonSchema(
      {
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort: PRODUCTION_EFFORT },
        system: TOP_SYSTEM,
        messages: [{ role: "user", content: renderBlocks(body) }],
      },
      TOP_SCHEMA,
    ),
  };
}

/* ------------------------------------------ what a per-part call is shown -- */

export interface PartBriefing {
  /** The whole document's title. */
  documentTitle: string;
  /** Every part's title and gist, numbered, as `renderFrozenOutline` prints them. */
  outline: string;
  /** This part's own title and gist. */
  title: string;
  gist: string;
}

const briefingText = (b: PartBriefing): string =>
  `THE WHOLE DOCUMENT'S TOP-LEVEL OUTLINE\n\n${b.outline}\n\n` +
  `THE PART YOU ARE WORKING ON\n\n  ${b.documentTitle}\n  ↳ ${b.title} — ${b.gist}`;

/* ------------------------------------- arm C round 2: sections, no gists -- */

export const SECTIONS_SYSTEM = `You are extending a nested table of contents for a longer work. You are given
one of its parts. The part's boundaries and title are already fixed; your job
is to divide it into its sections: one level, no deeper, and titles only.
Another call writes each section's summary afterwards, so write none.

You are shown the whole work's top-level outline for context, then the part's
title and its blocks as a numbered list. Each block has an id (e.g.
spya-k3m9qt), a tag, and its text. Some are marked NOT-GISTABLE. Block numbers
are only a reading aid; the ids are what you answer with.

The rules below are shared with a call that is handed several things to
divide at once, so they use its words. Here, read "child" as one of the
sections you return, and "section" as the part you were given.

${EXPAND_BOUNDARIES}

TITLES

${EXPAND_TITLE_RULES}
${EXPAND_DISTINCT}

OUTPUT

JSON only, no prose, no code fence:

{"sections": [{"start": "<blockId>", "title": "...", "sourceHeading": "..."}]}

Use only block ids that appear in the part's blocks. Do not invent ids.

${plainWords()}

${paperwork("structure")}`;

const SECTIONS_SCHEMA = {
  type: "object",
  properties: {
    sections: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: { start: str, title: str, sourceHeading: str },
        required: ["start", "title"],
        additionalProperties: false,
      },
    },
  },
  required: ["sections"],
  additionalProperties: false,
} as const;

const TOKENS_PER_TITLE = 60;
const TOKENS_PER_GIST = 90;
const PART_ENVELOPE_TOKENS = 200;

/** Sections one part may come back with: one per ~9 blocks (the prompt's stride), or one per heading if that is more. */
export function sectionsExpected(blocks: readonly Block[]): number {
  return Math.max(9, Math.ceil(blocks.length / 9), blocks.filter((b) => b.kind === "heading").length);
}

export function sectionsRequest(briefing: PartBriefing, blocks: Block[]): BuiltRequest {
  const answerTokens = PART_ENVELOPE_TOKENS + sectionsExpected(blocks) * TOKENS_PER_TITLE;
  const maxTokens = budgetFor("part sections", answerTokens, THINKING_HEADROOM);
  return {
    maxTokens,
    answerTokens,
    headroom: THINKING_HEADROOM,
    params: withMessagesJsonSchema(
      {
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort: PRODUCTION_EFFORT },
        system: SECTIONS_SYSTEM,
        messages: [{ role: "user", content: `${briefingText(briefing)}\n\nITS BLOCKS\n\n${renderBlocks(blocks)}` }],
      },
      SECTIONS_SCHEMA,
    ),
  };
}

/* ------------------------------------------- arm C round 3: gists, later -- */

export const GISTS_SYSTEM = `You are finishing a nested table of contents for a longer work. One of its
parts has already been divided into sections, and each section has its title.
Your job is to write the one-sentence gist of each section. Do not change a
title or a boundary.

You are shown the whole work's top-level outline for context, then the part's
title, then each section in order: its number, its title, and its blocks as a
numbered list. Each block has an id, a tag, and its text. Some are marked
NOT-GISTABLE, and a few of those are withheld and show no text at all: say
nothing about prose you cannot see. Block numbers restart at 0 in each section
and are only a reading aid.

The rules below are shared with another call and use its word: read "child" as
one of the sections you were given.

GISTS

${EXPAND_GIST_RULES}
- Write each gist from that section's own blocks, and claim nothing they do
  not say.

OUTPUT

JSON only, no prose, no code fence. One entry per section you were given, in
the order you were given them, each naming its own number:

{"gists": [{"section": 1, "gist": "..."}]}

${plainWords()}

${paperwork("structure")}`;

const GISTS_SCHEMA = {
  type: "object",
  properties: {
    gists: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: { section: { type: "integer" }, gist: str },
        required: ["section", "gist"],
        additionalProperties: false,
      },
    },
  },
  required: ["gists"],
  additionalProperties: false,
} as const;

export interface TitledSection {
  title: string;
  blocks: Block[];
}

export function gistsRequest(briefing: PartBriefing, sections: readonly TitledSection[]): BuiltRequest {
  const answerTokens = PART_ENVELOPE_TOKENS + sections.length * TOKENS_PER_GIST;
  const maxTokens = budgetFor("section gists", answerTokens, THINKING_HEADROOM);
  const shown = sections
    .map((s, i) => `SECTION ${i + 1} OF ${sections.length}: ${s.title}\n\n${renderBlocks(s.blocks)}`)
    .join("\n\n");
  return {
    maxTokens,
    answerTokens,
    headroom: THINKING_HEADROOM,
    params: withMessagesJsonSchema(
      {
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort: PRODUCTION_EFFORT },
        system: GISTS_SYSTEM,
        messages: [{ role: "user", content: `${briefingText(briefing)}\n\nITS SECTIONS\n\n${shown}` }],
      },
      GISTS_SCHEMA,
    ),
  };
}
