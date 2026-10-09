# Save the Hidden text opinions, and write down that paid AI output is kept

Admin report `spya-gqq38u` (Greg, 2026-10-08). The Hidden text check
([261007l](261007l-hidden-text-an-opus-check-the-reader-asks-for-over-the-flagged-fragments-only.md))
shipped with *"Nothing is stored"*, on Mirror's precedent. Greg:

> But then it said something like, The opinions are never saved. Why not? Any time we run AI
> processing or do valuable work, we should save it, unless there's a really good reason, like it's
> going to introduce enormous complexity or we're completely sure it's ephemeral or not going to be
> valuable. And we should make a minimal update to a doc, perhaps the database or mode doc, that sort
> of says, like, you know, we should be saving stuff that we've generated with AI that cost us money
> or time or effort.
>
> — Greg, 2026-10-08

## What changes for the reader

Press **Ask Opus about these**, reload, come back tomorrow: the lines beside each row and the
summary are still there, and the summary says when they were made (*"Opus judged 2 rows harmless,
on 8 Oct."*). Pressing again asks again and replaces the stored answer once the new one has
arrived. A run that fails or is abandoned leaves the last good answer in place.

If the article's scan has changed since (a re-import, a scanner change), nothing new is needed: a
judgment is already shown only beside a row identical to the one it was made from (`sameInputs`,
[`src/scan-groups.ts`](../../src/scan-groups.ts)), so a changed row reads *not checked*, and the
summary is counted from the lines drawn. That binding is why no source hash is stored.

## The table

`spideryarn.referee_hidden_checks`, one row per article, on `referee_claims`' model:

| column | |
|---|---|
| `article_id` | uuid, primary key, FK `articles.id` on delete cascade — one check per article |
| `owner_id` | uuid, FK `auth.users(id)` on delete restrict, like every owner key |
| `judgments` | jsonb, the validated `HiddenJudgment[]`: one model call's output, written and replaced whole, never queried across — the case `referee_claims.claims` argues out of [sql.md](../project/sql.md)'s column default |
| `unanswered`, `not_sent` | integer, not null, ≥ 0, `not_sent <= unanswered` (CHECK) |
| `model` | text, not null — what the gateway reported |
| `created_at` | timestamptz, not null — when the referee pressed |
| `finished_at` | timestamptz, not null — when the answer was validated |

**No pending row, no status, no attempt id.** Claims writes `pending` first because its panel shows
a run in flight across processes; this check is six seconds, its progress lives in the one tab that
asked, and the only write is the finished answer, as one upsert on `article_id`. Two tabs racing:
the later finish wins, and both were about the same rows. That is the simpler option, and what it
gives up — another tab cannot see a run in flight — is nothing a reader needs.

## The server

- **The call runs to the end** now, because there is somewhere for its answer to go. `gone` is no
  longer passed to `hiddenCheckStream`; the `sse` doc comment's list moves `runHiddenCheck` to *lets
  it run to the end* (its rule: every stream that runs on has a save path). A reader who leaves
  mid-call still gets the answer on their next visit rather than paying twice.
- **Saved after `done` is validated**, before the `done` frame is written, so a reader who sees the
  answer can reload and see it again. A save failure is logged (counts and slug, never a reason) and
  reported to Sentry, and the reader still gets the answer with a line saying it was not saved.
  *Simpler alternative passed over:* failing the run on a save error — that throws away an answer
  already paid for, which is the thing this plan exists to stop.
- **`GET /api/referee/hidden-check/:slug`** returns `{ check: StoredHiddenCheck | null }`, where
  `StoredHiddenCheck` is `HiddenCheckResult` plus `checkedAt` (ISO). The same ownership question
  as the POST (`shelfStore.read`), and owner-scoped in the store through `articleIdForOwned`, so
  another owner's slug is a 404. Referee is owner-only, and so is this.
- The `done` frame carries `checkedAt` too, so one client type covers both.
- **Store**: `src/store/pg-referee-hidden-checks.ts`, `RefereeHiddenCheckStore` in
  `contracts.ts`, `{ save(slug, check), read(slug) }`, guarded like its neighbours.
- **What may be logged**: slugs, counts, the model. Never a reason (it quotes the hidden text, and
  the article may be somebody's unpublished manuscript).

## The client

`useHiddenCheck` reads the stored check on mount and on a slug change (same abort discipline as the
run), and shows it as `status: "done"`. The read is validated with the same `isResult` the `done`
frame goes through, plus `checkedAt`. A failed read is silent (the button still works); it is not
an error the referee can act on. The summary line ends with the date. The button keeps its label.

## Everywhere else that has to hear

- `db:export`: an `ARTICLE_TABLE_COVERAGE` entry, `referee-hidden-check.json`, and a fixture in
  `tests/store-export-covers-tables.test.ts` that inserts a row and requires it back.
- Account and article deletion: the cascade from `articles`; the owner key restricts like the rest
  (whatever the account-deletion path does for `referee_claims`, it does here too).
- The suite's table registries (`created_at` on action tables, schema drift, store-migration
  registry), as each test demands.
- Docs: `referee-mode.md` § Ask Opus (the *Nothing is stored* bullet), the help page's Referee
  entry (*"The answer is not saved"*), the header comments in `src/referee-hidden-check.ts`,
  `src/web/useHiddenCheck.ts` and the route, `security.md`/`security-map.md` if they say not stored,
  and a note at the end of 261007l pointing here.

## The rule, written down once

One short section in [database.md](../project/database.md) — the doc about what we keep — with
Greg's words, and one line in [mode.md](../project/mode.md)'s checklist pointing at it, because a
new mode is where the choice gets made:

> **AI output we paid for is kept.** Anything a model produced that cost money, time or the
> reader's effort is stored — with when it happened — unless there is a really good reason not to:
> saving it would add enormous complexity, or it is certainly ephemeral or worthless. Say the reason
> in the code when you skip it.

## The sweep: other paid AI output we throw away

Every job in `JOB_DISPOSITION` (src/cost-categories.ts) checked against where its output goes,
2026-10-09 (a Sonnet subagent's census, the stream-lifetime list in `sse`'s comment in
src/routes.ts, and each caller's header). Everything step-driven is stored as a revision artefact,
and so are chat, search, criteria, claims, candidates, term lookups, citations' finds and
investigations, link summaries, the quiz's marks, shelf topics and the upload's source guess.
**None of the others was trivial to save, so none is fixed here.** For Greg:

| Job | What is thrown away | Why it is not kept today | To keep it |
|---|---|---|---|
| `referee-mirror` (Referee → Mirror) | the remarks on the referee's own comments | Mirror's precedent: *"a run is a prompt to look at your own sentence again, not an artefact"*; it stops the call when the referee leaves (plan 261005i) | **The one real candidate.** No privacy reason. A table like this one, but it goes stale whenever a comment or criterion changes, so it needs an input fingerprint as well — moderate. Recommend doing it next |
| `help-chat` (Help page) | the answer to a reader's question | a promise in [privacy.md](../project/privacy.md): the question and the answer are not stored | a privacy decision, not an engineering one |
| `command-suggest` (command bar) | the suggested searches and question | privacy.md: *"The list is not stored on the server"* (the model sees the profile); a suggestion pressed is saved as what it becomes | same: a privacy decision |
| `quiz-verdict` | one word that sets the next question's difficulty | *"a per-answer right/wrong on a log line is a stored grade wearing a different hat"*; the mark itself is kept in `quiz_attempts` | a privacy decision, and worth little alone |
| `transcribe` (dictation) | the transcript, until the reader saves the box | privacy.md: the audio is never stored; the browser keeps a week's copy | a privacy decision beside the microphone |
| embeddings (Force, Drift pictures) | paragraph vectors, cached in memory only | src/embeddings.ts: persisting needs pgvector or a bytea column, a migration and a re-embedding rule | moderate; about $0.0015 a cold article, so worth it only if the pictures get used |
| `command-pick`, `command-pick-words` | which command a sentence meant | used at once; about $0.0002 | ephemeral — the rule's own exception |

## Review of this plan (GPT Sol, before building)

[261009a-save-hidden-text-opinions-plan-review-sol.md](261009a-save-hidden-text-opinions-plan-review-sol.md),
*ready after fixes*, ten findings, all taken:

- **1** the reader's download as well as the rollback: `augmentations/referee-hidden-check.json`
  and its notes, beside `referee-hidden-check.json`.
- **2** the newer *press* wins, not the later finish: the upsert lands only over a check with an
  earlier `created_at`, otherwise the kept one is returned. (Binding the save to the article id
  resolved before the call was not taken: a delete and re-create under the same slug inside a
  six-second call is not a case worth a parameter.)
- **3** `save` takes the press time; `checkedAt` is `finished_at`.
- **4** a press aborts the read of the kept answer, so a late read cannot land over a run.
- **5** the last answer stays on screen while a retry runs and after it fails.
- **6** `saved: false` on the `done` frame when the save failed, caught inside the `done` branch;
  the store is `guarded` like its neighbours, so a failed write's parameters (the reasons) do not
  reach a log or Sentry.
- **7** owner and adversarial coverage for the stored path; security.md and security-map.md
  updated.
- **8** the article-delete fixture in tests/store-shelf-pg.test.ts. Account deletion is still
  manual (privacy.md) and the owner key restricts like every other.
- **9** the stream-lifetime test now asserts the call is *not* handed the reader's signal and that
  the answer saved. A caller who disconnects can now leave a call running; the global spending cap
  already covers repeatable paid operations, so no new limiter.
- **10** the sweep is above. The rule's wording was approved in substance in the report.

## Stages

1. Migration, store, routes, client, tests, docs, rule. One commit. GPT Sol code review
   (write-capable). Gates. Push to `dev`.
