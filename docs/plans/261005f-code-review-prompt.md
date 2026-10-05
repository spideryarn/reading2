# Code review: the dark quote fill, stronger

You reviewed the plan for this; this is the code built from it. You may fix what you find inside
this change (the files below) and report anything wider for me to decide. Work in this checkout (a
git worktree). Do not commit, do not run git commands that change anything, do not touch files
outside the list unless a finding requires it, and say so if you did.

The request, verbatim, from the product owner, Greg: "The quote highlighting color is not very
visible against the black background in dark mode. Take a screenshot and see if you can slightly
tweak it." Light mode must not change.

What was built, after your plan review (`docs/plans/261005f-dark-quote-fill-stronger-review-sol.md`):
the colour was kept, and the two fill strengths became per-theme tokens, 0.28 / 0.36 on the dark
page and 0.20 / 0.32 (unchanged) on the light one. Read `docs/plans/261005f-dark-quote-fill-stronger.md`
first; it says what was passed over and what was found and not fixed.

The diff is `git diff HEAD` plus the untracked files under `docs/plans/261005f-*`. The files:

- `styles/tokens.css` — `--quote-fill-light`, `--quote-fill-heavy` in both blocks, and the comment.
- `src/web/styles/annotations.css` — `--quote-fill` set from the tokens; comment edits.
- `tests/quote-fill.test.ts` — `fillStrength(theme, tier)` reads the tokens; four new assertions.
- `docs/project/quotes.md` — the strengths, and a new section "Stronger on the dark page".
- `src/types.ts` — one comment on `QuoteTier`.
- `docs/plans/261005f-*` — the plan, the reviews, four screenshots.

What I want checked:

1. **Light mode really is unchanged**, in every place the fill is drawn, including a page with no
   `data-theme` attribute at all and a `data-theme="system"` or media-query path if one exists
   (read `src/web/appearance.ts` and how the dark block in `styles/tokens.css` is selected). Is
   there any state in which `--quote-fill-light` is undefined where `mark.hit[data-quote]` is drawn
   (a page that loads `annotations.css` but not `styles/tokens.css`, the marketing pages, `/design`,
   a public `/read/public` page, an embedded or exported view)? An undefined token would make the
   `calc()` invalid and the quote fill disappear entirely, silently.
2. **The new assertions can fail.** For each of the four added tests, say what edit would turn it
   red, and try it if cheap. In particular: does `token(SCALES, theme, "--cat-4-rgb")` read the dark
   value and not a later light one; does the wiring assertion's regex actually see both rules; is the
   OKLab distance computed the same way a browser composites.
3. **Recompute the numbers in the plan's table and in the new section of quotes.md** with your own
   script and correct any that are wrong, in the docs.
4. **Every Greg quotation in the diff is his.** The only words of his that may appear in a
   blockquote or in quotation marks attributed to him are: the report sentence quoted above; "use the
   same colour we use for their outline-border" (2026-09-10, already in quotes.md); and quotations
   that were already in the files before this diff. If you edit a doc, do not attribute any new
   sentence to Greg.
5. Anything else that is wrong: a comment that now lies, a doc that still states 0.20 / 0.32 as the
   only strengths, a test elsewhere that hard-codes them.

Run `npx vitest run tests/quote-fill.test.ts tests/appearance-palette.test.ts tests/block-flash.test.ts tests/doc-links.test.ts`
and `npm run typecheck` after any edit you make. Do not run the full suite.

Write findings as a list, most serious first, each marked P0 to P3 with file and line, what you did
about it (fixed, or left for me and why). List every file you edited. Finish with a line beginning
exactly `VERDICT:` followed by one of `ship`, `ship after the fixes I made`, or `do not ship`.
