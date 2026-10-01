# Rename Annotations to Marginalia, and write up the three-column interface vision

Report `spya-yaxvgt` (Sentry SPIDERYARN-READING2-8E), from Greg, 2026-10-01. Two asks in one report:

1. **Write up an interface vision** — a direction of travel, explicitly not a decision: three
   columns, the decorated text in the middle, block-anchored marginalia on the right, unanchored
   things (Structure, Summary, Tweets) on the left, and most single-purpose mode bands
   de-emphasised. Then put the questions, trade-offs and concerns to Greg, three at a time.
2. **"Actually, let's rename Annotations mode to Marginalia mode right now, in that spirit."**

Greg's words, verbatim, are in the note,
[261001_1132-interface-vision-and-annotations-become-marginalia.md](../user-feedback/261001_1132-interface-vision-and-annotations-become-marginalia.md).

## Prior work checked

- fb7m-7p (Annotations' path wraps, notes swap in on a narrow window) **has landed** — `ceba340f`,
  `088a3e55` on `dev` — so the rename cannot collide with it. Its session is gone from
  `gjd-remote ls`.
- fb82-annotations-shows-other-modes is a delayed session (`--wait`, ~14h out at the time of
  writing); it has not started, so it cannot receive a message. The Overseer is told instead, so it
  can amend that brief or warn the session: the mode will be called Marginalia by then.
- No plan, note or commit already does either half.

## Stage 1 — the vision doc (docs only)

`docs/project/interface-vision.md`, owned by
[reading-view-overview.md](../project/reading-view-overview.md), headed as **not decided**. It
draws on Greg's report, the decorated playground (`experiments/decorated/`), and the recent
feedback notes (7E/7K Annotations, 7M/7P, 5A Tweets, 8B decorated, and the rest a survey found).
It holds the intent and the open questions, not a build plan. The questions go to the Overseer
for Greg, at most three at a time, per [ask-me-questions.md](../reusable/ask-me-questions.md),
and are recorded in the doc's § Open questions so they survive the chat.

## Stage 2 — the rename

### What changes

| Where | Before | After |
|---|---|---|
| The word a reader sees, `MODE_LABEL` | Annotations | **Marginalia** |
| The mode word, `MODES` / `Mode` / catalog key | `annotations` | `marginalia` |
| Catalog `aliases` | `marginalia`, margin notes, margin, sidenotes | `annotations`, margin notes, margin, sidenotes |
| The address | `?margin=1` | `?margin=1` — **unchanged** |
| Old `?mode=annotations` | turns the notes on | still turns the notes on |
| New `?mode=marginalia` | — | turns the notes on, the same way |
| The column's code | `src/web/annotations/` | `src/web/marginalia/` |
| Identifiers | `AnnotationsHead`, `AnnotationNote`, `annotationNotes`, `annotationsPress`, `AnnotationsPress(Input)` | `MarginaliaHead`, `MarginaliaNote`, `marginaliaNotes`, `marginaliaPress`, `MarginaliaPress(Input)` |
| Sentry `feature` tag | `Annotations` | `Marginalia` (old events keep the old tag; grouping may not change) |
| Test files | `tests/annotations-*.test.ts(x)` | `tests/marginalia-*.test.ts(x)` |
| Docs under `docs/project/` naming the mode | Annotations | Marginalia |

### What does not change, and why

- **`?margin=1` stays.** It is already the column's address (since 261001i the column is a switch
  beside `?mode=`, not a value of it) and it is already the right word. Changing it would break
  links for nothing.
- **The `"annotations"` literal stays in the four legacy translators** — `marginInSearch`
  (`src/web/params.ts`), the Reader's arrival rewrite, the Dock's link builder and
  `rememberableSearch` (`src/web/last-view.ts`) — because an old link or a remembered last view
  from 2026-10-01 still carries it. They are generalised to one named predicate,
  `isMarginaliaModeWord(value)` — `marginalia` or the legacy `annotations`, explicitly, not "any
  mode that is not a band", so a future second non-band control cannot silently turn into the
  margin — and `?mode=marginalia` takes the same road without a fifth copy of the rule.
- **Not `RETIRED_MODES`.** The brief suggested the retired-mode table, but it maps an old word to a
  *band* mode (`BandMode`), and Marginalia is not a band: its old word has to land on the `margin`
  switch, which is exactly what `marginInSearch` already does. Adding a second mechanism for the
  same redirect would be two statements of one rule. [mode.md § Retiring a mode](../project/mode.md)
  gains a line saying so, so the checklist stays true.
- **Every other "annotation"** — the prose decorations (`src/web/annotate.ts`,
  `annotation-cost.ts`, `styles/annotations.css`), OpenRouter's URL-citation annotations, MathML
  `<annotation>`, comment drafts — is a different sense and is left alone. The inventory that
  separated them is in this plan's history (subagent sweep, 2026-10-01).
- **Plans, notes, postmortems and the changelog** keep the old word: they are history, and source
  comments link the 261001d/i/k plans by path.
- **No database work.** Nothing stored is keyed on the mode word. Feedback diagnostics record only
  the open *band* (`BandMode`), which was never `annotations`, so no client — old or new — sends
  the word there.

### The simpler option passed over

Change only `MODE_LABEL` — one string, and the reader sees Marginalia everywhere. Rejected because
the command bar, the Dock's links and every test table say the mode word, so the code
would call one thing by two names from day one; that is the cost a rename exists to avoid, and the
surface here is small (no stored data, no URL change).

### Tests, red first

- `?mode=marginalia` turns the notes on (`marginInSearch`, the Reader's rewrite, last-view) — red
  before the change, because today `marginalia` is not a mode word and parses to nothing.
- `MODE_LABEL.marginalia === "Marginalia"`, and the command bar finds the mode by "annotations".
- The existing legacy `?mode=annotations` tests stay as they are and stay green, and the same
  conflict cases are mirrored for `?mode=marginalia`: `mode=marginalia&margin=0` in both orders, a
  metadata link keeping another band, and the mounted Reader's arrival rewrite for owner and
  visitor.
- The totals tables (`BAND_SAYS`, `DRAWS`, `BEHIND_THE_SWITCH`, …) are renamed by the compiler.

### Checks

`npm test`, `npm run typecheck`, `npm run lint` on touched files; GPT Sol code review
(`--sandbox workspace-write`); a Playwright check that the Dock's button says Marginalia,
`?mode=annotations` and `?mode=marginalia` both open the column and land on `?margin=1`.

## Progress

- 2026-10-01: plan written; survey of feedback and rename inventory done.
- 2026-10-01: GPT Sol's plan review ([261001n-marginalia-plan-review-sol.md](261001n-marginalia-plan-review-sol.md)):
  no P0. Taken: the named predicate, `MarginaliaNote`, the mirrored conflict tests, the
  mode.md exception, the Sentry and diagnostics wording; in the vision, the true narrow-window
  rule (612/900px), that only Glossary/Quotes/Citations mark the prose in every mode, that only
  Debate's `disputes` rows are disputes, and its three better first questions (the Dock question
  waits until the content it would hide is reachable another way). Its point that the docs claimed
  completion early is met by landing the docs with the rename, not before.
- 2026-10-01: built (`4849b82f5`): the rename by an Opus subagent from the inventory; the
  red-first `tests/marginalia-name.test.ts` went 4/4 red, then green, and mirrored
  `?mode=marginalia` conflict tests sit beside every legacy `?mode=annotations` one (the arrival
  test was seen to go red with the Reader's predicate put back to the literal).
- 2026-10-01: GPT Sol's code review ([261001n-marginalia-code-review-sol.md](261001n-marginalia-code-review-sol.md)):
  no P0/P1, "land after fixes". It fixed three tests: typing "annotations" in the command bar opens
  Marginalia rather than Comments, which shares the alias; mounted owner and visitor arrival with
  `margin=0` in both orders for both spellings; identical server titles for both spellings. Left
  for Greg: [reading-view-overview.md](../project/reading-view-overview.md)'s Marginalia entry
  says the last press wins below 900px, which is true only from 612px — an entry-point doc, so its
  wording waits for approval; [interface-vision.md](../project/interface-vision.md) has it right.
- 2026-10-01: Playwright, 1440×900, owner, `fowler-phrenology`: the Dock says Marginalia;
  ⌘K finds it by "marginalia" and by "annotations"; `?mode=marginalia` and `?mode=annotations`
  land on `?margin=1` with the column drawn; Glossary and the notes side by side; no console
  errors from our code. Seen once and not chased: on the very first load after a cold dev-server
  start, `?mode=marginalia` drew the column but kept the old URL for 5s; two reloads rewrote it.
  The rewrite is the same effect as before the rename, with only its literal replaced.
