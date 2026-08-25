/**
 * Finding the block ids in a model's answer — the pure half of the citation
 * contract. See docs/plans/chat-mode.md § The citation contract, and
 * ChatPanel.tsx for the half that draws them.
 *
 * A module of its own, DOM-free and testable, for the same reason layout.ts,
 * comment-nav.ts and stats.ts are: **this is the feature.** A chat that cites
 * the article is the only version of chat this project was willing to build
 * (vision.md § Anti-goals), and the whole difference between that and an oracle
 * is whether these six characters end up as something you can press. Rules that
 * load-bearing should be checkable without a browser.
 */
import { ID_PATTERN, ID_PREFIX } from "../ids.js";

/** A run of prose, or a run of ids the model cited together. */
export type Segment = { kind: "text"; text: string } | { kind: "cite"; ids: string[] };

/** A run of prose, and whether the model asked for it to be emphasised. */
export interface Emphasis {
  text: string;
  bold: boolean;
}

/**
 * A bracketed run of **nothing but ids**, or a bare run of ids — and nothing
 * around either.
 *
 * Two alternatives rather than one pattern with optional brackets, and both
 * halves of that shape were bought with a bug.
 *
 * **The whitespace.** The first version wrapped the ids in
 * `\[?\s*…[\s,;]*\]?`, so the optional whitespace could match *outside* the
 * brackets — which it never did for a bracketed citation (the match starts at
 * the `[`) and always did for a bare one. `see spya-k3m9qt above` came apart as
 * `see` + chip + `above` and rendered as **seek3m9qtabove**.
 *
 * **The brackets.** The second version matched *any* short bracketed run, on
 * the reasoning that `[see above]` would simply yield no ids and be left alone.
 * True, but a bracket containing an id **and** prose was replaced whole: from
 * `[see spya-k3m9qt for discussion]` the reader got a bare chip, and "see" and
 * "for discussion" were deleted from the model's answer. Silent text loss in
 * the one parser the feature rests on. Found by a GPT-5.6 review, 2026-08-26.
 *
 * So alternative one now requires the brackets to hold ids and separators and
 * nothing else. A bracket with prose in it falls through to alternative two,
 * which lifts the id out and leaves every other character where it was.
 *
 *  - `\[\s*(?:spya-…[\s,;]*)+\]` — a pure citation: `[spya-k3m9qt]`,
 *    `[spya-k3m9qt spya-p7w2dn]`, `[spya-k3m9qt, spya-p7w2dn]`.
 *  - the bare run — one or more ids joined by a separator, starting and ending
 *    at an id, so no surrounding character is ever consumed.
 *
 * Both match on the **shape of an id** rather than on punctuation, so a model
 * that drops the brackets still gets working links and one that writes
 * `[see above]` does not get a broken one. `ID_PATTERN` does the real checking:
 * "looks like an id" and "is one of ours" are different questions.
 */
const CITED =
  /\[\s*(?:spya-[a-z0-9]{6}[\s,;]*)+\]|spya-[a-z0-9]{6}(?:[,;]?\s+spya-[a-z0-9]{6})*/g;

/** Every id-shaped string inside one match. */
const ID_SHAPED = /spya-[a-z0-9]{6}/g;

/**
 * Split an answer's paragraph into prose and citations.
 *
 * `known` is every block id the article actually has. Ids outside it are not
 * turned into links, and the two cases differ:
 *
 *  - **None of a run's ids are usable** — the run is returned as text, exactly
 *    as the model wrote it, brackets included. A chip that scrolls nowhere is
 *    worse than visible noise: the reader presses it, the page does not move,
 *    and nothing distinguishes that from a bug in the scrolling.
 *  - **Some are** — the usable ones come back as a citation and the rest are
 *    dropped. That loses a little of what the model literally said, chosen over
 *    printing a bogus id beside a working one, where it would read as a second
 *    link that happens to be broken.
 *
 * Empty text segments are never emitted, so a paragraph that is nothing but a
 * citation does not come back with empty strings on either side of it.
 */
export function splitCitations(para: string, known: ReadonlySet<string>): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  const push = (text: string) => {
    if (text !== "") out.push({ kind: "text", text });
  };

  for (const match of para.matchAll(CITED)) {
    /* Deduplicated, because a model that writes `[spya-k3m9qt spya-k3m9qt]`
       would otherwise get two identical chips — and, since the chips are keyed
       by id, two React children with the same key. */
    const usable = [
      ...new Set(
        (match[0].match(ID_SHAPED) ?? []).filter((id) => ID_PATTERN.test(id) && known.has(id)),
      ),
    ];
    // Left where it is, and `last` deliberately not advanced — the run stays
    // part of whatever text segment it fell in.
    if (usable.length === 0) continue;
    push(para.slice(last, match.index));
    last = match.index + match[0].length;
    out.push({ kind: "cite", ids: usable });
  }
  push(para.slice(last));
  return out;
}

/**
 * The ids an answer cites that this article does not have.
 *
 * The client's counterpart to `unknownCitedIds` in src/converse.ts, which logs
 * the same number server-side. Not used to render anything — it exists so the
 * question "did the model make one up" has one definition on both sides rather
 * than two that can drift.
 */
export function unknownIds(text: string, known: ReadonlySet<string>): string[] {
  const bad = new Set<string>();
  for (const raw of text.match(new RegExp(`${ID_PREFIX}[a-z0-9]{6}`, "g")) ?? []) {
    if (ID_PATTERN.test(raw) && !known.has(raw)) bad.add(raw);
  }
  return [...bad];
}

/**
 * `**like this**` → a run marked bold, and everything else left alone.
 *
 * **This is the whole of the Markdown we interpret**, and the shortlist is
 * deliberate rather than a first instalment. The prompt in src/converse.ts asks
 * for plain paragraphs and gets them — no headings, no links, rarely a list —
 * but models bold a term they are introducing whatever you tell them, and
 * printing the asterisks makes the app look like it cannot read its own model's
 * output. Found in a browser test on 2026-08-25.
 *
 * Everything else stays literal. That is not laziness: rendering model output
 * as HTML is precisely what docs/project/security.md exists to prevent, and the
 * reason this is safe is that it never produces HTML at all — it returns runs
 * of **text**, and React escapes text. A `dangerouslySetInnerHTML` here would
 * be a hole; there is no version of this function that needs one.
 *
 * Unbalanced asterisks are left as the model wrote them: `**` with no closing
 * pair is text, because guessing where the author meant to stop is how you end
 * up bolding the rest of a paragraph.
 */
export function splitEmphasis(text: string): Emphasis[] {
  const out: Emphasis[] = [];
  let last = 0;
  // Non-greedy, and no newline inside a run: a stray `**` at the start of a
  // paragraph would otherwise reach across to one three sentences later and
  // embolden everything in between.
  for (const match of text.matchAll(/\*\*([^*\n]+)\*\*/g)) {
    if (match.index > last) out.push({ text: text.slice(last, match.index), bold: false });
    out.push({ text: match[1] ?? "", bold: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out;
}
