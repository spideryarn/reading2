# Second review: the client half, after your three blockers

You reviewed this code and returned **BLOCKED** with three blockers and six further findings. All
three blockers are fixed, and findings 4, 5 and 6 with them. This is the second pass.

Your own review is at `docs/plans/260828af-public-read-only-stage1b-review-sol.md` — read it first, then the
current code at HEAD. `docs/plans/260827ai-public-read-only-access.md` is the plan; Greg's eight decisions are
settled and not up for review.

## What changed since your first pass

- **Blocker 1** — `useArticleAccess` is keyed on the reader id, and the comparison is made **during
  render** rather than in an effect, because an effect is a render too late. The test changes
  identity inside the same mounted root; remounting rebuilds the state that holds the stale answer,
  so a test written that way passes against the bug.
- **Blocker 2** — `useLinkFacts` is behind a render-prop component boundary, so it is genuinely not
  called for a visitor. Not a prop-supplied hook: that would change the number of hooks a component
  calls when the prop changes.
- **Blocker 3** — known / pending / unknown, with unknown split by whether we asked. A failed
  **write** now says it may have taken effect, because the route writes and then reads back, so every
  failure after the write leaves the write standing. The response is validated rather than cast —
  `readJson` returns `{}` for a 204, so an unparseable success was coming out `private`.
- **4** — the Access & Sharing card renders its unknown state when metadata fails, instead of
  vanishing. Hidden only for a known fixture.
- **5** — `useArticleRename` is inside an owner-only component rather than gated by `offer={false}`.
- **6** — a fifth state, `availability-unknown`, worded so it claims only the half we know. Tweets
  derives from `available.tweets`. Unavailable tools use ownership-neutral wording that stays true
  when stage 3 lets a second reader hold the same document.

**In flight and not yet done:** your finding 8 (the per-file test mutations) and finding 9
(`publicFetch` checking an unnormalised string). Do not spend findings on those two; they are being
worked now.

## The one question I most want answered

Your three blockers all came from one place: **the seam is right in the components its author was
thinking about, and leaks in the ones they were not.** `ProseHoverCard` is the case — a carefully
built capability union, and four lines below it a component that mounts an authenticated fetch on
hover.

So the question is not *is the seam right*. It is:

> **Which components does a visitor mount that nobody has named?**

Enumerate what a visitor actually renders — everything reachable from `Reader`, from `ArticlePage`'s
visitor arm, and from the two public stand-in pages — and for each, say what it fetches, on mount and
on interaction: hover, focus, click, keyboard, scroll, resize, timer, retry, error boundary, suspense
fallback, or a state the tests never enter. Name any that can issue a request outside `/api/public/`,
any POST at all, and any request to a third party.

Treat *third party* as in scope: the hover path was reaching Wikipedia as well as `/api/library`, and
a visitor's reading being reported to an outside host is its own problem even when it costs us
nothing.

## Also worth your attention

1. **Does the fifth state hold apart from the fourth**, or can *availability unknown* and *not carried
   yet* be produced by the same condition?
2. **The sharing card's known/pending/unknown model** — any remaining path where a failed or slow
   write is drawn as a confident claim about visibility.
3. **The reader-identity fix** — any remaining render, cache or route transition where one reader's
   article can appear for another.
4. **Anything the plan, the briefs, the browser pass or your first review missed.**

## The state of the tree, measured

- `npm run typecheck`: clean across all three projects.
- `npm test`: the failures are other lanes' suites under database contention; they pass in isolation.
- A browser pass found four silent gaps, all fixed; see the plan § The browser pass.
- Other agents have uncommitted work here. Anything outside `src/web/`, `src/messages.ts` and the
  client test files is not this review's business.

Numbered findings, each with a severity — **blocker / should-fix / consider** — file and line, and a
concrete change. If it is now clean, say so plainly rather than finding something to say.
