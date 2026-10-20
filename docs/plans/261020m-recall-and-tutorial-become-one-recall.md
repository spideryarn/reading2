# Recall and Tutorial become one Recall

Up: [plans.md](../project/plans.md)

Report `spya-gtzeqm` (#636, Sentry SPIDERYARN-READING2-M1, queue item `qi-wbwgnc7g`), from an
admin, so trusted input:

> Can we collapse Recall and Tutorial to get the best of both worlds (and reduce the number of
> sub-modes)?
>
> — Greg, 2026-10-19 (spya-gtzeqm)

## What changes for a reader

Learn's chips go from **Recall · Tutorial · Explore · Quiz** to **Recall · Explore · Quiz**.
Recall is one conversation that does what both did:

- **A reader who has read it** says what they took from it, and Recall works as now: at most one
  correction, quoted and cited, then a nudge to remember a little more, with its passage link and
  its Hint button.
- **A reader who has not read it, or remembers nothing**, is no longer stuck in the wrong chip.
  Recall starts them from zero, the way Tutorial did: the piece's main claim in a sentence or two,
  cited, then a question they can answer without having read it. From then on it **teaches one
  small cited piece and asks them to do something with it** — say it back, say why, give a case,
  apply it — climbing when they succeed and stepping down when they don't.
- **Both** get Tutorial's reach-back (an earlier point comes back by the fourth reply) and its
  "adapt to who they are" (an expert is taken to the passage their goal is about; a newcomer gets
  plain words and small steps).
- The empty conversation's invitation says both: tell me what you took from it, **and it's fine if
  you haven't read it yet**.
- Recall keeps everything Tutorial lacked: the Hint button, Live voice, Recall's entitlement rules
  for corrections.

Old links keep working: `?learn=tutorial` opens Recall, and a Chat answer that carries an
*Open Learn › Tutorial* chip (stored model text) opens Recall too. A reader's stored Tutorial
conversation is folded into their Recall conversation on that article (below), so nothing they said
is lost or hidden.

## Why keep Recall's name, not Tutorial's

Opus, asked separately on 2026-10-20, came to the same answer for the same reasons (and pointed
out Greg's own words in `spya-c8x66d`, *"there's really only one recall mode"*). The weak point,
a reader who has not read it not clicking "Recall", is fixed in the copy, not the name.

- **The principle Greg keeps returning to is recall.** *"the act of recollection is what helps
  learning"* (`spya-c8x66d`); Tutorial was always the teaching end of the same exchange
  ([learning-vision.md](../project/learning-vision.md)). The merged mode's default path is the
  reader speaking first, which is Recall's shape.
- **It is the default chip** (`?learn=` omitted means Recall), the one with the data (9 threads in
  production against Tutorial's 2), the Hint button and Live.
- **Far less churn.** Recall's identifiers are the thread kind `learn` and the URL value `recall`;
  keeping them means Tutorial is **retired** rather than anything being renamed. Taking Tutorial's
  name would rename `recall` → `tutorial` in the URL and, all the way down, `learn` → `tutorial` in
  the stored thread kind, the unique index, `SpokenKind`, the hint code and every test.
- The one thing Tutorial's name did better — telling a reader who has not read it that this is for
  them too — moves into Recall's chip card and empty-state invitation.

If Greg prefers "Tutorial" as the word on the chip, that is a label change in `sub-modes.ts` and
the cards; no stored value depends on the label. The feedback note says so.

## The prompt — what each side brings, and the conflicts settled

`LEARN_SYSTEM` stays the base (it is the one voice Greg asked for in `spya-c8x66d`, and the hint
contract with `splitHint` lives in it). `TUTORIAL_SYSTEM` is deleted; what it had that Recall lacks
is written into `LEARN_SYSTEM`:

| From Tutorial | How it lands in Recall |
|---|---|
| HOW TO START (not read / nothing / a goal) | A new HOW TO START section, near-verbatim |
| One small cited piece, then one task | The **fill-the-gap** branch of ADAPT: when it tells, it teaches one piece and the nudge becomes a task about it |
| Task ladder (say it back → why → example → apply → connect), author first, own view rationed | The kinds of nudge, with Tutorial's ration on own-view questions |
| Reach-back by the fourth reply | A short COME BACK TO EARLIER POINTS |
| ADAPT TO WHO THEY ARE | Kept, shortened |
| Point to Explore when they go exploring | Kept |
| Good questions teach / no gimmes | Folded into what a nudge is |

Conflicts the merged prompt settles explicitly (several from Opus's read of both prompts):

1. **Teach or cue.** Recall's cue names "where and what it was about, never what it said";
   Tutorial teaches the content. → **Teach** when the reader has not read it, remembers nothing,
   is stuck, or a nudge failed (Recall's fill-the-gap cases); **cue** otherwise. A teaching turn is
   one small cited piece, then a task about it.
2. **Length.** Recall: 60–100 words, 120 ceiling, before the hint. Tutorial: under 100, 140
   ceiling. → One number: 120 before the hint, which fits a reaction, a two-or-three-sentence
   piece and a task. The hint's 25 words are on top, as now.
3. **One question.** Both say exactly one interrogative sentence, last. Unchanged; the task *is*
   the nudge.
4. **Which questions carry an id and a hint.** A question whose answer is in the article (why,
   what comes next, connect, apply, the reach-back) carries its passage id and a hint, as Recall's
   nudge does now. Four kinds carry **no hint**: the not-read reader's opening prediction, a question
   asking the reader's own view, a say-it-back (whose answer is the turn just written, so a hint
   would be a gimme; its id is the piece's, already given), and an application to a case the article
   does not discuss (which cites the passage its reasoning starts from). The opening prediction and
   own-view question carry **no id**. `splitHint` fails open, so a reply without a hint is drawn as
   written. The eval counts a hint on a say-it-back as a defect.
5. **"Do not restate what they said" vs "confirm a specific thing".** Compatible, and said so:
   confirm a claim of the article, never echo the reader's words.
6. **Framing that assumes they have read it.** The opening ("The reader has just read an
   article") and the tools line ("whether they have read THIS PIECE correctly") are rewritten to
   cover a reader who has not.
7. **The opening line.** `readItFor("learn")` takes Tutorial's offer: *"…It's fine if you haven't
   read it yet, or haven't finished."*
8. **Tutorial's recency line** (`lengthLine("tutorial")`) is what took its opening turns from
   uncited to cited. → Recall gets one, in Tutorial's words adjusted for the hint, and the eval
   says whether it earns its place.

Easy to lose, and kept: from Tutorial, "background the piece assumes, said to be yours", "explain
again more simply with a concrete example", good questions teach and no gimmes, the pointer to
Explore; from Recall, the whole entitlement section, the tone list, "fluency is not evidence —
when unsure, TELL", and "honour a request not to reveal what comes later".

**learn-mode.md § Why this one is not the anti-goal** rests on Recall being unusable unread. That
guarantee goes; the section is rewritten to the weaker one Tutorial had (every piece taught is a
short cited quotation, the reader sent into the passage), with the eval as its check.

## Stored data

Production, read-only on 2026-10-20: 9 `learn` threads (54 messages), 2 `tutorial` threads (6
messages), one article that has both.

One migration, in the shape of the two that came before
([`20261001143901_remember_one_thread.sql`](../../drizzle/20261001143901_remember_one_thread.sql)'s
fold and [`20261006035355_rename_remember_thread_kind_to_learn.sql`](../../drizzle/20261006035355_rename_remember_thread_kind_to_learn.sql)'s
order of DDL):

1. lock `chat_threads` against writers;
2. on an article with **both** a `learn` and a `tutorial` thread, move the Tutorial thread's
   messages **into the Recall thread**, conversation by conversation, after the Recall thread's
   last ordinal, each keeping its own order, never interleaved by timestamp (the earlier fold's
   reasoning); repoint `realtime_sessions.thread_id` and `comments.thread_id`; delete the emptied
   thread row; refuse (RAISE) if a moved thread has an answer in flight;
3. every remaining `tutorial` thread becomes `learn` (`UPDATE … SET kind`), keeping its id, title,
   timestamps and messages;
4. drop `chat_threads_one_tutorial`, and re-add the `chat_threads_kind` CHECK without `tutorial`
   — the postcondition: a surviving `tutorial` row fails the whole migration, which is one
   transaction.

Nothing a reader wrote is deleted: every message survives, in a thread the screen shows. The thread
row deleted in step 2 is empty by then. Keeper is the Recall thread rather than "the earliest",
because its id is the one the Recall screen, Live sessions and `?thread=` links already name.

This is the "an ordinary migration" case in CLAUDE.md, not the destructive one, but it moves rows a
reader created, so it is called out here and in the commit for Greg to see. The deploy applies it;
this work does not touch production.

Old code still running between the migration and the code (the usual deploy window) that inserts a
`tutorial` thread fails the CHECK — one failed turn, fixed by a reload. Old code reading a folded
row is fine: the kind is `learn`, which it knows.

## What goes in the code

The kind `tutorial` leaves the type, so the compiler finds most of the rest:

- `ThreadKind`, `THREAD_KINDS`, `SINGLE_THREAD_KINDS`, `LEARN_KINDS` (src/types.ts); the schema's
  CHECK and index (src/db/schema.ts); `storedThreadKind` then refuses a stray `tutorial`.
- `systemFor`, `readItFor`, `lengthLine`, `TUTORIAL_SYSTEM` (src/converse.ts);
  `MAX_LEARN_CHARS`' kind test and the request-kind validation (src/routes.ts); chat-tools,
  reader-notes, live, export, wider-world, chat-principles where they name it.
- Web: `LEARN_VIEWS` drops `tutorial`, and **`?learn=tutorial` parses to `recall`** with the URL
  rewritten (the alias, as `?mode=trajectory` → Skim does); `sub-modes.ts`'s chip and card;
  `LEARN_VIEW_HOW` in QuizPanel.tsx; ChatPanel's `TutorialInvitation` folded into Recall's empty
  state; `useChat`, `thread-source`, `chat-draft`, `activation`, `command-runners`; the command
  catalogue (`submode:learn:tutorial` gone from what chat may propose, **still parsed** as Recall
  for stored answers); `mode-catalog.ts`'s Learn sentences; FeaturesPage; LearnAbout.
- Evals: `evals/learn-tutorial.ts`'s three scripted readers (not read / remembers some / expert
  with a goal) are kept as the multi-turn half of the merged eval, run against kind `learn`;
  `evals/learn-recall.ts` stays as the single-turn half.
- Docs: learn-mode.md (Tutorial's section becomes the history of where these parts came from),
  learning-vision.md (three sub-modes), the help page, mode.md if it lists the chips,
  experimental-features.md, and every doc a sweep finds (rename-or-move.md's sweep, by a cheap
  subagent, fragments included: `tutorial`, `Tutorial`, `TUTORIAL_`, `Learn › Tutorial`).
  The word *tutorial* in `docs/tutorials/` and `write-tutorial.md` is unrelated and stays.

## Stages

1. **Prompt and eval.** Write the merged `LEARN_SYSTEM`; adapt `evals/learn-tutorial.ts` to run
   kind `learn`; run both evals on the old prompts (baseline — Recall on its 13, Tutorial on its 3×5)
   and on the merged one; read every answer. Done when the merged prompt is at least as good as
   Recall on the 13 and as Tutorial on the 3×5 (ids cited, length, one question, no praise, the
   not-read reader started from zero), with the comparison written up in
   `docs/investigations/`. Commit.
2. **Retire `tutorial`.** Migration, types, server, web, the URL and command aliases, tests,
   docs. Done when typecheck and the touched suites are green, the migration runs on the local
   database with a fixture holding both kinds on one article, and a browser pass (Sonnet subagent,
   Playwright on the box) shows three chips, `?learn=tutorial` landing on Recall, and the new
   invitation. Commit.
3. **Code review by GPT Sol (workspace-write)**, then the full `npm test`, push to `dev`, and the
   feedback bookkeeping.

## Simpler options passed over

- **Hide the Tutorial chip and leave its threads and prompt alone.** Cheapest, but it is not "the
  best of both": a not-read reader would land in Recall's prompt, which assumes they have read it.
  And it leaves a dead kind in the type and the CHECK, which the rename rule forbids.
- **Leave stored `tutorial` threads as they are and stop showing them.** Hides 6 messages a reader
  wrote; Chat would still list them, leading nowhere.
- **A switch inside Recall ("I've read it" / "teach me").** A sub-mode by another name; the
  report asks for fewer.

## Deferred

- Live voice tuned for teaching turns — Live uses its own prompts, not `LEARN_SYSTEM`, so the
  merged Recall's Live is as Recall's was.
- Telling the model whether the reader opened the last hint (still open from 261004h).

## Changed by GPT Sol's plan review

[261020m-recall-tutorial-plan-review-sol.md](261020m-recall-tutorial-plan-review-sol.md), eleven
findings, verdict "revise before build". What each changed:

- **F1 (mentions block the fold)** — `chat_mentions` keys on `thread_id` with `ON UPDATE NO
  ACTION`. Production has none on a Tutorial message (read-only, 2026-10-20), and the route allows
  mentions only in Chat. → The fold **RAISEs** if a message it would move has a mention, naming
  it; nothing is changed. No cascade added for a case that cannot arise.
- **F2 (a hint on an inference question)** — a question about a case the author does not discuss
  has no passage that answers it. → The prompt splits *apply to a new case* from *questions the
  article answers*: the first is framed as reasoning from the piece, cites the passage it starts
  from, and carries **no hint**.
- **F3 (unsettled conflicts)** — taken: "not a teacher" becomes "not a marker, not a lecturer";
  a *cue* stays topic-only and only a *taught* turn's question may carry structure; after filling
  a **failed** recall the next task is a different or smaller one, never a say-it-back of the
  answer just supplied; a say-it-back is for a piece newly taught.
- **F4 (old export files)** — mirror whatever `remember` got: the file-side kind normaliser maps
  `tutorial` → `learn`; where a file holds both, the Tutorial messages are appended to the Recall
  thread as the SQL fold does. Test with a bundle holding both.
- **F5 (offline cache)** — one client-side normaliser where thread kinds are read from a cached or
  fresh `/api/chat` body, mapping `tutorial` to `learn`; with both in a stale cache, the Recall
  thread is the one shown. Test it.
- **F6 (URL)** — `?learn=tutorial` is lifted in the router's existing legacy-lift path (the one
  that takes `?mode=trajectory` to Skim), and the remembered last view goes through it too.
- **F7 (stored command chips)** — production has **no** stored answer carrying
  `submode:learn:tutorial` (read-only, 2026-10-20). → **No alias at the live-door check**, which
  is a defence ([security-map.md](../project/security-map.md)) and stays untouched; an old chip,
  had one existed, is inert as any retired target is. "tutorial" stays a typed **search word** for
  Recall in the command bar, which is not the defence.
- **F8 (keeper metadata)** — taken: the kept thread's `updated_at` becomes the later of the two,
  and its `gist`/`gist_at` are cleared, since the transcript they summarised has grown. A
  Tutorial-only thread keeps all its metadata. The migration test covers both cases, ordinals with
  a gap, a comment and a realtime session repointed, a pending answer refused, and the
  CHECK/index afterwards.
- **F9 (deploy window)** — expand-and-contract declined: two threads, a beta, and "briefly broken
  is fine" for prod minutes. Taken in part: **a permanent wire alias** — a request that says
  `kind: "tutorial"` (a tab open across the deploy) is read as `learn`. Stated accurately: between
  the migration and the new code going live, an old server instance that tries to *start* a
  Tutorial thread fails the CHECK, and a reload helps only once the new code is serving.
- **F10 (evals and the footprint)** — the evals that name Tutorial are updated to compile and
  point at Recall; only the two Learn evals are re-run. The multi-turn eval now counts hints, and
  a hint after a say-it-back is a defect. The four-chip assumptions in tests and CSS are in
  stage 2's sweep.
- **F11 (the name's reasoning)** — fair: churn is not a reason for a label. The reason is the
  product one (§ Why keep Recall's name).

## What landed

- **Stage 1 (prompt and eval)**: three drafts measured against both evals —
  [261020c](../investigations/261020c-merged-recall-prompt-against-recall-and-tutorial-evals.md).
  One change beyond the plan: the second draft taught a say-it-back to every stuck reader, which
  for one who *has* read the piece replaces recall with repetition. So a say-it-back is now for a
  reader who has not read it; a stuck reader who has gets a cue, a why or a connect after the gap
  is filled.
- **Stage 2 (retire `tutorial`)**: as planned, in commit `5d5d9da91`, built by a subagent and
  read by me. The migration is
  [`20261020063618_fold_tutorial_into_recall.sql`](../../drizzle/20261020063618_fold_tutorial_into_recall.sql).
  There is no bundle *importer* in the app, so F4's file-side fold lives in `loadThreads`, the
  `chat.json` reader the test seeding uses. `quiz.css`'s narrow-head tightening now starts at three
  chips, which the browser pass checks at phone and iPad widths.

**A correction to the numbers above.** The first reads quoted here as "production" went through the
Supabase MCP tool, which on the box reaches the **local** stack (`127.0.0.1:54361`), not
production. They were re-read from production itself, read-only, the way
[database.md](../project/database.md) describes: 9 `learn` threads (54 messages), 2 `tutorial`
threads (6 messages), one article with both, and on the Tutorial side no stored
`submode:learn:tutorial` chip, no mention, no renamed title and nothing pending. The decisions that
rested on them stand; the Recall counts are corrected above.

## Changed by GPT Sol's code review

[261020m-recall-tutorial-code-review-sol.md](261020m-recall-tutorial-code-review-sol.md), seven
findings, verdict "revise before merge". It fixed F3, F4, F6 and F7 itself; I read its diff.

- **F1 (a reader's title lost in the fold)** — Learn conversations cannot be renamed from any
  screen, and production has no renamed Tutorial or Recall thread. → The migration now refuses,
  changing nothing, if a Tutorial thread it would fold has `renamed_at`, as it refuses a mention
  or an answer in flight. Red test first. (The local database had run the file before this edit,
  so its one ledger row was restamped after checking the postcondition in the catalogue, per
  [database.md § A watermark is not a ledger](../project/database.md#a-watermark-is-not-a-ledger).)
- **F2 (the prompt both allowed and forbade a reply with no question)** — taken: LENGTH now says
  at most one, usually one, none when the reader asked to be told and no question would help; the
  recency line says the same.
- **F3, F4 (fixed by the reviewer)** — an application to a case the article does not discuss is
  named beside the opening question and the own-view question as allowed; the no-gimmes rule
  names the say-it-back for a not-read reader as its deliberate exception.
- **F5 (reading-view-overview.md still said Learn cannot be used to avoid reading)** — corrected.
  It is a signposting line's description, not a rule's wording.
- **F6 (no test of the duplicate-id refusal)** — the reviewer added one; it passes on the local
  database.
- **F7 (names)** — fixed by the reviewer.
