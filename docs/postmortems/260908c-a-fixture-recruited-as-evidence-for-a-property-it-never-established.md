# A fixture recruited as evidence for a property it never established

**2026-09-08**, in `tools/fleet/` — the agent fleet dashboard
([260907e-agent-fleet-dashboard.md](../plans/260907e-agent-fleet-dashboard.md)). Nothing reached a
Spideryarn reader: this is an internal tool on the box and its only user is Greg. What it could have
cost is the part worth writing down. For about eleven hours the dashboard would type a message onto
the end of somebody's half-written sentence and press Enter on the join — and **a test asserted that
it should**.

## What happened

`sendMessage` in [`tools/fleet/steer.ts`](../../tools/fleet/steer.ts) decides whether a pane may be
typed at. Until 2026-09-08 it established three things: `parsePane` recognised no dialog, there is a
`❯` input prompt on screen, and that prompt has a box border immediately above it and another within
four lines below. **It never read what was in the box.**

So a message sent to a pane with a half-typed sentence in its input box was typed onto the END of
that text, and the second `send-keys` — the Enter — submitted the concatenation as one user turn.

Proved end to end before the fix, on a throwaway session of my own (`ab-dummy-target`, pane `%2433`)
rather than argued from a capture, because *"the parser accepts this pane"* and *"a send would do
harm"* are different claims and only one of them had been measured:

```
box before:  ❯ DRAFT-ALPHA
sendMessage(target, "OMEGA-SENT-BY-DASHBOARD", …)  →  { ok: true, verified: {…}, sent: [2 calls] }
box after:   ❯ DRAFT-ALPHAOMEGA-SENT-BY-DASHBOARD
```

and four seconds later the agent had answered it:

> ● I don't have anything that defines DRAFT-ALPHAOMEGA-SENT-BY-DASHBOARD — it's not a command …
> What would you like me to do with it?

**The dashboard returned a green tick for a user turn neither half of which anybody wrote.**

This is common, not exotic. Two read-only surveys of the live box the same day: **5 of 30 panes** in
the accepting-and-occupied state on the wider sweep, and on the narrower one — the seventeen panes
holding a Claude session with a `❯` on screen — **thirteen empty and four not**. One of the occupied
ones, `%218`, held `yes, shut it all down`: a sentence answering, word for word, a question its own
agent had asked eleven hours earlier, in a session running in auto mode.

**Be exact about which half of that is measured.** The concatenation is measured, on `%2433`. That
`%218`'s line was an unsent draft rather than a hint, or a suggestion the harness offered, is a
strong inference and nothing more: a capture cannot tell whose text it is. That is also why the new
arm is called `occupied-input` — see [the fix](#the-fix-that-is-right-for-the-long-term).

## The class, named

**A fixture proves the property it was captured for. It does not prove the property of the list it
later joins — and joining a list is silent.**

`tests/fixtures/fleet-panes/none-typed-numbered-message-in-input-box.txt` is a real capture of a pane
with a three-line message typed but unsent between the input box's two borders:

```
❯ 1. read the plan
  2. write the test
  3. stop and report
```

It was captured for exactly one reason: to prove that **a numbered list a PERSON typed is not a
dialog menu**, which is the parser's central false-positive risk. It did prove that. It still does —
`tests/fleet-pane.test.ts` asserts it under *"does not mistake a half-typed numbered message for a
menu"*, and that assertion has been correct every day of its life.

It was then added to the list inside a test in `tests/fleet-steer.test.ts` named **"sends to every
real screen that does have one"**, which asserts that `sendMessage` succeeds and issues two
`send-keys` calls for every name in the list.

So the suite did not merely fail to catch this defect. **It held the defect in place.** Had anybody
added an emptiness check before 2026-09-08, that test would have gone red and named this fixture as
the regression. The guard was pointed at the bug.

A second fixture was in the same list for the same reason.
`none-working-with-prose-decisions-list.txt` ends `❯ do all three`, and nobody had noticed — not the
session that wrote the list, not the plan doc, not me reading it twice. GPT Sol found it while
reviewing the plan, by counting.

### Why this name and not the two obvious alternatives

- **"A corpus assembled for one question, reused as the answer to another"** — rejected, because
  reuse is not the mistake and this name condemns the good case along with the bad. These same
  captures are read by four test files asking four different questions, and
  `tests/fleet-launch-mode.test.ts` reading them for the permission mode in the status bar is
  entirely correct. What went wrong is narrower and more specific: a *name* moved into a list that
  asserted something **stronger** than the name had earned, and no step in that move reopened the
  file.
- **"An existence check standing in for a state check"** — a true sub-class, and it is precisely what
  `inputSurface` was: *a box exists* does not entail *the box is empty*. Rejected as the headline for
  two reasons. It names the production defect and not the reason the defect survived a green suite,
  which is the interesting half; and it would fit a hundred null-check bugs, which makes it a
  category rather than a class. It is kept below as the shape of the code half.

The chosen name is a claim somebody could disagree with, and the disagreement is the useful part: it
says that **a fixture's membership of a list is an assertion**, made by hand, about a file nobody
reopened — not a bookkeeping act.

## Why nothing went red

Five things were satisfied, and they are not all the same failure. One of them is *somebody saw this
and wrote it down*, which is a different class from *nobody saw it* and wants a different fix.

1. **The derived corpus loop was green and was right.** `tests/fleet-pane.test.ts` derives each
   fixture's expectation from its filename prefix — `dialog-` must parse as a question, `none-` and
   `refused-` must not — over a `readdirSync`, so adding a fixture is the whole of adding a case.
   That loop has covered this fixture since the hour it landed and has never been wrong about it. It
   could not have caught this: `none-` means *"not a dialog"*, which is true of a pane with a draft
   in its box. **The convention worked. Its vocabulary was one word short of the new question.**
2. **The hand-typed list in a different file was green because it asserted the bug.** Above.
3. **`INPUT_BOX_LINES = 4` hid the frequency, and that is worse than not helping.** A draft of five
   or more visual lines pushes the closing border out of the window, so `inputSurface` refused it as
   `not-at-input` for an entirely unrelated reason. The long drafts — the ones somebody would notice
   — were refused; only the short ones got through. **A guard that makes a bug uncommon is not a
   guard against the bug**, and here it actively worked against discovery: it converted a constant
   failure into a rare one, and rarity is what let this live inside a suite that was green.
4. **The type could not have helped, because there were no arms to be exhaustive over.**
   `inputSurface` returned an ok/reason pair. No union, so no `never`, so nothing anywhere that
   forced a person to decide what an occupied box means.
5. **Somebody DID see it, wrote it into the code, and was right to defer it.** `inputSurface`'s own
   comment, before the fix:

   > **A box with a draft in it is still a box.** This says the surface takes text; it does not say
   > the surface is empty. Text sent to a box someone has half-typed into is appended to their draft
   > and submitted with it. That is a real defect and it is not this function's — it wants a product
   > decision about what to do, not a tighter predicate.

   That is accurate, and the deferral was defensible: it genuinely was a product decision, and it
   genuinely got made a few hours later. **The failure is that a known defect, written down in a
   comment, sat a few hundred lines from a test asserting the defect was correct behaviour, and
   nothing connected the two.** Prose cannot fail
   ([written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md)). The move available
   at that moment was not "fix it now" — it was one line in the test list marking those two fixtures
   as known-bad members, which would have gone red the day the emptiness rule landed and would have
   been read by the next person to touch the list.

## Which commit introduced it

Both halves are traceable, and they are the same author in the same Claude session, an hour and forty
minutes apart on one night.

- **The fixture arrived in `8215d60f`**, 2026-09-08 02:36, *"The page shows what a blocked session is
  asking, and pushes it live"*. Its message states the property the capture was for, and states it
  well:

  > The most valuable fixture that agent gathered is one it made by accident: typing a multi-line
  > numbered instruction into Claude Code's input box renders with a cursor, a consistent digit
  > column and a contiguous run -- every structural signal a real menu has. Only the footer key-hint
  > line separates them.

  That is the whole property, correctly stated. It says nothing about emptiness, because emptiness
  was not the question being asked.
- **The list arrived in `e2715c4f`**, the same day at 04:16, *"Checkpoint tests/fleet-steer.test.ts
  to unblock a fast-forward"* — from the same `Claude-Session` id as `8215d60f`. It added *"sends to
  every real screen that does have one"* with six fixture names, of which two have text in the box:

  ```
  none-working-empty-prompt · none-working-with-lettered-table
  none-working-with-prose-decisions-list          ← ends `❯ do all three`
  none-idle-with-prose-numbered-list · none-dialog-just-answered
  none-typed-numbered-message-in-input-box        ← three lines of draft
  ```
- **The fix is `d3aac321`**, 2026-09-08 13:48, *"Prose stops being established by absence, and starts
  requiring an empty box"*.

The introducing commit's message is half the explanation, as it usually is:

> Not a finished change. A subagent is part-way through hardening steer.ts against four of GPT Sol's
> P0s and this file is moving under it; **its 66 tests pass right now, which is the whole claim being
> made here.** … dev is typecheck-red on one line of routes-steer.ts, waiting for me, and the
> fast-forward that carries the fix is blocked only by this file having local modifications.

The author was under a self-imposed clock to unblock a red `dev` for everybody else, and the claim
being made was a *count*. **A list of fixture names is the fastest way to make a suite look
thorough**: six names, one loop, six assertions, no file opened. That is not carelessness about this
particular fixture — it is what optimising for a green count buys, which is why every countermeasure
below is mechanical rather than a resolution to read more carefully.

## What would have caught it, ranked by ease against value

1. **Derive the corpus's membership instead of typing it — the rule this repo had already written
   down, seven days earlier, for a different corpus.** `tests/fixture-corpus.test.ts`, out of
   [260901b-committed-fixture-corpus.md](../plans/260901b-committed-fixture-corpus.md), opens with
   the finding: **"named slugs are not coverage"** — a slug can survive in a corpus while the
   property it was retained *for* quietly disappears — and therefore that each property is asserted
   *"derived from the bytes rather than maintained as a second prose list that can drift from the
   first."* The `fleet-panes` corpus opened exactly that second prose list anyway, in a different
   file, a week later.

   **Done, in the shipped fix.** `tests/fleet-pane-surface.test.ts` now holds a table of all 25
   fixtures with the arm each must land in, plus `expect(names).toEqual(Object.keys(EXPECTED).sort())`
   against `readdirSync`, plus an asserted count per arm
   (`{ dialog: 16, "empty-input": 5, "occupied-input": 2, unrecognised: 2 }`). A fixture that arrives
   without being classified deliberately fails the suite; one that moves between arms fails it too.

   **Be exact about what it does not close.** The table's *values* are still typed by hand. It makes
   "unclassified" impossible; it does not make "confidently classified wrong" impossible — a new
   capture typed into the wrong arm passes if `paneSurface` happens to agree with the typo. The half
   it closes is the half that bit.

   Generalised, and this is the transferable sentence: **a fixture corpus gets its derivation test on
   the day a second test file starts reading it**, not after something has been asserted about it
   wrongly.
2. **Extend the naming vocabulary when a new property arrives, rather than opening a second list.**
   Free, and it is what the prefix convention is *for*. `dialog-`/`none-`/`refused-` carried "is this
   a dialog". The new question was "is the box empty", and the answer was a hand-typed array in
   another file instead of a fourth prefix or a table beside the loop that already existed. Stated as
   a rule: **if you are typing fixture names into an array, the property you are asserting has no
   home in the corpus yet — give it one.**
3. **Sweep the siblings, because there is at least one still live.** `tests/fleet-launch-mode.test.ts`
   holds four hand-typed fixture lists over this same corpus. One of them is named *"cannot read the
   mode while a dialog is up, on every dialog we have captured"* and lists **six** files while
   **sixteen** `dialog-` fixtures exist on disk. Same shape, open today: a hand-typed list whose
   title claims the corpus. One `readdirSync(FIXTURES).filter(f => f.startsWith("dialog-"))` fixes
   it.

   **Done, in `a9aeaaba`, on the strength of this paragraph — the same commit as this file.** The list is now
   `readdirSync(FLEET_PANES).filter(f => f.startsWith("dialog-"))`, with a floor asserted on the
   count — because a filter that matched nothing would iterate zero fixtures and pass, which is how
   this kind of test dies quietly. It covered six of sixteen and now covers sixteen; all sixteen
   pass, so the hand-typed list was not hiding a failure, only failing to look for one.

   **The reason it is worth calling out separately** is that it was found by writing this file, not
   by the fix. The sweep for siblings is the part of a postmortem that is easiest to skip and
   hardest to justify skipping: the class had been named for about an hour, and there was already a
   second instance of it in the same directory, whose title made the same false claim about the same
   corpus.
4. **A note against each fixture saying what it was captured to prove** — rejected, and honestly
   rather than politely. A `.txt` capture has no comment syntax that does not corrupt the bytes, so
   it would have to be a sidecar file or a manifest — at which point it is a table, and a table
   asserted against the directory is item 1, which is strictly better because it can fail. And
   nobody adding a sixth name to a list of five opens five sidecar files at 4am.

   The sharper version of the same idea is that **the annotation already existed, and was read as a
   category**. The file is called `none-typed-numbered-message-in-input-box`. The person who typed
   that string into a list titled *"sends to every real screen that does have one"* had the
   counter-evidence in the characters they were typing, and read the leading `none-` as the whole of
   its meaning. Annotation does not fix that. Derivation does.
5. **Mutation-testing the guard** — rejected, and the reason is worth keeping. Mutation testing asks
   whether deleting a line makes something go red. There was no emptiness check to delete. **It finds
   code with no test; it cannot find a property with no code**, which is what an absent guard is.
6. **The four-arm union with a `never`** — shipped, correct, and it would not have caught this.
   Exhaustive routing makes the compiler insist every arm is *handled*; it says nothing about whether
   a capture was assigned to the right arm. Named because a discriminated union is this repo's reflex
   answer and it is the wrong thing to credit here.

## The fix that is right for the long term

For the **production defect**, the shipped fix is the right one and I would build it again.
`inputSurface` moves out of `steer.ts` into `pane.ts` and widens into `paneSurface`, a four-arm
union — `dialog | empty-input | occupied-input | unrecognised` — parsed once per capture, with
`sendMessage` switching on it under a `never` and accepting only `empty-input`. New refusal code
`input-not-empty`, HTTP 409, because the request was fine and the box is not what the client thought.
Two functions reading one screen became one, which **deleted** a `parsePane` call rather than adding
one.

The arm is **`occupied-input` and not `drafted-input`**, on Sol's finding, and the name is
load-bearing:

> Calling it `drafted-input` claims provenance the parser does not possess.
>
> — GPT Sol, 2026-09-08

A capture renders a person's half-typed reply, a suggestion the harness offered, and the greyed hint
a never-used session draws in exactly the same pixels. What is true of all three is that the box is
not empty, and that is the only fact the decision needs.

For the **class**, the right long-term fix is not in `tools/fleet/` at all. It is that this repo
already owned the answer — `tests/fixture-corpus.test.ts` and the sentence *"named slugs are not
coverage"* — and did not apply it to its newest corpus. The durable form is item 1 above, and it
belongs where corpora are described rather than in the file every agent loads on every turn.

One thing to be plain about: leaving the emptiness gap open on the morning of 2026-09-08 was
defensible, and the comment saying so was good work. Leaving it open **while a test asserted it was
correct** was not defensible — and nobody made that second decision. It arrived by a name joining a
list.

## The thing I would tell myself

Both halves were written the same night, an hour and forty minutes apart, by one Claude session —
not this one, but the first person is the honest voice for it, because the reasoning is the kind I
would repeat. At 04:16 I was not thinking about that fixture at all. I was thinking about a red `dev`
and a fast-forward I was blocking, and I reached for the cheapest thing that raises a test count: a
list of names I already had in another buffer. I read the prefixes. `none-` meant *the parser says no
dialog*, and I let that stand in for *this is a screen we can safely type at*, which is a different
sentence and a much stronger one. Then I wrote a title over the list — *"sends to every real screen
that does have one"* — that made the stronger claim out loud, and the title is what every later
reader believed.

The belief worth naming, because it is the one that will come back somewhere nothing is watching:
**I thought I was adding coverage, and I was adding assertions.** Every name in that array was a
fresh claim about a file I had not reopened, and two of the six were false. The fixture had been
documenting this bug in plain sight since 02:36 — `typed-numbered-message-in-input-box` says so on
its face — and I filed it under a heading that said the opposite, in the same shift, without ever
looking at it twice.

## See also

- [260908f-prose-needs-an-empty-input-box-not-merely-a-box.md](../plans/260908f-prose-needs-an-empty-input-box-not-merely-a-box.md)
  — the plan, with the live measurement, the placeholder that nearly broke the fix, and Sol's review.
- [silent-success.md](../reusable/silent-success.md) — the parent class. Here the check did not
  merely share an assumption with the code; it was pointed at the defect and defended it.
- [written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md) — why a correct
  comment naming the defect, sitting in the file, prevented nothing.
- [260907c-a-heuristic-promoted-to-a-gate.md](260907c-a-heuristic-promoted-to-a-gate.md) — the
  neighbouring shape: fixtures written in the same sitting as the check, from the same picture of
  what the input looks like, so every one of them proved the check agreed with the author.
- [260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md](260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md)
  — the same tool, the same week, and the same underlying move: a hand-copied list where a derived
  one belonged.
- [260906a-a-red-first-test-defends-the-change-not-the-code.md](260906a-a-red-first-test-defends-the-change-not-the-code.md)
  — why the fix here was written red-first against the fixture that had been asserting the bug.
