You are reviewing a plan before it is built, in the Spideryarn repo (this working tree). Read-only.

The plan: docs/plans/261017g-native-title-tooltips-become-rich-cards-everywhere-and-a-test-keeps-it-that-way.md

Background to read: docs/project/tooltips.md (especially § Prefer the rich card to a native `title`, § The second implementation, § Five things that are load-bearing), src/web/BlockLinkCard.tsx (the delegated card the plan generalises, including its GUTTER_CONTROL branch), src/web/Tooltip.tsx, src/web/IconButton.tsx, src/web/BlockGutter.tsx (the existing `data-tip` users), src/web/main.tsx (where the new card would mount), src/sanitize-policy.ts (`ALLOW_DATA_ATTR`, `ARTICLE_DATA_ATTRS`), tests/fleet-imports.test.ts (the babel-AST pattern), tests/gutter-control-card.test.tsx and tests/block-link-card.test.tsx.

Inventory of native titles today: grep `src/web` for JSX `title=` on lowercase elements (about 170), plus `<Button title`, `<Link title`, `<SourceLink title`, and the two SVG `<title>` in src/web/cost-charts.tsx.

Please answer:
1. Is the design (one page-wide delegated `[data-tip]` card mounted in main.tsx outside App, and `title` → `data-tip` at every site) right, or is there a better one? Is lifting a `useDelegatedCard` hook out of BlockLinkCard the right call, versus a separate smaller TipCard? What could break in the reading view?
2. Accessibility: what is lost moving from `title` to `data-tip`, and is the plan's handling (aria-label where title was the only name; aria-describedby while open) enough? Any element types where this is wrong (inputs, `<time>`, table headers, SVG, `<a>`)?
3. Disabled buttons: do pointerover/pointerout reach a `disabled` <button> in current Chromium, Firefox and Safari? What do you recommend for the handful of disabled-with-explanation sites?
4. Interactions to worry about: a `[data-tip]` inside a `Tooltip` trigger, or inside an interactive card, or inside a `[data-block-link]` (two cards at once?); a `[data-tip]` element that is also a Tooltip trigger (IconButton titled=false precedent); Escape handling vs dialogs (see 261010g's "one Escape, one surface"); touch.
5. The guard test: anything it should catch that it would not? Anything it would false-positive on? Is the allowlist right?
6. Anything in the plan that is false about the code.

Write a verdict (go / go with changes / rethink) and numbered findings with file:line evidence.
