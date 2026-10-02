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

That decides the order of the work. **Every row added to the bar now is one more thing the model
can do later.** And the bar is useful without the model: instant, needing no model to choose, and free except where a row says `generates`. Since
2026-10-02 the bar re-runs any mode, opens Metadata's sections, archives and exports
([261002c](../plans/261002c-commands-do-more-and-an-interface-model-vision.md)). It also takes one
argument: `find <words>`, the deterministic ancestor of *"do they talk about X?"*

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
2. **Its confidence looks usable, but no threshold is measured yet.** Each of its four mistakes
   came with a confidence of 0.70 or less. At 0.8, every answer Jev kept was right and a quarter went
   to the fallback. But four errors cannot pin down a threshold, and 0.8 was read off this table.
3. **It does not take an argument.** `find <words>` needs the fallback, or a deterministic parse
   (the bar already has one for its verbs), or a second question to Jev.
4. **The fallback is not automatically safer.** It overruled Jev's correct *"none"* for *"delete this
   article"* with Archive, and it once named a command that does not exist. Hence the dispatcher and
   the gate above: an id checked against the real list, a *none* respected, and confirmation in code.
5. **The gateway reaches Jev now.** Every paid call goes through `src/ai-call.ts`
   ([ai-gateway.md](ai-gateway.md)), and since 2026-10-02 that includes the decisions endpoint:
   `openRouterDecisions`, built for quick search ([261002e](../plans/261002e-quick-search-v1.md), the same day). The eval reached Jev
   through its own declared bypass (`command-pick-jev`), written before that seam landed; a
   production interface model would call the seam. The endpoint is still alpha.

**The fallback** is a capable chat model on the existing wire, through the same tier rules as
everything else ([setup-dev.md](setup-dev.md) says which model each job uses). It is asked the same
question with the same command list. It is also allowed to answer *"I don't know"*, and the
reader then sees the bar's ordinary filtered list instead of a guess.

## Knowing how Spideryarn works

Three sources, from most to least curated:

1. **The Help page** (`/help`, for readers, being written as fb85). It is the first thing to search
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

This is the part that is a **defence** ([security-map.md](security-map.md)). It is written here for
Greg to decide, not built.

Chat has held one line since 2026-08-26: *nothing chat can call writes a file, deletes anything, or
spends money* ([chat-tools.md § Security](chat-tools.md#security-a-tool-result-is-data-and-one-of-them-is-a-strangers)).
The reason is concrete: an article, a fetched page or a link's text can carry instructions, and
fencing them is a mitigation, not a boundary. An interface model that can *act* crosses that line.
The proposal:

| What the command does | Examples | Run by the model's choice? |
|---|---|---|
| Moves the reader, opens a view, reads | open Glossary, find "X", go to Export | **Yes, at once.** Undone by Back |
| Writes the reader's own data, reversibly | archive, add a tag (no tags yet), bookmark | **Proposed**: shown as the row it would run; Enter runs it |
| Spends a model call or the allowance | run again, high-powered AI, a meaning search | **Proposed**, with the `generates` marker the bar already shows |
| Destroys or publishes | delete, make public | **Never** from a sentence. Only from its own page and its own confirmation |

Three rules make that table safe rather than merely polite:

- **The interface model never sees the article.** Its input is the reader's own words, the command
  list, where they are standing, and the Help. So a hostile article has no path to choosing a
  command. That is the whole difference from the main Chat (below).
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
  presses: the same row, rendered in the transcript, run by a click and never by the model. The
  first one is the one chat-tools.md § Not built already recommends: *plant a question on a
  section*.
- **The never row stays never.**

The order this suggests: the bar's interface model first (no article in context, so the line is easy
to hold), and chat's command buttons second, reusing its command list and its proposal rendering.

## Where we are

- **Built** (2026-10-02, [261002c](../plans/261002c-commands-do-more-and-an-interface-model-vision.md)):
  the bar's Metadata commands, re-run per mode, sections by name, archive, export, and `find <words>`.
- **Measured**: Jev choosing a command, once, on a hand-made set (§ Jev first).
- **Not built**: the interface model, Help search, chat command buttons, tags.

## Questions for Greg

1. **The line** (§ The line). Is *navigate freely, propose anything that writes or spends, never
   destroy or publish from a sentence* the right one?
2. **One run on the stronger model.** Today *more powerful AI* is a switch per article. Should the
   bar also offer *Glossary › Run again on Opus* for one run, and what would that cost a reader?
3. **Speech.** Dictation into the bar's box would be the three lines [dictation.md](dictation.md)
   says any box needs. Do you want that now, with the bar as it is, before any model?
4. **Tags.** *"add a tag of X"* needs tags to exist: on the shelf, per article, the reader's own. Is
   that a feature you want regardless of commands?
