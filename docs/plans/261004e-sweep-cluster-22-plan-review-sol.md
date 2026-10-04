**Refuse the plan as written on F1, an established P1. Recommend doing less: extract `tapRefusal`; leave the other three decisions inline.**

I reviewed behaviour at `0a98b28ab`. Implementation began concurrently, so I excluded those later changes. I made no file edits.

**F1 — P1, established: a delayed clear refusal strands a successfully committed turn.**

This reachable sequence exposes a live defect:

1. Enter tap mode, then press Talk, sending clear C.
2. Hold for at least 500 ms, then press Done.
3. The 300 ms tail expires: commit is sent, `tapCommitPending = true`, and a reply is owed.
4. Receive the delayed refusal of C.
5. Receive the successful commit acknowledgement.

At baseline hook lines 1235–1262, step 4 clears `tapCommitPending`, returns to `tap-idle`, mutes the microphone, and clears debt. Step 5 re-owes the reply, but the acknowledgement handler’s flag is now false, so it sends no `response.create`. The detector remains off.

I reproduced this using the **baseline hook and existing fake-channel harness, entirely in memory**. After both incoming events, the sent events remained:

```text
input_audio_buffer.clear
input_audio_buffer.commit
```

There was no `response.create`. This requires no message reordering: inbound clear-error still precedes inbound commit-ack; ordinary inbound delay lets the client submit the commit meanwhile.

**Smallest correction:** distinguish Done’s unsubmitted tail from a submitted turn. Once submitted, an earlier clear refusal must preserve the closed turn, its pending acknowledgement, and its reply debt. Only rejection of that commit should forgive it. Checking `tapCommitPending` alone is insufficient because it becomes false after acknowledgement while the reply may still be outstanding. Add this hook regression before extracting the policy, and amend the plan’s “no behaviour change” scope accordingly.

The late **entry** refusal has the same established flag-clearing consequence and preserves debt while restoring hands-free. Whether that necessarily leaves the turn unanswered is **reasoned**: the still-active voice detector may produce a reply. F1’s clear-refusal sequence avoids that uncertainty.

The complete current refusal table follows. **Every cell first deletes the refused event and sets `tapCommitPending = false`.**

| Refused event | `hands-free` | `tap-idle` | `tap-talking` | `tap-sending` |
|---|---|---|---|---|
| `entry` | A | A | A | A |
| `clear` | K | R | R | R |
| `commit` | K | R | R | R |
| `response` | K | R | R | U |

The outcomes are:

- **A:** hands-free; microphone on; debt unchanged; notice says tap mode could not start.
- **K:** mode, microphone, debt and notice unchanged.
- **R:** tap-idle; microphone off; debt cleared; notice invites another Talk.
- **U:** remain tap-sending; microphone off; debt retained; notice requests Reconnect.

Thus the table has **three** K cells, not just `clear × hands-free`. The problematic R cell is `clear × tap-sending` once submission has happened. Before submission, returning to Ready and preventing the timer’s commit is sensible; the same cell covers both situations today.

**F2 — P2, established: sharing `mayTalk` does not make the button and handler use equivalent facts.**

The rendered busy expression simplifies to:

```text
responding || speaking || pendingTools.length > 0
```

because `thinking = (responding || pendingTools.length > 0) && !speaking`. These normally correspond to the handler’s response, playback and tool facts after React commits a render. The hook updates the response state on creation and continuation checks; tool state and request cleanup also normally settle together.

There is, however, a concrete difference: **the UI has no `doneTimer` fact**. Press Done, then receive a clear refusal during its 300 ms tail. The mode becomes `tap-idle`, but the timer remains pending. The rendered button becomes enabled; `talk()` refuses until the timer callback clears the ref. Refs can also advance before their rendered mirrors.

Sharing the predicate can preserve today’s button behaviour by passing `tailPending: false`, `live: true` inside the live-only button branch, and the existing rendered busy expression. That preserves the discrepancy too.

**Smallest correction:** retain the current UI expression and remove the plan’s claim that predicate sharing holds the two gates together. If synchronising them becomes an explicit behaviour change, give the hook ownership of the rendered Talk eligibility, including the timer.

**F3 — P2, reasoned: three of the four extractions fail the deletion test.**

My recommendation for each proposed function:

| Function | Worth extracting? | Can its signature reproduce today? |
|---|---|---|
| `tapRefusal` | **Yes.** It concentrates recovery precedence, debt handling and notices behind one useful interface. | Yes, for the current four returned outcomes. Preserve the common flag reset outside it and define K for all three non-entry hands-free cells. F1’s correction needs an additional submission fact. |
| `mayTalk` | **No, as proposed.** It relocates a short conjunction while both callers still assemble different facts. | Yes for the handler. The UI needs the explicit mapping described in F2. |
| `doneVerdict` | **Marginal; omit.** Its useful threshold is one comparison, and effects still span both branches in the hook. | Yes: refuse unless live and talking; discard below 500 ms; send at or above it. Preserve the timing of the clock sample if exact neutrality matters. |
| `modeOnStart` | **No.** One ternary with one caller becomes an imported one-line wrapper. | Yes: keep plus any tap mode becomes tap-idle; everything else becomes hands-free. Consuming `keepTalkMode` remains a hook effect. |

**Smallest correction:** narrow the plan to `tapRefusal`, its types, the table tests, and the existing hook regression checks. Pure siblings justify this kind of boundary when it hides substantial policy; their existence does not make every short conditional worth moving.

**F4 — P3, established: the existing coverage is understated.**

The [plan](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c22-live-tap-policy/docs/plans/261004e-sweep-cluster-22-live-tap-policy-as-a-pure-function.md:25) says existing tests cover three refusal cells. They cover **five**: entry/idle, clear/hands-free, clear/talking, commit/sending and response/sending.

**Smallest correction:** replace “three” with “five” in both occurrences. The missing coverage that matters most is the delayed-error sequence, which a sixteen-cell pure table cannot establish by itself.

Finally, **clearing and nulling `doneTimer` in `stop` is behaviour-neutral for hang-up grace**. `stop` establishes `closing.current` before a timer can run; the existing callback then fails `isLive()`. After teardown, it fails because the peer connection is absent. Grace continues accepting provider events, while Done’s callback already sends nothing. Keep that cleanup.