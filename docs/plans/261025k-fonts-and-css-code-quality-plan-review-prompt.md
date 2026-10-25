# Plan review: 261025k fonts and CSS code quality

You are reviewing a plan before it is built. Read-only: do not change any file.

**The candidate** is one untracked file in this worktree (base `git rev-parse HEAD`):
`docs/plans/261025k-fonts-and-css-code-quality.md`. Untracked files: that plan and this prompt.

**Read first** (the plan cites them; they do not limit scope): docs/project/fonts.md,
docs/project/email.md, src/web/styles/voices.css, src/web/tailwind.css (the `@layer` statement and
how `button-tone.css` is imported into `tone`), tests/voices-css.test.ts, tests/helpers/stylesheets.ts,
src/store/pg-voucher-emails.ts (`giftHtml`), supabase/templates/*.html,
scripts/supabase-auth-config.ts (`templatesBody`), tests/auth-email-templates.test.ts,
src/sketch-scene.ts (`CHAR_W`, `wrap`, `charsThatFit`, `layoutNodeText`, `scoreSketch`),
src/sketch-paint.ts (every `CHAR_W` use), src/web/voice.ts, styles/tokens.css (the type section).

**What to check**

1. Is each design right, and is there a simpler one that gets the same value? In particular:
   - Item 2: does moving voices.css to a top-level `voices` layer between `app` and `utilities`,
     with `:where()` selectors, reproduce today's computed `font-family` everywhere? Look for app
     rules that today **beat** a voice rule on the same element (higher specificity than the
     voice list's, or later at equal specificity) — under the plan they would lose. Name any you
     find with file:line. Also any `!important`, `font:` shorthands, inline styles, or rules in
     `tone`/`utilities` that interact. Are there cascade-layer subtleties (nested layers, unlayered
     sheets, `@import … layer()` order, Tailwind's processing of `@layer` blocks) that break it?
   - Item 2: the plan puts the computed `.voice-*` rules last so a computed voice beats a list on
     the same element. Does any element today carry both, where that would change the result?
   - Item 1: "checked" (a test asserting each template = frame pieces + its own rows) vs
     "generated". Is the decomposition into head/open/footer/close pieces right given what differs
     between the three today (titles, the origin literal, comments at the top of the templates)?
   - Item 3: is a per-face `CHAR_W` table plus a test that measures each face's woff2 with
     @napi-rs/canvas sound? Does `CHAR_W` also feed anything else (edge labels, region labels, the
     caption) that the plan misses? Is putting `voiceClass(...)` on the `<svg>` the right hook, or
     would it collide with voices.css's lists (e.g. `.mode-band` resetting to `--font-ui`)?
2. Anything missed: docs that must change, tests that will break, the rule in fonts.md that
   `voice-*` must not go on an element a list names.

**Severity scale**: P0 breaks production or loses data; P1 the plan's stated result would not
hold (something renders differently, a test that cannot fail); P2 a real but smaller defect or a
clearly simpler route; P3 wording/nit. Give every finding an ID (F1, F2…), the severity, the
evidence (file:line), and the fix.

**My own suspicions, last**: (a) a component rule with an id selector or many classes setting
`font-family` on a voiced element; (b) `.passage-whole` resets' interaction once they move;
(c) whether Tailwind v4's `@import … layer(x)` of a file that itself contains no `@layer` is the
same as the `tone` precedent.
