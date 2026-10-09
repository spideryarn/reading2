/**
 * **`offer_to_save`: the guide offers the reader's reason or About you as a
 * card they press, and saves nothing itself** — plan
 * docs/plans/261009q-the-guide-offers-to-save-your-reason-and-about-you-in-your-words.md.
 *
 * The tool is the guide's alone (`toolsFor`), absent from Live (whose tool
 * route takes names from the browser and has nowhere to put a button), and
 * what it returns is an offer on the run plus a sentence telling the model
 * nothing was saved. Any store read or fetch from it would be a bug, so both
 * are spies that throw.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ store: [] as string[] }));

vi.mock("../src/store/index.js", async () => {
  const actual = await vi.importActual<typeof import("../src/store/index.js")>("../src/store/index.js");
  const spy = (name: string) => async () => {
    calls.store.push(name);
    throw new Error(`offer_to_save reached the store: ${name}`);
  };
  return {
    ...actual,
    loadArticle: spy("loadArticle"),
    loadGlossary: spy("loadGlossary"),
    loadCitations: spy("loadCitations"),
  };
});

import { GUIDE_TOOLS, runTool, toolsFor } from "../src/chat-tools.js";
import { LIVE_SERVER_TOOLS, liveTools } from "../src/live.js";
import { MAX_PROFILE_CHARS, MAX_PURPOSE_CHARS, type Meta, type ThreadKind } from "../src/types.js";

const meta = { title: "A piece" } as unknown as Meta;
const ctx = (kind: ThreadKind | undefined) => ({
  slug: "a-piece",
  meta,
  blocks: [],
  power: "standard" as const,
  kind,
  threadId: "spya-gdeab2",
  saved: { purpose: null, profile: null },
});

const names = (tools: readonly { function: { name: string } }[]) => tools.map((t) => t.function.name);

let realFetch: typeof fetch;
beforeEach(() => {
  calls.store.length = 0;
  realFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error("offer_to_save reached fetch"));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("who is offered it", () => {
  it("is the guide's, and no other kind's", () => {
    expect(names(toolsFor("guide"))).toContain("offer_to_save");
    for (const kind of ["chat", "learn", "tutorial", "explore", "candidates"] as const) {
      expect(names(toolsFor(kind))).not.toContain("offer_to_save");
    }
  });

  it("is not offered to a spoken guide, and the live tool route would refuse it", () => {
    const spoken = liveTools("guide").map((t) => (t as { name: string }).name);
    expect(spoken).not.toContain("offer_to_save");
    expect(LIVE_SERVER_TOOLS.has("offer_to_save")).toBe(false);
    /* GUIDE_TOOLS is what Live reads; it stays the article tools. */
    expect(names(GUIDE_TOOLS)).not.toContain("offer_to_save");
  });

  it("is refused to a chat that names it anyway", async () => {
    const out = await runTool("offer_to_save", { field: "reason", text: "for journal club" }, ctx("chat"));
    expect(out.detail).toBe("no such tool");
    expect(out.offer).toBeUndefined();
  });
});

describe("what it returns", () => {
  it("offers a reason, in our field name, normalised as the store would", async () => {
    const out = await runTool("offer_to_save", { field: "reason", text: "  For journal club\r\nnext week  " }, ctx("guide"));
    expect(out.offer).toEqual({ field: "purpose", text: "For journal club\nnext week", basis: null });
    expect(out.content).toMatch(/nothing is saved unless they press/i);
    expect(out.label).toBe("offered to save why you're reading");
    expect(calls.store).toEqual([]);
  });

  it("offers About you", async () => {
    const out = await runTool("offer_to_save", { field: "about_you", text: "A cognitive neuroscientist." }, ctx("guide"));
    expect(out.offer).toEqual({ field: "profile", text: "A cognitive neuroscientist.", basis: null });
    expect(out.label).toBe("offered to update About you");
  });

  it.each([
    ["an unknown field", { field: "password", text: "x" }],
    ["no field", { text: "x" }],
    ["empty text", { field: "reason", text: "   \n " }],
    ["text that is not a string", { field: "reason", text: 42 }],
    ["a reason over the cap", { field: "reason", text: "x".repeat(MAX_PURPOSE_CHARS + 1) }],
    ["About you over the cap", { field: "about_you", text: "x".repeat(MAX_PROFILE_CHARS + 1) }],
  ])("offers nothing for %s, and says why", async (_what, args) => {
    const out = await runTool("offer_to_save", args, ctx("guide"));
    expect(out.offer).toBeUndefined();
    expect(out.detail).toBe("not offered");
    expect(out.content).toMatch(/nothing was offered/i);
  });

  it("records what the field held when the turn read it, and refuses when it could not read it", async () => {
    const withSaved = { ...ctx("guide"), saved: { purpose: null, profile: "A historian" } };
    const reason = await runTool("offer_to_save", { field: "reason", text: "For journal club." }, withSaved);
    expect(reason.offer).toEqual({ field: "purpose", text: "For journal club.", basis: null });
    const about = await runTool("offer_to_save", { field: "about_you", text: "A historian of science." }, withSaved);
    expect(about.offer?.basis).toBe("A historian");
    const unread = await runTool("offer_to_save", { field: "reason", text: "x" }, { ...ctx("guide"), saved: { profile: null } });
    expect(unread.offer).toBeUndefined();
    expect(unread.content).toMatch(/what is saved now could not be read/i);
  });

  it("offers nothing that is already saved word for word", async () => {
    const out = await runTool(
      "offer_to_save",
      { field: "reason", text: " For journal club. " },
      { ...ctx("guide"), saved: { purpose: "For journal club." } },
    );
    expect(out.offer).toBeUndefined();
    expect(out.content).toMatch(/already their saved words/);
  });

  it("takes text exactly at the cap", async () => {
    const out = await runTool("offer_to_save", { field: "reason", text: "x".repeat(MAX_PURPOSE_CHARS) }, ctx("guide"));
    expect(out.offer?.text).toHaveLength(MAX_PURPOSE_CHARS);
  });
});
