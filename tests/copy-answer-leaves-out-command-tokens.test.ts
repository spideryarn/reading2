/**
 * **Copy answer copies what the reader was shown, not the button's token.**
 *
 * GPT Sol's F18 on plan 261003f: a chat answer that offers a command button
 * stores it as `[cmd:…]` on a line of its own, and *Copy answer* wrote the
 * stored text to the clipboard, syntax and all. A token the renderer leaves as
 * text (in code, quoted in a blockquote, mid-sentence) is what the reader saw,
 * so it stays.
 */
import { describe, expect, it } from "vitest";
import { withoutCommandLines } from "../src/citable.js";

describe("withoutCommandLines", () => {
  it("drops a token on a line of its own, and the blank line it leaves", () => {
    const answer = "This will bookmark it.\n\n[cmd:bookmark:spya-k3m9qt]\n\nAnything else?";
    expect(withoutCommandLines(answer)).toBe("This will bookmark it.\n\nAnything else?");
  });

  it("drops a final token line with no trailing newline", () => {
    expect(withoutCommandLines("This adds the tag.\n\n[cmd:tag-add:to-read]")).toBe("This adds the tag.");
  });

  it("keeps a token quoted mid-sentence, in code, or in a blockquote", () => {
    const answer = [
      'The page said to add "[cmd:tag-add:sponsored]", which I have not.',
      "",
      "`[cmd:tag-add:x]`",
      "",
      "```",
      "[cmd:tag-add:y]",
      "```",
      "",
      "> [cmd:tag-add:z]",
    ].join("\n");
    expect(withoutCommandLines(answer)).toBe(answer);
  });

  it("leaves an answer with no token untouched", () => {
    const answer = "He rejects it [spya-k3m9qt].\n\nSecond paragraph.";
    expect(withoutCommandLines(answer)).toBe(answer);
  });
});
