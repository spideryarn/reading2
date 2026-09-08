/**
 * **In the query where the dock leaves the screen while you read, no rule may
 * ask merely whether a mode is open.**
 *
 * The dock slides away as the reader goes forwards and comes straight back when
 * they turn round (scroll.ts § `stepBar`, narrow-window.css § a small device).
 * A guard written on 2026-08-31 held it down whenever a `.mode-band` existed,
 * because Greg had been stranded in one:
 *
 * > on mobile I did find that I sometimes struggled to get back to the main
 * > text (e.g. within the Search mode when the keyboard was open)
 *
 * On the day that was written the two conditions were the same sentence: the
 * crossover at which a band stops sharing the window with the article was
 * `MODE_MIN + PROSE_MIN`, and layout.ts says of it that *"no iPhone made has
 * ever cleared it, in either orientation"*. So on a phone, a band open **was**
 * a band covering the whole screen, and pinning the dock was the only safe
 * answer.
 *
 * **2026-09-06 split that number** (`MODE_PROSE_FLOOR`, so that a landscape
 * iPhone could show a mode and the article side by side) and the two sentences
 * came apart. The guard went on answering the old one, and a reader in
 * landscape got a dock pinned over an article they could have scrolled it back
 * with — `SPIDERYARN-READING2-2F`, 2026-09-07:
 *
 * > The dock used to disappear on iPhone and only reappear when I scroll … But
 * > now it seems to be there the whole time. I'm in landscape mode on an
 * > iPhone.
 *
 * docs/plans/260908e-the-dock-hides-on-scroll-in-a-mode-unless-the-band-is-the-whole-screen.md
 * has the measurements either side of the fix.
 *
 * ## What this file can and cannot do
 *
 * It reads the stylesheet, so it proves the rules are **written**, not that
 * they **apply** — the applying half is a browser, and the numbers are in the
 * plan. It is here for the shape of the bug rather than for the bug: *three*
 * rules in that query describe one condition, and the defect was that they
 * described it by proxy. So the assertion is about all of them at once, and a
 * fourth rule reaching for a bare `.mode-band` in there goes red without anyone
 * having to remember this file exists.
 *
 * The pattern is tests/shared-notice-hides-with-the-masthead.test.tsx, which
 * holds two halves of a fix together for the same reason.
 */
import { describe, expect, it } from "vitest";
import { readerSheets, stripComments } from "./helpers/stylesheets.js";

/**
 * § a small device, by its opening line.
 *
 * The string is `tests/spine-width.test.ts`'s business — it ties 731 to
 * `GIST_MIN + PROSE_MIN + SPINE_W − 1` — so this file takes it as given and
 * fails loudly if it has moved rather than quietly matching nothing.
 */
const QUERY = "@media (max-height: 620px), (max-width: 731px) {";

/** The sheet, comments stripped: prose quoting a rule is not a rule. */
function dockQuery(): string {
  const sheet = readerSheets().find((s) => s.path === "src/web/styles/narrow-window.css");
  expect(sheet, "narrow-window.css is not in the reading view's sheets any more").toBeDefined();
  const css = stripComments(sheet!.css);
  const at = css.indexOf(QUERY);
  expect(at, `§ a small device's query has moved or changed: ${QUERY}`).toBeGreaterThan(-1);
  /* Balance from the query's own `{`, so nested blocks come along and the next
     section does not. */
  let depth = 0;
  for (let i = at + QUERY.length - 1; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(at, i + 1);
  }
  throw new Error("§ a small device's query is unterminated");
}

/**
 * Every mention of the band inside that query, with enough either side to see
 * how it is qualified.
 *
 * The one spelling allowed to survive is the one the fix uses:
 * `.band-covers … .mode-band` — the band is the whole screen, so the dock is
 * the only way out of it. Anything else is the old proxy.
 *
 * **`.mode-band:focus-within` is not an exemption**, and that is deliberate
 * rather than an omission. It was in the plan as the *"keyboard is open"* half
 * and a browser threw it out: Search and Chat put focus in their field when
 * they open and never take it out, so it pinned the dock for the whole life of
 * two of the five modes — the defect this file exists to catch, wearing a
 * different selector. The narrow-window.css comment has the measurement.
 */
function bandMentions(block: string): string[] {
  return [...block.matchAll(/[^{};]*\.mode-band[^{};]*/g)].map((m) => m[0].trim());
}

describe("the dock, in a mode, in the query where it leaves the screen", () => {
  it("never asks merely whether a mode is open", () => {
    const mentions = bandMentions(dockQuery());
    expect(mentions.length, "no rule in § a small device mentions the band at all").toBeGreaterThan(
      0,
    );
    const bare = mentions.filter((m) => !m.includes("band-covers"));
    expect(
      bare,
      "a rule here holds the dock down for any open mode, including one with the article beside it",
    ).toEqual([]);
  });

  it("holds the dock down when the band is the whole screen", () => {
    const block = dockQuery();
    /* The guard itself: the one rule that puts `--dock-bottom` back to the
       bar's resting room. Located by what it *does* rather than by its
       selector, which is the thing under test. */
    const at = block.indexOf("--dock-bottom: var(--dock-space)");
    expect(at, "nothing in § a small device brings the dock back any more").toBeGreaterThan(-1);
    const guard = block.slice(0, at).lastIndexOf(":root:has(");
    expect(guard, "the guard is not a `:root:has()` any more").toBeGreaterThan(-1);
    const selector = block.slice(guard, at);
    expect(
      selector,
      "the covering band no longer pins the dock — a phone in portrait is stranded",
    ).toContain(".reader.band-covers .mode-band");
    /* One `:has()` with several arguments rather than several selectors, which
       is what keeps the whole guard at `.dock:focus-within`'s (0,3,0) and so
       ahead of `:root[data-bars="hidden"]`'s (0,2,0). Written apart, the band
       branches would tie and win only on source order — the file's own comment
       says GPT Sol caught that tie on 2026-08-28. */
    expect(
      selector.split("(").length - 1,
      "the guard has been split into several selectors and now ties on specificity",
    ).toBe(1);
  });

  it("still keeps the dock's slide for the case where the reader can scroll it back", () => {
    const block = dockQuery();
    /* `transition: none` says "the dock arrived because a panel opened", which
       is true only where the band took the screen. Side by side the dock hides
       and shows on scroll like any other, and a snapping bar on every change of
       direction is a defect rather than a decision. */
    const rules = [...block.matchAll(/[^{}]*\{\s*transition:\s*none[^}]*\}/g)].map((m) =>
      m[0].trim(),
    );
    expect(rules.length, "expected exactly one rule to kill the dock's transition").toBe(1);
    expect(rules[0]).toContain("band-covers");
  });
});
