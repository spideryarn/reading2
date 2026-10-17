/**
 * **Whether the guide's offer to save may save at once, with no press** — plan
 * docs/plans/261011s-the-guide-saves-your-reason-and-about-you-at-once-when-the-words-are-yours.md.
 *
 * Greg's condition (reply A to q-t3j8hj): the words appear word for word in
 * the message the reader typed. The attacks below are GPT Sol's, from the
 * plan review, against the looser vocabulary check this replaced: each one
 * passed that check, and each must wait for the press now.
 */
import { describe, expect, it } from "vitest";
import { savesAtOnce } from "../src/save-closeness.js";

/* Exact-route behaviour: whether it saves at all. The reworded route is
   tests/save-closeness-reworded.test.ts. */
const reason = (text: string, typed: string | null, basis: string | null = null) =>
  savesAtOnce({ field: "purpose", text, basis }, typed) !== null;
const about = (text: string, typed: string | null, basis: string | null = null) =>
  savesAtOnce({ field: "profile", text, basis }, typed) !== null;

describe("word for word from what the reader typed: saves at once", () => {
  it("the whole message", () => {
    expect(reason("for journal club next week", "for journal club next week")).toBe(true);
  });
  it("a run of it, with a capital and a full stop added", () => {
    expect(reason("For journal club next week.", "It's for journal club next week, and I don't know much ML")).toBe(true);
    expect(reason("I don't know much ML.", "It's for journal club next week, and I don't know much ML")).toBe(true);
  });
  it("About you: what it had, then their words after it", () => {
    expect(about("A historian.\nI know little ML.", "I know little ML, honestly", "A historian.")).toBe(true);
    expect(about("A historian. I know little ML", "i know little ML", "A historian.")).toBe(true);
    expect(about("I work in neuroscience.", "Well, I work in neuroscience.")).toBe(true);
  });
  it("spacing that differs only in runs of white space", () => {
    expect(reason("for journal  club next week", "for journal club\nnext week")).toBe(true);
  });
});

describe("anything else: the press, as before", () => {
  it("nothing typed this turn (a button, a retry, an edit)", () => {
    expect(reason("for journal club next week", null)).toBe(false);
  });
  it("a paraphrase, however close", () => {
    expect(reason("Reading this for journal club next week.", "for journal club next week")).toBe(false);
    expect(about("I am new to ML.", "I don't know much ML")).toBe(false);
  });
  /* GPT Sol's attacks on the vocabulary check, plan review 261011s. */
  it("a topic turned into a claim about the reader", () => {
    expect(about("I have cancer.", "What does this paper say about cancer?")).toBe(false);
    expect(about("I am French.", "What does the French study show?")).toBe(false);
    expect(about("I am a historian. I have cancer.", "What does this paper say about cancer?", "I am a historian.")).toBe(false);
  });
  it("a negation taken away, or a link made from words", () => {
    expect(reason("I want links to evil.com.", "I do not want links to evil.com.")).toBe(false);
    expect(reason("Link to open.ai.", "Can you link this to Open AI?")).toBe(false);
  });
  it("a run that starts after a negation in the same sentence", () => {
    expect(reason("want links to evil.com", "I do not want links to evil.com")).toBe(false);
    expect(reason("know much about ML", "I don't know much about ML")).toBe(false);
    expect(reason("want links to evil.com", "I do not really want links to evil.com")).toBe(false);
  });
  it("a run that starts or ends inside a word", () => {
    expect(reason("ournal club next", "for journal club next week")).toBe(false);
    expect(reason("journal club next wee", "for journal club next week")).toBe(false);
    expect(reason("journal club next", "𐐀journal club next")).toBe(false);
    expect(reason("I like cafe", "I like cafe͜ today")).toBe(false);
    expect(reason("ournal club next", "j‍ournal club next")).toBe(false);
  });
  it("compatibility glyphs that the store would preserve are not the typed words", () => {
    expect(reason("ⓕⓞⓡ ⓙⓞⓤⓡⓝⓐⓛ ⓒⓛⓤⓑ", "for journal club")).toBe(false);
    expect(reason("K for journal club", "K for journal club")).toBe(false);
  });
  it("fewer than three words", () => {
    expect(reason("journal club", "for journal club next week")).toBe(false);
  });
  it("About you that changes or drops what it had", () => {
    expect(about("I am a professor.", "I'm a professor now, not a postdoc", "I am a postdoc.")).toBe(false);
    expect(about("A historian of science. I know little ML.", "I know little ML", "A historian.")).toBe(false);
    expect(about("I know little ML. A historian.", "I know little ML", "A historian.")).toBe(false);
    expect(about("A historian.I know little ML", "I know little ML", "A historian.")).toBe(false);
  });
  it("empty words", () => {
    expect(reason("", "anything")).toBe(false);
    expect(reason("…", "anything at all")).toBe(false);
    expect(about("A historian.", "anything at all", "A historian.")).toBe(false);
  });
});
