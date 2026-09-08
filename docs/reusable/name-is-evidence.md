# A name is evidence, not an identity

Not project-specific. A trap, in the family of [silent-success.md](silent-success.md) but distinct
from it — see the last section.

**When a name is assigned by one mechanism and consumed by another, it is *evidence about* identity.
It has provenance, it decays, and it is not necessarily unique. Code that treats it as identity
addresses the wrong object, and every step succeeds.**

## The purest form, and it arrives from outside

`tmux -t` accepts a session **name** where you meant a handle, and resolves it happily. tmux
reassigns a name when a session dies. So a keystroke aimed at a row somebody read ten minutes ago
lands in whatever now wears that name — and on a box running dozens of agents, that is somebody
else's terminal.

Keep this one at the front, because it shows the shape arriving from **outside**: not a convention we
invented and then trusted, but an interface that offered a name and an identity as the same argument.
Most instances of this class are somebody else's `-t`.

## Four more, none of which looked like the others

- **A name that appears at every depth of a chain counts one thing many times.** Five processes in
  one wrapper chain carried `run-codex.ts`; exactly one carried `codex exec`. A recogniser matching
  the wrapper reports one review five times, and the result reads as a busy system rather than as a
  bug.
- **An id that is set once and never updated is not an id.** A session id written at launch survives
  the conversation it named being replaced. **A uuid that *changes* is evidence; a uuid that *cannot*
  is not.**
- **A name owned by a mechanism will be reasserted by it.** Renaming without clearing the flag that
  marks the name provisional got it renamed straight back by the process that owns provisional names.
- **One row, two names for one thing, trusted separately.** A directory and a branch arrived as
  independent claims off a single record and nothing downstream put them back together: one check ran
  in the directory, another swept by branch.

## The one that is not about identity at all

**A predicate's name is evidence about which question it answers**, and a caller who needs a narrower
question will read the name and get a wider one. Found 2026-09-08 by a cross-family review, before it
shipped:

- `steerableStatus` answers *"may this session be steered at all"*.
- `sendMessage` refuses a pane with a dialog open, because a keystroke there is an approval rather
  than a message.
- A queue drain asked the first when it needed the second — *"can a message be delivered right
  now"*, which is strictly narrower.

So the drain would have leased a queued instruction, been refused by the sending path, marked it
settled, and **destroyed the person's message** — once a minute until the queue emptied, while the
agent sat on one dialog. The author's own account of the root error is the useful sentence:

> I set out to fix a button that says *queued* and means *never*, and designed one that says *queued*
> and means *deleted*. Reusing the first predicate because it was there is how the two got welded
> together.

**Nothing here is an identity, and the class still fits.** The name was assigned by one mechanism —
somebody naming a predicate for its original caller — and consumed by another, and the code did
exactly what it said, to the wrong question. Which widens the rule below: **the thing that has
provenance is not only a name that points at an object, but any name that stands in for a claim.**
Reusing a predicate because its name sounds like your question is the same move as matching a process
by the string in its command line.

## And the compile-time pair, which is the strongest form

- **A brand is a claim that survives the operations which destroy what it claimed.** An intersection
  brand meaning *this value passed the gate* stays attached through `{...value, error: "boom"}` — no
  cast required — on a value that would now fail that gate. The fix is to stop *naming* the value and
  start *holding* it: a non-exported wrapper class with an ECMAScript private field, which is nominal
  rather than structural.
- **`readonly` is the same thing without anybody having invented it.** It is a claim about a
  *reference*, not a property of the *object*: `Object.assign(x, …)` reaches the object, and the
  conversion is shallow anyway, so `x.row.status.secondsLeft = 3600` goes straight through a
  `readonly` two levels up.

Together these are the strongest form of the class, because the brand is a label we chose and
`readonly` is one **the language ships**. So this is not a property of careless systems. It is a
property of labelling: a label is attached to a shape, and an operation that produces a new shape
carries the old label onto it.

**The exit is a change of question, not of code** — Fable, 2026-09-08, ruling on whether to add a
deep freeze:

> `readonly` was never runtime immutability, so asking a reviewer *"is this sound?"* gets the next
> level down every time. Freeze it and the next round finds `structuredClone`-then-forge. That is
> convergence to a known limit, not a chain of misses.

So state the guarantee at its true strength, write the uncovered case down **as uncovered**, and put
the one runtime check at the **use site** rather than at the mint — JavaScript cannot hold a value
still in between, and the use site is the only place where it matters that it did not move. See
[review-prompt-template.md § Give the question a floor](review-prompt-template.md#give-the-question-a-floor).

## The rule

When you match on a name, ask three things: **who wrote it, when, and what would make it stale.**
Prefer a key you can **verify** over one you can only **read**.

**And when you reuse a predicate, read its definition rather than its name** — then ask whether the
question you need is the one it answers, or a narrower one that happens to share a word.

## Why this is not [silent-success.md](silent-success.md)

That doc is about a check reporting success while doing nothing. This is about code that does exactly
what it says, **to the wrong object — or to the wrong question** — every step really did succeed, and
the answer is about something else. They meet only in that both produce a confident, wrong, quiet result.
