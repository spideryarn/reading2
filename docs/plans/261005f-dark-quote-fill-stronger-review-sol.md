1. **P1 — The spine check composites against the wrong background.** [tests/quote-fill.test.ts:261](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/tests/quote-fill.test.ts:261), [spine.css:57](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/src/web/styles/spine.css:57), [spine.css:90](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/src/web/styles/spine.css:90), [spine.css:290](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/src/web/styles/spine.css:290)

   The test puts the 70%-alpha strip over `--background`, but the strip is actually over `--panel` plus the part’s `--depth-1` tint. With the proposed colour, contrast is:

   - 3.157:1 over the page, as the plan says.
   - 3.066:1 over the bare panel.
   - 2.219:1 over an ordinary part.
   - 1.772:1 over the active part.
   - 2.846:1 over a supplement; 1.912:1 when active.

   The current pale lavender gives 3.279:1 over an ordinary part and 2.604:1 over the active part, so the change materially damages the other real use of `--quote-rgb`. I would test the actual rail backdrops and keep the spine colour unchanged—either by taking the strengths-only option or, if the prose genuinely needs the new hue, by introducing a separately tuned spine token after explicitly accepting that it is no longer literally the same colour.

2. **P1 — The prose contrast test also assumes the wrong background for valid quote locations.** [quote-fill.test.ts:178](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/tests/quote-fill.test.ts:178), [prose.css:858](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/src/web/styles/prose.css:858), [prose.css:875](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/src/web/styles/prose.css:875), [block-policy.ts:122](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/src/block-policy.ts:122), [quotes.ts:1713](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/src/quotes.ts:1713)

   Body code blocks and figure captions are deliberately offered to automatic stages, including Quotes. Non-gistable blocks draw `--ink-soft` over `--muted`, while captions draw `--ink-faint`. On the proposed strongest fill over that actual muted surface:

   - Soft ink is 3.943:1, not 4.642:1.
   - Caption/faint ink is 2.256:1.

   These were already below the intended floors with the current treatment—4.239:1 and 2.425:1—so the existing test overstates its protection, and the proposal worsens both. I would add real foreground/background cases before choosing values, then either scope a quieter fill/stronger ink to opaque blocks or deliberately exclude those block kinds from Quotes. The test and documentation must not claim 4.5:1 until this is resolved.

3. **P1 — One automatically assigned search colour newly falls below 3:1 over the strongest quote.** [colourscales.css:95](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/styles/colourscales.css:95), [annotations.css:403](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/src/web/styles/annotations.css:403), [annotations.css:455](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/src/web/styles/annotations.css:455)

   Automatic slot 4, `92 143 232`, is 3.349:1 over today’s strongest fill but 2.898:1 over the proposal. That affects even the full-strength bottom band; it is not merely the deliberately faded confidence edges. Add an overlap test for the fixed search hue and all categorical hues. With the proposed RGB, reducing heavy strength to 0.48 gives 3.015:1 for slot 4; alternatively retain the current quote colour and choose strengths that preserve the floor.

   Other overlap results on the proposed strongest fill:

   - Comment underline, promoted to full orange by [annotations.css:839](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/src/web/styles/annotations.css:839): 3.422:1, acceptable.
   - Citation rule: 3.056:1, just above 3.
   - Glossary dotted rule: 2.396:1, already below 3 today at 2.704.
   - Cross-reference rule: 2.432:1, also already below 3.
   - Chat underline: 1.507:1; the small full-colour chat glyph is 3.825:1. Both already had weak quote overlaps, but the proposal makes them weaker.
   - Inline `<code>` inherits the surrounding ink and is covered; opaque code blocks are the failure in finding 2.
   - A reader-owned coloured highlight replaces the quote background through the higher-specificity rule, so it is unaffected.
   - The pressed white ring is 9.292:1 against the proposed fill.
   - There is no authored `::selection` colour; the browser’s selection highlight paints over this treatment, so there is no repository token pairing to calculate.

4. **P2 — The simpler colour-preserving option is enough for the reported problem, especially for the common light tier.** [plan:34](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/docs/plans/261005f-dark-quote-fill-stronger-and-more-saturated.md:34), [plan:86](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/docs/plans/261005f-dark-quote-fill-stronger-and-more-saturated.md:86)

   Independently, `0.30 / 0.38` with the current lavender produces:

   - Faintest effective alpha 0.21 instead of 0.14.
   - Faintest ΔE 0.156, slightly higher than the proposal’s 0.153.
   - Faintest/page contrast 1.415:1, versus the proposal’s 1.313:1.
   - Soft ink 4.606:1; full ink 8.453:1.
   - Tier-boundary contrast 1.191:1.
   - No spine change.

   It is less saturated and its strongest fill is weaker—ΔE 0.269 versus 0.302—but it answers “not very visible” at least as strongly for the light-tier quotes most readers initially see, while matching “slightly tweak” and avoiding the spine regression. I would screenshot the current colour at `0.30 / 0.36` as well: that retains a 1.139 tier step and keeps automatic search slot 4 at 3.026:1. Only choose the new RGB if the side-by-side screenshot demonstrates that chroma, rather than visibility, is the desired improvement.

5. **P2 — One arithmetic row is stale.** [plan:67](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/docs/plans/261005f-dark-quote-fill-stronger-and-more-saturated.md:67)

   At priority 0.80, `quoteAlpha` is 0.88. With strengths 0.34 and 0.50, heavy-versus-light contrast is **1.301:1**, not 1.26:1. The stated 1.26 is what a 0.48 heavy strength produces: 1.257:1.

   My other independent results agree with the plan after rounding:

   | Measurement | Result |
   |---|---:|
   | Soft ink / strongest fill | 4.642 |
   | Ink / strongest fill | 8.519 |
   | Link / strongest fill | 4.053 |
   | Faintest fill / page | 1.313 |
   | Spine at 0.70 / page only | 3.157 |
   | Ink / solid proposed colour | 3.331 |
   | Faintest ΔE from page | 0.152745 |
   | Strongest ΔE from page | 0.302268 |

   `187 85 249` is approximately `oklch(0.6499 0.2394 309.898)`. It is 39.898° from blue 270 and 40.102° from pink 350, so it clears the test’s “greater than 39°” requirement.

6. **P2 — Light mode is correctly wired in the proposed CSS, but “must not change” is not pinned exactly.** [appearance-palette.test.ts:25](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/tests/appearance-palette.test.ts:25), [tokens.css:363](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/styles/tokens.css:363), [quote-fill.test.ts:184](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/tests/quote-fill.test.ts:184)

   `appearance-palette.test.ts` only treats literal colours as parity-controlled; numeric strengths such as `0.2` and `0.32` do not match `LITERAL`. The quote test’s theme-specific parser does catch an omitted light declaration, but it only enforces contrast ranges, not preservation of the exact old light rendering. Add exact assertions for light `--quote-rgb: 127 66 166`, `--quote-fill-light: 0.2`, and `--quote-fill-heavy: 0.32`, alongside the planned screenshot control.

7. **P3 — The token home is right; no alternative convention is needed.** [tokens.css:111](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/styles/tokens.css:111), [tokens.css:271](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/styles/tokens.css:271), [tokens.css:402](/home/greg/code/spideryarn2/.claude/worktrees/fbs0gppw-dark-quote-highlight/styles/tokens.css:402)

   `styles/tokens.css` already holds per-theme non-colour values such as `--reading-weight`; defining the two tier strengths in the paired root/light blocks and consuming them from `annotations.css` follows that convention. Component-level theme selectors would be worse.

   The repository-wide dependency sweep found:

   - Runtime `--quote-rgb` consumers: prose fill and spine strip only.
   - Runtime `--quote-fill` consumer: prose fill only.
   - `--quote-color`: no runtime consumer; it is currently only the required ordinary-colour alias.
   - `/design`: real `data-quote` specimens, so it inherits and usefully displays the change.
   - Quotes band and prose hover cards: no quote token dependency; neither is recoloured.
   - `tests/block-flash.test.ts`: assumes the declaration’s shape, not its values.
   - Fleet dashboard: has its own stylesheet and does not import the product token file.

VERDICT: build with the changes above