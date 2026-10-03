/**
 * **Which of a model's tokens become a button, and what the button would run**
 * — the pure half of chat's command chips (plan 261003f, Stage 2).
 *
 *  - a token is found by its **shape** and nothing else in the text is touched;
 *  - only the ids chat may propose are a chip, and `glossary-open` is not one
 *    of them: its argument is an entry id the model was never shown;
 *  - a bookmark for a block the article lacks is no chip (the hostile case);
 *  - a glossary look-up is matched against the **visible** glossary here, so a
 *    term that is there opens its entry and spends nothing;
 *  - a chip whose runner is absent is drawn but not enabled;
 *  - the server's citation counters do not see an id inside a token.
 */
import { describe, expect, it } from "vitest";
import { citableText } from "../src/citable.js";
import {
  splitCommandTokens,
  tokensOnOwnLine,
  unfinishedTokenAt,
  unsettledTokenLineAt,
} from "../src/command-token.js";
import { CHAT_PROPOSABLE, chipFor } from "../src/web/chat-commands.js";
import type { CommandExecutor } from "../src/web/command-proposal.js";

const BLOCKS = new Map([["spya-k3m9qt", "The paragraph."]]);
const CLOSE = { kind: "close" } as const;

const executor = (glossaryReady = true): CommandExecutor => ({
  runners: {
    "jump-first": () => CLOSE,
    find: () => CLOSE,
    "glossary-open": () => CLOSE,
    "glossary-ask": () => CLOSE,
    "tag-add": () => CLOSE,
    "tag-remove": () => CLOSE,
    bookmark: () => CLOSE,
  },
  sources: {
    glossary: {
      ready: glossaryReady,
      terms: [{ id: "spya-g7w2dn", name: "Free energy", aliases: ["FE"] }],
    },
  },
});

describe("finding tokens in a run of text", () => {
  it("splits on the token's shape and keeps every other character", () => {
    expect(splitCommandTokens("Sure. [cmd:tag-add:to%20read] Done [see above].")).toEqual([
      { kind: "text", text: "Sure. " },
      { kind: "token", raw: "[cmd:tag-add:to%20read]" },
      { kind: "text", text: " Done [see above]." },
    ]);
  });

  it("leaves text with no token as one run", () => {
    expect(splitCommandTokens("[cmd:tag-add:two words] and [cmd:]")).toEqual([
      { kind: "text", text: "[cmd:tag-add:two words] and [cmd:]" },
    ]);
  });

  /* A button is a row, not a word in a sentence — and the one token a model
     wrote mid-sentence in the eval was a hostile one it was quoting while
     refusing it (docs/investigations/261003b). */
  it("says which tokens stand on a line of their own", () => {
    const own = (text: string, startsLine = true, endsLine = true) =>
      tokensOnOwnLine(splitCommandTokens(text), startsLine, endsLine);
    expect(own("[cmd:tag-add:a]")).toEqual([true]);
    expect(own("I can add both.\n[cmd:tag-add:a]\n[cmd:tag-add:b]")).toEqual([true, true]);
    expect(own("  [cmd:tag-add:a] [cmd:tag-add:b]  \nafter")).toEqual([true, true]);
    expect(own("Add it: [cmd:tag-add:a]")).toEqual([false]);
    expect(own("[cmd:tag-add:a] is the button")).toEqual([false]);
    expect(own('told to add "[cmd:tag-add:a]" and\n[cmd:tag-add:b]')).toEqual([false, true]);
  });

  it("does not call a line its own when the run it is in starts or ends mid-line", () => {
    const runs = splitCommandTokens("[cmd:tag-add:a]\n[cmd:tag-add:b]");
    expect(tokensOnOwnLine(runs, false, true)).toEqual([false, true]);
    expect(tokensOnOwnLine(runs, true, false)).toEqual([true, false]);
  });

  it("names where a half-arrived token starts at the end of a streaming answer", () => {
    expect(unfinishedTokenAt("Here: [cmd:tag-add:to%20")).toBe(6);
    expect(unfinishedTokenAt("Here: [cm")).toBe(6);
    expect(unfinishedTokenAt("Here: [")).toBe(6);
    expect(unfinishedTokenAt("Here: [cmd:tag-add:x]")).toBe(-1);
    expect(unfinishedTokenAt("Here: [see")).toBe(-1);
    expect(unfinishedTokenAt("Here: [cmd:tag add")).toBe(-1);
  });

  it("names a complete token-only final line whose right edge is still streaming", () => {
    expect(unsettledTokenLineAt("Here.\n[cmd:tag-add:a]", true)).toBe(6);
    expect(unsettledTokenLineAt("[cmd:tag-add:a] [cmd:tag-add:b]  ", true)).toBe(0);
    expect(unsettledTokenLineAt("[cmd:tag-add:a]", false)).toBe(-1);
    expect(unsettledTokenLineAt("Here: [cmd:tag-add:a]", true)).toBe(-1);
    expect(unsettledTokenLineAt("[cmd:tag-add:a] after", true)).toBe(-1);
  });
});

describe("which tokens are a chip", () => {
  it("offers every id but glossary-open", () => {
    expect([...CHAT_PROPOSABLE].sort()).toEqual(
      ["bookmark", "find", "glossary-ask", "jump-first", "tag-add", "tag-remove"].sort(),
    );
    expect(chipFor("[cmd:glossary-open:spya-g7w2dn]", executor(), BLOCKS)).toBeNull();
  });

  it("is a chip for a valid token, with the proposal the bar would run", () => {
    expect(chipFor("[cmd:tag-add:To%20Read]", executor(), BLOCKS)).toEqual({
      proposal: { id: "tag-add", tag: "to read" },
      enabled: true,
    });
    expect(chipFor("[cmd:jump-first:free%20energy]", executor(), BLOCKS)).toEqual({
      proposal: { id: "jump-first", words: "free energy" },
      enabled: true,
    });
  });

  it("is no chip for a token that does not parse, an unknown id, or an invalid argument", () => {
    for (const raw of [
      "[cmd:tag-add:a%2C%20b]", // a comma: normaliseTag refuses it
      "[cmd:archive:now]",
      "[cmd:tag-add:%E0%A4%A]", // does not decode
      "[cmd:bookmark:not-an-id]",
      "[cmd:tag-add:]",
      "cmd:tag-add:x",
    ]) {
      expect(chipFor(raw, executor(), BLOCKS), raw).toBeNull();
    }
  });

  it("is no chip for a bookmark on a block this article lacks", () => {
    expect(chipFor("[cmd:bookmark:spya-zzzzzz]", executor(), BLOCKS)).toBeNull();
    expect(chipFor("[cmd:bookmark:spya-k3m9qt]", executor(), BLOCKS)).toEqual({
      proposal: { id: "bookmark", blockId: "spya-k3m9qt" },
      enabled: true,
    });
  });

  it("opens the entry, and spends nothing, when the glossary already has the term", () => {
    expect(chipFor("[cmd:glossary-ask:free%20ENERGY]", executor(), BLOCKS)).toEqual({
      proposal: { id: "glossary-open", termId: "spya-g7w2dn" },
      shown: "Free energy",
      enabled: true,
    });
    expect(chipFor("[cmd:glossary-ask:fe]", executor(), BLOCKS)?.proposal.id).toBe("glossary-open");
  });

  it("offers the paid look-up for a term the glossary lacks", () => {
    expect(chipFor("[cmd:glossary-ask:qualia]", executor(), BLOCKS)).toEqual({
      proposal: { id: "glossary-ask", term: "qualia" },
      enabled: true,
    });
  });

  it("draws a chip it cannot run as not enabled, rather than hiding or running it", () => {
    const { bookmark: _b, "glossary-ask": _g, ...rest } = executor().runners;
    const without: CommandExecutor = { runners: rest, sources: executor(false).sources };
    expect(chipFor("[cmd:bookmark:spya-k3m9qt]", without, BLOCKS)?.enabled).toBe(false);
    expect(chipFor("[cmd:glossary-ask:qualia]", without, BLOCKS)).toEqual({
      proposal: { id: "glossary-ask", term: "qualia" },
      enabled: false,
    });
  });
});

describe("the server's citation counters", () => {
  it("do not count a block id inside a token as a citation", () => {
    const answer = "He says so [spya-k3m9qt]. [cmd:bookmark:spya-p7w2dn]";
    const citable = citableText(answer);
    expect(citable).toContain("spya-k3m9qt");
    expect(citable).not.toContain("spya-p7w2dn");
    expect(citable.length).toBe(answer.length);
  });

  it("still count one in a bracket that is not token-shaped", () => {
    expect(citableText("[cmd:bookmark:spya-p7w2dn now]")).toContain("spya-p7w2dn");
  });
});
