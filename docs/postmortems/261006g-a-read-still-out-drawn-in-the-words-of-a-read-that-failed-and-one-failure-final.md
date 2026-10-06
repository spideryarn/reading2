# A read still out, drawn in the words of a read that failed, and one failure final

Queue items qi-kynm6gzc and qi-jpqg6r3b, 2026-10-06. The fix and its evidence are in
[261006e](../plans/261006e-access-and-sharing-says-checking-while-it-asks-and-asks-again-after-a-failed-read.md).

## What a reader saw

On the Metadata page, Access & sharing said *"We could not check who can read this, so nothing is
offered here — reload the page to try again"*: for a second or so on every load, and on four
articles for minutes after an import finished, until a reload.

## The real root cause

The page holds its one read as `provenance: ArticleMetadata | null` beside `provenanceError`.
`null` is true before the request lands and after it fails. The sharing card was handed only the
parsed `sharing`, which is `undefined` in both cases, and it had one state for `undefined`: the
failure sentence. So the card could not say *still asking*, and said *failed* instead.

The second half is separate and worse. The read ran when the slug changed and at no other time.
Nothing on the page asked again, so any one failure was the page's answer for as long as the tab
stayed open. The sentence told the reader to reload, which was correct, and was the only way out.

Which request failed on the four articles is not known. A real import, watched with every
`/api/metadata` response logged, got a 200; the stuck state was reproduced only by failing the
first read on purpose. Two things in that run make a real failure easy to believe: the endpoint
answers 404 until the import job has written its first artefacts, and the sighting was on a box
that was also running the whole suite. The queue's own guess, that the read fails on a stand-in
tree, was wrong: that read answered 200.

## The class, named

**A tri-state passed through a two-state door.** The page knew *asking / failed / known*. The
prop it handed down could carry *known / not known*, so the component on the other side had to pick
one sentence for two different facts, and picked the alarming one.

Its neighbour is **a first read with no second chance**: a page whose only trigger for a read is
arriving, on a server where the thing being read is still being written.

## The commit that introduced it

`39761ad21`, 2026-08-28, which gave the card its `UNREAD` state so that a failed fetch stopped
hiding the whole section. That was a real fix for a real bug, and it is why the state is worded as
a failure. The loading case was already flowing through the same `undefined` and inherited the
words. Imports that open the article while it is still being written (plans 261005j and 261005l)
did not cause it; they made the window in which a first read can fail one a reader stands in.

## Where the checks were

`tests/metadata-sharing-card.test.tsx` had a test for a failed read and one for a read without a
sharing block. Both asserted the failure sentence, and both were right. No test held a response
open, so nothing ever rendered the loading state long enough to read it. Its siblings on the same
page were already correct: `AboutYou`, the comments row (`Questions`) and `DeletePermanently` each
take `failed`, or `known` and `failed`, as well as the value. The card was given the value alone.

## The fix that is right for the long term

What shipped: the card takes `checking`, with its own sentence, and a failed first read is asked
again four times over about fifty seconds.

What would be better, and was not done: one type for *a read* (`asking | failed | known`) handed
whole to every section of the page, instead of a value and one or two booleans chosen per section.
With that, a section that forgot a case would not compile. It is a rewrite of how the Metadata page
passes its read to about ten components, and this fix did not need it.

## What would have caught the class, ranked by ease against value

1. **A test that holds the response open** for any component with a "could not" sentence. One
   promise in the fetch stub. Done for this card. It turns "what does this draw while waiting" from
   something nobody looks at into an assertion.
2. **When a prop can be absent for two reasons, pass the reason.** A habit, and the page's other
   sections already follow it. It would have prevented the first half outright.
3. **Ask of any page that reads once: what if that read fails while the thing is still being
   written?** Since 261005j an article is on screen before its import is done, so "the read
   happens after the write" is no longer true anywhere in the reading view.
4. A shared retry inside `useOrderedRead` for every artefact read. Rejected for now: most of its
   callers refresh on a job finishing, and a retry there would need to know which failures are
   worth repeating. One page needed it; one page has it.
