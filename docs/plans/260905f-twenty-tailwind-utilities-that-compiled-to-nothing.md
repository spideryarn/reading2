# Twenty Tailwind utilities that compiled to nothing

Status: **done**, 2026-09-05. Browser pass before and after, GPT Sol at plan and code stage.

> Yes, fix the missing Tailwind CSS issues. Use Sonnet subagents for browser screenshots and
> checking. Get technical input/review from GPT. Then push.
>
> — Greg, 2026-09-05

Found while building the small-screen banner
([260905e](260905e-a-small-screen-banner-on-a-phone.md)): copying `SharedNotice`'s classes onto the
new banner would have produced a box with no background, because `SharedNotice` has none — and a
border in the wrong colour, because its border colour comes from `currentColor`.

## What is wrong

`src/web/tailwind.css` § `@theme inline` is the bridge from our CSS variables to Tailwind's colour
names. It carries four of the reading view's own semantic names — `ink-faint`, `rule-strong`,
`highlight-wash`, `highlight-ink` — and stops there. Four more that the client actually writes are
absent:

| utility | wants | defined in `styles.css`? |
| --- | --- | --- |
| `tw:text-ink` | `--color-ink` | `--ink` yes, line 38 |
| `tw:text-ink-soft` | `--color-ink-soft` | `--ink-soft` yes, line 39 |
| `tw:border-rule` | `--color-rule` | `--rule` yes, line 47 |
| `tw:bg-surface-raised` | `--color-surface-raised` | `--surface-raised` yes, line 46 |

**A Tailwind v4 utility whose theme key is missing emits nothing.** Not a fallback, not a warning —
no rule at all. The class stays on the element, the build succeeds, and the property falls back to
its own default: **text inherits, a background goes transparent, a border colour becomes
`currentColor`.** Each of those looks designed rather than broken, which is the whole difficulty.
So `SharedNotice` asks for a raised panel with a rule round it and renders flat, and a
`<p className="tw:text-ink">` inside a `tw:text-ink-faint` parent, written precisely so that one
sentence stands out, is the same grey as everything near it.

The tokens all exist. The bridge just never learned their names. This is
[silent-success](../reusable/silent-success.md) in its purest form: the failure has no observer.

(`tw:border` still draws a border. In 4.3.3 it sets the width and `border-style: var(--tw-border-style)`,
a registered property whose initial value is `solid` — so the style is there without the `@layer base`
reset, which covers only `<button>` and `[data-slot]`. What `tw:border-rule` failing costs is the
*colour* alone.)

### The numbers, and two corrections

**20 live occurrences across four files** — `AccessSharing.tsx` (10), `PublicChrome.tsx` (4),
`PublicPages.tsx` (4), `PrivacyPage.tsx` (2). Every one of them is `tw:text-ink`,
`tw:border-rule` or `tw:bg-surface-raised`.

Four further occurrences are inside **comments**, in three more files, and they are the more
interesting half: somebody hit this before and wrote it down.

- `Tooltip.tsx:343` and `Library.tsx:893` both say, in almost the same words, *"`foreground/85`
  and NOT `ink-soft`, which is what the eye wants … `--ink-soft` is declared in styles.css but is
  not one of the four reading-view names bridged into Tailwind's theme, so `tw:text-ink-soft`
  compiles to nothing at all."* They diagnosed it exactly and routed around it.
- `SmallScreenHint.tsx:68–69` says the same for the other two names, which is why that banner is
  plain CSS rather than utilities.

So `tw:text-ink-soft` has **no live use at all** — it is a name two authors reached for, found
broken, and gave up on. That changes the shape of the fix; see § `ink-soft` below.

I told Greg on 2026-09-05 that it was **139 uses across 31 files**. That was wrong, and wrong the
way a bad grep is wrong: the pattern had no right-hand boundary, so `tw:text-ink` counted every
`tw:text-ink-faint`, and the file list came from a run that swept in `docs/`. The bug is the same
size; the blast radius is a seventh of what I said.

## The fifth one, which is not a colour

Scanning every `tw:` candidate through Tailwind's own resolver (below) turned up one more:
`tw:font-inherit` at `SourceLink.tsx:150`. Tailwind v4 has no `font-inherit` utility — the theme
namespace `--font-*` holds families, and `inherit` is not one of them — so it too emits nothing.

It has been harmless since 2026-09-04, when `tailwind.css` § the bit of preflight we need started
setting `font-family: inherit` on every `<button>`; this element is a button. So the class is both
dead and redundant, and the right fix is to delete it rather than to write `tw:font-[inherit]` and
have two rules saying one thing.

`tw:group` also resolves to nothing, and correctly: it is the marker class the `group-*` variants
target, not a utility. The test below has to know that.

## What we are doing

1. **Add the four `--color-*` keys** to `@theme inline`, beside the four semantic names already
   there. Nothing else in the bridge changes.
2. **Delete `tw:font-inherit`** from `SourceLink.tsx`, and *without* a comment explaining where the
   reset lives — the `@layer base` block already owns that fact, and restating it at the call site
   is a second home for it.
3. **Add `tests/tailwind-utilities-resolve.test.ts`**, so the class cannot come back.
4. **Browser pass** before and after, on every surface reachable from the box, reading
   `getComputedStyle` rather than trusting the screenshots.
5. **Retire the three comments that document the bug** — `Tooltip.tsx`, `Library.tsx`,
   `SmallScreenHint.tsx`. A comment saying a name is unavailable, left standing after the name
   arrives, is worse than no comment: the next author believes it. `SmallScreenHint` keeps its
   bespoke CSS (it is a sibling of `.install-hint` and styled beside it, which was always the
   better reason) but the paragraph shortens to say so.
6. **Signpost the new guard** from `design-css-overview.md`, beside the CSS checks already listed
   there.
7. **Correct the `inline` explanation in `tailwind.css`.** It says that without `inline` Tailwind
   "copies the RESOLVED value at build time". It does not: it emits
   `background-color: var(--tw-color-background)`, a reference to Tailwind's own prefixed copy of
   the token. Checked by compiling the real file with the keyword removed. The conclusion — use
   `inline` — is unaffected, and the reason it gives for the four names' absence is unaffected too,
   but a load-bearing comment in the block being edited should not be wrong. Sol, 2026-09-05.

### `ink-soft`, which nothing uses yet

Adding a theme name with no caller is how a bridge fills up with entries nobody can delete because
nobody can prove they are unused — the argument against `--color-page` below. `--color-ink-soft`
would be exactly that, *except* that two files say in writing that they wanted it and could not
have it.

So it gets added and those two call sites go back to what their authors meant:
`tw:text-foreground/85` → `tw:text-ink-soft`. That is a **real visual change**, not a no-op —
`--ink-soft` is an opaque `oklch(0.78 0 0)`, while `--foreground` at 85% composites to roughly
`0.86` over the tooltip's `--surface-raised` ground. The tooltips get perceptibly dimmer.

The before/after pictures decide it. If the dimmer grey reads worse than what is there now, the two
call sites revert **and `--color-ink-soft` comes back out with them** — a name with no caller does
not stay on the strength of a comment.

### Not doing: `--color-page`, `--color-panel`

`styles.css` defines those too and nothing asks for them as utilities. Adding names on the argument
that somebody might want them is how the bridge ends up with entries no one can delete because no
one can prove they are unused.

### The cost of the fix: a theme key opens every colour utility, not the one you wanted

The sharpest thing in Sol's plan review. `--color-rule` and `--color-surface-raised` do not only
make `tw:border-rule` and `tw:bg-surface-raised` legal — they make **`tw:text-rule` and
`tw:text-surface-raised`** legal too, and those are near-invisible words on a near-black page.

`tests/css-tokens.test.ts` already guards against exactly that shape (`tw:text-muted` is the surface,
`tw:text-muted-foreground` is the text) — and it had these four names on an **exclusion list**,
because at the time they could not compile and there was nothing to catch. That exclusion is now
load-bearing in the wrong direction, and the new resolver test would positively approve
`tw:text-rule`, because it does produce a rule.

So the exclusion goes, all four names, and `--rule-strong` joins them: it is a hairline colour at
about 2.1:1 on the page, and painting words in a border colour is the same mistake as painting them
in a background. All five have a clean baseline — no call site anywhere in `src/web` does this
today, which is the only cheap moment to close it.

Checked red before it was believed: `tw:text-rule` injected into `SourceLink.tsx` fails
`css-tokens` with `src/web/SourceLink.tsx: tw:text-rule`, and **passes the new resolver test**,
which is the clearest statement of why neither check subsumes the other. One asks whether the rule
exists; the other asks whether it should.

**And the guard had a hole exactly where this fix opens the risk.** It globbed `src/web/**/*.tsx`,
on the assumption that class strings live where the JSX does. They do not: `src/web/pill.ts` is a
whole module of them. Sol put `tw:text-rule` there at code-review stage and *both* suites stayed
green — the resolver quite correctly said the rule exists, and this check never opened the file. So
the glob is `{ts,tsx}` now, which is what Tailwind's own `@source` has always covered. Re-checked
red against Sol's own repro: `src/web/pill.ts: tw:text-rule`. Clean baseline over the wider set.

## The test, and why it uses Tailwind's own machinery

The obvious test — a regex for colour-shaped class names, checked against the keys in the
`@theme inline` block — needs a hand-written model of which utilities are colours. `text-sm`,
`text-center`, `text-inherit`, `border-t`, `border-collapse`, `border-dotted`, `divide-y`,
`outline-none`, `shadow-xs` and `bg-transparent` all live in colour-shaped namespaces and are not
colours. That model would be wrong on the day it was written and wronger every Tailwind release,
and a test that has to be taught the answer is a test that can be taught the wrong one.

So the test asks Tailwind instead:

- `compile()` is handed **`src/web/tailwind.css` itself**, whole, with a `loadStylesheet` that
  resolves its relative and `node_modules` imports. Not a reconstruction of the theme block — the
  real file, so the test cannot drift from it. It returns the `@source` directories the build
  scans, and the scanner is pointed at **those**, so editing `@source` to point at nothing breaks
  the test instead of quietly narrowing it.
- `@tailwindcss/oxide`'s `Scanner` produces the candidate list — the same scanner the build uses, so
  the test sees what the bundle sees, words pulled out of comments included.
- `candidatesToCss` answers, per candidate, whether a rule is produced. `null` means dead.
- and **one assertion goes through `compiler.build()`**, because the three above would all still
  pass with the `@import "tailwindcss/utilities.css"` line deleted and the bundle shipping with no
  utilities in it at all. Sol found that hole in the first draft.

Measured 2026-09-05 in this worktree: 402 `tw:` candidates on the finished tree, whole file, under
4 s wall for the suite. No build required. (It was 404 before the fix — `tw:font-inherit` and
`tw:text-foreground/85` went, `tw:text-ink-soft` arrived.)

### The shape that does not work, so nobody re-tries it

The obvious way to avoid the private API is to ask `compiler.build([one])` per candidate and see
whether the output grows. **A `Compiler` is incremental and remembers every candidate it has been
given**, so the second call already contains the first one's rule and the comparison runs against a
moving baseline. Measured: that loop reports **zero** dead candidates on the tree that has five, and
takes 16 seconds to do it. A green run that checked nothing — the exact shape this file exists to
prevent, discovered by trying it rather than by reasoning about it.

`candidatesToCss` is stateless, which is why it does the per-candidate work.

### What it still cannot see

A class name that is **assembled rather than written**. `"tw:text-" + "nonesuch"` is not a
candidate, because Oxide is a text scanner and never sees the joined string, so the suite stays
green over a class that produces no rule. This is not a gap between the test and the build — the
*build* has the identical blind spot, so a utility spelled that way does not exist in production
either. It is an argument for never assembling a `tw:` name from pieces, and it is written into the
test's header rather than left for somebody to discover. Sol demonstrated it against `pill.ts`.

`__unstable__` is in its name and a Tailwind upgrade may take it away. That is the price of the real
resolver over a copy of it, and it is the right way round: the export vanishing throws at **import
time**, before any assertion runs, where a reimplementation would keep passing while meaning less
each release.

## Verification

The claim "these four emit nothing" is checked against the built bundle, not against reasoning:

```
$ npm run build:client                    # dist/assets/main-DYikjMPK.css, 219 kB
$ grep -cE '\.tw\\:text-ink[^a-zA-Z0-9_-]'         …/main-DYikjMPK.css   → 0
$ grep -cE '\.tw\\:text-ink-soft[^a-zA-Z0-9_-]'    …                     → 0
$ grep -cE '\.tw\\:border-rule[^a-zA-Z0-9_-]'      …                     → 0
$ grep -cE '\.tw\\:bg-surface-raised[^a-zA-Z0-9_-]' …                    → 0
$ grep -cE '\.tw\\:text-ink-faint[^a-zA-Z0-9_-]'   …                     → 1   ← calibration
$ grep -cE '\.tw\\:border-rule-strong[^a-zA-Z0-9_-]' …                   → 1   ← calibration
$ grep -cE '\.tw\\:bg-background[^a-zA-Z0-9_-]'    …                     → 1   ← calibration
```

The three calibration lines are the point. Two earlier attempts at this grep reported "all
missing": one wrote `\\:` and emitted two literal backslashes, the other matched as a fixed string
and `text-ink` found `text-ink-faint`. A check that has never been seen to say "present" is not
evidence of absence.

The right-hand character class is what stops `text-ink` matching `text-ink-faint`, and it is the
same boundary the 139-versus-22 miscount was missing.

## What the browser actually measured, before

A Sonnet subagent on the box, Playwright against system Chrome, reading `getComputedStyle` rather
than trusting the pictures. Screenshots in the session scratchpad.

`AccessSharing` is signed-in and unreachable from here — except that the codebase already built
`src/web/preview-sharing.tsx` (`/preview-sharing.html`) for this exact problem, and the agent found
it and used it. It confirmed the stylesheet had really loaded (`--rule-strong: oklch(0.36 0 0)`, 65
rules) before believing any of the numbers, which is the right instinct.

| element | before |
| --- | --- |
| `PrivacyPage:161` summary box | `background: rgba(0,0,0,0)`, `border: oklch(0.97 0 0)` |
| `PublicChrome:141` SharedNotice | `background: rgba(0,0,0,0)`, `border: oklch(0.63 0 0)` |
| `PublicChrome:176/190` visitor sentence | `oklch(0.63 0 0)` — **identical to its faint parent** |
| `PublicPages:124/132/163` headings | `oklch(0.97 0 0)` — already right by inheritance |
| `PublicPages:216` artefact list | **"✓ built" and "— not built" both `oklch(0.63 0 0)`** |
| `AccessSharing:606` confirm box | `background: rgba(0,0,0,0)`; its `border-rule-strong` worked |
| `AccessSharing:804/810` chips | `oklch(0.97 0 0)` vs `oklch(0.63 0 0)` — borders differ only because the *text* differs |
| `AccessSharing:858` copy input | `border: rgb(133,133,133)` — Chrome's UA grey, not `currentColor` |

**The artefact list is the one that matters.** `PublicPages:216` is the answer to "what does this
shared link carry", and its yes and its no are the same colour: the tick and the dash are doing all
the work, and the styling that was meant to reinforce them has been absent since it was written.
That is a stranger's first look at the product.

Two things the pass corrected in my own account:

- The `<input>` at `AccessSharing:858` was never `currentColor` — form controls do not inherit
  `border-color`, so it carries Chrome's UA grey. It has the largest jump of anything here, and it
  is the one place where "the rule now applies" could plausibly look worse.
- `tw:text-ink-soft` has zero `className` uses anywhere in the tree. Confirmed independently.

## And after

Same agent, same elements, a fresh headless Chrome per page rather than a hard reload — HMR is not
to be trusted for a `@theme` edit, and a stale stylesheet looks exactly like a fix that did nothing.

| site | before → after |
| --- | --- |
| `PrivacyPage:161` | bg transparent → `oklch(0.26 0 0)`; border `0.97` → `0.27` |
| `PublicChrome:141` | bg transparent → `oklch(0.26 0 0)`; border `0.63` → `0.27` |
| `PublicChrome:176/190` | `0.63` → `0.97` — the sentence lifts off its faint parent |
| `PublicPages:216` ✓ built | `0.63` → `0.97` |
| `PublicPages:216` — not built | `0.63` → `0.63`, **so the two are finally different** |
| `AccessSharing:606` | bg transparent → `oklch(0.26 0 0)`; its border was already right |
| `AccessSharing:804/810` | borders `0.97` / `0.63` → `0.27` / `0.27` |
| `AccessSharing:858` input | border `rgb(133,133,133)` → `oklch(0.27 0 0)` |
| `Tip` / `TipNote` | `foreground/85` (≈0.86 composited) → opaque `oklch(0.78 0 0)` |
| every `tw:text-ink` already at `0.97` | unchanged — they were inheriting the right answer |

Nothing moved that was not predicted, and nothing regressed. The three judgment calls:

- **The copy-link `<input>`** keeps reading as a field. Its border is quieter, but it is now *the
  same* border as every chip and card on the page; the UA grey it replaces was an accident rather
  than a decision.
- **The tooltips** are dimmer and still comfortable: `oklch(0.78)` on an `oklch(0.26)` panel is a
  lightness gap of about 0.52. Not reverted.
- **The two boxes that gained a fill** now read as raised panels, which is what their markup has
  been asking for since it was written.

One incidental fix worth naming: the inventory chips' borders used to track their *text* colour,
because `border-rule` fell through to `currentColor` — so "shared" and "kept back" differed in
exactly the way the comment beside them argues they should not. They now share one border and the
padlock does the distinguishing.

## Risk

Switching on 20 declarations at once changes four files' appearance in one commit, and three of them
— `PublicChrome`, `PublicPages`, `PrivacyPage` — are what a stranger following a shared link sees
first. The elements have been laid out for months against the colours they *inherited* rather than
the ones they *asked for*, so "the rule now applies" and "the page now looks right" are not the same
claim. Hence the before/after browser pass reading `getComputedStyle`, rather than a build and a
shrug.

Two changes are worth watching for specifically:

- `SharedNotice` and the privacy summary box gain a `--surface-raised` fill they have never had.
- The sharing chips at `AccessSharing.tsx:804/810` currently take their border from
  `currentColor`, so the "shared" and "kept back" columns have **different border colours by
  accident** — the two tones differ in exactly the way the comment beside them argues they should
  not. After the fix both are `var(--border)` and the padlock does the distinguishing, as written.
- `AccessSharing.tsx:858` is an `<input>`. Its text may move from the browser's own form-control
  colour to `--ink` rather than merely re-stating what it inherited. Measure that one.

**No border appears anywhere.** The first draft of this plan said `SharedNotice` had none, and that
was wrong twice over: `tw:border` sets the width *and* `border-style: var(--tw-border-style)`, whose
registered initial value is `solid`, so the border has been drawn all along in `currentColor` — and
the `@layer base` reset I credited for the style covers only `<button>` and `[data-slot]`, while
these five sites are a `<div>`, a `<p>`, two `<li>`s and an `<input>`. The five `border-rule` sites
therefore **darken**, from their own text colour to `var(--border)`. Getting this wrong before the
browser pass would have had us reading a large, correct colour change as a regression. Sol,
2026-09-05, twice — the second time to say `border-style: solid` is not literally what it emits.
