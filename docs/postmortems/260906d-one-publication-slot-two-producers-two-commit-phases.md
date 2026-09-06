# One publication slot, two producers, two commit phases

**2026-09-06**, found while planning
[A3](../plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md#referees-two-sub-modes-share-one-slot-a-real-bug-and-it-goes-both-ways)
and fixed in its stage 4a. Referee's two sub-modes, `CriteriaBand` and `ClaimsBand`, are siblings
inside `RefereeSubMode` that both write `Reader`'s single `refereeFound`. Both published their marks
in a `useLayoutEffect` and cleared them in a passive `useEffect`. React destroys a deleted subtree's
**passive** effects in the passive phase of the commit that deleted it — *after* the layout phase in
which the incoming sibling published. So changing `?referee=` ran the arriving producer's publication
first and the departing producer's goodbye second, and the arriving producer's marks were overwritten
by a clear that belonged to the mode you had just left.

**Nothing reached a reader**, and the reason is worth more than the defect. See
[What a reader would actually have seen](#what-a-reader-would-actually-have-seen): both of these
bands publish an *empty* list on their first commit, so the stale clear overwrote empty with empty
and the settled state came out right by luck. This is written up as a latent defect with a live
class, not as an incident.

## The class: **one publication slot shared by two producers whose publish and clear run in different commit phases**

Not "a missing cleanup" and not "an effect ordering bug". The three parts are all load-bearing:

1. **One slot, two writers.** `Reader` keeps *five* `Found[]` slots precisely so that a mode on its
   way out cannot erase the marks of the mode arriving — an ownership requirement with a written
   history (`App.tsx` § `ideaFound`, [260826ac](../plans/260826ac-ideas-mode.md)). The five slots are
   one per *mode*. Referee's two sub-modes are one level below that, where the separation does not
   reach.
2. **A hand-over inside one commit.** The two producers are different component types in the same
   position, so React deletes one and mounts the other in a single commit rather than in two.
3. **Publish and clear in different phases.** Layout publish, passive clear. Within one commit that
   ordering is fixed and it is the wrong way round.

Take any one away and there is no bug. Two producers that never share a slot are safe with either
phase; two that swap across two commits are safe because React flushes the pending passive effects
before the next commit; and two whose clear is a layout cleanup are safe because React destroys
layout effects in the mutation phase, before it runs the incoming sibling's layout effect.

**Where else this class can bite**, checked rather than assumed: GPT Sol established that Criteria
and Claims are the only pair that can hand one slot over during a mounted `Reader`'s lifetime. Owner
and visitor twins share a named slot, but changing access swaps `OwnedArticle` for `VisitorArticle`
and unmounts the whole `Reader`. So the census is closed for today — and the guard added below is
what keeps it closed when a sixth sub-mode or a second slot-sharing pair arrives.

## The second class, and the more transferable one: **a development-mode double-render that hides the defect the test was written to catch**

The plan's first draft required the reproduction to be red **under StrictMode**. It would not have
been. Under StrictMode React simulates a remount of the newly mounted tree, and that simulated
remount **republishes the incoming producer after the outgoing clear**:

```text
claims layout publish
criteria passive clear
claims passive clear
claims layout publish     ← the simulated remount, which repairs the damage
settled DOM claims        ← green, against broken code
```

Non-StrictMode, the same commit:

```text
claims layout publish
criteria passive clear
settled DOM empty         ← red
```

Measured by GPT Sol in a React 19.2.8 probe
([260906c-plan-review-sol-2.md § F9](../plans/260906c-plan-review-sol-2.md)), and reproduced here:
in the very run that made
[`tests/passage-slot-hand-off.test.tsx`](../../tests/passage-slot-hand-off.test.tsx) go red in both
directions, its StrictMode case was **green against the same broken code**.

This is a nastier shape than an ordinary missed assertion, because StrictMode is *advice we followed*.
It exists to surface effect bugs, so reaching for it while writing a test about effect ordering is
the obvious move and the correct instinct — and here it does the exact opposite of what it is for.
Anything that makes development re-run your code (StrictMode's double-invoke, a retry, an
auto-refetch, a dev-only remount) can also **repair** the state a test is about, and then the test is
measuring the repair.

The rule that falls out: **a development-mode behaviour may never be present in the run that proves
the defect exists.** It is a regression variant afterwards, run only against the fixed code, and the
test has to say so or somebody will "improve" the file later by wrapping it.

## What a reader would actually have seen

Nothing, today — and finding that out took a measurement rather than a reading.

The plan asserted the marks were lost in the shipped app. They were not, because the loss needs the
*incoming* producer to publish something non-empty in the layout phase of the swap commit, and
neither referee band does: `CriteriaBand`'s marks come from `useCriteria`'s fetch and are `[]` at
mount, and `ClaimsBand`'s come from a tick the referee has not made yet. Mounting the real bands over
a stubbed `apiFetch` and swapping them in both directions produced the right settled state every
time, and no intermediate commit a test could see was wrong either.

So the honest account is: **a live class, a latent instance.** It becomes a lost-marks bug the moment
a slot-sharing producer has something to say on its first commit — a cached artefact, a default-on
selection, or marks derived from the URL, which is not hypothetical: `SearchBand` publishes
`findLiteral` marks synchronously from `?find=` on its very first commit, and it shares a slot with
nothing only by today's arrangement.

Two things follow for how this was tested. The red proof uses two stand-in producers built on the
shipped hook and driven by props, because the real bands cannot express the precondition; and
[`tests/passage-mode-cleanup.test.tsx`](../../tests/passage-mode-cleanup.test.tsx) carries the
real-band sub-mode hand-off in both directions as a settled-state regression guard, with a comment
saying in as many words that it passed before the fix and why.

## Which commit introduced it

**`9b636cc1`, 2026-09-01** — *"Three empty states, because two of them were the same lie told
twice"*, the commit that added `src/web/ClaimsPanel.tsx` with
`useLayoutEffect(() => onFound(found), [found, onFound])` and a passive unmount clear, beside
`CriteriaBand`, which had had that same pair since `b9f1d2a5` earlier the same day. Neither half
was wrong on its own; the second producer is what made the pair a defect, and the commit that adds the second writer is the one that
creates this class every time.

The passive clear itself is older and was correct when written: `SearchBand`'s
*"its own effect, with no dependency on the results, so it runs on unmount and only on unmount"*
predates any slot-sharing, and the argument it makes — do not fold the clear into the publication
effect, whose data dependencies change on every keystroke — is still right. What it never said, and
never needed to say, was anything about **phase**. The word *passive* was how the rule was spelled,
not what the rule was, and six copies later it read as the rule.

## The fix that is right for the long term

Not a sixth `Found[]` slot (the first proposal, and it contradicts *the five producer slots stay
five*, and would make `Reader` subscribe to `?referee=` purely to compensate for effect timing). Not
a `sharesSlot` field on the lifecycle input either (the second proposal, and it makes six feature
hooks know something about how `Reader` composes bands, in order to preserve an unmeasured
distinction).

What landed is [`src/web/passage-lifecycle.ts`](../../src/web/passage-lifecycle.ts): one hook holding
the three rules all six producers follow, discriminated three ways (`keyed`, `derived`, `unkeyed`),
in which **rule 3 is a layout cleanup for every producer**. That is smaller than either alternative
and strictly better for the five that do not share a slot: their outgoing marks now leave the prose
before the next paint rather than after it.

Two properties of the hook are correctness rather than tidiness, and both are written on it:

- **It never wraps the parent's setters.** Rule 3 lists them as its dependencies, so an identity that
  changed per render would turn a cleanup that runs on the way out into one that runs on every
  render. The suite would stay green except for one assertion — the *second* `.crit-jump` press in
  `passage-mode-cleanup`, which is there for exactly this.
- **Its effect dependencies are read off the input's fields**, never off the input object, which is a
  fresh object on every render.

## What would have caught the whole class, ranked by ease and value

1. **A shared-slot hand-off test with producers that publish at mount** — cheap, and it is the only
   one of these that catches the defect itself rather than its neighbourhood.
   [`tests/passage-slot-hand-off.test.tsx`](../../tests/passage-slot-hand-off.test.tsx), which
   records **every committed value of the slot** and fails if it is ever emptied between the outgoing
   producer's marks and the incoming producer's. Both directions, no StrictMode. It is red against
   the pre-fix phase and it stays red for any future producer that reintroduces it, because they all
   go through the one hook.
2. **One hook instead of six copies** — the largest value per unit of effort, and it is prevention
   rather than detection: a rule that exists once cannot be right in five places and wrong in the
   sixth, which is how `CriteriaBand` came to clear half the state for two days and `useIdeasMode` to
   have no invalid-key rule at all for a month. The comment that said *"a fix to one of these belongs
   in all three"* was doing this job by asking people to remember, and it had already been overtaken
   by the code twice (*"in both"* → three → six).
3. **A rule that a development-mode double-render may not be present in a red proof** — free, and it
   generalises far beyond this app. Written into the two test files it applies to, and into this
   postmortem, because it is not obvious and the obvious instinct is the wrong one.
4. **An assertion that no two mounted producers write the same slot** — the real generalisation, and
   the one not built. It would have to live at the composition point in `Reader` (stage 4b's
   `selectPassages` and its `band()` switch are where a slot and a mode meet), and it is worth doing
   only when a second slot-sharing pair appears; today's census is one pair, closed by inspection.
   Noted here so the next person does not have to re-derive it.

## See also

- [`src/web/passage-lifecycle.ts`](../../src/web/passage-lifecycle.ts) — the hook, and the reasoning
  for each of the three rules.
- [260906c](../plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md)
  § One lifecycle helper, three rules, three shapes — the plan, and both review rounds.
- [silent-success.md](../reusable/silent-success.md) — the family this belongs to: something
  reporting success while doing nothing, with the obvious check agreeing because it shares an
  assumption with the code. StrictMode's masking is a new member of it, and an unusually
  well-camouflaged one.
