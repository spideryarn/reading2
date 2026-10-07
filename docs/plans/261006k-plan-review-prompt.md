# Plan review: 261006k

Read-only review. Please review the plan at
`docs/plans/261006k-text-size-adjust-for-a-landscape-phone-and-a-quick-review-of-fonts-and-sizes.md`
before it is built. Do not edit any file.

Evidence to check it against, rather than taking the prose on trust:

- `src/web/tailwind.css` (the hand-written preflight substitute, the `@layer base` blocks near the end)
- `node_modules/tailwindcss/preflight.css` (the `html, :host` rule)
- `tests/preflight-substitute.test.ts` (the test the plan extends)
- `src/web/styles/skim.css` (`.skim-words`, `.skim-place`), `styles/tokens.css` (`--reading-size`)
- `docs/project/controls.md`, `docs/project/fonts.md`, `docs/project/typography.md`
- `index.html` (the viewport meta)
- The screenshot is not in the repo; the plan's table is my measurement of it. It shows Skim's band
  left of the article on what looks like an iPhone in landscape.

Questions:

1. Is the diagnosis (iOS Safari text autosizing in landscape, absent `-webkit-text-size-adjust: 100%`)
   sound, given a `width=device-width, initial-scale=1` viewport? Is there another explanation for a
   uniform 1.53x on wrapped text in the band while the article and the buttons are at their own size
   that I should rule out in the stylesheets?
2. Is `html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }` in `@layer base` the right
   rule and place? Any way it could regress something (layer order, `.prose`, the reader's zoom)?
3. Is the proposed test a real check (could it pass vacuously)?
4. Are the review's numbers right (count them yourself), and are the two questions for Greg plain
   and answerable?
5. Anything clear-cut the review should have built rather than asked about, or anything it built
   that is really a design choice?

End with a line `VERDICT: approve` or `VERDICT: changes needed`, and number your findings F1, F2, …
