# Review request: plan for `gjd-remote` to work from whichever repo you are in

You are reviewing a PLAN before anything is built. Read-only. Be specific and concrete; rank
findings by how much they would change the plan. Push back where the plan is wrong, but do not
re-litigate the product decisions Greg has already made (listed in the plan's "Decisions" table),
except to point out a consequence he may not have seen.

## Read, in this order

1. `docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md` — the plan.
2. `docs/plans/260831ad-multi-repo-support-for-gjd-remote-box.md` — the earlier plan it supersedes,
   and your own two reviews of it: `docs/plans/260831ad-multi-repo-support-sol.md`,
   `docs/plans/260831ad-per-repo-extension-sol.md`. Two of your recommendations there (no config
   file, no auto-clone) were overruled by Greg on 2026-09-02; the plan says how the objections are
   still answered. Judge whether they are.
3. The code the plan changes: `scripts/gjd-remote.ts` — especially `sessionDir()` (~line 685),
   `cmdClone()`/`cloneFacts()`/`remoteSlug()` (~1600–1830), `cmdPushEnv()` (~1470–1580),
   `cmdDoctor()` (~1960–2080), `resolvePrompt()`/`interactiveStdin()` (~1168–1224), the tmux
   `new-session -e` line (~1360), and `main()` (~2468). Also `scripts/gjd-remote-env.ts` (the
   allowlist and `buildEnvPayload`), `scripts/gjd-remote-tmux.ts` (the strict `ls` parser),
   `scripts/gjd-remote-log.ts` (the log schema), `src/ai-call.ts` (`openRouterJson`, `AI_JOB_ROUTE`)
   and `tests/no-undeclared-spend.test.ts`.
4. `docs/research/260902a-tui-prompt-library-for-gjd-remote.md` and
   `docs/research/260902h-per-repo-config-conventions-for-remote-dev.md`.
5. `docs/project/hetzner-remote-server-box.md` for the box, and `docs/reusable/silent-success.md`
   for the house failure mode.

## Facts established today (2026-09-02), so you need not re-derive them

- The box has one checkout, `~/code/spideryarn2`, whose origin is `https://github.com/spideryarn/reading2.git`,
  and token files for owners `gregdetre` and `spideryarn`.
- The only hard-wired constant in the CLI is `REMOTE_REPO_DEFAULT`; the five split-out modules have
  no repo strings; there is no interactive prompt anywhere; no test pins the constant.
- `REPO` in `gjd-remote.ts` is the tool's own install location (via `import.meta.url`), not cwd —
  so Terraform state, `.mcp.json` and the default `.env.local` all resolve to THIS checkout even when
  the user runs the tool from hellozenno. The plan must say which of those should follow cwd.
- `src/env.ts` loads `.env.local` from this repo's root, so the OpenRouter key for the proposal call
  is available regardless of cwd.
- `smol-toml` is already in `node_modules` transitively (used lazily by `scripts/deploy-checks.ts`).
- hellozenno is still at `/Users/greg/Dropbox/dev/experim/hellozenno` (origin
  `git@github.com:spideryarn/hellozenno.git`, i.e. an ssh remote locally); another agent is moving
  it to `/Users/greg/dev/hellozenno`.

## Questions I most want answered

1. **The identity → remote-checkout resolution.** Is the discriminated union
   (`found`/`absent`/`ambiguous`/`occupied`) complete? What state of the box makes it lie? In
   particular: a checkout under `~/code` whose origin is an ssh URL; a checkout nested two deep; a
   symlink under `~/code`; a partially-cloned directory left by a killed clone.
2. **Clone-then-setup inside `new-claude`.** The plan asks once, then clones, runs setup over ssh
   with a nonce marker, and refuses the session on any failure. Where does this leave a half-done
   state that the next run misreads as `found`? Should setup run inside the tmux session instead of a
   foreground ssh, given `npm ci` + Docker pulls can take minutes and the laptop may sleep?
3. **The per-repo config**: `.gjd-remote/config.toml` with `setup` and `check`, plus optional
   `.gjd-remote/setup`. Anything a repo could put in `setup` that changes what the TOOL does (not
   just what runs on the box)? Is "unknown keys are an error" enough?
4. **`push-env` for a repo with no policy.** Key names extracted by code, sent to a model via the
   gateway, proposal pre-ticks a checkbox, user decides, approved list saved to
   `~/.config/gjd-remote/repos/<owner>--<name>.toml`, two hard guards not overridable (non-loopback
   DB URL by value; the two infra-destroying names). Find the way a value leaks: into the prompt, the
   log, the spend record, a `SyntaxError` message, the checkbox description, the saved file. And: is
   a saved allowlist that pre-ticks silently next time a regression of the "new key is skipped until
   somebody adds it" property the current allowlist has?
5. **`REPO` vs cwd**: which of Terraform state, `.mcp.json`, `remote-smoke-browser.mjs` and the
   default `.env.local` path should follow the target repo, and which must stay with the tool?
6. **Stage order.** Would you reorder, merge or split? What would you cut from v1 that the plan
   keeps, and what does it defer that will bite within a week?
7. **The `ls` REPO column and the strict tmux record.** The plan extends the record with a field
   read via `show-environment`; legacy sessions show `(unknown)`. Does "a new-format record missing
   the field is rejected" survive a box where some sessions predate the change?
8. Anything in the "How each guard is made to go red" table that cannot actually be made to go red
   as written.

Write your answer as a numbered list of findings, each with: severity (blocker / should-fix /
nit), the file or plan section, what is wrong, and the concrete change. End with the three changes
you would make first.
