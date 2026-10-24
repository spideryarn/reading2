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
  explore: "carries",
  guide: "carries",
  candidates: {
    exempt:
      "Referee's find-reviewers: its reader is an editor finding reviewers, not someone reading the piece, and its own rules cover honesty and provenance",
  },
};
const coverageKinds = Object.keys(COVERAGE) as ThreadKind[];

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
  it("keeps the runtime list and the exhaustive coverage record in step", () => {
    expect([...THREAD_KINDS].sort()).toEqual([...coverageKinds].sort());
  });

  it.each(coverageKinds)("%s: carries them exactly once, or is exempt with a reason", (kind) => {
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

  it("is the first named rule section, after the opening description", () => {
    for (const kind of coverageKinds) {
      if (COVERAGE[kind] !== "carries") continue;
      const system = systemOf(kind);
      const headings = [...system.matchAll(/^([A-Z][A-Z0-9 '’—–,:-]+)$/gm)].map((match) => match[1]);
      expect(headings[0], kind).toBe(CHAT_PRINCIPLES_HEADING);
    }
  });

  it("leaves the fixed system-and-article cache prefix byte-identical between turns", () => {
    const article = buildConverseMessages({
      meta,
      blocks,
      history: [],
      question: "first question",
      kind: "chat",
    })[1];
    for (const kind of coverageKinds) {
      const first = buildConverseMessages({ meta, blocks, history: [], question: "first question", kind });
      const later = buildConverseMessages({
        meta,
        blocks,
        kind,
        question: "a different question",
        profile: "A different profile",
        history: [
          {
            id: "h1",
            role: "user",
            text: "an earlier turn",
            createdAt: "2026-10-20T12:00:00.000Z",
            status: "done",
          },
        ],
      });
      expect(later.slice(0, 2), kind).toEqual(first.slice(0, 2));
      expect(later[1], `${kind}'s article message`).toEqual(article);
    }
  });

  it("stays short: principles, not a second rulebook", () => {
    /* 200 until plan 261020ac added Greg's clause on assumed knowledge (16
       words, 210 in all); 220 until plan 261024d added his clause on what the
       model brings in (47 words, 262 in all); 270 until plan 261024v added
       his sentence on choosing the clearest example (35 words, 297 in all).
       Raise it for a principle Greg asks for, not to fit a rule. */
    expect(CHAT_PRINCIPLES.split(/\s+/).length).toBeLessThan(305);
  });

  it("asks for a recheck under push-back, not for the model to dig in", () => {
    expect(CHAT_PRINCIPLES).toContain("recheck, then hold or revise");
  });
});

/* Plan 261024v (spya-furs26): the principle's echo beside the profile, which
   is what measurably moved it. Every conversation that carries the principles
   gets it when there is a profile; nothing gets it without one. */
describe("the example reminder beside the profile", () => {
  const REMINDER = "Their job or field is not by itself a reason to use one from it.";
  const sent = (kind: ThreadKind, profile: string | null): string =>
    JSON.stringify(
      buildConverseMessages({ meta, blocks, history: [] as ChatMessage[], question: "what does it say?", kind, profile }),
    );

  it.each(coverageKinds)("%s: beside the profile when it carries the principles", (kind) => {
    const withProfile = sent(kind, "About them: Family lawyer.");
    expect(withProfile.includes(REMINDER), kind).toBe(COVERAGE[kind] === "carries");
    expect(sent(kind, null)).not.toContain(REMINDER);
  });
});
