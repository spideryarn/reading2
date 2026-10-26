# A front-matter stub measured its width in the wrong face

**What happened.** A shut stretch of front or back matter draws a one-line stub, `.matter-stub` in
`src/web/styles/prose.css`, which is meant to sit on the prose's measure so its first letter lines up
with the article's. Its comment says *"the container takes `.prose`'s face and size, so `ch` means
what it means there"*. It set `font-family: var(--font-reading)`. That has been Geist since
2026-10-02, while the prose is Source Serif 4 (`--font-author`), so the stub's
`clamp(45ch, 90vw, var(--reading-measure))` was counted in Geist zeroes. That makes it a different
width from the prose column it is centred against. Found on 2026-10-25 by the agent collapsing
`--font-reading` into `--font-ui` (plan [261025k § 4](../plans/261025k-fonts-and-css-code-quality.md)),
because the swap made the mismatch visible in the source.

## Root cause

Introduced in `49c065cae` (2026-10-18, 261018a stage 3). By then the article's face had moved from
`--font-reading` to `--font-author` (voices, 2026-10-02), but `--font-reading` kept its name, *the
base reading stack*. A token whose name says "the prose's face" was a reasonable thing to reach for,
and nothing told the author that it no longer was.

**The class: a token named for a role it no longer plays.** When a role moves to a new token and
the old token stays behind under its old name, the old name becomes a confident wrong answer for
everyone who comes later. The same mistake had already happened once with these boxes:
`.blk-gutter`, `.fold-toggle` and the mastheads (261003c, 88px off at 1440). That is why
`tests/prose-centred-in-its-cell.test.ts` lists them, and the stub was never added to that list.

## The fix

`.matter-stub` takes `--font-author`, like the other geometry-only boxes. Its two children are
buttons that set the UI face themselves (`.matter-stub > button`). The test now names it: red
against the old rule, green after. `--font-reading` itself is gone (261025k § 4), so the misleading
name is no longer there to reach for.

## What would have caught the class, by ease and value

1. **Delete or rename a token when its role moves.** Done here for `--font-reading`, `--font-brand`
   and `tw:font-prose`. That is the whole of the prevention for this instance, and it is cheap.
2. **A list in a test is only as good as its coverage.** A geometry box added later is not on the
   list, and this is the fourth time: the gutter, the fold toggle, the mastheads (261003c), the
   Skim door (261009j, 160px too wide) and now the stub. So
   `tests/prose-centred-in-its-cell.test.ts` asks the other way round: **every rule in every client
   sheet whose declarations use `var(--reading-measure)` sets `--font-author` itself, is the prose,
   or is named with the reason its face does not matter.** Its first version searched only the
   reading-view sheets and missed the repo-root `styles/tokens.css`; review widened it to the whole
   import graph and found `.reading-column` making the same mistake. One exception remains (the
   note gutter, the same element as `.blk-gutter`). The test names examples from both sheets and
   from `clamp()` and `calc()`, so an empty or narrowed scan does not pass.
