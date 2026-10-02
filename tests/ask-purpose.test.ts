// @vitest-environment jsdom
/**
 * **The one-shot mark that asks "Why are you reading this?" when the article
 * first opens** — src/web/ask-purpose.ts, plan 261001s § Stage 3 and GPT Sol's
 * review item 3.
 *
 * Peek must not consume (a failed read keeps the mark for the next load), clear
 * must only clear the slug it names (another add in this tab may have written a
 * newer one), and a browser that throws on storage must cost nothing worse than
 * not being asked.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const stored = new Map<string, string>();
let throwing = false;
const fake = {
  getItem: (key: string) => {
    if (throwing) throw new Error("SecurityError");
    return stored.get(key) ?? null;
  },
  setItem: (key: string, value: string) => {
    if (throwing) throw new Error("QuotaExceededError");
    stored.set(key, value);
  },
  removeItem: (key: string) => {
    if (throwing) throw new Error("SecurityError");
    stored.delete(key);
  },
  clear: () => stored.clear(),
};
Object.defineProperty(window, "sessionStorage", { configurable: true, value: fake });

const { ASK_PURPOSE_KEY, clearAskPurpose, markAskPurpose, peekAskPurpose } = await import(
  "../src/web/ask-purpose.js"
);

beforeEach(() => {
  stored.clear();
  throwing = false;
});
afterEach(() => {
  throwing = false;
});

describe("the ask-purpose mark", () => {
  it("is written under spideryarn.ask-purpose, naming the slug", () => {
    markAskPurpose("a-paper");
    expect(ASK_PURPOSE_KEY).toBe("spideryarn.ask-purpose");
    expect(stored.get("spideryarn.ask-purpose")).toBe("a-paper");
  });

  it("peek answers for the named slug only, and does not consume it", () => {
    markAskPurpose("a-paper");
    expect(peekAskPurpose("another-paper")).toBe(false);
    expect(peekAskPurpose("a-paper")).toBe(true);
    expect(peekAskPurpose("a-paper"), "peek consumed the mark").toBe(true);
  });

  it("clear removes the mark only when it names that slug", () => {
    markAskPurpose("a-paper");
    clearAskPurpose("another-paper");
    expect(peekAskPurpose("a-paper"), "clearing another slug removed this one").toBe(true);
    clearAskPurpose("a-paper");
    expect(peekAskPurpose("a-paper")).toBe(false);
    expect(stored.has("spideryarn.ask-purpose")).toBe(false);
  });

  it("survives storage that throws, answering 'no mark'", () => {
    throwing = true;
    expect(() => markAskPurpose("a-paper")).not.toThrow();
    expect(peekAskPurpose("a-paper")).toBe(false);
    expect(() => clearAskPurpose("a-paper")).not.toThrow();
  });
});
