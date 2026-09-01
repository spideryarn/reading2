# Rename Review mode to Remember mode, everywhere

**Status: plan, revised after cross-family review, ready to build.** Written 2026-09-01 early
morning. The first draft was reviewed by GPT-5.6 Sol
([review](260901d-rename-review-mode-to-remember-mode-everywhere-review-sol.md)) and returned **"do
not build this plan as written"**. Ten findings; nine taken, one part-taken. What changed is recorded
in § *What the review changed*, because a plan that quietly absorbs its review teaches the next reader
nothing.

## The job

The reading-view mode called **Review** becomes **Remember** — in the UI, the code, the tests, the
evals, the docs and the database. Greg, 2026-08-31:

> Let's rename "Review" to "Remember" mode, along with all files, docs, references, variables, schema
> (including database migrations as needed).

## Why — stated accurately, after the review knocked the first version down

Greg's reason, given when the work was scoped:

> The mode *name* has changed, and the prompt should update accordingly. The *intent* of the mode
> hasn't changed much — we're reviewing in order to remember, which is why either name potentially
> fits… (FYI for context, I'm renaming this mode because we might want a "Reviewer" mode for peer
> review, and don't want things to be confusing.)

**The specific collision he feared did not happen.** The work was deliberately delayed seven hours so
other agents could land theirs, and in that window
[260831an](260831an-referee-mode-for-peer-reviewers.md) built the peer-review mode — as **Referee**,
not Reviewer ([referee-mode.md](../project/referee-mode.md)). *Review* and *Referee* are further apart
than *Review* and *Reviewer* would have been.

The first draft of this plan claimed the rename had become **more** justified, on the grounds that the
two sit "seven lines apart" in `MODES`. **That was wrong, and the review caught it**: `MODES` is not
dock order — [`src/modes.ts`](../../src/modes.ts):108 says so explicitly — and in the dock they are
separated by Diagram and Chat ([`src/web/Dock.tsx`](../../src/web/Dock.tsx):443 vs :470). The argument
was rhetoric dressed as evidence.

**The honest case, which is still a good one:**

- *Review* stays ambiguous next to a tool whose whole subject is peer review. The collision is weaker
  than feared, not absent.
- *Remember* matches what the product is for — [vision.md](../project/vision.md)'s "internalise and
  interrogate" — where *Review* describes the mechanism.
- It works as an umbrella over the two sub-modes that now live under it, **Recall** and **Quiz**.

**The cost, named rather than hidden:** *Remember* can suggest saved memories or spaced repetition,
neither of which this mode does. The dock blurb carries the weight of correcting that, so it must stay
accurate.

So: **justified, but not more justified than before.** Nobody changed their mind; the ground moved.

## The licence Greg gave, quoted so it is not re-argued

> We have no real users yet, so it's fine to break things (e.g. urls) without aliases etc.

Taken at face value and applied wider than URLs. **No back-compat**: no legacy mode alias, no
dual-accept window on the database value, no preserved eval-result directories. It stops at
destruction — this rename only updates values, and anything whose clean path is a delete goes back to
Greg.

## Scope

| Layer | From | To |
|---|---|---|
| Mode key (URL + UI) | `"review"` | `"remember"` |
| Thread kind (**persisted**) | `kind = 'review'` | `kind = 'remember'` |
| Types | `ReviewStance`, `REVIEW_STANCES`, `ThreadKind`'s `"review"` | `RememberStance`, `REMEMBER_STANCES`, `"remember"` |
| Prompt constant | `REVIEW_SYSTEM` | `REMEMBER_SYSTEM` |
| Limits | `MAX_REVIEW_CHARS` | `MAX_REMEMBER_CHARS` |
| Sub-mode param | `?review=recall\|quiz` | `?remember=recall\|quiz` |
| Sub-mode types | `ReviewView`, `REVIEW_VIEWS`, `reviewParam` | `RememberView`, `REMEMBER_VIEWS`, `rememberParam` |
| Components | `ReviewBand`, `ReviewInvitation` | `RememberBand`, `RememberInvitation` |
| CSS | `.review`, `.review-submode*` | `.remember`, `.remember-submode*` |
| Dictation vocabulary | `"review mode"` | `"remember mode"` |
| Doc | `docs/project/review-mode.md` | `docs/project/remember-mode.md` |
| Tests | `tests/review-*.test.ts` (4) | `tests/remember-*.test.ts` |
| Eval + result | `evals/review-stances.ts`, `evals/results/review-stances.md` | `remember-stances.*` |
| npm script | `eval:review` | `eval:remember` |

Scale: **~140 hits are the mode; ~2,400 are not** — code review, Referee's peer-review prose, and
`preview` as a substring. That ratio is the whole risk, and it is why no blanket regex is run anywhere
in this job.

### Not renamed, deliberately

- **Code review.** Hundreds of comments saying *"Found by a GPT Sol review"*. Every
  `docs/plans/*-review-sol.md` / `*-review-prompt.md`.
- **Referee mode** and its peer-review prose.
- **`docs/plans/`, `docs/postmortems/`, `docs/research/`** — records of what was true then, as in
  [260831ak](260831ak-rename-the-toc-step-to-hierarchy-everywhere.md).
- **The prompt body** — see below.
- **`preview` anywhere** (~330 hits), and `feedback.environment`'s `'preview'` value.
- **`drizzle/0019_nebulous_romulus.sql`**, the shipped migration that introduced the CHECK, its
  comment in `0046`, and every pre-0048 Drizzle snapshot. A shipped migration records what ran.
- **`evals/hierarchy-structure/REVIEW-PROMPT.md` / `REVIEW-SOL.md`** — a code-review pair, despite the
  shouting names.
- **Committed historical eval output** — the dictation results JSON records "review mode" as the input
  it actually ran on. Rewriting it to make a grep clean would be falsifying a result.
- **`data/your-book-review-the-pale-king`** — an ingested article whose *title* says "book review".
- **The sub-mode values `recall` and `quiz`** — neither is the mode's name.
- **Existing `feedback.diagnostics` rows** — see below.

### The prompt body does not change, and both halves of that were checked

`REVIEW_SYSTEM` ([`src/converse.ts`](../../src/converse.ts):424) contains **no occurrence of "review"**
in its ~130 lines — verified independently by the review, which noted the only near-match is the word
"half-remember". So the constant's name changes and **no model-visible byte of the template moves.**

**But the first draft's conclusion — "the stance eval cannot regress by construction" — was wrong, and
the review was right to reject it.** The template is not the whole request. The renamed discriminant
also selects `readItFor` and `stanceLine` ([`src/converse.ts`](../../src/converse.ts):674), so a
botched rename can hand a Remember turn the *chat* prompt, or drop the stance, while the template
stays byte-identical. That is a silent failure of exactly the shape
[silent-success.md](../reusable/silent-success.md) is about.

**Evidence required instead:** capture the fully-built model messages before and after the rename, for
all four stances, and diff them. Deterministic, free, and strictly stronger than re-running a
nondeterministic paid eval whose own input literal is being renamed at the same time.

## Where the string is persisted

Probed read-only against the live local catalogue, then corrected by the review, which found two paths
a catalogue probe cannot see.

**1. `chat_threads.kind` — the only relational discriminator.** The review verified this
independently against the schema, `src/store/` and the migrations.

```
spideryarn.chat_threads | chat_threads_kind
    CHECK ((kind = ANY (ARRAY['chat'::text, 'review'::text])))
```

Local distribution: `chat` 27, `review` 1.

**2. `feedback.diagnostics` JSONB stores the reader's current mode.**
[`src/feedback-payload.ts`](../../src/feedback-payload.ts):118 declares `mode`, :371 validates it with
`oneOf(source.mode, MODES)`. The first draft asserted no JSONB holds a mode name; **that was
structurally wrong**, and a probe returning no `"review"` value today does not stop it being a
persistence path. **Decision: existing rows are left alone** — they are telemetry describing what a
reader actually saw, and rewriting them makes the record false. New diagnostics accept `remember`
automatically, because the validator reads `MODES`. This is an explicit exception, not an oversight.

**3. `data/<slug>/chat.json` — a real Remember thread in a filesystem snapshot.**
`data/noema-mythology-of-conscious-ai/chat.json`:296 holds `"kind": "review"`. It is gitignored, which
is why the sweep missed it. After the code rename, `chat.ts`:88 and
[`src/store/export.ts`](../../src/store/export.ts):534 would silently normalise that thread to
**chat** — a real thread of Greg's, quietly downgraded. **This needs Greg's yes before Stage C**: it
is local reader data that I did not create, which `AGENTS.md` says to ask about every time. The ask is
one line and the fix is a one-value edit; leaving it unnoticed is the one option ruled out.

**4. Ruled out, structurally rather than by an empty table.** `ai_calls.step_name` and `jobs.steps`
hold *pipeline step* names — locally `arc`, `glossary`, `hierarchy`, `extract`, `blocks`, `fetch`,
`assets`, `quotes`, `sketch`, `tweets`, `timeline`, `ideas`. Review is a reader-facing mode with no
pipeline step. `ai_calls` has **0 rows locally**, so its clean probe result was never evidence;
Stage C confirms against production before the migration runs.

**Two probes that proved nothing, recorded because both looked like success.** The first scanned
`information_schema` for schema `public` when the tables are in `spideryarn` — empty result, clean
bill of health. The second scanned rows in tables that are locally empty.

## The migration, and the rollout it needs

Order, which the review confirmed is correct:

1. `ALTER TABLE spideryarn.chat_threads DROP CONSTRAINT chat_threads_kind;`
2. `UPDATE spideryarn.chat_threads SET kind = 'remember' WHERE kind = 'review';`
3. Re-add the CHECK with `'remember'` in place of `'review'`.

Drop-and-re-add rather than alter, because Postgres has no `ALTER` for a check expression — house
style is at `drizzle/0046_quiz.sql`:29-43. The migration is transactional and takes an exclusive table
lock, so **no writer can slip between the statements**.

**`chat_messages.stance` needs no data update.** Its values (`balanced`/`respond`/`socratic`/
`signposts`) do not encode the thread kind, and the rows stay attached to the migrated thread by
identity. Only the type names and comments around them change.

### The incompatible window, which the first draft did not admit existed

Deployment runs migrations **before** the new application is pushed. So after 0048 commits and before
the new code is live: old code creating a `review` thread fails the new CHECK, and old code loading a
migrated `remember` row normalises it to chat. *"No compatibility aliases"* does not make this
disappear — it is a rollout problem, not an aliasing one.

**Decision: a brief maintenance window** — migrate, deploy, done — rather than
expand/migrate/contract across two deployments. With no users the window costs nothing, and
expand/contract would mean building exactly the dual-accept compatibility layer Greg's licence exists
to avoid. Stated here so the rollout is chosen rather than inherited.

## Stages

Each ends green and committable. The **A/B/C split changed after the review** — see below.

**Stage A — docs.** `review-mode.md` → `remember-mode.md` by `git mv`, every inbound link,
`AGENTS.md`'s signpost line (`CLAUDE.md` is a symlink). Read hit by hit; the code-review sense of the
word is all over these files. Also:
- [referee-mode.md](../project/referee-mode.md) § *Why the mode is "referee", not "reviewer"* argues
  its own name from the collision this rename removes. It gets a parenthetical — "review, since
  renamed to Remember" — rather than deletion, because the reasoning was right when the name was
  chosen. Its `ThreadKind` line at :134 is fact and simply updates.
- [url-state.md](../project/url-state.md) documents **neither** sub-mode key today — not Remember's
  and not Referee's. Renaming a parameter the URL source-of-truth does not list would leave it
  incomplete, so both get written down.
- `dictation.md` and `setup-dev.md` name the mode.

Gate: `tests/doc-links.test.ts`.

**Stage B — everything that is not the persisted thread kind.** Mode key, sub-mode param and its
**two** URL registrations, components, CSS, UI copy, dictation vocabulary, test filenames, eval, npm
script.

> **Stage B deliberately leaves every persisted `ThreadKind` literal as `'review'`.** That creates a
> temporary, intentional mapping: the mode is `remember`, the thread it writes is `kind: 'review'`.
> It is stated here because it looks like a missed rename and is not.

The first draft said Stage B would leave the literal in `schema.ts` alone "so the code still matches
the database", **which was backwards** — the review pointed out that renaming the runtime discriminant
while the CHECK still accepts only `chat|review` makes every Remember insert fail with `23514`, and
makes `pg-chat.ts`:229 silently coerce existing rows to chat. Stage B as first written could not have
had green Postgres tests. Fixed by moving the whole discriminant to Stage C.

**Stage C — the discriminant, the schema, the migration and the rollout, together.** Because they
cannot be separated without a broken intermediate state. Waits for the other agent's `0047` to land.
1. Wait for `0047_based_on_revision_id.sql` to be committed.
2. **Re-read the journal tail** rather than assuming the number is 0048.
3. `ThreadKind`, `schema.ts`, and every persisted `'review'` literal.
4. Generate the migration; hand-insert the `UPDATE` between the generated DROP and ADD.
5. Commit SQL, journal entry and snapshot together.
6. Verify: `review = 0`, `remember` = the old review count, total threads unchanged.
7. Production: confirm `ai_calls.step_name` holds no `'review'`, then the maintenance-window rollout,
   reporting row counts before and after.

## Tests

The first draft claimed five test files. **That was plainly false**, and the review listed what it
missed. The real set, to be run as the gate:

`store-chat-pg` · `store-roundtrip` · `chat-turn-paths` · `chat-web-links-prompt` · `visitor-gaps` ·
`public-network-trace` · `page-title` · `referee-mode` · `quiz` · `fixture-corpus` · the four
`review-*` files.

New tests owed, per the review:
- `modeParam.parse("remember")` succeeds; `"review"` fails.
- `rememberParam` accepts `recall|quiz`.
- `?mode=remember&remember=quiz&thread=…` drops `thread`.
- Opening a Remember thread returns to Recall and clears stale Quiz state.
- The old `review=` key is ignored.
- The built-model-messages diff described above, for all four stances.

### Committed fixture corpus

[260901b](260901b-committed-fixture-corpus.md)'s corpus holds the string:
`tests/fixtures/data-root/data/writes/chat.json` has `"kind": "review"`, generated by
`build-corpus.ts`:432-451 and described in that directory's `README.md`:76. **Generator and output
move together in Stage C**, or the corpus test compares a regenerated fixture against a stale one.

## The baseline, measured before anything was touched

| Gate | State at 06:55, before any edit |
|---|---|
| `npm run typecheck` | **6 pre-existing errors** — `all-skipped-publication-refusal`, `diagram-step`, `diagram`, `public-dto`. None in a file this rename touches. |
| `npm test` | **14 failed / 7932 passed**, 10 files. Pre-existing. |
| The four `review-*` files + `fixture-corpus` | **79 tests, all green.** |

The gate is *those stay green and the counts above do not get worse* — not "everything is green",
which is not true today and is not this job's to fix.

## The collision this plan works around

Another agent is mid-flight on [`src/db/schema.ts`](../../src/db/schema.ts), the drizzle ledger and an
uncommitted `0047`. Their file set (`src/jobs.ts`, `src/store/pg.ts`, `pg-revisions.ts`,
`pg-session.ts`, `artifacts-pg.ts`) is disjoint from this one **except `schema.ts` and `drizzle/`** —
which is exactly Stage C, and exactly why Stage C goes last and waits.

## The simpler options passed over

- **Rename the UI label only.** Rejected by Greg for the `hierarchy` rename on 2026-08-31 and the
  reasoning carries: two names for one concept taxes every reader of this repo.
- **Keep a `?mode=review` alias.** Rejected under Greg's licence; and an alias would squat on a name
  adjacent to a live, unrelated mode.
- **Do nothing, since Referee took a different name anyway.** Addressed above — weaker case than the
  first draft claimed, still a real one.
- **Expand/migrate/contract instead of a maintenance window.** Rejected: it is the dual-accept
  compatibility layer the licence exists to avoid, for a window nobody is in.

## What "done" looks like

The first draft's criterion — *no occurrence of the mode sense of "review" outside plans and
postmortems* — **is impossible**, as the review pointed out: Greg's own quotations inside the renamed
doc, live links to `260827ah-review-mode.md`, shipped migrations, old snapshots, historical telemetry
and committed eval outputs are all legitimate survivors. Chasing a clean grep would mean corrupting
history.

Replaced with: **no old live identifier, accepted wire value, URL key, user-facing label, current
normative prose, or generated current-schema artefact remains** — with an explicit allowlist for
historical paths, quotations, shipped migrations, snapshots, telemetry and eval results, which is
§ *Not renamed* above.

Plus:
- The test set above green; typecheck no worse than baseline.
- The built-model-messages diff shows the four stances unchanged.
- Production migrated, row counts reported.
- A reader can open Remember mode in the running app and complete a turn — checked in a browser.

## What the review changed

Nine findings taken, one part-taken. Recorded so the next reader sees the plan's own error rate.

| # | Finding | Outcome |
|---|---|---|
| 1 | Stage B disagrees with the database; `23514` on every insert | **Taken** — discriminant moved wholly into Stage C |
| 2 | Production has an incompatible window; plan chose neither remedy | **Taken** — maintenance window, chosen explicitly |
| 3 | "Exactly one database home" is false — `feedback.diagnostics` | **Taken** — path documented; existing rows an explicit exception |
| 4 | The filesystem snapshot's real Remember thread was missed | **Taken** — flagged for Greg's permission before Stage C |
| 5 | "More justified" is rhetoric; `MODES` is not dock order | **Taken** — rationale rewritten, factual error corrected |
| 6 | Prompt body claim true; "cannot regress" false | **Taken** — replaced with a deterministic message diff |
| 7 | Sub-mode rename needs both URL registrations, and tests | **Taken** — plus `url-state.md` gains both sub-mode keys |
| 8 | Migration SQL right, migration *plan* incomplete | **Taken** — seven-step checklist, journal tail re-read |
| 9 | Test baseline understated; live sites omitted | **Taken** — full list, incl. `vocabulary.ts`'s model-visible term |
| 10 | The "done" grep condition is impossible | **Taken** — replaced with the allowlist formulation |

**Part-taken:** the review offered "leave every persisted literal as `review` in Stage B" as an
alternative to merging the stages. Both are taken — the literals stay put *and* the discriminant moves
to Stage C — because the other agent's hold on `schema.ts` makes merging B into C wholesale
impossible right now.
