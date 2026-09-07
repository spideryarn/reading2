/**
 * **The hidden verdict** — the one call in this feature whose failure must be
 * completely silent.
 *
 * `classifyVerdict` decides whether the reader got a question right, so the
 * adaptive ladder can step. Nobody is ever shown its answer. That makes almost
 * every case here a case about *not* making a fuss: the contract is that a
 * refusal, a timeout, a model that answers in prose, or a reader who navigated
 * away all produce `undefined`, and `undefined` means the ladder holds its band
 * (src/web/quiz-ladder.ts).
 *
 * The reason to test that so heavily is docs/reusable/silent-success.md pointed
 * the other way. Everywhere else in this app a swallowed failure is a bug; here
 * it is the design, and the risk is the opposite one — a `throw` escaping this
 * function would break a mark the reader has already read, over a number they
 * were never going to see.
 *
 * A guess is worse than an absence, too, which is why `parseVerdict` is strict:
 * a wrong guess mis-pitches the next question, an absence merely repeats the
 * level.
 *
 * docs/plans/260907d-make-the-quiz-adaptive.md.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the stubbed gateway does next: an answer, a way to fail, or — for the
 * cancellation cases — nothing at all until its signal fires.
 *
 * **`pending` earns its place.** The first version of this file had a
 * cancellation test that rejected by hand, which meant it stayed green whether
 * or not `classifyVerdict` passed a signal to the gateway at all: it proved the
 * `catch`, and nothing about the abort. GPT Sol's finding 5 on the built code,
 * and it is `docs/reusable/silent-success.md` in its usual clothes — a test
 * that could never have failed for the reason it claims.
 */
let behaviour:
  | { kind: "answer"; content: unknown }
  | { kind: "throw"; err: Error }
  | { kind: "pending" };
const calls: { job: string; body: Record<string, unknown>; signal?: AbortSignal }[] = [];

vi.mock("../src/ai-call.js", () => ({
  openRouterJson: (
    job: string,
    body: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => {
    calls.push({ job, body, ...(options?.signal ? { signal: options.signal } : {}) });
    if (behaviour.kind === "throw") return Promise.reject(behaviour.err);
    if (behaviour.kind === "pending") {
      /* Answers only when the signal the caller handed us fires — the way a
         real aborted fetch does. If no signal was passed, this never settles
         and the test times out, which is the failure we want. */
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    }
    return Promise.resolve({
      json: { choices: [{ message: { content: behaviour.content } }] },
      answeredBy: null,
      generationId: null,
    });
  },
}));

const { classifyVerdict, parseVerdict } = await import("../src/quiz-verdict.js");

const REQ = {
  question: "What does the author say the wash channel carries?",
  answer: "Confidence — how sure the match is.",
  mark: "That tracks the piece [spya-k3m9qt].",
};

beforeEach(() => {
  calls.length = 0;
  behaviour = { kind: "answer", content: "right" };
});

describe("parseVerdict", () => {
  it("reads the two words it asked for", () => {
    expect(parseVerdict("right")).toBe("right");
    expect(parseVerdict("wrong")).toBe("wrong");
  });

  it("forgives the trimmings a model puts round a one-word answer", () => {
    expect(parseVerdict("Right.")).toBe("right");
    expect(parseVerdict("  WRONG\n")).toBe("wrong");
    expect(parseVerdict("`right`")).toBe("right");
  });

  /**
   * `unclear` is a real answer, not a failure: an ill-posed question should not
   * be graded either way, and the eval's `illPosed` case is exactly that. It
   * lands in the same absence as everything else, so the caller has one case to
   * handle rather than two.
   */
  it("treats unclear as absence, like every other non-answer", () => {
    expect(parseVerdict("unclear")).toBeUndefined();
  });

  it("never guesses from prose", () => {
    /* Contains the word "right", and means nothing of the kind. A looser parse
       — a `.includes()`, say — would call this `right` and step the ladder up
       on an answer that was wrong. */
    expect(parseVerdict("The reader is not right about the second half.")).toBeUndefined();
  });

  it("is absence for everything that is not a string", () => {
    expect(parseVerdict(undefined)).toBeUndefined();
    expect(parseVerdict(null)).toBeUndefined();
    expect(parseVerdict(42)).toBeUndefined();
    expect(parseVerdict({ verdict: "right" })).toBeUndefined();
    expect(parseVerdict("")).toBeUndefined();
  });
});

describe("classifyVerdict", () => {
  it("returns the verdict the model gave", async () => {
    behaviour = { kind: "answer", content: "wrong" };
    await expect(classifyVerdict(REQ)).resolves.toBe("wrong");
  });

  it("bills under its own job name, so the mark's cost stays the mark's", async () => {
    await classifyVerdict(REQ);
    expect(calls[0]?.job).toBe("quiz-verdict");
  });

  /**
   * **The article is not sent.** This is why the job can be quick tier, and it
   * is worth an assertion rather than a comment: the day somebody "helpfully"
   * adds the article for context, the cost of every answered question changes
   * and nothing else would say so.
   */
  it("sends only the question, the answer and the mark", async () => {
    await classifyVerdict(REQ);
    const sent = JSON.stringify(calls[0]?.body.messages);
    expect(sent).toContain(REQ.question);
    expect(sent).toContain(REQ.answer);
    expect(sent).toContain(REQ.mark);
    expect(sent.length).toBeLessThan(4000);
  });

  /* The contract, six ways. None of these may reject, and none may guess. */

  it("is absence when the provider refuses", async () => {
    behaviour = { kind: "throw", err: new Error("429") };
    await expect(classifyVerdict(REQ)).resolves.toBeUndefined();
  });

  /**
   * **The reader navigated away**, which takes the mark with it and must take
   * this too — a stream nobody is reading still costs money until somebody
   * cancels it.
   *
   * The gateway stub here settles *only* when the signal it was handed fires,
   * so this case cannot pass unless `classifyVerdict` actually forwards the
   * caller's signal. Delete the `AbortSignal.any` and it hangs.
   */
  it("hands the caller's signal to the gateway, and is absence when it fires", async () => {
    behaviour = { kind: "pending" };
    const stop = new AbortController();
    const result = classifyVerdict({ ...REQ, signal: stop.signal });
    expect(calls[0]?.signal, "no signal reached the gateway").toBeDefined();
    stop.abort();
    await expect(result).resolves.toBeUndefined();
  });

  /**
   * **The deadline is real**, and this is the case that proves it rather than
   * assuming it. Without the timeout leg the promise never settles and vitest
   * fails the test on its own clock — which is the point: what holds `done`,
   * and therefore the answered tick, is this call.
   */
  it("gives up on its own deadline when the provider never answers", async () => {
    vi.useFakeTimers();
    try {
      behaviour = { kind: "pending" };
      const result = classifyVerdict(REQ);
      await vi.advanceTimersByTimeAsync(30_000);
      await expect(result).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("is absence when the model answers with prose", async () => {
    behaviour = { kind: "answer", content: "Well, it depends what you mean by right." };
    await expect(classifyVerdict(REQ)).resolves.toBeUndefined();
  });

  it("is absence when the body is not the shape it should be", async () => {
    behaviour = { kind: "answer", content: undefined };
    await expect(classifyVerdict(REQ)).resolves.toBeUndefined();
  });

  it("does not pay to judge an empty answer", async () => {
    await expect(classifyVerdict({ ...REQ, answer: "   " })).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("does not pay to judge an empty mark", async () => {
    await expect(classifyVerdict({ ...REQ, mark: "" })).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});
