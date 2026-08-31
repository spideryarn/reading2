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

/**
 * One piece of a paragraph: prose, an address the model wants the reader to be
 * able to press, or a span it wrote between backticks.
 *
 * The three travel together from here on, because emphasis has to be paired
 * across all of them at once — see `emphasise`.
 */
export type LinkRun =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; url: string }
  | { kind: "code"; text: string };

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

/** One piece of a paragraph, and whether the model asked for it to be bold. */
export interface EmphasisedRun {
  kind: "text" | "link" | "code";
  /** Prose, the model's words for a destination, or a code span. Markers removed. */
  text: string;
  /** Present on a link run. */
  url?: string;
  bold: boolean;
}

/** `**`, counted rather than parsed — see `emphasise`. */
const MARKER = /\*\*/g;

/**
 * Bold runs, paired **across** the links and code spans rather than inside each
 * gap.
 *
 * `splitEmphasis` pairs `**` within one string, which was the whole of it until
 * links started cutting a paragraph into pieces. After that, the commonest
 * shape a model writes — `**[The paper](https://…)**` — arrives as three runs,
 * each holding one unpartnered marker, and the reader gets literal asterisks
 * around a link. Found by a GPT Sol review, 2026-08-27.
 *
 * A code span does it too, and that one was found here rather than in a review:
 * `**bold with `` `code` `` inside**` came apart into two text runs holding one
 * marker each, so the whole thing lost its bold AND printed four asterisks. The
 * same bug as the link one, six days later, because code spans were split off
 * first and never rejoined. They are rejoined now.
 *
 * So the markers are paired over the whole paragraph and a link or a code span
 * inherits whatever is open when it is reached. An **odd** count means the model left
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
 *  - **There has to be a link or a code span.** A paragraph with neither is handed to
 *    `splitEmphasis` exactly as it always was, so nothing this feature did can
 *    change how an ordinary answer — or a summary, which never has links at all
 *    — reads. The two rules used to differ on `**a*b**` as well as on a pair
 *    spanning a single newline; the first difference went on 2026-08-31, when
 *    `splitEmphasis` started letting a lone `*` through so that
 *    `**bold with *italic* in it**` would work. The newline one stands.
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
    runs.some((r) => r.kind !== "text") &&
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
    if (run.kind === "code") {
      out.push({ kind: "code", text: run.text, bold });
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
 * **The first mark we ever read, and for a while the only one.** The prompt in
 * src/converse.ts asks for plain paragraphs and gets them, but models bold a
 * term they are introducing whatever you tell them, and printing the asterisks
 * makes the app look like it cannot read its own model's output. Found in a
 * browser test on 2026-08-25. Since 2026-08-31 it has company — `splitCode`,
 * `splitItalic`, and the blocks in markdown.ts — and the pass order between
 * them is written on each of those; this one is unchanged and still the pass
 * every other inline rule is described relative to.
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
  /* `[^*\n]` used to be the contents, which refused `**this is *italic* too**`
     outright and printed all six asterisks. A single `*` is allowed through;
     `**` still is not, so an unpartnered pair is left literal exactly as
     before, and the inner pair is the italic pass's business. Found by a GPT
     Sol review, 2026-08-31. */
  for (const match of text.matchAll(/\*\*((?:[^*\n]|\*(?!\*))+?)\*\*/g)) {
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

/**
 * `` `like this` `` → a run to be set in the mono face, and everything else
 * left alone.
 *
 * **The first inline split, and the order is the point.** What is inside
 * backticks is meant to be shown exactly as written, so it must not be searched
 * for links, for block ids or for emphasis: `` `**` `` is two asterisks a
 * reader asked about, not an unclosed bold run, and a block id in a code span
 * is a string being discussed rather than a place to go.
 *
 * A lone backtick with no partner stays literal, for the reason `splitEmphasis`
 * gives about `**`: guessing where the author meant to stop is how the rest of
 * a paragraph ends up in the wrong face. No newline inside a span, so a stray
 * backtick cannot reach across a line to one three sentences later — a fenced
 * *block* of code is a block, and markdown.ts has already taken it out.
 */
export function splitCode(text: string): LinkRun[] {
  const out: LinkRun[] = [];
  let last = 0;
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    if (match.index > last) out.push({ kind: "text", text: text.slice(last, match.index) });
    out.push({ kind: "code", text: match[1] ?? "" });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** Where each code span sits in the string, so a link can be told to avoid one. */
function codeRanges(text: string): [number, number][] {
  return [...text.matchAll(/`[^`\n]+`/g)].map((m) => [m.index, m.index + m[0].length]);
}

/**
 * A paragraph as prose, code spans and links — the input `emphasise` wants.
 *
 * **Both marks are found over the same string, and a link wins where they
 * overlap.** The first version lifted the code spans out first and looked for
 * links only in what was left, which is the obvious shape and loses a link
 * whose label contains code: `[run `` `npm test` ``](https://…)` came apart
 * into five pieces and the reader saw the brackets and the raw address. Found
 * by a GPT Sol review, 2026-08-31.
 *
 * Going the other way — links first — is worse, because it makes
 * `` `https://example.com/` `` a link, and the whole reason code is looked for
 * at all is that what is inside backticks is shown as written. So neither is
 * "first": both are matched against the whole paragraph, a link that *overlaps*
 * a code span is dropped, and what is left is walked once in order.
 *
 * A code span inside a link's label therefore stays in the label, as characters.
 * Drawing it as code there would put a second face inside something the reader
 * is about to press, and the label is the model's words for a destination
 * rather than prose.
 *
 * The result is ONE run list, which is what lets `emphasise` pair `**` across
 * the whole paragraph rather than inside each gap.
 *
 * `partial` is the caller's doubt about the tail of a streaming answer, and it
 * suppresses only a bare address that runs to the end. See `splitLinks`.
 */
export function splitInline(text: string, links: boolean, partial = false): LinkRun[] {
  const code = codeRanges(text);
  const out: LinkRun[] = [];
  let last = 0;
  const push = (from: number, to: number) => {
    if (to > from) out.push({ kind: "text", text: text.slice(from, to) });
  };

  /* A code span INSIDE a link's label is fine — that is the whole case this
     was rewritten for. What kills a link is a code span that only half overlaps
     it, because then the backticks were opened outside and the link is inside
     something being shown as written. */
  const found = links
    ? webLinks(text)
        .filter((l) => !(partial && l.bare && l.toEnd))
        .filter((l) =>
          code.every(([a, b]) => !(l.index < b && a < l.end) || (a >= l.index && b <= l.end)),
        )
    : [];

  const marks = [
    ...found.map((l) => ({ at: l.index, end: l.end, run: linkRun(l.label, l.url) })),
    // A code span inside a link has already been claimed by it.
    ...code
      .filter(([a, b]) => !found.some((l) => l.index < b && a < l.end))
      .map(([a, b]) => ({ at: a, end: b, run: codeRun(text.slice(a + 1, b - 1)) })),
  ].sort((x, y) => x.at - y.at);

  for (const mark of marks) {
    push(last, mark.at);
    out.push(mark.run);
    last = mark.end;
  }
  push(last, text.length);
  return out;
}

const linkRun = (text: string, url: string): LinkRun => ({ kind: "link", text, url });
const codeRun = (text: string): LinkRun => ({ kind: "code", text });

/** A run of prose, and whether the model asked for it to be italic. */
export interface Italics {
  text: string;
  italic: boolean;
}

/**
 * `*like this*` and `_like this_` → an italic run.
 *
 * The **innermost** pass: it runs on leaf strings, after bold, links and
 * citations have taken their characters out. That ordering is what lets one
 * character mean two things without a parser — by the time this sees a string,
 * every `**` that had a partner is gone, so a `*` left in it is a single
 * marker or it is punctuation.
 *
 * Three guards, each bought by a way this goes wrong on ordinary prose:
 *
 *  - **No marker may touch another marker.** `**` that survived the bold pass
 *    is an unbalanced pair the model left open, and `splitEmphasis` deliberately
 *    leaves those literal; matching half of one here would undo that decision.
 *  - **No space just inside the markers.** `2 * 3 * 4` is arithmetic, and a
 *    model writing about a formula should not have half of it leaning over.
 *  - **`_` only at a word boundary**, so `some_variable_name` — and any URL that
 *    got this far — keeps its underscores. Models mostly write `*`; `_` is
 *    supported because the ones that do write it write it everywhere.
 */
/* `\p{L}\p{N}` rather than `\w`, which is ASCII: `café_naïve_été` had its
   middle word italicised and both underscores deleted, because `é` is not a
   `\w` and so looked like a word boundary. The repo already had the right
   pattern for this in src/term-match.ts. Found by a GPT Sol review, 2026-08-31. */
const WORD = "\\p{L}\\p{N}";
const ITALIC = new RegExp(
  `(?<![*${WORD}])\\*(?![\\s*])([^*\\n]+?)(?<![\\s*])\\*(?![*${WORD}])` +
    `|(?<![${WORD}_])_(?![\\s_])([^_\\n]+?)(?<![\\s_])_(?![${WORD}_])`,
  "gu",
);

export function splitItalic(text: string): Italics[] {
  const out: Italics[] = [];
  let last = 0;
  for (const match of text.matchAll(ITALIC)) {
    if (match.index > last) out.push({ text: text.slice(last, match.index), italic: false });
    out.push({ text: match[1] ?? match[2] ?? "", italic: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), italic: false });
  return out;
}
