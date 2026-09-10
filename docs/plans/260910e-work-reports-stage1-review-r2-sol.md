# Stage 1 code review, second run

> **How this file was assembled.** The reviewer wrote its findings here first, as asked, and then
> `run-codex` overwrote the file with the run's final chat message (a 774-byte summary pointing at this
> file). The findings, directory-listing paragraph and verdict below are the reviewer's own text,
> recovered verbatim from the last version it wrote (the activity log's patch to this file); they still
> say "fix pending" because it wrote them before fixing. The **Final status** section is its closing
> message, which reported the three fixes done. The orchestrator's check of those fixes follows.

## Findings

### WR-S1R2-1 — P1 — `tools/overseer/reports.ts:849-856,1012-1018`

The first review's stop-on-every-transient rule protects a possibly torn `reports.jsonl` tail, but it also stops on failures which happen before any append. A checker which always throws for the oldest submission therefore prevents every later inbox item from being attempted forever; an unreadable prepared file does the same from the replay loop. The stop must be specific to a failed append, while other item failures remain pending and the pass continues. Red test and fix pending.

### WR-S1R2-2 — P1 — `tools/overseer/reports.ts:989-997`

The wall deadline abandons a report between its artefact probes and retries it from its first probe next pass. A legal report with several artefacts can therefore make no progress if its early bounded probes consume the wall budget on every pass. It must finish the event without starting more probes after the deadline—for example, stamp the remaining references `unchecked` because this pass did not have time to look—rather than discard all completed checks and restart forever. Red test and fix pending.

### WR-S1R2-3 — P1 — `tools/overseer/report-artefacts.ts:78-94`

When the `origin/dev` git check cannot answer but the working-tree file exists, `checkPath` returns `found-locally`. That state asserts both existence and absence from dev, but the latter was not established; the highlighted contract says inability to run/read git is `unchecked`. Red test and fix pending.

The exact-key parsers, bracketed `/proc` observation, hard-link refusal, bounded no-follow reads, canonical `refusedAt`, claim-only fold/CLI wording, and commit/dev/path git commands otherwise match the design in this narrow review. A throwing report drain is caught, opens `reports`, and a later completed pass restores it; the synchronous production drain cannot overlap itself. Its cooperative operation bounds do mean one syscall/probe can delay the event loop, but the concrete unbounded case is the directory scan discussed below rather than a separate small daemon fix.

## Directory listing bound

This should be fixed before landing because a runaway writer can make the synchronous `readdirSync`/stat/sort pass over 100,000 entries delay the whole Overseer, including its heartbeat. Merely slicing the array after `readdirSync` does not bound the expensive operation. The smallest real bound is lazy `opendirSync` iteration capped at a fixed number of entries per pass (for example 1,000), with a cursor/fair rotation or quarantine of permanently invalid entries so the same hostile prefix cannot starve later valid submissions. Per the review brief, this review does not build that design-level

*(the recovered text ends mid-sentence here)*

## Verdict (as written before the fixes)

**Not approved yet.** The first run repaired important replay, trust-boundary, and bounded-read defects, and those repairs are sound in the areas rechecked here. Stage 1 still has three narrow P1 correctness/liveness defects above plus the pre-landing inbox enumeration bound. The P1 code fixes and final gates are in progress.

## Final status (the reviewer's closing message)

> Stage 1 is not approved to land until the inbox enumeration is bounded. I fixed three P1 issues:
> permanent item failures no longer starve later reports while torn-append protection remains; legal
> reports now complete when the wall-clock budget expires, with unprobed artefacts marked `unchecked`;
> a local path is no longer reported `found-locally` when Git could not determine its dev status.
> Tests: 178 passed, 1 sandbox-excluded real-Git test. Typechecking passes except for the unrelated
> concurrent Stage 3a `DecisionsPanel` error. Scoped lint and `git diff --check` pass.

## The orchestrator's check

Read the diff: `AppendMayHaveTornTail` is the only failure that stops a pass; the first file of a pass is
always admitted by the time bound, and a report that reaches the deadline mid-probes is recorded with the
rest `unchecked`; `checkPath` returns `unchecked` when the dev check could not answer. Six Stage 1 test
files outside the sandbox (the real-git test included): 172 passed, exit 0. The directory bound is not
built; it moves into Stage 3b, the next change to `reports.ts`, and Stage 3's review checks it.
