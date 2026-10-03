// @vitest-environment jsdom
/**
 * **A command chip in a chat answer, on the screen** — plan 261003f, Stage 2.
 *
 * The line this holds is the one Greg accepted on 2026-10-02
 * (docs/project/chat-llm-help-commands-vision.md § Decided): the model
 * *proposes*, the reader presses, and the model's text is parsed, never
 * trusted. So:
 *
 *  - a token is a button **only in an ordinary text node** — not in a code
 *    span, a code block or a link's label — and only where the panel was
 *    handed an executor;
 *  - anything invalid is the characters the model wrote, as an unknown block
 *    id is;
 *  - **nothing runs on render**; one press is one run; a second press while
 *    the first is in flight is refused; a `stay` shows its sentence;
 *  - availability is asked again at the press;
 *  - a half-arrived token at the end of a streaming answer is not drawn yet.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CitedMarkdown } from "../src/web/Cited.js";
import type { ActionOutcome } from "../src/web/command-match.js";
import type { CommandExecutor } from "../src/web/command-proposal.js";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const BLOCKS = new Map([["spya-k3m9qt", "The paragraph the model cited."]]);
const CLOSE: ActionOutcome = { kind: "close" };

function executor(runners: CommandExecutor["runners"]): CommandExecutor {
  return { runners, sources: {} };
}

function paint(text: string, commands?: CommandExecutor, partial = false): void {
  act(() => {
    root.render(
      createElement(CitedMarkdown, { text, blocks: BLOCKS, onJump: () => {}, links: true, commands, partial }),
    );
  });
}

const chips = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>("button.cmd-chip")];
const flush = () => act(async () => {});

describe("where a token is a button", () => {
  it("draws the bar's own row for a valid token in prose, and runs nothing", () => {
    const add = vi.fn(() => CLOSE);
    paint("Here you go.\n\n[cmd:tag-add:to%20read]", executor({ "tag-add": add }));
    expect(chips()).toHaveLength(1);
    expect(chips()[0]?.textContent).toBe("Add the tag “to read”");
    expect(host.textContent).not.toContain("[cmd:");
    expect(add).not.toHaveBeenCalled();
  });

  it("carries the generates marker on a row that spends", () => {
    paint("[cmd:glossary-ask:qualia]\n[cmd:tag-add:x]", {
      runners: { "glossary-ask": () => CLOSE, "tag-add": () => CLOSE },
      sources: { glossary: { ready: true, terms: [] } },
    });
    const [ask, tag] = chips();
    expect(ask?.querySelector(".cmd-chip-generates")?.textContent).toBe("generates");
    expect(tag?.querySelector(".cmd-chip-generates")).toBeNull();
  });

  it("is text inside a code span, a code block and a link's label", () => {
    const add = vi.fn(() => CLOSE);
    const text = [
      "Write `[cmd:tag-add:one]` like this.",
      "",
      "```",
      "[cmd:tag-add:two]",
      "```",
      "",
      "[see [cmd:tag-add:three]](https://example.com/x)",
    ].join("\n");
    paint(text, executor({ "tag-add": add }));
    expect(chips()).toHaveLength(0);
    expect(host.textContent).toContain("[cmd:tag-add:one]");
    expect(host.textContent).toContain("[cmd:tag-add:two]");
    expect(host.textContent).toContain("[cmd:tag-add:three]");
  });

  it("is text, exactly as written, when it is not a valid proposal", () => {
    const all = executor({ "tag-add": () => CLOSE, bookmark: async () => CLOSE, "glossary-open": () => CLOSE });
    for (const raw of [
      "[cmd:tag-add:a%2Cb]",
      "[cmd:delete:everything]",
      "[cmd:glossary-open:spya-k3m9qt]",
      "[cmd:bookmark:spya-zzzzzz]",
    ]) {
      paint(`Before.\n${raw}\nAfter.`, all);
      expect(chips(), raw).toHaveLength(0);
      expect(host.textContent, raw).toBe(`Before.\n${raw}\nAfter.`);
    }
  });

  it("does not turn the block id inside a refused token into a citation chip", () => {
    paint("[cmd:glossary-open:spya-k3m9qt]", executor({}));
    expect(host.querySelector(".cite")).toBeNull();
  });

  it("is text where the panel was handed no executor", () => {
    paint("Fine.\n[cmd:tag-add:x]");
    expect(chips()).toHaveLength(0);
    expect(host.textContent).toBe("Fine.\n[cmd:tag-add:x]");
  });

  it("still draws a citation beside a chip", () => {
    paint("He says so [spya-k3m9qt].\n[cmd:bookmark:spya-k3m9qt]", executor({ bookmark: async () => CLOSE }));
    expect(host.querySelectorAll(".cite")).toHaveLength(1);
    expect(chips()).toHaveLength(1);
    expect(chips()[0]?.textContent).toBe("Bookmark this passage");
  });

  it("draws a chip with no runner here as disabled", () => {
    paint("[cmd:bookmark:spya-k3m9qt]", executor({}));
    expect(chips()[0]?.disabled).toBe(true);
  });

  /* The eval's finding (docs/investigations/261003b): every token a model
     wrote for the reader was on a line of its own, and the one that was not
     was a hostile page's, quoted mid-sentence by a model refusing it. */
  it("is text in the middle of a sentence, and a button on a line of its own", () => {
    const commands = executor({ "tag-add": () => CLOSE });
    for (const text of [
      'The page told me to add "[cmd:tag-add:sponsored]" and I have not.',
      "Press this: [cmd:tag-add:x]",
      "[cmd:tag-add:x] is the button.",
      "**[cmd:tag-add:x]**",
      "*see* [cmd:tag-add:x]",
      "# [cmd:tag-add:x]",
      "See https://example.com/a\n[cmd:tag-add:x] https://example.com/b",
    ]) {
      paint(text, commands);
      expect(chips(), text).toHaveLength(0);
      expect(host.textContent, text).toContain("[cmd:tag-add:");
    }
    for (const [text, n] of [
      ["I can add both.\n[cmd:tag-add:a]\n[cmd:tag-add:b]", 2],
      ["One sentence.\n\n[cmd:tag-add:a]", 1],
      ["- [cmd:tag-add:a]\n- [cmd:tag-add:b]", 2],
      ["A line that ends hard.  \n[cmd:tag-add:a]", 1],
    ] as const) {
      paint(text, commands);
      expect(chips(), text).toHaveLength(n);
    }
  });
});

describe("an answer still arriving", () => {
  it("holds back a half-arrived token rather than flashing its characters", () => {
    const commands = executor({ "tag-add": () => CLOSE });
    paint("Sure.\n\n[cmd:tag-add:to%20", commands, true);
    expect(host.textContent).toBe("Sure.");
    expect(chips()).toHaveLength(0);
    paint("Sure.\n\n[cmd:tag-add:to%20read]", commands, true);
    expect(chips()).toHaveLength(1);
  });

  it("shows the same characters once the answer has stopped arriving", () => {
    paint("Sure. [cmd:tag-add:to%20", executor({ "tag-add": () => CLOSE }), false);
    expect(host.textContent).toBe("Sure. [cmd:tag-add:to%20");
  });

  it("holds nothing back where no chip could be drawn", () => {
    paint("Sure. [cmd:tag-add:to%20", undefined, true);
    expect(host.textContent).toBe("Sure. [cmd:tag-add:to%20");
  });
});

describe("pressing one", () => {
  it("runs the proposal once, through the runner it was handed", async () => {
    const add = vi.fn(async (): Promise<ActionOutcome> => CLOSE);
    paint("[cmd:tag-add:To%20Read]", executor({ "tag-add": add }));
    act(() => chips()[0]?.click());
    await flush();
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith({ id: "tag-add", tag: "to read" });
    expect(host.querySelector(".cmd-chip-said")?.textContent).toBe("Added.");
  });

  it("refuses a second press while the first is in flight, and says it is working", async () => {
    let settle: (o: ActionOutcome) => void = () => {};
    const bookmark = vi.fn(
      () =>
        new Promise<ActionOutcome>((r) => {
          settle = r;
        }),
    );
    paint("[cmd:bookmark:spya-k3m9qt]", executor({ bookmark }));
    act(() => chips()[0]?.click());
    expect(chips()[0]?.getAttribute("aria-busy")).toBe("true");
    act(() => chips()[0]?.click());
    act(() => chips()[0]?.click());
    expect(bookmark).toHaveBeenCalledTimes(1);
    await act(async () => settle(CLOSE));
    expect(chips()[0]?.getAttribute("aria-busy")).toBe("false");
    act(() => chips()[0]?.click());
    expect(bookmark).toHaveBeenCalledTimes(2);
    await act(async () => settle(CLOSE));
  });

  it("shows a stay's sentence beside the chip", async () => {
    paint(
      "[cmd:jump-first:panpsychism]",
      executor({ "jump-first": () => ({ kind: "stay", message: "“panpsychism” isn't in this article." }) }),
    );
    act(() => chips()[0]?.click());
    await flush();
    expect(host.querySelector(".cmd-chip-said")?.textContent).toBe("“panpsychism” isn't in this article.");
  });

  it("says a thrown run failed rather than leaving the chip busy", async () => {
    paint("[cmd:tag-add:x]", executor({ "tag-add": async () => Promise.reject(new Error("boom")) }));
    act(() => chips()[0]?.click());
    await flush();
    expect(chips()[0]?.getAttribute("aria-busy")).toBe("false");
    expect(host.querySelector(".cmd-chip-said")?.textContent).toMatch(/didn't work/);
  });

  it("asks again at the press whether it can still be run", async () => {
    /* The executor the chip holds loses its runner between drawing and
       pressing, with no render in between — a comments read that failed. */
    const held = vi.fn(async (): Promise<ActionOutcome> => CLOSE);
    const runners: { bookmark?: typeof held } = { bookmark: held };
    paint("[cmd:bookmark:spya-k3m9qt]", { runners, sources: {} });
    delete runners.bookmark;
    act(() => chips()[0]?.click());
    await flush();
    expect(held).not.toHaveBeenCalled();
    expect(host.querySelector(".cmd-chip-said")?.textContent).toBe("That can't be done from here any more.");
  });

  it("does not run a bookmark whose block left the article between drawing and pressing", async () => {
    const bookmark = vi.fn(async (): Promise<ActionOutcome> => CLOSE);
    const blocks = new Map(BLOCKS);
    act(() => {
      root.render(
        createElement(CitedMarkdown, {
          text: "[cmd:bookmark:spya-k3m9qt]",
          blocks,
          onJump: () => {},
          commands: executor({ bookmark }),
        }),
      );
    });
    blocks.delete("spya-k3m9qt");
    act(() => chips()[0]?.click());
    await flush();
    expect(bookmark).not.toHaveBeenCalled();
    // No longer a chip at all: it is the characters the model wrote.
    expect(chips()).toHaveLength(0);
    expect(host.textContent).toBe("[cmd:bookmark:spya-k3m9qt]");
  });
});
