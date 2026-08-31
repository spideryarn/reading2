/**
 * The first message of a conversation started from a passage.
 *
 * This file used to test a module-level cell that carried a question from the
 * explanation dialog into chat mode — its article scoping, its two-minute
 * expiry, and its clear-as-you-read. All three guarded real bugs, and all three
 * are now unreachable: since 2026-08-26 the conversation floats over the
 * article, so the dialog hands its follow-up across as a prop and there is
 * nothing in flight to scope, expire or double-read. See
 * docs/plans/260826ab-chat-as-gateway.md and the header of src/web/chat-handoff.ts.
 *
 * What is left is the text itself, which the reader sees and edits before they
 * send it — so it is worth getting right for their sake rather than the model's.
 * The model is told the passage structurally, on every turn; see
 * `anchorSection` in src/converse.ts and tests/article-prompt.test.ts.
 */
import { describe, expect, it } from "vitest";

import { askAboutBlock } from "../src/web/chat-handoff.js";

describe("the message a selection pre-fills", () => {
  it("names the block and quotes what was selected", () => {
    const asked = askAboutBlock({
      blockId: "spya-k3m9qt",
      quote: "qualia realism",
      question: "what does he mean?",
    });
    /* The short id, not the full one: every id on screen carries the `spya-`
       prefix, so it says nothing and costs five of the six characters that do.
       Same rule as `shortBlockId` in BlockRef.tsx. */
    expect(asked).toContain("k3m9qt");
    expect(asked).not.toContain("spya-");
    expect(asked).toContain("qualia realism");
    expect(asked).toContain("what does he mean?");
  });

  it("trims a long paragraph rather than pasting the whole thing in", () => {
    /* The paragraph button's case. The composer is somewhere you type, not
       somewhere you scroll. */
    const long = "word ".repeat(80);
    const asked = askAboutBlock({ blockId: "spya-k3m9qt", quote: long, question: "why?" });
    expect(asked).toContain("…");
    expect(asked.length).toBeLessThan(200);
  });

  it("says 'explain this passage' for an empty box", () => {
    /* Greg's call: leaving the box empty and pressing Enter keeps the old
       one-press behaviour a keystroke away rather than gone. Phrased as the
       reader would phrase it, because it is shown back to them as their own
       message. */
    const asked = askAboutBlock({ blockId: "spya-k3m9qt", quote: "a passage" });
    expect(asked).toContain("Explain this passage.");
  });

  it("quotes nothing when the reader picked out nothing", () => {
    const asked = askAboutBlock({ blockId: "spya-k3m9qt", question: "why?" });
    expect(asked).toContain("About block k3m9qt:");
    expect(asked).not.toContain('"');
  });
});
