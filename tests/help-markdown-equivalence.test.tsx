// @vitest-environment jsdom
/**
 * **The Markdown Help pages say exactly what the TSX said.** Temporary: it
 * goes when help-topics.tsx, help-modes.tsx and help-faq.tsx go, which is the
 * next step of the same stage.
 * docs/plans/261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md
 * § Stages, S2 step 2, and § S2 evidence for the day it was seen red.
 *
 * The files under src/web/help/pages/ were written by a one-off converter
 * from the old sections, so nobody proofread 1,300 lines. This is the
 * proofreading: the old words are the oracle, and every section (21 topics,
 * each mode's two halves, 8 questions) is compared four ways.
 *
 * 1. **The words.** Old and new rendered to a DOM, `textContent`, white space
 *    collapsed: equal.
 * 2. **The links.** The same targets the same number of times. The new side is
 *    drawn with the final multi-page addresses, which is what the files hold;
 *    the old side's `#x` is mapped to the same.
 * 3. **The marks.** The sequence of `(tag, text)` for every `strong`, `em`,
 *    `code`, `kbd` and `li`: equal. Equal words with a dropped emphasis, or a
 *    nested list flattened, would pass 1 and fail here.
 * 4. **Title and keywords**: equal.
 *
 * It is the only file besides the seven the plan's R3 lists that still
 * imports the old words.
 */
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MODES } from "../src/modes.js";
import { FAQ_IDS, HELP_TOPIC_IDS, type HelpAnchor } from "../src/web/help/help-anchors.js";
import { helpFaqSection, helpModeExtra, helpTopicSection } from "../src/web/help/help-content.js";
import { HELP_FAQ as OLD_FAQ } from "../src/web/help/help-faq.js";
import { HELP_MODES as OLD_MODES } from "../src/web/help/help-modes.js";
import { HELP_TOPICS as OLD_TOPICS } from "../src/web/help/help-topics.js";

/**
 * **Where each anchor will live once Help is many pages**: the address the
 * Markdown files already hold. Written out here rather than imported, because
 * `helpHref` still returns the one-page form and will change under this test.
 */
function finalHref(anchor: HelpAnchor): string {
  return anchor.startsWith("faq-") ? `/help/questions#${anchor}` : `/help/${anchor}`;
}

function dom(node: ReactNode): HTMLElement {
  const holder = document.createElement("div");
  holder.innerHTML = renderToStaticMarkup(<>{node}</>);
  return holder;
}

const squash = (s: string | null): string => (s ?? "").replace(/\s+/g, " ").trim();

function words(el: HTMLElement): string {
  return squash(el.textContent);
}

/** Every link's target, sorted, so the comparison is of a multiset. */
function links(el: HTMLElement, mapFragment: boolean): string[] {
  return Array.from(el.querySelectorAll("a"))
    .map((a) => {
      const href = a.getAttribute("href") ?? "";
      return mapFragment && href.startsWith("#") ? finalHref(href.slice(1) as HelpAnchor) : href;
    })
    .sort();
}

function marks(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll("strong, em, code, kbd, li")).map(
    (m) => `${m.tagName.toLowerCase()}: ${squash(m.textContent)}`,
  );
}

function expectSameBody(oldBody: ReactNode, newBody: ReactNode): void {
  const was = dom(oldBody);
  const is = dom(newBody);
  expect(words(is)).toBe(words(was));
  expect(links(is, false)).toEqual(links(was, true));
  expect(marks(is)).toEqual(marks(was));
}

describe("the Markdown Help pages against the TSX they were converted from", () => {
  it.each(HELP_TOPIC_IDS)("topic %s", (id) => {
    const was = OLD_TOPICS[id];
    const is = helpTopicSection(id, finalHref);
    expect(is.title).toBe(was.title);
    expect(is.keywords).toBe(was.keywords);
    expectSameBody(was.body, is.body);
  });

  it.each(FAQ_IDS)("question %s", (id) => {
    const was = OLD_FAQ[id];
    const is = helpFaqSection(id, finalHref);
    expect(is.title).toBe(was.title);
    expect(is.keywords).toBe(was.keywords);
    expectSameBody(was.body, is.body);
  });

  it.each(MODES)("mode %s", (mode) => {
    const was = OLD_MODES[mode];
    const is = helpModeExtra(mode, finalHref);
    expect(is.keywords).toBe(was.keywords);
    for (const half of ["whenToUse", "reading"] as const) {
      /* A half the old words left out must be left out, not empty. */
      expect(is[half] === null, `${mode} ${half} is null`).toBe(was[half] === null);
      expectSameBody(was[half], is[half]);
    }
  });

  it("compares every section, and each has words", () => {
    /* The guard against a comparison of nothing with nothing. */
    expect(HELP_TOPIC_IDS.length + FAQ_IDS.length + MODES.length).toBe(46);
    for (const id of HELP_TOPIC_IDS) expect(words(dom(helpTopicSection(id, finalHref).body)).length).toBeGreaterThan(40);
    for (const id of FAQ_IDS) expect(words(dom(helpFaqSection(id, finalHref).body)).length).toBeGreaterThan(40);
  });
});
