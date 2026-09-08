# A fixture that means "now" decays into the state it asserts against

**2026-09-08.** Two tests in `tests/fleet-web.test.tsx` began failing hours after they were written,
without anybody touching them or the code they cover. **Four separate agent sessions independently
diagnosed the second one**, each correctly, each having first checked it was not their own diff. The
defect is a class rather than an incident, it has a cheap guard, and the reason the first fix did not
find the second instance is the part worth keeping.

## What happened

Two fixture builders pinned absolute wall-clock instants:

```ts
state()         →  collectedAt:  new Date("2026-09-08T12:00:00Z")
messagesWire()  →  lastModified: new Date("2026-09-08T11:59:30Z")
```

Both meant *just now* on the morning they were written. Both are compared by the component against
the **real** `Date.now()`, against a threshold:

- `collectedAt` crossed the snapshot staleness threshold (2m 30s) at **12:02:30Z**. Three rendering
  tests then asserted the page would not say `STALE` about a page that had correctly begun to say
  `STALE`.
- `lastModified` crossed `STALE_TRANSCRIPT_MS` (30 minutes) at about **12:30Z**. The test
  `does not warn when the transcript is being written` then asserted the absence of a warning the
  page was correctly showing, against a transcript the fixture claimed was 1h 45m old.

In both cases **the test was right about the page and wrong about the clock**. Or, as
`w2-usage-limits` put it: *"the assertion is measuring how long ago you wrote the test."*

## The root cause, named

**Freshness is a relation between two times, and an absolute constant can only ever be one of them.**
A fixture whose meaning is *fresh* has to be computed from the clock the component reads. Put the
other way round, from the same session: **an instant belongs in a field; a relative claim computed
against an absolute fixture is that rule inverted.**

This is not a flake. Re-running proves nothing, it only ever gets worse, and the obvious repair —
editing the date — buys a few hours and hides the class. `w2-harness-adapter`: *"it will 'fix itself'
confusingly if anyone edits the date."*

## Why the first fix did not find the second

This is the interesting half, and it generalises past this bug.

`collectedAt` was fixed at 13:07Z (`3df3e833`) without looking for siblings. At that moment
`lastModified` had *also* already crossed its threshold — but the suite had not been run against it
since, so it presented as nothing at all.

> **A time bomb with a later fuse is indistinguishable from correct code.**
>
> — `w2-usage-limits`, 2026-09-08

So *fix the failure* and *fix the class* come apart exactly here. The only thing that finds the
second instance is going looking for it after the first: the
[rename-or-move.md](../reusable/rename-or-move.md) sweep discipline applied to a bug rather than to
an identifier. Nothing about the first repair suggests a second exists.

**Cost of not doing that sweep:** four sessions each spent a message and a diagnosis on an
already-fixed defect, in the two hours between the two fixes.

## The fix

Both defaults are computed from `Date.now()`. The tests that want an *old* snapshot pass both times
explicitly and are untouched. The sibling test that wants "hours ago" was made relative too — anchored
it happens to keep passing, but by accident rather than by construction, and the pair should say the
same thing.

## What would have caught it, and what deliberately would not

**The guard is a test about the test data**, which is an unusual angle and the transferable part:

```
the fixtures' own clock > means NOW where a fixture means 'fresh'
```

It asserts both defaults are within a minute of `Date.now()`. Mutation-checked by putting each
original literal back: both turn it red. Somebody who types a readable date into one of those
defaults now gets a red suite in seconds, rather than a puzzling failure hours later in a branch that
has nothing to do with it.

**It deliberately does not police every date in the file.** Twelve others were checked by hand:
`startedAt` feeds uptime and the sort comparators, and a turn's `at` is rendered verbatim — none has
a threshold to cross, so pinning those is correct. A guard that fires on things that are fine gets
disabled, which is the same failure as
[260908b](260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md)'s rejected `knip` sweep
(162 findings, none of them the sixteen) and the same failure as this dashboard drawing *"waiting?
unknown"* on 29 of 32 rows. **A warning nobody can not-see stops being read.**

## The class, and where else it lives

Any fixture that encodes a wall-clock instant and is read by code that compares against `Date.now()`
with a threshold. The signature to reach for: **a test that passes locally in the morning, fails in
the afternoon, and is untouched by the diff that "broke" it.**

The general rule for this repo is the one the fleet dashboard keeps arriving at from every direction:
**a value's honesty is only worth having if the thing that reads it is held to it.** Here the
producer (the component) was honest about staleness and the consumer (the assertion) had encoded a
belief about the clock that nothing checked.

## Four shapes of a green test that proves nothing, found in one day

This is one of four, and they are worth listing together because the family is what makes them
expensive rather than any one of them. **The common property is that the check and the thing it
checks share an assumption** — which is
[silent-success.md](../reusable/silent-success.md)'s subject, and the reason that note is worth
re-reading rather than this section restating it.

1. **Green when written, red later.** This postmortem. A fixture that encodes an instant decays into
   the state it asserts against. *A time bomb with a later fuse is indistinguishable from correct
   code.*
2. **Green because the test never reaches the thing.** Fixing the browser dropping `delivery` from a
   steer refusal, five tests passed — and passed again with the one line that reads the field
   deleted, because every one of them built the outcome by hand and handed it to the renderer. Tested
   parts, untested join, in the commit fixing a tested part with an untested join. `makeSteerApi` had
   no test caller anywhere in the repo. The same day, `w2-fleet-dictation`'s flood test never reached
   the burst ceiling it claimed to prove, because a per-key floor refused all twelve requests first.
3. **Green in isolation, red in the suite, and the failure lands on the innocent file.**
   `tests/fixture-ids.test.ts` catching `fleet-pause.test.ts` sharing two uuids with files that
   insert them: whichever tears down first deletes the other's fixture. `w2-fleet-dictation`, who
   found it: *"the signal points away from the cause, so whoever investigates starts in the wrong
   file and finds nothing wrong there — because there is nothing wrong there."*
4. **Green by construction, which is the worst of the four.** The first three are green by accident.
   This one is a *fix* that works by becoming invisible to the check. The first repair attempted for
   (3) used uuids with a memorable prefix containing `p` and `s`; the guard matches `[0-9a-f]{8}`, so
   it would not have seen them at all. The suite would have gone green and the collision would have
   remained. Caught before the edit landed, and only because the ids were re-read for hex.

   `w2-fleet-dictation` hit the same shape from the other side: a response fake that silently absorbed
   writes-after-close — **the exact thing it existed to detect**. *A fake that absorbs the thing under
   test is worse than no fake.*

**The check that separates all four from a real pass is the same one:** watch it fail. Every fix in
this postmortem and the four above was mutation-checked — the original defect put back, the suite run,
the file restored byte-identical. A check nobody has watched fail is not evidence.
