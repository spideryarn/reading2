/**
 * **The guide's greeting, arm by arm** — src/web/guide-greeting.ts, plan
 * docs/plans/261009i-the-guide-greets-in-chat-takes-live-and-a-bar-row.md.
 * What the panel draws from these is tests/guide-in-chat-panel.test.tsx.
 */
import { describe, expect, it } from "vitest";
import { guideGreeting, type Greeting } from "../src/web/guide-greeting.js";

const text = (g: Greeting | null): string => (g?.paragraphs ?? []).map((p) => p.map((r) => r.text).join("")).join("\n");

describe("guideGreeting", () => {
  it("says nothing until the read has answered", () => {
    expect(guideGreeting({ state: "loading" }, "A Piece")).toBeNull();
  });

  it("claims nothing and asks nothing when the read failed or the shelf could not be read", () => {
    for (const read of [
      { state: "failed" } as const,
      { state: "ready", purpose: null, purposeFailed: true, profile: null } as const,
    ]) {
      const g = guideGreeting(read, "A Piece");
      expect(g?.offersStart).toBe(false);
      expect(g?.invitesProfile).toBe(false);
      expect(text(g)).not.toMatch(/why are you reading|you said/i);
    }
  });

  it("asks why, and who they are, when neither is stored", () => {
    const g = guideGreeting({ state: "ready", purpose: null, purposeFailed: false, profile: null }, "A Piece");
    expect(text(g)).toContain("Why are you reading it?");
    expect(text(g)).toContain("tell me a little about yourself");
  });

  it("quotes a short span of About you, and the title in its own voice", () => {
    const long = `A neuroscientist ${"who studies memory ".repeat(20)}`;
    const g = guideGreeting({ state: "ready", purpose: null, purposeFailed: false, profile: long }, "A Piece");
    const quote = g?.paragraphs.flat().find((r) => r.voice === "reader")?.text ?? "";
    expect([...quote].length).toBeLessThanOrEqual(120 + 3);
    expect(g?.paragraphs[0]?.find((r) => r.voice === "title")?.text).toBe("A Piece");
  });

  it("falls back to 'this piece' with no title", () => {
    const g = guideGreeting({ state: "ready", purpose: "x", purposeFailed: false, profile: "y" }, undefined);
    expect(text(g)).toContain("Hi, I'm your guide to this piece.");
    expect(g?.offersStart).toBe(true);
  });
});
