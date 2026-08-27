# Spideryarn

An experiment in AI-assisted reading that **augments** rather than replaces reading.

> it augments human cognition, but it doesn't replace it … instead of trying to make things too
> easy, trying to replace the words with quick and easy summaries so much, but rather we help the
> user get what they need from it, help them read efficiently, but deeply, help them internalize and
> interrogate.
>
> — Greg, 2026-08-24

The product is **Spideryarn**; `spideryarn2` is just this working directory, and the app it's an
offshoot of is [documented here](docs/project/original-version/overview.md). The first feature is
**granularity zoom** — the article at any of several levels of compression, vertical for position in
the piece, horizontal for how much detail.

**This file is a signpost, not a spec.** Everything real lives in `docs/project/`.
`CLAUDE.md` is a symlink to this file — there is only one of it, so edit either name freely.

## Docs

Start with [vision.md](docs/project/vision.md), then whichever of these you need:

| Doc | What's in it |
|---|---|
| [vision.md](docs/project/vision.md) | what we're trying to do, the principles, and what we're deliberately *not* doing |
| [granularity-zoom.md](docs/project/granularity-zoom.md) | the core feature: the tree, the node shape, generation, interaction, failure modes |
| [block-ids.md](docs/project/block-ids.md) | **the spine** — the id format, and why ids are random rather than sequential — and, since 2026-08-26, **what stage 3 overwriting the author’s id broke**: a published page links to its own sections, we renamed the headings those links point at, and the links then went nowhere while looking exactly like links. The rename is undone by renaming the references with it, at the one moment both names are known; why the click is then ours rather than the browser’s; and the one class of id DOMPurify deletes before we ever see it |
| [table-of-contents.md](docs/project/table-of-contents.md) | the deeply-nested ToC: schema, granularity, the generation prompt |
| [architecture.md](docs/project/architecture.md) | pipeline stages, what a block is, storage layout, server, stage ownership |
| [database.md](docs/project/database.md) | **where the data lives**: one directory per article today, one file per stage — and the *read* seam is `src/api.ts` while the write path is six stage modules, which is the mistake most estimates of this migration start from. Also **how to connect to the remote**: which of the three hosts to use and why the obvious one won't work from Vercel, the enforced SSL that `pg` doesn't do by default, and the three credentials none of which is the superuser |
| [supabase-local.md](docs/project/supabase-local.md) | **the whole Supabase stack in Docker on this laptop**: `npm run db:start`, the two settings that are not the default (a `5436x` port block so it can run beside the old app's, and a Postgres version that tracks the remote rather than the CLI), why the local keys are not secrets, and the five ways it goes wrong quietly — a stale socket that looks like a running daemon among them |
| [fetching.md](docs/project/fetching.md) | **stage 1**: the size cap that counts the right bytes, the charset sniff, why Node's own text decoder is wrong about curly quotes, and the certificate failure that works fine in your browser. Since 2026-08-27 `RawManifest` has an **origin**, because a document can also arrive from a reader's own disk — and its two URLs became optional rather than filled with a placeholder, since a `file://` would have read as an address to everything downstream and nothing would have complained |
| [content-extraction.md](docs/project/content-extraction.md) | **stage 2, and there are two of them**: Readability for a web page, and — since 2026-08-26 — a model reading the pages for a PDF, both producing the same `article.html` so that stage 3 onwards cannot tell which ran. The branch is on what stage 1 says it fetched, never on the URL. The PDF half in full, including the check that stops a lost paragraph reaching a reader, is in [pdf-ingestion.md](docs/plans/pdf-ingestion.md) |
| [web-client.md](docs/project/web-client.md) | the reading view (stage 6): where the client code is and the constraints it works under |
| [links.md](docs/project/links.md) | **hover the article's own hyperlinks**: what a card can say about a destination *without asking anybody* — where it goes, whether it leaves the publication, whether it is a file, and the catalogue key the path is carrying (`arXiv 2212.13345`, `DOI 10.1073/…`), which is the one piece of noise worth keeping because it is the thing you paste into a search box. Why an in-article `#fragment` is the one destination we can actually *show*, and why it is quoted rather than summarised — and, since 2026-08-27, **the two things somebody else can tell us**: an article already on your shelf (its title, its gist and its length, which is Readability's output from ingest rather than a fetch) and Wikipedia's CORS-open summary API, with the four rules governing the one third-party call a reader's hover now makes. Also **the measurement that says why Readability-in-the-browser is not a decision but a wall** — philpapers 403s and sends no `access-control-allow-origin` at all, so the general case needs our own server and there is no flag that changes that — why a real title deletes the path trail rather than joining it, why the library's one match in this corpus is an article linking to itself, and **13% of the links here have a glossary term as their link text**, which is why there is one card with two sections rather than two cards racing for the same three words |
| [tooltips.md](docs/project/tooltips.md) | the spine's hover tooltips: which library, why Floating UI over Radix and Tippy, and the four things that fail silently — and, since 2026-08-26, **why there are two implementations**: the glossary term's card cannot use the wrapper, because its triggers are injected HTML with no React element to wrap and there are hundreds of them per article, so it is one panel for the page with the hover intent hand-rolled |
| [keyboard.md](docs/project/keyboard.md) | ↑ / ↓ step through the article, and the level they step by is whichever column the pointer is in |
| [touch.md](docs/project/touch.md) | **reading on an iPad**: a swipe over a gist column steps one item, the prose column keeps ordinary momentum scrolling — and why that split is the design rather than a caveat; why we did *not* use `scroll-snap` even though an open WebKit bug makes it nearly free on iOS, the 184px jump Chrome makes when the snap rule moves and the spec line saying it must, `touch-action` instead of `preventDefault` and the Safari passive-listener divergence behind that, why the step waits for your finger to lift, and the ten things only a real iPad can tell us |
| [glossary.md](docs/project/glossary.md) | **the terms this piece uses, and where it uses them**: a *mode* in the band rather than a page, so it cost the layout one line; the two bugs from the original it is shaped around — output tokens are what time out, and "keep the first one" systematically deleted the more specific phrase — the richness-scored dedup their plan wrote and never built, why occurrences are found by us rather than asked of the model, why the word boundary is not `\b`, the condition attached to keeping the model's difficulty and centrality scores and the threshold slider that handed the one number in it to the reader — and **why an entry says two things rather than one**: what the author means (from the article) and what you need to bring to it (the model's own knowledge), which is what stopped entries describing the page the reader is looking at, and made provenance a label instead of a warning triangle. The web is per-term and reader-initiated, and it is `explain` with a different selection rather than a second mechanism — and, since 2026-08-26, **every term is underlined in the prose in every mode**, which reverses the decision the same doc argues for two sections further down: what the reader now initiates is the *card*, not the line, so the line had to get quieter and "selected" had to stop meaning "marked at all". The card is a second tooltip implementation and there is a real reason for that — its triggers are injected HTML, so there is no React element to wrap |
| [summaries.md](docs/project/summaries.md) | **the article at whichever length you ask for**: a *mode* in the band, and the previous version's named length ladder wired to every level of the tree rather than to one hardcoded tooltip; why the shortest rung is free and the panel therefore works before anybody has paid a model call, one batched call per parent and the 89% that buys, the partial salvage that stops one malformed entry taking eight good ones with it, why a fallback down the ladder has to say so out loud, the expertise axis they built that nobody ever measured — and, since 2026-08-26, **the panel following the reader**: why the strong mark goes on the deepest row that is actually *drawn* rather than the deepest row there is, why a panel the reader can scroll nudges where a panel they cannot scroll centres, why keying on the target instead of on scroll events means never having to ask whether a scroll was yours or theirs, the `<li>` that measures its whole subtree, and the native smooth scroll that cannot be told to stop |
| [reader-profile.md](docs/project/reader-profile.md) | **telling the model who is reading**: two boxes and one string, and why the previous version built both and read neither; where the profile rides in every prompt and why that is the *end* of it rather than the system prompt; the rules that live in `SYSTEM` whether or not anybody has a profile, and the forbidden sentence carried verbatim because a prompt ban relocates a register rather than deleting one; why the glossary is the case this is really for — a difficulty score is a property of the *pair*, not of the term; the three states of `profileHash` and why two of them are never stale; why `existingFor` is stricter than the staleness rule it sits beside; and why the client may say *whether* but never *who* |
| [ideas.md](docs/project/ideas.md) | **the propositions this piece needs you to hold**: the other axis from the glossary — a term is a word you look up, an idea is a claim you hold, and the test that separates them is whether you can state it as a proposition. Why an *assumed* idea's occurrences are the passages that would stop making sense without it rather than passages that state it (nothing states it — that is the definition), and why the heading over them says *the model thinks* rather than *assumed in*: a block id proves the passage exists, not that the author assumed anything. The first stage that lets the model name block ids, and therefore the first with five ways of dropping what it said — `unanchored` being the one to watch. The first whose freshness covers the **tree** as well as the blocks, and the first with the reader's **profile in the stamp** rather than merely recorded. Two bugs found by running it: a prompt asking for ids against the renderer that omits them, which reported "the model returned no ideas" while the model had done nothing wrong; and the fix for it quietly breaking the prompt-cache grouping, which had assumed every article stage sends identical bytes |
| [comments.md](docs/project/comments.md) | **select a sentence and the model explains it**: the dialog (not a column), why the anchor is the quote rather than an offset — and **the two questions a selection raises**, since answering only the first is what made it explain that an acknowledgements line is an acknowledgements line rather than say who the person was. The answer now streams in, on plumbing chat had already built; the two ways to push back on a thin one are a deeper search that keeps your old answer until the new one lands, and a follow-up box that hands the question to chat rather than growing a transcript in a dialog |
| [chat-tools.md](docs/project/chat-tools.md) | **the tools chat can reach for**: the six, and the filter they had to pass — *does it send the reader somewhere they could not otherwise get to?* — which is why there is no `summarise_article` tool and never will be; why `index` and not `id` is the identity of a streamed tool call, and how keying on the wrong one looks exactly like a model choosing not to use a tool; why the last round is offered no tools rather than simply stopping, and why that is what makes the loop terminate; one deadline for the turn and a fresh stall clock per round, because a tool taking eight seconds is not a stalled stream; the fence around a stranger's web page and an honest account of what it does not stop; and the capped list that said nothing about being capped, which made the model try to count an article by hand and spend its whole budget doing it |
| [url-state.md](docs/project/url-state.md) | every bit of view state lives in the URL: the parameters, which ones push history and which replace, why position is a *section* — and the one path whose parameter is somebody else's address rather than one of our slugs, `/add/<a whole URL>` |
| [diagram.md](docs/project/diagram.md) | **the article's shape as a picture**, in the band: eight of them behind one toggle, in three groups. Three hand-rolled ones draw the **tree**, and the reason they are three rather than one is that a map faithful about *size* cannot also be legible about *names* — `strata` is to scale (in words, and it answers the one question the gist columns cannot: how much of the piece is that section) while `tree` and `mindmap` give every name the room it needs. Three D3 ones draw a **graph**, over a structure built from the prose itself: sections joined by the distinctive words they share, which is the one relationship a tree cannot hold — with an honest account of what that measure does and does not know, and why the words behind every link are shown rather than just the link. And, since 2026-08-27, **two made of paragraphs rather than of sections**: one dot each, placed by an embedding of what the paragraph is *about* — `drift` keeps the article down the page and spends sideways on meaning (topic lanes, or one sliding scale), and `trail` is the only picture here that gives up down-the-page-is-later, because both of its axes are meaning and reading order is the line joining the dots. **What they can and cannot promise runs one way only** — two dots far apart really are far apart, two dots close together may differ entirely in what the projection threw away — which no percentage of variance rescues, so the strip says it in words; plus why every lane is named from its own words, why one malformed paragraph must not set the dot sizes, and the plane that converges while its two axes do not. Also **the libraries the survey rejected and why** — every published diagram grammar spends width to show depth, and in a 288px band width is the axis we have not got — why the argument for hand-rolling was about the *data* rather than the algorithms and therefore changed when the data did, why a generated image of a structure is the [silent-success](docs/reusable/silent-success.md) pattern with a picture on it, and the secret the CSS and the TypeScript share, which is that SVG will not wrap text and moving a font size silently breaks arithmetic in another file |
| [column-context.md](docs/project/column-context.md) | how a gist column reads: the whole level in a panel with the current item held on the reading line — Greg's centred fisheye, chosen over three alternatives built beside it; the research, GPT's review, what the panel replaced and what it cost |
| [ingest-queue.md](docs/project/ingest-queue.md) | **paste a URL and it becomes an article**: the five steps as data, why p-queue and not BullMQ or pg-boss, why it polls rather than streaming, an honest account of how far "idempotent" actually goes — and, since 2026-08-26, **`/add/<a whole URL>`**, the address that queues an article and then takes you to it: why Add on the shelf now goes there rather than queueing where it stands, why the app's own spelling of that address is percent-encoded when the one you type need not be, and the three traps in a page whose whole job is one effect — and **the two functions that decide whether two addresses are one article**, why it has to be two rather than one (what we fetch may not be changed; what we compare may), and why the identity test lower-cases the path even though a path is case-sensitive — and, since 2026-08-27, **uploading a PDF off your own machine**: three requests of which the middle one does not touch our server at all, because on Vercel it cannot; why the transfer happens on the shelf and the ingest at `/add/upload/<id>`; why there is no new pipeline step and why the old one changes what it calls itself; why the staging object is deliberately never deleted (deleting one *re-arms* the grant over its key); why an upload never adopts an existing article and the one lookup that would have let it; and the ugly part, which is that the slug comes from the filename |
| [library.md](docs/project/library.md) | the homepage: browsing past articles, `/read/<slug>`, what a card says and why the blurb is the root gist, the one file a move to Postgres goes behind — and, since 2026-08-26, **what you can do to a card**: why Delete means archive and the Undo strip is the confirmation, why a renamed title is an override that a re-extraction cannot eat, why the card stopped being one big link and what that costs, the fourth kind of reader state and why its columns are on `articles` rather than on a revision, the two counts the tooltip deliberately refuses to show, and the search box's two matchers — and, since 2026-08-26, **one sort state and two renderers**: six sort chips, an Unread filter and a cards-or-table toggle that both views obey, the card that says what it is sorted by (which is the half a table library would not have given us, and why we hand-rolled instead of taking TanStack), and the three sorting rules that look right in a browser and are wrong — a fixture that floats to the top, a missing value read as a small one, and equal rows that reshuffle on reload — and, since 2026-08-27, **the third Delete**, on the article's own metadata page, where there is no strip and no dialog and the undo never expires, because the reader who pressed it is still looking at the page it belongs to |
| [page-titles.md](docs/project/page-titles.md) | **what the browser tab says**: one rule — *what is different about this tab goes first* — and the reasoning under it, since every place a title is shown truncates from the right. Why the article's own title leads and `Spideryarn` trails; why the strapline is on the two homepages and nowhere else (a tagline on every page is the boilerplate Google's own guidance says makes titles indistinguishable); why six of the seven modes are named and the default one is deliberately absent, which is the same call the URL makes; why the clamp is not a character limit and cannot be — every truncation that matters is measured in **pixels**, and the familiar "50–60 characters" is SEO folklore in the wrong unit. And the half that fails silently: **assigning `document.title` announces nothing**, because a screen reader reads a title on a document *load* and this app never loads twice — hence the live region, and the two ways a live region says nothing while looking like working code |
| [design-css-overview.md](docs/project/design-css-overview.md) | **the map for anything visual** (stub): the four stylesheets and the order they load in, which of the three mechanisms owns a given rule, the colour and type tokens, the sans that replaced Georgia and why the previous version's docs were wrong about its own fonts, the vertical rhythm, and an honest list of what isn't decided — and, since 2026-08-27, **why the shelf's buttons were ugly**, which was one line of CSS rather than taste: the preflight replacement we hand-wrote was scoped to `[data-slot]`, so it covered shadcn's components and not the *36 of 59* buttons on that page which are hand-rolled, every one of them wearing the browser's own `2px outset white` border and none of them a pointer cursor. The one-line console check that finds it, the second hover language `--accent` had quietly introduced, the muddy grey slab that made the page's primary action look disabled, and why `hover:bg-primary/90` makes an orange button *darker* on a dark ground. Its live counterpart is **`/design`** ([`DesignPage.tsx`](src/web/DesignPage.tsx)) — every token, face, weight and component variant on one page, with contrast measured in the browser; look at it after touching `tokens.css` |
| [colour-scales.md](docs/project/colour-scales.md) | **three palettes that are not the brand**: eight categorical hues (one per saved search), a sequential heat ramp, and two diverging scales. Mostly about the two things every published scale gets wrong on a near-black page — dark steps vanish, and a white pivot makes the *middle* of a diverging scale the loudest thing on it — plus why `color-mix` is the wrong way to build a ramp (hue takes the long way round, gamut clipping flattens the middle), why red/green is the worst possible oppositional pair and what to use instead, why monotonic lightness is the only property that matters in a sequential ramp, and the honest cost of deleting a saved search |
| [icons.md](docs/project/icons.md) | Lucide, not Phosphor: why, the one stroke weight everything uses, the loading spinner recipe, and the two ways swapping a glyph for an SVG breaks a layout quietly |
| [auth.md](docs/project/auth.md) | **the one-email beta gate** (stub): why auth here is about an open proxy and an open wallet rather than user accounts, why Supabase Auth won, the list of five providers that RLS restricts you to, and the one test that has to exist |
| [search.md](docs/project/search.md) | **finding a passage by its words, or by what it says**: one box with two matchers behind it and one results list, the wall the borrowed docs warn about that `annotateHtml` had already gone round — and why we did *not* need the CSS Custom Highlight API — the confidence unit that changed silently in their version and the four counts in the log line that would catch it here, the shared `findQuote` rule that stops the panel and the prose disagreeing, why the search wash is a different hue rather than a different alpha — and, since 2026-08-26, why the default matcher is the one that costs money, why a result now says *where in the article* as well as how sure the model is (and why that ruler counts characters rather than blocks), and what the confidence number actually means once you stop letting the word "confidence" explain itself — and **the shape of a search**, painted into the spine as one lane per question, which is the thing a list of thirty passages cannot show you, placed by the rail's measured pixels rather than by the character ruler a result row prints |
| [security.md](docs/project/security.md) | **two untrusted parties, and neither is another user** — the content, and the URL: why Readability let `<img onerror>` reach the reading view, where the sanitiser sits and why it's stage 3, the video-embed allowlist, the confirmed path traversal in the read API and the fixture fallback that disguised it as a refusal, the four ways to break it silently, and an honest list of what's still open |
| [logging.md](docs/project/logging.md) | **what the server says to whoever is running it**: why Pino, the three ways its config deliberately differs from the original version's, what each level means here, why redaction being path-based makes the message string a rule rather than a preference, Vercel's one-day retention and the two traps in its log view, why the pipeline's token counts are logged from the seam rather than from inside anyone's stage — and why the CLI's `console.log` output is not logging and is staying |
| [prompt-caching.md](docs/project/prompt-caching.md) | **paying for the article once**: the three caches and why it is three rather than one, the `←READER IS HERE` marker that sat inside the article body and meant explain never hit a cache in its life, the one renderer every prompt now goes through, the 1,024-token floor under which a breakpoint is accepted and does nothing, why a fan-out that fires all at once pays the write four times and reads none — and the two halves of checking it, since a broken cache returns the right answer and only costs more |
| [copy.md](docs/project/copy.md) | **the words the reader sees when something fails**, and why they are all in one file: say what happened without assuming they know what an HTTP status is, say *whose* problem it is — because telling somebody to try again when retrying cannot work is the expensive mistake — say what to do next, and never repeat what the provider said, which is a privacy rule rather than a style one. Also the bracketed code at the end of every message, which exists so a reader can quote four characters and so a test can stop pinning prose |
| [linting.md](docs/project/linting.md) | `npm run lint`: why Biome rather than ESLint (TypeScript 7 removed the API ESLint needs), the config-file extension that silently discards your settings, and which rules are off on purpose |
| [typechecking.md](docs/project/typechecking.md) | `npm run typecheck`: the three tsconfigs, the strict flags we turned on and the one we didn't, and the guard that stops a typecheck checking nothing |
| [static-analysis.md](docs/project/static-analysis.md) | **`npm run check`**: what the machine can say about this code without running it. Knip for the project-wide layer the typechecker can't see, cycles, complexity and copy-paste — but mostly **the tools that look perfect for this repo and are quietly wrong about it**, because TypeScript 7 removed the compiler API nearly all of them drive. dependency-cruiser resolving every import while possibly not *seeing* them all; the Biome rule whose autofix rewrites `import "./tailwind.css"` to `.js` and ships you an unstyled app with a green linter; why cycles gate and lint doesn't, and why a check that always fails is a check nobody runs |
| [version-control.md](docs/project/version-control.md) | **the git remote, and committing in a tree several agents share**: where the repo is (`spideryarn/reading2`, private) and why a push is neither a deploy nor a backup of anybody's uncommitted work; the two rules that are stricter than normal git practice and the 2026-08-26 accident behind the second of them — `git reset && git add` and `git commit` are two commands and the index is shared, so the pathspec after `--` is the load-bearing part; why a commit can be green here and broken everywhere else; what is deliberately not in git; and the repo move that still hasn't happened |
| [deployment.md](docs/project/deployment.md) | **Spideryarn on Vercel**: the project (`spideryarn-reading2`) and why it is not the old one, and **the two ways in that build different code** — a push to `main` builds the commit, `vercel deploy` builds your disk — which is worth knowing because the first git deploy failed on code that built fine locally, `src/routes.ts` having been committed importing two exports still sitting uncommitted in someone's working copy. Why the build compiles the API itself: Vercel uses this repo's TypeScript 7, which its builder cannot drive, and then *reports success and ships a function that fails on every request*. Also **why the app is currently readable by anybody who has the URL** — Vercel generates *two* `.vercel.app` production addresses, only one was deleted, and this page said the hole was closed for a day while it wasn't; Pro cannot put a login in front of either without a $150/month add-on. And, since 2026-08-27, **`spideryarn.com` itself** — moved off the old project without the registrar being told, because the records at Namecheap point at Vercel's shared edge rather than at any project, so which app answers is a mapping inside Vercel and the move is one API call. Which project goes in the path and which in the body, the `not_found` that meant success rather than failure (one call moved both names, the apex being a redirect the endpoint carries along), and the thing a move checklist does not ask about: **the app lost its `noindex` the moment it got a real address**, that header being a property of the address rather than of the project — with no `robots.txt` to fall back on, because the SPA catch-all was answering `/robots.txt` with `200 text/html`, which a crawler reads as *no such file*. Plus why "the repository couldn't be found" is usually about your account's GitHub connection rather than the repository, what `/api/health` is for and why it is hard to please, the five things here that fail without saying so, and an honest list of what does not work in production yet |
| [setup-dev.md](docs/project/setup-dev.md) | install, `npm run dev`, the command for each pipeline stage, and **which model each job uses** — two tiers in [`src/models.ts`](src/models.ts), capable (Sonnet 5) and quick (GPT-5.6 Luna), with a table saying which job is on which and everything on capable for now; also the two spellings the Anthropic SDK and OpenRouter each want, and why the quick tier can only have one of them |
| [original-version/](docs/project/original-version/overview.md) | **a folder, not a file** — the app this is an offshoot of, one doc per feature: what we borrowed, what it already solved, what it got wrong, and [what to rebuild first](docs/project/original-version/borrow-list.md) |
| [testing.md](docs/project/testing.md) | the test runner, what's deterministic enough to test, what we deliberately don't — and **[`evals/`](evals/README.md)**, which is the other thing: run by hand, calls a model or measures one's output, results committed so the next change is compared against a number rather than a memory |
| [browser-testing.md](docs/project/browser-testing.md) | how to drive the reading view in a browser, and the ways it lies to you: colour, sticky positioning, a hidden tab that fires no scroll events at all, an `opacity` that reads zero on something plainly painted — and **hovering by pixel rather than by element**, which is off by 5–6% and once produced a detailed bug report for a bug that did not exist |
| [open-questions.md](docs/project/open-questions.md) | undecided calls, each with a recommendation so nobody is blocked |

`docs/plans/` holds plans for work that is being done or has just been done — the reasoning and the
evidence behind a change, written before it landed and kept afterwards so the *why* survives.

`docs/postmortems/` holds one file per bug worth understanding — what the root cause actually was,
which commit introduced it, the fix that's right for the long term, and what would have caught the
whole class of it earlier. Not listed here either; list the folder.

`docs/research/` holds the working behind a decision — the options weighed, the sources, and the
dead ends — kept so nobody has to run the search again. A plan says what we're doing; a research doc
says what else we could have done and why we didn't.

Neither folder is listed here. There are a lot of them and they keep arriving, so list the directory
and read the file names — they say what each one is about, and the first paragraph of a plan says
the rest.

`docs/reusable/` holds notes that aren't about this project and are meant to be carried elsewhere:

- [docs/reusable/codex-cli-as-subagent.md](docs/reusable/codex-cli-as-subagent.md) — dispatching a
  GPT/Codex subagent from Claude Code via [`scripts/run-codex.ts`](scripts/run-codex.ts), for
  cross-family review or delegated implementation
- [docs/reusable/third-party-library-selection.md](docs/reusable/third-party-library-selection.md) —
  how to pick a dependency: bias towards long-lived, heavily-documented libraries, then write the
  decision down. Followed for Vitest in [testing.md](docs/project/testing.md)
- [docs/reusable/silent-success.md](docs/reusable/silent-success.md) — **the pattern behind most of
  a day's bugs.** A thing reports success while doing nothing, and the check you'd naturally run
  returns the answer you were hoping for — because it shares an assumption with the code. A dozen
  worked examples and the habit that catches them.
- [docs/reusable/css-sticky-containing-block.md](docs/reusable/css-sticky-containing-block.md) —
  why `position: sticky` can be declared correctly and do nothing: its range is its containing
  block's size minus its own, so a `100vw` bar in a `100vw` parent has zero range and fails
  silently. Found here, but not about this project.
- [docs/reusable/gjdutils-instructions.md](docs/reusable/gjdutils-instructions.md) — **read this
  first.** Greg keeps a library of reusable "how to do this kind of task well" instructions in
  [gjdutils](https://github.com/gregdetre/gjdutils/tree/main/docs/instructions). When a task matches
  one, follow it rather than inventing a process. Copied in so far:
  - [capture-sounding-board-conversation.md](docs/reusable/capture-sounding-board-conversation.md) —
    writing a conversation up as a document: quote Greg verbatim, synthesise the rest
  - [generate-mermaid-diagram.md](docs/reusable/generate-mermaid-diagram.md) — authoring `.mermaid`
    files and rendering them to SVG, plus the house style for colour, shape and labels
  - [rename-or-move.md](docs/reusable/rename-or-move.md) — `git mv`, then hunt down every reference
  - [write-deep-dive-as-doc.md](docs/reusable/write-deep-dive-as-doc.md) — researching a topic and
    writing it up as a reference doc with its sources attached

## The one contract that matters

Every block of the article gets a **stable id** (`spya-k3m9qt`), and every feature — ToC, summaries,
scroll position, highlights, notes, questions — addresses text by that id, never by character offset
or CSS selector. Ids are minted once and preserved on every later run, so they survive re-extraction.

The format, the reasoning, and the one way to get range checks silently wrong are all in
**[block-ids.md](docs/project/block-ids.md)** — read it before touching anything that resolves an id.

## How we write docs here

We keep **lots** of documents under `docs/project/`. A doc here is really only two things:

1. **Intent** — Greg's suggestions and directions, the goals, the design constraints, the decisions
   and why they were made. Mostly in his own words.
2. **Signposts** — links to the other docs and to the code, so an agent dropped into any one file
   can quickly find the relevant place.

Not descriptions of code, which the code already provides.

- **Update the docs as you go.** Any time you create or change functionality, consider whether a doc
  under `docs/project/` needs creating or updating, and do it in the same piece of work.
- **File names are lower-case kebab-case.** `table-of-contents.md`, not `TABLE_OF_CONTENTS.md`.
  This holds everywhere under `docs/`, including `docs/reusable/`, even when the doc was copied in
  from somewhere that shouted. Rename on sight and fix the links.
- **New doc ⇒ new signpost.** Every time you add a doc under `docs/project/`, add a line for it to
  the table above in this file. A doc nothing links to may as well not exist. Plans and research docs
  don't get a line — they're found by listing their folder — but link to them from the project docs
  they bear on.
- **Quote Greg directly.** Where a document captures something he said, use his exact wording, or as
  near to it as possible, in a blockquote — the phrasing carries intent that a paraphrase loses.
  Attribute and date it. If you later find you've flattened a quote into your own voice, put his back.
- **Signpost heavily.** Every document should link out to the other documents and to the relevant
  bits of code (e.g. [`src/blocks.ts`](src/blocks.ts)), so an agent dropped into any one file can
  find its way to everything else. Cross-link both directions; deep-link to specific sections.
- **Record decisions where they belong.** When something in
  [open-questions.md](docs/project/open-questions.md) gets decided, write it into the relevant doc
  and delete the question. That file should shrink.
- **Write down anything a future reader would otherwise have to reverse-engineer** — especially the
  reason a design went one way rather than the obvious other way, and *especially* where the decision
  went against the recommendation written down at the time.

## Working agreements for agents

- **Explain plainly.** Whenever you explain something, summarise, or ask a question — in chat, in a
  doc, in a commit message — use plain words and short sentences. Say the thing itself, not a
  gesture at it. No jargon where an ordinary word will do, no hedging padding.
- Several agents work this repo in parallel. Stay inside your stage — see
  [architecture.md § Stage ownership](docs/project/architecture.md#stage-ownership) — and talk to
  other stages through the JSON artefacts on disk, not by reaching into their code.
- The deeply-nested ToC and the granularity-zoom tree are
  [the same structure](docs/project/granularity-zoom.md#the-tree), produced by stages 4 and 5
  together. They must not diverge into two trees.
- Keep pipeline stages independently runnable and independently cacheable. Each writes JSON under
  `data/<slug>/`; anything expensive is cached on a content hash.
- Prefer boring: filesystem over database, one server process, TypeScript + ESM throughout, `tsx` to
  run. "It can be a simple one at first" — no framework churn while the ideas are still moving.
  **Two deliberate exceptions, both 2026-08-25 and both Greg's call.**

  *One — the database.* "Filesystem over database" is being reversed: storage moves to Supabase
  Postgres, *"in readiness for deploying this properly to the web."* The principle didn't lose an
  argument, it ran out of runway — a single writable disk is the thing serverless hosting does not
  have, so the choice is a database or no deploy. Planned in
  [postgres-migration.md](docs/plans/postgres-migration.md), **not yet built**; until it is, the
  filesystem layout in [database.md](docs/project/database.md) is still what's true. Note that
  "one server process" in this bullet goes with it, and that everything else here — TypeScript, ESM,
  `tsx`, no framework churn — is untouched.

  *Two — shadcn.* Tailwind v4 and shadcn components went in at Greg's
  request — *"Let's switch to using Shadcn."* That is framework churn, and it was weighed against
  this bullet rather than slipped past it: the plan
  ([shadcn-migration.md § Honest assessment](docs/plans/shadcn-migration.md#honest-assessment))
  states the cost in full and recommends only the cheap half of it. The principle was not forgotten;
  its owner overrode it. It still governs everything else, and it still governs how far shadcn
  spreads — [web-client.md § Tailwind and shadcn](docs/project/web-client.md#tailwind-and-shadcn-components)
  says what is deliberately staying hand-written.
- Before rebuilding something the previous version already solved — AI headings, multi-granularity
  summaries, Readability edge cases, overlapping highlights, stable element ids — check
  [original-version/](docs/project/original-version/overview.md). It's a library to consult, not a backlog
  to import: that project is far larger in scope, and this one is staying tight.
- **Log from the server, `console.log` from the CLI** — the rule is the destination, not the
  function name. Anything in a request path goes through [`src/log.ts`](src/log.ts), and a
  `console.log` there is a bug. Never put anything sensitive, or any article prose, in a log.
  [logging.md](docs/project/logging.md) has the why, the levels, and what fails silently.
- **Run `npm test` and `npm run typecheck` when you finish a change, not just before you commit.**
  Both are deterministic and take a few seconds, and finding out at commit time that a change from
  half an hour ago was wrong is the expensive way to find out. `npm run lint` too, on the files you
  touched — its baseline is not clean yet, so read it as advice rather than a gate; see
  [linting.md](docs/project/linting.md). What the tests cover, and what they don't, is in
  [testing.md](docs/project/testing.md); why the typecheck needs a script of its own rather than a
  bare `tsc` is in [typechecking.md](docs/project/typechecking.md).
- **Get a cross-family review before you commit.** Every plan under `docs/plans/` goes to GPT Sol
  before it is built, and the code built from it goes back for a second review — weight that second
  one higher, because a plan-stage review cannot find a `PATCH` that writes one field and then
  rejects the request. A different model family has different blind spots, and that is the whole
  point. Read-only, in the background, and give it three quarters of an hour:

  ```
  npx tsx scripts/run-codex.ts --model gpt-5.6-sol --effort high --timeout-minutes 45 \
    --prompt-file <review-prompt> --output <review-answer>
  ```

  Hand it the evidence — the scoped diff, the results file, the script that produced a number —
  rather than only the prose; the finding is often about the experiment rather than the conclusion.
  Check each finding yourself before acting on it, since some of them are wrong, then fold what
  survives into the plan and add its questions to the ones for Greg. **And check that a verdict
  actually arrived** — exit 0, and read the answer file — because a review that returned nothing
  looks exactly like a review that found nothing. The run spends the ChatGPT subscription first and
  falls back to `CODEX_API_KEY` by itself, so `retrying with CODEX_API_KEY` on stdout is the
  fallback working rather than a failure. Setup, that fallback and the traps are in
  [codex-cli-as-subagent.md](docs/reusable/codex-cli-as-subagent.md).
- **Reproduce a bug with a failing test before you fix it.** Write the test first and watch it go
  red — a test that was never red proves nothing. Then fix, and check it's gone green.
- **Root-cause every bug in a subagent, and write it up.** When you're fixing a bug, hand the
  investigation to a subagent and tell it to keep going until it really understands the cause — not
  the line that broke, but why that line was written. It should come back with: the root cause, which
  commit(s) introduced it and when, the fix that's best for the long term rather than the quickest,
  what we can learn from it, how we'd avoid this whole class of problem in future, and whether
  anything should be rearchitected. Then write that up as a new `.md` under `docs/postmortems/`.
- **Do browser work in a Sonnet subagent.** Anything driving Claude-in-Chrome — browser automation,
  checking the reading view in a real browser, screenshots — should be delegated to a subagent with
  `model: "sonnet"` rather than run in the main thread. It's mostly click-look-click, the screenshots
  are large, and keeping them out of the main context is worth more than the extra reasoning. Tell
  the subagent to read [browser-testing.md](docs/project/browser-testing.md) first, and ask it back
  for the conclusion, not the page dumps.
- Before writing any Anthropic SDK code, load the `claude-api` skill for current model ids and
  parameters; don't hardcode a model from memory.
- **Stream any model call a person is waiting on.** A spinner for fifteen seconds and the first
  sentence after two are the same call; only one of them lets the reader start reading. The plumbing
  is already built and shared — `sseChunks` and the abort helpers in
  [`src/openrouter-stream.ts`](src/openrouter-stream.ts), `sse(res)` in
  [`src/routes.ts`](src/routes.ts), `readEvents` in [`src/web/lib/sse.ts`](src/web/lib/sse.ts) — so
  a new streaming endpoint is a generator and a route, not a project. Write the generator as the
  only implementation and let the waiting callers drain it, rather than keeping a second
  non-streaming copy: `explain`/`explainStream` in [`src/explain.ts`](src/explain.ts) is the shape.
  A batch call in the pipeline, which nobody is watching, does not need this.
  [comments.md § The answer arrives a few words at a time](docs/project/comments.md#streaming) has
  the two invariants that a stream needs and a single response does not — chiefly that **a stream
  can end by simply stopping, and that looks exactly like finishing**.
- **Never run a git command that throws work away.** Other agents' unsaved edits are sitting in
  this same tree and there is no second copy of them. So: no `git checkout -- …`, no `git restore`,
  no `git stash`, no `git reset --hard`, no `git clean`, no switching or rebasing branches — not
  even "just on my own file", because you can't tell whose edits are in it. Undo your own mistake by
  editing the text back the way it was. If you think you really need one of these, ask Greg first.
- **Commit when the work is done.** When a piece of work is finished and working — or you've reached
  a good stopping point — commit it, without waiting to be asked.
- **Committing, with several agents in one working tree.** We're deliberately not using git
  worktrees yet — not worth the complexity — so the tree has other agents' in-flight edits in it.
  Commit only your own files, by naming them explicitly and doing it in one atomic command:

  ```
  git reset && git add <your files> && git commit -F <msg> -- <your files>
  ```

  The leading `git reset` unstages anything someone else left staged. Never `git add -A`, `git add .`
  or `git commit -a`. And don't stress if someone sweeps up one of your changes anyway — it happens,
  it's recoverable, keep going.

  **Name the files on `git commit` too — the `--` at the end is the load-bearing part**, and this
  recipe did not have it until 2026-08-26, when it produced exactly the accident it exists to
  prevent. `git reset && git add …` and `git commit …` are two commands, and **the index is shared**:
  another agent running its own `git reset` in the gap unstages your files and stages its own, and
  your commit then lands *their* work under *your* message. Not a race you can win by being quick —
  the gap is however long the tool call takes. A pathspec on `git commit` bypasses the index
  entirely and commits those paths whatever anybody has done to it, so the two commands stop being
  a sequence you have to get through uninterrupted. Use `-F <file>` rather than `-m` while you are
  at it; a long message in `-m` is one shell-quoting mistake away from the same mess.
