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
 *      (§ the title over the column) — and where nothing is centring anything,
 *      the bar's own left gutter *is* the prose's inset, so the title starts
 *      there too. The bar's two gutters are deliberately allowed to differ and
 *      the expression carries both.
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
    /* The selector was bare `thead th` until 2026-09-06, when it was scoped to
       the zoom table because it had been reaching every table in the app
       (docs/postmortems/260906g-an-unscoped-element-selector-in-styles-css-reached-every-table-in-the-app.md).
       This assertion is about the geometry, not the spelling, but `rule()`
       matches a selector literally — so a later rescoping breaks this test
       again, and the fix is to respell it here, never to relax the rule. */
    const head = rule(":where(table.zoom > thead) > tr > th");
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
    /* Stated rather than `auto`, and it still has to be: auto margins would
       centre this box in the bar, while the prose is half the reading cell's
       padding asymmetry right of centre in *its* box. */
    expect(r).toContain("margin-left: max(");
    expect(r).toContain("margin-right: auto");
    expect(r).toContain("var(--text-pad-l)");
    expect(r).toContain("var(--text-pad-r)");
    expect(r).toContain("font-size: var(--reading-size)");
    /* **And the bar's own padding is one of the terms, after a day in which it
       was not.** It rebuilds the bar's full width from the content box
       (`+ --masthead-pad-l + --masthead-pad-r`) and then subtracts
       `--masthead-pad-l` to get back into it, because the prose divides the
       whole reading cell while a margin starts at the bar's content edge.

       When the two reservations came out with the corner controls the two sides
       became equal, the term cancelled, and it was dropped. That was correct
       arithmetic and the wrong move: it turned an identity into a precondition,
       and the very next fix needed the two sides *unequal* — a phone's title
       wants the left gutter its prose has (styles.css § a narrow window). The
       long form is true for any pair, so nothing two hundred lines away has to
       stay in step with it.
       docs/plans/260905g-move-the-wordmark-and-feedback-button-into-the-dock.md
       § Stage 2. */
    expect(r).toContain("var(--masthead-pad-l)");
    expect(r).toContain("var(--masthead-pad-r)");
  });

  it("and the title still starts where the prose does when nothing is centring it", () => {
    /* **The floor of that `max` is the prose's own inset, not zero.**

       Below the width at which the centring term survives — a phone, or a band
       mode on a laptop — the term goes negative and the floor is what places the
       title. Zero puts it at the bar's content edge while the prose stays inset
       by `--text-pad-l`, and the two left edges are a step apart: measured at
       1024 in a band mode on 2026-09-06, title at 436 against a first line of
       prose at 447.

       Nobody had seen it because the *reservation* was paying for it by
       accident — the masthead's left padding was derived from `--logo-w` and
       landed within about two pixels of the prose's inset — so taking the
       reservation away is what exposed it. GPT Sol, T1. */
    const r = rule(".reader:has(table.only-prose):not(.text-alone) .masthead-inner");
    expect(r).toContain("max(0px, calc(var(--text-pad-l) - var(--masthead-pad-l)))");
  });

  it("and a phone's title starts at the prose's own gutter", () => {
    /* The other half of the same fix, and it is a padding rather than a margin
       because on a phone this bar is `.text-alone`: the rule above never runs,
       nothing is centring anything, and the title simply starts at the bar's
       content edge. So that edge is the prose's inset.

       Asserted as the declaration rather than as a computed number, for the
       reason this file gives elsewhere: `--text-pad-l` is `--blk-slot` plus its
       padding and has moved twice this month, and a test that copied its value
       would be a second place to change. */
    expect(css).toMatch(/--masthead-pad-l:\s*var\(--text-pad-l\)/);
    // And the padding really is set from the pair, or they are two numbers
    // nothing reads.
    expect(css).toMatch(/padding:[^;]*var\(--masthead-pad-r\)[^;]*var\(--masthead-pad-l\)/);
  });

  it("and the granularity pills follow the title rather than the gutter", () => {
    /* **The step this fix could have moved rather than removed.** `.controls`
       sits directly under the masthead and holds the granularity pills, and the
       shell's invariant is that the two bars share a gutter or the pills stop
       lining up with the title above them. Giving the phone's masthead the
       prose's inset while leaving this bar at a flat `1rem` would have put the
       pills 19.2px left of the title — the same step, one line lower down the
       screen. GPT Sol, U1.

       Written out in both rules rather than shared through a custom property:
       `--masthead-pad-*` are declared *on* `.masthead` and do not reach this
       bar, and lifting them to `:root` would make two bars with genuinely
       different vertical padding look like one thing. So the invariant is two
       numbers that have to agree, which is exactly the kind of thing that wants
       a test rather than a comment. */
    const narrow = css.slice(css.indexOf("@media (max-width: 731px)"));
    const controls = narrow.slice(narrow.indexOf(".controls {"));
    expect(controls.slice(0, controls.indexOf("}"))).toContain(
      "padding: 0 1rem 0 var(--text-pad-l)",
    );
  });
});
