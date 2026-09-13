/**
 * Both prompts say where a link may come from.
 *
 * `splitCitations` can check a block id against the article and refuse an
 * invented one. Nothing on our side can check a URL — so the provenance rule is
 * a sentence in the prompt, and a sentence in a prompt is exactly the kind of
 * thing that gets written once and forgotten in the other one.
 *
 * That is not hypothetical here: a **Remember** thread can search the web, its
 * answers go through the same renderer, and the first version of this feature
 * put the rule in `SYSTEM` only. A GPT Sol review found it on 2026-08-27, which
 * is why the block is a shared constant and why this file exists rather than a
 * comment saying "remember to update both".
 *
 * docs/plans/260827ao-chat-web-links.md.
 */
import { describe, expect, it } from "vitest";
import { buildConverseMessages } from "../src/converse.js";
import type { Block, Meta } from "../src/types.js";

const meta = { slug: "a-piece", title: "A piece", url: "https://example.com/a" } as unknown as Meta;
const blocks = [{ id: "spya-k3m9qt", text: "A paragraph." }] as unknown as Block[];

/** The system message a turn of this kind is sent. */
const system = (kind: "chat" | "remember"): string => {
  const messages = buildConverseMessages({ meta, blocks, history: [], question: "q", kind });
  const found = messages.find((m) => m.role === "system");
  if (!found) throw new Error(`no system message for a ${kind} turn`);
  return typeof found.content === "string" ? found.content : JSON.stringify(found.content);
};

describe("the rule about linking to the web", () => {
  it.each(["chat", "remember"] as const)("is in the %s prompt", (kind) => {
    const prompt = system(kind);
    expect(prompt).toContain("LINKING TO THE WEB");
    expect(prompt).toContain("NEVER invent a URL");
    // The provenance clause is the load-bearing half, so it is pinned by itself
    // rather than left to the heading above.
    expect(prompt).toContain("came back from a tool on this");
  });

  it("is the same text in both, because it is one constant", () => {
    /* Anchored on the HEADING — the words followed by a blank line — because
       chat's WHERE EACH CLAIM CAME FROM refers to this section by name ("as
       LINKING TO THE WEB says"), earlier in the prompt than the section itself,
       and a bare indexOf found that mention and compared two different places.
       docs/plans/260913b-chat-and-comment-questions-reach-for-the-web-and-the-citations-list.md. */
    const heading = "LINKING TO THE WEB\n\n";
    const clip = (prompt: string) => {
      const at = prompt.indexOf(heading);
      expect(at, "no LINKING TO THE WEB heading in the prompt").toBeGreaterThanOrEqual(0);
      return prompt.slice(at).split("\n\n").slice(0, 3).join("\n\n");
    };
    expect(clip(system("remember"))).toBe(clip(system("chat")));
  });

  it("shows the shape the parser actually reads", () => {
    // If this ever drifts to a different syntax, `webLinks` stops finding it and
    // the reader gets raw brackets. src/urls.ts.
    expect(system("chat")).toContain("[what the page is](https://example.com/the-piece)");
  });
});
