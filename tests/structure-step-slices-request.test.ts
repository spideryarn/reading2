/**
 * **The slices path adds nothing to an ordinary article's request.**
 *
 * A document too long for one structure answer is asked about in slices, each
 * with a short note ahead of its blocks (src/structure-slices.ts § `SLICE_NOTE`).
 * The note belongs to that path alone. The digest below was taken from the
 * tree before the slices path existed, so it moves if the ordinary request
 * does, whatever the reason.
 */
import { describe, expect, it } from "vitest";

import { checkpointKey } from "../src/source-hash.js";
import { canonicalWholeDocumentRequest, wholeDocumentRequest } from "../src/structure.js";
import { SLICE_NOTE, withSliceNote } from "../src/structure-slices.js";
import type { Block } from "../src/types.js";

const BLOCKS: Block[] = Array.from({ length: 12 }, (_, i) => {
  const text = `Paragraph ${i} of an ordinary article, with enough words to be a paragraph.`;
  return {
    id: `spya-aaaa${"23456789abcd"[i]}2`,
    tag: "p",
    kind: "text" as const,
    text,
    words: text.split(" ").length,
    html: `<p>${text}</p>`,
    gistable: true,
  };
});

/** `canonicalWholeDocumentRequest` minus the model address, which the environment may override. */
const digest = (params: ReturnType<typeof wholeDocumentRequest>["params"]): string => {
  const canonical = canonicalWholeDocumentRequest(params, "standard") as { request: Record<string, unknown> };
  const { model: _model, ...request } = canonical.request;
  return checkpointKey({ ...canonical, request });
};

describe("the structure request of an article that fits one answer", () => {
  it("is byte-identical to what it was before the slices path", () => {
    expect(digest(wholeDocumentRequest(BLOCKS).params)).toBe("908b510ae3360ace");
  });

  it("and the note changes the request it is added to", () => {
    const { params: plain, user: blocks } = wholeDocumentRequest(BLOCKS);
    const noted = withSliceNote(plain, blocks);
    expect(digest(noted)).not.toBe(digest(plain));
    const user = noted.messages[0]!.content;
    expect(user).toBe(SLICE_NOTE + blocks);
    expect(noted.messages).toHaveLength(1);
    expect(noted.system).toBe(plain.system);
  });
});
