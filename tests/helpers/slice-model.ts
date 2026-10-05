/**
 * A structure model for the slices tests: it reads the request it is handed
 * and writes a well-formed answer over exactly the blocks in it, so no test
 * needs a network. tests/structure-step-slices.test.ts and
 * tests/stated-limits.test.ts both stand it behind `streamMessage`.
 */
import type { MessagesBody } from "../../src/messages-stream.js";

export const USAGE = { input_tokens: 7, output_tokens: 11 };

/** The block ids a structure request shows, in order (src/structure-prompt.ts § `renderBlocks`). */
export function askedIds(params: MessagesBody): string[] {
  const user = params.messages[0]!.content;
  if (typeof user !== "string") throw new Error("the fake model was sent a user message that is not text");
  return [...user.matchAll(/^\[\d+\] (\S+) </gm)].map((m) => m[1]!);
}

/** Is this the root call? It shows no blocks; a slice or a whole document shows some. */
export const isRootCall = (params: MessagesBody): boolean => askedIds(params).length === 0;

/**
 * An answer whose top-level sections hold `sizes` blocks each, in order, the
 * remainder going to the last. A section of at least 20 blocks is cut into
 * tens; pass `flat` to leave every one undivided.
 */
export function sectionsAnswer(ids: string[], size = 100, flat = false): string {
  const children = [];
  for (let at = 0, i = 0; at < ids.length; at += size, i++) {
    const end = at + size * 2 > ids.length ? ids.length : at + size;
    const inner = [];
    if (!flat && end - at >= 20) {
      for (let k = at; k < end; k += 10) {
        inner.push({ title: `Step ${k}`, gist: `Step ${k} makes one small move forward.`, start: ids[k]! });
      }
    }
    children.push({
      title: `Chapter ${i}`,
      gist: `Chapter ${i} argues one thing of its own.`,
      question: `Chapter ${i} — why does it hold?`,
      start: ids[at]!,
      ...(inner.length > 0 ? { children: inner } : {}),
    });
    if (end === ids.length) break;
  }
  return JSON.stringify({
    root: { title: "A stretch", gist: "The stretch says several things.", question: "The stretch — why?", children },
  });
}

/** A root and nothing under it: sound on its own, and nothing to promote. */
export const ROOT_ONLY = JSON.stringify({
  root: { title: "A stretch", gist: "The stretch says several things.", question: "The stretch — why?" },
});

export const ROOT_ANSWER = JSON.stringify({
  gist: "The pieces share one worry about who owns a mind.",
  question: "Ownership — why does it keep failing? (short stories)",
});

/** What `streamMessage` hands back, as far as the structure step reads it. */
export const messageOf = (text: string, stop_reason = "end_turn") => ({
  content: [{ type: "text", text }],
  stop_reason,
  usage: USAGE,
});
