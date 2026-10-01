# Trawl D and E: auto-memory to docs, and paraphrased intent

Read-only trawl for `docs/plans/261001i-docs-and-signposting-sweep.md`, run 2026-10-01.

How it was done. All 102 files in `~/.claude/projects/-home-greg-code-spideryarn2/memory/` were read,
at least the header and first ~20 lines each. A distinctive phrase from each was grepped across
`docs/project/`, `docs/reusable/` and `CLAUDE.md`, and every "covered" verdict below has a doc line
behind it. Absence was checked by grep alone, so a NOT COVERED can be wrong where the doc uses
different words; the ones marked *(check)* are the least certain.

Classes: **a** = project knowledge every agent needs · **b** = machine-local or box state ·
**c** = a personal or feedback preference, or general epistemics with no single owning doc ·
**d** = stale or obsolete.
Approval: **PROPOSAL** = the owner is a rule doc (CLAUDE.md/AGENTS.md, the seven entry points,
`docs/reusable/*`, `version-control.md`, `code-quality-overview.md`), so it needs Greg's approval ·
**DIRECT** = any other doc.

## D1. Already in the docs: the memory can be deleted or cut to a pointer (32)

| memory | owner, and the line that already says it |
|---|---|
| `a-named-worktree-may-hold-a-dead-sessions-work` | `worktrees.md:84-86` "A named worktree that already exists is *resumed*, not recreated." |
| `a-port-you-bound-may-be-a-strangers-now` | `worktrees.md:822` "`ss -ltnp \| grep 527` names the owning pid … *is this my tree*"; `reusable/diagnose-box-resources.md:75` |
| `api-build-refuses-stale-client-shell` | `deployment.md:455` "Which is why `npm run build:api` alone refuses after a commit." |
| `biome-formatter-is-off-on-purpose` | `linting.md:173` "### Why the formatter is still off" |
| `browser-subagents-kill-shared-dev-servers` | `browser-testing.md:54` "**Never `pkill -f vite`**" |
| `check-git-log-before-building-a-feedback-fix` | `feedback-reports.md:342` "`git log`, `gjd-remote ls` … open what matches rather than trusting" |
| `classifier-accepts-fleet-restart-script` | `overseer.md:485-488` "`npx tsx scripts/fleet-restart.ts restart` is how … `sudo systemctl restart` is still refused" |
| `codex-cli-404s-on-this-box` | `reusable/codex-cli-as-subagent.md:125` "**Assume intermittent, not down.**" |
| `codex-usage-limits-are-free-to-read` | `usage-history.md:85` "The Codex card uses `account/rateLimits/read` from the Codex app-server." |
| `copying-a-fixture-uuid-reds-the-suite` | `testing.md:1410-1415` (`fixture-ids.test.ts`, "a fresh random id, not an exemption") |
| `em-dash-heading-anchor-fails-both-ways` | `testing.md:503`; `version-control.md:543` |
| `eval-corpus-in-a-worktree-is-the-fixture-cut` | `testing.md:716` "### An eval run in a worktree measures the fixture cut, not the corpus" |
| `exitworktree-counts-against-local-dev` | `worktrees.md:524-528` "Worktree has N commits … this count is the wrong question" |
| `fresh-worktree-reds-two-bundle-tests` | `worktrees.md:196-202` (`api-dist/`, `build:fleet`) |
| `full-suite-needs-tmux-on-this-box` | `testing.md:809-814` "judge it by the suite's own `Test Files` line … **Use `scripts/tmux-job.ts`**" |
| `gjd-remote-runs-from-the-box-with-one-var` | `hetzner-remote-server-box.md:49-54` (`/etc/gjd-remote-host`) |
| `gregs-answer-is-often-a-fifth-option` | `overseer-direction.md:217,1096` "his answer to those is often a fifth option nobody offered" |
| `long-waits-need-a-persistent-monitor` | `reusable/long-waits.md:21-38` (the table) |
| `merge-can-duplicate-what-it-does-not-conflict-on` | `reusable/git-resolve-merge-conflicts.md` (the memory itself says it is there) |
| `no-github-cli-credential-on-this-box` | `worktrees.md:924` "authenticated `gh` (`gh auth status`: *"You are not logged into any GitHub hosts"*)" |
| `no-production-db-access-from-this-laptop` | `database.md:555-560` (`.env.prod`, port 6543, "`begin read only; …`"); `overseer.md:499`. The memory's *name* is now false. |
| `npm-run-check-runs-the-full-suite` | `static-analysis.md:16-17` "**29 minutes** — 861 test files" |
| `parallel-subagents-share-one-scratchpad` | `reusable/engineering-manager.md:138` "**Parallel subagents share one scratchpad.**" |
| `plan-name-collides-between-agents` | `reusable/write-planning-doc.md` "Don't worry if this happens" |
| `postgres-suites-fail-from-contention` | `testing.md:46` "seven failures of which six were contention" |
| `prove-the-relaunch-before-stopping-the-old-process` | `overseer.md:631` "**Prove the relaunch before you stop a process.**" |
| `ps-grep-counts-its-own-apparatus` | `reusable/diagnose-box-resources.md:66-82` |
| `remote-control-is-already-on-for-box-sessions` | `overseer-direction.md:1266`; `reusable/agent-fleet-dashboard.md:25` |
| `removing-a-worktree-hits-two-false-blockers` | `worktrees.md` (the memory says it moved there) |
| `sol-limit-stops-work-never-luna` | `overseer.md:363` quotes Greg 2026-09-30 |
| `typecheck-wrapper-covers-tests-tsc-does-not` | `typechecking.md:40,69` |
| `use-opus-not-fable` | `reusable/engineering-manager.md:128`; `CLAUDE.md:369` "Fable is retired" |

## D2. Project knowledge that is not in the docs yet (class a)

Each row: memory → owner § → status → the text to add.

**Testing and checks**

1. `a-triage-agent-kills-your-vitest` → `testing.md` § the tmux/Test Files passage (~809) · DIRECT · partly covered (the "judge by `Test Files`" rule is there). Add: *"On the box, a resource-triage agent kills every running vitest when load spikes. The kill arrives as `EXIT=143` over a log of green ticks, so a log with no `Test Files` line is void, not passing. Re-run staggered, 15–90 minutes later; don't retry straight away alongside everyone else."*
2. `vitest-ignores-a-missing-test-path` → `testing.md` · DIRECT · not covered. Add: *"`vitest run a b c` where one path does not exist runs the rest and exits 0 without a word. After a scoped run, count the files it says it ran against the files you named."*
3. `scoped-test-gate-misses-a-routes-other-callers` → `testing.md` · DIRECT · not covered. Add: *"A scoped suite list built from your own diff misses other test files that drive the same route. When you change a route's request shape, `grep -rl '<the url>' tests/` and add every hit to the scoped run."*
4. `mutate-the-composition-root` → `testing.md` (near the mutation passage, ~497) · DIRECT · not covered. Add: *"Unit tests with injected fakes can't see whether the real objects are wired together. Mutate the composition root too (`??=` → `=`, a dropped registration), because that's where guards have turned out to have imaginary coverage."*
5. `sr-only-spans-satisfy-row-text-assertions` → `fleet-dashboard-modes.md` (tests) · DIRECT · not covered. Add: *"Every tooltip in a fleet row renders a `tw:sr-only` span beginning ' — ', so `toContain` on a row's `textContent` is answered by the tooltips. Assert on the element under test, and mutate the assertion once to see it go red."*
6. `piping-a-check-hides-its-exit-code` → `typechecking.md:299` (the filtering passage) · DIRECT · partly covered (it covers filtering, not the exit code). Add: *"`npm run typecheck \| tail` makes `$?` tail's, so a red run prints EXIT=0. Use `set -o pipefail` or `${PIPESTATUS[0]}`, or don't pipe it."*
7. `typecheck-tail-hides-its-own-errors` → `typechecking.md:299-301` · DIRECT · partly covered (`✗` lines lose their names under a grep). Add that **failures go to stderr** and the last two lines are always ✓, so judge the run by its exit code alone.
8. `a-blind-read-needs-its-shuffle-checked` → `prompting-guide.md` § measuring a prompt change · DIRECT · not covered. Add: *"Before trusting a blind A/B judge, count which side each arm landed on in the key, and run a same-prompt control (the arm against itself) as the baseline. A float LCG once put the new arm on one side 94 times in 95 (260926a); use the tested `blindCoin` in `evals/plain-words/run.ts`."*

**Box and tooling (count as project knowledge per the brief)**

9. `worktree-isolation-refuses-complex-bash` + `worktree-isolation-refuses-git-in-heredocs` → `worktrees.md` § Two things about `EnterWorktree` (~84) · DIRECT · not covered (no "too complex to verify" anywhere). Add: *"In a worktree-isolated session, Bash refuses any command it can't statically prove stays in the tree: loops over `$var` passed to `sed`, `bash -c`, and heredocs whose text merely mentions git. Put the script in a scratchpad file and run `bash <file>`. A subagent spawned before `EnterWorktree`, or one that calls `EnterWorktree` itself, loses Bash entirely."* (This trawl hit the refusal four times.)
10. `tmux-t-resolves-by-prefix` → `hetzner-remote-server-box.md` § tmux · DIRECT · not covered. Add: *"`tmux -t name` matches by prefix, so `kill-session -t foo` can kill another agent's `foobar`. Anchor with `-t '=foo'`."*
11. `tmux-ls-piped-through-head-lies` → `hetzner-remote-server-box.md:1128-1136` · DIRECT · partly covered. Add: *"To ask whether your own job is alive, use `tmux has-session -t '=<name>'`, never `tmux ls \| head`. Sessions list alphabetically and there are 30+ of them."*
12. `tmux-job-loses-your-exported-env` → `hetzner-remote-server-box.md:115` (the `tmux-job.ts` line) · DIRECT · not covered. Add: *"A job gets the tmux **server's** environment, not your shell's, so `export X=…; npx tsx scripts/tmux-job.ts …` loses X. Put the export inside a small `sh` script and pass that script."*
13. `tmux-job-takes-no-dash-dash` → same line, and `testing.md:814` · DIRECT · not covered. Add: *"`--name` is its only flag. A bare `--` or an invented `--log` becomes the command and exits 127 within a second, behind the same cheerful `✓`."*
14. `tmux-outlives-closed-tabs` → `hetzner-remote-server-box.md` § sessions · DIRECT · not covered (no `sessions.mjs`). Add: *"Closing a tab only detaches; `claude` keeps running at 300–450 MB. Run `node ~/gjd-remote/sessions.mjs` (`--kill` reaps only what it marks done)."*
15. `a-waiting-sessions-brief-is-in-a-separate-file` → `hetzner-remote-server-box.md` § gjd-remote · DIRECT · not covered. Add: *"A `--wait` session's brief is in `~/gjd-remote/prompts/<name>-<uuid>.md`. The `jobs/*.sh` launcher only `cat`s it, so grepping the `.sh` returns zero matches and looks like a brief that left the phrase out."*
16. `gjd-remote-sessions-may-not-start-in-auto-mode` → `feedback-reports.md` § dispatch, or `hetzner-remote-server-box.md:487` (`needs you`) · DIRECT · not covered. Add: *"A dispatched `new-claude --no-attach` session sometimes comes up without auto mode and stops at its first approval, which looks like thinking. A few minutes after dispatching, check `gjd-remote ls` for `? needs you`."*
17. `npx-tsx-survives-killing-its-shell-job` → `browser-testing.md:41-43` (the npm-wrapper passage) · DIRECT · partly covered. Add *"…and the same for `npx tsx server.ts &` / `kill $!`"* to that sentence.
18. `curling-a-port-cannot-tell-two-servers-apart` + `a-rebuild-does-not-reach-a-same-url-navigate` → `browser-testing-playwright.md` · DIRECT · not covered (`EADDRINUSE` and `?v=2` appear nowhere). Add: *"Confirm a server is yours from its own bind line in its log, not from a curl of the port (a peer may hold it). After a rebuild, navigate to a changed query string (`?v=2`), because a same-URL `goto` can serve the old document."*
19. `playwright-mixing-click-and-tap-fakes-hover` → `browser-testing-playwright.md:233-239` (tap section) · DIRECT · not covered. Add: *"One real `.click()` earlier in a run leaves the mouse parked. It is re-hit-tested on every layout change and overwrites tap-driven hover state. Drive a touch test with `.tap()` throughout."*
20. `playwright-screenshots-land-in-repo-root` → `browser-testing-playwright.md` · DIRECT · not covered. Add: *"`browser_take_screenshot` with a relative filename writes into the checkout root, and it can't write to the scratchpad. Save under the repo, then move it out; never leave an untracked PNG beside `package.json`."*
21. `no-audio-input-device-on-this-box` → `browser-testing-playwright.md`, with a pointer from `live-conversation.md`/`dictation.md` · DIRECT · not covered. Add: *"Headless Chrome on the box has no microphone, and the `--use-fake-device-for-media-capture` flags don't create one (`NotFoundError`). Feed `MediaRecorder` from a Web Audio graph instead."*
22. `vitest-process-count-is-five-per-suite` → `reusable/diagnose-box-resources.md` · PROPOSAL · not covered. Add: *"`pgrep -fa vitest \| wc -l` counts about five processes per running suite (wrapper, npm exec, sh, node, worker). Count suites, or trust load and MemAvailable."*
23. `browser-agents-measure-a-moving-tree` → `browser-testing.md` · DIRECT · *(check)*: "HMR" appears there but not this point. Add: *"Vite HMR pushes your edits into a running browser agent's page, so its report describes whichever tree existed at each moment. Don't edit what it is checking, or re-verify a serious finding against a known commit."*
24. `never-apply-migration-ddl-directly` → `database.md` (migrations) and `supabase-local.md` · DIRECT · not covered. Add: *"Apply migrations to the shared local database only through `npm run db:migrate`. Running the DDL by hand writes no ledger row and wedges `db:migrate` for every tree on the box. If it refuses over a peer's migration, stop and tell that peer."*
25. `drizzle-kit-generate-needs-a-tty` → `database.md` (migrations) · DIRECT · not covered. Add: *"`drizzle-kit generate` needs a TTY only for an ambiguous change (rename vs drop). Without one it exits 0 and writes nothing. A plain `ADD COLUMN` generates fine headless, so don't hand-write the `.sql`, which leaves no snapshot."*
26. `artefacts-live-on-article-revisions` → `database.md` · DIRECT · *(check)*. `article_revisions` is everywhere, but there is no "where to look" line. Add: *"Artefacts (`quotes`, `ideas`, `timeline`, `glossary`, …) are jsonb columns on `spideryarn.article_revisions`. `checkpoints` is a cache. Every table is in schema `spideryarn`, so a `public` filter returns zero rows."*
27. `npm-run-forwards-a-bare-argument` → `overseer.md:485` (fleet-restart) · DIRECT · not covered. Add: *"`npm run <script> <word>` forwards the word with no `--`. Never probe argv with a mode word that does something: `npm run fleet:restart go` really restarted the dashboard."*

**Overseer, queue and feedback**

28. `overseer-queue-export-is-too-big-to-read` → `overseer-queue.md` · DIRECT · not covered. Add: *"`export` prints ~280 KB, because every item's history is inline. Use `list`, or `export --json` through a `node -e` filter. The report id is `metadata.source`, so a top-level `source` filter silently matches nothing."*
29. `queue-edit-warns-about-a-lapse-that-cannot-happen` → `overseer-queue.md` · DIRECT · not covered. Add: *"`edit` always prints 'this LAPSES Greg's authorisation'. That only matters if `show` said `authority:` was authorised before the edit."*
30. `a-sibling-sweep-may-have-already-measured` → `feedback-reports.md` § the sweep · DIRECT · not covered. Add: *"Before re-deriving anything about a queued item, run `overseer-queue show <id>`. A sibling sweep may have appended the measurement to its `History:`, which neither `git log` nor `list` shows."*
31. `prove-an-empty-queue-with-a-control-query` → `feedback-reports.md:23-33` (the query) · DIRECT · not covered. Add: *"Zero results and a broken filter look the same. Before reporting an empty queue, re-run the query without `is:unresolved`, which should return the resolved history."*
32. `announce-before-taking-a-queued-slice` → `overseer-queue.md`, or `plans.md` (queued slices) · DIRECT · not covered. Add: *"Before starting a slice a plan has queued publicly, `SendMessage` the live peers. Two sessions once built the same slice eleven minutes apart, and the merge kept both copies without a conflict."*
33. `greg-allows-overseer-to-kill-finished-sessions` → `overseer.md:468` (`kill-session` is enacted) · DIRECT · covered in substance; the quote is missing. Add: Greg, 2026-09-29: *"You're allowed to run that command and similar yourself in future to free up memory."*
34. `greg-allows-overseer-to-deploy` → `overseer.md` § Deploying · DIRECT · covered in substance (`CLAUDE.md:267`). Add the quote: *"You have my permission to deploy any time you think it's a good idea."* (Greg, 2026-09-29).
35. `pull-latest-on-waking-up` → `worktrees.md` § The workflow, or `reusable/long-waits.md` · DIRECT (worktrees) · not covered (`worktree-freshen.ts` exists at `worktrees.md:39`, but the rule doesn't). Add: *"> when you wake up, pull the latest changes to avoid a big merge conflict at the end — Greg, 2026-09-06."* Run `worktree-freshen` first after a cron, a long wait, a compaction or a `--resume`.

**Rule docs (PROPOSAL)**

36. `commit-pathspec-drops-files-silently` → `version-control.md` § Commit your own files by name · PROPOSAL · not covered. Add: *"After the commit, read `git status --short`. A ` M` on a file that belongs to the change means it did not go in, and every gate stays green because the gates read the working tree."*
37. `diff-against-a-base-includes-the-merge` → `version-control.md` · PROPOSAL · not covered. Add: *"Once you have merged `origin/dev`, `git diff <fork-point> HEAD` includes everyone else's files. Scope your own change with `git show --name-only --format= <your commits>`."*
38. `a-codex-self-review-looks-like-an-independent-one` → `reusable/codex-cli-as-subagent.md` · PROPOSAL · not covered. Add: *"If `run-codex.ts` can't spawn its nested Codex (read-only sandbox, `/tmp` socket denied), an implement-and-review stage reviews itself and reports success. Grep the review artefact for 'could not start its nested', and launch the review from your own shell."*
39. `killed-codex-run-still-writes-its-answer` → `reusable/codex-cli-as-subagent.md` (near :404) · PROPOSAL · not covered (that line covers the wrapper's own timeout, not a hand kill). Add: *"A hand-killed run can leave its codex grandchild alive, and it writes the superseded answer minutes later. Never relaunch onto an `--output` path a previous run used."*
40. `ask-the-reviewer-to-check-the-conclusion` → `reusable/review-prompt-template.md` · PROPOSAL · not covered. Add: *"When a stage produces a result, put the conclusion in the candidate and name the finding you would least like to be wrong about. Ask whether you are explaining away an inconvenient result."*
41. `an-unchecked-brief-claim-becomes-a-source-comment` + `name-the-fallback-before-the-reviewer-does` → `reusable/engineering-manager.md` § Delegate · PROPOSAL · not covered. Add: *"A factual claim in a brief comes back verbatim in source comments and docs, so grep every load-bearing claim (above all 'nothing does X') before you brief. When a fix turns a silent gap into a refusal, write the fallback into the brief and have the builder test the licence for it."*
42. `subagents-end-turns-while-their-jobs-run` + `polling-a-log-burns-turns-not-time` + `grep-c-fallback-fires-immediately` → `reusable/long-waits.md` · PROPOSAL · not covered. Add: *"A subagent that starts a tmux job ends its turn and reports nothing, so own long waits yourself. Grep-polling a log burns turns, not wall-clock: arm one waiter and stop. In a poll loop use `grep -q`, never `grep -c … \|\| echo 0`, which yields '0\n0' and fires at once. And `kill -0` fails from the sandbox, so use `[ -d /proc/<pid> ]`."*
43. `a-fallback-makes-a-failed-check-look-answered` + `re-reading-your-own-work-is-a-zero-check` + `a-check-can-answer-a-weaker-question` → `reusable/silent-success.md` · PROPOSAL · partly covered (the class is there; these three shapes are not). Add one row each: an `ls X \|\| fallback` that prints plausibly when the check fails; re-reading your own work as zero evidence; and a guard whose subject and definition of "correct" move together in one edit.
44. `granularity-zoom-is-one-of-several-core-features` → `vision.md` · PROPOSAL · `CLAUDE.md:128` is already fixed ("one of the features this app is for"), but Greg's words aren't in vision.md. Add: *"> granularity-zoom is *a* core feature, but by no means the only reason the app exists! The glossary, concept-search, remembering, diagramming, etc all feel novel and interesting. — Greg, 2026-09-07"*
45. `scratchpad-scripts-cannot-import-repo-deps` → `reusable/engineering-manager.md:138` (scratchpad) · PROPOSAL · not covered. Add: *"A script in the scratchpad can't resolve the repo's `node_modules`, even when run from the repo root. Import by absolute path."*
46. `two-tailwind-utilities-one-property` → `web-client.md` § Tailwind and shadcn · DIRECT · not covered. Add: *"Two utilities that set one property (`mt-20` + `mt-auto`) aren't decided by class order. Tailwind's stylesheet order wins, and a screenshot can't see the loser. Check `getComputedStyle`."*
47. `tooltip-copy-is-read-on-four-surfaces` → `tooltips.md` (mode copy) or `new-mode.md` · DIRECT · not covered. Add: *"A mode's tooltip string is shown on four surfaces: the Dock (a press runs it), the loose mode links, a visitor's `VisitorBand` and an artefact that already exists. 'Opening it runs X' is false on three of them, so describe the artefact, not the gesture."*

## D3. Machine-local, personal, or stale: leave in memory, or delete

- **b, box state, fine as memory:** `no-vercel-credential-on-this-machine` (partly stale since 2026-09-29: `overseer.md:499` says prod credentials are on the box, and `get_runtime_logs` is covered at `vercel-hosting-deployment.md:64`; re-verify, then cut it down), `write-tool-refuses-paths-outside-the-repo`.
- **c, personal or epistemic, no single owner:** `a-comment-is-not-a-traced-equality`, `a-header-comment-is-not-a-traced-check`, `a-truncated-grep-becomes-an-exhaustive-list`, `a-survey-cannot-see-an-absent-state`, `two-joins-that-disagree-are-a-measurement`, `prose-through-a-shell-loses-its-markup`, `taskoutput-on-a-running-agent-dumps-its-transcript`, `wait-for-real-notifications` (except its `kill -0` fact, folded into item 42), `writing-escapes-produces-raw-bytes` (body not read in full). Several of these would fit as rows in `silent-success.md` if Greg wants them shared.
- **d, stale:** `sonnet-subagents-are-rate-limited-until-sep-12` (expired) · `get-ready-to-deploy-loop-lives-in-a-session` (a 2026-09-06 snapshot; the loop is now `readiness-loop.ts`, and the general fact belongs to `cron-scheduler.md`) · `public-read-audit-plan-not-built` (status belongs in plan 260902j itself) · `peer-discovery-is-per-config-directory` and `pool-account-sessions-have-no-sentry` (no pool accounts since 2026-09-30, per `overseer.md:334`; the second is also covered at `feedback-reports.md:221`) · `MEMORY.md` lines naming notes that have moved into docs (D1) should go when those notes do.

## E. Greg's intent paraphrased in docs/project, with his words in a plan

How these were found. Quotes attributed "Greg, 2026-…" in `docs/plans/` and `docs/user-feedback/`
that appear nowhere in `docs/project/`, `docs/reusable/` or `CLAUDE.md` (351 of them, most of them
plain feature requests), crossed with project-doc passages that state a Greg decision without
quoting him ("Greg's call", "Greg chose", "Greg decided", …). All are DIRECT unless marked.

1. `billing.md:1116` "**Greg's call, 2026-09-03: not worth closing.**" (two payable Checkout pages) ← `docs/plans/260902i-stripe-payments-and-subscription-tiers.md:112`, 2026-09-03: *"we can stop worrying about this unlikely edge case for now."*
2. `database.md:427-431` "Greg reversed the original `supabase-js` choice … **RLS is deferred**" ← `docs/plans/260825d-deploy-and-repo-move.md:149`, 2026-08-25: *"I had dreamed of using RLS instead of an API, but maybe that's overcomplicating things. … Let's just use a normal API for everything for now, and we can add RLS in later."*
3. `worktrees.md:238` "**A worktree pushes straight to `dev`.** … the local branch is a scratch label you delete afterwards" ← `docs/plans/260828r-worktrees.md:113`, 2026-09-01: *"I want each worktree to push directly to dev, and then we'll tidy up the local worktree branch afterwards."*
4. `billing.md:363` (the 260903i fixes) and `billing.md:1191` ("the generous reading … `past_due` is entitled here on purpose") ← `docs/plans/260903i-fix-the-upgrade-path-and-the-cancellation-telling.md:1199`, 2026-09-03: *"If in doubt, keep things simple, and err on the side of being fair and generous to the user."* This is the principle behind several billing choices, and billing.md never states it.
5. `web-client.md:38` "Directly under the title is the **origin line**" and `public-readable-sharing.md:46` "we prominently link to the original" ← `docs/plans/260906e-the-origin-url-under-the-masthead-title.md:3-7`, 2026-09-06: *"I know we have the view-the-original button, but I think it's important that we are prominent about the origin."*
6. `url-state.md:432-441` § The way back lives until you leave the article ("which is what the reader reported") ← `docs/plans/260916a-back-to-where-you-were-survives-a-mode-change.md:18-28`, 2026-09-12: *"ideally we want things across modes to use reusable machinery so that if we build something like that back to X … that should be true across citations and quotes and ideas and search and everything else … So then the back to would work robustly and universally."*
7. `deployment.md:159` (`npm run deploy` "applies any pending migrations to the remote") ← `docs/plans/260902a-remote-box-runs-production-migrations-without-a-human-in-the-loop.md:13`, 2026-09-02: *"I don't want to be in the loop. I don't want to have to do something manually."*
8. `deployment.md:225-231` and `testing.md:716-723` (the committed fixture corpus) ← `docs/plans/260901b-committed-fixture-corpus.md:75`, 2026-08-31: *"I'm really hoping that we can either make `data/` completely superfluous (i.e. not needed, no big deal if it's missing), or if it really is important (e.g. for evals) then commit it to the repo."*
9. `overseer-direction.md:797` ("harness-agnostic") and the not-Claude-specific design ← `docs/plans/260907e-agent-fleet-dashboard.md:304`, 2026-09-07: *"I'd rather not make this Claude-specific, and I think the Claude Code UI is weak, and we want to extend/improve on what's possible by building our own custom UI."*
10. `vision.md` § Simpler first (quotes 2026-08-31 only) · PROPOSAL ← `docs/plans/260830d-v1-imports-on-vercel.md:~11-12`, 2026-08-29: *"Look for simplicity, and getting to a v1 now, while being aware of the long-term-best eventual state and choosing stepping stones towards that."* This adds the "stepping stones" half, which the existing quote lacks.
11. `CLAUDE.md` "Real data belongs to the reader" / `database.md` · PROPOSAL for CLAUDE.md ← `docs/plans/260830d-v1-imports-on-vercel.md:218`, 2026-08-30: *"as soon as we move the app from Alpha to Beta status (hopefully soon), we'll need to take great care of our data going forwards ever after."* This is the origin of the rule, which is currently stated only in CLAUDE.md's own voice.
12. `CLAUDE.md` "Ask the other way round too: when a small product tweak … ask Greg" and `vision.md` § Simpler first · PROPOSAL ← `docs/plans/260831b-finish-the-database-move.md:227`, 2026-08-31: *"are there product decisions that would simplify this?"*; and the same file, `:255`, 2026-08-30: *"Define the stages such that we get most of the value with working versions as soon as possible … rather than deferring the main value to the end."* The second belongs in `reusable/engineering-manager.md` § stages (PROPOSAL), which states the staging rule without it.
13. `static-analysis.md` (knip, "unused files, exports") and `reusable/improve-the-codebase.md:66` ("dead code and unused exports") · PROPOSAL for the reusable doc ← `docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md:306`, 2026-09-04: *"I would like to delete dead code, to avoid future agents being confused."* The "why" is in no doc.
14. `glossary.md:148` "Greg's call, 2026-08-25, choosing a button over generating on every ingest" ← *(check)*: no verbatim quote was found in the 260825/260826 glossary plans by grep. Worth one search of the session transcript before writing it as a paraphrase-with-source.
15. `content-extraction.md:389` "Greg decided on 2026-09-07 not to re-extract the shelf" and `touch.md:371` "Greg chose that over hiding three of them behind a `⋯`" · *(check)*: no quote found in plans. Note that `touch.md:371` conflicts in spirit with `docs/plans/260905c-gutter-shows-as-many-icons-as-the-row-has-room-for.md` (2026-09-05: *"for short paragraphs we simply show a `...` button that reveals them all"*). That is the gutter, not the Dock, so probably not a contradiction, but worth a look.

Already quoted (no action): the cost rule (`cost-tracking.md:56`), mode-names-itself (`touch.md:664`),
icons over labels (`icons.md:213`), the search-score tooltip (`search.md:312`), the phone banner
(`touch.md:575`), dark only (`design-css-overview.md:74`), the Sol limit (`overseer.md:363`).
