# 261021h — An agent's question reaches *Needs a decision* without a deploy

> Increasingly I'm using the feedback dialog, the needs input section, to respond to everything
> rather than in this session's terminal. And so I wonder if we can add a way for you to add needs
> input entries for me, i.e. where you have a question for me or you need me to make a decision of
> your own. I then aren't sort of directly a response to a feedback report that I've made. That way,
> anything that's blocking, like if there's a migration issue or something else, you can just
> surface it in the needs input section and I can address everything from there (e.g. on my phone)
> rather than having to open up a terminal.
>
> — Greg, 2026-10-21 (to the Overseer)

And, later the same day, once asked:

> I guess I had assumed that the Needs Input sections are being stored and surfaced from the
> database. Is that not right? Because that would be the ideal, and that way then you can always be
> sure that anything you've submitted there is going to be live to me immediately. And that if
> there's something blocking the deploy, you can alert me before the deploy has happened, and
> hopefully I can unblock it.
>
> — Greg, 2026-10-21 (to the Overseer)

So the dialog serves questions from the database alone, with no path that waits for a deploy.

## What is wrong today

A question not tied to a report already works (`report: none`). What does not work is **time**: the
open questions are compiled into `src/feedback-questions.generated.ts`, so one reaches the dialog
only when a deploy carries it. A question about the thing *blocking* the deploy (2026-10-21: a local
migration-ledger fork held the deploy for 12+ hours) can never reach Greg at all.

## What done looks like

An agent runs one command and, within a minute, the question is at the top of *Needs a decision* on
production. Greg's reply is read back with `--answers` exactly as today. The Overseer's runbook says
blocking things go out this way.

## The design

```
 docs/user-feedback/questions/q-….md            (the only source: written and committed by an agent)
          │
          │  npx tsx scripts/feedback-questions.ts --publish q-xxxxxx   (or --publish --all)
          ▼
 spideryarn.feedback_questions  (production)      (a published copy: one row a file, refs left out)
          │
          ▼
 GET /api/admin/feedback/earlier?questions=4      (reads the rows, not a compiled file)
 POST …/answers, …/deferrals                       (unchanged; "does this question exist" asks the table)
```

1. **The file stays the source; the row is its published copy.** One home per fact: nobody edits a
   row, and the publish command overwrites the row from the file. The row holds what the dialog
   needs (`id, title, report, repeats, asked, body, status, acted`) and **not `refs`**, which is
   for agents and must never reach a browser.
2. **One path, not two.** The server reads the table only, and the compiled questions module
   (`src/feedback-questions.generated.ts`, `renderQuestionsModule`) is deleted. The overlay
   (generated file *plus* table, merged) is the option passed over: a merge rule for "the row says
   open, the deploy says answered" is a second place to be wrong, and the deploy path it keeps is
   the slow one we are replacing. `feedback-endings.ts` keeps parsing and validating every question
   file, so a bad file still fails it and its test.
3. **Every change to a question file is published**: asking, acting on a reply, marking answered.
   That replaces "run feedback-endings.ts and wait for the deploy". The safety net for a forgotten
   publish is `--answers` (which every sweep already runs, and which already reads production): it
   lists each file whose row is missing or differs. **The deploy does not publish**: a deploy ships
   an older sha than `dev`'s tip, so publishing from it could put a stale copy over a newer one.
4. **The write is narrow by construction.** The script holds one SQL statement that writes, a
   fixed `insert into spideryarn.feedback_questions … on conflict (id) do update … where` the row
   differs, in one transaction; it never deletes and touches no other table. Every file is parsed
   first, and one that does not parse means nothing is written (exit 2). A test asserts the only
   write the module can issue is that statement. A database role limited to the table was passed
   over: migrations connect as `postgres`, which on Supabase cannot `SET ROLE`
   ([database.md](../project/database.md)), so it would need a new login and a secret.
5. **Plain text at render, checked in the table too.** The dialog already draws a question as text
   nodes (no HTML is rendered anywhere in the Feedback dialog); check constraints repeat the file's
   rules (id format, title ≤ 120, body ≤ 6,000, status in `open`/`answered`, report a `spya-` id or
   null) so a row written by hand cannot be bigger or stranger than a file could be.
6. **Targets.** `--publish` writes production (`productionClient()`, the `Target:` line, as
   `--answers` reads it). `--publish --local` writes the local database from `.env.local`, for
   testing and for local dev, where the dialog is otherwise empty.
7. **The gate is unchanged**: the routes are admin-only as now, and the table has no owner and no
   route that writes it.

## Rollout order (production)

1. The migration (additive: one new table). Applied to production under Greg's standing permission.
2. `--publish --all` to production — harmless before the code deploys, because the running build
   does not read the table.
3. The Overseer deploys. From then on the dialog reads the rows.

Between 2 and 3, a question file edited on `dev` should still be published as well; nothing breaks if
it is not.

## Stages

1. **Table, store, server** — migration, `schema.ts`, store reads, `src/feedback-question.ts` async
   over the store, routes, delete the generated module, tests moved from mocking the generated file
   to rows. Gates: typecheck, the feedback suites, doc-links.
2. **The script** — `--publish`, `--local`, the drift lines in `--answers`, tests.
3. **Docs and end to end** — feedback.md, feedback-reports.md, overseer.md line; a local run: a
   `report: none` question published locally, shown in the dialog, replied to, read back with
   `--answers` against local. Then production steps 1–2.

## Decisions and findings

### GPT Sol's plan review (2026-10-21, read-only, `--effort high`)

Seven findings; none changes the shape. What each became:

- **F1 "within a minute" is the next open.** The dialog reads *Needs a decision* when it opens and
  does not poll. A published question is there the next time Greg opens Feedback (or reloads). That
  is what was asked; polling an open dialog is not built.
- **F2 a stale checkout could overwrite a newer row.** Taken in the cheap form: the upsert **may not
  move a row backwards** — an `answered` row is never set `open` again, and an `acted` id once
  published is never dropped (the `where` clause refuses, and the script reports the question as
  *refused, the row is newer than this file*). Wording can still be overwritten by an older copy;
  the drift lines in `--answers` show it. A source-commit ordering check was passed over as more
  machinery than the risk earns: questions are written by one agent at a time, on `dev`.
- **F3 one snapshot per request.** The store returns every row in one read; the route builds the
  open list, the status map, the acted map and the asked set from it, so one response cannot mix
  two versions. The parsers stay synchronous; the handlers await the existence check.
- **F4 the overlap.** Until the deploy carrying this lands, the running build knows only its
  compiled questions, so a reply to a question published after it is a 400. Deploy-free questions
  count from that deploy on.
- **F5 the guarantee, said accurately.** The script's code issues one fixed, parameterised write to
  one table; the production credential itself could do more. That is the guarantee, and the doc
  says so. (The plan's first draft overstated why a restricted role was passed over: the database
  doc shows `postgres` cannot become `supabase_auth_admin`, not that it can become no role. The
  real reason is that a restricted login is a new secret to hold on the box and the Mac.)
- **F6 `--local`** connects only to a URL `isLocalDatabaseUrl` accepts, prints its `Target:`, and
  accepts `development`/`test` rows for replies and deferrals; production mode keeps its refusal.
- **F7 the rows are checked on the way out too.** Check constraints for non-blank title and body,
  lengths, id formats and the status list; the server re-validates each row with the file's rules
  and a malformed one is a 500 with a log line, never a quietly shorter inbox. Postgres counts code
  points where JavaScript counts UTF-16 units, so a file within the JS limit is always within the
  table's.
