# Native `title` tooltips become rich cards everywhere, and a test keeps it that way

Report: spya-q04h98 (#589, SENTRY SPIDERYARN-READING2-JA), queue item `qi-8m3326rg`.

> Look for anywhere we're using regular tooltips (e.g. when hovering over the search name), and
> replace with rich tooltips / see tooltips.md / And how can we ensure this going forwards?
>
> — Greg, 2026-10-17

The rule is already written: [tooltips.md § Prefer the rich card to a native `title`](../project/tooltips.md#prefer-the-rich-card-to-a-native-title)
(Greg, 2026-10-01). Nothing enforced it, so it went on being broken: on 2026-10-17 there are **170
native `title` attributes on host elements in `src/web`**, two SVG `<title>` elements
(`cost-charts.tsx`), about 20 more on components that forward `title` to the DOM (`Button`, `Link`,
`SourceLink`, …), and `IconButton` sets one by default on every icon button in the app. The example
Greg names is Search's run chip (`SearchPanel.tsx`, `title={`${run.criterion}\n\nMark only this search`}`).

## What done looks like

1. Every one of those reaches the reader as our card — same look, same delays, keyboard focus opens
   it — and none as the OS's grey box.
2. **A test fails** on a new native tooltip in `src/web`: a `title` attribute on a host element, an
   SVG `<title>`, or a `title` handed to a component that puts it on the DOM. A short, reasoned
   allowlist (an `<iframe title>` is its accessible name, not a tooltip).
3. The types refuse `title` on our own DOM-forwarding components (`Button`, `Link`, `IconButton`
   already does), so the compiler catches the case the AST test cannot see.

## The design: one page-wide card for `data-tip`

```
 any element, any page                   main.tsx, once, beside <OfflineStrip/>
 <button data-tip="Delete this search">  ──pointerover / focusin──▶  <TipCard/>
                                                                      one Floating UI panel,
                                                                      Tooltip's classes and DELAY
```

**`title="…"` becomes `data-tip="…"`** at every site, and one delegated card, mounted once outside
`App` so every page has it (landing, admin, profile, the reading view), draws any `[data-tip]` the
pointer rests on or the keyboard focuses. Text split on blank lines becomes paragraphs, so the
search chip's `criterion\n\nMark only this search` reads as two (tooltips.md § Short paragraphs).

This is not a new mechanism. The reading view's gutter has done exactly this since 2026-10-02
(`BlockLinkCard.tsx` § `GUTTER_CONTROL`: *"Each had a native `title`, which reads as no tooltip at
all"*). What changes is that `data-tip` stops being the gutter's and becomes the app's:

- **The delegated machinery moves out of `BlockLinkCard.tsx` into a hook**, `useDelegatedCard`
  (hover intent with the 240/90ms delays and the warm swap, focus-visible open, Escape, touch
  ignored, detach-on-unmount, re-read on attribute change, `aria-describedby` while open, the
  `dialog[open]` portal root). `BlockLinkCard` keeps its own selectors and content (block links,
  cross-references, the reading-time line and its press/scroll behaviour, Marginalia's notes) and
  calls the hook; `TipCard` is the hook plus `data-tip` → `TipNote`. **The gutter's controls move
  to `TipCard`**, so `data-tip` has one owner and one card, and BlockLinkCard's selector loses
  `GUTTER_CONTROL`. The gutter's no-`aria-describedby` exception goes with it, as a per-element
  opt-out (`data-tip-describes="off"`) rather than a selector, since elsewhere the sentence is a
  real description.
- **`IconButton`'s `titled`** keeps its meaning — "say my label on hover" — and now writes
  `data-tip={label}` rather than `title`.
- **Accessible names.** A `title` was also the accessible name of an element with no other (an
  icon-only `<button>` with no `aria-label`). `data-tip` is not, so at each such site the migration
  adds `aria-label` with the same words. Where the element already has text or an `aria-label`,
  `aria-describedby` set while the card is open is what a screen reader hears, as for every
  `Tooltip` today (Floating UI's `useRole` does the same).
- **Article markup cannot forge one.** `ALLOW_DATA_ATTR: false` in `src/sanitize-policy.ts` drops
  every `data-*` an article carries except the named ones, and `data-tip` is not named; a chat
  answer is drawn as text, never as HTML (ChatPanel.tsx), and the other `dangerouslySetInnerHTML`
  HTML sinks that take untrusted markup are sanitised (the Design page's specimens are our own). So `[data-tip]` is only ever ours. No change to the
  sanitiser — it is a listed defence.

### The simpler option passed over

**Wrap each site in `<Tooltip content={<TipNote>…</TipNote>}>`.** It needs nothing new, but it is
about 200 JSX restructures instead of 200 attribute renames, each one a chance to break a ref or a
key handler (`Tooltip` clones its child — IconButton.tsx § `PassThrough` is the trap), and it is a
Floating UI instance per trigger on rows that repeat (admin tables, search runs, every cell of the
cost table). The delegated card costs nothing per trigger, which is tooltips.md's own argument for
it. Sites that already want a *rich* card (`ControlTip`, a head and paragraphs) are out of scope:
this job is the like-for-like move off the OS box; better words for any one card are a later,
per-card change.

**A second, separate delegated card that leaves the gutter where it is** was also passed over: two
owners of one attribute, and a second copy of the hover-intent code BlockLinkCard's own header
argues against.

### What the guard checks

`tests/no-native-title-tooltips.test.ts`, parsing every `src/web/**/*.tsx` with `@babel/parser`
(the AST route `tests/fleet-imports.test.ts` already takes; TypeScript 7 exposes no AST at its
root):

- a JSX `title` attribute on any lowercase (host) element — fails, with file:line and the fix;
- a JSX `<title>` element — fails;
- a `title` attribute on a component in a short named list that forwards it to the DOM — the
  types should make this impossible, and the test pins that they still do;
- allowlist: `iframe` (accessible name). Each entry carries its reason in the test.
- it is checked against itself: a fixture string with a native `title` must be found, so the test
  is seen to fail (silent-success.md).

Out of the guard's reach, and said so in the test's header: a `title` put on with `setAttribute` or
by spreading an object of props built elsewhere. The repo has neither today (grepped).

## Out of scope, written up for Greg

- **An article's own `title` attributes** (an author's `<a title>`, `<abbr title>`) survive the
  sanitiser and show the OS box in the prose, on top of our link card for a link. Stripping them is
  a change to `src/sanitize-policy.ts`, a listed defence, so it is a question, not a build. `<abbr
  title>` carries meaning (the expansion), which is the trade-off.
- **`tools/fleet/`'s dashboard** — an internal tool, not the reader's app; not in `src/web`.

## Stages

1. **The card.** `useDelegatedCard` lifted from BlockLinkCard; `TipCard` mounted in `main.tsx`;
   the gutter's controls moved to it; `IconButton` writes `data-tip`. Existing
   `block-link-card`, `gutter-control-card`, `block-gutter` tests green; a new `tip-card` test
   (hover opens after the delay, focus opens, Escape shuts, paragraphs split, text change re-read,
   `aria-describedby` while open, inside an open `<dialog>`).
2. **The sweep.** Every native `title` in `src/web` to `data-tip`, `aria-label` added where the
   title was the name; `title` removed from `Button`'s and `Link`'s prop types and the forwarding
   sites moved; the two SVG `<title>`s to `data-tip` on the bar. Delegated by file group to
   subagents; the inventory script's output is the checklist.
3. **The guard and the docs.** The test above; tooltips.md's rule gains its check and the `TipCard`
   row; this plan updated; browser check on the box (Search's run chip, an admin page, a disabled
   button, the gutter still right).

## Open technical questions (for the plan review)

- **Disabled buttons.** A native `title` shows on a `disabled` `<button>`; whether `pointerover`
  reaches a disabled form control differs by engine (IconButton.tsx § `disabled`). Chromium
  dispatches pointer events to disabled controls since ~116; Firefox and Safari? The sites with
  `disabled` and an explanatory title (`SearchPanel` *Waiting for your saved searches to load*, the
  retry buttons) would lose their explanation there. Options: leave it, move those few to
  `aria-disabled` (IconButton's pattern), or listen on the nearest non-disabled ancestor.
- Is lifting the hook out of BlockLinkCard worth its risk against a smaller `TipCard` that copies
  the ~80 lines of hover intent?

## After GPT Sol's plan review

[261017g-native-title-tooltips-plan-review-sol.md](261017g-native-title-tooltips-plan-review-sol.md):
*go with changes*. Each finding was checked against the code; all stand, and the plan changes so:

1. **The hook takes callbacks and nothing of BlockLinkCard's policy**: `contentFor`, `referenceFor`,
   `describes`, `observeAttributes`, `cardClass`. The reading line's virtual reference, its press,
   its close-on-scroll and the index refresh stay in BlockLinkCard. Triggers are `Element`, not
   `HTMLElement`, so an SVG shape can anchor one.
2. **Keyboard focus opens the card only where the element is focusable** — a button, a link, an
   input. A `title` on a `<span>`, `<td>` or `<th>` was pointer-only to a sighted reader already and
   read as a description by some screen readers; `data-tip` keeps the pointer half. Where the words
   are information found nowhere else on screen (an error's text, an exact time), the sweep adds
   them as `sr-only` text beside the element; elsewhere they are classed as supplementary.
3. **`cost-charts.tsx` keeps its SVG `<title>` for the static report** (`scripts/cost-analysis-chart.ts`
   renders it to markup with no React root and no card). The chart gets a `tips` prop: `"card"` in the
   app (`data-tip` on the shape), `"native"` for the standalone file. The guard excepts that one file.
4. **Disabled controls.** Hover events do reach a natively disabled `<button>` in current Chrome,
   Firefox (124+) and Safari, but the house `Button` sets `disabled:pointer-events-none`, and a
   disabled button takes no focus. So a disabled control whose `title` *explains why* moves to
   `aria-disabled` with a guarded click (IconButton's pattern) where that is safe, or gets a wrapper
   that carries the tip. A tip on a control that is merely sometimes disabled, saying what it does,
   may go unseen while disabled, as before for the keyboard.
5. **One owner, one Escape.** `TipCard` ignores a `[data-tip]` that is also a `Tooltip` trigger (the
   trigger is marked) or sits in a block link or cross-reference, and the guard's runtime test pins
   it. Escape is taken in the capture phase, only when a tip is open or pending, with propagation
   stopped then — so a tip inside an interactive card closes alone (one Escape, one surface,
   261010s) — and never during IME composition.
6. **The guard reads spreads**: a statically visible `title` in an object spread onto a host element
   (`{...(x ? { title } : {})}`) fails; six of those exist today (Bibliography, Glossary, FAQ, Quotes,
   Dictation ×2). `SourceLink` joins the forwarders, in its type and in the guard. The `<title>`
   check is limited to SVG. Exceptions are by file, not by tag, bar `iframe`.
7. Paragraphs from blank lines render as block spans inside `TipNote`, which is a `<span>`.
8. Corrected counts: 168 host-element `title`s plus two SVG `<title>`s, plus the spreads.

## Results

**Stage 1** (34c48075b): `useDelegatedCard.tsx` lifted out of BlockLinkCard; `TipCard.tsx` in
`main.tsx`; the gutter's six controls moved to it with `data-tip-describes="off"`; `IconButton`
writes `data-tip`. GPT Sol's code review of it
([261017g-native-title-tooltips-code-review-1-sol.md](261017g-native-title-tooltips-code-review-1-sol.md))
found five things, all checked and all fixed in stage 2's commit:

1. Escape closed the tip *and* the surface behind it. Now a showing tip takes the press for itself
   (window capture, `stopImmediatePropagation`); one still waiting out its delay is cancelled and
   the press goes on; an open native `<dialog>` keeps it.
2. A disabled `Tooltip` still blocked a `data-tip` fallback, and a `data-tip` *inside* a trigger
   could open a second card. Tooltip triggers are now a `WeakSet` (`TOOLTIP_TRIGGERS`), only while
   enabled, checked up the target's ancestors. A set, not the `data-tooltip-trigger` attribute
   first tried, because that changed every trigger's markup and
   `tests/mode-surface-changes-no-markup.test.tsx` rightly caught it.
3. A second tap on an open reading-time line re-opened it instead of closing it: the press handler
   now leaves an open line alone, as before the refactor. `tests/reading-time-card.test.tsx` has the
   case, seen red against the stage-1 handler.
4. The guard missed `{...{...{title}}}` and `{...{["title"]: x}}`: both now caught, both in the
   self-test.
5. The cost-chart exception covered the whole file; it now covers only a `<title>` under
   `tips === "native" &&`.

**Stage 2** (the sweep): every native `title` in `src/web` became `data-tip`, by five subagents
over disjoint files — about 190 sites, the seven spreads among them. Prop renames where a
component's `title` existed only to become a tooltip: `ThresholdSlider`, `ArmedDelete`, `StopBar`
and `SourceLink` (`tip`). `aria-label` added where the `title` had been an icon button's only
name; `data-tip-describes="off"` where the label and the tip are the same words; `sr-only` copies
where a span's tip was the only place a fact lived (an exact timestamp in admin, a failed
search's error, a tweet's over-limit count). `Button`'s and `Link`'s types refuse `title`.
Chat's thread-row card joins its lines with blank lines, so they are paragraphs; a single newline
inside a paragraph is a line break (`pre-line`), as it was in a `title`.

**Disabled controls.** Search's *find* moved from `disabled` to `aria-disabled` (its `ask` already
refused when not ready), because its card is the only place that says *why* it will not run. Every
other disabled control with a tip is either a raw `<button>`, which current browsers still send
hover events to, or a shadcn `Button` whose tip only says what it does — and a native `title` never
showed on one of those while disabled either, because of its `pointer-events: none`.

**Out of scope, asked:** an article's own `title`s —
[q-z2c269](../user-feedback/questions/q-z2c269.md).

**After a full-suite run.** Seventeen tests mock `Tooltip.js` wholesale, and `useDelegatedCard`
read `DELAY` from it, so hovering a card in those tests threw. `DELAY` now lives in
`src/web/tooltip-delay.ts`, and Tooltip.tsx re-exports it for the tests that time a Tooltip.

**Code review 2** ([prompt](261017g-native-title-tooltips-code-review-2-prompt.md),
[answer](261017g-native-title-tooltips-code-review-2-sol.md)): approve, with five fixes Sol made
and I checked. (1) The tip card's Escape could win over the Dock drawer's, which registers its
listener only when it opens, so the card now yields while `.dock-scrim` exists; there is a test with
the two together. (2) Below 731px the home wordmark's letters are hidden, so the link had no name;
it has an `aria-label` now. (3, 4) Some admin facts and the shelf's question count lived only in a
tip on something that cannot take focus; they now have `sr-only` copies. (5) Two tests that had
become vacuous (shelf-table-row-card, quiz-in-prose) now check for `data-tip` as well, and Sol showed
each one failing under a deliberate break.
