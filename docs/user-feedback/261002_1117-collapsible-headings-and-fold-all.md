---
reports: spya-skqwg8
ending: shipped
---
# Fold a heading's section away, or every section at once

Report `spya-skqwg8`, a suggestion, from Greg (admin), 2026-10-02, relayed by the Overseer with no
Sentry mirror, on `https://www.spideryarn.com/read/s41598-023-33209-9-spya-hxekgz?term=spya-y2tchy&mode=summary&summary=fuller`:

> It would be nice to be able to make headings collapsible, i.e. a little icon that would hide that
> heading's section.
>
> And ideally `Cmd+Opt+t` (and appropriate Windows equivalent) as keyboard shortcut to
> expand/collapse all.  And/or perhaps if I hold Opt while pressing on the expand/collapse-icon it
> switches to expand/collapse-all?
>
> (Indicate keyboard shortcuts in the heading-collapse-icon rich tooltip).
>
> If you can see a place in the UI to provide an icon to expand/collapse-all, add that too.
>
> Update docs as appropriate.
>
> Stop & let's discuss first if this would add substantial complexity.

**Ending: Shipped**, on `dev`. Plan
[261002e](../plans/261002e-collapsible-headings-and-fold-all.md).

**Was it substantial? No**, so it was built rather than brought back to discuss. The worry was that
almost everything in the reading view measures rows (the spine, `?at=`, the arrow keys). Hiding a
row's *cells* rather than the row keeps it in place at zero height, so those mostly kept working.
Five places needed to know about folds, all found by GPT Sol's two reviews and fixed.

What you get:

- **A chevron at the right-hand end of every heading** that has paragraphs under it. Press it to
  hide that section, down to the next heading at the same level or above. Press it again to bring
  the section back.
- **⌥-click (Alt-click) a chevron**, **⌘⌥T** (Ctrl+Alt+T off a Mac), or the masthead's **Fold all**
  beside *N sections*: folds every section, or opens them all if any is folded. The chevron's card
  names all three.
- **Any jump into a folded section opens it**: a search hit, a Structure row, a chip, a comment.
  **↑ / ↓ step over a folded section** rather than opening it.

What it does not do yet, by name in the plan:

- It does not remember folds across a reload.
- It does not fold by the AI's Structure tree, only by the author's own headings.
- The browser's ⌘F does not find words inside a folded section.

**The shortcut is best-effort:**

- Safari web apps use ⌘⌥T for *show/hide toolbar*.
- Ubuntu opens a terminal on Ctrl+Alt+T before the page sees it.
- On many Windows keyboard layouts Ctrl+Alt is AltGr.

⌥-click and *Fold all* work everywhere. keyboard.md § ⌘⌥T says so.
