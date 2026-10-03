/**
 * **What a GPT-Live session is sent** — src/live-gpt.ts, and
 * `createGptLiveSession` in src/live.ts. The plan is
 * docs/plans/261003a-gpt-live-alongside-realtime-for-live-conversation.md.
 *
 * As with the Realtime engine (tests/live.test.ts), everything that can go
 * silently wrong is decided in one request before a word is spoken, so what is
 * worth testing is what we *send*. Four things here fail without an error:
 *
 * - **The voice instructions over OpenAI's cap** is a 400 at create — but only
 *   for a long article, which is the one nobody tries first.
 * - **The article missing from the backend** is a backend that answers from
 *   what it remembers of the world, fluently.
 * - **A block id in the seeded history** teaches the voice to say ids aloud.
 * - **An allowlist that drops an event the hook needs** is a call that connects
 *   and then does nothing.
 *
 * No network: `fetch` is passed in. No database.
 */
import { describe, expect, it, vi } from "vitest";

import {
  createGptLiveSession,
  GPT_LIVE_BACKEND_MODEL,
  GPT_LIVE_MODEL,
  GptLiveCreateFailed,
  gptLiveCreateFailure,
  LIVE_SYSTEM,
  liveTools,
  UNTRUSTED_TOOL_RESULTS,
} from "../src/live.js";
import {
  GPT_LIVE_BACKEND_SYSTEM,
  GPT_LIVE_DATA_CHANNEL,
  GPT_LIVE_INSTRUCTION_TOKEN_CAP,
  GPT_LIVE_SEED_MESSAGE_CAP,
  GPT_LIVE_SEED_TOKEN_CAP,
  GPT_LIVE_VOICE_SYSTEM,
  gptLiveBackendInstructions,
  gptLiveOutline,
  gptLiveSeedInput,
  gptLiveSession,
  gptLiveVoiceInstructions,
  pessimisticTokens,
  SEED_TOKEN_BUDGET,
  trimSeed,
  VOICE_INSTRUCTION_BUDGET,
} from "../src/live-gpt.js";
import { readerFailureOf } from "../src/job-failure.js";
import { LIVE_UPSTREAM } from "../src/messages.js";
import type { Block, ChatMessage, Meta, Tree, TreeNode } from "../src/types.js";

const meta = { slug: "piece", title: "A Piece", byline: "Someone" } as Meta;

function block(n: number, text: string): Block {
  return {
    id: `spya-b${String(n).padStart(5, "0")}`,
    tag: "p",
    kind: "prose",
    text,
    words: text.split(" ").length,
    html: "<p/>",
    gistable: true,
  } as unknown as Block;
}

const blocks = [block(1, "The rainstorm does not compute."), block(2, "Substrate independence is assumed.")];

/** A tree with `parts` top-level parts, each with `subs` sub-parts, each gist `gistWords` long. */
function tree(parts: number, subs: number, gistWords: number): Tree {
  const nodes: Record<string, TreeNode> = {};
  const gist = (label: string): string =>
    `${label} ${Array.from({ length: gistWords }, (_, i) => `word${i}`).join(" ")}.`;
  const range: [string, string] = ["spya-b00001", "spya-b00002"];
  const root: TreeNode = {
    id: "n-root",
    depth: 0,
    parent: null,
    children: [],
    range,
    title: "The whole piece",
    gist: "The piece argues that rainstorms do not compute.",
  } as unknown as TreeNode;
  nodes[root.id] = root;
  for (let p = 0; p < parts; p++) {
    const part = {
      id: `n-p${p}`,
      depth: 1,
      parent: root.id,
      children: [] as string[],
      range,
      title: `Part ${p} title`,
      gist: gist(`Part ${p} says`),
    } as unknown as TreeNode;
    nodes[part.id] = part;
    root.children.push(part.id);
    for (let q = 0; q < subs; q++) {
      const sub = {
        id: `n-p${p}-s${q}`,
        depth: 2,
        parent: part.id,
        children: [`n-p${p}-s${q}-leaf`],
        range,
        title: `Section ${p}.${q} title`,
        gist: gist(`Section ${p}.${q} says`),
      } as unknown as TreeNode;
      nodes[sub.id] = sub;
      part.children.push(sub.id);
      nodes[`n-p${p}-s${q}-leaf`] = {
        id: `n-p${p}-s${q}-leaf`,
        depth: 3,
        parent: sub.id,
        children: [],
        range,
        title: `Leaf ${p}.${q}`,
        navLabel: `LEAFLABEL ${p}.${q}`,
      } as unknown as TreeNode;
    }
  }
  return { version: "1", generator: "test", slug: "piece", rootId: root.id, nodes } as unknown as Tree;
}

function msg(over: Partial<ChatMessage>): ChatMessage {
  return {
    id: "spya-m00000",
    role: "user",
    text: "",
    createdAt: "2026-10-03T10:00:00.000Z",
    status: "done",
    ...over,
  } as ChatMessage;
}

/** A conversation of `turns` question-and-answer pairs. */
function conversation(turns: number, answer: (i: number) => string): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < turns; i++) {
    out.push(msg({ id: `spya-q${String(i).padStart(5, "0")}`, text: `Question ${i}?` }));
    out.push(
      msg({ id: `spya-a${String(i).padStart(5, "0")}`, role: "assistant", text: answer(i) }),
    );
  }
  return out;
}

/* ------------------------------------------------------ the session -- */

describe("the session GPT-Live is asked to create", () => {
  const session = gptLiveSession({ meta, blocks, tree: tree(3, 2, 8), history: [] });
  const delegation = session.delegation as {
    type: string;
    responses: {
      model: string;
      instructions: string;
      reasoning: { effort: string };
      tools: Record<string, unknown>[];
    };
  };

  it("names the voice model, the voice, and the backend model at low effort", () => {
    expect(session.model).toBe(GPT_LIVE_MODEL);
    expect(GPT_LIVE_MODEL).toBe("gpt-live-1");
    expect(session.audio).toEqual({ output: { voice: "marin" } });
    expect(delegation.type).toBe("responses");
    expect(delegation.responses.model).toBe(GPT_LIVE_BACKEND_MODEL);
    expect(GPT_LIVE_BACKEND_MODEL).toBe("gpt-6-luna");
    expect(delegation.responses.reasoning).toEqual({ effort: "low" });
  });

  it("gives the backend the same nine tools as Realtime, flat", () => {
    const tools = delegation.responses.tools;
    expect(tools).toEqual(liveTools());
    expect(tools).toHaveLength(9);
    expect(tools.map((t) => t.name)).toContain("show_passage");
    for (const t of tools) {
      expect(t.type).toBe("function");
      expect(t).not.toHaveProperty("function");
    }
  });

  it("configures nothing GPT-Live does not have", () => {
    /* No noise reduction, turn detection or transcription settings exist on
       this API. A Realtime field carried over would be an unknown parameter. */
    expect(session).not.toHaveProperty("type");
    expect(session).not.toHaveProperty("tools");
    expect(JSON.stringify(session.audio)).not.toMatch(/noise_reduction|turn_detection|transcription/);
  });

  it("allows exactly the data-channel events the plan lists", () => {
    expect(session.client).toEqual({ data_channel: GPT_LIVE_DATA_CHANNEL });
    expect([...GPT_LIVE_DATA_CHANNEL.allowed_client_events]).toEqual([
      "response.item.create",
      "response.create",
      "session.close",
    ]);
    const server = GPT_LIVE_DATA_CHANNEL.allowed_server_events.map((e) =>
      "response_event" in e ? `nested:${e.response_event}` : e.type,
    );
    expect([...server].sort()).toEqual(
      [
        "session.started",
        "session.closed",
        "session.input_transcript.delta",
        "session.output_transcript.delta",
        "session.delegation.created",
        "session.usage.updated",
        "error",
        "nested:response.created",
        "nested:response.output_item.done",
        "nested:response.completed",
        "nested:response.failed",
        "nested:response.incomplete",
        "nested:error",
      ].sort(),
    );
    /* Every nested one is spelled the way the API takes it. */
    for (const e of GPT_LIVE_DATA_CHANNEL.allowed_server_events) {
      if ("response_event" in e) expect(e.type).toBe("response.event");
    }
  });
});

/* ------------------------------------------------- the two prompts -- */

describe("the voice instructions", () => {
  const text = gptLiveVoiceInstructions({ meta, blocks, tree: tree(3, 2, 8), profile: "A nurse." });

  it("has the sections, the title, the author, the outline and the profile", () => {
    for (const heading of [
      "# Personality",
      "# How to talk",
      "# Backchannel policy",
      "# Interruption policy",
      "# Delegation policy",
      "# The article",
      "# Who you are talking to",
    ]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain("TITLE: A Piece");
    expect(text).toContain("BY: Someone");
    expect(text).toContain("- Part 0 title: Part 0 says");
    expect(text).toContain("  - Section 2.1 title: Section 2.1 says");
    expect(text).toContain("A nurse.");
    expect(text).toContain("PLAIN WORDS");
  });

  it("carries the two lines the plan says carry the weight, and the audio rules", () => {
    expect(text).toMatch(/Delegate before giving any answer that depends on the article, and never guess\s+the result while you wait/);
    expect(text).toMatch(/Do not fill silence for the sake of\s+it/);
    expect(text).toMatch(/ask in a few words for them to say it again/);
    expect(text).toMatch(/Speak English, unless the reader is clearly talking to you in another\s+language/);
    expect(text).toMatch(/Never say a block id aloud/);
  });

  it("does not hold the article — not one block of it, and no leaf label", () => {
    /* The split is the design: the voice gets the map, the backend the text.
       A block's prose in here would be an invitation to answer from it. */
    expect(text).not.toContain("The rainstorm does not compute.");
    expect(text).not.toContain("spya-b00001");
    expect(text).not.toContain("LEAFLABEL");
    expect(text).not.toContain("Leaf 0.0");
  });

  it("leaves the profile out when there is none", () => {
    const bare = gptLiveVoiceInstructions({ meta, blocks, tree: tree(1, 0, 3) });
    expect(bare).not.toContain("# Who you are talking to");
  });

  it("stays under the cap for a 60,000-token article, and cuts the outline, never the rules", () => {
    /* Forty parts of twelve sections, each with a sixty-word summary: an
       outline of about 30,000 words on its own, far past the cap. */
    const big = tree(40, 12, 60);
    const long = Array.from({ length: 1200 }, (_, i) => block(i + 1, `Paragraph ${i} ${"lorem ipsum dolor sit amet ".repeat(8)}`));
    const huge = gptLiveVoiceInstructions({ meta, blocks: long, tree: big, profile: "x ".repeat(20_000) });

    expect(pessimisticTokens(huge)).toBeLessThanOrEqual(VOICE_INSTRUCTION_BUDGET);
    expect(VOICE_INSTRUCTION_BUDGET).toBeLessThan(GPT_LIVE_INSTRUCTION_TOKEN_CAP);
    /* By the roughest count there is, too: three characters a token. */
    expect(huge.length / 3).toBeLessThan(GPT_LIVE_INSTRUCTION_TOKEN_CAP);

    /* Every rule is still there, whole. */
    expect(huge).toContain(GPT_LIVE_VOICE_SYSTEM);
    /* And the outline is a whole view of the piece, not its first third: the
       last part is named. */
    expect(huge).toContain("- Part 0 title");
    expect(huge).toContain("- Part 39 title");
  });

  it("counts a non-Latin character as more than a token, so the budget holds for any script", () => {
    expect(pessimisticTokens("abc")).toBe(1);
    expect(pessimisticTokens("漢字")).toBe(3);
    const cjk = tree(40, 12, 0);
    for (const n of Object.values(cjk.nodes)) n.gist = "漢".repeat(300);
    const text2 = gptLiveVoiceInstructions({ meta, blocks, tree: cjk });
    expect(pessimisticTokens(text2)).toBeLessThanOrEqual(VOICE_INSTRUCTION_BUDGET);
  });
});

describe("the outline", () => {
  it("drops depth before it drops detail, and detail before it drops parts", () => {
    const t = tree(4, 3, 10);
    const all = gptLiveOutline({ tree: t, blocks, budget: 10_000 });
    expect(all).toContain("  - Section 3.2 title: Section 3.2 says");

    const shallow = gptLiveOutline({ tree: t, blocks, budget: 150 });
    expect(shallow).not.toContain("Section");
    expect(shallow).toContain("- Part 3 title: Part 3 says");

    const titles = gptLiveOutline({ tree: t, blocks, budget: 30 });
    expect(titles).toBe("- Part 0 title\n- Part 1 title\n- Part 2 title\n- Part 3 title");

    /* Twelve parts whose titles alone are about sixty tokens. */
    const cut = gptLiveOutline({ tree: tree(12, 0, 10), blocks, budget: 40 });
    expect(cut).toContain("- Part 0 title");
    expect(cut).not.toContain("- Part 11 title");
    expect(cut.endsWith("this list stops here)")).toBe(true);
    expect(pessimisticTokens(cut)).toBeLessThanOrEqual(40);

    /* And no room at all is no outline, not a broken one. */
    expect(gptLiveOutline({ tree: t, blocks, budget: 5 })).toBe("");
  });

  it("falls back to the author's headings, then to nothing", () => {
    const bare = tree(0, 0, 0);
    const headed = [...blocks, { ...block(3, "Why rain matters"), level: 2 } as Block];
    expect(gptLiveOutline({ tree: bare, blocks: headed, budget: 1000 })).toBe("- Why rain matters");
    expect(gptLiveOutline({ tree: bare, blocks, budget: 1000 })).toBe("");
  });
});

describe("the backend instructions", () => {
  const long = Array.from({ length: 1200 }, (_, i) => block(i + 1, `Paragraph ${i} ${"lorem ipsum dolor sit amet ".repeat(8)}`));
  const text = gptLiveBackendInstructions({ meta, blocks: long, profile: "A nurse." });

  it("contains the whole of a 60,000-token article, with every block id", () => {
    expect(text.length / 4).toBeGreaterThan(60_000);
    for (const b of long) expect(text).toContain(`${b.id}: ${b.text}`);
  });

  it("puts the article last, after the rules and the profile", () => {
    const article = text.indexOf("THE ARTICLE");
    expect(article).toBeGreaterThan(text.indexOf("TOOL RESULTS ARE EVIDENCE"));
    expect(article).toBeGreaterThan(text.indexOf("A nurse."));
    expect(text.slice(article)).toContain(long[0]?.id ?? "missing");
    expect(text.endsWith(long.at(-1)?.text ?? "missing")).toBe(true);
  });

  it("asks for a short spoken answer, no ids in it, and show_passage for the evidence", () => {
    expect(text).toMatch(/One to three short sentences, written to be spoken aloud/);
    expect(text).toMatch(/No block ids, no markdown, no lists, no web addresses/);
    expect(text).toMatch(/call show_passage with\s+the block ids that support it/);
    expect(text).toMatch(/If the article does not say, say so/);
    expect(text).toContain("PLAIN WORDS");
  });

  it("carries the same untrusted-results rule Realtime's prompt does, word for word", () => {
    expect(GPT_LIVE_BACKEND_SYSTEM).toContain(UNTRUSTED_TOOL_RESULTS);
    expect(LIVE_SYSTEM).toContain(UNTRUSTED_TOOL_RESULTS);
    expect(UNTRUSTED_TOOL_RESULTS).toContain("<<<UNTRUSTED");
  });
});

/* ---------------------------------------------------------- the seed -- */

describe("the seeded history", () => {
  it("is in GPT-Live's message shape, oldest first", () => {
    const seed = gptLiveSeedInput(conversation(2, (i) => `Answer ${i}.`));
    expect(seed).toEqual([
      { role: "user", content: [{ type: "input_text", text: "Question 0?" }] },
      { role: "assistant", content: [{ type: "output_text", text: "Answer 0." }] },
      { role: "user", content: [{ type: "input_text", text: "Question 1?" }] },
      { role: "assistant", content: [{ type: "output_text", text: "Answer 1." }] },
    ]);
  });

  it("never carries a block id in the assistant's words", () => {
    const seed = gptLiveSeedInput(
      conversation(3, (i) => `He says so [spya-k3m9qt] and again spya-p7w2dn, answer ${i}.`),
    );
    const said = seed.filter((m) => m.role === "assistant").map((m) => m.content[0].text);
    expect(said).toHaveLength(3);
    for (const text of said) expect(text).not.toMatch(/spya-/);
  });

  it("drops the oldest first to stay inside the token budget, and keeps the newest", () => {
    /* Twenty turns of long answers: far more than fits. */
    const seed = gptLiveSeedInput(conversation(20, (i) => `Answer ${i}. ${"word ".repeat(700)}`));
    const total = seed.reduce((n, m) => n + pessimisticTokens(m.content[0].text), 0);
    expect(total).toBeLessThanOrEqual(SEED_TOKEN_BUDGET);
    expect(SEED_TOKEN_BUDGET).toBeLessThan(GPT_LIVE_SEED_TOKEN_CAP);
    expect(seed.length).toBeGreaterThan(0);
    expect(seed.length).toBeLessThan(40);
    expect(seed.at(-1)?.content[0].text).toMatch(/^Answer 19\./);
    /* Contiguous: what is kept is the newest run, with no hole in it. */
    const kept = seed.map((m) => m.content[0].text.slice(0, 12));
    expect(kept.some((t) => t.startsWith("Answer 0."))).toBe(false);
  });

  it("shortens one over-long message rather than dropping the whole conversation", () => {
    const seed = gptLiveSeedInput([
      msg({ id: "spya-q00001", text: "Short question?" }),
      msg({ id: "spya-a00001", role: "assistant", text: "word ".repeat(20_000) }),
    ]);
    expect(seed).toHaveLength(2);
    expect(seed[1]?.content[0].text.endsWith("…")).toBe(true);
    expect(pessimisticTokens(seed[1]?.content[0].text ?? "")).toBeLessThanOrEqual(1200);
  });

  it("stays inside the message cap, and skips an empty message", () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `m${i}`,
    }));
    const seed = trimSeed(many);
    expect(seed.length).toBeLessThan(GPT_LIVE_SEED_MESSAGE_CAP);
    expect(seed.at(-1)?.content[0].text).toBe("m299");

    expect(trimSeed([{ role: "user", text: "  " }, { role: "assistant", text: "Hello." }])).toEqual([
      { role: "assistant", content: [{ type: "output_text", text: "Hello." }] },
    ]);
  });
});

/* --------------------------------------------------------- the create -- */

describe("createGptLiveSession", () => {
  const session = { model: GPT_LIVE_MODEL };

  function answering(status: number, body: unknown): typeof fetch {
    return vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
      json: async () => body,
    })) as unknown as typeof fetch;
  }

  it("posts the session and the SDP offer to the Live endpoint, and returns the answer", async () => {
    const real = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-key";
    try {
      const fetchImpl = answering(201, { session: { id: "live_abc" }, transport: { type: "webrtc", sdp: "v=0 answer" } });
      const out = await createGptLiveSession({ sdp: "v=0 offer", session }, fetchImpl);
      expect(out).toEqual({ providerSessionId: "live_abc", sdp: "v=0 answer" });

      const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0] ?? [];
      expect(url).toBe("https://api.openai.com/v1/live/sessions");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBe("Bearer sk-test-key");
      expect(JSON.parse(String(init?.body))).toEqual({
        session,
        transport: { type: "webrtc", sdp: "v=0 offer" },
      });
    } finally {
      if (real === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = real;
    }
  });

  it("turns a refusal into a typed error with the status and OpenAI's sentence, and never the key", async () => {
    const real = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-key";
    try {
      const fetchImpl = answering(400, { error: { message: "instructions is too long (17000 tokens)" } });
      const err = await createGptLiveSession({ sdp: "v=0", session }, fetchImpl).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(GptLiveCreateFailed);
      const failed = err as GptLiveCreateFailed;
      expect(failed.upstreamStatus).toBe(400);
      expect(failed.upstreamMessage).toBe("instructions is too long (17000 tokens)");
      /* Not `status`: the dispatcher answers with an error's `status`, and
         OpenAI's 400 is not a 400 from us. */
      expect(failed).not.toHaveProperty("status");
      expect(`${failed.message} ${failed.upstreamMessage}`).not.toContain("sk-test-key");

      /* What the reader is told is the mint's sentence; OpenAI's is kept for
         the log and does not end the diagnostic. */
      const reader = gptLiveCreateFailure(failed);
      expect(readerFailureOf(reader, "live")).toEqual(LIVE_UPSTREAM);
      expect(reader.message).toContain("instructions is too long");
      expect(reader.message.endsWith("(end of OpenAI's words).")).toBe(true);
    } finally {
      if (real === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = real;
    }
  });

  it("keeps a body that is not JSON, bounded", async () => {
    const real = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-key";
    try {
      const err = (await createGptLiveSession(
        { sdp: "v=0", session },
        answering(502, "x".repeat(5000)),
      ).catch((e: unknown) => e)) as GptLiveCreateFailed;
      expect(err.upstreamStatus).toBe(502);
      expect(err.upstreamMessage).toHaveLength(400);
    } finally {
      if (real === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = real;
    }
  });

  it("refuses a 201 with no session id or no SDP in it", async () => {
    const real = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-key";
    try {
      await expect(
        createGptLiveSession({ sdp: "v=0", session }, answering(201, { transport: { sdp: "a" } })),
      ).rejects.toBeInstanceOf(GptLiveCreateFailed);
      await expect(
        createGptLiveSession({ sdp: "v=0", session }, answering(201, { session: { id: "live_a" } })),
      ).rejects.toBeInstanceOf(GptLiveCreateFailed);
    } finally {
      if (real === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = real;
    }
  });

  it("says so, and asks nobody, when there is no key", async () => {
    const real = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const fetchImpl = answering(201, {});
      await expect(createGptLiveSession({ sdp: "v=0", session }, fetchImpl)).rejects.toThrow(
        /\[live-not-set-up\]/,
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (real !== undefined) process.env.OPENAI_API_KEY = real;
    }
  });
});
