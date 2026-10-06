# Plan review: the card on a quote in the prose says what a quote is

You are reviewing a **plan**, read-only, before it is built. Do not edit anything.

Repo: this worktree (TypeScript, ESM, React, vitest). Branch off `dev`.

## The candidate

A live pre-commit candidate. Base: `ba56c1cb1` (origin/dev). Untracked files, which `git diff` will
not show you:

- `docs/plans/261006j-the-card-on-a-quote-in-the-prose-says-what-a-quote-is.md` — the plan. Read it first.

Nothing else is changed yet. Code and docs the plan touches or leans on, to read as they stand:

- `src/web/ProseHoverCard.tsx` § `QuoteCard`, `QuoteCardSource`, `QUOTE_OPEN_MS`, and how the card is
  made enterable by the pointer
- `src/web/QuotesPanel.tsx` § `LABEL`, `priorityOf`, `quoteTier`, `quoteAlpha`
- `src/web/quote-band-rows.ts` § `aiProvenance`
- `src/mode-catalog.ts` § `quotes`
- `src/web/BandAbout.tsx`, `src/web/ModeSurface.tsx` (the band's (i) and its *More in Help →*)
- `src/web/help/help-anchors.ts`, `src/web/help/help-modes.tsx` § quotes
- `src/web/styles/prose-hover-card.css` § a quote's half
- `tests/quote-hover-card.test.tsx`
- `docs/project/quotes.md` (§ In the spine, on a card, and one at a time; § A highlighter pen),
  `docs/project/tooltips.md`

This list is where to start, not a limit on scope. You may run
`npx vitest run tests/quote-hover-card.test.tsx`; it needs no database or network.

## What to do

Attack the plan independently first. Greg's report is quoted at the top of the plan and there is no
screenshot. Is the plan's reading of it (the purple fills in the prose, seen from Citations mode) the
best one, given the table of surfaces — check each row of that table against the code. Is this the
simplest version that answers the report? **Is every proposed reader-facing sentence true of the
code**, for an owner and for a visitor on a shared article, and for every kind of quote that can
reach `QuoteCard` (scored, unscored, added by Find more, Skim's stop)? What breaks: a visitor
following the help link, the link inside a card that closes on pointer-leave, a card stacked with a
term or citation half, a narrow card? Are the tests able to fail for the right reason?

## Severity and findings

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding a stable ID (`F1`, `F2`, …), its severity, whether it is **established** (direct
evidence, no unresolved inference) or **reasoned**, what shows it, and the smallest fix (exact
replacement wording where it is prose). End with one line:
`VERDICT: build` / `VERDICT: build with fixes` / `VERDICT: do not build` — refuse only on an
established P0 or P1.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- Whether "A stronger highlight means a higher score" is accurate when the fill is two tiers plus a
  fade that floors at 0.70, and for an unscored quote (the card then says "Not scored.").
- Whether "the AI picked out" holds for every `Quote` that reaches this card.
- Whether four extra lines on every quote's card is the wrong trade, and the sentence alone (without
  the two score meanings) would be better.

Do not change any file.
