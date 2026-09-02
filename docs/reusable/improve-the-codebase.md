# Improve the codebase

Not project-specific. Finding the rework worth doing — tidyups, refactors, rearchitectures, bug
hotspots, files that got too big — and then doing enough of it that the tree is better than you
found it.

This is the doing counterpart to [audit-architecture-mode.md](audit-architecture-mode.md), which
investigates and changes nothing. Run it **under**
[engineering-manager.md](engineering-manager.md) — that has the machinery: stages, subagents, plan
docs, delegation, when to stop and ask. This doc is only about **what to look for and how to
choose**, and it tries not to repeat it.

## The bar

Long-term better: easier to understand, more reliable, easier to change six months from now. That
is almost always **fewer moving parts, not more** — the best finding deletes something.

So bias hard towards simplicity, and be suspicious of your own enthusiasm. An extraction that leaves
a new module with one caller, an interface with one implementation, or a "registry" for three
things, has added machinery and called it cleanup. If you cannot say what gets *simpler* for the
next reader, it is not a win.

**New machinery is a proposal for the plan, decided at review — not something to slip into a
stage.** And when something genuinely is shared, **put it where the invariant already lives rather
than minting a new home**: the module that already owns JSON parsing, or already owns what the
streaming paths must agree on, is where the shared piece goes.

You will not finish, and that is the expected outcome. The deliverable is a tree that is better,
committed, green, and a plan doc that honestly says what is left.

## Finding the work

**Start with what the codebase already knows.** The best items are not discoveries. They are places
where a comment, a doc or a postmortem *says* two things must stay in step, and nothing makes them.
Send a Sonnet subagent through the postmortems and the plan file names, and grep the source for the
sentences people write when they know: `TODO`, `HACK`, `for now`, `should be`, `don't forget to
also`, `must stay in step`, `the third time`, `see also`. In the repo this was written in, that
through-line held twice over:

> The through-line of almost every finding worth doing: the codebase already knew. … Most of the
> work below is finishing sentences the repo already started.
>
> — [260826m-simplification-audit.md](../plans/260826m-simplification-audit.md)

**Read repeat root causes, not individual bugs.** Two postmortems with the same *shape* are a class,
and the rework that kills the class is worth more than any single fix in it.
[silent-success.md](silent-success.md) and
[written-down-is-not-checked.md](written-down-is-not-checked.md) are two such classes already named.

**Count every instance before you plan the fix.** Grep the whole tree for the *idiom*, not the sites
a subagent showed you — each agent reads one slice, so it sees the copies inside its slice and none
of the outermost ones, and every duplication count arrives low. In the repo above, the first draft
undercounted every duplication it found (3 when it was 5, 4 when it was 18, 3 when it was 6, later
7); the rule written to stop that was then broken again in the next wave, 29 when it was 34. **A
dedup that leaves a copy alive is worse than none: the next reader believes it is done.**

The reason it undercounts is worth knowing, because it also tells you where the bugs are: a codebase
grows by copying the nearest module of the same genre, comments included — and the copy reliably
carries the *documented* half of a contract while silently dropping the undocumented half. So
copy-paste siblings are a strong predictor of real defects, not just of untidiness.

**And notice what slowed you down** in the last few hours of real work: what you had to read twice,
where you hesitated because you couldn't tell which of two paths was live, what you were afraid to
touch. That is first-hand evidence and nobody else has it.

### Size is a symptom, not the disease

Measure — run whatever static analysis the project has, count lines and complexity — but hold the
numbers loosely, and rank by **churn × complexity**, the file that is both big and edited every
week, rather than by size alone.

Be honest that size is weak evidence. In the repo above, across ~45 postmortems, **not one names
file length as the cause**; the big files show up often because they are edited often, and the
mechanism is always a missing check or a shared assumption. A 6,000-line file that is a flat,
documented, order-sensitive switch may be entirely fine, and splitting it into six files that must
now be read together is worse. Ask what the file's **reasons to change** are: one file, many
reasons, is the problem. One file, one reason, is just a long file.

The same goes for duplication. **Prove the drift** — the strongest evidence is a fix that has
already failed to reach one of the copies. Copies that have sat stable for months are usually
honest, and merging them couples two things that were independent.

## When there is too much: the umbrella plan

Almost always there is more than one job's worth. Don't pick greedily. Write an **umbrella planning
doc** ([write-planning-doc.md](write-planning-doc.md)) that lists everything found, clusters the
items that touch the same code or the same idea, and scores each cluster on **effort, value and
risk** — value and ease pick the order, risk can veto.

**Verify each finding before you score it.** Every finding a subagent or a tool hands you is a
claim: re-run the grep, re-read the code at today's line numbers, check the tool's hit is not a
false positive. Both times this kind of audit has been run here, the first draft was materially
wrong in places — including one item that proposed re-introducing a change the code's own header
said had been deliberately reverted. Review is not a substitute: a reviewer checks the plan you
wrote, not the greps you didn't run. Assume any line numbers in the audit are already stale, and
locate everything by content.

**And the proposed fix is a claim too — verify it separately.** A finding can be entirely true while
the fix beside it is wrong, and that is the easier mistake to miss, because the evidence you just
checked was for the finding. The first run of this doc found three identical copies of a query, each
comment calling itself "the third copy", none of them tested — all true — and proposed a test pinning
the three together. Greping the genre then found a fourth relative that was **already extracted,
already exported and already tested**: the copies had a home built for them and nobody had moved
them. The planned test would have been machinery whose only job was to protect duplication. Before
you build a fix, ask what already exists that it duplicates.

Tiers that have worked, and a good default:

- **Tier 0 — live defects you tripped over on the way.** Not cleanup. Do these first, red test
  first, and say so in the plan.
- **Tier 1 — cheap, mechanical, evidence in hand.** Dead code, N copies of one fix, a false comment,
  an unset variable that made half a defence inert. High ratio, low drama.
- **Tier 2 — the extractions worth doing.** Each gets a test *before* the extraction, and its own
  review.
- **Tier 3 — the rearchitectures.** Each is its own job with its own plan; the umbrella doc's role
  is to name it, size it, and stop.

Get the umbrella doc reviewed before building anything from it. Then do one or more clusters. If you
run them in parallel, the constraint is **non-overlapping file sets**, not independent ideas —
clusters that sound unrelated often share a file, and in a shared tree you have peers' uncommitted
work to route around too ([git-commit-changes.md](git-commit-changes.md)).

## Stages that can stop

Every stage ends committable, green and deployable — [engineering-manager.md](engineering-manager.md)
says that, and here it is the whole design constraint. For a rearchitecture the shape that gives it
to you is the boring one: **add the new thing beside the old, move callers in batches, delete the
old.** Each batch is a stage. If a stage would leave two ways to do the same thing, that is
tolerable only when the plan and the commit message say which one wins and when the other dies.

Two traps live in that window, and they are where this exact recipe has gone wrong before. **While
both paths exist, a fix must land in both** — in a batched migration, drift is *created* by a fix
landing in the original after the copy was taken. And **before the delete stage, grep for callers of
the old path** rather than trusting your batch list: a missed caller keeps working, silently, on the
code you believe is dead.

If you cannot see how to stop halfway, the job is not staged yet. Say so rather than starting.

## Not breaking it

A refactor is where [silent-success.md](silent-success.md) bites hardest, because the behaviour is
already correct, so there is no red test to write first. The substitute:

- **Characterise before you change.** Write tests against the *current* behaviour, then prove they
  can fail — break the code on purpose and watch them go red. A test that has never failed is not
  covering the thing you are about to move.
- **Pin the invariant, not the scaffolding.** Assert what any correct implementation must satisfy,
  not the way today's code happens to achieve it, or the test dies with the code it was describing.
- **If the behaviour you are about to pin looks wrong, that is a Tier 0 finding, not a spec.**
  Characterisation enshrines defects otherwise — a broken reply once got stored as a legitimate
  answer, and there was a test blessing it. Stop and file it.
- **An existing test going red is evidence, not an obstacle.** The change that makes your new test
  green is not automatically the right change, and the test that objects may be the one holding the
  requirement. Read what it asserts before you touch it.
- **Extract without changing behaviour in one commit; change behaviour in another.** A diff that
  does both is unreviewable, and hides the bug in the noise.
- **Delete the old path.** A refactor that leaves the old code behind "just in case" has doubled the
  surface. If it is genuinely unsafe to delete, that is a finding for the plan.

## Reviews and second opinions

The review cadence is [engineering-manager.md § GPT Sol](engineering-manager.md#gpt-sol) — the plan
before you build, every stage at its end, evidence rather than your account of it. Three things it
doesn't say:

- **Escalate the hard calls to Fable** (a subagent with `model: "fable"`) as well — a Tier 3
  boundary, two designs that both work, a claim you can't settle.
- **Ask explicitly whether a proposed abstraction is worth its keep.** Reviewers are good at this
  and will not volunteer it; asked directly, they will tell you the extraction is not worth the
  indirection.
- **Research how the shape is normally solved** before inventing your own, in a subagent — but treat
  what it finds as options, not obligations. Most best-practice advice is written for larger teams
  and longer-lived code than yours, and importing it wholesale is the commonest way this work turns
  into over-engineering.

## Along the way

- **Update the docs in the same stage**, and delete the false comments you found — they are half the
  findings, and one left behind is one the next agent believes.
- **Write the postmortem** for any real bug this turns up, and then do what it says, now
  ([engineering-manager.md § Bug-mode](engineering-manager.md#bug-mode)).
- **Record what you decided not to do, and why.** The umbrella doc's list of rejected items is worth
  as much as its list of accepted ones, and saves the next agent rediscovering them.
