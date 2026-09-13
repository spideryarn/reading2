/**
 * **The privacy policy has to stay true of the code**, and the part that will
 * go stale first is the list of models a reader's text reaches.
 *
 * The page names them — `claude-sonnet-5`, `gpt-5.6-luna` and the rest — because
 * a policy that says "an AI provider" and stops has told the reader nothing
 * they could check. Naming them is only worth anything if the names are still
 * the ones being sent, and nothing about swapping a model would make anybody
 * open PrivacyPage.tsx. So this test does: add a model to `DISPLAY_NAME` and it
 * goes red naming the page, exactly as `tests/models.test.ts` goes red when
 * `DISPLAY_NAME` itself falls behind the tiers.
 *
 * **The page cannot import the table**, which is why this reads the file as
 * text. `src/models.ts` is a server module — it reaches `src/embeddings.ts` and
 * from there into `node:` — and the client's import graph is asserted closed
 * (tests/client-imports.test.ts). A shared leaf holding just the ids was the
 * alternative and it is not worth a module: the drift is caught either way, and
 * this way the policy stays readable prose rather than a template.
 *
 * The two live-conversation models are checked from `src/live.ts` for the same
 * reason and with the same excuse — that file opens a database pool.
 *
 * **What this test does not check** is everything else on the page: the
 * regions, the retention windows, the subprocessor list, whether we still mean
 * what it says about reading your articles. Those are prose about arrangements
 * rather than about constants, and docs/project/website-text.md lists them as
 * the things to re-read when they move. A test that pretended to cover them
 * would be the worse kind of green.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DISPLAY_NAME } from "../src/models.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * The page with its comments removed — **the prose a reader actually sees**,
 * near enough.
 *
 * The first version of this test searched the raw file, and GPT Sol found the
 * hole in it: this file is heavily commented, several of those comments name a
 * model, and a policy that had stopped naming `voyage-4` on the page would go
 * on passing because the word survived in a comment explaining why it was once
 * there. That is exactly [silent success](docs/reusable/silent-success.md) —
 * the check shares an assumption with the thing it checks.
 *
 * Stripping block comments and JSX `{​/* … *​/}` braces is not a parser and does
 * not pretend to be. It is the cheap version of "look at the rendered text",
 * and the assertion below that it removed something is what stops the regex
 * quietly matching nothing and handing back the whole file again.
 */
const PAGE = (() => {
  const raw = readFileSync(path.join(ROOT, "src/web/PrivacyPage.tsx"), "utf8");
  return raw.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
})();

describe("the privacy page", () => {
  it("is reading the prose rather than the comments", () => {
    /* The positive control for the stripping above. Without it a regex that
       matched nothing would leave `PAGE` as the whole file and every assertion
       below would keep passing while checking the wrong text. The header of
       "GPT Sol" appears three times in the page's comments and nowhere in its
       prose, so its absence is proof the comments went. */
    expect(PAGE).not.toContain("GPT Sol");
    expect(PAGE).toContain("Last updated");
  });

  it("names every model this app can send text to", () => {
    /* `DISPLAY_NAME` maps several wire ids onto one readable name — both
       spellings of Claude land on `claude-sonnet-5` — and the readable name is
       what the page should carry. src/models.ts § DISPLAY_NAME. */
    const missing = [...new Set(Object.values(DISPLAY_NAME))].filter(
      (name) => !PAGE.includes(name),
    );
    expect(missing, "models missing from src/web/PrivacyPage.tsx").toEqual([]);
  });

  it("names the live-conversation models", () => {
    /* Read out of src/live.ts rather than imported: importing it opens a pool.
       The regex is anchored on the `export const` so a mention in a comment
       cannot satisfy it. */
    const live = readFileSync(path.join(ROOT, "src/live.ts"), "utf8");
    const ids = [...live.matchAll(/export const LIVE_(?:MODEL|TRANSCRIBER) = "([^"]+)"/g)].map(
      (m) => m[1] as string,
    );
    /* A positive control on the extraction itself: if the shape of those two
       declarations ever changes, `ids` goes empty and the assertion below
       passes over nothing at all — silent success, and the page would stop
       being checked without a test going red. docs/reusable/silent-success.md. */
    expect(ids).toHaveLength(2);
    expect(ids.filter((id) => !PAGE.includes(id))).toEqual([]);
  });

  it("says a bug report may carry the reader's own article, and no longer that it never does", () => {
    /* Plan 260913a. The section's last paragraph used to promise that a report
       never carries the article's text; since the tick-box can attach the
       reader's own article to the Sentry copy, that sentence would be false.
       Whitespace is collapsed because the JSX wraps its lines. */
    const prose = PAGE.replace(/\s+/g, " ");
    expect(prose).toContain("the report may also carry that article");
    expect(prose).toContain("though a screenshot you add will show whatever was on your screen");
    expect(prose).toContain("A bug report never carries your notes");
    expect(prose).not.toContain("never carries is the text of the article");
  });

  it("gives the one contact address rather than spelling one of its own", () => {
    /* docs/project/website-text.md: one address, in src/site-text.ts. A page
       that typed it out would be the second copy that goes stale after a
       domain move. */
    expect(PAGE).toContain("CONTACT_EMAIL");
    expect(PAGE).not.toMatch(/@spideryarn\.com/);
  });
});
