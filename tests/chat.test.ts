/**
 * Chat — the parts that are checkable arithmetic rather than a model call.
 *
 * Three things are tested here and one is deliberately not. Tested: what a
 * conversation gets called, what history is worth sending back, and which cited
 * block ids are real. Not tested: the model's answers, which are not
 * deterministic and whose quality is a reading judgement — the same line
 * testing.md draws everywhere else.
 *
 * See docs/plans/260826a-chat-mode.md.
 */
import { describe, expect, it } from "vitest";
import { ChatConflict, titleFrom, withEdit, withRetry } from "../src/chat.js";
import { recentHistory, unknownCitedIds } from "../src/converse.js";
import { snippet, splitCitations, unknownIds } from "../src/web/citations.js";
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

  /**
   * **An interrupted answer is dropped; a stopped one is kept.** The two flags
   * look alike and mean opposite things about history.
   *
   * `stopped` says the reader had read enough — the stored text is exactly what
   * they read, so it is real conversation and belongs here. `interrupted` says
   * the reader talked over a spoken answer: the realtime server truncates the
   * audio they never heard and hands back the transcript whole, so the tail of
   * that string is words that were generated and spoken to nobody.
   *
   * Sending it anyway is the failure worth a test. The next typed turn would be
   * answered as though the reader had heard a paragraph they interrupted three
   * words into — confidently, with nothing anywhere disagreeing.
   */
  it("drops an interrupted answer but keeps a stopped one", () => {
    const history = [
      [
        message({ id: "spya-111111", text: "stopped question" }),
        message({
          id: "spya-222222",
          role: "assistant",
          text: "what they actually read",
          stopped: true,
        }),
      ],
      [
        message({ id: "spya-333333", text: "interrupted question" }),
        message({
          id: "spya-444444",
          role: "assistant",
          text: "words nobody heard the end of",
          interrupted: true,
        }),
      ],
    ].flat();
    expect(recentHistory(history).map((m) => m.text)).toEqual([
      "stopped question",
      "what they actually read",
    ]);
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
    // 1600 - 12 of spine - 400 of band.
    expect(f.widths).toEqual([1188]);
    expect(f.overflowing).toBe(false);
    expect(f.minWidth).toBe(1600);
  });

  it("the band gives way to the prose before the prose gives way to it", () => {
    // 954 - 12 spine = 942 available; the prose floor is 544, so the band
    // takes 398 rather than its ideal 400.
    //
    // **The window was 966 until 2026-08-28, and halving the rail would have
    // left this test passing while proving nothing.** At 966 a 12px rail leaves
    // 954, `clamp(954 - 544, 288, 400)` is MODE_IDEAL, and the band is at its
    // ideal width — so "gives way" never happens and every assertion below
    // would have had to be relaxed to green. The window moves instead, so the
    // *available* width is the 942 the scenario was written around. GPT Sol.
    const f = band(954);
    expect(f.modeW).toBe(398);
    expect(f.widths).toEqual([544]);
    expect(f.overflowing).toBe(false);
  });

  it("shrinks to MODE_MIN, and that is the last width where both fit", () => {
    // 844 - 12 spine = 832 available, which is exactly MODE_MIN + PROSE_MIN.
    const f = band(844);
    expect(f.modeW).toBe(MODE_MIN);
    expect(f.widths).toEqual([544]);
    expect(f.overflowing).toBe(false);
  });

  /**
   * **Below that the band stops sharing the screen and covers the article**,
   * which reverses what this file asserted until 2026-08-27: the band used to
   * hold MODE_MIN and let the page scroll sideways, on the same "honour the
   * floors and overflow" reasoning the column layout used.
   *
   * It is the wrong answer for the same reason it was wrong there. At 390px it
   * asked a phone for 832px of content and produced two half-visible panels,
   * neither of them readable. And it is inconsistent even on a laptop: below
   * 744px the reading view has already given up sideways scrolling entirely, so
   * a mode that reintroduces it contradicts the page the reader just left.
   *
   * `modeW: 0` is not a claim that there is no band — it is how much horizontal
   * room the band takes *from the table*, and a fixed full-screen panel takes
   * none. layout.ts § fitMode, and styles.css § a narrow window.
   */
  it("gives the band the whole screen once the two no longer fit", () => {
    const f = band(843);
    expect(f.modeW).toBe(0);
    expect(f.widths).toEqual([831]); // the prose, still there, still full width
    expect(f.overflowing).toBe(false);
    expect(f.minWidth).toBe(843); // never wider than the window
  });

  /**
   * **The number the stylesheet used to have to agree with, and no longer
   * carries at all.**
   *
   * styles.css § a band with no room widened the fixed `.mode-band` to the
   * window below `843px`, and this was the only thing keeping that literal
   * honest until 2026-08-28. They were out of step for a while and the failure
   * was total rather than untidy: `fitMode` handed the band `modeW: 0` from 855
   * down, the CSS widened it only from 743 down, and between those two every
   * mode was a correctly-positioned element nought pixels wide. Nothing threw.
   *
   * **The literal went on 2026-09-03**, because it could not be right in both
   * spine states: the crossover is the window *minus the rail*, so it is 844
   * with the rail on and 832 with `?spine=0`, and a media query cannot see a
   * query parameter. `App.tsx` writes `band-covers` from `fit.modeW === 0` and
   * the stylesheet keys off that instead — so the assertion below is now the
   * *whole* statement of the crossover rather than one of a pair, and moving it
   * moves the page. `tests/spine-width.test.ts` is what stops the query coming
   * back.
   */
  it("hands over to the stylesheet at exactly 844/843", () => {
    expect(band(844).modeW).toBe(MODE_MIN); // still a band beside the prose
    expect(band(843).modeW).toBe(0); // the stylesheet takes it from here
  });

  it("never asks a phone for more width than it has", () => {
    for (const w of [320, 390, 480, 600, 732, 843]) {
      const f = band(w);
      expect(f.minWidth).toBe(w);
      expect(f.overflowing).toBe(false);
    }
  });

  /* There is one rail since 2026-08-26 — the labelled form is gone — so in a
     mode the rail is simply on unless the reader turned it off. */
  it("shows the rail at every width", () => {
    expect(band(1100).spine).toBe("on");
    expect(band(1099).spine).toBe("on");
    expect(band(600).spine).toBe("on");
  });

  /* `?spine=0` is a choice about the page, not about the mode you are in, so
     it is the one thing that takes the rail away here — the mode band's own
     rule is that the rail is unconditional. */
  it("hides the rail in a mode too, when the reader has hidden it", () => {
    const f = fitView({
      ...article,
      showText: true,
      chosen: null,
      modeBand: true,
      windowWidth: 1600,
      showSpine: false,
    });
    expect(f.spine).toBe("off");
    // The rail's 12px goes to the prose; the band keeps its ideal width.
    expect(f.modeW).toBe(MODE_IDEAL);
    expect(f.widths).toEqual([1200]);
    expect(f.minWidth).toBe(1600);
  });

  it("leaves the ToC layout untouched when there is no mode band", () => {
    const f = fitView({ ...article, showText: true, chosen: null, windowWidth: 1600 });
    expect(f.modeW).toBe(0);
    // Automatic fit's own default — spine + L1 + L2, never L0. See
    // tests/layout.test.ts § "the default hierarchy view (no ?cols=)".
    expect(f.columns).toEqual([1, 2]);
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

/* `splitEmphasis` was here — "the only Markdown we interpret", which it was
   for six days. It went on 2026-08-31 along with the rest of the hand-rolled
   inline parser; a parser reads `**bold**` and we no longer own a rule about
   it. Its cases live on as DOM assertions in
   tests/chat-markdown-render.test.tsx. docs/plans/chat-markdown.md. */

/* `nextModeIndex` was here — the mode switch's keyboard arithmetic, tested
   without a browser because that is the only place an off-by-one in a wrapping
   index can be caught cheaply. It went on 2026-08-31 with the arrow keys
   themselves: the bottom bar, the diagram chips and the search matchers all
   stopped selecting on arrow presses, because on this page the arrows belong to
   the article and because selecting a mode now starts a paid model call.
   What replaced these cases is tests/arrows-belong-to-the-article.test.tsx,
   which asserts the absence rather than the arithmetic. Dock.tsx § the mode
   switch, and docs/plans/260831ai-which-modes-are-ready-in-the-bottom-bar-and-running-one-by-clicking-it.md. */

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
   `retryTurn` and `fsChatStore.edit` around them so that the rules can be
   checked without a `data/` directory to write into. (`editTurn` was the third
   name here until 2026-08-28, when it turned out to have no callers and to be
   the version *missing* the `expectedTailId` tail check — src/store/fs.ts:245.) That extraction is not only for testing —
   two tests in this repo that both wrote to `data/` passed alone and failed
   together, because vitest runs files in parallel. */

const thread = (messages: ChatMessage[]): ChatThread => ({
  id: "spya-t7r4wz",
  title: "why is it like that?",
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  kind: "chat" as const,
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

/**
 * A generator that makes `mintId` produce exactly these ids, in this order.
 *
 * `mintId` takes six characters off `random()`, so each id is six numbers
 * chosen to land on the character it wants — see `pick` in src/ids.ts. Anything
 * asked for after the list runs out comes back as a zero, which is a valid id
 * and not one of these.
 */
const offering = (...ids: string[]): (() => number) => {
  const ALPHABET = "abcdefghjkmnpqrstuvwxyz023456789";
  const LETTERS = ALPHABET.slice(0, 23);
  const draws: number[] = [];
  for (const id of ids) {
    const body = id.slice("spya-".length);
    for (const [i, ch] of [...body].entries()) {
      const chars = i === 0 ? LETTERS : ALPHABET;
      draws.push(chars.indexOf(ch) / chars.length);
    }
  }
  let at = 0;
  return () => draws[at++] ?? 0;
};

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
    /* The tempting optimisation is to mint against the surviving ids, which
       frees the three rows this edit throws away. A stream still finishing its
       write finds its row by id, so handing one straight back puts a stopped
       half-sentence under a question nobody asked. Within one process the
       route's `settleThread` already rules that out; this covers the second
       server, which cannot see the first one's streams. And it holds within one
       call only — a discarded id leaves the file and the next mint may reuse it.

       **The generator is rigged, and it has to be.** This test used to hand
       `withEdit` a real `Math.random` and assert the new id was none of the
       discarded ones — which passes at odds of 771 million to one whether the
       rule is there or not, and passed all the more surely because the fixture's
       ids ("a1", "u2") are not in the id alphabet at all and could never have
       been minted. It read as coverage and was worth nothing. Pointed out by a
       GPT-5.6 review, 2026-08-26. Now the first thing the generator offers *is*
       a discarded id, so a `taken` set that had forgotten it would hand it
       straight back. */
    const before = thread([
      message({ id: "spya-uuuuuu", role: "user", text: "why is it like that?" }),
      message({ id: "spya-aaaaaa", role: "assistant", text: "because." }),
      message({ id: "spya-vvvvvv", role: "user", text: "and the other one?" }),
      message({ id: "spya-bbbbbb", role: "assistant", text: "differently." }),
    ]);
    const { reply } = withEdit(
      [before],
      before.id,
      "spya-uuuuuu",
      "rephrased",
      NOW,
      offering("spya-bbbbbb", "spya-cccccc"),
    );
    expect(reply.id).toBe("spya-cccccc");
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
