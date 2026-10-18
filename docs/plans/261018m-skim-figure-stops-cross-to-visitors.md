# 261018m — Skim's figure stops cross to visitors

Queue item `qi-6297kfn6`; report `spya-c8z66b` (SPIDERYARN-READING2-J5); question
[q-gq0f4k](../user-feedback/questions/q-gq0f4k.md). Follows
[261017d](261017d-figures-as-stops-of-their-own-in-the-skim-route.md), which built figure stops
owner-only and asked (§ Not built: figure stops for visitors). The same shape as
[261012a](261012a-skim-pass-intros-cross-to-visitors.md), which let the pass intros cross.

## Why

`skim/14` lets a figure be a stop of its own in Gist, More and Most, with a cue saying why it is
there. A visitor to a shared or public article walks the same route with the figures left out,
because the visitor's payload is built field by field in
[`src/public/dto.ts`](../../src/public/dto.ts), a defence named in
[security-map.md](../project/security-map.md). The question offered A (visitors see the figure
stops too) or B (they keep the quotes-only walk). Greg replied:

> A
>
> — Greg, 2026-10-18 (reply spya-qj6qzz to q-gq0f4k)

That reply is the say-so for this one field, `figures`, and for nothing else on the route.

## What changes

1. **`PublicSkim` gains `figures?: SkimFigureStop[]`**
   ([`src/public-types.ts`](../../src/public-types.ts)). `publicSkim` copies it **field by field**,
   as it does each stop: `{ blockId, depth, cue, after }`, and only when the stored route has the
   key, so a route from before `skim/14` still crosses without it, exactly as the owner's. Spreading
   each figure object (or `opt(skim, "figures")`) would let a field added to `SkimFigureStop` later
   cross unasked; the field-by-field copy is what the file does everywhere else.
   - `blockId`: a block of this article, which the visitor's payload already carries in `blocks`
     (every block crosses; front and back matter fold, they are not withheld). A figure whose block
     is no longer there is a disabled row on the client, as for the owner.
   - `depth`, `after`: the pass and the quote stop it follows, both about the route, which already
     crosses.
   - `cue`: the model's one line about what to look at, on the same footing as a stop's `cue`
     (same prompt rules, same `PROFILE_RULES`, validated and length-capped server-side before it is
     stored, drawn as a React text node).
   - Nothing else of the route is touched: `profileHash`, `dropped` (its figure counts with it),
     `visible`, and the pipeline fields stay out.
2. **The visitor's band walks them.** `VisitorSkimBand`
   ([`SkimMode.tsx`](../../src/web/modes/skim/SkimMode.tsx)) calls
   `walkOf(route.stops, route.figures)` as the owner's band does; the rows, the door and the step
   are already shared and draw a figure stop whichever access drew them.
3. **Tests, red first.**
   - `tests/public-dto.test.ts`: the fixture's figure moves from "proves it stays out" to the key
     set and the `toEqual`; a planted extra key on the stored figure must not cross (the
     field-by-field guard); `profileHash` still asserted absent by key and by value; and a route
     with no `figures` crosses with no key (Sol plan review F2).
   - `tests/public-visibility-pg.test.ts`: the real row carries a figure stop and the real response
     carries it, still without the profile hash.
   - `tests/skim-figures.test.tsx`: a visitor's Gist walks the figure between its quotes and steps
     to it, as the owner's test does.
4. **Docs.** security-map.md records the addition with Greg's reply (as it does for `intros` and
   `matter`); [skim.md](../project/skim.md), the help page
   (`src/web/help/pages/modes/skim.md`, *"Visitors to a shared article walk the passages only"*),
   and the comments that say owner-only (`Skim.figures` in `src/types.ts`, `PublicSkim`,
   `VisitorSkimBand`, the DTO test fixture) are corrected.

## Considered and not done

- **Filtering figure stops to blocks the visitor's payload holds.** Every block crosses, so the
  filter would never fire; and the client already treats a missing figure as a disabled row.
- **Letting the pass intros name a figure now that both readers see them.** That is a prompt change
  and a `skim/15`, not the one field Greg allowed; the intros keep mapping the quotes, which stays
  right for both readers.
- **`opt(skim, "figures")`**, the one-liner 261017d named: simpler, but it would copy whatever a
  `SkimFigureStop` holds in future. The per-field copy is four lines more.

## Reviews

- **Plan, GPT Sol** ([prompt](261018m-plan-review-prompt.md), [answer](261018m-plan-review-sol.md)):
  APPROVE WITH CHANGES. It found nothing else to change for a visitor to get the field (the public
  select reads the whole `skim` column; export, caching, server render and MCP are untouched), and
  nothing owner-gated in the client's figure rows. Its three findings:
  - F1, the bookkeeping (q-gq0f4k, the spya-c8z66b note, the generated files): done at the end,
    per [feedback-reports.md](../project/feedback-reports.md).
  - F2, nothing tested that a route with no `figures` crosses with no key rather than `[]`: added
    to `tests/public-dto.test.ts`.
  - F3, `src/skim.ts`'s version comment said a visitor walks no figures: corrected. The prompt's
    own reason (section 4, *"some readers walk the route without its figures"*) is **left as it
    is, deliberately**: it is still true, since validation can drop or trim a figure the model
    named, and rewording a prompt means a new `skim/15` and a measurement, which is more than the
    one field Greg allowed. If the intro rule is ever relaxed to name figures, that is when the
    reason changes.
- **Code, GPT Sol** ([prompt](261018m-code-review-prompt.md), [diff](261018m-code-review.diff),
  [answer](261018m-code-review-sol.md)): LAND WITH FIXES. One P3, a stale comment on
  `SkimFigureStop` in `src/types.ts` saying the DTO carries no figures, which it fixed. It broke the
  change on purpose four ways and saw a test fail each time: the DTO projection removed, `figures`
  always emitted (the older-route test), a whole-object spread (`plantedFigureField`), and
  `route.figures` dropped from the visitor's `walkOf`. Its sandbox could not reach Postgres, so
  `tests/public-visibility-pg.test.ts` was run here instead: 54 passed.
