## Findings

- **High — safe-area handling is missing.** [PageContents.tsx:391](/home/greg/code/spideryarn2/.claude/worktrees/fb9m-metadata-toc-on-ipad/src/web/PageContents.tsx:391), [plan:24](/home/greg/code/spideryarn2/.claude/worktrees/fb9m-metadata-toc-on-ipad/docs/plans/261002a-metadata-contents-on-an-ipad-in-landscape.md:24)  
  The fixed nav keeps `left: 1.5rem`, despite the project rule that fixed chrome adds the safe inset it faces ([tokens.css:89](/home/greg/code/spideryarn2/.claude/worktrees/fb9m-metadata-toc-on-ipad/src/web/styles/tokens.css:89)). Simply adding `--safe-left` to the nav is insufficient: with inset `s`, its right edge becomes `12.5rem + s`, while the planned text begins at `13.5rem`, reducing the gap from `1rem` to `1rem - s` and potentially creating overlap.

  Adjust both sides together, for example:

  ```text
  nav:  tw:left-[calc(1.5rem_+_var(--safe-left))]
  main: tw:lg:ml-[max(calc(12rem_+_var(--safe-left)),calc((100%_-_48rem)/2))]
  ```

  Add a browser case with forced non-zero `--safe-left`/`--safe-right`; normal Playwright runs expose zero insets on this machine.

- **Low — the 1152px centring claim is only true without a classic scrollbar.** [plan:29](/home/greg/code/spideryarn2/.claude/worktrees/fb9m-metadata-toc-on-ipad/docs/plans/261002a-metadata-contents-on-an-ipad-in-landscape.md:29), [plan:59](/home/greg/code/spideryarn2/.claude/worktrees/fb9m-metadata-toc-on-ipad/docs/plans/261002a-metadata-contents-on-an-ipad-in-landscape.md:59)  
  `100%` here correctly means the containing block’s logical width, not the `main` element’s width ([CSS Box Model specification](https://www.w3.org/TR/css-box-3/)). That containing width excludes a classic scrollbar. With a 15px scrollbar at a 1152px viewport, the margins are 192px and 177px; exact centring begins around 1167px. Describe the threshold as “1152px of containing-block width,” and make the check account explicitly for scrollbar width.

- **Low — the touched comments preserve an already-stale typography claim.** [Metadata.tsx:760](/home/greg/code/spideryarn2/.claude/worktrees/fb9m-metadata-toc-on-ipad/src/web/Metadata.tsx:760), [PageContents.tsx:459](/home/greg/code/spideryarn2/.claude/worktrees/fb9m-metadata-toc-on-ipad/src/web/PageContents.tsx:459)  
  They say `.metadata-page` owns a page-scoped button-font rule, but that rule was removed ([feedback.css:607](/home/greg/code/spideryarn2/.claude/worktrees/fb9m-metadata-toc-on-ipad/src/web/styles/feedback.css:607)); the reset is now global ([tailwind.css:364](/home/greg/code/spideryarn2/.claude/worktrees/fb9m-metadata-toc-on-ipad/src/web/tailwind.css:364)). Since this plan already edits both adjacent comments, correct them now.

## Verified

- Global border-box makes the 48rem width include the 1.5rem padding, so the plan’s ordinary zero-inset geometry is correct ([tokens.css:358](/home/greg/code/spideryarn2/.claude/worktrees/fb9m-metadata-toc-on-ipad/src/web/styles/tokens.css:358)).
- The exact Tailwind class currently present—`tw:lg:ml-[max(12rem,calc((100%_-_48rem)/2))]`—compiles correctly under installed Tailwind 4.3.3. The `tw:` prefix comes first, and underscores provide the required spaces; this matches Tailwind’s [arbitrary-value syntax](https://tailwindcss.com/docs/styling-with-utility-classes#using-arbitrary-values).
- Metadata has no band or sticky bar aligned to the centred `main`. The Dock spans the viewport and is cleared vertically by `--dock-space`; the contents nav also deducts that space. The toast is a transient bottom-right overlay and already overlaps part of the prose region, but the change creates no nav/toast or nav/Dock collision.
- The margin formula remains the simplest design. A grid/sticky wrapper would couple the geometry more structurally, but adds markup and changes scrolling behavior without solving more of the reported problem.

## Verdict

**Revise before approval.** The core design and arithmetic are sound, but the safe-area omission is plan-blocking for an installed iPad-oriented change. Add the inset to both the nav position and the main’s margin floor, test with forced non-zero insets, and correct the scrollbar wording.