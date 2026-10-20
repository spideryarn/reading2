# Code review: 261020g, Marginalia's tooltips

## Findings

### F1 — Medium: the trigger lost the dialog's ARIA state

**Evidence:** `src/web/Tooltip.tsx:342`, `src/web/Tooltip.tsx:401-476`; regression at
`tests/marginalia-cite-card.test.tsx:157-190`.

The *Cites* button already owns the shut line's disclosure through `aria-expanded` and
`aria-controls`. `getReferenceProps` gave the interactive Tooltip its dialog state, but the child's
attributes won the merge, so an open dialog could coexist with `aria-expanded="false"` and no
reference to the dialog id. I changed `Tooltip` to preserve both controlled ids, report expanded
while either surface is open, and disable `useRole` with the rest of the Tooltip while the line is
open. The regression also proves that Enter and Space leave only the disclosure relationship while
the dialog is disabled. Escape is covered separately and closes the card without opening the line.

### F2 — Medium: a focus-only touch could disable a later mouse hover

**Evidence:** `src/web/marginalia/MarginaliaColumn.tsx:418-530`; regression at
`tests/marginalia-cite-card.test.tsx:223-263`.

The local touch flag was cleared on click and pointer cancel, but not when a touch focused the line
without producing either event. On a hybrid device, a later real mouse hover was then refused. I
forwarded pointer enter/leave and keydown through `ShutNote` and clear the refusal on a real mouse or
keyboard interaction. The test first leaves the touch focus without a click, then proves mouse hover
opens the card.

### F3 — Low: cut words went stale when layout, rather than the window, changed width

**Evidence:** `src/web/BlockLinkCard.tsx:220-237`, `src/web/BlockLinkCard.tsx:433-449`; regression at
`tests/marginalia-cite-card.test.tsx:323-339`.

The implementation re-read on card open and `data-open`, but not when the shut label changed width.
A window-only resize listener would still miss a band or column resizing the label. I now observe the
actual `.marg-shut-label` while its delegated card is open, with `window.resize` only as the fallback
where `ResizeObserver` is absent. `cutWords` itself remains null-safe, reads text only when clipped,
accepts only a known voice, and falls back to `ui`.

### F4 — Low: the memo contract was narrower than its dependency and its test had no consumer

**Evidence:** `src/web/reader/Reader.tsx:2875-2888`; strengthened fixture and assertion at
`tests/quiz-in-prose.test.tsx:258-281` and `tests/quiz-in-prose.test.tsx:596-644`.

`marginCiteActions` used only the owner/visitor distinction but depended on the whole `owner` value.
I narrowed it to the already-computed stable `isOwner` boolean. The four senders are stable callbacks
or stable callback-derived values: `askWork`, `checkCitedWorkInChat`, `openCitedWorkFromCard`, and
`jumpTo`. The existing `memo(TableView)` test could pass without mounting any citation context
consumer, so I added a ready cited work and assert that the Marginalia citation line really exists
before the `?at=`-only render-count assertion.

### F5 — Low: comments and project docs still described every line as delegated

**Evidence:** `src/web/marginalia/tips.ts:12-18`, `src/web/Tooltip.tsx:647-656`,
`src/web/marginalia/MarginaliaColumn.tsx:661-670`, `docs/project/marginalia.md:297-324`, and
`docs/project/tooltips.md:282-288`.

I corrected the stale claims: most shut lines use the delegated house card, questions own a
`Tooltip`, and *Cites* owns the reused `CiteCard`. I also corrected `ControlTip.drawn`'s old “Sketch
only” comment and the citation-action comment (Open/jump close in the wrapper; the other actions
close through `CiteCard`).

## GPT Sol plan-review audit

- **F1:** complete after F2 above — touch/pen focus is refused, cancel clears it, and a later mouse
  or keyboard interaction clears a stranded refusal.
- **F2:** complete — `enabled={!lineOpen}` keeps the card shut, with mouse, Enter, Space, and ARIA
  assertions.
- **F3:** complete — Open in Sources and numbered jumps close before invoking their sender; tests
  assert the card has gone. Ask/check use `CiteCard`'s own close path.
- **F4:** complete after F3 above — `data-open` refreshes wrapping and a label `ResizeObserver`
  refreshes clipping after local layout changes.
- **F5:** complete after F4 above — the context value is memoised from stable senders and a real
  consumer is present in the render-budget test.
- **F6:** complete — `.marg-cite-card` at `src/web/styles/marginalia.css:497-500` uses the skim-card
  cap and scrolls internally.

The delegated card does not match *Cites*: its button receives no `data-marg-tip`, asserted at
`tests/marginalia-cite-card.test.tsx:96-113`. The interactive wrapper carries `prose-card`, its
inner scroller carries `marg-cite-card`, and the same test asserts both. `CiteCard` remains the
exported prose component. I found no wider issue requiring a decision.

## Files edited

- `src/web/BlockLinkCard.tsx`
- `src/web/Tooltip.tsx`
- `src/web/marginalia/MarginaliaColumn.tsx`
- `src/web/marginalia/tips.ts`
- `src/web/reader/Reader.tsx`
- `tests/marginalia-cite-card.test.tsx`
- `tests/marginalia-note-cards.test.tsx`
- `tests/quiz-in-prose.test.tsx`
- `docs/project/marginalia.md`
- `docs/project/tooltips.md`
- `docs/plans/261020g-marginalia-tooltips-code-review-sol.md` (this report)

## Checks

- `npx vitest run tests/marginalia-cite-card.test.tsx tests/marginalia-note-cards.test.tsx` —
  **passed**, 2 files / 60 tests.
- `npx vitest run tests/tooltip-interactive.test.tsx tests/quiz-in-prose.test.tsx` — **passed**,
  2 files / 20 tests.
- `npm run typecheck` — the command's `tsx` wrapper could not open `/tmp/tsx-1000/14.pipe` in this
  sandbox (`EPERM`) and did not reach the compiler. The same script via
  `node --import tsx scripts/typecheck.ts` — **passed** all four TypeScript projects and the
  all-source coverage check (3,853 files).
- Advisory Biome lint over all touched source/test files — **exit 0**. It reports only the existing
  two optional-chain warnings and five complexity notices in `BlockLinkCard.tsx`/`Reader.tsx`; no
  fix was applied because those functions are outside this stage's changes.
- `git diff --check` — **passed**.
