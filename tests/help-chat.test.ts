/**
 * ***Ask about Spideryarn* — the body, the prompt and the job's registrations.**
 * Plan docs/plans/261007k-help-chatbot.md, Stage 1. The route, its refusals and
 * its lifetime are tests/help-chat-route.test.ts; the corpus is
 * tests/help-corpus.test.ts.
 */
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
import { AI_JOB_WIRE, HELP_CHAT_MODEL, NON_TASK_MODELS, QUICK_MODEL_OPENROUTER } from "../src/models.js";
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
    for (const page of pages) expect(HELP_CHAT_SYSTEM, page.anchor).toContain(`Address: ${page.href}`);
    expect(HELP_CHAT_SYSTEM.indexOf("THE HELP PAGES")).toBeLessThan(HELP_CHAT_SYSTEM.indexOf("WHAT YOU DO"));
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
    expect(body.max_completion_tokens).toBe(HELP_CHAT_MAX_TOKENS);
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("plugins");
    expect(Object.keys(body).sort()).toEqual(["max_completion_tokens", "messages", "model"]);
  });
});

describe("the help-chat job, registered everywhere a job must be", () => {
  it("is on the quick tier's model until the eval says otherwise", () => {
    expect(HELP_CHAT_MODEL).toBe(QUICK_MODEL_OPENROUTER);
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
  it("is 30 an hour and 100 a day per reader, one at a time, with a fuse of 1,500 a day", () => {
    expect(HELP_CHAT_RATE_POLICY).toMatchObject({ fills: 30, windowMs: 3_600_000, concurrency: 1 });
    expect(HELP_CHAT_RATE_POLICY.daily).toEqual({ fills: 100, globalFills: 1_500, windowMs: 86_400_000 });
  });

  it("holds its slot for the whole deadline and then some, so a live answer is never doubled", () => {
    expect(HELP_CHAT_TIMEOUT_MS).toBe(45_000);
    expect(HELP_CHAT_STALL_MS).toBe(20_000);
    expect(HELP_CHAT_RATE_POLICY.leaseMs).toBe(HELP_CHAT_TIMEOUT_MS + 30_000);
  });
});
