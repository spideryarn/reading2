/**
 * How a block id is shown and linked — src/web/BlockRef.tsx.
 *
 * Two pure functions out of a component file, and both are worth pinning
 * because both fail *quietly*. A prefix stripped by the wrong number of
 * characters still looks like an id; a link that drops the rest of the query
 * string still navigates, just to a different view of the article than the one
 * the reader was looking at. See docs/project/block-ids.md#showing-an-id.
 */
import { afterEach, describe, expect, it } from "vitest";
import { blockHref, shortBlockId } from "../src/web/BlockRef.js";

describe("shortBlockId", () => {
  it("drops the prefix every id on screen shares", () => {
    expect(shortBlockId("spya-k3m9qt")).toBe("k3m9qt");
  });

  it("leaves an id that isn't ours alone rather than eating five characters", () => {
    expect(shortBlockId("main-content")).toBe("main-content");
  });
});

/** `blockHref` reads the live address, which in node is ours to supply. */
function atLocation(pathname: string, search: string): void {
  Object.defineProperty(globalThis, "location", {
    value: { pathname, search },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis as object, "location");
});

describe("blockHref", () => {
  it("points ?at= at the block, on this article", () => {
    atLocation("/read/example", "");
    expect(blockHref("spya-k3m9qt")).toBe("/read/example?at=spya-k3m9qt");
  });

  it("keeps the rest of the view, so the link shows what the reader is seeing", () => {
    atLocation("/read/example", "?cols=0,1&text=0");
    const href = blockHref("spya-k3m9qt");
    const params = new URLSearchParams(href.slice(href.indexOf("?")));
    expect(params.get("cols")).toBe("0,1");
    expect(params.get("text")).toBe("0");
    expect(params.get("at")).toBe("spya-k3m9qt");
  });

  it("replaces the position already in the URL rather than adding a second one", () => {
    atLocation("/read/example", "?at=spya-aaaaaa");
    expect(blockHref("spya-k3m9qt")).toBe("/read/example?at=spya-k3m9qt");
  });

  it("carries the full id, prefix and all — the short form is only for the eye", () => {
    atLocation("/read/example", "");
    expect(blockHref("spya-k3m9qt")).toContain("spya-k3m9qt");
  });
});
