/**
 * ***Ask about Spideryarn* — the body, the prompt and the job's registrations.**
 * Plan docs/plans/261007k-help-chatbot.md, Stage 1. The route, its refusals and
 * its lifetime are tests/help-chat-route.test.ts; the corpus is
 * tests/help-corpus.test.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { AI_JOB_ROUTE, CHAT_REASONING } from "../src/ai-call.js";
import { JOB_DISPOSITION } from "../src/cost-categories.js";
import { MAX_HELP_QUESTION_CHARS, parseHelpChatRequest, type HelpCorpusPage } from "../src/help-chat.js";
import {
  HELP_CHAT_MAX_TOKENS,
  HELP_CHAT_RATE_POLICY,
  HELP_CHAT_STALL_MS,
  HELP_CHAT_SYSTEM,
  HELP_CHAT_TIMEOUT_MS,
  helpChatRequest,
} from "../src/help-chat-call.js";
import corpus from "../src/help-corpus.generated.json" with { type: "json" };
import { AI_JOB_WIRE, HELP_CHAT_MODEL, NON_TASK_MODELS } from "../src/models.js";
import { plainWords } from "../src/plain-words.js";

describe("the body of POST /api/help-chat", () => {
  it("takes one question, trimmed", () => {
    expect(parseHelpChatRequest({ question: "  What is the spine?\n" })).toEqual({
      ok: true,
      request: { question: "What is the spine?" },
    });
  });

  it("takes a question of exactly the limit, and refuses one character more", () => {
    expect(parseHelpChatRequest({ question: "x".repeat(MAX_HELP_QUESTION_CHARS) }).ok).toBe(true);
    expect(parseHelpChatRequest({ question: `  ${"x".repeat(MAX_HELP_QUESTION_CHARS)}  ` }).ok).toBe(true);
    expect(parseHelpChatRequest({ question: "x".repeat(MAX_HELP_QUESTION_CHARS + 1) }).ok).toBe(false);
  });

  it.each([
    ["null", null],
    ["a string", "What is the spine?"],
    ["a list", [{ question: "What is the spine?" }]],
    ["no question", {}],
    ["an empty question", { question: "" }],
    ["only spaces", { question: " \n\t " }],
    ["a number", { question: 7 }],
    ["a conversation instead", { messages: [{ role: "user", text: "zebra" }] }],
    ["an unknown key beside the question", { question: "What is the spine?", history: [] }],
  ])("refuses %s, in fixed words that never repeat what was sent", (_what, body) => {
    const parsed = parseHelpChatRequest(body);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).not.toContain("spine");
    expect(parsed.reason).not.toContain("zebra");
  });
});

describe("what the model is sent", () => {
  const pages = corpus as readonly HelpCorpusPage[];

  it("is the whole Help, with every page's address, first", () => {
    for (const [i, page] of pages.entries()) {
      const marker = `=== ${page.title} ===\nAddress: ${page.href}`;
      const start = HELP_CHAT_SYSTEM.indexOf(marker);
      expect(start, page.anchor).toBeGreaterThanOrEqual(0);
      const next = pages[i + 1];
      const end =
        next === undefined
          ? HELP_CHAT_SYSTEM.indexOf("=== End of the Help pages ===")
          : HELP_CHAT_SYSTEM.indexOf(`=== ${next.title} ===`, start + marker.length);
      expect(HELP_CHAT_SYSTEM.slice(start, end), page.anchor).toContain(page.body);
    }
    expect(HELP_CHAT_SYSTEM.indexOf("THE HELP PAGES")).toBeLessThan(HELP_CHAT_SYSTEM.indexOf("WHAT YOU DO"));
  });

  /* The rule names pages by address — Feedback for a question the pages do
     not answer, Chat for one about an article. An address the Help has since
     moved would be a link the page refuses to draw (help-answer-links.ts), so
     every one the rule itself writes must be a page the corpus has. */
  it("links, in its own rule, only to pages the Help has", () => {
    const rule = HELP_CHAT_SYSTEM.slice(HELP_CHAT_SYSTEM.indexOf("=== End of the Help pages ==="));
    const linked = [...rule.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]);
    expect(linked).toEqual(expect.arrayContaining(["/help/feedback", "/help/mode-chat"]));
    const known = new Set(["/help", ...pages.map((p) => p.href)]);
    for (const href of linked) expect(known.has(href ?? ""), href).toBe(true);
  });

  it("carries the plain-words rule for an explanation", () => {
    expect(HELP_CHAT_SYSTEM).toContain(plainWords("explain"));
  });

  it("is one stable system message, with the question alone after it", () => {
    const a = helpChatRequest("What is the spine?");
    const b = helpChatRequest("Why is this part orange?");
    expect(a.messages).toEqual([
      { role: "system", content: HELP_CHAT_SYSTEM },
      { role: "user", content: "A reader of the Help pages asks:\n\nWhat is the spine?" },
    ]);
    /* The cached prefix is every byte of the system message: identical
       whatever is asked. */
    expect((a.messages as { content: string }[])[0]).toEqual((b.messages as { content: string }[])[0]);
    expect(HELP_CHAT_SYSTEM).not.toMatch(/\{\{|\}\}/);
  });

  it("asks the Help model for at most the ceiling, with no tools", () => {
    const body = helpChatRequest("What is the spine?");
    expect(body.model).toBe(HELP_CHAT_MODEL);
    expect(HELP_CHAT_MAX_TOKENS).toBe(800);
    expect(body.max_completion_tokens).toBe(HELP_CHAT_MAX_TOKENS);
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("plugins");
    expect(Object.keys(body).sort()).toEqual(["max_completion_tokens", "messages", "model"]);
  });
});

describe("the help-chat job, registered everywhere a job must be", () => {
  it("pins the model the eval chose, independently of the general quick tier", () => {
    expect(HELP_CHAT_MODEL).toBe("openai/gpt-5.6-luna");
    const models = readFileSync(new URL("../src/models.ts", import.meta.url), "utf8");
    expect(models).toContain('export const HELP_CHAT_MODEL = "openai/gpt-5.6-luna";');
    expect(NON_TASK_MODELS).toContainEqual({ job: "help-chat", id: HELP_CHAT_MODEL, provider: "openrouter" });
  });

  it("speaks chat/completions, prefers OpenAI's endpoint for its cache, and does not think", () => {
    expect(AI_JOB_WIRE["help-chat"]).toBe("chat");
    expect(AI_JOB_ROUTE["help-chat"]).toEqual({
      path: "/v1/chat/completions",
      wire: "chat",
      provider: { order: ["openai"], require_parameters: true },
    });
    expect(CHAT_REASONING["help-chat"]).toEqual({ effort: "none" });
  });

  it("is reader-facing request work in the cost report", () => {
    expect(JOB_DISPOSITION["help-chat"]).toBe("interactive request work");
  });
});

describe("the allowance", () => {
  it("is 30 an hour and 100 a day per reader, one at a time, with a fuse of 1,300 a day", () => {
    expect(HELP_CHAT_RATE_POLICY).toMatchObject({ fills: 30, windowMs: 3_600_000, concurrency: 1 });
    expect(HELP_CHAT_RATE_POLICY.daily).toEqual({ fills: 100, globalFills: 1_300, windowMs: 86_400_000 });
  });

  it("holds its slot for the whole deadline and then some, so a live answer is never doubled", () => {
    expect(HELP_CHAT_TIMEOUT_MS).toBe(45_000);
    expect(HELP_CHAT_STALL_MS).toBe(20_000);
    expect(HELP_CHAT_RATE_POLICY.leaseMs).toBe(HELP_CHAT_TIMEOUT_MS + 30_000);
  });
});
