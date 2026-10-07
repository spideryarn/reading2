# Vision: say what you want, and the app does it

Up: [reading-view-overview.md](reading-view-overview.md)

> **Not decided.** A direction of travel written up at Greg's request on 2026-10-01, the same kind
> of doc as [interface-vision.md](interface-vision.md). Nothing here is built except what
> § Where we are says. When a piece of this is decided, it moves into the doc that owns it and comes
> out of here.

## What Greg asked for

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
> would be neat. Yes, that should definitely be the aspiration.
>
> — Greg, 2026-10-01, SPIDERYARN-READING2-8D (the note:
> [261001_1124-commands-do-more-and-an-interface-model-vision.md](../user-feedback/261001_1124-commands-do-more-and-an-interface-model-vision.md);
> the plan: [261002c](../plans/261002c-commands-do-more-and-an-interface-model-vision.md))

## The idea in one picture

```
  the reader types or says:  "do they talk about free energy?"
                                   │
                                   ▼
   ┌──────────────────────── the interface model ────────────────────────┐
   │  knows: the command list (names, words, what each does, whether it   │
   │         writes or spends), where the reader is standing, the Help     │
   │  never sees: the article's text                                      │
   │  answers: one command + its argument + how sure it is                 │
   └──────────────┬───────────────────────────────────┬───────────────────┘
          sure enough                           not sure
                  │                                   │
                  ▼                                   ▼
      Jev's pick (≈0.6 s)                  a capable model picks,
                                           or says it doesn't know
                  │
                  ▼
   ┌──── the same command the bar already runs ────┐
   │  navigate / open / find  →  runs at once       │
   │  writes or spends        →  shown, Enter runs  │
   └────────────────────────────────────────────────┘
```

**Two models with two jobs.** The *content model* reads the article and writes about it: chat,
summaries, the glossary. The *interface model* reads only what the reader asked and what the app
can do, and turns one into the other. In practice the same model may do both, prompted
differently. They are kept apart in this doc because they are trusted differently (§ The line).

## The command list is the tool list

**Every command the bar has is already a typed, named action**: its words, a description, whether
it generates, and what pressing it does (`src/web/command-match.ts` § `Command`). That is nearly
what a model needs as a tool definition. So the interface model needs no second catalogue. It
chooses from the bar's rows, and it can never do something the bar cannot.

**Nearly, not exactly** (GPT Sol, reviewing the plan). Today a row is built inside React: an action
row carries a closure, and a mode row carries nothing runnable at all. That array cannot be sent to
a model, and an eval cannot reuse it faithfully. Three pieces sit between the bar and a model:

1. **A serialisable descriptor** for each command: a stable id, the trusted words, an argument
   schema (`find` takes words; most take nothing), a risk class (§ The line), and whether it is
   available where the reader is standing.
2. **A trusted dispatcher** in the client that turns a validated id and argument into today's
   closure or navigation. The model names an id. It never names code.
3. **A confirmation gate enforced in code**, not in a prompt. Anything whose risk class writes or
   spends goes through it, whoever asked.

**All three exist since 2026-10-03, for the commands that take an argument**
([261003f](../plans/261003f-commands-take-arguments-tags-dictation-and-chat-tools.md)). The
descriptor is `CommandProposal` with its `RISK` class and its stored token; the dispatcher is
`runProposal`, over the runners the page supplies, where a missing runner is "not available here"
(both in [`command-proposal.ts`](../../src/web/command-proposal.ts)); and the gate is the press —
a typed row's Enter in the bar, a button in a chat answer. Seven ids: jump to the first X, find,
open or ask for a glossary term, add or remove a tag, bookmark.

**And for every other row, since the same day**
([261003k](../plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md)).
The bar's other rows — modes, pages, re-runs, archive — are still closures in React, so what a model
is shown is not the row but its **key and our words for it**: `pickKey`
([`command-match.ts`](../../src/web/command-match.ts)) names a row by id and label, and
`src/command-pick-catalogue.generated.json` holds the description and nicknames for every key the
bar can offer, written from the bar's own functions by `tests/command-pick-catalogue.test.ts`, which
fails when the file falls behind. The browser sends keys only; the words the model reads are the
server's. The dispatcher is the bar itself, which looks the answered key up in the rows it has at
that moment, and the gate is `onlyMovesTheReader`
([`CommandBar.tsx`](../../src/web/CommandBar.tsx)), which asks each action row to declare
`opensOnly`.

That decides the order of the work. **Every row added to the bar now is one more thing the model
can do later.** And the bar is useful without the model: instant, needing no model to choose, and free except where a row says `generates`. Since
2026-10-02 the bar re-runs any mode, opens Metadata's sections, archives and exports
([261002c](../plans/261002c-commands-do-more-and-an-interface-model-vision.md)). It also takes
arguments, each behind a verb the reader types: `find <words>`, the deterministic ancestor of *"do
they talk about X?"*, and since 2026-10-03 the jump, the glossary look-up and the tags
([reading-view-overview.md § The command bar](reading-view-overview.md#the-command-bar)).

What the model adds on top of the bar:

- **Paraphrase.** *"redo the glossary with the good model"* has no row whose words match it.
- **Arguments in free text.** *"is consciousness mentioned anywhere"* is `find consciousness`.
- **Composition, later.** *"switch on high-powered AI and redo the summary"* is two commands, so it
  is a proposal of two, confirmed together.
- **Questions about the app**, answered from the Help: *"what does the dotted underline mean?"*

## Jev first, a capable model when unsure

Greg named the shape: Jev for speed, then a stronger model when Jev is unsure. What we know about
Jev: it is `typesafe/jev-1.13`, a *decisions* model on OpenRouter's alpha
`POST /api/alpha/decisions`. It costs about 0.6 s and $0.0005 a call
([261002e](../investigations/261002e-shelf-topics-which-model-picks-the-pills.md)). It returns
`probabilities` over named options and a `confidence`, which is close to the shape this needs: *"of
these 40 commands, which one, and how sure?"*

**Measured once, on 2026-10-02** ([261002c-jev-picks-a-command.md](../investigations/261002c-jev-picks-a-command.md)):
72 requests written and labelled by us, against a 51-row command list copied by hand from the bar, with the rows this plan was about to add.

| | Jev | Sonnet 5 (the fallback's tier) |
|---|---|---|
| right, all 72 | 68 (94%) | 70 (97%) |
| right, the 26 harder ones | 22 (85%) | 25 (96%) |
| pulls the words out of *"do they talk about X?"* | cannot: it only picks an option | 7 of 7 |
| median latency | 0.3 s | 2.1 s |
| cost a call | $0.0001 | $0.006 |

What that answers, and what it does not:

1. **Jev is right often enough to go first.** It is five to ten times faster and sixty times
   cheaper than the fallback.
2. **Its confidence looked usable, and 0.8 was read off this table.** Each of its four mistakes
   came with a confidence of 0.70 or less. Four errors cannot pin down a threshold; the second
   measurement (below) moved it to 0.95.
3. **It does not take an argument.** `find <words>` needs the fallback, or a deterministic parse
   (the bar already has one for its verbs), or a second question to Jev.
4. **The fallback is not automatically safer.** It overruled Jev's correct *"none"* for *"delete this
   article"* with Archive, and it once named a command that does not exist. Hence the dispatcher and
   the gate above: an id checked against the real list, a *none* respected, and confirmation in code.
5. **The gateway reaches Jev now.** Every paid call goes through `src/ai-call.ts`
   ([ai-gateway.md](ai-gateway.md)), and since 2026-10-02 that includes the decisions endpoint:
   `openRouterDecisions`, built for quick search ([261002e](../plans/261002e-quick-search-v1.md), the same day). The eval reached Jev
   through its own declared bypass (`command-pick-jev`), written before that seam landed; the
   bar's interface model calls the seam. The endpoint is still alpha.

**Measured again on 2026-10-03, against the bar's real rows**
([261003e](../investigations/261003e-which-fast-model-turns-a-sentence-into-a-command-and-its-argument.md)):
192 requests, 40 of them written blind, scored on the 186 the bar's own matching cannot answer.
What the bar is built on:

- **Jev picks; GPT Luna copies the words out, only when the pick takes words.** That pair got the
  whole outcome right on 175 of 186 (94%), in about 0.3 s when no words are needed and a p90 of
  1.2 s over all. Jev's own attempt at the words failed, and Luna alone was 96% right but 1.4 s
  on every request.
- **0.95 is the cut for running at once** (`RUN_AT_ONCE`, [`src/command-pick.ts`](../../src/command-pick.ts)):
  none of the 35 picks at or above it was wrong. Five errors in all, so it is a starting point.
- **A model's confidence gates nothing that writes or spends.** Every model picked Archive for
  some request that should have been nothing, at up to 0.98.

**The capable-model tier was not built.** When Jev's first pick was wrong, the right row was in its
top three 11 times of 11. So below the cut the bar draws Jev's top three and the reader picks,
rather than waiting 2 s and paying sixty times as much for a second model to settle what the
reader settles by looking. Jev may answer *none*, and the bar then says it could not tell.

## Knowing how Spideryarn works

Three sources, from most to least curated:

1. **The Help page** (`/help`, for readers — [help-page.md](help-page.md)). It is the first thing to search
   because it is written for exactly this reader, and nothing in it is internal. It ships as TSX
   rather than Markdown, so the model needs either a text export of it at build time or a search
   over the rendered text.
2. **The project docs** (`docs/project/`). They are thorough, but written for agents and full of
   internals. As a source of *how a feature behaves* they are good. As text to quote to a reader
   they are wrong in voice and sometimes in audience: admin-only facts, cost figures that
   [cost-tracking.md](cost-tracking.md) says only the administrator sees. Whatever is exposed needs
   a filter, or a generated reader-facing digest.
3. **The code**, open source on GitHub. It is the last resort and the most expensive. It is useful
   for a question nobody wrote down.

The cheapest useful version: put the Help text in the interface model's prompt (prompt-cached,
[prompt-caching.md](prompt-caching.md)), with no search tool at all. A search tool is only worth
building once the Help outgrows a prompt.

## The line: what it may do without asking

This is the part that is a **defence** ([security-map.md](security-map.md)). Greg accepted it as the
starting rule on 2026-10-02 (§ Decided). It is built for the bar's argument rows, for chat's
buttons and for the bar's interface model (§ Where we are).

Chat has held one line since 2026-08-26: *nothing chat can call writes a file, deletes anything, or
spends money* ([chat-tools.md § Security](chat-tools.md#security-a-tool-result-is-data-and-one-of-them-is-a-strangers)).
The reason is concrete: an article, a fetched page or a link's text can carry instructions, and
fencing them is a mitigation, not a boundary. An interface model that can *act* crosses that line.
The proposal:

| What the command does | Examples | Run by the model's choice? |
|---|---|---|
| Moves the reader, opens a view, reads | open Glossary, find "X", go to Export | **Yes, at once.** Undone by Back |
| Writes the reader's own data, reversibly | archive, add a tag, bookmark | **Proposed**: shown as the row it would run; Enter runs it |
| Spends a model call or the allowance | run again, high-powered AI, a meaning search | **Proposed**, with the `generates` marker the bar already shows |
| Destroys or publishes | delete, make public | **Never** from a sentence. Only from its own page and its own confirmation |

Three rules make that table safe rather than merely polite:

- **The interface model never sees the article.** Its input is the reader's own words, the command
  list, where they are standing, and the Help. So a hostile article has no path to choosing a
  command. That is the whole difference from the main Chat (below). **This input list is the
  pick's** (a sentence, turned into one command). The bar's other call, the short list from why you
  are reading, does not see the article either, but it does see the reader's profile and reason for
  reading, and it writes words of its own: § Where we are, the 261005k entry.
- **A proposal is the bar's own row.** The reader confirms the same thing they would have pressed
  themselves, drawn the same way, rather than a model's description of it.
- **Its output is parsed, not trusted.** A command id outside the list, or an argument that fails
  the command's own validation, is *"I don't know"*.

## The aspiration: the main Chat does all of this

Greg: *"that should definitely be the aspiration."* Chat already runs a tool loop
([chat-tools.md](chat-tools.md)), so the mechanics are close. A command could be offered to chat as
a tool. The hard part is that **chat's context holds the article and fetched pages**, which are
exactly the untrusted text the line above keeps away from actions. So in chat:

- **Navigation and finding** can be tools today in all but name. `search_article_words` already is
  one, and *"show me"* could open the result.
- **Anything in the "proposed" rows** must come back as a button in the answer that the reader
  presses: the same row, rendered in the transcript, run by a click and never by the model.
  **Built 2026-10-03** for bookmark, tags, the glossary look-up, jump and find —
  [chat-tools.md § Command buttons](chat-tools.md#command-buttons-chat-proposes-the-reader-presses).
  Still to come is the one chat-tools.md § Not built recommends: *plant a question on a section*.
- **The never row stays never.**

The order this suggested was the bar's interface model first (no article in context, so the line is
easy to hold) and chat's command buttons second. It went the other way round: Greg asked for the
chat half directly (`spya-wh2xys`), and a button the reader presses holds the line without needing
the interface model.

## Where we are

- **Built** (2026-10-02, [261002c](../plans/261002c-commands-do-more-and-an-interface-model-vision.md)):
  the bar's Metadata commands, re-run per mode, sections by name, archive, export, and `find <words>`.
- **Measured**: Jev choosing a command, once, on a hand-made set (§ Jev first).
- **Built** (2026-10-03, [261003d](../plans/261003d-your-own-tags-on-articles-on-the-shelf-and-the-metadata-page.md)):
  tags themselves — [library.md § Your own tags](library.md#your-own-tags).
- **Built** (2026-10-03, [261003f](../plans/261003f-commands-take-arguments-tags-dictation-and-chat-tools.md)):
  the descriptor and the dispatcher (§ The command list is the tool list); the bar's argument
  commands, Greg's *"add a tag of X to this paper"* among them; the experimental switch as a row;
  dictation in the bar's box ([dictation.md](dictation.md)); and chat's command buttons
  ([chat-tools.md § Command buttons](chat-tools.md#command-buttons-chat-proposes-the-reader-presses)),
  with their eval
  ([261003b](../investigations/261003b-chat-proposes-commands-as-chips.md)).
- **Built** (2026-10-03, [261003k](../plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md)):
  **the interface model, for the bar.** A signed-in reader's sentence that matches no row is sent
  on Enter to `POST /api/command-pick` ([`src/command-pick-call.ts`](../../src/command-pick-call.ts)),
  with the keys of the rows the bar has. The model sees the sentence and our words for those rows,
  never the article. What the reader sees is in
  [reading-view-overview.md § The command bar](reading-view-overview.md#the-command-bar).
  **The typed verbs stay** (Greg had asked whether natural language subsumes them): they are
  instant and free, and they are what the model's answer lands on; a sentence is the way in when
  you did not know the verb.
  One departure from § The line's table: **`find` from a sentence is proposed, not run at once**,
  because the words a model pulled out carry no measured confidence.
- **Built** (2026-10-05, [261005k](../plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md)):
  **the bar proposes a short list from why you are reading.** A second call, not a wider pick:
  `POST /api/command-suggest/:slug` ([`src/command-suggest-call.ts`](../../src/command-suggest-call.ts)),
  made only when the owner presses the row that asks. **What this model sees is different from the
  pick's**: the reader's profile and their reason for reading the article, loaded by the server,
  and our words for the bar's modes. Not the article, and nothing the browser wrote. It answers
  with up to three searches, two modes and one question for chat, each drawn as a row of the bar's
  own that waits for its own press. It is the one place the profile becomes words that can leave
  the conversation, and
  [reader-profile.md § The command bar's suggestions](reader-profile.md#the-command-bars-suggestions-the-one-exception)
  says why that is allowed and what it does not promise.
- **Not built**: questions about the app answered from the Help; two commands from one sentence;
  the capable model when Jev is unsure (§ Jev first says what replaced it); the interface model
  in chat.

## Decided

Greg's answers, 2026-10-02, to the four questions this section used to ask:

1. **The line** (§ The line): *"Let's try those rules to start with and see how it goes."* Navigate
   freely, propose anything that writes or spends, and never destroy or publish from a sentence.
   That is the rule the first interface model is built to.
2. **One run on the stronger model:** *"maybe let's hold off on changes to this for now."* It stays
   two commands: High-powered AI, then Run again.
3. **Speech in the bar:** *"ok"*. Shipped 2026-10-03 (`fbwh2xys`, § Where we are).
4. **Tags:** *"we definitely do want to be able to add tags, but it can wait till tomorrow's
   session"* (`fbqmev0s`). Shipped 2026-10-03, and the tag command with them (§ Where we are).
