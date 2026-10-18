/**
 * Pipeline stage 5q — **relations**: how each paragraph bears on the one
 * before it, as one word from a closed list of ten, and a few optional prose
 * notes about connections elsewhere in the article. Marginalia draws a few
 * relation words beside their paragraphs (so, but, vs); the rest are stored
 * and not drawn. docs/plans/261003f-marginalia-relation-words-and-timeline-events.md
 * § Stage 2 is the original relation-word design; plan 261011o adds notes.
 *
 * **There is no command line here.** Running it against one article is a job:
 *
 *   POST /api/jobs { slug, steps: ["relations"] }
 *
 * ## What it shares with `faq`, and what it does not
 *
 * **The request is Ideas' byte for byte up to the breakpoint** —
 * `articleWithIds(meta, blocks.filter(isBodyEvidence))` first, carrying the
 * cache breakpoint, then this stage's instructions (src/models.ts §
 * `ARTICLE_RENDERER`). The fingerprint covers those rendered bytes and the
 * ordered paragraph pairs in the user message.
 *
 * What it does not share:
 *
 * 1. **The required answer is still mechanical.** Every paragraph gets a
 *    block id and one of ten words. Optional notes are checked separately:
 *    their quotes must occur in the blocks they name, and the prompt carries
 *    the plain-words rule for their prose (nothing checks it afterwards).
 * 2. **The model is told which paragraphs to answer**, in the user message,
 *    and must answer every one once. FAQ chooses its own passages.
 * 3. **A sparse answer fails.** FAQ's empty list is a real answer; here fewer
 *    than half the listed paragraphs answered throws, because a stored
 *    artefact with three words in it looks exactly like a quiet article (Sol
 *    P1-5).
 * 4. **An article with nothing to label spends nothing**: fewer than two body
 *    paragraphs stores an empty artefact without a model call.
 * 5. **Owner only.** Nothing here reaches a visitor — their payload carries no
 *    staleness verdict for this artefact (Sol P1-4). src/sharing-steps.ts.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { Article } from "./article-input.js";
import { articleWithIds } from "./article-prompt.js";
import { anthropicCallFailed } from "./anthropic-call.js";
import { isBodyEvidence } from "./block-policy.js";
import { finishedText, streamMessage } from "./messages-stream.js";
import {
  CAPABLE_MODEL,
  effortFor,
  generatorFor,
  sameGenerator,
  type ModelPower,
} from "./models.js";
import { parseJsonAnswer } from "./parse-json.js";
import {
  assertNoBlockIdEnums,
  validateAnthropicJsonSchema,
  withMessagesJsonSchema,
} from "./messages-structured-output.js";
import {
  checkpointKey,
  fallbackHeadTitle,
  type MetaFingerprintWithUrl,
} from "./source-hash.js";
import { budgetFor } from "./token-budget.js";
import { paperwork } from "./paperwork.js";
import { plainWords } from "./plain-words.js";
import { findQuote } from "./quote-match.js";
import {
  ARTICLE_NOTE_KINDS,
  RELATIONS,
  type MarginNote,
  type MarginNoteKind,
  type MarginNotesDropped,
  type Block,
  type BlockId,
  type Meta,
  type Relation,
  type Relations,
  type RelationsDropped,
  type Tree,
} from "./types.js";

export type { Relation, Relations, RelationsDropped } from "./types.js";

/** Bumped whenever the prompt changes what a relation *is*, or which paragraphs are asked about. */
export const PROMPT_VERSION = "relations/4";

/**
 * A sentence's worth: fewer words than this is a heading, a date or a byline.
 *
 * **A twin of `PARAGRAPH_MIN_WORDS` in src/web/marginalia/notes.ts**, which
 * decides where the margin puts a part's question. Defined again here because
 * `src/` must not import from `src/web/`; tests/relations.test.ts holds the
 * two equal. Changing it changes which paragraphs are asked about, so it bumps
 * `PROMPT_VERSION`.
 */
export const PARAGRAPH_MIN_WORDS = 12;

/** One paragraph the model is asked about, and the paragraph it is read against. */
export interface EligibleParagraph {
  id: BlockId;
  /** The paragraph before it in the same list — not always the block before it. */
  previous: BlockId;
}

/**
 * **Which paragraphs get a word**: body text blocks of at least a sentence,
 * all but the first. "The one before" is the previous paragraph by the same
 * rule, the first included — so a heading, a figure or a one-line aside
 * between two paragraphs does not come between them.
 *
 * A paragraph after a heading is listed like any other: "but" across a section
 * break still means something.
 */
export function eligibleParagraphs(
  blocks: readonly (Pick<Block, "id" | "kind" | "words"> & {
    treatment?: Block["treatment"] | null;
  })[],
): EligibleParagraph[] {
  const paragraphs = blocks.filter(
    (b) => isBodyEvidence(b) && b.kind === "text" && b.words >= PARAGRAPH_MIN_WORDS,
  );
  const out: EligibleParagraph[] = [];
  for (let i = 1; i < paragraphs.length; i++) {
    out.push({ id: paragraphs[i]!.id, previous: paragraphs[i - 1]!.id });
  }
  return out;
}

/**
 * The answer budget in tokens, sized to the list: one row is
 * `{"blockId":"spya-k3m9qt","relation":"for-example"},`, about twenty tokens,
 * counted as thirty, plus a base for the JSON around the list. Undersizing does
 * not degrade: it throws `truncationFailure` and loses the pass.
 */
export const TOKENS_PER_PARAGRAPH = 30;
/**
 * One note at its longest: two ids, a kind, `NOTE_MAX_WORDS` of note and two
 * quotes of up to `NOTE_MAX_QUOTE_CHARS` each, counted generously (GPT Sol on
 * the plan, P1-1: a budget sized for the words alone truncates a full answer).
 */
export const TOKENS_PER_NOTE = 300;
export function answerTokens(paragraphs: number): number {
  return (
    200 +
    paragraphs * TOKENS_PER_PARAGRAPH +
    (noteCap(paragraphs) + sourceCap(paragraphs)) * TOKENS_PER_NOTE
  );
}

/**
 * The subset of a block that can change either message sent to the model.
 * `kind` and `words` decide whether it appears in the ordered user list;
 * `treatment` decides whether it appears in the article prefix.
 */
export type RelationFingerprintBlock = Pick<Block, "id" | "text" | "kind" | "words"> & {
  treatment?: Block["treatment"] | null;
};

/**
 * What this artefact was written from — the exact dynamic request bytes: the
 * body/head string and the ordered paragraph pairs. The tree matters only when
 * it supplies the fallback title. No profile, because who reads does not change
 * how one paragraph follows another.
 */
export function inputFingerprint(
  blocks: readonly RelationFingerprintBlock[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): string {
  /* `articleWithIds`'s head reads only this fingerprint subset. `slug` is a
     required field of `Meta` for other callers, but it is not rendered. */
  const promptMeta = (meta ?? { title: fallbackHeadTitle(tree) }) as Meta;
  return checkpointKey([
    "relations-input/1",
    articleWithIds(promptMeta, blocks.filter(isBodyEvidence)),
    renderPrompt(eligibleParagraphs(blocks)),
  ]);
}

/** Does this artefact still describe the request's rendered article and paragraph list? */
export function isStale(
  relations: Relations,
  blocks: readonly RelationFingerprintBlock[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): boolean {
  return relations.sourceHash !== inputFingerprint(blocks, tree, meta);
}

/** Would a run today use a different prompt contract or model generation? */
export function isOutdated(relations: Pick<Relations, "version" | "generator">): boolean {
  return (
    relations.version !== PROMPT_VERSION ||
    !sameGenerator(relations.generator, CAPABLE_MODEL)
  );
}

export function emptyDropped(): RelationsDropped {
  return { unknown: 0, repeated: 0, offList: 0, missing: 0 };
}

const RELATION_SET: ReadonlySet<string> = new Set(RELATIONS);

/**
 * Turn what the model said into one relation per paragraph, believing as
 * little as possible. Pure.
 *
 * In the model's order: a row naming an id that was not asked about — or a row
 * with no readable id at all — is dropped (`unknown`); a second row for a
 * paragraph already answered is dropped and the first wins (`repeated`); a
 * word outside `RELATIONS` is dropped (`offList`) and does not use the
 * paragraph up. Listed paragraphs left with no answer are `missing`.
 *
 * **Fewer than half the listed paragraphs answered throws**, so the job fails
 * and nothing is stored. An empty list of paragraphs is an empty answer.
 */
export function toRelations(
  raw: unknown,
  eligibleIds: readonly BlockId[],
): { relations: Record<BlockId, Relation>; dropped: RelationsDropped } {
  if (!Array.isArray(raw)) {
    throw new Error(
      "The model's answer has no `relations` array in it, so there is nothing to read. " +
        "That is a failed answer rather than an empty one.",
    );
  }
  const asked: ReadonlySet<string> = new Set(eligibleIds);
  const dropped = emptyDropped();
  const found = new Map<string, Relation>();
  for (const row of raw as readonly unknown[]) {
    const r = row && typeof row === "object" ? (row as { blockId?: unknown; relation?: unknown }) : {};
    const blockId = typeof r.blockId === "string" ? r.blockId.trim() : "";
    if (!asked.has(blockId)) {
      dropped.unknown++;
      continue;
    }
    if (found.has(blockId)) {
      dropped.repeated++;
      continue;
    }
    const word = typeof r.relation === "string" ? r.relation.trim() : "";
    if (!RELATION_SET.has(word)) {
      dropped.offList++;
      continue;
    }
    found.set(blockId, word as Relation);
  }
  dropped.missing = eligibleIds.length - found.size;

  if (found.size * 2 < eligibleIds.length) {
    throw new Error(
      `The model answered ${found.size} of ${eligibleIds.length} paragraphs, fewer than half, ` +
        "so nothing is written: a sparse list would look like an article with few turns in it. " +
        `Dropped: ${dropped.unknown} naming a paragraph that was not asked about, ` +
        `${dropped.repeated} repeats, ${dropped.offList} with a word off the list.`,
    );
  }

  /* In the article's order rather than the model's, so the stored object reads
     top to bottom. */
  const relations = {} as Record<BlockId, Relation>;
  for (const id of eligibleIds) {
    const word = found.get(id);
    if (word) relations[id] = word;
  }
  return { relations, dropped };
}

/* ------------------------------------------------------------------ notes --
   **A few notes the model chose to write** — Greg, 2026-10-11 (spya-qyuet0):
   *"give the LLM just a bit more freedom … explain things that would otherwise
   be confusing … highlight really important cross-references, especially if
   there's an inconsistency"*. Plan 261011o. Extra to the relation words, not
   part of their contract: a bad note is dropped and counted, never fails the
   run, and none at all is a real answer. */

/**
 * A note longer than this is dropped. The prompt asks for at most 25 words;
 * the slack is for a model that runs a little over, not for a paragraph.
 */
export const NOTE_MAX_WORDS = 35;

/** A quote longer than this is not a quote of the words a note is about. FAQ's limit (src/faq.ts). */
export const NOTE_MAX_QUOTE_CHARS = 300;

/**
 * **How many notes an article may have**: one per eight paragraphs asked
 * about, at least two and at most eight. The user message says the number;
 * this keeps it, after every other rule, in the model's order, which the
 * prompt makes most valuable first. Sparing is the point (*"We don't want to
 * overdo it"*): the cap is a ceiling the prompt says need not be reached.
 */
export function noteCap(paragraphs: number): number {
  return Math.min(8, Math.max(2, Math.ceil(paragraphs / 8)));
}

/**
 * **How many origin notes an article may have**, beside `noteCap`: one per
 * sixteen paragraphs, at least two and at most four. Their own allowance so
 * they never crowd out a *tension*, and a small one, because each is the
 * model's memory and nothing checks it (plan 261018i, Sol F4).
 */
export function sourceCap(paragraphs: number): number {
  return Math.min(4, Math.max(2, Math.ceil(paragraphs / 16)));
}

/** Kinds that must name the other passage; `explain` must not; `aside` may. */
const NEEDS_TARGET: ReadonlySet<MarginNoteKind> = new Set(["recall", "tension"]);
const NO_TARGET: ReadonlySet<MarginNoteKind> = new Set(["explain"]);
const NOTE_KIND_SET: ReadonlySet<string> = new Set(ARTICLE_NOTE_KINDS);

export function emptyNotesDropped(): MarginNotesDropped {
  return { malformed: 0, unknown: 0, offList: 0, badTarget: 0, unquoted: 0, badText: 0, repeated: 0, overCap: 0 };
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The article's characters for `typed` in `block`, or null: the quote must be there, spacing and all. */
function located(block: Pick<Block, "text">, typed: string): string | null {
  const span = findQuote(block.text, typed, undefined, "spaced");
  if (!span || span.end - span.start > NOTE_MAX_QUOTE_CHARS) return null;
  return block.text.slice(span.start, span.end);
}

/**
 * Turn what the model said into notes, believing as little as possible. Pure.
 *
 * `body` is every passage of the article's body (`isBodyEvidence`), which is
 * what the model was shown; a note may sit beside, or point at, any of them.
 * **Both ends are corroborated by a quote** (GPT Sol on the plan, P1-3): an
 * id alone can name a real but wrong block, and a note that says "the results
 * report 8%" beside a link to the methods is a confident wrong join. The
 * stored quotes are the article's characters, never the model's, as FAQ's.
 *
 * Every rule runs before the cap, so a malformed row never uses up a slot.
 * Never throws: a missing or malformed `notes` is no notes.
 *
 * `taken` is the passages that already have a note; this adds to it, so
 * `toSourceNotes` run after it with the same set keeps one note per passage
 * across both arrays.
 */
export function toNotes(
  raw: unknown,
  body: readonly Pick<Block, "id" | "text">[],
  cap: number,
  taken: Set<string> = new Set(),
): { notes: MarginNote[]; dropped: MarginNotesDropped } {
  const dropped = emptyNotesDropped();
  if (!Array.isArray(raw)) return { notes: [], dropped };
  const byId = new Map(body.map((b) => [b.id as string, b]));
  const notes: MarginNote[] = [];
  for (const row of raw as readonly unknown[]) {
    if (!row || typeof row !== "object") {
      dropped.malformed++;
      continue;
    }
    const r = row as Record<string, unknown>;
    const blockId = str(r.blockId);
    const targetShapeOk =
      (r.to === null || (typeof r.to === "string" && r.to.trim() !== "")) &&
      (r.toQuote === null || typeof r.toQuote === "string") &&
      (r.to === null) === (r.toQuote === null);
    const to = str(r.to) || null;
    const block = byId.get(blockId);
    const target = to === null ? null : byId.get(to);
    if (!block || target === undefined) {
      dropped.unknown++;
      continue;
    }
    const kind = str(r.kind);
    if (!NOTE_KIND_SET.has(kind)) {
      dropped.offList++;
      continue;
    }
    const k = kind as MarginNoteKind;
    if (
      !targetShapeOk ||
      to === blockId ||
      (to === null && NEEDS_TARGET.has(k)) ||
      (to !== null && NO_TARGET.has(k))
    ) {
      dropped.badTarget++;
      continue;
    }
    const quote = located(block, str(r.quote));
    const toTyped = str(r.toQuote);
    const toQuote = target === null ? null : located(target, toTyped);
    if (quote === null || (target !== null && toQuote === null)) {
      dropped.unquoted++;
      continue;
    }
    const { text, words } = noteText(r.text);
    if (words === 0 || words > NOTE_MAX_WORDS) {
      dropped.badText++;
      continue;
    }
    if (taken.has(blockId)) {
      dropped.repeated++;
      continue;
    }
    if (notes.length >= cap) {
      dropped.overCap++;
      continue;
    }
    taken.add(blockId);
    notes.push({ blockId: block.id, kind: k, text, quote, to: target?.id ?? null, toQuote });
  }
  return { notes, dropped };
}

/** A note's words, one space apart, and how many there are. */
function noteText(v: unknown): { text: string; words: number } {
  const text = str(v).replace(/\s+/g, " ");
  return { text, words: text === "" ? 0 : text.split(" ").length };
}

/**
 * **Origin notes**: where a quote, allusion or named reference in a passage
 * comes from, from the model's memory (Greg, spya-w99qsz; plan 261018i). Pure.
 *
 * The rows carry no kind: code stamps `source`, so a note from memory can
 * never be filed as one of the article-only kinds, nor one of those as this
 * (Sol F1). No other passage. The same checks as `toNotes` otherwise: the
 * passage is in the body, `quote` is in it, the words fit, one note per
 * passage — `taken` is shared with `toNotes` — and the cap last.
 *
 * **The quote proves where the note sits, not that the attribution is true.**
 * Nothing here can check that; the label the margin draws says so.
 */
export function toSourceNotes(
  raw: unknown,
  body: readonly Pick<Block, "id" | "text">[],
  cap: number,
  taken: Set<string>,
): { notes: MarginNote[]; dropped: MarginNotesDropped } {
  const dropped = emptyNotesDropped();
  if (!Array.isArray(raw)) return { notes: [], dropped };
  const byId = new Map(body.map((b) => [b.id as string, b]));
  const notes: MarginNote[] = [];
  for (const row of raw as readonly unknown[]) {
    if (!row || typeof row !== "object") {
      dropped.malformed++;
      continue;
    }
    const r = row as Record<string, unknown>;
    const blockId = str(r.blockId);
    const block = byId.get(blockId);
    if (!block) {
      dropped.unknown++;
      continue;
    }
    const quote = located(block, str(r.quote));
    if (quote === null) {
      dropped.unquoted++;
      continue;
    }
    const { text, words } = noteText(r.text);
    if (words === 0 || words > NOTE_MAX_WORDS) {
      dropped.badText++;
      continue;
    }
    if (taken.has(blockId)) {
      dropped.repeated++;
      continue;
    }
    if (notes.length >= cap) {
      dropped.overCap++;
      continue;
    }
    taken.add(blockId);
    notes.push({ blockId: block.id, kind: "source", text, quote, to: null, toQuote: null });
  }
  return { notes, dropped };
}

export const RELATIONS_SYSTEM = `You are reading the article above one paragraph at a time, to say how each
paragraph follows from the one before it.

WHAT TO DO

The user message lists paragraphs by their ids (like spya-k3m9qt), in reading
order. Beside each is the id of the paragraph before it. For every listed
paragraph, say how it bears on that paragraph before it, by choosing exactly
one word from the list below.

Judge by what the paragraph DOES, not by its first word. A paragraph can push
back without saying "but", and one that opens with "So" may only be carrying
on.

THE TEN RELATIONS

  "therefore"   — it draws its conclusion from the one before.
  "but"         — it pushes back on the one before: an objection, a limit, a
                  reason to doubt it.
  "because"     — it gives the reason for the one before.
  "for-example" — it is an instance of the claim the one before made.
  "contrast"    — it is set against what came before, without denying it: the
                  other side, the other case, the other group.
  "zoom-in"     — the same subject, in more detail.
  "zoom-out"    — it steps back from the detail to the larger point.
  "new-thread"  — it starts something the one before did not lead to.
  "restates"    — it makes the same point again, in other words.
  "and-also"    — more of the same line of thought, with no change of
                  direction. This is the default: choose it when nothing else
                  clearly fits.

Most paragraphs in most pieces simply carry on. Choose "therefore", "but" or
"contrast" only when the paragraph really does turn that way.

THE RULES

- Answer every listed id exactly once, in the order listed.
- In "relations", answer only the listed ids. Never invent an id, and never
  answer for a paragraph that is not on the list.
- A paragraph that follows a heading is judged like any other, against the
  paragraph named beside it.
- "relation" must be one of the ten words above, spelled exactly as shown.

${paperwork("relation")}

A FEW NOTES IN THE MARGIN — OPTIONAL

The reader sees the article with a narrow margin beside it. Besides the
relation words, you may write a few short notes for that margin, each beside
the passage it is about. Most pieces have a few places where a note would
help a reader — a step that is easy to stumble on, a point that depends on
something said much earlier, two passages that do not agree — and some have
none. Write a note only where a careful reader, reading straight through,
would be glad to find it there. A margin full of notes is worse than an empty
one, and the number the user message allows is a ceiling, not a target.

Four kinds:

  "tension" — this passage and another in the piece seem incompatible: they
              make claims about the same thing, in the same scope and at the
              same time, that cannot both be true as stated — a number that
              differs, a claim one asserts and the other denies, a term
              defined one way and used another. Say what each says, plainly.
              NOT a contrast the author draws on purpose, a qualification, a
              development of the argument, or a different group or period.
              It is the most useful note, and the most damaging when wrong.
  "recall"  — this passage leans on something said far from here, and being
              reminded of what that was would change how the reader takes
              this passage. Say the thing itself, not "see section 2". Not
              for the passage just before: the reader has just read it.
  "explain" — a step, term or move here that is likely to confuse this
              reader, unpicked in a sentence. Not a summary of the passage,
              and not a definition the passage itself gives.
  "aside"   — anything else short that would help this reader at this point.
              Use it rarely.

Each note names what it is about by quoting:

- "quote": the words in its own passage that the note is about, copied
  exactly from that passage, a phrase or a sentence.
- "to": the other passage's id. Required for "tension" and "recall"; null for
  "explain"; "aside" may name one or have null. Never the note's own passage.
- "toQuote": the words in the other passage that the note means, copied
  exactly from it. Null exactly when "to" is null.

The rules for notes:

- A note may sit beside, or point at, any passage of the article, not only
  the paragraphs listed for relations: a heading, a caption, the first
  paragraph.
- Use only the article. Not what you know from elsewhere.
- No more notes than the user message allows, and never two beside the same
  passage. List them most valuable first.
- Each note is one or two short sentences, at most 25 words, and says
  something the passage itself does not.
- Never write a note to paraphrase or summarise a passage, to praise or agree
  with it, or to label an ordinary step in the argument. Do not try to use
  every kind.

WHERE IT COMES FROM — A SEPARATE LIST, OPTIONAL

Pieces quote lines, allude to stories, and name people and works in passing,
often without saying where they come from. A reader then stops, and goes to
look it up. In "sourceNotes" you may save them that trip: a few short notes,
each beside a passage, saying where a quotation, allusion or named reference
comes from.

These are the only notes that may use what you know from outside the
article. The reader will see each one marked as from the AI's memory and
unchecked. So everything in them must be something you are sure of.

The ones worth writing are the ones the piece leaves bare:

- a phrase it uses without saying it is a quotation or someone's coinage
  ("the American century", "the medium is the message");
- a quotation it gives without saying whose it is, or from where;
- a person it names with no word of who they are;
- a story, event or work it alludes to without naming.

Write one only when all of these are true:

- **The piece does not already say it.** Read the passage and the sentences
  around it first. If they say who said it, which book or play it is from,
  or who the person is, there is nothing to add: write nothing, even though
  you know more. A work named with its author, or explained in the next
  sentence, needs no note.
- A careful general reader might not know it. A book, film or person almost
  every reader knows (Lord of the Flies, 1984, Shakespeare) needs no note.
- Knowing it helps them read this passage.
- It is not a formal citation to the piece's own references or footnotes.
  Those are listed elsewhere.
- You are sure of the answer at the level you give it.

How specific to be:

- Name an exact work, line or date only when you are sure of that exact work,
  line or date.
- Otherwise give only what you are sure of: the author, the tradition, the
  period. "A saying often credited to Mark Twain, though there is no record
  of him saying it" is a good note; "From Twain's Notebook (1902)" is a bad
  one unless you know it is true.
- If an attribution is disputed, or is commonly made but wrong, say so. That
  is often the most useful thing to say.
- Do not quote the original's wording from memory as though it were exact.
- If you are not sure where it comes from, write nothing. A wrong source is
  worse than none.

What to say:

- Where it comes from, and, if it helps, in a few words what the original was
  about.
- **Never say why the author chose it, what they meant by it, or what they
  were trying to do.** You cannot know, and the reader can judge the fit
  themselves.
- Not a definition of an ordinary word, and not a summary of the passage.

Each origin note has:

- "blockId": the passage it sits beside.
- "quote": the words in that passage it is about, copied exactly.
- "text": one or two short sentences, at most 25 words.

No more than the user message allows, most useful first, and never beside a
passage that already has a note in "notes". Most pieces need none or very
few. Do not put an origin note in "notes", and do not put anything from
outside the article in "notes".

${plainWords("explain")}

OUTPUT

JSON only, no prose, no code fence. The notes come first, while the whole
piece is in mind; "notes" and "sourceNotes" are always present, and either
may be an empty list:

{"notes": [
  {"blockId": "spya-w4n8hc", "kind": "tension", "quote": "cut errors by 12%", "text": "Here errors fall by 12%; the results give 8% for the same group and period.", "to": "spya-r2d6tm", "toQuote": "an 8% reduction in errors"}
],
"sourceNotes": [
  {"blockId": "spya-h6c2vq", "quote": "the past is a foreign country", "text": "The opening line of L. P. Hartley's novel The Go-Between (1953), about a man looking back on a childhood summer."}
],
"relations": [
  {"blockId": "spya-k3m9qt", "relation": "but"},
  {"blockId": "spya-p7x2wd", "relation": "and-also"}
]}`;

/** The user message: the paragraphs to answer, each beside the one before it. */
export function renderPrompt(paragraphs: readonly EligibleParagraph[]): string {
  const lines = paragraphs.map((p) => `${p.id} (the paragraph before it: ${p.previous})`);
  return `First write at most ${noteCap(paragraphs.length)} margin notes, or none.

Then at most ${sourceCap(paragraphs.length)} origin notes, or none.

Then say how each of these ${paragraphs.length} paragraphs bears on the paragraph before it. Answer every one, once, in this order.

=== THE PARAGRAPHS ===

${lines.join("\n")}`;
}

/**
 * The closed answer shape. `relation` is an enum of the ten words; `blockId`
 * is a plain string and is resolved after the parse, never an enum
 * (`assertNoBlockIdEnums`, docs/project/prompting-guide.md).
 */
export const RELATIONS_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    /* First, so the model writes them with the whole piece in mind rather
       than after a hundred mechanical rows (plan 261011o § Measurement).
       Always present, often empty; `to` always present and nullable, never
       omitted (the comma trap, docs/project/prompting-guide.md). */
    notes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          blockId: { type: "string" },
          kind: { type: "string", enum: [...ARTICLE_NOTE_KINDS] },
          quote: { type: "string" },
          text: { type: "string" },
          to: { type: ["string", "null"] },
          toQuote: { type: ["string", "null"] },
        },
        required: ["blockId", "kind", "quote", "text", "to", "toQuote"],
        additionalProperties: false,
      },
    },
    /* Origin notes, from memory (plan 261018i). No `kind`: code stamps
       `source`, so the article-only rule above is a field (Sol F1). */
    sourceNotes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          blockId: { type: "string" },
          quote: { type: "string" },
          text: { type: "string" },
        },
        required: ["blockId", "quote", "text"],
        additionalProperties: false,
      },
    },
    relations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          blockId: { type: "string" },
          relation: { type: "string", enum: [...RELATIONS] },
        },
        required: ["blockId", "relation"],
        additionalProperties: false,
      },
    },
  },
  required: ["notes", "sourceNotes", "relations"],
  additionalProperties: false,
} as const;

validateAnthropicJsonSchema(RELATIONS_OUTPUT_SCHEMA);
assertNoBlockIdEnums(RELATIONS_OUTPUT_SCHEMA, ["blockId", "to"]);

export interface RelationsRun {
  relations: Relations;
  /** False when there was nothing to label and no model was called. */
  called: boolean;
  /** How many paragraphs the model was asked about. */
  paragraphs: number;
  dropped: RelationsDropped;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  maxTokens: number;
  elapsedMs: number;
}

export async function generateRelations(opts: {
  /** The article, handed in — never a directory to open. src/article-input.ts. */
  article: Article;
  onProgress?: (detail: string) => void;
  signal?: AbortSignal;
  /** Mark the article as a cache breakpoint — see src/glossary.ts for the note. */
  cacheArticle?: boolean;
  /** Which capable model reads it — the article's High-powered AI setting (plan 260930f). */
  power: ModelPower;
}): Promise<RelationsRun> {
  const { blocks, tree, meta: realMeta } = opts.article;

  /* **Two values, deliberately**, as src/faq.ts: the stub is for the prompt's
     head and the fingerprint gets the real nullable meta, which is what the
     stamp hashes. tests/meta-fallback-fingerprint.test.ts asks the property. */
  const meta: Meta = realMeta ?? ({ title: fallbackHeadTitle(tree) } as Meta);
  const sourceHash = inputFingerprint(blocks, tree, realMeta);

  /* The body only, applied at the call site as `ideas` does — the same bytes.
     The paragraphs asked about are a subset of it. */
  const evidence = blocks.filter(isBodyEvidence);
  const paragraphs = eligibleParagraphs(blocks);
  const eligibleIds = paragraphs.map((p) => p.id);
  const started = Date.now();

  const artefact = (
    relations: Record<BlockId, Relation>,
    dropped: RelationsDropped,
    notes: { notes: MarginNote[]; dropped: MarginNotesDropped },
    origins: { notes: MarginNote[]; dropped: MarginNotesDropped },
  ): Relations => ({
    version: PROMPT_VERSION,
    generator: generatorFor(opts.power),
    slug: opts.article.slug,
    sourceHash,
    relations,
    dropped: { ...dropped },
    /* One list for the client, which tells them apart by kind. */
    notes: [...notes.notes, ...origins.notes],
    notesDropped: { ...notes.dropped },
    sourceNotesDropped: { ...origins.dropped },
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
  });

  /* Fewer than two body paragraphs: nothing has a paragraph before it. A real,
     empty artefact, and no call. */
  if (paragraphs.length === 0) {
    const dropped = emptyDropped();
    return {
      relations: artefact(
        {} as Record<BlockId, Relation>,
        dropped,
        { notes: [], dropped: emptyNotesDropped() },
        { notes: [], dropped: emptyNotesDropped() },
      ),
      called: false,
      paragraphs: 0,
      dropped,
      model: generatorFor(opts.power),
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      maxTokens: 0,
      elapsedMs: Date.now() - started,
    };
  }

  const answer = answerTokens(paragraphs.length);
  const maxTokens = budgetFor("relations", answer);

  let message: Anthropic.Message;
  try {
    const call = streamMessage(
      "relations",
      withMessagesJsonSchema(
        {
          max_tokens: maxTokens,
          thinking: { type: "adaptive" },
          output_config: { effort: effortFor("relations") },
          /* Article first, then this stage's instructions: byte-identical to
             `ideas` and `faq` up to the breakpoint. */
          system: [
            {
              type: "text" as const,
              text: articleWithIds(meta, evidence),
              ...(opts.cacheArticle ? { cache_control: { type: "ephemeral" as const } } : {}),
            },
            { type: "text" as const, text: RELATIONS_SYSTEM },
          ],
          messages: [{ role: "user", content: renderPrompt(paragraphs) }],
        },
        RELATIONS_OUTPUT_SCHEMA,
      ),
      { power: opts.power, ...(opts.signal ? { signal: opts.signal } : {}) },
    );

    if (opts.onProgress) {
      const report = opts.onProgress;
      let chars = 0;
      let last = 0;
      call.onText((delta) => {
        chars += delta.length;
        const now = Date.now();
        if (now - last < 500) return;
        last = now;
        report(`${paragraphs.length} paragraphs, ${Math.round(chars / 1000)}k characters so far`);
      });
    }

    /* `call.finalMessage()`, never `call.stream.finalMessage()` — the wrapper
       is what records what this call cost. src/messages-stream.ts. */
    message = await call.finalMessage();
  } catch (err) {
    throw anthropicCallFailed(err);
  }
  const raw = finishedText(message, "relations", maxTokens, answer);

  const parsed = parseJsonAnswer<{ relations?: unknown; notes?: unknown; sourceNotes?: unknown }>(
    raw,
    "the model's answer",
  );
  const { relations, dropped } = toRelations(parsed.relations, eligibleIds);
  /* The article-only notes first, so on a passage both name, theirs wins. */
  const taken = new Set<string>();
  const notes = toNotes(parsed.notes, evidence, noteCap(paragraphs.length), taken);
  const origins = toSourceNotes(parsed.sourceNotes, evidence, sourceCap(paragraphs.length), taken);

  /* Nothing is written here — the caller writes through the store. */
  return {
    relations: artefact(relations, dropped, notes, origins),
    called: true,
    paragraphs: paragraphs.length,
    dropped,
    model: generatorFor(opts.power),
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    maxTokens,
    elapsedMs: Date.now() - started,
  };
}
