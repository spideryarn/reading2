# Seventh sweep: Skim's hold, two unchecked replies, and the picture flags

Up: [plans.md](../project/plans.md) ·
umbrella: [261006m](261006m-seventh-codebase-sweep-depth-umbrella.md), cluster **C10b**
(§ What the review changed: U14, U15) ·
the first half: [261007b](261007b-seventh-sweep-rewrite-hold-on-the-six-forced-verbs-without-one.md)

Three small repairs in the reader's client, one commit each. None changes a server file.

## 1. Skim's rewrite hold

**What was wrong.** *Plan it again* is a forced run beside a route already on screen. The job
leaves the list a moment before the page has read the new route, and in that moment the button was
live. Finding WCO3
([Opus](../investigations/261006d-seventh-sweep-depth-reader-client-and-per-mode-hooks-opus.md),
[Sol's review](../investigations/261006d-seventh-sweep-depth-reader-client-review-sol-on-opus.md));
Skim was the seventh of its seven, left by C10a.

**Reproduced.** A Skim row in [`tests/rewrite-hold.test.tsx`](../../tests/rewrite-hold.test.tsx),
mounting the real `SkimBand`, before any wiring: 17 failed, 10 passed.

```text
× holds every forced control while the completion GET is still in the air
  the job is done and its result has not been read: Plan it again: expected 'enabled' to be 'disabled'
× holds the forced verb synchronously before the next render
  expected [ …, … ] to have a length of 1 but got 2
```

Two clicks in one tick made two forced POSTs, as in the other six.

**The sibling copied: `useFaq` / `FaqPanel` § `run`.** `useSkim` already calls itself "`useFaq`'s
shape", and its panel's `run(label, again)` helper is the same one. The one difference is that
Skim's read is inside the hook, so `useFreshReads` sits there too (as in `useTweets`). The route's
`generatedAt` is the identity: `src/skim.ts` stamps it on every run.

**What landed.** `useSkim` returns `rewriting` and `refresh`, and hides `failed` while held. Both
places the panel draws *Plan it again* (the stale or profile-changed banner, and the status foot of
a current route) go through the one `run` helper, which now gives way to the waiting line or
disables the button. Retry and the trimmed-job release came with `useRewriteHold`; nothing in
`rewrite-hold.ts` changed. Skim is a row, and its line is gone from the guard's exclusion list.

**New reader-facing wording, for Greg to veto.** The band already calls its artefact a route
(*Nobody has planned a route…*, *Looking for the route…*), so, in the pattern of the others:

- *The new route hasn't loaded yet.*

It is drawn where FAQ draws its own, by the same component, so no layout was decided.

**How the hold and the prerequisite runs interact.** A Skim run asks for the Quotes or the Ideas
first, unforced and in the same job, when they are missing or stale.

- The hold is keyed by `(slug, "skim")` and follows the one job the press made. That job is over
  when the route is written, so the hold lasts through any Quotes or Ideas it made on the way.
  The request still forces `skim` alone.
- A held Skim does not hold a prerequisite's own forced control (*Find more* in Quotes, Regenerate
  in Ideas), and a held one of those does not hold *Plan it again*. Each has its own key.
- A press made while the Quotes or Ideas read is still loading was already kept as an intent and
  made once when they answer. The hold is taken when the request is actually made, in
  `startReady`, not at the press. In between, `starting` is true and the panel draws no button.
- The unforced `ensure` is not held. That includes *Plan the route for this* (`SkimPurpose.tsx`),
  which saves a purpose and then asks for a route the server will re-plan because the profile
  hash moved. Pressed over a held route it starts a run, but for a different purpose, so it is
  not the duplicate the hold exists for. Left as it is.

Two tests pin the first and third points
(§ *Skim: the forced run and its prerequisites*).

**Mutations, each put back afterwards** (the Skim rows, 29 tests):

| Mutation | Red |
|---|---|
| `useSkim` returns `rewriting: false` | 18 |
| `startReady` calls `queue.start` beside the hold | 17 |
| the panel's `runDisabled` is always false | 6 |
| the panel never draws the waiting line | 8 |

**What the documents got wrong.**

- The guard asserted that `useSkim.ts` is found *because of* its conditional spread. With the hold,
  the forced call is a plain `{ force: true, … }`, so that assertion proved nothing about the form
  any more and was removed; the form is still pinned by the guard's snippets.
- The exclusion's reason said Skim waited on plan 261006n's change to the same hook. Nothing in
  `useSkim.ts` had changed when this was built.
- The brief allowed one fixture field in `tests/skim-panel.test.tsx`. The interface grew two
  (`rewriting`, `refresh`), and `tests/skim-purpose-line.test.tsx` builds the same fixture, so
  both files gained both lines.
