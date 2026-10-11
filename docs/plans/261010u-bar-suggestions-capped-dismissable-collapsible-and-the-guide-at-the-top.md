# The bar's suggestions: four at most, dismissable, collapsible, and the guide at the top

Two admin reports from Greg, 2026-10-10, both about the command bar's *Suggest what to do here*
(plan [261005k](261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md)),
both from the Landscape of Consciousness article. Queue item `qi-na7p6xy4`.

> I clicked suggest what to do here in the command bar, and it added some useful suggestions. I
> think three or four should probably be enough. I don't know. It should be possible to dismiss some
> of them so that they don't come up again if they're not helpful. And it should also be possible to
> collapse them as well. Once they'd been added, they seem to stay, and then they kind of pushed
> everything else down.
>
> — Greg, 2026-10-10, `spya-yf23zk`

> And following up from my last feedback report, I quite like these suggest what to do here
> suggestions in the command bar, but I still want an easy way to get to the guide chat, somewhere
> near the top of the command bar.
>
> — Greg, 2026-10-10, `spya-xasbd3`

The guide half overlaps `spya-q3pzyn` (queue `qi-dp2tphkd`, session `fbq3pzyn-guide-in-command-bar`,
which has not started: it waits until Mon 12 Oct). That one also asks for a clearer name and **one
guide icon everywhere**; this plan does only the placement, and leaves the name and the icon to it.

## What is there now

- The model may return up to 3 searches, 2 modes and 1 lens (`src/command-suggest.ts` caps), so up
  to **six** rows, each three lines tall (label, the row's description, the model's *why*). They sit
  above every ordinary row and stay for the visit: on Greg's screen they pushed the modes below the
  fold.
- No way to hide one, or the block.
- The *Guide* row (plan 261009i) is not typed-only, but it is listed after every mode and sub-mode
  (`besideTheModes`), so on an empty box it is near the bottom.

## What changes

1. **Four at most, drawn.** The model's caps stay as they are (no prompt change for this); the bar
   draws at most `MAX_SUGGESTIONS_SHOWN = 4` of what it kept, in an interleaved order — first search,
   first mode, the lens, second search, second mode, third search — so a cap never costs the list
   its only mode or its question for chat. Dismissing one lets the next take its place.
   *Simpler option passed over:* lowering the model's caps to 2/1/1. Fewer parts, but then a
   dismissal leaves a hole, and it is a prompt change that wants a re-run of the eval.
2. **Dismiss one, for good.** Each suggested row gets a small × (*Don't suggest this again*); with
   the row highlighted, `Delete` does the same. The row goes at once, and the dismissal is stored:
   - **Where**: a new table `spideryarn.command_suggestion_dismissals` — `article_id` (FK to
     `articles`, cascade), `kind` (`search` | `mode` | `lens`), `value` (the search or lens words,
     lower-cased and whitespace-collapsed; a mode's row id), `dismissed_at`. Primary key
     `(article_id, kind, value)`. No `owner_id`: an article has one owner and the suggestions are
     only ever offered to them, so the reader is the article's owner, as for the other tables that
     inherit ownership through the article.
   - **Per article, not across articles.** The searches and the question are written from that
     article's reason for reading, so the same words on another article are a different suggestion.
   - `POST /api/command-suggest/:slug/dismiss` with `{ kind, value }`, owner-checked the way the
     suggest route is (`ownedArticleIdentity`), exact body shape, value capped at the existing
     length caps.
   - **The server filters** a later answer against the stored dismissals before it answers, so a
     dismissed suggestion does not come back as the same words or the same mode. **It also tells the
     model**, in the user message, the searches and question the reader dismissed, so a paraphrase is
     less likely; that is asked of a model, not enforced, and the doc says so.
   - There is no undo in v1 and no page that lists them. Deleting the article deletes them.
   - Exported with the article? It is a fact about the reader's use of the article; `export.md` is
     checked and the export is extended only if it already carries the owner's other per-article
     preferences.
3. **Collapse the block.** The line above the list (*From why you're reading*) becomes a button with
   a chevron and a count, outside the listbox. Collapsed, the suggested rows are not drawn and the
   arrows do not visit them; the line stays, so they are one press away. The choice is a per-browser
   convenience in `localStorage` (wrapped in try/catch), not a reader field.
4. **Stops pushing the bar down** comes from 1 and 3 together, plus: a suggested *search* row drops
   its description line (*Search mode, a fast first pass…*), which says nothing its label does not.
   The lens row keeps its description, because it is the sentence that says nothing is sent until you
   press Send (the reason it was given a line of its own on 2026-10-06).
5. **The guide at the top.** On an empty box the *Guide* row is drawn first among the ordinary rows,
   straight after the suggestions block (and after the *Suggest what to do here* row when there is no
   list). Typed, it ranks as it does today.

## Stages

1. **Server**: the table and migration, the dismiss route, the filter and the prompt line. Tests:
   the body parser, the filter, and a route test that a dismissed search does not come back.
2. **Bar**: the cap and order, the × and `Delete`, the collapse line, the dropped description, the
   Guide row first. Tests in `tests/command-bar*.test.tsx`.
3. **Docs and browser check**: reader-profile.md § the command bar's suggestions (where the
   dismissals live — no longer "never stored on the server"), privacy.md, keyboard.md (`Delete`),
   database.md if it lists tables, the help page. A Sonnet subagent checks it in a browser on the box.

Sol reviews the plan before stage 1 and the code before the push.

## Done looks like

The bar, on an article with a reason for reading: Guide near the top; at most four suggestions under
a line that collapses them; × on one removes it and asking again does not bring it back; reloading
keeps the collapse.

## After GPT Sol's plan review (verdict: rethink) — what changed

The review is [261010u-bar-plan-review-sol.md](261010u-bar-plan-review-sol.md). Every finding taken;
this section **replaces** the parts of the plan above that it contradicts.

- **F1, F2, F6 — the dismissals store no words, are bounded, and belong to one fingerprint.**
  A dismissal is an **identity**: a 16-hex hash (the cyrb53 `readFromHash` already uses) of the kind
  and the normalised words or mode id, computed by one pure function in `src/command-suggest.ts`
  that the browser and the server share. The table is **one row per article**:
  `command_suggestion_dismissals(article_id PK → articles cascade, read_from text, dismissed text[]
  of identities, created_at, dismissed_at)`, at most 50 identities (oldest dropped), checked by the
  column as well as the route. A dismissal posted under a `readFrom` different from the stored one
  replaces the row. The suggest route filters an answer only when the stored `read_from` is the one it
  has just computed — so when the reader edits *About you* or the reason, the old dismissals stop
  applying, as the old list stops showing (F6). **Nothing is sent to the model**: no prompt change
  (F2). Profile-derived words are never stored, only their hashes.
- **F3 — Guide is the first row of all** on an empty box, then the *Suggest* row or the suggestions
  block, then the rest. A display-only reorder; typed ranking is unchanged. A fresh answer still
  selects its first suggestion.
- **F4 — no button inside an option.** The × is a pointer-only hit area (`aria-hidden`, its click
  stops propagation so it does not also run the row); the accessible way is `Delete` on the
  highlighted suggestion, announced with `aria-keyshortcuts` and, after a dismissal, a sentence in
  the bar's status line.
- **F5 — the collapse line** is a real button outside the listbox, `aria-expanded`,
  `aria-controls`, the count in its text; `mousedown` does not take focus from the box; collapsing
  moves the highlight to the first row (Guide) by row id, not by index.
- **F7 — failure contract**: the row goes at once; if the POST fails it comes back and the status
  line says it could not be saved. No undo in v1 — a dismissed suggestion costs nothing, and asking
  again gives other ones; named in the note.
- **F8 — tests**: 401 unauthenticated, 404 stranger, extra field / bad identity / bad `readFrom`
  refused, cap holds, cascade on article delete, a dismissed suggestion filtered from the next answer,
  and not filtered once the fingerprint changes.
- **F9 — export and registries**: added to article-rows, rollback export, bundle export, the
  export-coverage and schema-drift tests, following `stale_notice_dismissals` (plan 261010a).
- **F10 — the pipeline, in order**: resolve today's drawable rows → drop dismissed → interleave
  (search, mode, lens, search, mode, search) → take four.

## What landed, and the code review

Built in two stages (server by a subagent, bar here), then reviewed by GPT Sol with write access
([prompt](261010u-bar-code-review-prompt.md), [answer](261010u-bar-code-review-sol.md)). Its
verdict was *rethink*, but seven of its eight findings it fixed itself and they are in this commit:

- the client now confirms a dismissal only on exactly `{ok: true}`;
- local dismissals are keyed by `(slug, readFrom)`, so a re-ask cannot race a pending write;
- selection after a dismissal, a rollback or a fold follows the row, not its index;
- the route recomputes the current fingerprint from the stored profile and refuses a late write
  from an older list with 409 (`DISMISS_STALE`), so it cannot replace newer dismissals;
- `created_at` no longer moves when a new fingerprint replaces the row;
- the dismiss route is `article: "none"` (it never spends);
- the Guide test now proves the row is the executor's.

**Not taken: the fold row as a real button with `aria-expanded`** (its finding 1, our F5). ARIA 1.2
does not support `aria-expanded` on `option`, and moving the control out of the listbox would break
the one rule the bar's keyboard model rests on (focus stays in the input, every row is an option).
The state is in the row's own text instead: *"3 suggestions, hidden. Press to show."* /
*"Press to hide these."*, read with the row. Revisit if a screen-reader user says otherwise.

**Browser check not done.** The shared local database cannot take this migration until a peer's
migration (`20261010190341_feedback_addenda`, worktree `fbsaz0yw-addendum`, committed but not pushed)
lands on dev: `npm run db:migrate` refuses an unknown ledger row, rightly. The route tests ran
against a private database built from this tree's migrations; the bar against jsdom.
