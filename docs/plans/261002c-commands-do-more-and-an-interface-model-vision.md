# Commands do more, and a vision for an interface model

Reports: SPIDERYARN-READING2-8D (spya-rkn8mn), Overseer queue qi-gwp9epnd. From an admin (Greg),
so trusted input; `feedback-reporter.ts` exited 0 on the production row.

> Add a lot more Metadata functionality to Commands, e.g. to reprocess (a particular mode) with more
> powerful AI.
>
> And in general, look for ways to make Commands more powerful and universal and an easy-to-use way
> to do most things.
>
> My dream would actually to include a way to type/speak questions/commands, e.g.
> - "add a tag of X to this paper" would trigger the appropriate tool
> - "do they talk about X?" would add a search
>
> Perhaps an LLM would run the appropriate tools (ideally Jev via OpenRouter as a first-pass for
> speed, falling back to a more powerful LLM if Jev is unsure about what's the right thing to do).
>
> Ideally we would provide this interface-LLM (for clarity, I'm distinguishing it from the
> content-LLM that focuses on the article - though obviously in practice we might be using the same
> models, just prompted differently) with a bunch of information about how Spideryarn works, and/or
> give it tools that search its own Help page and/or the docs in the repo and/or code (which is open
> source on GitHub).
>
> I suppose in the long-term, we might allow the main Chat to do all this stuff too... actually, that
> would be neat. Yes, that should definitely be the aspiration. Create a
> chat-llm-help-commands-vision.md (or similar), and delegate to one or more agents to make as much
> progress on all this as you can.
>
> If anything is complex or needs my input, defer it (and we'll discuss), otherwise use your
> judgment about how to make this work nicely.
>
> — Greg, 2026-10-01 (from `/read/jco-2005-01-libre-spya-hk9cc7?mode=tweets`)

## The shape of the answer, in one paragraph

**Build the deterministic half; write the model half down.** Every command the bar learns is a
typed, named action with its own words, its own `generates` marker and its own `run`. That is
exactly the list an interface model would later choose from, so each row built now is one more tool
the model will have on the day it arrives, and the bar stays useful (and free, and instant) without
it. The model itself is a vision doc plus, if there is room, one cheap measurement of Jev choosing
a command from typed phrases. Letting any model *act* for the reader crosses a line chat has held
on purpose since 2026-08-26 (*"nothing chat can call writes a file, deletes anything, or spends
money"*, chat-tools.md § Security). That is a defence, so it is written up for Greg, not built.

## What exists

- The bar: `src/web/CommandBar.tsx` (rows), `src/web/command-match.ts` (the `Command` union —
  `mode`, `submode`, `page`, `action` — and five-tier ranking), `src/web/sub-modes.ts`. Mounted by
  the Dock on the reading view (with `onMode`) and on the Metadata page (no `onMode`: mode rows are
  links). Owner-only. Rows besides modes: Metadata, Comments, the app pages, Feedback.
  [reading-view-overview.md § The command bar](../project/reading-view-overview.md#the-command-bar).
- Metadata's re-run menu: `METADATA_RERUN_STEPS` (src/rerun-steps.ts) — arc, tweets, glossary,
  quotes, ideas, timeline, quiz, faq, sketch, skim, debate, citations, crossrefs, simple — each a
  forced `POST /api/jobs { slug, steps, force: [step] }` through `useStepJob`/`useJobs().run`.
  Labels `RERUN_LABEL` and notes `RERUN_COST_NOTE` in Metadata.tsx. Free to the reader.
- A mode's band shows a job for its step **started elsewhere** (`useStepJob` matches any
  queued/running job for the slug whose steps include it; `watches-queue` polls every 8 s, Arc is
  `quiet`). So a job started from the bar shows up in the band once the mode is open.
- High-powered AI: a per-article switch, first thing in Metadata's *AI processing* section;
  `PUT /api/article/:slug/high-power`, charged one article (half if public) to a reader, once.
  Switching re-runs nothing; the re-run rows are how you ask. [high-powered-ai.md](../project/high-powered-ai.md).
- Metadata sections open and flash via `reveal()` in `PageContents.tsx` (DOM event
  `SECTION_REVEAL`), but **there is no URL for a section** (open state is local, deliberately).
- Archive: `useArchive` (src/web/useArchive.ts), one controller in `OwnedArticle`
  (`ArticlePage.tsx`), passed to Metadata and Reader but not to the Dock.
- Export: `download()` private inside `ExportSection`, `GET /api/export/:slug`.
- Share: there is no share dialog, on purpose — *Share…* on Metadata scrolls to *Access & sharing*
  so the publish confirmation cannot be skipped.
- Search: words mode is addressable — `?mode=search&match=words&find=wet+hardware` — and costs
  nothing. Meaning search is a model call and is pressed, not arrived at.
- Jev (`typesafe/jev-1.13`): a *decisions* model on OpenRouter's alpha `POST /api/alpha/decisions`,
  ~0.6 s and ~$0.0005 a call, returns `probabilities` and `confidence` per question. Only an eval
  has called it, through the declared bypass `shelf-topics-jev`; the gateway (`src/ai-call.ts`) has
  no route for it ([261002e](../research/261002e-shelf-topics-which-model-picks-the-pills.md)).

## What we'll build

### Stage 1 — this article's Metadata, from the bar

Rows about the article you are standing on, so they appear exactly where `articleRows` does today
(reading view and Metadata page, owner only).

1. **Run a mode again** — one `action` row per step in `METADATA_RERUN_STEPS`, labelled
   `<RERUN_LABEL> › Run again` (the sub-mode rows' `›` convention), description from the step's
   cost note or a plain sentence, aliases `rerun`, `regenerate`, `redo`, `run again`, `refresh`,
   `again`; `generates: true`. **Shown only once the query is non-empty and matches** — fourteen
   rows would otherwise double the empty list everybody scrolls past to reach a mode. That needs a
   small new property on `CommandWords` (`typedOnly`), filtered in one place.

   Enter **awaits** the forced `POST /api/jobs` (via `useJobs("quiet").run`, the same call
   `useStepJob.start` makes, `force: [step]`, so nothing downstream is swept in), then:
   - **refused** (allowance, a run already in flight, offline): the bar stays open and says the
     server's sentence on a line under the input. A refusal that closed the bar would be a press
     that did nothing visibly — silent success.
   - **accepted**: the bar closes and the reader is taken to where the run shows its progress —
     on the reading view, the mode that draws that step (glossary → Glossary, simple → Summary ›
     Simple, arc → Structure, crossrefs → none, …), opened as its Dock button would; on the
     Metadata page, or for a step no mode draws, the *AI processing* section, revealed and flashed,
     where `RerunRow` (watches-queue, kept mounted) picks the job up. A row for a mode the Dock
     does not draw (experimental switch off) is not offered, matching Metadata's own filter, if
     it has one; otherwise matching it, since the switch hides the mode and not its data.
   - The mapping step → place is a total `Record<MetadataRerunStep, …>` beside `METADATA_RERUN_STEPS`,
     so a fifteenth step cannot arrive unplaced.
   - Opening the mode must not start a *second* run (generate-on-open fires only when there is no
     artefact; when there is none, the server's duplicate guard must refuse or join). Verified by a
     test, not assumed.

2. **Metadata sections by name** — `page` rows *High-powered AI* (→ *AI processing*, where the
   switch is first), *AI processing*, *Access & sharing* (aliases `share`, `public`, `publish`,
   `private`), *Export* (aliases `download`, `json`). Needs a way to address a section:
   **`?section=<id>` on the Metadata page**, read on arrival, revealing (open + scroll + flash) that
   section, then removed with `replace` so a reload or Back does not re-flash. One row in
   url-state.md. On the Metadata page itself the row reveals directly rather than navigating.
   *What it cost* stays off: the bar has never had an admin check, and this is not the change that
   gives it one.

3. **Archive / Unarchive this article** — one `action` row whose label follows the state (this is
   the exception to *Comments never moves with its state*: the verb *is* the command, and a row
   called *Archive* on an archived article would do the opposite of its name), through the existing
   `useArchive` controller, plumbed from `OwnedArticle` to the Dock and on to the bar. `generates:
   false`. Reversible, so no confirm.

4. **Export this article** — an `action` row that downloads the JSON, via `download()` extracted
   from `ExportSection` into a shared helper both call. `generates: false`.

**Deliberately not**: Delete (irreversible; a keyboard Enter one row away is the wrong door),
*Start this article again* (experimental and the widest press on the page), toggling High-powered AI
from the bar (it charges an article; the switch's own copy is where that price is stated, so the
row goes there instead).

**Greg's own example, "reprocess a mode with more powerful AI"**, is two commands after this stage
— *High-powered AI* (switch it on, priced as today) then *Glossary › Run again*. Doing it in one
(Opus for *this run only*, without switching the article) is a new billing shape — what does one
Opus re-run cost a reader? — so it is a question for Greg, below, not a build.

### Stage 2 — commands that take words

The bar has refused arguments since 260906h (*"it has one text box and it is the filter"*), and
Greg's dream examples are all argument-shaped. The smallest honest step:

- **`find <words>`** (also `search <words>`, `search for <words>`, `does it mention <words>`,
  `do they talk about <words>`, trailing `?` ignored): a row *Find "<words>" in this article*,
  which opens Search in words mode with `find=<words>`. Free, instant, exhaustive — and the
  deterministic ancestor of *"do they talk about X?"*. It appears **only** when the query starts
  with one of those verbs, so `No command matches.` stays the answer to a query that names nothing
  (decision 3 of 260906h is about a *guessed* fallback, and this is not one: the reader typed the
  verb). The parse is a pure function in command-match.ts with its own tests.

Considered for this stage and left out, each for the vision doc: `ask <question>` (a chat send is a
model call; prefilling the composer is possible but half a verb), `tag <X>` (there are no tags),
`define <term>` (the glossary's *Look up* box is a model call).

### Stage 3 — the vision doc

`docs/project/chat-llm-help-commands-vision.md`, under reading-view-overview.md beside
`interface-vision.md`: the interface model vs the content model; the command registry as its tool
list; Jev first with a confidence threshold, a capable model on low confidence; a *Help* tool
(the Help page, fb85, when it lands), docs and code search; what it may do without asking (navigate,
open, find), what it must propose and the reader confirm (anything that writes or spends), and what
it must never do (anything the article's own text asked for); the main Chat as the aspiration and
what stands between here and there; the open questions for Greg.

### Stage 4 (if there is room) — measure Jev choosing a command

A small paid eval, not production code: ~40 typed phrases (Greg's examples among them, plus
paraphrases, plus a few with no right answer) against the real command list, Jev's choice and
confidence vs a capable chat model's. Answers: how often is Jev right, and is its confidence a
usable "unsure" signal? A few cents. Its own declared bypass beside `shelf-topics-jev`. Results to
`docs/investigations/` (Greg 2026-10-02: internal evals go there). Skipped without regret if the
first three stages take the time.

## The simpler options passed over

- **Rows that link to Metadata only** (no in-bar re-run): one fewer `POST` path, but a reader in
  the glossary who types *rerun glossary* would land on another page and press again — two steps
  for the thing he asked for.
- **Every rerun row always listed**: no new `typedOnly` property, but fourteen rows in the empty
  list.
- **A query-string trigger** (`/metadata?run=glossary`) so the bar only ever navigates: a URL that
  spends when opened is a link anyone can make a reader click. Refused.

## Questions for Greg (Awaiting)

1. **One run on the stronger model, without switching the whole article.** Today *more powerful
   AI* is a switch per article (one article from the allowance, once). Do you want a per-run
   choice — e.g. *Glossary › Run again on Opus* — and if so, what does one such run cost a reader:
   free (like a re-run), a fraction of an article, or only available once the switch is on?
2. **Letting a model act.** The vision doc's proposal is: the interface model may only *navigate*
   on its own; anything that writes or spends is shown as the command it would run, and the reader
   presses Enter. Is that the line you want, before anyone builds it?

## Done looks like

- Stage 1/2: tests red-first for the row lists, the `typedOnly` filter, the step→place record, the
  refusal line, the `find` parse; `npm test`, `npm run typecheck` green; browser check at desktop
  and 390 px (bar open on a typed `rerun`, an accepted run landing in the band, a refused one, a
  section reveal, `find predictive`). reading-view-overview.md § The command bar and url-state.md
  updated. GPT Sol code review per stage.
- Stage 3: the doc, linked from its entry point, `tests/doc-links.test.ts` green.

## Progress

- 2026-10-02: plan written.
