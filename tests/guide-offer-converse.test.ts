/**
 * **The guide's offer reaches the stored run** — plan
 * docs/plans/261009o-the-guide-offers-to-save-your-reason-and-about-you-in-your-words.md.
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
    })) {
      if (event.type === "tool" && event.run.status === "done") finished.push(event.run);
      if (event.type === "done") done = event as { tools?: ToolRun[] };
    }

    const offer = { field: "purpose", text: "For journal club next week." };
    expect(finished).toHaveLength(1);
    expect(finished[0]?.offer).toEqual(offer);
    expect(done?.tools?.[0]?.offer).toEqual(offer);
    expect(done?.tools?.[0]?.label).toBe("offered to save why you're reading");
  });
});
