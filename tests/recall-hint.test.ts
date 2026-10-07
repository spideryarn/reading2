/**
 * **`splitHint` and `answerAsSeen`** — the one place that decides whether a
 * Recall answer's last paragraph is a hint to put behind the Hint button.
 *
 * The rule is "fail open": every shape that is not exactly the contract leaves
 * the text whole, so a deviation shows the hint in plain sight and nothing the
 * model wrote is ever hidden for good.
 * docs/plans/261004h-recall-questions-link-the-passage-and-carry-a-hint-button.md
 */
import { describe, expect, it } from "vitest";
import { answerAsSeen, splitHint } from "../src/recall-hint.js";

const BODY =
  "The piece turns on search and learning [spya-aaaaaa]. Do you remember what he says researchers kept doing instead [spya-bbbbbb]?";
const HINT = "He names two games where the hand-built approach lost [spya-cccccc].";

const whole = (text: string) => ({ body: text, hint: null });

describe("splitHint", () => {
  it("leaves an answer with no hint whole", () => {
    expect(splitHint(BODY)).toEqual(whole(BODY));
    expect(splitHint("")).toEqual(whole(""));
  });

  it("splits a final Hint: paragraph off a body that ends with a question", () => {
    expect(splitHint(`${BODY}\n\nHint: ${HINT}`)).toEqual({ body: BODY, hint: HINT });
  });

  it("splits when the id comes after the question mark, or there is none", () => {
    const after = "Do you remember what comes next? [spya-bbbbbb]";
    expect(splitHint(`${after}\n\nHint: ${HINT}`)).toEqual({ body: after, hint: HINT });
    const bare = "Do you remember what comes next?";
    expect(splitHint(`${bare}\n\nHint: ${HINT}`)).toEqual({ body: bare, hint: HINT });
  });

  it("allows a closing quotation mark or bracket after the question mark", () => {
    for (const body of [
      'He asks "what comes next?"',
      "Do you remember it (or what it was set against?)",
      "Do you remember “what comes next?” [spya-aaaaaa spya-bbbbbb]",
    ]) {
      expect(splitHint(`${body}\n\nHint: ${HINT}`)).toEqual({ body, hint: HINT });
    }
  });

  it("recognises a question through Markdown closing syntax and a full-width question mark", () => {
    for (const body of [
      "**Do you remember what comes next?** [spya-aaaaaa]",
      "[Do you remember what comes next?](https://example.com/passage) [spya-aaaaaa]",
      "次に何が起こったか覚えていますか？ [spya-aaaaaa]",
    ]) {
      expect(splitHint(`${body}\n\nHint: ${HINT}`), body).toEqual({ body, hint: HINT });
    }
  });

  it("splits across CRLF line endings and extra blank lines", () => {
    expect(splitHint(`${BODY}\r\n\r\nHint: ${HINT}`)).toEqual({ body: BODY, hint: HINT });
    expect(splitHint(`${BODY}\n\n\nHint: ${HINT}\n`)).toEqual({ body: BODY, hint: HINT });
  });

  it("keeps a hint that runs over two lines as one hint", () => {
    expect(splitHint(`${BODY}\n\nHint: He names two games\nwhere it lost.`)).toEqual({
      body: BODY,
      hint: "He names two games\nwhere it lost.",
    });
  });

  it("leaves every other spelling of the marker as written", () => {
    for (const marker of ["**Hint:**", "**Hint**:", "Hint -", "hint:", "HINT:", " Hint:", "A hint:", "Hint :"]) {
      const text = `${BODY}\n\n${marker} ${HINT}`;
      expect(splitHint(text), marker).toEqual(whole(text));
    }
  });

  it("leaves a Hint: that follows a single newline, not a blank line", () => {
    const text = `${BODY}\nHint: ${HINT}`;
    expect(splitHint(text)).toEqual(whole(text));
  });

  it("leaves a hint in the middle, with a later paragraph after it", () => {
    const text = `${BODY}\n\nHint: ${HINT}\n\nOr just say tell me.`;
    expect(splitHint(text)).toEqual(whole(text));
  });

  it("leaves an empty hint", () => {
    for (const text of [`${BODY}\n\nHint:`, `${BODY}\n\nHint:   \n`]) {
      expect(splitHint(text)).toEqual(whole(text));
    }
  });

  it("leaves a hint with no body before it", () => {
    const text = `Hint: ${HINT}`;
    expect(splitHint(text)).toEqual(whole(text));
  });

  it("leaves a direct answer that asks nothing, whatever it ends with", () => {
    const text = `He says researchers kept building in what they knew [spya-bbbbbb].\n\nHint: ${HINT}`;
    expect(splitHint(text)).toEqual(whole(text));
  });

  it("does not count a question that is not the body's last sentence", () => {
    /* Round 2, F5: "contains a ?" is too loose. A rhetorical or quoted question
       followed by a statement is not a nudge, and neither is a URL's query. */
    for (const body of [
      "Why does he say that? Because search scaled and knowledge did not [spya-aaaaaa].",
      'He asks "what comes next?" and then answers it himself [spya-aaaaaa].',
      "It is at https://example.com/a?b=c [spya-aaaaaa].",
    ]) {
      const text = `${body}\n\nHint: ${HINT}`;
      expect(splitHint(text), body).toEqual(whole(text));
    }
  });

  it("hides the hint as soon as the whole marker has arrived, and not before", () => {
    /* A reply that is still arriving. Nothing holds back a partial `Hin`. */
    expect(splitHint(`${BODY}\n\nHin`)).toEqual(whole(`${BODY}\n\nHin`));
    expect(splitHint(`${BODY}\n\nHint:`)).toEqual(whole(`${BODY}\n\nHint:`));
    expect(splitHint(`${BODY}\n\nHint: He`)).toEqual({ body: BODY, hint: "He" });
  });
});

describe("answerAsSeen", () => {
  const text = `${BODY}\n\nHint: ${HINT}`;

  it("is the body alone when the hint was never opened", () => {
    expect(answerAsSeen({ role: "assistant", text }, "learn")).toBe(BODY);
  });

  it("is the body and the hint when it was opened", () => {
    expect(
      answerAsSeen({ role: "assistant", text, hintOpenedAt: "2026-10-04T10:00:00.000Z" }, "learn"),
    ).toBe(text);
  });

  it("leaves every other kind of conversation alone", () => {
    for (const kind of ["chat", "tutorial", "explore", "candidates"] as const) {
      expect(answerAsSeen({ role: "assistant", text }, kind)).toBe(text);
    }
  });

  it("leaves the reader's own message alone, even one that ends like a hint", () => {
    expect(answerAsSeen({ role: "user", text }, "learn")).toBe(text);
  });

  it("leaves an answer with no recognised hint alone", () => {
    expect(answerAsSeen({ role: "assistant", text: BODY }, "learn")).toBe(BODY);
  });
});
