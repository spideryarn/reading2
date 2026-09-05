/**
 * **The "?" answer teaches, and it costs nothing above the cache breakpoint.**
 *
 * Report 1S: *"When I click the question-mark-comment in vertical gutter, it
 * should explain in easy-to-understand language, starting with brief summary,
 * and drawing on pedagogical techniques, e.g. worked example, analogy, etc"*.
 *
 * The instruction that buys that rides in the **final user message**, between
 * the anchor line and the stance line, and nowhere else. Everything above the
 * `cache_control` breakpoint — the system prompt, the article block, the canned
 * assistant line — has to stay byte-identical or the whole article is written
 * to the cache again on every help turn, which is the bug
 * docs/postmortems/260826h-chat-cache-automatic-breakpoint.md cost us once
 * already.
 *
 * GPT Sol named the assertion that pins it, and it is the first `describe`
 * below:
 *
 * > cachedText(helpMessages) === cachedText(ordinaryMessages)
 *
 * **A byte test proves placement, not pedagogy.** Whether the wording actually
 * produces a better explanation is a live check on a real article, named in the
 * plan's § What is left for Greg. What this file can prove is that the
 * instruction is there, that it is the only difference, and that it says nothing
 * about *where the answer comes from* — which is deliberate, and is the one
 * place 1S and 1X pull against each other: `SYSTEM` owns the encouragement to
 * search, and a second weaker copy of it here that only fires on help turns is
 * how the first one stops meaning anything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildConverseMessages, converse } from "../src/converse.js";
import type { Block, ChatMessage, Meta } from "../src/types.js";

const block = (id: string, text: string): Block => ({
  id,
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/).length,
  html: `<p>${text}</p>`,
  gistable: true,
});

const blocks: Block[] = [
  block("spya-k3m9qt", "Phrenology was a science of bumps, and it was wrong."),
  block("spya-p7w2dn", "The measurement was real; the inference was not."),
];

const meta = { title: "A piece", byline: "Somebody" } as unknown as Meta;

/** One SSE frame, exactly as OpenRouter writes them. */
const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

/** A finished stream: the frames, then the terminator. */
function streamOf(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

const base = {
  meta,
  blocks,
  history: [] as ChatMessage[],
  question: "About block spya-k3m9qt: I could not follow this.",
  anchor: { blockId: "spya-k3m9qt" },
};

const ordinary = () => buildConverseMessages(base);
const help = () => buildConverseMessages({ ...base, help: true });

/**
 * Everything at or above the `cache_control` breakpoint, as one string.
 *
 * The system message and the article message are the two blocks the prefix is
 * made of; the tool definitions render ahead of both and are compared
 * separately, in the second `describe`.
 */
function cachedText(messages: ReturnType<typeof buildConverseMessages>): string {
  return JSON.stringify(messages.slice(0, 3));
}

/** The message the question rides in — the last one, always. */
const finalUser = (messages: ReturnType<typeof buildConverseMessages>) =>
  String(messages.at(-1)?.content ?? "");

describe("nothing above the breakpoint moves", () => {
  it("sends a byte-identical cached prefix for a help turn and an ordinary one", () => {
    expect(cachedText(help())).toBe(cachedText(ordinary()));
  });

  it("differs in the final user message and in nothing else", () => {
    const h = help();
    const o = ordinary();
    expect(h).toHaveLength(o.length);
    for (let i = 0; i < h.length - 1; i += 1) {
      expect(h[i], `message ${i} differs between a help turn and an ordinary one`).toEqual(o[i]);
    }
    expect(finalUser(h)).not.toBe(finalUser(o));
  });
});

describe("what the addendum says", () => {
  it("tells the model the reader pressed '?' rather than typing", () => {
    expect(finalUser(help())).toContain('The reader pressed the "?" beside this passage');
  });

  it("asks for the plain orientation, the missing prerequisite and one analogy", () => {
    const text = finalUser(help());
    expect(text).toContain("one or two plain sentences on what this passage is doing");
    expect(text).toContain("the term of art, the named person, the study");
    expect(text).toContain("one analogy or one small worked example");
    expect(text).toContain("Send them back into the paragraph better equipped to read it");
  });

  it("sits between the anchor line and the question", () => {
    const text = finalUser(help());
    const anchorAt = text.indexOf("This conversation is about block spya-k3m9qt");
    const helpAt = text.indexOf('The reader pressed the "?"');
    const questionAt = text.indexOf(base.question);
    expect(anchorAt).toBeGreaterThanOrEqual(0);
    expect(helpAt).toBeGreaterThan(anchorAt);
    expect(questionAt).toBeGreaterThan(helpAt);
  });

  /* The one place 1S and 1X pull against each other, pinned so a later edit has
     to argue with it. `SYSTEM` owns *"USE web search unless you are genuinely
     sure"*; a second, weaker copy of that rule here would fire only on help
     turns and would drift from the first one, and the drift is invisible.
     docs/plans/260905c-… § The one place 1S and 1X pull against each other. */
  it("says nothing at all about where the answer comes from", () => {
    const text = finalUser(help());
    for (const word of ["search", "web", "look it up", "tool"]) {
      expect(
        text.toLowerCase().includes(word),
        `the help addendum mentions "${word}" — the system prompt owns that rule, and ` +
          `two copies of it that can drift apart is how the first one stops meaning anything`,
      ).toBe(false);
    }
  });

  it("is absent from an ordinary turn", () => {
    expect(finalUser(ordinary())).not.toContain('The reader pressed the "?"');
  });
});

/**
 * **The same property, on the wire.**
 *
 * `buildConverseMessages` is where the addendum is added, so the assertions
 * above are the ones that would go red if it moved. This block is about the
 * *rest* of the request — the tool definitions in particular, which render at
 * position 0, ahead of system and messages, and whose invalidation takes all
 * three cache tiers with it (docs/research/260826b-prompt-caching-anthropic.md).
 * Nothing in `converse` branches on `help`; that is the claim, and a claim
 * nobody has watched fail is not evidence.
 */
describe("the request body a help turn actually sends", () => {
  const sent: Record<string, unknown>[] = [];

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-key";
    sent.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        sent.push(JSON.parse(init.body as string) as Record<string, unknown>);
        return Promise.resolve({
          ok: true,
          body: streamOf([
            frame({ model: "test/model", choices: [{ delta: { content: "Because." } }] }),
            frame({ choices: [{ finish_reason: "stop", delta: {} }] }),
          ]),
        } as Response);
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  const ask = async (help?: true) => {
    for await (const _ of converse({
      meta,
      blocks,
      history: [],
      question: base.question,
      /* No `anchor` here, and that is not an oversight: `ConverseRequest` has no
         such field. The anchor line is a `buildConverseMessages` option that the
         chat route does not currently pass — noticed 2026-09-05 and left alone,
         because it is a separate question from where `help` goes. */
      slug: "a-piece",
      ...(help ? { help } : {}),
    })) {
      // drained
    }
  };

  it("sends identical tools, system and article blocks either way", async () => {
    await ask(true);
    await ask();
    const [helpBody, plainBody] = sent as [Record<string, unknown>, Record<string, unknown>];
    expect(sent).toHaveLength(2);
    /* Serialised, not compared by identity: two calls build two object graphs
       and `toBe` would fail for a reason that has nothing to do with bytes. */
    expect(JSON.stringify(helpBody.tools)).toBe(JSON.stringify(plainBody.tools));
    const prefix = (b: Record<string, unknown>) =>
      JSON.stringify((b.messages as unknown[]).slice(0, 3));
    expect(prefix(helpBody)).toBe(prefix(plainBody));
  });

  it("differs only in the last message", async () => {
    await ask(true);
    await ask();
    const last = (b: Record<string, unknown>) => JSON.stringify((b.messages as unknown[]).at(-1));
    expect(last(sent[0] as Record<string, unknown>)).not.toBe(
      last(sent[1] as Record<string, unknown>),
    );
  });
});
