No P0: this diff adds no delivery path. `steer.ts` changes only a comment, and its existing send path still requires a live `claude --session-id …` descendant.

## Ranked findings

1. **P1 — A headless Claude can be classified as steerable.**  
   [harness.ts:361](/home/greg/code/spideryarn2/.claude/worktrees/harness-adapter/tools/overseer/harness.ts:361) returns immediately when `--session-id` is first. For:

   ```text
   claude --session-id abc --print do the thing
   ```

   the result is `claude-code`, and `capabilitiesOf` grants both prose steering and dialog answering, although `--print` makes it headless. The existing verifier at [steer.ts:625](/home/greg/code/spideryarn2/.claude/worktrees/harness-adapter/tools/fleet/steer.ts:625) also accepts that invocation because it checks only the session ID.

   This does not create a new send today because the classifier is unused, but it is a false capability grant waiting at the integration seam. Use one shared, lossless Claude-argv parser for recognition and steering; inspect all option arguments before returning interactive, with `--print` taking precedence or producing an explicit ambiguity.

2. **P1 — Codex mode cannot be determined safely from flattened `ps args`.**  
   [work.ts:341](/home/greg/code/spideryarn2/.claude/worktrees/harness-adapter/tools/overseer/work.ts:341) destroys argument boundaries, then [work.ts:376](/home/greg/code/spideryarn2/.claude/worktrees/harness-adapter/tools/overseer/work.ts:376) treats the first resulting word as a subcommand.

   Two concrete failures:

   - `codex 'review this diff'` is an interactive Codex with one prompt argument, but `ps args` becomes indistinguishable from `codex review this diff`; it is reported as `codex-batch`.
   - `codex --model x review the diff` is a valid non-interactive review, but it becomes `codex-interactive` in [harness.ts:395](/home/greg/code/spideryarn2/.claude/worktrees/harness-adapter/tools/overseer/harness.ts:395) and no work in `work.ts`. [The test at line 211](/home/greg/code/spideryarn2/.claude/worktrees/harness-adapter/tests/overseer-work.test.ts:211) currently pins this wrong result.

   The official OpenAI command reference confirms that base `codex` accepts an optional interactive prompt, global flags precede or propagate to commands, and `review` is non-interactive. It also lists non-TUI commands such as `app-server`; the current “everything except exec/review is interactive” fallback consequently mislabels `codex mcp-server` and `codex app-server`. [Official OpenAI Codex command reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli)

   Read `/proc/<pid>/cmdline` for harness-shaped candidates and parse the NUL-separated argv. Whitelist known interactive forms; return `ambiguous-harness` for other Codex subcommands rather than calling every one a TUI.

3. **P2 — A malformed tree can return a steerable Claude instead of `unknown`.**  
   [harness.ts:465](/home/greg/code/spideryarn2/.claude/worktrees/harness-adapter/tools/overseer/harness.ts:465) returns a shallow hit before inspecting the next level for cycles; [line 549](/home/greg/code/spideryarn2/.claude/worktrees/harness-adapter/tools/overseer/harness.ts:549) returns a depth-zero match before walking at all.

   Confirmed input:

   ```text
   pid 1, ppid 3: bash -l
   pid 2, ppid 1: claude --session-id abc
   pid 3, ppid 1: sleep 1
   ```

   This contains the cycle `1 → 3 → 1`, but returns `claude-code` for pid 2 and therefore all capabilities `true`. A self-parented pane whose own command is Claude likewise returns `claude-code`.

   Validate the entire reachable ancestry separately before selecting the shallowest harness. Selection may prune below a matched harness; structural validation should not.

4. **P2 — The promised non-empty `unknown.why` is not enforced.**  
   [harness.ts:524](/home/greg/code/spideryarn2/.claude/worktrees/harness-adapter/tools/overseer/harness.ts:524) passes probe prose through unchanged:

   ```ts
   classifyPaneHarness(1, { read: false, why: "" })
   // { kind: "unknown", cause: "process-table-unreadable", why: "" }
   ```

   Supply a fallback when `why.trim()` is empty, or make failure construction go through one non-empty constructor.

5. **P3 — There is a seventeenth hand-written join: Claude invocation parsing.**  
   New [recogniseClaude](/home/greg/code/spideryarn2/.claude/worktrees/harness-adapter/tools/overseer/harness.ts:352) and existing [isClaudeForSession](/home/greg/code/spideryarn2/.claude/worktrees/harness-adapter/tools/fleet/steer.ts:625) independently interpret the same argv and already disagree. For `claude --session-id=abc`, the harness returns ambiguous while steering accepts session `abc`; duplicate session-ID options also differ.

   Extract a pure shared Claude invocation parser after the competing `steer.ts` work lands. The shared Codex regex and tree index are good precedents.

6. **P3 — Two evidence claims are stronger than the captured data.**  
   The `/tmp` guard at [work.ts:321](/home/greg/code/spideryarn2/.claude/worktrees/harness-adapter/tools/overseer/work.ts:321) checks spelling, not location. A process launched as `./codex exec` with cwd `/tmp/fake-codex-X` is classified as batch. Likewise shell recognition at [harness.ts:555](/home/greg/code/spideryarn2/.claude/worktrees/harness-adapter/tools/overseer/harness.ts:555) establishes only that argv0’s basename is `bash`, not the executable’s identity. Either narrow the comments to “absolute throwaway paths/basenames” or inspect `/proc/<pid>/exe` and cwd for candidates.

A smaller contract error: [harness.ts:176](/home/greg/code/spideryarn2/.claude/worktrees/harness-adapter/tools/overseer/harness.ts:176) says shell commands are truncated, but [line 557](/home/greg/code/spideryarn2/.claude/worktrees/harness-adapter/tools/overseer/harness.ts:557) returns the raw command. Export and reuse the truncator, or remove that promise.

## The seven claims

1. **Correct for a well-formed tree.** It is BFS, depth zero is checked, a whole level is collected before choosing, and a deeper harness cannot beat a shallower one. The malformed-tree exception is Finding 3.

2. **Incorrect.** An unreadable reading can produce an empty `why`; malformed ancestry can produce a positive Claude result; and “shell” is basename-positive rather than executable-identity-positive.

3. **Correct.** `Record<HarnessKind, …>` forces every kind into the table, and the exhaustive switch forces every `Harness` arm into `describeHarness`. `capabilitiesOf` is not a hole—it couples `Harness["kind"]` back to the record. There are currently no production consumers.

4. **Correct today.** Only `claude-code.steerWithProse` is true. No code in the diff sends anything or widens the existing send path. Finding 1 means the classifier can place a headless process into that supposedly steerable kind.

5. **Partly incorrect.** `TreeReadFailure`, `CODEX_BATCH_SUBCOMMAND`, the process index, and `resolveExecutable` are properly shared. Claude invocation parsing is duplicated and divergent; the `/tmp` guarantee is only lexical.

6. **Incorrect overall.** The `exec|e|review` boundary correctly rejects `reviewer` and `export`, and those three names are the right non-interactive modes. Argument flattening and global options make the recogniser produce both false positives and false negatives. `codex review --help` is also non-interactive but not a paid run, despite the description saying “paid GPT run.”

7. **Correct, including the trap.** It is safe now because both Codex kinds refuse steering. If `codex-interactive` is later flipped to true, this sequence can send prose to a shell: classify `bash -l → codex`; Codex exits; the shell regains the tty; stale capability authorizes `tmux send-keys`. Do not implement that future stage by changing one boolean. It needs a Codex-specific, immediate send-time identity/foreground check—preferably a session-addressed Codex control channel rather than tty injection.

I would keep all six union arms. `claude-headless` and `codex-batch` are precisely the two arms that prevent “same executable means same capability”; cutting either recreates the lie this stage is intended to remove.

Validation: all 31 harness tests passed; the combined scoped run passed 82/90, with the eight failures all caused by this sandbox refusing test-spawned processes (`spawnSync … EPERM`). All three TypeScript projects compiled directly, including the DOM-only fleet project, and `wire.ts` contains no import or runtime value. Biome passed. `git diff --check` found one trailing-space line in `codex-batch-pane.txt`.