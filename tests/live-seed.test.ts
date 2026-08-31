/**
 * **Seeding a live session must not teach the voice model to say block ids.**
 *
 * A live conversation is seeded with the thread so far, so a reader can type,
 * switch to voice, and be understood. Typed chat cites by writing
 * `[spya-k3m9qt]` into the answer; the live prompt forbids saying an id aloud
 * and gives the model `show_passage` instead.
 *
 * Seed that history verbatim and the voice model is shown **examples of its own
 * past speech containing the thing it is told never to say** — few-shot pressure
 * against our own instruction, whose symptom is a companion spelling out
 * "S P Y A dash K 3 M 9" with no apparent cause and nothing in any log.
 *
 * Found by Fable, 2026-08-31. docs/plans/260831l-live-conversation-in-chat.md § 1d.
 */
import { describe, expect, it } from "vitest";

import { liveSeedItems, withoutBlockIds } from "../src/live.js";
import type { ChatMessage } from "../src/types.js";

const msg = (over: Partial<ChatMessage> & { id: string }): ChatMessage => ({
  role: "user",
  text: "",
  createdAt: "2026-08-31T00:00:00.000Z",
  status: "done",
  ...over,
});

describe("withoutBlockIds", () => {
  it("takes the brackets too", () => {
    /* Left behind, "[]" is read aloud as "open square bracket, close square
       bracket", which is worse than the id was. */
    expect(withoutBlockIds("He rejects it [spya-k3m9qt].")).toBe("He rejects it.");
  });

  it("handles several ids in one bracket", () => {
    expect(withoutBlockIds("Spread across two [spya-k3m9qt spya-p7w2dn].")).toBe(
      "Spread across two.",
    );
    expect(withoutBlockIds("Or comma'd [spya-k3m9qt, spya-p7w2dn].")).toBe("Or comma'd.");
  });

  it("takes a bare id and tidies the hole", () => {
    expect(withoutBlockIds("See spya-k3m9qt above.")).toBe("See above.");
  });

  it("leaves an id inside a URL alone", () => {
    /* A model that searched the web can return somebody's link that happens to
       contain an id shape. Mangling a stranger's URL is worse than leaving an
       id in a place nobody reads out. Same reasoning as `citedBlockIds`. */
    const text = "As at https://example.com/notes/spya-k3m9qt which explains it.";
    expect(withoutBlockIds(text)).toContain("https://example.com/notes/spya-k3m9qt");
  });

  it("leaves prose without ids exactly as it was", () => {
    const plain = "He never really answers the question, which is the interesting part.";
    expect(withoutBlockIds(plain)).toBe(plain);
  });
});

describe("liveSeedItems", () => {
  const history: ChatMessage[] = [
    msg({ id: "spya-000001", text: "What does he claim?" }),
    msg({
      id: "spya-000002",
      role: "assistant",
      text: "That consciousness is not substrate independent [spya-k3m9qt].",
    }),
  ];

  it("strips ids from the assistant's words", () => {
    const seed = liveSeedItems(history);
    expect(seed[1]?.text).toBe("That consciousness is not substrate independent.");
    expect(seed.some((s) => s.text.includes("spya-"))).toBe(false);
  });

  it("leaves the READER's words untouched", () => {
    /* Their words are theirs. If a reader said something id-shaped, editing it
       would be putting words in their mouth — and nothing downstream reads the
       user side aloud anyway. */
    const said = [
      msg({ id: "spya-000003", text: "what is spya-k3m9qt about" }),
      msg({ id: "spya-000004", role: "assistant", text: "The rainstorm." }),
    ];
    expect(liveSeedItems(said)[0]?.text).toBe("what is spya-k3m9qt about");
  });

  it("uses recentHistory's window rather than a second one", () => {
    /* A whole turn or neither half — the rule `recentHistory` already enforces,
       and the reason seeding is built here rather than in the browser. */
    const half = [
      ...history,
      msg({ id: "spya-000005", text: "asked but never answered" }),
      msg({ id: "spya-000006", role: "assistant", text: "", status: "pending" }),
    ];
    expect(liveSeedItems(half).map((s) => s.text)).toEqual([
      "What does he claim?",
      "That consciousness is not substrate independent.",
    ]);
  });

  it("does not seed an interrupted answer", () => {
    /* It contains words the reader never heard. Seeding it would have the voice
       model continue from a paragraph that, as far as the reader is concerned,
       was cut off three words in. */
    const withInterrupted = [
      ...history,
      msg({ id: "spya-000007", text: "and then?" }),
      msg({ id: "spya-000008", role: "assistant", text: "a long unheard tail", interrupted: true }),
    ];
    expect(liveSeedItems(withInterrupted).map((s) => s.text)).toEqual([
      "What does he claim?",
      "That consciousness is not substrate independent.",
    ]);
  });
});
