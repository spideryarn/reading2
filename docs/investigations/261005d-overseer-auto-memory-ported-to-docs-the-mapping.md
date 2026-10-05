# The Overseer's auto-memory, ported to docs: the mapping

Up: [investigations.md](../project/investigations.md) ·
plan: [261005k](../plans/261005k-port-overseer-auto-memory-into-docs.md) · queue item `qi-8836whem`

**What this is for.** The Overseer's Claude Code auto-memory is a folder on the box,
`~/.claude/projects/-home-greg-code-spideryarn2/memory/`, and it is not in Git. Greg, 2026-10-05:
*"I want to make sure that all our lessons are stored in Git, ideally in our docs.md files, so that
if we were to start a new box, it would not have lost valuable insights."* This file says, for each
of the 85 memory files, where its lessons now are, and whether the file can be deleted.

**Where it stands (2026-10-05).** 27 files are *eligible*: every lesson in them is in a
doc, or was dropped for a stated reason. 58 are *retain*: at least one lesson is a rule, so
it is one of the 49 proposals below, and proposals need Greg's yes before they land.
**Nothing was deleted.** The 25 direct edits are on `dev` in the same commit as this file.

## How to use this before deleting anything

1. Run `python3 docs/plans/261005k-probes/check-mapping.py` on this file. It fails if a memory file
   has no row, two rows, or a content hash that has moved since the row was written. A moved hash
   means the file gained something after it was read: read it again before deleting it.
2. Delete only rows marked *eligible*.
3. A *retain* row becomes eligible when its proposals have landed (or Greg has refused them, which
   is also an answer). Until then the memory file is the only place that lesson lives.
4. `MEMORY.md` is the index, not a memory; three files were never in it
   (`peer-discovery-is-per-config-directory`, `taskoutput-on-a-running-agent-dumps-its-transcript`,
   `use-opus-not-fable`). Cut its lines as the files go.

## How it was made, and what that does and does not show

Four Opus subagents each read about twenty files in full, split each into its lessons, and for
every lesson grepped the docs and read the passage before calling it *already*. One writer then
applied the edits in sequence. GPT Sol reviewed the plan before any of it and the result after
([its answer](../plans/261005k-port-overseer-auto-memory-result-review-sol.md)): it read all 35
files then marked eligible, found seven that would have lost a lesson and one dropped on too thin a
check, and those eight are now *retain*, each row saying why. It also found six sentences among
the edits that were instructions or were no longer true, and they were rewritten.
The batch reports, with each agent's doubts, are kept:
[A](../plans/261005k-probes/report-A.md), [B](../plans/261005k-probes/report-B.md),
[C](../plans/261005k-probes/report-C.md), [D](../plans/261005k-probes/report-D.md).

- *already* means a named doc and section says the lesson and how to act on it; the row quotes a
  phrase from it. Each was read by one agent, once.
- *moved (XEn)* means edit *n* of batch *X* put it in a doc in this commit. These are facts and
  traps only: descriptions of how something behaves.
- *propose XPn* means it would tell an agent what it may or must do, so it was not edited. It is
  proposal *n* below.
- *dropped* is a stale claim (with what was checked), one finished job's detail, a duplicate of
  another memory, or a note about the memory system.

The dates and numbers inside the ported text are the memories' own. Where an agent could check one
against the tree it did, and the reports' Doubts sections say which it could not.

**What the check script cannot tell you.** `check-mapping.py` checks the inventory and the hashes.
It does not know whether a lesson is covered: change every *retain* to *eligible* and it still
passes. The verdicts are a reviewed judgement, not a computed one.

## Lessons in retained files that no proposal carries yet

Sol sampled thirteen retained rows and found these. Each file is retained, so nothing is at risk
today, but **landing that file's proposals does not make it eligible until these are settled too.**

| memory file | the lesson still unplaced | nearest proposal |
|---|---|---|
| `a-named-worktree-may-hold-a-dead-sessions-work` | Look for an existing worktree on the topic *before* assuming a fresh start, not only after entering one. | CP5 |
| `a-comment-is-not-a-traced-equality` | A fingerprint built for caching can leave out fields that a safety comparison needs. | DP6 |
| `two-joins-that-disagree-are-a-measurement` | Report the disagreement row by row, and send the unfavourable reading to whoever decides, at the time. | DP2 |
| `a-codex-self-review-looks-like-an-independent-one` | Brief the independent reviewer to treat the first artefact as a claim and test its named statements. | DP7 |
| `full-suite-needs-tmux-on-this-box` | Whether a long command should ever be given a deadline: the `timeout` incident is in `testing.md`, the instruction is nowhere. | none |
| `tmux-outlives-closed-tabs` | Where the source of `sessions.mjs` lives. The memory says Greg's laptop; nobody could check that from the box. | none |

Two edits sit in a home the reviewer thought weak (RR-19): the `Write`-tool and `npm run` bullets
are in the box's trap list, and describe the harness and npm, not the box. Left there, since no
project doc owns either; a better home would be a proposal.

## Four of Greg's quotes could not be found in anything he typed

A model wrote the memory files, so each quotation attributed to Greg was searched for in the
session transcripts (`docs/plans/261005k-probes/check-quotes.py`, which looks for the string in a
turn a person typed, and skips model output, peer messages and compaction summaries). The script
finds candidates; it does not prove authorship, and its first version counted a compaction summary
as typed. So each hit was then read in its turn, and GPT Sol read the source turns again
independently. Eight were found in his own turns. **Four were not**, and appear only in the Overseer's own summaries of what
he said and in its messages to other sessions:

| in proposal | the string as the memory has it | memory's date |
|---|---|---|
| AP1 | "You're allowed to run that command and similar yourself in future to free up memory." | 2026-09-29 |
| AP2 | "You are allowed to remove worktrees where it's safe to do so (e.g. we've already pushed their contents, or we have explicitly agreed that we are throwing them away) And you are allowed to remove temp files where safe to do so" | 2026-10-05 |
| AP5 | "if you see bugs, fix them without asking me." | 2026-10-04 |
| AP5 | "if there are clear no-tradeoffs-improvements that won't add much complexity, you should always do them" | 2026-10-04 |

That does not show he did not say them. A message that reached the Overseer some other way than a
typed turn would not be found, and the search was run once. It does mean the wording rests on a
model's record. **So AP1, AP2 and AP5 should go to Greg with the question "are these your words?"**
and land as a quote only if he says yes; otherwise as a dated paraphrase.

Found in his typed turns: the Codex-transcripts permission (AP3), the weekly-usage instruction
(AP4), both halves of the `SUPABASE_ACCESS_TOKEN` rule (AP7), "when you wake up, pull the latest
changes" (AP8), and the granularity-zoom blockquote (AP9).

## Things the Overseer should know before putting the proposals to Greg

- **AP4 reverses the runbook.** `overseer.md` § The tick rations Claude's seven-day window on Greg's
  2026-09-09 words; the memory records him ending that on 2026-10-01, and that quote was found.
- **AP6 names a cap the tree does not have.** No file says "pacer" or "cap of 6"; the proposal
  states a measured capacity instead.
- **BP12 and CP4 each loosen a rule in `AGENTS.md`** (`npm run check` before you commit; a green
  suite before you push). BP6 and CP4 say nearly the same thing and should be one proposal.
- **BP3, BP4 and BP7 overlap proposals F1 and K3** still pending from the 2026-10-01 sweep, in
  `docs/plans/261001i-probes/proposals.md`. Retire one set so Greg is not asked twice.
- **CE5 (a refused merge that reset six files) was seen once and never reproduced.** It is in
  `version-control.md` in those words. CP3, the rule that follows from it, rests on that one sighting.
- **Docs the agents found out of date and did not touch**, because no memory carried the fix:
  `feedback-reports.md` still describes pool accounts; `typechecking.md` § The layout says "three
  projects"; `long-waits.md` has no measurement later than 2026-09-02; `database.md`'s safe-read
  example uses `psql`, which the box does not have.

## The table

Sorted by file name. The hash is the first twelve characters of the file's sha256 when it was read.

| memory file | sha256 (first 12) | lessons | verdict |
|---|---|---|---|
| `a-check-can-answer-a-weaker-question` | `b1ba354f0a43` | L1a (a guard that reads a copy or a spelling of its subject cannot see the subject move) already: `docs/project/typechecking.md` § A guard you rely on, that only this gate can enforce — "the guard must read the thing it is guarding, not a copy of it". L1b (the seven bypasses of 2026-09-08 and what each moved) moved (DE3). L2 (a grep in one direction reports on one direction; name the scope searched) propose DP3. | retain |
| `a-codex-self-review-looks-like-an-independent-one` | `537dc14c4c7f` | L1 (a Codex run asked to implement and review reviews itself when its nested run cannot start, and reports success) propose DP7. L2 (read the artefact's provenance line; re-run from your own shell; do not count it as the cross-family round) propose DP7. | retain |
| `a-comment-is-not-a-traced-equality` | `598d07b8dbbf` | L1 (an equality inferred from an assignment and a comment, with the middle hop never opened) propose DP6. L2 (a hash built for caching may be weaker than one built for safety; ask what it protects before borrowing it) already, loosely: `docs/reusable/name-is-evidence.md` § The one that is not about identity at all — "Reusing a predicate because its name sounds like your question". | retain |
| `a-fallback-makes-a-failed-check-look-answered` | `57de320b38c0` | L1 (`ls X \|\| git show Y` prints plausible output when the check fails; read the exit code) propose DP2. L2 ("the commit is on dev" is not "the file is in my tree") propose DP2. | retain |
| `a-fixing-reviewer-can-attribute-your-words-to-greg` | `d82eff31b991` | L1 (a write-capable review put a sentence from the prompt in a dated blockquote as Greg's decision) propose DP8. L2 (diff the docs it touched, grep its edits for `Greg`; say in the prompt whose decision a trade-off was) propose DP8. | retain |
| `a-header-comment-is-not-a-traced-check` | `e49cbd7db4f1` | L1 (a header saying what one component cannot see is not evidence about the system; trace the refusal path; say "unverified" if you could not) propose DP6. | retain |
| `a-named-worktree-may-hold-a-dead-sessions-work` | `e5fd016e3e64` | L1 (a named worktree is resumed; look with `git status` and `git log origin/dev..HEAD`) already: `worktrees.md` § Two things about `EnterWorktree` — "is *resumed*, not recreated". L2 (re-derive inherited work's claims; neither trust it nor throw it away) propose CP5. | retain |
| `a-port-you-bound-may-be-a-strangers-now` | `f2870b0363eb` | L1 (a pid found by port may be a peer's; read `/proc/<pid>/cwd` before killing) propose BP11. L2 (a port changes hands) already: `browser-testing.md` § And check the port, not just the server — "And the port you were given can change hands while you work." | retain |
| `a-refused-merge-can-wipe-uncommitted-edits` | `c4a8588138b2` | L1 (a refused merge left tracked edits at HEAD; recovery from the dangling `WIP on` commit) moved (CE5). L2 (commit before every merge) propose CP3. | retain |
| `a-sibling-sweep-may-have-already-measured` | `2d4484ee3ce1` | L1 (what an earlier run appended to a queue entry is only in `overseer-queue show <id>`; `list`, `git log` and `gjd-remote ls` do not show it) moved (DE1). L2 (on a long entry the fact is in the middle, not the newest appendix) moved (DE1). L3 (read the entry before re-measuring; if nothing changed, append nothing) propose DP10. The Sentry specifics (the empty queue, the Vercel MCP boundary) are dropped as stale: `feedback-reports.md` § Where the queue lives — "The database is the queue; Sentry is optional context." | retain |
| `a-survey-cannot-see-an-absent-state` | `9794d6939cd2` | L1 (a rule derived from a census of live instances misses the beginning-of-life state; make one specimen first) propose DP2. | retain |
| `a-truncated-grep-becomes-an-exhaustive-list` | `44da9ebeaf01` | L1 (`grep … \| head -20` cut seven callers to three and the three became "the set" in a source comment; count first or re-run unbounded) propose DP3. `written-down-is-not-checked.md` § 4. An inventory names the cause ("the grep was truncated") but not what to do about `head`. | retain |
| `an-unchecked-brief-claim-becomes-a-source-comment` | `16fb40772dcd` | L1 (a claim in a brief comes back verbatim in comments, docs and tests; grep each load-bearing one first) propose DP4. L2 (a review finding is the same hazard; enumerate the input space rather than test one instance) propose DP6. L3a (a peer session's confident claim is the same hazard) already: `silent-success.md` § Spotting the family — "the agreeing is what stopped the checking". L3b (a grep answers one direction; say which in the sentence that reports it) propose DP3. L4 ("nothing does X" is the riskiest shape) already: `docs/reusable/written-down-is-not-checked.md` § 2. A statement that asserts an absence — "An absence is only as good as the enumeration behind it". L5 (end every brief with "say which claims in this brief turned out to be false") propose DP4. L6 (a wrong claim has copies; hunt them all) propose DP4. L7 (re-check the claims a decision rests on) already: `codex-cli-as-subagent.md` § Four ways the second opinion gets wasted — "Test the load-bearing fact first." | retain |
| `announce-before-taking-a-queued-slice` | `4a9efee524bb` | L1 (check who is on a queued slice before starting it, and make the claim visible) already: `overseer.md` § Dispatching agents — "Read `gjd-remote ls` before you dispatch anything … two agents building the same slice from the same queue, which this box has already paid for once", and "Name a session after what claims it". L2 dropped: duplicate — the clean merge that kept both sets of rows is `merge-can-duplicate-what-it-does-not-conflict-on` (another batch). L3 dropped: superseded — "answer a peer on timing, not ownership" was for agents claiming slices among themselves; slices are now dispatched and named by the Overseer (`overseer.md` § Dispatching agents). L4 dropped: stale — "no machinery for this" (2026-09-07, a paraphrase of Greg) predates the claim register the same section now describes. **After review (RR-7):** the Overseer's dispatch rules do not cover an agent starting on its own: message peers before taking a slice a plan doc queues, write the claim into the plan, and answer a peer on timing, not ownership — propose RP6. The other drops stand. | retain |
| `api-build-refuses-stale-client-shell` | `abaa13f68eb4` | L1 (`build:api` alone refuses after a commit; run `npm run build`) already: `deployment.md`, the paragraph before § Everything that bundle imports at module scope — "Which is why `npm run build:api` alone refuses after a commit". L2 (hit while re-measuring `bench-cold-start.ts`) dropped: one finished job. | eligible |
| `ask-the-reviewer-to-check-the-conclusion` | `e7a758fada3b` | L1 (put the result in the candidate and ask for a judgement of the conclusions; name the finding you least want to be wrong about) propose DP5. L2 (a finding that changes a conclusion outranks one that changes a line) already: `docs/reusable/review-prompt-template.md` § The five rules, rule 4 — "Grade by the consequence, not the file". L3 (keep both the wrong conclusion and its correction in the plan doc) propose DP5. | retain |
| `biome-formatter-is-off-on-purpose` | `c9d4779f1a60` | L1 (formatter off on purpose; never `--formatter-enabled=true`; 205 lines, 8 the author's) already: `linting.md` § The trap if anyone turns it on — "never pass `--formatter-enabled=true` on the command line". L2 (recovery by `git show HEAD:<file> >` and re-applying by hand) already: same paragraph — "There is no undo: the recovery is `git show HEAD:<file> >` the file". L3 (lint only the files you touched) already: `AGENTS.md` § Before you call it finished — "`npm run lint` on the files you touched". **After review (RR-2):** the recovery's precondition — confirm with `git diff --word-diff` that the only content changes are yours before overwriting from `HEAD` — is not in `linting.md`. propose RP1. | retain |
| `box-traps-moved-to-docs` | `2be458902b0f` | L1 dropped: about the memory system itself — a pointer to the 2026-10-01 sweep, whose mapping is `docs/plans/261001i-probes/report-W3.md` and `report-W4.md`. | eligible |
| `browser-agents-measure-a-moving-tree` | `e7f6081a16c4` | L1 (HMR feeds a long browser check a moving tree) already: `browser-testing.md` § A long check measures a moving tree — "reports on whatever the tree held at each moment, not on a commit". L2 (queue edits, or brief the agent to re-verify at the end) propose CP9. L3 (record the sha a long gate started from; check before acting or telling anyone) propose CP10 — W3's P5 of 2026-10-01, never landed. L4 (a written survey expires the same way; sha in its heading) propose CP11. | retain |
| `browser-subagents-kill-shared-dev-servers` | `7ddf1b9c5ef9` | L1 (never `pkill -f vite`; put the constraint in the brief) already: `browser-testing.md` § And check the port — "**Never `pkill -f vite`**" and "Put the constraint in the prompt when you dispatch browser work". L2 (a pattern cannot tell worktrees apart; an env-var prefix is not in the cmdline) moved (BE9). L3 (`$!` is the npx wrapper; kill the listener, then check the port) already: same section — "which stops the npx wrapper and leaves the node child holding the port" and "kill the **listening** PID". | eligible |
| `check-git-log-before-building-a-feedback-fix` | `f5865ba3498c` | L1 (check `git log` before planning a fix for a report) already: `docs/project/feedback-reports.md` § The run, step 3 — "First, check it isn't already done or in flight". L2 (the fix can arrive under a sibling report's name; `gjd-remote ls` cannot show it; the commits arrive only when `worktree:setup` merges, announced in one line) moved (DE2). L3 (the record is plan 260908c) dropped: a pointer, and the file exists; DE2 links it. | eligible |
| `classifier-accepts-fleet-restart-script` | `20efa6d52fe9` | L1 (`npx tsx scripts/fleet-restart.ts restart` is accepted, a hand-typed `sudo systemctl restart` is not, prefer the bare `npx tsx` form) already: `overseer.md` § Steering, and the actions you have — "the classifier accepted that command unattended on 2026-09-09 … and so was one `npm run` form". L2 (a refusal is not evidence about the command alone; session history seems to count) moved (AE1). L3 (do not retry what the classifier has just refused) propose AP10. | retain |
| `classifier-refuses-production-reads-in-auto-mode` | `3f63229cb311` | L1 (the classifier refuses reads of real reader data from an unattended session, and a chat yes from Greg does not change it; what was allowed instead) moved (AE2). L2 (try once, write Greg a one-command script, say the data was not looked at) propose AP10. | retain |
| `codex-cli-404s-on-this-box` | `3c6fc973ab11` | L1 (the 404 is intermittent; retry; say plainly if the review could not run) already: `docs/reusable/codex-cli-as-subagent.md` § The house workflow in this repo — "Assume intermittent, not down." L2 (check exit code and that the answer file exists) already: same section — "exit 0, *and* read the answer file". L3 (the Bash tool's two-minute default kills a review; explicit timeout or tmux) propose DP9. L4 (a `model: "fable"` subagent is the substitute) dropped: stale — `AGENTS.md` § Delegating says "Fable is retired (Greg, 2026-09-28)", and `engineering-manager.md` § Delegate says the work waits rather than taking a stand-in. Also stale: `--model gpt-5.6-sol`; the house command is `--model sol`. | retain |
| `codex-usage-limits-are-free-to-read` | `a98106c2c38c` | L1 (`account/rateLimits/read` on the app-server, no model call, live) already: `usage-history.md` § The Codex subscription reading — "Every observation is a real fetch from the service, not a locally cached value". L2 (`primary`/`secondary` are positions) already: same — "are positions, not window names". L3 (`window_minutes` against `windowDurationMins`) already: `tests/fixtures/codex-usage/README.md` — "the session log writes snake_case with `window_minutes`", and `docs/reusable/codex-subscriptions.md` § Knowing what each account has left. L4 (the handshake, 1.9 s and 117 MB, `codex doctor` hangs) already: `docs/plans/260909d-read-the-codex-subscription-usage-limits-and-show-them-beside-claude-s.md` — "**`initialize` requires `clientInfo`**", "**117 MB peak RSS**", "**Dead end: `codex doctor`.**". | eligible |
| `commit-pathspec-drops-files-silently` | `ed993b02fc3f` | L1 (a tracked file left out of the pathspec; every gate green because gates read the working tree) moved (CE4). L2 (read `git status --porcelain` after every pathspec commit) propose CP2. | retain |
| `copying-a-fixture-uuid-reds-the-suite` | `280da0bdde6b` | L1 (a uuid in two test files reds `fixture-ids`; fix is a fresh uuid) already: `testing.md` § Mint a fixture id randomly, not by counting — "The fix for a flag is a fresh random id, not an exemption". L2 (it flags non-row uuids too; `NOT_A_ROW`) already: same section — "It therefore flags harmless overlaps too". L3 (only the full suite shows it, ~26 minutes later) dropped: a timing, and the gate is one file anyone can run alone. | eligible |
| `diff-against-a-base-includes-the-merge` | `e958f3530a52` | L1 (after merging dev, a diff from a remembered fork point includes everything the merge brought) moved (CE3). L2 (don't wait for a green full suite on a busy trunk; show disjointness and push) propose CP4. | retain |
| `em-dash-heading-anchor-fails-both-ways` | `aedb02654539` | L1 (the gate's slug and GitHub's disagree on an em-dash heading) already: `testing.md` § Why the docs have a test — "passes links that are broken on GitHub and rejects the ones that work"; also `version-control.md` — "Two dated headings, one trap". L2 (link with no fragment and name the section in prose) propose CP6; it differs from what the doc tells you to do. L3 (queue item `qi-takva5m9`) dropped: not found anywhere under `docs/`, so not repeated. | retain |
| `eval-corpus-in-a-worktree-is-the-fixture-cut` | `f75071a2999b` | L1 (worktree `data/` is the fixture cut; 84 vs 360; `matchesManifest: false`) already: `testing.md` § An eval run in a worktree measures the fixture cut, not the corpus — "Nobody reads it". L2 (`cp -rn` appears to work and changes nothing) already: same section — "`cp -rn` skips existing files". L3 (copying the whole corpus breaks four named store suites, which is why `worktree:check` compares `data/` with the fixtures) moved (CE1). L4 (run against the primary's directories by absolute path; `entryForDir` matches on slug) moved (CE1). L5 (`constitution` is the negative fixture, never to be "repaired") already: `tests/fixtures/data-root/README.md`, the per-slug table — "The **negative fixture**, and the only sliced one" (in Git, though not under `docs/`; see Doubts). | eligible |
| `exitworktree-counts-against-local-dev` | `b7122ca5c77b` | L1 ("N commits will be discarded" after a successful push is the wrong question) already: `worktrees.md` § `ExitWorktree` refuses for two reasons — "this count is the wrong question". L2 (re-invoke with `discard_changes: true`) dropped: superseded. The same section says "`ExitWorktree` is for leaving a worktree, not for removing one", and since 2026-10-05 a `WorktreeRemove` hook (`.claude/settings.json:60`) hands removal to `npm run worktree:remove`. | eligible |
| `fix-bugs-and-free-improvements-without-asking` | `ab97a059832f` | L1 (bugs and no-trade-off, low-complexity improvements are authorised and dispatched without asking; trade-offs, complexity, destructive production writes and rule wording still go to Greg) propose AP5. | retain |
| `fresh-worktree-reds-two-bundle-tests` | `4f2d4b353abd` | L1 (no `api-dist/` reds two bundle tests; `npm run build`) already: `worktrees.md` § What a worktree costs — "`api-dist/vercel.js` is missing until `npm run build` runs". L2 (fleet tests red until `npm run build:fleet`) already: same paragraph — "are red until `npm run build:fleet` runs"; the detail that the reported line is `process.exit unexpectedly called` is moved (CE2). L3 (`tests/fetch.test.ts` 400 ms budget busts under load) moved (CE2). L4 (check the failing paths are in your diff first) dropped: duplicate of `diff-against-a-base-includes-the-merge` L1. L5 ("3 failed / 865 passed, 40 minutes") dropped: a dated count the doc says ages badly. | eligible |
| `full-suite-needs-tmux-on-this-box` | `3f562ff6bc55` | L1 (run long commands under `tmux-job.ts`; a backgrounded run is killed and reported exit 0) already: `testing.md` § Run the suite in tmux — "is killed under load and reported as a success". L2 (no `--` before the command) already: same — "`--name` is its only flag, and there is no `--` separator". L3 (unique name, `EXIT=` last line, session ends with the command, the husks) already: same, and `hetzner-remote-server-box.md` § Sessions nobody made on purpose — "runs the command as the pane's own process so the session ends with it". L4 (logs live in `logs/tmux-jobs/`; deleting the directory orphans a run) moved (BE2). L5 (the kill is the harness's own low-memory guard, on system memory) moved (BE3); the bare fact already: `overseer.md` § Things that will catch you — "OOM-killed on *system* memory pressure". L6 (the waiter is killed too, and that is not the job failing) moved (BE3). L7 (watch with a Monitor that fires on `EXIT=` or on the session vanishing) propose BP3. L8 (the exit code lies both ways; read the summary line) already: `static-analysis.md` § The gate/advisory split — "Read its summary line, not the exit code you were handed", and `testing.md` § A nuqs write outlives the test that started it — "every test still reported green". L9 (a `timeout` wrapper: `EXIT=124` announced as exit 0) moved (BE3). L10 (`npm run check` contains the suite, so not beside `npm test`) already for the fact: `static-analysis.md` top — "a second full suite ran for half an hour, in parallel with a deliberate one"; the 2026-09-05 measurement and "end one" moved (BE4). L11 (the box dies of concurrent suites, 18 at load 391) already: `testing.md` § Run the suite in tmux — "load 391, swap full, 18 suites at once". L12 (check load and memory first; stagger the retry) already: same — "a re-run straight away tends to meet the same fate", and § So a crowded machine may refuse to start a run at all, which now does the check mechanically. L13 (the admission refusal) already: `testing.md` § So a crowded machine may refuse… — "the run **stops, loudly**, saying `NO TESTS RAN`"; the `REFUSING TO START` string and the fast-red signature moved (BE5). L14 ("leave the reserve file alone") dropped: the doc decides otherwise — "If a run is refused and you are certain, delete the file or set a smaller reserve" — see Doubts. | retain |
| `get-ready-to-deploy-loop-lives-in-a-session` | `af886449f903` | L1 (a session cron dies with its session) already: `get-ready-to-deploy.md` § Running it on a timer — "A `/loop` lives in its session", and `cron-scheduler.md` — "a session cron dies with its session". L2 (the only evidence is a gap in `logs/loops/get-ready-to-deploy/<yyMMdd>.md`) already: `cron-scheduler.md` — "the only evidence is a gap in a log nobody is reading"; the path is in `get-ready-to-deploy.md`. L3 (the durable form is a system cron, a change to the box) already: `get-ready-to-deploy.md` — "a system `cron` running `claude -p`". L4 dropped: the job ids and the five one-shots of 2026-09-06/07 are one finished job. | eligible |
| `gjd-remote-runs-from-the-box-with-one-var` | `94da63f70d12` | L1 (from the box, `npx tsx scripts/gjd-remote.ts`; the address comes from `/etc/gjd-remote-host`) already: `hetzner-remote-server-box.md` § Running `gjd-remote` from the box — "There is no `gjd-remote` on the box's PATH, so the `npx tsx` form is the only one that runs". L2 (a prompt on stdin needs `--no-attach`) already: same doc § Starting a session with a prompt — "you get told to use `--no-attach` and `resume`, rather than a hang". L3 (why the old note was wrong: `/etc/profile.d/`) already: same doc — "It was an export in `/etc/profile.d/` until 2026-09-05, and that was wrong for every agent". L4 (it supersedes two earlier notes) dropped: about the memory system. | eligible |
| `granularity-zoom-is-one-of-several-core-features` | `d4f23efdb9d0` | L1 (granularity-zoom is one core feature, not the yardstick for ranking work) propose AP9 — `vision.md` says only "The first feature built on this is granularity zoom" and files the rest under "Where this goes after granularity zoom". L2 dropped: stale — the phrase "the feature this whole app is for" is no longer in `AGENTS.md` or anywhere under `docs/project/` (grepped). | retain |
| `greg-allows-deleting-old-codex-transcripts` | `78e1605361b9` | L1 (standing permission, Codex rollouts older than a week, not Claude transcripts) propose AP3. | retain |
| `greg-allows-overseer-to-deploy` | `9624ca9d64cd` | L1 (the Overseer may deploy, migrations included) already: `overseer.md` § Deploying — "You are the only one who deploys." L2 (read pending migrations, a destructive one goes to Greg) already: same section, step 2 — "Anything that would destroy reader data goes to Greg first". L3 (read the `Target:` line, deploy only a checked commit, say what went out) already: same section, steps 5–6 — "It is not deployed until three things agree". L4 (never push to `main` by hand) already: `overseer.md` § gate 3 — "no push to `main` except through `npm run deploy`". L5 dropped: stale, "the keys may not be in place yet" — `overseer.md` § Deploying now says "The credentials are on the box". | eligible |
| `greg-allows-overseer-to-kill-finished-sessions` | `6ab170cd6601` | L1 (standing permission to kill finished sessions to free memory) propose AP1 — the close-out in `overseer.md` § Dispatching agents says "only then close the session", but not that a bulk kill for memory is the Overseer's, and not Greg's words. L2 (only after debrief, nothing unpushed) already: `overseer.md` § gate 3 — "no killing a session with unpushed work" and "Closing a session before its debrief". L3 (old Playwright Chrome dies with its session) rides in AP1 as a clause. L4 dropped: duplicate — walking `/proc` to measure per-session memory is the lesson of `ps-grep-counts-its-own-apparatus` (another batch). | retain |
| `greg-allows-removing-safe-worktrees-and-temp-files` | `e5d1b2c7d68b` | L1 (remove a worktree whose work is pushed) already: `overseer.md` § Dispatching agents — "you don't need my input to remove worktrees". L2 (also a tree agreed to be thrown away, and safe temp files) propose AP2. L3 (what "safe" means: no commits past `origin/dev`, `data/` equal to the fixtures, `.env.local` compared without printing) already: `worktrees.md` § Before you remove one — "file by file, by content", and § "`.env.local — DIFFERS`, and how to settle it without printing a secret". The memory's `git worktree remove --force` is corrected by the tree: the doc's command is `npm run worktree:remove`. L4 (new trees go under `/var/tmp/spideryarn-worktrees/`) already: `worktrees.md` § Where a worktree's bytes live — "On the box a new worktree is at `/var/tmp/spideryarn-worktrees/<name>`". L5 (a full `/home` breaks peers) already: `hetzner-remote-server-box.md` § Traps — "`/home` is the small disk". | retain |
| `gregs-answer-is-often-a-fifth-option` | `da400e1ad3f4` | L1 (offer options but expect an answer that is none of them) already: `ask-me-questions.md` § How to ask — "Expect a fifth option anyway: often the answer is neither", and `overseer.md` § gate 2 — "Scope is where his fifth options come from". L2 (explain the trade-off and its mechanism before the options) already: `AGENTS.md` § Explain plainly and briefly — "each option explained fully and plainly". L3 dropped: stale — "one question at a time" (2026-09-06) is superseded by `overseer.md` intro, Greg 2026-09-08, "ask me questions upfront! Much more convenient for me than dribbling them out", and `ask-me-questions.md` — "At most three at a time". L4 (when he overrules evidence, build it but hold the irreversible part for his sign-off) already: `overseer.md` § gate 2 — "Except where it outlives the branch … a published sentence, a privacy promise"; the instance is in `dictation.md` — "which is Greg's call and not a benchmark's". L5 dropped: the three 2026-09-06 examples are one day's story. | eligible |
| `grep-c-fallback-fires-immediately` | `1174cfbe1761` | L1 (`grep -c … \|\| echo 0` yields `0\n0`; use `grep -q`) propose BP3. L2 (a monitor that fires suspiciously fast gets checked by hand) propose BP3. | retain |
| `killed-codex-run-still-writes-its-answer` | `f405f19bb77b` | L1 (a killed run still writes the old answer to a reused `--output` path; unique path or delete first) propose DP9. L2 (ask the reviewer to echo a nonce) propose DP9. L3 (kill the process group, not the pid) propose DP9. L4 (judge a review by whether it answers the prompt sent) already: `codex-cli-as-subagent.md` § Gotchas — "reads as an answer to a *previous* prompt … Treat such an answer as suspect". L5 (the other ending: the run dies under memory pressure and writes nothing; match `--prompt-file` in `pgrep`; relaunch once) propose DP9. L6 (wait with `CronCreate` one-shots, not a shell loop) dropped: duplicate of `long-waits-need-a-persistent-monitor` (batch B). | retain |
| `long-waits-need-a-persistent-monitor` | `a85e129c1498` | L1 (the limits table) already: `docs/reusable/long-waits.md` § What each mechanism actually gives you — "**600 s, hard**". L2 (the ten-minute story was wrong) already: same doc § A note on the ten-minute story — "It is wrong. Four variants". L3 (CronCreate one-shot resumes this session; `at` if the machine may not last; never a foreground `sleep`) already: same doc § Choosing — "It is the only mechanism that does this". L4 (background Bash is killed under load; `killed` is no information) propose BP2. L5 (never pipe a test run through `tail`) already: `static-analysis.md` § The gate/advisory split — "Redirect rather than pipe", and `typechecking.md` § Four ways to report it clean while it is red. L6 (tell load noise from a real failure: re-run alone, then a detached worktree at the commit before yours) dropped as duplicate of `postgres-suites-fail-from-contention` L1 (BP5); the worktree half already: `testing.md` § A green run here proves less than it looks like — "reproduce in a worktree with `node_modules` symlinked". L7 (`nohup … &` survives the kill sweep) dropped: superseded, `scripts/tmux-job.ts` exists and `overseer.md` § Things that will catch you says "Long jobs need `scripts/tmux-job.ts`"; `nohup` is named in no doc. L8 (a background `sleep` does not make time pass; read `ps -o etime=`) propose BP3. L9 (the trigger is memory, not only load; arm two `CronCreate` one-shots) propose BP2. L10 (a `Monitor` survived where two Bash waiters died; a dead waiter says nothing about the job) propose BP2. | retain |
| `merge-can-duplicate-what-it-does-not-conflict-on` | `e9e99adc93e2` | L1 (a merge keeps both sides' list entries with no markers, in a file whose marked hunks were elsewhere; run the list's own test straight after) propose CP1. The doc has the general sentence ("says nothing about the files it merged silently") but its example is two *files*; duplication inside one file is the missing case. | retain |
| `name-the-fallback-before-the-reviewer-does` | `ecf8627dd075` | L1 (a brief that adds a throw, a 4xx or a refusal on a reader's path carries the fallback and an instruction to test the licence) propose DP4. L2 (list the refusal in the review prompt as the conclusion you least want wrong) propose DP5. L3 (when the fallback fires, the plan says documented, not closed) propose DP4. | retain |
| `no-github-cli-credential-on-this-box` | `6d1ba5afe9c1` | L1 (`gh` is installed and logged out; `git` works; the API steps are Greg's) moved (BE6) — the fact is in `worktrees.md` only inside the trunk-flip history ("which has no authenticated `gh`"), not where a reader with the problem would look. Re-checked 2026-10-05: still logged out. L2 (`git remote set-head origin -a` is not a substitute) already: `version-control.md` — "the explicit form, because the `-a` spelling asks", and `worktrees.md` — "`git remote set-head origin -a` was wrong, and wrong in the direction that hides". **After review (RR-3):** check `gh auth status` before promising a GitHub-API step, do every part that does not need it, and name the one piece that is Greg's (he can log in from the session) — propose RP2. | retain |
| `no-production-db-access-from-this-laptop` | `04f6e8b9b052` | L1 (`.env.prod` is on the box) already: `overseer.md` § Deploying — "The credentials are on the box", and `feedback-reports.md` — "on a machine with `.env.prod` (the box has it)". L2 (`.env.local` and the Supabase MCP point at the local stack) already: `infra/hetzner/README.md` § Why Supabase needs no credential, and what that buys — "so it cannot reach production". L3 (read inside `begin read only`, never a bare `SET`) already: `database.md` § remote connection — "**Never `SET` anything on the transaction pooler**". L4 (no `psql` on the box; a `pg` script with the committed CA; `ESSLREQUIRED`; the classifier refuses `rejectUnauthorized: false`) moved (BE10). L5 (the bucket's `object/info` read, and its 400 control) moved (BE10). L6 (writing is still Greg's call; a credential is not an approval) already: `AGENTS.md` § Working agreements — "Real data belongs to the reader, not to us". **After review (RR-1):** L5's bucket read (`object/info`, and its 400 control) was cut from BE10 as unverified and is in no doc. Unresolved: verify it and port it, or drop it. | retain |
| `no-vercel-credential-on-this-machine` | `cbb9b926ad4b` | L1 (the CLI is logged out, so no deploy from here) dropped: stale — `overseer.md` § Deploying says "the Vercel CLI login in `~/.local/share/com.vercel.cli/auth.json`", and that file exists on the box, dated 2026-09-29. L2 (never `git push origin main` instead) already: `AGENTS.md` — "Pushing to `main` yourself is an unreviewed deploy to real readers". L3 (`npm run deploy -- --dry-run` runs every local gate) already: `deployment.md` flags table — "every local gate, nothing external". L4 (the Vercel MCP reads production logs, including the message Sentry withholds) already: `vercel-hosting-deployment.md` § Searching the logs — "Sentry withholds that sentence on purpose". L5 (the result overflows into a file) moved (BE11). L6 (in an unattended session some MCP tools are refused; a refusal is not a lost credential; same for the Supabase MCP) moved (BE11). **After review (RR-5):** check that an unattended session is allowed the runtime-log tools before planning a job around them, and the remedy the memory names (an allow-list entry for the two read-only tools, part of queue item `qi-hpyc3az9`) — propose RP4. | retain |
| `npm-run-check-runs-the-full-suite` | `4da852e0e6dd` | L1 (`check` is the whole suite and a production build, 26 minutes) already: `static-analysis.md` top — "**`npm run check` runs the whole test suite, and this line used to say `~20s`.**". L2 (the last four rows are advisory) already: same doc § What we run and § The gate/advisory split — "runs everything and fails on **gates** only". The "seven gates" count is stale: `scripts/check.ts` has nine `gate: true` entries today. L3 (commit on the fast gates and read `check`'s verdict when it lands) propose BP12. L4 ("prints nothing until it finishes") dropped: `scripts/check.ts` prints a `── <name> (gate)` header as each step starts. | retain |
| `npm-run-forwards-a-bare-argument` | `64df6b07e1a5` | L1 (`npm run <script> <word>` forwards the word; `go` restarted the live dashboard) moved (BE8) — the story is in Git only as the header comment of `scripts/fleet-restart.ts`, in no doc. L2 (mode words: no default mode, `restart` not `go`) already in the code it describes: `scripts/fleet-restart.ts` header — "There is no default mode"; pointed at by BE8. **After review (RR-4):** never probe argument handling with a word that has an effect; use `--help`, a nonsense argument, or read the script — propose RP3. | retain |
| `parallel-subagents-share-one-scratchpad` | `034f4ce417c7` | L1 (the scratchpad is per session; give each subagent a prefix; "small targeted edits" for a shared file) already: `docs/reusable/engineering-manager.md` § Delegate — "Parallel subagents share one scratchpad." | eligible |
| `peer-discovery-is-per-config-directory` | `c0391078ad96` | L1 (`ListAgents` and `SendMessage` find peers per Claude config directory; an empty list is not a dead peer) moved (AE3). L2 dropped: superseded — the `DEBRIEF` marker in assistant turns as the fallback channel: every session has run under the default directory since 2026-09-30 (`overseer.md`), and reporting to the Overseer is now `work-reports.md`. | eligible |
| `plan-name-collides-between-agents` | `02ebccbcec5c` | L1 (a shared letter is deliberate; no check-first ritual, no rename) already: `docs/reusable/write-planning-doc.md` § File naming conventions — "Don't worry if this happens", and the header of `scripts/plan-name.ts`. L2 (each directory has its own letter sequence) already: `postmortems.md` — "Its own letter sequence". L3 (the earlier wrong version of this memory) dropped: about the memory itself. | eligible |
| `polling-a-log-burns-turns-not-time` | `4e819ee4a40e` | L1 (a poll spends a turn, not time; arm one waiter and end the turn) propose BP3. | retain |
| `pool-account-sessions-have-no-sentry` | `1398fda36ade` | L1 dropped: stale — pool accounts are gone: `overseer.md` § The standing jobs, "Since 2026-09-30 there are none … every session runs on the default login". L2 (a report session tries the Sentry tool before assuming it is absent) already: `feedback-reports.md` § Into the Overseer's queue — "still holds for a session that can". L3 (the sweep does the Sentry write at the start of its run from the note) already: same passage — "the next sweep marks the issue in Sentry from that note at the start of its run". L4 dropped: queue entry `qi-a38gypaj` is marked done (2026-09-12) in the Overseer's queue store. | eligible |
| `postgres-suites-fail-from-contention` | `916d05c26f68` | L1 (re-run each red file alone before calling it a regression) propose BP5. L2 (the signatures) already: `testing.md` § One database, many suites — "The failures do not say \"contention\". They arrive as `expected 'busy' to be 'claimed'`", and § `TEST DATABASE CONTENDED`. L3 (plan 260903e exists to remove this) dropped: built — `testing.md` § `TEST DATABASE CONTENDED` says "It should be rare now — that is what the private lane is for". L4 (re-gating after a merge is a treadmill; pick the re-run from what the merge brought in) propose BP6. | retain |
| `prose-through-a-shell-loses-its-markup` | `2ae9b9505022` | L1 (backticks in a double-quoted shell string run as commands; the write succeeds and reads as clumsy prose) propose CP7. L2 (never pass prose through a shell string; Write it, or a quoted heredoc) propose CP7. | retain |
| `prove-an-empty-queue-with-a-control-query` | `731a87e04b7d` | L1 (a finding that is an absence needs a control that would come back non-empty) already: `silent-success.md` § The habit — "A number that can honestly be zero needs its positive control asserted by the same run." L2 (re-run the Sentry search without `is:unresolved`) dropped: stale — since 2026-10-02 the sweep starts from `scripts/feedback-unswept.ts` (exists), and `feedback-reports.md` § Where the queue lives says "exit 2 = could not read, not "none"". L3 (`qi-hpyc3az9` is unbuilt) dropped: one job, and the item is still in the queue itself (`overseer-queue.ts show qi-hpyc3az9`, read 2026-10-05). **After review (RR-6):** widening the period is a second check, for a report that aged out of the window unresolved; `scripts/feedback-unswept.ts` still defaults to 30 days — propose RP5. | retain |
| `prove-the-relaunch-before-stopping-the-old-process` | `d4f932c2c521` | L1 (run the relaunch shape against something harmless first) already: `overseer.md` § Things that will catch you — "Prove the relaunch before you stop a process." L2 (worktree isolation is a second gate: probe the other worktree's path too) propose BP10. L3 (the way out is `ExitWorktree` with `keep`, telling the Overseer first) propose BP10. L4 (a peer cannot be asked to run the blocked half) propose BP10. | retain |
| `ps-grep-counts-its-own-apparatus` | `c78e3cd870e3` | L1 (`ps … \| grep -c` counts its own wrappers and any command that names the flag; walk `/proc` and match argv elements; print what matched) propose BP8. L2 (`pkill -f` kills its wrapper shell, exit 144, and everything chained after it never runs) propose BP9; the first half already: `docs/reusable/diagnose-box-resources.md` § The traps — "`pkill -f <string>` will match your own shell". | retain |
| `public-read-audit-plan-not-built` | `5c1520af3681` | L1 dropped: the built/not-built status of plan 260902j is one job, and the plan's own Progress log is the record (the plan exists; the memory says the same). L2 (a vitest timeout inside `act()` fails every later test in the file) moved (AE4) — it is in the plan's log only, not in `testing.md`. L3 (a reference sweep that skips `scripts/` misses callers) already: `rename-or-move.md` — "postmortems, tests, fixtures, scripts, `package.json`", and `AGENTS.md` § Delegating — "code, docs, plans, tests, fixtures, scripts". | eligible |
| `pull-latest-on-waking-up` | `ef0f7dcad733` | L1 (merge `origin/dev` first thing on waking, not at push time) propose AP8 — `worktrees.md` § The workflow has the merge only "when a piece of work is done". L2 (re-run tests after the merge) already: `worktrees.md` § The workflow — `npm test && npm run typecheck` follows the merge. L3 (merge, never rebase) already: `AGENTS.md` — "Always merge, never rebase". L4 (the fast-forward-only form for the shared primary) rides in AP8 as its last paragraph. L5 dropped: duplicate — fetch and merge as separate commands is the lesson of `worktree-session-refuses-compound-shell` (another batch). L6 dropped: stale — "a conflict is shown to Greg rather than resolved unilaterally" is reversed by `AGENTS.md`, "resolve it yourself … It goes to Greg only if it is a real product trade-off (Greg, 2026-09-10)". | retain |
| `re-reading-your-own-work-is-a-zero-check` | `68ea533dea0a` | L1 (re-reading your own work finds nothing; buy an external check; five holes, none found by re-reading) propose DP1. L2 (when a check is green, make it go red) already: `docs/reusable/silent-success.md` § The habit — "ask what you would have to measure for it to look **wrong**". L3 (two fixture-uuid collisions diagnosed as one habit; the refuting values were in my own message) already: `silent-success.md` § The habit — "two fixture-id collisions read as one bad habit, when one was a counting-block id that hit a real row and the others were captured ids shared on purpose". | retain |
| `remote-control-is-already-on-for-box-sessions` | `1273f09adf54` | L1 (check for the first-party phone client before building a dashboard) already: `agent-fleet-dashboard.md` — "Check first whether your harness already gives you a phone client". L2 (it fails quietly: 8 of 23 on 2026-09-08) already: `overseer-direction.md` § Remote Control fails quietly — "8 of 23 live sessions had Remote Control broken". L3 dropped: stale — the check by `bridgeSessionId` in `~/.claude/sessions/*.json`: of 8 such files on the box today one carries the field and it is null, so the field no longer says what the memory says. L4 (`claude agents --json` is the fast source) already: `overseer-direction.md` — "`claude agents --json` is fast (~1s, cross-repo) but incomplete". L5 dropped: stale — "`gjd-remote ls` takes 10–12s": `hetzner-remote-server-box.md` § How slow it is measures 1.85s. **After review (RR-18):** L3 was dropped on one day's sample (eight session files, one null `bridgeSessionId`), which shows the memory's count is out of date and not that the field is the wrong test. The launch-against-live distinction survives in `docs/plans/260907e-agent-fleet-dashboard.md`. Retained until somebody says whether that is enough. | retain |
| `removing-a-worktree-hits-two-false-blockers` | `08f6a2d7b5a6` | L1 (`logs/` no longer blocks; it is walked) already: `worktrees.md` § A new `.gitignore` entry needs a verdict here — "`logs/` is now walked rather than counted". L2 (`.env.local — DIFFERS` "often clears itself now") dropped: stale. `worktrees.md` § `.env.local — DIFFERS` and `scripts/worktree-check.ts:787` both say the line-subset test "was tried here and reverted" on 2026-09-08. L3 (never print a value; compare key names) already: same section — "Do not run a plain `diff` on two `.env.local`s". L4 (untracked eval results are the dangerous kind) already: § `ExitWorktree` refuses for two reasons — "Those 44 were once somebody's *paid* eval results". L5 (a blocker is resolved by an action) already: § A new `.gitignore` entry — "A blocker is resolved by an action, not by an argument." | eligible |
| `research-gets-a-docs-research-writeup` | `72525104f302` | L1 (an eval, model comparison or spike gets a write-up in `docs/investigations/`; external work in `docs/research/`) already: `investigations.md` § The rule — "gets a write-up here before the work is called done", with both of Greg's quotes; and `engineering-manager.md` — "write it up in the project's investigations folder before the stage is called done". L2 dropped: stale, "rule wording … pending Greg's approval" — the rule is in `investigations.md`. | eligible |
| `scratchpad-scripts-cannot-import-repo-deps` | `0b2d5fc38414` | L1 (a script outside the repo cannot resolve the repo's packages, whatever the cwd; import by absolute path or `createRequire`) moved (CE7). | eligible |
| `session-cap-covers-greg-directed-work` | `144e8147cb3c` | L1 (every new session counts against what the box carries, Greg-directed ones included; queue the work when he answers many at once; check the box before any `new-claude`) propose AP6. L2 (the heavy-command lock, `flock /var/tmp/spideryarn-heavy.lock`) rides in AP6; the file exists on the box and review prompts under `docs/plans/` use it, but no doc under `docs/project/` names it. | retain |
| `sol-limit-stops-work-never-luna` | `23d9d9bec1d8` | L1 (no Luna stand-in, no skipped review; pause) already: `overseer.md` § The standing jobs, Usage limits — "DO NOT fall back to Luna for important stuff or skip the GPT reviews", and `engineering-manager.md` § Delegate — "Never a stand-in for Sol". L2 (tell Greg at once, he can reset it) already: same two passages — "I can do a reset to get extra. But you need to let me know." L3 (the second Claude login was removed) already: `overseer.md` § The standing jobs — "Since 2026-09-30 there are none". | eligible |
| `subagents-end-turns-while-their-jobs-run` | `b66d85928bd9` | L1 (a subagent starts a loop and ends its turn; give it work that finishes in one turn, own the wait yourself) propose BP4. L2 (`TaskStop` leaves its tmux sessions running; kill by exact name) propose BP4. | retain |
| `supabase-access-token-needs-greg-each-time` | `8a699c4916c9` | L1 (the token is on the box) already: `hetzner-remote-server-box.md` § Where things are — "until Greg put it on, 2026-10-01". L2 (every use needs a fresh yes from Greg; a past yes is not relayed as standing; never printed) propose AP7. | retain |
| `taskoutput-on-a-running-agent-dumps-its-transcript` | `b217bfe07385` | L1 (`TaskOutput` on an unfinished subagent returns its raw transcript; wait for the notification) propose BP4. | retain |
| `tmux-outlives-closed-tabs` | `e94681084d0f` | L1 (closing a tab detaches; judge a session by its transcript's last message, not tmux activity or mtime) already: `hetzner-remote-server-box.md` § tmux keeps sessions alive and does nothing else — "So closing a tab never ends `claude`". L2 (`sessions.mjs` is not in the repo; `--selftest`) moved (BE1). L3 (a running `sleep`/`until` child means the session scheduled its own wake-up; a kill loses nothing, `claude --resume` brings it back) propose BP1. L4 (`idle` is not abandoned: armed `CronCreate`; the percentage is the context bar; a pane-reader's progress claim loses to `git log`) propose BP1. L5 (`waits Nh` is its own state) already: same doc § What `gjd-remote ls` is telling you — "is still counting down; Claude has not started". | retain |
| `two-joins-that-disagree-are-a-measurement` | `b8a3dbb864cd` | L1 (build a second, independently derived join so it can disagree) propose DP2. L2 (`unknown` is its own column, never folded into the negative) propose DP2. L3 (zero unknowns is not a correct join) propose DP2. L4 (send the unfavourable reading to whoever decides, at the time) already, loosely: `codex-cli-as-subagent.md` § Four ways the second opinion gets wasted — "A result whose value is to somebody else is the one that gets dropped." | retain |
| `typecheck-wrapper-covers-tests-tsc-does-not` | `b8c0efede26a` | L1 (wrapper checks more projects than bare `tsc`) already: `typechecking.md` § The layout — "is not \"the typecheck\", and reaching for it is a trap with no error message". L2 (vitest strips types, a type-level test cannot go red at `npm test`) already: same doc § Why three, and not one — "\"the tests pass\" and \"the tests compile\" are two claims". L3 (prove a type guard red under the right invocation; no case for bare `tsc`) already: § Four ways to report it clean while it is red — "Verify a guard by breaking it, under `npm run typecheck` and nothing narrower". L4 (grep `✗\|error TS`; a pipe destroys the exit code) already: same section — "A pipe also replaces the exit code with the last command's". L5 (2026-09-08 incident; "a note not reached for") dropped: one incident, and a remark about the memory system, which `written-down-is-not-checked.md` owns. Note: the memory's "three projects" is stale; `scripts/typecheck.ts` now discovers every `tsconfig.json`. | eligible |
| `use-opus-not-fable` | `a63607bb5779` | L1 (Opus where a doc says Fable; Sol stays the cross-family check; Sonnet for research and browser; Luna for light work) already: `AGENTS.md` § Delegating — "Fable is retired (Greg, 2026-09-28)", and `engineering-manager.md` § Delegate — "Stop using Fable. Let's just rely on Opus 5.5". L2 dropped: stale, "the repo docs may still mention Fable" — they have been updated. | eligible |
| `vitest-process-count-is-five-per-suite` | `e2646e65ad0e` | L1 (`pgrep -fa vitest` counts about five processes per suite; count suites, or read load and memory) propose BP7. L2 (a proxy invented in an incident inherits its units) propose BP7, one clause. | retain |
| `wait-for-real-notifications` | `2fdc24b6d8a5` | L1 (do not write a notification into your own turn; arm one waiter and end the turn) propose BP3. L2 (run `date` before stating a time) propose BP3. L3 (`kill -0 <pid>` fails from the sandbox) dropped: did not reproduce — on 2026-10-05, from an agent's Bash call on the box, `kill -0` returned 0 for a child and for another of the user's processes. See Doubts. | retain |
| `weekly-claude-usage-is-not-a-gate` | `ee5fc5e28706` | L1 (do not slow the fleet for Claude's weekly limit; run to 100% and tell Greg) propose AP4 — **contradicts** `overseer.md` § The tick step 2, "The seven-day window … is rationed the same way". L2 (the 2026-10-03 breach, and that a heads-up at about 95% is fine) rides in AP4. L3 (Codex has its own rule) already: `overseer.md` § The standing jobs, Usage limits — "work stops; it does not step down". | retain |
| `worktree-session-refuses-compound-shell` | `8a229383866e` | L1 (Bash in a worktree session refuses what it cannot verify, including a heredoc that mentions git; use Edit and Write; a script saved and run is accepted) already: `worktrees.md` § Two things about `EnterWorktree` — "names git in a form too complex to verify". | eligible |
| `write-capable-reviewer-can-invent-greg-quotes` | `5aa183a51cc2` | L1 (the same incident, 2026-10-04, plan 261004e) dropped: duplicate of `a-fixing-reviewer-can-attribute-your-words-to-greg` L1. L2 (tell a session that runs fixing reviews to grep the reviewer's doc edits for "Greg") dropped: duplicate of the same file's L2, carried by DP8. | eligible |
| `write-tool-refuses-paths-outside-the-repo` | `d9421850ae90` | L1 (`Write` refuses a path outside the working directory, finally so in an unattended session; a quoted Bash heredoc works) moved (BE7). | eligible |
| `writing-escapes-produces-raw-bytes` | `cca7c088f279` | L1 (an escape typed as content can land as the raw byte; `grep` then reads the file as binary) moved (CE6). L2 (the signature, and `file <path>`) moved (CE6). L3 (the guard is a denylist over everything tracked; commit messages are outside it and git refuses them) moved (CE6). L4 (`Edit` and a `Write`-written repair script reintroduce it) moved (CE6). L5 (never insert an invisible character to escape syntax) propose CP8. L6 (the repair script holds no escape at all; do not retry a refused Bash call) propose CP8. L7 (`git checkout`/`restore` is not the way out) already: `AGENTS.md` § Working in a tree several agents share — "Never run a git command that throws work away". L8 (watch the guard go red, not pass) already: `AGENTS.md` — "A check you have never seen fail is not evidence". L9 (the false claim that `tools/` was uncovered) dropped: one corrected mistake. | retain |

## The proposals

49 of them, as each batch wrote them. **Before** is the text in the doc today; **After**
is what would replace or follow it. The link paths inside a proposal are written for the doc it
targets, not for this file. Numbering: the letter is the batch (A permissions and Overseer practice,
B box and waiting, C git and tooling, D review and reasoning, R added after the result review).

### AP1 — `docs/project/overseer.md` § Dispatching agents

**Before:** new, after the paragraph that ends

```
([worktrees.md § Removing one](worktrees.md#removing-one)).
```

**After:**

```
**Killing finished sessions to free memory is yours too.** Greg, 2026-09-29, after running the
Overseer's `tmux kill-session` list himself: *"You're allowed to run that command and similar
yourself in future to free up memory."* That day swap was full, vitest's memory guard had blocked
four sessions' tests for hours, and killing 17 finished sessions took available RAM from 7 to 12 GB
and swap from 31 to 21 GB. Gate 3 still picks which: only a session that has debriefed, with no
worktree holding uncommitted or unpushed work. A session's old Playwright Chrome goes with it. If
the classifier asks, cite this.
```

Why here: it is the close-out paragraph, which already says closing a finished session is the
Overseer's; this adds the bulk kill and Greg's words. Carries
`greg-allows-overseer-to-kill-finished-sessions` L1, L3.

### AP2 — `docs/project/overseer.md`, a new subsection before `### Dispatching agents`

**Before:** new, after the line

```
deploy's push; `npm audit --audit-level=high` in the primary is the second opinion.
```

**After:**

```
### Keeping `/home` from filling

`/home` on the box is the small disk, and when it is full it is peers' commits and worktree
creation that fail ([hetzner-remote-server-box.md § Traps](hetzner-remote-server-box.md#traps)).
Greg gave two standing permissions on 2026-10-05, the day it reached 100%.

**Worktrees and temp files.** *"You are allowed to remove worktrees where it's safe to do so (e.g.
we've already pushed their contents, or we have explicitly agreed that we are throwing them away)
And you are allowed to remove temp files where safe to do so"*. Safe for a worktree is still what
`npm run worktree:check` says inside it
([worktrees.md § Before you remove one](worktrees.md#before-you-remove-one)), and the removal is
still `npm run worktree:remove`. What this adds to the close-out under *Dispatching agents* is the
tree you and Greg agreed to throw away, and temp files. The Overseer's notes count
`npm cache clean --force` as one of those.
```

Why here: it is a permission for the Overseer, beside the other things it may do unasked
(Dependabot, deploying). Carries `greg-allows-removing-safe-worktrees-and-temp-files` L2.

### AP3 — `docs/project/overseer.md`, the same new subsection

**Before:** new, as the last paragraph of the subsection AP2 adds.

**After:**

```
**Old Codex transcripts.** *"Ok, you have permission any time to delete Codex transcripts more than
a week old"*. That is the `rollout-*.jsonl` files under `~/.codex/sessions/` last modified more
than seven days ago, and the directories that leaves empty:
`find ~/.codex/sessions -type f -name 'rollout-*.jsonl' -mtime +7 -delete`. They were 6.8 GB that
day, half of it older than a week. A review's conclusions are in the repo's `*-sol.md` files.
Claude's transcripts under `~/.claude/projects/` are **not** covered.
```

Why here: the same permission family as AP2. If AP2 is refused, this needs its own home (the
`/home` bullet in `hetzner-remote-server-box.md` § Traps). Carries
`greg-allows-deleting-old-codex-transcripts` L1.

### AP4 — `docs/project/overseer.md` § The tick, step 2

**Before:** new, after the line that ends step 2 (the new paragraph is indented three spaces, inside
the list item)

```
   room. Watch both budgets, and ration against the tighter one.
```

**After:**

```
   **Claude's seven-day window is no longer rationed, since 2026-10-01.** Greg, after the Overseer
   said it would slow new session starts at 92% of the week: *"Keep going until you hit 100% of
   your weekly usage limits, and then I'll find a way to reset them."* So do not hold the queue or
   slow releases because Claude's weekly figure is high, and when sessions do stop at 100%, tell
   him plainly. A line to him at about 95% is fine. The Overseer broke this on 2026-10-03: at 97% it
   held the queue for about three hours, reasoning that at 100% every session stops, itself
   included. That is the trade he had already chosen. A GPT limit is different and still stops work
   (*Usage limits*, above).
```

Why here: this paragraph is where the weekly window is rationed, and the new one reverses it. The
paragraph above it ("at ~4 points a day it lasts the week", and Greg's 2026-09-09 "slow things down
a bit") would then be history; Greg may prefer it rewritten rather than added to. Carries
`weekly-claude-usage-is-not-a-gate` L1, L2.

### AP5 — `docs/project/overseer.md` § gate 2 (Answer facts, route judgement, default the product call)

**Before:** new bullet, after the *Low-stakes decisions* bullet, whose last two lines are

```
  A decision he has not seen is still a decision he can reverse, so the record is the whole of the
  permission.
```

**After:**

```
- **Bugs, and improvements that cost nothing, you authorise yourself.** Greg, 2026-10-04: *"if you
  see bugs, fix them without asking me."* and *"if there are clear no-tradeoffs-improvements that
  won't add much complexity, you should always do them"*. So a plain bug fix, or an improvement with
  no trade-off and little added complexity, does not wait in the queue as *needs Greg*: run the
  queue's `authorize … --by greg` citing this, and dispatch it. What still goes to him as a tagged
  question is a real product trade-off, added complexity, a destructive write to production, and
  the wording of a rule doc.
```

Why here: gate 2 is the list of what the Overseer may decide on Greg's behalf. Carries
`fix-bugs-and-free-improvements-without-asking` L1.

### AP6 — `docs/project/overseer.md` § Dispatching agents

**Before:** new, after the *Three at a time at most* paragraph, which ends

```
spend the evening investigating the box.
```

**After:**

```
**Every new session counts against what the box can carry, whoever asked for it.** Work started for
an answer Greg has just given is not exempt. On 2026-10-05 about fifteen sessions were started in
two hours, one per answer. With about twenty running, up to eight `tsc` runs at once (1–3 GB each),
dev servers and browser agents, load reached about 170 and swap 31 of 32 GB; Greg's ssh crawled and
peers' gates were killed. The 30 GB box fits about six to eight active sessions. So when Greg
answers several questions at once, record the decisions straight away, put the work at the front of
the queue, and release it as sessions finish. Check load, memory and swap before **any**
`gjd-remote new-claude`, not only before a release from the queue. A heavy command can be made to
wait its turn with `flock /var/tmp/spideryarn-heavy.lock <command>`.
```

Why here: it sits beside the existing concurrency limit and the 2026-09-08 "eight sessions in twenty
minutes" story in the same section. Carries `session-cap-covers-greg-directed-work` L1, L2.

### AP7 — `docs/project/hetzner-remote-server-box.md` § Where things are, the `gjd-remote-env.ts` bullet

**Before:**

```
  Supabase project) was too, until Greg put it on, 2026-10-01: *"I know there is risk, but I think
  it'll be fine."* Tested in [`tests/gjd-remote-env.test.ts`](../../tests/gjd-remote-env.test.ts).
```

**After:**

```
  Supabase project) was too, until Greg put it on, 2026-10-01: *"I know there is risk, but I think
  it'll be fine."* **Its being on the box is not permission to use it.** It went on for one run of
  `scripts/supabase-auth-config.ts templates`, and Greg, the same day: *"You have my permission
  this time to run the command … But going forwards, you still need to ask my permission for any
  action that involves SUPABASE_ACCESS_TOKEN."* So every action that uses it, by any session, needs
  a fresh yes from him for that action. Do not pass an earlier yes to a peer as though it were
  standing, and never print the value.
  Tested in [`tests/gjd-remote-env.test.ts`](../../tests/gjd-remote-env.test.ts).
```

Why here: it is the one passage that says the token is on the box, so it is where an agent finds
out it could use it. Carries `supabase-access-token-needs-greg-each-time` L2.

### AP8 — `docs/project/worktrees.md` § The workflow

**Before:** new, after the code block that ends

```
git diff origin/dev...HEAD     # THREE dots. Two is a trap; see below.
```

(and its closing fence), before the paragraph that begins `**Type the three dots.**`

**After:**

```
**Merge `origin/dev` when you wake up as well, not only when the work is done.** A session resuming
from a cron, a long wait, a compaction or a `--resume` fetches and merges before it does anything
else.

> when you wake up, pull the latest changes to avoid a big merge conflict at the
> end
>
> — Greg, 2026-09-06

That day a change sat in a worktree for about two hours, and `dev` moved three times during the
push sequence itself: the merges brought in 64, then 11, then 84 files, each one after the tests
had run, and each forcing another run. Merged early, the same changes are an ordinary integration,
and a conflict arrives while there is still time to think about it. Run the affected tests again
after the merge.

In the shared primary, look first: if `git rev-list --left-right --count HEAD...origin/dev` shows
nothing local-only, `git merge --ff-only origin/dev` moves the branch without a merge commit and
without touching what other agents have uncommitted there.
```

Why here: this section is the merge recipe, and it currently places the merge at the end of the
work. Greg may prefer `docs/reusable/long-waits.md`, which is where an agent about to wait looks.
Carries `pull-latest-on-waking-up` L1, L4.

### AP9 — `docs/project/vision.md`, the opening section

**Before:**

```
The first feature built on this is [granularity zoom](granularity-zoom.md).
```

**After:**

```
The first feature built on this is [granularity zoom](granularity-zoom.md). It is one core feature,
not the reason the app exists:

> granularity-zoom is *a* core feature, but by no means the only reason the app
> exists! The glossary, concept-search, remembering, diagramming, etc all feel
> novel and interesting.
>
> — Greg, 2026-09-07

So weigh a piece of work by what it does for the whole set of reading modes
([reading-view-overview.md](reading-view-overview.md)), not for the tree alone. Work on extraction
quality usually feeds all of them, which is the stronger argument for it.
```

Why here: it is the sentence that introduces granularity zoom, and the one an agent ranking work
would read. Carries `granularity-zoom-is-one-of-several-core-features` L1.

### AP10 — `docs/project/hetzner-remote-server-box.md` § Traps

**Before:** new bullet, directly after the bullet AE2 adds (or, if AE2 is not applied, after
"else large and disposable belongs on `/` too.").

**After:**

```
- **Do not retry a command the classifier has just refused.** Whether it runs is not the agent's
  call. Try a read of real reader data at most once from an unattended session. If it is refused,
  write the one-command read-only script for Greg to run, do not plan an eval around a real shelf,
  and say plainly in the report that the data was not looked at.
```

Why here: beside the fact it acts on (AE2). Carries `classifier-accepts-fleet-restart-script` L3 and
`classifier-refuses-production-reads-in-auto-mode` L2.

Each adds or changes what an agent is told to do, or sits in `docs/reusable/`.

### BP1 — `docs/project/overseer.md` § Things that will catch you

**Before**: new, after the bullet that ends

```
  found one of twenty-three, because decisions end in full stops.
```

**After**

```
- **`idle` is not abandoned either.** Measured 2026-09-06 across sixteen sessions: most `idle` ones
  had armed a `CronCreate` one-shot hours ahead and stopped on purpose. Before calling a session
  stuck or finished, `tmux capture-pane` and look for a `CronCreate` near the tail, and check for a
  running `sleep` or `until` child: a session that scheduled its own wake-up is not to be killed.
  The percentage in its status line is the context bar, not progress — "7%" was once reported as
  "stage 1 not yet coded" on a branch eight commits deep — so take `git log origin/dev..<branch>`
  and the plan doc's status line over any reading of the pane. Killing a finished session loses
  nothing: its edits are on disk and `claude --resume <session-id>` brings the conversation back.
```

Why here: it is the Overseer's judgement about which sessions to end, and the 2026-10-01 sweep left
it for this doc. Carries: `tmux-outlives-closed-tabs` L3, L4.

### BP2 — `docs/reusable/long-waits.md` § Choosing

**Before**: new section, after the paragraph that ends

```
explanation when somebody reports a long wait "cancelled after about ten minutes".
```

**After**

```

## On a loaded machine, the waiter dies before the job

"No cap found" in the table is true of a quiet machine. On a box shared by many agents the harness
stops background Bash tasks when the *system* is short of memory, whoever is using it: on 2026-09-03
five background runs in a row were reported `status: killed` with nothing written, and on
2026-09-05 a waiter that was only a sleeping shell was stopped at 63 minutes, launched at a load of
17.7 with 9 GB free. So checking `uptime` and `free -g` first is necessary and not sufficient.

- **`killed` is no information about the thing you were running.** Read the job's own log.
- **Run the job itself somewhere the harness does not own** — a tmux session — and treat the waiter
  as disposable.
- **For "resume this conversation in N hours", arm two `CronCreate` one-shots a few minutes apart**
  rather than one plus a `Monitor`. A one-shot is scheduled inside the Claude process, so there is
  no child to kill.
- **A `Monitor` is hardier than background Bash, not immune.** On 2026-09-08, with 7 GB available,
  two Bash waiters were killed within minutes while a `Monitor` on the same condition delivered its
  event. When a Bash waiter dies, check the `Monitor` before assuming it went too.
```

Why here: this doc's table and its "pair it with a `Monitor`" advice are what the measurements
correct. Carries: `long-waits-need-a-persistent-monitor` L4, L9, L10.

### BP3 — `docs/reusable/long-waits.md`

**Before**: new section, directly after BP2's (or after the same anchor line if BP2 is declined).

**After**

```

## While you wait

- **Arm one waiter, then end the turn.** A poll does not advance time, it spends a turn: on
  2026-09-08 over a hundred turns of `grep EXIT= <log>` went by while the clock moved about seven
  minutes. For a tmux job, one `Monitor` that fires on the log's `EXIT=` line or on the session
  vanishing is enough.
- **A background `sleep` does not make time pass for you.** `run_in_background` returns at once, so
  several of them run side by side while you carry on. Read `ps -o etime=` on the job's pid, or run
  `date`, before saying how long anything has taken or what time it is.
- **A notification is something that arrives, never something you write.** On 2026-09-30 an agent
  waiting on a review wrote completion notices into its own turns and then acted on them. Real ones
  come as system turns.
- **In a poll loop use `grep -q`, never `grep -c PATTERN file || echo 0`.** With no matches
  `grep -c` prints `0` and exits 1, so the fallback runs too, the value is two lines, and a test
  against `"0"` is true at once. On 2026-09-07 that announced two running jobs as done within
  seconds. A waiter that fires suspiciously fast gets its condition checked by hand.
```

Why here: the doc says which mechanism to pick and nothing about how to behave once it is armed.
Carries: `polling-a-log-burns-turns-not-time` L1; `long-waits-need-a-persistent-monitor` L8;
`full-suite-needs-tmux-on-this-box` L7; `wait-for-real-notifications` L1, L2;
`grep-c-fallback-fires-immediately` L1, L2.

### BP4 — `docs/reusable/engineering-manager.md` § Delegate

**Before**: new paragraphs, after

```
Run them in parallel only when their file sets don't overlap.
```

**After**

```

**Give a subagent work that finishes inside one turn, and own the long waits yourself.** A subagent
told to run a long loop starts it and ends its turn with "I'll wait for that to complete",
reporting nothing: the harness counts it finished because a tmux job it spawned is not a child it
tracks. Resuming it repeats the pattern — on 2026-09-06 three did this and one spent 152k tokens on
idle re-checks. Ask for the instrument and a bounded measurement, tell it to block in the foreground
rather than background anything, and read its artefacts yourself. Stopping such an agent leaves its
tmux sessions running: list them and end each by exact name.

**Do not read a subagent's output before its completion notice arrives.** On an agent still running,
`TaskOutput` returns the tail of its raw transcript, every tool call and diff included — about 18k
tokens for one call on a busy agent. After it finishes the same call returns the report. To watch
progress meanwhile, poll something cheap and external: a file it is due to write, or
`git status --short`.
```

Why here: § Delegate is where a brief's shape is decided. Carries:
`subagents-end-turns-while-their-jobs-run` L1, L2;
`taskoutput-on-a-running-agent-dumps-its-transcript` L1.

### BP5 — `docs/project/testing.md` § A test that spawns a process needs its own timeout

**Before**: new paragraph, after the line

```
[260903d](../plans/260903d-improve-the-codebase-second-sweep.md) § T1.2.
```

**After**

```

**So re-run each red file alone before calling any of them a regression.** A file that passes alone
was the box; one that fails alone is yours. On 2026-09-03 three full runs produced 22, 2 and 2
failures and all but three assertions passed in isolation — and those three were real, hiding in a
batch of twenty.
```

Why here: the paragraph above it tells the same story and stops short of saying what to do.
Carries: `postgres-suites-fail-from-contention` L1 (and `long-waits-need-a-persistent-monitor` L6).

### BP6 — `docs/project/testing.md` § A scoped run answers a smaller question than it looks like

**Before**: new bullet, after the bullet that ends

```
  drive a route.
```

**After**

```
- **After merging `dev`, choose the re-run from what the merge brought in, not from what your change
  is about.** `git diff --name-only HEAD...origin/dev` first; then typecheck and the suites those
  files touch. A full gate after every merge reports on a tree that has already gone: on 2026-09-08
  `dev` gained 74 commits in 55 minutes, two full re-gates went red, and neither red belonged to the
  change being gated. Keep the full gate for the tree you push.
```

Why here: it is a rule about which scoped run to choose. It also bears on `AGENTS.md` § Before you
call it finished, which this does not change. Carries: `postgres-suites-fail-from-contention` L4.

### BP7 — `docs/reusable/diagnose-box-resources.md` § The traps

**Before**: new paragraph, after the paragraph that ends

```
tooling. `pgrep -x` matches the executable name; `-f` is for when you genuinely mean the arguments.
```

**After**

```

**`pgrep -fa vitest | wc -l` counts about five processes per suite.** One `npx vitest run` is the
shell wrapper, `npm exec`, `sh -c`, the `.bin/vitest` node and its worker. On 2026-09-08, 24
processes were about five single-file runs on a box with load 13 and 13 GB free, and a threshold of
"eight vitest processes" written after that morning's overload would have blocked a healthy gate.
Count suites — `pgrep -fa "vitest run" | grep -c "\.bin/vitest"` — or read load and available
memory, which measure the thing itself. A threshold invented during an incident inherits that
incident's units.
```

Why here: it is the process-counting trap this section collects; the 2026-10-01 sweep proposed the
same (its P3/K3), not yet landed. Carries: `vitest-process-count-is-five-per-suite` L1, L2.

### BP8 — `docs/reusable/diagnose-box-resources.md` § The traps

**Before**: new paragraph, directly after BP7's (or after the same anchor line).

**After**

```

**`ps -eo args | grep -c <flag>` counts its own apparatus.** On 2026-09-08 it answered 3 for a flag
no process was using: the two `bash -c` wrappers whose argv carried the whole pipeline, and the
grep itself. Under an agent harness any flag merely *named* in a command becomes a phantom, because
the tool shell puts the entire command line into argv. Walk `/proc` instead: read each
`/proc/<pid>/cmdline`, split on NUL, and match argv *elements*; report how many entries were scanned
and how many were unreadable, so a permission failure cannot read as zero. And print what matched,
not just the count, before quoting it to anybody.
```

Why here: same section, same family. Carries: `ps-grep-counts-its-own-apparatus` L1.

### BP9 — `docs/reusable/diagnose-box-resources.md` § The traps

**Before**

```
**`pkill -f <string>` will match your own shell.** Your command line contains the string you are
searching for, so the shell running `pkill` kills itself, and the exit code looks like a failure of
the thing you meant to kill. Kill by PID, or filter out `$$`.
```

**After**

```
**`pkill -f <string>` will match your own shell.** Your command line contains the string you are
searching for, so the shell running `pkill` kills itself, and the exit code looks like a failure of
the thing you meant to kill. Kill by PID, or filter out `$$`. Anything chained after it with `&&` or
`;` then never runs: on 2026-09-08 a `pkill -f … && <restart>` returned 144 twice, and the second
time it looked as though the restart had worked, because the old process was gone and the new one
had never started. Run it alone in its own call and confirm with a separate `pgrep`.
```

Why here: it completes the paragraph with the consequence that cost the time. Carries:
`ps-grep-counts-its-own-apparatus` L2.

### BP10 — `docs/project/overseer.md` § Things that will catch you

**Before**

```
- **Prove the relaunch before you stop a process.** The classifier judges each command alone: it
  allowed `kill -TERM` of the daemon and refused every relaunch, and the daemon was down eleven
  minutes on 2026-09-08 until Greg typed it. Run the exact relaunch shape against something harmless
  first; if that is refused, leave the old one running and hand Greg both halves as one command pair.
```

**After**

```
- **Prove the relaunch before you stop a process.** The classifier judges each command alone: it
  allowed `kill -TERM` of the daemon and refused every relaunch, and the daemon was down eleven
  minutes on 2026-09-08 until Greg typed it. Run the exact relaunch shape against something harmless
  first; if that is refused, leave the old one running and hand Greg both halves as one command pair.
  Worktree isolation is a second gate of the same shape: on 2026-09-09 a session in a worktree was
  allowed to stop the readiness loop and refused every way of starting it, because the launch runs
  git in another worktree. So probe the real path, not only the command's shape. Do not ask a peer
  to run the half you were refused. The way out of an isolation refusal is `ExitWorktree` with
  `action: "keep"`, which returns the session to the primary, where restarting a service is an
  ordinary operation; say so to the Overseer before doing it.
```

Why here: it extends the existing rule with its second mechanism and adds a permission. Carries:
`prove-the-relaunch-before-stopping-the-old-process` L2, L3, L4.

### BP11 — `docs/project/browser-testing.md` § And check the port, not just the server

**Before**

```
So: kill the **listening** PID (`lsof -ti :PORT`, or find the `vite` child), then check the port is
actually free before starting another. And prove *which code* is being served before you trust a
```

**After**

```
So: kill the **listening** PID (`lsof -ti :PORT`, or find the `vite` child), then check the port is
actually free before starting another. **Before killing a pid you found by port, read
`/proc/<pid>/cwd` and confirm it is your own tree**: on 2026-09-08 a session's own server was
already gone and the listener on its port was a peer's dev server, bound in the gap. And prove
*which code* is being served before you trust a
```

Why here: the sentence it amends is the one that sends a reader to kill by port. Carries:
`a-port-you-bound-may-be-a-strangers-now` L1.

### BP12 — `docs/project/static-analysis.md`, the note under the command list

**Before**

```
working. `npm run check` is the pre-commit gate, and you should expect to wait — run it under
[`scripts/tmux-job.ts`](../../scripts/tmux-job.ts), because a backgrounded process is OOM-killed on
*system* memory pressure here. `--fast` skips the build but **not** the suite.
```

**After**

```
working. `npm run check` is the pre-commit gate, and you should expect to wait — run it under
[`scripts/tmux-job.ts`](../../scripts/tmux-job.ts), because a backgrounded process is OOM-killed on
*system* memory pressure here. `--fast` skips the build but **not** the suite. Start it early rather
than waiting on it in series: commit on the fast gates — `npm run typecheck`, the suites you
touched, and `npx vitest run tests/doc-links.test.ts` after any doc edit — and read `check`'s
verdict when it lands.
```

Why here: it is where the cost of `check` is stated. **It loosens `AGENTS.md`'s "`npm run check`
before you commit"**, so it is Greg's to decide, and if he takes it AGENTS.md wants the matching
line. Carries: `npm-run-check-runs-the-full-suite` L3. (BE4's paragraph follows this one whichever
lands first; BE4's anchor is the last line of this Before block.)

### CP1 — `docs/reusable/git-resolve-merge-conflicts.md` § Once the proposal is agreed

**Before:** new, after the paragraph ending

```
conflict — which is how a merged migration journal can leave a forked snapshot chain that every test
still passes.
```

**After** (a new paragraph):

```

The same holds inside a file that did conflict. When both sides added entries to one list, array
or registry, git keeps both wherever the added lines did not collide, with no markers. A merge on
2026-09-07 marked five hunks in a route table, all comment wording, and left every referee route
declared twice. After a merge that touches a file holding a list, run that list's own test before
anything else.
```

Why here: this doc owns what a merge does silently, and its only example is two new files. Carries
`merge-can-duplicate-what-it-does-not-conflict-on` L1.

### CP2 — `docs/project/version-control.md` § The thing that fails silently

**Before:** new, as the last sentence of the paragraph CE4 adds (after "`git status --porcelain`.").

**After:**

```
So after every pathspec commit, run `git status --porcelain` and read it: a ` M` line for a file
that belongs to the change is a file that did not go in.
```

Why here: it is a new step in the commit recipe, and this section is where the recipe's silent
failures are listed. Carries `commit-pathspec-drops-files-silently` L2.

### CP3 — `docs/project/worktrees.md` § The workflow

**Before:**

```
git fetch origin dev
git merge origin/dev           # NOT rebase — see below
```

**After:**

```
git fetch origin dev
git merge origin/dev           # NOT rebase — see below. Commit first: never merge on a dirty tree
```

and, after the paragraph ending `Below` (a link to the Traps section) `for why this bites here in particular.`, a new
paragraph:

```

**Commit before every merge.** A merge refused over modified tracked files has once left them at
`HEAD` — [version-control.md § Always merge, never rebase](version-control.md#always-merge-never-rebase).
```

Why here: the workflow block is what an agent copies, and it merges without saying the tree must
be clean. `get-ready-to-deploy.md` already says "Commit before you pull" for its own sweep. Carries
`a-refused-merge-can-wipe-uncommitted-edits` L2. Depends on CE5 for the link's content.

### CP4 — `docs/project/worktrees.md` § The workflow

**Before:** new, after the paragraph CP3 adds (or after `Below` (a link to the Traps section) `for why this bites here in`
`particular.` if CP3 is declined).

**After:**

```

**Do not wait for a green full suite on a busy trunk.** Each merge of `dev` can bring a different
session's breakage: three merges in one afternoon on 2026-09-08 met three unrelated reds, each
fixed upstream within the hour by the session that caused it. Show that your own files are
disjoint from the failing ones, show that your own tests pass, and push.
```

Why here: it changes what the `npm test && npm run typecheck` line in this block is taken to
require. It is a permission, so it is Greg's to give; `AGENTS.md` says to tolerate reds that are not
yours but does not say a push may go ahead over one. Carries `diff-against-a-base-includes-the-merge`
L2.

### CP5 — `docs/project/worktrees.md` § Two things about `EnterWorktree` that have each cost an agent an hour

**Before:** new, after the line

```
checks, sees nothing, and starts again from scratch on top of a half-finished job.
```

**After** (continuing the same paragraph):

```
If there is work there, neither trust it nor throw it away: read it and check its claims
yourself, by breaking each fix and watching its test go red. On 2026-09-05 that took twenty
minutes for three inherited stages, and they were sound.
```

Why here: the paragraph says to look and stops before saying what to do with what you find.
Carries `a-named-worktree-may-hold-a-dead-sessions-work` L2.

### CP6 — `docs/project/testing.md` § Why the docs have a test

**Before:**

```
at once. Left alone on cost, not on merit. **Write anchors the way the gate wants** — one hyphen —
and know they are wrong on github.com; the rendered docs are read locally and in editors far more
often. Fixing it properly is a whole-tree sweep and wants to be its own job.
```

**After:**

```
at once. Left alone on cost, not on merit. **Write anchors the way the gate wants** — one hyphen —
and know they are wrong on github.com; the rendered docs are read locally and in editors far more
often. Or link to the file with no fragment and name the section in prose, which is right in both
places. Fixing it properly is a whole-tree sweep and wants to be its own job.
```

Why here: this paragraph is the rule for such a link, and the memory's advice is a second option
the rule does not offer. Carries `em-dash-heading-anchor-fails-both-ways` L2.

### CP7 — `docs/reusable/documentation-policy.md` § Keeping it true

**Before:** new bullet, after the bullet ending

```
  rule, so adding a line for a new doc, or tweaking a pointer, needs no approval.
```

**After:**

```
- **Never pass prose through a shell string.** Backticks inside a double-quoted shell argument are
  command substitution, so each code span is run and removed: a plan section appended that way on
  2026-09-08 landed with four spans missing, the script printed its success line, and the result
  read as clumsy writing, not as damage. `$`, `!` and `\` are the same family. Write prose with the
  Write tool, or have a script read it from a file; a heredoc with a quoted delimiter is safe. Then
  read what landed.
```

Why here: it is about how a doc edit reaches the file, and no project doc owns that. Carries
`prose-through-a-shell-loses-its-markup` L1, L2.

### CP8 — `docs/project/testing.md`, the subsection CE6 adds

**Before:** new, as the last paragraph of "### A raw NUL in a file makes every grep of it come back
empty".

**After:**

```

So: never insert an invisible character to get round syntax — rewrite the sentence so it does not
need the delimiter. Repair a file with a script that contains no escape sequence at all, building
each backslash with `chr(92)`, finding the line by a plain-text anchor that must match exactly
once, and counting the bad bytes before and after. And when a Bash call is refused for *"control
characters that would be hidden in the approval dialog"*, do not retry it: that is this byte, so
move the content into a file.
```

Why here: these are the instructions that follow from CE6's facts, kept beside them. Carries
`writing-escapes-produces-raw-bytes` L5, L6.

### CP9 — `docs/project/browser-testing.md` § A long check measures a moving tree

**Before:** new, after the line

```
verification round. The same is true of a 24-minute gate on a busy `dev`.
```

**After** (a new paragraph):

```

So do not edit the files a browser agent is checking while it runs; queue the edits. Where that is
not possible, say in its brief which findings to re-verify at the end, or re-run any serious
finding against a known commit before acting on it.
```

Why here: the section states the trap and not what to do about it. Carries
`browser-agents-measure-a-moving-tree` L2.

### CP10 — `docs/project/testing.md` § Run the suite in tmux, because a killed run and a passing run look the same

**Before:** new, after the paragraph ending

```
section belongs to — [silent-success.md](../reusable/silent-success.md).
```

**After** (a new paragraph):

```

**A long gate reports on a commit, not on the tree you are standing in.** Record the sha the run
started from, and before acting on a failure, and above all before telling its owner, check that
sha is still your `HEAD`; `git merge-base --is-ancestor <fix> HEAD` says whether a fix is already
in. On 2026-09-08 three sessions reported the same `fixture-ids` red to its owner after the fix
had merged, one of them from a tree that already held it.
```

Why here: it is the same family as the paragraphs above it. This is W3's P5 from the 2026-10-01
sweep (`docs/plans/261001i-probes/report-W3.md`), which never landed. Carries
`browser-agents-measure-a-moving-tree` L3.

### CP11 — `docs/project/plans.md` § A few principles

**Before:** new bullet, after the bullet ending

```
  prose cannot fail ([written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md)).
```

**After:**

```
- **A survey of the tree carries the sha it was taken at, in its heading.** On 2026-09-08 a 29-row
  census took ninety minutes to land, `dev` moved 52 commits meanwhile, and a peer had shipped the
  stage one of its main findings called missing. Before landing one, re-check the rows the next
  stages depend on, and say that the others were not re-checked.
```

Why here: it sits beside the principle that a status line has to rest on something. Carries
`browser-agents-measure-a-moving-tree` L4.

All but DP10 are in `docs/reusable/`, so they are proposals whatever their wording.

### DP1 — `docs/reusable/silent-success.md` § The habit

**Before:**

```
**Reasoning about it is not checking it.** A regex reviewed by eye looked correct and matched the
wrong thing; the mutation run found it in seconds. Reasoning is the natural check par excellence,
because it re-runs the same assumption that produced the code.
```

**After:**

```
**Reasoning about it is not checking it.** A regex reviewed by eye looked correct and matched the
wrong thing; the mutation run found it in seconds. Reasoning is the natural check par excellence,
because it re-runs the same assumption that produced the code. **Re-reading your own work is the
same check, and it buys nothing.** On the night of 2026-09-07/08 five separate holes in one
migration's safety net each survived repeated reading by its author, and every one fell to
something external: a peer session, a cross-family review, or a probe run against a case that
should fail. When you catch yourself planning to read it carefully once more, spend that on one of
those three instead.
```

Why here: this is the paragraph a reader lands on when deciding whether thinking harder is a check.
Carries `re-reading-your-own-work-is-a-zero-check` L1.

### DP2 — `docs/reusable/silent-success.md` § Fourteen more, from the checks rather than the code

**Before** (the heading, and the last row of that table):

```
## Fourteen more, from the checks rather than the code
```

```
| An assertion that reddens above the line you care about | The test fails when the bug is introduced, so it covers it | *Which* assertion fired — a mutation can redden a test without ever reaching the one it is named for |
```

**After** (the heading renamed, and three rows added directly after that last row):

```
## Seventeen more, from the checks rather than the code
```

```
| An assertion that reddens above the line you care about | The test fails when the bug is introduced, so it covers it | *Which* assertion fired — a mutation can redden a test without ever reaching the one it is named for |
| A fallback chained onto an existence check | `ls X \|\| git show Y` printed a commit header, so the file is there | The check alone, by exit code — `test -e X && echo PRESENT \|\| echo ABSENT`, so both branches say which happened — and in *your* tree: a peer's commit being on the trunk does not put its file in a worktree that has not merged it |
| A rule derived from a census of what is running | All seventeen live instances agree, so the rule is obvious | One specimen made on purpose of the state nothing is in right now — just created, just failed, empty. A new session showed a greyed hint in its input box that no used session has, and the rule would have made every new session unsendable |
| A count that came from one join | Zero unknowns, and a plausible number | A second join, derived independently, kept beside the first so the two can disagree; `unknown` as its own column, never folded into "no". A pid join returned unknown for 4 of 4, an ancestry join returned zero unknowns and the wrong answer, and only the disagreement pointed at the cause |
```

Why here: each is a check that answered while defeated, which is this table's subject. The heading's
anchor has no inbound link (`grep -rn "fourteen-more-from-the-checks" docs AGENTS.md`, 2026-10-05:
no hits), so renaming it breaks nothing. Carries `a-fallback-makes-a-failed-check-look-answered`
L1, L2; `a-survey-cannot-see-an-absent-state` L1; `two-joins-that-disagree-are-a-measurement` L1,
L2, L3.

### DP3 — `docs/reusable/written-down-is-not-checked.md` § What to actually do

**Before:**

```
- **Never a bare count.** *"14 by `grep -rn takeRunLock tests/`, 2026-09-02"* — command, scope,
  date.
```

**After:**

```
- **Never a bare count.** *"14 by `grep -rn takeRunLock tests/`, 2026-09-02"* — command, scope,
  date.
- **Never a list from a search piped through `head`.** On 2026-09-08 `grep -rn … | head -20`
  showed three callers of seven, and the three went into a source comment as the set — in the
  comment written to correct a false claim. Count first (`grep -c`, `| wc -l`), or re-run it
  unbounded before the list becomes a sentence.
- **Say what you searched, in the sentence that reports the result.** A grep answers one
  direction. *"Nothing in `tools/overseer/` imports X"* is a claim a reader can size; *"the seam is
  one-way"* also needs the reverse grep, and on 2026-09-09 nobody had run it before a design
  decision was built on it.
```

Why here: both are inventories and absences reported without their edge, which is this list's
subject. Carries `a-truncated-grep-becomes-an-exhaustive-list` L1;
`an-unchecked-brief-claim-becomes-a-source-comment` L3b; `a-check-can-answer-a-weaker-question` L2.

### DP4 — `docs/reusable/engineering-manager.md` § Delegate

**Before** (new, after this paragraph):

```
A subagent starts with nothing but your prompt. Name the files, say what the stage excludes as well
as what it is for, say what done looks like, and ask for the conclusion rather than the material.
Run them in parallel only when their file sets don't overlap.
```

**After** (that paragraph unchanged, then):

```
**Grep every load-bearing claim in a brief before you send it.** The builder's only source for the
reasoning is the brief, so a fact asserted there comes back quoted in a source comment, a doc
paragraph and a test header at once, and each copy then reads as separately established. Three
false ones in one plan in September 2026 each cost a review cycle: a named caller, a "nothing loads
this file", a "this file calls that function". The same goes for a fact you took from a review
finding or from another session's message. Give the builder the grep rather than the conclusion,
and **end the brief with *"say which claims in this brief turned out to be false"*** — on
2026-09-08 two wrong instructions stayed out of the tree because both implementers reported the
problem instead of complying. When a claim does turn out wrong, find every copy of it, as you would
for a rename.

**A brief that adds a refusal carries its own retreat.** For a `throw`, a 4xx or any hard refusal on
a path a reader can reach, write two things before the work starts: the fallback, in one sentence,
as a decision already taken (*"if any ordinary request reaches the throw, do not keep it: log a
warning and return null"*), and an instruction to test the mechanism the "this cannot happen"
argument rests on, naming it. On 2026-09-07 the builder found the stated mechanism was the wrong
one, the reviewer found the replacement argument was false too, and because the fallback was
already written a P0 was a one-line decision. When the fallback fires, the plan says *documented*,
not *closed*.
```

Why here: § Delegate is where the doc says what a brief must contain. Carries
`an-unchecked-brief-claim-becomes-a-source-comment` L1, L5, L6;
`name-the-fallback-before-the-reviewer-does` L1, L3.

### DP5 — `docs/reusable/review-prompt-template.md` § The five rules, before the template

**Before** (new, after rule 3's paragraph, which ends with these two lines):

```
This is [codex-cli-as-subagent.md § If you can write the question, write the fix](codex-cli-as-subagent.md#the-house-workflow-in-this-repo)
applied to the prompt's layout rather than its content.
```

**After** (those lines unchanged, then):

```
**When the stage produced a result, the conclusion is part of the candidate.** List the results
file or the write-up in the manifest and say *read this as a reviewer of the conclusions, not only
of the code*. Then, under your own suspicions, write the one sentence you would least like to be
wrong about and ask for it by name; a refusal the stage introduced on a reader's path belongs
there. On 2026-09-07 an eval's write-up called its arms "not separable", and the reviewer, asked
directly whether that was explaining away an inconvenient result, showed that it compared two
statistics on different sampling scales and that three of the five arms were one recipe. A reviewer
handed only the diff cannot find that, because the defect is not in the code. Keep the wrong
conclusion and its correction both in the plan doc: deleting the wrong one loses the evidence of
which way the pull went.
```

Why here: it is a rule about what goes in the prompt and where, beside the rule on suspicions.
Carries `ask-the-reviewer-to-check-the-conclusion` L1, L3;
`name-the-fallback-before-the-reviewer-does` L2.

### DP6 — `docs/reusable/codex-cli-as-subagent.md` § The house workflow in this repo

**Before:**

```
**Check each finding yourself before acting on it.** Some of them are wrong. Fold what survives into
the plan, and add its questions to the ones for Greg.
```

**After:**

```
**Check each finding yourself before acting on it.** Some of them are wrong. Fold what survives into
the plan, and add its questions to the ones for Greg.

**Checking means tracing, not reading a description.** Open the function that does the thing and
every hop on the way to it. A comment says what a field *means*, never what it *equals*; a file
header says what one component cannot see, not what the system does. On 2026-09-09 a plan's central
mechanism rested on two values being the same thing, inferred from an assignment and a nearby
comment with the middle hop never opened, and it was false. On 2026-09-10 a security finding was
"verified" from a header describing a blind spot, when the check that covered it was one file over,
and it went to Greg as an alarm. For a claim about behaviour, run the small complete set of inputs
rather than one: a finding that a function "compares only the first two" ids was true, and the
obvious single test of it would have passed and seemed to refute it, because only the position of
the odd one decides. **A finding you could not trace is relayed as *unverified*, in that word.**
```

Why here: it is the paragraph that tells the caller to check a finding, and it does not say how.
Carries `an-unchecked-brief-claim-becomes-a-source-comment` L2;
`a-comment-is-not-a-traced-equality` L1; `a-header-comment-is-not-a-traced-check` L1.

### DP7 — `docs/reusable/codex-cli-as-subagent.md` § The house workflow in this repo

**Before** (new, after the paragraph that ends with this line):

```
[Gotchas](#gotchas). `retrying with CODEX_API_KEY` on stdout is the fallback working, not a failure.
```

**After** (that paragraph unchanged, then):

```
**And check that it was a second opinion.** A Codex run asked both to implement and to review can
end up reviewing its own work: when the wrapper cannot start a nested Codex process inside the
sandbox (the read-only filesystem, or the `listen EPERM` on tsx's IPC socket under
[Gotchas](#gotchas)), the same model takes the review brief itself. It does not fail. Measured
2026-09-09: it wrote a proper artefact with IDs, severities and two rounds, found two real P1s and
reported "accepted after fixes"; an independent pass over the same commit, launched from the
caller's own shell, then refused it on five established P1s. Exit 0, a fresh answer file and
plausible findings are all satisfied by a self-review. The only sign was one sentence in the
artefact saying the nested process could not start. So read a review artefact for how it was
produced, launch the review yourself from a fresh `run-codex.ts` invocation, and do not count a
self-review as the cross-family round.
```

Why here: it sits beside the existing "check that a verdict actually arrived" rule, and is the case
that rule passes. Carries `a-codex-self-review-looks-like-an-independent-one` L1, L2.

### DP8 — `docs/reusable/codex-cli-as-subagent.md` § The house workflow in this repo

**Before** (new, after the paragraph that ends with these two lines):

```
a **plan review**, where the only thing to fix is prose, and for any pass where you want the mutation
rather than the patch.
```

**After** (that paragraph unchanged, then):

```
**Read the reviewer's doc edits as well as its code, and grep them for `Greg`.** On 2026-10-04 a
write-capable review edited a plan doc and put a sentence from the review prompt, the caller's own
account of a trade-off it had taken, in a dated blockquote headed as Greg's decision. Greg had said
nothing. This repo treats his quoted words as rules, so a made-up one in a committed doc would be
read as his authority by every later agent, and nothing else checks it. In the prompt, say whose
decision each trade-off was (*"my decision, not the user's"*).
```

Why here: it is a cost of the write-capable default, stated where that default is described. Carries
`a-fixing-reviewer-can-attribute-your-words-to-greg` L1, L2 (and the duplicate
`write-capable-reviewer-can-invent-greg-quotes`).

### DP9 — `docs/reusable/codex-cli-as-subagent.md` § Gotchas

**Before:**

```
- **Stale-looking answers.** A run occasionally returns something that reads as an answer to a
  *previous* prompt. The wrapper writes a fresh temp `-o` file per run and never resumes a session,
  so it isn't output reuse on this side; the likely causes are upstream. Treat such an answer as
  suspect, re-run with a textually distinct prompt, and never let a single Codex pass carry a
  load-bearing claim ("X is already implemented", "this is safe") without a second check.
```

**After:**

```
- **Stale-looking answers.** A run occasionally returns something that reads as an answer to a
  *previous* prompt. The wrapper writes a fresh temp `-o` file per run and never resumes a session,
  so it isn't output reuse on this side; the likely causes are upstream. Treat such an answer as
  suspect, re-run with a textually distinct prompt, and never let a single Codex pass carry a
  load-bearing claim ("X is already implemented", "this is safe") without a second check.
- **One cause of a stale answer is on this side: relaunching onto an `--output` path a killed run
  used.** Measured 2026-09-07: a review was killed with `kill <pid>` and `pkill -P <pid>` and
  relaunched with a rewritten prompt at the same path. The first run survived both signals (it sits
  below the `npx` and `tsx` processes, in a process group of its own), finished, and wrote the
  *superseded* review to that path about eight minutes later. Exit code and "the file exists" both
  passed, the answer was acted on, and a design decision was reversed on it. So give every run its
  own `--output` path, or delete the file first and treat its reappearance as the signal; kill a
  run by process group (`kill -- -<pgid>`); and judge an answer by whether it discusses the prompt
  you sent. Asking the reviewer to echo a nonce from the prompt makes that mechanical.
- **The opposite ending: under memory pressure the run dies and writes nothing.** No answer file
  and no process whose `--prompt-file` is yours means it died, and relaunching onto the same path
  is then safe because nothing was written. Check with `pgrep -af "run-codex|codex"` and match the
  prompt file: several worktrees run reviews at once and a bare process count is somebody else's.
  Relaunch once; a second death is the box, not the run.
- **The Bash tool's own two-minute default kills a review mid-run.** Give the call an explicit
  timeout well above `--timeout-minutes`, or run it detached with `scripts/tmux-job.ts`.
```

Why here: Gotchas already has the stale-answer bullet, and it currently says the cause is not on
this side. Carries `killed-codex-run-still-writes-its-answer` L1, L2, L3, L5;
`codex-cli-404s-on-this-box` L3.

### DP10 — `docs/project/overseer-queue.md`, after the paragraph DE1 adds

**Before:** new, after the last line of DE1's text (`to hold a fact recorded earlier.`).

**After:**

```
So before a sweep investigates a standing question, read the entry that owns it whole with
`npx tsx scripts/overseer-queue.ts show <id>`, history timestamps included. If a sibling has
already measured and nothing has changed since, say so in the debrief and append nothing: another
"measured again, same" section is noise in a record Greg still has to read.
```

Why here: the queue doc owns how its entries are read and written, and this is a required step
rather than a description. Carries `a-sibling-sweep-may-have-already-measured` L3.

### RP1 — `docs/project/linting.md` § The trap if anyone turns it on

Added after GPT Sol's review (RR-2). Written by the orchestrator from the memory file.

**Before:**

```
There is no undo: the recovery is `git show HEAD:<file> >` the file and re-apply your own change by
hand, which is only possible because the other 197 lines were committed. Wrap by hand instead.
```

**After:**

```
There is no undo: the recovery is `git show HEAD:<file> >` the file and re-apply your own change by
hand, which is only possible because the other 197 lines were committed. Look at
`git diff --word-diff` first and confirm the only content changes in the file are yours: a peer's
uncommitted edit in it would be overwritten too. Wrap by hand instead.
```

Why here: it is the recovery recipe, and it overwrites a file in a shared tree. Carries
`biome-formatter-is-off-on-purpose` L2's precondition.

### RP2 — `docs/project/hetzner-remote-server-box.md` § Traps, the `gh` bullet

Added after review (RR-3).

**Before:**

```
  `origin` work, so the gap is only the GitHub API: the default branch, pull requests, repository
  settings, Actions.
```

**After:**

```
  `origin` work, so the gap is only the GitHub API: the default branch, pull requests, repository
  settings, Actions. Run `gh auth status` before promising a step that needs the API, not after
  doing everything around it. Then do every part that does not need it, and tell Greg which one
  piece is his; he can run `gh auth login` in the session if he would rather it were done there.
```

Why here: beside the fact it acts on. Carries `no-github-cli-credential-on-this-box` L1's
"how to apply".

### RP3 — `docs/project/hetzner-remote-server-box.md` § Traps, the `npm run` bullet

Added after review (RR-4).

**Before:**

```
    has the story, and it is why that script has no default mode.
```

**After:**

```
    has the story, and it is why that script has no default mode. Never find out how a script
    handles its arguments by passing a word that does something: use `--help`, a nonsense word, or
    read the script.
```

Why here: beside the incident. Carries `npm-run-forwards-a-bare-argument`'s "how to apply".

### RP4 — `docs/project/vercel-hosting-deployment.md` § Searching the logs

Added after review (RR-5).

**Before:** new, at the end of the bullet that ends

```
    answer and not a lost login. The Supabase MCP was refused the same way on 2026-09-19.
```

**After:**

```
    So do not plan an unattended job around reading production logs without first making the call
    from such a session. What would change it is not code or a credential but an allow-list entry
    for those two read-only tools, which is Greg's to add.
```

Why here: beside the measurement. Carries `no-vercel-credential-on-this-machine` L6's instruction
and remedy. The memory ties the remedy to queue item `qi-hpyc3az9`, which is still open.

### RP5 — `docs/project/feedback-reports.md` § Where the queue lives

Added after review (RR-6). **No exact text is proposed**, because the memory's recipe was for a
Sentry search and the sweep now reads `scripts/feedback-unswept.ts`. The lesson to carry: an empty
result has two checks, not one. The first is a control that would come back non-empty if the query
works (already in `silent-success.md` § The habit). The second is the window: a report that aged out
of it unresolved is also absent, and the script's default is 30 days, so an empty sweep should be
re-run once with a wider `--since` before it is reported as "nothing waiting". Whoever takes this
should read the script's options and write the sentence against them.

### RP6 — `docs/reusable/engineering-manager.md` § Stages

Added after review (RR-7).

**Before:** new, after the paragraph that ends

```
[git-commit-changes.md](git-commit-changes.md).
```

**After:**

```

**Before starting a slice a plan doc has queued for anyone, say so.** A queue that several sessions
read is an invitation to all of them at once: on 2026-09-07 two sessions built the same slice from
the same plan eleven minutes apart, and the merge kept both. Send one message to the live peers
asking whether anyone is on it, and write *"Claimed, <date>, by <session>"* into the plan. When a
peer asks you first, answer on timing, not ownership: a slice you reserved and are not working on
is worth less than the same work done tonight by someone who is awake.
```

Why here: the Overseer's dispatch rules cover sessions it starts; this is for an agent picking up
work itself. The Overseer's notes record that Greg, asked on 2026-09-07 whether to build tooling
for this, said to just tell him and build nothing; that is a paraphrase, not a quote. Carries
`announce-before-taking-a-queued-slice` L1 and L3.
