# The top bar stops being drawn when it has nothing in it

**Status: built 2026-09-08, from feedback report `SPIDERYARN-READING2-2E`.** This is
**stage 3** of
[260905g](260905g-move-the-wordmark-and-feedback-button-into-the-dock.md), which is in turn
stage 4 of [260905d](260905d-declutter-the-reading-view-top-bars.md). Both wrote it down and
neither built it; a reader has now reported it, so it gets built here rather than being
re-designed.

> There seems to be some kind of black empty horizontal bar at the top of the screen, for example
> in the structure mode. I wonder if that's a hangover from the bar at the top of the hierarchy
> mode, or if it's something else. But can we get rid of it?
>
> — Greg, via the Feedback button, 2026-09-07 17:39 UTC
> (`?mode=structure&at=spya-fvuu5k`, build `c0fb04a4`)

It is exactly what he guessed: a hangover from Hierarchy's bar.

## What is actually there

`.controls` still renders on every reading view, and its only remaining contents are Hierarchy's
granularity pills (`!inMode`), a visitor's read-only chip (`!owner`) and a comment-transport
error. In a band mode, as the owner, with no comment error, all three are absent and the element
is `<div class="controls"></div>` — 44px of `--bar-h`, empty, and the whole reading view pinned
under it by `--bar-bottom`.

Measured in this worktree on 2026-09-08, signed in as the owner, Chrome 1280 × 900,
`?mode=structure`:

```
controls  <div class="controls"></div>   children: 0   height: 44   (position: sticky)
band      .mode-band.struct              top: 44
--bar-bottom  calc(2.75rem + 0px)
```

The same in `?mode=outline`. In `?mode=plain` the element is equally empty. Only Hierarchy fills
it.

**And it cannot slide away, by design.** Since
[260907b](260907b-the-top-bar-leaves-while-you-read-at-every-width.md) the bar leaves on scroll at
every width — but `:root:has(.controls:focus-within, .mode-band)` in
[shell.css § the bar that leaves while you read](../../src/web/styles/shell.css) holds it down
whenever a band is open, because on a phone the bar used to carry the way out of a mode. So in a
band mode the empty strip is there at every scroll position, which is the state the reader was
looking at. The guard's own comment already names this as the thing stage 3 would fix:

> the bar is *empty* in a band mode (its only content is Hierarchy's pills), so dropping the guard
> would slide a band and every sticky gist to reclaim a blank strip. Reclaiming that strip properly
> means not drawing it, which is
> `docs/plans/260905g-move-the-wordmark-and-feedback-button-into-the-dock.md` stage 3.

## `-2F` is a different bug, and this does not fix it

`SPIDERYARN-READING2-2F`, filed two minutes later, says the Dock is always visible on an iPhone in
landscape when it used to auto-hide. **Reproduced here**, at 844 × 390 with real wheel events,
scrolled forwards until `data-bars="hidden"`:

| mode | `data-bars` | `.controls` top | `.dock` top | `--dock-bottom` |
|---|---|---|---|---|
| plain | `hidden` | −44 (gone) | 390 (gone) | `0px` |
| structure | `hidden` | 0 (**held**) | 350 (**held**) | `calc(2.5rem + 0px)` |
| outline | `hidden` | 0 (**held**) | 350 (**held**) | `calc(2.5rem + 0px)` |

So both reports are about chrome that a `.mode-band` pins in place — but they are **two rules, in
two files, about two bars, with two different justifications**, and they are not one cause:

- `-2E` is `:root:has(.controls:focus-within, .mode-band)` in `shell.css` holding down a bar with
  **nothing in it**. Nobody wants an empty strip; the fix is not to draw it.
- `-2F` is `:root:has(…, .mode-band) { --dock-bottom: var(--dock-space) }` in
  `narrow-window.css` holding down a bar that is **full**, and is the mode switcher and the only
  way out of the mode. Greg asked for that guard himself on 2026-08-31 —
  *"on mobile I did find that I sometimes struggled to get back to the main text (e.g. within the
  Search mode when the keyboard was open)"* — so undoing it is a product decision that reverses an
  earlier one, not a bug fix.

Nothing in this plan touches `--dock-bottom`. `-2F` keeps its own session, and this table is the
evidence it should start from.

## The shape of the fix

Two stages, both already specified in 260905g stage 3 and both already reviewed there by GPT Sol
(finding G3 is why stage 2 exists in this shape rather than as a deletion).

**Stage 1 — the element is not rendered when it would be empty.**

A predicate in [`layout.ts`](../../src/web/layout.ts), beside `proseVisible` and
`offerableGists`, because that file is where the reading view's layout questions are answered as
pure functions and this is one of them. `Reader` renders `.controls` only when it says yes.

Then the CSS has to agree, and this is the part with a trap in it. Four states, and the ladder has
to resolve in this order:

| state | `--bar-bottom` | selector | specificity |
|---|---|---|---|
| no bar at all | `--safe-top` | `:root:not(:has(BAR))` | (0,2,0) |
| bar, and a guard holds it | resting | `:root:has(BAR):has(BAR:focus-within, .mode-band)` | (0,4,0) |
| bar, hidden by scroll | `--safe-top` | `:root[data-bars="hidden"]` | (0,2,0) |
| bar, at rest | resting | `:root` (tokens.css) | (0,1,0) |

`BAR` is `:where(.reader) > .controls` — see § What the review changed, finding 1, for why it is
scoped and why `:where()` is what keeps the numbers in that column true.

The existing guard is (0,3,0), which beats a (0,2,0) "there is no bar" rule — so it gains a
`:has(.controls)` of its own. That is not padding for the specificity: the guard exists to stop
*the bar* sliding out from under a reader, and a guard about the bar should not fire when there is
no bar. Written as one selector rather than two, because `:has()` takes the specificity of its most
specific argument and a second selector would be a tie decided by source order — the fragility Sol
caught in this same file on 2026-08-28.

The first and third rows both compute `var(--safe-top)`, so their (0,2,0) tie is harmless; they
agree.

`--bar-hide` needs nothing. It is the bar's own `transform`, and there is no bar to transform.

The JS is already ready for this and needs no change: `stickyOffset()` and `stickyDestination()`
in [`scroll.ts`](../../src/web/scroll.ts) both return `safeTop` for an absent `.controls` — added
by Sol's review of 260905d on 2026-09-05, against exactly this stage — and `startMoving()` and
`onFocusShift()` are null-safe.

**Stage 2 — the comment-transport error leaves the bar.**

If it stays, a refused comment write re-draws a 44px bar mid-read and pushes the article down. That
was named in 260905g as the last argument against doing this at all.

It is **not deleted** — Sol refused that (G3), and rightly: `comments.error` is not the drawer's
`loadFailed`. `loadFailed` is about the one fetch that fills the list and is only drawn when the
list is empty; `error` carries every refused write, retry and delete, including ones whose row has
already scrolled off. So it moves onto the control the failure is about: the Dock's **Comments**
button, where the count sits, as a mark rather than a number. `error` joins the owner's arm of
`Dock`'s `drawer` prop, next to `loaded` and `loadFailed`, and `commentError` leaves `BarContents`
in the same change — a term left there would put the empty bar straight back on the error path,
which is the whole thing this stage exists to prevent.

It gets **three carriers**, and the number is not belt-and-braces: 260905g's spec said the sentence
would be the button's `title`, and that is wrong in this file. `DockTab` deliberately has no
`title` — five test files assert its absence, because an OS box beside a hover card is a race
rather than a fallback and does not exist on a touch device at all
([tooltips.md](../project/tooltips.md)). So: a red mark in the count's slot for a sighted reader,
an `sr-only` node the button points `aria-describedby` at for a screen reader, and the sentence at
the top of the drawer the button opens — which is the only one a finger can reach. The accessible
**name** stays "Comments", per the rule Dock.tsx § the switch itself already states and which Sol
had caught a breach of there.

`fitSignature` has to see it, or the row keeps the rung it was measured for while a digit's worth
of width appears — Dock.tsx § the bar's fit ladder.

## What the review changed

GPT Sol reviewed this plan before it was built and returned "do not build as written" with three
P1s ([the review](260908a-empty-top-bar-plan-review-sol.md)). All five findings are acted on; the
specificity table above it confirmed outright.

**1 (P1) — an article can forge a `.controls`, and this change is what makes that matter.**
`src/sanitize-policy.ts` reserves six class names (`cmt`, `chat`, `term`, `hit`, `zoomable`,
`zoom-btn`) and `controls` is not one of them. Verified here rather than read off the list: running
the sanitiser over

```
<div id="root"><div class="reader"><p class="controls">a decoy</p><aside class="mode-band">band</aside></div></div>
```

returns it **byte-for-byte**, `id` and all. That was latent while the bar was always drawn, because
ours is earlier in document order and a bare `querySelector` therefore always found it. A
*conditional* bar removes that accident: with ours absent, `stickyOffset` measures the publisher's
paragraph as the chrome every deep link, `?at=` reading and arrow-key step has to clear — a
plausible number, no error, [silent-success](../reusable/silent-success.md) exactly.

So the queries are scoped, in two different ways, because the two halves can afford different
things:

- **JS** — `controlsBar()` in `scroll.ts`, used by `stickyOffset`, `stickyDestination`,
  `watchBarVisibility`'s two sites and `ViewportProbe`. It takes the *first* `.reader` in document
  order — necessarily ours, since ours is the outermost element and any forgery is inside it — and
  then only its direct children. Not `document.querySelector(".reader > .controls")`, which matches
  a forged `<div class="reader"><p class="controls">` just as readily.
- **CSS** — `:where(.reader) > .controls`, which cannot express "the first one" and so closes the
  ordinary decoy but not a forged `.reader` wrapper. That is deliberate and the cost is bounded:
  the failure is 44px of empty strip on the publisher's own article and nothing else. Measured, and
  the number is in the table below.

`.mode-band` in the guard is left unscoped on purpose. A forgery there can only hold the bar
*down*, which is what happened before this change anyway; scoping it wrongly would silently stop
the guard firing, which is the failure Sol has caught twice in this file.

**2 (P1) — stage 2 has to remove `commentError` from the predicate.** Correct, and it now says so
above; `BarContents` has no such field and `tests/layout.test.ts` states the absence.

**3 (P1) — `title` is the wrong carrier and the accessible name is the wrong place.** Correct on
both counts; § Stage 2 above is rewritten to the three carriers Sol asked for.

**4 (P2) — the verification never exercised the guard.** Fixed; § How we knew.

**5 (P2) — the `display: none` alternative was dismissed on a false premise.** It was: a
`display: none` element generates no flow box, and its zero rect makes both sticky functions return
`safeTop` anyway. The bullet below is rewritten with the reasons that actually hold.

## And what the review of the built code changed

The second review is the one that counts, and it earned it: two P1s that no plan-stage read could
have found ([the review](260908a-empty-top-bar-code-review-sol.md)). Both confirmed at the source
before acting on them.

**1 (P1) — a failed *load* was being announced as a failed *write*.** `useComments`'s load path
sets `error` **and** `loadFailed` together (`useComments.ts`, both the `body.error` branch and the
`catch`), so a comments fetch that never landed reached the Dock carrying a perfectly good `error`
string — and the button said *"a change to your comments didn't save"* to a reader who had changed
nothing, with the drawer then saying it twice in two voices. `commentError` is now
`own && !own.loadFailed ? own.error : null`, which is what its own doc-comment always claimed it
was. A load failure keeps the answer it already had, in `Questions`.

That also caught a fixture stating something the app cannot produce:
`tests/dock-questions-loading.test.tsx` posed `loadFailed: true, error: null`. It carries an error
string with the flag now, so the reachable state is the one under test.

**2 (P1) — the `note` prop was silently destroying the Comments hover card's description, in every
state.** My comment said floating-ui would take `aria-describedby` while the card was open. It is
the other way round: `mergeProps` in `@floating-ui/react` does `.concat(userProps)` into its reduce,
so for every key that is not an `on…` handler the **child's** prop is applied last and wins. And
React puts the key in `props` even when the JSX wrote `undefined` — so `aria-describedby={note ?
noteId : undefined}` suppressed the card's id whether or not there was a note.

Fixed in `Tooltip` rather than worked around in `DockTab`, because it is `Tooltip`'s merge that is
wrong: the child's own value is taken out before the merge and joined back on after, so both ids
survive. **That repairs an existing bug as well** — the experimental switch has set its own
`aria-describedby` beside a card since the cards landed, and has been losing the card's description
ever since. Its own test found the change immediately, by asking `getElementById` for what is now a
two-id list.

**3 (P2) — the tests left both seams open.** The Dock suite always rendered with the drawer open, so
it would have passed against a mark that only appeared there; `panel` is a parameter now and
defaults to shut. The tooltip case is new and is what pins finding 2 — mutated back to the old
`cloneElement(children, getReferenceProps({ ...children.props, ref }))` it reports **0** described
ids where it expects more than 0.

**What I did not do**, and Sol asked for: a jsdom mount of `Reader` asserting `.reader > .controls`
per branch. There is no such test in this repo and building the first one is not a bug fix — the
reading view has no DOM tests at all, deliberately, and the browser *is* its harness
([browser-testing.md](../project/browser-testing.md)). The integration seam is covered by the
measurement in § How we knew row 3, which is a real page against a real server and strictly stronger
than a mount with the hooks stubbed. Naming it so it is a decision rather than an omission.

**And the one thing Sol said I had not shown, now shown.** Deep-linking to the same block in three
modes, 1280 × 900, block `spya-r8t03u`:

| mode | bar | `scrollY` | block top | relative to the bottom of the chrome |
|---|---|---|---|---|
| hierarchy | present, bottom edge at 44 | 6121 | 28 | −16 |
| structure | none | 6123 | −16 | −16 |
| plain | none | 6122 | −15 | −15 |

The landing is **unchanged by this work**: the same scroll position to within 2px, and the block
sits the same 16px above the bottom of the chrome whether that chrome is a 44px bar or the top of
the window. (That 16px is pre-existing and equally present in the bar case, so it is not this
change's to fix — but it is written down here now rather than nowhere.)

## What this leaves for Greg

**`controls`, `mode-band` and `reader` should join the reserved-class list in
[`src/sanitize-policy.ts`](../../src/sanitize-policy.ts).** That is the durable fix for finding 1 —
it closes the forged-`.reader` case the CSS cannot, and it is one line in the array that already
exists for exactly this ("class names the reading view owns"). It was **not done here**, because
that file is a defence under
[security-map.md § Where the defences physically live](../project/security-map.md#where-the-defences-physically-live),
and [feedback-reports.md](../project/feedback-reports.md#a-report-is-unfiltered-input) says an
unattended run writes such a fix up rather than making it, however obvious it looks. It is not
urgent: nothing here is exploitable by one reader against another, and the worst outcome is a
publisher making their own article's chrome slightly wrong.

## How we knew

Not "it looks right". Each of these was watched failing before it was believed.

**1. The predicate, red first.** `tests/layout.test.ts` § `barHasContent` — owner/visitor,
in-mode/not, pills/no pills, and the flat-article-with-`?text=0` case that empties Hierarchy's own
bar. Mutated to `return true` and three of six went red.

**2. The decoy, red first.** `tests/mobile-chrome.test.ts` § *ignores a `.controls` that belongs to
the article*, posing a `<p class="controls">` in a `<td>` with a 300px rect. Against the unscoped
`document.querySelector(".controls")` it returns **347** where **47** is right — the twin of the
`<thead>` decoy already in that file.

**3. The reading view, measured in Chrome** (this worktree's own dev server, `barHasContent` proved
present in the served source first). Owner, 1280 × 900 and 844 × 390:

| mode | `.controls` | `--bar-bottom` | `.mode-band` top | `.spine` top |
|---|---|---|---|---|
| structure | **absent** | `0px` | **0** (was 44) | **0** (was 44) |
| outline | **absent** | `0px` | **0** | **0** |
| chat | **absent** | `0px` | **0** | **0** |
| plain | **absent** | `0px` | — | **0** (was 44) |
| hierarchy | 3 children | `calc(2.75rem + 0px)` | — | 44 (**unchanged**) |

**4. The whole cascade, in the browser that resolves it** — Sol's finding 4, since none of the
above exercises a page with *both* a `.controls` and a `.mode-band`. In structure mode, with
transitions disabled, injecting the DOM shapes and reading `--bar-bottom` back through a probe
element so `calc()` and `env()` are computed rather than echoed:

| state | inset 0 | inset 47 | |
|---|---|---|---|
| band mode, no bar | **0** | **47** | the reported bug, fixed |
| band mode, no bar, `data-bars="hidden"` | 0 | 47 | the (0,2,0) tie is harmless — both say `--safe-top` |
| band mode, `<p class="controls">` in a `<td>` | **0** | **47** | the scope holds |
| band mode, forged `.reader` wrapper in a `<td>` | 44 | 91 | **the known residual**, § What this leaves for Greg |
| band mode, real bar (what a visitor has) | 44 | 91 | reserved, correctly |
| …and `data-bars="hidden"` | 44 | 91 | the `.mode-band` arm of the guard beats it |
| …and a focused control in the bar | 44 | 91 | the `:focus-within` arm |

**5. The Dock's mark**, `tests/a-failed-comment-write-is-said-on-the-dock.test.tsx` — the three
carriers, the count it replaces, the fit signature, the drawer shut as well as open, and the load
failure that must **not** be announced as a failed write. Two of its cases go red against a
`CommentsChip` that never marks; the tooltip case goes red against the old `Tooltip` merge.

**6. The suites that pose a bar.** `tests/bar-motion.test.tsx` and `tests/mobile-chrome.test.ts`
both appended their `.controls` to `<body>`, which `controlsBar()` cannot see — so two cases in
`bar-motion` went red and were fixed by putting the fixture where the real bar lives. That is the
scoping proving itself on the way past: a fixture the code under test cannot find is a test
asserting about nothing.

Done: in a band mode as the owner there is no `.controls` element and the band's top edge is
`--safe-top`; Hierarchy is unchanged; and a comment transport failure moves nothing.

## The simpler options passed over

- **Keep `commentError` in the bar and accept a 44px jump on that path** (stage 1 alone). Cheaper
  by about forty lines, and it would ship the strip fix today. Rejected because the jump is a
  regression this change would introduce knowingly, on a path that is already a bad moment for the
  reader, and because stage 2 is small enough that deferring it is not buying much. Named here so
  it is a choice rather than an oversight: if stage 2 turns out to be bigger than it looks, stage 1
  alone is still worth landing.
- **`display: none` on an empty bar, or `.controls:empty { display: none }`, instead of not
  rendering it.** Sol's finding 5, and the first draft of this bullet was wrong about it: a
  `display: none` element generates **no flow box**, and its zero rect makes both
  `stickyOffset` and `stickyDestination` return `safeTop` of their own accord. The `:empty` version
  is genuinely tempting — no predicate at all, and so no second contract to keep in step with the
  JSX, which is a real cost this design pays.

  Rejected on two grounds that do hold. **`scroll.ts` asks the DOM four times whether there is a
  bar**, and a present-but-unpainted element answers yes to every one of them; the repo's own
  `<thead>` note says what it thinks of an element that is "the right one by luck", and here it
  would be the wrong one on purpose. And **`:empty` is a whitespace bug waiting to happen**: one
  `{" "}` or a conditional that renders `""` and the bar is silently back, in a place no test looks.
  The predicate can also say *why* the bar is empty, which `:empty` cannot, and it is what 260905g
  stage 3 specified and Sol accepted at the time.
- **Scope the selectors to `body > #root > .reader > .controls`**, which a forged chain inside the
  prose genuinely cannot match, since article markup is never a child of `<body>`. Correct, and
  rejected as over-fitting the shell: it silently stops matching the day the app is mounted
  anywhere else, and it fails toward "there is no bar", which is invisible in the mode where that
  is also the right answer. The narrower `:where(.reader) >` leaves one contrived case open and
  fails toward a cosmetic bug; the durable answer is the sanitiser, above.
- **A `data-bar="none"` attribute on the root instead of `:has()`.** Would need an effect in
  `Reader` writing to `<html>`, which is a second mechanism for a question `:has()` already answers
  — and this file is written in `:has()` throughout, with the reasoning for it recorded twice.
- **Drop the `.mode-band` arm of the guard and let the empty bar slide away.** Reclaims the strip
  while scrolling forwards and leaves it at rest, at the top of the article, which is where a
  reader starts. The guard's own comment rejects this in as many words.
- **Do nothing.** Fable's recommendation when 260905g was written, and defensible then: the strip
  reads as a seam rather than as a control. A reader has now filed it as a bug, which settles it.

## See also

- [260905g](260905g-move-the-wordmark-and-feedback-button-into-the-dock.md) — stages 1 and 2, and
  the stage-3 spec this builds
- [260905d](260905d-declutter-the-reading-view-top-bars.md) — what emptied the bar in the first
  place
- [260907b](260907b-the-top-bar-leaves-while-you-read-at-every-width.md) — why the bar hides at
  every width now, and the `stickyOffset`/`stickyDestination` split this depends on
- [the postmortem](../postmortems/260905g-the-top-of-the-spine-is-under-the-wordmark-on-a-phone.md)
- [reading-view-overview.md](../project/reading-view-overview.md) ·
  [design-css-overview.md](../project/design-css-overview.md) ·
  [narrow-windows.md](../project/narrow-windows.md)
