# A site that refuses the app: a better way round now, and the bigger options for Greg

Reports `spya-x5e966` (#580, Sentry `SPIDERYARN-READING2-J0`) and `spya-tqsw3u` (#581, `-J2`, a
shorter repeat), both Greg's, 2026-10-15, from `/add/https://www.cell.com/fulltext/S1364-6613(15)00180-1`:

> I can see it in my browser (though there was a check of some kind to verify that I'm human, so I
> had a suspicion this might happen). What can we do to solve this for users going forwards? A
> browser extension? Something else?

The research behind this plan is
[261015a](../research/261015a-getting-a-page-behind-a-bot-check-extensions-bookmarklets-open-access-copies.md).
Prior work it builds on: [261006c](261006c-a-bot-check-page-is-refused-by-its-own-markup.md) and
[261006f](261006f-other-bot-check-walls-that-clear-the-floor.md) (a bot-check page is recognised and
refused by name), [261005l](261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md)
and [261005m](261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md) (paper
sources: a link that leads to a paper fetches the paper from fixed addresses).

## What happened

cell.com answers our server with **403** (a reCAPTCHA/Cloudflare-style wall), so the fetch step
fails with `forbidden` → `[fetch-refused]`, `blocked`. Measured from the box today: the article
page, its PDF address, Europe PMC's article page and its PDF renderer all answer 403, and PubMed
Central's page answers 200 with a reCAPTCHA challenge in it. **The article itself is open access
(CC BY)**: Crossref gives its DOI as `10.1016/j.tics.2015.08.003`, OpenAlex and Unpaywall mark it
`hybrid` OA, and it is PMC4595480. The only copy the box can actually read is Europe PMC's REST
`fullTextXML`, which is JATS XML, a format the pipeline cannot read today.

## Two parts

### Part 1, built now: the refusal points at the way round, and the add page holds the door

Inside our current services and defences. Nothing new is fetched or trusted.

1. **The sentences.** `forbidden` (`[fetch-refused]`) and the stage-2 bot-check sentence
   (`[jb-bot-check]`) both describe a site that turns away automated readers, which the reader's
   browser can usually get past. Both now say: *use its Download PDF button if it has one.
   Otherwise, save the page as a PDF. Then upload that file.* A journal's Download PDF is the
   publisher's typeset file, better than a printed page. Kind unchanged (`blocked`); code
   unchanged. **Not "an HTML file"**, which `[jb-bot-check]` used to offer: no browser offers a
   plain HTML file by that name (Safari saves a Web Archive, Chrome's single file is MHTML, and
   neither is taken), so the advice would send a reader into a second refusal (Sol's plan
   review, finding 3).
2. **An "Upload a file" control on the failed add page.** The sentence tells the reader to upload
   a file, and the add page they are standing on had no way to do it: they had to go back to the
   shelf and find the File button. So under a failed import whose failure suggests an upload, the
   add page draws the shelf's own `UploadPicker` pieces (its File button, its status row, and an
   **Add** button that commits the chosen file), which hands the file to `uploadEngine` and
   navigates to `/add/upload/<id>` exactly as the shelf does. No new upload path.
   - **One file.** `UploadPicker` gains `single`: no `multiple` on the input, and two or more
     files picked or dropped are refused with a sentence pointing at the shelf, rather than
     starting the shelf's minimal batch import, which reads only metadata and does not navigate
     (Sol, finding 2).
   - **Which failures.** An explicit set in `src/messages.ts`, `SUGGESTS_UPLOAD`: the codes whose
     sentence tells the reader to upload a file (`fetch-refused`, `fetch-login`, `fetch-declined`,
     `fetch-certificate`, `fetch-redirects`, `fetch-type`, `fetch-scheme`, `fetch-private`,
     `fetch-address`, `fetch-empty`, `fetch-incomplete`, `fetch-paper-missing`, `jb-bot-check`).
     A test holds both directions: every code in the set has a sentence that says upload, and
     every fetch-failure sentence that says upload has its code in the set. So a reworded sentence
     and the control cannot drift apart silently.
   - **Only on a failed import from an address**: `status === "error"`, `isImportJob(job)` (a
     mode job carries a `url` too) and `job.url`, with the code read off `job.error` by
     `codeOfMessage`, the one regex for bracketed codes (Sol, finding 6).
   - **What it makes is a separate article**, an upload with no source address. The failed job
     stays on the shelf until the reader forgets it. Acceptable for v1; linking the upload to the
     address it stands in for would be a new stored field.
   - **Accepted**: if this tab is already sending some other file, the picker's status row shows
     that transfer, as it does on the shelf. It is named by its filename and links to its own add
     page, and two uploads at once are refused anyway (`ONE_UPLOAD_AT_A_TIME`).

**The simpler option passed over: the sentence alone.** It is one edit, but it leaves the reader
on a page that tells them to upload and offers no way to. The control reuses the shelf's picker,
so the added surface is a predicate, a `single` flag and a dozen lines of layout.

### Part 2, Greg's call: getting the page without the reader saving anything

Each of these adds a new outside service, a new data flow, or a new way in, so none is built
here. The question file (`q-fp8tqr`) asks; the research doc has the evidence.

- **A. An open-access copy, found automatically.** On a refused fetch, find the DOI (Crossref,
  from the publisher's id in the address), ask OpenAlex whether a repository holds the paper, and
  import that copy. **The shape that keeps today's boundary** (Sol, finding 4): never fetch an
  address a registry hands back. Registry fetches today go only to fixed API hosts and paper-source
  candidates are addresses we build from validated ids
  ([security.md](../project/security.md), [fetching.md § A paper source](../project/fetching.md#a-paper-source-one-paper-several-addresses)).
  So: take only a validated PMC id from the registry, build Europe PMC's API address ourselves,
  fetch it through the whole guarded path, and convert its JATS XML to HTML with no external
  entities or resources resolved. Keep the address the reader pasted, record which copy was read,
  and say so when it is an accepted manuscript rather than the published version. New: Europe PMC
  as a service, a JATS converter, and the DOI of what a reader adds going to registries at add
  time. Coverage is unmeasured; sample twenty real refused links first.
- **B. A bookmarklet that sends the page from the reader's browser.** The Instapaper model.
  **It cannot simply POST to us** (Sol, finding 1): the API authenticates with an
  `Authorization: Bearer` header, not a cookie, precisely so that another site cannot make
  requests as the reader ([src/web/lib/api.ts](../../src/web/lib/api.ts)), and a script running in
  the publisher's page can neither read that token nor should it hold one. The workable design
  is a handoff: the bookmarklet opens a Spideryarn capture page in a new window, passes it the
  page's HTML with `postMessage`, and that page, signed in as usual, sends it through the existing
  upload path. Unverified: whether a publisher's Content-Security-Policy stops the bookmarklet
  running at all (Firefox has a long-open bug), and installing one on iOS is fiddly.
- **C. A browser extension.** What Readwise Reader and Zotero do, and the most robust. It need not
  ask for every site: an extension invoked by its button can use `activeTab`, which grants access
  only to the tab the reader clicked it on (Sol, finding 5). Still the largest: store review on
  three browsers, a second codebase, and the same authenticated handoff as B.
- **Not recommended: a challenge-solving service.** Ordinary headless rendering will not get past
  this wall; a service built to evade anti-automation checks would, sometimes. Against it:
  fragility as the walls change, a cost per request, publishers' terms, and the security burden
  if a reader's session ever entered the flow (Sol, finding 7).

## Stages

1. Part 1: the sentences, `SUGGESTS_UPLOAD` and its test, the add-page control and a component
   test. GPT Sol plan review ([261015a-plan-review-sol.md](261015a-plan-review-sol.md), verdict
   *rework*; all seven findings taken, as marked above). GPT Sol code review
   ([findings](261015a-code-review-findings-sol.md), [answer](261015a-code-review-sol.md),
   verdict *ship after fixes (made)*): one medium and three low, all fixed by the reviewer and
   checked here. A terminal transfer is now forgotten when a new file is chosen, so the row cannot
   name the new file under the old one's failure; an unrelated transfer in a `single` picker reads
   *Another upload:*; the control's line and Help's "Adding articles" page now say PDF too; and the
   tests gained a two-file drop and an import with no address. Browser check (Sonnet, Playwright,
   own dev server, 1440 and 390 wide): the sentence, no Retry, the control, a PDF chosen and added
   through to `/add/upload/<id>`, and two dropped files refused, all as intended; no layout
   problems. Full `npm test`: 1,982 files green; the one red file was this plan's own test, run
   while the review fixes were half-written. It is green on the committed code, with the 29 other
   files that touch the upload picker, the add page or the sentences (842 tests).
2. Bookkeeping: research doc, question file for Part 2, the user-feedback note, Sentry statuses.

## Not done here, and why

- **No change to the fetch step or any defence.** The SSRF guard, the user-agent and the paper
  source rules stay exactly as they are.
- **The shelf's job card** keeps showing the sentence only: the shelf already has its File button
  one row above the card.
