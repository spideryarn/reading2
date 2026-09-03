# Review prompt: the signed-out marketing pages redesign

You are reviewing a redesign of the two signed-out marketing pages of a web app, `/` and
`/features`. Be adversarial and concrete. I want correctness and craft problems, not
encouragement.

## Read these, in this order

1. `docs/plans/260903g-redesign-the-signed-out-marketing-pages.md` — the plan, including the design
   posture the owner chose and the advice he chose it against.
2. `output/site-redesign.diff` — the whole change to the four source files, as a scoped diff.
3. `docs/project/marketing-pages.md` — the doc written alongside it.
4. `src/web/tailwind.css` — the stylesheet entry point. Its header comment carries several traps
   that this change could plausibly have walked into (layer order, the `tw` prefix, no preflight,
   the `dark:` variant redefinition, the image `height: auto` rule).
5. `docs/project/design-css-overview.md` — which mechanism owns which style, and the colour rules,
   including the `oklch` vs `oklab` mixing trap and the "`--accent` is a surface, not the orange"
   collision.

## The stack, so you do not flag non-problems

React 19 + Vite, TypeScript ESM. Tailwind v4 with a **`tw` prefix and v4 colon syntax** — `tw:flex`,
`tw:hover:bg-accent`. Tailwind preflight is deliberately NOT imported. Hand-written CSS lives in
`src/web/styles.css` inside `@layer app`; utilities are in `@layer utilities` and outrank it. The app
is **dark-only, unconditionally** — no light theme, no `prefers-color-scheme`. Brand orange is
`#DB8A45`, exposed as `--highlight` / `--spideryarn-orange`; `--accent` is a dark surface and not the
orange. No new npm dependency was added and none should be proposed.

## What I want you to look for, hardest first

1. **CSS correctness.** Anything in the new `§ the site` block at the foot of `styles.css` that is
   invalid, silently dropped, or does not do what its comment claims. Specifically:
   - `var(--x)` with no fallback naming a token that does not exist — that is invalid at computed
     value time, the whole declaration is dropped, and it looks exactly like a rule that applied.
   - `background-clip: text` with `-webkit-text-fill-color: transparent` — is the fallback `color`
     actually reachable in any browser, or have I written a heading that can render invisible?
   - The masked-gradient border on `.site-frame-hero::before` (`mask-composite: exclude` plus the
     `-webkit-` pair). Does this degrade safely?
   - `backdrop-filter` on `.site-nav` over a `color-mix()` background.
   - `animation-timeline: scroll(root block)` on `.site-nav` and `.site-tilt`, and
     `view(block)` on `.site-reveal`. Are the `@supports` guards testing the right thing? Is there
     any browser or state where content ends up **permanently invisible or permanently skewed**?
     I care about this one most — invisible content is a real bug, a missing flourish is not.
   - The `@media print` override — does it actually cover everything that could print blank?
2. **Layout.** Overflow: the hero is inside `overflow-hidden`, the glow is `inset-inline: -30%`, and
   the tilt uses a 3D transform. Can the page scroll sideways at any width? Does the sticky nav have
   an ancestor that clips or transforms it, which would silently kill `position: sticky`? Is
   `tw:scroll-mt-20` on the sign-in anchor enough to clear a 3.5rem sticky bar?
3. **Accessibility.** Heading order (`h1`, then `h2`s from `H2`, then `h3` inside `Showcase` and
   `Tile` — is that right, or does `Showcase` need to be an `h2`?). Contrast of
   `--muted-foreground` body text and of the orange `.site-eyebrow` on the page ground. The
   `.site-cta-primary` foreground on orange. Whether the `prefers-reduced-motion` guard in
   `tailwind.css` genuinely neutralises the scroll-driven animations — flattening
   `animation-duration` may do nothing to a scroll-timeline animation, which would leave motion for
   a reader who asked for none. Check that specifically.
4. **React/TSX.** Anything wrong in `SiteBits.tsx` — the `span` prop on `Tile` is interpolated into a
   className, the `Frame` component takes `hero` and `eager` and sets `loading`/`decoding`. Any
   unused prop, any prop that no longer does anything after `Split` became `Showcase`.
5. **Dead code.** `Split` and its `.site-split` / `.site-bleed` CSS were removed mid-change. Is
   anything else now orphaned — an unused import, an unused class, a `Feature` or `Portrait` export
   with no call site?
6. **Honesty of the copy.** Every sentence is supposed to carry a provenance comment naming a dated
   quote from the owner, a product fact, or `[tissue]`. Find any sentence that has lost its comment,
   any comment that now names the wrong thing after the restructure, and any **claim that is not
   checked against the code** — for instance the landing page says "Nine more ways in." above a
   bento grid, and "Four maps of the structure of the piece — force, drift, trail and sketch".
   Count them in the diff. This page has shipped a wrong count before.
7. **What I got wrong that you would have done differently**, in one short section at the end.

## Two things I already know

- The pages are still tall: `/` is about 7,700px and `/features` about 11,800px at 1440 wide.
  Shorter screenshots are being retaken to bring both down. You may still comment on structure.
- The design posture (glow, big type, tilt, bento, scroll-reveal) was chosen by the owner over two
  more restrained options that had both been recommended to him. **Do not re-litigate the posture.**
  Review the execution of it.

Give findings as a numbered list, most severe first, each with the file, the line or selector, what
breaks, and the concrete fix. Say explicitly if you find nothing in a category.
