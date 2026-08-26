/**
 * A fetched page must not be able to write itself to the server's stderr.
 *
 * src/extract.ts builds a JSDOM from HTML we did not write. JSDOM's **default**
 * virtual console forwards its own errors straight to `console`, and one of
 * them quotes the page: a malformed `@import` produces
 *
 *   Could not parse CSS @import URL "<what the page said>"
 *   relative to base URL "<the full source URL, query string and all>"
 *
 * That goes round Pino, `errorFields` and redaction alike — none of which can
 * reach a string somebody else's library printed. docs/project/logging.md
 * forbids it, and nothing in this repo could have caught it, because the leak
 * is a dependency's rather than ours.
 *
 * Found by a GPT Sol review on 2026-08-26, the fourth round of that class.
 *
 * **The first assertion is the load-bearing one.** It proves the default really
 * does leak, using the same input. Without it, this file would go green the day
 * JSDOM changed its default or the `@import` branch moved — testing nothing,
 * and looking exactly like a passing test. That mistake was made twice earlier
 * the same day, which is why it is spelled out here.
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { describe, expect, it } from "vitest";

/** An `@import` href `new URL()` genuinely rejects: unterminated IPv6 bracket. */
const PAGE = `<html><head><style>@import "http://[LEAKED-PAGE-TEXT";</style></head><body><p>hi</p></body></html>`;
const SOURCE = "https://source.example/article?token=LEAKED-URL";

/** Everything written to console.error / console.warn while `run` executes. */
async function consoleFrom(run: () => void): Promise<string[]> {
  const lines: string[] = [];
  const error = console.error;
  const warn = console.warn;
  console.error = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  console.warn = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    run();
    // The scan runs during parse, but give any queued emit a turn regardless.
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    console.error = error;
    console.warn = warn;
  }
  return lines;
}

describe("JSDOM's console, on a page we did not write", () => {
  it("really does print the page and the source URL when left at its default", async () => {
    const lines = await consoleFrom(() => void new JSDOM(PAGE, { url: SOURCE }));
    const leaked = lines.join("\n");
    expect(leaked, "JSDOM no longer leaks here — the test below now proves nothing").toContain(
      "LEAKED-PAGE-TEXT",
    );
    expect(leaked).toContain("LEAKED-URL");
  });

  it("prints nothing at all with the virtual console extract.ts passes", async () => {
    const lines = await consoleFrom(
      () => void new JSDOM(PAGE, { url: SOURCE, virtualConsole: new VirtualConsole() }),
    );
    expect(lines).toEqual([]);
  });

  it("is what src/extract.ts actually does", async () => {
    // Pinned by reading the source: the alternative is a test that passes while
    // the real call site quietly goes back to the default.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/extract.ts", import.meta.url), "utf8");
    expect(src).toMatch(/virtualConsole:\s*new VirtualConsole\(\)/);
  });
});
