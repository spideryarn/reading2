/**
 * **The Help pages as the Help chatbot is handed them** —
 * src/help-corpus.generated.json. Plan docs/plans/261007k-help-chatbot.md,
 * GPT Sol's F3 on it.
 *
 * **This file is the generator and the check**, as
 * tests/command-pick-catalogue.test.ts is for the bar's rows, and for the same
 * reason: the Help's pages are Vite `?raw` imports (src/web/help/help-pages.ts),
 * so nothing outside Vitest or the browser can read them, and the server must
 * not read `src/web/` at run time. The last test builds the corpus again and
 * fails when the checked-in file differs. To regenerate:
 *
 *     WRITE_HELP_CORPUS=1 npx vitest run tests/help-corpus.test.ts
 *
 * **Built from the Help's own sources of truth, not from the files alone**: the
 * order is `HELP_GROUPS` (what the contents page shows), the title, summary and
 * keywords are `helpEntry`'s, a mode's page is in the order the page draws it
 * — its `In short`, then the mode catalog's two sentences under *How it works*
 * (they are not in its file), then the rest, split by the page's own parser
 * (`helpModeSections`) — every `{{…}}` token is expanded by
 * `expandHelpTokens`, and each page's address is `helpHref` — so a question is
 * `/help/questions#faq-…`, never `/help/faq-…`.
 *
 * A Help page edited without regenerating is a red test here, not a chatbot
 * answering from yesterday's Help.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { HelpCorpusPage } from "../src/help-chat.js";
import { MODE_CATALOG } from "../src/mode-catalog.js";
import { HELP_ANCHORS, helpAnchorKind, helpHref, type HelpAnchor } from "../src/web/help/help-anchors.js";
import { HELP_GROUPS, helpEntry } from "../src/web/help/help-content.js";
import { expandHelpTokens, helpModeSections } from "../src/web/help/help-markdown.js";
import { helpPage } from "../src/web/help/help-pages.js";

const FILE = path.join(import.meta.dirname, "..", "src", "help-corpus.generated.json");
const REGENERATE = "WRITE_HELP_CORPUS=1 npx vitest run tests/help-corpus.test.ts";

/**
 * **A picture line, as words**: `![alt](images/x.png "caption")` becomes
 * `(Picture: alt. Caption: caption)`. The model cannot see the picture, a
 * reader could not use its path, and an answer that copied the markup would
 * show its characters. A line that is not exactly one picture is left alone,
 * and the test above fails on any `![` that gets through.
 */
function pictureInWords(body: string): string {
  return body.replace(/^!\[([^\]]*)\]\(\S+?(?: "([^"]*)")?\)$/gm, (_line, alt: string, caption?: string) =>
    caption ? `(Picture: ${alt}. Caption: ${caption})` : `(Picture: ${alt})`,
  );
}

/**
 * A mode's page in the order the page draws it (help-content.tsx § helpBody):
 * its opening, then the catalog's two sentences under *How it works*, then the
 * rest of its file.
 */
function bodyOf(anchor: HelpAnchor): string {
  const markdown = expandHelpTokens(helpPage(anchor).body, anchor).trim();
  const kind = helpAnchorKind(anchor);
  if (kind.kind !== "mode") return pictureInWords(markdown);
  const catalog = MODE_CATALOG[kind.mode];
  const { inShort, whenToUse, reading } = helpModeSections(markdown, anchor);
  const parts = [inShort.markdown, `## How it works\n\n${catalog.description}.\n\n${catalog.how}`, whenToUse?.markdown, reading?.markdown];
  return pictureInWords(parts.filter((p) => p !== undefined).join("\n\n"));
}

const built: HelpCorpusPage[] = HELP_GROUPS.flatMap((group) =>
  group.anchors.map((anchor) => {
    const entry = helpEntry(anchor);
    return {
      anchor,
      href: helpHref(anchor),
      group: group.title,
      title: entry.title,
      summary: entry.summary,
      keywords: entry.search.keywords,
      experimental: entry.experimental,
      body: bodyOf(anchor),
    };
  }),
);
const text = `${JSON.stringify(built, null, 1)}\n`;

describe("src/help-corpus.generated.json", () => {
  it("holds every live Help anchor once, in the contents page's order", () => {
    expect(built.map((p) => p.anchor).sort()).toEqual([...HELP_ANCHORS].sort());
    expect(new Set(built.map((p) => p.anchor)).size).toBe(built.length);
  });

  it("gives a question its place on the questions' page, and every other page its own address", () => {
    const question = built.find((p) => p.anchor.startsWith("faq-"));
    expect(question?.href).toBe(`/help/questions#${question?.anchor}`);
    expect(built.find((p) => p.anchor === "spine")?.href).toBe("/help/spine");
  });

  it("expands every token, so no page shows the model a {{…}}", () => {
    for (const page of built) expect(page.body, page.anchor).not.toMatch(/\{\{|\}\}/);
  });

  it("says what a picture shows in words, and never hands the model image markup", () => {
    /* A picture line copied into an answer would be drawn as its characters
       (Cited shows an image as source), and its file path is no use to a
       reader. The words of it are: the alt text and the caption. */
    for (const page of built) expect(page.body, page.anchor).not.toMatch(/!\[|images\//);
    const spine = built.find((p) => p.anchor === "jumping-around");
    expect(spine?.body).toContain("(Picture: A click on the spine jumps to another section");
  });

  it("gives a mode's page in the page's order: In short, its picture, How it works with the catalog's sentences, then the rest", () => {
    const glossary = built.find((p) => p.anchor === "mode-glossary")?.body ?? "";
    const at = (s: string) => {
      const i = glossary.indexOf(s);
      expect(i, s).toBeGreaterThanOrEqual(0);
      return i;
    };
    expect(glossary.startsWith("## In short\n\n")).toBe(true);
    const order = [
      at("## In short"),
      at("(Picture: "),
      at("## How it works"),
      at(`${MODE_CATALOG.glossary.description}.`),
      at(MODE_CATALOG.glossary.how),
      at("## When to use it"),
      at("## Reading it"),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it.runIf(process.env.WRITE_HELP_CORPUS === "1")("is written", () => {
    writeFileSync(FILE, text);
  });

  it("is what the Help pages say today", () => {
    let onDisk = "";
    try {
      onDisk = readFileSync(FILE, "utf8");
    } catch {
      /* Reported below, with the command. */
    }
    expect(onDisk === text, `src/help-corpus.generated.json is not what the Help pages say now. Regenerate it:\n  ${REGENERATE}`).toBe(
      true,
    );
  });
});
