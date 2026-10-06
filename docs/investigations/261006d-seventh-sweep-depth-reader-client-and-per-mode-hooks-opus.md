# Seventh sweep, depth: the reader client and the per-mode hooks  (Opus, read-only, 2026-10-06)

The Opus half of the zone. GPT Sol read the same zone separately; I did not look at its document.
Brief: [common](261006d-seventh-sweep-depth-prompt-common.md),
[zone](261006d-seventh-sweep-depth-prompt-client.md). Prior work:
[the fifth sweep's web-client investigation](261003b-fifth-sweep-web-client.md).

Evidence states: **R** reproduced, **C** proved from the code, **H** hypothesis. Line numbers are
from this tree and will go stale; the quoted identifier is the anchor.

## What I read

**In full:** `useOrderedRead.ts`, `useAutoRun.ts`, `public-api.ts`, `useIdeas.ts`, `useTimeline.ts`,
`useFaq.ts`, `useClaims.ts`, `lib/describe-failure.ts`, `ReadError.tsx`, `docs/project/mode.md`.

**The whole hook body, header skimmed:** `useQuotes.ts`, `useDebate.ts`, `useSketch.ts`,
`useIllustrated.ts`, `useTweets.ts`, `useSkim.ts`, `useSimple.ts`, `useCrossrefs.ts`,
`useMirror.ts`, `useStepJob.ts` (the hook and `useStepFinished`; not `stepRunRequest`'s callers).

**The read half only:** `useGlossary.ts` (`useGlossaryRead`), `useCitations.ts`
(`useCitationsRead`), `useQuiz.ts` (`useQuizRead`), `useCriteria.ts` (the opening load),
`rewrite-hold.ts` (header), `lib/opening-read.ts` (header), `article/access.ts` (how a change of
reader reaches the page), `ArticlePage.tsx` § `OwnedArticle`'s always-mounted reads.

**By grep and by region:** `Reader.tsx`. I read about 1,500 of its 4,612 lines in full (271–940,
1076–1204, 1570–1600, 1736–1890, 2418–2430, 2822–2852, 4436–4530) and went through every effect's
dependency list and every `mode ===` comparison by grep. `Metadata.tsx`: the provenance read and
every place it is handed down. `Dock.tsx`, `useSearch.ts`, `useComments.ts`, `useChat.ts` and the
thirteen panels: only the lines that read a hook's read state.

**Postmortems:** the seven named, plus 261004d (*a caught read exception…*), 261005o, 261006f,
and the first half of 261006g (*work made for one reader…*). The seven ids are prefixes that match
more than one file each; the ones I took are listed under (e).

**Skipped, though in the zone:** `activation.ts`, `params.ts`, `mode-catalog.ts`, `lib/sse.ts`,
`lib/api.ts` (beyond its exports and `CACHEABLE`), `reader/passages.ts`, `reader/useReadingPosition.ts`,
`useSearch`/`useComments`/`useChat` beyond their load state, and two-thirds of `Reader.tsx`. Chosen
that way because the brief's decision rests on the hooks; the cost is that anything I say about
`Reader.tsx` is a lower bound.

**Chosen by** the brief's question first, then by what the postmortems named. The churn command was
not run; the fifth sweep's table (`Reader.tsx` 86 commits, 15 fixes) was taken as read.

## What the method could not see

- No browser. Every reader-visible claim is from a hook test or from the code.
- No full suite. Two throwaway test files were run and deleted (WCO1, WCO2); `git status` shows
  only the 261006d investigation files.
- Panels were not read end to end, so "the panel draws X in state Y" is checked only where a
  finding depends on it, and is marked H elsewhere.
- Whether WCO3's unheld *Regenerate* can really be pressed twice in each of seven panels: I proved
  the hold is absent, not that each button is live in the gap.
- Production. Nothing here says how often any of this happens to a reader.

## Findings

Ranked by ease × value, Tier 0 first.

### WCO1 — The quiz's always-mounted read does not hear its own step finish  (Tier 0, **R**)

`src/web/useQuiz.ts` § `useQuizRead`; `src/web/article/ArticlePage.tsx` § `const quiz = useQuizRead(slug)`.

Four reads are held by `OwnedArticle` in every mode because the prose draws from them: glossary,
quotes, citations and quiz. Commit `e039d2acd` (2026-10-02, *Citations, Glossary and Quotes reads
hear their own step finish*) gave three of them `useStepFinished(slug, step, refresh)`. The quiz
read had been hoisted two days earlier (2026-09-30) and was not included.

```
$ grep -rn 'useStepFinished(slug' src/web
useCitations.ts:365   useGlossary.ts:439   useQuotes.ts:281   MarginaliaColumn.tsx:815-818
```

**Failing input.** Press Learn → Quiz on an article with no quiz (the run starts), then open any
other mode before the job ends. The job finishes; nothing re-reads; the questions that Greg asked to
be *"always show[n] in situ in the text, whether you're in quiz mode or not"* are not drawn until
the Learn band is reopened or the page reloaded.

**Reproduced.** A copy of `tests/always-mounted-reads-refresh.test.tsx` with one row added,
`["quiz", useQuizRead]`: the three existing rows pass, the quiz row fails with
`one read after the job, not none: expected ['GET /api/quiz/always-mounted'] to deeply equal [Array(2)]`.

Ease 5, value 3, risk low.

**Fix, as a separate claim.** One line in `useQuizRead`, and the row in that test's `READS`. With
the band open, the band's `useStepJob` refreshes too; the existing test's *both completion
listeners coalesce* case covers that for the other three and would for this. **And the class:**
`READS` is a hand list of three. Nothing derives "which reads does `OwnedArticle` hold", so a fifth
always-mounted read will be missed the same way. `read-error-matrix.test.tsx` § *every caller of
useOrderedRead* is the shape to copy: a static half that fails a hook called in `OwnedArticle`
that is neither a row nor a named exclusion.

### WCO2 — A failed revalidation takes the cross-reference links out of the prose  (Tier 0, **R**)

`src/web/useCrossrefs.ts` § `catch { … if (current()) setRead({ slug, links: null }) }`.

Fourteen hooks carry the line `setStatus((was) => (was === "loading" ? "error" : was))` and the
comment *a failed revalidation must not take the list away*. This one clears what it had. Its
comment (*"an owner's reading view without its underlines is the page it was yesterday"*) was true
when the hook read once; it has refreshed on every finished `crossrefs` job since `07a7aaaa8`.

**Failing input.** Links drawn; a job naming `crossrefs` finishes; the refresh GET answers 500 (or
401 after the token refresh, or 429). A dropped connection does **not** show it, because
`/api/crossrefs/` is in `CACHEABLE` and `apiFetch` answers from the saved copy.

**Reproduced** with a throwaway hook test on the real `jobEngine`: opening read returns one link,
the post-job read returns 500, the hook's result goes from one link to `null`.

Ease 5, value 2, risk none.

**Fix, as a separate claim.** In the catch, keep the previous answer when it is for this slug.
Beside it, the same file hand-writes `useStepFinished`: `useJobs("quiet", onFinished)` with
`job.steps.some((s) => s.name === "crossrefs")` is `writesStep` spelled out. Use the shared one.

### WCO3 — Regenerate's hold reached six of the thirteen hooks that have a forced run  (Tier 1–2, **C** / H)

`src/web/rewrite-hold.ts`; callers by `grep -n 'useRewriteHold(' src/web/*.ts`: Quiz, Simple, Ideas,
Glossary, Tweets, Sketch.

`mode.md` states the rule for every mode: *"A forced verb goes through `useRewriteHold` … every
forced control in the panel honours `rewriting`, and the mode is a row in
`tests/rewrite-hold.test.tsx` — which nothing checks you added."* The hold's scope was set by the
fifth sweep's finding list (plan 261004c § 2a, *"The hold in five panels"*), not by which hooks
have a forced verb. These have one and no hold:

| Hook | Forced control | What a second press buys |
|---|---|---|
| `useIllustrated` | `regenerate(note)` — `IllustratedView.tsx` § `view.regenerate(steer.note)` | the dearest job in the app (the hook's own figure: $0.40–$0.65, four to seven minutes) |
| `useQuotes` | `regenerate(useProfile)` — *Find more*, which **appends** | a second append |
| `useTimeline`, `useFaq`, `useDebate`, `useCitations`, `useSkim` | `regenerate()` on the stale banner's `onRun` | a second replace |

C: no hold exists in these seven. H: that each button is enabled in the gap the hold was written
for (job gone from the list, re-read not yet landed, or re-read failed and the old artefact kept).
I did not drive the panels. No reason for the difference is written anywhere I found.

Ease 3, value 3. Risk: each hook needs an identity (`generatedAt` exists on most) and
`useFreshReads`; the panels gain a waiting line a reader sees.

**Fix, as a separate claim.** Either wire the seven, Illustrated first, or write the exemption and
its reason into `rewrite-hold.ts`. Either way give `rewrite-hold.test.tsx` the static half WCO1
asks for: a hook that calls `queue.start({ force: true` is a row or a named exclusion.

### WCO4 — "Check before you publish" reached nine of thirteen; Tweets has the 261004d ordering exactly  (Tier 1, **C**; reach H)

`grep -c 'new MalformedReply' src/web/use*.ts` → Glossary, Ideas, Citations, Debate, Quiz, Faq,
Simple, Quotes, Timeline. Sketch and Illustrated validate through `readSketch` /
`readStoredIllustrated`. That leaves:

- `useTweets.ts` § `setLoaded(found); landed(started, res, found.thread?.generatedAt ?? null)`. A
  `200 null` body queues `setLoaded(null)` and then throws on `found.thread`. The catch sees
  `answered.current === true`, keeps `status: "ready"`, and the thread is gone: postmortem
  261004d's class, in the one hook its fix did not visit.
- `useSkim.ts` § `setSkim(loaded.skim)`. A 200 without `skim` commits `ready` with no route.

Neither is reachable from today's server (`/api/tweets` and `/api/skim` still answer a plain 404;
`src/types.ts` § `NONE_YET_AS_NULL_HEADER` says so). It becomes reachable the day plan 261006h's
open item — *"Tweets, relations, Skim, Sketch and Arc still answer 404"* — is closed server-first.
Ease 4, value 2.

**Fix, as a separate claim.** The same guard as the other nine, before the first setter; two rows
in `read-error-matrix.test.tsx`'s malformed-success table (today: ideas, quotes, glossary, quiz).

### WCO5 — The Metadata page still shows the caught error's own words, and asks "did it fail" two ways  (Tier 1, **C**)

`src/web/Metadata.tsx` § `setProvenanceError((e as Error).message)`.

Plan 261004c moved fourteen hooks to `describeFetchFailure`; this read was left
(`read-error-matrix.test.tsx` § `NOT_A_ROW`: *"It still prints the caught message as it is; that is
another cluster's file"*). It is still so, and the sentence is drawn (`error={provenanceError}`).
In the same file the failure is tested as `Boolean(provenanceError)` four times (`useArchive`,
`AboutYou`, the comments row, `DeletePermanently`) and as `provenanceError === null` once (the
sharing card's `checking`). They disagree on `""`, which is postmortem 261005i's class (*failure
presence inferred from message contents*). I found no path that produces an empty message, so that
half is H.

Ease 5, value 2. **Fix:** `describeFetchFailure(e as Error)`, and one predicate.

### WCO6 — After a failed retry over "none yet", twelve hooks forget the "none" and Tweets keeps it  (Tier 1, **C**)

Sequence: the read answers 404; a later read fails; the reader presses *Try again*; that fails too.

- Twelve hooks: `retryRead` sets `loading` because the value is null, and the catch's
  `was === "loading" ? "error" : was` lands on `error`. The empty state and its *Generate* button are
  no longer drawn; only the sentence and *Try again* are.
- `useTweets` § `setStatus((was) => (was === "loading" ? "none" : was))`: back to `none`, button kept
  (the 261004f fix).

Same sequence, two endings, and the reason is written only on the Tweets side. Reader-visible, so
which is right is under *For the owner*. The Read type below settles it by construction.

### WCO7 — `useIllustrated`'s re-ask key stringifies an object  (Tier 1, **C**)

`src/web/useIllustrated.ts` § `` `${queue.failed ?? ""}\u0000${queue.job?.id ?? ""}` ``.

`queue.failed` has been a `StepFailure` object since 2026-09-03 (the interface comment above it
says so), so the first half is `[object Object]` or empty. It still changes whenever a failure
appears or a job id changes, which is every case I could construct, so nothing is broken. The key
no longer says what its comment says it does. Ease 5, value 1. **Fix:** `queue.failed?.message`.

### WCO8 — Counts and a storage layer that comments still describe  (Tier 1, **C**)

- *"shared with the seven other artefact readers"*: `useTimeline`, `useArc`, `useGlossary`,
  `useIdeas`, `useQuiz`, `useSketch`, `useQuotes`, and `useOrderedRead.ts`'s own header.
  `grep -rl 'useOrderedRead(' src/web` gives 19 callers.
- `useAutoRun.ts` header: *"Eleven targets can do this"*, listing none of FAQ, Skim or Simple, each
  of which calls it. Fourteen call sites.
- `Metadata.tsx`: *"walking the filesystem for it would charge every reader"*, *"that endpoint is
  already walking this article's directory"*. The filesystem store went on 2026-09-05.

`mode.md` already says *"Nothing counts the modes, anywhere, and it must stay that way."* **Fix:**
delete the numbers rather than correct them.

### WCO9 — `mode.md`'s residue does not mention the mode comparisons in `Reader.tsx` outside the switch  (Tier 1, **C**)

`grep -cE '\bmode (===|!==) "' src/web/reader/Reader.tsx` → 21, naming nine modes. `modeBand()`'s
switch is compiler-checked; these are not, and a new mode that steps, hands off or hides chrome has
to find them by reading. See *Reader.tsx* below for the list. **Fix:** one bullet in `mode.md`'s
residue (signposting, so no approval needed) naming the four groups.

### WCO10 — The Read type  (Tier 3: named and sized below, not designed)

See *The five questions*. Size: the spike is one hook, four consumer files, about a day with its
tests. All thirteen: 20 files, 93 consumer lines, most of a week with review.

## Siblings compared

### The thirteen artefact reads

All thirteen: use `useOrderedRead`; return a four-word `status` (`loading | none | ready | error`),
a nullable value and `error: string | null` as three separate facts; keep the value and the status
through a failed revalidation; have `retryRead`; send no `AbortSignal` and fence a late reply with
`current()`; and are reset on a change of article or reader **only by unmounting** — `OwnedArticle`
is `key={slug}`, and `useArticleAccess` answers `loading` in the render where `readerId` changes.
None of them knows the reader. Only the cells that differ are below. **Bold** differs from the
majority; "—" is the majority.

| Hook | Where the read is mounted | "None yet" on the wire | Malformed 200 | After 404 → fail → retry → fail | Forced run held | Hears its step when the band is shut | Facts beside the value |
|---|---|---|---|---|---|---|---|
| Ideas | band, and Marginalia, and Skim | `200 null` (header) or 404 | `MalformedReply`, old value kept | `error` | yes | via Marginalia's `useStepFinished` | stale, outdated, profiled, profileChanged, `fresh` |
| Timeline | band, Marginalia, Skim | — | — | — | **no** | via Marginalia | stale, outdated |
| FAQ | band, Marginalia | — | — | — | **no** | via Marginalia | stale, outdated |
| Debate | band, Marginalia | — | — | — | **no** | via Marginalia | stale, outdated |
| Quotes | **`OwnedArticle`, always** | — | — | — | **no** (and its forced run appends) | yes | stale, outdated, profiled, profileChanged |
| Glossary | **`OwnedArticle`, always** | — | — | — | yes | yes | + `panelRun`, `hiding`; **the only one with a render-time slug reset** |
| Citations | **`OwnedArticle`, always** | — | — | — | **no** | yes | stale, outdated; **local patches over the value** |
| Quiz | **`OwnedArticle`, always** | — | — | — | yes | **no — WCO1** | + kept answers |
| Simple | band | — | — | — | yes | n/a | + `preview` |
| Sketch | band | **404 only** | own validator; **empty scene list → `none` with `faults`** | — | yes | n/a | + `faults`, `drawn`; **the empty branch leaves stale / outdated / profiled as they were** |
| Illustrated | band | **404 only** | own validator; **no plates → `none`** | — | **no — the dearest** | n/a | + `faults`, a second read (`SketchReadiness`, already a union); same leftover |
| Tweets | band | **404 only** | **none — WCO4** | **`none` — WCO6** | yes | n/a | **one `loaded` response object, not five `useState`s**; **`ready` with `thread: null` is possible**; its own recheck sentence |
| Skim | band | **404 only** | **none — WCO4** | — | **no** | n/a | + `notOnRoute`, `waitingRun`; **its status is gated on two other hooks' statuses** |

Written reasons: the 404-only five are named as left open in plan 261006h. The Tweets ending has
postmortem 261004f. Nothing else in a bold cell has a reason written down.

Can each state be told apart today? *Asking* (first read): yes, `loading`. *Failed with nothing
known*: yes, `error`. *Known-empty*: yes, `none`. *Known with a value*: only as `ready` **and** value
non-null, checked together (32 lines match `status === "ready" &&` or `?`). *Failed over a known
answer*: only by reading `error` beside a `ready`/`none` status — the 261004c bug. *A refresh in
flight over a known answer*: **not at all**; `reload` and `refresh` do not touch `status`.
*Stale*: a boolean beside the value, re-checked by each consumer that draws into the prose.

### The other reads in the zone

| Hook | Shape | Ordered | Failure | Retry | Reset | Abort |
|---|---|---|---|---|---|---|
| `useCrossrefs` | value only, tagged with its slug | `useOrderedRead` | **silently empty, and clears what it had — WCO2** | none | slug tag + remount | fence |
| `useClaims` | **`run` + `loaded` + `loadFailed` + `error` + a three-state `fingerprint`** | `useOrderedRead`, the one `discard()` caller | `describeFetchFailure`; a body `error` is also a failure | `useAutoRun`'s one re-read; **during it `status` stays `error`** | effect on slug (does not clear `error`) | fence; **the POST stream is not aborted on unmount** |
| `useCriteria`, `useSearch`, `useComments` | **rows + `loaded` + `loadError`** (`loadFailed` derived) | `openingRead` with a 15 s deadline, `live` flag | `loadError`, kept until reload | **none, on purpose** (`opening-read.ts`: a retry is a second snapshot racing the reader's writes) | effect on slug | **aborted** (`abandon()`) |
| `useChat` | a `LoadPhase` union inside the reducer, **flattened to `loaded` / `loadFailed` at the door** | reducer drops a superseded load | phase `failed` | `reload()` | reducer | n/a |
| `useMirror` | one `status` union (`idle / running / done / failed`); no read at all | n/a | `describeFetchFailure` | press again | effect on slug | **`AbortController`** |
| `Metadata.tsx` provenance | **value + `provenanceError` + `provenanceOffline` + `failedReads`**, handed to children as `checking` / `failed` / `known` / `error`, chosen per child | `useOrderedRead` | **raw message — WCO5** | four timed re-reads of a failed *first* read | effect on `reload` | fence |

### How the prose decides to draw from an always-mounted read

`Reader.tsx`, four reads, three rules:

| Read | Gate | Reason written |
|---|---|---|
| glossary | `glossaryRead?.glossary?.entries` — no status, no stale | no (terms are matched by text, so stale is harmless) |
| quotes | `capability.quotes.quotes` — no status, no stale | no (same) |
| quiz | `status === "ready" && !stale` | yes: *"its passages may no longer be the prose"* |
| citations (margin) | `status === "ready" && !stale` | yes |

Not a defect. It is the same question — may this answer be drawn — asked four ways.

### `Reader.tsx`

**Its reasons to change**, each of which I saw at least one commit comment for: (1) the fit
arithmetic and the band covering or stepping aside; (2) navigation policy — the Dock's `onMode` is
a hundred-line closure inside the JSX, with Plain, toggle-to-close, Marginalia, Search arrival,
sub-modes and the herald in it; (3) one `Found[]` / `openKey` pair per marking mode (the fifth
sweep's W6, held); (4) hand-offs between modes — the chat handoff and its senders, the quiz
arrival, the Skim arrival, the term / idea / event openers; (5) comments, bookmarks and selection;
(6) keyboard routing; (7) `modeBand()`. One component holds 30 `useState`, 17 `useRef`, 19
`useQueryState(s)`, 20 effects, 36 memos and 39 callbacks.

**Effects whose dependency list encodes an ordering:**

- `useLayoutEffect(clearArrivalAnchor, [mode])` must be a layout effect so it runs before the new
  band's passive effects ask where the reader is. Written.
- Reset-on-leave, one effect per piece of state, each `[mode]`: `setBandAway(false)`, the `herald`,
  `if (mode !== "chat") setChatHandoff(null)`, `if (mode !== "learn") setQuizArrival(null)`, the
  held flash. Each is correct only because *"the mode and the handoff are set in one event, so they
  arrive in one commit"* (its comment). A hand-off set a tick after the navigation would be cleared.
- Four "latest value in a ref" mirrors with two timings and no reason for the difference:
  `currentMode` and `inQuiz` and `modeWas` are written in passive effects; `commentsNow` and
  `refereeNow` in a dependency-less layout effect. A callback that fires between commit and the
  passive flush reads the previous mode from the first three. H: I did not find a caller it bites.

**State that duplicates the URL:** none as `useState` in what I read. `mode` is subscribed four
times (`useQueryState("mode")`, `setModeAndMargin`, `quizNav`, `subNav`), which is one store read
four ways, and `nowInQuiz` is derived from `quizNav.mode` rather than `mode`. One direct read of
`location.search` (the Marginalia word), with its reason written.

**Per-mode branches outside the switch** (WCO9), by group:

- chrome: `bandOpen = mode !== "plain"`, `showCrumbs … mode !== "structure"`, `placing={mode === "referee"}` (twice), `refereeNow`;
- ← / → stepping: `skimKeys` (`mode === "skim"`), `quizStepKeys` (`"learn"`), `quoteStepKeys`
  (`"quotes"`), and `mode === "structure"` as `useArrowNav`'s last argument, chained as
  `skimKeys ?? quizStepKeys ?? quoteStepKeys`;
- hand-offs and overlays: the chat overlay's `mode === "chat" || mode === "learn"`, the two
  reset-on-leave effects, `modeWas.current === "chat"`, `inQuotesMode`, the Skim door;
- the Dock press: `mode === "plain" && !marginOpen`, `next === "search"`.

## The five questions about `asking | failed | known`

### (a) Which hook is the best spike

**`useIdeas`.** 316 lines, 16 test files touch it or its panel, and it has a row in each of the
three sibling tables (the failed-read matrix, the malformed-success table, the rewrite hold). It is
the hook `mode.md` tells a new mode to copy. And it meets every seam the type has to survive except
two: the read half is already split out (`useIdeasRead`), it is mounted twice (the band and
Marginalia), another hook reads its status (`useSkim` § `ideasFirst`), it feeds `useAutoRun`, and
it carries the hold's `FreshReads` and the profile facts. Its consumers are four files:
`IdeasPanel.tsx` (7 lines), `MarginaliaColumn.tsx` (1 status read), `SkimMode.tsx` (1),
`useSkim.ts` (3 lines reading `ideas.status`).

Not FAQ, which is simpler but has no hold, no profile and no second hook reading it, so a spike on
it would pass without having met the hard parts. Not Glossary, Citations or Quiz: always-mounted,
with local patches over the value (`patchEntry`, `applyFound`, kept answers) — the two seams Ideas
does not have, and the right *second* step.

### (b) What the type must say that three words cannot

From the states the hooks are actually in, written as (status, value, error):

| # | State today | Where | Three words? |
|---|---|---|---|
| 1 | (`loading`, null, null) | every opening read | asking |
| 2 | (`error`, null, msg) | a failed opening read | failed |
| 3 | (`none`, null, null) — the server said *none yet* | every hook; it is what `useAutoRun` spends on | **no** — `known` with what? |
| 4 | (`ready`, V, null) | | known |
| 5 | (`ready`, V, msg) — a refresh failed over a value | all 13, on purpose | **no** |
| 6 | (`none`, null, msg) — a refresh failed over *none yet* | all 13; postmortem 261004c | **no** |
| 7 | (`ready`, V, null) with a re-read in the air | all 13, invisible | no, and nobody draws it |
| 8 | (`loading`, null, null) reached by *Try again* from 6 | 12 hooks; forgets the *none* (WCO6) | **no** |
| 9 | (`ready`, V) where V is stale / outdated / written for another profile | 13 | not the read's business, but see below |
| 10 | (`none`, null) **because what is stored is unusable**, with `faults` | Sketch, Illustrated | **no** — a third kind of empty |
| 11 | a value that came from the browser's saved copy | `provenanceOffline`, Search's `loadFromCopy`, the hold's `landed(started, res, …)` | **no** |
| 12 | *none*, and a prerequisite read is still out or refuses | Illustrated's and Skim's `gate`, which hands `useAutoRun` a made-up `"loading"` or `"ready"` | no |

So, taking the brief's four candidates in turn:

- **A failed refresh over a known answer: yes, required.** States 5 and 6 are deliberate in all
  thirteen hooks and the Metadata page (`known=true, failed=true`, its own comment). With three
  exclusive words a hook must pick `failed` (the list vanishes, which the guard exists to stop) or
  `known` (the failure vanishes, which is 261004c). The sketch as written would re-create one bug
  or the other.
- **Known-empty versus known-with-value: yes, required**, and it is the distinction that decides
  whether money is spent. `known` must carry `T | null`, or be two kinds.
- **A refresh in flight over a known answer: no.** Nothing draws it. The one consumer that needs
  "has a read that *started after X* landed" is the hold, and it needs sequence numbers, which it
  already keeps in `FreshReads`. Leave that where it is.
- **A run in flight: no.** `job / starting / stalled / failed / rewriting` are already one object
  from `useStepJob` and the hold. Keep it beside the read, not inside it.
- **Never-had versus no-longer-has: no, not here.** An artefact read that answers *none* after
  *ready* simply clears. That distinction belongs to list reconciliation (`useChatAnchors`), which
  is 261005q and is not this type.

Two things the brief did not list and the hooks need:

- **The facts that arrive with the answer belong inside it.** `stale`, `outdated`, `profiled`,
  `profileChanged`, `faults`, `notOnRoute`, `panelRun` are separate `useState`s that each branch of
  `load` must remember to reset. Sketch's and Illustrated's empty branches do not reset four of
  them. `useTweets` already keeps one response object and derives the rest; it has three
  `useState`s where Ideas has seven.
- **Where the answer came from** (the server, or the saved copy): three consumers already need it.

The smallest shape that says all of that — offered to size the work, not as the design:

```ts
type Read<A> =
  | { kind: "asking" }                      // nothing known: the first read, or a retry after `failed`
  | { kind: "failed"; error: string }       // nothing known, and the read failed
  | { kind: "known";
      answer: A | null;                     // null: the server said "none yet"
      from: "server" | "copy";
      recheck: null | { error: string } };  // the last re-read failed; the answer above still stands
```

where `A` is the hook's own record (`{ ideas, stale, outdated, profiled, profileChanged }`).
Note what this is: today's four-word status, with the value and the error moved inside it. The
three-word sketch is one word short and one field short.

### (c) Which consumers read the status and the error today

Artefact reads. Pattern: a hook result's `.status` compared to one of the four words, or its
`.error`, outside the hook that owns it.

```
$ P='(owner|view|read|Read|quotes|ideas|glossary|timeline|debate|citations|quiz)\??\.(status (===|!==) "(loading|none|ready|error)"|error\b)|quizRead\?\.status|glossaryRead\?\.status|ideasRead\.status|faqRead\.status|timelineRead\.status|debateRead\.status'
$ grep -rnE "$P" --include=*.tsx --include=*.ts src/web   # minus the hooks' own files and unrelated panels
```

93 lines in 20 files:

| File | Lines | | File | Lines |
|---|---:|---|---|---:|
| `Tweets.tsx` | 7 | | `SkimPanel.tsx` | 4 |
| `QuotesPanel.tsx` | 7 | | `FaqPanel.tsx` | 4 |
| `QuizPanel.tsx` | 7 | | `CitationsPanel.tsx` | 4 |
| `IdeasPanel.tsx` | 7 | | `useSkim.ts` (reads Quotes' and Ideas') | 4 |
| `GlossaryPanel.tsx` | 7 | | `marginalia/MarginaliaColumn.tsx` | 4 |
| `SketchView.tsx` | 6 | | `reader/Reader.tsx` | 3 |
| `SimplePanel.tsx` | 6 | | `modes/skim/SkimMode.tsx` | 3 |
| `DebatePanel.tsx` | 6 | | `find-more.ts` | 2 |
| `TimelinePanel.tsx` | 5 | | `modes/summary/SummaryMode.tsx` | 1 |
| `IllustratedView.tsx` | 5 | | `modes/debate/DebateMode.tsx` | 1 |

So: 13 panels hold 75 of the 93. **`Reader.tsx` reads three** (quiz, citations, glossary) and
`useAutoRun.ts` takes the status as its argument. **`Dock.tsx` and `Metadata.tsx` read none of the
artefact hooks' state.** What they read is the other family: `loaded` / `loadError` / `loadFailed`
(`grep -c` of those three words: `Dock.tsx` 39, `SearchPanel.tsx` 34, `Metadata.tsx` 22 — mostly
its own `checking` / `failed` / `known` props — `ConversationModes.tsx` 21, `SearchMode.tsx` 17,
`CandidatesPanel.tsx` 17, `Reader.tsx` 10, `CriteriaPanel.tsx` 9, `PlaceOnCriterion.tsx` 6,
`ClaimsPanel.tsx` 2; these counts include comments and prop declarations).

Two idioms account for most of the artefact lines and would become one `switch` or one helper:
`value !== null && (owner === null || owner.status === "ready")` (10 lines), and
`{owner?.error && <ReadError … />}` beside `{owner?.status === "none" && …}`.

`useAutoRun` does not need to change in the spike: `statusOf(read)` gives it the four words.

### (d) Is `PublicRead<T>` the thing to generalise

**No. It is a different job.** `PublicRead<T>` is what **one fetch came back with**:
`ok | not-shared`, and it throws for everything else. It has no *asking* and no *failed*, by design,
and it exists to make a 404 a value. The Read type is what **a component knows over time**. The
only thing to borrow is its lesson, which is (b)'s second point: *none* is an answer, not a failure.

The real precedents are the ten or so unions the client has already grown, one at a time, for
exactly this: `ArticleAccess` (`article/access.ts`), `ShelfState` (`PublicLibraryPage.tsx`),
`ArticleCost.tsx`'s `load`, `FeedbackEarlier.tsx`, `useAutosavedText.ts`, `SketchReadiness`
(`useIllustrated.ts`), `CardState` (`AccessSharing.tsx`: `checking | unknown-because | known`),
`add-share-link.ts` (`unknown` with `because` and `checking: boolean` — a failed read being asked
again), `add-high-power.ts`, and `LoadPhase` in `chat/model.ts`. Everything written since about
mid-September reaches for a union; the thirteen artefact hooks predate the habit. So the type
would be the eleventh of its kind and the first shared one.

### (e) Would it have prevented each of the seven

The ids are prefixes; these are the files I took.

| Postmortem | Prevented? |
|---|---|
| 261004c *an empty artefact state can still carry a failed read* | **Only with `recheck`.** With three exclusive words it is re-created. Even then a view can ignore a nested field; it is forced only if the panel draws failures through one helper. |
| 261004f *a previous 404 cannot settle the next failed retry* | **Mostly, by the transition function, not by the type.** One value set by one `failed(prev, error)` cannot stay `asking` after a request ends. A hook that hand-writes the transition can still get it wrong. |
| 261005q *a refetch cannot tell never-had from no-longer-has* | **No.** That is provenance of a *row* inside a list. |
| 261005r *a publication 404 does not establish sharing state* | **No.** An answer to one question was used as the answer to another. Its fix was an `unknown` member on a different type. |
| 261006b *a read completion does not prove it followed a write* | **No.** Ordering; `useOrderedRead`'s class. |
| 261006g *a read still out, drawn in the words of a read that failed* | **First half yes, exactly** — a card handed a `Read<Sharing>` cannot be handed "not known" without a reason. Second half (one failure is final) no. |
| 261005i *failure presence inferred from message contents* | **Yes**: `failed` is a kind, not a truthy string. (If the brief meant *a pending origin mistaken for an acknowledged one*: no.) |

Two yes, two only with more than the sketch, three no. The three it cannot touch are about order
and provenance, and those are most of what goes wrong with reads here.

### Does it collapse into the rejected generic hook, and is it worth it

**It goes most of the way there, and that should be said before the spike rather than found after
it.** To make 261004c and 261004f impossible rather than merely less likely, the type needs its
three transitions written once: start, landed, failed. Those are already identical in the hooks —
`was === "loading" ? "error" : was` is in 14 files, the `retryRead` body in 13 — and the one hook
that wrote its own variant is the one with a postmortem. Once a hook returns `Read<A>` and calls
three shared functions, what is left of its `load` is the URL, the header, the validation and the
identity. That is the fifth sweep's rejected `useArtefactRead` with the fetch left out. The
rejection's stated reason was that the hooks *"differ substantively"*; having read all thirteen,
they differ in their parse and their extra facts, and not in their state machine.

**Is it worth it? In the narrow form, yes, and for a reason the postmortems understate.** Its main
yield is not the seven postmortems (two of seven). It is that a fix to the read's state machine
would be made once: WCO6 and the leftover flags in Sketch and Illustrated are this sweep's
examples, 261004c, 261004d and 261004f the last one's. It would do nothing for WCO1, WCO2 or WCO3,
which are about which hooks are *wired to* something; a test that walks the siblings finds those,
and is cheaper.

**Shaped differently from the sketch:** four states, not three; the response's facts inside the
answer; three pure functions in one module; no shared hook, no shared fetch. **And a stop
condition for the spike:** if `IdeasPanel` comes out longer or harder to read, or if `useIdeasRead`
still needs a `useState` beside the `Read`, stop — the type is not paying. The saved-list family
(`loaded` / `loadError`) should be left out of it altogether: it has no retry on purpose, and
`Read` with half its transitions forbidden is a worse fit than the three booleans.

## For the owner

1. **The Read type** — a shared type for "what a mode knows about its stored result", replacing a
   status word, a value and an error held separately. *Removes:* the chance for one hook to end up
   in a combination the others cannot reach. *Costs:* about a day for one hook; most of a week for
   thirteen, touching 20 files, with nothing a reader would see. *It would not have stopped* five of
   the seven bugs it was proposed for without being made larger than the three-word sketch, and
   three of them not at all. Recommend the one-hook spike on Ideas, with the stop condition above.
2. **After a failed *Try again* on a mode with nothing in it** (WCO6): should the *Generate* button
   still be there? Today it is on the Thread and gone in the other twelve. Keeping it is one more
   press that can spend; removing it leaves only *Try again*.
3. **Regenerate's hold in the seven modes without it** (WCO3). *Adds:* a disabled button and a
   waiting line in Illustrated, Quotes, Timeline, FAQ, Debate, Citations and Skim, for the second or
   so after a rewrite finishes, or until *Try again* succeeds if that read failed. *Removes:* a
   possible second paid run. Illustrated alone is most of the value.
4. **`Metadata.tsx` says *"Checking which files the pipeline wrote…"*** to a reader. There are no
   files. A wording change.

## Considered and not proposed

- **Deleting the in-hook slug resets** (Glossary's render-time block, the effects in Claims, Mirror,
  Criteria, Tweets' `answered`, Crossrefs' slug tag). Dead under `key={slug}` in the app, but the
  hook tests change the slug on a mounted hook and `useOrderedRead` is written for it. Defence in
  depth with tests behind it.
- **A generic `useArtefactRead`.** Rejected in the fifth sweep; I am not bringing it back, only
  saying above that the type's transitions are most of it.
- **One "may this be drawn in the prose" helper** for the four always-mounted reads. Two of the
  four differences have written reasons and the other two are harmless.
- **Splitting `Reader.tsx`, or pulling the Dock's `onMode` closure out.** No drift shown; size is
  not a reason.
- **Moving the 404-only five to `200 null`.** Already recorded as open in plan 261006h.
- **`useClaims` staying `error` during its automatic re-read.** One round trip, and Claims is
  outside the artefact family.
- **The passive-versus-layout ref mirrors in `Reader.tsx`.** No caller found that it bites.
- **Abort signals on the artefact GETs.** They are small, and the fence already refuses the reply.

## One level up

The zone's approach is sound: URL state, ordered reads, a job engine, total tables over `Mode`.
What this pass adds to the fifth sweep's "a fix does not travel" is where it fails to travel *to*:
every case found here (WCO1, WCO3, WCO4, WCO5) is a fix applied to the list of hooks somebody
enumerated on the day — three reads, five panels, fourteen hooks minus one file — and never to
"every hook that has property P". Where the membership is derived and a test fails an unlisted
member (`read-error-matrix.test.tsx`'s second half) nothing was missed; where the list is typed by
hand (`READS` of three, `ROWS` of six) something was. That is a cheaper lever than the Read type and
it is aimed at a different class, so the two are not alternatives: the type makes the thirteen
state machines one, and the derived tables make sure the thirteen are all at the table.
