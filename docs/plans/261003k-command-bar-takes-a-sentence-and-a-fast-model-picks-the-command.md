# The command bar takes a sentence, and a fast model picks the command

Report: spya-t0dg9u (Overseer queue qi-3wb7cgda, session `fb-command-bar-nl`). From an admin (Greg),
so trusted input. It also carries part 3 of 3 of spya-thpsnd, which is **noted here and not built**
(§ Noted, not built).

> Already provided feedback that I would like the command bar eventually to be much richer. And
> indeed, it struck me that we could get rid of the quick search icon and just have that be
> something you could do from the command bar. So you could say, search for blah blah blah. I
> realize that's going to get complicated, but that's, I think, where we want to go. What I was
> going to suggest was that maybe if we used Jev, the type-safe, very quick classification model,
> which we've already got the API key for, maybe we could allow the user to provide natural language
> input. So I want to see what's changed on this site since yesterday, and it would know to pick the
> changelog, for example, or search for blah blah blah. Well, in that case, it would know that this
> is a search, and it should hand off. Maybe it has an option for this requires an LLM to interpret.
> It's not one of the options, or it's an option but it needs parameters or something. And then in
> that case, the command bar should have a little dictation voice icon next to it so that I can
> talk. And so let's start with an eval to see if Jev can do a good job of it. And if not, then
> fine, let's use something like DeepSeek or Luna. It's got to be something with quite a low
> latency. And yeah, run an eval and then try and At least get to a V1. In the past, we talked about
> the idea that there could be parameters, so search for X, and that it would be in the UI. I guess
> this idea of voice and natural language, I can't tell if we would also still want the parameters,
> or if the natural language kind of subsumes that idea because it's just more powerful. I guess, as
> always, do some research, do some evals, and maybe let's go with whatever you think is going to
> get us most of the value without too much complexity.
>
> — Greg, 2026-10-03 (spya-t0dg9u)

## What is already there

- **The bar's rows** (modes, sub-modes, pages, actions, *Run again*) match what you type against
  their names and nicknames, instantly and for free (`rankCommands`, src/web/command-match.ts).
- **Typed arguments** behind a verb: `find X`, `jump to first X`, `define X`, `tag X`, `untag X`
  (`parseArgumentQuery`, then `resolveArgument` → a `CommandProposal`, src/web/command-proposal.ts).
  Landed today in 261003f.
- **The microphone in the bar's box** — also 261003f. Greg's *"a little dictation voice icon next
  to it"* is done.
- **One measurement of Jev picking a command**
  ([261002c](../investigations/261002c-jev-picks-a-command.md)): 68 of 72 right at 0.3 s, against a
  hand-copied list of rows; it cannot pull an argument out of a sentence.
- **The line**, decided by Greg on 2026-10-02
  ([chat-llm-help-commands-vision.md § Decided](../project/chat-llm-help-commands-vision.md#decided)):
  navigate freely, **propose** anything that writes or spends, never destroy or publish from a
  sentence.

So what is missing is exactly one thing: **a sentence that names no row** — *"I want to see what's
changed on this site since yesterday"*, *"is consciousness mentioned anywhere"* — gets
`No command matches.`

## The design, in one picture

```
 reader types or dictates:  "I want to see what's changed since yesterday"
            │
            ▼
   the bar's own matching (instant, free)  ──── rows? ──► as today, nothing changes
            │ no row
            ▼
   "No command matches. Enter asks what you meant."
            │ Enter
            ▼
   POST /api/command-pick   { the sentence, the rows this bar has right now }
            │
            ▼   one fast model call (which model: Stage 1 decides)
   picks among those rows  +  the five argument commands  +  "none"
            │
   ┌────────┴───────────────┬──────────────────────────┐
   sure, and it only        not sure, or it writes     none
   moves the reader         or spends
   │                        │                          │
   runs at once             the row(s) are drawn,      "Couldn't tell what
   (Back undoes it)         Enter runs the one picked  you meant" + the list
```

Five decisions in that picture, each the simpler of two:

1. **The model is asked only when the bar's own matching finds nothing, and only on Enter.** Not on
   every keystroke and not on a pause. Passed over: asking after a pause in typing, which saves one
   key press and costs a debounce, races between answers and keystrokes, and a paid call for every
   half-typed word. A sentence almost never matches a row by accident (the match is "your whole
   query appears inside one name"), so *nothing matched* is a good enough sign that the reader
   wrote a sentence.
2. **The model's answer is one of the bar's existing rows, by id — never anything new.** The
   words the model reads for each row come from **one trusted list the server holds**, generated
   from the bar's real rows and checked by a test (F1). The browser sends only the keys of the rows
   it has right now (an id and its label, so *Archive* and *Put back* are different keys); a key
   the server does not know is dropped. The first draft had the browser send the words too, which
   was simpler and made the endpoint a classifier anybody signed in could point at their own
   options.
3. **An argument command is the same `CommandProposal` the verbs already make.** *"is consciousness
   mentioned anywhere"* comes back as `find` + `consciousness`, goes through `checked()` and
   `resolveArgument`, and is drawn as the row *Find “consciousness” in this article*. No second
   path to "what does this ask for".
4. **Not sure means showing the rows, not asking a bigger model.** Jev returns a probability for
   every option, so when it is unsure the bar draws its top few and the reader picks. That removes
   the "capable model when unsure" tier from v1 altogether: 2 s and sixty times the price, to
   settle something the reader settles by looking. A second model is used only if Stage 1 says the
   first cannot extract arguments.
5. **Parameters stay, and natural language does not replace them** (Greg's open question). The
   typed verbs are instant and free and are what the model's answer lands on; a sentence is the
   fallback for when you did not know the verb. One mechanism underneath, two ways in.

**The line, applied.** Only a pick of one **row** that the model is sure of, and that only moves
the reader, runs at once. Everything else is drawn and waits for a fresh press of Enter: any
**argument** answer (the words the model pulled out have no measured confidence — F2), anything
`RISK` calls `writes` or `spends`, any row carrying `generates`, and any pick below the cut. The
interface model never sees the article: its input is the sentence and the rows.

## Stage 1 — the eval (Greg: *"let's start with an eval"*)

The question is no longer "can Jev pick a row" (yes, 94%). It is **which arrangement gets a sentence
to a row *and its argument* fast enough to feel like the bar**. `evals/command-pick/` is extended,
not forked.

- **The list is the real one.** A pure function gives the bar's rows as `{id, label, aliases,
  description, generates}` (from `commandId` + `commandText`, which exist), and the eval calls it
  for an owner on an article with Experimental on. The hand-copied `catalogue.ts` goes. Plus the
  five argument kinds (`find`, `jump-first`, `glossary`, `tag-add`, `tag-remove`) and `none`.
- **The requests**: the 72 from before, relabelled against the real list (tags exist now), plus
  about 50 new: Greg's two from this report, argument sentences for each of the five kinds that the
  verb table does *not* already parse, dictated rambles, and more with no right answer. And a
  **blind set of about 40** written by a separate subagent that sees only the row names, so not
  every request was written by whoever wrote the prompt. Every request the bar's own matching
  already answers is marked, since production never sends those.
- **The arms**, each one call per request, median and p90 latency and cost recorded:

  | arm | what it is asked |
  |---|---|
  | Jev, pick | one `choice` over the rows + argument kinds + `none` (as 261002c) |
  | Jev, pick + argument | the same call with one yes/no question per word of the sentence: *is this word part of what to look for?* — a guess at getting the argument without a second model |
  | DeepSeek V4.1 Flash | JSON `{id, argument}` |
  | GPT Luna (the `quick` tier) | the same |
  | Haiku 4.5 | the same |
  | Jev pick, then the best small model for the argument only | computed from the saved answers plus an argument-only call |

- **What decides**: right pick; right argument (exact, after the cleaning the verbs already do);
  whether the right row is in Jev's top three when its first is wrong; p90 latency under about a
  second; nothing destructive picked for a *none*.
- Written up as `docs/investigations/261003e-which-fast-model-turns-a-sentence-into-a-command-and-its-argument.md`.

**Predeclared reading of the result** (F6), frozen before the blind set is read: compare
**complete** outcomes — right row, and for an argument command the right words after the
production check — on the requests the bar cannot answer itself. Floors: 85% right there, p90 at
most 1.2 s. Among arrangements that meet both, one call beats two when they are within 3 points;
otherwise the more accurate. The hybrid's latency and cost are the real sum of its two calls.
Results go in a fresh folder, so no answer from the 72-phrase run is reused (F7).

## Stage 2 — v1

**The trusted list** — `src/command-pick-catalogue.generated.json`: every `(id, label)` the bar
can offer, over the contexts it opens in (owner on an article, archived or not, Experimental on or
off; a visitor; Metadata; no article), each with its description, nicknames, `generates` and kind.
Generated from the real rows under vitest; a test regenerates it and fails if the file differs.

**Shared, pure** — `src/command-pick.ts` (no React, imported by server and browser):

```ts
interface PickKey { id: string; label: string }
type ArgumentKind = "find" | "jump-first" | "glossary" | "tag-add" | "tag-remove";
interface PickRequest { sentence: string; rows: PickKey[]; argumentKinds: ArgumentKind[] }
type PickAnswer =
  | { kind: "row"; key: PickKey; confidence: number; others: PickKey[] }
  | { kind: "argument"; argument: ArgumentKind; words: string }
  | { kind: "none" };
```

with the caps (sentence ≤ 300 characters, ≤ 200 keys), the body validator (exact shape, unknown
keys refused — `POST /api/transcribe`'s rule), the argument kinds' own descriptions, the question
builder, and `readPick`, which turns the model's raw answer into a `PickAnswer` and returns `none`
for a key that was not sent or an argument that is empty or not found in the sentence. **`words`
must appear in the sentence** (case-insensitively): the model extracts, it does not invent, and a
dictated *neuro science* stays as said.

**Server** — `src/command-pick-call.ts` and one row in `AUTH_ROUTES` (src/routes.ts):
`POST /api/command-pick`, `article: "none"`, signed-in by the gate every row gets. One job,
`command-pick`, registered where the survey found each job must be (`NonTaskAiJob`, `AI_JOB_WIRE`,
`NON_TASK_MODELS`, `AI_JOB_ROUTE`, `JOB_DISPOSITION` as interactive request work, and
`DecisionJob` or `ChatJob` + `CHAT_REASONING` depending on Stage 1). If Stage 1 picks Jev,
`openRouterDecisions` learns the `choice` question (a member of `DecisionQuestion` and a branch in
`readDecisions`, as its docblock says). A deadline of 5 s, aborted when the reader's request
closes. A second job, `command-pick-argument`, only if Stage 1 says a second model is needed.
The route-contract test gets its row and its two counts.

**No per-reader rate limit, and that is a decision, not an omission.** Dictation and quick search
have none; ai-gateway.md records why (the OpenRouter monthly cap is the backstop), and a new rate
bucket is a migration plus an edit to files on the security map, which an unattended run does not
make. What bounds a call instead: signed-in only, the caps above, one model call of about $0.0001,
options whose words are the server's own, and an answer that can only be a key the caller sent or
a substring of the sentence the caller sent.

**Client** — `src/web/CommandBar.tsx`:

- `pickKeys(commands)`: the rows as `{id, label}`, from `commandId` + `commandText`.
- With no row and a non-empty query, signed in, the empty line reads
  *No command matches. Press Enter to ask what you meant.* and Enter posts. `inFlight` and the
  status line (`Working out what you meant…`) are the ones an async action already uses.
- **One request revision** (F5): a counter bumped by any edit to the box, a close, and a change of
  the row list. An answer for an older revision is thrown away.
- The answer becomes **suggested keys**, not commands: `{ revision, keys | argument }`. What is
  drawn is looked up in the *current* row list at render, by id **and** label, and argument answers
  go through `resolveArgument` and `argumentCommand` — the path a typed verb takes. So if *Archive*
  became *Put back* while the answer was out, the suggestion is gone rather than reversed, and the
  runner is always today's.
- **Runs at once** only when all of: a `row` answer; its key is still in the list; confidence at or
  above the cut Stage 1 measures; and the row only moves the reader — a mode or sub-mode or page
  that does not `generate`, or an action that declares `opensOnly` (a required field on action
  rows, so a new one must say). Everything else is drawn, first row selected, and waits.
- **A proposal is confirmed only by a fresh press** (F4): the bar ignores a repeating Enter
  (`event.repeat`) and one during text composition, everywhere — so holding Enter cannot ask and
  then confirm.
- `none`, a failure or a timeout: *Couldn't tell what you meant.* and the bar stays open.
- Signed out, or on a page whose bar has no reader: today's `No command matches.`, no request.

**Behind the Experimental switch for v1?** No: it adds nothing to the screen until a query matches
nothing, and then one sentence. A [Q] in the debrief.

Tests, red first: `readPick` (an id not offered, an argument not in the sentence, a malformed
answer → `none`); the validator's caps; the route's contract row; the bar — Enter with no match
posts once, two Enters post once, a sure navigate pick runs, an unsure one draws rows, a
`generates`, writes or argument pick never runs without a second Enter, a held Enter across the
answer runs nothing (F4), an alias two glossary entries share stays two rows (F3), Archive turning
into Put back while the answer is out leaves no suggestion (F5), typing during the call discards
the answer, signed-out posts nothing; and the server drops a key it does not hold (F1).

## Stage 3 — docs, Help, browser check, the note

The vision doc (§ Where we are, § Jev first — the interface model exists; the capable fallback is
replaced), reading-view-overview.md § The command bar, ai-gateway.md / setup-dev.md / cost-tracking
for the job, the Help page, evals/README. A Playwright check at 1280, 820 and 390 px by a Sonnet
subagent. The feedback note; queue entries for the deferred halves.

## Noted, not built

- **Removing the quick-search icon** in favour of *search for X* in the bar. Greg: *"that's, I think,
  where we want to go"* — a direction, and it removes something readers use; `find X` and a
  sentence both reach Search today. A question in the debrief.
- **The reader's reason for reading feeding the bar** (spya-thpsnd, part 3): the bar, told why you
  are reading, proposes a set of actions — a few searches, a mode to try, a Debate steered by a
  lens. It needs the composition this plan leaves out (several proposals confirmed together) and
  an interface model that may see the reader's profile. Left for Greg to discuss, as he asked.
- **Questions about the app answered from the Help** (vision doc § Knowing how Spideryarn works).
- **Two commands from one sentence.**
- **A capable model when the fast one is unsure** — replaced by showing the candidates (decision 4).

## Review ledger

Plan review, GPT Sol, [261003k-plan-review-sol.md](261003k-plan-review-sol.md), against 316e9365c.
Every finding checked against the code and accepted.

| ID | Sev | Finding | Taken |
|---|---|---|---|
| F1 | P0 | Browser-supplied option words make the route a classifier for anyone signed in | The server holds the words (a generated, tested list); the browser sends keys |
| F2 | P1 | Small models and extracted arguments have no confidence to run at once on | Argument answers are always proposed; only a sure row pick runs |
| F3 | P1 | One answer can resolve to several rows (a shared glossary alias) | Follows from F2: argument answers never run at once; test added |
| F4 | P1 | A held Enter asks and then confirms a spending row | Repeating and composing Enters ignored |
| F5 | P1 | An id can mean the opposite row by the time the answer lands (Archive / Put back) | Keys are id + label, resolved against today's rows; a request revision |
| F6 | P2 | The selection rule could prefer two calls over an equal one | Rewritten: complete outcomes, floors, one call preferred |
| F7 | P2 | The runner would reuse the old 72 answers | A fresh results folder |

## Progress

- 2026-10-03: plan drafted; Sol's plan review (F1–F7) folded in. The eval is running.
- 2026-10-03: **Stage 1 landed** — the eval
  ([261003e](../investigations/261003e-which-fast-model-turns-a-sentence-into-a-command-and-its-argument.md),
  $1.87). 192 requests, 186 of which the bar cannot answer itself. On those: Jev picks the right
  row or argument kind 94% of the time at a p90 of 0.34 s; GPT Luna alone is 96% right at 1.39 s;
  Jev's per-word trick for the argument fails (33 of 48). **The frozen rule selects Jev for the
  pick and a small model for the words only when the pick takes them** (94%, p90 1.1–1.2 s, and
  0.3 s for the three quarters of requests that take no words). What Stage 2 takes from it:
  - **The extractor is GPT Luna** (`QUICK_MODEL_OPENROUTER`). Luna and Haiku were both 48 of 48
    and 0.1 s apart; Luna is the tier the app already has.
  - **The run-at-once cut is 0.95**: of Jev's picks that would run at once, 5 of 56 were wrong
    with no cut, 4 of 42 at 0.8, 1 of 37 at 0.9, none of 35 at 0.95. Five errors, so a starting
    point. None of the five did harm (each opened a page).
  - **Below the cut, draw Jev's top three**: when its first pick was wrong the right row was in
    its top three 11 times of 11.
  - **A model's own confidence is no gate**: every model picked Archive for some request that
    should be nothing (Luna, *archive everything on my shelf*, 0.98). Only the row's risk class
    stops that — which is the rule already in this plan.
  - **Keys must not carry the slug**: a page row's id is its address (`page:/read/<slug>/metadata`),
    so the key the browser sends and the server holds replaces the article's slug with a fixed
    word.
  - Found on the way, and fixed in Stage 2: `find mentions of dopamine` looks for
    *mentions of dopamine*.

