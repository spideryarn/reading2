# The dialog said nothing was personalised, and a picture drawn for the reader was

**2026-08-30.** Found by a test about **column policy**, one layer below the thing that was wrong.
Nobody opened the dialog. Nobody reported it. The sentence an owner reads before making an article
public had been false for about two hours and the only thing that noticed was
[`tests/store-revision-columns.test.ts`](../../tests/store-revision-columns.test.ts), which does not
know the dialog exists.

> **Fixed the same day** in [`src/store/pg.ts`](../../src/store/pg.ts), by deriving the list from
> `ArtifactMap` instead of writing it down. See [the fix](#the-fix).

## What the sentence is for

Before an article goes public, the owner gets a confirmation card
([`src/web/AccessSharing.tsx`](../../src/web/AccessSharing.tsx)) that names **which artefacts were
written for their reader profile**. Three states, three sentences, and the third one lists them by
name — `src/messages.ts`, and the reasoning is in
[`src/types.ts` § `personalised`](../../src/types.ts):

| `personalised` | The owner is told |
|---|---|
| absent | *"…may have been written for your reader profile"* — a hedge, because the store could not say |
| `[]` | **"Nothing here was written for your reader profile."** |
| `["glossary", …]` | *"your glossary — written for your reader profile, and shared exactly as written."* |

The middle row is the whole risk. It is not a hedge and not a list; it is a flat denial. The leak it
guards is not that an artefact quotes the profile — [`src/profile.ts`](../../src/profile.ts) forbids
that — it is that **what a profile made the model leave out is visible in what it kept**.

## The bug

[`personalisedSteps`](../../src/store/pg.ts) built that list from a hand-written table of four:

```ts
const carriers: Partial<Record<StepName, { profileHash?: string | null } | null>> = {
  tweets: revision.tweets,
  glossary: revision.glossary,
  summary: revision.summary,
  ideas: revision.ideas,
};
return STEP_ORDER.filter((step) => carriers[step]?.profileHash != null);
```

`sketch` is the fifth. [`generateSketch`](../../src/sketch.ts) stamps `profileHash` exactly like the
other four — `sketch.profileHash = profile ? hashProfile(profile) : null` — because the picture is
drawn by a model that was told who is reading. It was never added here.

So an owner whose only personalised artefact was a Sketch got `personalised: []`, and the card said
**"Nothing here was written for your reader profile."** That is the strongest of the three sentences
and the one that must never be said wrongly.

Three separate places had to be wrong together, and were:

- **`REVISION_PROJECTIONS.metadata`** did not select the `sketch` column, so the value was not even
  fetched.
- **`personalisedSteps`** was a `Partial<Record<…>>`, so a missing key is a legal object.
- **`OWNED_ARTEFACT`** in [`src/messages.ts`](../../src/messages.ts) had no noun for it, so even a
  correct list would have rendered *"your sketch"* by fallback rather than *"your sketch diagram"*.

**One correction to how bad it was, worth writing down rather than rounding up.** No personalised
sketch actually reached a visitor. The public API is two routes —
[`src/public/route-names.ts`](../../src/public/route-names.ts) — and `PublicArtefacts` names `arc`,
`tweets`, `glossary`, `summary` and `ideas`. `sketch` is in neither. So the sentence was false about
the article and true by accident about the wire, held up by a *second* list that also does not
mention sketch. Both lists are supposed to grow; only one of them was fixed here.

## The commit

[`3897bc9`](../plans/260830j-sketch-diagram.md) — *"Sketch becomes a fourth chip, and the first step that does
not write its own file"*, 2026-08-30 14:14. A good commit and a careful one: it converted the step
away from writing its own file, argued the view out of `DiagramPanel`, validated the scene in the
browser on arrival, and measured its step budget rather than guessing it. It touched the schema, the
step CHECK constraint, `REVISION_READ_POLICY`, `REVISION_PROJECTIONS.sketch`, the route, the hook and
the view.

It missed three lists, and the three it missed have one thing in common: **nothing fails when they
fall behind.** The seven it got right all fail loudly — a missing column does not compile, a missing
CHECK entry rejects the insert.

## How it was found, which is the interesting part

`tests/store-revision-columns.test.ts` asserts that **each projection selects exactly what the policy
grants it**:

```ts
expect(Object.keys(REVISION_PROJECTIONS[read]).sort()).toEqual(policyGrants(read));
```

`REVISION_READ_POLICY` already said `sketch: { metadata: "value", sketch: "value" }` — the commit
classified the new column correctly, because that test's *first* assertion forces every column of the
table to be classified before anything passes. The projection then did not take it. Red.

So a test whose subject is *how many bytes a query drags across the wire* caught a *privacy* bug, by
accident, because the privacy bug happened to also be a projection that disagreed with its policy.
Nothing was testing the thing that mattered. Had `personalisedSteps` read the sketch off a column
some other read already selected, there would have been no red anywhere.

### Two neighbours from the same commit, found the same way

- **`sketch.json` had no entry in the artefact manifest**
  ([`tests/store-artefact-manifest.test.ts`](../../tests/store-artefact-manifest.test.ts)), so
  import and export did not know about it and a filesystem → Postgres → filesystem round trip would
  have dropped the artefact silently — the same loss
  [260828c-export-never-wrote-the-readers-purpose.md](260828c-export-never-wrote-the-readers-purpose.md) is about.
  The manifest entry and [`src/store/export.ts`](../../src/store/export.ts) landed;
  [`src/store/import.ts`](../../src/store/import.ts) is written and **held back**, because a peer
  had a 1,400-line rewrite of that file in flight and a pathspec commit takes the whole file. So
  today an export writes `sketch.json` and an import ignores it, which is where it stood before —
  no worse, and finished when that rewrite lands.
- **`writeWholeArticle` in
  [`tests/pipeline-artifact-store.test.ts`](../../tests/pipeline-artifact-store.test.ts)** did not
  write a sketch, so the fixture's "whole article" was missing one.

**And the timing of the manifest test is the thing to take from it.** It does not read the code; it
reads `data/` and holds what is there against a list somebody wrote. `data/` is gitignored. So it
went red only once a real `sketch.json` existed on this laptop — the first one is timestamped 14:15,
one minute after the commit, because Greg happened to run the step. On a fresh checkout, or on any
machine where nobody drew a sketch, **it would have stayed green forever.** Its evidence is a
property of the machine, not of the change: exactly the shape
[silent-success.md](../reusable/silent-success.md) warns about, in the test that was written to
prevent it.

## The fix

The list is no longer a list. It is read out of `ArtifactMap`
([`src/store/artifacts.ts`](../../src/store/artifacts.ts)) by the compiler:

```ts
type ProfileCarrying = {
  [K in keyof ArtifactMap]: "profileHash" extends keyof ArtifactMap[K] ? K : never;
}[keyof ArtifactMap] &
  StepName;

const carriers: Record<ProfileCarrying, { profileHash?: string | null } | null> = { … };
```

`Record`, not `Partial<Record>`, is what does the work: a sixth artefact that gains a `profileHash`
stops compiling here until somebody says what to do about it. Verified by mutation rather than
assumed — deleting `sketch: revision.sketch` gives

```
error TS2741: Property 'sketch' is missing in type '{ tweets: …; glossary: …; summary: …; ideas: …; }'
  but required in type 'Record<ProfileCarrying, { profileHash?: string | null } | null>'.
```

`REVISION_PROJECTIONS.metadata` now selects the column, and `OWNED_ARTEFACT` has the noun.

### The obvious form of that type is wrong, and looks right

The structural version — `ArtifactMap[K] extends { profileHash?: string | null }` — returns the same
five today. It was checked, both ways, against the real `ArtifactMap`. It is also **one shared field
away from matching everything**, because the only reason it excludes anything is TypeScript's weak
type detection: a type with *no* property in common with a wholly-optional target is rejected, and a
type with *one* is accepted.

```ts
Tree extends { profileHash?: string | null }                    // false
Tree extends { profileHash?: string | null; version?: string }  // true   ← Tree has `version`
```

So the day somebody widens that probe, or the day `Tree` gains a field the probe already names, the
"derived" list quietly becomes *every artefact* and the dialog starts naming the block ids as
personalised. `"profileHash" extends keyof T` asks the question directly and cannot do that. A rule
held up by the absence of a shared field is not a rule.

## What would have caught the class

The class is: **a hand-written list that has to stay exhaustive over a set that grows, where falling
behind fails nothing.**

**1. Compile-time derivation, which is what landed, and it is the right default.** Where the fact
already lives in a type, make the list total over a key derived from that type and let `tsc` ask the
question. Two more places in this repo have the same shape and one of them is live:

- **`OWNED_ARTEFACT` — done, and not where you would expect.** It was
  `Partial<Record<StepName, string>>`, and its docstring said the fallback was unreachable because
  all five were in the table: true today, and the same sentence the old `personalisedSteps` could
  have written about itself. It is now a `satisfies` declaration whose inferred type is exactly its
  keys, and the coverage assertion lives in
  [`tests/messages.test.ts`](../../tests/messages.test.ts) rather than beside it, because
  `src/messages.ts` **must stay a leaf** — `tests/client-imports.test.ts` refuses it even an erased
  `import type`, and pins that refusal as a reverted relaxation. So the check goes where both halves
  can be seen at once. It fails `npm run typecheck`, not vitest.

  Two traps on the way, both of which made the check vacuous while looking finished. The first
  attempt wrote `OWNED_ARTEFACT as Record<ProfileCarrying, string>` — the cast makes the assertion
  pass whatever the table says. The second ran the mutation under `npx tsc -p tsconfig.json`, which
  **excludes `tests/`**, so deleting the entry produced no error and the assertion appeared not to
  work. Both were caught by insisting the mutation actually redden something.
- **The read list in `tests/store-revision-columns.test.ts` — done, and it was hiding two.** Its loop
  named each read by hand — deliberately, so that *deleting* a projection fails — but adding one
  failed nothing, so `REVISION_PROJECTIONS.sketch` **and** `.arc` were checked against the policy by
  nothing at all. The test that caught this bug had the same defect one level up. The list is one
  shared const now, with a test holding it against `Object.keys(REVISION_PROJECTIONS)` so that both
  directions fail.

  Covering the two turned both red immediately: `sketch` selected `id` and `tree`, and `arc`
  selected `id`, none of which the policy granted. Nothing was wrong at runtime — the projections
  were right and the policy was three columns behind — but that is the same drift in the same file
  that produced this bug, sitting there unnoticed.
- **`tests/db-step-constraint.test.ts`** is the case where derivation is impossible and the answer is
  a static file check instead: `revision_step_runs_step` is a CHECK expression in SQL, `drizzle-kit`
  diffs the schema and knows nothing about it, and it had been forgotten twice before — `'summary'`,
  then `'assets'`. Its header says `'sketch'` would have been the third. That test is the model for
  every list the type system cannot reach, and its argument for being static rather than asking
  Postgres is the same argument that matters here: **the check has to be able to fail on the day the
  file is written**, not after a migration has run or after somebody happens to generate a fixture.
- **`HOMES` in `tests/store-artefact-manifest.test.ts` cannot be derived**, and should not be — its
  whole point is to ask the filesystem rather than the code. But it needs saying in that file that
  its evidence arrives only when a real file exists on the machine running it, which for `sketch.json`
  was one minute after the commit by luck and could as easily have been never.

**2. A test that asserts the dialog's list for an article with a personalised sketch.** Worth having,
and I would write it — but be honest about what it buys. Enumerating artefacts in a test is *another
hand-written list with the same failure*: the sixth artefact will not be in the test either. What it
does buy is the seam. Assert that a revision whose only `profileHash` is on the sketch produces
`personalised: ["sketch"]` and that `AccessSharing` therefore renders the naming sentence rather than
the denial — that pins the **value that crosses the boundary**, which no amount of policy checking
does, and it would have been red here.

**3. And yes: the real defect is that a step can be added without anything asking "does it carry a
`profileHash`?"** That is the honest answer, and the two above are consequences of it. Adding a step
today touches `STEP_ORDER`, the CHECK constraint, `artifacts-fs`, `artifacts-pg`, the read policy,
the projections, import, export, the manifest and the dialog. Sketch got seven right and missed
three, and the three it missed were exactly the three that stay quiet. The fix for that is not a
checklist in a comment — `db-step-constraint`'s header already makes the case that three migrations
each warning about the previous one is the clearest possible sign that a comment is not the
mechanism. It is that **every one of those lists should be total over a derived key**, so that the
step's own type is what asks, ten times, in ten files, at compile time.

## Related

- [260828c-export-never-wrote-the-readers-purpose.md](260828c-export-never-wrote-the-readers-purpose.md) — the same
  family, one table over: a condition that was a hand-written copy of an object's keys, fixed by
  deriving the condition from the object.
- [260828a-the-config-file-is-not-the-bucket.md](260828a-the-config-file-is-not-the-bucket.md) — a declaration and
  the thing it describes drifting apart with nothing comparing them.
- [silent-success.md](../reusable/silent-success.md) — why a green test whose fixture cannot contain
  the case is not evidence.
- [reader-profile.md](../project/reader-profile.md) — what a `profileHash` means and why a stale one
  is wrong rather than old.
- [security-map.md](../project/security-map.md) — where the owner-versus-visitor boundary is
  enforced, and what the public reader is allowed to say.
