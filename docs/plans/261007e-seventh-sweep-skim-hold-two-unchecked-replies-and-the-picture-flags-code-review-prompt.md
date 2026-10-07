# Code review (write-capable): Skim's hold, two unchecked replies, the picture flags

You are reviewing, and may fix, one committed stage in this worktree.

**The stage:** on branch `worktree-sweep7-skim-hold-and-picture-flags`: `0ecb8f2c2` (Skim's rewrite
hold), `2456bafed` (Thread and Skim check a reply before publishing it), `84bcd4d62` (merge of
`origin/dev`), `2d433bb0b` (the picture hooks' flags grouped with the picture). Read each with
`git show`. The plan:
`docs/plans/261007e-seventh-sweep-skim-hold-two-unchecked-replies-and-the-picture-flags.md`. The
umbrella: `docs/plans/261006m-seventh-codebase-sweep-depth-umbrella.md`, cluster C10 and § What the
review changed (U14, U15). Context you reviewed earlier today: the rewrite hold was added to six
other modes (plan `docs/plans/261007b-seventh-sweep-rewrite-hold-on-the-six-forced-verbs-without-one.md`;
your review of it is beside it), and `useIdeas` got an answer-object grouping
(`docs/plans/261006n-one-type-for-a-read-spiked-on-useideas.md` § The decision).

**Try to break each item.**

1. **Skim's hold.** Skim runs prerequisites first (Quotes, Ideas) when they are missing or stale,
   then its own step; its forced verb is *Plan it again*, drawn in two places. The hold is keyed
   `(slug, "skim")`, identity is the route's `generatedAt`, and it "follows the one job the press
   made, so it lasts through any Quotes or Ideas that job makes first". Break it:
   - a hold that never releases: the job fails in a PREREQUISITE step (does the hold learn the job
     is over?); the job is stopped; the prerequisite succeeds and Skim's step is refused; the route
     comes back with the same `generatedAt`; the reader changes the reading purpose mid-hold; the
     slug changes; the band closes and reopens;
   - a press made while a prerequisite read is still loading is "a kept intent, made once", and the
     hold is taken when the request is actually sent: between the click and the send, is the
     control live (a second click → two kept intents → two POSTs)?
   - the builder left one path unheld on purpose and recorded it: *Plan the route for this* in
     `SkimPurpose.tsx`, an unforced `ensure` that, over a held route, starts a run for a new
     purpose. Is that a second paid run of the kind the hold exists to stop, or a legitimately
     different request (a different purpose)? If it is the former and the fix is to honour
     `rewriting` there too, fix it red-first; if it is a product question, report it.
   - the builder REMOVED a guard assertion (that `useSkim.ts` is found because of its conditional
     spread) because the forced call is now a plain object. Is the conditional-spread form still
     pinned by the guard's snippet cases, so the guard has not lost coverage of that syntax?
   One new reader-facing sentence, in the existing pattern: *The new route hasn't loaded yet.* Check
   it matches the others in form and placement. Write no further sentence.
2. **Thread (`useTweets`) and Skim validate before publishing.** A 404 or a `200 null` is "none
   yet"; Thread requires `thread` to be an object; Skim requires `skim` to be an object with a
   `stops` array; anything else throws `MalformedReply` and the accepted answer and its flags stay.
   The retreat rule was: no real server envelope may be rejected. The builder verified Thread
   against two stored threads from the fixture corpus, and Skim **from the route code alone** (no
   stored Skim route exists in the corpus). Read `loadSkim`, the Skim step's writer and its types:
   is there any stored shape (an older artefact version, an empty route, a route with zero stops, a
   legacy field name) that the server answers 200 for and this check now refuses? Same for Thread
   (the builder names one theoretical gap: a stored thread that is truthy but not an object). The
   builder also reports a hole in the tests themselves: with `MalformedReply` not imported, the
   throw was a `ReferenceError` and every row still passed. Close that hole if it is a small change
   to the matrix (assert the failure is the authored one, by class or by sentence).
3. **The picture hooks.** `useSketch` and `useIllustrated` each now hold one nullable value (the
   checked picture, its stored identity for the hold, and the four flags), with `faults` kept
   separate so a checked-empty answer still reports them. Returned interface, ordering and
   `FreshReads` calls are said to be unchanged. Find a sequence where the grouped version draws
   something different from the code before it, other than the fixed leak: picture → failed
   re-read (must keep the picture and flags); picture → 404 (must clear picture, flags AND faults);
   picture → checked-empty with faults (must clear picture and flags, keep faults); the hold's
   identity across each. `useIllustrated` depends on the Sketch's readiness: is anything it reads
   from `useSketch` changed in shape or timing?
4. Every rewritten comment and doc sentence is a claim (`skim.md`, `tweets.md`, `sketch.md`,
   `illustrated.md`, `reader-profile.md`); check each against the code.

You may run `npx vitest run tests/<file>` (jsdom; nothing outside the tree) and
`node --import tsx <script>`. A red in the sandbox may be the sandbox: say so. No `npm test`, no
network.

**Fix what is inside this stage**, narrowly, red-first. **Report, do not fix, anything wider.** Do
not touch `useIdeas.ts`, `IdeasPanel.tsx`, `modes/ideas/*`, `marginalia/*`, `CommandBar.tsx`,
`SketchView.tsx` / `IllustratedView.tsx` beyond reading them, or any server file. Do not commit.
Do not attribute any decision to the product owner in docs: the choices here were the
orchestrator's (Claude's) and the builder's.

**Reply format.** Findings C1, C2, …; P0 (data loss) / P1 (a reader sees wrong behaviour: a dead
button, a second paid run, a real reply refused) / P2 / P3; the input; reproduced or reasoned;
fixed or not (and the test). Then files changed, what you ran with raw counts, a verdict (ship /
ship with these fixes applied / do not ship), and wider notes.
