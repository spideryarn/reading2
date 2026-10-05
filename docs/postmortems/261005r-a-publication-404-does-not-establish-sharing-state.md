# A publication 404 does not establish sharing state

Up: [postmortems.md](../project/postmortems.md).

Caught in review of `4c6f2cc5b`, which introduced the browser import-sharing controller. No
production incident was established. The [review](../plans/261005l-permalink-and-share-code-review-sol.md)
records the findings and experiments. Written by GPT Sol during that review, when three defects
were still open; **§ What was done about it**, at the end, is the implementer's, added afterwards.

The browser read metadata to decide whether a slug already had a published article. A 404
correctly answered that question. It did not answer whether an unpublished draft had already
been shared on a previous visit. Nevertheless the controller converted it into `off`, displaying
an unchecked public box over an article whose visibility was public. The confirming write had
already happened; the new controller had lost the evidence for it.

## Publication absence mistaken for visibility evidence

The root cause was using one state for two different facts: what this page's owner had requested,
and what the server currently allowed. `off` accurately described a fresh page's empty intent but
was rendered as the article's sharing state. The broader lifecycle repeated the same inference:
`dispose()` attempted a compensating private request, and forgetting the controller was treated
as enough to forget its public state. Neither a 404 nor an attempted compensation read visibility.

Another failure followed from that ownership choice: controllers belonged to add addresses, so
two equivalent addresses resolving to one slug could produce competing writers. An old private
compensation could commit after a new confirmed public write. Its answer updated nobody, leaving
the new page saying Public over a private article. The existing purpose-session retirement
barrier in `AddPage.tsx` is a sibling that already recognizes this ordering problem; sharing had
no equivalent owner for pending writes.

## Why nothing went red

The original tests drove one controller at a time and verified that a private request was sent,
not that its confirmed result remained represented after replacement. The metadata probe's
404 case was always modeled as a private new import. A remount retaining independent server
visibility, a refused compensation, and two simultaneous controllers for one slug all broke
those assumptions; the temporary review probes reproduced each mismatch.

The initial job-list test also asserted that a done import should never prompt another read.
That prevented a loop but blessed a different bug: publication could finish after the article
404 and before the first jobs list, leaving the owner permanently on Not shared. That test was
changed to check one reread, with a separate still-unreadable case proving it does not loop.

## What would have caught it, ranked by ease against value

1. **Track server state independently in lifecycle tests.** Cheap and done in the review probes:
   retain it over a reload, refuse rollback, and reverse completion order for competing writers.
   The assertion compares visible state with the transport's state, not the requested payload.
2. **Give each mutation a live owner until its result is known.** A retained retirement result
   and ordering per owner/slug prevent silent failed compensation and an older writer undoing a
   newer one. This remains required implementation work, not a completed fix.
3. **Read the fact the UI claims.** A pre-publication visibility read would establish authoritative
   initial state. It requires a server contract, so the reviewer left it untouched under the
   browser-only instruction. A browser-only alternative must explicitly represent unknown
   visibility and offer an unshare action without equating missing local consent with private.
4. **Persist the checkbox alone — rejected.** It could mask one same-tab reload but cannot prove
   server truth, coordinate another tab, or detect a refused private write. Automatically making
   the article private at mount is also rejected: opening a page is not withdrawing consent.

## The fix that is right for the long term

Separate consent for a particular owner/slug from confirmed server visibility, and serialize
visibility changes for that owner/slug across controller replacement. Surface an uncertain or
refused rollback until the owner can resolve it. Do not introduce a second API implementation or
change billing/publication rules merely to preserve a checkbox.

The two fixes applied during review are narrower: reversible pause/resume stops unsent publication
retries after unmount without undoing a confirmed public state; a parent-held owner/slug guard
permits one completed-import reread across the loading unmount. Both have regressions seen red
before fixing, and were deliberately mutated back to prove those regressions fail.

I would ask of a displayed sharing state: what server fact establishes it, and who still owns the
last write that could change it? A local intent or a sent request cannot answer either question.

## What was done about it

Added by the implementing session, 2026-10-05, after the review above. The fix went the other way
from "give each compensating write an owner": **the compensating writes were removed.**

- **No automatic take-back.** The controller sends `private` only when the reader unticks. That
  closes the unseen refusal and the old write undoing a new one, because neither write exists.
- **One controller per slug per tab**, in a module-level registry, so two add addresses for one
  slug share one writer.
- **A reload shows *unknown*, not *off*.** A `sessionStorage` mark, written before a share request
  is sent,
  makes a reloaded page say it cannot read the switch back and offer the untick. This is option 3's
  browser-only alternative, with the mark as the hint that triggers it. It is not option 4: the
  mark never draws a state as known and never sends a public request.

- **A second check found the registry had made a new stale state** (the
  [fix check](../plans/261005l-permalink-and-share-fix-check-sol.md), F16 and F17): a controller
  kept for the tab's life could say Public after Metadata had unshared, or send an old waiting
  intent over it. It now repeats its read on every return to the add page, and gives way to
  Metadata once the article has published. Same class: a remembered state shown as a server fact.

**Still open:** a second tab has no mark, so there the box is unticked over a public, unpublished
article. Closing it needs the pre-publication visibility read of option 3, a server change, put to
Greg as a question in the [plan](../plans/261005l-permalink-and-share-while-an-article-is-importing.md).

