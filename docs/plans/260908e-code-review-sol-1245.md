## Verdict: land it with changes

The core `.band-covers` fix is correct, but I would not ship this exact diff.

### Findings

1. **The install-hint deferral is not defensible. This patch widens the mismatch.**

   On an uninstalled iPhone, `.install-hint` sets `--hint-h: 3.5rem`. In a side-by-side mode after scrolling:

   - the new rule translates the hint off-screen;
   - `--dock-bottom` becomes `0`;
   - but `.mode-band` still uses `+ var(--hint-h)` and therefore stops roughly 56px above the bottom.

   The result is a blank/exposed strip larger than the 40px dock this change was intended to reclaim. The headless measurements did not cover this configuration because the install hint only renders on uninstalled iOS. See [narrow-window.css](/home/greg/code/spideryarn2/.claude/worktrees/fb2f-dock-always-visible-landscape/src/web/styles/narrow-window.css:646), [mode-band.css](/home/greg/code/spideryarn2/.claude/worktrees/fb2f-dock-always-visible-landscape/src/web/styles/mode-band.css:47), and [dock.css](/home/greg/code/spideryarn2/.claude/worktrees/fb2f-dock-always-visible-landscape/src/web/styles/dock.css:150).

   It also newly creates the acknowledged dock/hint disagreement in side-by-side modes: a drawer, focused dock, focused hint, or dialog can restore the dock while the hint remains translated away.

   Fix the dock/hint state centrally. The proposed transform variable is appropriate, but it also needs a “current hint clearance” value for `.mode-band`; `--hint-h` should remain the permanent document-padding reservation.

2. **The same proxy bug remains live in `shell.css` for public visitors.**

   Owners normally have no `.controls` in a band mode. Visitors do: `barHasContent()` always returns true for them so it can show the read-only chip. Consequently these rules still pin the top bar whenever any band is open:

   - the `--bar-bottom` guard;
   - the `transition: none` rule.

   That is exactly the old proxy bug, one reader type wide. See [shell.css](/home/greg/code/spideryarn2/.claude/worktrees/fb2f-dock-always-visible-landscape/src/web/styles/shell.css:659) and [layout.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb2f-dock-always-visible-landscape/src/web/layout.ts:474).

   Change both bare `.mode-band` conditions to `:where(.reader.band-covers) .mode-band`. Specificity remains unchanged.

3. **One load-bearing specificity comment is still wrong.**

   The new explanation correctly says `.dock:focus-within` is `(0,2,0)` and the complete guard is `(0,3,0)`. But the earlier comment still calls `.dock:focus-within` itself `(0,3,0)`, directly contradicting the correction below it. See [narrow-window.css](/home/greg/code/spideryarn2/.claude/worktrees/fb2f-dock-always-visible-landscape/src/web/styles/narrow-window.css:450).

   The actual specificity is correct:

   - dock guard: `(0,3,0)`;
   - transition rule: `(0,3,0)`;
   - install-hint rule: `(0,3,0)`.

4. **The submitted static test can pass with the bug restored.**

   `bandMentions()` greedily spans a whole comma-separated selector. This passes:

   ```css
   :root:has(.mode-band, :where(.reader.band-covers) .mode-band)
   ```

   The match contains `band-covers`, and the exact guarded spelling is still present, yet the bare arm pins the dock again. I reproduced that against the submitted regex.

   Other holes:

   - deleting the install-hint rule entirely still passes;
   - `[class~="mode-band"]` or an escaped class spelling is invisible;
   - `:not(.band-covers):has(.mode-band)` can satisfy substring checks while meaning the opposite;
   - an unrelated responsive `.mode-band { … }` rule would be a false positive.

   The hardcoded media string does fail loudly: any textual change makes `indexOf()` return `-1`, and an unmatched block throws. The brace balancer is not string-aware, but that is secondary.

   Exact selector brittleness is appropriate here because `:where()` is part of the specificity fix. Assert the three selectors/declarations individually rather than treating every `.mode-band` mention as equivalent.

   The working tree changed during this review and now contains an uncommitted per-occurrence replacement that closes the comma-arm bypass. It still needs an assertion that the install-hint rule exists.

5. **The overscroll claim is weakened enough to support the safety argument, but its negative list is incomplete.**

   The four named selectors genuinely lack `overscroll-behavior`, and the five named containing scrollers genuinely have it. But Chat, Referee, Diagram, Sketch, and Illustrated also have band scrollers without containment—for example `.chat-scroll`, `.ref-panel`, `.diag-scroll`, `.sk-scroll`, and `.ill-scroll`.

   Say “for example” before the four-selector list or remove the attempted inventory. “Several covering scrollers contain overscroll” is sufficient for the safety argument.

### Direct answers

- **Dock unreachable:** I found no demonstrated unreachable dock caused by the semantic selector. In side-by-side layout the article remains exposed and any upward document movement restores the dock. The unresolved soft-keyboard case is real but not proven unreachable.
- **Missing configurations:** the measurements omit the two important dimensions above: an uninstalled iPhone with the install hint, and a signed-out/public visitor with a controls bar. They also do not emulate coarse pointer or non-zero safe-area insets.
- **`:focus-within`:** `.mode-band:focus-within` is gone from all operative selectors; it remains only in explanatory comments.
- **Class timing:** safe. `fit`, the parent class, `--mode-w`, and the band are produced by the same React render. DOM mutations are painted after the commit, so there is no intermediate frame with a mounted band and stale parent class. Initial width measurement is synchronous, and resize/orientation updates recompute both together.

Verification: the four scoped test files passed, 35/35, before the concurrent test edit. Typechecking passed across all projects. Full `npm test` could not run because the local database was unavailable; a later targeted rerun was refused by the repository’s memory admission guard.