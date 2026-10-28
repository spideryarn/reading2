/**
 * **Plain text with monospaced blocks in it**: the one line-by-line reading of
 * a question's body (and, from Stage 3, a mockup's), shared by the file
 * compiler, the server's read of published rows and the dialog, so all three
 * agree on what is inside a fence. Greg, 2026-10-28, on a mockup in a
 * question: *"at the very least ASCII text, but then it would need to be
 * monospaced"*. Plan 261028b, Stage 2, and GPT Sol's plan review F3: the
 * `Details` split reads the same line state, so a `Details` inside a fence is
 * drawn, not split on.
 *
 * The rule: a line that is exactly three backticks, nothing else on it, opens
 * or closes a monospaced block and is not itself shown. Everything else is
 * plain text. No markdown, no info string after the backticks, no nesting.
 *
 * An import-free leaf, so scripts and the browser may both load it.
 */

/** The line that opens and closes a monospaced block. */
export const PLAIN_TEXT_FENCE = "```";

export type PlainTextBlock = { kind: "text" | "mono"; text: string };

/** CRLF and lone CR become LF, so a file saved on Windows reads the same. */
export function normaliseNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * **Each line, and whether it is inside a fence.** A fence line itself counts
 * as inside. When the last fence is never closed, `unclosed` is true and every
 * line is reported outside: an unclosed fence is not a fence, and the text is
 * read as plain text, whole.
 */
export function fencedLines(text: string): { lines: string[]; inside: boolean[]; unclosed: boolean } {
  const lines = normaliseNewlines(text).split("\n");
  const inside: boolean[] = [];
  let open = false;
  for (const line of lines) {
    if (line === PLAIN_TEXT_FENCE) {
      inside.push(true);
      open = !open;
    } else {
      inside.push(open);
    }
  }
  if (open) return { lines, inside: lines.map(() => false), unclosed: true };
  return { lines, inside, unclosed: false };
}

/** A text block's blank lines at either end go: the gap is the block's margin. */
function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? "").trim() === "") start++;
  while (end > start && (lines[end - 1] ?? "").trim() === "") end--;
  return lines.slice(start, end);
}

/**
 * **The text as blocks to draw.** Text outside fences is `text`, its blank
 * lines at either end dropped; text inside is `mono`, every line kept with its
 * leading spaces. An empty fence draws nothing. With an unclosed fence the
 * whole text is one `text` block and `unclosed` is true: the caller draws it as
 * plain text (the compiler refuses such a file; a row already published with
 * one is still drawn, never a failure).
 */
export function parsePlainTextBlocks(text: string): { blocks: PlainTextBlock[]; unclosed: boolean } {
  const normalised = normaliseNewlines(text);
  const { lines, unclosed } = fencedLines(normalised);
  if (unclosed) return { blocks: [{ kind: "text", text: normalised }], unclosed: true };
  const blocks: PlainTextBlock[] = [];
  let open = false;
  let run: string[] = [];
  const flush = () => {
    if (open) {
      if (run.length > 0) blocks.push({ kind: "mono", text: run.join("\n") });
    } else {
      const kept = trimBlankLines(run);
      if (kept.length > 0) blocks.push({ kind: "text", text: kept.join("\n") });
    }
    run = [];
  };
  for (const line of lines) {
    if (line === PLAIN_TEXT_FENCE) {
      flush();
      open = !open;
    } else {
      run.push(line);
    }
  }
  flush();
  return { blocks, unclosed: false };
}
