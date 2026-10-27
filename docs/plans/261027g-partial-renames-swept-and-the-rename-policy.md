# Partial renames, swept once, and what the rename policy was missing

Asked of the Overseer by Greg, 2026-10-27 (lightly de-typo'd; "harshly" is a dictation slip for
"partially"):

> Just a couple of things on my mind about tidying up. Firstly, have we done any renames that were
> only partially applied? I ask because having stuff that's renamed in the UI for example but not
> elsewhere could lead to inconsistencies that be confusing and impair development for future
> agents. Let's write this up as a skill that we can run every month or so and then delegate to an
> agent to run it, looking for this and really any other tidy ups that are going to improve future
> development and make the code base easier to understand, maintain and extend.

And then, the same day, before the skill was written:

> maybe we don't even need to run the rename sweep monthly. Maybe we could just signpost to it from
> a relevant place so that going forwards whenever we do a rename we rename in a pretty kind of
> complete way. So maybe it's less about a sweep and more about a policy about renames. Use your
> judgment.

So there is no new skill doc. This plan records the one-off sweep, and
[§ What the policy was missing](#what-the-policy-was-missing) proposes the change to
[rename-or-move.md](../reusable/rename-or-move.md) that would have prevented what it found. That
doc is a rule doc, so the change waits for Greg.

## Answer: which renames were only partly applied

**Most code and database renames were carried through; the prose lagged.** The exceptions below
include deliberately retained `tweets`, Bibliography's `investigate`, Outline's implementation
names and the chat tool `article_citations`, plus compatibility aliases and columns awaiting
contract. What this sweep changes is mainly the **product word in comments and docs**.
An identifier rename changes `DebatePanel` to `ReceptionAndClaimsPanel` and
leaves "the Debate's rows" in the comment above it. In the worst case, several hundred comment and
doc lines still called Sources' Reception and Claims "Debate" (nominators' estimate, 2026-10-27).

| Rename | Date | Code, files, routes, DB | Prose leftovers found | Fixed here |
|---|---|---|---|---|
| Trajectory → Skim | 2026-10-01 | complete | none | — |
| Annotations → Marginalia | 2026-10-01 | complete | none | — |
| review → remember → Learn | 09-01, 10-06 | complete | none | — |
| Tutorial folded into Recall | 2026-10-20 | complete | 3 lists of thread kinds | yes |
| Steer → profile | 2026-08-30 | complete | an orphan doc comment for the removed field, 2 comments | yes |
| Open glossary → Open in Glossary | 2026-10-10 | complete | the Help screenshot still shows the old label | no — re-shoot (F6) |
| Tweets mode → Summary's Thread view | 2026-10-03 | **step, column, route and files still `tweets` on purpose** (261003l) | ~15 comments, docs and test titles calling it a mode or band | prose yes; the identifiers are F1 |
| toc → hierarchy → structure (the step) | 08-29, 10-02 | complete (`toc/N` prompt tags kept on purpose) | — | marked the tags as deliberate |
| Hierarchy mode (gist columns) retired | 2026-09-29 | complete | ~25 present-tense comments and doc lines, the changelog prompt's list of bar modes, fixture versions `hierarchy/4` | yes |
| Outline mode → Structure's list face | 2026-09-10 | **`OutlinePanel.tsx`, `outline.ts`, `.outln-*` keep the name**, said in the header | "outline mode" where Plain was meant | prose yes; the files are F3 |
| Peer review → Sources | 2026-10-09 | complete | none | — |
| Citations → Sources' Bibliography | 2026-10-09 | complete except the retained chat tool `article_citations` (F4) | ~75 prose lines, 4 test titles, a fixture id | yes |
| Debate → Sources' Reception and Claims | 2026-10-09 | complete; legacy columns and routes are in their contract window (qi-mzfxw3q2, in progress) | several hundred lines | the capitalised mode word fixed; lowercase "a debate" for the stored artefact remains, mostly in tests (F5) |
| Referee's Claims → Promises | 2026-10-11 | complete | none | — |
| Investigate → *Dig deeper* (Bibliography) | 2026-10-01 | **code keeps `investigate` on purpose** (bibliography.md § the names) | ~100 comments, and since 2026-10-20 **Sources › Investigate is a different, current thing** | prose yes; the identifiers are F2 |
| Updates → *Adds to it* | 2026-10-26 | complete | none | — |
| `npm run pdf` → `eval:pdf-read` | 2026-09-05 | complete | **a live CLI error message still named `npm run pdf`** (src/fetch.ts) | yes |

Found on the way, the same family: 19 comments citing test files by a path that had since moved
(mostly `.ts` → `.test.ts`, and `orchestrator-direction.md` → `overseer-direction.md`). All fixed.

Sweep method: five Sonnet nominators, one per rename family plus one for renames nobody had listed
and for dead file pointers, each given the same brief (what counts as history, alias or ordinary
English; FIX / ASK / BIG). Searched `src/ tests/ scripts/ tools/ evals/ docs/project/
docs/reusable/` and `package.json`. Skipped as history: `docs/plans/`, `docs/postmortems/`,
`docs/user-feedback/`, `docs/research/`, `docs/investigations/`, `docs/tutorials/`,
`evals/results/`, `drizzle/`, `*.generated.*`. Left alone because other sessions were in them:
`src/pipeline.ts`, `src/db/schema.ts`, `src/profile.ts`, `src/store/pg-chat.ts`, every `skim` path.
Blind to: anything that is not a grep match, which includes screenshots.

## What was left on purpose, and is now marked where it lives

A leftover that does not say why it is there cannot be told from a missed one, so the next sweep
re-flags it. Each of these got a comment naming its reason and plan: `hierarchy` in
`src/feedback-payload.ts`, the `toc/N` prompt tags (`src/structure-slices.ts`), `data-outline-rung`
(`src/web/OutlinePanel.tsx`), the "trajectory" command-pick phrasings, `src/web/Tweets.tsx`, the
`citations.json` test fixture loader, the `simple` step (`summaries.md`), the Dig deeper refusal
strings kept for old tabs (`src/messages.ts`), and `src/web/InvestigatePanel.tsx`, which shares a
word with Bibliography's `investigate` route.

## Follow-ups, not started

Each needs Greg, because it touches a stored value, a route or a URL, or because it is big enough to
want its own plan.

- **F1. `tweets` → `thread` all the way down.** The screen says Thread; the step, the
  `article_revisions` column, `/api/tweets`, `src/tweets.ts`, `Tweets.tsx`, `TweetsMode.tsx` and
  `useTweets` say `tweets`. Plan 261003l kept them, three days before Greg's 2026-10-06 rule that a
  rename on screen is a rename all the way down. The Skim and Sources renames are the template.
  **Recommend: do it**, as its own plan.
- **F2. Decide the future of Bibliography's retained `investigate` server half.** `makeInvestigateCitation`,
  `citation-investigate*.ts`, `POST /api/bibliography/:slug/:id/investigate` and the
  `citation_investigations` table retain the former *Dig deeper* action's names. Its button was
  removed on 2026-10-09; the server half and stored answers remain pending Greg's removal-or-reuse
  decision ([261009k D5](261009k-ask-in-chat-replaces-dig-deeper-and-a-chat-goes-back-to-its-item.md)).
  Since 2026-10-20 "Investigate" is also a Sources sub-mode, so the retained names are ambiguous.
  **Recommend: settle D5 first**; if this server action is kept, rename it in its own plan, with a
  migration for the table.
- **F3. `OutlinePanel` / `outline.ts` / `.outln-*` → Structure's list face**, about 20 files, no
  stored values. Marked deliberate today. **Recommend: do it when Structure is next touched**,
  otherwise leave.
- **F4. Two smaller names.** The chat tool `article_citations` lists the Bibliography; renaming it
  changes a name stored in old chat transcripts. `src/vocabulary.ts` still biases dictation towards
  "gist column" and "granularity zoom". **Recommend: rename the tool with an alias for old
  transcripts; drop the two dictation words.**
- **F5. The rest of "Debate" in prose**: lowercase "a debate" for the stored artefact, mostly in
  `tests/reception-*`, public-DTO and store tests. Mechanical. **Recommend: after the 261009w
  contract lands**, so the two do not collide.
- **F6. Re-shoot `src/web/help/pages/images/glossary-card.png`**, which shows *Open glossary*.

Also found, not a rename: the fleet's recovery panel prints `npx tsx scripts/overseer-launches.ts
dispose …` for a script that has not landed on `dev` (the comment in
`tools/overseer/recovery-resume.ts` says so). Passed to the Overseer.

## What the policy was missing

The rule is already right. [rename-or-move.md § A rename on screen is a rename all the way down](../reusable/rename-or-move.md#a-rename-on-screen-is-a-rename-all-the-way-down)
says *"A grep should find one name, not two."* Most of these renames followed it for the code;
the deliberately retained names and compatibility windows are listed above.
Two things let the prose through:

1. **Nothing says when a rename is finished.** The renames ended when the identifiers compiled and
   the tests went green. Prose cannot go red, so the grep for the old *product word* (capitalised,
   as comments write it) was never run at the end.
2. **Deliberate leftovers were recorded in the plan, not where they live.** So a reader of
   `Tweets.tsx` or `citation-investigate.ts` could not tell a kept name from a missed one, and wrote
   the old word into the next comment because the code still said it.

The proposed change, kept to those two points, is in the report to Greg (before/after) and not
applied here.

## Reviews

GPT Sol's code review of both stages is in
[261027g-code-review-sol.md](261027g-code-review-sol.md).
