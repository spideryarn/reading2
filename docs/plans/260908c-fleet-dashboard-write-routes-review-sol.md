# GPT Sol's review of the fleet dashboard's write routes

**Reviewed:** `bad6eee5`, 2026-09-08. The code, not the plan — the second of the two reviews
[code-quality-overview.md](../project/code-quality-overview.md) asks for, and the one to weight
higher, because a plan-stage review cannot find a `PATCH` that writes one field and then rejects
the request.

**The plan under review:** [260907e-agent-fleet-dashboard.md](260907e-agent-fleet-dashboard.md).
**The prompt it was given** asked it to attack the design, not only the code, and told it that
naming something as not worth building was a welcome conclusion.

**Twenty findings, seven of them P0.** Two are already fixed and one was pre-empted:

- **F8** (new-session route open to DNS rebinding) was found and fixed here about an hour before
  this review landed, in `ae5d8efa` — one shared `addressableHost`, and a test against **both**
  routes' entry points rather than against the predicate, because a test of the predicate would
  have passed on the day the bug existed.
- **F14** (the client renders "never collected" as an empty healthy fleet) and **F19** (the client
  ignores `refreshMs` and cries STALE for 42s of every cycle) were both fixed in the design work
  that landed at `5ab1f6b0`.

**F1 is the same defect GPT Astra found by experiment**, and the two arrived independently within
an hour of each other. It is stage v0.2b in the plan, and it is why answering a dialog is switched
off (`39882b49`).

**The finding that is not a bug** is **F6**. Pane text is not provenance: an agent that prints a
plausible menu — deliberately, or because it was processing hostile input — produces a capture the
parser accepts. Sol's recommendation is to keep dialog answering read-only *unless there is a
structured, trusted source of question identity*, or to accept explicitly that pane text is
executable UI. **That is Greg's decision, not an engineering one**, and it is the first thing to
put to him.

---

The write routes at `bad6eee5` should not remain mounted as-is. There are several paths to a wrong action, including wrong-conversation delivery.

One important scope correction: the committed React client is still explicitly read-only. It contains no message box, session-start form, or clickable question options, and it drops `panePid` and `claudeSessionId`. The findings below affect the mounted HTTP APIs and block safely adding those controls.

## Findings

### F1 — P0 — Dialog equality omits the action being approved

`tools/fleet/pane.ts:217-230`, `tools/fleet/steer.ts:631-638,683-699`, `tests/fleet-pane.test.ts:169-176`

`promptAbove()` deliberately discards everything before the last horizontal rule. For a file-write dialog, the parsed question is only “Do you want to create notes.md?”; the proposed diff is omitted.

Sequence:

1. Snapshot A shows a write to `notes.md` containing content A.
2. That dialog is answered elsewhere.
3. The same session proposes different content B for `notes.md`.
4. Prompt, options and keys parse identically.
5. `sameQuestion()` passes and the route approves B although Greg saw A.

Bind question identity to a normalized digest of the complete action/diff/command, not its display projection.

### F2 — P0 — A free-text message can approve a permission dialog

`tools/fleet/steer.ts:599-619`

`sendMessage()` verifies the pane and Claude process but never verifies that the current screen is a text-input surface.

Sequence:

1. The client honestly sees `working`.
2. Before delivery, Claude opens a numbered permission dialog.
3. A steering message beginning with `1` arrives.
4. The dialog consumes `1` as approval; the subsequent Enter reaches the next screen.
5. The route returns 200.

Require a positively recognized free-text input state immediately before sending. “Not recognized as a question” is not strong enough.

### F3 — P0 — Conversation verification uses an argv substring

`tools/fleet/steer.ts:406-417,469-517`, `scripts/gjd-remote.ts:2549-2554`

`claudePidsFor()` checks whether flattened process text contains `--session-id <expected>`. It does not identify the actual argv value following the real option.

Sequence:

1. Conversation A exits.
2. Conversation B starts under the same pane with an initial prompt mentioning `--session-id <A>`.
3. `gjd-remote` puts that prompt into B’s argv.
4. B’s command line begins with `claude` and contains A’s substring.
5. Ancestry passes, and a stale message intended for A is delivered to B.

Read NUL-delimited `/proc/<pid>/cmdline` and require the exact argument pair. The purported prefix test at `tests/fleet-steer.test.ts:544-552` passes for the wrong reason: it tests a shorter candidate, not `expected UUID + suffix` or a later prompt argument.

### F4 — P0 — The question check is not adjacent to the send

`tools/fleet/steer.ts:677-701`, `tools/fleet/steer.ts:312-335`

The dialog is captured before `verifyTarget()`, which performs three commands with 10-second timeouts. The dialog can change while identity verification is running, yet the old keys are still sent successfully.

Make the final question capture/comparison the last check before delivery. The remaining unavoidable race should be milliseconds, not potentially several seconds.

### F5 — P0 — Arrow selection has an avoidable inter-call race

`tools/fleet/steer.ts:524-580`

Arrows and Enter are separate tmux calls. Another attached terminal can move the cursor between them, so Enter selects a different option.

`tmux send-keys` accepts `Down … Down Enter` in one invocation. That still cannot provide true terminal atomicity, but it removes this explicit extra window and partial-call failure.

### F6 — P0 — Pane output can forge a question

`tools/fleet/pane.ts:148-150,275-353`, `tools/fleet/collect.ts:331-346`, `tools/fleet/steer.ts:677-701`

The footer is a heuristic, not provenance. This is accepted as a dialog:

```text
❯ 1. Approve destructive action
  2. Cancel
Enter to confirm · Esc to cancel
```

A concrete race exists because status and pane capture are separate: status sees a genuine dialog; it is answered; the now-working agent prints attacker-shaped output while no input prompt is visible; the collector publishes stale `needs-you` plus the forged question. Re-capture and identity verification then reproduce and accept it, and the digit lands in a working pane.

This is especially serious in combination with the acknowledged foreground-process gap: a child program can print the forged menu and interpret the click however it wants. I would keep dialog answering read-only unless there is a structured, trusted source of question identity—or explicitly accept that pane text is executable UI.

### F7 — P0 — Options above 9 use physical line distance

`tools/fleet/pane.ts:254-264,275-304`

For numbered options above 9, arrow distance is calculated from terminal line indexes. Continuation lines therefore count as menu movements.

A continuation line before option 10 makes “choose 10” send ten Downs instead of nine and select option 11. Calculate distance in the parsed option array.

### F8 — P1 — New-session CSRF is DNS-rebinding vulnerable

`tools/fleet/routes-new.ts:188-223`, `tests/fleet-new-route.test.ts:350-407`

Unlike steering, this route has no hostname allowlist. It accepts whenever attacker-controlled `Origin` and `Host` agree.

A page at `attacker.example:8787` can rebind that name to the Tailscale address and send:

```text
Origin: http://attacker.example:8787
Host: attacker.example:8787
Sec-Fetch-Site: same-origin
Content-Type: application/json
```

All checks pass, allowing arbitrary agent launches. The directory allowlist is not confinement: the launched agent can change directory or modify anything its Unix account can.

Use one shared Origin implementation for both routes and add the exact rebinding-shaped test.

### F9 — P1 — “One launch at a time” has an await race

`tools/fleet/routes-new.ts:640-660,693-706,629-633`

The route checks `inFlight`, then awaits the request body, and claims the slot afterwards.

Two partial requests can both pass the empty-slot check, finish their bodies, and both launch. Whichever launch finishes first then sets `inFlight = null` while the other remains active.

Recheck and claim admission atomically after parsing, and clear the slot only if the completing record owns it. The existing test at `tests/fleet-new-route.test.ts:429-441` is serial and cannot expose this.

### F10 — P1 — The prompt can become a Claude CLI option

`tools/fleet/routes-new.ts:315-325`, `scripts/gjd-remote.ts:2550-2556`

The first process receives `-p -` safely, but downstream `gjd-remote` runs:

```text
claude --session-id UUID "$(cat prompt)"
```

There is no `--` before the prompt. A prompt such as `--dangerously-skip-permissions` is therefore a Claude flag, not prose.

The “stdin, never argv, no shell anywhere” conclusion is false end-to-end. Add `--` before the positional prompt.

### F11 — P1 — Private prompts leak despite the tests

`scripts/gjd-remote.ts:819-823,2480,2587-2605,2652`, `tools/fleet/routes-new.ts:343-348,615-619`, `tests/fleet-new-route.test.ts:225-230`

For unnamed launches, the first five prompt words become the provisional tmux name, are printed, stored and logged. The full prompt also becomes the remote Claude process argv and is readable by other same-user processes.

The test passes for the wrong reason: its sensitive word, `acquisition`, is the sixth word, and the fake launcher reports the unrelated name `x`.

Use a random/timestamp provisional name for web launches and test with a secret in the first word.

### F12 — P1 — Health admission fails open

`tools/fleet/routes-new.ts:681-690`, `tools/fleet/health.ts:432-445`

The route accepts `healthLevel() === "unknown"`. That is exactly what an overloaded box may report when it cannot fork or timeouts occur.

Additionally, a known critical disk reading can first raise `critical`, then be overwritten with `unknown` when load, memory and swap are unreadable. The launch then proceeds.

Refuse both `critical` and `unknown`; uncertainty must not erase an already-known critical result.

### F13 — P1 — `-d` bypasses `gjd-remote`’s setup admission

`tools/fleet/routes-new.ts:315-325`, `scripts/gjd-remote.ts:1188-1202,1231-1263,1380-1384,1454-1457`

The route always supplies `-d`, even for the default repository. `gjd-remote` intentionally treats explicit directories as an unverified escape hatch, so it skips repository setup status and the setup lock.

The dashboard can therefore start an agent while setup is rewriting the checkout or after setup status became unreadable. Use verified repo resolution for repository launches, reserving `-d` for an explicit unsafe mode.

### F14 — P1 — The client renders “never collected” as an empty healthy fleet

`tools/fleet/web/src/Header.tsx:63-96,151-160`, `tools/fleet/web/src/App.tsx:54`, `tools/fleet/web/src/SessionsPanel.tsx:184-190`

The server correctly emits `{rows: [], collectedAt: null}` before its first collection. Once the poll receives that object, client state is non-null, so it renders “0 sessions”, “No sessions”, and non-stale “collected at an unknown time”.

The test at `tests/fleet-web.test.tsx:307-313` uses `state: null`, not the real wire object, so it misses the defect.

### F15 — P1 — Any JSON object becomes an authoritative fleet state

`tools/fleet/web/src/types.ts:215-230`

`parseFleetState({})` succeeds. Missing `rows` becomes `[]`, malformed rows are dropped, schema is ignored, and invalid timestamps become null.

A 200 `{}`, a future incompatible schema, or a malformed blocked row therefore renders an empty or shortened fleet without an error. Require `schema === 1`, the rows array and the core discriminators; do not silently shorten authoritative state.

### F16 — P1 — The generation token can describe a different collection

`tools/fleet/collect.ts:267-280,317-334`

Session rows are collected first; panes and `tmuxServerPid` are sampled later in another command. If tmux restarts between them, old rows are joined to new pane handles and labelled with the new server PID.

Collect the generation with the inventory it identifies, or bracket collection with before/after generation reads and reject a change.

### F17 — P1 — Send failures are neither private nor binary

`tools/fleet/steer.ts:312-335,565-580`, `tools/fleet/routes-steer.ts:720-725`

If the text call succeeds and Enter fails, the route returns 409 but leaves the text in Claude’s input. A retry can append or later submit it. If `execFileSync` times out, delivery itself may also be ambiguous.

Separately, Node’s child-process error message contains argv. Failure of the literal-text call can put the supposedly unlogged message into the refusal and server log.

The result needs `none | partial | delivery-unknown`, including completed calls, and sanitized subprocess errors.

### F18 — P2 — Refused steering consumes rate-limit slots

`tools/fleet/routes-steer.ts:561-580,689-710`

The limiter records before text, target, status, live verification and delivery checks. Six well-shaped but bogus requests consume the whole-fleet allowance and block a legitimate request for ten seconds.

The limiter test at `tests/fleet-steer-route.test.ts:528-535` proves only that a limiter-refused request does not consume another slot; it does not test downstream refusals.

### F19 — P2 — The client ignores the advertised refresh interval

`tools/fleet/state.ts:55,75`, `tools/fleet/web/src/types.ts:81-96,215-230`, `tools/fleet/web/src/Header.tsx:42,88`

The server publishes `refreshMs = 60_000` specifically to prevent threshold drift. The client drops it and hardcodes 30 seconds. With a 60-second delay after each approximately 12-second collection, the healthy page reports STALE for about 42 seconds of each cycle.

### F20 — P2 — The launch timeout is not a resource deadline

`tools/fleet/routes-new.ts:480-508,613-633`

The timeout signals only the direct Node child. Its synchronous SSH child or an already-detached remote tmux session can continue. Nevertheless, the route releases admission and allows another launch after cooldown.

`maybeStarted: true` is honest presentation, but it does not preserve “one launch operation at a time”.

## Design judgments

`parseParents()` and `descendsFrom()` themselves are sound and fail closed on malformed tables, missing links, cycles and excessive depth. Their snapshots retain the ordinary PID-reuse race, but the larger concrete identity defect is F3.

The stale-claims design is directionally right: comparing live tmux with historical expectations is better than deriving both sides live. A signed snapshot token cannot prove what the human saw—a buggy same-origin client can fetch a fresh token just as easily as fresh fields.

A useful construction is an opaque immutable `snapshotId`: retain a short server-side snapshot ring and accept `{snapshotId, rowId, action}`. The server reconstructs pane/session/PID/tmux-generation/status/question digest from that historical snapshot. This prevents field mixing and hand-built claims, but an integration test must still prove that tapping rendered snapshot A submits A after snapshot B arrives.

On authentication: reachability-only is defensible only if the tailnet membership and all same-UID processes are trusted. If prompt-injected local agents are adversaries, an HTTP login or bearer token is insufficient—they already share the tmux socket and can invoke the underlying commands directly. That threat requires Unix-user/socket privilege separation. For remote peers, a Tailscale `whois` owner allowlist is a cheap improvement without adding a login page.

The new-session route should be unmounted until at least F8–F13 are resolved. At this revision the committed UI cannot use it, so it currently contributes attack surface without user benefit. Dialog answering should also remain read-only until F1, F4 and F6 have a satisfactory identity model.

The nonce evidence is sufficient for the narrow claim that one unique HTTP message reached and was consumed by the intended Claude: generation inside the script avoids the earlier command-echo false positive, the dependent Claude reply is an independent witness, and the unrelated pane is a useful control. It does not establish race safety, authorization, or general target correctness, and the exact script/baseline was not preserved in git.

No files were changed.