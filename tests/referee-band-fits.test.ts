/**
 * **The Referee band's four children fit inside it — the half of that a test
 * can reach.**
 *
 * The bug, measured in Chrome on 2026-09-01 at an ordinary 1280 × 720: the
 * band's children were `gloss-head` 41 + `ref-notice` 214 + `ref-scan` 386 +
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
 * above and after, written into src/web/styles.css § referee mode beside the
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
 * Delete the wrapper from App.tsx and the CSS matches nothing; every other test
 * still passes and the mode is unusable again. So this file pins the pairing,
 * which is the part that rots, and says nothing about pixels, which is the part
 * it cannot see.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  REFEREE_TEXT_ALREADY_SENT,
  REFEREE_TEXT_ALREADY_SENT_SHORT,
} from "../src/messages.js";

const CSS = readFileSync("src/web/styles.css", "utf8");
const APP = readFileSync("src/web/App.tsx", "utf8");

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
   * The band, from `className="mode-band gloss referee"` to the end of its
   * `<aside>`. Crude, and deliberately so: a missing band is a failure here
   * rather than a vacuous pass, which is the trap a regex test falls into when
   * it stops matching anything.
   */
  const band = APP.match(/className="mode-band gloss referee"[\s\S]*?<\/aside>/)?.[0];

  /* The five **tags**, not the five words. `.ref-panel` is named in the prose of
     the comment above the scan ("outside `.ref-panel`"), so an `indexOf` on the
     bare class name finds the comment and reports an order that is not the
     markup's — the first version of this test failed for exactly that reason,
     which is the cheapest possible reminder that a regex over source is reading
     text and not a tree. */
  const TAGS = {
    brief: 'className="ref-brief"',
    notice: 'className="ref-notice"',
    scan: "<SourceScanNotice",
    chips: "<RefereeViews",
    panel: 'className="ref-panel"',
  } as const;

  it("the Referee band is still in App.tsx and still has all five parts", () => {
    expect(band, "no `mode-band gloss referee` aside in App.tsx").toBeDefined();
    for (const [name, tag] of Object.entries(TAGS)) {
      expect(band, `the ${name} (\`${tag}\`) is not in the band`).toContain(tag);
    }
  });

  it("the notice and the scan are inside `.ref-brief`, and the chips and the panel are not", () => {
    const at = (needle: string) => band?.indexOf(needle) ?? -1;
    /* The wrapper opens before both of the things it is supposed to cap, and
       closes before the chips. Positions rather than a parse: the point is the
       order of the five, and the order is the whole of the fix. */
    expect(at(TAGS.brief)).toBeLessThan(at(TAGS.notice));
    expect(at(TAGS.notice)).toBeLessThan(at(TAGS.scan));
    expect(at(TAGS.scan)).toBeLessThan(at(TAGS.chips));
    expect(at(TAGS.chips)).toBeLessThan(at(TAGS.panel));

    /* And the wrapper really closes between the scan and the chips, rather than
       swallowing them: exactly one `</div>` sits in that gap. Without this the
       four assertions above are satisfied by a `.ref-brief` that wraps the
       whole band, which would cap and scroll the chips and the panel too. */
    const gap = band?.slice(at(TAGS.scan), at(TAGS.chips)) ?? "";
    expect(gap.match(/<\/div>/g)?.length, "`.ref-brief` does not close before the chips").toBe(1);
  });
});

/**
 * **Both boxes are collapsed by default now, and that is a second answer to the
 * same problem this file is about.**
 *
 * The cap above is what makes the band survive a referee who has opened both;
 * the collapse is what means they usually have not. Greg asked for it on
 * 2026-09-02 — the scan first, *"default-collapsed unless something has been
 * found"*, and then the confidentiality notice with it.
 *
 * What a test can hold here is the part that would rot silently: a collapse
 * that took the *fact* away with the paragraph. The label on the control has to
 * be the sentence itself, and it has to still say what the long one says.
 * src/web/SourceScanNotice.tsx's own tests hold the scan half, where there is a
 * component to render.
 */
describe("the preamble is shut until a referee asks for it", () => {
  /* The same slice as the describe above takes, and taken again rather than
     shared: a `band` that stopped matching would then fail in one place instead
     of quietly emptying two. */
  const band = APP.match(/className="mode-band gloss referee"[\s\S]*?<\/aside>/)?.[0];

  it("the notice's label is the long sentence's own opening clause", () => {
    /* Values, not source text: two strings that drift apart are the failure —
       a label reading "Confidentiality" over a paragraph that says the text has
       already gone would pass any test written about the markup. */
    expect(REFEREE_TEXT_ALREADY_SENT_SHORT).toMatch(/\.$/);
    const clause = REFEREE_TEXT_ALREADY_SENT_SHORT.replace(/\.$/, "");
    expect(
      REFEREE_TEXT_ALREADY_SENT.startsWith(clause),
      `the notice's label is no longer what the notice says:\n  ${clause}\n  ${REFEREE_TEXT_ALREADY_SENT}`,
    ).toBe(true);
  });

  it("the band shows that label outside the collapse, and the paragraph inside it", () => {
    expect(band, "the shut notice says nothing at all").toContain(
      "REFEREE_TEXT_ALREADY_SENT_SHORT",
    );
    expect(band).toContain("aria-expanded={noticeOpen}");
    /* The long sentence and the disclosure line are the two things behind the
       chevron, and `noticeOpen &&` is the whole of what puts them there. */
    expect(band).toMatch(/\{noticeOpen && \(/);
  });

  it("starts shut on every visit, and remembers nothing between them", () => {
    /* A collapse is only allowed here because it is not a dismissal — App.tsx
       § RefereeBand. `useState(false)` is that, in one line: no storage, no
       column, and the same first screen every time. */
    expect(APP).toContain("const [noticeOpen, setNoticeOpen] = useState(false);");
  });
});
