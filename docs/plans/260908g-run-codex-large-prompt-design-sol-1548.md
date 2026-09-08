I’d build **A**, using a wrapper-owned regular file descriptor—not a pipe.

The invariant should become:

> fd 0 is never inherited. It is either closed, or attached to a finite wrapper-owned regular file that must reach EOF.

That preserves the real anti-hang guarantee while removing the argv ceiling entirely. I would not use a threshold, and I would not add D’s size check: once the prompt is on stdin, its size is unrelated to `spawn E2BIG`. If spawning still returns `E2BIG`, the likely cause is total argv/environment size and the error should say that.

### Proposed shape

- `buildCodexArgs` no longer accepts or contains the prompt. End argv with `--`, `-`.
- Both `--prompt` and `--prompt-file` become a wrapper-owned temporary prompt file.
  - Copy `--prompt-file` byte-for-byte rather than decoding and re-encoding it.
  - Write `--prompt` as UTF-8.
  - Keep the snapshot private, ideally mode `0600`.
- Make `runChild`’s stdin choice explicit and narrow, for example:

  ```ts
  stdin: { kind: 'closed' } | { kind: 'file'; fd: number }
  ```

  Don’t expose Node’s complete `StdioOptions`, because that would allow `'inherit'` or an unclosed pipe.
- `runCodex` opens the prompt snapshot afresh for each attempt and closes its fd in `finally`.
- Claude and the auth probe explicitly use `{ kind: 'closed' }`.

This changes the claims currently made in [run-codex.ts](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/scripts/run-codex.ts:5) and [subagent-cli.ts](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/scripts/subagent-cli.ts:204), but it agrees with the exception already documented in [codex-cli-as-subagent.md](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/docs/reusable/codex-cli-as-subagent.md:339).

### Is a file fd safe?

Yes, provided it is an already-complete regular file. Reading it eventually returns EOF regardless of whether the parent still has its read descriptor open. There is no writer whose lifetime can accidentally keep the input open.

A pipe plus `child.stdin.end(prompt)` can also be made correct, but it adds failure surfaces:

- forgetting or failing to call `end()`;
- handling `EPIPE` if Codex exits early;
- backpressure and buffering for genuinely large inputs;
- more lifecycle coupling between the child and the wrapper.

The regular file is simpler and safer here.

One important trap: **do not reuse the same open fd across auth retries**. The first Codex process advances its shared file offset to EOF; the second would receive an empty prompt. Reopen the path for every attempt in [runPlan](/home/greg/code/spideryarn2/.claude/worktrees/fleet-dictation/scripts/run-codex.ts:426).

### Other A failure modes

- Never pass a real positional prompt alongside stdin. Otherwise Codex appends stdin as a `<stdin>` block. `-` is only the stdin sentinel; assert that it is the sole positional argument.
- A leading `-`, embedded newlines, Unicode, and no trailing newline are all naturally safe.
- An empty file produces immediate EOF and cannot hang. Codex may reject an empty instruction, but that is an ordinary CLI result. Preserve or deliberately tighten today’s behavior separately.
- `-` is documented by the installed Codex 0.153.4 as supplying the initial instructions from stdin. The `<stdin>` append behavior applies when a separate prompt is also supplied.
- Clean up the prompt snapshot after all retries. If the wrapper is killed hard and leaves it behind, the private temp directory/file permissions matter.
- `--dry-run` needs a new representation: show `codex … -- -` plus the stdin source and byte count, rather than pretending the prompt is an argv element.
- A huge `--prompt` can still fail while launching the wrapper itself because it arrives in *run-codex’s* argv. That is unavoidable; `--prompt-file` remains the arbitrary-size interface.

### Should inline `--prompt` also use stdin?

Yes. Its normal inputs are small, but retaining a second Codex invocation path buys little and leaves different semantics depending on which wrapper flag was used. Uniformity is worthwhile here.

### The regression test

Use the existing stand-in Codex and exercise the wrapper end-to-end:

1. Write a 256 KiB prompt file—large enough to cross Linux’s one-argument ceiling. Include a leading dash, multibyte text, and no final newline.
2. Launch `scripts/run-codex.ts --prompt-file …` with the fake Codex on `PATH`.
3. Have the fake Codex run an exact byte comparison between stdin and the original file, then write its answer only after the comparison succeeds.
4. Assert wrapper exit status `0` and the expected answer.

That test fails against today’s implementation at the real `spawn` boundary with `E2BIG`; it requires no model, network, or credentials. It also proves EOF arrived because the comparison cannot finish otherwise.

Keep the argv unit assertion too—argv ends in `--`, `-` and contains no prompt—but treat it as a supporting test.

Add one second regression for the subtle retry case: make attempt one consume and verify stdin, then emit the recognized subscription-credit error; make attempt two consume and verify it again before succeeding. That catches accidentally reusing the fd at EOF.