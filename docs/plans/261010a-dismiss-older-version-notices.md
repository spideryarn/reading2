# The "older version of the article" notices can be dismissed, in every mode

Report `spya-mutgym` (#524), queue item `qi-hxqzh4mm`. Filed by Greg (admin; `feedback-reporter.ts`
exit 0) on 2026-10-09 22:59 UTC from Sources (`mode=peer-review`) on `arxiv-1706-03762-spya-wyt7j0`.

> I'm seeing this "This describes an older version of the article." in a mode.
>
> Look for all of those and in each case make sure there is a way for me to dismiss them if I don't
> want to rerun it.
>
> — Greg, 2026-10-09

Precedent: [261009i](261009i-skim-profile-notice-can-be-dismissed.md) gave Skim's profile notice
an ×, stored on `articles`, and said that if a second dismissible banner turned up, the store should
become *"a table keyed by mode then"*. This is that second one, ten times over.

## Which notices

Every banner that tells an **owner** that the artefact on screen was made from an older version of
the article (`stale`: the article moved underneath it). Some say it in other words, but they all
report the same fact, so they are all in scope:

| mode | where | words now |
|---|---|---|
| Glossary | `GlossaryPanel.tsx` | These terms describe an older version of the article. |
| Ideas | `IdeasPanel.tsx` | These describe an older version of the article. |
| FAQ | `FaqPanel.tsx` | These describe … |
| Timeline | `TimelinePanel.tsx` | This describes … |
| Summary (Simple) | `SimplePanel.tsx` | This describes … |
| Citations (in Sources) | `CitationsPanel.tsx` | This describes … |
| Thread (Tweets) | `Tweets.tsx` | This thread describes … |
| Debate, Reception (in Sources) | `DebatePanel.tsx` | The article has changed since this search ran, … |
| Debate, claims list (in Sources) | `DebatePanel.tsx` | `DEBATE_CLAIMS_LIST_STALE` |
| Quotes | `QuotesPanel.tsx` | The article has changed since these were chosen. … |
| Quiz | `QuizPanel.tsx` § `Staleness` | These questions were written about an older version … |
| Skim, stale reason | `SkimPanel.tsx` § `bannerReason` | The Quotes, Ideas, or outline have changed since … |
| Search | `SearchPanel.tsx` § `StaleNote` | This search describes … / N of these searches … |
| `/design` | `DesignPage.tsx` | the specimen of the banner |

The *outdated* state (an older prompt, same article) has had no banner since 260929c, so it is not
affected.

**Two notices were kept on purpose because they report a fault**: Skim's stale reason (*"a route
over Quotes that have moved can stop where nothing is"*, 261009i) and Quiz (*"every mark is refused
with a 409"*). Greg's words cover them too ("in each case"), so both get the ×. What the notice was
protecting is still covered somewhere else: when Quiz refuses a mark, the place where the mark is made gives its own reason
(`routes.ts` § `refuseAMovedQuiz`: *"The article has changed since these questions were written, so
this answer cannot be marked against them. Write the questions again."*), and a Skim stop
that points at nothing already falls back to its own message. The × hides the warning. It does not
hide the fault.

## How long a dismissal lasts: until the artefact is made again

The options were *this view* (component state, which comes back when the band is reopened), *this
version of the article* (which needs every mode's own input fingerprint, and there are four kinds),
or *this artefact*. The last is the one that matches what Greg said: "if I don't want to rerun it".
The dismissal is about *this* glossary, thread, or list, so:

- **Key: `<mode>:<identity>`**, where the identity is the artefact's own clock, the same value every
  owner hook already gives `useRewriteHold` (`generatedAt` for most, `searchedAt` for Debate,
  `batchId` for Quiz, the route's `generatedAt` for Skim, the run id for a saved search). Re-running
  re-stamps it, so the new artefact's notice is a new key, and if that artefact goes stale later its
  notice comes back.
- **A further change to the article does not bring it back.** The reader has already said they will
  not re-run this artefact, and a second edit does not change that. This is the simpler choice. If
  it turns out wrong, the key gains the article's fingerprint later.
- **Search** is per saved run (`search:<runId>`). Its banner counts the stale runs that are ticked,
  so the × dismisses each one it counted. A run that goes stale afterwards brings the banner back,
  counting only itself. The ⚠ on each row stays, because it labels the row rather than giving notice.

## Where it is stored, and what this stores about a reader

**A new table, `stale_notice_dismissals`**, owner-scoped through the article like
`glossary_hidden_entries`:

| column | |
|---|---|
| `article_id` uuid, FK → articles, `on delete cascade` | |
| `notice` text, `check` format `^[a-z-]+:[^\s]{1,80}$` | the key above |
| `created_at` timestamptz not null default now() | when it was first dismissed |
| `dismissed_at` timestamptz not null | set again on each dismissal |
| primary key `(article_id, notice)` | |

**This is a field stored about a reader**: which outdated notices they chose not to act on, and
when. It is allowed because an admin asked for it. It goes out with the reader's export and is
deleted with the article. Skim's two `articles` columns from 261009i stay where they are: they hold
a different fact (the profile notice, keyed on the profile hash), and moving them is churn with no
reader-visible gain.

**The server does not check the key against the current artefact.** It is opaque, bounded, and has a
fixed form, and the `<mode>` part must be one of a fixed list (`src/stale-notice.ts`). A key that
names no artefact on screen never matches anything, and the row is the owner's own, so a stray key
harms nothing. Checking it would need a loader per mode in one route, which means ten couplings to
guard nothing.

## Routes

- `GET /api/stale-notices/:slug` → `{ dismissed: string[] }`. Owner only (a stranger's slug is a 404,
  through `articleIdForOwned` as `glossary-hidden` does).
- `POST /api/stale-notices/:slug`, body `{ notices: string[] }` (1–50, each valid). Upserts each
  key, moves `dismissed_at` forward, and answers 204. Never spends.

## Client

- **`src/web/useStaleNotices.ts`**: one module-level cache per slug (a `useSyncExternalStore`), so
  ten panels make one GET between them. `isDismissed(key)` and `dismiss(keys)`. The dismissal hides
  at once (optimistic). A failed POST **reads again** and shows "Could not hide this" only if the
  read shows the dismissal did not land, which is the rule 261009i and `useGlossary`'s hide follow.
  It is fenced to the job engine's epoch / signed-in account the way `rewrite-hold.ts` is, so a
  sign-out forgets it.
- **`src/web/StaleNotice.tsx`**: the `gloss-stale` banner, its ⚠, the sentence, an × at the end of
  the sentence, and the panel's own run button below. **One component for every mode**
  (controls.md § controls that do the same job look the same). The × is the `close-x` Skim's profile
  notice already uses, with the class renamed from `skim-notice-close` to a shared one, and Skim's
  profile notice draws through the same component. Tooltip: *"Keep this as it is, and stop saying
  so until it is made again."* Accessible name: *"Dismiss this notice"*. Quotes' banner uses
  `quotes-stale` rather than `gloss-stale`, and keeps its own class through a `className` prop.
- **Visitors** (Search's banner is the only one a visitor sees) get the × too, held in memory for
  the page view, since they own nothing to store it against.
- `/design` shows the specimen with its ×.

## Simpler options passed over

- **localStorage.** No migration or route. Passed over for the same two reasons as 261009i: *store
  when it happened* (AGENTS.md § Writing code), and it would not follow the reader to the phone,
  where a banner costs the most room.
- **Component state only** ("this view"). It comes back every time the band is reopened, which is
  exactly when Greg would see it again.
- **A per-mode column or GET field for each artefact**, as 261009i did. That is fourteen route and
  hook changes, against one table and one shared hook.

## Tests

- Route: dismiss then GET lists it; a second dismiss moves `dismissed_at` forward; a stranger's slug
  is a 404 on both; a bad body (unknown mode, empty list, over 50 keys, malformed key, extra field)
  is a 400; deleting the article cascades the rows.
- Registries: schema drift, export covers tables, created-at on action tables, migration registry,
  authenticated route contract.
- Hook: optimistic hide; a failed POST whose re-read shows the key stays hidden; a failed POST whose
  re-read does not show it brings the notice back with the sentence.
- Component, one row per mode: the stale banner has an × and pressing it hides the banner (a table
  test, so a new stale banner without the component fails it). The row asserts the key passed for
  each mode.
- Seen in a browser at desktop width and at 390px.

## After GPT Sol's plan review

[Review](261010a-dismiss-older-version-notices-plan-review-sol.md), verdict *build with fixes*. Each
finding, and what it changed. **Where this section and the ones above disagree, this one wins.**

1. **Missed notices: Sketch, Illustrated, Claims.** Added. `SketchView.tsx` and `IllustratedView.tsx`
   put the stale sentence into a grey caveat line alongside other facts. It moves to its own line,
   with the × beside it. The other caveats (lost boxes, profile) stay where they are and cannot be
   dismissed, because they are not this notice. `ClaimsPanel.tsx`'s *"Answered about an earlier
   version of this paper."* gets the × too. Two **row-level** warnings stay as they are:
   `CriteriaPanel.tsx`'s per-criterion ⚠ and the Debate check row's *"Checked against an earlier
   version"*. Each labels one row rather than giving notice, like Search's per-row ⚠.
2. **A search keeps its run id when it is answered again.** The key is
   `search:<runId>@<finishedAt>`, and `finishedAt` changes on a revision or a retry. The build
   checks that the client receives it.
3. **Quiz is left out.** When it is stale, every mark is refused and the answer controls are
   disabled, so there is nothing usable to keep, and the banner is the only explanation of the
   disabled box. A dismissal would leave a broken box with no reason given. **Skim's stale reason
   is in**: the route still works stop by stop. A stop that points at nothing gets its own words, a
   tooltip and accessible name *"This quote is no longer in the Quotes"*, so the explanation no
   longer depends on the banner.
4. **A banner that carried the job.** Wherever a panel hides its foot while the artefact is stale,
   because the banner's run button carries the progress and Stop (Ideas, FAQ, Timeline, Simple,
   and any other found during the build), the gate reads **"the banner is showing"**, not "stale".
   Once the banner is dismissed, a job started from Metadata still shows its progress, failure and
   Stop in the foot. That is the fix 261009i made for Skim.
5. **Bounded storage, replacing the per-notice rows.** One row per `(article, mode)`:

   | column | |
   |---|---|
   | `article_id` uuid FK → articles, cascade | |
   | `mode` text, `check` in the fixed list | |
   | `dismissed_for` text[] not null, 1–50 elements, each ≤ 120 chars, `check`ed | the identities dismissed |
   | `created_at`, `dismissed_at` timestamptz | first time, latest time |
   | primary key `(article_id, mode)` | |

   A dismissal **replaces** the mode's array. For every mode except Search it is one identity. For
   Search it is every stale run the banner counted at that moment, and the client sends the ones
   already dismissed too, so a re-dismiss loses nothing. Storage stays bounded at a handful of rows
   per article, however often anyone presses ×. The route body is `{ mode, identities: string[] }`.
   The GET returns `{ dismissed: { [mode]: string[] } }`. The keys stay opaque, which Sol
   accepts under security-map.md (the row is the reader's own). The bound is what was missing.
6. **Cache races.** `useStaleNotices` keys its cache by `(job-engine epoch, slug)` and shares one
   GET in flight. A GET that began before a write applies only after that write's own read-back,
   which is useSkim's rule. Writes go through a queue per mode, and each sends the whole array
   (Search's union), so two quick × presses cannot undo each other. A failed write reads again and
   shows the failure only if the key is not there. Completions from an old epoch or slug are
   dropped. Tests cover a stale GET landing after a dismiss, two dismisses in a row, a slug change,
   a sign-out, and GET dedup.
7. **Coverage.** Add a source guard: `gloss-stale`/`quotes-stale`/`clm-stale` markup, or the
   *"older version of the article"* wording, outside `StaleNotice.tsx` fails unless it is on a named
   exception list (Quiz, with its reason). Update `store-guarded`, `close-cross` and the
   stale-surface test in `mode-surface-changes-no-markup`.
