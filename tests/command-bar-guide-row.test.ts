/**
 * **The bar's *Guide* row** — plan
 * docs/plans/261009i-the-guide-greets-in-chat-takes-live-and-a-bar-row.md
 * (Greg, 2026-10-09, `spya-s6qhzv`: *"there should be a command in the command
 * bar for opening the guide chat"*).
 *
 * Drawn only where the page hands over `openGuide` (the owner's reading view),
 * first for `guide` though Help also has that word, and pressing it opens the
 * guide and spends nothing.
 */
import { describe, expect, it, vi } from "vitest";
import { besideTheModes } from "../src/web/CommandBar.js";
import { type Command, rankCommands } from "../src/web/command-match.js";

const label = (c: Command | undefined): string | undefined => (c !== undefined && "label" in c ? c.label : undefined);

const queue = { run: async () => null, lastFailure: () => null };

function rows(openGuide?: () => { kind: "close" }): readonly Command[] {
  return besideTheModes({
    article: {
      slug: "a-piece",
      search: "",
      view: "article",
      help: "/help/mode-chat",
      executor: { runners: {}, sources: {}, ...(openGuide ? { openGuide } : {}) },
    },
    openComments: undefined,
    openFeedback: null,
    queue,
  });
}

describe("the Guide row", () => {
  it("comes first for `guide`, with Help still in the list", () => {
    const ranked = rankCommands("guide", rows(() => ({ kind: "close" })));
    expect(label(ranked[0])).toBe("Guide");
    expect(ranked.map(label)).toContain("Help");
  });

  it("is not drawn where the page cannot open the guide", () => {
    expect(rows().map(label)).not.toContain("Guide");
  });

  it("opens the guide, and generates nothing", () => {
    const open = vi.fn(() => ({ kind: "close" }) as const);
    const guide = rows(open).find((c) => label(c) === "Guide");
    expect(guide?.kind).toBe("action");
    if (guide?.kind !== "action") return;
    expect(guide.generates).toBe(false);
    guide.run();
    expect(open).toHaveBeenCalledOnce();
  });
});
