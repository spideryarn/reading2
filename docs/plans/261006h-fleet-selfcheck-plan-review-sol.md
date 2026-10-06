Build with changes. The anchor is reasonable for the recorded systemd environment, but the plan misses a definite type-contract conflict and several refusal cases.

I changed no files, used no network, and contacted no tmux server. The installed tmux 3.4 manual supports the documented socket and format behaviour below; runtime conclusions are labelled separately.

| Statement | Assessment |
|---|---|
| **1. Outside tmux means `${TMUX_TMPDIR:-/tmp}/tmux-<uid>/default`.** | **Qualified.** That is the default selection with no usable `TMUX` and no `-S`/`-L` override. `TMUX_PANE` is not required for socket selection. `#{socket_path}` reports the server socket pathname, which `realpath` can canonicalize when it remains resolvable. See F2–F3. |
| **2. “Under tmux, nothing changes.”** | **Accurate when both variables are populated**, provided that branch performs no new filesystem checks. A partial environment changes behaviour; see F2. |
| **3. Matching socket path makes the reported pid that server’s pid.** | **Accurate for genuine tmux output.** The manual defines `socket_path` and `pid` as the server socket path and server PID. Reading them together needs no `/proc` join. This trusts the tmux executable and does not authenticate fabricated wrapper output. |
| **4. A fifth field cannot disturb existing parsers.** | **Accurate for this collector’s existing output consumers.** `panesBySession` reads the first three fields; `tmuxServerPid` reads the fourth. The strict steering parser uses a separate pipe-delimited format. The bench’s independent four-field calls remain valid. Exact command assertions need updating. |
| **5. Required served `selfCheck` cannot break consumers.** | **False at compile time with “no change to the page.”** Existing runtime readers ignore unknown fields, but the page deliberately inherits required wire fields. See F1. |

**F1 — P1, established: “No change to the page” contradicts the wire contract.**

[The client type](/var/tmp/spideryarn-worktrees/qi-j4jyf3ab-selfcheck-systemd/tools/fleet/web/src/types.ts:521) derives from `FleetStateWire` through `Omit`. Its [parser](/var/tmp/spideryarn-worktrees/qi-j4jyf3ab-selfcheck-systemd/tools/fleet/web/src/types.ts:3564) constructs that derived type. Adding required `selfCheck` to the shared wire type makes this object incomplete.

[wire.ts](/var/tmp/spideryarn-worktrees/qi-j4jyf3ab-selfcheck-systemd/tools/fleet/wire.ts:1185) explicitly promises this enforcement. Adding the field only to a server-side extension would evade that contract.

Smallest change: declare the verdict’s transport type in `wire.ts`, publish the required field, and explicitly add `"selfCheck"` to the client’s documented `Omit` list if the page will ignore it. No visual change or schema bump is needed. Include the bench and snapshot fixtures in the required-field migration.

**F2 — P1, reasoned: the fallback can reject a correctly selected named server.**

Concrete input:

```text
TMUX=/tmp/tmux-1000/s3a-sock,1234,0
TMUX_PANE absent
listed socket=/tmp/tmux-1000/s3a-sock
```

Tmux uses `TMUX` to select the socket even without `TMUX_PANE`. The current check returns `cannot-check`; the planned fallback compares against `default` and returns `absent`. This is a behavioural change on a legitimate environment, not evidence that the child queried another socket.

Smallest change: use the default anchor only when `TMUX` is absent or empty. Preserve `cannot-check` for a partial `TMUX` environment, or deliberately support its socket separately. Test missing, empty and malformed variables independently.

The counterexample follows tmux selection behaviour and the proposed branch; I did not exercise it against a server.

**F3 — P2, established omission; runtime consequence reasoned: unresolved paths have no verdict.**

The plan names missing socket metadata and unreadable uid, but omits failure of either `realpath`. Those operations can fail. The tmux manual specifically documents accidental socket removal and recreation with `SIGUSR1`; removal after a successful listing therefore needs handling.

An uncaught resolution error would discard a collection from the correct server. Falling back to unequal raw strings could instead invent a wrong-socket refusal.

Smallest change: return `cannot-check` with the resolution failure when either path cannot be resolved. Reserve `absent` for **two successfully canonicalized paths that differ**. Test failure on each side and aliases resolving to the same path. Preserve the fifth field’s complete pathname rather than whitespace-splitting or trimming away its suffix.

**F4 — P2, established: failure tracing already exists; the proposed logging changes its policy.**

[refreshOnce](/var/tmp/spideryarn-worktrees/qi-j4jyf3ab-selfcheck-systemd/tools/fleet/refresh.ts:129) already calls:

```ts
deps.logError(`collection failed: ${error}`);
```

[The server](/var/tmp/spideryarn-worktrees/qi-j4jyf3ab-selfcheck-systemd/tools/fleet/server.ts:607) wires that to `console.error`. A new refusal already leaves a stderr trace.

Adding transition logging without removing this call duplicates messages. Removing it changes the logging policy for every collection failure, including errors whose text changes each attempt.

I would cut this part from the stage. If transition-only logging remains desirable, describe it as a separate policy change and test its ordering, repetition and recovery behaviour.

**F5 — P2, reasoned: the live gate does not necessarily reproduce the service environment.**

Removing two variables from an interactive shell preserves its `PATH`, `TMUX_TMPDIR`, cwd and other environment differences. The recorded service has no `TMUX_TMPDIR`. The proposed run can therefore pass—or trigger the retreat—against a different expected socket or executable.

Smallest change: specify a preflight using the service’s uid, cwd and effective environment, including `EnvironmentFile` values. Treat its successful result as deployment evidence for that configuration, not proof that future filesystem failures cannot cause a false refusal.

Also verify the published verdict through the actual composition path: success → refused collection → recovery. The verdict retained in `FleetSnapshot` describes the retained rows; the refused attempt remains represented by `error`.

**F6 — P3, established: the pane check does not prove completeness.**

The plan says the pane check can prove the listing complete. It only proves that its own pane survived. A listing containing that pane and omitting others passes [selfCheck](/var/tmp/spideryarn-worktrees/qi-j4jyf3ab-selfcheck-systemd/tools/fleet/collect.ts:643).

Replace this with: “The pane check can detect omission of our own pane; neither anchor proves the complete listing survived.”

One stage is the right size after cutting the logging change. Keep the socket parsing, check, snapshot propagation, explicit client omission and behavioural tests together. The `/proc` alternative adds machinery without improving the stated guarantee under the existing trust in tmux.

VERDICT: build with changes (F1, F2, F3, F4, F5, F6)