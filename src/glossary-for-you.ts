/**
 * **"For you" marks on the glossary** — the personal layer on top of a shared
 * artefact, and the first of its kind.
 *
 * > So, for example, maybe I might generate a glossary, and I always do that the
 * > same way, but then the post-processing personalization would flag some of
 * > those as being particularly relevant, or add a postscript that provides
 * > extra context that will be useful for me.
 * >
 * > — Greg, 2026-10-01 (spya-j5f7yv)
 *
 * The glossary is written for nobody in particular, because a visitor to a
 * public article reads it (src/profile.ts § PERSONAL_STEPS). This file takes
 * the finished term list and the owner's profile and asks one cheap call which
 * few terms are most worth *this* reader's attention, with one line each. The
 * answer is stored in its own owner-only column (`glossary_for_you`), never in
 * the glossary, and never read by the public path.
 *
 * Three things it is careful about:
 *
 * - **One serializer.** `forYouTermList` is the text the prompt carries and the
 *   input `forYouGlossaryHash` hashes, so the hash covers exactly what the
 *   model saw — id, name, gloss, in order (GPT Sol's finding 5). Two functions
 *   that each picked "the fields that matter" would drift.
 * - **The model's ids are claims.** A mark naming a term that is not in the
 *   list is dropped and counted, never shown (`toMarks`).
 * - **No article text.** The term list and the profile are the whole input, so
 *   the call is small and the article is not sent again.
 *
 * docs/plans/261001m-shared-mode-output-for-everyone-personalisation-as-an-addendum.md;
 * docs/project/glossary.md § Marked for you.
 */
import { createHash } from "node:crypto";

import { openRouterJson } from "./ai-call.js";
import { modelFor } from "./models.js";
import { parseJsonAnswer } from "./parse-json.js";
import { plainWords } from "./plain-words.js";
import { hashProfile, PROFILE_RULES } from "./profile.js";
import type {
  Glossary,
  GlossaryEntry,
  GlossaryForYou,
  GlossaryForYouMark,
  GlossaryForYouView,
} from "./types.js";

/** Which prompt wrote the marks. Bump it when the prompt or the term list's shape changes. */
export const PROMPT_VERSION = "glossary-for-you/1";

/** At most this many marks: a few pointers, not a second ranking of the list. */
export const FOR_YOU_MAX_MARKS = 8;

/** A note's ceiling in characters — one line under the gloss. */
export const FOR_YOU_NOTE_MAX = 160;

/**
 * How much of each entry's gloss the term list carries. The lead the panel
 * shows closed is one or two sentences; this keeps a long legacy `gloss` from
 * swelling the call, and the cut is part of the serializer, so the hash agrees.
 */
const GLOSS_CHARS = 240;

/** The answer's ceiling, thinking included (the quick tier is a reasoning model). */
const MAX_COMPLETION_TOKENS = 4_000;

/** A call that has not answered in this long is a failed one. */
const CALL_TIMEOUT_MS = 60_000;

/**
 * The one-line gloss the term list carries for an entry: what the panel shows
 * on a closed row (`entryProse` in src/web/GlossaryPanel.tsx — `senseHere`,
 * else `background`, else a legacy `gloss`), whitespace collapsed and cut.
 */
function glossLine(entry: GlossaryEntry): string {
  const lead = entry.senseHere || entry.background || entry.gloss || "";
  const flat = lead.replace(/\s+/g, " ").trim();
  return flat.length > GLOSS_CHARS ? `${flat.slice(0, GLOSS_CHARS - 1).trimEnd()}…` : flat;
}

/**
 * **The term list, exactly as the prompt carries it** — one line per entry, in
 * the glossary's order: `[id] name — gloss`. The single serializer: the prompt
 * prints this, and `forYouGlossaryHash` hashes this.
 */
export function forYouTermList(glossary: Pick<Glossary, "entries">): string {
  return glossary.entries
    .map((entry) => {
      const gloss = glossLine(entry);
      return gloss ? `[${entry.id}] ${entry.name} — ${gloss}` : `[${entry.id}] ${entry.name}`;
    })
    .join("\n");
}

/**
 * **Which glossary a set of marks annotates** — sixteen hex characters of the
 * term list above, like `hashProfile`. Moves when a term is added, removed,
 * renamed, reordered, or its gloss changes; does not move for a web lookup,
 * which is not in the list.
 */
export function forYouGlossaryHash(glossary: Pick<Glossary, "entries">): string {
  return createHash("sha256").update(forYouTermList(glossary), "utf8").digest("hex").slice(0, 16);
}

/**
 * The instructions. Constant, so the profile cannot edit the rules that
 * constrain it (src/profile.ts § `PROFILE_RULES`); the profile and the list go
 * in the user message.
 *
 * **The forbidden example is verbatim, and twice.** `PROFILE_RULES` carries it,
 * and this task is closer to flattery than any other that reads the profile —
 * it is *about* the reader — so the shapes it must not take are spelled out
 * again for a note. glossary.md's lesson: a ban relocates a register; a real
 * bad example removes it.
 */
export const GLOSSARY_FOR_YOU_SYSTEM = `You mark a few terms in an article's glossary for one particular reader.

You get the glossary's terms, one per line as [id] name — what it means here,
and a short description of who the reader is and why they are reading. The
glossary itself is written for any reader and stays as it is. Your job is the
small layer on top: which few terms most deserve THIS reader's attention, and
one line for each that helps them in particular.

WHICH TERMS

Pick at most ${FOR_YOU_MAX_MARKS}, and fewer is often better. Choose a term when, for this reader:
- it is likely to trip them up: a word they know from their own field that the
  article uses in a different sense, or a near-namesake of something they know;
- it bridges from what they already know: a concept they will recognise under
  another name;
- it is central to what they said they are reading for.
Do not pick a term only because it is hard or central in general; the glossary
already shows that to everyone. If no term is worth marking for this reader,
return an empty list.

THE NOTE

One plain sentence, under ${FOR_YOU_NOTE_MAX} characters, that adds context for this reader:
how the term relates to something they know, or how the article's sense differs
from the one they probably know. Never repeat the glossary's own definition.
Never say why you picked it for them, and never mention the description they
gave. Write about the term, not about the reader.

NEVER write a note of this shape:
  "As a cognitive scientist, you'll appreciate that…"
  "Given your background in physics, this will be familiar."
  "This is especially relevant to your goal of…"
  "You'll want to pay attention here."
GOOD (for a reader who works on neural networks):
  "Not the attention of transformers: here it means a person's focus, measured by eye tracking."

${plainWords("explain")}

${PROFILE_RULES}

ANSWER

JSON only, no prose around it:
{"marks":[{"id":"<a term id from the list, copied exactly>","note":"<one sentence>"}]}`;

/** The user message: who is reading, then the list. Nothing of the article. */
export function forYouMessage(glossary: Pick<Glossary, "entries">, profile: string): string {
  return `=== WHO IS READING ===

${profile}

=== THE GLOSSARY'S TERMS ===

${forYouTermList(glossary)}`;
}

/** What validation dropped, by why — counts only, for the log line. */
export interface ForYouDropped {
  /** A mark whose id is not a term in this glossary. */
  unknownId: number;
  /** A second mark on a term already marked. */
  duplicate: number;
  /** A mark with no usable note. */
  noNote: number;
  /** Marks beyond `FOR_YOU_MAX_MARKS`, after the above. */
  overCap: number;
  /** Notes cut to fit `FOR_YOU_NOTE_MAX` — kept, not dropped. */
  shortened: number;
}

export function emptyDropped(): ForYouDropped {
  return { unknownId: 0, duplicate: 0, noNote: 0, overCap: 0, shortened: 0 };
}

/** Cut a note to the ceiling at a word boundary, with an ellipsis. */
function fitNote(note: string): string {
  if (note.length <= FOR_YOU_NOTE_MAX) return note;
  const room = note.slice(0, FOR_YOU_NOTE_MAX - 1);
  const space = room.lastIndexOf(" ");
  return `${(space > FOR_YOU_NOTE_MAX / 2 ? room.slice(0, space) : room).trimEnd()}…`;
}

/**
 * **The model's answer, reduced to marks we can stand behind.**
 *
 * - an id not in the glossary is dropped (`unknownId`) — the model inventing a
 *   term is the failure this exists for;
 * - a second mark on one term is dropped;
 * - a note that is missing or blank drops its mark; one over the ceiling is cut;
 * - at most `FOR_YOU_MAX_MARKS` survive, taken in the order the model gave
 *   them (its priority), then returned in the glossary's own order.
 *
 * `null` when the answer is not the shape at all — no `marks` array — which is
 * a failed call, never an empty answer. `marks: []` is a real answer.
 */
export function toMarks(
  answer: unknown,
  glossary: Pick<Glossary, "entries">,
): { marks: GlossaryForYouMark[]; dropped: ForYouDropped } | null {
  const list = answer && typeof answer === "object" ? (answer as { marks?: unknown }).marks : undefined;
  if (!Array.isArray(list)) return null;
  const order = new Map(glossary.entries.map((entry, i) => [entry.id, i]));
  const dropped = emptyDropped();
  const kept: GlossaryForYouMark[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const raw = item && typeof item === "object" ? (item as { id?: unknown; termId?: unknown; note?: unknown }) : {};
    const id = typeof raw.id === "string" ? raw.id.trim() : typeof raw.termId === "string" ? raw.termId.trim() : "";
    if (!order.has(id)) {
      dropped.unknownId += 1;
      continue;
    }
    if (seen.has(id)) {
      dropped.duplicate += 1;
      continue;
    }
    const text = typeof raw.note === "string" ? raw.note.replace(/\s+/g, " ").trim() : "";
    if (!text) {
      dropped.noNote += 1;
      continue;
    }
    if (kept.length >= FOR_YOU_MAX_MARKS) {
      dropped.overCap += 1;
      continue;
    }
    const note = fitNote(text);
    if (note !== text) dropped.shortened += 1;
    seen.add(id);
    kept.push({ termId: id, note });
  }
  kept.sort((a, b) => (order.get(a.termId) ?? 0) - (order.get(b.termId) ?? 0));
  return { marks: kept, dropped };
}

/** What one run produced, and what it cost to find out. */
export interface ForYouRun {
  forYou: GlossaryForYou;
  dropped: ForYouDropped;
  model: string;
  inputTokens: number;
  outputTokens: number;
  terms: number;
}

/**
 * **Mark the glossary for one reader** — one quick-tier call, metered by the
 * gateway as job `glossary-for-you` inside the step's collector.
 *
 * Throws on a refused, failed or unreadable call: a step that wrote nothing
 * must say so rather than store an empty list that means "nothing for you".
 * The caller has already refused the two cases with nothing to ask about — no
 * profile, no terms (src/pipeline.ts § glossaryForYou).
 */
export async function generateGlossaryForYou(opts: {
  slug: string;
  glossary: Pick<Glossary, "entries">;
  /** The rendered profile (`renderProfile`, src/profile.ts) — never empty here. */
  profile: string;
  signal?: AbortSignal | undefined;
}): Promise<ForYouRun> {
  const started = Date.now();
  const model = modelFor("glossary-for-you", "standard");
  const deadline = AbortSignal.timeout(CALL_TIMEOUT_MS);
  const call = await openRouterJson(
    "glossary-for-you",
    {
      /* Quick tier: High-powered AI does not move it, as with `simple-check`. */
      model,
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      messages: [
        { role: "system", content: GLOSSARY_FOR_YOU_SYSTEM },
        { role: "user", content: forYouMessage(opts.glossary, opts.profile) },
      ],
    },
    { signal: opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline },
  );
  const body = call.json as {
    choices?: { message?: { content?: unknown } }[];
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  } | null;
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("glossary-for-you: the answer had no text");
  }
  const result = toMarks(parseJsonAnswer<unknown>(content, "glossary-for-you"), opts.glossary);
  if (!result) throw new Error("glossary-for-you: the answer had no marks list");
  return {
    forYou: {
      version: PROMPT_VERSION,
      generator: call.answeredBy ?? model,
      slug: opts.slug,
      glossaryHash: forYouGlossaryHash(opts.glossary),
      profileHash: hashProfile(opts.profile),
      marks: result.marks,
      generatedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
    },
    dropped: result.dropped,
    model: call.answeredBy ?? model,
    inputTokens: typeof body?.usage?.prompt_tokens === "number" ? body.usage.prompt_tokens : 0,
    outputTokens: typeof body?.usage?.completion_tokens === "number" ? body.usage.completion_tokens : 0,
    terms: opts.glossary.entries.length,
  };
}

/**
 * **The stored marks, if they annotate this glossary** — the store's half of
 * the owner's GET (src/store/pg.ts § loadGlossary). Marks made for an earlier
 * version of the list are not shown at all: a mark on a term that has since
 * been reworded would be a note about a gloss the reader is not looking at.
 */
export function marksForGlossary(
  stored: GlossaryForYou | null,
  glossary: Pick<Glossary, "entries">,
): GlossaryForYou | null {
  if (!stored || !Array.isArray(stored.marks)) return null;
  return stored.glossaryHash === forYouGlossaryHash(glossary) ? stored : null;
}

/**
 * **What the owner is shown** — the route's half, given the profile they have
 * now (`resolveProfile`, src/routes.ts). None when they have no profile now:
 * marks written for somebody they have stopped describing are not theirs to
 * act on, and *Mark again* could only refuse (GPT Sol's finding 8).
 */
export function forYouView(
  stored: GlossaryForYou | null,
  profile: string | null,
): GlossaryForYouView | null {
  if (!stored || !profile) return null;
  return {
    marks: stored.marks,
    marksProfileChanged: stored.profileHash !== hashProfile(profile),
    failed: stored.failed !== undefined,
  };
}

/**
 * **The record a failed call leaves** — no marks, `failed`, and the same
 * hashes a success would have had, so the GET can say *these terms were not
 * marked* about this list and this profile. Never current
 * (`forYouIsCurrent`), so the next run tries again.
 */
export function failedForYou(opts: {
  slug: string;
  glossary: Pick<Glossary, "entries">;
  profile: string;
  elapsedMs: number;
}): GlossaryForYou {
  return {
    version: PROMPT_VERSION,
    generator: "none",
    slug: opts.slug,
    glossaryHash: forYouGlossaryHash(opts.glossary),
    profileHash: hashProfile(opts.profile),
    marks: [],
    failed: "call",
    generatedAt: new Date().toISOString(),
    elapsedMs: opts.elapsedMs,
  };
}

/**
 * **Is a stored set of marks the one this step would write now?** — the
 * step's freshness, `(glossaryHash, profileHash, version)`, in one place so
 * the runner (`isDone`) and the metadata page (`isCurrent`, src/store/pg.ts)
 * cannot answer it two ways.
 *
 * `generator` is not compared: a quick-tier model swap is not a reason to
 * spend again on marks nobody has complained about. `profile` is the rendered
 * profile now; with none there is nothing these marks could be current for.
 */
export function forYouIsCurrent(
  stored: GlossaryForYou | null,
  glossary: Pick<Glossary, "entries"> | null,
  profile: string | null,
): boolean {
  if (!stored || !glossary || !profile) return false;
  return (
    stored.failed === undefined &&
    stored.version === PROMPT_VERSION &&
    stored.glossaryHash === forYouGlossaryHash(glossary) &&
    stored.profileHash === hashProfile(profile)
  );
}
