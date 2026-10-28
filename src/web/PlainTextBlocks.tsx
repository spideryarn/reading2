/**
 * **Plain text, with its monospaced blocks drawn as such**: a question's body
 * in the Feedback dialog, and from Stage 3 a mockup's. Text is a paragraph per
 * run, its own line breaks kept; lines between two lines that are exactly
 * three backticks are a `<pre>` in the one monospace, scrolling sideways
 * rather than wrapping, so an ASCII mockup lines up. An unclosed fence draws
 * the whole text as plain text. Text only: nothing here is markup.
 * src/plain-text-blocks.ts; plan 261028b, Stage 2.
 */
import { parsePlainTextBlocks } from "../plain-text-blocks.js";

export function PlainTextBlocks({ text, className }: { text: string; className?: string }) {
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
            {block.text}
          </p>
        ),
      )}
    </>
  );
}
