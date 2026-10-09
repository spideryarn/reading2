# Skim: a quieter open stop, so its quote stands out

Greg's answer to [q-u04sye](../user-feedback/questions/q-u04sye.md), which came out of report
`spya-x0rfs2` and plan [261009j § Not built](261009j-skim-question-optional-and-the-border.md#not-built-the-wider-layout-put-to-greg-as-one-question).
The mode is [skim.md](../project/skim.md).

> Okay, try these and let's see how it goes.
>
> — Greg, 2026-10-09 (`spya-uzpm5s`)

> Perhaps we could also do something to make it clearer that these are quotes. So you know how drop
> caps are, like you know, they make a single character really large. I wonder about creating a pair
> of quite big kind of quote icon symbols just to the left of the actual quote to make it clear that
> it's a quote. Maybe that's not necessary. Maybe the fact that it's already in Times New Roman
> indicates that it's from the article.
>
> — Greg, 2026-10-09 (`spya-nphhbf`)

> I should say that I don't have it open in front of me and I can't quite visualize it, so I'm not
> 100% sure of what you're suggesting. So this is an experiment.
>
> — Greg, 2026-10-09 (`spya-d8nc0h`)

## What we build (option A)

All CSS, in `src/web/styles/skim.css`; nothing in the components changes.

1. **The open stop's section heading** (`.skim-row.current .skim-place`): 0.82rem rather than
   `--type-item` (0.92rem), `--ink-soft` rather than `--ink`. The weight stays 600: it already was
   600, so "semi-bold instead of bold" in the question was wrong about the starting point; what read
   as bold was the size and the full-strength ink. The other rows' headings are untouched — the
   route still scans as a list.
   - This is a named exception to the band's text roles, so `tests/type-roles.test.ts` gets an
     `EXCEPTIONS` row at 0.82rem with its reason, and the `.skim-place` cascade witness moves to a
     row that is not current (it is the current row today, which the new rule would rightly fail).
2. **The chips** (`.skim-chip`): no fill (`transparent`, so the stop's raised ground shows through)
   rather than `--page`, which is near-black in dark mode and white in light; text `--ink-soft`.
   The border stays `--rule-strong`, the stronger of the two rule colours — the mock-up's outline
   was too faint because it used the weaker one. Hover and `.on` keep the accent border, and the
   text goes back to `--ink` on hover so the chip still answers the pointer.
3. **The door's cue** (`.skim-door-cue`): `font-style: normal`. The face already marks the words
   as the model's.

## The quote marks: tried in a screenshot, kept only if they clearly help

Greg's idea: a large pair of quote marks to the left of the quote, drop-cap style. Tried by
injecting CSS and a span into the page (nothing built), screenshotted beside the built version on
desktop, dark and light. The judgement and the reason go below under § Result, whichever way it
falls.

The case against, before looking: the quote already opens with a “, is in the author's serif while
everything around it is sans or mono, and the column to its left holds the stop's number and its
position mark, so a large mark has to go either over that column or into the quote's own width.

## Simpler option passed over

Option B, the heading alone. Greg chose A.

## Stages

1. This plan, GPT Sol plan review (read-only).
2. The CSS and the test change; `npm test` for the touched suites, typecheck.
3. Screenshots, before and after, desktop dark and light, and the quote-mark experiment (Sonnet,
   Playwright).
4. GPT Sol code review, skim.md updated, the question file and the note, push to `dev`.

## Result

Built as planned, with two changes from the plan review
([plan-review-sol](261009m-skim-quieter-open-stop-plan-review-sol.md)):

- **Both door lines go upright**, the model's cue and the fixed "End of Gist — 5 stops"; they share
  `.skim-door-cue`, and one slant for one and not the other would be a distinction nobody asked
  for. The comment says the model's line is marked by its face, not the slant.
- **A cascade witness for the new exception**: the exception check reads only rules whose selector
  is exactly `.skim-row.current .skim-place`, so a later, more specific rule could win unseen. The
  new test computes the open heading's size through every sheet, and was watched going red with
  such a rule added.

**Kept against a review finding:** the chip outline stays `--rule-strong`. GPT Sol measured it at
about 1.4:1 on the dark raised ground and 2:1 on the light, under the 3:1 often asked of a control's
boundary. Greg's option named the stronger border colour, the screenshots show the outline clearly in
both themes, and the chip is still recognisably a button by its shape and its hover. If the chips
stop reading as things to press, the border can go up a step on its own.

Screenshots, desktop at 1440 wide, `fowler-phrenology` stop 1, in
[261009m-shots/](261009m-shots/): `before-row-dark.png` and `after-row-dark.png`,
`before-row-light.png` and `after-row-light.png`, `before-door-dark.png` and `after-door-dark.png`,
`after-chip-hover-dark.png`, `after-page-dark.png`.

**The quote marks were not kept.** Two variants, in `quotemark-a-dark.png`, `quotemark-a-light.png`
and `quotemark-b-dark.png`: (A) a large opening mark floated drop-cap style, (B) one hung in the
gutter to the left of the text. A pushes the first line in and makes the quote's left edge ragged; B
is tidier but sits under the stop number and position mark, which is that column's job, and on a
280px band or a phone it would crowd them. Neither tells the reader anything the quote does not
already say: it opens with a curly “, and it is the only line in the author's serif in a band of
sans and mono — the point Greg made himself. With the heading and the chips quieter, the quote is
now the brightest line in the stop without one.
