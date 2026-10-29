# The margin button starts the literature search

Greg's answer to [q-sxfwqq](../user-feedback/questions/q-sxfwqq.md), on report `spya-nkq6rj`:

> D for now
>
> — Greg, 2026-10-28 (spya-bcc0y8)

> Change my mind. Let's go for A.
>
> — Greg, 2026-10-28 (spya-nq5ec9)

**Option A**: the first press of the margin button on an article starts Sources' literature search
(`situate`, the part whose findings sit beside passages in the margin) if it has never run for that
article. A reload, a pasted link, or arriving at an article whose margin was already on does not
spend. About $0.30–0.50 per article it runs on. It grows from
[261028c](261028c-explanations-of-confusing-passages-and-sources-feeding-the-margin.md) § Idea 1,
and it loosens the cost rule of q-vg2b69 (*"only do that when we open the sources mode"*), so the
change is recorded where that rule lives, [sources.md § Where it sits](../project/sources.md#where-it-sits).

**Constraint:** the box's OpenRouter key is over its monthly limit until 1 November. Nothing here
needs a model call to build or test: the change is in the client's press-and-token machinery, and
the tests run on a mocked network, as `tests/marginalia-relations-on-open.test.tsx` does. What waits
for the reset: seeing a real search land in the margin after a press, in a browser on the box —
queue item `qi-wwdnrywn`.

## What exists

- **The press is already told apart from the arrival.** `useActivateMode` (Dock.tsx) arms
  Marginalia's row only on the press that turns the column on — not on the press that turns it off
  (its feed is still mounted for that instant), not from the command bar while it is on, not from a
  visitor. Back, Forward, a reload and a pasted `?margin=1` call no activator at all.
- **But the row answers `null`** (`MODE_TARGET.marginalia` in activation.ts): the relation words are
  made on arrival (`useAutoRunOnArrival`), so the press had nothing left to arm.
- **The margin reads the dossier and never makes it** (`SituateMarginFeed` in MarginaliaColumn.tsx,
  `useSituateRead`).
- **`useAutoRun`** spends a token a control minted, once, by the mount that claims it, only when
  the read answers `none`, at most once per `(slug, target)` per tab session, and never in a
  view-as tab. `enabled = false` drops a claimed token at once.

## The change

1. **A new auto-run target, `margin-literature`** (auto-run-targets.ts), of its own kind beside the
   composite `sources-where`: the search, with the works cited listed first in the same job when they
   are missing too, as *Where it sits*' press does (`ensure({ withBibliography })`). Its own name
   rather than reusing `sources-where`, because a token belongs to one owner: `WhereBand` owns that
   one, and the margin feed this one.
2. **Marginalia's row names it**: still `delegated`, now answering `"margin-literature"` rather than
   `null`. `modeStep` stays `null` for delegated rows, so the import's list is unchanged (no
   spending on import: option C was not chosen).
3. **The feed claims it.** `SituateMarginFeed` mounts the full `useSituate` (which has no
   `useAutoRun` of its own and spends nothing by mounting) plus `useAutoRun(slug,
   "margin-literature", …)`. Its status is the dossier's read, held at `loading` while the Reader's
   Bibliography read has not answered (so the press waits to know whether to list the works first).
   A stored dossier — stale or outdated included — is never re-run by this, as on *Where it sits*.
4. **Nothing shown, nothing spent.** `enabled` is the feed's `shown` (switched on *and* the window has
   room for the notes). A press on a window too narrow for the notes is dropped: the findings would
   land in a column nobody can see. That is a failure to spend, the safe direction, and the same rule
   the relation words keep.
5. **`OwnerMarginFeed` is handed the Bibliography read's status** (`owner.bibliography.status`), so
   it reads nothing new.

What this deliberately does not change: Reception's *Search the web* and Claims' *List its claims*
still wait for their own buttons (named in the question's details as later candidates; Greg did not
take them up); a visitor's press arms nothing; the narrow-window press that swaps the band out for a
margin that was already on arms nothing (the margin was already on — that is an arrival, not the
press that turns it on).

## What GPT Sol's plan review changed

[261029h-plan-review-sol.md](261029h-plan-review-sol.md). All four findings taken:

- **MARGIN-1 (P1), two doors could post two jobs.** The margin's `[bibliography, situate]` job writes
  Bibliography first; *Where it sits*, pressed meanwhile, would read the works as present and the
  search as missing, and post `[situate]` — a different work key, so a second job row. Both doors
  now hold their press at `loading` while a search job is in the queue or this door's POST is in
  flight (`searching` in useWhereAutoRun.ts). Two separate tokens stay: one owner each.
- **MARGIN-2 (P1), a failed Bibliography read had no way back.** The feed is handed the Reader's
  Bibliography read itself (`status` and `retryRead`), and with no dossier a Bibliography `error` is
  an `error` (read again), not a guess. With a dossier stored, Bibliography is not consulted at all
  (`marginLiteratureStatus`).
- **MARGIN-3 (P2), the full hook would poll every eight seconds.** `useSituate` takes a cadence;
  the margin passes `"quiet"`, and its own `useStepFinished` went, since the hook's job watch
  refreshes the read.
- **MARGIN-4 (P2), exhaustive lists.** `modeStep` excludes the new target; `EVERY_TARGET` and the
  all-modes cost sweep (`every-mode-draws-its-surface.test.tsx`, which now lets a press post an
  `also` job: the relation words the shown column asks for) were updated. The integrated cases for
  the press that turns the margin off and the command bar naming it while on already existed in
  `a-second-press-closes-the-mode.test.tsx` and still hold.

## What GPT Sol's code review changed

[261029h-code-review-sol.md](261029h-code-review-sol.md), on commit `1d3f1317c`. Sol fixed both
P1s, each with a failing test first:

- **MARGIN-CR1, `starting` belonged to one mount.** The other door could post while the first
  door's POST was still in flight. One unforced start per article is now shared across this tab's
  `useSituate` mounts (`startSituateOnce`). A caller waiting behind a POST that fails still gets its
  own try.
- **MARGIN-CR2, a quiet snapshot could be older than the press.** Each door now waits for a job list
  fetched after its token was minted (`useFreshQueueForActivation`, using `jobEngine.afterFreshList`).
  That wait has a 10-second ceiling so a failed queue read cannot hold a press forever, and it is
  skipped when the engine has no session: no list is coming, so the snapshot is all there is. The
  no-session case was added after the review, because without it every press in an engine-less
  harness waited out the ceiling (five probes in `modes-that-start-themselves.test.tsx`).
- **MARGIN-CR3**: marginalia.md and the Sources help page brought into line.

## The simpler option passed over

**Reuse `useSituateRead` and POST the job from the token directly, with no Bibliography first.**
Fewer moving parts, but the search would then run without the works the piece cites whenever
Bibliography was not made on import, and the stored dossier is never re-run by *Where it sits*' press,
so the poorer search would stick. Listing the works first costs one cheap step in the same job and
keeps the two doors to the same search making the same search.

## Tests (red first)

In a new `tests/margin-press-starts-the-search.test.tsx`, the owner's feed on a mocked network:

- a Marginalia press then the feed mounting, with no dossier: one POST, `steps` the search, unforced;
  with Bibliography `none`, `precededBy: ["bibliography"]`;
- arriving with no press: no POST (the reload / pasted-link case);
- a dossier already stored (ready, stale, outdated): no POST, the token retired;
- not shown (narrow window): no POST, and the token does not survive to a later mount;
- StrictMode: one POST;
- a second press on the same tab after the first spent: no second POST.

And the `MODE_TARGET` assertions that currently say the press arms nothing are updated.

## Docs

sources.md § Where it sits (the rule, loosened, with Greg's two replies) and § Opening it is the
request; marginalia.md (the literature row; *The press arms nothing*); activation.ts's row comment and
Dock.tsx's `marginOn` comment; useSituate.ts's header; q-sxfwqq answered and published; the report's
note.
