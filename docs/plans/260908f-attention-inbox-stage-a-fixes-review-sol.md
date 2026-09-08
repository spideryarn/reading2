Not approved yet. Three blockers remain.

1. **Critical — failure caching still survives upgrades.** `unreadable` is no longer newly cached, but schema 1 still accepts an old cached `unreadable` verdict ([attention-memory.ts](/home/greg/code/spideryarn2/.claude/worktrees/attention-inbox/tools/overseer/attention-memory.ts:112)). It becomes a cache hit, is never added to `unclassified`, and can still publish false calm indefinitely. Reject/drop cached `unreadable` records or bump the schema.

2. **High — incompleteness is still underrepresented.** In the submitted version, `unclassified` covers classifier failures only. A mixed scan—19 readable quiet panes plus one capture failure/unparseable pane—still claims “nothing needs you.” Showing known items is the right trade, but silently implying completeness is not; the wire contract is worth changing. The in-progress `sessionsUnreadable` field now visible in the tree is the right direction, but its calculation currently:

   - omits `noPane`;
   - counts distinct unclassified fingerprints, not affected sessions;
   - can print “nothing needs you” followed by a caveat retracting that claim.

   An incomplete empty result should remain `unknown`; an incomplete non-empty list should explicitly say “at least N” or “N found; M sessions unjudged.”

3. **High — findings 2 and 5 only close normal-process paths.**

   - Per-process epoch is insufficient. The daemon can outlive a tmux-server restart, after which `$1` can name a different session. This repo already treats `tmuxServerPid` as the necessary generation. Include it in the epoch/key.
   - Normal shutdown awaits `attentionRunning`, but the exception path calls `stopHere()` first ([daemon.ts](/home/greg/code/spideryarn2/.claude/worktrees/attention-inbox/tools/overseer/daemon.ts:585)); the await is only later on the non-throwing path ([daemon.ts](/home/greg/code/spideryarn2/.claude/worktrees/attention-inbox/tools/overseer/daemon.ts:726)). Also, writable manual CLI runs do not honor the daemon lock. Atomic rename prevents torn JSON, not lost updates or duplicate calls. Lack of abort propagation is otherwise acceptable: the pass is bounded.

The other repairs are sound:

- Key-hint duplication: acceptable for Stage A; it exactly matches `pane.ts` and fails conservatively.
- Total parsers: fixed, apart from the cached-`unreadable` policy hole above.
- Previous-input boundary: fixed.
- Cost arithmetic: fixed.

One additional accounting issue: the separate Overseer transport is justified, but merely adding it to `ALLOWED` exempts it. Daemon spend is discarded and it has no `UNMETERED_SPEND` entry, despite that registry explicitly saying an allow-list is not a spend register.

Measurement: the held-out run supports “the classifier matched Fable’s four positives on this capture, repeatably, while a nearby dashboard snapshot showed none as `needs-you`.” It does not support 12 independent positives or 63 independent negatives—they are 4 and 21 repeated three times. The first capture is not a matched comparison at 3m20 skew; even 54 seconds should be described as nearby, not simultaneous. Finally, `irreversible` / `technical` / `other` are not adjacent buckets: the observed wobble spans first-to-last ranking, so presence looks stable but ranking remains unvalidated.

Focused tests: 167 passed.