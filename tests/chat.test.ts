/**
 * Chat — the parts that are checkable arithmetic rather than a model call.
 *
 * Three things are tested here and one is deliberately not. Tested: what a
 * conversation gets called, what history is worth sending back, and which cited
 * block ids are real. Not tested: the model's answers, which are not
 * deterministic and whose quality is a reading judgement — the same line
 * testing.md draws everywhere else.
 *
 * See docs/plans/chat-mode.md.
 */
import { describe, expect, it } from "vitest";
import { ChatConflict, titleFrom, withEdit, withRetry } from "../src/chat.js";
import { nextModeIndex } from "../src/web/Dock.js";
import { recentHistory, unknownCitedIds } from "../src/converse.js";
import { snippet, splitCitations, splitEmphasis, unknownIds } from "../src/web/citations.js";
import { SUGGESTIONS } from "../src/web/ChatPanel.js";
import { fitView, MODE_IDEAL, MODE_MIN } from "../src/web/layout.js";
import type { ChatMessage, ChatThread } from "../src/types.js";

const message = (over: Partial<ChatMessage>): ChatMessage => ({
  id: "spya-k3m9qt",
  role: "user",
  text: "why?",
  createdAt: "2026-08-25T00:00:00.000Z",
  status: "done",
  ...over,
});

describe("titleFrom — a conversation names itself", () => {
  it("uses a short question whole, with no ellipsis it has not earned", () => {
    expect(titleFrom("What is the real problem?")).toBe("What is the real problem?");
  });

  it("collapses newlines, so a pasted paragraph does not break the list", () => {
    expect(titleFrom("What is\n\n  this?")).toBe("What is this?");
  });

  it("cuts a long question on a word boundary", () => {
    const long =
      "What exactly does the author mean when he says that consciousness is not a computation at all";
    const title = titleFrom(long);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(61);
    /* The cut lands between words, never mid-word. Which means the title is a
       prefix of the original AND the original's next character is a space —
       checking only the prefix would pass for a cut through the middle of a
       word, which is the failure this is about. */
    const kept = title.slice(0, -1);
    expect(long.startsWith(kept)).toBe(true);
    expect(long[kept.length]).toBe(" ");
  });

  it("falls back rather than producing an empty name", () => {
    expect(titleFrom("   ")).toBe("New chat");
  });

  /* A sixty-character run with no spaces in it — a pasted URL, a long token.
     `lastIndexOf(" ")` returns -1 there, and slicing to -1 would have produced
     an empty title, which is exactly the sort of thing that only shows up on
     the one row of the list nobody can click. */
  it("cuts a long unbroken string rather than emptying it", () => {
    const url = `https://example.com/${"a".repeat(80)}`;
    expect(titleFrom(url).length).toBe(61);
  });
});

/** A finished exchange: a question and the answer to it. */
let seq = 0;
const turn = (question: string, answer: string): ChatMessage[] => [
  message({ id: `spya-q${String(seq).padStart(5, "0")}`, text: question }),
  message({ id: `spya-a${String(seq++).padStart(5, "0")}`, role: "assistant", text: answer }),
];

describe("recentHistory — what goes back to the model", () => {
  it("keeps finished turns in order", () => {
    expect(recentHistory(turn("one", "two")).map((m) => m.text)).toEqual(["one", "two"]);
  });

  /* **A WHOLE turn, or neither half.** This test used to drop the failed
     assistant message and keep the question that produced it, which is what the
     code did — so it pinned the bug rather than catching it. The model then got
     two user turns in a row and answered the abandoned question again. */
  it("drops both halves of a turn that never got an answer", () => {
    const history = [
      turn("kept", "answered"),
      [
        message({ id: "spya-cccccc", text: "asked but never answered" }),
        message({ id: "spya-dddddd", role: "assistant", text: "", status: "pending" }),
      ],
      [
        message({ id: "spya-eeeeee", text: "asked and failed" }),
        message({ id: "spya-ffffff", role: "assistant", text: "half", status: "error" }),
      ],
    ].flat();
    expect(recentHistory(history).map((m) => m.text)).toEqual(["kept", "answered"]);
  });

  it("never sends two questions in a row", () => {
    const history = [
      message({ id: "spya-aaaaaa", text: "one" }),
      message({ id: "spya-bbbbbb", role: "assistant", text: "", status: "error" }),
      message({ id: "spya-cccccc", text: "two" }),
      message({ id: "spya-dddddd", role: "assistant", text: "answer" }),
    ];
    const roles = recentHistory(history).map((m) => m.role);
    expect(roles).toEqual(["user", "assistant"]);
    expect(roles.some((r, i) => r === roles[i - 1])).toBe(false);
  });

  /* `turns` means turns, which is what the name always claimed — the cap used
     to count messages, so it kept half as much history as it said. */
  it("counts the cap in turns rather than in messages", () => {
    const history = Array.from({ length: 10 }, (_, i) => turn(`q${i}`, `a${i}`)).flat();
    const kept = recentHistory(history, 2);
    expect(kept.map((m) => m.text)).toEqual(["q8", "a8", "q9", "a9"]);
  });

  /* A history that is not question-then-answer is damaged, and this function
     builds prompts rather than repairing data. */
  it("drops a stray assistant message with no question before it", () => {
    const history = [
      message({ id: "spya-aaaaaa", role: "assistant", text: "orphan" }),
      ...turn("q", "a"),
    ];
    expect(recentHistory(history).map((m) => m.text)).toEqual(["q", "a"]);
  });
});

describe("unknownCitedIds — the citation contract's one silent failure", () => {
  const known = new Set(["spya-k3m9qt", "spya-p7w2dn"]);

  it("says nothing when every cited id is real", () => {
    expect(unknownCitedIds("He rejects it [spya-k3m9qt] and again [spya-p7w2dn].", known)).toEqual(
      [],
    );
  });

  it("names an id the article does not have", () => {
    expect(unknownCitedIds("As it says [spya-zzzzzz].", known)).toEqual(["spya-zzzzzz"]);
  });

  it("counts a repeated bad id once", () => {
    expect(unknownCitedIds("[spya-zzzzzz] and [spya-zzzzzz]", known)).toEqual(["spya-zzzzzz"]);
  });

  /* Ids whose SHAPE is wrong are not ours and are not counted — the client
     shows them as plain text, and calling them hallucinated block ids would
     inflate the number that exists to detect real hallucination. `l`, `i` and
     `o` are excluded from the alphabet (block-ids.md), so an id containing one
     was never minted here. */
  it("ignores strings that only look like ids", () => {
    expect(unknownCitedIds("[spya-lllooo] [spya-abc] [spya-] spya", known)).toEqual([]);
  });

  it("finds an id the model wrote without brackets", () => {
    expect(unknownCitedIds("see spya-zzzzzz above", known)).toEqual(["spya-zzzzzz"]);
  });
});

describe("fitView in a mode — the band replaces the columns", () => {
  const article = { gistDepths: [0, 1, 2], leafDepth: 3 };
  /* NOT called `fit`, which is what layout.test.ts calls its equivalent: Biome
     reads a bare `fit(` as Vitest's focused-test helper and flags the whole
     file (lint/suspicious/noFocusedTests). A human skimming can misread it the
     same way, which is the better reason. */
  const band = (windowWidth: number) =>
    fitView({ ...article, showText: true, chosen: null, modeBand: true, windowWidth });

  it("1600px: the band at its ideal width, the rest to the prose", () => {
    const f = band(1600);
    // No gist columns at all — they are not squeezed, they are gone.
    expect(f.columns).toEqual([]);
    expect(f.modeW).toBe(MODE_IDEAL);
    // 1600 - 208 of spine - 400 of band.
    expect(f.widths).toEqual([992]);
    expect(f.overflowing).toBe(false);
    expect(f.minWidth).toBe(1600);
  });

  it("the band gives way to the prose before the prose gives way to it", () => {
    // 1150 - 208 spine = 942 available; the prose floor is 544, so the band
    // takes 398 rather than its ideal 400.
    const f = band(1150);
    expect(f.modeW).toBe(398);
    expect(f.widths).toEqual([544]);
    expect(f.overflowing).toBe(false);
  });

  it("stops shrinking at MODE_MIN and overflows instead", () => {
    const f = band(700);
    expect(f.modeW).toBe(MODE_MIN);
    // The prose keeps its floor; the page scrolls sideways, exactly as the
    // table does when the columns do not fit.
    expect(f.widths).toEqual([544]);
    expect(f.overflowing).toBe(true);
  });

  /* The ToC layout has a tie-break that keeps the rail narrow when widening it
     would cost a column — widening the window must never REMOVE context. There
     are no columns to lose in a mode, so the rule does not apply and the labels
     appear as soon as they fit. */
  it("keeps the spine's labels wherever they fit", () => {
    expect(band(1100).spine).toBe("full");
    expect(band(1099).spine).toBe("narrow");
  });

  it("leaves the ToC layout untouched when there is no mode band", () => {
    const f = fitView({ ...article, showText: true, chosen: null, windowWidth: 1600 });
    expect(f.modeW).toBe(0);
    expect(f.columns).toEqual([0, 1, 2]);
  });
});

describe("splitCitations — the block ids in an answer, found and checked", () => {
  const known = new Set(["spya-k3m9qt", "spya-p7w2dn"]);
  const split = (para: string) => splitCitations(para, known);
  /** A compact shape for reading a result: "text" or "cite:id,id". */
  const shape = (para: string) =>
    split(para).map((s) => (s.kind === "text" ? s.text : `cite:${s.ids.join(",")}`));

  it("pulls one bracketed id out of a sentence", () => {
    expect(shape("He rejects it [spya-k3m9qt].")).toEqual([
      "He rejects it ",
      "cite:spya-k3m9qt",
      ".",
    ]);
  });

  it("keeps several ids cited together as one citation", () => {
    expect(shape("Both [spya-k3m9qt spya-p7w2dn] say so.")).toEqual([
      "Both ",
      "cite:spya-k3m9qt,spya-p7w2dn",
      " say so.",
    ]);
  });

  it("accepts commas between ids, which the model sometimes writes", () => {
    expect(shape("[spya-k3m9qt, spya-p7w2dn]")).toEqual(["cite:spya-k3m9qt,spya-p7w2dn"]);
  });

  /* Matching on the SHAPE of an id rather than on the brackets is what makes
     this survive a model that drops the punctuation. */
  it("finds an id the model wrote without brackets", () => {
    expect(shape("see spya-k3m9qt above")).toEqual(["see ", "cite:spya-k3m9qt", " above"]);
  });

  it("leaves prose with no ids in it completely alone", () => {
    expect(shape("The article does not say.")).toEqual(["The article does not say."]);
  });

  /* The important half of the contract. An id this article does not have must
     NOT become a link: a chip that scrolls nowhere is indistinguishable from a
     bug in the scrolling, and the reader has no way to tell which they hit. */
  it("leaves an id this article does not have as plain text, brackets and all", () => {
    expect(shape("As it says [spya-zzzzzz].")).toEqual(["As it says [spya-zzzzzz]."]);
  });

  it("keeps the good ids in a mixed run and drops the invented one", () => {
    expect(shape("Both [spya-k3m9qt spya-zzzzzz] agree.")).toEqual([
      "Both ",
      "cite:spya-k3m9qt",
      " agree.",
    ]);
  });

  it("ignores strings that only look like ids", () => {
    // `l`, `i` and `o` are not in the alphabet (block-ids.md), so this was
    // never minted here and is not a citation at all.
    expect(shape("[spya-lllooo] and [spya-abc]")).toEqual(["[spya-lllooo] and [spya-abc]"]);
  });

  it("emits no empty text segments around a paragraph that is only a citation", () => {
    expect(split("[spya-k3m9qt]")).toEqual([{ kind: "cite", ids: ["spya-k3m9qt"] }]);
  });

  it("handles two citations in one sentence", () => {
    expect(shape("First [spya-k3m9qt], then [spya-p7w2dn].")).toEqual([
      "First ",
      "cite:spya-k3m9qt",
      ", then ",
      "cite:spya-p7w2dn",
      ".",
    ]);
  });

  /* The client and the server must answer "did the model invent an id" the same
     way, or the count in the log describes something the reader is not seeing. */
  it("agrees with the server's count of invented ids", () => {
    const answer = "One [spya-k3m9qt], two [spya-zzzzzz], three [spya-yyyyyy].";
    expect(unknownIds(answer, known).sort()).toEqual(unknownCitedIds(answer, known).sort());
    expect(unknownIds(answer, known).sort()).toEqual(["spya-yyyyyy", "spya-zzzzzz"]);
  });
});

describe("splitCitations — the bug the space-eating pattern had", () => {
  const known = new Set(["spya-k3m9qt"]);
  const shape = (para: string) =>
    splitCitations(para, known).map((s) => (s.kind === "text" ? s.text : `cite:${s.ids.join(",")}`));

  /* The first version of the pattern let its optional whitespace match OUTSIDE
     the brackets, so a bare id swallowed the spaces around it and rendered as
     "seek3m9qtabove". It only ever happened when the model forgot the
     brackets, which is the case nobody tests by hand. */
  it("keeps the space on both sides of a bare id", () => {
    expect(shape("see spya-k3m9qt above")).toEqual(["see ", "cite:spya-k3m9qt", " above"]);
  });

  it("keeps the space before a bracketed id and the punctuation after it", () => {
    expect(shape("as he says [spya-k3m9qt].")).toEqual(["as he says ", "cite:spya-k3m9qt", "."]);
  });

  it("leaves a bracketed aside that is not a citation completely alone", () => {
    expect(shape("he says [see above] plainly")).toEqual(["he says [see above] plainly"]);
  });

  /* A stray opening bracket must not swallow the rest of the paragraph looking
     for a closing one that never comes. */
  it("survives an unclosed bracket", () => {
    expect(shape("a [ b spya-k3m9qt c")).toEqual(["a [ b ", "cite:spya-k3m9qt", " c"]);
  });
});

describe("splitEmphasis — the only Markdown we interpret", () => {
  const shape = (text: string) =>
    splitEmphasis(text).map((r) => (r.bold ? `b:${r.text}` : r.text));

  /* Found in a browser test on 2026-08-25: the prompt asks for plain prose and
     gets it, but a model bolds the term it is introducing whatever you tell it,
     and the literal asterisks made the app look unable to read its own output. */
  it("turns a bolded term into a bold run", () => {
    expect(shape("He calls it **computational functionalism** here.")).toEqual([
      "He calls it ",
      "b:computational functionalism",
      " here.",
    ]);
  });

  it("handles two bolded runs in one paragraph", () => {
    expect(shape("**one** and **two**")).toEqual(["b:one", " and ", "b:two"]);
  });

  it("leaves text with no emphasis as a single run", () => {
    expect(shape("nothing to see")).toEqual(["nothing to see"]);
  });

  /* Guessing where an unclosed run was meant to stop is how you embolden the
     rest of a paragraph. */
  it("leaves an unmatched pair of asterisks literal", () => {
    expect(shape("a **b c")).toEqual(["a **b c"]);
  });

  it("does not reach across a line break to find its closing pair", () => {
    expect(shape("a **b\nc** d")).toEqual(["a **b\nc** d"]);
  });

  it("leaves single asterisks alone — they are not our syntax", () => {
    expect(shape("2 * 3 * 4")).toEqual(["2 * 3 * 4"]);
  });
});

describe("nextModeIndex — the mode switch's keyboard, without a browser", () => {
  /* A count, not the real one. `nextModeIndex` is pure index arithmetic and
     knows nothing about which modes exist, so pinning this to `MODES_UI.length`
     would only mean the test changes shape every time a mode is added or the
     bar is reordered — which happened twice in two days. The bar is Contents,
     Summary, Glossary, Search, Chat today (Dock.tsx § MODES_UI); the wrapping
     is checked at other counts below. */
  const N = 3;

  it("moves forward on Right and Down", () => {
    expect(nextModeIndex("ArrowRight", 0, N)).toBe(1);
    expect(nextModeIndex("ArrowDown", 0, N)).toBe(1);
  });

  it("moves backward on Left and Up", () => {
    expect(nextModeIndex("ArrowLeft", 2, N)).toBe(1);
    expect(nextModeIndex("ArrowUp", 2, N)).toBe(1);
  });

  it("wraps forward off the end", () => {
    expect(nextModeIndex("ArrowRight", N - 1, N)).toBe(0);
  });

  /* JavaScript's `%` keeps the sign of its left operand, so the naive
     `(index - 1) % count` returns -1 here — a valid-looking array index that
     reads back as `undefined`, and an arrow key that silently does nothing. */
  it("wraps backward off the start rather than landing on -1", () => {
    expect(nextModeIndex("ArrowLeft", 0, N)).toBe(N - 1);
  });

  it("jumps to the ends on Home and End", () => {
    expect(nextModeIndex("Home", 2, N)).toBe(0);
    expect(nextModeIndex("End", 0, N)).toBe(N - 1);
  });

  /* Anything else must come back null so the handler returns WITHOUT calling
     preventDefault or stopPropagation — otherwise the group would swallow Tab,
     Enter and every printed character while it happens to hold focus. */
  it("declines keys that are not its own", () => {
    for (const key of ["Tab", "Enter", " ", "a", "Escape", "PageDown"]) {
      expect(nextModeIndex(key, 0, N)).toBeNull();
    }
  });

  it("declines everything when there are no modes to move between", () => {
    expect(nextModeIndex("ArrowRight", 0, 0)).toBeNull();
  });

  /* Adding a fourth mode is a row in MODES_UI and nothing else — the arithmetic
     must not have three baked into it anywhere. */
  it("works for any number of modes", () => {
    expect(nextModeIndex("ArrowRight", 3, 4)).toBe(0);
    expect(nextModeIndex("End", 0, 4)).toBe(3);
    expect(nextModeIndex("ArrowRight", 0, 1)).toBe(0);
  });
});

describe("splitCitations — prose inside brackets, and duplicates", () => {
  const known = new Set(["spya-k3m9qt", "spya-p7w2dn"]);
  const shape = (para: string) =>
    splitCitations(para, known).map((s) => (s.kind === "text" ? s.text : `cite:${s.ids.join(",")}`));

  /* The parser used to match ANY short bracketed run and replace the whole
     thing with chips, so a bracket holding an id and prose lost the prose:
     "see" and "for discussion" were simply deleted from the model's answer.
     Silent text loss in the one parser the feature rests on. */
  it("keeps the words a bracket holds alongside an id", () => {
    expect(shape("As [see spya-k3m9qt for discussion] shows.")).toEqual([
      "As [see ",
      "cite:spya-k3m9qt",
      " for discussion] shows.",
    ]);
  });

  it("keeps a page reference beside a cited id", () => {
    expect(shape("[spya-k3m9qt, p. 4]")).toEqual(["[", "cite:spya-k3m9qt", ", p. 4]"]);
  });

  /* A bracket of nothing but ids and separators is still consumed whole — that
     is the ordinary citation, and keeping its brackets would leave punctuation
     around something that no longer reads as text. */
  it("still swallows the brackets of an ordinary citation", () => {
    expect(shape("Yes [spya-k3m9qt].")).toEqual(["Yes ", "cite:spya-k3m9qt", "."]);
    expect(shape("Yes [spya-k3m9qt, spya-p7w2dn].")).toEqual([
      "Yes ",
      "cite:spya-k3m9qt,spya-p7w2dn",
      ".",
    ]);
  });

  /* Two identical chips, and — since the chips are keyed by id — two React
     children with the same key. */
  it("draws one chip when the model cites the same block twice", () => {
    expect(shape("[spya-k3m9qt spya-k3m9qt]")).toEqual(["cite:spya-k3m9qt"]);
  });
});

describe("snippet — what a citation chip shows on hover", () => {
  it("shows a short paragraph whole, with no ellipsis it has not earned", () => {
    expect(snippet("A short block.")).toBe("A short block.");
  });

  it("collapses the whitespace the article's own markup leaves behind", () => {
    expect(snippet("two\n\n  words")).toBe("two words");
  });

  it("cuts a long paragraph on a word boundary", () => {
    const long = `${"word ".repeat(200)}end`;
    const out = snippet(long, 60);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(61);
    // The kept part is a prefix of the original AND the original's next
    // character is a space — checking only the prefix would pass for a cut
    // through the middle of a word, which is the failure this is about.
    const kept = out.slice(0, -1);
    expect(long.startsWith(kept)).toBe(true);
    expect(long[kept.length]).toBe(" ");
  });

  /* `lastIndexOf` returns -1 with no space to cut at, and `slice(0, -1)` is not
     "nothing" — it is "everything but the last character". The naive version
     therefore showed a 5,000-character block IN FULL inside a hover card, from
     the one input that has no spaces in it. */
  it("still bounds a long string that has no spaces in it", () => {
    const wall = "x".repeat(5000);
    const out = snippet(wall, 60);
    expect(out.length).toBeLessThanOrEqual(61);
    expect(out.endsWith("…")).toBe(true);
  });

  it("says nothing for a block with no text of its own", () => {
    expect(snippet("   ")).toBe("");
  });
});

describe("the chat suggestions", () => {
  /**
   * **The rule, enforced.** Every suggestion has to send the reader back into
   * the article; the one that does the opposite is the app's named anti-goal
   * (vision.md: "a chatbot with the article stuffed in the context window"), and
   * it is also the single most obvious thing for somebody to add here in good
   * faith. A comment saying "don't" is not much of a guard against that.
   */
  it("never offers to summarise the article", () => {
    for (const s of SUGGESTIONS) {
      expect(`${s.label} ${s.ask}`.toLowerCase()).not.toMatch(/summar[iy]|tl;?dr|in a nutshell/);
    }
  });

  it("asks a real question in every one", () => {
    for (const s of SUGGESTIONS) {
      expect(s.label.trim()).not.toBe("");
      // The label is a button; the ask is what the reader appears to have typed,
      // so it has to stand on its own in the transcript.
      expect(s.ask.length).toBeGreaterThan(s.label.length);
    }
  });
});

/* ------------------------------------------------- retrying and editing ----
   The two things that rewrite a stored conversation rather than adding to it,
   which is what makes them worth testing at all: everything else in this file
   appends, and an append cannot lose anything.

   `withRetry` and `withEdit` are the whole decision, extracted from the async
   `retryTurn`/`editTurn` around them so that the rules can be checked without a
   `data/` directory to write into. That extraction is not only for testing —
   two tests in this repo that both wrote to `data/` passed alone and failed
   together, because vitest runs files in parallel. */

const thread = (messages: ChatMessage[]): ChatThread => ({
  id: "spya-t7r4wz",
  title: "why is it like that?",
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  messages,
});

/** A finished four-message conversation: ask, answer, ask, answer. */
const conversation = (): ChatThread =>
  thread([
    message({ id: "u1", role: "user", text: "why is it like that?" }),
    message({ id: "a1", role: "assistant", text: "because [spya-k3m9qt].", model: "m" }),
    message({ id: "u2", role: "user", text: "and the other one?" }),
    message({
      id: "a2",
      role: "assistant",
      text: "that one is different.",
      citations: [{ url: "https://example.com" }],
      searches: 1,
      model: "m",
    }),
  ]);

const NOW = "2026-08-26T12:00:00.000Z";

describe("withRetry — answering the same question again", () => {
  it("blanks the answer in place, keeping its id", () => {
    const before = conversation();
    const { thread: after, reply, user } = withRetry([before], before.id, "a2", NOW);
    expect(after.messages).toHaveLength(4);
    expect(reply.id).toBe("a2");
    expect(reply.status).toBe("pending");
    expect(reply.text).toBe("");
    // The question comes off the stored row, not from the caller — a stale tab
    // must not be able to store an answer under a question it was not asked.
    expect(user.text).toBe("and the other one?");
    // And the row itself, not just its words: the route names it in the `begin`
    // frame so the client can stop calling it by a name it invented.
    expect(user.id).toBe("u2");
  });

  it("drops everything the replaced answer carried", () => {
    const before = conversation();
    const { reply } = withRetry([before], before.id, "a2", NOW);
    /* The bug this pins is a spread: `{...last, text: "", status: "pending"}`
       type-checks, reads as obviously right, and leaves the old answer's web
       sources sitting under text that never mentions them. */
    expect(reply.citations).toBeUndefined();
    expect(reply.searches).toBeUndefined();
    expect(reply.model).toBeUndefined();
  });

  it("refuses anything but the last answer", () => {
    const before = conversation();
    expect(() => withRetry([before], before.id, "a1", NOW)).toThrow(ChatConflict);
  });

  it("refuses a question, an unknown id, and an unknown thread", () => {
    const before = conversation();
    expect(() => withRetry([before], before.id, "u2", NOW)).toThrow(ChatConflict);
    expect(() => withRetry([before], before.id, "nope", NOW)).toThrow(ChatConflict);
    expect(() => withRetry([before], "spya-zzzzzz", "a2", NOW)).toThrow(ChatConflict);
  });

  it("refuses an answer that is still arriving", () => {
    const live = thread([
      message({ id: "u1", role: "user" }),
      message({ id: "a1", role: "assistant", text: "half a", status: "pending" }),
    ]);
    expect(() => withRetry([live], live.id, "a1", NOW)).toThrow(ChatConflict);
  });

  it("retries a failed answer, which is the case it was asked for", () => {
    const failed = thread([
      message({ id: "u1", role: "user" }),
      message({ id: "a1", role: "assistant", text: "", status: "error", error: "timed out" }),
    ]);
    const { reply } = withRetry([failed], failed.id, "a1", NOW);
    expect(reply.status).toBe("pending");
    expect(reply.error).toBeUndefined();
  });

  it("leaves the other conversations alone", () => {
    const other = { ...conversation(), id: "spya-p7w2dn" };
    const mine = conversation();
    const { threads } = withRetry([other, mine], mine.id, "a2", NOW);
    expect(threads[0]).toBe(other);
  });
});

describe("withEdit — rewriting a question", () => {
  it("discards everything after the edited question", () => {
    const before = conversation();
    const { thread: after, discarded } = withEdit([before], before.id, "u1", "actually, why NOT?", NOW);
    // ask, answer, ask, answer → the rewritten ask, and one pending answer.
    expect(after.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(after.messages[0]?.text).toBe("actually, why NOT?");
    expect(after.messages[1]?.status).toBe("pending");
    // Three: the answer it had, and the whole turn that followed.
    expect(discarded).toBe(3);
  });

  it("marks the question as edited, and does not keep the old words", () => {
    const before = conversation();
    const { user } = withEdit([before], before.id, "u1", "rephrased", NOW);
    expect(user.editedAt).toBe(NOW);
    expect(JSON.stringify(user)).not.toContain("why is it like that?");
  });

  it("renames the thread only when the FIRST question changes", () => {
    const before = conversation();
    expect(withEdit([before], before.id, "u1", "a whole new subject", NOW).thread.title).toBe(
      "a whole new subject",
    );
    expect(withEdit([before], before.id, "u2", "a whole new subject", NOW).thread.title).toBe(
      before.title,
    );
  });

  it("discards nothing when the last question is the one edited", () => {
    const before = thread([
      message({ id: "u1", role: "user" }),
      message({ id: "a1", role: "assistant", text: "an answer" }),
      message({ id: "u2", role: "user", text: "one more" }),
    ]);
    const { discarded, thread: after } = withEdit([before], before.id, "u2", "one more, but better", NOW);
    expect(discarded).toBe(0);
    expect(after.messages).toHaveLength(4);
  });

  it("never reuses an id it just discarded", () => {
    const before = conversation();
    const { reply } = withEdit([before], before.id, "u1", "rephrased", NOW);
    /* The tempting optimisation is to mint against the surviving ids, which
       frees `a1`, `u2` and `a2`. A stream still finishing its write finds its
       row by id, so handing one straight back puts a stopped half-sentence
       under a question nobody asked. Within one process the route's
       `settleThread` already rules that out; this covers the second server,
       which cannot see the first one's streams. And it holds within one call
       only — a discarded id leaves the file and the next mint may reuse it. */
    expect(["u1", "a1", "u2", "a2"]).not.toContain(reply.id);
  });

  it("refuses to edit an answer, an unknown message, or an unknown thread", () => {
    const before = conversation();
    expect(() => withEdit([before], before.id, "a1", "x", NOW)).toThrow(ChatConflict);
    expect(() => withEdit([before], before.id, "nope", "x", NOW)).toThrow(ChatConflict);
    expect(() => withEdit([before], "spya-zzzzzz", "u1", "x", NOW)).toThrow(ChatConflict);
  });
});

describe("a stopped answer is not a failed one", () => {
  it("still counts as history the model should see", () => {
    /* The check that matters: `recentHistory` keeps whole turns whose answer is
       `done` and non-empty. A stopped answer IS done — the reader ended it, the
       model did say those words — so pretending it never happened would have
       the conversation contradict itself one turn later. */
    const history = recentHistory([
      message({ id: "u1", role: "user", text: "why?" }),
      message({ id: "a1", role: "assistant", text: "because it was", stopped: true }),
    ]);
    expect(history.map((m) => m.id)).toEqual(["u1", "a1"]);
  });

  it("is dropped when it was stopped before a word arrived", () => {
    /* A stop that lands before the first token is stored `done`, `stopped`, with
       zero characters — not as an error, because nothing failed. Which means
       `recentHistory` is the only thing standing between that row and a turn
       being sent to the model in which it said nothing at all. It drops it on
       the empty text, and this test is what keeps that true. */
    const history = recentHistory([
      message({ id: "u1", role: "user", text: "why?" }),
      message({ id: "a1", role: "assistant", text: "", status: "done", stopped: true }),
    ]);
    expect(history).toEqual([]);
  });
});
