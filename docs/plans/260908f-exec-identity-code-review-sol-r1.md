I would not sign this stage off unchanged. I found no P0, but two P1s undermine the stated identity guarantee.

## P1

1. **The sticky register never learns identity after an unverified sample, so the sampling gap is not harmless.**

   [diff.ts:1143](/home/greg/code/spideryarn2/.claude/worktrees/260908f-exec-identity/tools/overseer/diff.ts:1143) emits only for two consecutive verified readings. Meanwhile, [store.ts:2425](/home/greg/code/spideryarn2/.claude/worktrees/260908f-exec-identity/tools/overseer/store.ts:2425) initializes `verifiedExecution` only on `session-seen`, and [store.ts:2354](/home/greg/code/spideryarn2/.claude/worktrees/260908f-exec-identity/tools/overseer/store.ts:2354) updates it only from that event.

   Concrete failures:

   - On the actual upgrade path, the old baseline parses as `unknown/not-reported`; the first new verified snapshot emits no event. Existing register entries therefore remain `verifiedExecution: null` indefinitely.
   - `verified(A) → unknown → verified(B)` leaves the register claiming A and retains A’s `statusSince`. The existing Overseer history/attention projection then ranks B using its predecessor’s age.

   I reproduced the upgrade case with the checked-in fixture: zero execution events and all six register entries remained `null`.

   This directly disproves the roadmap’s claim that the gap affects history but not the guarantee. `statusSince` is an existing event-dependent consumer.

   Smallest correct fix: reconcile every current verified row against the register’s last verified token, rather than only against the previous snapshot. Persist an event when the register token is null or differs; update the token and reset `statusSince` to a lower bound. Keep unknown readings sticky.

2. **A `verified` reading can combine the old process-table row with a different current process’s start token.**

   [execution-identity.ts:238](/home/greg/code/spideryarn2/.claude/worktrees/260908f-exec-identity/tools/fleet/execution-identity.ts:238) identifies the harness and conversation from `ps`; [execution-identity.ts:268](/home/greg/code/spideryarn2/.claude/worktrees/260908f-exec-identity/tools/fleet/execution-identity.ts:268) later reads `/proc/<pid>/stat`, without proving that the PID still represents the process classified by `ps`.

   If the harness exits and its PID is reused between those reads, the result contains:

   - the old harness kind and conversation;
   - the replacement process’s `startTicks`;
   - `kind: "verified"`.

   If the old conversation matched the claim, [identityWriteGate:163](/home/greg/code/spideryarn2/.claude/worktrees/260908f-exec-identity/tools/fleet/execution-identity.ts:163) returns `allowed: true`. I reproduced that mixed reading with injected inputs. The existing `process-start-unreadable` arm covers exit without reuse, but not reuse.

   Smallest correct fix: bracket a fresh process-table classification with start-token reads and require the same token, harness PID, ancestry and conversation on both sides. A second fleet-wide `ps` plus a second small `/proc` read per candidate is sufficient and still cheap here.

## P2

3. **The helpers intended for browser draft continuity are in a Node-only module.**

   [execution-identity.ts:61](/home/greg/code/spideryarn2/.claude/worktrees/260908f-exec-identity/tools/fleet/execution-identity.ts:61) imports `node:fs` and Overseer modules, while `continuityOf` and `identityWriteGate` are the functions the later browser-side Session continuity stage is supposed to reuse. The DOM-only web project cannot safely import this module, so that stage must duplicate the invariant or refactor this work first.

   Smallest fix: extract token formatting, continuity and gate policy into a browser-safe leaf module containing only type imports. Keep machine reads and harness classification in `execution-identity.ts`. This also removes the architectural braid where Overseer imports a fleet module that itself imports Overseer. There is no current runtime cycle—Biome’s cycle check passed—but the layering already bites at the intended consumer.

4. **The runtime parsers admit states that the producer cannot construct, and the gate trusts them.**

   [observation.ts:667](/home/greg/code/spideryarn2/.claude/worktrees/260908f-exec-identity/tools/overseer/observation.ts:667) and [web/types.ts:1045](/home/greg/code/spideryarn2/.claude/worktrees/260908f-exec-identity/tools/fleet/web/src/types.ts:1045) accept `harness: "shell"` or an unrecognised harness mapped to `"unknown"` alongside `conversation: {kind:"verified"}` while preserving `execution.kind: "verified"`. The outer row’s claimed conversation is not cross-checked either. `identityWriteGate` then allows that value because it checks only the conversation arm.

   Smallest fix: validate cross-field invariants at `parseRow`, including that verified conversation identity matches the row claim and belongs to an explicitly addressable harness. Also make the gate require the supported harness as defense in depth.

   Relatedly, [store.ts:1780](/home/greg/code/spideryarn2/.claude/worktrees/260908f-exec-identity/tools/overseer/store.ts:1780) accepts any nonempty token string, so the claim that every malformed present value fails is too strong. Centralise a real token-text parser in the browser-safe leaf module and reuse it here.

5. **The token is a process-incarnation token, not an unqualified execution/run token.**

   [wire.ts:1512](/home/greg/code/spideryarn2/.claude/worktrees/260908f-exec-identity/tools/fleet/wire.ts:1512) overstates uniqueness. Within this box’s fixed PID namespace and ordinary fork/exit launch path, `boot:pid:startTicks` is an excellent practical identity. Field 22 is indeed start time in clock ticks, and `boot_id` is stable during a boot. [Linux `proc_pid_stat(5)`](https://www.man7.org/linux/man-pages/man5/proc_pid_stat.5.html), [kernel `boot_id` documentation](https://www.kernel.org/doc/html/v6.9/admin-guide/sysctl/kernel.html).

   It does not identify an exec epoch: `execve` replaces the program image while preserving the process/PID, so a process re-execing another harness keeps the token. [Linux `execve(2)`](https://man7.org/linux/man-pages/man2/execve.2.html). PID namespace changes are also outside the encoded scope. Checkpoint/restore may give one logical application run a new process token—a safe false replacement—and VM snapshot rollback is outside the guarantee.

   Smallest fix for this box: scope the contract explicitly to “one process incarnation in this collector’s PID namespace.” If conversation continuity must survive or detect re-exec, compare the observed conversation identity alongside the token.

## Conclusions on the challenged decisions

- `parseProcStat`: last `)` is correct, and field 22 at post-parenthesis index 19 is correct. It does not strictly prove non-truncation: a successful short read ending during or just after field 22 can yield a plausible smaller number. Requiring the normal terminal newline would cheaply close that parser claim, though I found no evidence that `readFileSync` against procfs produces such partial successful records during exit.
- The `verified`/`claimed-only`/`unknown` mappings fail closed. None is too reassuring operationally. `claimed-only` with `conversation: not-claimed` is semantically odd, however, and no current consumer benefits from this distinction.
- Resetting `statusSince` on a proven replacement is correct and does not break its existing consumers. Missing the reset across the P1 gap does.
- No `OBSERVATION_SCHEMA` or `STORE_SCHEMA` bump is needed. Both changes are additive and old consumers merely omit continuity. However, the absent-field fallback must subsequently converge from `null` to a verified token; it currently does not. A schema bump would not fix that.
- `identityWriteGate` is appropriately strict for conversation-addressed writes, but it is not standalone authority and needs the parser/harness hardening above.
- The additional ~40 ms blocking `ps` is reasonable against the measured collection cost, provided Responsive collection later moves it off the request event loop.
- The core token, collection pass and conservative wire field are proportionate. The event/sticky-register layer and exported policy helpers are over-built ahead of their consumers: they add substantial state and contract surface, yet currently contain the two main correctness gaps. `claimed-only` plus eight unknown causes is also more taxonomy than the present UI uses.

Verification note: the referenced `docs/plans/260908f-exec-identity-suite.txt` is absent. The available suite logs did not yet contain a final Vitest summary when inspected. I independently reran `fleet-execution-identity`: 33/33 passed, and the scoped import-cycle check passed.