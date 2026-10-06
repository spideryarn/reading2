# Plan review: Remember's identifiers become `learn`

You are reviewing a **plan**, read-only. Do not change any file.

**Candidate:** commit cce4fea44d005226c5a78caca93b2e33daf23d76, one file:
docs/plans/261006a-remember-identifiers-become-learn-all-the-way-down.md
in the worktree /var/tmp/spideryarn-worktrees/learn-rename (branched from dev). Nothing is built.

**Background.** The reading mode "Remember" was renamed "Learn" on screen by
docs/plans/261005l-remember-becomes-learn-and-explore-covers-critiques.md. This plan renames the
identifiers underneath: mode id, `?mode=` / `?remember=` / `?chatfrom=` words, the stored
`chat_threads.kind` value with its CHECK and partial unique index, components, CSS, files, docs.
Greg's instruction is quoted in the plan and in docs/reusable/rename-or-move.md. Precedents:
drizzle/0048_rename_review_thread_kind.sql (the last kind rename) and
docs/plans/261001r-trajectory-becomes-skim-and-marginalia-rename-audit.md (the last mode rename).

**Do an independent pass first.** Read the plan against the code (src/modes.ts, src/web/last-view.ts,
src/web/params.ts, src/web/router.ts, src/chat.ts, src/routes.ts, src/store/pg-chat.ts,
src/store/export.ts, src/db/schema.ts, src/types.ts, src/web/thread-source.ts,
src/command-pick.ts, the drizzle migrator and docs/project/database.md) and look for:
what the plan says is true of the code and is not; a stored or wire spelling of the word it
missed; a way the migration loses, mislabels or orphans a reader's thread, or fails only where
there is history; a way the kept `?mode=remember` alias or the dropped ones misbehave (not merely
"an old link opens a default", which is accepted); anything in the order of stages that leaves the
tree unsafe to commit at a stage boundary; and whether a simpler shape gets the same result.

**Severity scale (grade by consequence):** P0 data loss, exploitable security, incorrect charging,
or the service broadly unusable. P1 user-visible wrong behaviour, or an authoritative contract
violated. P2 design or maintainability risk with no wrong behaviour today. P3 prose or comment
defect. Give every finding an ID (PR-1, PR-2 …), its severity, whether it is *established* (you
read the code that shows it) or *suspected*, the file and symbol, and what to do instead. End with
a verdict: approve / approve with changes / do not build.

**Accepted already, do not re-litigate:** minutes of breakage between migration and deploy on this
beta; a stale tab getting a 400 until reload; old `?remember=` and `?chatfrom=remember` links
falling back to a default; dated folders keeping the old word and stale links.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

1. Stage 1 renames the thread kind while the mode id is still `remember`. Is there a place that
   equates the two strings (a kind compared with a mode, e.g. in src/web/thread-source.ts or
   ChatPanel) so that stage 1 alone is wrong at its boundary? Would one stage be safer than two?
2. The partial unique index: drop and create inside the migration's transaction, with rows already
   rewritten. Any lock or ordering trap, and does drizzle-kit's snapshot agree afterwards?
3. Canonicalising `NEEDS_AN_EXPLICIT_PRESS` through `modeFromParam`: `diagram`, `chat` and the
   marginalia words go through the same filter; does canonicalising change any of them?
4. Changing the ids sent to the command-bar picker without re-running its eval.
5. `isThreadKind` coercing an unknown kind to `chat` in pg-chat.ts and export.ts: during the
   window old code reads `learn` rows as chats. Can any old-code write path then persist
   something wrong (a turn appended under the chat prompt, an export)?
