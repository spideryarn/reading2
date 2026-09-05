/**
 * **The reading column sits in the middle of whatever cell it is given** —
 * Greg, 2026-09-04: *"Always centre the Text view within its column when
 * visible, no matter which mode is active. It looks better that way."*
 *
 * A sibling of `tests/text-alone-centring.test.ts`, and deliberately not part
 * of it: that file guards the *other* mechanism, the one that centres the whole
 * table when the article is the only thing on the page (`Fit.alone`,
 * `PROSE_ALONE_MAX_REM`), and nothing here changes it. This one guards three
 * declarations in `src/web/styles.css` that no other test can see, because they
 * are pure CSS with no TypeScript on either end of them:
 *
 *   1. `.prose` divides the leftover in its cell (§ text)
 *   2. `.blk-gutter` moves with it, or the reader's marks stand off in the
 *      margin beside paragraphs they are no longer next to (§ the gutter)
 *   3. the masthead lands on the prose's left edge in a mode too, so a centred
 *      column is not sitting under a left-aligned title
 *      (§ the title over the column)
 *
 * **There was a fourth, and it went on 2026-09-05.** `th.text .th-measure` put
 * the `Text verbatim` heading on the prose's left edge by the same arithmetic.
 * The column-header row lost its height that day and its labels became
 * `.sr-only` spans (styles.css § the head with no row), so there is no heading
 * to align: both the rule and the two spans it needed are gone.
 * docs/plans/260905d-declutter-the-reading-view-top-bars.md § Stage 3.
 *
 * **Delete any one of the three and the page still renders**, which is exactly
 * the species of silence `tests/spine-width.test.ts` and `doc-links.test.ts`
 * exist for. What none of them can see is whether a browser actually centres
 * anything; that is a rendered check, and the measurements are in
 * docs/plans/260904d-archive-articles-centre-the-text-and-a-done-key.md.
 *
 * Comments are stripped before anything is asserted, for the reason the sibling
 * file gives at length: this stylesheet quotes its own declarations in prose, so
 * a check that read it raw would be satisfied by a sentence about the code.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stripBlockComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "");

const css = stripBlockComments(
  readFileSync(new URL("../src/web/styles.css", import.meta.url), "utf8"),
);

/**
 * One CSS rule body, by selector, with whitespace flattened.
 *
 * Anchored to the start of a line, because `.prose` and `.masthead-inner` are
 * both also the tail of a dozen descendant selectors and the first match would
 * otherwise be somebody else's rule.
 */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, "m").exec(css);
  expect(found, `no rule for \`${selector}\` in styles.css`).not.toBeNull();
  return (found?.[1] ?? "").replace(/\s+/g, " ").trim();
}

describe("the reading column is centred in its cell", () => {
  it("the prose divides the leftover on both sides", () => {
    const r = rule(".prose");
    expect(r).toContain("margin-inline: auto");
    // And it is still capped, or there is no leftover to divide.
    expect(r).toContain("max-width: clamp(45ch, 90vw, var(--reading-measure))");
  });

  it("the gutter follows the paragraph measure, so the marks stay beside the text", () => {
    const r = rule(".blk-gutter");
    /* Half the room the centring divides, added to the offset it always had —
       `--blk-gutter-x` since 2026-09-04, when the gutter became a 2 x 2 pad and
       every one of its numbers moved into § tokens. Same quantity, one home. */
    expect(r).toContain("var(--blk-gutter-x)");
    expect(r).toContain("var(--reading-measure)");
    expect(r).toContain("var(--text-pad-l)");
    expect(r).toContain("var(--text-pad-r)");
    // Self-limiting: a cell narrower than the measure leaves the gutter alone.
    expect(r).toMatch(/max\(\s*0px/);
    /* `65ch` is the zero glyph of the font it is USED on, size AND weight —
       Geist is variable. Without both, the gutter is 6% + ~3px shy of the
       prose's own left edge. */
    expect(r).toContain("font-size: var(--reading-size)");
    expect(r).toContain("font-weight: var(--reading-weight)");
  });

  /**
   * **The heading that used to have to travel with the prose has no height.**
   *
   * This is what is left of that case: an assertion that the row really is
   * collapsed, rather than that its one visible label is aligned. The three
   * things it checks are the three ways a zero-height head silently stops being
   * one — a padding, a border, or a label left in flow will each hold the row
   * open, because a table cell treats `height` as a *minimum*.
   */
  it("the column-header row has no height left to align anything in", () => {
    const head = rule("thead th");
    expect(head).toContain("height: var(--head-h)");
    expect(head).toContain("padding: 0");
    expect(head).not.toContain("border-bottom");
    // The token itself, or `height: var(--head-h)` above proves nothing.
    expect(css).toMatch(/--head-h:\s*0px/);
    /* And the labels are out of flow, or the cell is as tall as its text
       whatever `height` says. `.sr-only` is the shared utility (§ screen
       readers); TableView writing something else would pass the CSS check
       above and render a 20px row. */
    const tsx = readFileSync(new URL("../src/web/TableView.tsx", import.meta.url), "utf8");
    expect(tsx).toContain('<span className="sr-only">{columnLabel(d, geometry.leafDepth)}</span>');
    expect(tsx).toContain('<span className="sr-only">Text verbatim</span>');
    // …and the column is still named for a screen reader, which is the whole
    // reason the text is hidden rather than deleted.
    expect(tsx).toContain('scope="col"');
  });

  it("the footnotes opt out as a block, apparatus and all", () => {
    /* `.notes-head` and `.note-num` are absolutely positioned against the cell
       and set their own 0.8rem/600, so an offset computed there would mean
       something ~90px different from the same offset in the prose. Both stay
       put, and the note's prose stays with them. */
    expect(rule("td.text.note .prose")).toContain("margin-inline: 0");
    expect(rule("td.text.note .blk-gutter")).toContain("left: var(--blk-gutter-x)");
  });

  it("the masthead follows the prose wherever the two share a box", () => {
    const r = rule(".reader:has(table.only-prose):not(.text-alone) .masthead-inner");
    expect(r).toContain("max-width: var(--reading-measure)");
    // Stated rather than `auto`: this bar's own padding is asymmetric, so auto
    // margins would centre the title 60px left of the column.
    expect(r).toContain("margin-left: max(");
    expect(r).toContain("margin-right: auto");
    expect(r).toContain("var(--masthead-pad-l)");
    expect(r).toContain("var(--masthead-pad-r)");
    expect(r).toContain("font-size: var(--reading-size)");
  });

  it("and the bar names the padding the title has to undo", () => {
    /* Asserted as declarations rather than through `rule()`, because `.masthead`
       is a long rule and what matters is that the two custom properties are the
       ones the padding is actually set from — a var declared and then not used
       is a number that can drift out of step in silence. */
    expect(css).toContain("padding-left: var(--masthead-pad-l)");
    expect(css).toContain("padding-right: var(--masthead-pad-r)");
    expect(css).toMatch(/--masthead-pad-l:\s*max\(1\.5rem,/);
    expect(css).toMatch(/--masthead-pad-r:\s*calc\(var\(--feedback-w\) \+ 1\.5rem\)/);
  });
});
