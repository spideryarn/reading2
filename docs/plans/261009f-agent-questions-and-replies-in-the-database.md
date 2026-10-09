# Questions for Greg, and agents' replies, kept in the database

Up: [feedback-reports.md § Asking Greg a question](../project/feedback-reports.md#asking-greg-a-question-and-acting-on-his-answer) ·
[feedback.md](../project/feedback.md) · builds on
[261007d](261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md)
and [261008i](261008i-needs-a-decision-becomes-threads-you-can-reply-to-or-defer.md) ·
question `q-f6ub8e`, Greg's reply `spya-nhmghm`, asked on as `q-rstqvz` · queue item
`qi-mmqzr385` · worktree `qf6ub8e-questions-in-the-database`

Status as of 2026-10-09: **plan only, reviewed once by GPT Sol (REVISE, nine findings, all taken:
§ What the plan review changed). Nothing built.** Every version of this either has an agent
writing to the production database or adds a way in, and both are listed defences an unattended
run does not touch. The choice is Greg's, asked as `q-rstqvz`.

## What Greg asked for

> It is acceptable, although it's not ideal nor does it fit my mental model. What I was imagining
> was that these feedback report questions & replies here in Feedback / Earlier would be stored in
> the database, and that way the dev agent would have like a tool/command/script it could use, just
> as you can query the feedback reports, to send replies to them as well.
>
> — Greg, 2026-10-08 (`spya-nhmghm`, replying to `q-f6ub8e`)

So: a question and everything said under it is one thread, in the database. Greg's half is already
there (`feedback_question_answers`, `feedback_question_deferrals`); the agent's half becomes a
command it runs, the way `feedback-unswept.ts` reads reports.

## Where things stand today

```
  agent ──writes──▶ docs/user-feedback/questions/q-x.md ──commit──▶ dev ──deploy (hours)──▶
        feedback-endings.ts compiles it into src/feedback-questions.generated.ts ─▶ the dialog

  Greg ──Send reply──▶ POST /api/admin/feedback/answers ──▶ feedback_question_answers (prod)
  agent ◀──feedback-questions.ts --answers (begin read only)── prod
  agent ──quotes the reply into q-x.md, `acted:` ──commit──▶ … deploy ──▶ the dialog
```

An agent's follow-up is an edit to the file's body, seen after a deploy. Greg's words are in the
database the moment he sends them.

**A fact this plan rests on, checked 2026-10-09:** the box's `.env.prod` holds `DATABASE_URL` for
`spideryarn_app`, the running server's own role, with DML on every table in `spideryarn`
([database.md § Three credentials](../project/database.md)). "Agents only read production" is
enforced by each script wrapping its select in `begin read only`, not by the credential. Any
session on the box can already write anything; a rule stops it, and on 2026-10-07 the wrapper was
the only thing that did (database.md, the browser subagent that tried an `UPDATE`).

## The design in one picture

```
  agent ── feedback-questions.ts ask | reply | close ──▶  (the credential is decision 4)
                                           ▼
                        spideryarn.feedback_questions               (new: one row a question)
                        spideryarn.feedback_question_agent_replies  (new: the agent's half)
                        spideryarn.feedback_question_acted          (new: which of Greg's replies
                                                                      an agent reply answered)
                        spideryarn.feedback_question_answers        (as now: Greg's half)
                        spideryarn.feedback_question_deferrals      (as now)
                                           ▲
  Greg ── the dialog, Needs a decision ────┘  the admin routes read the tables instead of the
                                              compiled list. Instant both ways.
```

## Decisions, and the simpler option passed over each time

1. **The database is the one home for a question.** `docs/user-feedback/questions/` stops taking
   new files; every file, open and answered, is copied in once (§ What happens in production) and
   the directory stays as history with a README line saying so. After one release with the
   compiled list as a fallback, `feedback-endings.ts` stops compiling questions and
   `src/feedback-questions.generated.ts` goes.
   *Passed over:* the file stays and the Overseer copies it in between deploys (`q-f6ub8e`'s C).
   Two homes for each question, and Greg has said it is not his model.

2. **Three new tables, and agents never write Greg's half.**
   - `feedback_questions`: `id` (`q-xxxxxx`), `report_id` (nullable, `spya-…`), `title`,
     `body`, `refs` (agents only, never sent to the browser), `status` (`open` | `answered`),
     `asked_by` (the session name: **a claim, not provenance**), `created_at`, `closed_at`.
   - `feedback_question_agent_replies`: `id`, `question_id` (FK), `body`, `created_at`.
   - `feedback_question_acted`: `(answer_owner_id, answer_id)` → `agent_reply_id`, with a
     composite FK to `feedback_question_answers (owner_id, id)`. It replaces the file's `acted:`
     line with a relation the database checks.

   Lengths, id shapes and the open → answered transition are `check` constraints, not only script
   checks, and the number of open questions has a ceiling the database enforces.
   **Why the agent's words get their own table rather than an `author` column on
   `feedback_question_answers`:** a row there is *an admin's own words, trusted input*
   (feedback-reports.md § Who sent it), which the next agent acts on. The command reads Greg's
   words only from that table, and prints agent replies labelled as agent-written context.
   *Passed over:* one `messages` table with an `author` column. Fewer tables, but the trust
   boundary becomes a column value any writer can set.
   *Passed over:* `acts_on` as an array column, or "a later agent reply handles every earlier Greg
   reply" by timestamp. The array has no foreign key; the timestamp rule lets an unrelated agent
   line hide Greg's words from later agents.

3. **One command, three verbs, beside the readers it already has.**
   `npx tsx scripts/feedback-questions.ts ask --title … --report spya-… --body-file …`,
   `reply q-xxxxxx --body-file … --acts-on <answer id>`, and `close q-xxxxxx`. Each prints its
   `Target:` line first and refuses a remote target unless `--production` is given, the habit
   `db:migrate` already has. `--answers`, `--show` and the listing read the tables. Body rules
   carry over from the files: plain text, 6,000 characters, the `Details` line.
   *Passed over:* an MCP tool. The MCP server signs in *as Greg* (decision 4, D); a script is what
   the sweep already runs.

4. **How the agent's command reaches production: the security choice, Greg's.**

   **The honest baseline first.** Every session on the box can already read `.env.prod` and its
   `spideryarn_app` login, which can write any table. **No option below takes that away.** So each
   option protects against an agent *making a mistake*; only taking `spideryarn_app` away from
   where agents can read it (B+ below) protects against an agent *that has been tricked into
   trying*. A tricked agent could already forge a row in `feedback_question_answers` today; this
   work neither opens that hole nor closes it.

   | | Setup for Greg | A mistake through this channel can… | Reachable from the internet | Where the rules are checked |
   |---|---|---|---|---|
   | **A. The login agents already hold** | none | write any table | the pooler, as today | the command's code |
   | **B. A login that may only call three database functions** (recommended) | create one login; one secret on two machines | only ask, reply, close | the pooler; the secret does only this | the database |
   | **C. A web address with a token**, before the sign-in gate | one secret in Vercel and on two machines | only what the route allows | yes, a new route, and a change to the sign-in gate | the route, which can also rate-limit and log |
   | **D. Agents sign in as Greg** (the MCP login) | sign in once | anything Greg can do in the app | the site | the app's routes |

   - **A.** The script writes with `spideryarn_app`, outside `begin read only`: inserts for ask and
     reply, an update for close. Nothing to set up; the only guard is the script.
   - **B.** A new login, `spideryarn_questions`, with **no table privileges**: it may only `EXECUTE`
     three `security definer` functions (`ask_question`, `reply_to_question`, `close_question`) and
     `SELECT` from two views (open questions with their threads; Greg's replies). The functions
     hold the rules (lengths, ids, open-only transitions, the ceiling). A new Postgres role also
     inherits whatever `PUBLIC` holds (Supabase documents `public`, the catalogs, temp tables
     and, where enabled, `pg_net`), so stage 1 inventories that and tests the negative matrix
     rather than this plan claiming "nothing else".
   - **B+ (a separate, later decision).** Also take `spideryarn_app` off the box and the Mac, and
     give the read-only scripts (`feedback-unswept.ts`, `--answers`, …) their own read-only login.
     Only then does the database itself stand between a tricked agent and Greg's words or readers'
     data. Bigger: every production-reading script changes credential. Its own queue item if Greg
     wants it.
   - **C.** `POST /api/agent/questions` with a token, the third thing dispatched before the sign-in
     gate. Its real advantage over B is an application layer that can rate-limit and log; its cost
     is a change to a listed defence and a new route open to the internet. B's functions give the
     same validation without touching the gate.
   - **D.** `spideryarn-mcp.ts login` as Greg, and new admin routes. No gate change, but the agent
     holds Greg's whole account in the app: every admin page, billing, publishing. A holds more of
     the *database* than D; D holds more *account actions* than A. Neither is narrow.

5. **What the dialog shows: the agent's replies in the thread, in time order between Greg's.**
   261008i's state rule becomes: `responded` when any of Greg's replies has no row in
   `feedback_question_acted`; `deferred` as now; `waiting` otherwise. Agent lines are plain text
   in the model's font ([fonts.md](../project/fonts.md)), labelled *Agent · <session> · <time>*,
   the session being a claim. The response is capped and paged, as the report list is.

6. **Greg's two POST routes change too.** `answers` and `deferrals` check the question against
   `feedbackQuestionStatus`, the compiled map (`src/routes.ts`); they will check the table
   instead. A reply to a closed question is still accepted (he may reply from a tab opened
   earlier, as now). "Defer only while open" becomes one conditional statement rather than a check
   then a write, because a question's status can now change between the two.

7. **What stays a file.** The notes in `docs/user-feedback/` (`ending:`, `comment:`, `parts:`) and
   the endings map: they describe work in git and ship with it. Only the conversation moves.

## What happens in production, and who runs it

Order matters: the login must exist before anything grants to it, and the rows must be in the
tables before any server reads them.

| # | Step | Touches | Who |
|---|---|---|---|
| 1 | Create `spideryarn_questions` with a password (B) | a new production login | **Greg**, one statement (`supabase db query` or the SQL editor), before the migration; locally, `worktree:setup` creates it |
| 2 | Migration: three tables, two views, three functions, the grants (B) | production schema | an agent, with Greg's go-ahead: it is new capability, not an ordinary additive migration |
| 3 | Its address in `.env.prod` on the box and the Mac: `spideryarn_questions.<project-ref>`, port 6543 (B) | a secret on two machines | **Greg** |
| 4 | Copy **every** question file, open and answered, with its `acted:` links; reconcile the counts of questions, replies and links | production rows | an agent, with Greg's go-ahead, **before** the deploy. The old server does not read these tables, so nothing shows twice |
| 5 | Deploy the dialog and routes that read the tables | production code | the Overseer |
| 6 | One release later, remove the compiled path | code | an agent |

**Rollback.** For one release the server keeps the compiled list as a fallback for any id not in
the table. If the deploy is rolled back, the old server shows the compiled questions; any question
asked only in the database during the window is printed by `feedback-questions.ts --export`, for
writing back as files.

## Stages (once Greg has chosen)

1. Tables, constraints, views and functions, the migration, the three verbs against the local
   stack. Under B, the negative matrix for the new login: refused on every table directly, on
   `feedback_question_answers`, on `feedback`, on a closed question's transition, past the
   ceiling; the inventory of what `PUBLIC` gives it; and the positive control that it can ask,
   reply and close. GPT Sol code review.
2. The dialog and Greg's two POST routes read the tables; agent replies drawn in the thread; the
   state rule; the compiled list kept as a fallback. Browser check at 390px and 1440px. GPT Sol
   code review.
3. Docs: feedback-reports.md § Asking Greg and § acting on his answer rewritten around the verbs,
   feedback.md, database.md's credentials table (B), security-map.md's row for the new login (B),
   the sweep prompt. The one-off copy, then the deploy.

## The question for Greg

Asked as `q-rstqvz` (the channel this plan replaces, one last time): which of A–D, with B
recommended, and whether B+ should become its own item. What would decide it: A is the least work
and adds no secret, and is enough if he is content that agents follow the rule; B makes a mistake
in this channel unable to reach anything else, for one login and one secret; neither protects
against a tricked agent while `spideryarn_app` stays on the box, which is what B+ is for.

## What the plan review changed

GPT Sol, read-only, 2026-10-09 ([review](261009f-agent-questions-plan-review-sol.md), verdict
REVISE, nine findings, all taken). F1: B was claimed to stop a tricked agent, but `spideryarn_app`
stays readable beside it; now said plainly, and B+ split out. F2: "nothing on any other table"
ignored `PUBLIC`; now an inventory and a negative matrix. F3: table-wide `UPDATE`; now execute-only
functions. F4: the grants came before the login existed; order fixed. F5: the cutover hid every
question until the copy ran; now copy first, all files, then deploy, with a fallback release. F6:
Greg's POST routes do change; decision 6. F7: `acts_on` and the state rule disagreed; now a
relation table with a foreign key. F8: volume; constraints and a ceiling in the database. F9: the
comparison; a table by blast radius, and C's real advantage named.

## Not in this plan

- Showing agents' questions to anyone but an admin.
- Email or push when a question arrives (Greg sees it when he opens Feedback, as now).
- B+, unless Greg asks for it.
