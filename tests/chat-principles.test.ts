/**
 * **Every conversation about an article carries the shared principles, or says
 * why not.** Greg, 2026-10-19 (`spya-u3yw2a`): *"Do we have a system prompt
 * (for Chats) (or something equivalent that all Chats share)?"* —
 * src/chat-principles.ts, plan docs/plans/261020d-principles-every-chat-shares.md.
 *
 * A `Record<ThreadKind, …>` rather than a list, so a new kind is a compile
 * error here until somebody decides which it is (GPT Sol's plan review, F11),
 * and each kind's prompt is the one `buildConverseMessages` actually sends.
 *
 * **What it cannot see**: Live's spoken prompts (src/live.ts, src/live-gpt.ts)
 * are not thread kinds and do not carry it yet — deferred in the plan, not
 * forgotten — and the "?" explanation (src/explain.ts) is one answer, not a
 * conversation.
 */
import { describe, expect, it } from "vitest";
import { CHAT_PRINCIPLES, CHAT_PRINCIPLES_HEADING } from "../src/chat-principles.js";
import { buildConverseMessages } from "../src/converse.js";
import { THREAD_KINDS, type Block, type ChatMessage, type Meta, type ThreadKind } from "../src/types.js";

const COVERAGE: Record<ThreadKind, "carries" | { exempt: string }> = {
  chat: "carries",
  learn: "carries",
  tutorial: "carries",
  explore: "carries",
  guide: "carries",
  candidates: {
    exempt:
      "Referee's find-reviewers: its reader is an editor finding reviewers, not someone reading the piece, and its own rules cover honesty and provenance",
  },
};

const blocks: Block[] = [
  {
    id: "spya-k3m9qt",
    tag: "p",
    kind: "text",
    text: "Bigger brains make better thinkers, the study found.",
    words: 8,
    html: "<p>Bigger brains make better thinkers, the study found.</p>",
    gistable: true,
  },
];
const meta = { title: "A piece", byline: "Somebody" } as unknown as Meta;

const systemOf = (kind: ThreadKind): string =>
  String(
    buildConverseMessages({ meta, blocks, history: [] as ChatMessage[], question: "what does it say?", kind })[0]
      ?.content ?? "",
  );

describe("the principles every chat shares", () => {
  it.each(THREAD_KINDS)("%s: carries them exactly once, or is exempt with a reason", (kind) => {
    const rule = COVERAGE[kind];
    const system = systemOf(kind);
    const count = system.split(CHAT_PRINCIPLES_HEADING).length - 1;
    if (rule === "carries") {
      expect(system).toContain(CHAT_PRINCIPLES);
      expect(count).toBe(1);
    } else {
      expect(rule.exempt.length).toBeGreaterThan(20);
      expect(count).toBe(0);
    }
  });

  it("sits near the top, before the prompt's own detailed rules", () => {
    for (const kind of THREAD_KINDS) {
      if (COVERAGE[kind] !== "carries") continue;
      const system = systemOf(kind);
      /* Ahead of the plain-words section every one of them ends with. */
      expect(system.indexOf(CHAT_PRINCIPLES_HEADING)).toBeLessThan(system.indexOf("PLAIN WORDS"));
      expect(system.indexOf(CHAT_PRINCIPLES_HEADING)).toBeLessThan(2000);
    }
  });

  it("stays short: principles, not a second rulebook", () => {
    expect(CHAT_PRINCIPLES.split(/\s+/).length).toBeLessThan(200);
  });

  it("asks for a recheck under push-back, not for the model to dig in", () => {
    expect(CHAT_PRINCIPLES).toContain("recheck, then hold or revise");
  });
});
