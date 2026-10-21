# Code review: minimum text and touch-target sizes on a phone (261021c)

You are the code reviewer AND fixer for one stage. Repo: this worktree. The change is the single commit
`fe867d4b7` (diff it with `git show fe867d4b7`), on top of origin/dev. The plan, including your own earlier
plan review (R1–R5) and what landed, is docs/plans/261021c-minimum-text-and-touch-target-sizes-on-a-phone.md.

What it does: a token `--text-min` (src/web/styles/tokens.css) — 0px by default, `max(13px, 0.8125rem)` under
`@media (any-pointer: coarse)` — and every literal font-size under 13px-equivalent in src/web/styles/*.css
(bar diagram*, design-page, logo-animations) mechanically rewritten to `max(var(--text-min), X)`; the type-role
tokens and Tailwind's `--text-xs` (tailwind.css @theme inline) floored; arbitrary `tw:text-[…]` sizes rewritten
to `tw:text-[length:max(var(--text-min),X)]`; 40px finger targets in Chat (mode-band.css, chat-actions.css) and
the prose hover card (prose-hover-card.css); a 28×40 halo on footnote markers (footnotes.css); a guard
tests/minimum-text-size.test.ts with an exact baseline tests/fixtures/small-text-baseline.json; docs in
typography.md § The smallest text, controls.md § The numbers, phone-and-touch.md.

Look hardest at:
1. The mechanical rewrite: any declaration where wrapping changes meaning — `!important` placement, a value
   inside `@supports`/`@container`/keyframes, a font-size used as a measuring unit (em-based widths/heights
   elsewhere in the same rule that silently grow on a phone and break a layout: badges, circles, superscripts,
   the dock's count badge, spine, gutter, icons sized in em), a size deliberately tiny for a reason stated in its
   comment (sr-only, a hidden measuring element, an ellipsis glyph), text inside fixed-height boxes that would
   now clip. Read the comments beside changed declarations.
2. The footnote marker `::after` halo: does any other rule already put `::after`/`position` on
   `.prose a[data-spya-note-ref]`, or does `position: relative` on an inline `<a>` inside `<sup>` misbehave?
3. Chat CSS: `.chat-icon` at 40px under any-pointer — does it break the band header (title truncation), the
   rename/edit Save/Cancel pair, `.chat-icon.held` span, the steppers? `.chat-sources li > a` as inline-flex —
   does overflow-wrap still work for a long URL title?
4. The guard: false greens.
5. Tests: run `npx vitest run tests/minimum-text-size.test.ts tests/type-roles.test.ts tests/tap-target.test.tsx
   tests/close-cross.test.ts` yourself (they need no network).

Fix what is inside this stage, narrowly; report, do not fix, anything wider. Severity P0–P3, an ID per finding
(C1, C2…), file:line evidence, and say for each whether you fixed it. Write the findings to your answer.
