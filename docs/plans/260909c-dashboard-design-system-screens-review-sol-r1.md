## Verdict

The central problem is information architecture, not styling. The dashboard is organised around data producers—sessions, transcripts, checkpoints, usage scans—while Greg arrives with three decisions:

1. Do I need to act?
2. Is work stuck?
3. Is useful progress happening?

Box health and Readiness work because they lead with a verdict and subordinate the evidence. Sessions partly works, but combines an inbox, session creation, a roster, and detail navigation. Usage, Overseer, and Recent messages foreground their evidence-gathering machinery.

There are no P0 findings. The code is unusually careful about unknown, stale, failed, and expired states. The redesign’s main risk is making those distinctions prettier but less truthful.

I reviewed revision `5b3efeb3` via `git show` because the checkout is currently at `e05714f4`. No files were changed.

## Across every screen

| Screen | Needed from me? | Anything blocked? | Where things stand? |
|---|---:|---:|---:|
| Sessions | Strong, but not directly actionable | No | Weak |
| Usage limits | Indirectly | Yes, for account capacity; hard to scan | Weak |
| Box health | When intervention is needed | Yes, as a cause | Strong |
| Readiness | Partly | Yes, for shipping | Strong |
| Overseer | Partly | Partly | Partial |
| Recent messages | Indirectly | No | Weak; forensic rather than summarising |
| Deploys | Rarely | Only if deploy status is known | Historical only |
| Queued ideas | Yes for some states | Yes, within the queue | Partial |
| Session detail | Yes | Partly | Strong for one session, but buried |

**GLOBAL-01 · P1 · Landing surface.** Build it, but do not make it another block above the existing Sessions page. That would repeat the current failure: the useful summary becomes a preamble to 3,529px of roster. Make the landing surface a genuine replacement/overview with three explicit regions:

- **Needs you:** the first actionable question, with answer or skip.
- **Blocked:** known blockers plus an explicit unknown/unmeasured state—never `0 blocked` unless it was actually measured.
- **Progress:** meaningful change since the last look, not merely `7 working`. Working is activity; commits, completed reviews, pushes, finished work, or an absence of progress signals answer “where do things stand?”

The roster and log should be drill-ins from this surface. Cost: M using existing signals; L if proper progress/blocker events must be added.

**GLOBAL-02 · P2 · Persistent chrome.** The clock-skew sentence should be demoted to the freshness tooltip or a small diagnostic indicator. Because the displayed ages are already corrected, a five-minute skew does not change the dashboard action in the next ten seconds. Keep it prominent only when skew cannot be measured or corrected and therefore makes displayed times unreliable. Cost: S.

The same argument applies to Usage’s three-zone timestamps. Travel explains why the information exists, not why it must be repeated in every row. Lead with location-independent durations—`resets in 2h`, `read 6m ago`—and one device-local instant. Put UTC, London, and Athens in the attached disclosure or copyable detail. Cost: S.

**GLOBAL-03 · P2 · Navigation.** Nine top-level icons communicate the underlying component inventory, not a reader model. Once the landing surface exists, consider primary destinations such as Inbox/Fleet, Activity, System, and More. This is lower priority because one frequent user can learn the icons, and the needs-you badge already provides useful cross-tab signalling. Cost: M.

## 1 · Sessions

Reader questions, ranked:

1. “Who needs an answer from me, and what are they asking?”
2. “Which work is stuck or going wrong?”
3. “What is each agent actually doing, and has it moved?”
4. “Open this particular session.”

It answers the first well enough to detect attention, but not to act without another tap. It does not answer “blocked,” and `working/quiet` plus repeated identifiers is not an answer to “where do things stand?”

**S1-01 · P1 · Sessions · Replace repeated metadata with discriminating information.** Your suspicion is right: this is the highest-value change to an existing screen. A roster row should contain:

1. identity/purpose;
2. actionable status or blocker;
3. most recent meaningful progress;
4. age only where it changes interpretation.

Hide `spideryarn/reading2` when it is the fleet default. Move the tmux handle trio to detail, exposing it only when needed for disambiguation. Cost: M; much can use data already present.

**S1-02 · P1 · Sessions · Model “blocked” separately from “quiet.”** Rate-limited, awaiting a decision, paused for a scheduled reason, failing repeatedly, and simply finished must not share a calm bucket. If the fleet cannot reliably classify blockers, the overview should say `Blocked: unknown`, not infer none from quiet sessions. Cost: L if it needs new collection fields.

**S1-03 · P2 · Sessions · Make the attention item question-first.** `TECHNICAL` and the session name are routing context. The agent’s decision sentence should be the card headline, followed by its recommendation/options and then the session name. Age is correctly a tie-breaker, not the primary rank. Ideally the first inbox item is answerable or skippable in place, matching the “inbox—act” direction. Cost: M.

**S1-04 · P2 · Sessions · Move New session out of the normal scan path.** Put it in a persistent action, below the roster, or show the full card only for an empty fleet. Starting work is rarer than assessing 18 existing sessions. Cost: S.

Remove or demote: default repo/path, tmux handles, repeated `WORKING` pills inside a `WORKING` band, the explanatory `gjd-remote` prose, and the New session card above the roster.

## 2 · Usage limits

Reader questions:

1. “Can I start more Claude work now, or will it be rejected?”
2. “How much is left in each current window, and when does it reset?”
3. “If you cannot tell, why not—and what should I trust instead?”
4. “Have limits been causing trouble recently?”

It potentially answers “blocked,” but the answer is encoded as a document. It does not provide a usable “where things stand” scan.

**S2-01 · P1 · Usage limits · Use typed state cards, not generic stat cards.** Restyling is safe only because the underlying `UsageWindowCard` union already prevents expired or unattributed values from carrying a percentage. Preserve that discipline in the primitive.

An honest set of value slots would be:

- Live and attributed: **`42% left`**, with `58% used · resets in 2d` beneath.
- Current window without a valid reading: **`Unknown`**, with `Last cached window has reset; no current reading` beneath.
- Cache may belong to another account: **`Withheld`** or **`Unknown`**, with the attribution failure beneath.
- Source failed: **`Unavailable`**, visually distinct from ordinary unknown.
- Stale but still valid: keep the number, visibly mark it stale, and attach its age.

Do not use a bare em dash: without the explanatory state word, it conflates unknown, absent, and failed. Do not show the expired percentage anywhere in the primary card; the code is right to discard it. Cost: M.

**S2-02 · P2 · Usage limits · Separate answer, evidence, and provenance.**

- Answer: account verdict and current window cards.
- Evidence needed to trust the answer: account identity, reading age, reset validity, compact scan coverage such as `235/240 transcripts checked`.
- Provenance/diagnosis: checkpoint write time, candidates, lines scanned, duration, full contradiction explanation.

The eleven-line contradiction belongs under `Why unknown`, not deleted. Cost: M.

**S2-03 · P2 · Usage limits · Let sparse history admit that it is sparse.** One short segment on a full 24-hour chart should render as `Not enough readings for a trend · one reading at 58%`, optionally with the point. Do not print the three invalid-window explanations again beneath it. Cost: M.

Remove or demote: repeated three-zone instants, checkpoint-carrying time, detailed scan mechanics, duplicated invalidity sentences, the empty 100/50/0 chart, and old rejection history beyond a compact count. Keep directly visible: verdict, account, reading age, active reset validity, and the positive-control coverage behind any reassuring absence.

## 3 · Box health

Reader questions:

1. “Is the box currently constraining the fleet?”
2. “Which resource is responsible?”
3. “Was there a recent incident, or is this moment unusual?”
4. “Do I need to intervene?”

This answers “where things stand” strongly and can explain blockers. It is the right visual model, though not every other screen is naturally a stat-card screen.

**S3-01 · P2 · Box health · Make the verdict a sentence, not merely a pill.** Lead with `Box is healthy`, `Box is strained`, or `Box health unknown`; keep the pill as a secondary status marker. Cost: S.

**S3-02 · P2 · Box health · Summarise history before drawing it.** Add a compact incident answer such as `No critical periods in 24h` or `2 critical periods · last at 04:10`, then retain the sparklines for diagnosis. Cost: M.

**S3-03 · P3 · Box health · Condition the action prominence.** “Act on the box” should remain below the evidence and be quieter/collapsed when health is OK, becoming easier to reach when strained or critical. Cost: S–M.

Demote: raw server output, routine gap explanation, and the full legend when nothing unusual happened. Do not demote the evidence beneath each number or any unknown/gap state.

## 4 · Readiness

Reader questions:

1. “Is dev safe to ship?”
2. “Exactly what prevents that answer from being yes?”
3. “Is a missing check running, failed, or simply never recorded?”
4. “How far has dev moved beyond main?”

It answers “where things stand” well and “blocked” for the release process. Its main gap is action adjacency.

**S4-01 · P2 · Readiness · Put the next action beside the verdict.** `We do not know` should become `Dev readiness unknown`, immediately followed by the gating reason and the relevant action: run the missing check, wait for the active run, or refresh. The five evidence rows should identify which checks actually vote on this commit. Cost: S–M.

**S4-02 · P2 · Readiness · Make 24-hour marks diagnostic detail.** The latest gating state matters more than a day of historical marks. Keep the history, but below a compact current-check summary or behind disclosure. Cost: M.

**S4-03 · P3 · Readiness · Keep branch state literal.** Prefer `dev is 323 commits ahead of main` over `323 commits not deployed`. The former is what this panel measured; deployment truth belongs to Deploys and can diverge from branch movement. Cost: S.

Demote: the mark-provenance tutorial, non-voting runs, and full tree mechanics. Keep the SHA visible but subordinate to the verdict.

## 5 · Overseer

Reader questions:

1. “Is the Overseer alive and actually seeing the fleet?”
2. “Has it queued anything surprising that I should cancel or inspect?”
3. “Do I need to restart or message it?”
4. “What has it remembered about stalled sessions?”

It contains answers to all of those but makes the reader parse implementation prose. It also mixes status, usage, queue management, box actions, direct messaging, and broadcast authority.

**S5-01 · P1 · Overseer · Remove the duplicated Usage card.** The second copy adds no new interpretation and makes two tabs compete for ownership. Show one compact cross-link only when Usage explains the current fleet state: `Account usage unknown` or `Rate-limited until …`. Cost: S–M.

**S5-02 · P1 · Overseer · Reduce the top to two independently truthful checks.**

- **Coordinator:** running/stopped, last write.
- **Fleet input:** receiving/stale/never received, last accepted snapshot.

Then show pending queue count and the one appropriate intervention. This preserves the important “alive but deaf” distinction without requiring two paragraphs. Cost: M.

**S5-03 · P2 · Overseer · Separate operations from history.** Queue cancellation, message Overseer, broadcast, and box actions belong in a clearly labelled action region. The remembered register is diagnostic history and should be collapsed by default. Cost: M.

Remove or demote: schema, PID, tick count, start age, instance UUID, routine scheduler explanation, the eight remembered-session lines, the `≥` footnote, and the full Usage duplicate. Promote scheduler state only when it is unexpectedly off or blocked.

## 6 · Recent messages

Reader questions:

1. “What have agents said or decided since I last looked?”
2. “Did anything surprising happen?”
3. “Find the message about this session or topic.”
4. “Show me the raw transcript evidence.”

This is a forensic/calibration tool, not a good answer to “where do things stand.” That is acceptable if it is presented as a drill-in rather than as a fleet summary.

**S6-01 · P2 · Recent messages · Put messages before filter inventory.** Keep search plus one `Filters` control in the first row. Open speaker and session choices in a sheet/disclosure; show only active filters as chips. Fifteen inactive pills before the first result invert content and tooling. Cost: M.

**S6-02 · P2 · Recent messages · Make each row human-time first.** Show `2m ago · 06:53` and keep the exact ISO timestamp in detail/copy. Collapse tool-only turns by default into something like `3 tool-only turns`, expandable to commands. Cost: S–M.

**S6-03 · P2 · Recent messages · Decide whether this is messages or the calibration log.** The direction calls for “what was decided on Greg’s behalf, by whom, and what landed.” Raw transcript turns do not provide that reliably. Either rename this honestly to Messages, or later build a typed Activity log of decisions, completions, pushes, and interventions. Cost: S for renaming; L for the real log.

The incompleteness warning should remain visible, but compact it to `Incomplete: 12 of 18 sessions readable · details`. Demote exact coverage reasons, inactive filter chips, raw ISO values, “No words…” rows, and command lines.

## 7 · Deploys

Reader questions:

1. “What changed in production?”
2. “What is serving now, and did the latest deploy succeed?”
3. “Which release introduced something I noticed?”
4. “Which commits were involved?”

The current screen answers release history, not current production state. It only partly answers “where things stand.”

**S7-01 · P2 · Deploys · Use summary rows and drill-in.** Each release should show date, reader-visible headline, and deployment status if actually known. Expand one release for prose and commits. Cost: M; already owned elsewhere.

**S7-02 · P2 · Deploys · Keep record freshness distinct from deployment status.** If the dashboard cannot observe Vercel, say `Deploy record last updated…`; do not imply that Git refs prove what is serving. Cost: S–M.

It belongs in the same semantic system—type scale, status language, absence handling, cards, disclosures—but not in the same stat-card shape. It is a chronology. Demote inline commit links, full prose for old releases, and per-commit interaction until a release is opened.

## 8 · Queued ideas

Reader questions:

1. “Is anything here waiting for me?”
2. “What is authorised and ready to run?”
3. “What is next?”
4. “Why has this item not moved?”

It can answer blocked and queue state, but identical current data makes its state model invisible.

**S8-01 · P2 · Queued ideas · Summarise by actionable state.** Lead with `0 need you · 0 ready · 8 proposals`, then group rows under those headings. If all items are genuinely proposals, identical styling is correct; do not invent visual diversity merely to make the page livelier. Cost: M.

**S8-02 · P2 · Queued ideas · Make queue order explicit.** Show `Next`, `2`, `3` or grouped position. Priority matters; age generally does not, and should not become a fake priority signal. When an item truly needs Greg but cannot be acted on from the read-only phone UI, say `Needs desktop` and surface the exact next step. Cost: S–M.

Demote: repeated `PROPOSAL` pills once a section heading carries that state, monospace IDs, throughput/no-ETA explanation, file path, and queue version. Keep the reason an item is not moving.

## 9 · Session detail

Reader questions:

1. “What does this session need from me right now?”
2. “What is it doing, and is it stuck?”
3. “What evidence do I need before answering?”
4. “What can I safely tell it to do?”

It should be the action surface, but on a phone it is buried beneath unrelated controls and may visibly contradict the inbox snapshot.

**S9-01 · P1 · Session detail · Make the phone push real.** When `selectedId` is present in one-pane mode, render detail immediately below the masthead. Suppress the global Attention panel, New session card, and roster order controls. The list may be absent, but the current implementation still leaves its furniture above detail. Cost: S.

**S9-02 · P1 · Session detail · Never show two unqualified answers about the same session.** The inbox is a periodic inference; detail is the current action surface. Once selected, hide the duplicate attention card or label it explicitly as an older inbox observation with its age. Ideally reconcile both into one current decision model. Cost: M.

**S9-03 · P2 · Session detail · Keep identity and exit available.** Use a compact sticky row with Back, session identity, status, and freshness; put the current question/action directly beneath. Cost: S.

Remove from above detail: New session, roster count/order, and global attention cards. Demote handles, directory, and collection provenance within detail unless diagnosing identity.

## On `design-a-screen.md`

**DOC-01 · P2 · Design checklist.** It is good and materially better than a conventional visual checklist because it starts with reader questions, actions, and states the redesign must not erase. The absence section is especially strong.

Three sentences deserve softening:

- “A screen answers one question well” is too rigid for a deliberate overview. Better: one screen supports one decision or task; an overview may need several subordinate questions.
- “If it would only change what they believe, it belongs one tap away” is too absolute. Belief and confidence often determine whether an operator acts. Use “changes the immediate action or confidence in taking it.”
- “Every live number carries when it was taken” should allow one clearly shared timestamp for a group of readings collected together; repeating it per tile would recreate the Usage problem.

## If you only do three things

1. **Build the landing surface as a true action-first overview, not a preface to the roster.** It must distinguish known-none from unknown for both needs and blockers.
2. **Rewrite Sessions around purpose, blocker, and progress; remove the two constant lines.** Bundle the cheap phone-detail fix into this work.
3. **Rebuild Usage from its typed epistemic states:** verdict, valid headroom, reset, compact evidence, then provenance/history on demand.

So: the constant session-card lines are the best single existing-screen deletion. The landing surface is still the highest-value product change, provided it replaces rather than lengthens the Sessions page.