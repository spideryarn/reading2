# The safe helper was private, so three boundaries wrote the unsafe spelling

Found 2026-09-06 by GPT Sol, reviewing the code for
[260905h](../plans/260905h-a-mode-failure-should-leave-the-article-readable.md) (finding F10). Not a
production incident: nothing is known to have thrown a non-`Error` in the reader. The reason it is
worth a file is the shape, and the fact that the fix was written down **ten hours after the bug, in
the same module, and never reached back**.

## What was wrong

React's `componentDidCatch(error: Error, info: ErrorInfo)` declares an `Error`. The runtime does not
enforce it: React hands the handler **the thrown value, unchanged**, and `throw null`, `throw "nope"`
and an object whose `name` getter throws are all legal JavaScript. So this line, in a boundary's
handler —

```ts
recordLog({ kind: "client-error", source: "boundary", name: error.name });
```

— throws a `TypeError` **inside the handler**, on a path that only runs when something is already
broken.

The consequence is worse than a lost log line, and different in each of the three boundaries:

- **`AppBoundary`** is the outermost one. A second throw out of its handler has nothing above it to
  catch it, so React unmounts the whole tree: an empty `#root`, no message, nothing in the tab but
  the background colour — **precisely the state that boundary was created on 2026-08-27 to prevent.**
- **`FeatureBoundary`** (added in 260905h) escaped upward into `AppBoundary`, which replaced the whole
  reader — the containment failing in exactly the case it exists for. Worse, the retirement of the
  activation token sat *after* the log line, so it never ran, leaving a press that a later Back could
  spend on a paid job.
- **`ChunkBoundary`** in `LazyPage` degrades a `[chunk]` "part of the app didn't arrive, reload"
  into the generic `[render]` apology.

## The real root cause

Not that somebody forgot. **The correct helper already existed, in the same file the boundaries
import `recordLog` from, and it was module-private.**

`src/web/log-buffer.ts` § `nameOfThrown` guards the read, catches a throwing getter, and returns
`"Error"` for anything else. Its own docstring names the hazard exactly:

> `event.error` is whatever was thrown, which need not be an `Error` at all: a string, a number,
> `null` on a cross-origin script failure, or an object whose `name` getter throws.

So the hazard was understood and solved. It was solved for `watchUncaughtErrors`, in the same
module, and left unexported — while forty lines away in the import graph three boundaries went on
writing `error.name`, because that was the only spelling a caller outside the module could see, and
because the type signature invited it.

### The order it happened in

| When | What |
|---|---|
| 2026-08-27 `b8745a07` | `AppBoundary` created. It calls only `captureClientFailure(error, …)` — whose parameter is `unknown` and whose body is wrapped in `try`/`catch`. **Safe by construction.** |
| 2026-09-01 00:08 `d1b9db0e` | The client log buffer lands. `AppBoundary` gains `recordLog({ … name: error.name })`. **The defect, and it is one line.** |
| 2026-09-01 10:22 `54ec2d2c` | Ten hours later, `nameOfThrown` is written in `log-buffer.ts`, with the docstring above. Private. The call site added that morning is not revisited. |
| 2026-09-05 `d86810ed` | `FeatureBoundary` is written by deliberately following `AppBoundary`'s conventions, and copies the line. |
| 2026-09-06 | `ChunkBoundary` in `LazyPage` does the same. Third copy, written while this postmortem's own bug was being fixed in the other two. |

Note the first row. The **defensive** neighbour was already there: `captureClientFailure(err: unknown)`
takes the widest type and swallows its own failures. The new line, one statement below it, trusted
the parameter's declared type instead of copying the caution of the call above it.

## The class, named

**The reachable spelling is the unsafe one.**

A module understands a hazard, solves it internally, and exports only the thing that *needs* the
hazard solved. Every caller outside then writes the naive version — not through carelessness, but
because the naive version is the only one in scope, and usually because a type annotation makes it
look fine. The safe version and the unsafe version live in one file, and which one you get depends on
whether you happen to be inside it.

It has a propagation mechanism, and this repo supplies it: the house style says *follow the
conventions of the file that did this first*. So a defect in the exemplar is inherited along with its
virtues, comment and all. That is the same shape as
[260901c](260901c-the-success-signal-that-outlived-its-witness.md), where one wrong sentence was
copied verbatim into six files over six days. Here it was one property read into three.

## The fix that is right for the long term

Not three hand-rolled guards. Two of those had already been written by the time this was understood —
one in `AppBoundary`, one in `FeatureBoundary` — which is two implementations of one idea, and the
third boundary still had none.

**Export `nameOfThrown` and make it the only way a boundary turns a caught value into a log name.**
Every handler becomes one line with no property read in it, the reasoning lives in one place, and the
unsafe spelling stops being the reachable one. Done in this run, along with the deletion of both
hand-rolled copies.

Also kept, from the same review: in `FeatureBoundary` the **activation retirement now runs before any
diagnostic**. Money before telemetry — a report that fails should never be able to cost the reader a
model call.

## What would have caught the whole class

Ranked by ease against value. The first two are done in this run.

1. **Export the helper.** One keyword. It removes the only reason a call site had to write the read
   itself, and it is the whole of the structural fix. *Highest value for the least work by a wide
   margin — and available since 2026-09-01.*
2. **A sweep test: no `componentDidCatch` in `src/web/` reads a property off its caught parameter.**
   One test, and it is the thing that catches boundary number four before it is written. Landed as
   `tests/no-boundary-reads-the-caught-value.test.ts`, walking the AST rather than grepping
   (`tests/helpers/ts-ast.ts`), in the shape `tests/feedback-payload.test.ts` already established
   when it sweeps `src/web/` for `this.name =`.

   Two details that are the difference between a guard and a decoration. It asserts it found
   **exactly the three known boundaries, by name**, so a fourth reddens it on arrival and a walk that
   silently stops matching reddens it too, rather than passing vacuously — verified both ways, by
   putting `error.name` back and by stubbing the finder to return nothing. And it rejects *reading a
   member off* the caught value while still allowing it to be **passed on**, because
   `captureClientFailure(err: unknown)` is exactly the safe sink it should be handed to.
3. **A `throw null` case in every boundary's behavioural test.** A few lines each, and it proves the
   containment rather than the spelling. Weaker than (2) only because it is per-boundary and so
   relies on somebody remembering; stronger in that it tests what the reader actually sees.
4. **Declare the handlers `componentDidCatch(error: unknown, …)`.** TypeScript's method-parameter
   bivariance should permit widening an override, and under `strict` it would make `error.name` a
   compile error at every site — the type system refusing the mistake instead of a test finding it,
   which is what [typechecking.md § The flags, and why](../project/typechecking.md#the-flags-and-why)
   asks for. **Not attempted here and not verified**; worth twenty minutes if anyone adds a fifth
   boundary.

The general form of (1), which is the part worth carrying to other files: **when you write a guard
against a hazard, ask who else is exposed to it before you make it private.** The docstring on
`nameOfThrown` was already a better explanation of the danger than anything the three call sites had.
It just could not be reached from them.
