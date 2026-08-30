You are reviewing a CSS + test change to Spideryarn, a TypeScript/React reading app. Dark theme only:
the page is oklch(0.145 0 0) and text is oklch(0.97 0 0).

## The report

Greg: "Some of Outline mode text is too faded. ... And can you make the levels/siblings clearer, e.g.
what level are we on, who are siblings at the same level? Perhaps with horizontal indenting?"

Outline mode is a fixed, NEVER-SCROLLING panel listing the article's structure: level 1 = parts,
level 2 = the current part's sections, level 3 = the current section's paragraphs. A pure function
(src/web/outline.ts) builds five candidate lists ("rungs"); the panel renders all five hidden,
MEASURES them, and draws the tallest that fits. Rows carry classes: lvl-1/2/3, tier-cur/near/mid/far
(distance from the current row), .here (the whole ancestor chain of the reader's position), .now (the
deepest drawn row they are in), .read (ends before the reader), .supplement (endnotes), .focused.

## What I found and changed

1. The whole `§ outline mode` block was written against custom properties this app does not define:
   `--muted` used as a TEXT colour six times (it is shadcn's raised dark SURFACE, oklch(0.245 0 0) --
   about 1.2:1 on the page), plus `--fg`, `--panel-2`, `--ui-font`, `--read-font`, none of which
   exist anywhere. `.outln-row.here { color: var(--fg) }` therefore never painted anything.
2. `.outln-text` needs `display:-webkit-box` for its line clamp, which is BLOCK-level, so the number
   span and the title stacked: every numbered row was two lines tall. Row is now a 2-col grid.
3. Levels/siblings: per-level number gutters, a hairline rail per nested run, and the current section
   marked on its rail.
4. A new gate, tests/css-tokens.test.ts, for the class in (1).

## What I want from you

Be adversarial and concrete. In particular:

- **The grid.** `.outln-row` is now `display: grid; grid-template-columns: auto minmax(0, 1fr)`.
  `.outln-num`, `.outln-text`, `.outln-gist`, `.outln-arc` are placed by name. At level 3 the number
  is `display: none`. Is there any row shape (empty number on a supplement, a very long unbroken
  token, a supplement at level 1, the gist/arc paragraphs) where this overflows the panel, changes
  the measured height in a way the fit cannot see, or drops the line clamp? Remember the panel CANNOT
  scroll, and the hidden measuring copies use the SAME markup and classes -- so a bug that changes
  height is measured correctly and merely wastes space, but a bug that makes the VISIBLE list taller
  than the measured one runs rows off the bottom silently.
- **The rails.** `::before` on lvl-2 and lvl-3, `::after` on lvl-3 only, absolutely positioned
  top:0/bottom:0 against a `position: relative` row. Do they join up? Does `.outln-row.now.lvl-2::before`
  actually win over the base rule (specificity)? Does anything else in the file already use these
  pseudo-elements on `.outln-row`? Does `border-radius: 3px` on the row clip them?
- **The colours.** Base `--ink-soft` (0.78) on `.outln-list`; `.tier-far` and `.read .outln-text` both
  `--ink-faint` (0.63); `.here` `--ink` (0.97); `.now` gets `--highlight-wash` behind it. Check the
  CASCADE ORDER carefully -- `.outln-row.here`, `.outln-row.tier-far`, `.outln-row:hover`,
  `.outln-row.now` are all specificity (0,2,0) or lower, so source order decides. Is there any
  combination (a .here row that is also tier-far; a .now row under the pointer; a .read row that is
  also .here; a .supplement that is also .now) where the wrong one wins, or where a row ends up
  LESS legible than before? Give me contrast ratios if you can.
- **The test.** Does it actually catch the class, or only the instances? Where can it pass on broken
  CSS -- `var()` nested inside another `var()`'s fallback, a token defined only inside a media query
  or a `@supports`, a token defined in a scope that does not reach the element that reads it, a
  `color:` written as a shorthand (`font:`, `border:`) or via a Tailwind utility, a surface token
  reached through an intermediate alias (`--x: var(--muted); color: var(--x)`)? I proved both halves
  red by reintroducing the two original bugs; tell me what that proof does NOT cover.

Ignore anything outside the outline block and the new test.

## The diff

```diff
diff --git a/docs/project/design-css-overview.md b/docs/project/design-css-overview.md
index dfa5472..04a9bae 100644
--- a/docs/project/design-css-overview.md
+++ b/docs/project/design-css-overview.md
@@ -74,6 +74,26 @@ The semantic layer at the top of `styles.css` (`--ink`, `--page`, `--panel`, `--
 shadcn surface names. On a dark ground the greys run the other way: *soft* and *faint* are darker,
 not lighter.
 
+### Both of those are checked, because both had already happened
+
+[`tests/css-tokens.test.ts`](../../tests/css-tokens.test.ts) reads all four stylesheets and asserts
+two things. Neither was a hypothetical; `§ outline mode` had six instances of the second and three
+of the first, and the panel was half unreadable on screen for four days before Greg's screenshot.
+
+- **A `var(--x)` with no fallback names a token that exists** — in one of the four sheets, or set as
+  an inline style from `src/web` (the test reads those too, including the `--h${i}` family
+  `annotate.ts` emits). An undefined custom property with no fallback is *invalid at computed value
+  time*: the whole declaration is dropped and the property inherits. Nothing errors, and the rule
+  looks exactly like one that was applied. `.outln-row.here { color: var(--fg) }` — the mark on the
+  reader's whole ancestor chain — did nothing at all.
+- **No `color:` is a surface token.** `--muted` is `oklch(0.245 0 0)` and the page is
+  `oklch(0.145 0 0)`, so text painted in it sits at about 1.2:1. The text twin is
+  `--muted-foreground`, aliased here as `--ink-faint`.
+
+The `--accent` warning above was already written in two files, in capitals, and the mistake was made
+anyway with `--accent`'s neighbour. **A rule that is only written down is not a check**, which is
+why these two now are.
+
 **There is exactly one colour that is not the orange, and it is `--hit-rgb`** — the wash over search
 results ([search.md](search.md)). It exists because a comment, a glossary term and a search hit can
 all cover the same sentence, and three meanings separated only by opacity is one hue too few. That
diff --git a/src/web/styles.css b/src/web/styles.css
index 95a2407..da97633 100644
--- a/src/web/styles.css
+++ b/src/web/styles.css
@@ -8924,13 +8924,25 @@ table.only-prose thead { display: none; }
   --outln-pad-l: 0.75rem;
   --outln-pad-r: 0.5rem;
   padding: 0.75rem var(--outln-pad-r) 0 var(--outln-pad-l);
+
+  /* One step of nesting, and where that step's rail is drawn. Both are used by
+     several rules below and by both pseudo-elements, so they are named once:
+     a rail that does not sit in the gutter its own level opened is worse than
+     no rail, because it groups the wrong rows. */
+  --outln-indent: 1.15rem;
+  --outln-rail: 0.45rem;
 }
 
 .outln-list {
   list-style: none;
   margin: 0;
   padding: 0;
-  font-family: var(--ui-font);
+  font-family: var(--font-ui);
+  /* The rung the rest of the colours are measured from. It is set here rather
+     than left to inherit because everything below either lifts off it
+     (`.here`, `.now`) or drops to `--ink-faint`, and a base that came from
+     whatever the band happens to inherit makes both of those unpredictable. */
+  color: var(--ink-soft);
 }
 /* One tab stop for the whole tree, so the rows are reachable without putting
    forty stops in front of the prose — the pattern Diagram mode already uses.
@@ -8939,7 +8951,23 @@ table.only-prose thead { display: none; }
 .outln-list:focus-visible { outline: none; }
 
 .outln-row {
-  display: block;
+  /* **A grid, so the number sits BESIDE the title instead of above it.**
+     `.outln-text` needs `display: -webkit-box` for its line clamp, and that is
+     a *block-level* box: as an inline-flow sibling of `.outln-num` it took a
+     line of its own, so every numbered row was two lines tall. Nothing
+     errored and nothing measured wrong — the clamp still said one line, and
+     the fit measures real markup so it saw the truth — the panel just spent
+     half its height on numbers, and the header's "one line per row" was false
+     for every row that had a number.
+
+     The grid also gives the title a hanging indent and starts every sibling's
+     title at the same x, which is most of what makes a run of them read as a
+     run. */
+  display: grid;
+  grid-template-columns: auto minmax(0, 1fr);
+  column-gap: 0.4rem;
+  /* The level rails are absolutely positioned against the row. */
+  position: relative;
   cursor: pointer;
   border-radius: 3px;
   padding: 0.12rem 0.3rem;
@@ -8949,17 +8977,54 @@ table.only-prose thead { display: none; }
 }
 .outln-row.lvl-1 { margin-top: 0.5rem; font-weight: 600; }
 .outln-row.lvl-1:first-child { margin-top: 0; }
-.outln-row.lvl-2 { padding-left: 1.1rem; }
-.outln-row.lvl-3 { padding-left: 2.2rem; font-weight: 400; }
+.outln-row.lvl-2 { padding-left: var(--outln-indent); }
+.outln-row.lvl-3 {
+  padding-left: calc(var(--outln-indent) * 2);
+  font-weight: 400;
+  /* No number, so no gutter to gap away from — see `.lvl-3 .outln-num`. */
+  column-gap: 0;
+}
 
 .outln-num {
-  display: inline-block;
-  min-width: 1.6em;
-  color: var(--muted);
+  grid-column: 1;
+  color: var(--ink-faint);
   font-variant-numeric: tabular-nums;
 }
+/* **A gutter per level, not one width for all of them.** "1" and "1.10" are
+   different widths, and a shared `min-width` either wastes a level-1 row's
+   space or lets a level-2 number push its title out of line with its
+   siblings'. Tabular figures make each reservation exact. */
+.outln-row.lvl-1 .outln-num { min-width: 1.1em; }
+.outln-row.lvl-2 .outln-num { min-width: 2.3em; }
 .outln-row.lvl-3 .outln-num { display: none; }
 
+/* ── Levels and siblings ─────────────────────────────────────────────────────
+   Indent says how deep a row is; it does not say which rows it belongs with.
+   A run of six sections with two paragraphs nested inside one of them is two
+   groups, and at one indent step they read as a single ragged column — the
+   complaint that produced this. So every nested run also gets a hairline rail
+   in the gutter its own level opened, drawn on each row of the run and joining
+   into a continuous line because the rows touch (only `.lvl-1` has a margin,
+   which is what separates the parts).
+
+   A level-3 row needs BOTH rails: its own, and its parent section's continuing
+   *through* it. A section rail that stopped where its own paragraphs begin
+   would say the paragraphs are outside the section. Hence `::before` for the
+   inherited rail and `::after` for the row's own. */
+.outln-row.lvl-2::before,
+.outln-row.lvl-3::before,
+.outln-row.lvl-3::after {
+  content: "";
+  position: absolute;
+  top: 0;
+  bottom: 0;
+  width: 1px;
+  background: var(--rule-strong);
+}
+.outln-row.lvl-2::before,
+.outln-row.lvl-3::before { left: var(--outln-rail); }
+.outln-row.lvl-3::after { left: calc(var(--outln-rail) + var(--outln-indent)); }
+
 /* **One line per row, which the fit's arithmetic assumes and nothing enforced
    until now.** A wrapped title or a paragraph's navLabel silently made the
    list taller than the row count implies and the boundary churn larger than
@@ -8970,6 +9035,11 @@ table.only-prose thead { display: none; }
    use. `overflow-wrap: anywhere` stays so a URL in a navLabel breaks rather
    than being hard-clipped with nothing to say so. */
 .outln-text {
+  /* Named, never auto-placed: at level 3 the number is `display: none` and so
+     is not a grid item at all, and an auto-placed title would slide into the
+     `auto` first column and size itself to its own content — no clamping, and
+     an overflowing row. */
+  grid-column: 2;
   display: -webkit-box;
   -webkit-box-orient: vertical;
   -webkit-line-clamp: 1;
@@ -8982,20 +9052,35 @@ table.only-prose thead { display: none; }
 .outln-row.tier-cur  { font-size: 0.95rem; }
 .outln-row.tier-near { font-size: 0.9rem; }
 .outln-row.tier-mid  { font-size: 0.85rem; }
-.outln-row.tier-far  { font-size: 0.82rem; color: var(--muted); }
+.outln-row.tier-far  { font-size: 0.82rem; color: var(--ink-faint); }
 
 /* Where the reader is. `.here` is the whole ancestor chain and `.now` is the
    one deepest drawn row — two marks because at a shallow rung the part is the
    honest answer to "where am I", and a stripe repeated on four nested rows is
    not a mark anyone can find. */
-.outln-row.here { color: var(--fg); }
+.outln-row.here { color: var(--ink); }
+/* Before `.now`, so the current row keeps its own ground under the pointer. */
+.outln-row:hover { background: var(--surface-raised); }
 .outln-row.now {
-  background: var(--panel-2, rgba(127, 127, 127, 0.12));
+  /* The orange tinted into the page, the token the rest of the app already
+     uses for "this one" — and a real token, which `--panel-2` never was. */
+  background: var(--highlight-wash);
   font-weight: 650;
 }
-.outln-row.read .outln-text { color: var(--muted); }
+/* **Where the reader is, marked on the sibling rail as well as in the row.**
+   The rail is the thing the eye runs down when it is asking "which of these am
+   I in", so the answer belongs on it — a thumb on a track. */
+.outln-row.now.lvl-2::before {
+  width: 2px;
+  background: var(--highlight);
+}
+/* Read, and far away, are deliberately the SAME value rather than two steps of
+   dimness that could be told apart. Both mean "periphery", and giving them a
+   step each is how the panel would end up with an opacity ladder the header
+   forbids. */
+.outln-row.read .outln-text { color: var(--ink-faint); }
 /* The apparatus: present in the structure, outside the argument. */
-.outln-row.supplement { font-style: italic; color: var(--muted); }
+.outln-row.supplement { font-style: italic; color: var(--ink-faint); }
 /* `--highlight`, never `--accent`: tokens.css defines `--accent` as a raised
    dark SURFACE (shadcn's meaning), so a ring drawn in it is nearly invisible
    against the panel — and the native outline is suppressed on the list, so
@@ -9004,23 +9089,24 @@ table.only-prose thead { display: none; }
    `--highlight`. GPT Sol caught it, 2026-08-28. */
 .outln-row.focused { box-shadow: inset 0 0 0 2px var(--highlight, currentColor); }
 
-.outln-row:hover { background: var(--panel-2, rgba(127, 127, 127, 0.08)); }
-
 /* The sentence on the current section, and the arc sentence on the current
    part. Prose, so they take the reading face at reading size rather than the
    list's UI font — the mistake GPT's review caught in the gist columns, where
    an inherited UI font left a gist a step LARGER than the title above it. */
 .outln-gist,
 .outln-arc {
+  /* Under the title, not under the number: a sentence hanging off its heading
+     reads as belonging to it. */
+  grid-column: 2;
   margin: 0.2rem 0 0.1rem;
-  font-family: var(--read-font, inherit);
+  font-family: var(--font-reading);
   font-size: 0.85rem;
   font-weight: 400;
   line-height: 1.4;
-  color: var(--fg);
+  color: var(--ink);
   overflow-wrap: anywhere;
 }
-.outln-arc { color: var(--muted); font-style: italic; }
+.outln-arc { color: var(--ink-soft); font-style: italic; }
 
 /* The candidates being measured. Laid out for real — same width, same styles,
    same wrapping — and simply not painted. `visibility: hidden` rather than
@@ -9042,9 +9128,9 @@ table.only-prose thead { display: none; }
 }
 
 .outln-card { max-width: 22rem; }
-.outln-card-crumb { font-size: 0.75rem; color: var(--muted); }
+.outln-card-crumb { font-size: 0.75rem; color: var(--ink-faint); }
 .outln-card-title { font-weight: 600; margin-bottom: 0.2rem; }
-.outln-card-gist { margin: 0; font-family: var(--read-font, inherit); }
+.outln-card-gist { margin: 0; font-family: var(--font-reading); }
 
 /* ── The arc, while it is being written ───────────────────────────────────────
 
```

## The new test file (untracked)
```ts
/**
 * **Every custom property a stylesheet reads is one that exists, and no text
 * colour is drawn in a surface token.**
 *
 * Both halves of this were live in `§ outline mode` until 2026-08-30, and
 * between them they made half the panel unreadable — Greg's screenshot, and
 * the reason this file exists. The block had been written against a token
 * vocabulary this app does not have:
 *
 *   - `var(--fg)`, `var(--panel-2)`, `var(--ui-font)` — **defined nowhere.**
 *     An undefined custom property with no fallback is *invalid at computed
 *     value time*: the declaration is thrown away and the property inherits.
 *     So `.outln-row.here { color: var(--fg) }` — the mark on the whole
 *     ancestor chain, one of the panel's two answers to "where am I" — simply
 *     did nothing, and looked exactly like a rule that had been applied.
 *   - `color: var(--muted)` in six places. `--muted` is shadcn's *surface*
 *     grey, `oklch(0.245 0 0)`, and the page is `oklch(0.145 0 0)`: about
 *     1.2:1. The text was painted, correctly, in very nearly the background.
 *     The text token is `--muted-foreground` / `--ink-faint`.
 *
 * tokens.css already carries a comment warning about exactly this for
 * `--accent`, and styles.css carries another. Two comments, and the mistake
 * was made anyway — a rule that is only written down is not a check. So it is
 * one here.
 *
 * Both checks are deliberately whole-file rather than scoped to one block: the
 * class is "a stylesheet naming a token from somewhere else", and it has no
 * reason to prefer the outline.
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Every stylesheet the client actually loads — tailwind.css imports the rest. */
const SHEETS = [
  "src/web/tailwind.css",
  "src/web/styles.css",
  "styles/tokens.css",
  "styles/colourscales.css",
];

/** Comments are prose about tokens, not uses of them. `--cat-N-rgb` is a
 *  comment's way of writing a family and would otherwise fail here. */
const decomment = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const sheets = SHEETS.map((path) => ({ path, css: decomment(readFileSync(path, "utf8")) }));

const declared = (re: RegExp, hay: string) => {
  const out = new Set<string>();
  for (const m of hay.matchAll(re)) if (m[1]) out.add(m[1]);
  return out;
};

describe("no stylesheet reads a custom property that nothing defines", () => {
  /* Defined in CSS. */
  const inCss = new Set<string>();
  for (const { css } of sheets) {
    for (const t of declared(/(--[A-Za-z0-9_-]+)\s*:/g, css)) inCss.add(t);
  }

  /* Defined from the client, as an inline style. Some are written as a literal
     key (`"--lane": …`) and some as a template (`--h${i}`), so the templates
     are kept as prefixes and matched against a numeric tail — which is exactly
     what annotate.ts emits. */
  const js = globSync("src/web/**/*.{ts,tsx}")
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  const fromJs = new Set<string>();
  const jsFamilies = new Set<string>();
  /* The closing quote of an object key sits between the name and the colon:
     `{ "--lane": … }`. Leaving it out of the pattern is why this test's first
     run reported `--lane` and `--h` as undefined when both are set two lines
     apart in Spine.tsx. */
  for (const t of declared(/(--[A-Za-z0-9_${}-]+)["'`]?\s*:/g, js)) {
    if (t.includes("${")) jsFamilies.add(t.replace(/\$\{[^}]*\}/g, ""));
    else fromJs.add(t);
  }
  const setFromJs = (token: string) =>
    fromJs.has(token) ||
    [...jsFamilies].some((f) => token.startsWith(f) && /^\d+$/.test(token.slice(f.length)));

  for (const { path, css } of sheets) {
    /* `var(--x, fallback)` is fine whether or not `--x` exists — the fallback
       is the author saying so. Only the no-fallback form is a claim that the
       token is there, and only that form is checked. */
    const used = declared(/var\(\s*(--[A-Za-z0-9_-]+)\s*\)/g, css);
    for (const token of [...used].sort()) {
      if (inCss.has(token)) continue;
      it(`${path} reads ${token}`, () => {
        expect(
          setFromJs(token),
          `\`var(${token})\` in ${path} is defined in no stylesheet and set by no inline style. ` +
            `An undefined custom property with no fallback makes the whole declaration invalid ` +
            `and the property inherits — nothing errors, the rule just does nothing.`,
        ).toBe(true);
      });
    }
  }
});

/**
 * The tokens tokens.css defines as *surfaces*. Each has a `-foreground` twin
 * that is the text colour, and styles.css adds `--ink` / `--ink-soft` /
 * `--ink-faint` over the top. Painting text in one of these puts near-black on
 * near-black: it is the mistake, not a dark-mode subtlety.
 */
const SURFACES = [
  "--background",
  "--card",
  "--popover",
  "--secondary",
  "--muted",
  "--accent",
  "--sidebar",
  "--input",
  "--border",
];

describe("no text is painted in a surface token", () => {
  for (const { path, css } of sheets) {
    /* `color:` only — the lookbehind keeps `background-color`, `border-color`,
       `caret-color` and the rest out, which are the properties these tokens
       are for. */
    const hits: string[] = [];
    for (const m of css.matchAll(/(?<![-\w])color:\s*var\(\s*(--[A-Za-z0-9_-]+)/g)) {
      if (m[1] && SURFACES.includes(m[1])) hits.push(m[0]);
    }
    it(path, () => {
      expect(
        hits,
        `these paint text in a surface token; the text twin is \`<token>-foreground\`, ` +
          `or one of --ink / --ink-soft / --ink-faint`,
      ).toEqual([]);
    });
  }
});
```

## The relevant token definitions (styles/tokens.css and the semantic layer in styles.css)
```css

    /* ---- surfaces and text (dark only; see the header) ---------------- */
    /* Not literally #000 on #fff inverted: the page is all-but-black and the text is off-white,
       because pure white on pure black haloes at reading sizes. That was first noticed in Georgia,
       and it did not go away when the reading face became Geist — light-on-dark bloom is about the
       contrast, not the face. The other half of the same fix is --reading-weight below. */
    --background: oklch(0.145 0 0);
    --foreground: oklch(0.97 0 0);
    --card: oklch(0.205 0 0);
    --card-foreground: oklch(0.97 0 0);
    --primary: oklch(0.65 0.15 45);            /* Spideryarn orange in OKLCH — unchanged */
    --primary-foreground: oklch(0.16 0.02 45); /* text *on* an orange fill, so now near-black */
    --secondary: oklch(0.269 0 0);
    --secondary-foreground: oklch(0.97 0 0);
    --muted: oklch(0.245 0 0);
    --muted-foreground: oklch(0.63 0 0);
    /* CAREFUL: --accent here is shadcn's meaning — a raised dark *surface* for hover
       states — NOT the brand highlight colour. If you import this file into a
       stylesheet that already uses --accent to mean "the orange", every highlight
       silently goes near-black and vanishes into the page. Use --highlight /
       --spideryarn-orange for the orange, and rename your own variable rather than
       redefining --accent. */
    --accent: oklch(0.269 0 0);
    --accent-foreground: oklch(0.97 0 0);
    --destructive: oklch(0.65 0.2 27.325);
    /* Required by every Radix overlay shadcn builds on (popover, dropdown,
       tooltip content). The value is the raised-panel grey that styles.css
       already calls --surface-raised: on a dark page, up is forward. */
    --popover: oklch(0.26 0 0);
    --popover-foreground: oklch(0.97 0 0);
    --destructive-foreground: oklch(0.97 0 0);

    --border: oklch(0.27 0 0);
    --input: oklch(0.3 0 0);
    /* The focus ring, and it is the app's orange rather than shadcn's grey on
       purpose. Two reasons, and the second is the real one.
   that means "the orange" says --highlight, so the two never get confused.  */
:root {
  /* On a dark page the greys run the other way: soft/faint means *darker*, not
     lighter, so these lightnesses descend from --ink rather than ascending. */
  --ink: var(--foreground);
  --ink-soft: oklch(0.78 0 0);
  --ink-faint: var(--muted-foreground);

  --page: var(--background);
  --panel: var(--sidebar);
  /* Floats above everything: the tooltip panel. Lighter again than --panel,
     which is itself lighter than --page — on a dark ground, up is forward. */
  --surface-raised: oklch(0.26 0 0);
  --rule: var(--border);
  --rule-strong: oklch(0.36 0 0);

  --highlight: var(--spideryarn-orange);
```
