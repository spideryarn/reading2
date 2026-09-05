/**
 * The byline stage 2 stores, and the whitespace the page left in it.
 *
 * Readability's `_checkByline` returns `node.textContent.trim()` — an outer
 * trim and nothing else — so a byline laid out over several source lines
 * arrives with the layout still in it:
 * `"By \n \n Natalie Wolchover\n \n \nDecember 17, 2024"` (Quanta), and on the
 * committed corpus `"Affiliation: Google Brain\n\nEmail: noam@google.com"` and
 * `"Eric Steven Raymond\n    Thyrsus Enterprises\n    <esr@thyrsus.com>"`.
 *
 * That string goes into `meta.byline`, onto the library card and into the
 * masthead, where a newline is either a line break nobody asked for or a
 * silently swallowed one.
 *
 * **And a newline is not always a space.** Between two CJK characters it renders
 * as nothing, so collapsing it to `" "` puts a word gap into a name that has
 * none — the CSS Text 3 segment-break rule, and the half of this function GPT
 * Sol found missing on 2026-09-05.
 *
 * See docs/plans/260904e-extraction-repair-evals-and-llm-post-processing.md § A.
 */
import { describe, expect, it } from "vitest";
import { runExtract, tidyMetaText } from "../src/extract.js";

const prose = (n: number) =>
  Array.from(
    { length: n },
    (_, i) =>
      `<p>Paragraph ${i} of ordinary prose, long enough that Readability keeps this article rather than deciding the page is a navigation shell with nothing in it. It carries on for a sentence or two more.</p>`,
  ).join("\n");

const page = (byline: string) => `<!doctype html>
<html lang="en"><head><title>A Title</title>
<meta name="author" content="${byline}"></head>
<body><article>${prose(8)}</article></body></html>`;

describe("tidyMetaText", () => {
  it("collapses a byline laid out over several lines", () => {
    expect(tidyMetaText("By \n \n Natalie Wolchover\n \n \nDecember 17, 2024")).toBe(
      "By Natalie Wolchover December 17, 2024",
    );
  });

  it("collapses tabs and non-breaking spaces too", () => {
    expect(tidyMetaText("Ann\tAuthor  and Bob")).toBe("Ann Author and Bob");
  });

  it("leaves an already-tidy byline byte-identical", () => {
    expect(tidyMetaText("Jaroslav Lukiv")).toBe("Jaroslav Lukiv");
  });

  /**
   * **It does not insert a separator anywhere**, and that is the decision, not
   * an omission. `"Visual Journalism teamBBC News"` is one Readability byline
   * built from two adjacent spans in BBC's own contributor markup — a
   * contributor's name and their role — not our byline glued to our siteName,
   * which is stored and rendered separately. Guessing a word boundary inside a
   * name is how `"Visual Journalism team"` becomes `"Visual Journalism Team"`
   * or worse, and there is no way to tell that apart from a real name.
   */
  it("does not guess a word boundary inside a run-together byline", () => {
    expect(tidyMetaText("Visual Journalism teamBBC News")).toBe("Visual Journalism teamBBC News");
  });

  /**
   * **A line break between two CJK characters is not a space**, and collapsing
   * it to one puts a word gap into a name that has none.
   *
   * This is the CSS Text 3 segment-break rule, and browsers follow it: wrap a
   * Japanese sentence in source and the reader sees no gap where the line broke.
   * Readability's byline comes straight off `textContent`, so a Japanese
   * publisher who sets a name and a role on two source lines hands us a newline
   * between two ideographs — and `/\s+/gu → " "` renders that as
   * `"田中太郎 記者"`, a string the page never showed anybody.
   *
   * GPT Sol, 2026-09-05, who reproduced it. RTL characters and bidi controls
   * were checked in the same review and pass through untouched, which is right.
   */
  it("does not insert a space where a line broke between two CJK characters", () => {
    expect(tidyMetaText("田中太郎\n記者")).toBe("田中太郎記者");
    expect(tidyMetaText("朝日新聞\n   \n編集部")).toBe("朝日新聞編集部");
    expect(tidyMetaText("김철수\n기자")).toBe("김철수기자");
  });

  it("still puts a space in where either side of the break is not CJK", () => {
    // The rule is about two CJK characters meeting, not about the string having
    // any CJK in it: a Latin word on either side needs its gap.
    expect(tidyMetaText("田中太郎\nTanaka Taro")).toBe("田中太郎 Tanaka Taro");
    expect(tidyMetaText("Asahi\n新聞")).toBe("Asahi 新聞");
    expect(tidyMetaText("Ann\nAuthor")).toBe("Ann Author");
  });

  it("still collapses an ordinary space between two CJK characters to one", () => {
    // Only a *segment break* disappears. A space the publisher actually typed is
    // a space, and this function is not in the business of deleting those.
    expect(tidyMetaText("田中太郎  記者")).toBe("田中太郎 記者");
  });

  it("says nothing rather than an empty string when there was nothing", () => {
    expect(tidyMetaText("   \n  ")).toBeUndefined();
    expect(tidyMetaText(null)).toBeUndefined();
    expect(tidyMetaText(undefined)).toBeUndefined();
  });
});

describe("runExtract", () => {
  it("stores the tidied byline, not the page's layout", async () => {
    const { meta } = await runExtract({
      html: page("By&#10; &#10; Natalie Wolchover&#10; &#10; &#10;December 17, 2024"),
      url: "https://example.com/a",
      slug: "a",
    });
    expect(meta.byline).toBe("By Natalie Wolchover December 17, 2024");
  });

  it("leaves the field absent when the page gave no byline", async () => {
    const { meta } = await runExtract({
      html: `<!doctype html><html lang="en"><head><title>A Title</title></head><body><article>${prose(8)}</article></body></html>`,
      url: "https://example.com/b",
      slug: "b",
    });
    expect("byline" in meta).toBe(false);
  });
});
