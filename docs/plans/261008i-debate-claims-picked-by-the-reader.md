# Debate Claims: list the claims first, the reader picks, and a box for a claim of their own

Queue item `qi-7e32ngyt` (supersedes `qi-k9deez4b`). Report `spya-caue42`; question
[q-sn37bt](../user-feedback/questions/q-sn37bt.md). Up: [debate.md](../project/debate.md).

## What Greg asked for

> C list the claims first, let them pick
>
> and also B allow them to input their own
>
> — Greg, 2026-10-08, reply `spya-rp3u4p` to q-sn37bt, in the Feedback dialog

The options he chose between are in
[261003o § Q-claims-picker](261003o-debate-reception-and-claims-sub-modes-and-a-tidier-panel.md#q-claims-picker-should-you-be-able-to-choose-which-claim-debate-checks).
In plain words:

- **C.** Opening Claims lists the article's main claims, from a cheap call that searches nothing.
  The reader ticks some, presses Check, and only then is the web searched, for those claims.
- **B.** A box in Claims to type a claim in your own words and have it checked the same way, and a
  button on a claim already checked to dig further into it. Each press is one more search, about
  20 cents, and nothing searches by itself.

The original words, from the report this all came from: *"It may be that you could, as a first
pass, say, which of these claims do you want me to check? … and then there could be effectively a
thread or something … for each claim, and then papers that have sort of evaluated the claim since
then."* (Greg, 2026-10-03, `spya-caue42`.)

## Where this sits against what is already built

- **Debate's one search runs two passes** (`generateDebate`, `src/debate.ts`): pass A, Reception,
  and pass B, which picks three or four claims by itself and searches them. Both run on one press
  and are stored as one document per article, `article_revisions.debate`, which a visitor to a
  shared article also sees.
- **Since 2026-10-05 the owner can already dig in chat**: *Check this claim in chat* on each claim,
  and the angle box at the top of the panel
  ([debate.md § Check a claim in chat](../project/debate.md#check-a-claim-in-chat),
  [§ Look at the debate from an angle](../project/debate.md#look-at-the-debate-from-an-angle)).
  That route answers in prose; it does not give rows with checked quotations. Greg's answer asks
  for the stored, checked kind. **Both stay**: chat for open-ended digging, Claims for checked
  sources. The angle box is about the debate as a whole; the new box is one claim, checked.

## What we build

Revised after GPT Sol's plan review (§ Review ledger): every finding accepted.

### 1. The press on Debate searches for Reception only

Pass B leaves `generateDebate`. A press costs one search instead of two, and the synthesis (themes,
key sources) runs over Reception's rows.

- **"Not searched" is a state, not an empty group** (F4). An empty `claims` group today means a
  search ran and found nothing, and the panel says exactly that. So the stored document gets an
  explicit marker that pass B did not run (a discriminated group state, or a field whose absence
  means a legacy document that did search), and the owner DTO, the public DTO, the (i)'s
  provenance and the empty-state copy all read it. Never zeroed counts.
- **`PROMPT_VERSION` becomes `debate/7`** (F3). What a run asks for changed. The store's `outdated`
  comparison marks older debates outdated, which the panel deliberately does not announce
  (mode.md, Greg 2026-09-29), so nothing new appears on screen.
- **Stored debates keep their claim rows**, and Claims still draws them, under their own heading,
  *Claims the earlier search chose*, with the relevance bar and threads scoped to those rows as
  today. Visitors see them as today.
- **The Reception chip's press arms the Reception search; the Claims chip's press no longer does**
  (F1). Today both sub-modes arm the one `debate` target (`src/web/activation.ts`), so pressing
  Claims on an article with no debate would buy Reception. Debate's target becomes the sub-mode's:
  `PressContext`, `subModeTarget`, `bandTarget`, the command row and `DebateViews` change together.

### 2. Claims lists the article's claims: a pipeline artefact

A new pipeline step and artefact, `debate-claims` (F11: the schema itself calls Referee's one-row
table an interim, and the step machinery brings the prompt stamp, the job's de-duplication, the
revision carry policy, export and the public projection, by mode.md § The artefact's checklist).

- One call on the capable tier: the article with block ids, **no web search**, a few cents. Up to
  eight claims the article rests on that someone outside could argue with, each with `blockId` and
  `quote` (the article's own words, re-found with `findQuote` in `"spaced"` mode and replaced by
  the article's characters, the referee rule), a one-line `statement` in plain words (the model's,
  labelled as such) and an `id` we mint. A claim whose quote is not found is dropped and counted.
  Document order, never a ranking. Its own `PROMPT_VERSION`.
- **It runs on a press, never on arrival** (F1; mode.md § pressing the control that opens it).
  Pressing the Claims chip when there is no list makes it, as any mode button does. A link, Back,
  a reload or a last-view restore that lands on Claims only reads, and shows a *List its claims*
  button.
- **A stale list is read-only** (F6): shown, with *List again*; Check and Dig further are off.
- **A visitor sees the list, read-only** (F8): it is model output about the article, which mode.md
  makes public by default (the postmortem 260929a is what happens otherwise). The article's quote,
  the anchor and the model's statement go through `PUBLIC_PROJECTIONS` and the public DTO like
  every other artefact; no controls, no checks.

### 3. The reader ticks claims, or types one, and presses Check

```
 [ Reception 3 | Claims 5 ]
 Which claims should be checked?
  ☐ "memories … survive metamorphosis"                       [jump]
     Memories can outlast the brain that formed them. (AI's wording)
  ☑ "RNA from trained animals …"                             [jump]   ▸ 3 sources
  ☐ "the self is continuously rebuilt"                       [jump]
 Check a claim of your own  [ RNA can carry a memory between animals ]
 [ Check 1 ticked claim ]           one web search, about a minute and a half

  ▾ "RNA from trained animals …"     3     [Check this claim in chat] [Dig further]
       row, row, row
  ▾ Your claim: "RNA can carry a memory between animals"   2
       row, row

  Claims the earlier search chose                    (only on a debate stored before this)
  ▾ …
```

- **One press is one search**, covering every ticked claim plus the typed one, at most four
  targets: the cost Greg was quoted (about 20 cents a search) and pass B's shape, one call over
  several claims.
- **The typed claim** is the reader's own words, trimmed, not empty, at most 600 characters
  (`MAX_LENS_CHARS`, as the angle box), refused rather than cut. It is stored only as a target of
  the check that searched it.
- **Dig further** on a checked claim runs one search for that claim alone, told which addresses it
  already has, so it looks elsewhere. **The server derives those addresses and every listed
  anchor from stored ids** (F12); the client sends claim ids and the typed text, nothing else.
  Its rows join the claim's; an address the claim already has is drawn once.
- **Every target gets an explicit answer** (F5). The model answers one group per target,
  `{claimId, rows: []}`, and the server requires exactly one group for each requested id: a
  missing, duplicated or unknown id is counted and the target is marked *not answered*, never
  *found nothing*. Only an explicit empty group produces "This search found nothing it could quote
  on this claim."
- **One reader of the answer** (F12): discriminated listed/own target and row types, and a
  `readCheckedClaimGroup` in `src/debate.ts` on top of the existing private `readGroupWith`, so the
  refusals (URL returned by the search, quote in that page's extract, the article's own address
  and copies of it) stay one implementation. A listed target's `blockId` and `claimQuote` come
  from the stored list; a typed target's rows carry no block.

**Where it runs** (F10): `POST` is a long-lived SSE request on Referee's pattern
(`runRefereeClaims`, `src/routes.ts`): the pending row is written before the call, completion is
attempt-fenced, and the stream ends only after the answer is stored. Vercel allows 800 s; the
search takes about 90. `GET` lists the article's checks, for recovery, other tabs and a reload, and
sweeps abandoned pending rows so an orphan cannot block later checks. A disconnected client does not
cancel the call; its answer is stored and found by the next `GET`.

**Stored in `debate_claim_checks`**, keyed `(article_id, id)`: `owner_id`, `status`
(pending/done/error), attempt and lease, `list_source_hash` (the list it was made from),
`prompt_version`, `targets` and `results` (JSONB, one call's wholesale output, sql.md's
exception as Referee argues it), `counts`/`losses`, `web_searches`, `model`, `error` (never
logged), `created_at`, `finished_at`. Checks are drawn under the list with the same hash.

**What stops a reader spending without meaning to** (F2, F7):

- a press, never an arrival;
- **one pending check per article, held by Postgres**: a partial unique index on `article_id`
  where `status = 'pending'`, and the reservation is that insert, before the model call, so two
  tabs pressing at once get one search and one 409;
- the **list is fresh**: the server compares the stored list's hash with the article it has just
  loaded and answers 409 before any allowance or model use (F6);
- **the check's own allowance**, bucket `debate-check` (`DEBATE_CHECK_RATE_POLICY`,
  `src/debate.ts`: 10 an hour, 30 a day per reader, two at once, a global fuse of 100 a day — about
  $6 a reader-day and $20 a day in all at the worst, at ~$0.20 a check; Greg's to move), taken
  after every free refusal (ownership, input, staleness, in flight) and before the model. *Amended
  after stage 3's code review (GPT Sol's E1):* this first shared the `dig-deeper` allowance, but
  that bucket's lease is 170 s, sized for Dig deeper's calls, and a check could run 720 s; only
  unexpired leases count towards `concurrency`, so a slow check stopped holding its slot and "two
  at once" held nothing. Lengthening Dig deeper's lease would have loosened Dig deeper instead, so
  the check got its own bucket, with a lease of its deadline (now 360 s, the Debate step's budget
  for a comparable call) plus a minute;
- owner only. The experimental switch is **not** a defence (security-map: it changes what is
  discoverable, never who may do what), and is not counted as one here.

No defence in [security-map.md](../project/security-map.md) is changed: the allowance machinery is
used, not altered (one more bucket in it, after E1), and the list reaches visitors through the
existing projection. A reviewer is asked to
check exactly that.

### 4. Who sees what

- **Owner**: the list, the ticks, the box, the checks, and the legacy group.
- **Visitor**: the list, read-only, and the legacy group, as today. Checks are in a table the
  public reader does not read, so a typed claim (the owner's own words) cannot reach a visitor.
  Whether a visitor should see checked results for listed claims is Greg's (below).

### 5. The states, and the owner's panel without a stored debate (F9)

The panel today has no Claims before a debate is stored (`DebatePanel.tsx`, the control and the
Claims body are under `debate && ready`). Reception, the list and the checks become three
independent reads. Claims works with no stored debate and while Reception is loading or failed.
The states to draw and test: list none / pending / done-empty / error / stale; check pending /
done-empty / error / swept / not-answered; two tabs; an old debate with legacy claims. The Claims
count is the deduplicated rows on screen, not a raw sum.

### 6. What else has to hear about it

The pre-search screen's words (it describes two searches); the (i) and the segment tooltips;
`export.md` and the export put-chain plus `ARTICLE_TABLE_COVERAGE` for the check table; privacy.md
if it lists what Debate sends; the help page's Debate entry; debate.md; url-state.md if any state
is addressed; cost categories for the two new calls ([cost-tracking.md](../project/cost-tracking.md));
`last-view.ts` and `sub-modes.ts` if the press rules change what a restore may do; the eval under
`evals/debate/` only so far as it assumes pass B.

## Stages

Cut vertically, each ending with the gates green, a GPT Sol code review that fixes, and a commit.

1. **Reception-only press** (§ 1): `debate/7`, pass B's explicit not-run state through both DTOs and
   the copy, legacy claim rows under their heading, and the per-sub-mode activation target.
2. **The claims list, end to end** (§ 2): the step and artefact with the whole mode.md checklist,
   the press rules, stale read-only, the public projection, the panel's list (no Check yet).
3. **Checks, end to end** (§ 3, § 5): the table and migration, the reservation, the allowance, the
   SSE route and GET with sweep, the reader of the answer, ticks, the box, Dig further, the states.
   Then the browser check (Sonnet, Playwright on the box) at 1440, 820 and 390 wide with real calls
   on one article: list, tick two, check, dig further, own claim, a visitor.
4. **Bookkeeping**: debate.md, q-sn37bt, the report's note, `feedback-endings.ts`, the queue item.

Each code stage is an Opus subagent's; I keep the plan, the briefs, the diffs and the commits.

## Tests (red first)

- Stage 1: `generateDebate` makes one search call and stores the not-run marker; a document without
  the marker still reads as searched; the Claims empty state does not say "found nothing" over a
  not-run pass; pressing Claims with no debate does not arm the Reception search.
- Stage 2: a claim whose quote is not in its block is dropped and counted; the article's characters
  replace the model's; document order; the cap; arriving by link does not run the list and pressing
  the chip does; a stale list offers List again and no Check; a visitor gets the list and no
  controls.
- Stage 3: a row naming an unknown target is dropped; a missing target is *not answered*, an
  explicit empty one is *found nothing*; a listed target's anchor comes from the list; the pass-B
  refusals still fire; two concurrent POSTs on two connections make one check and one 409; a stale
  list is a 409 before the allowance; an allowance refusal starts no model call; an older attempt
  cannot finish over a newer one; a non-owner is refused; a typed claim over 600 characters is
  refused; a visitor's payload has no checks; export covers the table.
- Mutation check at the end: let the model's `claimQuote` through; drop the partial unique index;
  draw checks to a visitor; treat a missing target as empty. The suite must notice each.

## The simpler options passed over

**Keep the automatic search and add only the box (B alone, the recommendation in q-sn37bt).** No
list step, no ticks. A day or so less, but Greg chose C as well, and C is what stops money being
spent on claims nobody cares about.

**Reuse Referee's claims list** (`referee_claims`, `runClaimsStream`) as the first step. It already
lists a paper's claims with anchored quotes, but answers a different question (what a paper claims
about its own contribution, up to twenty claims with the passages that take each up, for a peer
reviewer) at a higher cost, and would couple Debate to Referee's prompt. The anchoring rule is
reused; the call is not.

**A one-row table for the list, as Referee has** (the first draft). Fewer files, but the schema
calls that shape an interim, and it would hand-build the stamp, the de-duplication, export and the
public projection that a pipeline step already has.

**One search per ticked claim.** Simpler rows, but three ticks would cost three searches.

## Questions for Greg (not waited on)

- **Should a visitor to a shared article see the claims you checked?** As built they see the
  article's claim list and the old search's claims, but not your checks: a check may be a claim
  you typed, in your own words. Showing visitors the checks of the article's own listed claims
  (never a typed one) is a small follow-up. Asked as [q-cgwene](../user-feedback/questions/q-cgwene.md).

## Review ledger

Plan review, GPT Sol, 2026-10-08:
[261008i-debate-claims-plan-review-sol.md](261008i-debate-claims-plan-review-sol.md). Verdict:
build with these changes. All twelve accepted, each checked against the code it cites.

| | Finding | What changed |
|---|---|---|
| F1 | P0: both sub-modes arm one target, and the list would run on arrival | per-sub-mode target; the list runs on a press (§ 1, § 2) |
| F2 | P0: "one pending check" was not atomic | partial unique index, reservation by insert (§ 3) |
| F3 | P1: removing pass B without a version bump lies | `debate/7`; the list has its own version (§ 1, § 2) |
| F4 | P1: an empty claims group means "searched, found nothing" | explicit not-run state (§ 1) |
| F5 | P1: a flat row list cannot show a target was answered | one group per target, missing = not answered (§ 3) |
| F6 | P1: a stale list stayed actionable | read-only; server 409 on hash mismatch (§ 2, § 3) |
| F7 | P0: the limiter was undecided; the switch was called a defence | the `dig-deeper` allowance; switch struck (§ 3) |
| F8 | P1: hiding the list from visitors breaks mode.md's default | list public, read-only; checks private (§ 2, § 4) |
| F9 | P1: Claims cannot exist without a stored debate today; no state matrix | three independent reads; the states (§ 5) |
| F10 | P1: POST then GET left the paid call's lifetime unclear | SSE on Referee's pattern; GET sweeps (§ 3) |
| F11 | P2: the list belongs in the pipeline | a step and artefact; stages recut vertically |
| F12 | P2: reuse needs an explicit shape | discriminated types; `readCheckedClaimGroup` on `readGroupWith` (§ 3) |

### Stage 1 (2026-10-08): landed

Built by an Opus subagent (`41ad4b649`): `Debate.claims` is a union, a legacy searched group or
`{pass: "not-run", rows: []}`; `activationForDebate(view)` arms the Reception search for Reception
and nothing for Claims; `debate/7`. Code review and fixes, GPT Sol:
[261008i-debate-claims-stage1-code-review-sol.md](261008i-debate-claims-stage1-code-review-sol.md),
verdict *land with the fixes made*. Accepted:

| | Finding | Fix |
|---|---|---|
| C1 | P0: a Reception press could survive a move to Claims and spend when the GET settled | `useAutoRun` takes `enabled`; a disabled press is consumed at once |
| C2 | P1: the panel's own Reception segment did not arm the search | it does, as a sub-mode chip should (mode.md) |
| C3 | P1: the eval still assumed two searches | one-search runs score; legacy replay kept |
| C4 | P1: copy elsewhere still said Debate searched claims | tooltip, sharing inventory, rerun and reset copy |
| C5 | P1, before this stage: export has no `debate.json` at all | not fixed here; queued separately |

Gates as run by me: typecheck green; 36 files, 1027 passed, 2 skipped (debate, public DTO, command
bar, activation, metadata, doc-links). The full suite's only failures in the builder's run were
`chat-live-turn` and `citation-investigate-route`, fixed on dev by `32147ae71` after this tree's base.

### Stage 2 (2026-10-09): landed

Built by an Opus subagent (`905c46ff6`): the `debate-claims` step and artefact
(`article_revisions.debate_claims`, migration `20261008222555_debate_claims`), `src/debate-claims.ts`
and `src/web/useDebateClaims.ts`. Pressing Claims arms `debate-claims` and never `debate`;
arriving only reads. The Reception | Claims control is drawn before any search is stored. A visitor
gets `claims[].{id, blockId, quote, statement}` and no controls; a list alone makes Debate present
for a visitor (inventory only, which the reviewer confirmed changes no refusal). Export carries it.
Departures, kept: a stale list also hides *Check this claim in chat*; not added to Metadata's re-run
rows (the stale banner's *List again* covers it).

Code review and fixes, GPT Sol:
[261008i-debate-claims-stage2-code-review-sol.md](261008i-debate-claims-stage2-code-review-sol.md),
verdict *land with the fixes made*. Accepted:

| | Finding | Fix |
|---|---|---|
| D1 | P1: a claims-only public article advertised Debate but dropped the list when lifting the payload | `public-artefacts.ts` keeps it |
| D2 | P1: the stamp hashed the whole tree, so renaming a section staled the list and offered a paid re-run | hashes the rendered body and head the prompt actually sends |
| D3 | P1: the owner read's `outdated` ignored model drift | uses `debateClaimsAreOutdated` |

D2 moved one expectation in `tests/freshness-deciders-agree.test.ts` (a renamed section no longer
stales the list; both deciders still agree), which I updated. Gates as run by me: typecheck green;
48 files, 1895 passed, 18 skipped, then the freshness file 152/152.

### Stage 3 (2026-10-09): landed

Built by an Opus subagent (`570156267`): `debate_claim_checks` (migration
`20261009020028_debate_claim_checks`), `generateClaimCheck` and `readCheckedClaimGroup` in
`src/debate.ts`, `src/store/pg-debate-claim-checks.ts`, `GET`/`POST /api/debate-claims/:slug/checks`,
`src/web/useDebateChecks.ts`, `src/web/debate-checks.ts` and the ticks, box, Check and Dig further in
`DebatePanel.tsx`. It was pushed to dev before its review (`c5f0f9b47`), only because its migration
was applied to the shared local database and was blocking every other worktree's `db:migrate`; the
Overseer was asked to hold deploys until the review's fixes landed.

Three review rounds, GPT Sol:
[round 1](261008i-debate-claims-stage3-code-review-sol.md) (*do not land*),
[round 2](261008i-debate-claims-stage3-code-review-r2-sol.md) (*do not land*),
[a narrow check of the last fix](261008i-debate-claims-stage3-code-review-r3-sol.md) (*do not land*,
on E7 alone).

| | Finding | Outcome |
|---|---|---|
| E1 | P0: the allowance's lease (Dig deeper's, 170 s) was shorter than the call (720 s) | its own bucket, `debate-check` (migration `20261009024756`), lease = deadline + 60 s; deadline 360 s and started at the reservation. Closed |
| E2 | P0, reasoned, gateway-wide: a transport retry can resend a paid request | queued as `qi-2gaxfaaj` |
| E3 | P1: a broken stream re-enabled the press | the press stays held until its own row is read. Fixed |
| E4 | P1: copies of the article at another address counted | one shared copy predicate. Fixed |
| E5 | P1: a re-made list hid paid results | checks drawn from their stored targets; an earlier-version group. Fixed |
| E6 | P1: the sweep could end a live check | one clock from the reservation; grace = deadline + 120 s. Closed |
| E7 | P1: a paid answer lost when storing it fails | retried four times over 14 s; **Sol still objects** (below) |
| E8 | P1: Dig further's addresses read before the reservation | read after it, before the allowance. Fixed |
| E9–E11 | another tab's check unseen; a free read shown as a search; an older read over a newer one | fixed |
| G1–G4 | round 2: guarded-store inventory; a failed read consuming quota; recovery picking another tab's row; a late `begin` frame | fixed |

**Sol still objects to E7; overruled because** the write is attempt-fenced and retried for 14 s, the
loss is one answer of about 20 cents during a database outage with no second spend, the failure goes
to the log and Sentry, and a durable outbox would be a second place answers live, which is more than
this beta warrants. Opus arbitrated and agreed (accept, with two stale comments fixed and the
limits written into debate.md § Checking, which they are). The other accepted limit: a single store
write hanging for over a minute is unbounded (no statement timeout), so a third concurrent check
could then start, under the hourly, daily and global counts.
