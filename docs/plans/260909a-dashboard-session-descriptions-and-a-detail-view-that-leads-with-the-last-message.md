# Dashboard: session descriptions, a notified Overseer, and a detail view that leads with the last message

**Status as of 2026-09-09 02:45: Stage 0 committed and pushed to `dev` (`2d50d6a7`, merged and pushed
as `3d020761`); Stages A–F unbuilt, and the plan for them is being rewritten against a cross-family
review that refused it.** Evidence: no file named `describe*` under `tools/fleet/`, and
`grep -rn "description" tools/fleet/web/src/types.ts` returns nothing on `FleetRow`. This doc is a
record of a decision, not evidence that anything shipped.

**The review is [260909a-dashboard-session-descriptions-review-sol.md](260909a-dashboard-session-descriptions-review-sol.md)**
— twelve findings, seven of them established P1s, verdict *refuse as written*. The ledger is at the
bottom of this doc. Do not build Stages A–F from the text above until the ledger says a finding is
folded in.

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

### The description needs a reader that does not exist yet

**Found 2026-09-09 02:30, after the plan went to Sol and before Stage A started.** The plan above says
the description comes from "the session's first turns", read with `readRecentMessages`. **It cannot
be**: `readRecentMessages` (`transcript.ts:891`) and `readRawTail` (`:1055`) both seek **backwards**
from the end of the file, and there is no forward reader anywhere in `tools/fleet/`. What they return
is the newest 12 turns, which is the opposite end of the conversation.

That matters beyond plumbing, because it is what makes the cache design work. A description taken from
the newest turns describes what a session is doing *now*, so its fingerprint churns on every turn and
"one call per session" becomes one call per turn — the exact cost `planClassifications` exists to
prevent.

**The answer is a small forward reader**, and it is smaller than it looks because
`recordsToTurns(records, maxTextChars)` is already exported (`transcript.ts:717`) and does the hard
part: coalescing an assistant turn that spans several JSONL lines by `message.id` (1497 of 2806 ids in
the measured transcript spanned more than one line), and dropping `isSidechain` subagent records that
would otherwise read as the main agent saying things it never said. So the new code is "read the first
N KB, keep the complete records, hand them to `recordsToTurns`".

**It is also cheaper than the reader it sits beside** — a forward read is one chunk from byte 0, with
none of the backwards seeking `readRecentMessages` needs — which is worth saying because "another
transcript read per session" sounds like the 10–12 s cost this dashboard exists to avoid, and is not.

Two consequences for the stages below: Stage A gains the reader, and **`tools/fleet/transcript.ts`
joins the file set** (it is in nobody's claim).

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

1. **A third `Speaker` arm, `"dashboard"` — reversed twice, and the second reversal is the right one.**
   `SPEAKER_PREFIX` (`actions.ts:522-525`) has `greg` and `overseer`, and neither fits a notice *from
   the dashboard to the Overseer*: `greg` is a lie (he pressed a button, he did not write the line),
   and `overseer` would have the Overseer read a message apparently from itself.

   The Overseer first ruled the arm out on the ground that widening the union turns the
   delivery-receipts agent's build red, and I planned a private prefix constant instead. **Sol's F5
   refused that**, and the Overseer withdrew its ruling: a second hand-written attribution mechanism
   is exactly what gate 1 forbids, and a scheduling conflict is not a reason to create one.

   **The mechanical detail that settles it beyond the principle:** `SPEAKER_PREFIX` is an exhaustive
   `Record<Speaker, string>`, so a private constant could never have compiled *honestly* — it would
   have been a second declaration of the same contract with nothing relating the two, which is the
   `QueueView` twin that cost this project four dropped fields in one night. The arm is two files,
   `wire.ts` and `actions.ts`.

   **`claude-agents-dashboard` adds it itself**, in a small commit straight after its Stage 4, and
   sends the Overseer the sha. **Stage D starts then**, and not before.

   **THE ARM IS FOR REPORTS ONLY, AND THIS IS A CONSTRAINT ON EVERY FUTURE USE OF IT.** Its prefix
   says *a person acted and software is reporting it*. That sentence is true of "somebody started a
   session from the web UI" and false of anything the receiving agent is meant to act on. So if
   anything ever sent under this speaker is an **instruction**, the prefix has become a false
   statement about its own message and **the arm must be split, not reused** — a reporting speaker
   and an instructing one are two different claims about authority and must not share a label.
   The Overseer's constraint, 2026-09-09, and it is written here because the next person to reach for
   this arm will be reaching for a convenient existing thing.

   One thing comes free: `renderMessage` already refuses a slash command from any speaker but `greg`
   (`actions.ts:578-583`), so the notify line inherits that and cannot smuggle a command.
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

- [x] Split `RecentMessages.tsx` into `LatestMessage` and `EarlierMessages` over the **same**
      `useRecentMessages` reading — one fetch, one view, two renderers, so the newest turn and its
      older siblings cannot disagree about what was read.
- [x] **The refusal arms surface at the top with the latest message.** `not-found`, `unreadable`,
      `no-answer` and *not read yet* are the states in which there is no newest turn; leaving them
      downstairs would have rendered **nothing** at the top, which reads as a session that has said
      nothing rather than as a transcript we could not read. A test pins it.
- [x] **The stale note moved up with the turn it qualifies, and the provenance did not.** Same cut
      `Found` already made one level down: bytes-read changes what you *believe*, age changes what you
      *do* — and the disclosure is closed by default, so a caveat inside it is a caveat nobody has.
- [x] Re-parented `ActionButtons` and the queue below the conversation; **nothing they say changed**
      and `DELIVERY_HEADLINE` is byte-identical.
- [x] One line of existing copy did change and had to: the shell sentence said "the transcript and the
      identifiers **below**", and the transcript is now above it.
- [x] Six `describe` blocks appended to `tests/fleet-web.test.tsx`; nothing reorganised.
      **All 345 pass, and the new ones are capable of failing** — rendering every turn in `Latest`
      instead of the newest turns "shows only the newest turn outside the disclosure" red. The order
      assertions would have failed before the change too, because `Latest message` did not exist.
- [x] The disclosure is located in tests **by what its summary says**, not by `querySelector("details")`:
      Rename and *Where it is* are also `<details>` sharing the class, so the first match is whichever
      sits highest on the page, and "not inside the disclosure" would have passed against the wrong
      element for a reason unrelated to the claim.
- [ ] **The idle summary is NOT in this stage** — it needs the describer, which is blocked. The
      section is built to take it: when it arrives it goes beside the newest turn, shown only when the
      session is idle *and* the summary is cached, never a spinner where a sentence goes. F9's
      constraints (summarise the last completed turn, never infer "finished" from `idle`) land with it.
- [x] Browser check at 390 px and 1280 px, in a subagent driving Playwright against a server run out of
      this worktree. Not Sonnet, deliberately: those are rate-limited until 2026-09-12 and a 429 kills
      a spawned agent mid-task rather than at spawn.

**What the browser said, and the one thing it caught that no test could.** Order correct at both
widths, measured by vertical position rather than by DOM order alone; no horizontal overflow at 390 px
(`scrollWidth === clientWidth === 390`, open and closed), long `Bash` strings in tool-call lines
breaking mid-token rather than overflowing; the newest turn readable without pinching; console
completely silent — zero messages of any type, not even the one error the docs lead you to expect.

**And the finding: the disclosure summary was styled as a section heading, not as a control.** It had
copied *Where it is*'s summary styling — 11 px, uppercase, tracking-widest, ink-faint — so on screen
it sat between `LATEST MESSAGE` and `SAY SOMETHING TO IT` reading as a third section label, with
nothing but the browser's native 8 px triangle to say otherwise. `cursor: pointer` is invisible on a
phone. The agent's words: *"I'd have scanned past it."* That is the one thing a jsdom test cannot
answer — every assertion about it passed, because the element was correct and only its appearance was
wrong — and it is precisely the "button to click" Greg asked for.

Fixed: sentence case at 13 px with a border and a panel fill. **And a second fix from the same
report**, which was offered as the lower priority and taken anyway because it is two lines: opening
the disclosure inline pushed the composer ~2,600 px down at 390 px (measured, `y=1576` → `y=2841`), so
reading back and then replying was a long scroll each way. The content is now capped at `60vh` with
its own scroll — which is *closer* to the "popup panel" Greg asked for than an unbounded expansion, so
it costs nothing in fidelity to the request.

**And the cap introduced a defect of its own, which the second browser round caught.** With no
boundary on the scrolling box, `offsetWidth − clientWidth` was `0` at both widths — overlay
scrollbars, no gutter, no persistent bar — so the last visible turn simply stopped and the next
section began. At 390 px the cut landed mid-turn, and a panel holding six more messages read as **a
conversation that ends here**. That is this tool's own failure mode wearing a new hat: an absence
rendering as a fact, introduced by a fix for something else. A border and radius matching the control
that opened it makes the cut legible as a cap. Verified after: the border computes on the scrolling
div (`1px solid oklch(0.9 0 0)`, all four sides) as well as the summary, `offsetWidth − clientWidth`
is now `2` — the borders, not a reclaimed gutter — and at maximum scroll the last child's bottom sits
exactly on the panel's inner bottom edge (`650 === 650` at 1280, `616 === 616` at 390), so the side
padding clipped nothing. It reads as **two stacked related boxes** — a control with its output panel
beneath — rather than one unit, which keeps the summary legible as the thing you press while the panel
is open.

**Two pre-existing defects the move made prominent, and they are Greg's calls rather than this
stage's.** The turn body renders as raw text, so a message containing `**bold**` or backticks shows
its markup — deliberate, because `web/src/` is under a glob test forbidding raw HTML and rendering
markdown is a scope and safety decision, not a tweak. And a long turn is cut mid-word above *"Cut
short — 2,253 characters in full"*, which is server-side `maxTextChars`. Both were tolerable at the
bottom of the page and are more noticeable as the first thing you read.

**One thing the check could not observe:** no session on the box had a pending question at the time,
so *"What it needs from you"* above the latest message is verified by a jsdom test and by source
order, not by a screenshot.

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

## Review ledger — GPT Sol, round one, 2026-09-09

Verdict **refuse as written**: no P0, seven established P1s. The artefact is
[260909a-dashboard-session-descriptions-review-sol.md](260909a-dashboard-session-descriptions-review-sol.md);
findings are addressed by ID and each ID appears exactly once. Every finding below was checked
against the code before being accepted.

| ID | Finding | Disposition |
|---|---|---|
| F1 | A reused pane renders the previous conversation's description | **Accepted** — verified |
| F2 | The reader cannot detect that its cached idle summary is stale | **Accepted, reduced** |
| F3 | `readRecentMessages` cannot produce `openingFingerprint` | **Accepted** — found independently first |
| F4 | Web-launched sessions are ineligible for generated titles | **Accepted** — verified, and worse than stated |
| F5 | The private notification prefix violates the attribution gate | **Escalated** — conflicts with a coordination decision |
| F6 | Nullable notification state lets the consumer lose the result | **Accepted** |
| F7 | Bounding individual calls still blocks the dashboard (~60 s, not 30 s) | **Accepted** |
| F8 | A stale claim can notify a former Overseer | **Accepted** |
| F9 | "Must not say finished" has no implementation requirement | **Accepted** |
| F10 | Stages A and B deliberately end with dead joins | **Accepted** |
| F11 | The daemon rationale overstates what `wire.ts` refuses | **Accepted** — conclusion stands, reasoning did not |
| F12 | The plan's status line is internally stale | **Fixed** |

### The three that change the shape of the work

**F1 is the one that would have shipped.** `transcript.ts:200-215` says it outright: `CLAUDE_SESSION_ID`
is set once at session creation and *never updated*, so a pane re-used for a second conversation still
names the first one, and the reader "will faithfully return that conversation's last turns… real
messages, well formed, correctly attributed, about this repo. They are simply not the conversation on
screen." Every key I proposed — both fingerprints, `tmuxServerPid`, the pane and session handles —
matches in that sequence, so conversation A's confident description renders on conversation B's row.
That is precisely the failure this whole codebase is organised against, and my key design did not
touch it.

**The fix is a dependency rather than a patch:** a description is renderable only when the row's
Execution identity is `verified` and its verified conversation id is the id of the transcript that was
read; `claimed-only` or `unknown` produces `cannot-tell` and never falls back to `CLAUDE_SESSION_ID`.
That is `FleetRow.execution`, which `260908f-roadmap-exec-identity` is landing — so Stage B was
already queued behind it, and now *depends* on it rather than merely sharing a file.

#### The shape it depends on — verified by reading, not by being told

**Not on `dev` as of 2026-09-09 03:10**: `git show origin/dev:tools/fleet/wire.ts | grep -c
ConversationReading` prints `0` and `tools/fleet/execution-identity.ts` is absent from `origin/dev`.
The owning session's gates (full suite, Sol review) are still running and it will not push before they
are dispositioned, which is right.

**But it is checkable anyway, because we are on one box**, and it was cross-checked rather than taken
on trust — read directly out of
`/home/greg/code/spideryarn2/.claude/worktrees/260908f-exec-identity/tools/fleet/wire.ts`:

```ts
export type ExecutionToken = { boot: string; pid: number; startTicks: number };   // :1523

export type ConversationReading =                                                  // :1545
  | { kind: "not-claimed" }
  | { kind: "verified"; id: string }
  | { kind: "conflicting"; claimed: string; observed: string }
  | { kind: "unverifiable"; claimed: string; why: string };

export type ExecutionReading =                                                     // :1612
  | { kind: "verified"; token: ExecutionToken; harness: HarnessKind; conversation: ConversationReading }
  | { kind: "claimed-only"; conversation: ConversationReading; why: string }
  | { kind: "unknown"; cause: ExecutionUnknownCause; why: string };
```

**The separation is the whole point and is exactly F1:** knowing which child process is running does
not prove which transcript it is writing, so those are two readings rather than one. `conversation.id`
is the id the live process's own `--session-id` carried, not the tmux claim — and `wire.ts:1551-1555`
says outright which side is stale: *"the claim is the stale one … `observed` is the conversation
actually in the pane and `claimed` is what every address in this payload would have sent you to."*

**A wrong inference, recorded because the type invites it.** `claimed-only` also carries a
`conversation`, and I read that as meaning `conflicting` is reachable from two execution arms — that
we could know a pane had changed hands without having identified the process. **It is not, and the
reason is structural:** `claimed-only` means the walk ran and could not *name* what it found, so no
command line was read, so there is no observed conversation id to disagree with the claim.
`readExecutionIdentity` passes `observed: null` on that path unconditionally
(`execution-identity.ts:258`) and `conversationOf` (`:302`) maps a null observation to `unverifiable`,
or `not-claimed` where there is no claim. **`conflicting` comes from `verified` and nowhere else.**

So the coverage is *narrower* than I thought, not wider, and the verified-only predicate was right all
along. The type does not express the invariant, which is why a careful read reached the opposite
conclusion; its author has added it to the arm's doc comment.

| reading | what the row shows |
|---|---|
| `execution.verified` **and** `conversation.verified` **and** the id matches the transcript read | the description, keyed on `boot:pid:startTicks` |
| `conversation.conflicting` (reachable from `verified` only) | **"this pane is running a different conversation now"** — never a description |
| anything else | `cannot-tell`, worded informatively (see the caveat below) |

**A near miss worth knowing about, since it looks like thrown-away information.** When a harness *is*
named and only its start ticks cannot be read, the reading is `unknown`/`process-start-unreadable`
and it discards a conversation verdict it briefly held. Promoting that to `claimed-only` carrying the
real verdict *would* make `conflicting` reachable from two arms — and was rejected deliberately,
because a failed `/proc` read almost always means the process exited between the `ps` and the read, so
naming the conversation a dead process was running is a false alarm rather than a rescued fact.

Three refinements from that session, all taken:

- **Key the cache on the execution token, not merely gate rendering on it.** The token stringifies as
  `boot:pid:startTicks`. With it in the key, conversation B *misses* the cache and generates its own
  description, so the stale entry becomes **unreachable** rather than merely unrendered. Gating alone
  leaves a correct-looking record sitting in the cache waiting for some later code path to find it —
  the difference between a wrong state being invisible and being unrepresentable, which is the rule
  this project actually holds itself to. Do both.
- **`conflicting` gets its own copy, not the grey "cannot tell" arm.** When the conversation reading
  is `conflicting`, we know a great deal: `observed` is what is actually running in that pane and
  `claimed` is the stale id every other field on the row still names. That is a *positive* statement —
  **this pane is running a different conversation now** — and it is the single case F1 is about.
  Collapsing it into the same arm as `unverifiable` throws away the finding.
- **Do not import `tools/fleet/execution-identity.ts` from the browser**; it reads `node:fs` at module
  scope, and `tests/fleet-imports.test.ts` is the guard. Its `identityWriteGate` is server-side only.
  Narrow inline in the client instead — the shape is declared once in `wire.ts` and the compiler
  enforces the narrowing, so that is not a hand-written second copy of a contract.

**And the caveat that shapes the copy rather than the code:** a live, working Claude can read as
`claimed-only` — a session launched before `new-claude` began writing `--` has a prompt running past
the option region, so `claude-argv.ts` refuses the command line. More importantly, **every row parses
to `unknown` until both the dashboard and the daemon are restarted on that code**, which is the
Overseer's to arrange. So `cannot-tell` is the **normal case for a while, not an error**, and its
wording must be informative rather than apologetic or it will read as a broken page.

**F4, and it is partly self-inflicted.** `routes-new.ts:405-423` already documents this and cites an
earlier Sol finding: a web launch passes an opaque `web-<clock>` name, which makes gjd-remote run
`claude --name`, which writes a `customTitle` and sets `GJD_PROVISIONAL=0`. Privacy was chosen over
the title deliberately — a prompt-derived name would leak the prompt onto every listing on the box.

**Stage 0 then made the consequence worse**, which I did not see when I shipped it: those sessions used
to read `title === null` and would have been eligible for a generated title; now they carry an opaque
clock-shaped one and Stage C's `row.title === null` test skips them. So Stage 0's headline number is
weaker than reported — for a launcher-named session the `customTitle` simply *is* the session name, and
what it gained is a title identical to a name the list could already show. **Stage 0's durable win is
narrower: it stops rows showing a *misleading* generated title** (`Overseer`, and
`claude-agents-dashboard`'s garbled "Fraud agents dashboard").

**The eligibility rule is therefore not `row.title === null`.** The cheap and general form, preferred
over Sol's gjd-remote change because it needs no launch-path surgery and catches every launcher name
rather than only the web one: **a title equal to the session's own name is a name, not a title.** It
reclassifies `worktree-removal-script`, `web-260908-125129-3e7aab` and every `w2-*` session as
undescribed, which is what they are. Sol's tmux-only-name option remains the right fix *at the source*
and is worth doing later; it is not worth blocking the description work on.

**F10 is a fair hit with the postmortem I quoted at it.** Stage A's done condition was "nothing else
imports the new module", which is Class A from
[260908b](../postmortems/260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md) — the exact
failure I cited in the References. Stages A–C merge into one delivery stage whose completion boundary
is the real `statePayload` output rendering every description arm in a real browser; the unit-level
describer and store become reviewed checkpoints inside it, not landed stages.

### F5 — escalated, not decided

Sol: *"`overseer.md` says attribution is enforced through required `Speaker`, 'and you should not work
around it.' The plan explicitly works around it with a private constant. A coordination conflict with
another branch is not a reason to create the second handwritten attribution mechanism the gate
forbids."*

The Overseer ruled the opposite four hours earlier, on the ground that widening `Speaker` turns the
delivery-receipts agent's build red mid-flight. **Both are right about their own half**: Sol is right
that a second attribution path is the thing gate 1 forbids, and the Overseer is right that this is a
scheduling problem. They are not actually in conflict — the answer is to add the arm *after* the
delivery-receipts work lands, which is a sequencing decision the Overseer owns. Put back to it rather
than settled here; Stage D does not start until it answers.

### One risk carried from a peer, 2026-09-09

**The cache key is built out of a type another session is still having reviewed.** `ExecutionToken`'s
three fields (`boot`, `pid`, `startTicks`) are what the description cache is keyed on, and Sol has
been asked specifically to attack that token design and the differ's sampling gap. Its author thinks
it much more likely the token survives untouched, and flagged it anyway — correctly, because a silent
change to those three fields is a cache migration for us rather than a rename.

**So the token is consumed through one stringifier and one place**, not spread through the describer,
and the plan says so here rather than discovering it later: if the token's shape moves, exactly one
function changes and every stored record is invalidated by its own key rather than by a migration.

## One more coordination, 2026-09-09 — the shared turn renderer

`recent-messages-tab` is building a dock tab showing a rolling window of recent messages across every
live session, and asked whether to reuse `RecentMessages.tsx`'s rendering or duplicate it while this
stage is in flight. **Answered: extract it, and the reason is a correctness hazard rather than
tidiness.**

`Turn` is small, but it renders `SPEAKERS`, a nine-arm map over `MessageSpeaker`, and two of those
arms are traps. `transcript.ts:60-64` says a `compact-summary` *"reads exactly like a person
recapping the task"* and is *"the single most convincing wrong answer this module could give"*. A
second renderer that collapses that into `human`, or falls through on an arm it does not know, shows a
fabricated recap as something a person said — and a cross-session feed is the **worst** place for that
bug, because its reader was not watching those sessions and has no independent sense of what was said
in them. Duplicating markup is cheap; duplicating a nine-arm discrimination with two landmines is not.

**The split, so neither agent edits the other's file:** that session creates a new file holding `Turn`
and `SPEAKERS`, copied as-is; this one deletes the local copy and changes one import once Stage E is
green and reviewed. Two copies exist harmlessly in between, and each step has one owner.

## Review ledger — GPT Sol on the Stage E code, round one, 2026-09-09

Verdict **refuse**: four established P1s, two P2s. Artefact:
[260909a-dashboard-session-descriptions-review-e-sol.md](260909a-dashboard-session-descriptions-review-e-sol.md).
It ran `tests/fleet-web.test.tsx` itself (345/345 at the time) rather than reasoning about it, and
changed no files. All six accepted; every one verified against the code first.

| ID | Finding | Disposition |
|---|---|---|
| F13 | An incomplete empty read is presented as a silent session | **Fixed** |
| F14 | An older readable turn can be labelled "Latest message" | **Fixed** |
| F15 | Uncertainty about which transcript is live is hidden as provenance | **Fixed** |
| F16 | The zero-turn disclosure invents an "only turn" | **Fixed** |
| F17 | The tests do not pin the stale warning *outside* the disclosure | **Fixed** |
| F18 | The split does not make refusal loss unrepresentable | **Fixed** |

**All six are one mistake with six faces, and it is a mistake the move itself created.** This section
used to sit at the bottom of the page, where a sentence reads as a footnote. It now sits second, where
a sentence reads as *the session's current state* — and four of its sentences had only ever been true
as footnotes.

- **F13** — `found` with no turns said *"a session that has not spoken yet"* even when
  `reachedStartOfFile` was `false` (the read explicitly did not reach the beginning) or `null` (no
  claim either way). Neither establishes silence. The empty branch also returned **before** the stale
  warning it had already computed, so the least certain reading was the one shown with the fewest
  qualifications. Now three distinct sentences, and the caveats are drawn whether or not there is a
  turn.
- **F14, and it is the sharpest.** `parseRecentMessages` drops a turn it cannot parse and keeps only a
  **count** — the *position* is lost (`messages-client.ts:279-288`, verified). So given
  `[readable, unreadable]` the page renders the readable one under "Latest message", and **the missing
  one may be newer**. The warning existed and was inside the closed disclosure. Now beside the turn.
- **F15** — `copies !== 1` means we cannot tell which file is live, and steering on that message may
  answer a different conversation. That changes what you **do**, so by this file's own do/believe rule
  it cannot live behind a disclosure. My rule, applied against me.
- **F16** — an empty `older` slice has two causes that mean opposite things: one turn was read and it
  is above, or nothing was read and the thing above is an empty-state sentence. The sentence I wrote
  covered both and contradicted the second.
- **F17 is a finding about the tests, and a good one.** jsdom's `container.textContent` **includes the
  descendants of a closed `<details>`**, so every "is the warning on the page" assertion passes whether
  a reader can see it or not — moving `StaleNote` back inside would have kept the suite green. The new
  tests assert *containment* against the disclosure element. Verified by mutation: removing `StaleNote`
  from the visible half turns exactly that test red.
- **F18** — the two halves were exported separately, and although the only caller paired them
  correctly, the *API* let a future consumer render the history alone and flatten all four refusal
  states into nothing. Now one exported `Conversation` owns the exhaustive switch and
  `EarlierMessages` takes only the `found` arm, so the bad composition is not expressible.

Eight tests added (363 total), typecheck clean across 1765 files.

## Stage D: the module is built, and its wiring hit a design question worth stopping on

**Built, tested and committed (`189e234c`): `tools/fleet/notify-overseer.ts` and its 15 tests.** Who to
tell, what to say, what to record about what became of it — everything impure injected, so all six
arms of `NotifyOutcome` are reachable with no tmux, no pane and no gateway. Mutation-checked:
collapsing `cannot-tell` into `no-holder` turns exactly the test that names that distinction red.
**Not wired**, and the stage is not done until it is.

### F6 is bigger than "add a field", and the reason is `inFlight === record`

Sol's F6 asks for `LaunchRecord` to become a discriminated union so `{state:"started",
notification:absent}` is unrepresentable. Sizing it against the code turned up a constraint neither of
us had:

**The launch record is mutated in place, and its object identity is load-bearing.** `launch()` ends
with `if (inFlight === record)` (`routes-new.ts:893`) — a **reference** comparison that exists because
of an earlier Sol finding: before the claim was atomic, two launches could be live at once and the
first to finish cleared the second's slot. That check is what makes the impossible loud. Replacing the
record object to move it between union arms **breaks that identity**, and repairing it by comparing
`id` instead would quietly weaken the thing it was built to protect.

Every type-level formulation that preserves identity moves the discriminant off the top level —
`record.progress = {state, notification}` assigned wholesale, or `state` becoming an object. Both
change the **wire shape**. And `LaunchRecord` is a **hand-written twin**: the server declares it in
`routes-new.ts:182` and the client declares it again in `new-session-client.ts:62`, related by nothing
but hope, with `parseLaunch` reading `v["state"]` as a string. So a rename is invisible to the
compiler and shows up as `parseLaunch` returning `null` for every record and the panel rendering
nothing — the exact silent-break class of
[260908b](../postmortems/260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md).

**So F6 done properly is "migrate `/api/sessions/new` behind `wire.ts`"**, where one declaration turns
both ends red on a change. That is not scope creep invented here — it is **item 1 on
[260907e](260907e-agent-fleet-dashboard.md)'s own "what is left" list**, and `wire.ts` belongs to
`claude-agents-dashboard` under a "one new block at the END only" agreement that a new block would
satisfy.

**Three ways to take it, and this is a decision rather than a preference:**

1. **Migrate the endpoint behind `wire.ts` as part of this stage.** Correct, and it closes a known
   twin. Costs a stage of its own and lands in another workstream's roadmap item.
2. **Wire the notification with `notification` as a required top-level field**, no union, plus a test
   that a `started` record never carries `not-attempted`. Ships tonight; leaves F6 satisfied by a test
   rather than by the compiler, which is the thing this project keeps saying is not enough.
3. **Leave Stage D unwired** until the migration is scheduled. The module is committed and inert; no
   half-join exists.

**Not decided here** — it is the Overseer's to sequence, because option 1 collides with somebody
else's roadmap and option 2 knowingly accepts a weaker guarantee than a P1 finding asked for.
Recorded rather than chosen at 1:30am at the end of a long session, which is the condition under which
option 2 looks most attractive and is least likely to be revisited.

### What remains in Stage D whichever way that goes

- The send in a **child process** with one total deadline (F7): `sendMessage` is synchronous
  `execFileSync` across as many as six tmux and process calls at 10 s each, and `launch()` runs on the
  dashboard's event loop. The module already takes an async `send`, so this is wiring rather than
  redesign.
- A **re-read of the claim immediately before delivery** (F8): a holder can release the role between
  the snapshot and the send while staying in the same pane, and every one of `sendMessage`'s guards
  would still pass. Process identity is not current role ownership.
- Mark the launch `started` **before** notifying, so the notification can never delay the launch result.
- The panel line, after `record.note` (`NewSessionPanel.tsx:165-167`).

## Where this stopped, 2026-09-09 ~02:20

**On `dev`:** Stage 0, Stage E and both its review rounds, the `/api/sessions/new` migration behind
`wire.ts`, the notify module, the notification wired into the launch record, and the adoption of the
shared `Turn` renderer.

**Stage D is one binding short of done.** `realIo()`'s `notifyOverseer` answers *cannot-tell, this
server has no fleet snapshot wired to the launch route* — true, printed, and not a silent nothing, but
not the feature. `server.ts` must bind a real notifier, and **that binding is where the last two P1s
live**:

- **F7 — off the event loop.** `sendMessage` is synchronous `execFileSync` across as many as six tmux
  and process calls at ten seconds each. `notifyOverseer` is already `async`, so the module does not
  need to change; the binding runs it in a child process with one total deadline. **If the deadline
  expires after an effect may have begun, record `unknown`, never `refused`** — the module's `unknown`
  arm exists for exactly that and must not be reused for a clean refusal.
- **F8 — re-read the claim immediately before delivery.** A holder can release the role between the
  snapshot and the send while staying in the same pane, and every one of `sendMessage`'s guards would
  still pass. Process identity is not current role ownership.

**And Stages A–C are now unblocked**: `260908f-roadmap-exec-identity` landed at `8ed9ae59`.

Three things changed from what is written above and must be re-read rather than assumed:

- `ExecutionToken` and `ConversationReading` are **unchanged**, so the cache key design stands — that
  carried risk did not fire.
- **`identityWriteGate` and `continuityOf` moved to `tools/fleet/execution-token.ts`, a leaf with only
  type imports, which the browser CAN import.** That reverses the advice recorded above: import them
  rather than hand-narrowing inline. `isAddressableHarness` is exported there too.
- **The row parsers now downgrade an incoherent reading** — a `verified` conversation whose id is not
  the row's claim becomes `unverifiable` at the parse. So a `verified` conversation on a row now
  genuinely agrees with `claudeSessionId`, which simplifies the check the table above describes.
- Two new `unknown` causes (`process-changed-under-read`, `uptime-unreadable`) both land in the
  existing `cannot-tell` arm; no new arm to handle.

Measured on the live box after that landed: 26 sessions, 26 verified, 0 unknown, 0 claimed-only, the
whole pass costing 236 ms. **But every row reads `unknown`/`not-reported` until the Overseer restarts
the dashboard and the daemon**, so `cannot-tell` remains the normal case for a while and its copy
should read as informative rather than broken.
