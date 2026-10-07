/**
 * Model prose, drawn — the marks, the blocks, and `[spya-k3m9qt]` turned into
 * something you can press.
 *
 * **One definition, two panels.** This was chat's, privately, until the
 * summaries needed the same thing (Greg, 2026-08-26: *"Add block-ids to the
 * summary output — make them clickable, to scroll the text there, and also with
 * rich-tooltips"*). Two copies of "how a citation looks and what hovering one
 * shows" would drift, and the day they drift is the day a reader learns that a
 * chip means something slightly different depending on which band it is in.
 *
 * ## Where the Markdown comes from
 *
 * `mdast-util-from-markdown`, which is the tokenizer `remark-parse` is built
 * on. It gives back an **AST and stops** — no HTML at any stage, no `hast`, no
 * `remark-rehype`, nothing to sanitise. This file walks that tree into React
 * elements.
 *
 * It replaced a hand-rolled parser on 2026-08-31, the day after that parser was
 * written, on Greg's call after a review found seven defects in it — six of them
 * text the model wrote that never reached the reader. The reasoning, the
 * measurements and the library comparison are in docs/plans/chat-markdown.md.
 * The short version: **CommonMark is a specification with edge cases, and we do
 * not want to be the ones who know them all.**
 *
 * ## What is still ours, and why
 *
 * The library owns *structure* and the marks that have syntax. Three things it
 * cannot own:
 *
 *  - **Block ids have no syntax at all.** A bare `spya-k3m9qt` in ordinary prose
 *    is a citation if this article has that id and nothing otherwise, so it is
 *    matched on shape inside `text` nodes, by `splitCitations` — untouched by
 *    this rewrite, along with its two bug-history paragraphs.
 *  - **Bare URLs stay ours**, and that is not taste. `webLinks` in src/urls.ts is
 *    shared with the *server*, which strips links before counting cited ids so
 *    that an id inside a URL is not read as a hallucination. Letting the parser
 *    decide what a bare URL is would give the two sides two answers. So
 *    `remark-gfm` is deliberately **not** installed: its autolink literals are
 *    the one thing it offers that we would have to override anyway, and the rest
 *    of it is tables and footnotes we do not want.
 *  - **A link is checked before it is drawn** — scheme, credentials, the real
 *    host printed beside the model's label. See `drawLink`.
 *
 * ## Nothing here becomes markup
 *
 * This is model output. The article's own HTML is sanitised twice before it is
 * trusted (docs/project/security.md) and nothing here earns an exemption.
 * Every leaf reaches React as a **string**, which React escapes. Two node kinds
 * make that explicit rather than incidental: an `html` node — the model wrote
 * `<b>` — is drawn as its own characters, and so is an `image`, because an
 * `<img src>` built from model output is a request to an address a hostile page
 * chose. `sourceOf` is how both do it.
 */
import { createElement, Fragment, useMemo, type ReactElement, type ReactNode } from "react";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes, PhrasingContent, Root, RootContent, Text } from "mdast";
import { BlockRef } from "./BlockRef.js";
import { MAX_BLOCK_DEPTH } from "../citable.js";
import { chipFor } from "./chat-commands.js";
import { quotesBefore, splitCitations, splitLinks } from "./citations.js";
import { CommandChip } from "./CommandChip.js";
import type { CommandExecutor } from "./command-proposal.js";
import type { JumpAim } from "./flash.js";
import {
  splitCommandTokens,
  tokensOnOwnLine,
  unfinishedTokenAt,
  unsettledTokenLineAt,
} from "../command-token.js";
import type { BlockId } from "../types.js";
import { hasCredentials, hostOf, isWebUrl } from "../urls.js";

interface Props {
  /** One run of model prose, or a whole answer. */
  text: string;
  /** Every block this article has, id to plain text. Also the "is this real" check. */
  blocks: Map<string, string>;
  /**
   * `aim` arrives only from a chip whose sentence quotes the article, and
   * carries the quoted words so the landing can paint them rather than the
   * paragraph (`cited`, below). A caller that ignores it gets the jump it
   * always got.
   */
  onJump(id: BlockId, aim?: JumpAim): void;
  /**
   * The **end** of this text may be half-written — the answer is still arriving.
   *
   * There used to be a `live` flag beside this one, which took the per-chip
   * tooltips away while an answer streamed. The chips share one card now
   * (BlockLinkCard.tsx), which costs nothing per chip, so it went. Only a bare
   * address needs this one — a `[label](url)` is
   * proof its own address finished, and so is `<https://…>` — so it reaches
   * exactly one place, the last `text` node in the tree. See `splitLinks`.
   */
  partial?: boolean;
  /**
   * Draw links. **Off by default.**
   *
   * Opt-in rather than on everywhere, and the reason is a boundary rather than
   * a preference. An `href` built from model output is a place a hostile page
   * can steer a model into sending the reader (docs/project/security.md), so it
   * is allowed only where a prompt has been written to govern it — chat's
   * `LINKING TO THE WEB` rule, which says a URL must have come back from a tool
   * on this turn. The summary model reads the same untrusted article and has no
   * such rule, and summaries have never contained an address anyway.
   *
   * The first version of this turned links on for every caller of this file, on
   * the argument that a mark meaning two things in two bands is worse than
   * either. That argument is about *appearance*; this is about what an attacker
   * can reach. Raised by a GPT Sol review, 2026-08-27.
   */
  links?: boolean;
  /**
   * Draw command tokens as buttons, pressed through this executor. **Absent by
   * default**, and for `links`' reason: a button built from model output is
   * allowed only where a prompt governs it (converse.ts § OFFERING AN ACTION)
   * and a page has runners to give — chat, for the article's owner. Everywhere
   * else a `[cmd:…]` is the characters the model wrote. CommandChip.tsx.
   */
  commands?: CommandExecutor | undefined;
  /** Class for the chip wrapper, so each band can size its own. */
  className?: string;
}

/** Everything the walk below needs, gathered once per render. */
interface Ctx {
  blocks: Map<string, string>;
  onJump(id: BlockId, aim?: JumpAim): void;
  links: boolean;
  commands: CommandExecutor | undefined;
  className: string | undefined;
  /** The source, for drawing a node as the characters the model wrote. */
  source: string;
  /** The last `text` node in the tree, if its tail is not to be trusted. */
  tail: Text | null;
}

/**
 * A whole answer, with its blocks drawn as well as its marks.
 *
 * Chat and Candidates use this structured shape. Quiz marking is one run of
 * prose, so it uses `CitedText` instead.
 */
export function CitedMarkdown(props: Props): ReactElement {
  return <Drawn {...props} flat={false} />;
}

/**
 * One run of model prose: the marks and the citation chips, and **no structure**.
 *
 * The Quiz reply's, where the text sits inside a `<p>` that is already
 * `white-space: pre-wrap`, so model newlines remain line breaks.
 *
 * A block that is not a paragraph is drawn as **the characters the model wrote**
 * — see `drawBlock`. That is the one behaviour here worth being deliberate
 * about: flattening a list to its items' text would delete the `- ` from every
 * line, and silently deleting what the model wrote is the failure this whole
 * area keeps having. Showing the marker is what the panel did before any of
 * this existed.
 */
export function CitedText(props: Props): ReactElement {
  return <Drawn {...props} flat />;
}

function Drawn({
  text,
  blocks,
  onJump,
  partial = false,
  links = false,
  commands,
  className,
  flat,
}: Props & { flat: boolean }): ReactElement {
  /* Parsed once per distinct answer. A streamed answer changes on every token
     so this misses on every token by design — measured at ~1.5ms for a 4KB
     answer, which is the budget it has to fit in. What the memo removes is the
     re-parse on every UNRELATED re-render of the panel around it. */
  const tree = useMemo(() => fromMarkdown(text), [text]);
  const ctx: Ctx = {
    blocks,
    onJump,
    links,
    commands,
    className,
    source: text,
    tail: partial ? lastText(tree, text) : null,
  };
  return <>{drawBlocks(tree.children, ctx, flat)}</>;
}

/**
 * The last `text` node in the tree — the only place a half-written address can
 * be.
 *
 * By position rather than by walk order, because the two agree and the first is
 * one line. Everything above the tail has finished arriving, whatever block it
 * sits in: the first version of this passed the flag only to the last
 * *paragraph*, so a URL still arriving inside a quote or a heading was linked
 * two tokens before it became something else. Found by a GPT Sol review,
 * 2026-08-31.
 */
function lastText(tree: Root, source: string): Text | null {
  let last: Text | null = null;
  // Streaming inspects the whole tree, including blocks past the render cap.
  // Keep that inspection off the call stack too.
  const todo: Nodes[] = [tree];
  for (let node = todo.pop(); node; node = todo.pop()) {
    if (node.type === "text") {
      if (!last || (node.position?.end.offset ?? 0) > (last.position?.end.offset ?? 0)) last = node;
      continue;
    }
    // Reverse insertion preserves the old traversal's tie-breaking order.
    if ("children" in node) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        const child = node.children[i];
        if (child) todo.push(child);
      }
    }
  }
  /* **Only if it really is the end of the answer.** An answer whose last block
     is a code fence has its greatest-offset `text` node somewhere above it —
     that text has finished arriving, and suppressing a link in it left a
     finished URL unclickable until the whole answer landed. Over-suppression
     rather than a premature link, but a flicker either way. GPT Sol, 2026-08-31. */
  const ends = (last as Text | null)?.position?.end.offset ?? -1;
  return ends === source.trimEnd().length ? last : null;
}

/**
 * A node as the characters the model actually typed.
 *
 * The fallback for everything this file does not draw — raw HTML, images,
 * reference links and their definitions, and anything a future CommonMark
 * construct adds. **It cannot lose text**, which is why it is a slice of the
 * source rather than a reconstruction: whatever we failed to understand, the
 * reader still sees exactly what arrived.
 *
 * Positions are on every node `mdast-util-from-markdown` produces, so the
 * fallback below is for a future parser rather than this one. It falls back to
 * the node's own `value` rather than to `""`, because a review pointed out that
 * "cannot lose text" and "whatever CommonMark grows next" are a stronger pair of
 * claims than `""` supports: an `html` or `code` node still knows its own
 * characters even if it has forgotten where they came from.
 */
function sourceOf(node: Nodes, ctx: Ctx): string {
  const from = node.position?.start.offset;
  const to = node.position?.end.offset;
  if (from !== undefined && to !== undefined) return ctx.source.slice(from, to);
  return "value" in node && typeof node.value === "string" ? node.value : "";
}

/**
 * How deep a quote inside a list inside a quote may go before we stop reading
 * structure and draw the rest as its own characters.
 *
 * The parser handles 6,000 nested `>` markers without complaint; **this walk
 * does not**, and that distinction cost the first version of this rewrite a
 * defect. `drawBlocks` → `drawBlock` → `drawBlocks` is several stack frames per
 * level, and a review measured `RangeError: Maximum call stack size exceeded` at
 * around 2,400 levels. In this panel that is not a bad answer, it is the
 * conversation gone: the render throws and the reader loses the thread.
 *
 * The hand-rolled parser had this cap. Deleting the parser deleted it, which is
 * the shape of mistake a rewrite makes — the guard lived in the thing being
 * replaced rather than in the thing that needed it. GPT Sol, 2026-08-31.
 *
 * Twelve is past anything a model writes and nowhere near the stack — the
 * number is `MAX_BLOCK_DEPTH` in src/citable.ts, which says what counts as a
 * level. `citableText` there stops where this does, so the server counts
 * citations in exactly the text the reader is shown chips in; sharing the
 * number is not what makes that true, and
 * tests/chat-markdown-render.test.tsx § agrees at the depth cap is what checks it.
 */
const MAX_DEPTH = MAX_BLOCK_DEPTH;

/**
 * A run of blocks.
 *
 * In flat mode the blank line goes **between** them and not after each, which
 * is a sentence's worth of care for a reason: `.quiz-reply` is `pre-wrap`, so a
 * trailing `\n\n` is a visible empty line under every marked answer.
 * The first version of this appended one and seven older tests in
 * chat-web-links-render.test.tsx went red on the whitespace — which is exactly
 * what they were for.
 */
function drawBlocks(nodes: RootContent[], ctx: Ctx, flat: boolean, depth = 0): ReactNode[] {
  return nodes.map((node, i) => {
    const before = i > 0 ? nodes[i - 1] : undefined;
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: one immutable answer, rebuilt whole
      <Fragment key={`b${i}`}>
        {before && between(before, node, ctx, flat, depth)}
        {drawBlock(node, ctx, flat, depth)}
      </Fragment>
    );
  });
}

/**
 * What goes between two blocks.
 *
 * Usually nothing — a `<p>` and a `<ul>` space themselves. Two cases need
 * characters, and both are about **not losing what the model wrote**:
 *
 *  - **Either side is drawn as its own source.** A node's position covers the
 *    node; the blank line *between* two nodes belongs to neither, so two raw
 *    blocks in a row ran together on screen —
 *    `[a]: https://a.example[b]: https://b.example`. Found by a GPT Sol review,
 *    2026-08-31, which is also the review that pointed out the claim "`sourceOf`
 *    cannot lose text" was therefore false. The gap is taken from the source, so
 *    it is whatever the model actually typed.
 *  - **Flat mode**, where a paragraph break is a blank line rather than an
 *    element — see `CitedText`.
 */
function between(
  before: RootContent,
  after: RootContent,
  ctx: Ctx,
  flat: boolean,
  depth: number,
): string {
  if (asSource(before, flat, depth) || asSource(after, flat, depth)) {
    const from = before.position?.end.offset;
    const to = after.position?.start.offset;
    if (from !== undefined && to !== undefined && to > from) return ctx.source.slice(from, to);
  }
  return flat ? "\n\n" : "";
}

/** Is this block drawn as the characters the model typed rather than as itself? */
function asSource(node: RootContent, flat: boolean, depth: number): boolean {
  if (depth >= MAX_DEPTH) return true;
  if (flat) return node.type !== "paragraph";
  return !DRAWN.has(node.type);
}

/** The block kinds `drawBlock` has an element for. Everything else is source. */
const DRAWN = new Set(["paragraph", "heading", "list", "blockquote", "code", "thematicBreak"]);

function drawBlock(node: RootContent, ctx: Ctx, flat: boolean, depth = 0): ReactNode {
  // Past the cap nothing is structure — see MAX_DEPTH.
  if (depth >= MAX_DEPTH) return sourceOf(node, ctx);
  if (node.type === "paragraph") {
    const inner = inline(node.children, ctx, false, true);
    /* In flat mode a paragraph is its own contents; the blank line between one
       paragraph and the next is `drawBlocks`'s, which `.quiz-reply`'s
       `pre-wrap` shows. */
    return flat ? inner : <p>{inner}</p>;
  }
  // Structured blocks are for Chat and Candidates. A Quiz mark shows the
  // model's characters instead — see CitedText.
  if (flat) return sourceOf(node, ctx);

  switch (node.type) {
    case "heading":
      /* `h4` and down, never `h1`. The panel's own title is the `h2` above
         these, so an answer that starts with `#` must not outrank it — a
         document outline that says the reply is the page is worse than a
         heading a step smaller than the model imagined. */
      return createElement(
        `h${Math.min(6, node.depth + 3)}`,
        { className: "fmt-h" },
        inline(node.children, ctx),
      );
    case "list":
      return drawList(node, ctx, depth);
    case "blockquote":
      /* A quote is evidence the model is repeating, not its own offer. In
         particular a fetched page may contain an exact token on its own line;
         leaving the executor in scope would turn quoted hostile text into a
         button. Links and citations still draw as before. */
      return (
        <blockquote className="fmt-quote">
          {drawBlocks(node.children, { ...ctx, commands: undefined }, false, depth + 1)}
        </blockquote>
      );
    case "code":
      /* No highlighting and no language badge. The face and the box are what
         make code readable at this size; the rest is a library. An unclosed
         fence still lands here — CommonMark says a code block runs to the end
         of its container — which is what a reader watching an answer arrive
         should see. */
      return (
        <pre className="fmt-pre">
          <code>{node.value}</code>
        </pre>
      );
    case "thematicBreak":
      return <hr className="fmt-rule" />;
    default:
      // `html`, `definition`, and whatever CommonMark grows next.
      return sourceOf(node, ctx);
  }
}

/**
 * One list.
 *
 * `start` is carried through, so a model that numbers from 3 — which happens
 * when it continues a list across two answers — gets a 3 rather than a 1
 * silently correcting it.
 *
 * An item whose content is a single paragraph loses the `<p>`, which is the
 * difference between a tight list and one with a blank line between every
 * bullet. mdast decides looseness for the whole list (`spread`); this decides
 * it per item, which is simpler and looks the same on everything a model writes.
 */
function drawList(node: RootContent & { type: "list" }, ctx: Ctx, depth: number): ReactElement {
  const items = node.children.map((item, i) => {
    const only = item.children.length === 1 ? item.children[0] : undefined;
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: one immutable answer, rebuilt whole
      <li key={`i${i}`}>
        {only?.type === "paragraph"
          ? inline(only.children, ctx, false, true)
          : drawBlocks(item.children, ctx, false, depth + 1)}
      </li>
    );
  });
  return node.ordered ? (
    <ol className="fmt-list" start={node.start ?? 1}>
      {items}
    </ol>
  ) : (
    <ul className="fmt-list">{items}</ul>
  );
}

/**
 * **Whether a text node's first and last characters sit at a line's edge** —
 * what a command token needs to know to be a button (src/command-token.ts §
 * `tokensOnOwnLine`). Only a paragraph's own children can: a node inside a
 * bold run, a heading or a link's label is never a line.
 */
interface Edges {
  readonly starts: boolean;
  readonly ends: boolean;
}
const MID_LINE: Edges = { starts: false, ends: false };

/**
 * The marks inside a block. `label` renders a link's own words — see
 * `drawLink`. `lines` says these are a paragraph's own children, so the first,
 * the last, and whatever sits beside a hard break is at a line's edge.
 */
function inline(nodes: PhrasingContent[], ctx: Ctx, label = false, lines = false): ReactNode[] {
  const edge = (i: number): boolean => {
    const beside = nodes[i];
    return beside === undefined || beside.type === "break";
  };
  return nodes.map((node, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: one immutable answer, rebuilt whole
    <Fragment key={`p${i}`}>
      {drawPhrase(node, ctx, label, lines ? { starts: edge(i - 1), ends: edge(i + 1) } : MID_LINE)}
    </Fragment>
  ));
}

function drawPhrase(node: PhrasingContent, ctx: Ctx, label: boolean, edges: Edges): ReactNode {
  switch (node.type) {
    case "text":
      return label ? node.value : leaf(node, ctx, edges);
    case "strong":
      return <strong>{inline(node.children, ctx, label)}</strong>;
    case "emphasis":
      return <em>{inline(node.children, ctx, label)}</em>;
    case "inlineCode":
      /* Shown as written, and reaching no other rule: `**` in a code span is two
         asterisks a reader asked about, and a block id in one is a string being
         discussed rather than a place to go. */
      return <code className="fmt-code">{node.value}</code>;
    case "break":
      return <br />;
    case "link":
      // A link inside a link's own label is not a link. Nor is one at all
      // where the caller has not opted in.
      return label || !ctx.links ? sourceOf(node, ctx) : drawLink(node, ctx);
    default:
      // `image`, `html`, `linkReference`, `footnoteReference`, …
      return sourceOf(node, ctx);
  }
}

/**
 * A `text` node: the bare addresses in it, and the citation chips between them.
 *
 * `splitLinks` rather than the parser, because `webLinks` is shared with the
 * server — see this file's header. It runs first for the reason it always did:
 * `splitCitations` matches a bare run of ids by *shape*, and
 * `https://example.com/notes/spya-k3m9qt` carries that shape inside its path.
 */
function leaf(node: Text, ctx: Ctx, edges: Edges): ReactNode {
  const tail = node === ctx.tail;
  if (!ctx.links) return cited(node.value, ctx, edges, tail);
  const runs = splitLinks(node.value, tail);
  const last = runs.length - 1;
  return runs.map((run, i) =>
    run.kind === "link" ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: one immutable answer, rebuilt whole
      <Fragment key={`l${i}`}>{anchor(run.text, run.url)}</Fragment>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: one immutable answer, rebuilt whole
      <Fragment key={`t${i}`}>
        {/* A run beside a link is mid-line on that side, whatever the node is. */}
        {cited(run.text, ctx, { starts: edges.starts && i === 0, ends: edges.ends && i === last }, tail && i === last)}
      </Fragment>
    ),
  );
}

/**
 * A `[label](url)` or `<https://…>` the parser found.
 *
 * **The checks are ours and they happen here**, because the parser will hand
 * back any string at all as a `url` — `javascript:`, an address with
 * credentials in it, a `mailto:`. `isWebUrl` and `hasCredentials` are the same
 * two refusals `webLinks` makes about a bare address, so both kinds of link get
 * the same answer. A refused link is drawn as the characters the model typed,
 * which loses nothing and links nowhere.
 */
function drawLink(node: PhrasingContent & { type: "link" }, ctx: Ctx): ReactNode {
  if (!isWebUrl(node.url) || hasCredentials(node.url)) return sourceOf(node, ctx);
  /* `<https://…>` — CommonMark's angle autolink, which needs no `remark-gfm` —
     arrives with the address as its own label. Handing `anchor` the plain
     string lets it see that and skip the host, which would otherwise print the
     address twice on one line. */
  const only = node.children.length === 1 ? node.children[0] : undefined;
  if (only?.type === "text") return anchor(only.value, node.url);
  return anchor(inline(node.children, ctx, true), node.url);
}

/**
 * One link, and the host it actually goes to.
 *
 * **The host is printed, quietly, beside the label.** That is not decoration:
 * the label is the model's to choose, the model has just been reading pages we
 * do not control, and `[the Anthropic paper](https://not-anthropic.example/)` is
 * a plausible sentence with a hostile destination. The hover card shows the real
 * address, but a card takes 320ms of rest to open and a click does not wait for
 * it — so the one fact that cannot be faked is on the page rather than behind a
 * gesture. Raised by a GPT Sol review, 2026-08-27, which is also where the
 * credentials refusal came from.
 *
 * Not printed when the label already *is* the address, which would say it twice.
 *
 * Three guards besides, all of them reuses: the scheme was checked before this
 * is reached — by `webLinks` for a bare address, by `drawLink` above for one the
 * model wrote in `[…](…)`; the label and the URL are *strings* that React
 * escapes, never HTML; and `noreferrer` as well as `noopener`, because the
 * article's own URL is a reading history and a model-supplied destination is
 * not owed it. docs/plans/260827ao-chat-web-links.md.
 */
function anchor(label: ReactNode, url: string): ReactElement {
  const host = hostOf(url);
  const shown = typeof label === "string" ? label : "";
  return (
    <>
      <a className="cited-link" href={url} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
      {host !== "" && shown !== url && <span className="cited-link-host">{host}</span>}
    </>
  );
}

/**
 * One link-free run of text: the command tokens in it, and the citations
 * between them.
 *
 * **Tokens come out before citations, and the order is load-bearing** for the
 * reason links come out before both: `[cmd:bookmark:spya-k3m9qt]` carries the
 * shape of a block id, and citations-first would tear it into a chip and two
 * scraps of syntax. `citableText` (src/citable.ts) blanks the same span, so the
 * server's counters agree.
 *
 * A token is a button only where the caller handed in an executor, it stands
 * **on a line of its own** (src/command-token.ts § `tokensOnOwnLine` — a token
 * mid-sentence is one being talked about, not offered) **and** `chipFor`
 * accepts it (chat-commands.ts). Otherwise it is the characters the model
 * wrote, whole — an invalid token's id is still not a citation.
 *
 * `end` says this run is the tail of an answer still arriving. A half-arrived
 * token there, or a complete one on the still-open final line, is left undrawn
 * until a newline or the end of the stream settles what it is
 * (src/command-token.ts § `unfinishedTokenAt`, `unsettledTokenLineAt`).
 */
function cited(text: string, ctx: Ctx, edges: Edges, end: boolean): ReactNode {
  const commands = ctx.commands;
  /* The current end of a stream is not an established line edge. Hold a
     complete token-only final line as well as a half token: a later delta may
     append prose and prove it was a quotation in the middle of a sentence.
     A newline settles the line before the stream itself finishes. */
  const openStreamLine = end && !/[\r\n][ \t]*$/.test(ctx.source);
  let cut = openStreamLine && commands !== undefined ? unfinishedTokenAt(text) : -1;
  if (cut === -1 && openStreamLine && commands !== undefined) {
    cut = unsettledTokenLineAt(text, edges.starts);
  }
  const runs = splitCommandTokens(cut === -1 ? text : text.slice(0, cut));
  const ownLine = tokensOnOwnLine(runs, edges.starts, edges.ends);
  let token = 0;
  return runs.map((run, i) =>
    run.kind === "text" ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: one immutable answer, rebuilt whole
      <Fragment key={`r${i}`}>{citations(run.text, ctx)}</Fragment>
    ) : ownLine[token++] === true &&
      commands !== undefined &&
      chipFor(run.raw, commands, ctx.blocks) !== null ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: one immutable answer, rebuilt whole
      <CommandChip key={`k${i}`} raw={run.raw} commands={commands} blocks={ctx.blocks} />
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: one immutable answer, rebuilt whole
      <Fragment key={`k${i}`}>{run.raw}</Fragment>
    ),
  );
}

/**
 * The citation chips and the prose between them — one run with no link and no token in it.
 *
 * **A chip carries the quotations of its own sentence**, so pressing it paints
 * those words in the block rather than the whole paragraph (a reader's report,
 * spya-hzpf9b; citations.ts § `quotesBefore` has the rule and what makes it
 * safe). Only the segment immediately before the chip is asked — the prose
 * since the previous chip — so a quotation is never handed past one citation
 * to the next. Every id of one bracket gets them, because `"…" [a, b]` does
 * not say which of the two the words are from: each block paints what it has,
 * and one that has none washes whole, as before.
 */
function citations(text: string, ctx: Ctx): ReactNode {
  const segs = splitCitations(text, ctx.blocks);
  return segs.map((seg, i) => {
    if (seg.kind === "text") {
      // biome-ignore lint/suspicious/noArrayIndexKey: one immutable answer, rebuilt whole
      return <Fragment key={`s${i}`}>{seg.text}</Fragment>;
    }
    const before = segs[i - 1];
    const quotes = before?.kind === "text" ? quotesBefore(before.text) : [];
    return (
      <span
        className={["cite-chips", ctx.className].filter(Boolean).join(" ")}
        // biome-ignore lint/suspicious/noArrayIndexKey: one immutable answer, rebuilt whole
        key={`c${i}`}
      >
        {/* The card on hover — the paragraph itself, so a claim can be checked
            against the article without leaving the sentence (summaries.md § A
            summary is a door) — is `BlockRef`'s now, one card shared with every
            other block link on the page (BlockLinkCard.tsx). It was this
            file's own `CitedBlock`, one `Tooltip` per chip, until 2026-09-28. */}
        {seg.ids.map((id) => (
          <BlockRef key={id} id={id} onJump={ctx.onJump} {...(quotes.length === 0 ? {} : { quotes })} />
        ))}
      </span>
    );
  });
}
