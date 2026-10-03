/**
 * **`show_passage`, answered in the browser: only ids the article has become a
 * pointer, and the model is told the truth about the rest.**
 * `shownPassage` in src/web/live/session-shared.ts, which both live engines call.
 *
 * The browser check of 2026-10-03 is the case this file exists for. GPT-Live's
 * backend pointed at `spya-gm3xu0a`; the article's id is `spya-gm3xu0`. The id
 * was kept unchecked, the model was told "Showed the reader 1 passage.", and
 * when the exchange was written the server refused the whole of it ("a passage
 * pointed at something that is not in this article"). The call ended and the
 * reader's words were never stored.
 */
import { describe, expect, it } from "vitest";

import { POINTER_MAX_IDS, shownPassage } from "../src/web/live/session-shared.js";

/** The article: six paragraphs. */
const ARTICLE = new Set(["spya-gm3xu0", "spya-k3m9qt", "spya-aaaaaa", "spya-bbbbbb", "spya-cccccc", "spya-dddddd"]);

describe("an id the article does not have", () => {
  it("is dropped from the pointer, and the model is told which one", () => {
    const shown = shownPassage({ blockIds: ["spya-k3m9qt", "spya-gm3xu0a", "spya-aaaaaa"], why: "the divide" }, ARTICLE);
    expect(shown.blockIds).toEqual(["spya-k3m9qt", "spya-aaaaaa"]);
    expect(shown.why).toBe("the divide");
    expect(shown.output).toBe("Showed the reader 2 passages. 1 id was not in the article: spya-gm3xu0a.");
    expect(shown.detail).toBe("spya-k3m9qt spya-aaaaaa");
  });

  it("leaves no pointer at all when it was the only one, and says nothing was shown", () => {
    const shown = shownPassage({ blockIds: ["spya-gm3xu0a"], why: "the divide" }, ARTICLE);
    expect(shown.blockIds).toEqual([]);
    expect(shown.output).toBe("None of those ids are in the article; nothing was shown. Not in the article: spya-gm3xu0a.");
    expect(shown.detail).not.toContain("spya-");
  });

  it("is dropped when it is well formed and simply not this article's", () => {
    const shown = shownPassage({ blockIds: ["spya-zzzzzz", "spya-gm3xu0"] }, ARTICLE);
    expect(shown.blockIds).toEqual(["spya-gm3xu0"]);
    expect(shown.output).toBe("Showed the reader 1 passage. 1 id was not in the article: spya-zzzzzz.");
  });

  it("is checked for its shape even where there is no article to ask", () => {
    /* The preview page (preview/live.html) mounts the hook with no article. */
    const shown = shownPassage({ blockIds: ["spya-k3m9qt", "spya-gm3xu0a", "paragraph four"] });
    expect(shown.blockIds).toEqual(["spya-k3m9qt"]);
    expect(shown.output).toBe("Showed the reader 1 passage. 2 ids were not in the article: spya-gm3xu0a, paragraph four.");
  });
});

describe("something that is not an id", () => {
  /* GPT Sol's D5 probe: `[null]` became the string "null". */
  it("is dropped, never turned into a string", () => {
    const shown = shownPassage({ blockIds: [null, 7, { id: "spya-k3m9qt" }, ["spya-k3m9qt"], "spya-k3m9qt"] }, ARTICLE);
    expect(shown.blockIds).toEqual(["spya-k3m9qt"]);
    expect(shown.output).toBe("Showed the reader 1 passage. 4 of the values given were not ids.");
  });

  it("leaves no pointer when nothing given was one", () => {
    expect(shownPassage({ blockIds: [null] }, ARTICLE)).toMatchObject({
      blockIds: [],
      output: "None of those ids are in the article; nothing was shown. 1 of the values given was not an id.",
    });
    expect(shownPassage({ blockIds: "spya-k3m9qt" }, ARTICLE)).toMatchObject({
      blockIds: [],
      output: "No block ids were given; nothing was shown.",
    });
    expect(shownPassage({ blockIds: [] }, ARTICLE)).toMatchObject({
      blockIds: [],
      output: "No block ids were given; nothing was shown.",
    });
  });

  it("cannot make the tool result long, however long the string is", () => {
    const shown = shownPassage({ blockIds: ["x".repeat(5_000)] }, ARTICLE);
    expect(shown.output.length).toBeLessThan(200);
  });
});

describe("more ids than the prompt asks for", () => {
  /* The backend prompt says "two or three at most"; the browser check got eight. */
  it("shows the first four the article has, and says so", () => {
    expect(POINTER_MAX_IDS).toBe(4);
    const shown = shownPassage(
      { blockIds: ["spya-gm3xu0", "spya-nope99", "spya-k3m9qt", "spya-aaaaaa", "spya-bbbbbb", "spya-cccccc", "spya-dddddd"] },
      ARTICLE,
    );
    expect(shown.blockIds).toEqual(["spya-gm3xu0", "spya-k3m9qt", "spya-aaaaaa", "spya-bbbbbb"]);
    expect(shown.output).toBe(
      "Showed the reader the first 4 passages of the 6 given; 4 is the most shown at once. 1 id was not in the article: spya-nope99.",
    );
    expect(shown.detail).toBe("spya-gm3xu0 spya-k3m9qt spya-aaaaaa spya-bbbbbb");
  });

  it("counts an id given twice once", () => {
    const shown = shownPassage({ blockIds: ["spya-gm3xu0", "spya-gm3xu0", "spya-k3m9qt"] }, ARTICLE);
    expect(shown.blockIds).toEqual(["spya-gm3xu0", "spya-k3m9qt"]);
    expect(shown.output).toBe("Showed the reader 2 passages.");
  });
});

describe("an ordinary pointer", () => {
  it("is unchanged", () => {
    expect(shownPassage({ blockIds: ["spya-k3m9qt"], why: "where it says so" }, ARTICLE)).toEqual({
      blockIds: ["spya-k3m9qt"],
      why: "where it says so",
      output: "Showed the reader 1 passage.",
      label: "pointed at",
      detail: "spya-k3m9qt",
    });
  });
});
