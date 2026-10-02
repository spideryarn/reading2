# Glossary: hide an entry, Dig deeper from the card, hyphens match spaces

Up: [plans.md](../project/plans.md) · area: [glossary.md](../project/glossary.md)

Three reports from Greg on one article (`s41598-023-33209-9-spya-hxekgz`), 2026-10-02, one session
(`fbyqfzkm-glossary-hide-dig-deeper-links`).

> Give me a way to hide a Glossary entry (e.g. because I know it already, and/or it keeps showing up
> too much).
>
> Definitely there should be a way in the Glossary mode (e.g. swiping right should reveal a
> trashcan, or just show a trashcan icon). It might be nice to be able to do this from the tooltip
> that appears when I hover/touch a Glossary entry in the article without having to go to Glossary
> mode.
>
> I can't decide whether it should just hide (for me) or delete (for everyone, e.g. for a public
> article). Let's go with Hide for now.
>
> LOW PRIORITY And perhaps there'd be a thing in the Glossary mode to see/review/unhide Hidden items?
>
> — Greg, 2026-10-02 (spya-yqfzkm)

> We have a "Dig deeper" in Glossary mode. Add that to the in-text glossary tooltip.
>
> — Greg, 2026-10-02 (spya-p09u4s)

> the glossary item for delayed win-shift only shows one block-link, even though that shows up
> throughout the article. why? is it something to do with spacing/hyphens? how could we improve this
> without adding too much complexity?
>
> — Greg, 2026-10-02 (spya-n04d5p)

And, relayed by the Overseer the same day, on clickable hover cards (open-questions Q10):

> Q-hover-cards-clickable (c) would be ideal if we can make it work, but test & check in browser
> carefully. If this ends up being really complicated, we'll reconsider.
>
> — Greg, 2026-10-02

The in-text glossary card is `ProseHoverCard`, which is already interactive (it carries the
*in the glossary* button), so Dig deeper goes there directly and nothing here depends on the
shared `Tooltip` prop that session is adding.

## 1. Why "delayed win-shift" found one block (spya-n04d5p)

Read from production, inside `begin read only` … `rollback`, on 2026-10-02:

```
entry spya-y2tchy  name "Delayed win-shift task"  aliases []  blocks ["spya-c58mtq"]

block        the article's words
spya-c58mtq  "…study phase of a delayed win-shift task for memory…"     ← matched
spya-f8pqnx  "…an 8-arm maze delayed-win-shift task^{41,42}…"            ← hyphen, not space
spya-n6wzxa  "…(a) A delayed-win-shift task was used."                   ← hyphen
spya-aj0wcz  "…used here was the delayed-win-shift task on an 8 arm…"    ← hyphen
spya-kqzezj  "…the eight-arm delayed-win-shift task, consisting…"        ← hyphen
spya-jwsykg  "…encoding in the delayed win-shift radial arm maze…"       ← no "task" after it
spya-eyqha9  "…test phase of a delayed radial maze win-shift task…"      ← words split apart
```

Two causes, and Greg's guess is the bigger one:

1. **Hyphens.** `termPattern` (src/term-match.ts) lets whitespace inside a form match any run of
   whitespace, and nothing else. The paper mostly writes *delayed-win-shift*, so a name with a space
   misses four of the seven.
2. **The name carries a generic head noun, and no alias drops it.** The model named the entry
   *Delayed win-shift task* and gave no aliases, so *delayed win-shift radial arm maze* cannot match.
   The last one (*delayed radial maze win-shift task*) splits the phrase and no reasonable matcher
   should find it.

### The fix

**In the matcher: between two words of a form, a space and a hyphen are the same thing.** Each
interior run of whitespace or hyphens (`-`, U+2010 hyphen, U+2011 non-breaking hyphen) in a form
becomes `[\s\-‐‑]+`. So *delayed win-shift task* finds *delayed-win-shift task*, and
*win-shift* finds *win shift*. One line in one module, and because that module is shared, the
stored occurrence list, the prose underlines, and Dig deeper's anchor (`anchorIn` in
src/term-lookup.ts) all change together, so they cannot disagree.

Not included: en dash (U+2013), because it is the range dash (*1990–2000*, *pages 3–7*); and a
hyphen against *nothing* (*e-mail* vs *email*), which would mean matching inside words.

The honest cost, as with the plural rule: *co-op* now matches *co op*. It is rare, and it fails the
harmless way.

**When the list is read: match it again against the article as it is now.** `entry.blocks` is
worked out when the list is written, so a matcher fix reaches an existing glossary only when someone
presses *Find more*. `loadGlossary` (src/store/pg.ts) already reads every block's id and text (for
the staleness fingerprint), and the writer matched against exactly that set (`buildGlossary` gets
the article's whole block list). So, **when the list is not stale**, `loadGlossary` recomputes each
entry's `blocks` with the same `findOccurrences` and puts the entries back in document order with
the same `inDocumentOrder`. That is a regex pass of about 30 entries over a few hundred blocks, on
data already in memory.

When the list *is* stale, the stored lists are left exactly as they are. The panel's
`occurrencesFitTheArticle` and the server's `[gl-stale]` refusal both depend on the rule that empty
`blocks` on a stale list says nothing, and this change does not touch that rule.

The public reader's payload (src/store/public-reader.ts) gets the same recompute through the same
helper if its read already holds block text; otherwise it keeps the stored list, and the next
*Find more* fixes it.

**Deferred: the generic-head-noun alias.** Telling the prompt to add, as an alias, the shortest form
the article actually uses (*delayed win-shift* for *Delayed win-shift task*) would catch
`spya-jwsykg`. But a prompt change has to be measured before it ships
([prompting-guide.md](../project/prompting-guide.md)), and the matcher fix gets most of the way
(1 of 7 becomes 5 of 7). It is named here so that the gap is visible; it is not built.

## 2. Hide an entry, for me (spya-yqfzkm)

**What hiding does.** A hidden entry:

- is not underlined in the prose, in any mode, so it has no hover card either;
- is not in the band's list, the term count, or the threshold's *n of m*;
- appears in a collapsed **Hidden (n)** section at the foot of the band, where each one has
  **Unhide**. (Greg marked this LOW PRIORITY, but without it a hide is permanent, and a mis-tap on a
  phone has no way back. It is the cheapest form of the undo, so it is in v1.)

It stays in the artefact. Chat's glossary tool and the export still see it, because hiding is a
preference about what is on screen, not a judgment that the entry is wrong.

**Who.** The article's owner, on their own article: the same shape as reading time, which is also
per article and owner-only. A visitor on a public article sees the owner's list exactly as before.
The owner's hides do not reach them, and they cannot hide anything of their own (deferred, below).

**Where it is stored.** A new table, as reading time does it:

```
spideryarn.glossary_hidden_entries
  article_id  uuid  → articles(id) on delete cascade
  entry_id    text  check: spya id format
  hidden_at   timestamptz default now()
  primary key (article_id, entry_id)
```

Keyed on the entry id, which is stable: an id survives *Find more* (`dedupe` keeps the incumbent's
id) and is carried into every new revision, so a hide outlives both. An entry that disappears
leaves a harmless orphan row. A table rather than a `text[]` column on `articles`, because
[sql.md](../project/sql.md) prefers keys, and because this mirrors `reading_time`, so there is
nothing new to learn.

**API.**

```
PUT    /api/glossary/:slug/hidden/:entryId   → 204   (idempotent)
DELETE /api/glossary/:slug/hidden/:entryId   → 204   (idempotent)
```

These use the same owner check every other owner write uses (copied, not re-derived). The read is
`loadGlossary`: it attaches `hidden: true` to those entries at the read seam, the way it already
attaches `lookup`. So there is no second GET, and the public payload, which never calls
`loadGlossary`, cannot pick it up.

**Client.** `useGlossaryRead` (src/web/useGlossary.ts) owns the one list that both the band and the
prose draw from. It gets a `setHidden(id, hidden)` that flips the entry in place straight away, then
sends the request, and flips it back with a sentence if the request fails. Reader's
`termSelections` (the prose underlines) and the band filter `hidden` out. A `?term=` that names a
hidden entry is cleared, by the same rule that already clears a term the threshold hides.

**Controls.**

- In the band: a small trash-can icon button on each row (Greg: *"or just show a trashcan icon"*),
  labelled *Hide*, with a tooltip saying *only for you*. No swipe gesture in v1.
- In the hover card's foot, owner only: *Hide*, which hides the entry and closes the card.

**Deferred, by name:**

- **Delete for everyone.** Greg chose hide.
- **A visitor hiding terms on someone else's public article.** That needs a reader id that is not
  the owner; the table would gain `reader_id`.
- **Swipe to reveal the trash can.** Touch already has a two-tap rule on marks
  ([touch.md](../project/touch.md)), and a swipe on band rows would be a new gesture system.
- **Hidden entries in the export.**

## 3. Dig deeper from the hover card (spya-p09u4s)

The card is `ProseHoverCard`'s `TermCard`, which is already interactive, so per the Overseer's note
the button goes there and nothing waits on the shared-Tooltip prop.

**What it does.** It opens the band on that term and starts the dig there: the same
`openTermInGlossary` the card's *in the glossary* button calls, plus a one-shot "dig on arrival"
request that the owner's band consumes once and passes to the existing `look(id)`. So the answer
streams into the row, where all the existing machinery is (the wait sentence, the draft, failure,
*Dig deeper again*, the allowance).

Owner only, because a visitor has no Dig deeper anywhere. The button is disabled with the same
sentence as the band when the term is unquoted, or when a lookup is already running.

**The simpler option passed over: streaming the answer inside the card.** The card closes when the
pointer leaves and is 18rem wide, and a minute-long stream needs somewhere that stays put. The band
already is that place. If Greg wants the answer in the card itself, that is a later change.

## Stages

1. **Matcher + re-match on read** (n04d5p). Failing test first: `termPattern(["delayed win-shift
   task"])` against *delayed-win-shift task*, plus a `findOccurrences` case using the production
   shapes. Fix, then the `loadGlossary` recompute and its test.
2. **Hide.** Migration, store, routes, `loadGlossary` attach, client hook, band row button + Hidden
   section, card button, prose filter. Tests: store round-trip (pg), route owner check, the filter.
3. **Dig deeper in the card.** Button, one-shot request, band consumes. Test that the request is
   consumed once.
4. Docs (glossary.md sections), browser check (Sonnet subagent, desktop and touch), GPT Sol code
   review, feedback note.

## Security

The new write is an owner write behind the existing owner check, copied rather than changed. The
public read path is untouched: hidden ids are attached only in the owner's `loadGlossary`. No
defence in [security-map.md](../project/security-map.md) is modified.

## Reviews

- Plan: GPT Sol, read-only (below once returned).
- Code: GPT Sol, workspace-write.

## Revised after GPT Sol's plan review

[261002c-plan-review-sol.md](261002c-plan-review-sol.md) (exit 0, answer file fresh, 2026-10-02
14:13). The verdict was *revise before building*; every finding checked out against the code, and
the plan above is superseded where it disagrees with this list:

1. **Dig deeper from the card: no one-shot.** `look` and its state (admission, draft, kept, failure)
   move out of the band's `useGlossary` into the always-mounted `useGlossaryRead`. Job polling stays
   in the band. The card calls `look(id)` directly and opens the band on the term
   (`openTermInGlossary` already lowers the threshold to reveal it). A side effect, and a better one:
   closing the band no longer disowns a running dig.
2. **One visible list.** Hidden entries are filtered out in one place, and that list feeds the prose
   marks, the card, the G key, Skim's stop cards (`stop-card.ts`, `canOpenFromStopCard`), and the
   band's counts, sorts and threshold. The raw list is kept only for the Hidden section. A
   personally hidden `?term=` is cleared in every order, not just prioritised. The trash button is
   a sibling of the row's `<button>`, never nested inside it.
3. **Export.** The hide preference is exported alongside reading time (`src/store/article-rows.ts`),
   and `tests/store-export-covers-tables.test.ts` will insist on it.
4. **The public read re-matches too, always.** Done in stage 1. And simpler than the plan: **both
   reads always re-match, stale or not.** On a stale list an empty `blocks` already says nothing
   (`occurrencesFitTheArticle`), and the visitor is never told "unquoted". So there is no second
   rule to keep.
5. **Pessimistic writes.** Disable the control, await the PUT or DELETE, then `refresh()`. The card
   closes only on success, and shows its own failure line otherwise.
6. **Ownership in the store**, with `articleIdForOwned`. PUT refuses an id that is not in the
   current glossary. DELETE stays idempotent. No `hidden_at`.
7. **Matcher:** separators are made canonical before the dedup and the length sort. Done, with a
   test.
8. **The helper takes `{ id, text }`**: `src/glossary-occurrences.ts`. Done.
