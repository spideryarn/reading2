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
 * (docs/project/security.md) and nothing here earns an exemption; `splitCitations`
 * and `splitEmphasis` return runs of *string*, and React escapes strings.
 */
import { Fragment, type ReactElement } from "react";
import { BlockRef, shortBlockId } from "./BlockRef.js";
import { Tooltip } from "./Tooltip.js";
import { snippet, splitCitations, splitEmphasis } from "./citations.js";
import type { BlockId } from "../types.js";

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
  /** Class for the chip wrapper, so each band can size its own. */
  className?: string;
}

export function CitedText({ text, blocks, onJump, live = false, className }: Props): ReactElement {
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
