# A flag the store did not keep

Up: [postmortems.md](../project/postmortems.md) · plan:
[261009e](../plans/261009e-high-powered-chat-cut-off-at-its-ceiling.md)

When the model's `max_tokens` cuts a chat answer off, chat says so: *"This answer ran out of room
and stopped mid-sentence. Try again."* It says so only to the tab that watched the answer arrive.
The Postgres chat store never had anywhere to put the flag, so after a reload, or on the reconnect
path, the same answer reads as a whole one. **This reached readers**: every cut-off chat answer in
production has lost its warning on reload, for as long as production chat has run on Postgres. How
many there were cannot be counted, because the one fact that would say so was never written down.
Found by an investigation, not a report.

## What happened

`converse` computes `truncated` when the stream ends on `length`. The route puts it on the `done`
frame and on the patch it hands `chatStore.finish` (`src/routes.ts`, the `finished` object).
`ChatPanel` prints the sentence when `message.truncated` is set, and `answerMayAct`
(`src/web/guide-acts.ts`) refuses to let a cut-off guide answer act. But `chat_messages` has no
`truncated` column; `finish` does not set it, `messageRow` does not write it, `toMessage` does not
read it. So the warning lives in browser memory only, and a guide answer that was cut off becomes
one that may act once it is reloaded.

`tests/chat-truncated-stored.test.ts` reproduces it: a stubbed stream stops on `length`, and the
answer comes back from `chatStore.load` without `truncated: true`.

## The history: the field arrived 42 minutes after the store

| When | Commit | What |
|---|---|---|
| 2026-08-26 15:17 | `79ea868c5` | The Postgres chat store: `chat_messages`, `toMessage`, `messageRow`. |
| 2026-08-26 15:40 | `03fb6a98b` | The store's own agent adopts another agent's in-flight `tools` column, because the schema and journal are shared. |
| 2026-08-26 15:59 | `be59cf968` | *"Let chat use tools"* adds `truncated?: boolean` to `ChatMessage`, wires `tools` through export and import, and gives `truncated` nothing. |
| 2026-09-01 | [260831b](../plans/260831b-finish-the-database-move.md) | Production serves every request from Postgres; files cannot run under Vercel. |
| 2026-09-05 | `86a4ef7c0` | The filesystem store is deleted. |

The filesystem store wrote the whole message as JSON, so the flag survived there by construction.
So until `86a4ef7c0` it worked wherever chat ran on files, and anyone checking it there would have
seen the warning come back after a reload. On Postgres it never came back once. Production readers have been
affected since chat first ran there, and paying ones since 2026-09-03.

## The class: a field-by-field mapping drops whatever it does not name

`src/store/pg-chat.ts` converts between `ChatMessage` and a row by listing fields, in three places
(the read half `toMessage`, the write half `messageRow`, and `finish`'s patch). A field nobody lists
is not an error. It is simply absent on the way out, and an absent optional field means "false".

**This file has met the class before.** `tools` went missing from it once (caught in `03fb6a98b`
because its column rode along); `passages` and `interrupted` got a read half in `40ad62725` and no
write half, caught by their author in `43814634e`, whose message calls it *"the class this repo keeps
meeting"*. Each time, the fix was a comment saying *"named here or it does not exist"*, and the
comments multiplied: `help` (`078bf4368`) and `hintOpenedAt` (`35ca72d7f`) were added under the
same warning, correctly. `truncated` is the first one to ship. The rule was written down five times
and checked by nothing. The legacy exporter met the same class with `tools`, `stance`, `criterionId`
and `valence`, recorded in
[260901h](260901h-export-dropped-a-table-the-whole-row-design-was-meant-to-protect.md).

## Why nothing went red

- **The types cannot see it.** Every field involved is optional, and under
  `exactOptionalPropertyTypes` *leaving an optional key out* is always a legal object. `toMessage`
  returns a valid `ChatMessage` whether it names `truncated` or not. Drizzle's `$inferInsert` does not
  help either: with no column there is nothing for it to demand.
- **The tests never crossed the seam with the field set.** Converse's tests check the flag on the
  `done` frame; the panel's tests hand it a message that already carries it. Neither goes through
  the store. `tests/store-roundtrip.test.ts` does go through it, but over the committed corpus,
  which has no cut-off answer, and its coverage check counts artefacts, not fields.
- **The failure is the absence of a sentence.** A cut-off answer that reads as whole looks exactly
  like a whole answer. Nobody watches for a warning that is not there.

## What would have caught it, ranked by ease against value

1. **A round-trip test over a `Required<ChatMessage>`**: build a message with every field set, put
   it through `messageRow` then `toMessage`, expect it back unchanged, and put the same fields
   through `finish`'s patch. A new field on `ChatMessage` will not compile into the fixture until
   it is listed, and once listed fails the round trip until both halves name it. This is the class
   check, and it is being added (`tests/pg-chat-row-roundtrip.test.ts`). It would have caught every
   instance above.
2. **The same test for every store that maps a domain type by enumeration.** Cheap per store. A sweep
   of the other Postgres stores on 2026-10-09 found **one live sibling, not fixed here**:
   `Meta.quality` (`src/types.ts:1831`), the PDF transcription checker's complaints, is neither in
   `metaColumns` (`src/store/artifacts-pg.ts:897`) nor read back by the Meta reader
   (`src/store/pg.ts` ~1931), and has no column, yet `src/feedback-article.ts:297` still reads it.
   Its own comment calls it *"the whole of what is left of that defence"*. Every other mapper names
   all its optional fields. Only `ClaimsRun` already has this kind of test
   (`tests/store-pg-referee-claims.test.ts`, `Record<keyof ClaimsRun, true>`).
3. **Whole-row JSON for the message** instead of columns: rejected. It would make the class
   impossible, but the table is columns-over-JSON on purpose ([sql.md](../project/sql.md)), and
   `stopped` and `interrupted` beside it are queryable booleans. Item 1 buys the safety for one file.
4. **A comment at the mapping** saying *list it in both halves*: rejected as a countermeasure, since
   five of them are already there and this instance happened under them.

## The fix that is right for the long term

`chat_messages.truncated boolean not null default false`, written by `messageRow` and `finish`,
read by `toMessage` as `true` or absent, like `stopped`, and reset by `retry` — a clean finish omits
the flag rather than sending `false`, so without the reset an old `true` would outlive its answer
(GPT Sol's plan review, F2). That is the shipped fix and the right one. The rollback export
(`src/store/export.ts`) and its restore-side seeder were a fourth and fifth enumeration, and were
dropping `passages` and `interrupted` as well as `truncated`; all three are named there now.

What makes it long-term is item 1, built as two tests: the `Required<ChatMessage>` round trip in
`tests/pg-chat-row-roundtrip.test.ts`, and a `finish` patch typed
`Required<Omit<ChatMessage, NotFinishable>>` plus the retry reset in
`tests/chat-truncated-stored.test.ts`. Both were seen red by deleting the line each one holds.
Without them, the next optional field on `ChatMessage` goes the same way.

## The second finding: the ceiling itself

The investigation that found this thought Opus was hitting chat's 4,000-token ceiling. That
cut-off was mostly a harness artefact, but the ceiling is thin for Opus at `high`. Chat on the
high-power model goes to 6,000, as far as the turn's 120-second deadline can follow; explain, at 1,500 on
Opus at `high`, goes to 4,000 (`DIG_ANSWER_TOKENS`). Explain and dig deeper still store a cut-off
answer as a whole one, because `Comment` has no field for it; that is a follow-up for Greg. The
reasoning is in the plan.

## The thing I would tell myself

The field and the store were written the same afternoon by two agents, and the one that added the
field did wire `tools` through the store, in the same commit. So it was not ignorance of the
mapping. It was the assumption that a flag set on the done frame and handed to `finish` had been
saved, because handing it over is the visible half of saving it. When I add a field to a type that
a store maps by hand, I check the store's read half returns it, not that I passed it in.
