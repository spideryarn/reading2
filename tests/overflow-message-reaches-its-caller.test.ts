/**
 * **Which of the two overflow sentences each public caller actually gets.**
 *
 * `ANSWER_OVERFLOWED` carries the narrowing advice and goes to Search alone,
 * because Search's reader typed the ask; `ANSWER_OVERFLOWED_FIXED_ASK` is the
 * retry and nothing else, and is what Criteria, Claims and Mirror get, none of
 * which draws a scoping control. The split, and why it is two codes rather than
 * one, is src/messages.ts § `ANSWER_OVERFLOWED`; the parameter that chooses is
 * `AskKind` in src/search.ts.
 *
 * **Why this file exists rather than another case in tests/search.test.ts.** The
 * split was already tested by calling `parseHits` directly with each `ask`
 * value, and that test proves the parser branches — it does not prove any
 * particular screen reaches the branch it was written for. Deleting
 * `"editable"` at the one call site in `runSearch`, or adding it to a Referee
 * caller, left the whole suite green, which is precisely the regression the
 * split exists to prevent. Found by a cross-family review, 2026-09-02
 * (docs/plans/260902f-make-referee-mode-understandable-stage5-review-sol.md,
 * finding 1).
 *
 * So each of the four **public entry points** is driven end to end here, over
 * stubbed SSE frames, and asserted on the exact sentence and the exact code a
 * reader would see. One file rather than four cases spread across four run
 * files, because the property under test is the contrast between the callers
 * and it is only legible with all four side by side.
 *
 * Every case sends the same failure: an object that opens and never closes,
 * with `finish_reason: "length"` and a clean `[DONE]`, which is exactly what
 * hitting the token ceiling looks like from here. Nothing about the connection
 * is broken, so the only thing that can produce a message is the strict final
 * parse.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ANSWER_OVERFLOWED, ANSWER_OVERFLOWED_FIXED_ASK } from "../src/messages.js";
import { findPassagesStream, parseHits } from "../src/search.js";
import { runCriterionStream } from "../src/referee-criteria-run.js";
import { runClaimsStream } from "../src/referee-claims-run.js";
import { mirrorStream } from "../src/referee-mirror.js";
import type { RefereeCriterionConfig } from "../src/referee-criteria.js";
import type { Block, BlockId, Comment, Meta } from "../src/types.js";

const meta = {
  title: "Controls in the wild",
  byline: "Ada Lovelace",
  siteName: "Nature",
  url: "https://example.com/paper",
} as Meta;

const METHODS = "Participants were randomised by a computer-generated sequence held off site.";
const RESULTS = "The effect was 0.3 points and did not reach significance in the primary analysis.";

const block = (id: string, text: string): Block => ({
  id: id as BlockId,
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/).length,
  html: `<p>${text}</p>`,
  gistable: true,
});

const BLOCKS: Block[] = [block("spya-k3m9qt", METHODS), block("spya-p7w2dn", RESULTS)];

const SINGLE: RefereeCriterionConfig = { kind: "single" };

/** One comment, so Mirror has something to read and reaches the model at all. */
const COMMENT: Comment = {
  id: "spya-c00001",
  blockId: "spya-k3m9qt" as BlockId,
  quote: "randomised",
  start: METHODS.indexOf("randomised"),
  createdAt: "2026-09-02T00:00:00.000Z",
  status: "none",
  body: "This does not say who held the sequence.",
};

/** One SSE frame, exactly as OpenRouter writes them. */
const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

/** A response whose body is the given SSE text, split so a `data:` line lands
    across two reads — the same awkwardness tests/search-stream.test.ts uses. */
function sse(raw: string, splitAt = 7): Response {
  const bytes = new TextEncoder().encode(raw);
  const parts = [bytes.slice(0, splitAt), bytes.slice(splitAt)].filter((p) => p.length > 0);
  let i = 0;
  return {
    ok: true,
    headers: new Headers(),
    body: new ReadableStream<Uint8Array>({
      pull(c) {
        if (i < parts.length) c.enqueue(parts[i++] as Uint8Array);
        else c.close();
      },
    }),
  } as unknown as Response;
}

/**
 * An answer cut off by the ceiling: the outer object opens, one complete item
 * closes inside it, and then the text stops mid-item.
 *
 * The complete first item matters — it is what makes `objectEnd`'s job real
 * rather than trivial, and the shape that used to be misreported as
 * `[ai-unreadable]` (src/search.ts § `parseHits`). `key` is the top-level name
 * each caller's prompt asks for; `parseHits` does not read it, which is why one
 * parser serves all four, but sending the wrong one would make these mocks a
 * shape the server never sends.
 */
function cutOff(key: string, first: unknown): Response {
  const partial = `{"${key}":[${JSON.stringify(first)},{"blockId":"spya-p7`;
  return sse(
    frame({
      model: "anthropic/claude-sonnet-4.5",
      choices: [{ delta: { content: partial } }],
    }) +
      frame({ choices: [{ finish_reason: "length", delta: {} }] }) +
      "data: [DONE]\n\n",
  );
}

/** Drive a generator to exhaustion and hand back whatever it threw. */
async function thrownBy(events: AsyncGenerator<unknown>): Promise<Error | undefined> {
  try {
    for await (const _ of events) {
      /* Previews are allowed and irrelevant here: what is under test is the
         message the run ends with, and a preview never becomes an answer. */
    }
  } catch (err) {
    return err as Error;
  }
  return undefined;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("the overflow message each public caller gets", () => {
  it("gives Search the narrowing advice, because Search's reader typed the ask", async () => {
    fetchMock.mockResolvedValue(
      cutOff("hits", {
        blockId: "spya-k3m9qt",
        quote: "randomised",
        confidence: 90,
        reasoning: "r1",
      }),
    );
    const thrown = await thrownBy(
      findPassagesStream({ meta, blocks: BLOCKS, criterion: "how were people assigned?" }),
    );
    /* The exact sentence, not merely that something was thrown: the test this
       replaces asserted `toBeDefined()`, and every failure in this module is
       defined. */
    expect(thrown?.message).toBe(ANSWER_OVERFLOWED.message);
    expect(thrown?.message).toMatch(/narrower/);
    expect(thrown?.message).toMatch(/\[ai-overflowed\]$/);
  });

  it("gives a criterion run the retry alone — its words are a saved row, not a box on this screen", async () => {
    fetchMock.mockResolvedValue(
      cutOff("results", {
        blockId: "spya-k3m9qt",
        quote: "randomised",
        confidence: 80,
        reasoning: "r1",
      }),
    );
    const thrown = await thrownBy(
      runCriterionStream({
        meta,
        blocks: BLOCKS,
        criterion: "Are the controls adequate?",
        config: SINGLE,
      }),
    );
    expect(thrown?.message).toBe(ANSWER_OVERFLOWED_FIXED_ASK.message);
    /* The half of the assertion that catches the mutation: an `"editable"` added
       at this call site changes only the second sentence, and the two messages
       are otherwise word for word the same. */
    expect(thrown?.message).not.toMatch(/narrow/);
    expect(thrown?.message).toMatch(/\[ai-overflowed-no-ask\]$/);
  });

  it("gives a claims pull the retry alone — it pulls the paper's own claims and has nothing to scope", async () => {
    fetchMock.mockResolvedValue(
      cutOff("claims", {
        blockId: "spya-k3m9qt",
        quote: "randomised",
        claim: "Assignment was concealed",
        passages: [],
      }),
    );
    const thrown = await thrownBy(runClaimsStream({ meta, blocks: BLOCKS }));
    expect(thrown?.message).toBe(ANSWER_OVERFLOWED_FIXED_ASK.message);
    expect(thrown?.message).not.toMatch(/narrow/);
    expect(thrown?.message).toMatch(/\[ai-overflowed-no-ask\]$/);
  });

  it("gives a Mirror run the retry alone — it reads the referee's comments and has nothing to scope", async () => {
    fetchMock.mockResolvedValue(
      cutOff("remarks", { kind: "vague", commentId: "spya-c00001", note: "n" }),
    );
    const thrown = await thrownBy(mirrorStream({ blocks: BLOCKS, comments: [COMMENT] }));
    expect(thrown?.message).toBe(ANSWER_OVERFLOWED_FIXED_ASK.message);
    expect(thrown?.message).not.toMatch(/narrow/);
    expect(thrown?.message).toMatch(/\[ai-overflowed-no-ask\]$/);
  });

});

/* --------------------------------------------------- the parser underneath -- */

/**
 * The unit the four cases above exercise, and the two sentences themselves.
 *
 * **Moved here from tests/referee-tooltips.test.tsx**, which is about tooltips,
 * on 2026-09-02. Nothing in it changed except its address: what it always
 * checked is the parser's branch and the shape of the two messages, and the
 * cases above are what turn that into evidence about a screen.
 *
 * **The first fix conditioned the clause and that was not enough**, which the
 * same review showed: it read *"where you asked a question of your own"*, and a
 * criterion **is** the referee's own question, so the condition reads as
 * satisfied on the one screen it was written to exclude. The old test greped for
 * `where you|if you|when you` and blessed exactly that. So the message split,
 * `MARK_CUT_OFF`'s shape — one diagnosis, a caller who cannot take the advice,
 * its own code, because tests/messages.test.ts refuses two sentences under one
 * code and is right to.
 */
describe("the two sentences, and which one a caller gets by saying nothing", () => {
  it("offers the referee's three callers the one lever their screens have", () => {
    const message = ANSWER_OVERFLOWED_FIXED_ASK.message.toLowerCase();
    expect(message, "the retry is not offered, and it is the only lever Claims has").toMatch(
      /trying again/,
    );
    /* No conditional clause either: a criterion **is** the referee's own
       question, so any wording hung on "you asked" reads as available here. That
       is the mistake the first fix made, and the test that blessed it greped for
       exactly those words. */
    expect(message, "narrowing is back on the message three screens cannot act on").not.toMatch(
      /narrow/,
    );
    expect(
      ANSWER_OVERFLOWED_FIXED_ASK.message,
      "the code a reader quotes has gone, or gone back to Search's",
    ).toMatch(/\[ai-overflowed-no-ask\]$/);
  });

  it("keeps the narrowing advice for Search, which is the caller that can act on it", () => {
    const search = ANSWER_OVERFLOWED.message.toLowerCase();
    expect(search, "Search lost the lever only Search has").toMatch(/narrower/);
    expect(search, "Search lost the retry").toMatch(/trying again/);
    expect(ANSWER_OVERFLOWED.message, "Search's already-quoted code changed").toMatch(
      /\[ai-overflowed\]$/,
    );
    expect(
      ANSWER_OVERFLOWED_FIXED_ASK.message,
      "the split collapsed and all four callers are getting one sentence again",
    ).not.toBe(ANSWER_OVERFLOWED.message);
  });

  /**
   * **The default is the one that promises least**, so a sub-mode added later
   * cannot inherit advice about a control it does not have. Only Search opts in,
   * and it is the only caller of `parseHits` that passes anything.
   */
  it("gives a caller that says nothing the message with no narrowing in it", () => {
    const truncated = '{"hits":[{"blockId":"spya-k3m9qt","quo';
    expect(() => parseHits(truncated)).toThrow(ANSWER_OVERFLOWED_FIXED_ASK.message);
    expect(() => parseHits(truncated, "editable")).toThrow(ANSWER_OVERFLOWED.message);
  });
});
