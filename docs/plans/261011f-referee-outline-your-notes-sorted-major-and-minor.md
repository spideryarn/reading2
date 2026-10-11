# Referee › Outline: your own notes, sorted major and minor by you, copied out in your words

Up: [plans.md](../project/plans.md) · Mode doc: [referee-mode.md](../project/referee-mode.md)

Overseer queue item `qi-5fn7stsv`, session `fbh5aypq-referee-notes-skeleton`. Idea 4 (D in the
question) of
[261009b](../research/261009b-what-a-peer-reviewer-needs-and-where-sources-and-referee-divide.md).

## Goal, context

Greg, 2026-10-10, answering q-fkq30v part 4 (reply `spya-dbfeqh`):

> 4 all? Use your judgment based on that combination of ease and value.

Idea D, as the research put it: *"The reviewer marks each of their own comments major or minor.
Then they take them out as a skeleton, in their own words only: summary, major, minor. This is
step 5, with nothing written for them."*

A referee's report is, almost everywhere, a short summary, then major concerns, then minor ones. A
referee using Spideryarn already writes their notes as comments on passages. Today nothing helps
them get from *forty notes scattered down a paper* to *the shape of a report*, and the only way out
is the whole-article export.

## Why this is not the scaffold Greg vetoed

On 2026-08-31 Greg ruled out a **"draft my referee report"** scaffold — *"a scaffold collecting
flagged passages into report structure"* ([260831an](260831an-referee-mode-for-peer-reviewers.md),
appendix). The same night's constraints said *"a plain comments-export may come later"*
([ideas-fable.md](../research/260831e-helping-peer-reviewers/ideas-fable.md)). This is that plain
export, and three rules keep it on the right side of the line, each enforced in code:

1. **Only the reviewer's words go out.** The comment's `body`, and the passage it is on, in quote
   marks, as the author wrote it. Never a model's answer on a comment, never a chat, never a
   Structure heading (those are model-written — so a passage is located by its quote, not by a
   heading), never a Mirror remark, never a criterion's model hits.
2. **The reviewer sorts; nothing sorts for them.** Major or minor is a field only the reviewer
   writes. There is no suggestion, no default other than *not sorted yet*, and no model call
   anywhere in the sub-mode.
3. **The summary heading is left empty.** *Summary* is printed with nothing under it but a
   placeholder saying it is theirs to write.

## What the reviewer sees

A sixth Referee chip, **Outline**, after Mirror (step 5 of the job comes after the close read and
the second look; Candidates is the editor's and Hidden text the least-used, so both stay last).

```
 [Criteria][Claims][Mirror][Outline][Candidates][Hidden text]   ⚠ Notices   (i)

 Sort your own notes into major and minor, then copy them out as the bones of your report.
 Only your words go out — nothing here is written for you.               [ Copy outline ]

 Not sorted yet (3)
   "the gains hold across all six benchmarks"                     [Major] [Minor]   ↗
   Only four of the six are in Table 2.
   …
 Major (2)
   …                                                              [Major✓] [Minor] ↗
 Minor (5)
   …
 2 highlights with no words of yours are left out.
```

Each row: the passage (quote, truncated), the reviewer's words, a two-button toggle (press the
lit one again to un-sort), and a jump into the piece. Rows are in reading order within each group
(the drawer's order, `comment-nav.ts`).

**Copy outline** puts plain text on the clipboard:

```
Summary
[Yours to write.]

Major
1. Only four of the six are in Table 2.
   On: "the gains hold across all six benchmarks"

Minor
1. …

Not sorted yet
1. …
```

Plain text rather than Markdown because it is pasted into a journal's web form, which renders `**`
literally. *Not sorted yet* is copied too, last, rather than silently dropped: a note the reviewer
wrote and forgot to sort should be in front of them, not missing.

**Which comments count:** every comment of this reader's on this article that has words — review
comments (with a criterion) and reading notes alike, because both are the reviewer's notes. A bare
highlight or bookmark has none of the reviewer's words, so it is counted in a line and not listed.
A comment with words is listed whether or not it is anchored to a quote (a whole-paragraph note is
located by the paragraph's opening words, as the drawer does — `passageOf`).

## Key decisions, and the simpler options passed over

- **A field on the comment, not colours or criteria.** Colour already means something else (a
  highlight); reusing it would braid two meanings. A criterion is a scale with poles; major/minor is
  not one. So: `comments.severity text check (severity in ('major','minor'))`, nullable, with
  `severity_at` beside it ("store when it happened"). The type is
  `Comment.severity?: "major" | "minor"`.
- **Its own operation and route**, `patchSeverity` and `PATCH /api/comments/:slug/:id/severity`
  with a required `severity` key (`null` un-sorts) — the house rule for patch routes
  ([comments.md § the five operations](../project/comments.md#the-five-operations-and-why-there-are-five)):
  absent must never mean *clear*. A copy of `patchColour`'s shape. Does not touch `updatedAt`, which
  means *the words were edited*. Not set on `create`: sorting is a later step, and keeping it out of
  `create` keeps the 409 idempotency comparison unchanged.
- **Sorted only in the Outline panel, not also in the comment boxes.** The simplest version: one
  place to sort, at the moment of writing the report. Adding the toggle to the draft box and
  `CommentDialog` is a later step if the reviewer asks for it; it would mean touching two of the
  most-edited components in the app.
- **No stored summary box.** A text box for the summary would be a new stored thing per article;
  the empty heading costs nothing and the reviewer writes the summary where they write the report.
- **No new store, no export work beyond one line.** `src/store/export.ts` builds the comment row
  from a hand-written list, so `severity` is added there (it says so in its own comment); import
  reads it back through the same type.
- **Shared links do not carry it.** `publicCommentsQuery` names its columns, so the field never
  reaches a visitor. A reading note the reviewer sorted still goes out on a shared link as a plain
  reading note, exactly as it does today — this change adds no exposure. Whether a *sorted* note
  should be withheld like a criterion-placed one is a defence change
  (`PUBLIC_COMMENTS_WHERE`, [security-map.md](../project/security-map.md)) and is written up for
  Greg rather than made here.
- **Behind the experimental switch like the rest of Referee** (Greg, q-fkq30v 3B).

## Coordination

`fbh5aypq-referee-promises-starters` (qi-2dxtedww) is renaming Claims to Promises in the same
registries (`referee-views.ts`, `sub-modes.ts`, `activation.ts`, `RefereeMode.tsx`). Both add or
change a key in the same `Record`s, so a merge conflict there is expected and mechanical.

## Stages

1. **Store and route.** Migration, schema, type, `toComment`, `patchSeverity` in the contract and
   `pg-comments.ts`, the route, the export line, `useComments.sort(id, severity)` queued like
   `recolour`. Tests red first: a route test that `PATCH {}` is a 400, `{severity:"major"}` round
   trips, `null` clears, `"huge"` is a 400, another owner's comment is a 404; the export test
   carries the field.
2. **The sub-mode.** `outline` in `REFEREE_VIEWS` and every `Record` the compiler then names;
   `OutlinePanel.tsx` (pure function `outlineText(comments, blocks)` for the clipboard, tested on
   its own: never contains an `answer`, a citation, or a Structure heading; empty summary; reading
   order; unsorted last); the band passes `comments` and the sort callback. Help page and
   referee-mode.md § the six sub-modes.
3. **Browser pass** in a Sonnet subagent, with screenshots; GPT Sol code review; land.

## Done looks like

A referee with notes on a paper opens Outline, sorts them, presses Copy, and pastes a plain-text
skeleton whose every sentence they wrote, in reading order under Major, Minor and Not sorted yet,
under an empty Summary.
