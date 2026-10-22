The citation layout is directionally right, and Tailwind’s coarse-pointer variant works. Several mechanisms need changing before implementation, especially the later band override, unsafe hit-area halos, and the unbounded `Button` rollout.

**R1 — P1 — Stage 1 improves paragraph separation but worsens line spacing.**

Evidence: the plan records the current 1.5 line-height at [plan:26](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/docs/plans/261021g-phone-sizes-part-two-citations-spacing-and-remaining-touch-targets.md:26), then proposes 1.4 at [plan:67](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/docs/plans/261021g-phone-sizes-part-two-citations-spacing-and-remaining-touch-targets.md:67). That contradicts Greg’s concern about line spacing as well as paragraph spacing.

Suggested change: keep title line-height at least 1.5 while retaining the proposed stacked title/action, padding, and hairline. The two-row source item is the simplest clear shape; an icon-only action would be less understandable.

**R2 — P1 — The band-corner 40px variable will be overwritten on phones.**

Evidence: `mode-band.css` defines the variable around `src/web/styles/mode-band.css@9a8f62146:1926`, but the later-loaded [narrow-window.css:954](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/styles/narrow-window.css:954) sets it back to `2rem` inside a coarse-pointer query. The load order is [styles.css:39](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/styles/styles.css:39) versus [styles.css:57](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/styles/styles.css:57).

Suggested change: replace or override the later narrow-window declaration with `40px` under `any-pointer: coarse`, and update its 32px comment. Then let `--band-about-room` continue deriving from it.

**R3 — P1 — The shadcn `Button` mechanism is sound, but the safety argument and coverage are not.**

Evidence: `Button` merges through `twMerge` at [button.tsx:104](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/components/ui/button.tsx:104). A coarse `min-h-10` remains effective alongside call-site `h-7` or `size-7`; the latter only fixes height, while `min-height` still floors it. Icon variants also need `min-w-10`, as the plan says. Tailwind v4 does support the prefixed `tw:any-pointer-coarse:` form; it is already used at [SetNewPassword.tsx:27](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/SetNewPassword.tsx:27).

However, the repository has 116 JSX `Button` openings across 49 files—not about 273—and they are not all alone in a row. Examples include adjacent sharing controls at [AccessSharing.tsx:664](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/AccessSharing.tsx:664) and up to three compact profile controls at [ProfilePanel.tsx:683](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/ProfilePanel.tsx:683).

The shelf chips are correctly excluded: they do not use this `Button`. The top-bar edit-title control is also excluded unintentionally: it uses `IconButton` at [TitleEditor.tsx:363](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/TitleEditor.tsx:363), whose fixed `size-7` class is at [IconButton.tsx:37](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/components/ui/IconButton.tsx:37).

Suggested change: retain the global shadcn floor, but replace the “alone in its row” claim with an inventory and test representative dense rows, dialogs, hover cards, admin/auth screens, and the four-button quiz state. Give the masthead `IconButton` a local coarse-pointer class rather than silently widening every `IconButton`.

**R4 — P1 — Three proposed `.tap-target` uses do not satisfy the helper’s clearance contract.**

Evidence: the helper explicitly says callers owe it empty surrounding space at [tap-target.css:16](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/styles/tap-target.css:16).

- The facts line is allowed to wrap at [shell.css:413](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/styles/shell.css:413). A single-article measurement cannot prove that 40px halos on read-time/count/fold controls never overlap controls on adjacent wrapped lines.
- The fold toggle already has an accepted 4px overlap with the gutter at [prose.css:125](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/styles/prose.css:125); expanding its 24px target by 8px per side increases that overlap.
- `.skim-where` is an absolute button laid over the separate main-row button at [skim.css:547](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/styles/skim.css:547) and [SkimPanel.tsx:1078](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/SkimPanel.tsx:1078). A halo would steal part of another action’s target.

Suggested change: use drawn `inline-flex; min-height: 40px` controls in the wrapping facts row so line layout reserves the space. Redesign or defer the fold and skim controls until each has its own 40px cell.

**R5 — P1 — The matter information button would remain narrower than 40px.**

Evidence: the plan proposes making both controls 40px tall at [plan:99](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/docs/plans/261021g-phone-sizes-part-two-citations-spacing-and-remaining-touch-targets.md:99), but `.matter-stub-info` has only a 13px icon and tiny horizontal padding at [prose.css:256](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/styles/prose.css:256).

Suggested change: make the information control `40px × 40px`, not merely 40px tall; keep the proposed 8px gap and verify long stub labels wrap acceptably.

**R6 — P1 — The selected gutter bar will cover about two prose lines, not 1.5.**

Evidence: the bar has 2px vertical padding and borders at [gutter.css:1175](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/styles/gutter.css:1175). A 40px row therefore becomes roughly 46px high, while the measured prose line-height in the plan is 23px. The “five-control” width is also unreachable: `BlockGutter` constructs at most four simultaneous controls at [BlockGutter.tsx:503](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/BlockGutter.tsx:503).

Suggested change: correct the geometry and decide explicitly between reserving roughly 46px above the selected paragraph or keeping a slimmer drawn bar with independently tested 40px targets. Do not build the increased occlusion based only on the current wording.

**R7 — P2 — Removing the quiz step gap is unnecessary and makes adjacent actions less forgiving.**

Evidence: the row already provides an 8px gap at [quiz.css:237](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/styles/quiz.css:237), and can contain Previous, Next, Show all, and Discuss at [QuizPanel.tsx:1360](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/QuizPanel.tsx:1360). Four 40px controls plus three 8px gaps are only 184px wide.

Suggested change: retain the gap, enlarge all four possible controls, and include that four-control state in the browser check.

**R8 — P2 — Two deferred targets are cheap and local enough to include.**

Evidence: the glossary hide button is not on top of the term button; the layout deliberately places it beside the owner row because nested buttons are invalid at [glossary.css:370](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/styles/glossary.css:370). It can safely become 40px square, at the cost of 11px of title width. Footer links are ordinary wrapped links at [SiteFooter.tsx:292](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/SiteFooter.tsx:292), so a coarse `inline-flex; min-height: 40px` rule is also straightforward.

The dock’s measured 39px target at [plan:114](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/docs/plans/261021g-phone-sizes-part-two-citations-spacing-and-remaining-touch-targets.md:114) should either be raised by the missing pixel or recorded as a deliberate exception; [controls.md:188](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/docs/project/controls.md:188) currently allows only passage IDs as exceptions.

Suggested change: include glossary hide and footer links; resolve the dock’s one-pixel discrepancy. The shelf chips, at-rest gutters, inline citations, structure rows, and spine strips are reasonably deferred.

**R9 — P2 — A cascade assertion per rule is not a sufficient guard.**

Evidence: the test helper returns a matching declaration rather than computing the final cascade at [tap-target.test.tsx:81](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/tests/tap-target.test.tsx:81). It does not cover later selectors, specificity, stylesheet order, generated Tailwind utilities, attachment to the intended JSX node, or overlapping hit regions. The gutter already has a more appropriate owning test at [gutter-phone-bar.test.ts:33](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/tests/gutter-phone-bar.test.ts:33).

Suggested change:

- Test every `Button` size variant directly, including icon width.
- Test that each intended component actually carries its class.
- Put gutter geometry and maximum-control assertions in `gutter-phone-bar.test.ts`.
- Add arithmetic clearance tests for every halo.
- Use computed styles in the browser, or a helper that folds all relevant declarations in stylesheet order.
- Demonstrate the guard failing when a later conflicting rule is appended.

The documentation list should also explicitly update `touch.md`’s “rest of the band” statement at [touch.md:479](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/docs/project/touch.md:479), its gutter geometry, and the narrow-window 32px comment—not only `controls.md` and possibly `phone-and-touch.md`.

VERDICT: build with changes