# Improve the codebase

Not project-specific. Finding the rework worth doing — tidyups, refactors, rearchitectures, bug
hotspots, files that got too big, defences that aren't catching enough — and then doing enough of it
that the tree is better than you found it.

**This is a periodic sweep, not a daily workflow.** Run it every week or so, across the whole
codebase, when nobody has asked for anything in particular — unlike
[engineering-manager.md](engineering-manager.md), the workflow a *named* job runs many times a day.
The two meet at one seam: this sweep ends in an umbrella plan, and once you pick a cluster off it,
building that cluster is an ordinary job run the ordinary way. So this doc covers **what to look for
and how to choose**; that one covers stages, briefs, reviews and commits.

## The bar

Long-term better: easier to understand, more reliable, easier to change six months from now. That is
almost always **fewer moving parts, not more** — the best finding deletes something.

"Easier to change" has a concrete test. Greg, 2026-09-02:

> it should be easier (and more confident) for a future agent to find all the relevant places it
> needs to edit, and when it edits them for it to be clearer whether there are implications
> elsewhere that need to be taken into account.

So put every finding to that question: **what would the next editor have had to find, and what
would have told them?** Signposting in the docs, static analysis that surfaces callers and
inconsistencies, boundaries that shrink the set of places, tests that go red at the site you
missed — these are four answers to the one question, and a finding is worth more the cheaper and
more mechanical its answer is. A type the compiler checks beats a test, which beats a doc that
says "also update".

So bias hard towards simplicity, and be suspicious of your own enthusiasm. Two tests to put to every
abstraction you are about to propose, including your own:

- **The deletion test.** Would removing this module concentrate complexity behind a smaller
  interface, or just spread it across the callers? Only the first is a win. A new module with one
  caller, an interface with one implementation, or a "registry" for three things all fail it.
- **The YAGNI test.** If the requirement does not exist today, the complexity that would support it
  should not either — however convincingly you can predict the future.

If you cannot say what gets *simpler* for the next reader, it is not a win. And when something
genuinely is shared, **put it where the invariant already lives rather than minting a new home**.

You will not finish, and that is the expected outcome. The deliverable is a tree that is better,
committed, green, and a plan doc that honestly says what is left.

## Finding the work

**If you were handed a target** — a file, an area, a planning doc — audit that, not the whole tree.
A planning doc is itself a claim about the code: check the commits that say they implement it,
uncommitted changes included, against what it actually says.

Otherwise it is the whole tree, and that is more than one agent can hold. Fan it out.

### How to run the trawl: wide and cheap, then narrow and expensive

**Breadth first, in parallel, with cheap models.** Their job is to **nominate**, not to score — you
do the scoring. Split the sweep two ways, because the two cuts find different things and neither
finds the other's:

- **By lens** — one agent per shape, each looking at the whole tree: what the code already says
  about itself; duplication and divergence; dead code and unused exports; the defences.
- **By zone** — one agent per area or layer, each looking for every shape: the store, the routes,
  the client, the scripts. A zone agent is what catches "this area has stopped being coherent".

**Then go deep on a few.** Take the two or three areas that came back richest and spend a strong
model on each, reading properly rather than grepping. Depth is where a real cause gets separated
from a symptom.

Give every agent the same brief: cite `file:line`, say how you know, and say what you looked at and
what you skipped — the last two feed the scope line and the evidence states below.

**Start with what the codebase already knows.** The best items are not discoveries. They are places
where a comment, a doc or a postmortem *says* two things must stay in step, and nothing makes them.
Send a cheap subagent through the postmortems and the plan file names, and grep the source for the
sentences people write when they know — `TODO`, `HACK`, `for now`, `should be`, `don't forget to
also`, `must stay in step`, `is latent in`, `the third time`. Widen that vocabulary as you go — a
live 500 once hid behind a phrasing nobody had thought to grep for.

**Read the repeat root causes, not the individual bugs.** Two postmortems with the same *shape* are
a class, and the rework that kills the class is worth more than any single fix inside it.

**Read what was already rejected, before you propose anything.** Prior plans record decisions as
well as work, and the fastest way to waste a stage is to rebuild something a previous round
considered and refused. Search the plans for the thing you are about to propose, by name.

**Count every instance before you plan the fix.** Grep the whole tree for the *idiom*, not the sites
a subagent showed you. Counts arrive low for a structural reason: each agent reads one slice, so it
sees the copies inside its slice and none of the outermost ones. **A dedup that leaves a copy alive
is worse than none: the next reader believes it is done.**

A codebase grows by copying the nearest module of the same genre, comments included — and the copy
reliably carries the *documented* half of a contract while silently dropping the undocumented half.
Copy-paste siblings predict real defects, not just untidiness.

**Look for two ways to do one thing**, which is a different search from looking for copies. Not the
same code twice, but two mechanisms for one job that grew up separately: two HTTP wrappers, two
notions of "current", two config readers, a helper and the hand-rolled version of it living side by
side. These are worse than duplication because a reader cannot tell which one is correct, and a fix
lands in whichever the author happened to know about.

**And notice what slowed you down** in the last few hours of real work: what you had to read twice,
where you hesitated because you couldn't tell which of two paths was live, what you were afraid to
touch. That is first-hand evidence and nobody else has it.

**Replay the last few real changes.** For each recent commit, ask what told the author about each
file it touched. "They happened to know" is a finding, and so is a pair of files that change
together commit after commit yet never import each other. Fix it with the cheapest of the four
answers above; a signpost is the fallback, not the first choice.

### Size is a symptom, not the disease

Measure — run whatever static analysis the project has, count lines and complexity — but hold the
numbers loosely, and rank by **churn × complexity**, the file that is both big and edited every
week. A deepening in code nobody touches is a refactor you will never cash in.

Size is weak evidence: across ~45 postmortems in the codebase this was written for, **not one names
file length as the cause** — the mechanism is always a missing check or a shared assumption.
Splitting a long file into six that must now be read together is worse, not better. Ask what the
file's **reasons to change** are: one file, many reasons, is the problem. One file, one reason, is
just a long file.

The same goes for duplication. **Prove the drift** — the strongest evidence is a fix that has
already failed to reach one of the copies. Copies stable for months are usually honest, and merging
them couples two things that were independent.

### Look at the defences, not only the code

The tests, the type system, the static analysis and the production signals are all part of the
codebase, and they are where the highest-leverage rework usually hides. Three questions, in order:

- **Could a class be killed by construction?** A type that makes the wrong state unrepresentable, a
  narrower signature, a lint rule, a stricter compiler flag — these end a whole class without a
  test, and they are *less* machinery, not more. Ask it before proposing any test.
- **Would a better test have caught what got through?** Work from the escapes, not from coverage.
  Push each test to the *lowest* level that catches its class; prefer verified fakes and contract
  tests over mocks that have drifted from the thing they stand in for; write the edge case that
  subsumes the easy ones. **Fewer, richer tests is a win, and deleting tests counts as
  improvement** — a suite that is slow, flaky or vacuous hides real failures. Success is "catches
  the real bug", never coverage or test count.
- **When a class cannot be closed before it ships, would we notice?** Provider drift, rare races and
  environment-specific failures leak past every gate. Ask whether a production signal would have
  surfaced the last incident in hours rather than days: an error capture, an alert threshold, a
  structured-log breadcrumb. Its bar: show it **would have fired on the actual incident**, and that
  it is bounded against alert-fatigue. A noisy signal is worse than none.

## Every finding is a claim, including yours

This is the part that goes wrong, and it goes wrong quietly.

A subagent's finding, a comment's count, a prior plan's summary, your own first draft — **verify
each at the strength you assert it.** A quantifier (*each*, *every*, *all three*) means you counted.
"Verified" means you re-ran the grep against today's tree, locating by content rather than by line
number, because the line numbers in any audit are already stale.

**The fix beside a finding is a separate claim from the finding**, and the easier one to miss,
because the evidence you just checked was for the finding. Before building anything, ask what
already exists that it duplicates. One run found three untested copies of a query — true — and
proposed a test pinning them together; grepping the genre turned up their extracted, exported,
already-tested home, which nobody had moved them to. The planned fix was machinery whose only job
would have been to protect duplication.

## When there is too much: the umbrella plan

Almost always there is more than one job's worth. Don't pick greedily. Write an **umbrella planning
doc** ([write-planning-doc.md](write-planning-doc.md)) that lists everything found, clusters the
items touching the same code or the same idea, and scores each cluster on **effort, value and
risk** — value and ease pick the order, risk can veto.

**Three things the doc must carry, because a reviewer cannot check your diligence but can check
these:**

- **A scope line** — directories swept, directories excluded, and what the method is blind to. A
  grep over `src/` silently omits the deploy scripts, and nobody notices an absence. Static sweeps
  find no races, no ordering bugs, nothing that exists only at runtime.
- **An evidence state on every finding** — *reproduced*, *proved from the code*, or *hypothesis* —
  kept separate from its tier. The words blur under pressure, and a confident hypothesis otherwise
  gets scored like a reproduction. Nothing counts as a correctness win below a reachable call path.
- **The counts shown, not summarised**, so the next reader can check them without redoing the work.

**The first stage addresses the highest confirmed tier unless risk explicitly vetoes it** —
otherwise the cheap, comfortable cluster wins on convenience while a live defect waits.

Tiers that have worked, and a good default:

- **Tier 0 — live defects you tripped over on the way.** Not cleanup. Do these first, red test
  first, and say so in the plan.
- **Tier 1 — cheap, mechanical, evidence in hand.** Dead code, N copies of one fix, a false comment,
  an unset variable that made half a defence inert. High ratio, low drama.
- **Tier 2 — the extractions worth doing.** Each gets a test *before* the extraction, and its own
  review.
- **Tier 3 — the rearchitectures.** Each is its own job with its own plan; the umbrella doc's role
  is to name it, size it, and stop.

**End the doc one level up:** say whether the overall approach of the area is sound. That is the
finding a grep can never produce. If it is not sound, that is a Tier 3 item — named and sized, not
started.

**If you were asked only to audit, stop once the umbrella doc is reviewed**: found, verified, scored
and reviewed, with nothing built, is a complete deliverable rather than an abandoned run. Otherwise
do one or more clusters — and if you run them in parallel, the constraint is **non-overlapping file
sets**, not independent ideas.

## Stages that can stop

Every stage ends committable, green and deployable, and here that is the whole design constraint.
For a rearchitecture the shape that gives it to you is the boring one: **add the new thing beside
the old, move callers in batches, delete the old.** Each batch is a stage. If a stage leaves two
ways to do one thing, that is tolerable only when the plan and the commit message say which wins and
when the other dies.

Two traps live in that window. **While both paths exist, a fix must land in both** — drift is
*created* by a fix landing in the original after the copy was taken. And **before the delete stage,
grep for callers of the old path** rather than trusting your batch list: a missed caller keeps
working, silently, on code you believe is dead. If the old path turns out to be genuinely unsafe to
delete, that is a finding for the plan, not a reason to leave it "just in case".

If you cannot see how to stop halfway, the job is not staged yet. Say so rather than starting.

## Not breaking it

A refactor is where a check that shares an assumption with the code bites hardest, because the
behaviour is already correct, so there is no red test to write first. The substitute:

- **Characterise before you change.** Write tests against the *current* behaviour, then prove they
  can fail.
- **Prove a check can fail against a semantically *wrong* implementation, not only a mutilated
  one.** Breaking the code on purpose only proves the test detects *that* break. Then ask what
  plausible wrong version would still pass. Asserting that words appear is the commonest tautology:
  a test that checked a SQL string for `current_revision_id` and `inner join` passed a query that
  joined a table to itself and had no `where` clause at all. Assert the relationship and the bound
  parameters, not the vocabulary.
- **If the behaviour you are about to pin looks wrong, that is a Tier 0 finding, not a spec.**
  Characterisation enshrines defects otherwise.
- **An existing test going red is evidence, not an obstacle.** The change that makes your new test
  green is not automatically the right change, and the test that objects may be the one holding the
  requirement. Read what it asserts before you touch it.
- **Extract without changing behaviour in one commit; change behaviour in another** — and before
  finalising either, strip out the unrelated renames and restructurings that crept in. A diff that
  does both is unreviewable and hides the bug in the noise.

## Reviews and second opinions

The review cadence is [engineering-manager.md § GPT Sol](engineering-manager.md#gpt-sol). Three
things it doesn't say:

- **Escalate the hard calls to a second model family as well** — a Tier 3 boundary, two designs that
  both work, a claim you can't settle.
- **Ask explicitly whether a proposed abstraction is worth its keep.** Reviewers are good at this
  and will not volunteer it; asked directly, they will tell you the extraction is not worth the
  indirection.
- **Research how the shape is normally solved** before inventing your own — but treat what it finds
  as options, not obligations. Most best-practice advice is written for larger teams and
  longer-lived code than yours, and importing it wholesale is the commonest way this work turns into
  over-engineering.

## Along the way

- **Delete the false comments you found.** They are half the findings, and one left behind is one
  the next agent believes.
- **Record what you decided not to do, and why** — in the plan, where the next run's search for
  prior rejections will actually find it. That list is worth as much as the list of accepted items.
