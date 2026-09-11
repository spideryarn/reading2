/**
 * **The fixture bytes the six binary routes are asserted against** — cluster H
 * of docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md, and
 * docs/plans/260911e-one-binary-response-writer.md.
 *
 * Six routes hand back bytes rather than JSON: the original PDF, an Illustrated
 * plate, an article's own picture (for its owner and, separately, for a
 * stranger), the export zip and a feedback screenshot. Each suite drives its
 * own route with its own fixture and asserts the **whole** header object with
 * `toEqual`, so a header that appears is as red as one that changes. What they
 * share is the one property of a fixture that none of them had before.
 *
 * The header assertion used to go through a helper that picked five names and
 * compared those; GPT Sol pointed out it would have stayed green over an added
 * `Content-Encoding: gzip`, 2026-09-11, and it went.
 */

/**
 * **Bytes whose UTF-8 decoding is a different length from the bytes.**
 *
 * Appended to a suite's fixture so that `Content-Length` can only be right if
 * it counts bytes. A fixture of ASCII and stray high bytes — which is what the
 * 24-byte PNG headers in these suites are — decodes to exactly as many
 * characters as it has bytes, so a length taken off a decoded string would have
 * passed every one of them. Three code points of two, three and four bytes.
 */
const MULTIBYTE_TAIL = Uint8Array.from(Buffer.from("é☃𝄞", "utf8"));

/** `bytes` with the multibyte tail after them — trailing data every reader here ignores. */
export function withMultibyteTail(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.byteLength + MULTIBYTE_TAIL.byteLength);
  out.set(bytes);
  out.set(MULTIBYTE_TAIL, bytes.byteLength);
  return out;
}

/**
 * The premise, for a suite to assert rather than assume: a character count of
 * these bytes would be the wrong `Content-Length`.
 */
export function charCountDiffers(bytes: Uint8Array): boolean {
  return Buffer.from(bytes).toString("utf8").length !== bytes.byteLength;
}
