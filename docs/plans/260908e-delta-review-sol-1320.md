## Verdict: land it with changes

The visitor-bar change and `--hint-now` arithmetic are correct. One part of finding 1 remains unresolved and is newly reachable in side-by-side modes.

### Required code change

The dock and install hint still do not share one cascade decision.

With `data-bars="hidden"` in a side-by-side mode:

1. The hidden rule sets `--dock-bottom: 0`.
2. Any drawer, dock focus, install-hint focus, or dialog makes the guard restore `--dock-bottom`.
3. The hint nevertheless remains translated away, and `--hint-now` remains `0`, because both rules exclude only a covering band.

See [narrow-window.css](/home/greg/code/spideryarn2/.claude/worktrees/fb2f-dock-always-visible-landscape/src/web/styles/narrow-window.css:556) versus [narrow-window.css](/home/greg/code/spideryarn2/.claude/worktrees/fb2f-dock-always-visible-landscape/src/web/styles/narrow-window.css:657).

The sharpest failure is `.install-hint:focus-within`: the guard keeps the dock home specifically so a keyboard reader does not lose the focused control, but the hint containing that control still translates off-screen. Before this patch, any `.mode-band` prevented that transform, so the claim that the mismatch “is not widened” is false.

Finish the central design from the previous review:

- Define `--install-hint-transform: translateY(0px)`.
- Have `.install-hint` read it.
- In the hidden-root rule, set `--dock-bottom: 0px`, `--hint-now: 0px`, and the hidden transform together.
- In the higher-specificity guard, restore all three together: resting dock, `--hint-now: var(--hint-h)`, and identity transform.
- Remove the separate selector that duplicates only the band arm.

Update the static test to assert those paired declarations.

### Direct answers

- Yes, `--hint-now: var(--hint-h)` resolves from the winning `--hint-h` on the same `:root`. Source order does not freeze it at `0`; the install-hint rule makes it 3.5rem.
- The new selector is `(0,2,0)` and beats the token declaration’s `(0,1,0)`. Its cascade is technically correct; the incomplete state model above is the problem.
- The two changed consumers are the only current-position consumers. The reader padding, dialogs, dialog height constraints, offline strip, return chip, and the hint’s own height deliberately need resting/stable geometry.
- `--hint-now` cannot feed document height or `stepBar`: it is consumed only by the fixed mode band and fixed overflow pseudo-element.
- The shell selectors remain exactly `(0,4,0)` and `(0,3,0)`. The leading direct-child `:has()` remains an existence/scope gate, and the no-bar rule cannot conflict when a visitor’s real controls bar exists.
- No visitor state loses a necessary exit. Covering bands remain pinned; side-by-side visitors retain the article and dock, while the bar contains only a non-interactive status chip.
- Both injected measurements are faithful for the CSS behavior. “First child” is unnecessary—actual matching requires only a direct child—but after the bar is sticky it does not change the result. The injections do not independently test React’s environment/render gates, which `shouldOfferInstall` and `barHasContent` cover separately.

Also correct the stale plan claims that the mismatch was “not widened” and that the visitor shell case is “still open”; the latter is now fixed. The `ViewOnlyChip` comments claiming it stays visible at every scroll position also need narrowing.

I reran the three directly relevant test files: 55/55 passed. `git diff --check` is clean.