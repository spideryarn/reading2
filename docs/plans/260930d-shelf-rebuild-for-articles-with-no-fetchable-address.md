# The shelf's re-fetch button rebuilds, rather than refusing, when there is nothing to fetch

Feedback SPIDERYARN-READING2-6B, from Greg (admin):

> In the logged in homepage shelf, we have a button for refetch and rebuild. It seems to be disabled
> in the case of articles that have been uploaded rather than retrieved from the web, presumably
> because it can't refetch them. It *could* rebuild them though, and so I feel like that button
> should still be active - it should just skip the refetching (and perhaps indicate that in the
> tooltip).
>
> — Greg, 2026-09-30

Status: built and reviewed; on `dev`, not deployed.

## What is there today

`useShelfActions` in [src/web/ShelfEntry.tsx](../../src/web/ShelfEntry.tsx) queues
`POST /api/jobs { slug, force: ["fetch"] }` — `DEFAULT_INGEST_STEPS` (fetch, extract, blocks,
hierarchy, assets) with `fetch` forced, and `cascadeForce` forcing everything after it. It is gated on
`hasWebUrl` (a recorded `final_url` that `isWebUrl` accepts); without one the button is drawn,
`aria-disabled`, with one of two cards: *no address recorded* or *the recorded address cannot be
fetched* ([library.md § When a button cannot do its job](../project/library.md)).

## The change

When there is no web address, the same button queues the same job with **`extract` forced instead
of `fetch`**: `POST /api/jobs { slug, force: ["extract"] }`. `fetch` is then not forced, finds its
`raw` manifest already there (`stepIsDone`), and skips; `extract` onward re-run over the copy we
hold. This is exactly the job `enqueueReset` queues (src/jobs.ts), minus the reset plan — so no new
server path, and nothing here changes what the queue accepts.

- Both no-address cases (none recorded; one recorded that is not http/https) become **live** and
  rebuild-only — unless the pipeline cannot safely reuse the stored copy (see the reviews below).
- The button's accessible name and the touch menu's words (`rerunLabel`, one string for both) say
  `Rebuild from the stored copy (nothing to fetch)`, or
  `Rebuild (no web address and no reusable stored copy)`
  where it is unavailable.
- The tooltip cards `rerunNoUrl` and `rerunNotWeb` become `rebuild` (live: nothing fetched, the
  stored copy processed again, may spend model calls) and `rebuildUnavailable` (unavailable). Neither
  says "you uploaded this" — the card never infers an upload from a missing address (library.md).
- `library.md § When a button cannot do its job` is updated to match.

Same icon (`RefreshCw`). Tests that pinned the disabled state are changed to pin the new one — the
body sent, the button live, the words.

## Considered and passed over

- **Omitting `fetch` from the step list** (`steps: [extract, blocks, hierarchy, assets]`). It would
  avoid a skipped "Fetching the page — already done" row on the progress card of an upload. But it
  puts a copy of `DEFAULT_INGEST_STEPS` in the client, which can drift from the server's, and the
  Reset feature already lives with the same skipped row. Deferred; not worth a second list.
- **Deciding server-side** ("rebuild" as its own endpoint that picks the force). More parts for no
  behaviour the client cannot already express with the existing route.

## Plan review (GPT Sol, 2026-09-30): REJECT, and what changed

Sol traced the request end to end and confirmed it works for an article with a stored source: the
route accepts `force: ["extract"]`, the cascade forces extract..assets, `fetch` skips, the work key
differs from reset and re-fetch, a bare-slug re-run takes no quota slot, ownership is checked, the
draft publishes. Upload records, the page cap and the guessed canonical link (260929g) are unharmed.

- **P1, accepted — the "no stored copy is unreachable" claim above was false.** src/db/schema.ts §
  `rawSourceSha256` says a null reference "is a real answer … an article imported before we kept
  them", and nothing enforces its presence at publication. For such an article the unforced `fetch`
  finds no manifest, runs, and fails with "No source URL". **Fix:** the shelf read now takes
  `raw_source_kind is not null` as a presence flag (`hasRawSource` in src/store/pg.ts, the same
  mechanism as `hasArc`; the read policy grants `library: "presence"`, a boolean, so the reference
  itself still reaches only the `rawSource` read). A web article still re-fetches regardless.
- **P2, accepted — "read afresh" overstated it.** A PDF's unchanged transcription chunks come back
  from checkpoints. The card now says "processed again" and "may spend model calls".
- **P2, accepted — one card, not two.** No address and a non-web address send the same request, so
  they share one card and one name ("Rebuild from the stored copy (nothing to fetch)"). The
  distinction stays on Open the original, where it changes what happens.

The code review (below) was handed this revised plan as well, in place of a second plan round.

## Code review correction

GPT Sol, code review of 48cc3b82: **APPROVE WITH CHANGES**, both fixed by the reviewer in place. The
receipt claim checked against `hasArtefacts` in src/store/artifacts-pg.ts (`run?.status !== "done"`
returns false before any artefact is read). Sol's sandbox could not reach local Postgres; the two
Postgres suites were run afterwards outside it, green, with the 17 other touched suites (327 tests).

The stored-source presence flag was necessary but not sufficient. `stepIsDone(fetch)` reaches
`hasArtefacts`, which also requires the current revision's `fetch` run row to say `done`; new drafts
carry that row beside the source reference. A published or imported revision can hold the reference
without the completed receipt, because publication does not enforce the pairing. In that state the
first implementation advertised a rebuild, then ran `fetch` and failed for want of an address.

The shelf query now returns both booleans from the **current published revision**. `describeArticle`
sets the required `sourceReusable` field true only when the source reference and completed receipt
are both present, and the unavailable copy says *no reusable stored copy* rather than claiming we
hold no bytes. Requiring the boolean also makes the cached-shelf validator reject pre-field rows,
rather than briefly treating an unknown as reusable. The Postgres shelf fixture includes the
distinguishing state — a reference with no receipt — so dropping either half makes the test red.

## Tests

- tests/shelf-actions-menu.test.tsx, tests/shelf-action-tooltips.test.tsx — the live rebuild sends
  `force: ["extract"]` for both absences; unavailable with `sourceReusable: false`; a web article
  re-fetches whatever. Watched red by making the no-address branch force `fetch`.
- tests/reset-and-regenerate.test.ts — the same request through the real claim and publication on an
  article with no address: `fetch` never runs (its fake throws), extract runs, a revision publishes,
  `final_url` stays null.
- tests/store-shelf-reads.test.ts — `sourceReusable` from Postgres, including the article with a
  reference but no completed fetch receipt.
- tests/store-revision-columns.test.ts — the policy pin widened by presence only.

## Deferred

- The progress card's skipped first row reads "Fetching the page — already done" for an upload
  (`stepLabel` only knows an upload when the job carries one). Same as Reset today.
