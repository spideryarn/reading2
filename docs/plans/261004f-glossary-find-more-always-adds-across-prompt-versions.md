# 261004f: Glossary's Find more adds to a list an older prompt wrote

Report spya-try2v7 (Sentry SPIDERYARN-READING2-C1), Greg, 2026-10-04 10:20 UTC, in Glossary mode
on `/read/entropy-26-00481-with-cover-from-taylor-beck-spya-naz564`:

> In glossary, there's a find terms again button. I don't know what that does. I want a find more
> button that finds a bunch more.
>
> — Greg, 2026-10-04

It is the reaction to [261003c](261003c-glossary-find-more-at-the-top-and-metadata-press-closes.md),
which put the run button at the top of the column and gave it two labels.

## Why he sees *Find terms again*

The button's press is one request, the forced glossary run. What that run does is decided by
`existingFor` in `src/glossary.ts`: it **adds** to the list only when three things match the list
on file — the article, the prompt version, and the reader profile. If any differs, the run
**replaces** the list. 261003c labelled the button by which of the two will happen.

The prompt version is the one that almost never matches. It has been bumped five times since
2026-09-26 (`glossary/5` … `glossary/9`), and every bump turns every existing list into one whose
press replaces it. Greg's list is `glossary/4`. So on most of the shelf, most of the time, there is
no *Find more* at all, only a button that replaces the list and whose name he could not read.

## What we build

**A list written by an older prompt is added to, not replaced.** Same article, same profile, prompt
version `glossary/4` up to the current one: the press appends, and the button says **Find more**.

1. **`existingFor`** stops refusing on a version difference as such. One predicate,
   `appendableVersion(version)`, exported, used by `existingFor` and `panelRunKind`: true for
   `glossary/4` up to the current version.
   - Below 4 refuses: `glossary/1` is another entry shape (the case the refusal was written
     for), and `glossary/2` and early `glossary/3` were stamped with a blocks-only `sourceHash`,
     so they fail the source test anyway (Sol, F3).
   - Newer than this build refuses, which is what it did before: an older build in a rollback
     does not add to a newer build's list (Sol, F4). Unreadable refuses.
2. **The list is stamped with the current version after the append, and records the oldest
   prompt an entry came from** in a new optional field on the artefact, `oldestVersion`, carried
   forward until a rewrite. See *The stamp* below for why not the older stamp.
3. **`panelRunKind`** follows: `rewrite` only when the article moved, the press's profile differs
   from the list's, or the version is not appendable. `glossaryRunKind` (Metadata's row) is built
   on `existingFor`, so it follows with no edit: an outdated list reads *Find more terms* there.
4. **The remaining rewrite cases get words a reader can act on.** They are now rare: the article
   changed, the profile changed or was cleared, or a list from before `glossary/4`. The label
   becomes **Write a new list** (Metadata's row already says *"Writes a new list"*), and the
   reason is drawn under the button, because a tooltip does not exist on a touch screen and "I
   don't know what that does" is the complaint: *"The article, your profile or how we write
   glossaries has changed since these terms were found, so this replaces the list. Terms you added
   are kept."* It names all three causes, so it is true in each (Sol, F5). The tooltip stays.
5. **A *Find more* that found nothing says so**: *"No more terms worth adding turned up."* The
   prompt allows an empty answer, and until now that looked like a button that did nothing (Sol,
   F6). A new optional field `lastAdded` on the artefact, as Quotes has; the line shows when
   `passes > 1 && lastAdded === 0`.
6. **"A bunch more"** is what an append asks for: `suggestedCount(words)`, one per ~400 words, at
   most 20 a pass. An Entropy paper is at the ceiling. Not changed.

Help page, `docs/project/glossary.md` (the run row; § What this replaced; § Start again's third
bullet), `docs/project/reader-profile.md` (the label names), the feedback note.

## The stamp

The first draft of this plan kept the list's **older** stamp on an append, as Quotes did from
2026-09-11 to 2026-09-24, so that `version` would mean "the oldest prompt here". Review and a read
of the store killed it:

- An unforced `steps: ["glossary"]` job would fail `sameStamp` for ever and append on every run
  (Sol, F1, established: the model half of the stamp converges, the kept version never would).
- Metadata reads a failed currency check as *not run*, so the row would say that straight after a
  successful *Find more* (Sol, F2).
- The store refuses a write whose artefact stamp disagrees with the step's (`assertStampAgrees`,
  `src/store/artifacts.ts`), so the append would not have been written at all. Mine, found while
  checking F1.

All three come from one fact: `version` is what the stamp machinery compares. So `version` stays
"the prompt that wrote the latest pass", every one of those checks keeps working untouched, and
the provenance the older stamp was meant to keep goes in a field of its own. The list stops being
`outdated` after its first *Find more*; nothing announced `outdated` anyway (Greg, 2026-09-29:
*"it's not worth bugging the user about it."*).

An unforced job on an outdated, appendable list now appends once and then skips, where it used to
rewrite once and then skip. No client path posts one against an existing list (Sol confirmed
auto-run and reset; the panel, the badge, Metadata and the command bar all force).

## What this gives up

- **A prompt improvement no longer reaches an old list through this button.** Entries a
  `glossary/4` run wrote stay as they are, in their older register, beside new ones. Nothing in
  the client rewrites a same-article, same-profile list now. That was already true of a *current*
  list since *Start again* went (Greg, 2026-09-05: *"those are all confusing and unnecessary"*);
  this extends the same accepted loss to an outdated one. `DELETE /api/glossary/:slug` still
  exists, with no caller.
- **A cited paper already on a list stays** (261003o told the reader to press *Find terms again*
  to drop it). *Hide* on the entry removes it from the reader's view.
- A profile change still rewrites, through this button and through the badge's Regenerate; the
  badge depends on that, so it is untouched.

## Options passed over

- **Keep both labels and only explain better.** Cheapest, and does not give Greg what he asked
  for: on his list there would still be no button that adds.
- **Keep the list's older stamp.** § The stamp.
- **Append across a profile difference too.** The badge's Regenerate and Metadata's row both rely
  on "forced + different profile = rewrite", and there is one forced verb. It needs a second
  request shape (and a second `work_key`), which is not afternoon-sized. Not built; the rewrite
  cases keep an honest label instead.
- **A separate "rewrite" control for an outdated list.** Not asked for, and it is the *Start
  again* Greg removed. Not built.

## What review changed

GPT Sol's plan review (`261004f-plan-review-sol.md`), *build with changes*, six findings, all
accepted: F1 and F2 (the kept stamp never converges, and Metadata says *not run*) → the stamp is
the current one, § The stamp. F3 (`glossary/2` and early `/3` cannot pass the source test) → the
floor is `glossary/4`. F4 (a newer list in a rollback) → refused, as before. F5 (the sentence was
false for an old-format list) → it names all three causes. F6 (a press that finds nothing looks
broken) → `lastAdded` and its line.

## Tests (red first)

- `tests/glossary.test.ts`: `existingFor` accepts a `glossary/4` and a `glossary/8` list on the
  same article and profile; refuses `glossary/1`, `/2`, `/3`, a newer and an unreadable version, a
  moved article, a different profile. `buildGlossary` appending to a `glossary/4` list keeps every
  old entry and its id, adds the new ones, stamps the current version, records
  `oldestVersion: "glossary/4"` and carries it through the next pass; a pass that adds nothing
  has `lastAdded: 0`; a first pass and a rewrite carry no `oldestVersion`.
- `tests/glossary-panel-run-kind.test.ts`, `tests/glossary-run-kind.test.ts`: outdated + same
  profile is `append`; `glossary/1` and a newer build's list are `rewrite`.
- Panel (`tests/glossary-find-more-keeps-the-lists-profile.test.tsx`,
  `tests/glossary-compact-header.test.tsx`, `tests/rewrite-hold.test.tsx`): an outdated list
  offers *Find more* with no sentence; a rewrite offers *Write a new list* with the sentence on
  screen; the found-nothing line shows only for `passes > 1 && lastAdded === 0`.
- Mutation at the end: put the version refusal back and see the suite go red.

## Stages

One stage: it is one function, one stamp, one label and their docs.

## Decisions and assumptions (unattended run)

- The new label and sentence are mine; Greg asked for the behaviour, not these words.
- Lists from before `glossary/4` still rewrite.
- Two optional fields are added to the stored glossary JSON (`oldestVersion`, `lastAdded`). No
  migration: both are absent on every existing list and read as such.
