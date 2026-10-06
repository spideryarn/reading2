# Reader switch guards must outlive the auth branches they guard

Up: [postmortems.md](../project/postmortems.md)

Review of [261006h](../plans/261006h-browser-storage-keyed-by-reader-and-the-feedback-switch-test.md),
2026-10-06, reproduced reader A's article position becoming reader B's saved position after
A signs out and B signs in while another tab stays open. This is a cross-reader exposure and
can overwrite B's existing saved view. There is no evidence it reached a reader; the reproduction
uses the real app wiring in jsdom, without a database or browser session.

## What happened

At `/read/x?mode=quotes&at=spya-k3m9qt`, A's view is saved under A's new reader key. A
`SIGNED_OUT` notification leaves that query string in place. `SIGNED_IN` for B then leaves B
at A's view and saves it under B's key, even when B already has `?mode=timeline` saved.

The red run of [last-view-app-reader-change.test.tsx](../../tests/last-view-app-reader-change.test.tsx)
had **two failures and one passing control**:

```text
sign-out must remove A's article state: expected '?mode=quotes&at=spya-k3m9qt' to be ''
expected '?mode=quotes&at=spya-k3m9qt' to be '?mode=timeline'
```

## The class: a transition guard loses its history at the transition it guards

The address belongs to the tab and survives a remount. The identity used to decide whether that
address belongs to the current reader was held by `useLastView` inside `ArticlePage`, which does
not survive the signed-in/signed-out branch change in `App`. A new instance forgets A while the
address still remembers A. It therefore treats A's address as a link B chose.

With `arrivedFor` reset to `null`, the reader-change rewrite never runs. The ordinary
explicit-link rule suppresses both restoration and the first-open default. The save then faithfully
copies the wrong reader's address into the correctly named key. Keying persisted records closes
neither ownership of the live address nor ownership of the guard's history.

`git log -S'useLastView'` and `git blame` identify **`a626d45e7`**, the stage 1 commit, as the
introduction of the incomplete reader-switch protection and the reader-specific destination for
the contaminated save. Its commit message claims readers no longer read each other's records.
The prior unkeyed store already mixed readers; this commit's new claim and switch handling left
the normal sign-out/sign-in path open.

There is a sibling with the correct lifetime already in the tree:
[add-visit.ts](../../src/web/add-visit.ts) keeps an add visit's identity in `App`, above its auth
branches. The same boundary had been understood for an action that must not restart for B.

## Why nothing went red

[last-view-change-of-reader.test.tsx](../../tests/last-view-change-of-reader.test.tsx) changes
`readerId` on one persistent test component. It proves direct A-to-B changes work when the guard
survives, but replaces the app's remount boundary with the lifetime the implementation needs.
The fresh-mount cases start at a bare address or a deliberately supplied link, so they never ask
who left the surviving address behind. Storage tests cannot distinguish those origins either.

## What would have caught it, ranked by ease against value

1. **Drive auth transitions through the real owner of the routing branches.** Cheap and added in
   this review: keep the address open across A → signed out → B, assert both the address and each
   reader's stored record, and include an existing B record. The test was seen red before the fix.
2. **Give transition history an owner that survives every tested transition.** A small code change:
   move the last-view lifetime to `App`, above its auth branches. Leaving the article must still
   end that article arrival so an explicit link opened later remains authoritative.
3. **A browser-only regression suite** — rejected as the primary guard. It costs more to run and
   needs accounts and services; the failing boundary is React's real routing/auth composition and
   can be exercised without them. Browser testing remains useful corroboration.
4. **Clear all browser storage on sign-out** — rejected. It destroys both readers' saved places
   and does not establish who owns the live address.

## The fix that is right for the long term

Keep the tab's article-arrival identity above the auth branches in `App`; the same hook can retain
the existing restoration, first-open and save rules. Outside an article it advances identity without
reading or writing an article record. This closes the remount path as well as direct A-to-B changes
while preserving explicit links opened after leaving the article. The review fix takes this shape;
there is no separate temporary patch.
