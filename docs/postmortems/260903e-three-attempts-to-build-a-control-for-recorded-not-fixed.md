# Three attempts to build a control for "recorded, not fixed" — and why none of them shipped

Not a bug. A sweep, asked for by Greg after
[260903c](260903c-quiz-band-quota-refused-a-good-batch-and-its-error-reached-the-reader.md):

> A written-down defect with an unchanged default is a defect with a paper trail, not a mitigation.
> There are a few other "recorded rather than fixed" notes in the docs; they're probably worth a
> sweep at some point.

This file exists because the sweep's most useful output was **three retractions**, and a retraction
that only lives in a plan doc is the thing this whole exercise is about.

## The class, which was not new

**A written-down defect with an unchanged default.** Ten postmortems already name it —
`260827b`, `260828a`, `260828e`, `260828f`, `260901a`, `260902c-truncation`, `260902e`, `260903b`,
`260903c-quiz`, `260903d` — and it has a reusable doc,
[written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md), **written before four
of those recurred against it.** `260902b` had already drawn the conclusion: *"the prevention cannot
be another paragraph… The only prevention that works here is mechanical."*

So the question was never "what is the class". It was "what is the mechanism". Three were proposed
and all three were wrong.

## Attempt 1 — a register. Killed by Fable.

`docs/known-defects.md`, every deliberately-unfixed defect with its code location, plus a test
failing when a marker has no entry and when an entry names dead code. It looked like exactly what
`260902e` asked for — *"something that can go stale loudly"*.

**Why it fails:** it institutionalises the substitution it is meant to prevent.

> A register makes recording the *sanctioned endpoint* of finding a bug.

And it fails on the case that motivated it. The quiz author did not fail to *find* the note in
`copy.md`; they wrote fresh code that fell into the default. **Fresh code consults nothing.** No
register would have been read.

## Attempt 2 — `DEFECT:` pinned tests. Killed by GPT Sol.

Fable's replacement: a deferral must leave behind something that runs — a normal test, named
`DEFECT:`, asserting what the code does *today*. `grep -rn "DEFECT:" tests/` becomes a register
nobody maintains. Fable conceded it was *pressure-neutral*: it fires when the defect is fixed, not
when it matters.

**Sol found it is worse than neutral:**

> It remains green while the defect harms readers. It goes red when somebody fixes the defect. It
> converts a known defect into suite-approved expected behaviour. That is not merely
> pressure-neutral; it risks **normalising** the defect.

And it failed on its only candidate. `src/collect-assets.ts:52` was offered as an example — *"no
per-host throttle… a limit that has quietly stopped being one"* — with a claimed ~400-request burst.
There is a **process-global concurrency gate admitting two**, and the existing test already proves it.
A pinned test there *"would institutionalise a defect that has not been demonstrated."*

(Vitest's `test.fails` was separately rejected: it passes on *any* throw, so a test failing for an
unrelated reason still reports the defect as pinned — [silent-success.md](../reusable/silent-success.md).)

## Attempt 3 — a positional rule. Killed by the evidence.

An audit of all 57 postmortems reported that the top-ranked prevention was built in ~44 of ~50, and
concluded the failure was **positional**: top item lands, everything below it does not. The rule
drawn from it: *do items 2-and-below in the same commit or not at all.*

**Sol spot-checked four postmortems and the pattern did not hold.** The decisive counterexample is
`260901d` — the audit's own strongest evidence — where **#1 is open, #3 landed, #4 is open**. A lower
recommendation landing while the top one did not is the inverse of the claim. `260902c-laptop` landed
all five; `260903c-cache` has all five open.

"The first recommendation often lands" survives. The causal story does not, and neither does the rule.
Sol also caught the plan contradicting itself: it proposed `260830d`'s *lower-ranked* test-count guard
while that postmortem's two named long-term fixes stay open (`src/web/params.ts:26` still
value-imports component modules).

## What was actually built

No machinery. Sol's scope verdict, accepted:

> For this alpha, build **no new universal machinery yet**. Fix the confirmed defects, distinguish
> defects from accepted limitations in postmortems, and revisit tooling only after two or three real
> deferrals reveal a common executable shape.

Five confirmed defects instead —
[260903e](../plans/260903e-sweep-recorded-rather-than-fixed-defects.md) has them.

The one durable qualification worth keeping, from Sol, because it retires the "just log it" reflex:
**a log line is not observable merely because it exists.** The quiz deferral named a trigger that
reached only the Vercel log, which
[sentry-error-monitoring.md](../project/sentry-error-monitoring.md) says outright nobody watches.

## The real finding: the control is not knowledge

Four instances of this class were produced **during** the work, by people who had just read the
postmortem naming it:

1. `src/quiz.ts` — a comment claiming the diagnostic *"goes to the log and to Sentry"*. Measured: as
   free text it is `withheld: true` and the numbers never arrive. Written by the author of
   `260903c-quiz`, the day after writing it.
2. `src/quiz.ts` — that deferral's named trigger, `dropped.overCap`, absent from the only line that
   fires when it fires.
3. The sweep plan itself proposed a one-line fix that a comment forty lines from the function
   forbids, because a subagent's report was trusted over the code — one section after the plan wrote
   down that a scanner cannot distinguish a live deferral from a settled decision.
4. A subagent ran `npm test | tail -60`, read `[exited with code 0]`, and caught itself: that is
   `tail`'s status. This is [260831c](260831c-the-exit-status-that-belonged-to-tee.md), already
   written up here. Its own words: *"This plan's own subject, in the check I ran to verify the plan's
   own subject."*
5. **The fix for (2) shipped a false causal claim, and the end-of-stage review caught it.** The new
   diagnostic said a non-zero `overCap` meant *"the deferred bug in `toQuestions` manufacturing this
   failure rather than the model"*. It does not: `overCap` counts raw elements the cap never
   **examined**, which may be malformed, duplicate, unanchored, or the wrong band. Sol reproduced it
   with twelve valid `easy` questions and one malformed `{ band: "hard" }` — `overCap: 1`,
   `malformed: 0`, and a diagnostic asserting a cause it cannot support. **The accompanying test
   injected `overCap: 4` directly rather than obtaining it through the cap, so it could never have
   caught this.** A number was made observable, per the rule this run adopted, and the sentence
   explaining it was invented in the same breath.
6. **A severity claim inflated in transit.** This work described the `pdf-read` defect as "a
   permanent trap: an article that can never be read again". `260828e`, its source, says of that
   same instance: *"it is a silent wrong rather than a permanent trap."* The original was careful and
   the summary of it was not — the ordinary way a claim inflates, by a second writer compressing a
   hedge out of a sentence they did not re-read. Two of the three assertions in the inflated version
   were also independently false.

`260901c` had said it plainly and it went unheeded: *"`silent-success.md` is loaded into every agent's
awareness and all three shipped anyway… So awareness is not the control."*

**What did work, three times out of three: a different model reading the plan before it was built.**
Fable killed attempt 1. Sol killed attempts 2 and 3. `260902e` was found the same way — by Sol
reviewing an unrelated plan, not by any check. That is already the house rule in CLAUDE.md, and the
honest conclusion is that it is the control, and it does not need a new rule written next to it.

## What would have caught it — ranked by ease and value

1. **Free, high value — send the *mechanism* to another model, not just the plan.** All three bad
   mechanisms here died in review, and cheaply. The failure mode was inventing a control and finding
   its flaw four hours later, not shipping one. Instance 5 says the same about code: the false causal
   claim was found by the end-of-stage review, which the house rules already make obligatory.
2. **Cheap, high value — when a deferral names a trigger, open the file the trigger fires in and look
   for the number.** Two of this run's instances were exactly this, both catchable in thirty
   seconds. Generalisable: *a deferral's trigger is a claim about a channel, and channels are
   checkable.*
3. **Cheap, high value — a test that injects the value it is checking cannot check the value.** The
   `overCap` test set the counter by hand and asserted the formatting, so the semantic error behind it
   was invisible. **Obtain the number the way production obtains it**, or the test is about the
   sentence rather than the fact. This is [silent-success.md](../reusable/silent-success.md) narrowed
   to one habit, and it is the cheapest item on this list.
4. **Cheap, medium value — verify a subagent's finding in the file before acting on it.** Of the
   automated findings this run, roughly a third were wrong, all in the same direction: a symptom
   confirmed absent from the file named, without checking whether something else supplied it. Two
   were already-fixed code saying so in the same sentence.
5. **Do not build a register, a `DEFECT:` convention, or a positional rule.** Recorded so the next
   person who has this idea — and it is a very natural idea — finds the three arguments already made.

## Still open, and named rather than deferred

- **`biome.jsonc` → `biome.json` silently discards the whole lint config** (`linting.md:101`), with
  the detection command written in the doc and wired into nothing. A live instance of this class,
  left because it belongs in a tooling plan.
- **`database.md`'s trap heading now overstates its own body**, and renaming it means editing the
  CLAUDE.md pointer that deep-links its anchor — one approved set under
  [edit-important-docs.md](../reusable/edit-important-docs.md). Greg's call.
- **Partial block-id loss is still unflagged** (`src/pipeline.ts:1736`). Sol supplied the
  threshold-free design — intersect lost ids with ids actually referenced by reader data, and refuse
  on one or more rather than on a guessed percentage — and it is a design stage, not a sweep item.
