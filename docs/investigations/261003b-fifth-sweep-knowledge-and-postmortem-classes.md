# Knowledge that has not reached its owner, and the postmortem classes: fifth sweep investigation

This is one of the fifth codebase sweep's depth investigations, under
[the umbrella plan](../plans/261003f-fifth-codebase-sweep-umbrella.md). It covers three questions.
Which decisions and contracts live only in a commit message? Which agent-memory traps belong in a
project doc? And, for the postmortem classes since 2026-09-08, has the fix that works by
construction been built, and what is the cheapest mechanical defence that would have caught two or
more of their members? It also checks two "must stay in sync" comments named in the brief. Read
only; dev at `59bd41171`, 2026-10-03.

## Scope, method, and what the method cannot see

**Looked at:**

- **Commits.** All 108 commits in the nominator's `b_long.txt`: non-merge, since 2026-09-08, body
  over 15 lines, touching nothing under `docs/`. Every body was read in full by an Opus subagent,
  and I spot-checked its claims.
- **Agent memory.** All 77 files in `~/.claude/projects/-home-greg-code-spideryarn2/memory/`, every
  body read by a second Opus subagent.
- **Postmortems.** Every postmortem in the seven classes the nominator listed, which is the 64 dated
  260908 or later. I read the "What would have caught it" and "The fix that is right for the long
  term" sections of each, and all of 260910a.
- **Censuses**, each with the command that produced it:
  - every synchronous `child_process` call in `src tools scripts evals`;
  - the import closures of `tools/fleet/server.ts`, `tools/overseer/daemon.ts` and
    `scripts/overseer.ts`;
  - fixed sleeps in `tests/`;
  - `parseJsonAnswer` importers;
  - `useExhaustiveDependencies` findings;
  - the "must agree / in sync with" comments.

**The rule for a doc gap.** A finding counts as a doc gap only if both of these hold:

- the identifiers the commit or memory names (function, field and file names, not my paraphrase)
  do not appear in the owning doc;
- the section where the fact would live was read and does not hold it.

Source headers at the enforcing site were checked too. When the decision is written there, that is
the right home: at most it is a signpost gap.

**Skipped:**

- Commits with short bodies, and commits that touched `docs/`. A decision recorded in a doc is out
  of scope even if it sits in the wrong doc.
- Class A's 13 members, read only as far as their defence sections.
- The source "admissions" in B-knowledge § 2, apart from the two pairs in the brief. They belong to
  the zone investigators.
- `scripts/check-cloud-init.ts` was read only far enough to judge the risk (see Rejected).

**What this method cannot see:**

- Knowledge that lives only in a conversation or in Greg's head.
- Commits with short bodies that still carry a decision.
- Whether a doc that *has* the fact is the one a reader would actually open. That is a
  findability question, and the DOC sweep (261001i) measured it with probes. This sweep did not.

**Earlier nominations that turned out false.** Of the nominator's 12 commit nominations, **9 were
already documented** or decided in the header of the enforcing file. Of its memory classifications,
5 were already in docs. That is the same ratio the brief warned about: a grep of your own phrasing
is not proof of absence.

## Part 1. Commit bodies with no doc

### The nominator's twelve, re-verified

| sha | verdict | where it already is |
|---|---|---|
| fa9d3cc2 | drop | `overseer.md` lines 85-88 have the slash-command refusal. The absent-speaker default is argued in the header above `parseSpeaker` in `tools/fleet/routes-steer.ts`. |
| efce13c3 | drop (source home) | `tools/fleet/wire.ts` lines 65-87: why the third `dashboard` speaker exists. |
| 1534a908, 7b13bd7a | drop | `fleet-dashboard-modes.md` lines 181-221: "types only, no imports", why, and the `Omit<>` rule. |
| f16e3ec0 | drop | `overseer.md` lines 229-235, gate 3, under the renamed `JobBehaviour` / `ScheduleConfig`. The earlier grep for `JobDefinition` missed it because of the rename. |
| 5c8e4213 | drop | `citations.md` lines 222-235: "draws nothing, not the whole block", the multiplicity rule, the channel. |
| bbe36005 | drop | `fleet-recent-messages.md` line 209. |
| 87002cb7, b2029e4d | drop | `testing.md` § A test that spawns a process needs its own timeout (around line 788), which links 260910a; and the `tools/fleet/child.ts` header. |
| aade22b0, 91ce727c, 620411c9 | drop (source home) | Headers of `tools/fleet/pause.ts`, `PauseLine.tsx` and `AttentionPanel.tsx`. A signpost gap remains (K9). |
| 100c0f03 | **keep** | K4 |
| a07b9528 | **keep** | K5 |
| 41cf5897 | **keep** | K6 |

### Findings: decisions and contracts held only in commits (all T1, effort S, none in a rule doc unless marked)

- **K1. The `overseer-direction.md` paragraph about several Claude accounts is false now.**
  - **Commits:** 9b76bc4f, cdc3cd1a, aebdb320, caf42a29.
  - **The paragraph:** `overseer-direction.md` § Usage limits, "Can we call an API instead?" (the
    "Multiple accounts on one box is mechanically possible" paragraph). It says running two
    accounts concurrently *"has **not** been tested … not a reason to build one now"*. **I checked
    the text myself.**
  - **What shipped on 2026-09-10:**
    - an account registry, `scripts/claude-accounts.ts`;
    - `new-claude --account auto` as the default;
    - a refusal to route the ambient account, because `~/.claude.json` sits beside the default
      config dir;
    - shared `sessions/`.
  - **Since 2026-09-30** no pool account is registered (`overseer.md` lines 342-345).
  - **Owner:** that paragraph. `hetzner-remote-server-box.md` § Starting a session never mentions
    `--account`.
  - **Proof the docs lack it:** `account auto` appears 0 times in docs/project; `claude-accounts`
    and `registry.json` appear once each, both in the removal note.
  - **Partial home:** plan 260909g.
  - **Fix:** replace the paragraph: built, dormant since 09-30, and a link to 260909g. **Value:
    medium. It is the most misleading item found**, because it tells a future agent that something
    which exists was never built.
- **K2. `ai-gateway.md` says `UNMETERED_SPEND` has "Two entries"; the register has five.**
  - **Commits:** 641ec7d9, fff7d148.
  - **The register,** `src/spend-declarations.ts` from line 522, has five entries: the live evals,
    `run-codex`, `run-claude`, `attention-classify` and `describe`. I checked the doc's sentence.
  - **The unwritten decision:** the fleet's own model calls are unmetered rather than declared. The
    tools tree may not import `src/` (Greg, 2026-09-09), and `AiJob` is closed to jobs the app
    pays for, so declaring them would push them into `AI_JOB_WIRE`.
  - **Proof the docs lack it:** `run-claude.ts`, `attention-classify` and `describe.ts` each appear
    0 times in docs/project.
  - **Fix:** one line in `ai-gateway.md` § The three calls allowed round the outside, pointing at
    the register rather than counting its entries. **A count in prose is the thing that went stale.**
- **K3. `dictation.md` § One code, one sentence says the code test reads only `src/`.**
  - **Commit:** bb76c171.
  - **Wrong since:** `tests/dictation-codes.test.ts` line 51 now scans both `src/` and `tools/`.
  - **Also missing:** `[mic-bad-request]` is not in the code table (0 hits in docs/).
  - **Fix:** one line, plus one table row.
- **K4. The second import boundary is undocumented.** `tools/fleet` may reach only a named set of
  `tools/overseer/*` modules, never `store.ts`.
  - **Commits:** 100c0f03, 4620b393.
  - **The check:** a transitive closure, compared by set equality against
    `OVERSEER_MODULES_FLEET_MAY_IMPORT_WHY` in `tests/fleet-attention.test.ts`. It has ten entries,
    each with its reason.
  - **The gap:** `fleet-dashboard-modes.md` § "Ask this before you design the panel" documents only
    the tools-to-src boundary. The constant appears 0 times in docs/project.
  - **Fix:** one paragraph there: where the second boundary lives, that it is set equality, and
    "add an entry with its reason, and read its closure first".
- **K5. Fable's rule for the dashboard has no doc.** "A caveat stays on screen only if it changes
  what you do in the next ten seconds; otherwise one tap away, on the number it qualifies. A caveat
  true of a whole class of cards is stated once above the list."
  - **Commits:** a07b9528, 3400352d, 2bfe48dc.
  - **The gap:** `fleet-dashboard-modes.md` § Absence is stated, never drawn says *what* to state,
    not *where it may sit*. The two rules pull against each other with nothing to arbitrate.
  - **Fix:** one paragraph.
- **K6. A control on a fleet card gets no pointer input unless it is lifted.** A session card is a
  stretched link (`.session-open::after { inset: 0 }`), so a control on it receives no clicks or
  taps unless it has `position: relative; z-index: 1`.
  - **Commit:** 41cf5897.
  - **Why tests miss it:** keyboard focus still works, so jsdom passes. Only `elementFromPoint` in
    a real browser shows it.
  - **The gap:** `fleet-dashboard-modes.md` § Seeing it. `stretched link` and `session-open` each
    appear 0 times in docs/project.
  - **Fix:** one checklist bullet.
- **K7. Fleet dictation on a phone needs HTTPS.**
  - **Commit:** b42cf448.
  - **Why:** over the plain-HTTP tailnet address the page is not a secure context, so
    `navigator.mediaDevices` is undefined. The fix is `tailscale serve`, not repo code.
  - **The gap:** `hetzner-remote-server-box.md` § After `tailscale up` tells you to bind that
    address and never says the phone then loses the mic. `tailscale serve` appears 0 times there.
  - **Fix:** one line.
- **K8. The Decisions and Queued-ideas routes are read-only as a security decision.** The dashboard
  has no login, so a write route would let anything that can reach the port record a review in
  Greg's name.
  - **Commits:** fe2dfa91, 0f59d1d2.
  - **Enforced by:** `/api/queue` refuses POST, giving that reason, and a test pins the refusal.
  - **The gap:** `overseer-queue.md` lines 20-21 say "read-only" and not why.
  - **Fix:** one line in `fleet-dashboard-modes.md`'s registrations row "a write".
    **Alternatively** in `security-map.md` § The fleet dashboard. That is an entry point, so it
    **needs Greg's approval**.
- **K9. Signposts only.** In both cases the decision is fully argued in source or in plans, and no
  project doc points at it.
  - **The pause line.** `PauseLine`, `readPauses` and `pause.ts` each appear 0 times in
    docs/project. Add a line to `overseer-direction.md` § `idle` is the bug.
  - **Scheduled dispatch and the launch protocol** (260910f; "a spawn is never a completion"). Add
    a line to `overseer.md` § The standing jobs.
- **K10. A stale source comment.** `tools/overseer/decisions.ts` around line 1271 (the
  "DELIBERATE DEPARTURE FROM idea-queue.ts" block) says the queue still compares against a baseline
  that counts unreadable lines. `idea-queue.ts` around line 1629 now folds the same prefix on both
  sides ("Compare like with like"). **Read both; proved from the code.** **Fix:** delete the
  departure framing from the comment. Effort S.
- **Weak lead, not a finding.** 47cd7a9d: a `<label>` wrapping a tooltip trigger takes the control's
  name. It is guarded only for the fleet (`tests/fleet-tooltip-copy.test.ts`). Product panels use
  both `<label>` and tooltips, and `tooltips.md` never mentions it. **Hypothesis**: worth one grep
  by whoever owns tooltips.

**Where the rest went.** The other ~90 commits each keep their decision in the header of the file
that enforces it, or in a plan or postmortem the project docs already link to. Readiness and usage
history are good examples: `readiness.md` and `usage-history.md` carry their rules. The pattern is
healthy. Decisions sit beside the code. What is missing is mostly **a pointer from the area doc**,
not the decision itself.

## Part 2. Agent memory (77 files)

**Counts:**

| Class | Count |
|---|---|
| Already in an owner doc | 30 |
| Partly there | 16 |
| Belongs in a doc and absent (6 of them low value) | 18 |
| Stale as the primary class | 6 |
| Should stay in memory | 7 |

The full table, one line per file with the owner section and the evidence, is in the sweep
scratchpad (`K2-memory-result.md`). It is summarised here rather than copied, because the memory
folder is outside the repo.

### Should move, ranked

Docs marked (R) are in `docs/reusable/` and **need Greg's approval** per
[edit-important-docs.md](../reusable/edit-important-docs.md).

- **M1. `codex-cli-as-subagent.md` § Gotchas (R).** Two memories belong here:
  - `killed-codex-run-still-writes-its-answer`: a grandchild survives the kill and later writes to
    a reused `--output`;
  - `a-codex-self-review-looks-like-an-independent-one`: a write-capable run that cannot spawn
    reviews itself.

  Both get past the "exit code *and* answer file" check that CLAUDE.md treats as enough. The doc's
  "stale-looking answers … likely upstream" bullet is probably the first of these, misattributed.
  **Value: high.**
- **M2. `engineering-manager.md` § Delegate (R).** Three memories, and none of the three is in the
  doc:
  - `an-unchecked-brief-claim-becomes-a-source-comment`: end every brief with "say which of my
    claims turned out false";
  - `name-the-fallback-before-the-reviewer-does`;
  - `subagents-end-turns-while-their-jobs-run`.
- **M3. `version-control.md` (not a rule doc).** Two memories:
  - `pull-latest-on-waking-up`: Greg's 09-06 instruction, with his quote;
  - `a-refused-merge-can-wipe-uncommitted-edits`: "strategy ort failed" left tracked edits at HEAD,
    so commit before merging, and recover from the dangling WIP commit.

  Neither `WIP on` nor `strategy ort` appears in the doc.
- **M4. `overseer.md` § The tick (not a rule doc).** Greg's 2026-10-01 rule, "run to 100% weekly
  usage", is absent from the runbook the Overseer reads. The memory records that the Overseer broke
  the rule on 10-03. **Value: high**, because the reader of that doc is the one that broke it.
- **M5. `SUPABASE_ACCESS_TOKEN` needs Greg's yes each time.** This is a standing permission rule for
  every agent, held in one agent's memory. **Owner:** `hetzner-remote-server-box.md`, where the
  token's placement is already recorded; or `security-map.md`, an entry point, which **needs
  approval**.
- **M6. `long-waits.md` (R).** Its "pair CronCreate with a Monitor" advice is contradicted by the
  memory's measurement: under memory pressure, waiters die, so arm two CronCreate one-shots instead.
  `polling-a-log-burns-turns-not-time` and `grep-c-fallback-fires-immediately` belong beside it.
- **M7. `testing.md` (not a rule doc).** `writing-escapes-produces-raw-bytes`: the guard
  `tests/no-raw-nul-bytes.test.ts` exists, but no doc names it, or the signature (every grep returns
  nothing while `sed` shows the text).
- **M8. `silent-success.md` or `written-down-is-not-checked.md` (R).** Four memories, one new
  species each: `a-survey-cannot-see-an-absent-state`, `a-comment-is-not-a-traced-equality` (merge
  `a-header-comment-is-not-a-traced-check` into it) and `two-joins-that-disagree-are-a-measurement`.
  **Value: medium.** These are habits, and the family already has a home.

**Stay in memory (7):**

- `box-traps-moved-to-docs`, which is itself the pointer;
- `no-github-cli-credential`, re-verified today;
- `greg-allows-overseer-to-kill-finished-sessions`, a permission granted to one role (it could
  arguably go to `overseer.md` gate 3);
- four about harness or personal behaviour: `scratchpad-scripts-cannot-import-repo-deps`,
  `taskoutput-…`, `wait-for-real-notifications` and `write-tool-refuses-paths-outside-the-repo`.

**Stale, for the memory's owner rather than for a sweep.** The third sweep already decided that
deleting memory files is not an agent's call.

- `no-vercel-credential-on-this-machine`: the CLI has been logged in on the box since 09-29.
- `public-read-audit-plan-not-built`: Cluster D, `GET /api/public/asset`, has shipped.
- `peer-discovery-is-per-config-directory` and `pool-account-sessions-have-no-sentry`: there has
  been no pool login since 09-30.
- `codex-cli-404s-on-this-box`: recommends a Fable stand-in, which is now forbidden.
- `postgres-suites-fail-from-contention`: "re-run each alone" contradicts `testing.md` § POLLUTED,
  "never work around it by re-running".
- `MEMORY.md`: three index lines are now wrong.

### Two contradictions between docs, found on the way

- **K11. `feedback-reports.md` contradicts `overseer.md` on who deploys.** `feedback-reports.md`
  around line 386 says *"The loop never deploys. Production is `npm run deploy`, and it stays
  Greg's."* `overseer.md` § Deploying gives deploys to the Overseer (Greg, 2026-09-29). **Read both;
  proved.** **Fix:** one line in feedback-reports.md, pointing at overseer.md § Deploying. T1, S.
  **Value: medium**: a feedback session reading it will either ask Greg needlessly or wait.
- **Heading anchors.** `testing.md` § Why the docs have a test says to write an em-dash anchor with
  one hyphen. The `em-dash-heading-anchor-fails-both-ways` memory says to drop the fragment. Pick
  one and fold it into testing.md. T1, S.

## Part 3. The postmortem classes as a lens

The seven families are B-knowledge's grouping, over the 64 postmortems dated 260908 or later. For
each: is the fix that works by construction built, and what is the cheapest mechanical defence that
would have caught **two or more** members?

### Class G: a timeout that does not converge

**This class is mixed.** Only 260910a and its predecessor 260906e are about a synchronous child. The
other members are different shapes:

- 260909a, a recovery loop keyed to a transition;
- 260912a, a polling budget;
- 260915b, a client state machine;
- 260930b, a stale "not designed" comment, which is not G at all.

The synchronous-child subclass has **three sightings by its own count** (`e8f00815`, `8f7de0fc`,
260910a), and two more commits (`7166b92d`, `77d01268`) wrote new timed sync calls after the
lesson was first written down.

**The census.** There are **44** synchronous calls with a timeout:

```
grep -rn -E "\b(execFileSync|spawnSync|execSync)\(" --include=*.ts tools src scripts evals   # 130 sync calls
```

Then I kept those with `timeout` within the next ten lines. **18 are in `tools/`.** That confirms
B's count, and I read all 18: every one is real. The rest are in scripts.

**Exposure, from the import closure of each entry point plus the call path** (closure script in the
sweep scratchpad, `k3/closure.mjs`):

| Where it blocks | Sites |
|---|---|
| **Dashboard request path** (`server.ts`) | `health.ts` `run()` (5 s × 6, via `routes-new.ts` `healthLevel: () => collectHealth(…)` on every new session); `steer.ts` `realIo().run` and `pane.ts` `capturePane` (10 s, every send, and the drain loop); `routes-actions.ts` two `ps` (10 s each); `routes-rename.ts` two `tmux` |
| **Dashboard timer, same thread** | `readiness-wiring.ts` `liveSessionNames`; `readiness-git.ts` two `spawnSync git` |
| **Overseer daemon loop** | `work-probe.ts` `ps` (every tick); `usage.ts` `claude auth status` (20 s); `attention-probe.ts` two `tmux` (wired through `attentionRunner` in `scripts/overseer.ts` `run`) |
| **Startup only, so negligible** | `revision.ts` `defaultRun` |
| **CLI only** | `diagnose.ts`, `report-artefacts.ts`, `launchers.ts`, `scripts/overseer.ts` `tmuxSessionName` |

**The by-construction fix, `runOwned`** (`tools/fleet/child.ts` `probeOwner`), is built and used by
collection, health-async and the pane pass. **Every row of 260910a's "Other members, not fixed"
table is still the old shape.**

- **G1. A test that a long-running process cannot reach a synchronous child API.** This is 260910a's
  own item 2, and it is **not built**: no test mentions `spawnSync`/`execFileSync` as an import
  guard, and there is no `noRestrictedImports` in `biome.jsonc`.
  - **How:** walk the import graph from `tools/fleet/server.ts` and `tools/overseer/daemon.ts`, the
    way `tests/fleet-imports.test.ts` already walks it. Fail on any value import of
    `execFileSync | spawnSync | execSync`, except an allowlist that may only shrink. On day one the
    allowlist holds the 13 exposed sites above.
  - **What it catches:** `7166b92d` and `77d01268` would both have gone red.
  - **Score:** T1, effort S-M, value medium, risk low. Middle tier by CLAUDE.md's three standards.
  - **Files:** one new test file, plus possibly a shared walker helper extracted from
    `tests/fleet-imports.test.ts`.
  - **Worth its keep:** yes. It is the only defence that is aimed at the class rather than an
    instance, and the walker exists.
- **G2. `work-probe.ts` never reaches its own clock-quoting branch.** The signal branch,
  `"killed by … after N ms (timeout is …)"`, cannot be reached on a timeout, because `spawnSync` sets
  `error` as well as `signal`, and `run.error` is checked first.
  - **Where:** `tools/overseer/work-probe.ts`, the `if (run.error !== undefined)` line just before
    the `run.signal` branch.
  - **Evidence:** proved from the code, plus 260910a's measurement
    `{"errorCode":"ETIMEDOUT","signal":"SIGTERM"}`.
  - **Score:** T1, effort S. Reorder the two checks, and add a test with a TERM-ignoring child, using
    `tests/fleet-child.test.ts` as the template. Value low to medium: it turns a silent wedge into a
    message with the clock in it.

### Class E: a test depends on state it does not own

| Member | Built | Mechanical guard |
|---|---|---|
| 260908e, a fixture that means "now" | yes | a guard for that instance |
| 260910d, a whole-environment assertion that printed secrets | **yes, by construction** | `tests/test-workers-hold-no-secrets.test.ts` |
| 260930a, a fixed window | the `until`/`tickAfter` helpers (`tests/helpers/overseer-until.ts`) | used by 5 files |
| 261001c, the live-repo default | the instance is fixed | habit only |
| 261002a, a gitignored corpus | the instance is fixed, and the tree was swept once by hand | habit only |
| 260910d, the literal `new URL(…, import.meta.url)` | — | its item 2, a static guard, is **not built** |

`testing.md` § Mocks and fixtures that manufacture green lists 260908e, 260930a and 260910d as
one-liners. **It lacks 261001c and 261002a**: neither id, nor `changelog-pending` / `pending-file`,
appears in testing.md.

- **E1. A static guard against a literal `new URL("…", import.meta.url)` outside browser code.**
  There are **4 live sites**:

  ```
  grep -rnE 'new URL\("[^"]+", import\.meta\.url\)' src scripts tools --include=*.ts | grep -v "src/web/\|tools/fleet/web/"   # 6, 2 in a comment
  ```

  The four are `tools/overseer/attention-eval.ts:169`, `tools/overseer/diagnose.ts:908`,
  `scripts/bench-cold-start.ts:74` and `scripts/overseer.ts:134`.
  - **Exposure:** each is wrong only if a jsdom test loads the module, and today none does. So the
    exposure is a hypothesis.
  - **Score:** T1, effort S (a grep-test like `doc-links`), value low to medium. Cheap, and it turns
    the next one into a red test that says why.
- **E2. Two one-liners in `testing.md` § Mocks and fixtures:** "a CLI default that reads the live
  checkout" (261001c) and "a test that reads a gitignored file" (261002a). T1, S. Not a rule doc.
- **E3. A tracked-paths test: every path literal that a test reads resolves to a `git ls-files`
  path.** It is what 261002a's sweep did by hand. It would catch 261002a. It would **not** catch
  261001c, whose file is tracked and merely at its default. So it catches one member: **T2**, effort
  M, because assembled paths (`path.join`, `new URL`) need care. Its value is the next one, not the
  last one. Hold until a second member appears.

### Class F: the model-output contract

**The fix that works by construction is built.** Structured outputs go through one validator,
`src/messages-structured-output.ts`, covered by `tests/messages-structured-output.test.ts`.
`prompting-guide.md` § What the model writes back states the rule: *"every exception is named"*.

**But the exceptions are named only in a plan** (`261001s` Stage 3a, and its Sol survey). No test
holds the list.

```
grep -rl "parseJsonAnswer" src --include=*.ts | grep -v src/parse-json.ts                    # 21 importers
… | xargs grep -L "withMessagesJsonSchema\|withChatJsonSchema\|messages-structured-output\|OUTPUT_FORMAT\|output_config"
# -> src/citation-find.ts, src/json-repair-log.ts, src/search.ts
```

- **F1. A census test for structured output.** Every `parseJsonAnswer` importer either uses the
  adapter or appears in a `Record<file, reason>` of named exceptions. Today that record would hold
  three entries: `citation-find` (web search on the same call), `search` (items stream) and
  `json-repair-log` (not a call).
  - **What it catches:** the next 261002b-shaped stage, because a new JSON stage without a schema
    would go red. 261002e (a strict schema admitting shapes its parser discards) is downstream of
    the adapter and not caught.
  - **Score:** T1, effort S, value medium. It moves "every exception is named" from prose into a
    check. That is the [written-down-is-not-checked](../reusable/written-down-is-not-checked.md)
    case exactly.
  - **The census is coarse.** It misses calls that parse with plain `JSON.parse`. The referee runs
    and `labels.ts` turned up in a looser grep. The test's header should say so, rather than claim
    completeness.

### Class D: React state or an event judged at the wrong moment

Each member is fixed with an instance test. The tests are good and red-first: two deliveries in one
`act`, a held request, a click landing elsewhere later.

- **No shared mechanical defence** covers two members. They differ in mechanism: batching, a
  mutable hook, per-frame notification, gesture events, derived identity.
- **One cheap defence hits a neighbour.** Biome's `useExhaustiveDependencies` named 260916a's exact
  missing dependency (class B), and was not read, because lint is advice here. I ran it today:

  ```
  npx biome lint --only=correctness/useExhaustiveDependencies src/web tools/fleet/web   # 13 errors, 548 files, 208 ms
  ```

  - **Three "missing dependency":** `ChangelogPage.tsx` line 731 (`setReleaseOpen`, which wraps a
    functional `setOpen`, so it is harmless) and `reader/measure.ts` lines 50 and 160 (`measure`, a
    pure closure, also harmless).
  - **Ten "more than necessary":** these are deliberate re-run triggers, the `layoutKey` pattern
    `linting.md` § What the first run found already explains.
- **D1. Make this one rule a gate.** Suppress the 13, each with its reason, then add a test that
  runs Biome with `--only=correctness/useExhaustiveDependencies` and expects zero.
  - **Score:** T1, effort S (13 one-line suppressions and one test), value medium.
  - **What it catches:** 260916a. It would **not** have caught 261002c, whose hook never read the
    snapshot, so in this window it catches one member. It is worth it anyway, because the class it
    guards (a memo or effect key written by hand) is common in a 548-file client, and the baseline
    for this rule is small enough to be zero.
  - **Prior sweeps:** none proposed this. The only mention, in `linting.md`, is about the `FIXABLE`
    trap.

### Class C: layout read at the wrong time or from the wrong number

**Built:**

- `layoutViewportWidth()` and `pageWidth()` in `measure.ts`;
- `tests/layout-viewport-width.test.tsx`, an allowlist with a count and a reason for each raw
  `innerWidth`;
- the shared `scroll.ts`;
- the Playwright snippet now carries `ignoreDefaultArgs: ["--hide-scrollbars"]`
  (`browser-testing-playwright.md` line 30). That was 261002a's item 1, "not yet done" when it was
  written.

**B's "58 hits of 100vw/innerWidth" is not a finding.** The 18 `innerWidth` reads are under the
allowlist. The 40 `100vw` hits are comments, or `min(…, calc(100vw - X))` clamps:

```
grep -rnE "^\s*(width|min-width|inline-size)\s*:[^;]*100vw" src/web   # 5, all min()
```

None is a bare `width: 100vw`. Nothing to do.

### Class B: the rule is right and the line beneath disagrees

The defences on record are habits ("when a comment's subject is plural, grep"). The mechanical part
is the **two-copy pairs**: a comment that says two places must agree.

```
grep -rnIiE "must (stay in sync|match|agree|mirror)|kept in sync|in sync with|is a mirror of|mirrors (src|tools|scripts)/" src tools scripts   # 65
```

Most of those 65 are invariants, not copies. **The real two-copy pairs I could identify:**

| Status | Pairs |
|---|---|
| Enforced | `hit-colours.ts` `CATEGORICAL_SLOTS` (by `tests/hit-colours.test.ts`); `artifact-storage.ts` `STORAGE` (by `store-artefacts-pg`); `admin.ts` (by `admin-spend-column`); `dictation-limits.ts` (one home by design); `useSlow.ts` (one constant now) |
| Unenforced and drifted | `src/types.ts:12` (K12) |
| Unenforced, low risk | `migration-digest` vs `drizzle.config.ts` (K13); `httpError` "Mirrors src/routes.ts" (prior sweeps left it until one drifts; out of scope here) |

- **K12. The `TreeNode` copy in the doc has already drifted.** `src/types.ts:12` says
  *"`TreeNode` must stay in sync with docs/project/granularity-zoom.md#node-shape"*.
  - **Nothing enforces it.** No test reads that section; the only `granularity-zoom` test hits are
    `doc-links`.
  - **It has drifted.** `TreeNode` gained `question?: string` on 2026-09-05 (`0621fd6ca`), with a
    long docblock. The doc's `interface Node` block lacks it. **Proved:** I read both.
  - **Cheapest fix:** delete the copy. Replace the field-by-field code block in
    `granularity-zoom.md` § Node shape with a pointer to `src/types.ts` § `TreeNode`. Keep the prose
    about `gist` / `navLabel`, which is the doc's real content. Then delete the sync comment in
    types.ts.
  - **A test that parses the doc's code block** is the second choice: it keeps two copies alive.
  - **Score:** T1, S, value low to medium. Not a rule doc.
- **K13. Nothing checks that `drizzle.config.ts` agrees with the migration constants.**
  `scripts/migration-ledger.ts` (around line 730), `src/migration-digest.ts:159` and
  `scripts/db-migrate.ts:283` all say `drizzle.config.ts` must agree with
  `MIGRATIONS_SCHEMA` / `MIGRATIONS_TABLE`.
  - **What holds today:** `db-migrate.ts` imports the constants, so two of the three copies are
    one. `drizzle.config.ts` hardcodes `"spideryarn_migrations"` / `"__drizzle_migrations"`, and no
    test compares them. `tests/auth-users-fence.test.ts` reads that file for something else.
  - **Exposure:** that block is read only by `drizzle-kit migrate`, which this repo deliberately
    does not run (the `db-migrate.ts` header). So drift bites only someone who runs it by hand.
    **Value: low.**
  - **Fix:** import the two constants into `drizzle.config.ts`, after checking drizzle-kit's loader
    accepts the `.js`-suffixed ESM import. If it does not, add a three-line test that imports the
    config and compares. T1, S.

### Class A: evidence weaker than the claim (13 members)

**The type-level fixes are built where they apply:**

- one declaration per wire shape (`tools/fleet/wire.ts`, `tests/fleet-compile-guards.test.ts`);
- proof on the licensed branch, as a discriminated union (260910b);
- `pdf-record-types-shown.test.ts` typed `Record<RecordType, …>` (261001b).

**The rest are judgement:** a fixture's provenance, a representative sample, a plan versus an
instrument. **No generic mechanical defence is worth its keep.** 260908c already rejected mutation
testing as a gate, with a reason worth keeping. `silent-success.md` is the class's home.
**Nothing to propose.**

## Two ways to do one thing, and drift that was proved

- **A synchronous timed child next to `runOwned`.** 13 exposed sites against 4 converted
  callers. The fix reached the collection path only, and that is G1's subject.
- **A field list in a doc next to the type.** It drifted by one field (K12).
- **Counts in prose next to the register they count.** Two drifted: `UNMETERED_SPEND` "two" against
  five (K2), and dictation's "`src/`" against `src/` and `tools/` (K3).
- **Who deploys.** Two docs give two answers (K11).

## Testability

- **Fixed sleeps in `tests/`:**

  ```
  grep -rnE "new Promise\(\s*\(?(r|res|resolve)\)?\s*=>\s*setTimeout\(\s*(r|res|resolve)\s*,\s*[0-9_]+" tests   # 329, in 177 files
  ```

  89 are 0 ms yields. **116 are 100 ms or more.** The biggest cluster, 37 at 400 ms, is tooltip
  tests waiting out the hover delay (`Tooltip.tsx` `DELAY`). Those are *positive* waits on a timer
  queued earlier, and node fires timers in order of expiry, so they are slow but not flaky under
  load. 260930a's risk is the **negative** window ("nothing happened within X"). Telling the two
  apart takes a per-site read I did not do. **Hypothesis only. No finding.**
- **The sync-child sites cannot be tested at their seam without a real child.** Most take an
  injectable `run`, and `fleet-child.test.ts` is the template. G1 does not need one.

## Product simplifications (PRODUCT)

None in this area. It is about knowledge and checks, not about what a reader sees.

## Considered and rejected

- **B's twelve commit nominations:** 9 dropped, with reasons in the table above.
- **A lint rule (Biome `noRestrictedImports`) instead of G1:** cheaper to write, but lint is advice
  here, not a gate. 260910a reached the same conclusion.
- **Converting all 18 tools/ sync sites to `runOwned` in one sweep:** T2-sized, and each needs its
  own async conversion of its caller (the steer send path above all). G1's shrinking allowlist lets
  that happen one site at a time, so it is not proposed as a sweep item.
- **`check-cloud-init.ts` `TEMPLATE_VARS` against `main.tf`:** drift is loud in both directions.
  An extra variable in the YAML fails the script, and a missing one fails `terraform plan`. Not
  worth a test.
- **The `100vw` sites:** all are clamps, with nothing to fix.
- **A meta-test that every "must agree" comment names its enforcing test:** 65 hits, mostly
  invariants rather than copies. It would be noise, the same verdict the second sweep gave its
  module-scope Map/Set meta-test.
- **Moving Opus-memory knowledge in bulk:** M1-M8 are the ones worth a doc line. The other ~30
  MOVED memories could shrink to pointers, but that is the memory owner's call, not a sweep's
  (third and fourth sweeps).
- **E3, a tracked-paths test:** held, because only one member would have been caught.
- **A gesture-id model for taps (260915a's long-term shape):** the postmortem itself declines it.

## One level up

The repo's approach to knowledge is sound. Decisions go in the header of the file that enforces
them, plans keep the reasoning, and postmortems name the class. Of 108 long commits, only about 9
carried something with no home, and most of those were signpost gaps.

Two weaknesses recur:

- **Counts and copies in prose drift silently.** K2, K3 and K12 are the evidence. The fix is to
  point at the source instead of restating it, which `signposting-and-single-source-of-truth.md`
  already says.
- **A class's mechanical defence is proposed in the postmortem and then not built.** Examples:
  260910a item 2 (G1), 260910d item 2 (E1), and 261002b's "every exception is named" (F1).
  Postmortems end with ranked defences, and nothing tracks whether the cheap one shipped.

A small T2 would close the second weakness. Add a "Status: built / not built (date)" line to each
ranked defence. Or keep a short table in `postmortems.md` of defences proposed and not yet built,
reviewed by the weekly sweep. It is not proposed as a check, which would be the noise rejected
above. It is roughly half a day for the existing 64.

## Ranked top list, in clusters with non-overlapping files

| Rank | Id | Tier | Effort | Value | Files |
|---|---|---|---|---|---|
| 1 | G1 | T1 | S-M | med | new `tests/no-sync-child-in-long-running.test.ts` (reuses the walker in `tests/fleet-imports.test.ts`) |
| 2 | F1 | T1 | S | med | new `tests/json-calls-use-structured-output.test.ts` |
| 3 | K1, K9 | T1 | S | med | `docs/project/overseer-direction.md`, `docs/project/overseer.md`, `docs/project/hetzner-remote-server-box.md` |
| 4 | M4, M5, K11 | T1 | S | med-high | `docs/project/overseer.md` (§ The tick), `docs/project/hetzner-remote-server-box.md`, `docs/project/feedback-reports.md` |
| 5 | D1 | T1 | S | med | the 13 files `useExhaustiveDependencies` names, plus a new test |
| 6 | K4, K5, K6, K8 | T1 | S | med | `docs/project/fleet-dashboard-modes.md` |
| 7 | K12 | T1 | S | low-med | `docs/project/granularity-zoom.md`, `src/types.ts` |
| 8 | K2, K3, K7 | T1 | S | low-med | `docs/project/ai-gateway.md`, `docs/project/dictation.md` (K7 shares hetzner with cluster 3) |
| 9 | E1, E2, M7 | T1 | S | low-med | new grep test; `docs/project/testing.md` |
| 10 | M3 | T1 | S | med | `docs/project/version-control.md` |
| 11 | G2 | T1 | S | low-med | `tools/overseer/work-probe.ts`, a test |
| 12 | K10, K13 | T1 | S | low | `tools/overseer/decisions.ts`; `drizzle.config.ts` |
| — | M1, M2, M6, M8 | T1, **Greg's approval** | S | high (M1, M2) | `docs/reusable/codex-cli-as-subagent.md`, `engineering-manager.md`, `long-waits.md`, `silent-success.md` |
| — | Postmortem defence status | T2 | M | med | `docs/project/postmortems.md` |

**How to run the clusters in parallel:**

- **Cluster A (tests):** G1, F1, E1, G2.
- **Cluster B (client lint):** D1.
- **Cluster C (overseer and box docs):** K1, K7, K9, M4, M5, K11.
- **Cluster D (fleet docs):** K4, K5, K6, K8.
- **Cluster E (product docs):** K2, K3, K12, E2, M7, M3.
- **Cluster F (Greg's approval):** M1, M2, M6, M8. Show before and after, one set at a time.

**Totals by tier:**

- **T0:** 0.
- **T1:** 27 items: K1-K13, M1-M8, G1, G2, F1, D1, E1, E2. Four of them (M1, M2, M6, M8) need
  approval, and so do the alternative homes offered for K8 and M5.
- **T2:** 2: E3, held; and the postmortem defence-status table.
- **T3:** 0.

---

Up: [investigations.md](../project/investigations.md)
