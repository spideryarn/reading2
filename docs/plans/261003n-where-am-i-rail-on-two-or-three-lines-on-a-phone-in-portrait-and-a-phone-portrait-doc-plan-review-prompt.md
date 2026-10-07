# Plan review: the where-am-I rail on two or three lines on a phone, and a phone-portrait doc

You are reviewing a **plan**, not code. Read-only: change no file.

**The candidate** is commit `a4d682ac9`, one file:
`docs/plans/261003n-where-am-i-rail-on-two-or-three-lines-on-a-phone-in-portrait-and-a-phone-portrait-doc.md`.
Nothing is built yet.

**The code it is a plan about** (read it; this list is where to start, not a limit):
`src/web/HeadingsCrumbs.tsx`, `src/web/crumbs.ts`, `src/web/styles/crumbs.css`,
`src/web/styles/shell.css` § the bar that leaves while you read (and `.controls` above it),
`src/web/styles/tokens.css` (`--bar-h`, `--bar-bottom`, `--bar-hide`),
`src/web/styles/narrow-window.css` (the `.controls` rules inside `@media (max-width: 731px)`),
`src/web/scroll.ts` (`stickyOffset`, `stickyDestination`, `watchBarVisibility`, `controlsBar`),
`src/web/reader/Reader.tsx` (`showCrumbs`, `showBar`, `layoutKey`),
`tests/spine-width.test.ts`, `tests/headings-crumbs-wiring.test.tsx`,
`docs/project/narrow-windows.md`, `docs/project/touch.md`,
and the previous plan `docs/plans/261002h-headings-breadcrumb-at-the-top-of-the-reading-view.md`.

## What to do

First, an independent pass: would this plan, built as written, give a reader on a phone in portrait
a breadcrumb they can read, without breaking anything pinned under the bar, any jump or scroll
position, or any other width? Find what the plan has wrong or has not thought of. Name the concrete
source path for each finding.

Then say whether the plan's stage 3 (a new short map doc, `phone-portrait.md`, rather than a section
in `touch.md`) is the right home under `docs/reusable/documentation-policy.md` and
`docs/reusable/signposting-and-single-source-of-truth.md`.

## Severity, and what a refusal takes

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Grade by consequence. Refuse only on an **established** P0 or P1 (an exact reachable source path
that demonstrates it); a reasoned one ranks but does not block. Give every finding an ID, `F1`,
`F2`, …, and for each say: severity, established or reasoned, the path, and the smallest change to
the plan that answers it. End with one line: `VERDICT: proceed` or `VERDICT: refuse (F…)`.

## My own suspicions — worth less than your pass; spend most of the run elsewhere

1. Raising `--bar-h` on `:root:has(:where(.reader) > .controls > .crumbs)` inside a media query:
   does that selector's specificity and source order actually win over `tokens.css`, and do
   `--bar-bottom` / `--bar-hide`, which are `calc()`s declared on `:root`, re-resolve from it? Is
   anything reading `--bar-h` that is on screen with this bar and should not grow?
2. Anything that hardcodes 44px or 2.75rem for the bar instead of the token or a measurement.
3. `layoutKey` in `Reader.tsx` carries `showBar` but not the bar's height. Crossing 731px changes
   the bar's height; `windowWidth` is in the key, so I think that is covered. Is it?
4. Whether fixing the height (rather than fitting it to the path) is right, given the bar is
   sticky and in flow and never hides while it holds the breadcrumb.
5. Press size: two stacked rows of buttons under a thumb.
