# Third pass: the summary-mode blocker, fixed

Your second review (`docs/plans/260829a-footnotes-finish-review-2-sol.md`) confirmed the continuation
fix and returned BLOCK on one more: summary mode still treated the apparatus as argument
structure. This is that fix.

Both of your previous passes found a real blocker, so please assume there is one more and go
looking for it rather than confirming this one. The regenerated scoped diff is
`docs/plans/260829a-footnotes-finish.diff` — 1319 lines now, and genuinely complete this time; the
289-line version I nearly sent you was a `git diff -- $VAR` that zsh had collapsed into a
single pathspec.

## The blocker

You were right, and the part worth recording is that **the evidence was already on my screen
and I read straight past it.** A probe I ran before your review printed
`summary titles: … | The techno-rapture | Notes | | | | | |` — those six empty titles after
"Notes" *are* the phantom rows — and I wrote it down as "summary tree includes Notes, good".

## The fix, in two halves

**`buildSummaryTree`** (`src/web/tree.ts`): a supplement node is marked `supplement: true`, is
not descended into, and **does not advance the part counter**. That last part matters
separately from the numbering: the counter now increments only on children that are the
argument, so appending an apparatus cannot renumber part 1 or invent a part 3. A new
`SummaryNode.supplement?: true` is absent on every ordinary node, so a consumer that does not
know about it reads exactly as before.

**`SummaryPanel.tsx`**: no number span, no "No summary for this section", and a `supplement`
class on the row that dims it into the same key `.arc-step.arc-supplement` and
`.spine-part.supplement` already use.

## The tests, and a third instance of the same trap

`tests/supplement.test.ts` gets the tree-side assertion: `Notes` comes back `supplement`, with
`children: []` and `number: ""`, while the argument's parts keep `1`, `2` unshifted.

`tests/summary-expand.test.tsx` gets the panel side, mounted, because the tree fix alone does
not prove a reader stops seeing it.

**Those panel assertions started as one test and I split them into four**, because a probe
that reverted *both* halves of the fix reddened only the numbering and never ran the
missing-summary check — the first failing assertion ends the test. That is the third time in
this one change that two clauses shared a single probe: the two hash pins, then the two halves
of the panel fix. Each half now has its own test and each was watched go red on its own.

I also took both of your suggested additions:

- **strictly increasing, unique `starts`**, asserted across all five shapes — the one thing
  about the continuation change I could not rule out by argument.
- **a deep Notes-plus-References case**, asserting two rows and not one, and that the fisheye
  and `?at=` name the same two anchor blocks.

## State

- `npm run typecheck`: all three projects pass. (The two `output/**` complaints are gitignored
  build artefacts a non-hermetic gate copies in; they are at HEAD and not mine.)
- Full `npm test`: **5585 passed, 1 failed** — `tests/sse-heartbeat.test.ts`, which passes in
  isolation and is a timing-sensitive heartbeat test unrelated to anything here. I touch no
  SSE code.
- `tests/supplement.test.ts` is now 50 tests.

## What I want from this pass

1. **The part counter.** I changed numbering from `map((id, i) => ... i + 1)` to a counter
   that advances only on non-supplement children. Check I have not introduced an off-by-one
   or a case where two siblings get the same number.
2. **`SummaryNode.supplement` as an optional `true`.** Every other consumer of
   `buildSummaryTree` ignores it. Is there one that should not — `currentEntryId`,
   `showsChildren`, the follow/scroll path — where an apparatus row that is now childless
   changes behaviour I have not looked at?
3. **Any panel or projection still unexamined.** I have now been through the fisheye, `?at=`,
   keynav, the arc, the spine and summary mode. If there is a seventh, name it.
4. Anything else.
