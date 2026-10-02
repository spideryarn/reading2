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

**Revised after GPT Sol's plan review** (F1–F10,
[261002c-commands-do-more-plan-review-sol.md](261002c-commands-do-more-plan-review-sol.md)); every
finding was checked against the code and accepted. The first draft is commit 23c084574; what
changed and why is under § Review ledger.

### Stage A — re-run any mode from the bar, and `find <words>`

1. **A leaf registry of re-run commands**, `src/web/rerun-commands.ts`, client-safe and importing
   neither Metadata nor the Dock (Metadata imports the Dock, the Dock imports the bar — F8). It
   holds, per step of `METADATA_RERUN_STEPS`, a total `Record`: the label (`RERUN_LABEL` moves here
   from Metadata.tsx) and the static cost note (`RERUN_COST_NOTE` likewise). Metadata keeps only the
   glossary's dynamic override. One source for the label on Metadata's row and on the bar's.
2. **Action rows can be asynchronous and can fail visibly** (F2). `action.run` today returns `void`
   and the bar closes regardless. It becomes a discriminated outcome — close, or stay open with a
   reader-facing sentence — and the bar awaits it, shows a pending state, ignores a second Enter or
   click while one is in flight, and closes only on success. The existing synchronous actions
   (Comments, Feedback) return "close".
3. **One row per re-run step**, `<label> › Run again`, `generates: true`, offered for **every**
   step whatever the experimental switch says (F7: Metadata decided this already, rerun-steps.ts —
   the switch hides clutter, not the ability to regenerate). **Shown only when the query is
   non-empty** (`typedOnly` on `CommandWords`), so the empty list does not grow by fourteen. Words
   (F3 — the matcher compares the whole query with one label or alias; it does not combine tokens):
   compound aliases generated per step — `rerun <x>`, `re-run <x>`, `regenerate <x>`, `redo <x>`,
   `refresh <x>`, `<x> again`, `run <x> again` for each name of the step (its label, and its mode's
   name and aliases where it has one). Plain `glossary` must still put the Glossary mode first.
4. **Enter starts the forced run** — `POST /api/jobs { slug, steps, force: [step] }`, the call
   `useStepJob.start` makes — and awaits it. A refusal keeps the bar open with `lastFailure()` read
   at once, before the post-action poll can clear it. **On success the reader is taken to
   Metadata's AI processing section**, revealed and flashed, where that step's `RerunRow`
   (watches-queue, kept mounted) shows the run. **Never to the mode itself** (F1): a mode opened
   with no artefact arms generate-on-open, the server does not dedupe a forced job against an
   unforced one (`force` is part of the work key, src/store/jobs.ts), and that would be a second
   paid run. A test pins one POST. Landing in the band is the better experience and is deferred
   until there is a seam that tells auto-run "this job satisfies you". On the Metadata page itself
   the row starts the run and reveals the section without navigating. This needs the section
   address, so `?section=` (below) is built in this stage.
5. **`?section=<id>` on the Metadata page**: a validated `replace` param, classified
   `NEVER_REMEMBERED` in last-view.ts (F5 — otherwise a URL holding only it reads as bare and the
   remembered view is appended over it), read on arrival, **consumed only after `reveal()`
   succeeds**, and retried while the target may still be mounting (F4). One row in url-state.md.
6. **`find <words>`** (also `search`, `search for`, `does it mention`, `do they talk about`, a
   trailing `?` dropped): a row *Find "<words>" in this article* opening Search in words mode,
   `?mode=search&match=words&find=<words>`. Free and instant. Only when the query starts with one of
   those verbs, so `No command matches.` stays the answer to a query naming nothing (260906h's
   decision 3 was about a *guessed* fallback; here the reader typed the verb). A pure parse in
   command-match.ts with its own tests.

### Stage B — Metadata's sections, Archive, Export

1. **Section rows**: *High-powered AI* (→ AI processing, where the switch is first), *AI
   processing*, *Access & sharing* (aliases `share`, `public`, `publish`, `private`). Not *Export* —
   the direct action below owns that word (F4). Not *What it cost* — the bar has no admin check.
2. **Archive / Unarchive this article**, through `useArchive`, plumbed from `OwnedArticle` to the
   Dock and the bar. **Absent while `archive.at` is unknown** or on a fixture (F6 — the
   controller's own rule: either label could be false), disabled while busy, and the label after
   the press read from the controller, not assumed. The label moves with the state: *Archive* on an
   archived article would do the opposite of its name (the fixed-label rule is Comments').
   `generates: false`.
3. **Export this article** — downloads the article's ZIP export (F9) via `download()` extracted
   from `ExportSection` into a shared helper both call, keeping its busy guard, anchor flow, URL
   revocation and server error. Aliases `download`, `zip`, `backup`. A failure keeps the bar open
   with the sentence. `generates: false`.

**Deliberately not**: Delete (irreversible; a keyboard Enter one row away is the wrong door),
*Start this article again* (experimental and the widest press on the page), toggling High-powered
AI from the bar (it charges an article; the switch's own copy is where that price is stated, so
the row goes there instead).

**Greg's own example, "reprocess a mode with more powerful AI"**, is two commands after this —
*High-powered AI* (switch it on, priced as today) then *Glossary › Run again*. Doing it in one
(Opus for *this run only*) is a new billing shape, so it is a question for Greg, below.

### Stage C — the vision doc

[chat-llm-help-commands-vision.md](../project/chat-llm-help-commands-vision.md), under
reading-view-overview.md beside interface-vision.md. Sol's F10 shapes its middle: the model needs
a **serialisable command descriptor** (stable id, trusted words, argument schema, risk class,
availability), a **trusted dispatcher** that resolves a validated id to today's closure, and a
**confirmation gate enforced in code** for anything that writes or spends — not the React array
as it stands.

### Stage D (if there is room) — measure Jev choosing a command

A small paid eval, not production code: ~40 typed phrases (Greg's examples, paraphrases, a few
with no right answer) against a serialised command catalogue, Jev's choice and confidence vs a
capable chat model's. Answers whether Jev is right often enough and whether its confidence is a
usable "unsure" signal. A few cents, its own declared bypass beside `shelf-topics-jev`, results in
`docs/investigations/`.

## Review ledger

| ID | Sev | Finding | Taken |
|---|---|---|---|
| F1 | P1 | Opening the mode after a forced POST can enqueue a second paid unforced run; no server dedupe | Land in Metadata › AI processing; test one POST |
| F2 | P1 | `action.run` is `void`, the bar always closes; `useJobs.error` is cleared by the next poll | Async discriminated outcome; read `lastFailure()` at once |
| F3 | P1 | "rerun glossary" matches no row — the matcher does not combine tokens | Compound aliases per step |
| F4 | P1 | Export twice (section + action); a section may not be mounted yet | One direct Export; consume `?section=` only after reveal succeeds |
| F5 | P1 | `section` absent from last-view classification | `NEVER_REMEMBERED`, tested |
| F6 | P1 | Archive's unknown state | Absent while unknown; label from the controller |
| F7 | P1 | The plan contradicted itself on the experimental switch | Every step, as Metadata |
| F8 | P2 | Labels private to Metadata; importing them closes a cycle | Leaf `rerun-commands.ts` |
| F9 | P3 | Export is a ZIP | Wording |
| F10 | P2 | "Registry = tool list" needs descriptors, a dispatcher and a gate | Into the vision doc |

## The simpler options passed over

- **Rows that link to Metadata only** (no in-bar re-run): one fewer `POST` path, but the reader
  would land on another page and press again — two steps for the thing he asked for. (After F1 the
  run still lands there, but already started.)
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

- Stages A/B: tests red-first for the row lists, the `typedOnly` filter, the compound aliases
  (`rerun glossary` finds the row, `glossary` still finds the mode first), one POST per press, the
  refusal line, `?section=` classification and late reveal, the `find` parse, Archive's unknown
  state; `npm test`, `npm run typecheck` green; browser check at desktop and 390 px (a typed
  `rerun glossary`, an accepted run landing in AI processing, a section reveal, `find predictive`,
  archive and unarchive). reading-view-overview.md § The command bar and url-state.md updated. GPT
  Sol code review per stage.
- Stage C: the doc, linked from its entry point, `tests/doc-links.test.ts` green.

## Progress

- 2026-10-02: plan written; Sol's plan review (F1–F10) folded in, stages re-cut A–D.
