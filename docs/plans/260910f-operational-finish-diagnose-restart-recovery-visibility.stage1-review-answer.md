Verdict: refuse commit `cb4c3ba7` on two established P1 contract violations. No P0 findings. I could not write the requested answer file because the workspace is read-only; no repository files were changed.

## Findings

### F1 — P1 — established: `dirty` does not mean whether the SHA names the running code

[revision.ts](/home/greg/code/spideryarn2/.claude/worktrees/ops-diagnose/tools/fleet/revision.ts:133) deliberately excludes untracked files, while its comments and [wire.ts](/home/greg/code/spideryarn2/.claude/worktrees/ops-diagnose/tools/fleet/wire.ts:4587) give `dirty` the stronger meaning “the SHA does/does not name the running code.”

I ran three scratch-repository mutations:

- A committed module imported an omitted, untracked `helper.mjs`. The program executed it and returned `42`; the stamp was `known`, `dirty:false`.
- A tracked executable was marked `assume-unchanged`, then changed from returning `1` to `2`. Git status was empty; the process executed `2`; the stamp was `known`, `dirty:false`.
- Only an unrelated tracked Markdown file was edited. The executable still exactly matched the commit and returned `7`; the stamp was `dirty:true`.

Thus:

- “`dirty:false` means exact tracked content” is false for Git index flags such as `assume-unchanged`.
- Untracked or ignored executable inputs make the SHA fail to name running code despite `dirty:false`.
- “`dirty:true` means the SHA does not name running code” is false when the change is unrelated to executable inputs.

Smallest honest change: rename the meaning to `trackedDirty` and use this wording:

> `known` records a HEAD SHA observed during startup. `trackedDirty` records whether Git status reported tracked changes anywhere in the checkout. Neither value proves which bytes the process loaded.

Do not render either arm as “running code matches.” If exact artifact identity is required, run a prebuilt immutable artifact/versioned checkout and stamp that artifact; Git status over a mutable source tree cannot establish it.

Scoping untracked files to `tools/`, `scripts/`, and `src/` is useful as a separate advisory signal, but it is not sound certification: imports cross those boundaries, dependency and ignored files can execute, and the closure changes over time. The honest middle is two facts: a conservative whole-tree certification signal and a separately labelled service-relevant-change signal.

### F2 — P1 — established: SHA and cleanliness are not one snapshot

[revision.ts](/home/greg/code/spideryarn2/.claude/worktrees/ops-diagnose/tools/fleet/revision.ts:128) runs `rev-parse`, then a second Git process runs status at line 133.

In a scratch repository I:

1. Started at commit A with `code.mjs` modified.
2. Let `rev-parse` return A.
3. Committed the modification as B before the status command.
4. Let status observe the now-clean B checkout.

The result was:

```text
status at read: M code.mjs
stamp:          sha=A, dirty=false
HEAD afterward: B, clean
```

The recorded SHA and `dirty` flag describe different repository states. This is especially relevant because the primary is expected to move under services.

Smallest change: obtain the OID and status from one invocation, such as `git status --porcelain=v2 --branch`, parsing `branch.oid`. At minimum, re-read HEAD after status and return `unknown` when it changed. The documentation must still call this a Git observation, not loaded-code identity.

Also, the reads are not literally at process start: ESM’s static dependency graph has loaded before [server.ts](/home/greg/code/spideryarn2/.claude/worktrees/ops-diagnose/tools/fleet/server.ts:133) or [daemon.ts](/home/greg/code/spideryarn2/.claude/worktrees/ops-diagnose/tools/overseer/daemon.ts:644) can execute them.

### F3 — P1 — established from control flow: a Vite watch rebuild keeps the old stamp

[vite.fleet.config.ts](/home/greg/code/spideryarn2/.claude/worktrees/ops-diagnose/vite.fleet.config.ts:62) computes `stamp` once when the config loads. Every `generateBundle` invocation emits that same object, and `define` permanently embeds it.

The installed Vite implementation resolves the config once, creates one watcher, and reuses those plugin/options objects for subsequent watch builds. Therefore:

1. Run `npx vite build --watch --config vite.fleet.config.ts`.
2. Let the first build finish.
3. Move HEAD or edit a tracked client source.
4. Let the watcher rebuild.

The second bundle contains new code but retains the first build’s SHA, dirty flag, `readAt`, and `builtAt`. A normal one-shot build has the same, smaller window between config evaluation and reading its inputs.

Smallest change if watch is unsupported: reject `config.build.watch` explicitly, and describe the field as “checkout observed when config loaded.” To retain D3’s stronger “what this bundle was built from,” build from an immutable snapshot or capture per build through a virtual module and verify the checkout again before accepting the output.

A normally cached config does not affect separate `npm run build:fleet` processes; `--watch` is the concrete failure.

### F4 — P2 — established: malformed timestamps remain `known`

[parseStartRevision](/home/greg/code/spideryarn2/.claude/worktrees/ops-diagnose/tools/fleet/revision.ts:82) and [readBuildStamp](/home/greg/code/spideryarn2/.claude/worktrees/ops-diagnose/tools/fleet/build-stamp.ts:55) check only that timestamps are strings.

I wrote:

```json
{
  "kind": "known",
  "sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "dirty": false,
  "readAt": "not-a-date",
  "builtAt": "also-not-a-date"
}
```

`readBuildStamp` returned it as a valid known stamp. This contradicts the reader’s “missing/malformed becomes unknown” contract and will produce invalid clock calculations later.

Smallest change: validate `readAt` and `builtAt` as finite ISO instants and add otherwise-valid invalid-date cases to the build-stamp and daemon-note tests.

## Accuracy of the requested statement

The accurate replacement is:

> A `known` stamp records a HEAD SHA and a Git status observation made during startup. `dirty:false` means that status reported no tracked changes; `dirty:true` means it reported at least one tracked change somewhere in the checkout. It does not prove which code the process or bundle contains. `unknown` must never be rendered as a match.

The `unknown` arm itself is handled correctly in this commit: old notes remain unstamped, malformed revision objects become unknown, and `describeNote` prints unknown explicitly. The actual match renderer does not exist in stage 1, so that final rule remains to be enforced in later stages.

Validation: `npx vitest run tests/fleet-revision.test.ts` produced 7 passes and 2 failures. Both real-repository cases failed because this managed sandbox reports `spawnSync git EPERM` alongside successful Git status/output; the injected real-Git probes above succeeded and established F1/F2. While reviewing, other agents advanced the worktree; all findings above are pinned to `cb4c3ba7`, not those later changes.