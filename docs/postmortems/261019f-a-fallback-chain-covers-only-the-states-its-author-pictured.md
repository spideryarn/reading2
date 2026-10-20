# A fallback chain covers only the states its author pictured

Greg opened his own article from `/admin/articles`
(`/read/conscious-artificial-intelligence-and-biological-spya-drhjjm`) and was told *"This document
isn't shared. If somebody sent you the link, ask them to turn sharing on for it."* He reported it as
`spya-zt7u0h` on 2026-10-19. It was his own PDF upload. Its import (job `spya-k0ytd8`) had failed
that morning on a separate bug, already fixed ([261019c](261019c-foreign-text-cleaned-for-the-noise-we-had-seen-not-for-what-the-database-can-hold.md)).
The page should have shown the failed import's card, with its reason and a Retry button. Plan
[261019n](../plans/261019n-admin-sees-other-users-articles-and-views-as-them.md).

## The root cause

Before an import publishes, the owner's own read of the article is a 404, the same as a
stranger's. `OwnerNotShared` (`src/web/article/StillBeingAdded.tsx`) exists to tell those two apart.
It looks in the owner's own job list and draws their import instead of *Not shared*. It picked the
job with a chain of fallbacks:

```
live import ?? the job this page followed ?? a completed import ?? (nothing → Not shared)
```

A failed import is reachable only through the middle link: a job this page had *followed* while it
ran, which then failed. That covers the case its author pictured: you start an import, open its
address, and watch it fail. It leaves out the other way to arrive, which is opening the address
**after** the import has already failed: from a bookmark, from the shelf the next day, or from
`/admin/articles`. That job was never live while the page was open, so nothing followed it. It is
not completed, so the chain fell through to *Not shared*, which is a sentence about somebody
else's article, said to its owner.

## The class: a fallback chain covers only the states its author pictured

Each link in a `a ?? b ?? c` chain is a state somebody thought of. The chain's last link is a
default, and the default silently absorbs every state nobody listed. Here the states are
`JobStatus`'s five, crossed with whether the page saw the job run. The chain covered four of the
ten combinations by name, and *Not shared* covered the rest. Its sibling: a `switch` with a
`default` where a `never` check belonged.

## The commit that introduced it

`2ebec5a62` (2026-10-05, plan [261005l](../plans/261005l-permalink-and-share-while-an-article-is-importing.md)).
That commit added `followed` precisely so that *a job that fails stays on screen*. It solved
failure for the one arrival path in view.

## The fix that is right for the long term

Don't enumerate statuses at all. Take **the newest import job of the slug**, by the store's own
order `(createdAt, id)`, and read its status: queued, running, failed or cancelled draws its card,
and done re-reads the article. A new status, or a new way of arriving, then has one place to be
decided, not a chain to slot into. GPT Sol's plan review showed that the first patch, a fourth link
`?? failed`, kept the class: it ranked status above recency, so after a Retry it could draw an
older failure over a newer job. Its code review closed the remaining gaps in the selector itself
([261019e](261019e-a-selector-is-only-as-current-and-total-as-its-input.md)).

## What would have caught it

1. **A test per way of arriving, not only per status.** The suite had *fails while you watch*, not
   *already failed when you arrive*. It has both now, and both were red first.
2. **Asking what the default branch says to whom.** *Not shared* is addressed to someone who is not
   the owner. A component that has just looked in the owner's own job list is the one place that
   knows it is talking to the owner, so its default should never have been that sentence.
