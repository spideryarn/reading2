# The masthead's facts line pushes a phone page sideways

**Dispatched by the Overseer, 2026-10-01**, from a note in
[261001f-long-url-wraps-and-chat-latest-pill-clears-the-text.md](261001f-long-url-wraps-and-chat-latest-pill-clears-the-text.md):
`antikythera-mechanism` overflows a 390px page by about 180px, blamed there on "three spans inside
`.zoomable` wrappers". Not from a reader report. The brief asked that no article figure be able to
push the page wider than the viewport.

**Prior work.** Checked `docs/plans/`, `docs/user-feedback/`, `git log --oneline -200 origin/dev`
and `gjd-remote ls`. Only 261001f mentions it, as out of scope. No session owns it.

## What is actually wrong

**It is not a figure.** Measured in headless Chrome at 390×844 against the local copy
(`antikythera-mechanism-spya-zhxrzm`): `scrollWidth` 570. The elements past the right edge whose
right edge is 570 are the last three spans of the masthead's `<p class="facts">` (`~51 min`,
`9 parts`, `31 sections`) — 261001f's "three spans at x 364–570", misattributed. The 616px table
further down is inside its own scroller and does not count. Two injections settle it:

| injected CSS | `scrollWidth` at 390 |
|---|---|
| none | 570 |
| `.facts { display: none }` | 390 |
| `.facts > span + span { display: inline-block }` | 390 |

**The mechanism.** `Masthead.tsx` renders the facts as adjacent `<span>`s with **no whitespace
between them**, and the separator dot is a `::before` *inside* each span. Since b8e8a9dd (plan
260929d, 2026-09-29) every span after the first is `white-space: nowrap`, so that "9 / parts"
cannot split. Together those leave no soft-wrap opportunity anywhere from the byline's last word to
the end of the line:

```
Contributors to Wikimedia | projects·Wikimedia Foundation, Inc.·11,688 words·~51 min·9 parts·31 sections
                ^ last break opportunity                                  one unbreakable run, ~520px →
```

Any article whose site name and counts add up to more than the column is affected — every
Wikipedia article on a phone, at least. 260929d's own check passed on a paper whose run was shorter.

**The class:** inline items made `nowrap` individually, with nothing between them, leave no wrap
opportunity at any of their boundaries (ordinary inline boundaries are not one), so the whole
suffix of the line is unbreakable. Making each item whole silently made the whole line whole.

## The fix

One declaration in `src/web/styles/shell.css`, replacing the `nowrap`:

```css
.facts > span + span { display: inline-block; }
```

An inline-block is an atomic inline, and CSS Text § 5.5 requires a soft-wrap opportunity before and
after one, so the line wraps *between* facts. It also keeps each later fact whole, without
`nowrap`: an inline-block's width is its shrink-to-fit width against the whole column, not against
what is left of the line, so "9 parts" does not fit at the end of a line and goes to the next one
whole — what 260929d wanted. And unlike `nowrap`, a multi-word fact wider than the entire column (a
very long site name — Sol's finding) can wrap at its spaces inside its own box instead of
overflowing. An unbroken token remains unbreakable; this change does not add `overflow-wrap`. The
first span stays inline and wraps freely; normally it is the byline or author list, though the
metadata fields are optional and the first remaining fact takes that position when they are absent.

**What it costs.** A wrapped line starts with the dot (`· 9 parts`), since the dot lives inside the
span it precedes. Accepted: moving the separator would mean changing the markup and the
"no stranded interpunct" rule above it, which is a redesign of a line that only needed to wrap.

**Simpler options passed over.**

- *Drop the `nowrap` and nothing else.* Brings back "9 / parts" splitting, which is why it was
  added.
- *`inline-block` and keep the `nowrap`.* Fixes the aggregate overflow, but a single site name
  wider than the column still overflows (GPT Sol, plan review).
- *Emit `{" "}` between the spans in JSX.* Also gives break points, but adds a visible space before
  every dot and changes the spacing at every width.
- *`overflow-wrap: anywhere` on `.facts`.* Would break inside "Wikimedia" rather than between
  facts.
- *`overflow-x: clip` on the reader.* Hides the symptom and cuts the text off; also hides the next
  overflow of any kind.

## The figures, as asked

Since the brief named figures: the figure wrappers are not involved, and no figure overflows in
any article swept. `scrollWidth` in headless Chrome against the dev server (local copies), before
and after the fix; the right-hand column lists every element past the edge that is not inside a
scroller:

| article (figures) | 390 before | 390 after | 1440 before / after |
|---|---|---|---|
| antikythera-mechanism (21) | 570 — three `.facts` spans | 390 | 1440 / 1440 |
| spider-silk (20) | 572 — three `.facts` spans | 390 | 1440 / 1440 |
| the-mythology-of-conscious-ai (5) | 439 — one span | 390 | 1440 / 1440 |
| scaling-hypothesis (9) | 394 — one span | 390 | 1440 / 1440 |
| towards-a-theory-of-bugs (80) | 390 | 390 | 1440 / 1440 |
| what-if-we-had-bigger-brains (7) | 390 | 390 | 1440 / 1440 |
| fowler-phrenology (0) | 390 | 390 | 1440 / 1440 |

The wide tables (antikythera's runs to x 616 at 390) sit inside their own horizontal scroller and
never reach the page. So the figures already meet the brief; there was nothing to change there.

Screenshots: [before, 390](261001e-before-390.png), [after, 390](261001e-after-390.png),
[after, 1440](261001e-after-1440.png).

## Test

`tests/masthead-facts-wrap-in-chrome.test.tsx`, after `mark-sign-in-chrome.test.ts`'s pattern
(real Chrome, `setContent`, the root token sheet and reader stylesheets inlined, skipped where there
is no Chrome). It renders the **real `Masthead`** with `renderToStaticMarkup` — so the missing
whitespace between the spans is the component's own, not a literal that could drift — inside a
`<div class="reader">` (the masthead's width and phone padding come from custom properties `.reader`
declares), with the antikythera facts (byline, site name, ~11,688 words, 9 parts, 31 sections), into a
390px viewport, and asserts:

1. `document.documentElement.scrollWidth <= 390`, and every `.facts` child's right edge is within
   the viewport;
2. no measurement is split across lines — a `Range` over each span's text has client rects on one
   line only (a span's own `getClientRects()` is one box once it is an inline-block, so it would
   prove nothing);
3. a multi-word site name longer than the column wraps at its spaces and does not overflow either;
4. **a control**: the same page with the old rule forced back (`display: inline; white-space:
   nowrap`) *does* overflow, so the fixture still exercises the bug. The test has the real
   `--font-ui` fallback stack but not Geist's package-owned `@font-face`, so this is what proves the
   fallback font has not quietly made the run fit;
5. the owner's other facts-line shape — an `AuthorNames` first span containing linked nested spans
   and a `+ 2 more` button — wraps without overflow while every following fact stays whole.

Red before the fix (1 fails), green after.

## Checks

- `npm test`, `npm run typecheck`, lint on touched files.
- Browser sweep (Sonnet subagent, Playwright): antikythera and three or four other articles with
  figures, at 390 and 1440; `scrollWidth` vs `clientWidth`, and a look at the masthead.
- GPT Sol plan review before building; code review before pushing.

## Progress

- [x] Reproduced in Chrome; root cause found by injection
- [x] Sol plan review — fix confirmed (CSS Text § 5.5); three test gaps and the long-site-name
  case taken in above
- [x] Test red (538 > 390, control and premise green), fix, test green. Mutation: with
  `display: inline` and no `nowrap` it goes red on the split check (`[2,1,1,1,2]`)
- [x] Browser sweep, table above
- [x] Sol code review ([261001e-code-review-sol.md](261001e-code-review-sol.md)): approved; it
  added the real `--font-ui` token sheet, the owner's author-list shape and a check that a long
  site name really wraps, and corrected two overclaims. Its sandbox could not launch Chrome, so I
  re-ran the test in Chrome afterwards: green, and red again (637 > 390) with `nowrap` put back.
- [x] Full `npm test`: the only reds are the five a fresh worktree always has (no `api-dist/`, no
  fleet build: `cold-start-lazy-imports`, `pdf-bundle-trace`, three `fleet-*`).
- [x] Commit, push to dev
