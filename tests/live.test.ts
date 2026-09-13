/**
 * **Live conversation mode's session, and the four ways it goes silently
 * wrong.** src/live.ts, docs/plans/260831g-live-conversation.md.
 *
 * Everything expensive about this feature is decided before a single word is
 * spoken — the model is told the article, handed nine tools and given the
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
  LIVE_SERVER_TOOLS,
  LIVE_TRANSCRIBER,
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

  it("carries all eight chat tools plus show_passage", () => {
    const names = tools.map((t) => t.name);
    expect(names).toContain("show_passage");
    expect(names).toContain("search_article_words");
    expect(names).toContain("article_glossary");
    expect(names).toHaveLength(9);
  });

  it("offers article_citations and lets the server run it — deliberately", () => {
    /* `CHAT_TOOLS` is shared by typed Chat, Remember, Candidates and Live, and
       the citations tool reaches all four on purpose: read-only, article-local,
       the reader's own derived data. A per-kind tool list was weighed and was
       more machinery than that warrants. docs/plans/260913b-…-citations-list.md
       § Where it reaches (GPT Sol F9). */
    expect(tools.map((t) => t.name)).toContain("article_citations");
    expect(LIVE_SERVER_TOOLS.has("article_citations")).toBe(true);
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
  const inputOf = (s: Record<string, unknown>) =>
    (s.audio as { input: Record<string, Record<string, unknown>> }).input;

  /**
   * **The vocabulary goes in `keywords`, and NEVER in `prompt`.**
   *
   * The most important assertion in this file, and the only one that is about a
   * bug that actually reached a reader. With the term list in `prompt`, the
   * transcriber reads the whole list back as a transcript whenever it is handed
   * non-speech — so a pause with a fan running became "the reader just said
   * Spideryarn, granularity zoom, gist column, block id, …" and the companion
   * answered it. Measured twice in evals/live/hallucination-on-noise.mts.
   *
   * Nothing about a session object can show that going wrong again, which is
   * why this test asserts the *absence* of `prompt` as hard as the presence of
   * `keywords`.
   */
  it("sends the vocabulary as keywords, never as a prompt", () => {
    const s = liveSession({ meta, blocks, vocabulary: ["Spideryarn", "spya-k3m9qt"] });
    expect(inputOf(s).transcription?.keywords).toEqual(["Spideryarn", "spya-k3m9qt"]);
    expect(
      inputOf(s).transcription,
      "a term list in `prompt` is read back as a transcript on silence",
    ).not.toHaveProperty("prompt");
  });

  it("omits keywords entirely rather than sending an empty list", () => {
    /* All three ways of having nothing to say, spelled out rather than looped
       over a mixed array — `exactOptionalPropertyTypes` makes "absent" and
       "explicitly undefined" different types, and the loop hid that. */
    for (const s of [
      liveSession({ meta, blocks, vocabulary: [] }),
      liveSession({ meta, blocks, vocabulary: null }),
      liveSession({ meta, blocks }),
    ]) {
      expect(inputOf(s).transcription).not.toHaveProperty("keywords");
      /* Transcription itself stays on. Without it the app never learns what the
         reader said, so there is nothing to show and nothing to store. */
      expect(inputOf(s).transcription?.model).toBe(LIVE_TRANSCRIBER);
    }
  });

  /**
   * The deprecated family is the one that regurgitates, and it is also being
   * switched off — `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` and
   * `whisper-1` were deprecated 2026-08-26, shutdown 2027-02-26. Naming them
   * here means going back to one is a red test rather than a quiet regression.
   */
  it("is not on one of the deprecated transcribers", () => {
    const s = liveSession({ meta, blocks, vocabulary: ["Spideryarn"] });
    expect(["gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"]).not.toContain(
      inputOf(s).transcription?.model,
    );
  });

  it("turns noise reduction on, which is off by default", () => {
    /* Upstream of everything else: it filters before the VAD, so a room is
       less likely to open a turn at all. The API takes exactly two values and
       refuses anything else, so this pins one of them rather than a shape. */
    const s = liveSession({ meta, blocks });
    expect(["near_field", "far_field"]).toContain(
      (inputOf(s).noise_reduction as { type?: string } | undefined)?.type,
    );
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
