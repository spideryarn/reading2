No P0 authorization bypass: a priority event does not affect `isDispatchable`, `queueDepth`, or the dispatch fold arm. It changes only presentation order and “items ahead” calculations.

Note: this worktree already contains a partial uncommitted implementation. I treated it as WIP, but it exposed two concrete issues below.

## P1

### P1-1 — `move` and priority form two contradictory order systems

- **Failure:** placement order is `A, C, B`, priorities are `A=.9, C=.9, B=.1`, so the visible order is `A, C, B`. `move A --after B` changes hidden placement to `C, B, A`, but visible order becomes `C, A, B`. The command neither puts A after B nor does nothing: it unexpectedly swaps A and C.
- **Where:** [plan § Placement stays placement](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/docs/plans/260909d-a-priority-on-every-queued-idea-and-the-queue-ordered-by-it.md:112), and the proposed sort after placement in [idea-queue.ts](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/tools/overseer/idea-queue.ts:916).
- **Instead:** reject `--before/--after` when the items have different priorities. Define `--front/--back` explicitly as “front/back among items with exactly this priority,” or retire them for prioritized items. “Band” currently means exact numeric equality, not a range: `0.85` and `0.84` cannot be reordered by `move`.

This also makes the proposed `add --front` warning insufficient. An exit-zero command named `--front` can place an item last; automation will not read the explanatory prose. Refuse `add --front` without a priority, and describe the prioritized form as front of its exact-priority group.

### P1-2 — the claimed old-reader failure is false for `add --priority`

- **Failure:** a new writer appends one `added` event containing `priority: .9`. An old reader ignores that unknown key, sees no unknown `prioritized` event, considers the queue healthy, and uses placement order. It can therefore select the wrong next item without a problem.
- **Where:** [plan § Schema](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/docs/plans/260909d-a-priority-on-every-queued-idea-and-the-queue-ordered-by-it.md:117). The WIP parser accepts priority directly on `added` at [idea-queue.ts](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/tools/overseer/idea-queue.ts:1110).
- **Instead:** keep priority out of `added`. `add --priority` should atomically append `added` followed by `prioritized`, just as combined edit does. Then every stated priority contains an event an old reader rejects loudly, and keeping schema 1 is defensible. Alternatively implement genuine multi-version parsing before bumping the schema; “the current parser would reject old lines” is not itself an argument against a necessary bump.

### P1-3 — dry-run and apply are not the same reviewed operation

- **Failure:** Greg dry-runs version V and sees all queued items covered. Before apply, a new important item is added. `--apply` rereads V+1 and succeeds, leaving that item `null`, below even low-priority product work. The applied result is not the result Greg reviewed.
- **Where:** [plan § set-priorities](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/docs/plans/260909d-a-priority-on-every-queued-idea-and-the-queue-ordered-by-it.md:139).
- **Instead:** dry-run must print an opaque version and the exact follow-up command; `--apply` must require that version and refuse if it moved. Also refuse apply when the queue has problems or the file contains absent IDs. If unnamed live items are permitted, require an explicit `--allow-unnamed`; otherwise a typo produces the partial application the command claims to prevent.

### P1-4 — an existing queue problem can mask a new invalid priority write

- **Failure:** the queue already has one malformed line. A priority event against a settled or unknown item creates one new fold problem. `appendEvents` compares candidate problem count `1` with current count `1`; because the malformed line was dropped from the candidate fold, it appends the invalid event. The resulting append-only authorization record now has two problems.
- **Where:** [appendEvents’ count comparison](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/tools/overseer/idea-queue.ts:1463).
- **Instead:** fold the parsed existing events once as a baseline, then compare the candidate against that baseline. Parser problems must not participate in the “did this batch add a fold problem?” count. Add the exact regression: unreadable line + invalid `prioritized` event must leave the file byte-for-byte unchanged.

### P1-5 — a one-off instruction is being generalized into standing ordering authority

- **Failure:** Greg authorizes A and B and ranks A first. Later the Overseer assigns B priority 1; a dispatcher honoring effective order takes B next. The work is still authorized, so this is not a gate-3 content bypass, but the Overseer has changed the constraint governing its own choice.
- **Where:** [plan lines 35–53](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/docs/plans/260909d-a-priority-on-every-queued-idea-and-the-queue-ordered-by-it.md:35) versus the runbook’s rule that the Overseer may only propose changes to “the queue that authorises you” in [overseer.md](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/docs/project/overseer.md:146).
- **Instead:** do not lapse content authorization—that is the wrong axis. Narrow the permission to this Greg-requested, version-bound bulk banding, make Overseer priorities proposals until Greg accepts them, or get an explicit runbook decision granting standing reprioritization authority. “`moved` already allows it” may identify an existing hole rather than establish policy.

## P2

### P2-1 — the new event kind is good, but it is not structural authorization safety

- **Failure:** a hand-written or buggy writer emits `edited { priority: .9 }`. The parser ignores the unknown key, accepts an empty edit, records “edited nothing,” and silently leaves priority unchanged.
- **Where:** the rationale in [the plan](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/docs/plans/260909d-a-priority-on-every-queued-idea-and-the-queue-ordered-by-it.md:55) and permissive `edited` parsing in [idea-queue.ts](/home/greg/code/spideryarn2/.claude/worktrees/queue-priority/tools/overseer/idea-queue.ts:1140).
- **Instead:** keep the separate event because it gives honest history and atomic composition, but reject an `edited` event with no recognized field and preferably reject event-specific unexpected keys. The round-two lesson was actor/gate asymmetry: any event that changes dispatchability needs an explicit authority rule. Merely having another event kind does not provide that.

### P2-2 — the `needsGreg` priority rule is not supported by the quoted brief

The plan says Greg wanted those rows “unchanged in priority,” but the quoted request says **all** Spideryarn product ideas should be low priority. Decide this explicitly. Do not rely on a `?` marker and visual inspection to mediate two conflicting readings.

## Calls I endorse

- **Priority does not lapse content authorization:** yes. I found no path from priority to gate validity.
- **Separate `prioritized` event:** yes, for auditability and clean event semantics; not for the claimed structural security reason.
- **`number | null`, null last:** yes.
- **Sort once in `foldQueue`:** yes. `waitingAhead` and `itemWait` should follow effective visible order. `queueDepth` is order-insensitive and does not actually change meaning.
- **Out-of-range values reject the line:** yes; `unreadable-line` is sufficient.
- **No schema bump:** only after removing priority from `added`, so every stated priority forces an old reader to fail loudly.

**Verdict: build it with the changes named.**