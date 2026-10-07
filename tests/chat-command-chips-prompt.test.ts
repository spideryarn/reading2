/**
 * **The chat prompt teaches the token the renderer reads** — plan 261003f,
 * Stage 2.
 *
 * A prompt and a parser are two descriptions of one syntax, and the day they
 * drift the reader gets raw brackets where a button was meant. So every token
 * written in the prompt is run through the real parser, and every id chat may
 * propose has to be shown at least once.
 *
 * And the section is chat's alone: Learn, Tutorial and Explore are not handed an
 * executor (Reader.tsx), and the spoken prompt must never be taught a token it
 * would read aloud (src/live.ts § `LIVE_SYSTEM`).
 */
import { describe, expect, it } from "vitest";
import { COMMAND_TOKEN_SOURCE } from "../src/command-token.js";
import { buildConverseMessages } from "../src/converse.js";
import { LIVE_SYSTEM } from "../src/live.js";
import type { Block, Meta } from "../src/types.js";
import { CHAT_PROPOSABLE } from "../src/web/chat-commands.js";
import { parseProposalToken } from "../src/web/command-proposal.js";

const meta = { slug: "a-piece", title: "A piece", url: "https://example.com/a" } as unknown as Meta;
const blocks = [{ id: "spya-k3m9qt", text: "A paragraph." }] as unknown as Block[];

const system = (kind: "chat" | "learn" | "tutorial" | "explore" | "candidates"): string => {
  const messages = buildConverseMessages({ meta, blocks, history: [], question: "q", kind });
  const found = messages.find((m) => m.role === "system");
  if (!found) throw new Error(`no system message for a ${kind} turn`);
  return typeof found.content === "string" ? found.content : JSON.stringify(found.content);
};

/** The prompt's own rules, without the article that follows them. */
const rules = (kind: "chat" | "learn" | "tutorial" | "explore" | "candidates"): string =>
  system(kind).split("A paragraph.")[0] ?? "";

const tokensIn = (text: string): string[] => text.match(new RegExp(COMMAND_TOKEN_SOURCE, "g")) ?? [];

describe("the chat prompt's section on offering an action", () => {
  it("is in the chat prompt, in the system message the cache keeps", () => {
    expect(rules("chat")).toContain("OFFERING AN ACTION");
  });

  it("shows only tokens the parser accepts and chat may propose", () => {
    const shown = tokensIn(rules("chat"));
    expect(shown.length).toBeGreaterThan(0);
    for (const raw of shown) {
      const parsed = parseProposalToken(raw);
      expect(parsed, raw).not.toBeNull();
      expect(CHAT_PROPOSABLE, raw).toContain(parsed?.id);
    }
  });

  it("shows every id chat may propose", () => {
    const ids = new Set(tokensIn(rules("chat")).map((raw) => parseProposalToken(raw)?.id));
    for (const id of CHAT_PROPOSABLE) expect(ids, id).toContain(id);
  });

  it("says who may ask for one, and that the model has done nothing", () => {
    const prompt = rules("chat");
    expect(prompt).toContain("Only the reader's own message");
    expect(prompt).toContain("You have not done it");
  });

  it.each(["learn", "tutorial", "explore", "candidates"] as const)("is not in the %s prompt", (kind) => {
    expect(rules(kind)).not.toContain("[cmd:");
    expect(rules(kind)).not.toContain("OFFERING AN ACTION");
  });

  it("is not in the spoken prompt, which would read a token aloud", () => {
    expect(LIVE_SYSTEM).not.toContain("[cmd:");
    expect(LIVE_SYSTEM).not.toContain("OFFERING AN ACTION");
  });
});
