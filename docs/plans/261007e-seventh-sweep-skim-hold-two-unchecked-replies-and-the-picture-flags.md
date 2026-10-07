# Seventh sweep: Skim's hold, two unchecked replies, and the picture flags

Up: [plans.md](../project/plans.md) ·
umbrella: [261006m](261006m-seventh-codebase-sweep-depth-umbrella.md), cluster **C10b**
(§ What the review changed: U14, U15) ·
the first half: [261007b](261007b-seventh-sweep-rewrite-hold-on-the-six-forced-verbs-without-one.md)

Three small repairs in the reader's client, one commit each. None changes a server file.

(This file was `261007d-…` for its first two commits, whose messages say so. Another plan took
that letter on `dev` the same hour, so it moved to `e`.)

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
  when it finishes, fails or is stopped, so the hold lasts through any Quotes or Ideas it makes
  on the way and uses the same release rules if a prerequisite fails.
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

Tests pin the whole job and the deferred press, including failure and cancellation before Skim writes
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

## 2. Thread and Skim check a reply before publishing it (WCO4)

**What was wrong.** `readJson<T>` parses and checks no shape (an empty 200 is `{}`). `useTweets`
queued `setLoaded(found)` and only then touched `found.thread`; `useSkim` set five pieces of state
straight from the reply. Nine sibling hooks refuse a reply without its artefact by throwing
`MalformedReply` first.

**Reproduced.** New rows in
[`tests/read-error-matrix.test.tsx`](../../tests/read-error-matrix.test.tsx) §
*a reply is checked before it is published*, driving the two real hooks: 25 red before the fix.
Sol's two probes are among them (Thread after `null` lost its thread; Skim after `{}` ended
`ready` with `undefined` for a route), and so is one the review did not pose: a malformed reply's
`stale: true` was published beside the old route.

**What landed.** In both hooks the reply is read, checked and only then published:

- a 404 **or a `200 null`** is "none yet" (U15). Neither route sends `null` today; the test holds
  the two answers to the same outcome, including Thread's start-on-arrival;
- Thread asks for a `thread` that is an object; Skim asks for a `skim` that is an object with a
  `stops` list;
- anything else throws `MalformedReply` into the catch each hook already had, so the accepted
  answer and its flags stay. Skim then says `PAGE_FAULT`, as the nine do. Thread says its own
  re-read sentence (`THREAD_RECHECK_FAILED`) when it has a thread, which is what it already said
  for every failed re-read, and `PAGE_FAULT` on an opening read.

**The retreat rule: no real envelope is refused.** Each check asks only for what the server
already requires before answering 200. `loadTweets` (`src/store/pg.ts`) answers 404 unless the
stored thread is truthy; `loadSkim` answers 404 unless `skim.stops` is an array; the routes add the
flags (`src/routes.ts`). The two threads stored in the fixture corpus (`writes`, `noema-…`) are
wrapped as the route wraps them and are accepted (§ *every thread stored in the fixture corpus*).
**Not sampled when this was built:** the corpus holds no Skim route, and no stored row in any
database had been read, so for Skim the argument was the route's code alone. The local database
has been sampled since (§ Review status). One gap in it: a stored thread that is truthy and
not an object (a string) would pass the server and be refused here. The stage writes objects only.

The flags and `notOnRoute` are not type-checked, as in the nine: a reply with a route and no
`stale` reads as not stale.

**Mutations, each put back** (84 tests in the file):

| Mutation | Red |
|---|---|
| Skim: no check | 11 |
| Skim: refuse only an absent `skim` | 3 |
| Skim: `stops` not asked for | 2 |
| Skim: `null` is not absence | 1 |
| Thread: no check | 7 |
| Thread: refuse only an absent `thread` | 3 |
| Thread: `null` is not absence | 1 |

**A hole in these tests, initially closed by the typecheck and not by them.** With `MalformedReply` not
imported, the throw was a `ReferenceError` and every row still passed, because any thrown thing
lands in the same catch. `npm run typecheck` is what refused it. The code review added assertions
for the actual `MalformedReply` in the catch's diagnostic: removing both imports still passed
the original 26 rows, then failed 24 malformed-reply rows with those assertions (the two absence
rows still passed).

**What the documents got wrong.**

- Sol's probe reads as if Thread after `null` should keep its thread. Under U15 a `200 null` is
  absence, so it takes the thread away exactly as a 404 does; the cases that keep it are `{}` and
  a reply whose `thread` is `null`.
- The brief's "surface the failure the way the nine do" fits Skim. Thread already had a sentence
  of its own for a failed re-read and keeps it.

## 3. A picture's flags go with the picture

**What was wrong.** `useSketch` and `useIllustrated` each have two ways to `none`: a 404, and a
reply whose stored value the checker keeps nothing of (no scene; no plate). The second cleared the
picture and its identity, kept the checker's `faults`, and did not reset `stale`, `outdated`,
`profiled` or `profileChanged`. So after a flagged picture, the hook said "no picture" and
"stale, outdated, written for a profile that has changed" at once. Found by the read-type spike
([261006n](261006n-one-type-for-a-read-spiked-on-useideas.md)) and confirmed by GPT Sol.

**Reproduced.** A transition test per hook in
[`tests/read-error-matrix.test.tsx`](../../tests/read-error-matrix.test.tsx) §
*a checked-empty answer carries none of the last picture's flags*: flagged picture, then a stored
value with nothing drawable, then a fresh picture. Red on both before the fix: all four flags
still true beside `status: "none"`.

**Fixed by grouping, in both hooks.** As `useIdeas` now holds its list and flags in one
`IdeasAnswer | null`, each picture hook holds one nullable value: the checked picture, the stored
value's identity for the hold, and the four flags. "No picture" is that value being null, so it
has nowhere to carry a flag. `faults` stays its own state, and the checked-empty branch still
keeps it. Status, error, `useOrderedRead`, the `FreshReads` calls and the returned interface are
unchanged; no consumer changed. The minimal repair (four resets in the branch) was not needed in
either hook: the identity was already set and cleared in step with the picture, so putting it in
the same value disturbed nothing about the hold (`tests/rewrite-hold.test.tsx`, both rows and
their Retry seam, green).

**What a reader could have seen: nothing.** Both views return their empty state as soon as
`status` is `none`, and that branch reads none of the four flags. `SketchView` reads `stale`,
`profiled` and `profileChanged` only below its `if (!view.sketch) return null`; `IllustratedView`
reads `stale` and `profileChanged` only below its own, and in `PaintAgain`, which is drawn beside
a painting. Inside `useIllustrated`, `regenerate` reads `profileChanged` to decide whether to
draw the Sketch first, and nothing calls `regenerate` with no painting. So this was a wrong
answer from the hook that no caller asked for, and the fix is for the next caller.

**Mutations, each put back** (90 tests in the file), the same five in each hook:

| Mutation | Red |
|---|---|
| the checked-empty branch does not clear the value | 1 |
| the checked-empty branch drops the faults | 1 |
| a 404 keeps the faults | 1 (0 at first: see below) |
| a failed re-read clears the value | 2 |
| a returned flag is a constant `false` | 2 |

*A 404 keeps the faults* survived the first version of its test, in both hooks: the flagged
picture had no faults, so there was nothing for the 404 to fail to clear. The test now goes
through the checked-empty answer first.

**What the documents got wrong.** Nothing in substance. The brief's "Illustrated's second none
branch" and "Sketch's empty-scenes branch" are as described.

## Review status

GPT Sol reviewed the three commits
([answer](261007e-seventh-sweep-skim-hold-two-unchecked-replies-and-the-picture-flags-code-review-sol.md),
[prompt](261007e-seventh-sweep-skim-hold-two-unchecked-replies-and-the-picture-flags-code-review-prompt.md)).
**Verdict: ship with these fixes applied**, and no further behavioural defect found. Its fixes
landed as one commit after being checked independently:

- **C1 (P2), fixed.** The malformed-reply rows passed with a `ReferenceError` in place of the
  authored failure. They now assert that what the catch logged is a `MalformedReply`. Checked
  again here: with the import removed from `useSkim.ts`, 12 of the file's 94 tests fail (all
  Skim's malformed rows); from `useTweets.ts`, the 12 Thread rows.
- **C2 (P3), fixed.** The comment and the docs said Skim's job is over "when the route is
  written". It is over when it finishes, fails or is stopped. The wording is corrected in
  `useSkim.ts`, [skim.md](../project/skim.md) and § 1 above, and six lifecycle cases were added
  (Quotes or Ideas fails; is stopped; succeeds and then Skim is refused; each with the completion
  GET never answered). Checked here: with `ended` made to ignore a job whose `skim` step never
  started, the four fail-and-stop cases go red (`expected 'disabled' to be 'enabled'`); the two
  refused cases stay green, as that mutation does not touch them.
- **C3 (P3), comment only.** `useTweets.ts` said no reply the server sends fails the check. A
  stored thread that is truthy and not an object would pass `loadTweets` and be refused by the
  client. The comment now says so; the check is unchanged.

`useSkim.ts` and `useTweets.ts` differ from the builder's commits in comments only. One thing was
changed in the review answer itself: its six file links were written from the repository root and
failed `tests/doc-links.test.ts`, so they are now relative.

**Stored artefacts, sampled after the review** (the local database, counts only, read-only; not
production). For Skim the check is: the stored value is a JSON object whose `stops` is an array.

| Stored in `article_revisions` | Found | Pass | Fail |
|---|---:|---:|---:|
| Skim routes, the 50 sampled (current revisions first) | 50 | 50 | 0 |
| Skim routes, every stored one | 222 | 222 | 0 |
| Threads, every stored one | 395 | 395 | 0 |

So no stored reply would be refused. Of these, 40 routes and 52 threads are on an article's
current revision, which is the only one the routes serve. These are a development database's rows; production was
not read.

**The one new reader-facing sentence, for Greg to veto:** *The new route hasn't loaded yet.*

## Left

- **The command bar's *Run again* row** still bypasses every hold, Skim's now included. Known,
  pinned by a test, P1 by Sol's grading, not this cluster's.
- ***Plan the route for this* over a held route** starts an unforced run for a different reading
  purpose (§ 1). Judged a legitimately different request, and left.
- **A stored thread that is truthy and not an object** would pass the server and be refused by
  the client (C3). None observed, in the corpus or in the local database.
- **No browser pass.**
