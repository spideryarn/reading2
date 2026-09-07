# Spideryarn

AI-assisted reading that **augments** rather than replaces reading. Live at
[www.spideryarn.com](https://www.spideryarn.com); this is the code behind it.

> it augments human cognition, but it doesn't replace it … help the user get what they need from
> it, help them read efficiently, but deeply, help them internalize and interrogate.
>
> — Greg, 2026-08-24

Everything in this repo is downstream of that sentence.

## What it is

A companion, not a replacement: it highlights, annotates, orients and explains, but keeps you in
the text itself. Or, as the front page puts it, it's like reading a dog-eared copy of a book where a
clever friend has highlighted the best bits and scribbled in the margins to help with the difficult
bits — rather than reading the Reader's Digest version.

It is for people who read difficult material and think professionally: scientists, researchers,
academics, editors, anyone who opens a long, deep, important article — a paper, a philosophy essay,
a policy report — that they want to understand, digest, internalise, critique and remember.

## The problem, and the bet

Nearly every AI reading tool makes the same move: compression. Paste an article, get bullet points,
done. That is genuinely useful for triage and genuinely corrosive for understanding: a fluent
impression of the piece and none of its texture, no argument you could reconstruct, no sentence you
could quote. The summary replaced the reading instead of supporting it.

> you can go to the gym or you can buy a forklift truck to lift the weights. But if you buy the
> forklift truck that lifts the weights, then you atrophy. … our goal is to make things easier where
> we can, but not too easy.
>
> — Greg, [dictated notes](docs/research/260902k-greg-notes-the-edge-between-ease-and-difficulty.md), 2026-09

So the bet is to make deep reading *cheaper*, not optional. Scan the landscape quickly. Descend on
demand into the actual prose, at the point you care about. Stay oriented at whatever altitude you
are flying. Ask questions at the moment of confusion, in place. Come away with something retained.

Three commitments separate this from the summariser it superficially resembles
([vision.md § Principles](docs/project/vision.md#principles)):

- **The text is the destination, not the source material.** Every generated line is a door into the
  prose, not a wall in front of it. We never silently rewrite the author's words: the full text is
  always there beside whatever the model produced.
- **When the AI says what the article says, it cites the passage.** One press and you are reading
  the author, not the model. Nothing it asserts is left unanchored.
- **It is a reading tool, not a writing or chat tool.** The article never leaves the screen. And
  when a design call is genuinely close, the tiebreak is: which option will best help the reader
  form their own rich, updated internal representation — digest, understand, learn, notice,
  integrate, critique?

And deliberately not, ever ([vision.md § Anti-goals](docs/project/vision.md#anti-goals)): "read
this in 2 minutes"; streaks, nudges, anything optimising for time in the app; confident generated
claims with no path back to the source.

## What it does today

This started as an experiment and is a real product now, with accounts, billing, and paying readers
since 2026-09-03. The readership is small and knows it is a beta, so we still optimise for how fast
we can move.

The thing the app is *for* is **granularity zoom**
([granularity-zoom.md](docs/project/granularity-zoom.md)): the article at several levels of detail
at once, down the page for position and across for how much detail. The leftmost level is a
sentence for the whole piece; the rightmost is always the author's verbatim prose; move sideways and
the text expands or contracts without you losing your place. Everything else lives in a band beside
the prose that the modes take turns in
([reading-view-overview.md](docs/project/reading-view-overview.md) is the map). Fourteen modes are
built; the ones marked *experimental* are behind a switch on `/profile`
([experimental-features.md](docs/project/experimental-features.md)) because they are not yet good
enough to show a stranger by default.

**Finding your way around the piece**

- **Plain** — the prose and nothing else, the default. Every other mode is a step away from it and a
  step back.
- **Hierarchy** — granularity zoom itself, one column per level of detail beside the text.
- **Outline** — a constantly evolving table of contents, detailed where you are and sparse
  elsewhere, a semantic fisheye lens ([column-context.md](docs/project/column-context.md)).
- **Summary** — a sentence on every part of the piece, and every section of every part, as deep as
  you ask ([summaries.md](docs/project/summaries.md)).
- **Diagram** — the shape of the piece as a picture, with where you are marked on it
  ([diagram.md](docs/project/diagram.md)); one picture by default, four more experimental.
- **Search by meaning** — a word, a phrase, or a description of what you are after; the relevant
  passages are marked in the prose, each hit saying how sure it is
  ([search.md](docs/project/search.md)).

**Understanding it**

- **Glossary** — the terms this piece uses in a non-obvious way, defined from the piece itself and
  underlined wherever they occur ([glossary.md](docs/project/glossary.md)).
- **Ideas** — the propositions the piece assumes you already hold, and the ones it introduces
  ([ideas.md](docs/project/ideas.md)).
- **Quotes** *(experimental)* — the most central, striking lines, in the author's own words
  ([quotes.md](docs/project/quotes.md)).
- **Timeline** *(experimental)* — when the piece says things happened, showing the uncertainty
  rather than hiding it ([timeline.md](docs/project/timeline.md)).
- **Links** — hover the author's own hyperlinks and see something about the destination before you
  leave ([links.md](docs/project/links.md)).
- **Debate** *(experimental)* — what the rest of the web says about this piece; the one mode whose
  content is not drawn from the article
  ([the plan](docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md)).

**Asking**

- **Select a sentence** — that bookmarks it; optionally add a note, or ask for an explanation, which
  streams in while the article stays on screen ([comments.md](docs/project/comments.md)).
- **Chat** — ask a longer question; whenever the answer says what the article says, it links to the
  passage. It does not summarise the article unless you ask it to
  ([chat-tools.md](docs/project/chat-tools.md)). You can also **talk to it out loud** and switch
  between speaking and typing ([live-conversation.md](docs/project/live-conversation.md)).
- **Referee** *(experimental)* — for peer reviewers: your own criteria checked against the paper
  with every matching passage marked, and a mirror that rereads your draft comments. It helps you
  read the paper without reading it for you ([referee-mode.md](docs/project/referee-mode.md)).

**Keeping it**

- **Remember** *(experimental)* — say what you took from the piece and find out where it holds and
  where it comes apart ([remember-mode.md](docs/project/remember-mode.md)); or the other way round,
  a **Quiz** in which the article asks and you answer, marked against the text rather than an answer
  key ([quiz.md](docs/project/quiz.md)).
- **The library** — every article you have added, one click from where you left off
  ([library.md](docs/project/library.md)). Make one public and strangers can read it at
  `/read/public` ([public-shelf.md](docs/project/public-shelf.md)); your notes, chats and searches
  stay yours.
- **It knows who is reading** — say once who you are and what you know, and for any article why you
  are reading it, and the notes are written for you
  ([reader-profile.md](docs/project/reader-profile.md)).
- **It's the reader's data** — one button exports everything Spideryarn holds about an article as
  plain files ([export.md](docs/project/export.md)); what we do with a reader's data is in
  [privacy.md](docs/project/privacy.md).

Chat deserves a flag, because "a chatbot with the article stuffed in the context window" is a named
anti-goal here. It was built anyway, at Greg's request, and the argument that what was built is not
the anti-goal — along with an honest account of where that argument is weakest — is in
[260826a-chat-mode.md § Say the awkward thing first](docs/plans/260826a-chat-mode.md#say-the-awkward-thing-first).

## Pricing

Reading is never charged for; only adding an article spends a slot. The free tier is three articles,
for life, with no card required; **Reader** is $10 a month (£8 · €9) for twenty a month, and
**Researcher** $50 a month (£40 · €45) for a hundred and fifty. An article you make public costs half
a slot. The live figures are `src/web/PlanCards.tsx` § `WEBSITE_PLANS` and `/pricing`; what a slot
is and why it is priced this way is [billing.md](docs/project/billing.md).

## Running it yourself

You need **Node 26**, **Docker running**, and an **OpenRouter API key** — nothing else, no accounts
on anybody's dashboard. The commands, in the order that works, with a "did it work?" check after
each and what the failures mean, are in
[setup-dev.md § Quickstart](docs/project/setup-dev.md#quickstart); the rest of that file has the
per-stage pipeline commands, which model does which job, and what each secret is for.

## How it works

**[docs/tutorials/architecture.html](docs/tutorials/architecture.html)** — *The shape of Spideryarn*
— explains the whole system to somebody who knows the product and has never opened the code: how an
article is fetched, cut into blocks and retold at several lengths, why every paragraph gets a
permanent id so your notes survive a re-import, and why the pipeline builds a new revision beside the
live one rather than editing in place. Open it in a browser. Three more go a level deeper:
[import-pipeline-and-database.html](docs/tutorials/import-pipeline-and-database.html),
[revisions-and-the-schema.html](docs/tutorials/revisions-and-the-schema.html), and
[260906a-deployment-and-infrastructure.html](docs/tutorials/260906a-deployment-and-infrastructure.html)
— *Shipping Spideryarn* — which follows one commit all the way to the live site and is the place to
start if you want to know what it takes to run this thing.

For engineers, [architecture.md](docs/project/architecture.md) is the reference, and
[block-ids.md](docs/project/block-ids.md) is the one contract everything else depends on — read it
before touching anything that resolves an id.

## Where the real documentation is

**This file is a signpost, and so is [AGENTS.md](AGENTS.md)** (`CLAUDE.md` is the same file).
Everything real lives in `docs/project/`, and AGENTS.md has the full table — seven entry-point
docs, one line per doc beneath each, saying what is in it. Start there. The handful worth naming
here:

| Doc | What's in it |
|---|---|
| [vision.md](docs/project/vision.md) | what we're trying to do, the principles, and what we're deliberately *not* doing |
| [granularity-zoom.md](docs/project/granularity-zoom.md) | the core feature: the tree, generation, interaction, failure modes |
| [reading-view-overview.md](docs/project/reading-view-overview.md) | everything the reader sees, and the fourteen modes |
| [setup-dev.md](docs/project/setup-dev.md) | install, dev, every pipeline command, and which model each job uses |
| [original-version/](docs/project/original-version/overview.md) | the larger app this came from — a library to consult, not a backlog to import |

`docs/plans/` holds the reasoning behind work being done or just done; `docs/postmortems/` one file
per bug worth understanding; `docs/research/` the options weighed behind a decision. None of them
are indexed — list the folder and read the file names.

## Contributing

Contributions are welcome, and the most useful one is not code.

**The easiest and best way to help is the Feedback button**, top-right of the reading view once you
are signed in. A really well-described bug report or feature request — what you were doing, what you
expected, what happened instead, and *why it mattered to your reading* — **feeds directly into the
product-building pipeline**. Reports are stored, triaged, and worked through in batches, with a note
kept under [`docs/user-feedback/`](docs/user-feedback/) and the reasoning written down
([feedback-reports.md](docs/project/feedback-reports.md) is the process;
[260904b](docs/plans/260904b-address-user-feedback-reports-batch.md) is what one batch looks like).
Nothing here has produced more change per minute spent than a precisely-described report.

**And if you want to write code, I'd love to work with you.** Get in touch first at
**hello@spideryarn.com** — say what you want to build and we'll work out whether it fits, which
saves you building something the vision doc rules out
([vision.md § Anti-goals](docs/project/vision.md#anti-goals) is worth a read either way).
[setup-dev.md](docs/project/setup-dev.md) takes an empty checkout to a running app, and
[the architecture tutorial](docs/tutorials/architecture.html) explains how the whole thing works.

**One unusual condition on pull requests.** If you built it with an AI agent — and most of this repo
was — include the prompts and the conversation alongside the diff. Greg, 2026-09-06:

> If someone wants to submit a pull request, they have to also include the prompts/conversation with
> their agents that helped them build it, so I can understand their intent/approach.

Paste them into the PR description, or add them as a file under `docs/plans/`. This is not a
formality: in a codebase where the code is cheap and the *intent* is the scarce thing, the
conversation is the part that says what you were trying to do and what you decided not to do — which
is exactly what a reviewer needs and a diff never shows. It is the same reason every piece of work
here keeps a plan doc.

[CONTRIBUTING.md](CONTRIBUTING.md) is the short version of this section, plus one thing in the tests
that looks like a leaked key and is not.

## Working here

Read [AGENTS.md](AGENTS.md) — it's the working agreement, for people as much as for agents. The
short version: several sessions work this tree at once, so stay inside your stage, never run a git
command that throws work away, and commit your own files by name
([version-control.md](docs/project/version-control.md) has the recipe and why it has the shape it
does).

Licence: [MIT](LICENSE), covering this project's own code and documentation and not the third-party
articles kept as test inputs under `evals/` and `tests/fixtures/`.
