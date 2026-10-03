# Profile gets the contents list and search box

Up: [plans.md](../project/plans.md)

Queue item `qi-fnypfagn`. The second half of feedback report `spya-ka3cau`, which
[261003k](261003k-feedback-screenshot-shrinks-to-fit-and-profile-sections-collapse.md) left as a
question. That plan made Profile's sections fold like Metadata's and asked whether Profile should
also get Metadata's left-hand contents list. Greg's answer, relayed by the Overseer:

> Q-profile-contents-list I don't understand the question. Probably B
>
> — Greg, 2026-10-03

B is: at desktop width, a column on the left lists Profile's six sections with a search box above
it. Clicking one opens it (if it is shut) and scrolls to it. It is hidden on an iPad in portrait
and on a phone, as on Metadata.

## What we will do

The list is already a shared component. [`src/web/PageContents.tsx`](../../src/web/PageContents.tsx)
takes the page's container and reads its `[data-section]` elements, and Profile's sections have
carried those, and their `keywords`, since 261003k. So:

1. **Mount `<PageContents>` on `/profile`**, pointed at the page's `<main>`.
2. **Share the margin class.** The list is fixed in the left margin, and its page has to step its
   column right between 1024px and 1152px so the list does not sit on the text. Metadata does that
   with one long class written inline. It moves to a named constant, `CONTENTS_MARGIN`, exported
   from `PageContents.tsx`, and both pages use it. Two copies of that arithmetic would drift.

Nothing else changes: the same search, the same open-scroll-flash, the same breakpoint.

## What it costs, and what is left as it is

- **The search uses Profile's billing synonym table** (`ProfilePage.tsx` § `PROFILE_SYNONYMS`):
  *bill* and *usage* find *Plan*. Code review caught wrong matches with the original Metadata
  default: *archived articles* and *font size* found *Recently read*, while *hide experimental
  features* found nothing. Metadata's archive/hide/shelf and size/count groups gave those words
  an article-specific meaning. `PageContents` now accepts a page's own table, keeping Metadata's
  default for callers that omit it.
- **Profile keeps the corner wordmark** (Metadata's is in its dock). The wordmark is at the top of
  the left corner and the list starts 6rem down. The browser check looks at whether they touch.
- Between 1024px and 1152px wide the Profile column sits up to 4rem right of centre, as
  Metadata's does.

## The simpler option passed over

Leave it off, which was 261003k's recommendation: six headings on about one screen. Greg chose
otherwise. A copy of the list written for Profile was never an option; the component is shared.

## Done looks like

- A test, red first, in `tests/profile-sections-collapsed.test.tsx`: the page has a nav listing
  its six sections in order; pressing *What's running* there opens that section; typing *dark
  mode* in the search box leaves *Settings* and Enter opens it.
- Metadata's tests pass unchanged.
- A browser check by a Sonnet subagent at 1440, 820 and 390 wide.
- `reader-profile.md` § The page's six sections says the list is there; the feedback note carries
  Greg's answer.
- A GPT Sol review of the code.

## What landed

Built as planned, in two commits: the mount and the shared `CONTENTS_MARGIN`, then the review's fix.

**GPT Sol's code review, 2026-10-03: ship with changes.** One finding, P2, fixed by the reviewer
and red first: Metadata's synonym table gave three wrong answers on Profile (quoted above under
*What it costs*). `PageContents` takes an optional `synonyms` and Profile passes its own. It also
checked the built CSS still contains the margin rule now that the class is a constant, and made the
margin test name the class rather than only compare the page with the constant.

**Left as it is:** *which model* lists *About you* above *What's running*, because both carry
*model* as a keyword. Both are shown; only the order is arguable.

**The browser check** (Sonnet, Playwright; 1440, 1100, 820 and 390 wide) passed every item. At
1440 the list is at x 24 to 200 and the page's text starts at 353; the wordmark ends 52px above it.
At 1100, the tightest width, the text starts at 216, a 16px gap. At 820 and 390 the list is not
drawn and the page is not shifted. Click, search, Enter and Escape behave as on Metadata, whose own
list is unchanged. No console errors. It ran before the review's synonym fix, which changes no
layout.
