/**
 * **Plain text, with its monospaced blocks drawn as such**: a question's body
 * in the Feedback dialog, and from Stage 3 a mockup's. Text is a paragraph per
 * run, its own line breaks kept; lines between two lines that are exactly
 * three backticks are a `<pre>` in the one monospace, scrolling sideways
 * rather than wrapping, so an ASCII mockup lines up. An unclosed fence draws
 * the whole text as plain text. Text only: nothing here is markup.
 * src/plain-text-blocks.ts; plan 261028b, Stage 2.
 *
 * **One exception, `linkMockups`**: a mockup's id (`m-k3m9qt`) in the text is
 * a link to its page on `/admin/mockups`, so a question can point at the
 * pictures it is asking about. The id has a fixed shape (`isMockupId`) and the
 * link is built from it, so the text cannot make a link anywhere else. It opens
 * in a new tab, which keeps the dialog and a half-written reply where they are.
 * Plan 261028b, Stage 3.
 */
import type { ReactNode } from "react";
import { isMockupId } from "../mockups.js";
import { parsePlainTextBlocks } from "../plain-text-blocks.js";
import { adminMockupHref } from "./router.js";

/** Candidates only; each is checked with `isMockupId` before it becomes a link. */
const MOCKUP_ID_IN_TEXT = /\bm-[0-9a-z]{6}\b/g;

function withMockupLinks(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let from = 0;
  for (const match of text.matchAll(MOCKUP_ID_IN_TEXT)) {
    const id = match[0];
    if (!isMockupId(id)) continue;
    parts.push(text.slice(from, match.index));
    parts.push(
      <a key={`${id}@${match.index}`} href={adminMockupHref(id)} target="_blank" rel="noopener noreferrer">
        {id}
      </a>,
    );
    from = match.index + id.length;
  }
  parts.push(text.slice(from));
  return parts;
}

export function PlainTextBlocks({
  text,
  className,
  linkMockups = false,
}: {
  text: string;
  className?: string;
  linkMockups?: boolean;
}) {
  const { blocks } = parsePlainTextBlocks(text);
  return (
    <>
      {blocks.map((block, index) =>
        block.kind === "mono" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the blocks are rebuilt whole from the text and never reorder
          <pre key={index} className="fb-mono">
            {block.text}
          </pre>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: as above
          <p key={index} className={className}>
            {linkMockups ? withMockupLinks(block.text) : block.text}
          </p>
        ),
      )}
    </>
  );
}
