# UI sweep K4: failure sentences, and five small panel states

Cluster K4 of [the UI sweep umbrella](261007a-ui-sweep-umbrella.md#k4-failure-sentences-and-four-small-panel-states),
which is the plan and was reviewed there. This doc records what landed, what the umbrella and the
builder's brief got wrong, and what was left. The rules it applies are in
[copy.md § The same seam in the browser](../project/copy.md#the-same-seam-in-the-browser), which
now names the new adopters.

## What it is for

Since plan [260924a](260924a-only-a-sentence-the-server-wrote-reaches-the-reader.md) only a sentence
somebody wrote for a reader reaches one, and `describeFetchFailure` in
`src/web/lib/describe-failure.ts` is where a caught failure becomes that sentence. Eleven catches
still printed `(err as Error).message`, so Safari's "Load failed" or a bug's first line was the
explanation a reader got. Beside them, five panels said or offered the wrong thing in a state
nobody had looked at.

## Group 1: the throw seam, then six catches (`b007f68cd`)

**The seam first.** `readAnswerStream` (`src/web/lib/sse.ts`) threw three things: the server's
`error` frame (already a `ReaderFacingError`), the body ending early, and a `done` frame the caller
refuses. The last two were plain `Error`s.

- **A body that ends early is a `ReaderFacingError`.** Its sentence (`ENDED_UNFINISHED`, or the
  caller's own, as the quiz passes) was written for a reader and says to try again.
- **A refused completion is a `MalformedReply`**, chosen on purpose and not by default.
  `MalformedReply` in `lib/reader-facing.ts` is the existing class for "a reply that arrived and is
  not the shape its reader needs", and `describeFetchFailure` gives it `PAGE_FAULT` and reports it.
  That is the right outcome here for a second reason: the sentence this used to throw ended
  "Trying again starts a fresh answer", and *Dig deeper* and *Investigate* send `done` **after**
  storing the answer. So the old advice was an invitation to pay for a second answer when the first was usually
  kept, and `PAGE_FAULT`'s advice (reloading shows what the server finished) is the true one. The
  two sites that can lose a stored answer this way (Glossary's *Dig deeper*, Citations'
  *Investigate*) already re-read their list after any failure. The ask box may finish without a
  new stored answer (`AddedTerm`'s `existing` and `no-glossary` arms), so reloading is not a
  promise to recover that answer; `PAGE_FAULT` still correctly identifies an app fault.

**Who else catches what it throws.** Four callers: `useGlossary.ts` (two), `useCitations.ts`,
`useQuiz.ts`. No file compares the message. Three tests pinned it: `quiz-mark-stream` (the stall's
and the socket's own words) and two files whose mocked `readJson` threw a plain `Error` for a
refusal where the real one throws an `HttpError`; each now says what the real helpers do.

**The six catches** call the helper: Glossary's *Dig deeper* and ask box, Citations'
*Investigate*, the quiz's mark, `useProjection`, `useSimilar`. Projection and Similar keep their
abort check and still keep an earlier good answer over a failed repeat
(`tests/diagram-answer-survives.test.tsx`, unchanged and green).

**The test** is `tests/kept-answer-catches-say-a-readers-sentence.test.tsx`. It poses only `fetch`:
the real `apiFetch`, `readJson`, `readEvents` and `readAnswerStream` run, so a lost connection is
the mark those helpers put on it. Rows per stream site: unreachable, cut mid-stream, stalled,
refused, ended early, malformed completion, unexpected exception. Projection and Similar read JSON,
so they have three rows; the quiz's `done` refuses nothing, so it has no malformed row. **25 of 39
cases were red before the change.** The 14 that were green pin behaviour that already held (a
stall and a refusal in the three sites that had copied the helper's first branch).

Mutations, each turning a test red: the early end back to `Error` (7 fail), the refused completion
as a `ReaderFacingError` (4), and each of the six catches back to `.message` (3 to 5 each).

## Group 2: Skim's purpose box (`012af29a1`)

`savePurpose` rejects whenever the reply to its PATCH is lost, and the route answers after the
write. So "Not saved — {error}" was printed over a sentence that was on the shelf.

The catch now asks what is stored before it says which it was. `storedPurpose` (new, in
`purpose.ts`) is one GET of `/api/reader?slug=`, and only a fresh server 200 that could read the
shelf is an answer: `apiFetch` answers a failed GET from the saved copy with a real 200 and
`x-spideryarn-offline: copy`, which says nothing about a save made a second ago
(`Metadata.tsx` § `stillOnTheServer` has the same rule).

| The read says | The box does |
|---|---|
| the draft is stored | carries on as the press asked: shows *Reading for: …* and plans the route |
| something else, or nothing, is stored | *These words are not what is saved for this article, so no route was planned. {reason}*, draft kept |
| nothing it can trust (a copy, a failure, `purposeFailed`) | *Couldn't tell whether that was saved, so no route was planned. Your words are still in the box. Reload the page to see what is stored.*, draft kept |

`{reason}` is `describeFetchFailure`'s, with its own code last. The third sentence carries no code
and no reason on purpose: the reason for a lost connection says "nothing was sent or received",
which is more than is known there, and Metadata's delete says the same thing the same way
(copy.md § The words on the one control that cannot be undone). The "Something went wrong."
fallback is gone. The simpler option passed over: reword to "may not have been saved" and re-read
nothing. It leaves the reader to reload to find out what one GET can tell them, and it would have
dropped the route they asked for when the save had in fact landed.

Seven cases seen red in `tests/skim-purpose-line.test.tsx`; five mutations each turn it red.

The independent review corrected two assumptions: a mismatched snapshot cannot prove the PATCH
never stored the words (another tab may have replaced them, or the GET may overtake a write still
finishing), and a recovered save must call `profileSaved`, as the ordinary success path does.
Without that notification the command suggestions and link summaries keep the old purpose.
Malformed confirmation fields now leave the result unknown rather than asserting absence.
Five new cases were red for these causes, then green after the narrow fixes.

## Group 3: four more sites (`675d794f9`)

What can throw at each, named before it was routed:

| Site | What reaches the catch | Change |
|---|---|---|
| `SourceLink.tsx` (*View the original*) | `apiFetch`'s marked `TypeError`; `NotThisReader`; its own "The server said 404." (a plain `Error`); `res.blob()` dying part-way (a bare `TypeError` nobody marked); anything in the tab hand-off | helper; the 404 sentence is a `ReaderFacingError`; the blob read marks its `TypeError` |
| `command-runners.ts` (tag add, tag remove) | whatever `TagsControl.edit` rejects with: `editArticleTags` is `apiFetch` + `readJson`, so an `HttpError`, a marked `TypeError`, `NotThisReader`, or a bug | helper |
| `ArticleCost.tsx` | `apiFetch` + `readJson`: the same four | helper |
| `export-download.ts` | `apiFetch`; `failure(res)` (an `HttpError`); `res.blob()` dying part-way; the DOM work | helper; the blob read marks its `TypeError` |

**One code, last.** `SourceLink` and the export append their own code (`[source-open]`,
`[export-failed]`). The helper's sentences for a lost connection and a page fault carry theirs, so
the site's is appended only when the reason has none (`codeOfMessage`, existing). A lost connection
under Export now ends `[net-down]` where it read "Failed to fetch [export-failed]". The 413 branch
is unchanged.

**The blob mark is written twice**, three lines each, in the two files. Its natural home is a
`readBlob` beside `readJson` in `lib/api.ts`, which is not in this cluster's manifest; see § Left.

Ten cases seen red (`tests/source-link-failure.test.tsx`, new; `command-runners`,
`article-cost-section`, `metadata-export-button`). Nine mutations each turn a test red. Two older
tests posed a refusal as a plain `Error` or a synchronous throw out of `fetch`, which the real
helpers never produce; they now use `ReaderFacingError` and a rejected promise.

## Group 4: panel states (`e707aa87f`, and the hold in the review commit)

- **Quotes, `Foot`.** At `MAX_QUOTES_TOTAL` the ceiling sentence stood where a job's progress, Stop
  and failure would have been. `Foot` takes an `elsewhere` element: the existing `rerun("Choose
  them again", true)` row whenever a job is running, starting or failed, drawn in place of the
  sentence. A failed job with an id retries that job (`JobProgress`'s Retry, as everywhere); a run
  that never became a job is asked for again through `rerun`, the forced rewrite, never
  `pressFindMore`. **With the seventh sweep's rewrite hold** (merged from `dev` before the review):
  `owner.rewriting` also selects `elsewhere`, so the hold's "The new quotes haven't loaded yet."
  line shows at the ceiling too, and a failed run's *Choose them again* is disabled while the hold
  is up (`rerun` already passes `runDisabled`). Both are pinned by test.
- **Glossary, occurrence chips.** A chip's jump now calls `setAtBlock`, as `BlockNav.onGo` does.
- **Glossary, the ask box** (from K2's report). It is `type="search"` in a form with no key
  handler. It now cancels an Enter or Escape an input method is using, per
  [keyboard.md § A key an input method is using is not ours](../project/keyboard.md#a-key-an-input-method-is-using-is-not-ours).
  Not checked in a browser with Chrome's composition API; K2 measured the browser default on five
  boxes of the same type, and jsdom has neither default, so the unit test pins the cancel.
- **Referee.** Criteria's *Try again* is drawn only while `worthRetrying(row.error)`; Mirror's
  button is not drawn under a failure that is not worth retrying. The sentence stays in both.
  `useCriteria.ts` is untouched. **A consequence worth knowing:** Mirror has one button, so under
  such a failure there is nothing to press until the reader leaves the sub-mode and comes back.
  That is `JobProgress`'s rule ("neither when another go cannot help"), and the failures it
  applies to are an account or configuration fault or a refusal that would be repeated.
- **Search, the order row.** A `role="group"` named "Order the passages by" (the siblings'
  wording), `aria-pressed` on each button, and in `search.css` under `.srch-sort-btn`: the hover
  behind `@media (hover: hover)`, an `:active`, the app's focus mark, and the 40px floor under
  `(pointer: coarse)`. The group wrapper is `display: contents`, so the buttons are still flex
  items of `.srch-sort`. Not `OrderGroup`. `tests/touch-controls.test.ts` holds Search's buttons to
  the same three checks as the other two rows, and gained a focus-mark check for all three.
- **Search, the hint.** `Results` now knows whether the reader owns the searches, and counts the
  failed rows whose ⚠ is a button:
  - all of them: *The ⚠ on each ticked row above tries it again.*
  - none: *The ⚠ on each ticked row above only marks the failure. It is not a button, because
    running the same search again is unlikely to go differently.*
  - some: *On the ticked rows above, the ⚠ tries the search again where that could work. On the
    others it only marks the failure.*

  "Ticked" is the panel's own word for a switched-on search ("Tick a search above to mark its
  passages"), and every ticked search has failed when this hint shows.

  The review removed the original hint's claim that another go *would* fail the same way:
  the server's refusal says *most likely*, and `worthRetrying` decides which control to offer,
  not whether another attempt is guaranteed to fail. Two tests reproduce that stronger claim
  with the real `providerHttpFailure(403)` sentence, in the all-refused and mixed states.

Red first for each (Quotes 5 cases, Glossary 2 + 2, Criteria 1, Mirror 1, Search 5,
touch-controls 3). Eighteen mutations each turn a test red.

## The browser check

A dev server started from this worktree, Chrome through Playwright, signed in as the seeded reader.
Every non-GET to a route that can run a model was refused inside the browser by a `context.route`
handler, whatever a script pressed. Scripts: `k4-lib.ts`, `k4-measure-search.ts`,
`k4-measure-rest.ts` in the session scratchpad.

**Search's order row**, `/read/levin-self-improvising-memory-spya-gj60pu?mode=search&runs=spya-w0e3ct`
(a saved search with 20 passages), dark theme. Measured before the change and after it with one
script; the table is every value that differs.

| | 1440, fine pointer | 390, touch (`pointer: coarse`) |
|---|---|---|
| Button radius, colours, border, font size, padding | same (10px; `oklch(0.63 0 0)` at rest, `oklch(0.97 0 0)` on `oklch(0.26 0 0)` pressed; 13.28px; 1.6px 6.4px) | same |
| Button x, y, width | same | same (x 130.13, 200.06, 303.67; y 289.53) |
| Button height | same (22.19) | **22.19 → 40** |
| Lines the buttons take | 1 → 1 | 1 → 1 |
| Row height | same | 35.97 → 53.78 |
| Count ("20 passages") | same | y 290.33 → 299.23 (centred in the taller row) |
| `aria-pressed` | none → false, false, true | the same |
| Accessibility tree (CDP) | no group → a group named "Order the passages by"; the three buttons report pressed | the same |
| Focus after a real Tab | the browser's own ring, `auto 1px rgb(238, 238, 238)` → `solid 2px rgb(219, 138, 69)`, offset 1px | the same |
| Hover on an unpressed order (mouse) | `oklch(0.63 0 0)` → `oklch(0.97 0 0)`, before and after | not applicable (`hover: hover` is false) |

So the row at rest is unchanged at 1440, and at 390 the only differences are the floor's.

**Glossary's stepper.** On `/read/vb-spya-vu3xen?mode=glossary`, a term with 10 uses: "1 / 10" on
opening; pressing the second chip went to `spya-bkp9by` and the counter read "2 / 10"; Next read
"3 / 10". On `/read/fowler-phrenology?mode=glossary`, a term with 31 uses: 1, then 2, then 3 of 31.

**Diagram's two failure sentences**, with the two requests refused before they left the browser
(they are POSTs that can embed, see § What the umbrella and the brief got wrong):

- Drift: "Could not place these paragraphs. Couldn't reach the dev server — is `npm run dev` still
  running? (Failed to fetch) [net-down]" and *Try again*.
- Force: "There are no dotted lines, and the rest of the picture is unaffected. Couldn't reach the
  dev server — is `npm run dev` still running? (Failed to fetch) [net-down]" and *Try again*.

That is the development build's wording for a lost connection, which keeps the browser's words in
brackets on purpose (`couldNotReach`); a built page says `COULD_NOT_REACH` alone, which the unit
test pins with `PROD` stubbed. Before the change both read "… Failed to fetch".

Not reached in a browser: Glossary's ask and *Dig deeper*, Citations' *Investigate*, the quiz's
mark (each calls a model), Skim's purpose box (its button is "A paid model call"), the Referee
failures, Quotes at its ceiling, the failed-search hint (no fixture has a failed saved search).
Unit tests cover them.

## What the umbrella and the brief got wrong

- **"The Diagram projection/similar reads are plain GETs"** (the brief). They are POSTs, and the
  hooks say why: the first call embeds the article and costs money. They were refused in the
  browser by the route handler and never reached the server.
- **"Four small panel states"** is five, counting the ask box K2 handed over, and six with the hint.
- **"They have … no `:focus-visible` rule"** is true of the stylesheet and reads as "no focus mark".
  The browser's own ring was showing (1px, auto). The change is to the app's mark, not from nothing.
- **A "failed forced rewrite" at Quotes' ceiling** is, on the server, an append that can add
  nothing: `existingFor` (src/quotes.ts) appends to any list that is current and from this article,
  whatever asked. So "retries the rewrite" means the client asks through `rerun` (the forced verb
  with the reader's profile), which is what was built; it does not make the server rewrite a
  current list.
- **`DiagramPanel.tsx`'s comments** say the strip prints "the server's own words". They were
  already loose (a lost connection printed the browser's words) and are loose in the other
  direction now: the words are the server's when the server answered, and `describeFetchFailure`'s
  otherwise. That file is not in this cluster's manifest; see § Left.

## Left, and why

- **`COULD_NOT_REACH` says "nothing was sent or received just now"** (`src/messages.ts`), which
  is false when a stream or a download dies after delivering some of itself. Every caller of
  `describeFetchFailure` has said it for a cut stream since 2026-09-24; K4 adds the four
  kept-answer streams and the two blob reads. The review's K4-F1, and its one blocker; see
  § Review status. Dropping the clause is the whole fix, in a file outside this manifest.
- **`readBlob` in `lib/api.ts`.** The two blob reads mark a lost connection inline. One shared
  helper beside `readJson` is the right home; `api.ts` is outside this manifest.
- **`DiagramPanel.tsx`'s two comments** ("the server's own words", near where it draws
  `projection.error` and `similar.error`). Not this cluster's file.
- **The other purpose boxes** (`ProfileBox.tsx`, `SettingsSection.tsx`, the add page) still print
  "Not saved — {message}" for every rejection, which has the defect Skim's had. They save on an
  idle timer through `useAutosavedText`, so the fix is in that shared piece and is its own small
  job.
- **Mirror under a failure that is not worth retrying** has no button until the sub-mode is
  re-entered (above). If that proves wrong in use, the alternative is to keep the button under its
  ordinary label.
- **The ask box in a real browser with an input method.** Pinned by unit test only.

## Review status

- Code, round 1: GPT Sol, write-capable inside the cluster. Its prompt and answer are beside this
  doc (`261007a-ui-sweep-k4-code-review-prompt.md`, `261007a-ui-sweep-k4-code-review-sol.md`).
  **Verdict: not ready**, on K4-F1 alone. Eight findings; five fixed by the reviewer and kept
  (three with the builder's wording over the reviewer's, below), one corrected comment, two
  reported. **Sol still objects to K4-F1; overruled as a blocker** because the sentence it faults
  is in `src/messages.ts`, outside this cluster's manifest, has been what chat and the fourteen
  read hooks say for a cut stream since 2026-09-24, and replaces the browser's raw "network
  error" in the sites K4 moved. It is a real defect and is the first item for whoever owns that
  file next: `COULD_NOT_REACH` says "nothing was sent or received just now", which is false after
  a stream has delivered text; dropping that clause fixes every caller. No second round: the
  fixes below were made by the reviewer itself.

  **Reworded by the builder after the review.** K4-F3's sentence became *These words are not what
  is saved for this article…* (the reviewer's *The saved purpose didn't match these words* reads
  oddly when nothing is saved). K4-F4 and K4-F8's hints say "ticked row", the panel's word, and
  the all-permanent one gives its reason with a hedge ("unlikely to go differently") in place of
  the certainty the review removed. `storedPurpose`'s validation is laid out as three early
  returns. Seven mutations of the review's fixes and the hold each turn a test red.

  The reviewer's own account of each finding:

- **K4-F1, P1, established; outside the permitted files.** `COULD_NOT_REACH` in
  `src/messages.ts` says nothing was sent or received. K4 routes mid-stream and mid-blob failures
  to it after headers or text have arrived. The class is *transport classification overstating
  the request's outcome*; the shared sentence predates K4, but these uses are new. It remains
  unchanged because `messages.ts` is outside the five commits' path list.
- **K4-F2, P1, established; fixed.** Skim's recovered save bypassed `profileSaved`:
  *success-path side effects omitted from recovery*, introduced by `012af29a1`. The new test
  observes the real profile generation published by the notification that clears cached summaries
  and wakes the suggestions.
- **K4-F3, P1, established; fixed.** A mismatched read said the write never happened:
  *a snapshot mistaken for write history*, introduced by `012af29a1`. The regression arranges
  a landed write replaced by another tab before the read. The sentence now states the mismatch.
- **K4-F4, P1, established; fixed.** Search's no-retry and mixed hints guaranteed a refusal:
  *a control policy mistaken for certainty about the outcome*, introduced by `e707aa87f`.
  Two red-first tests use the actual `providerHttpFailure(403)` sentence; the hints now describe
  the controls without that guarantee.
- **K4-F5, P2, established at the client seam; fixed.** Missing or ill-typed confirmation
  fields were treated as a read proving absence: *unvalidated data mistaken for evidence*,
  introduced by `012af29a1`. Three malformed-response probes were red first. The current reader
  route does not emit those shapes; this is defensive validation of the new confirmation seam.
- **K4-F6, P3, established; corrected.** The shared stream comment and this doc generalised
  *Dig deeper* and *Investigate*'s storage contract to every `done`. Glossary's ask can return
  `existing` or `no-glossary` without storing the answer. The classification stays `MalformedReply`;
  the explanation now limits the recovery claim to stored answers.
- **K4-F7, P2, reasoned; reported.** Mirror keeps a blocked failure after the comments change,
  with no button until the sub-mode is re-entered. This is documented behaviour within the brief,
  but *retry policy applied to a changed request* risks making the narrower-request escape hard
  to discover. Fixing the hook's response to comment changes would touch `useMirror.ts`, outside
  this cluster.
- **K4-F8, P1, established; fixed.** The all/none hints said *each row above* although the
  count includes only switched-on searches and the list also draws unchecked rows:
  *a subset conclusion widened to the displayed population*. The new no-retry variant was
  introduced by `e707aa87f`; the retained all-retry sentence predates K4 (`dd8de264a8`). Two
  red-first cases display both policies while selecting only one. All three variants now name
  the switched-on searches; the earlier tests always selected every supplied row.

Nine new regression cases were observed red for their intended reasons, then green after the
fixes. Review work stayed inside the candidate paths and was left uncommitted; no network,
database, model call or full-suite run was used. The separate review answer carries the final
check results and verdict.
