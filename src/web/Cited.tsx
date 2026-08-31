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
 * (docs/project/security.md) and nothing here earns an exemption; `splitCitations`,
 * `splitEmphasis` and `splitLinks` return runs of *string*, and React escapes
 * strings.
 *
 * The one thing here that reaches an **attribute** rather than a text node is a
 * link the model wrote, and it is off unless a caller asks for it — see `links`.
 */
import { Fragment, type ReactElement } from "react";
import { BlockRef, shortBlockId } from "./BlockRef.js";
import { Tooltip } from "./Tooltip.js";
import { emphasise, snippet, splitCitations, splitEmphasis, splitLinks } from "./citations.js";
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
 * **Three passes, in this order: links, then emphasis across them, then
 * citations.** The first cannot move — `splitCitations` matches a bare run of
 * ids by shape, and a URL can carry that shape inside its path (`splitLinks`
 * says why at length). Emphasis has to see the links rather than the gaps
 * between them, or `**[The paper](https://…)**` prints its own asterisks
 * (`emphasise`).
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
  const runs = emphasise(links ? splitLinks(text, partial) : [{ kind: "text", text }]);
  return (
    <>
      {runs.map((run, i) =>
        run.kind === "link" && run.url ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: runs of one immutable string, rebuilt whole
          <Fragment key={`l${i}`}>{link(run.text, run.url, run.bold)}</Fragment>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: runs of one immutable string, rebuilt whole
          <Fragment key={`r${i}`}>
            {wrap(
              cited(run.text, { blocks, onJump, live, ...(className ? { className } : {}) }),
              run.bold,
            )}
          </Fragment>
        ),
      )}
    </>
  );
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
 * not owed it. docs/plans/260827ao-chat-web-links.md.
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
 * (docs/plans/260826a-chat-mode.md § Say the awkward thing first, and
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
 * The whole of the Markdown either panel interprets. Both prompts ask for plain
 * sentences and mostly get them, but a model bolds a term it is introducing
 * whatever you tell it, and printing the asterisks makes the app look like it
 * cannot read its own model's output.
 */
function emphasised(text: string): (string | ReactElement)[] {
  return splitEmphasis(text).map((run, i) =>
    run.bold ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: runs of one immutable string, rebuilt whole
      <strong key={`b${i}`}>{run.text}</strong>
    ) : (
      run.text
    ),
  );
}
