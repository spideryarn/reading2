/**
 * **The guide's offer reaches the stored run** — plan
 * docs/plans/261009q-the-guide-offers-to-save-your-reason-and-about-you-in-your-words.md.
 *
 * Through `converse` itself, with `fetch` stubbed: the model asks for
 * `offer_to_save`, then answers. The finished `tool` frame and the `done`
 * event's runs must carry the offer, since that is what the page draws the
 * card from and what the route stores.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { converse } from "../src/converse.js";
import type { Block, Meta, ToolRun } from "../src/types.js";

const meta = { title: "A piece", url: "https://example.com/a" } as Meta;
const blocks = [{ id: "spya-k3m9qt", html: "<p>alpha</p>", text: "alpha" }] as Block[];

const frame = (body: unknown) => `data: ${JSON.stringify(body)}\n\n`;

function body(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const f of frames) c.enqueue(encoder.encode(f));
      c.enqueue(encoder.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a guide turn that offers to save", () => {
  it("puts the offer on the finished run, live and in the done event", async () => {
    const rounds = [
      [
        frame({
          model: "test/model",
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "toolu_0",
                    type: "function",
                    function: {
                      name: "offer_to_save",
                      arguments: JSON.stringify({ field: "reason", text: "For journal club next week." }),
                    },
                  },
                ],
              },
            },
          ],
        }),
        frame({ choices: [{ finish_reason: "tool_calls", delta: {} }] }),
      ],
      [
        frame({ model: "test/model", choices: [{ delta: { content: "Start with the abstract." } }] }),
        frame({ choices: [{ finish_reason: "stop", delta: {} }] }),
      ],
    ];
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, headers: new Headers(), body: body(rounds[call++] ?? []) }) as Response),
    );

    const finished: ToolRun[] = [];
    let done: { tools?: ToolRun[] } | undefined;
    for await (const event of converse({
      power: "standard",
      meta,
      blocks,
      history: [],
      question: "I'm reading it for journal club next week.",
      slug: "example",
      kind: "guide",
      saved: { purpose: null, profile: null },
    })) {
      if (event.type === "tool" && event.run.status === "done") finished.push(event.run);
      if (event.type === "done") done = event as { tools?: ToolRun[] };
    }

    const offer = { field: "purpose", text: "For journal club next week.", basis: null };
    expect(finished).toHaveLength(1);
    expect(finished[0]?.offer).toEqual(offer);
    expect(done?.tools?.[0]?.offer).toEqual(offer);
    expect(done?.tools?.[0]?.label).toBe("offered to save why you're reading");
  });

  /* The browser pass: round one's "…mattered?" met round two's "You can…" as
     "mattered?You can…". */
  it("starts a later round's words on a new paragraph, in the deltas and the stored text alike", async () => {
    const call = frame({
      model: "test/model",
      choices: [
        {
          delta: {
            content: "Start with the abstract. What does your club want?",
            tool_calls: [
              {
                index: 0,
                id: "toolu_0",
                type: "function",
                function: { name: "offer_to_save", arguments: JSON.stringify({ field: "reason", text: "For journal club." }) },
              },
            ],
          },
        },
      ],
    });
    const rounds = [
      [call, frame({ choices: [{ finish_reason: "tool_calls", delta: {} }] })],
      [
        frame({ model: "test/model", choices: [{ delta: { content: "You can save it with the button." } }] }),
        frame({ choices: [{ finish_reason: "stop", delta: {} }] }),
      ],
    ];
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, headers: new Headers(), body: body(rounds[n++] ?? []) }) as Response),
    );
    let streamed = "";
    let stored = "";
    for await (const event of converse({
      power: "standard",
      meta,
      blocks,
      history: [],
      question: "For journal club.",
      slug: "example",
      kind: "guide",
      saved: { purpose: null, profile: null },
    })) {
      if (event.type === "delta") streamed += event.text;
      if (event.type === "done") stored = event.text;
    }
    expect(stored).toBe("Start with the abstract. What does your club want?\n\nYou can save it with the button.");
    expect(streamed).toBe(stored);
  });

  it("replays a later tool-calling round to the model without the display separator", async () => {
    const asks = (id: string, content: string) => [
      frame({
        model: "test/model",
        choices: [
          {
            delta: {
              content,
              tool_calls: [
                {
                  index: 0,
                  id,
                  type: "function",
                  function: { name: "search_article_words", arguments: JSON.stringify({ query: "alpha" }) },
                },
              ],
            },
          },
        ],
      }),
      frame({ choices: [{ finish_reason: "tool_calls", delta: {} }] }),
    ];
    const rounds = [
      asks("toolu_0", "First round."),
      asks("toolu_1", "Second round."),
      [
        frame({ model: "test/model", choices: [{ delta: { content: "Final round." } }] }),
        frame({ choices: [{ finish_reason: "stop", delta: {} }] }),
      ],
    ];
    const sent: { messages: { role: string; content: unknown; tool_calls?: unknown[] }[] }[] = [];
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sent.push(JSON.parse(init.body as string));
        return { ok: true, status: 200, headers: new Headers(), body: body(rounds[n++] ?? []) } as Response;
      }),
    );

    for await (const _event of converse({
      power: "standard",
      meta,
      blocks,
      history: [],
      question: "Find alpha.",
      slug: "example",
      kind: "guide",
      saved: { purpose: null, profile: null },
    })) {
      // drained
    }

    const replayed = sent[2]?.messages.filter((message) => message.role === "assistant" && message.tool_calls);
    expect(replayed?.map((message) => message.content)).toEqual(["First round.", "Second round."]);
  });
});
