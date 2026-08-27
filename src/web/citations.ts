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
import { webLinks, withoutWebLinks } from "../urls.js";

/**
 * Whatever can answer "is this one of the article's blocks?".
 *
 * Structural rather than `ReadonlySet<string>` so that a `Map` of block id to
 * block text satisfies it too — the panel needs that map anyway, to put the
 * cited paragraph in a chip's tooltip, and building a parallel Set beside it
 * would be a second copy of one fact.
 */
export interface Known {
  has(id: string): boolean;
}

/** A run of prose, or a run of ids the model cited together. */
export type Segment = { kind: "text"; text: string } | { kind: "cite"; ids: string[] };

/** A run of prose, and whether the model asked for it to be emphasised. */
export interface Emphasis {
  text: string;
  bold: boolean;
}

/** A run of prose, or an address the model wants the reader to be able to press. */
export type LinkRun =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; url: string };

/**
 * Split a paragraph into prose and the links in it.
 *
 * **The matching itself is in src/urls.ts**, because the server needs the same
 * answer: it counts block-id citations in the raw answer text, and an id inside
 * a URL is neither a citation nor a hallucination. Two patterns would have
 * disagreed the first time either was edited. `webLinks` also carries the three
 * refusals — the scheme allowlist, an address with credentials in it, and a
 * bare address we would have had to truncate — and each of them leaves the
 * characters exactly where the model wrote them.
 *
 * **This runs before `splitCitations`, and the order is load-bearing.** That
 * function matches a bare run of ids on the shape `spya-[a-z0-9]{6}`, and a URL
 * is a string somebody else wrote: `https://example.com/notes/spya-k3m9qt`
 * carries that shape inside it. Citations-first, the id becomes a chip and the
 * address is torn in half — a link to `…/notes/` beside a chip pointing at a
 * block this article almost certainly does not have. So links come out whole
 * first, and only what is left is searched for citations.
 *
 * `partial` says the paragraph may be **half-written** — it is the last one of
 * an answer that is still streaming. A bare URL touching the end of such a
 * string is very likely half of an address, and a link to a truncated URL is
 * one a reader can click in the second before the rest arrives. So it stays
 * text until anything follows it. A Markdown link needs no such rule: its
 * closing `)` is proof the address finished.
 */
export function splitLinks(para: string, partial = false): LinkRun[] {
  const out: LinkRun[] = [];
  let last = 0;
  const push = (text: string) => {
    if (text !== "") out.push({ kind: "text", text });
  };

  for (const link of webLinks(para)) {
    if (partial && link.bare && link.toEnd) continue;
    push(para.slice(last, link.index));
    last = link.end;
    out.push({ kind: "link", text: link.label, url: link.url });
  }
  push(para.slice(last));
  return out;
}

/** A run of prose or a link, and whether the model asked for it to be bold. */
export interface EmphasisedRun {
  kind: "text" | "link";
  /** Prose, or the model's words for a destination. Markers removed. */
  text: string;
  /** Present on a link run. */
  url?: string;
  bold: boolean;
}

/** `**`, counted rather than parsed — see `emphasise`. */
const MARKER = /\*\*/g;

/**
 * Bold runs, paired **across** the links rather than inside each gap.
 *
 * `splitEmphasis` pairs `**` within one string, which was the whole of it until
 * links started cutting a paragraph into pieces. After that, the commonest
 * shape a model writes — `**[The paper](https://…)**` — arrives as three runs,
 * each holding one unpartnered marker, and the reader gets literal asterisks
 * around a link. Found by a GPT Sol review, 2026-08-27.
 *
 * So the markers are paired over the whole paragraph and a link inherits
 * whatever is open when it is reached. An **odd** count means the model left
 * one unclosed, and then nothing is emboldened and every marker stays literal —
 * the rule `splitEmphasis` already followed, for the reason written there:
 * guessing where the author meant to stop is how the rest of a paragraph ends
 * up bold.
 *
 * A link's own label is emphasised separately by the caller, so `[**Foo**](…)`
 * still works; its markers are not counted here, since they can never partner
 * one outside the label.
 *
 * **The toggle is used only where it is needed**, and the two guards below are
 * both about not losing characters:
 *
 *  - **There has to be a link.** A paragraph with none is handed to
 *    `splitEmphasis` exactly as it always was, so nothing this feature did can
 *    change how an ordinary answer — or a summary, which never has links at all
 *    — reads. The two rules differ on `**a*b**` and on a pair spanning a single
 *    newline, and there is no reason to change either where no link forced it.
 *  - **No two markers may be adjacent.** `****` encloses nothing, and a toggle
 *    would consume all four characters and emit none — silent text loss in the
 *    one parser this feature rests on, which is the accident `splitCitations`
 *    already has a paragraph about. `splitEmphasis` leaves it literal, so where
 *    it appears we fall back and it stays literal here too.
 */
export function emphasise(runs: LinkRun[]): EmphasisedRun[] {
  const texts = runs.filter((r) => r.kind === "text");
  const markers = texts.reduce((n, r) => n + (r.text.match(MARKER)?.length ?? 0), 0);
  const paired =
    markers > 0 &&
    markers % 2 === 0 &&
    runs.some((r) => r.kind === "link") &&
    // Empties at a run's edges are ordinary — `**` right before a link. An
    // empty *between* two markers is `****`, and that is the case above.
    texts.every((r) => r.text.split("**").slice(1, -1).every((piece) => piece !== ""));

  const out: EmphasisedRun[] = [];
  let bold = false;
  for (const run of runs) {
    if (run.kind === "link") {
      out.push({ kind: "link", text: run.text, url: run.url, bold });
      continue;
    }
    if (!paired) {
      for (const piece of splitEmphasis(run.text)) {
        out.push({ kind: "text", text: piece.text, bold: piece.bold });
      }
      continue;
    }
    for (const piece of run.text.split("**")) {
      if (piece !== "") out.push({ kind: "text", text: piece, bold });
      bold = !bold;
    }
    /* `split` yields one more piece than it saw markers, so the toggle above
       ran once too often for this run. */
    bold = !bold;
  }
  return out;
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
export function splitCitations(para: string, known: Known): Segment[] {
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
export function unknownIds(text: string, known: Known): string[] {
  const bad = new Set<string>();
  // Links out first, exactly as `unknownCitedIds` does server-side and for the
  // same reason: an id shape inside a URL is not a citation, because the
  // renderer never turned it into one. `withoutWebLinks` is the shared matcher.
  for (const raw of withoutWebLinks(text).match(new RegExp(`${ID_PREFIX}[a-z0-9]{6}`, "g")) ?? []) {
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

/**
 * A short, readable piece of a block, for a citation chip's hover card.
 *
 * Cut on a word boundary and only when there is something to cut — a short
 * paragraph is shown whole rather than given an ellipsis it has not earned.
 *
 * **`lastIndexOf` returns -1 when there is no space to cut at**, and
 * `slice(0, -1)` is not "nothing", it is "everything but the last character".
 * So the naive version silently showed a 5,000-character block *in full* inside
 * a tooltip — the failure mode being a card the height of the window, from the
 * one input that has no spaces in it. The same trap `titleFrom` in src/chat.ts
 * carries a note about; second sighting, hence a shared shape and a test.
 */
export function snippet(text: string, max = 260): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  // A word boundary only if there is one worth using; otherwise a hard cut,
  // which is still a bounded string.
  return `${space > max / 4 ? cut.slice(0, space) : cut}…`;
}
