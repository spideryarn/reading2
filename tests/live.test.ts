/**
 * **Live conversation mode's session, and the four ways it goes silently
 * wrong.** src/live.ts, docs/plans/live-conversation.md.
 *
 * Everything expensive about this feature is decided before a single word is
 * spoken — the model is told the article, handed eight tools and given the
 * reader's vocabulary in one request, and then talks to the browser directly on
 * a wire this process never sees. So the only thing worth testing here is what
 * we *sent*, exactly as `tests/transcribe.test.ts` argues about dictation.
 *
 * The four:
 *
 *  - **The tool shape.** Realtime flattens the function; chat/completions nests
 *    it. Reusing `CHAT_TOOLS` unconverted produces a session with no tools that
 *    still connects and still talks, so the symptom is a companion that has
 *    stopped being able to point at anything and says nothing about why.
 *  - **The article.** If `articleWithIds` ever stops being interpolated, the
 *    model answers about the article from whatever it remembers of the world,
 *    fluently, and nothing errors.
 *  - **The wrong prompt.** `SYSTEM` in src/converse.ts demands a block id in
 *    square brackets on every claim. Spoken, that is six seconds of gibberish
 *    per sentence — so this checks the live prompt is not that one.
 *  - **The vocabulary.** Same failure dictation has: quietly worse transcripts
 *    and no other symptom.
 */
import { describe, expect, it } from "vitest";

import {
  LIVE_MODEL,
  SHOW_PASSAGE_TOOL,
  liveInstructions,
  liveSession,
  liveTools,
  mintLiveToken,
} from "../src/live.js";
import type { Block, Meta } from "../src/types.js";

const meta = { slug: "piece", title: "A Piece", byline: "Someone" } as Meta;
const blocks = [
  { id: "spya-aaa111", tag: "p", kind: "prose", text: "The rainstorm does not compute.", words: 5, html: "<p/>" },
  { id: "spya-bbb222", tag: "p", kind: "prose", text: "Substrate independence is assumed.", words: 4, html: "<p/>" },
] as unknown as Block[];

describe("the tools, in the shape realtime actually takes", () => {
  const tools = liveTools() as Record<string, unknown>[];

  it("flattens every function — a nested one is a session with no tools", () => {
    /* The load-bearing assertion in this file. `CHAT_TOOLS` is
       `{ type, function: { name, … } }` and realtime wants
       `{ type, name, … }`. Both are objects with a `type` of "function", so a
       shape check that only looked at `type` would pass on the broken one. */
    for (const t of tools) {
      expect(t.type).toBe("function");
      expect(t, `${String(t.name)} still has a nested function`).not.toHaveProperty("function");
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(t.parameters).toBeTruthy();
    }
  });

  it("carries all seven chat tools plus show_passage", () => {
    const names = tools.map((t) => t.name);
    expect(names).toContain("show_passage");
    expect(names).toContain("search_article_words");
    expect(names).toContain("article_glossary");
    expect(names).toHaveLength(8);
  });

  it("puts show_passage first, because it is the only one that costs nothing", () => {
    /* Order is a hint, not a rule — but a talking companion goes silent for a
       second or two on every other tool in the list, and this one it can honour
       in the frame it arrives in. */
    expect(tools[0]?.name).toBe("show_passage");
    expect(SHOW_PASSAGE_TOOL.parameters.required).toEqual(["blockIds"]);
  });
});

describe("what the model is told", () => {
  const text = liveInstructions({ meta, blocks });

  it("contains the whole article, with its ids", () => {
    expect(text).toContain("The rainstorm does not compute.");
    expect(text).toContain("Substrate independence is assumed.");
    expect(text).toContain("spya-aaa111");
  });

  it("is NOT the written-chat prompt", () => {
    /* If somebody ever reaches for `SYSTEM` from src/converse.ts because it is
       right there and says all the true things, this is what should stop them.
       That prompt's headline rule asks for a citation in square brackets at the
       end of every claim, which out loud is unusable. */
    expect(text).not.toContain("CITING THE ARTICLE — THE ONE RULE THAT MATTERS");
    expect(text).toContain("NEVER SAY A BLOCK ID OUT LOUD");
  });

  it("puts the rules before the article", () => {
    /* Forty thousand tokens of article between the rules and the first spoken
       word is a lot of room for the rules to stop being the most recent thing
       the model read. */
    expect(text.indexOf("HOW TO TALK")).toBeLessThan(text.indexOf("THE ARTICLE"));
  });

  it("includes the reader's profile when there is one, and no heading when there is not", () => {
    expect(liveInstructions({ meta, blocks, profile: "A neuroscientist." })).toContain(
      "A neuroscientist.",
    );
    expect(text).not.toContain("WHO YOU ARE TALKING TO");
  });
});

describe("the session", () => {
  it("primes the transcriber with the vocabulary", () => {
    const s = liveSession({ meta, blocks, vocabulary: "Spideryarn, spya-k3m9qt" });
    const input = (s.audio as { input: Record<string, Record<string, unknown>> }).input;
    expect(input.transcription?.prompt).toBe("Spideryarn, spya-k3m9qt");
  });

  it("omits the prompt entirely rather than sending an empty one", () => {
    const s = liveSession({ meta, blocks, vocabulary: "" });
    const input = (s.audio as { input: Record<string, Record<string, unknown>> }).input;
    expect(input.transcription).not.toHaveProperty("prompt");
    /* Transcription itself stays on. Without it the app never learns what the
       reader said, so there is nothing to show and nothing to store. */
    expect(input.transcription?.model).toBe("gpt-4o-transcribe");
  });

  it("asks for semantic turn detection, not the fixed-silence default", () => {
    /* `server_vad` cuts a turn after 500ms of quiet, which is a reader
       thinking. Being interrupted mid-thought is the thing that makes a voice
       mode unusable. */
    const s = liveSession({ meta, blocks });
    const input = (s.audio as { input: Record<string, Record<string, unknown>> }).input;
    expect(input.turn_detection?.type).toBe("semantic_vad");
  });
});

describe("minting a token", () => {
  const ok = {
    ok: true,
    json: async () => ({
      value: "ek_test",
      expires_at: 123,
      session: { model: "gpt-realtime-2.1" },
    }),
  } as Response;

  it("sends the session and the expiry, and hands back only the secret", async () => {
    let seen: { url: string; body: Record<string, unknown>; auth: string } | null = null;
    const spy = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = {
        url: String(url),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        auth: String(new Headers(init?.headers).get("authorization")),
      };
      return ok;
    }) as unknown as typeof fetch;

    process.env.OPENAI_API_KEY = "sk-test";
    const out = await mintLiveToken({ type: "realtime", model: LIVE_MODEL }, spy);

    expect(seen!.url).toBe("https://api.openai.com/v1/realtime/client_secrets");
    expect(seen!.auth).toBe("Bearer sk-test");
    expect((seen!.body.expires_after as Record<string, unknown>).seconds).toBe(600);
    expect(out.token).toBe("ek_test");
    /* The browser is handed a secret and nothing else — not the instructions,
       not the tools, not the article. The created session already holds them,
       and a client that is given the prompt is one that can be talked into
       sending a different one. */
    expect(Object.keys(out).sort()).toEqual(["expiresAt", "model", "token"]);
  });

  it("reports the model OpenAI created, not the one we asked for", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const other = {
      ok: true,
      json: async () => ({ value: "ek_x", expires_at: 1, session: { model: "something-else" } }),
    } as Response;
    const out = await mintLiveToken({}, (async () => other) as unknown as typeof fetch);
    expect(out.model).toBe("something-else");
  });

  it("keeps OpenAI's own sentence when it refuses", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const bad = {
      ok: false,
      status: 400,
      text: async () => '{"error":{"message":"Unknown parameter: session.wibble."}}',
    } as Response;
    await expect(
      mintLiveToken({}, (async () => bad) as unknown as typeof fetch),
    ).rejects.toThrow(/Unknown parameter: session\.wibble/);
  });

  it("refuses without a key rather than sending an unauthenticated request", async () => {
    delete process.env.OPENAI_API_KEY;
    let called = false;
    const spy = (async () => {
      called = true;
      return ok;
    }) as unknown as typeof fetch;
    await expect(mintLiveToken({}, spy)).rejects.toThrow(/live-not-set-up/);
    expect(called).toBe(false);
  });

  it("refuses a 200 that carries no secret", async () => {
    /* A shape that changed under us would otherwise reach the browser as the
       string "undefined" and fail at the SDP exchange, one layer from the
       cause. */
    process.env.OPENAI_API_KEY = "sk-test";
    const empty = { ok: true, json: async () => ({ session: {} }) } as Response;
    await expect(
      mintLiveToken({}, (async () => empty) as unknown as typeof fetch),
    ).rejects.toThrow(/no client secret/);
  });
});
