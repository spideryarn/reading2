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

- **The search uses Metadata's synonym table** (`page-search.ts` § `METADATA_SYNONYMS`): *price*
  finds *cost*, and so on. On Profile the groups that matter (cost, price, bill) point at Plan,
  which is right, and the rest match nothing. A Profile table of its own is a prop away if a wrong
  match is ever seen. Not built.
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
