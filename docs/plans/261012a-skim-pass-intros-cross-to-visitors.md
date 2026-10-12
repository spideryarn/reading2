# 261012a — Skim's pass intros cross to visitors

Queue item `qi-ka756pt3`; report `spya-wu83xh` (SPIDERYARN-READING2-HE); question
[q-t5xjqn](../user-feedback/questions/q-t5xjqn.md). Follows
[261011r](261011r-skim-more-always-longer-than-gist-a-pass-intro-shorter-quotes-skim-for-box.md),
which built the intros owner-only and asked.

## Why

`skim/13` gives each Skim pass an intro: one or two AI-written sentences saying what the walk goes
through and in what order, the answer to Greg's *"disorienting and disjointed"*. A visitor to a
shared or public article walks the same route without it. The question offered A (visitors see it
too) or B (owner only); Greg replied:

> A
>
> — Greg, 2026-10-12 (reply spya-quyk2n to q-t5xjqn)

The visitor's payload is built field by field in [`src/public/dto.ts`](../../src/public/dto.ts), a
defence named in [security-map.md](../project/security-map.md). That reply is the say-so for this
one field, and for nothing else on the route.

## What changes

1. **`PublicSkim` gains `intros?: SkimIntros`** ([`src/public-types.ts`](../../src/public-types.ts)),
   copied in `publicSkim` with `opt(skim, "intros")` — absent on a route from before `skim/13`,
   exactly as the owner's. Each entry is plain text or `null`; nothing else is in the tuple.
   `profileHash` and the pipeline fields stay out, and so does `dropped.badIntro` /
   `dropped.movedIntro` (our checking's tally, as every `dropped`).
2. **The visitor's panel draws it.** [`SkimPanel.tsx`](../../src/web/SkimPanel.tsx) reads the intro
   from `route` (owner's or visitor's) instead of `owner.skim`, for both the line above the stops
   and the (i) sentence that explains it. It is rendered as a text node in a `<p>`, as now — never
   a link, an attribute or HTML.
3. **Tests.** `tests/public-dto.test.ts`: the fixture's intros move from "proves they stay out" to
   the key set and the `toEqual`, with `profileHash` still asserted absent by key and by value.
   `tests/public-visibility-pg.test.ts`: the real row carries intros, and the real response carries
   them and still not the profile hash (the DTO test cannot see whether the public `select`
   fetches the column — it is the same `skim` jsonb column, but the test says so). A panel test that
   a visitor's band shows the intro.
4. **Docs.** security-map.md § the allowlist records the addition with Greg's reply (as it does for
   `PublicMeta`'s three); [skim.md](../project/skim.md) and the comments that say "owner only"
   (`Skim.intros` in `src/types.ts`, `publicSkim`, `PublicSkim`, the panel) are corrected, and so is
   the reader-facing help page (`src/web/help/pages/modes/skim.md`, "On your own articles"; Sol F1).
   security.md lists no DTO fields, so it has nothing to change.

## Why it is safe to send

- The intro prompt (`skim.ts` section 4) holds the cue's rules and adds *"Never address or mention
  the reader."* Cues already cross under the same argument (`PublicSkim`'s comment): they may be
  shaped by the owner's profile and purpose, `PROFILE_RULES` forbids a sentence about the reader,
  and `/features/public-readable-sharing` tells the author.
- Validated server-side to a string ≤ `MAX_INTRO_CHARS` or `null` (`introsOf`) before it is stored.
- Drawn as React text, so a hostile model output is shown, not run.

## Considered and not done

- **Re-validating the tuple in the DTO** (length 3, each string ≤ 240). The store only ever writes
  what `introsOf` returns, and no other DTO field re-validates its model text; adding it here would
  be a second validator for one field. Copy as-is, like `cue`.
- **Changing the visitor's promise line** (`VISITOR_SKIM_PROMISE`, *"The order and the cues are the
  model's reading"*). The (i) already gets `SKIM_INTRO_EXPLAINED` beside it, which says the line is
  AI-written; the promise stays as is.

## Reviews

- **Plan, GPT Sol** ([prompt](261012a-skim-plan-review-prompt.md), [answer](261012a-skim-plan-review-sol.md)):
  APPROVE WITH CHANGES. F1, the help page still said *"On your own articles"* — fixed. F2, that
  security-map.md is a rule doc whose wording needs Greg's approval first: not taken, because the
  brief that carried Greg's "A" asks for security-map.md to be updated in this same change, and the
  addition is a dated record of one field beside `PublicMeta`'s, not a change to any rule's wording.
