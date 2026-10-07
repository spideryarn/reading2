// @vitest-environment jsdom
/**
 * **What Help's Markdown machinery refuses, and what its text form says**:
 * src/web/help/help-front-matter.ts, help-pages.ts, help-markdown.tsx.
 * docs/plans/261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md
 * § The Markdown, and how it becomes a page.
 *
 * The files are ours, so the machinery throws on anything it does not draw
 * rather than drawing it wrongly, and tests/help-page.test.tsx turns a throw
 * into a red test by rendering the page. That only works if the throws
 * happen, and the 50 real files are all well formed, so none of them shows
 * one. These are the refusals, each seen.
 */
import { globSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PUBLIC_SHELF_LABEL } from "../src/messages.js";
import { MODE_CATALOG } from "../src/mode-catalog.js";
import { MODES } from "../src/modes.js";
import { MODE_LABEL } from "../src/title-text.js";
import { CHANGELOG_LABEL } from "../src/web/router.js";
import {
  FAQ_IDS,
  HELP_ANCHORS,
  HELP_GUIDE_IDS,
  HELP_TOPIC_IDS,
  helpHref,
} from "../src/web/help/help-anchors.js";
import { readFrontMatter } from "../src/web/help/help-front-matter.js";
import {
  expandHelpTokens,
  helpMarkdownText,
  helpSectionText,
  renderHelpMarkdown,
  renderHelpModeHalves,
} from "../src/web/help/help-markdown.js";
import { HELP_IMAGES } from "../src/web/help/help-images.js";
import { HELP_TOPIC_FILES, HELP_TOPIC_PAGES } from "../src/web/help/help-pages.js";

const html = (md: string): string => renderToStaticMarkup(<>{renderHelpMarkdown(md, "t")}</>);

describe("the page files", () => {
  it("registers every Markdown file under pages", () => {
    const registered = [
      ...HELP_TOPIC_IDS.map((id) => `${id}.md`),
      ...MODES.map((mode) => `modes/${mode}.md`),
      ...FAQ_IDS.map((id) => `questions/${id}.md`),
      ...HELP_GUIDE_IDS.map((id) => `guides/${id}.md`),
    ].sort();
    const onDisk = globSync("**/*.md", { cwd: "src/web/help/pages" }).sort();

    expect(onDisk).toEqual(registered);
  });
});

describe("the front matter", () => {
  const shape = { required: ["title", "keywords"], optional: ["related"] } as const;
  const read = (raw: string) => readFrontMatter(raw, shape, "t");

  it("reads keys, keeps a colon in a value, and returns the body", () => {
    const { meta, body } = read("---\ntitle: Your data: export\nkeywords: a b\n---\n\nWords.\n");
    expect(meta).toEqual({ title: "Your data: export", keywords: "a b" });
    expect(body).toBe("Words.");
  });

  it.each([
    ["no opening fence", "title: x\nkeywords: a\n---\nb", /first line must be ---/],
    ["never closed", "---\ntitle: x\nkeywords: a\nb", /never closed/],
    ["a missing key", "---\ntitle: x\n---\nb", /missing "keywords"/],
    ["an unknown key", "---\ntitle: x\nkeywords: a\nauthor: me\n---\nb", /unknown front matter key "author"/],
    ["a key twice", "---\ntitle: x\ntitle: y\nkeywords: a\n---\nb", /appears twice/],
    ["an empty value", "---\ntitle:\nkeywords: a\n---\nb", /"title" is empty/],
  ])("throws on %s", (_name, raw, message) => {
    expect(() => read(raw)).toThrow(message);
  });

  it("every topic has a summary that is one sentence of its own", () => {
    for (const page of Object.values(HELP_TOPIC_PAGES)) {
      expect(page.summary).toMatch(/^[A-Z].{30,}\.$/);
      expect(page.summary).not.toBe(page.title);
    }
  });
});

describe("drawing a file", () => {
  it("draws the elements the page styles, and nothing else", () => {
    const out = html("A **b** *c* `d` <kbd>E</kbd>.\n\n- one\n  - inner\n- two\n\n## Sub");
    expect(out).toContain("<p>A <strong>b</strong> <em>c</em> <code>d</code> <kbd>E</kbd>.</p>");
    expect(out).toContain("<ul><li>one<ul><li>inner</li></ul></li><li>two</li></ul>");
    expect(out).toMatch(/<h2[^>]*>Sub<\/h2>/);
  });

  it("draws a link to a page of Help, to a question, and to another page of the site", () => {
    const md = "[a](/help/spine) [b](/help/questions#faq-older-profile) [c](/pricing)";
    expect(html(md)).toMatch(
      /href="\/help\/spine".*href="\/help\/questions#faq-older-profile".*href="\/pricing"/,
    );
    /* A Help link's address is `helpHref` of the anchor it names. */
    expect(html("[a](/help/spine)")).toContain(`href="${helpHref("spine")}"`);
  });

  it.each([
    ["other HTML", "A <span>b</span>.", /only HTML allowed is <kbd>/],
    ["a block of HTML", "<div>\nx\n</div>", /nothing draws a "html"/],
    ["an unclosed kbd", "Press <kbd>Enter.", /never closed/],
    ["an unknown token", "A {{nonsense}}.", /unknown token \{\{nonsense\}\}/],
    ["half a token", "A {{public-shelf-label.", /not closed/],
    ["the table inside a sentence", "See {{modes-table}} here.", /alone in its own paragraph/],
    ["a link to a page that does not exist", "[a](/help/nowhere)", /names no live Help page/],
    ["a link to a retired anchor", "[a](/help/mode-trajectory)", /names no live Help page/],
    ["a question outside questions#", "[a](/help/faq-older-profile)", /should be \/help\/questions#faq-older-profile/],
    ["a link off the site", "[a](https://example.com)", /must be a path on this site/],
    ["a numbered list", "1. one\n2. two", /numbered lists/],
    ["a loose list", "- one\n\n- two", /blank line/],
    ["a deeper heading", "### Three", /only ## headings/],
    ["a block quote", "> quoted", /nothing draws a "blockquote"/],
    ["an image inside a sentence", 'See ![alt](images/x.png "Cap.") here.', /alone in its own paragraph/],
    ["two images in one paragraph", '![a](images/x.png "A.")\n![b](images/x.png "B.")', /alone in its own paragraph/],
    ["an image in a list", '- ![alt](images/x.png "Cap.")', /alone in its own paragraph/],
    ["an image inside a link", '[![alt](images/x.png "Cap.")](/help/spine)', /alone in its own paragraph/],
    ["an image with no caption", "![alt](images/x.png)", /needs a caption/],
    ["an image with no alt", '![](images/x.png "Cap.")', /needs alt text/],
    ["an image not in the manifest", '![alt](images/nowhere.png "Cap.")', /not in help-images.ts/],
    ["an image off the site", '![alt](https://example.com/x.png "Cap.")', /images\/<name>/],
    ["an image by reference", "![alt][x]\n\n[x]: images/x.png", /nothing draws a "imageReference"/],
  ])("throws on %s", (_name, md, message) => {
    expect(() => html(md)).toThrow(message);
    /* The text walk refuses the same files, so search cannot index what the page cannot draw. */
    expect(() => helpMarkdownText(md, "t")).toThrow();
  });

  it("draws an image alone in its paragraph as a figure, its title the caption", () => {
    const [name, image] = Object.entries(HELP_IMAGES).find(([, i]) => i.still === undefined) ?? [];
    if (name === undefined || image === undefined) throw new Error("help-images.ts has no still pictures");
    for (const path of [`images/${name}`, `../images/${name}`]) {
      const out = html(`![What it shows](${path} "The caption.")`);
      expect(out).toMatch(/^<figure[^>]*><img [^>]*\/?><figcaption[^>]*>The caption\.<\/figcaption><\/figure>$/);
      expect(out).toContain(`src="${image.src}"`);
      expect(out).toContain('alt="What it shows"');
      /* Drawn at half the file's pixels: every picture is shot at 2×. */
      expect(out).toContain(`width="${image.w / 2}"`);
      expect(out).toContain(`height="${image.h / 2}"`);
    }
    /* A straight quote in a caption is written escaped, and arrives whole. */
    expect(html(`![x](images/${name} "A \\"quoted\\" word.")`)).toContain(">A &quot;quoted&quot; word.</figcaption>");
    /* A GIF is drawn with its still for a reader who asked for less motion. */
    const gif = Object.entries(HELP_IMAGES).find(([, i]) => i.still !== undefined);
    if (gif !== undefined) {
      const out = html(`![x](images/${gif[0]} "Moves.")`);
      expect(out.toLowerCase()).toContain(
        `<picture><source media="(prefers-reduced-motion: reduce)" srcset="${gif[1].still?.src}"/><img `.toLowerCase(),
      );
    }
    /* In the text walk a figure is its caption, so search finds it. */
    expect(helpMarkdownText(`A.\n\n![What it shows](images/${name} "The caption.")`, "t")).toBe("A.\nThe caption.");
  });

  it("splits a mode's file into its two halves, and a missing half is null", () => {
    const both = renderHelpModeHalves("## When to use it\n\nA.\n\n## Reading it\n\nB.", "t");
    expect(renderToStaticMarkup(<>{both.whenToUse}</>)).toBe("<p>A.</p>");
    expect(renderToStaticMarkup(<>{both.reading}</>)).toBe("<p>B.</p>");
    expect(renderHelpModeHalves("## Reading it\n\nB.", "t").whenToUse).toBeNull();
    expect(renderHelpModeHalves("## When to use it\n\nA.", "t").reading).toBeNull();
  });

  it.each([
    ["words before the first heading", "A.\n\n## Reading it\n\nB.", /must start with a ## heading/],
    ["a misspelt heading", "## When to use\n\nA.", /a mode's headings are/],
    ["the halves out of order", "## Reading it\n\nB.\n\n## When to use it\n\nA.", /repeated or out of order/],
    ["a half twice", "## Reading it\n\nB.\n\n## Reading it\n\nC.", /repeated or out of order/],
  ])("a mode's file throws on %s", (_name, md, message) => {
    expect(() => renderHelpModeHalves(md, "t")).toThrow(message);
  });
});

describe("the tokens", () => {
  const experimental = MODES.filter((m) => MODE_CATALOG[m].experimental).map((m) => MODE_LABEL[m]);

  it("stand for the labels in code, on the page and in the text", () => {
    expect(html("[{{public-shelf-label}}](/read/public)")).toContain(`>${PUBLIC_SHELF_LABEL}</a>`);
    expect(helpMarkdownText("{{whats-new-label}}.", "t")).toBe(`${CHANGELOG_LABEL}.`);
    const list = helpMarkdownText("{{experimental-modes}}", "t");
    expect(experimental.length).toBeGreaterThan(1);
    for (const label of experimental) expect(list).toContain(label);
    expect(list).toMatch(/, .* and /);
  });

  it("the table is drawn as a table, with a row for every mode", () => {
    const out = html("{{modes-table}}");
    expect(out).toContain("<table");
    for (const m of MODES) expect(out).toContain(`href="/help/mode-${m}"`);
  });

  it("expandHelpTokens leaves Markdown, with the table as a list and no token behind", () => {
    const out = expandHelpTokens(HELP_TOPIC_FILES.modes);
    expect(out).not.toContain("{{");
    expect(out.match(/^- \*\*.+\*\*.*: reach for it when /gm)?.length).toBe(MODES.length);
    expect(out).toContain(`- **${MODE_LABEL.chat}**: reach for it when you have a question of your own`);
    expect(() => expandHelpTokens("{{nonsense}}")).toThrow(/unknown token/);
  });
});

describe("a section's plain text", () => {
  it("exists for every anchor, with no Markdown or token left in it", () => {
    for (const anchor of HELP_ANCHORS) {
      const text = helpSectionText(anchor);
      expect(text.length, anchor).toBeGreaterThan(40);
      expect(text, anchor).not.toMatch(/\{\{|\*\*|<kbd>|\]\(/);
    }
  });

  it("says what the page says", () => {
    expect(helpSectionText("spine")).toContain("It is proportional — a part that fills half the piece");
    expect(helpSectionText("keyboard")).toContain("⌘K (Mac) or Ctrl K opens the command bar.");
    expect(helpSectionText("mode-plain")).toMatch(/^When to use it\nFor reading straight through\./);
    expect(helpSectionText("modes")).toContain(`${MODE_LABEL.chat}: reach for it when you have a question of your own`);
  });
});
