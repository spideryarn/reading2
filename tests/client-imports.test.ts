/**
 * **Nothing under `src/web/` may reach a server module.**
 *
 * Not a style rule. Vite bundles whatever the client imports, transitively, so
 * a single `import { helper } from "../converse.js"` pulls that file's whole
 * module graph into the browser — pino, `node:fs`, the system prompts, the
 * request shapes. It compiles, it passes the type-check, and the app keeps
 * working; the only symptom is a bigger bundle containing things nobody meant
 * to ship.
 *
 * That is not hypothetical. On 2026-08-26 `ChatPanel.tsx` imported one
 * four-line URL check from `src/converse.ts`, and the client bundle grew 24KB
 * and gained the string `OPENROUTER_API_KEY`. The key's *value* was never in it
 * — it is read from `process.env`, which does not exist in a browser — but the
 * prompt and the OpenRouter request shape were, and the next edit in that
 * direction is a real leak rather than an embarrassing one.
 *
 * AGENTS.md already names the hazard: *"One `import type` away from a node
 * module is one careless edit away from a broken browser bundle."* This is that
 * sentence, enforced.
 *
 * The fix when this fails is never to add the file to the allowlist. It is to
 * move the shared thing into a module that imports nothing — src/types.ts,
 * src/ids.ts, src/urls.ts are the existing examples.
 */
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { refuseUntraceableImportsInSource } from "./helpers/ts-ast.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const WEB = path.join(ROOT, "src", "web");

/**
 * Modules at `src/` that the client is allowed to import.
 *
 * Every one of these is pure: no `node:` imports, no side effects, no
 * dependencies of its own beyond the others in this list. That is the whole
 * qualification, and it is checked below rather than trusted.
 */
const SHARED = new Set([
  "types.js", // the shapes both sides speak in
  "ids.js", // minting and validating block ids
  "urls.js", // the http(s) allowlist, used by the server and the panel
  "reading-time.js",
  /* The five questions the machinery may ask about a block, and the word count
     that states one of them as a number. On the list for the same reason
     `reading-time.js` is, and next to it on purpose: the masthead over the
     article you are reading and the card you decide from before you open it are
     on opposite sides of the wire, and nothing would ever have told us the two
     had drifted. It imports `types.js` and nothing else.
     See src/block-policy.ts and docs/plans/260828o-footnotes.md. */
  "block-policy.js",
  /* What a supplement node is, and which nodes sit under one. On the list for
     the same reason `block-policy.js` is, and it imports that file and types
     and nothing else: the tree is one structure and both sides read it, so the
     spine's dimmed band, the arc's step marker, the fisheye's "Notes" and the
     shelf card's part count are four answers that have to come from one
     definition. The alternative is the client re-deriving "is this the
     apparatus" from a missing gist, which is the inference this whole design
     refuses to make. See src/supplement.ts. */
  "supplement.js",
  "ingest.js", // slug derivation, so the client can show the same one the server will mint
  "term-match.js", // where a glossary term appears in a block
  /* What the glossary's *Look up a term* box will accept — the bound, the
     screen, and the three sentences a refused term gets. On the list for the
     reason the header gives rather than for convenience: it imports nothing at
     all, having been made a leaf when this test caught it reaching for one
     number in `vocabulary.ts`. The box refuses on `parseAskedTerm` and so does
     `POST /api/glossary/:slug/ask`, so a second copy would be a reader told two
     different things by one rule depending on which side caught it.
     See src/asked-term.ts and docs/project/glossary.md § Looking a term up. */
  "asked-term.js",
  "quote-match.js",
  /* The order the steps run in, and the two types read off it. On the list
     because it was made a leaf for this — `useStepJob` needs `StepBefore` to
     hold a caller's `precededBy` to steps that really do precede, and it read
     that type off `src/pipeline.ts`, a server module, until this test went red
     on it (2026-09-04). It imports `StepName` from `types.js` and nothing else,
     and `src/pipeline.ts` re-exports it, so the ordering still has one home.
     This is the outcome the long comment below argues for, reached one more
     time. See src/step-order.ts. */
  "step-order.js",
  /* Which nine steps the Metadata page offers a *Generate it again* button for.
     On the list for the reason the header of this file gives rather than for
     convenience: it imports `StepName` from `types.js` and nothing else, and it
     was written as a leaf **because of this rule** — the alternative was the
     browser importing `src/pipeline.ts` for `FORCE_ONLY_WHEN_NAMED`, which is
     the same edge `step-order.js` above was extracted to stop.
     Beside that file and not inside it: one answers what order the steps run
     in, the other which of them a reader may ask for again, and the second is a
     product judgement about cost and failure semantics.
     See src/rerun-steps.ts and
     docs/plans/260907d-re-run-any-generated-mode-from-the-metadata-page.md. */
  "rerun-steps.js",
  // Whether a saved search still describes the article. The panel puts a
  // warning on a row and the server answers the same question at the read seam;
  // src/source-hash.ts computes the fingerprints and needs `node:crypto`, so
  // only the *comparison* is shared. Three lines and no imports but types.
  "search-stale.js",
  "sanitize-policy.js", // the DOMPurify config, shared so both passes agree
  /* The address a reader writes to us at. On the list because it imports
     nothing at all, and here rather than typed into the page because it is the
     one place that address is spelled — Greg, 2026-09-02, and
     docs/project/website-text.md. The privacy page needs it in the browser;
     the first server-composed page or email that needs it will import the same
     constant rather than a second copy that survives a domain move.
     See src/site-text.ts. */
  "site-text.js",
  // Every sentence a reader is shown when a model call fails. On the list
  // because it qualifies rather than because it was convenient: everything it
  // imports is on this list too. The client needs it so /design can render the
  // real failure copy at the width it will actually wrap at — placeholder text
  // is exactly what stops anyone noticing a message reads badly.
  // ("it imports nothing at all" until 2026-09-08, which had stopped being
  // true — `types.js`, `uploads.js`, `billing-plan.js` and `modes.js` are all
  // allowlisted, which is why the guard below stayed green over it.)
  // See docs/project/copy.md.
  "messages.js",
  /* Two words — whether a document came off an address or off a reader's disk.
     A whole module for a union, and this list is half the reason: `messages.js`
     needs it to choose between two refusal sentences, and the module that owns
     the fact (`source.js`) reaches `fetch.js` and its untyped packages, so a
     type-only import from there fails the client project with TS7016. This is
     the leaf the header of that file, and the docstring below, both say to make.
     It imports nothing, and must go on importing nothing.
     See src/document-origin.ts. */
  "document-origin.js",
  /* The pure half of drawing TeX as maths: where a delimited formula is, the
     bounds temml is called with, and the text a drawn formula reads as. On the
     list because both sides must give one answer — the browser draws the
     formula (src/web/maths.ts) and the server checks a quote across it
     (src/quote-in-block.ts), and a second copy of the span rules would let a
     reader select symbols the server says are not there. Its only import is a
     type from `temml`, a package the client already bundles, which is the
     dompurify case below rather than a dependency on ours; temml itself is
     passed in, never imported. See docs/project/maths.md. */
  "maths-tex.js",
  /* How big a dictation may be, and what containers we can transcribe. On the
     list for the reason the header gives rather than for convenience: it
     imports nothing at all, and the alternative is two copies of one number.
     The recorder's cap, the request's cap and Vercel's 4.5 MB body limit are a
     single arithmetic problem with an end in the browser and an end on the
     server, and a client that records more than the server will take is a 413
     after somebody has talked for two minutes.
     See src/dictation-limits.ts. */
  "dictation-limits.js",
  // The server caps spoken passage/tool labels before saving them. Live's
  // lost-response repair compares those saved fields with the same cap, so it
  // must share the rule. Extracted from routes.ts into this import-free leaf;
  // the purity check below keeps server dependencies out of the client.
  "spoken-label.js",
  /* What a bug report may carry — the diagnostics blob's shape and the two
     image formats a pasted screenshot may be. On the list for the same reason
     `monitoring-scrub.js` is, and it is the same argument one seam over: the
     dialog builds the blob and `POST /api/feedback` validates it, and a browser
     copy and a server copy would be two allowlists with the looser one winning.
     It imports nothing at all. See src/feedback-payload.ts and
     docs/plans/260831aj-feedback-button-and-bug-reports-to-sentry.md. */
  "feedback-payload.js",
  /* What may be said about a failure when it leaves the machine. On the list
     for the same reason `messages.js` is: it imports nothing but that file and
     types, and both halves of monitoring have to agree on the rules exactly —
     a browser copy and a server copy would be two allowlists, and the looser
     one would be the one nobody read. See docs/plans/260827y-error-monitoring-sentry.md
     and src/monitoring-scrub.ts. */
  "monitoring-scrub.js",
  // Whether a failed ingest job is worth offering a Retry for. It imports
  // messages.js and nothing else, and the card is the only thing that asks —
  // so the rule lives in one place rather than being spelled out at the
  // button. See docs/postmortems/260826a-toc-max-tokens.md.
  "job-failure.js",
  /* What state an import is in, as the reader sees it, and the sentences that
     go with each. Beside `job-failure.js` because it is the same argument one
     question along — that file answers *may I press Retry*, this one answers
     *what is happening right now* — and it calls that one rather than
     absorbing it, since `retryJob` on the server needs the same answer. It
     imports `job-failure.js`, `messages.js` and types, all of which are on
     this list. Two surfaces read it and they disagreed before it existed: the
     add card and the run button in a band.
     See docs/plans/260831ao-a-stuck-ingest-job-the-reader-can-see-and-clear.md § Stage 4. */
  "job-state.js",
  // What counts as a PDF worth uploading, and how big is too big. The picker
  // asks (src/web/UploadPicker.tsx) and `POST /api/uploads` will ask when it
  // exists, which is the whole reason it is a module rather than a constant in
  // the component — the two disagreeing is invisible until a file is accepted
  // in one place and refused in the other. Imports nothing.
  // See docs/plans/260826u-pdf-upload-and-storage.md.
  "uploads.js",
  // Who the administrator is. On the list because it qualifies rather than
  // because it was convenient: one exported constant, one three-line function,
  // no imports at all. The client needs it so the shelf can decide whether to
  // draw an Admin link — a decision that is cosmetic, while the refusal that
  // matters is the server's on `/api/admin/`. Both sides asking one function is
  // the point: two spellings of "is this Greg" is one place for them to
  // disagree. See docs/project/admin.md.
  "admin.js",
  /* What plan a reader is on, and the sentences `/profile` says about it. On the
     list for the same reason `admin.js` is, and it is the same argument one
     question along: `GET /api/billing/usage` builds a `ReaderPlan` and
     BillingSection.tsx draws it, so the shape is a wire contract with an end on
     each side. It imports nothing at all.

     **It is a flat module rather than `src/billing/plan.ts` because of this
     rule**, and that is worth saying rather than looking like a naming whim: the
     rest of `src/billing/` constructs Stripe clients and opens database
     transactions, and the one file the browser may have had to leave the
     directory to prove it. See src/billing-plan.ts and docs/project/billing.md
     § What a reader sees. */
  "billing-plan.js",
  /* The Sketch diagram's schema, its validator and its painter — the two files
     that turn a model's scene into geometry. On the list for the reason the
     header states rather than for convenience: `sketch-scene.js` imports
     `types.js` and `ids.js`, `sketch-paint.js` imports `sketch-scene.js`, and
     neither reaches a `node:` module or has a side effect.
     The client needs them because **the browser is where the scene is checked**,
     and that is the design rather than an implementation detail: what arrives
     from `/api/sketch/:slug` is a stored artefact that may have been written by
     an older schema or against an article whose block ids have since moved, and
     the panel must drop what it cannot draw before drawing anything. Putting
     `readSketch` on the server only would make the client trust a validation it
     could not see, which is the arrangement docs/reusable/silent-success.md is
     about. `sketch-paint.js` is on the same list for the sibling reason: it is
     the ONE painter, and the offline harness in evals/sketch/ renders the same
     primitives — a second painter in the panel is two answers to one question.
     See docs/project/diagram.md § Sketch. */
  "sketch-scene.js",
  "sketch-paint.js",
  /* The illustration brief's schema and its two readers. On the list for
     `sketch-scene.js`'s reason and one that is sharper: it imports only
     `quote-match.js` (already here) and type-only `types.js` / `sketch-scene.js`,
     reaches no `node:` module and has no side effect — and **the browser is
     where the rows under the picture are checked**. Each row shows a passage
     and jumps the article to the block it came from, and a stored artefact may
     have been written against block ids an article has since moved, so
     `readStoredIllustrated` runs at ingress in src/web/useIllustrated.ts and
     drops what it cannot vouch for. The `readModelBrief` half of the file is
     the server's and is never called here; the split is the trust boundary, and
     the header of src/illustrated-plate.ts says why there are two.
     See docs/project/diagram.md § Illustrated. */
  "illustrated-plate.js",
  /* What a stranger is served — the wire shapes of `/api/public/…`. On the list
     for the reason the header of the file gives rather than for convenience: it
     imports `types.js` and nothing else, and it is a `.ts` of nothing but
     `interface` declarations, so it erases entirely at compile time.
     The client needs it because the public reader and the public metadata page
     are typed against exactly the shapes the server projects — the whole point
     of an allowlist projection is lost if the browser re-declares its own idea
     of what came back. See docs/plans/260827ai-public-read-only-access.md § The payload. */
  "public-types.js",
  /* The wire shapes of `GET /api/public/library` — the shelf of public
     articles. On the list for exactly `public-types.js`'s reason and beside it:
     it imports **nothing at all** and is nothing but `interface` declarations,
     so it erases entirely at compile time. Separate from that file because it
     is the contract for the *list* rather than for one article, and the two
     projections must not be tempted into being one — the header of
     src/public-library-types.ts has the argument.
     See docs/plans/260904b-pricing-page-and-public-showcase.md § Stage 3a. */
  "public-library-types.js",
  /* What we know about the article's own images: which URLs a block would have
     the browser fetch, what a downloaded file turns out to be, and the map a URL
     is looked up in. On the list because it qualifies — it imports **nothing at
     all** — and because being on it is the point rather than a convenience.

     The manifest is built in the pipeline by parsing block HTML with jsdom, and
     read in the browser by parsing the same HTML with Chrome. Those two have to
     agree about which elements count and about the exact string
     `getAttribute("src")` returns, and they cannot agree by care: `blocks.json`
     stores `…&amp;s=…` while the DOM hands back `…&s=…`, so a second copy of the
     selection would miss every entry with a query string — five of the corpus's
     thirteen images — with no error and no broken picture, just the publisher's
     URL left in place. One module, both callers.
     See src/assets.ts and docs/plans/260829b-hosting-the-articles-images.md. */
  "assets.js",
  /* **Which stored object an asset URL names, and how that URL is spelled.**
     The delivery half of the file above, and on the list for the same reason:
     it imports `assets.js` for its types and nothing else.

     Being on it is again the point rather than a convenience. `sendArticleAsset`
     (src/routes.ts) and `pgPublicReader.loadAsset` both look a hash up with
     `storedAssetFor`, and `rehost.ts` builds the `src` the browser asks with —
     so the route's idea of which entry a URL names and the client's idea of
     which URL an entry has are two halves of one fact. A second copy would not
     404; it would serve nothing at a URL nobody complains about.

     **This rule cost it one import**, which is worth knowing before somebody
     adds it back: `publicAssetPath` spells a URL `src/public/route-names.ts`
     also spells, and delegating to that file is refused here — the allowlist
     holds flat module names, so a nested one cannot be shared. The two are tied
     by an assertion in tests/rehost.test.ts instead.
     See src/asset-delivery.ts. */
  "asset-delivery.js",
  /* Escaping text into markup, and composing an article's page title. On the
     list because they qualify — `html.js` imports nothing at all, and
     `title-text.js` imports only the other leaves below it — and because being
     on it is the whole point rather than a convenience. (This comment said
     "only `html.js`" until `modes.js` and `read-address.js` arrived; the test
     underneath checks purity, so the drift was in the prose alone.)

     From 2026-08-29 a serverless function composes the `<title>` for a shared
     `/read/<slug>` before the bundle loads (src/public/page-head.ts), and React
     then assigns `document.title` over the top of it. Anything the two disagree
     about is a tab that visibly changes in front of the reader, and they did
     disagree: the server normalised whitespace, control characters and bidi
     overrides and the client did not. A second copy of a title rule is one
     place for it to drift, and this is the drift.
     See src/title-text.ts and docs/project/page-titles.md. */
  "html.js",
  "title-text.js",
  /* The nine middle-band modes. It lived in `src/web/params.ts` until
     2026-08-30 and moved for the reason the two above are on this list: the
     serverless function that composes a shared article's `<title>` has to know
     which mode the address asked for, or the tab says one thing and React says
     another a second later. It imports nothing at all, and `params.ts`
     re-exports every name so no component knows it moved. See src/modes.ts. */
  "modes.js",
  /* What each of those modes *is*: the sentence a reader is shown about it, the
     words they might type meaning it, and whether it is still behind the
     experimental switch. On the list because it qualifies — it imports
     `modes.js` and nothing else — and because being on it is the point rather
     than a convenience.

     The two older fields were `blurb` and `experimental` on a `MODES_UI` row in
     src/web/Dock.tsx, which is a 2,300-line React component, and they moved on
     2026-09-07 because a second reader was arriving that cannot import it (the
     command bar, docs/plans/260906h-mode-catalog-and-a-command-bar.md). The
     alternative was a fifth field on a Dock layout row, which is how `MODES_UI`
     became the place everything about a mode ended up. Nothing under
     src/public/ reads it yet; it is written to this rule anyway, so that the
     day a server-composed page wants to say what a mode is, the answer is one
     import rather than a second copy. See src/mode-catalog.ts. */
  "mode-catalog.js",
  /* What a `/read/…` address asks for — the view, and whether the client is
     about to rewrite a legacy spelling into the metadata page. On the list
     because it imports nothing at all, and because being on it is the point:
     `main.tsx` does the rewrite and the serverless head composer has to predict
     it, since `/read/x?about=1` is one path segment and so reaches the composer
     while `/read/x/metadata` is two and never does. Two copies of that
     predicate is a tab that changes at mount. See src/read-address.ts. */
  "read-address.js",
  /* What a referee's criterion is, and what a result of one may say. On the
     list because both modules qualify — `referee-criteria.js` imports
     `quote-match.js`, `types.js` and `urls.js`, every one of them already here,
     and `saved-criteria.js` imports only `referee-criteria.js` — and because
     being on it is the point rather than a convenience.

     The client needs them for the reason `sketch-scene.js` is here: **the
     browser draws what the server validated, and it has to be the same
     validation.** The panel prints a signed valence and a direction in words
     off `DivergingResult`, and the marks in the prose are resolved from the
     same `RefereeResult` the server checked with `findQuote` — a second
     declaration of that shape in `src/web/` is how the panel and the paragraph
     come to disagree about what a criterion found. The two clamps especially:
     `clampConfidence` sends a negative to 0 and `clampValence` keeps it, and a
     browser copy of that pair is the exact silent failure the whole module
     exists to prevent.
     See src/referee-criteria.ts and
     docs/plans/260831an-referee-mode-for-peer-reviewers.md. */
  "referee-criteria.js",
  "saved-criteria.js",
  /* What a claim is, where the paper takes it up, and the three sentences a row
     may print when it has no passages under it. On the list because it qualifies
     rather than because it was convenient: it imports `quote-match.js` and
     `types.js`, both already here, and nothing else.

     The client needs it for the same reason it needs `referee-criteria.js`, and
     one reason of its own. The shared reason: the marks in the prose are
     resolved from the same `Claim` the server checked with `findQuote`, so a
     second declaration in `src/web/` is how the panel and the paragraph come to
     disagree about what a claim found. The reason of its own is the **copy** —
     `NO_PASSAGE_FOUND`, `PASSAGES_UNUSABLE`, `LINKAGE_NOT_ADEQUACY` and
     `DOCUMENT_ORDER_NOTE` are values here rather than strings inside the panel
     precisely so that tests/referee-copy-is-about-the-model.test.ts can check
     the sentences themselves; a browser copy would be a second set of words for
     that test to be right about and wrong in front of.
     See src/referee-claims.ts and
     docs/plans/260831an-referee-mode-for-peer-reviewers.md § 2. */
  "referee-claims.js",
  /* What a Mirror run is made of — the five remark kinds, the input counts and
     the coverage status. On the list because it imports **nothing at all**: it
     is a `.ts` of type declarations only, on the model of `public-types.js`
     above, and it exists because of this test rather than in spite of it.

     Mirror's shapes were declared inside `src/referee-mirror.ts` until stage 5b
     put a panel on them, and that module reaches `node:crypto`, the log, the
     gateway and the model table. The fix this file's own header names — *move
     the shared thing into a module that imports nothing* — is what was done,
     and `referee-mirror.ts` re-exports every name so nothing else had to
     change. The browser needs them for the reason `sketch-scene.js` is here:
     the panel draws exactly what the validator stamped, and the field that
     matters most is `RemarkCommon.trialTested` — a literal `true` or `false`
     per member, so a second declaration in `src/web/` is how a panel comes to
     print an untested remark as though a randomised trial were behind it.
     See src/referee-mirror-types.ts and docs/project/referee-mode.md § Mirror. */
  "referee-mirror-types.js",
  /* What a candidate reviewer is, and the four rules a name has to survive
     before an editor sees it. On the list because it qualifies — it imports
     `types.js` and `urls.js`, both already here — and because being on it is the
     whole point rather than a convenience.

     Candidates is Chat with a third `ThreadKind`, so its shortlist is **parsed
     out of the transcript in the browser** (src/web/CandidatesPanel.tsx). There
     is no server-side validation of it to be the second copy of: this module IS
     the enforcement, and a second declaration under `src/web/` would be a second
     answer to "may this name be shown", with the looser one on screen. The rules
     it holds — a source link the web search actually returned, the paper's own
     authors excluded, a fit-requirement and a real block id on every row — are
     the ones nothing in the article can check.
     See src/referee-candidates.ts and
     docs/plans/260831an-referee-mode-for-peer-reviewers.md § 4. */
  "referee-candidates.js",
  /* What the deterministic injection scan answers with — the finding kinds, the
     `ordinary` labels, the blind spots, and the union that says whether anything
     was examined at all. On the list because it imports **nothing at all**: it
     is a `.ts` of type declarations only, on the model of `public-types.js` and
     `referee-mirror-types.js` above, and it exists because of this test rather
     than in spite of it — the scanner itself parses documents with jsdom.

     The browser needs it for the reason `sketch-scene.js` is here, and with more
     riding on it than any of them: `SourceScan.findings` exists **only** on the
     examined arm, so a PDF — which is not scanned at all — cannot be rendered
     from `findings.length` as a clean bill of health. A second declaration under
     `src/web/` would be a second answer to *did we look*, and the looser one
     would be the one a referee reads.
     See src/injection-scan-types.ts and docs/project/referee-mode.md § rule 5. */
  "injection-scan-types.js",
  /* Where in a model's answer a block id counts as a citation. On the list
     because it qualifies: it imports `urls.js`, already here, plus
     `mdast-util-from-markdown` — which is the dompurify case exactly, a package
     the client already bundles directly (src/web/Cited.tsx § fromMarkdown), so
     there is no leaf to move a copy into and the only alternative is a second
     parser.

     Being on it is the point rather than a convenience, and this module was
     written for it. The chip on the reader's screen and `citedBlockIds` in the
     log are one question asked on two sides of the wire — how many ids did this
     answer cite — and they drifted for as long as the client parsed Markdown
     while the server matched a regex: on four inputs GPT Sol found, a citation
     the reader never saw or a hallucination that never happened. `citations.ts`
     calling this is what makes the counter true.
     See src/citable.ts and docs/plans/chat-markdown.md. */
  "citable.js",
  /* The `data-spya-*` namespace — the attributes stage 2 leaves on the article
     so stage 3 can read them back. On the list because it imports **nothing at
     all**, deliberately and for this reason: its own header says so, since a
     module that decides what is trusted should not be able to pull anything in
     behind it.

     The browser needs it because the stamps outlive everything else. Stage 2
     mints an attribute, the stored html carries it through a database, and
     `src/web/notes-view.ts` reads it back months later to find a footnote's
     marker and its back-link — so a spelling written twice is a spelling that
     can drift with nothing going red on either side. One namespace, one file.
     See src/reserved.ts, tests/reserved.test.ts (which enforces that only this
     file names the prefix) and
     docs/plans/260831af-carrying-markup-facts-past-readability.md. */
  "reserved.js",
  /* The changelog file's schema and its parser. The writer
     (`scripts/changelog/changelog.ts`) and the reader
     (`src/web/ChangelogPage.tsx`) are the two callers, and a format defined
     twice drifts — here it would drift into a blank page rather than an error,
     since the page is deliberately tolerant of a line it cannot read.

     **One flat file rather than a `src/changelog/` pair**, which is what it was
     for an hour on 2026-09-06. This list holds names resolved directly under
     `src/`, so a nested module cannot be shared through it and would need a
     second mechanism beside this one — `asset-delivery.ts` made the same call
     for the same reason. It imports nothing, so the purity check below has
     nothing to find.
     See src/changelog.ts and docs/project/changelog.md. */
  "changelog.js",
]);

/**
 * **There is no allowlist for reaching outside `src/`, and there was one until
 * 2026-09-07.**
 *
 * `OUTSIDE_SRC_ALLOWED` held exactly one specifier —
 * `../../docs/changelog/versions.ndjson?raw`, the changelog page's 210 KB of
 * committed data — on the reasoning that data is not code and there was no
 * `src/` leaf to move it into. Both halves were true and the conclusion still
 * cost a production deploy, because the rule it was reasoning about is not the
 * rule that mattered:
 * docs/postmortems/260907a-an-import-into-a-vercelignored-directory-built-everywhere-except-vercel.md.
 *
 * The file now sits beside its one reader as `src/web/changelog-versions.ndjson`,
 * so its specifier never leaves `src/web` and the sweep below never looks at
 * it. **That is the point.** The set was also an unchecked hatch on its own
 * terms — it matched the raw specifier and returned *before* the resolve below,
 * so a later entry could have walked straight back out of `src/` with this test
 * still green. Move the file; do not reintroduce the set. The guard for the
 * wider class is `maskPrunedRoots` in scripts/deploy.ts.
 */

/** Every `.ts`/`.tsx` file under a directory, recursively. */
function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourcesUnder(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** One import, and whether it survives compilation. */
interface Imported {
  spec: string;
  /**
   * A **whole-statement** type import — `import type { X } from "…"`, or
   * `export type { X } from "…"`.
   *
   * The distinction is exact and it has to be: only this form erases. TypeScript
   * deletes the entire statement, so no edge reaches the bundler and nothing can
   * be dragged along. `import { type A, b } from "…"` is a *different thing*
   * wearing similar clothes — `b` is a value, the module is emitted, and it
   * drags whatever it drags. A scanner that waved that one through would be
   * worse than no scanner, because it would read as a check while permitting
   * the exact import it exists to stop.
   */
  typeOnly: boolean;
}

/** Every import one file makes — `import` and `export … from` alike. */
function scan(file: string): Imported[] {
  const text = readFileSync(file, "utf8");
  /* **A dynamic `import()` with a computed specifier is refused**, not skipped.
     Every rule below reads a list of specifiers, so an edge with no name is an
     edge that passes every one of them — GPT Sol, 2026-09-06, F21, which showed
     the same hole in three graph guards at once. The refusal, and the repo-wide
     scan behind it, are in tests/helpers/ts-ast.ts; it parses only when the
     text could contain one. */
  refuseUntraceableImportsInSource(text, path.relative(ROOT, file), "tests/client-imports.test.ts");
  const found: Imported[] = [];
  /* The middle capture is everything between the keyword and `from`, which is
     what decides `typeOnly`: ` type { X } ` says yes, ` { type A, b } ` says
     no. `\s` after `type` and not `\b`, so a default import named `types`
     stays a value import. */
  for (const m of text.matchAll(
    /(?:^|\n)\s*(?:import|export)([^;'"]*)from\s*["']([^"']+)["']/g,
  )) {
    if (m[2]) found.push({ spec: m[2], typeOnly: /^\s*type\s/.test(m[1] ?? "") });
  }
  /**
   * **`import.meta.glob("…")`, which is Vite's and which the rules above cannot
   * see at all.**
   *
   * It takes a pattern rather than a path, and Vite expands it at build time
   * into a real import of every file that matches — so
   * `import.meta.glob("../*.ts")` in a shared module pulls the whole of `src/`
   * into the browser, and every check in this file passes, because there is no
   * `from` clause anywhere in it. GPT Sol named it as the mutation
   * `client-imports` would miss, 2026-08-28.
   *
   * The pattern is recorded verbatim rather than resolved: a glob names a *set*
   * of files, and the honest answer to "what does this drag in" is that we
   * cannot say from a regex. So the rule below refuses any glob that reaches
   * out of the module's own directory, which is the fail-closed reading — and
   * an unhelpful error on a legitimate glob is a conversation, where the
   * alternative is `node:fs` in the bundle and nothing saying so.
   *
   * Not marked `typeOnly`: there is no such spelling, and the expansion is
   * value imports by construction.
   */
  for (const m of text.matchAll(/\bimport\.meta\.glob\w*\(\s*\[?\s*["']([^"']+)["']/g)) {
    if (m[1]) found.push({ spec: m[1], typeOnly: false });
  }
  /* `import "./side-effect.css"` and dynamic `import("…")` too. Neither form has
     a type-only spelling: a side-effect import exists *for* the side effect,
     and a dynamic import is a runtime call. */
  for (const m of text.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) {
    if (m[1]) found.push({ spec: m[1], typeOnly: false });
  }
  for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    if (m[1]) found.push({ spec: m[1], typeOnly: false });
  }
  return found;
}

/** Just the specifiers, for the rule that does not care how they were written. */
function importsOf(file: string): string[] {
  return scan(file).map((i) => i.spec);
}

/**
 * **The rule, as a function**, so the sweep and the table below ask the same
 * question of the same code.
 *
 * Split out on 2026-08-28: the sweep reads real files and today every shared
 * module is a leaf, so it passes without exercising one interesting case. A
 * rule inlined in the loop could only be tested by editing a real module, and
 * an edit-based check is one whose target can move underneath it.
 *
 * `typeOnly` is in the parameter and not in the body, deliberately — see the
 * long comment on the sweep for why the erased form is flagged anyway.
 */
function disqualifying(name: string, imports: Imported[]): string[] {
  const out: string[] = [];
  for (const { spec } of imports) {
    if (spec.startsWith("node:")) out.push(`src/${name} → ${spec}`);
    /* **Any relative specifier, not just `./`.** A shared module reaching
       further into `src/` can drag anything with it — and `../` reaches out of
       `src/` altogether, which is worse rather than exempt. The check was
       `startsWith("./")` until 2026-08-28, so `import.meta.glob("../*.ts")`
       passed it on a technicality after the scanner had been taught to see the
       glob at all. */
    if (spec.startsWith(".") && !SHARED.has(spec.replace(/^\.\//, ""))) {
      out.push(`src/${name} → ${spec}`);
    }
  }
  return out;
}

describe("the client's imports", () => {
  it("never reaches out of src/web except to a shared pure module", () => {
    const offenders: string[] = [];
    for (const file of sourcesUnder(WEB)) {
      for (const spec of importsOf(file)) {
        // Only relative imports can escape; a bare specifier is a package.
        if (!spec.startsWith("../")) continue;

        /* **Resolved against the importing file, not counted as `../`s.** The
           check used to read one leading `../` as "this leaves src/web", which
           is only true for a file sitting directly in src/web. `src/web/lib/`
           is two deep, so its own `../offline.js` is a sibling of its parent —
           inside the client, and perfectly legal — and the old rule called it
           an escape. It never came up because everything under lib/ had until
           now imported only its own directory. 2026-08-27. */
        const resolved = path.resolve(path.dirname(file), spec);
        if (resolved === WEB || resolved.startsWith(`${WEB}${path.sep}`)) continue;

        const fromSrc = path.relative(path.join(ROOT, "src"), resolved);
        if (fromSrc.startsWith("..") || fromSrc.includes(path.sep)) {
          offenders.push(`${path.relative(ROOT, file)} → ${spec} (outside src/)`);
          continue;
        }
        if (!SHARED.has(fromSrc)) {
          offenders.push(`${path.relative(ROOT, file)} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * And the allowlist has to keep earning its place.
   *
   * A module on it that grows a `node:` import takes the whole client with it,
   * and the test above would not notice: the import in `src/web` still points
   * at an allowed name. So the allowlist is checked too, and it is checked for
   * the thing that actually breaks a browser bundle — `node:` built-ins.
   *
   * Deliberately NOT a ban on package imports. `sanitize-policy.ts` takes a
   * `import type` from dompurify, which erases at compile time and is a package
   * the client bundles anyway. Flagging that would push somebody to duplicate a
   * type rather than share it, which is worse than the thing being prevented.
   *
   * ## A local `import type` is NOT the same case, and that was decided the hard way
   *
   * The tempting move is to read the paragraph above as a general rule about
   * erasure — a whole-statement `import type` is deleted before a bundler sees
   * it, so it cannot drag anything, so flagging it is a false positive. That
   * relaxation was written on 2026-08-28 and **reverted the same afternoon**,
   * and the reason is worth the paragraph because the argument for it is
   * genuinely persuasive and will be made again.
   *
   * It is true about the *bundle* and beside the point about the *design*. The
   * rule this file enforces is not only "do not break the browser build" — it
   * is **shared modules stay leaves**. A type-only import is a real dependency
   * in the source, and the fix is cheap and better every single time.
   *
   * The evidence is from the same afternoon. `src/messages.ts` grew
   * `import type { EmbeddingReason } from "./embeddings.js"`; this guard fired;
   * and whoever owned that work moved `EmbeddingReason` into
   * [`src/types.ts`](../src/types.ts) instead — unprompted, and the better
   * outcome, because the shape both halves speak now lives in a module that
   * imports nothing. The relaxation would have removed exactly that pressure and
   * left the type where it was. Greg's team lead weighed both and reverted it.
   *
   * **Why dompurify above really is different**, since that is where the
   * reasoning goes wrong: dompurify is a *package the client already bundles*,
   * so there is no leaf to move the type into and the only alternative is
   * duplicating it. `embeddings.ts` is ours, and there was a leaf.
   *
   * `node:` stays absolute for its own reason, unchanged by any of this: a node
   * built-in named in a module the browser loads erases just as cleanly, but it
   * is a sentence about the shape of this code worth somebody stopping over.
   *
   * So `Imported.typeOnly` is computed and **deliberately not consulted here**.
   * It is kept because the test below rests on it: if this rule is ever revisited
   * the distinction has to be trustworthy, and `import { type A, b }` — which
   * still emits the module — must never be mistaken for the erased form.
   */
  it("keeps the shared modules free of node built-ins", () => {
    const impure: string[] = [];
    for (const name of SHARED) {
      const file = path.join(ROOT, "src", name.replace(/\.js$/, ".ts"));
      impure.push(...disqualifying(name, scan(file)));
    }
    expect(impure).toEqual([]);
  });

  /**
   * **The one module that has to import *nothing*, not merely nothing
   * disqualifying.**
   *
   * The rule above lets an allowlisted module import another allowlisted
   * module, which is right for almost all of them and not enough for this one:
   * `document-origin.ts` exists **because** `src/messages.ts` cannot reach
   * `src/source.ts` without dragging `src/fetch.ts`'s untyped packages into the
   * browser client's project and failing it with TS7016. A leaf that grows any
   * dependency is a leaf that can grow that one back, by a route the guard
   * above would pass because the intermediate name is allowlisted too.
   *
   * That file's header promises this in prose. ⟨GPT Sol, F28: *"an exact
   * zero-import assertion would make the prose promise executable"*⟩ — which is
   * this repo's own standard, since a promise in a comment is a promise nothing
   * checks.
   *
   * **A list of one, and it should stay short.** If a second module ever needs
   * this, it needs it for a reason worth writing next to its name here.
   */
  it("keeps the leaf modules importing nothing at all", () => {
    const LEAVES = ["document-origin.js"];
    for (const name of LEAVES) {
      expect(SHARED.has(name), `${name} is not on the shared list`).toBe(true);
      const file = path.join(ROOT, "src", name.replace(/\.js$/, ".ts"));
      const specs = scan(file).map((i) => i.spec);
      expect(specs, `src/${name} must import nothing`).toEqual([]);
    }
  });

  /**
   * **What the rule flags, stated as data.**
   *
   * The sweep above reads real files, so it can only ever exercise the imports
   * somebody happens to have written — and today every shared module is a leaf,
   * so it passes without touching a single interesting case. This is the same
   * rule asked about each spelling directly.
   *
   * The type-only row is here **as an expected flag rather than as a deleted
   * case**, so that the decision in the comment above is executable rather than
   * only asserted in prose. If somebody relaxes the rule again, this goes red
   * and points them at the paragraph explaining why it was already tried.
   */
  it("flags a local import however it is spelled, and a node: built-in", () => {
    const local = (spec: string, typeOnly: boolean) => disqualifying("messages.js", [
      { spec, typeOnly },
    ]);

    // A value import of a module that is not on the list: the original rule.
    expect(local("./embeddings.js", false)).toHaveLength(1);
    /* And the erased form too — this is the reverted relaxation, pinned. The
       bundle does not care; "shared modules stay leaves" does. */
    expect(local("./embeddings.js", true)).toHaveLength(1);
    // A module that IS on the list is fine either way.
    expect(local("./types.js", false)).toHaveLength(0);
    expect(local("./types.js", true)).toHaveLength(0);
    // `node:` is absolute, type import or not.
    expect(local("node:fs", false)).toHaveLength(1);
    expect(local("node:fs", true)).toHaveLength(1);
    // A package is deliberately not flagged — the dompurify case.
    expect(local("dompurify", false)).toHaveLength(0);
    /* A Vite glob reaching out of the directory, which `scan` records by its
       pattern. `../*.ts` is not on the allowlist and cannot be, so it is
       flagged like any other local reach — which is the fail-closed answer to
       a form whose expansion a regex cannot know. */
    expect(local("../*.ts", false)).toHaveLength(1);
  });

  /**
   * **The scanner can tell the two spellings apart.**
   *
   * The rule above no longer consults `typeOnly`, so this is not load-bearing
   * today — it is kept because the distinction is what any future revisit would
   * rest on, and because `import { type A, b }` still emits the module and must
   * never be mistaken for the erased form.
   *
   * Asserted against fixture text rather than against a real file, because the
   * property is about the parse and not about any module's current contents —
   * and because the dangerous form is one nobody happens to have written in a
   * shared module today, so a check that only read the repo would pass without
   * ever exercising it.
   */
  it("counts only a whole-statement type import as erased", () => {
    const fixture = path.join(ROOT, "node_modules", ".import-scan-fixture.ts");
    writeFileSync(
      fixture,
      [
        'import type { A } from "./a.js";',
        'export type { B } from "./b.js";',
        'import type C from "./c.js";',
        // Mixed: `d` is a value, so the module is emitted and this must be flagged.
        'import { type D, d } from "./d.js";',
        'import { e } from "./e.js";',
        // A default import that merely starts with the letters "type".
        'import types from "./f.js";',
        'import "./g.js";',
        // Vite's glob, which has no `from` clause for the other rules to see.
        'const mods = import.meta.glob("./h/*.ts");',
        'const eager = import.meta.glob("./i/*.ts", { eager: true });',
      ].join("\n"),
    );
    try {
      const byName = new Map(scan(fixture).map((i) => [i.spec, i.typeOnly]));
      expect(byName.get("./a.js")).toBe(true);
      expect(byName.get("./b.js")).toBe(true);
      expect(byName.get("./c.js")).toBe(true);
      expect(byName.get("./d.js")).toBe(false);
      expect(byName.get("./e.js")).toBe(false);
      expect(byName.get("./f.js")).toBe(false);
      expect(byName.get("./g.js")).toBe(false);
      /* Recorded at all, which is the point — the scanner was blind to this
         form entirely. Never type-only: there is no such spelling, and the
         expansion is value imports by construction. */
      expect(byName.get("./h/*.ts")).toBe(false);
      expect(byName.get("./i/*.ts")).toBe(false);
    } finally {
      rmSync(fixture, { force: true });
    }
  });
});
