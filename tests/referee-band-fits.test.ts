/**
 * **The Referee band's four children fit inside it — the half of that a test
 * can reach.**
 *
 * The bug, measured in Chrome on 2026-09-01 at an ordinary 1280 × 720: the
 * band's children were `band-head` 41 + `ref-notice` 214 + `ref-scan` 386 +
 * `ref-views` 46 = **687px in a 636px band**, so `.ref-panel` — the only child
 * carrying `min-height: 0`, and therefore the only one flexbox was willing to
 * squeeze — was **0px tall with 321px of content in it**, the sub-mode chips
 * started at y=700 in a 720px window, and `.mode-band` is `position: fixed`
 * with `overflow: visible`, so none of it was clipped, scrolled to, or in any
 * way announced. Criteria, Claims, Mirror and Candidates were all unreachable.
 * A scan finding **three** things was enough; the article was ordinary.
 *
 * ## What this file cannot do, and it is most of it
 *
 * **jsdom has no layout engine.** `getBoundingClientRect` returns zeros for
 * everything, `offsetHeight` is 0, and flexbox is not implemented at all — so a
 * test asserting "the panel is taller than zero" would have been *red before
 * the fix and red after it*, and one asserting "the children fit" would have
 * been **green before the fix**, because 0 + 0 + 0 + 0 fits in 0. That is the
 * exact shape docs/reusable/silent-success.md collects, and it is why there is
 * no measurement here.
 *
 * The measurement is a browser one and it lives in two places: the numbers
 * above and after, written into src/web/styles/referee.css § referee mode beside the
 * rules they justify, and docs/project/referee-mode.md § the band has to fit.
 *
 * ## What it can do, and why it is worth having anyway
 *
 * The fix is **two things that only work as a pair**, in two files, and either
 * one alone is silent:
 *
 * - a rule capping `.ref-brief` and giving it its own scrollbar, plus a floor
 *   under `.ref-panel` so it is no longer the child that gives way;
 * - markup that actually puts the notice and the scan inside a `.ref-brief`,
 *   and leaves the chips and the panel outside it.
 *
 * Delete the wrapper from the band and the CSS matches nothing; every other test
 * still passes and the mode is unusable again. So this file pins the pairing,
 * which is the part that rots, and says nothing about pixels, which is the part
 * it cannot see.
 *
 * The markup half moved out of `App.tsx` into
 * src/web/modes/referee/RefereeMode.tsx on 2026-09-06. `BAND_FILE` names it in
 * every guard below, so a subject that moves again fails loudly rather than
 * slicing an empty string out of the wrong file —
 * docs/reusable/silent-success.md.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readerCssNoComments } from "./helpers/stylesheets.js";

/* The reading-view sheets as a set rather than one path — `src/web/styles.css`
   has held nothing but `@import`s since 2026-09-06.

   Comments stripped, and that is not cosmetic: `bodyOf` below matches raw
   source, so a rule someone commented out would still satisfy every assertion
   here and a deleted rule would have a second place to be found.
   docs/reusable/silent-success.md; GPT Sol, 2026-09-07. */
const CSS = readerCssNoComments();
const BAND_FILE = "src/web/modes/referee/RefereeMode.tsx";
const BAND_SOURCE = readFileSync(BAND_FILE, "utf8");

/** The declarations inside `selector { … }`, or null if there is no such rule. */
function bodyOf(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return CSS.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"))?.[1] ?? null;
}

describe("the stylesheet caps the preamble and floors the panel", () => {
  it("`.ref-brief` is capped and scrolls inside the cap", () => {
    const body = bodyOf(".ref-brief");
    expect(body, "no `.ref-brief` rule — the notice and the scan are uncapped again").not.toBeNull();
    /* A cap without a scrollbar is worse than no cap: the content is then
       clipped by `overflow: hidden` or drawn outside the band by
       `overflow: visible`, and either way the referee cannot reach the scan's
       findings. Both halves or neither. */
    expect(body).toMatch(/max-height:\s*[^;]+;/);
    expect(body).toMatch(/overflow-y:\s*auto/);
  });

  it("`.ref-panel` no longer has `min-height: 0`, which is what let it reach zero", () => {
    const body = bodyOf(".ref-panel");
    expect(body, "no `.ref-panel` rule").not.toBeNull();
    const min = body?.match(/min-height:\s*([^;]+);/)?.[1]?.trim();
    expect(min, "`.ref-panel` declares no `min-height`, so its content sets one").toBeDefined();
    /* It still has to override the `auto` a flex item gets by default — that is
       what `min-height: 0` was there for — so "any non-zero length" is the
       assertion, not "no min-height". */
    expect(min).not.toBe("0");
    expect(min).not.toBe("0px");
    expect(min).toMatch(/^[\d.]+\s*(?:rem|px|em)$/);
  });
});

describe("the markup the rules above are aimed at", () => {
  /**
   * The frame, from `feature="gloss referee"` to the end of its `<ModeSurface>`.
   * Crude, and deliberately so: a missing band is a failure here rather than a
   * vacuous pass, which is the trap a regex test falls into when it stops
   * matching anything.
   *
   * **Since 2026-10-03 the brief is rendered only while Notices is open, and
   * the chips are above it** (plan 261003k). The pairing this file pins is
   * unchanged: when the brief *is* open it is the capped, scrolling box, the
   * scan and the notice are inside it, and the panel is outside it — so an
   * opened Notices box still cannot push the panel off a band that clips
   * nothing. tests/referee-notices.test.tsx holds when it is open.
   */
  const band = BAND_SOURCE.match(/feature="gloss referee"[\s\S]*?<\/ModeSurface>/)?.[0];

  /* The five **tags**, not the five words: a class name also appears in the
     prose of comments, and an `indexOf` on the bare name finds the comment. */
  const TAGS = {
    chips: "<RefereeViews",
    brief: 'className="ref-brief"',
    scan: "<SourceScanNotice",
    notice: 'className="ref-notice"',
    panel: 'className="ref-panel"',
  } as const;

  it(`the Referee band is still in ${BAND_FILE} and still has all five parts`, () => {
    expect(band, `no \`gloss referee\` ModeSurface in ${BAND_FILE}`).toBeDefined();
    for (const [name, tag] of Object.entries(TAGS)) {
      expect(band, `the ${name} (\`${tag}\`) is not in the band`).toContain(tag);
    }
  });

  it("the scan and the notice are inside `.ref-brief`, and the chips and the panel are not", () => {
    const at = (needle: string) => band?.indexOf(needle) ?? -1;
    /* Positions rather than a parse: the point is the order of the five. The
       scan is first inside the brief because it is what opens the box
       unasked, and under the paragraphs a finding would start below the cap. */
    expect(at(TAGS.chips)).toBeLessThan(at(TAGS.brief));
    expect(at(TAGS.brief)).toBeLessThan(at(TAGS.scan));
    expect(at(TAGS.scan)).toBeLessThan(at(TAGS.notice));
    expect(at(TAGS.notice)).toBeLessThan(at(TAGS.panel));

    /* And the wrapper really closes before the panel, rather than swallowing
       it: the notice's own `</div>` and the brief's are the only two in that
       gap. Without this the assertions above are satisfied by a `.ref-brief`
       that wraps the panel, which would cap and scroll it too. */
    const gap = band?.slice(at(TAGS.notice), at(TAGS.panel)) ?? "";
    expect(gap.match(/<\/div>/g)?.length, "`.ref-brief` does not close before the panel").toBe(2);
  });

  it("is shut on every visit unless the scan says otherwise, and remembers nothing", () => {
    /* A collapse is only allowed here because it is not a dismissal —
       RefereeMode.tsx § RefereeBand. No storage, no column: the default is
       computed from the scan and a press lasts as long as the mount. */
    expect(BAND_SOURCE).toContain(
      "const [noticesChoice, setNoticesChoice] = useState<boolean | null>(null);",
    );
    expect(BAND_SOURCE).toContain("const noticesOpen = noticesChoice ?? sourceScanOpens(scan);");
    expect(BAND_SOURCE).not.toMatch(/window\.localStorage|sessionStorage/);
  });
});
