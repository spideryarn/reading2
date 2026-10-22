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
      expect(g?.invitesProfile).toBe(false);
      expect(text(g)).not.toMatch(/why are you reading|you said/i);
    }
  });

  /* Plan 261019p: one question, and a way past it; nothing about who they are. */
  it("asks only why, with a way past it, when no reason is stored, About you or not", () => {
    for (const profile of [null, "A cognitive neuroscientist who studies memory"]) {
      const g = guideGreeting({ state: "ready", purpose: null, purposeFailed: false, profile }, "A Piece");
      expect(text(g)).toContain("Why are you reading it? A few words is plenty.");
      expect(text(g)).toContain("Or just ask me something about it.");
      expect(text(g)).not.toMatch(/about yourself|About you|still right/);
      expect(g?.paragraphs.flat().some((r) => r.voice === "reader")).toBe(false);
      expect(g?.invitesProfile).toBe(false);
      expect(g?.paragraphs[0]?.find((r) => r.voice === "title")?.text).toBe("A Piece");
    }
  });

  it("quotes a stored reason back and offers to answer questions", () => {
    const g = guideGreeting({ state: "ready", purpose: "For my journal club", purposeFailed: false, profile: null }, "A Piece");
    expect(text(g)).toContain("You said you're reading it because “For my journal club”.");
    expect(text(g)).toContain("or you can ask me something about it.");
    expect(g?.invitesProfile).toBe(true);
  });

  it("falls back to 'this piece' with no title", () => {
    const g = guideGreeting({ state: "ready", purpose: "x", purposeFailed: false, profile: "y" }, undefined);
    expect(text(g)).toContain("Hi, I'm your guide to this piece.");
  });
});
