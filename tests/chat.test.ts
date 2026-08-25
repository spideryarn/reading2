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
import { titleFrom } from "../src/chat.js";
import { nextModeIndex } from "../src/web/Dock.js";
import { recentHistory, unknownCitedIds } from "../src/converse.js";
import { splitCitations, splitEmphasis, unknownIds } from "../src/web/citations.js";
import { fitView, MODE_IDEAL, MODE_MIN } from "../src/web/layout.js";
import type { ChatMessage } from "../src/types.js";

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

describe("recentHistory — what goes back to the model", () => {
  it("keeps finished turns in order", () => {
    const history = [
      message({ id: "spya-aaaaaa", text: "one" }),
      message({ id: "spya-bbbbbb", role: "assistant", text: "two" }),
    ];
    expect(recentHistory(history).map((m) => m.text)).toEqual(["one", "two"]);
  });

  /* An unfinished turn is not part of the conversation the model should be
     continuing — and an empty `content` is rejected outright by OpenRouter, so
     sending one would fail the *next* question because of the last one. */
  it("drops turns that never got an answer", () => {
    const history = [
      message({ id: "spya-aaaaaa", text: "kept" }),
      message({ id: "spya-bbbbbb", role: "assistant", text: "", status: "pending" }),
      message({ id: "spya-cccccc", role: "assistant", text: "half", status: "error" }),
      message({ id: "spya-dddddd", role: "assistant", text: "   " }),
    ];
    expect(recentHistory(history).map((m) => m.text)).toEqual(["kept"]);
  });

  it("keeps the most recent turns when there are too many", () => {
    const history = Array.from({ length: 30 }, (_, i) =>
      message({ id: `spya-a${String(i).padStart(5, "0")}`, text: `t${i}` }),
    );
    const kept = recentHistory(history, 4);
    expect(kept.map((m) => m.text)).toEqual(["t26", "t27", "t28", "t29"]);
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
  // Contents, Chat, Glossary — the order they sit in the bar (Dock.tsx § MODES_UI).
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
