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
import { BlockRef, shortBlockId } from "./BlockRef.js";
import { Tooltip } from "./Tooltip.js";
import { snippet, splitCitations, splitLinks } from "./citations.js";
import type { BlockId } from "../types.js";
import { hasCredentials, hostOf, isWebUrl } from "../urls.js";

interface Props {
  /** One run of model prose, or a whole answer. */
  text: string;
  /** Every block this article has, id to plain text. Also the "is this real" check. */
  blocks: Map<string, string>;
  onJump(id: BlockId): void;
  /**
   * The answer is still arriving.
   *
   * **No tooltip while it is.** A streamed answer re-renders on every token, so
   * a Floating UI instance per chip would be a dozen `useFloating` hooks
   * created and torn down a hundred times during one reply. Once the text has
   * landed it re-renders no more and the tooltips cost nothing — which is also
   * the only time anybody is reading carefully enough to hover one. `BlockRef`'s
   * native `title` covers the gap. Nothing in summary mode streams, so this
   * defaults off.
   */
  live?: boolean;
  /**
   * The **end** of this text may be half-written — the answer is still arriving.
   *
   * A separate flag from `live`, and deliberately: `live` is about how much
   * machinery to mount while the text keeps changing, and this is about trusting
   * the last few characters. Only a bare address needs it — a `[label](url)` is
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
  /** Class for the chip wrapper, so each band can size its own. */
  className?: string;
}

/** Everything the walk below needs, gathered once per render. */
interface Ctx {
  blocks: Map<string, string>;
  onJump(id: BlockId): void;
  live: boolean;
  links: boolean;
  className: string | undefined;
  /** The source, for drawing a node as the characters the model wrote. */
  source: string;
  /** The last `text` node in the tree, if its tail is not to be trusted. */
  tail: Text | null;
}

/**
 * A whole answer, with its blocks drawn as well as its marks.
 *
 * Chat's, and only chat's. The summary prompt asks for plain sentences and gets
 * them, and a summary is dense enough that a stray `#` becoming a heading would
 * be worse than a stray `#` — so summaries use `CitedText`, which reads the same
 * marks and refuses the same structure.
 */
export function CitedMarkdown(props: Props): ReactElement {
  return <Drawn {...props} flat={false} />;
}

/**
 * One run of model prose: the marks and the citation chips, and **no structure**.
 *
 * The summary panel's, where the text sits inside a `<p>` that is already
 * `white-space: pre-wrap`, so paragraphs are blank lines rather than elements.
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
  live = false,
  partial = false,
  links = false,
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
    live,
    links,
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
  const walk = (node: Nodes) => {
    if (node.type === "text") {
      if (!last || (node.position?.end.offset ?? 0) > (last.position?.end.offset ?? 0)) last = node;
      return;
    }
    if ("children" in node) for (const child of node.children) walk(child);
  };
  walk(tree);
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
 * Twelve is past anything a model writes and nowhere near the stack.
 * `citableText` (src/citable.ts) stops at the same depth, so the server counts
 * citations in exactly the text the reader is shown chips in.
 */
const MAX_DEPTH = 12;

/**
 * A run of blocks.
 *
 * In flat mode the blank line goes **between** them and not after each, which
 * is a sentence's worth of care for a reason: `.summ-text` is `pre-wrap`, so a
 * trailing `\n\n` is a visible empty line under every summary in the panel.
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
    const inner = inline(node.children, ctx);
    /* In flat mode a paragraph is its own contents; the blank line between one
       paragraph and the next is `drawBlocks`'s, which is what `.summ-text`'s
       `pre-wrap` has always shown. */
    return flat ? inner : <p>{inner}</p>;
  }
  // Structure is chat's. A summary shows the characters instead — see CitedText.
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
      return (
        <blockquote className="fmt-quote">
          {drawBlocks(node.children, ctx, false, depth + 1)}
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
          ? inline(only.children, ctx)
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

/** The marks inside a block. `label` renders a link's own words — see `drawLink`. */
function inline(nodes: PhrasingContent[], ctx: Ctx, label = false): ReactNode[] {
  return nodes.map((node, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: one immutable answer, rebuilt whole
    <Fragment key={`p${i}`}>{drawPhrase(node, ctx, label)}</Fragment>
  ));
}

function drawPhrase(node: PhrasingContent, ctx: Ctx, label: boolean): ReactNode {
  switch (node.type) {
    case "text":
      return label ? node.value : leaf(node, ctx);
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
function leaf(node: Text, ctx: Ctx): ReactNode {
  if (!ctx.links) return cited(node.value, ctx);
  return splitLinks(node.value, node === ctx.tail).map((run, i) =>
    run.kind === "link" ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: one immutable answer, rebuilt whole
      <Fragment key={`l${i}`}>{anchor(run.text, run.url)}</Fragment>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: one immutable answer, rebuilt whole
      <Fragment key={`t${i}`}>{cited(run.text, ctx)}</Fragment>
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

/** The citation chips and the prose between them — one link-free run of text. */
function cited(text: string, ctx: Ctx): ReactNode {
  return splitCitations(text, ctx.blocks).map((seg, i) =>
    seg.kind === "text" ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: one immutable answer, rebuilt whole
      <Fragment key={`s${i}`}>{seg.text}</Fragment>
    ) : (
      <span
        className={["cite", ctx.className].filter(Boolean).join(" ")}
        // biome-ignore lint/suspicious/noArrayIndexKey: one immutable answer, rebuilt whole
        key={`c${i}`}
      >
        {seg.ids.map((id) =>
          ctx.live ? (
            <BlockRef key={id} id={id} onJump={ctx.onJump} />
          ) : (
            <Tooltip
              key={id}
              placement="top"
              className="tip-cite"
              content={<CitedBlock id={id} text={ctx.blocks.get(id) ?? ""} />}
            >
              <span className="cite-hit">
                <BlockRef id={id} onJump={ctx.onJump} />
              </span>
            </Tooltip>
          ),
        )}
      </span>
    ),
  );
}

/**
 * What a citation chip shows on hover: **the paragraph itself**.
 *
 * Greg asked for a rich tooltip here, 2026-08-26, and the only content worth
 * putting in one is the thing the citation points at. A chip saying "go to this
 * passage" tells the reader what clicking does; a chip showing the passage lets
 * them decide whether to click at all — and, more to the point, lets them check
 * the model against the article without leaving the sentence they are reading.
 * That check is the whole justification for both features that use this
 * (docs/plans/260826a-chat-mode.md § Say the awkward thing first, and
 * docs/project/summaries.md § A summary is a door), and until it existed it
 * cost a jump and a scroll back.
 *
 * Truncated, deliberately and not generously. Enough to recognise the paragraph
 * and see whether it says what the summary claims; not enough to read instead of
 * going there. The original version learned the same thing about search results
 * and kept two lengths for it —
 * docs/project/original-version/search-and-chat.md.
 */
function CitedBlock({ id, text }: { id: BlockId; text: string }) {
  const shown = snippet(text);
  return (
    <>
      <div className="tip-cite-head">{shortBlockId(id)}</div>
      {shown === "" ? (
        // A block with no text of its own — an image, a figure. Saying so beats
        // an empty card that looks like a tooltip that failed to load.
        <p className="tip-cite-empty">This block has no text of its own.</p>
      ) : (
        <p className="tip-cite-text">{shown}</p>
      )}
      <div className="tip-cite-go">Click to go there</div>
    </>
  );
}
