/**
 * Model prose with `[spya-k3m9qt]` in it, drawn as something you can press.
 *
 * **One definition, two panels.** This was chat's, privately, until the
 * summaries needed the same thing (Greg, 2026-08-26: *"Add block-ids to the
 * summary output — make them clickable, to scroll the text there, and also with
 * rich-tooltips"*). Two copies of "how a citation looks and what hovering one
 * shows" would drift, and the day they drift is the day a reader learns that a
 * chip means something slightly different depending on which band it is in.
 * Same reasoning as src/quote-match.ts and src/web/search-hits.ts: where two
 * features answer one question, they answer it in one file.
 *
 * The rules the chips obey live next door in citations.ts, which is DOM-free
 * and tested. This file is only the drawing.
 *
 * **Text is rendered as text, never `dangerouslySetInnerHTML`.** This is model
 * output. The article's own HTML is sanitised twice before it is trusted
 * (docs/project/security.md) and nothing here earns an exemption; every splitter
 * in citations.ts, and every block in markdown.ts, returns *string*, and React
 * escapes strings.
 *
 * The one thing here that reaches an **attribute** rather than a text node is a
 * link the model wrote, and it is off unless a caller asks for it — see `links`.
 */
import { createElement, Fragment, type ReactElement } from "react";
import { BlockRef, shortBlockId } from "./BlockRef.js";
import { type MdBlock, parseBlocks } from "./markdown.js";
import { Tooltip } from "./Tooltip.js";
import {
  emphasise,
  type EmphasisedRun,
  snippet,
  splitCitations,
  splitEmphasis,
  splitInline,
  splitItalic,
} from "./citations.js";
import type { BlockId } from "../types.js";
import { hostOf } from "../urls.js";

interface Props {
  /** One run of model prose. Paragraph splitting is the caller's business. */
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
   * This run of text may be **half-written** — it is the last paragraph of an
   * answer that is still arriving.
   *
   * A separate flag from `live`, and deliberately: `live` is about how much
   * machinery to mount while the text keeps changing, and this is about
   * trusting the last few characters. Only the tail of a streaming answer is
   * unfinished, so only the caller knows which paragraph gets it. See
   * `splitLinks`.
   */
  partial?: boolean;
  /**
   * Draw `[label](https://…)` and bare addresses as links. **Off by default.**
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
   * either. That argument is about *appearance*; this is about what an
   * attacker can reach. Raised by a GPT Sol review, 2026-08-27.
   */
  links?: boolean;
  /** Class for the chip wrapper, so each band can size its own. */
  className?: string;
}

/**
 * Model prose, drawn.
 *
 * **Four passes, in this order: code spans, then links inside what is left,
 * then emphasis across both, then citations.** None of them can move. Code is
 * first because what is inside backticks is shown as written, so it must reach
 * none of the others. Links come before citations because `splitCitations`
 * matches a bare run of ids by shape and a URL can carry that shape inside its
 * path (`splitLinks` says why at length). Emphasis has to see the links and the
 * code rather than the gaps between them, or `**[The paper](https://…)**` and
 * ``**bold with `code` in it**`` print their own asterisks (`emphasise`).
 *
 * The first three are `splitInline`, which returns ONE run list precisely so
 * emphasis can pair markers across the whole paragraph.
 *
 * A link's label gets emphasis and nothing else. An id inside a label is not a
 * citation: it is the words the model chose for a destination, and turning part
 * of them into a chip would put a second, differently-behaved thing inside
 * something the reader is about to press.
 */
export function CitedText({
  text,
  blocks,
  onJump,
  live = false,
  partial = false,
  links = false,
  className,
}: Props): ReactElement {
  const runs = emphasise(splitInline(text, links, partial));
  const ctx = { blocks, onJump, live, ...(className ? { className } : {}) };
  return (
    <>
      {runs.map((run, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: runs of one immutable string, rebuilt whole
        <Fragment key={`r${i}`}>{draw(run, ctx)}</Fragment>
      ))}
    </>
  );
}

/** One run of a paragraph: a code span, a link, or prose with chips in it. */
function draw(
  run: EmphasisedRun,
  ctx: Omit<Props, "text" | "partial" | "links">,
): ReactElement {
  if (run.kind === "code") return wrap(<code className="fmt-code">{run.text}</code>, run.bold);
  if (run.kind === "link" && run.url) return link(run.text, run.url, run.bold);
  return wrap(cited(run.text, ctx), run.bold);
}

/** `<strong>` around a run the model asked to emphasise, and nothing otherwise. */
function wrap(content: ReactElement, bold: boolean): ReactElement {
  return bold ? <strong>{content}</strong> : content;
}

/**
 * One link the model wrote, and the host it actually goes to.
 *
 * **The host is printed, quietly, beside the label.** That is not decoration:
 * the label is the model's to choose, the model has just been reading pages we
 * do not control, and `[the Anthropic paper](https://not-anthropic.example/)`
 * is a plausible sentence with a hostile destination. The hover card shows the
 * real address, but a card takes 320ms of rest to open and a click does not
 * wait for it — so the one fact that cannot be faked is on the page rather than
 * behind a gesture. Raised by a GPT Sol review, 2026-08-27, which is also where
 * the credentials refusal in `webLinks` came from.
 *
 * Not printed when the label already *is* the address, which would say it twice.
 *
 * Three guards besides, all of them reuses: the scheme was checked by
 * `isWebUrl` inside `webLinks`; the label and the URL are *strings* that React
 * escapes, never HTML; and `noreferrer` as well as `noopener`, because the
 * article's own URL is a reading history and a model-supplied destination is
 * not owed it. docs/plans/chat-web-links.md.
 */
function link(label: string, url: string, bold: boolean): ReactElement {
  const host = hostOf(url);
  const anchor = (
    <a className="cited-link" href={url} target="_blank" rel="noopener noreferrer">
      {emphasised(label)}
    </a>
  );
  return (
    <>
      {wrap(anchor, bold)}
      {host !== "" && label !== url && <span className="cited-link-host">{host}</span>}
    </>
  );
}

/** The citation chips and the prose between them — one link-free run of text. */
function cited(
  text: string,
  { blocks, onJump, live, className }: Omit<Props, "text" | "partial" | "links">,
): ReactElement {
  return (
    <>
      {splitCitations(text, blocks).map((seg, i) =>
        seg.kind === "text" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments of one immutable string, rebuilt whole
          <Fragment key={`t${i}`}>{emphasised(seg.text)}</Fragment>
        ) : (
          <span
            className={["cite", className].filter(Boolean).join(" ")}
            // biome-ignore lint/suspicious/noArrayIndexKey: segments of one immutable string, rebuilt whole
            key={`c${i}`}
          >
            {seg.ids.map((id) =>
              live ? (
                <BlockRef key={id} id={id} onJump={onJump} />
              ) : (
                <Tooltip
                  key={id}
                  placement="top"
                  className="tip-cite"
                  content={<CitedBlock id={id} text={blocks.get(id) ?? ""} />}
                >
                  <span className="cite-hit">
                    <BlockRef id={id} onJump={onJump} />
                  </span>
                </Tooltip>
              ),
            )}
          </span>
        ),
      )}
    </>
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
 * (docs/plans/chat-mode.md § Say the awkward thing first, and
 * docs/project/summaries.md § A summary is a door), and until it existed it
 * cost a jump and a scroll back.
 *
 * Truncated, deliberately and not generously. Enough to recognise the paragraph
 * and see whether it says what the summary claims; not enough to read instead
 * of going there. The original version learned the same thing about search
 * results and kept two lengths for it —
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

/**
 * `**like this**` → a bold run, and everything else left alone.
 *
 * Both prompts ask for plain sentences and mostly get them, but a model bolds a
 * term it is introducing whatever you tell it, and printing the asterisks makes
 * the app look like it cannot read its own model's output.
 *
 * **This and the other inline marks belong to both panels; the blocks belong to
 * chat.** `CitedText` is shared, so a summary reads bold, italic, code spans and
 * block ids too. That line is not arbitrary: an inline mark is a thing a model
 * does whatever you tell it, and a summary printing its own asterisks looks
 * broken; a heading or a bullet list is *structure*, which a summary was never
 * asked for and would be worse for. `CitedMarkdown` is the blocks, and only
 * chat passes it.
 */
function emphasised(text: string): (string | ReactElement)[] {
  return splitEmphasis(text).map((run, i) =>
    run.bold ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: runs of one immutable string, rebuilt whole
      <strong key={`b${i}`}>{italicised(run.text)}</strong>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: runs of one immutable string, rebuilt whole
      <Fragment key={`i${i}`}>{italicised(run.text)}</Fragment>
    ),
  );
}

/**
 * `*like this*` → an emphasised run, inside whatever the bold pass left.
 *
 * The innermost pass, and it has to be: by the time a string reaches here every
 * `**` that had a partner has been consumed, so a surviving `*` is either a
 * single marker or it is arithmetic. `splitItalic` says which.
 */
function italicised(text: string): (string | ReactElement)[] {
  return splitItalic(text).map((run, i) =>
    run.italic ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: runs of one immutable string, rebuilt whole
      <em key={`e${i}`}>{run.text}</em>
    ) : (
      run.text
    ),
  );
}

/**
 * A whole answer, with its **blocks** drawn as well as its marks.
 *
 * `CitedText` is one run of prose; this is a model's reply, which since
 * 2026-08-31 may contain a bullet list, a numbered list, a heading, a quote, a
 * rule or a block of code. Greg asked for it after finding that a list the
 * prompt explicitly permits arrived on screen as `- one - two - three`, held on
 * separate lines only by a `white-space: pre-wrap` in the stylesheet that was
 * there to make the bug survivable.
 *
 * **Still no HTML anywhere in this.** markdown.ts finds the blocks and returns
 * *data*; each block's text comes back here as a string and is handed to
 * `CitedText`, which returns runs of string that React escapes. There is no
 * stage at which model output becomes markup, which is what keeps this on the
 * right side of docs/project/security.md — see markdown.ts § Why we parse this
 * ourselves.
 *
 * Opt-in, like `links`, and for a smaller reason: only chat's prompt asks for
 * these shapes. The summary panel's asks for plain sentences and gets them, and
 * a summary is dense enough that a stray `#` becoming a heading would be worse
 * than a stray `#`.
 */
export function CitedMarkdown({
  text,
  blocks,
  onJump,
  live = false,
  partial = false,
  links = false,
  className,
}: Props): ReactElement {
  const ctx = { blocks, onJump, live, links, ...(className ? { className } : {}) };
  return <>{drawBlocks(parseBlocks(text), ctx, partial)}</>;
}

/** What every block below needs to draw its inline runs. */
type Ctx = Omit<Props, "text" | "partial">;

/**
 * A list of blocks.
 *
 * `partial` reaches **only the last text in the answer**, wherever that is — the
 * end of a paragraph, of a heading, of the last item of a list, or of the last
 * line of a quote. Everything above it has finished arriving.
 *
 * The first version passed `false` for headings and quotes on the reasoning
 * that a block inside one is closed by the structure around it. That is true of
 * a *finished* answer and false of the one case the flag exists for: while an
 * answer streams, the tail can be inside a quote, and `> See https://good.exa`
 * was drawn as a link two tokens before it became `…example.evil.example/x`.
 * A link the reader can press in the second before its destination changes is
 * exactly what `splitLinks` refuses for a paragraph. Found by a GPT Sol review,
 * 2026-08-31.
 */
function drawBlocks(list: MdBlock[], ctx: Ctx, partial: boolean): ReactElement[] {
  return list.map((block, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: blocks of one immutable string, rebuilt whole
    <Fragment key={`b${i}`}>{drawBlock(block, ctx, partial && i === list.length - 1)}</Fragment>
  ));
}

function drawBlock(block: MdBlock, ctx: Ctx, partial: boolean): ReactElement {
  switch (block.kind) {
    case "para":
      return <p>{inline(block.text, ctx, partial)}</p>;
    case "heading":
      /* `h4` and down, never `h1`. The panel's own title is the `h2` above
         these, so an answer that starts with `#` must not outrank it — a
         document outline that says the reply is the page is worse than a
         heading a step smaller than the model imagined. */
      return createElement(
        `h${Math.min(6, block.level + 3)}`,
        { className: "fmt-h" },
        inline(block.text, ctx, partial),
      );
    case "rule":
      return <hr className="fmt-rule" />;
    case "code":
      /* No highlighting and no language badge. The face and the box are what
         make code readable at this size; the rest is a library. */
      return (
        <pre className="fmt-pre">
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return <blockquote className="fmt-quote">{drawBlocks(block.blocks, ctx, partial)}</blockquote>;
    case "list":
      return drawList(block, ctx, partial);
  }
}

/**
 * One list.
 *
 * `start` is carried through, so a model that numbers from 3 — which happens
 * when it continues a list across two answers — gets a 3 rather than a 1
 * silently correcting it.
 *
 * An item whose content is a single paragraph is drawn **without** the `<p>`,
 * which is the difference between a tight list and one with a blank line
 * between every bullet. CommonMark decides tightness for the whole list; this
 * decides it per item, which is simpler and looks the same on everything a
 * model writes.
 */
function drawList(block: MdBlock & { kind: "list" }, ctx: Ctx, partial: boolean): ReactElement {
  const items = block.items.map((item, i) => {
    const last = partial && i === block.items.length - 1;
    const only = item.length === 1 ? item[0] : undefined;
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: items of one immutable string, rebuilt whole
      <li key={`i${i}`}>
        {only?.kind === "para" ? inline(only.text, ctx, last) : drawBlocks(item, ctx, last)}
      </li>
    );
  });
  return block.ordered ? (
    <ol className="fmt-list" start={block.start}>
      {items}
    </ol>
  ) : (
    <ul className="fmt-list">{items}</ul>
  );
}

/** A block's text, with the marks and the citation chips in it. */
function inline(text: string, ctx: Ctx, partial: boolean): ReactElement {
  return <CitedText text={text} partial={partial} {...ctx} />;
}
