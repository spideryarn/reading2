# Code review: re-run Structure and Start again

Reviewed the uncommitted implementation in this worktree. I found and fixed two
payload correctness defects, tightened the route and Metadata freshness checks
to agree with the payload, and added tests that fail on the original code. I did
not commit, call a paid model, or touch a remote database.

## Findings fixed

### 1. `fitsTree` accepted an incomplete arc

The original predicate was only a subset check:

```ts
arc.entries.every(entry => currentPartRanges.has(entry.range))
```

It therefore kept an arc when the old entries all still matched but the current
tree had gained a part. It also accepted two entries for one part. In both cases
the reading view could look complete while one current part had no arc sentence.

I moved the structural predicate to `src/tree-parts.ts` (and re-exported it from
`src/arc.ts`) and made it a bijection over `partsOf(tree)`: equal counts, unique
part ranges, unique entry ranges, and exact range membership. Using `partsOf`
is important: a depth-one supplement is apparatus and the arc generator does
not write a sentence for it.

The edge cases now have explicit tests:

- one exact top-level part fits;
- the only fitting arc for no parts has no entries;
- a depth-one supplement is excluded;
- changing only a part's children does not invalidate its arc sentence;
- a root-level or subsection-level range is rejected when it is not exactly a
  current part range;
- a proper subset and duplicate entries are rejected.

If a root and its sole part happen to have the same range, an entry cannot
reveal which level produced it; accepting it is harmless because it is exactly
the range the reading view joins to that sole part.

### 2. Public and private-link readers still received the bad arc

`src/store/pg.ts#loadArticle` is the owner's path. Public-shelf and private-link
reads go through the public reader and `publicArticle`, which previously copied
the stored arc without the new fit check. A visitor would therefore continue to
see the silently incomplete arc.

I applied the same structural check at the public DTO boundary. A bad arc is
omitted. This cannot start paid work: `useArc` is mounted only by `OwnedReader`;
`VisitorArticle` keeps the payload's arc or none and makes no arc GET or job
POST. The public import-graph test remains green, so the DTO still cannot reach
writers or model calls.

I also corrected the public DTO's positive fixture. Its former arc used the
root's range, and its only depth-one node was a supplement, so it was not a
drawable positive control. The fixture now has one argument part plus the
supplement and an arc sentence for the argument part.

### 3. The arc route and Metadata could disagree with the article payload

After `loadArticle` omitted a structurally bad arc, `/api/arc/:slug` could still
return the same object as ready if its ordinary fingerprint was current.
`useArc` would then put it back. I made `loadArc().stale` and Metadata's
`isCurrent("arc")` require `fitsTree` too.

For the intended Structure re-run path, the changed tree also changes the arc
input stamp, so the owner's unforced arc job regenerates it. There is one wider
integrity case I did not expand this stage to solve: if somebody manually
damages an arc's entries while leaving a current pipeline receipt/stamp behind,
the payload and route now refuse it, but the unforced runner may trust that
receipt and skip rewriting it. That is arbitrary stored-data corruption rather
than a Structure re-run, and repairing it would mean widening the pipeline's
currency contract.

### 4. Tests could pass while the feature was wrong

I added tests that first failed against the submitted code for the proper-subset
arc, duplicate entries, and the public DTO leak. I also added:

- a real `DockCommandBar` test proving *Start this article again* is absent with
  experiments off, present with them on, navigates to AI processing, and sends
  no POST;
- an exact Structure command test proving Enter sends
  `{ slug, steps: ["structure"], force: ["structure"] }`;
- a Postgres wiring test for `loadArticle` and `/api/arc` (written but not run
  here because the local database is unavailable).

I corrected one stale `cascadeForce` comment which still claimed arc was absent
from `FORCE_ONLY_WHEN_NAMED`; arc has been in that set since it gained its own
freshness stamp.

## Checks of the requested paths

- Both Metadata and command-bar Structure rows use the same `stepRunRequest`
  path and send a slug-only, one-step named force.
- `cascadeForce(["structure"], {"structure"})` remains exactly `structure`.
  Structure is correctly not in `FORCE_ONLY_WHEN_NAMED` for a multi-step job.
- Labels do not need to be in this one-step request. Structure writes the empty
  pending-label manifest; publishing that revision queues the separate labels
  successor. `tests/labels-land-after-the-shelf.test.ts` has the exact
  forced-Structure publication case, though its Postgres lane could not run in
  this sandbox.
- The Metadata busy state tracks the Structure job, then stops while the
  separately published labels successor runs. This is the existing planned
  split, not a broken mode assumption. `RERUN_MODE.structure` links to the real
  Structure band and the generic icon/name/cost paths all accept it.
- Every `besideTheModes` call site now supplies `experimentalOn`. Production
  passes `experimental.on`, and `metadataRows` adds the Start-again row only
  when it is true. The row does not leak when the switch is off.

## Verification

- Red phase observed: 3 failures (proper subset, duplicate entries, public DTO
  stale arc) before the fixes.
- Focused review suite: 8 files, 208 tests passed.
- Typecheck: all five TypeScript projects passed; all 4,102 source files are
  covered. The npm wrapper could not create its `tsx` IPC socket in this
  sandbox, so I ran the same script through Node's `tsx/esm` loader.
- Biome check on the reviewed source and tests passed with four existing
  informational complexity warnings: three large job-runner functions in
  `src/jobs.ts`, and `src/store/pg.ts`'s `isCurrent` switch.
- `git diff --check` passed.
- `npm test` could not start the private Postgres lane: local port 54362 and
  Docker are unavailable in the sandbox. A separate full unit-project attempt
  reached unrelated `tests/run-claude.test.ts` sandbox failures and was stopped;
  the scoped unit suites above are green.

No commit was made.
