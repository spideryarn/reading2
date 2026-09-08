# `run-codex` sends a large prompt on stdin instead of dying at execve

`npx tsx scripts/run-codex.ts --prompt-file <big>` fails with `spawn E2BIG` before codex starts.
It cost a 45-minute review cycle on 2026-09-08, and the fix is in the wrapper rather than in the
habits of the people who use it.

> Can we fix the root cause so that we don't need the doc?
>
> — Greg, 2026-09-08

That instruction is the whole shape of this piece of work. The alternative on the table was a
paragraph in [codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md) warning that
`--prompt-file` does not mean what it says. **A warning about a trap is worth less than not having
the trap**, and this one is cheap to remove.

## What actually happens

`buildCodexArgs` puts the prompt in argv, as the last element after `--`. Linux caps a **single**
argv element at `MAX_ARG_STRLEN` — 32 pages — regardless of how much room the rest of the command
line has. Bisected on this box against `/bin/true`, so the measurement is about `execve` rather than
about codex:

```
argv ceiling for ONE argument: ~125 KB (fails at ~129 KB), code E2BIG
the review prompt that failed:  138 KB
```

**This is not an edge case.** A code-review prompt carrying a scoped diff crosses 128 KB easily;
the one that failed was 2,993 lines, which is an ordinary size for a stage of work.

### Two things make it worse than an ordinary error

- **The failure is at `spawn`, so nothing is written to `--output`.** And a *killed* codex run does
  write its answer file — [memory, 2026-09-06]. So neither "the answer file exists" nor the exit
  code distinguishes the two, and both look like a review that found nothing.
- **The flag is called `--prompt-file`**, which reads as a promise that the file is what travels.
  It is not; the file is read and its contents are pasted into argv.

The knowledge was already in the file. The dry-run branch carries the comment *"the command stops
being copy-pasteable at that size anyway (argv has its own limit)"* — written by somebody who knew
the limit existed and did not connect it to the path a real run takes.

## The spike

Six arms, real `codex exec` runs against a one-word prompt, padded with an HTML comment so the
padding cannot change the answer. `evals`-style: the point is what the numbers say, not that it
exited zero.

| arm | outcome |
|---|---|
| argv, small | exit 0, 6.0s, `OK`, **10,675 tokens** |
| **argv, 200 KB** | **`spawn E2BIG` in 4 ms** — the bug, reproduced |
| stdin from a file fd, small | exit 0, 5.5s, `OK`, no wedge |
| **stdin from a file fd, 200 KB** | **exit 0, 7.1s, `OK`, 110,647 tokens** |
| stdin from a pipe we close, small | exit 0, 5.2s, no wedge |
| stdin from a pipe we close, 200 KB | exit 0, 6.9s, `OK`, no wedge |
| **stdin from a pipe we never close** | **wedged the full 60 s, SIGKILL, no answer file** |

**The token count is the evidence, not the exit code.** 110,647 against 10,675 is the 200 KB
actually reaching the model; an exit of 0 would have been just as consistent with codex quietly
receiving nothing. Same standard as the dictation vocabulary probe elsewhere in this repo: the
answer has to change, because a success status is what a silently-dropped field also produces.

### What the last arm settles

The wrapper's header calls `stdio[0] = 'ignore'` *"the load-bearing anti-hang guarantee"*, and the
last arm shows the hazard is real rather than folklore: a pipe nobody closes wedges until it is
killed, with no answer file and no error.

**So a file descriptor on a real file is strictly safer than a pipe**, and that is an asymmetry
rather than a preference. A file EOFs because it has an end; a pipe EOFs because somebody remembered
to call `.end()`. The failure mode of the first is nothing, and of the second is a permanent hang in
a wrapper whose whole selling point is that the hang is impossible by construction.

## The decision

**Option A: always stdin, from a wrapper-owned regular file.** No threshold, no size check, one
path. GPT Sol's design review
([260908g-run-codex-large-prompt-design-sol-1548.md](260908g-run-codex-large-prompt-design-sol-1548.md))
recommended exactly this and its reasoning is the reasoning below.

The invariant `subagent-cli.ts` now states, replacing *"stdin is closed"*:

> fd 0 is never inherited. It is either closed, or attached to a finite, already-complete regular
> file that must reach EOF.

**"Close fd 0" was never the real rule.** The rule is that fd 0 must reach EOF, and closing it is
one way of satisfying that. A complete file is another, and it removes the argv ceiling as a side
effect — one change answering both problems rather than a special case bolted beside the guarantee.

Shaped as `ChildStdin`, a two-arm union rather than Node's `StdioOptions`, so `'inherit'` and
`'pipe'` are **not spellable** at that call site. Making the field required rather than optional
made the compiler name every caller, which is how `run-claude.ts`'s two came to be looked at.

`--prompt` goes the same way as `--prompt-file`. Uniformity: two invocation paths would mean two
sets of semantics depending on which flag somebody typed, and the rare path is always where the
latent bug lives.

### The trap in the fix, which the review caught before it was written

**An fd carries a file offset, and the child shares it.** Attempt one reads the prompt to EOF and
leaves the offset there; attempt two, handed the same descriptor, reads **nothing**. Codex would be
asked to review an empty instruction and would answer something plausible — exit 0, an answer file,
no error — so the retry that exists to rescue a credential failure would silently become a review of
no code at all.

`runPlan` therefore reopens the path per attempt and closes in `finally`. Proved by mutation: with
one shared fd, the regression reports `expected +0 to be 204817`.

### What did NOT change

- **`--prompt` keeps the 128 KB ceiling**, because it arrives in *this script's own* argv. Nothing
  the wrapper does can help, and both its header and the reusable doc now say so. `--prompt-file` is
  the interface for anything large.
- **`run-claude.ts` still closes fd 0**, and therefore still has argv's ceiling. `claude -p` takes
  its prompt positionally and offers no `-` sentinel, so the fix does not transfer. Nobody has hit
  it; it is written down rather than fixed.

## What it cost the documentation

The whole point. [codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md) § 1 carried an
aside telling you to redirect a finite file *"if you're deliberately feeding a prompt too large for
argv"*. That is now what the wrapper does, so the passage describes **how it works** instead of
warning about a trap — and it keeps the two facts anybody building another wrapper would need:
`-` must be the sole positional, and a descriptor carries an offset.

Greg, 2026-09-08: *"Can we fix the root cause so that we don't need the doc?"*

## What the fix must not break

- **`stdio[0]` never becomes an inherited or open-ended pipe.** That is the guarantee above, and the
  last spike arm is what it costs to get wrong.
- **A prompt beginning with `-` is still a prompt.** Today `--` does that; on stdin the question does
  not arise, but the property has to survive whichever path is taken.
- **`--dry-run` still prints something a person can paste.** It currently does
  `codexArgs.slice(0, -1)` on the assumption the prompt is the last element, which stops being true.
- **`codex exec` must not receive a prompt on argv *and* on stdin.** Its own help says stdin is then
  appended as a `<stdin>` block, which would silently double the prompt.

## The tests, and the two that were wrong first

Both live in `tests/run-codex.test.ts`, spawn the wrapper for real against a stand-in codex, and
need no model, network or credential. Both were **watched failing against the reintroduced bug**,
which is the only reason either is evidence:

| | mutation | what it printed |
|---|---|---|
| a 256 KB prompt arrives byte for byte | prompt back on argv | `expected 'run-codex: spawn E2BIG' not to contain 'E2BIG'` |
| the second credential attempt gets the whole prompt | one shared fd | `expected +0 to be 204817` |

**The second test passed against the bug twice before it worked**, and both reasons are the same
family as everything else found today — the check sharing an assumption with the thing checked:

1. **It had an escape hatch.** *"No second attempt means this box has no `CODEX_API_KEY`, so
   return"* — which fired, skipped its own assertions, and reported green. `CODEX_API_KEY` is now
   passed explicitly and the two attempts are asserted rather than assumed.
2. **Its stand-in read `wc -c < /dev/stdin`.** On Linux `/dev/stdin` is `/proc/self/fd/0`, and
   opening it for a *regular file* creates a fresh open file description **at offset 0** — so the
   redirect re-read the whole file however far fd 0 had advanced, and could not have observed an
   offset bug in principle. Reading fd 0 as inherited is what codex does and the only version that
   can fail.

## The test that would have caught it

`tests/run-codex.test.ts` already has `fakeCodex`, which writes a shell stand-in and spawns it for
real. A prompt over 128 KB, asserted to arrive intact, **would have gone red on the original code
and costs nothing to run** — no model call, no credential.

The existing tests could not have caught it, and the reason is worth keeping: they assert the
*shape* of the argv, and the argv's shape was correct. It was merely too long to hand to `execve`.
A test that checks what a command line says will never find a limit on how much it may say.
