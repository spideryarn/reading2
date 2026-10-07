/**
 * **What a Help page says, for a test that holds Help to a promise about a
 * feature.**
 *
 * Help's words are Markdown files (src/web/help/pages/), and several feature
 * tests assert that Help says, or no longer says, a particular thing: that a
 * double Stop sends, that the thorough search takes about ten seconds, that a
 * link-shared article is listed nowhere. They used to render the TSX the
 * words were written in. This gives them the same words as the reader sees
 * them: tokens replaced, Markdown's marks gone, a link reduced to its text,
 * and white space collapsed so that a sentence wrapped across two lines of
 * the file is one sentence here.
 * docs/plans/261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md,
 * R3.
 *
 * It goes through `helpSectionText`, which refuses whatever the page refuses
 * to draw, so a test here never passes on words the page could not show.
 */
import type { Mode } from "../../src/modes.js";
import { modeAnchor, type HelpAnchor } from "../../src/web/help/help-anchors.js";
import { helpSectionText } from "../../src/web/help/help-markdown.js";

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Every word on one page of Help (for a mode: its two halves, without the catalog's sentences). */
export function helpWords(anchor: HelpAnchor): string {
  return collapse(helpSectionText(anchor));
}

/**
 * **A mode's page from "Reading it" on**: how to read what the mode shows,
 * which is where Help makes its promises about a mode's behaviour. Throws if
 * the page has no such half, so a test cannot go green on an empty string.
 */
export function helpModeReadingWords(mode: Mode): string {
  const lines = helpSectionText(modeAnchor(mode)).split("\n");
  const at = lines.indexOf("Reading it");
  if (at === -1) throw new Error(`Help's page for ${mode} has no "Reading it"`);
  return collapse(lines.slice(at + 1).join("\n"));
}
