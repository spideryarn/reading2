# Dashboard: session descriptions, a notified Overseer, and a detail view that leads with the last message

**Status as of 2026-09-09 01:20: planned, nothing built.** Evidence: no file named `describe*` under
`tools/fleet/`, and `grep -rn "description" tools/fleet/web/src/types.ts` returns nothing on
`FleetRow`. This doc is a record of a decision, not evidence that anything shipped.

Umbrella plan: [260907e-agent-fleet-dashboard.md](260907e-agent-fleet-dashboard.md). Session name
`dashboard-titles-descriptions-detail`, worktree `260909a-dashboard-descriptions`.

## The goal

Four things Greg asked for on 2026-09-09 at 00:05, in his words:

> - When we start a New Session in the web UI, it should somehow notify the Overseer.
> - When we start a new session, it should get a good title and/or update in the web dashboard.
> - For each session, provide a 1-2-sentence description of what it's about, and show in the Session
>   List.
> - In the Session Detail section, show the most recent message (perhaps with a summary if idle)
>   prominently near the top, with the input-box and command-lists underneath, with a button to click
>   to open up the previous messages in a popup panel or something.

Underneath all four is one complaint: **the dashboard tells you a session's mechanical state and not
what it is doing.** A list of thirty-odd rows reading `no title yet` beside a status pill is a list
you cannot triage. So the deliverable is *legibility* — a name and a sentence per row, and a detail
view whose first screenful is the thing the agent last said rather than a box to type into.

**This is the middle robustness tier**, not the product's. See
[overseer-direction.md § A higher bar for robustness here than elsewhere](../project/overseer-direction.md#a-higher-bar-for-robustness-here-than-elsewhere-and-its-ceiling):
a reading that could not be taken must not render as a reading, the consumer must be unable to
discard the distinction, and a write refuses rather than degrades. Every "not yet described" and
"could not tell" arm below is that rule, not decoration.

## Greg's three product decisions, settled 2026-09-09 — do not reopen

Relayed through the Overseer, which asked him upfront.

1. **Descriptions and idle summaries come from a cheap model call, cached.** GPT Luna over
   OpenRouter, the path `tools/overseer/attention-classify.ts` already uses (a plain `fetch`,
   deliberately no import from `src/`), budgeted the way `planClassifications` budgets (`maxCalls`,
   keyed by a fingerprint so an unchanged input costs nothing), persisted the way
   `attention-memory.ts` persists `attention.json`. One call per session from its first turns for the
   description; refresh only when the session goes idle. **No key ⇒ publish "not yet described",
   never an empty string dressed as a description.**
2. **"Notify the Overseer" = one line into the Overseer's session**, sent when `POST
   /api/sessions/new` reaches `started`, to whoever holds the `overseer` claim; nothing sent when
   nobody holds it, and the launch record says so. Through the existing steer machinery, never a new
   sender. **Never the word "sent"** — nothing on this box can observe reception.
3. **Titles are dashboard display only.** Generate one for any row whose `title` is null, mark it as
   generated, and **do not rename the tmux session** — the name is the address `SendMessage` and
   `gjd-remote` use. Claude's own `aiTitle` wins the moment it arrives.

## References

Read in this order if you are picking this up cold.

**The contracts this work must not break**

- [overseer-direction.md § A higher bar for robustness](../project/overseer-direction.md#a-higher-bar-for-robustness-here-than-elsewhere-and-its-ceiling)
  — the middle tier, and the two-hand-written-declarations-of-one-contract class.
- [overseer.md § The gates](../project/overseer.md#the-gates) — gate 1, *never hide who decided*. The
  notify line is subject to it.
- `tools/fleet/wire.ts:1-23` — the no-imports rule, forced by the client's separate tsconfig.
  `wire.ts:1002-1016` — a new top-level field must be **required**, because an optional key crosses
  both ends silently. `tests/fleet-compile-guards.test.ts` is the gate.
- [260907e-agent-fleet-dashboard.md](260907e-agent-fleet-dashboard.md) § "Who is doing what" — the
  ownership table this plan works around.
- [260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md](../postmortems/260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md)
  — sixteen instances of a built, tested, routed and dead feature. Every stage below ends with the
  join exercised, not the parts.

**The machinery being reused**

- `tools/overseer/attention-classify.ts` — the gateway client. `classifyTail:427` (fetch shape,
  `temperature: 0`, `response_format: json_object`, `usage: {include:true}`, 30 s abort, **no
  retries**), `planClassifications:136` (budget, deterministic drop order, key-in-record check),
  `callCost:364` / `addSpend:379` / `describeCost:403` (the BYOK trap; `usage.cost` alone is `0` on
  this box). `ClassifierOptions.fetchImpl:416` is the injection seam and **no test has ever used it.**
- `tools/overseer/attention-memory.ts` — the cache-file pattern: schema version, key-in-record,
  parse-or-replace, `writeAtomically`, "a lost memory is a cost, never a lie".
- `tools/fleet/transcribe.ts:129` `openRouterKey()` — env, then one variable out of `.env.local`,
  never `loadEnvLocal`. Already used by a live fleet route, so the fleet server already makes paid
  calls and already holds the key.
- `tools/fleet/transcript.ts:891` `readRecentMessages()` — seeks **backwards** in 256 KB chunks,
  capped at 1 MiB and 12 turns × 2000 chars. The header at `:11-13` is explicit that not grepping
  whole transcripts "is most of why this dashboard exists".
- `tools/fleet/collect.ts:772` `readPauses()` — the shape to copy for a late async pass: one shared
  read for the fleet, per-row try/catch, and the rule at `:759-765`, *"A FAILURE HERE MUST NOT COST
  THE BOARD."*
- `tools/fleet/steer.ts:1312` `sendMessage(target, text, declaredStatus, io)` — synchronous;
  `Delivery = "none" | "partial" | "unknown"` at `:347`; `checkText:507` refuses newlines, control
  characters and >4000 chars; `steerableStatus:463`; the pane must read `empty-input`.
- `tools/fleet/overseer-claim.ts:243` `claimFromSnapshot(body, {nowMs, maxAgeMs})` →
  `{none} | {one,name,id} | {contested,names} | {cannot-tell,why,holder?}` at `:81-92`.
- `tools/fleet/actions.ts:522-525` `SPEAKER_PREFIX`, `:577` `renderMessage(text, speaker)`.
- `tools/fleet/routes-new.ts:182` `LaunchRecord`, `:863-871` the `started` transition, `:603`
  `NewSessionIo` (the injection seam), `:114` the promise that the prompt is never logged.

**The UI being changed**

- `tools/fleet/web/src/SessionDetail.tsx` — six sections, `:601-1135`. `DELIVERY_HEADLINE:319-336`
  is the four-armed delivery rendering that **must not change**.
- `tools/fleet/web/src/SessionsPanel.tsx:147-156` — the `no title yet` fallback.
- `tools/fleet/web/src/RecentMessages.tsx` — `useRecentMessages:398`, turns **newest last**.
- `tools/fleet/web/src/ui.tsx` — `Card`, `SectionHeading`, `Button`. There is **no modal, dialog or
  popover component anywhere in the fleet client**; the house pattern is a native
  `<details>/<summary>`, used five times, rationale at `ActionButtons.tsx:609-616`.
- `tests/fleet-web.test.tsx` — 8250 lines, jsdom + `react-dom/client` + raw DOM queries, **not**
  React Testing Library, no snapshots, flat `describe` blocks appended chronologically.

## Key decisions

### The describer runs in the dashboard, not in the daemon

**This reverses the Overseer's stated default, and the reason it gave for that default turned out not
to hold.** Its argument was that the daemon owns the budget, the key and `attention.json`'s pattern
while the dashboard stays a reader. The key half is simply false: `tools/fleet/transcribe.ts:129`
`openRouterKey()` has been in the fleet server since dictation shipped, and the dictation route makes
paid gateway calls today. So "the dashboard would need a key" was not a cost.

What decides it instead is **where the row is**:

- The description's input is the session's first turns. The only bounded transcript reader on this box
  is `readRecentMessages` in `tools/fleet/transcript.ts`, and its whole reason for existing is that the
  alternative — `gjd-remote ls` grepping multi-MB transcripts — costs 10–12 s a pass.
- The description must land **on a row in the Sessions list**, which is what Greg asked for. A
  daemon-side producer publishes through the register, and `wire.ts:1245-1293` refuses exactly that
  join: *"A register entry and a fleet row can agree about a pane and still be about different
  children: the generation tuple can stay fixed while the process inside it is replaced."* The
  dashboard holds the snapshot, so there is no join to get wrong.
- Ownership: daemon-run means additive surgery on `store.ts`, `daemon.ts` and `scripts/overseer.ts`,
  owned by two other in-flight workstreams. Dashboard-run means ~15 additive lines in `collect.ts`,
  owned by one.

**The objection that survives, and how it is answered.** A model call must not run inside `collect()`,
whose deadline is `COLLECT_DEADLINE_MS = 120_000` and whose failure blanks the board. So the pass runs
*beside* the collector on the server's refresh loop — the way `drainSharedQueues` is wired at
`server.ts:286` — and writes a file. `collect()` only ever **reads** that file, in a pass modelled on
`readPauses`. A wedged gateway therefore cannot cost the board a refresh; the worst it can do is leave
descriptions stale, which the record says out loud.

**What we lose, stated plainly:** the Overseer cannot read descriptions out of `current.json`. It can
read the file directly (it is in the store root and is plain JSON), which is not as good as the
checkpoint but needs no HTTP client — and my brief forbids a second HTTP client from the daemon
anyway. If the Overseer later wants them in the checkpoint, the producer moves and the file stays the
contract, which is the same argument `tools/fleet/attention.ts:14-24` makes about `loadCheckpoint`.

### One call yields the title, the description and the idle summary

Not three calls and not two. The input is the same material and the marginal cost of two more short
fields is a few dozen output tokens.

This also disposes of a question that looked live: **is a generated title worth a model call at all,
when Claude's own `aiTitle` arrives within a turn or two?** On its own, probably not. As a third field
on a call we are making anyway, it is free, and it fills exactly the window Greg complained about —
the first minutes of a session, when the list says `no title yet`.

### Two fingerprints, because the two artefacts have different lifetimes

- **`openingFingerprint`** — a hash of the session's earliest turns. Stable for the life of the
  conversation, so the description is computed once and never churns. This is the thing that makes
  "one call per session" true rather than aspirational.
- **`tailFingerprint`** — the same discipline as `turn-tail.ts:130`, over the newest turn, so the idle
  summary refreshes when the session has actually said something new and costs nothing when it has
  not.

A record carries **both** keys plus the `tmuxServerPid` it was computed under, and a reader that finds
a disagreement treats the record as stale rather than rendering it — `planClassifications`'
key-in-record check (`attention-classify.ts:151`), applied to a two-part key.

### The simpler options passed over

- **A Floating-UI dialog for the message history.** Rejected for a native `<details>/<summary>`: there
  is no dialog component in this client, `<details>` is the established pattern in five places, and
  `ActionButtons.tsx:609-616` already argues that a hover surface must not be the only copy of
  something a person needs to read. Greg said "a popup panel *or something*". If the disclosure reads
  badly at 390 px this decision gets revisited with a screenshot, not an argument.
- **A third `Speaker` arm** — see the open question below. The fallback is cheaper and touches nothing
  shared.
- **Doing nothing but showing `aiTitle` sooner.** It is genuinely most of the title win for zero cost,
  and it is *not* enough: it gives no description, which is the half Greg asked for twice.
- **Joining descriptions to rows in the browser.** Rejected: the client would have to re-derive the
  `tmuxServerPid` generation check, which is precisely the "two hand-written declarations of one
  contract" class. The join happens once, server-side, where the snapshot's own generation token is in
  scope.
- **Extending `attention.json` with a `descriptions` key.** Rejected: that file is the attention pass's
  private memory with its own schema version, and it is pruned to what *that* pass saw on each run.
  Same pattern, separate file.

## Coordination — asked and answered by the Overseer, 2026-09-09 01:40

1. **No third `Speaker` arm.** `SPEAKER_PREFIX` (`actions.ts:522-525`) has `greg` and `overseer`, and
   neither fits a notice *from the dashboard to the Overseer*: `greg` is a lie (he pressed a button,
   he did not write the line), and `overseer` would have the Overseer read a message apparently from
   itself. Adding `"dashboard"` would widen a union in `wire.ts` that `SPEAKER_PREFIX` and
   `parseSpeaker` must exhaust, turning the delivery-receipts agent's build red. **Ruled out; build
   the fallback**, which touches nothing shared: compose the line in `tools/fleet/notify-overseer.ts`
   with its own named prefix constant, call `sendMessage` directly, and test that the composed line
   (a) begins with an attribution naming the dashboard and disclaiming Greg, (b) is neither existing
   `SPEAKER_PREFIX`, and (c) survives `checkText` **after** prefixing.
   **This is a deliberate exception to the shared attribution machinery**, and the reason it is
   tolerable is that the text is fixed and reviewed — the same ground `renderSpoken`'s `/compact`
   exception stands on ([overseer.md § gate 1](../project/overseer.md#1-never-hide-who-decided)).
   If a second such sender ever appears, that is the moment to add the arm rather than a second
   constant.
2. **`collect.ts` is queued behind `260908f-roadmap-exec-identity`**, which is at suite-plus-review
   now. Merge `origin/dev` after it lands, then add the ~15 additive lines. That session has been told
   directly that I am queued behind it. If it has not landed by the time Stage 0 is reviewed, the
   Overseer arbitrates rather than have this wait.
3. **`scripts/gjd-remote-tmux.ts` is nobody else's tonight.** Stage 0 takes it.
4. The Overseer's "eight of twelve untitled" counted four shell panes; **8 live Claude sessions is the
   right denominator**, and five of them were untitled.

## Needs Greg — for the debrief, not mid-run

- **The prompt's first line leaves `routes-new.ts`.** That module currently records `promptBytes` and
  never the prompt, and its header at `:111-114` makes that an explicit promise. Greg's decision 2
  asks for "the prompt's first line" in the notice, which widens the promise. It is his call whether
  the notice carries the first line, a character count, or nothing but the session name. **Stage D
  builds it carrying the first line, truncated, since that is what he asked for, and flags it.**
- **A sentence readers see:** the wording of "not yet described" and of the generated-title marker.

## Stages

Each ends with the suite green, the tree committable, and a GPT Sol review. Nothing here restarts the
dashboard or the daemon — the debrief says a restart is needed and the Overseer arranges it.

### [x] Stage 0 — the titles that already exist and are not being read

**Added 2026-09-09 01:35, after the Overseer relayed that Greg had asked why most of the dashboard
says "no title yet". This stage is the answer, it needs no model call, and it landed first.**

`scripts/gjd-remote-tmux.ts:797` derived the title from the last `"aiTitle"` record in the transcript.
But Claude Code also writes **`"customTitle"`**, and `grep -rn customTitle scripts/ tools/ src/`
returned **nothing** — so every session launched by `gjd-remote` with a name, which is most of the
fleet, displayed as untitled for its whole life.

**Measured on the live fleet, 2026-09-09 01:33** (`scratchpad/MAIN-title-coverage.sh`), and again end
to end through the real script afterwards (`scratchpad/MAIN-live-titles.ts`):

| | before | after |
|---|---|---|
| live Claude sessions titled | **3 of 8** | **8 of 8** |
| all tmux sessions titled | 3 of 18 | 8 of 18 |

The five that gained one: `260908f-roadmap-exec-identity`, `260908f-roadmap-usage`,
`worktree-removal-script`, `fb2p-quotes-always-outlined-in-text` and this session. The ten still blank
are shells and `tmux-job` panes with no conversation, where blank is correct.

**The rule is "a chosen title wins outright", NOT "the most recent record wins" — and getting that
wrong is the interesting part of this stage.**

The first version of this fix took the newest record of either kind, on the strength of a census
saying the two keys never co-occur. **That census was wrong, and wrong in a way with a name:** it
ended in `head -30` over what turned out to be 70 files, and the truncated list was written up as an
exhaustive one — in the plan *and* in a source comment, which is exactly the shape
[silent-success.md](../reusable/silent-success.md) is about. The Overseer caught it by opening one
file the truncation had hidden.

**What is actually true**, from the untruncated census (`scratchpad/MAIN-title-census2.sh`) and from
the record shapes at lines 1708-1709 of the Overseer's own transcript:

| | |
|---|---|
| transcripts containing a `customTitle` | **70** |
| of those, also containing an `aiTitle` | **3** |
| of those 3, whose *last* title record is the `aiTitle` | **3** |

The harness emits the two **as a pair** — `customTitle` first, `aiTitle` immediately after — and
re-emits the pair on every re-title. So the last record is always the generated one, and newest-wins
discards the chosen name **every time it could matter**. Corrected rule: **the last `customTitle` if
there is one, otherwise the last `aiTitle`.**

**Verified live after the correction**, two rows changed for the better: the session Greg had named
`Overseer` stopped showing "Overseer and fleet improvement roadmap", and `claude-agents-dashboard`
stopped showing **"Fraud agents dashboard"** — a garbled `aiTitle` that a chosen name now overrides.

**What this still does not fix, so nobody re-reports it:** renaming a **tmux session** writes nothing
to the transcript. That is a separate fact on `FleetRow.name`, and it is a **debrief item for Greg**
rather than something to build — the Overseer's instruction, and right, because `adoptTitles` also
renames sessions *from* their `aiTitle` and the snapshot cannot tell an adopted name from a chosen one.

- [x] `scripts/gjd-remote-tmux.ts`: prefer the last `customTitle`, fall back to the last `aiTitle`.
      **One read of the file**, filtered twice — that grep is the dominant cost of a whole collection
      (`gjd-remote ls` takes 10-12 s almost entirely here), so a second `grep` over a multi-MB
      transcript would have been a real cost rather than a tidiness question. Fixes `gjd-remote ls`
      too, since the derivation is shared.
- [x] Nine tests in `tests/gjd-remote-tmux-script.test.ts`, which had **no title coverage at all** —
      that absence is why this could be wrong for as long as it was. Two went red first and are the
      reported bug; two are the pair case, taken from the real record shapes; the rest pin repeated
      re-titling, multiple renames, and the empty and absent-transcript arms.
- [x] **Mutation-checked**: removing the `customTitle` preference turns exactly the two pair tests
      red. Code and tests changed together here, so red-first was not available and this stands in
      for it.
- [ ] `SessionsPanel.tsx:147-156`: when there is still no title, fall back to `row.name` — which
      `SessionDetail.tsx:852` already does — instead of the italic "no title yet". **Moved to Stage C.**
- [ ] Check the escaped-quote truncation defect (`260831y-…-sol.md:82`) is not made worse by matching a
      second key; the same `[^"]*` limitation applies to both.

### [ ] Stage A — the describer, pure, with no wiring

The whole model call and its parsing, testable with no network and no fleet.

- [ ] `tools/fleet/describe.ts` (new): `SessionDescription` as a discriminated union with at minimum
      `{kind:"described", title, description, idleSummary|null, ...keys}`, `{kind:"not-yet-described"}`
      and `{kind:"cannot-tell", why}`. **No arm may be an empty string.**
- [ ] `buildDescriberPrompt(material)` — the tail is untrusted text written by another agent; fence
      it and say so in the system prompt, exactly as `buildClassifierPrompt` does at
      `attention-classify.ts:176-178`. Cap the material the way `turn-tail.ts:114-115` does.
- [ ] `parseDescription(raw)` — total and strict; anything unexpected is `cannot-tell`, never a
      plausible-looking default. Model `parseVerdict:228`.
- [ ] Reuse `callCost` / `addSpend` / `describeCost` / `ClassifierSpend` from `attention-classify.ts`
      rather than re-deriving the BYOK arithmetic. Generalise `planClassifications` over its item type
      if that is cleaner than a parallel copy — decide when the code is in front of you, and say which
      in this doc.
- [ ] **Tests, red first.** Including the one nobody has written: assert the HTTP body through the
      unused `fetchImpl` seam — model id, `temperature: 0`, `usage: {include:true}`, the
      `Authorization` header — following `fakeGateway()` in `tests/fleet-transcribe.test.ts:58-74`.
- [ ] Mutate the finished code and check the suite notices ([silent-success.md](../reusable/silent-success.md)).

**Done looks like:** `npx vitest run tests/fleet-describe.test.ts` green, nothing else in the repo
imports the new module, no paid call has been made.

### [ ] Stage B — the pass, the file, and the join onto rows

- [ ] `tools/fleet/describe-store.ts` (new) — `descriptions.json` in the store root: schema version,
      key-in-record, parse-or-replace, atomic write. **Do not import `writeAtomically` from
      `tools/overseer/jsonl.ts`** — `tools/fleet/attention.ts:14-24` deliberately refuses the
      equivalent import to avoid closing a `fleet` ↔ `overseer` cycle; check what
      `tools/fleet/health-history.ts` already does and follow it.
- [ ] `tools/fleet/describe-pass.ts` (new) — takes rows, picks who needs describing, reads material
      with `readRecentMessages`, calls the gateway under `maxCalls`, writes the file. Every side effect
      injected (`read`, `call`, `now`) the way `runAttentionPass` injects `capture`/`classify`/`now`.
      Over-budget sessions are **reported, never hidden**.
- [ ] Wire it into `server.ts`'s refresh loop **beside** `collect()`, not inside it. No key ⇒ the pass
      does not run and the file says `not-yet-described`, the way `attentionRunner` returns `null`.
- [ ] `collect.ts`: `description` on `FleetRow`, initialised in `toRows`, filled by a
      `readDescriptions(rows)` pass beside `readPauses` that checks both fingerprints and the
      `tmuxServerPid` generation. **Ask the Overseer first** (open question 2).
- [ ] `web/src/types.ts`: the client-side type, required not optional.
- [ ] Tests: the pass with an injected gateway; the store's stale-key refusal; the join, including a
      record whose generation disagrees.

**Done looks like:** `/api/state` carries a description for at least one real session on this box, read
out of the running server — not out of a fixture.

### [ ] Stage C — the Sessions list

- [ ] `SessionsPanel.tsx:147-156`: show the generated title where `row.title` is null, **marked as
      generated**, and the description beneath. `aiTitle` wins whenever it exists.
- [ ] "not yet described" and "could not tell" render as themselves.
- [ ] Fits ~316 px of text (the narrow column is 340 px minus card padding) and reads at 1280 px.
- [ ] New `describe` blocks appended to `tests/fleet-web.test.tsx`; **never reorganise** existing ones.
- [ ] Browser check at 390 px and 1280 px — **Sonnet subagent**, Playwright, per
      [browser-testing-playwright.md](../project/browser-testing-playwright.md). Tell it to kill its
      own dev server by PID, never `pkill -f vite`.

### [ ] Stage D — notify the Overseer on `started`

- [ ] `tools/fleet/notify-overseer.ts` (new): find the claim holder, resolve its row to a
      `SteerTarget`, compose the one line, send, return a typed outcome.
- [ ] Outcome vocabulary is the one the path already returns — **submitted / partial / unknown / no
      holder / refused(code)** — plus `contested` and `cannot-tell` from `OverseerClaim`. Never "sent".
- [ ] `routes-new.ts`: a new **injected dep** (so the module stays free of steer/collect imports and
      the imports guard stays green) and a new nullable field on `LaunchRecord`, set at the `started`
      transition `:863-871`. Never `void notify(...)` — carry the result into the record.
- [ ] Wire the real implementation in `server.ts`, where the snapshot lives.
- [ ] Bound the `SteerIo` timeouts: `sendMessage` is synchronous `execFileSync` with up to three tmux
      calls at 10 s, and `launch()` runs on the server's event loop. A 30 s block on the middle tier
      looks exactly like the page dying.
- [ ] `NewSessionPanel.tsx`: render the outcome after `record.note` at `:165-167`.
- [ ] Tests: the three states Greg named — a holder exists, nobody holds it, the send refuses — plus
      contested and cannot-tell. Fake the send at the `NewSessionIo`-style seam; **nothing touches a
      real pane.**

### [ ] Stage E — the detail view

New order, the loud band staying on top:

| | today | after |
|---|---|---|
| 1 | what it needs from you | what it needs from you |
| 2 | say something to it | **latest message** (+ idle summary when idle), earlier behind a disclosure |
| 3 | ask it to… | say something to it |
| 4 | waiting to go to it | ask it to… |
| 5 | recent messages | waiting to go to it |
| 6 | where it is | where it is |

- [ ] Split `RecentMessages.tsx` into a latest-message view and an earlier-messages disclosure over the
      same `useRecentMessages` reading. **The refusal arms (`not-found`, `unreadable`, `no-answer`,
      "not read yet") surface at the top with the latest message**, not down with the provenance — a
      reading that could not be taken must not render as silence.
- [ ] Re-parent `ActionButtons` freely; **change nothing it says**, and leave
      `DELIVERY_HEADLINE:319-336` byte-identical. If an arm reads badly in the new layout that is a
      message to the dashboard agent via the Overseer, not an edit.
- [ ] The idle summary shows only when the session is idle **and** the summary is cached — never a
      spinner where a sentence goes.
- [ ] New `describe` blocks in `tests/fleet-web.test.tsx`, appended.
- [ ] Browser check at 390 px and 1280 px in a Sonnet subagent.

### [ ] Stage F — land it

- [ ] `npm test` and `npm run typecheck` in tmux via `scripts/tmux-job.ts` — never backgrounded, which
      is OOM-killed on system memory pressure.
- [ ] Final GPT Sol review of the whole diff, weighted higher than the plan review.
- [ ] Update this doc's status line, push to `dev`, debrief per
      [debrief-progress.md](../reusable/debrief-progress.md).
- [ ] `npm run worktree:check` before the worktree is removed.

## Risks, surfaced early

- **The idle edge is not what it looks like.** `idle` describes the pane, not the work: ten of fifteen
  sessions genuinely waiting on Greg showed as idle (`turn-tail.ts:6-16`). Refreshing a summary on the
  idle edge is still right — it means "the agent stopped generating" — but the summary must not say
  "finished".
- **`statusSince` is a floor, not a measurement**, for any session already running when the daemon
  started (`store.ts:275-282`). Nothing in this plan may key a cache on it; that is why both keys are
  content fingerprints.
- **`title` truncates on an escaped quote** (`260831y-gjd-remote-final-review-sol.md:82`) and the
  session is then permanently marked non-provisional. Not ours to fix, but a generated title sitting
  beside a truncated `aiTitle` will look like our bug.
- **Two agents editing `tests/fleet-web.test.tsx`.** Append only, re-read immediately before editing.
