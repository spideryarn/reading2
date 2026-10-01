/**
 * **A word too long for the column breaks, whether or not it is a link.**
 *
 * `.prose a` had `overflow-wrap: break-word` and nothing else did, so a URL the
 * extractor left as plain text — common from a scan or a PDF — pushed a 390px
 * page 25px sideways (`fowler-phrenology`'s "Persistent URL" line, 2026-10-01,
 * docs/plans/261001f-long-url-wraps-and-chat-latest-pill-clears-the-text.md).
 * The declaration belongs on `.prose` itself, where every block inherits it.
 *
 * Only the browser can see the wrap; this pins the rule that makes it.
 */
import { describe, expect, it } from "vitest";
import { readerCssNoComments } from "./helpers/stylesheets.js";

const CSS = readerCssNoComments();

describe("long words in the prose", () => {
  it("`.prose` itself declares only overflow-wrap: break-word, so bare text breaks without shrinking a table's min-content width", () => {
    // `.prose {` exactly — not `.prose a`, `.prose pre`, or a compound selector.
    const rules = [...CSS.matchAll(/(?:^|})\s*\.prose\s*\{([^}]*)\}/g)].map((m) => m[1] ?? "");
    expect(rules.length).toBeGreaterThan(0);
    const values = rules.flatMap((body) =>
      [...body.matchAll(/(?:^|;)\s*overflow-wrap:\s*([^;}]+)\s*(?:;|$)/g)].map((m) => m[1]?.trim()),
    );
    /* `some(break-word)` would stay green if a later `.prose` rule restored
       `normal` or chose `anywhere`; the cascade would then undo the fix. */
    expect(values).toEqual(["break-word"]);
  });
});
