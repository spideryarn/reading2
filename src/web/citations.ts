/**
 * Finding the block ids in a model's answer — the pure half of the citation
 * contract. See docs/plans/260826a-chat-mode.md § The citation contract, and
 * ChatPanel.tsx for the half that draws them.
 *
 * A module of its own, DOM-free and testable, for the same reason layout.ts,
 * comment-nav.ts and stats.ts are: **this is the feature.** A chat that cites
 * the article is the only version of chat this project was willing to build
 * (vision.md § Anti-goals), and the whole difference between that and an oracle
 * is whether these six characters end up as something you can press. Rules that
 * load-bearing should be checkable without a browser.
 *
 * **This file used to be twice this size**, and the other half was a hand-rolled
 * Markdown inline parser — bold runs paired across links, code spans, italics.
 * All of it went on 2026-08-31 when `mdast-util-from-markdown` arrived
 * (src/web/Cited.tsx, docs/plans/chat-markdown.md). What is left is the part no
 * Markdown library can do, and the reason each piece stayed:
 *
 *  - `splitCitations` — a block id has **no syntax**. It is matched on shape
 *    inside ordinary prose and checked against the article.
 *  - `splitLinks` — bare addresses, matched by `webLinks` in src/urls.ts, which
 *    the *server* also uses. Two matchers would give two answers.
 *  - `unknownIds` and `snippet` — the counter and the hover card.
 */
import { ID_PATTERN, ID_PREFIX } from "../ids.js";
import { CITATION_RUN, citableText } from "../citable.js";
import { webLinks } from "../urls.js";
import type { MentionedArticleView } from "../types.js";
import type { LearnConversationView } from "./thread-source.js";

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

/**
 * **Another of the reader's articles, brought into this conversation**, as a
 * citation chip needs it: where to go and what to call it. `href` is built
 * from the server's slug and never from anything the model wrote.
 */
export interface CrossSource {
  slug: string;
  title: string;
  /** `/read/<slug>`, without the block; the chip adds `?at=`. */
  href: string;
}

/**
 * **Which ids in an answer belong to a mentioned article**, and which belong to
 * more than one article and so to none.
 *
 * Sol's F1 on plan 261012d: a block id is unique within its article and not
 * across them — an import can carry an existing `spya-…` id
 * (docs/project/block-ids.md). So an id names an article only when exactly one
 * of the open article and the mentioned ones has it; otherwise it stays text,
 * because a chip that might open the wrong article is worse than none.
 */
export interface CrossArticles {
  /** Ids found in exactly one mentioned article and not in the open one. */
  byId: ReadonlyMap<string, CrossSource>;
  /** Ids found in two or more of the open article and the mentioned ones. */
  ambiguous: ReadonlySet<string>;
}

/** Nothing brought in: every id is the open article's or nobody's, as before. */
export const NO_CROSS: CrossArticles = { byId: new Map(), ambiguous: new Set() };

/**
 * Build the map from the open article's blocks and the server's list of the
 * articles this conversation brought in (`mentioned` on the thread). Only an
 * **available** one is read — an unavailable one carries no slug and no ids,
 * by construction (`MentionedArticleView` in src/types.ts).
 *
 * `hrefOf` is the router's `readHref`, passed in so this file stays DOM-free.
 */
export function crossArticles(
  open: Known,
  mentioned: readonly MentionedArticleView[] | undefined,
  hrefOf: (slug: string) => string,
): CrossArticles {
  if (!mentioned || mentioned.length === 0) return NO_CROSS;
  const byId = new Map<string, CrossSource>();
  const ambiguous = new Set<string>();
  for (const m of mentioned) {
    if (!m.available) continue;
    const source: CrossSource = { slug: m.slug, title: m.title, href: hrefOf(m.slug) };
    for (const id of new Set(m.blockIds)) {
      if (ambiguous.has(id)) continue;
      const other = byId.get(id);
      if (open.has(id) || (other && other.slug !== source.slug)) {
        byId.delete(id);
        ambiguous.add(id);
        continue;
      }
      byId.set(id, source);
    }
  }
  return { byId, ambiguous };
}

/**
 * **One of the reader's own conversations about this article**, as a chip
 * needs it — plan docs/plans/261024u-chat-links-the-earlier-conversation-it-mentions.md.
 * Built from the threads the server listed for the signed-in owner
 * (thread-links.ts § `threadLinks`), never from anything the model wrote: the
 * model's bracket only selects the id.
 */
export interface ThreadLink {
  id: string;
  /** What the reader's list calls it. */
  title: string;
  /** Which band opens it (thread-links.ts § `threadHref`). */
  target: ThreadTarget;
}

/**
 * Which band opens a conversation. A chat opens wherever chats are drawn now
 * (Chat's band, or the floating chat); the guide in Chat's band; a Recall or
 * Explore conversation in its part of Learn.
 */
export type ThreadTarget =
  | { band: "here" }
  | { band: "chat" }
  | { band: "learn"; view: LearnConversationView };

/** No conversations to link: every conversation id stays the characters the model wrote. */
export const NO_THREADS: ReadonlyMap<string, ThreadLink> = new Map();

/**
 * A run of prose, a run of the open article's ids the model cited together, a
 * run of one mentioned article's ids, or a run of the reader's conversations.
 */
export type Segment =
  | { kind: "text"; text: string }
  | { kind: "cite"; ids: string[] }
  | { kind: "cross"; ids: string[]; source: CrossSource }
  | { kind: "thread"; links: ThreadLink[] };

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
 * text until anything follows it. A `[label](url)` needs no such rule — its
 * closing `)` is proof the address finished — and since 2026-08-31 the parser
 * has taken those out before this ever sees them, so in practice this function
 * now sees bare addresses and nothing else. The bracketed branch stays in
 * `webLinks` because the server still meets both kinds.
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
 *
 * The pattern lives in src/citable.ts since 2026-10-24, so the server's
 * counters find the same runs (plan 261024u).
 */
const CITED = CITATION_RUN;

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
 *    link that happens to be broken. A run containing an ambiguous id is the
 *    exception: the whole run remains text, because dropping a collision would
 *    hide the fact that its source could not be established.
 *
 * Empty text segments are never emitted, so a paragraph that is nothing but a
 * citation does not come back with empty strings on either side of it.
 */
export function splitCitations(
  para: string,
  known: Known,
  cross: CrossArticles = NO_CROSS,
  threads: ReadonlyMap<string, ThreadLink> = NO_THREADS,
): Segment[] {
  /* **A conversation id is drawn only when no passage claims it.** Thread and
     block ids come from one mint (src/ids.ts), so a collision is very unlikely,
     but a chip that might open a conversation when the model meant a paragraph
     is the `CrossArticles` case again: text. */
  const clash = (id: string) =>
    threads.has(id) && (known.has(id) || cross.byId.has(id) || cross.ambiguous.has(id));
  const out: Segment[] = [];
  let last = 0;
  const push = (text: string) => {
    if (text !== "") out.push({ kind: "text", text });
  };

  for (const match of para.matchAll(CITED)) {
    /* Deduplicated, because a model that writes `[spya-k3m9qt spya-k3m9qt]`
       would otherwise get two identical chips — and, since the chips are keyed
       by id, two React children with the same key.

       An id more than one article has is not usable at all (`CrossArticles`),
       not even as the open article's: which one the model meant is exactly
       what nobody can tell. */
    const shaped = match[0].match(ID_SHAPED) ?? [];
    /* A collision is evidence that this whole citation run has no unambiguous
       provenance. Keep the run exactly as the model wrote it, rather than
       linking its other ids while silently deleting the colliding one. */
    if (shaped.some((id) => cross.ambiguous.has(id) || clash(id))) continue;
    const usable = [
      ...new Set(
        shaped.filter(
          (id) =>
            ID_PATTERN.test(id) &&
            !cross.ambiguous.has(id) &&
            (known.has(id) || cross.byId.has(id) || threads.has(id)),
        ),
      ),
    ];
    // Left where it is, and `last` deliberately not advanced — the run stays
    // part of whatever text segment it fell in.
    if (usable.length === 0) continue;
    push(para.slice(last, match.index));
    last = match.index + match[0].length;
    out.push(...grouped(usable, known, cross, threads));
  }
  push(para.slice(last));
  return out;
}

/**
 * One run, split by article in the order each first appears: the open
 * article's ids as they always were, each mentioned article's as its own, and
 * the reader's conversations as one more group. Every id is usable by now.
 */
function grouped(
  usable: readonly string[],
  known: Known,
  cross: CrossArticles,
  threads: ReadonlyMap<string, ThreadLink>,
): Exclude<Segment, { kind: "text" }>[] {
  const groups = new Map<string, Exclude<Segment, { kind: "text" }>>();
  for (const id of usable) {
    const link = known.has(id) || cross.byId.has(id) ? undefined : threads.get(id);
    if (link) {
      const group = groups.get("thread");
      if (group?.kind === "thread") group.links.push(link);
      else groups.set("thread", { kind: "thread", links: [link] });
      continue;
    }
    const source = known.has(id) ? undefined : cross.byId.get(id);
    const key = source ? `x:${source.slug}` : "open";
    const group = groups.get(key);
    if (group?.kind === "cite" || group?.kind === "cross") group.ids.push(id);
    else groups.set(key, source ? { kind: "cross", ids: [id], source } : { kind: "cite", ids: [id] });
  }
  return [...groups.values()];
}

/**
 * One double-quoted run: an opening `"` or `“`, a body with no quotation mark
 * in it, a closing `"` or `”`. Both marks are required, in the one string.
 */
const QUOTED = /["“]([^"“”]*)["”]/g;
/** The end of a sentence in the prose between quotations: `.`, `!` or `?`, then whitespace. */
const SENTENCE_BREAK = /[.!?]\s/;
/** Where a model says it left words out: `…`, `...`, or either in brackets. */
const ELISION = /\s*\[?(?:…|\.{3,})\]?\s*/;
/** Shorter than this is `"a self"`: too little to find, and nothing to hunt for in a long paragraph. */
const QUOTE_MIN = 8;

/**
 * **The quotations a citation chip is vouching for**: every double-quoted run
 * in `text` that is in the chip's own sentence, when `text` is the prose
 * between the previous chip (or the start of the run) and this one. Empty when
 * there is none, and then the chip behaves as it always has.
 *
 * A reader's report, spya-hzpf9b: an answer reads *He calls it "an intelligent
 * data pattern" [spya-ajt4fw]*, the chip lands on a 250-word paragraph and
 * washes all of it, and the sentence quoted cannot be found. With the words in
 * hand the flash can paint them instead (flash.ts § `FlashTarget.quotes`). Plan
 * docs/plans/261003i-tutorial-leans-to-retention-a-softer-blurb-quote-links-that-show-the-quote.md.
 *
 * **The same sentence, not only the words straight before the chip.** The
 * first version took a quotation only when nothing but whitespace lay between
 * it and the chip. Measured on 120 tutor turns
 * (docs/investigations/261003c-tutorial-prompt-leans-to-retention.md), about
 * one article quotation in ten is not there: the model writes *he says the engram
 * "looks increasingly random" once correlations are removed, so "the
 * interpretation … must be creative" [id]*, or *"salience" of the data,
 * reinterpreted fresh each time [id]* — one or two quotations earlier in the
 * sentence, the chip at its end. So a quotation counts when **no sentence
 * break lies between its closing mark and the chip**: a `.`, `!` or `?`
 * followed by whitespace, in the prose outside quotation marks. A break
 * disowns that quotation and every one before it.
 *
 * **What makes the looser rule safe is the other end** (flash.ts §
 * `quoteRanges`): each quotation is looked for in the cited block and painted
 * only if it is there. One wrongly attached here — a quotation from another
 * block, a scare-quoted word of the model's own — can at worst paint words
 * that really are in this chip's block, and usually paints nothing.
 *
 * **One text node is all this sees** (Cited.tsx § `cited`), so a quotation
 * with emphasis inside it — three inline nodes — has its opening mark in a
 * node this is never shown. The pattern needs both marks, so that case yields
 * nothing rather than the tail of the quotation. An accepted limit, pinned in
 * tests/quote-flash.test.tsx.
 *
 * **An elided quotation gives its longest piece**: the article does not contain
 * `a … b`, and one piece found is better than the pair not found. Sentence
 * punctuation the closing mark took in with it (`pattern."`) is dropped, since
 * the article's own sentence may not end there.
 */
export function quotesBefore(text: string): string[] {
  const runs = [...text.matchAll(QUOTED)];
  const out: string[] = [];
  /* Right to left, from the chip: the prose after each quotation and before
     the next one (or the chip) is the only place a break is looked for, so a
     full stop inside somebody's quotation is not one. */
  let gapEnd = text.length;
  for (const run of runs.reverse()) {
    if (SENTENCE_BREAK.test(text.slice(run.index + run[0].length, gapEnd))) break;
    gapEnd = run.index;
    let longest = "";
    for (const piece of (run[1] ?? "").split(ELISION)) {
      const words = piece.trim().replace(/[.,;:]+$/, "");
      if (words.length > longest.length) longest = words;
    }
    if (longest.length >= QUOTE_MIN && !out.includes(longest)) out.unshift(longest);
  }
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
  // renderer never turned it into one — nor is one in a code span, a link's
  // label or an image's alt text. `citableText` is the one definition of where
  // a citation can be, shared with the server's counters.
  for (const raw of citableText(text).match(new RegExp(`${ID_PREFIX}[a-z0-9]{6}`, "g")) ?? []) {
    if (ID_PATTERN.test(raw) && !known.has(raw)) bad.add(raw);
  }
  return [...bad];
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
