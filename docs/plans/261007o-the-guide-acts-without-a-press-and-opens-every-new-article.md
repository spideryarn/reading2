# 261007o — The guide acts without a press, and opens every new article

Owned by [plans.md](../project/plans.md). Overseer queue items `qi-kc47m5pw` and `qi-yfa6gs7m`
(report `spya-tddvg2`), the two follow-ups [261007j](261007j-the-guide-a-conversation-about-how-to-read-this.md)
deferred. **Status: plan, for GPT Sol's review.**

## What Greg said

> q-tyvutf yes. err on the side of capability for the guide, unless there's high risk/stakes
>
> — Greg, 2026-10-07

> q-kgrhm4 yes. but perhaps with a fixed starting message?
>
> — Greg, 2026-10-07

The Overseer's brief, from those: let the guide act without a press — open modes, switch parts,
scroll to passages, run anything free and inside the article — and keep a press for anything that
spends money or acts outside the article, *because a planted instruction in an article must not be
able to spend or reach out*. And the guide is the first thing every newly added article opens on,
with a fixed, free greeting; the reader's first message is the first model call.

## Item 1 (`qi-kc47m5pw`): the guide acts

### What "free and inside the article" means, in code

There is already one answer to *what does this press do to the world*: `proposalRisk`
(`src/web/command-proposal.ts`), `navigate | writes | spends`, with `mode` resolved per target from
`modeGenerates` / `subModeGenerates` (the table the bar's `generates` marker reads). **The guide acts
on `navigate` and nothing else.** Concretely, of the eight ids `CHAT_PROPOSABLE` allows:

| id | acts at once? | why |
|---|---|---|
| `jump-first`, `find` | yes | scroll / open Search on exact words: no model call, no write |
| `glossary-ask` resolved to `glossary-open` by `chipFor` | yes | opens an entry that exists |
| `glossary-ask` unresolved | no | asks a model: spends |
| `mode` whose target does not generate (Plain, Structure, Search, Chat, Learn and its free sub-modes, Referee…) | yes | moves the band |
| `mode` whose target generates (Summary, Glossary, Quotes…) | no | opening it arms a paid run |
| `quick-search` | no | spends |
| `tag-add`, `tag-remove`, `bookmark` | no | writes the reader's data; tags act on the shelf, outside the article |

"Switch parts": there is no part-switching proposal today (no catalogue row, no `[cmd:…]` id); a
jump to a passage in another part does the same thing, and that is a `jump-first`. Not adding one.

**Bookmark is the judgement call.** It is free and inside the article, so the brief's words would
allow it. Kept a press: it writes into the reader's comments, a planted instruction could fill them,
and the value of an unpressed bookmark is small. Named in the debrief.

### When it acts, and only then

- **Only a guide thread** (`kind === "guide"`). Chat keeps its buttons: chat's context holds fetched
  web pages as well as the article, and nobody asked for it.
- **Only an answer that finished while this conversation was on screen**: the conversation saw its
  last answer `pending` and then `done`. A transcript loaded from the server (history, a reload, a
  thread reopened from the list) never acts — reopening a guide must not re-run last week's moves.
  An `error` or stopped-with-error answer never acts.
- **At most one act per answer: the first token, in the answer's order, that is drawn as a chip,
  enabled, and `navigate`.** Everything else in that answer stays a button, as today. One act
  because two moves would clobber each other (open Structure, then jump) and the reader could not
  follow what happened.
- **The same validation as a press, because it is a press.** The act is the chip's own press,
  fired from the chip's effect: `chipFor` asked again at that moment, `canRun`, the runner, the same
  outcome handling. Only a token that `Cited.tsx` drew as a chip can act — on its own line, not
  inside a link, accepted by `chipFor` — because the chip is what acts. No second parser of the
  answer's text that could disagree with the draw.

```
Conversation (guide)                 Answer → Cited → CommandChip ×n
  last answer pending → done   ──▶   GuideAct context { messageId, used:false }
                                      first chip whose effect finds:
                                        chipFor(raw) enabled && proposalRisk == navigate
                                        → used = true; press()
```

The claim is one mutable object per finished answer, so StrictMode's double effect and a second
eligible chip both find `used` and do nothing.

### What the model is told

`modeWordsSection` (guide-only, system prompt, cached) changes its last paragraph from *"You cannot
open a mode or run a search yourself"* to: a free mode's line carries *Opens at once:* before its
token, a generating mode's *Button:*; when you write an *opens at once* token, the page opens it as
your answer ends, so say *I've opened X* rather than offering, put that token last, and write at
most one; quick searches and anything marked *Button* stay offers. The catalogue rows already carry
`generates`, the same bit `modeGenerates` gives (pinned by an existing catalogue test or a new one).
`COMMAND_CHIPS` (shared with Chat) is unchanged.

### security-map.md (a rule doc; Greg approved the behaviour, the wording is shown here)

The `chat-commands.ts` row's last sentence, *"A press is the only way any of it runs."*, becomes:

> A press is the only way any of it runs, with one exception: in the guide, the first chip of an
> answer that finished on screen runs itself if `proposalRisk` says it only moves the reader
> (`src/web/guide-acts.ts`). Anything that writes, spends or leaves the article is still a press,
> so a planted instruction can at worst move the reader, undone by Back.

## Item 2 (`qi-yfa6gs7m`): the guide opens every new article

The greeting is already ours and free (`GuideGreeting.tsx`), and adapts to whether a reason is
stored; nothing to build there. What changes is the first-open default:

| usable width | before (261005a, 261007j) | after |
|---|---|---|
| below 700px (a band covers the prose) | the article alone; the modal if the add page asked and no reason | unchanged |
| 700px and up | `?mode=summary`, or the guide when the add page asked and no reason | `?mode=chat&guide=1` |
| 900px and up | the same with `&margin=1` | `?mode=chat&guide=1&margin=1` |

`firstOpenSearch` returns the guide instead of Summary. That makes the purpose read irrelevant to
*where* a first open lands, so the coordinator in `first-open-purpose.ts` shrinks: the default no
longer waits for the purpose read (`releaseWhenDecided`, `firstOpenHeld`, the deferred apply go),
and what is left is the one question the purpose read still answers — **does the modal show?** — no
on a held first open where a band fits (the guide's greeting holds the same box), yes where none
fits, and as today on every non-first open. The phone keeps the modal, as 261007j judged.

`useLastView`'s ordinary path still waits for the settings store's `signedIn`, as it did for
Summary.

Docs: url-state.md § An article never opened here (table and the guide bullet), summaries.md's line
that Summary is where a first open lands, chat-tools.md § The guide, chat-llm-help-commands-vision.md
§ Where we are, the comments in `last-view.ts` and `first-open-purpose.ts`. Greg's 2026-10-04 quote
stays, with his 2026-10-07 answer under it as what replaced it.

## After the plan review (overrides the above where they differ)

[GPT Sol](261007o-plan-review-sol.md): *build with changes*, five findings, all accepted.

- **F1 (P1) — Search writes on mount.** Opening Search tidies remembered quick/thorough pairs and
  its swap deletes a superseded quick result (`auto-thorough.ts`, `SearchMode.tsx`), so `find` and
  `mode:search` are `navigate` by `proposalRisk` but not free of writes. **Neither acts alone**:
  `find` and any Search key stay a press; the prompt marks Search *Button*. The act set is
  `jump-first`, `glossary-open` and a non-generating, non-Search `mode`.
- **F2 (P1) — "seen pending, then done" is not "finished now".** Provisional ids are swapped at
  `begin`, batched frames can skip the pending render, a refused retry restores an old `done`, and
  a recovered row also ends `done`. **The trigger is the controller's own `turn.done`** — dispatched
  only by a live stream of a turn this tab started (recovery dispatches `recovery.found`) — handed
  to listeners with the committed reply and thread id. A stopped or truncated answer never acts.
- **F3 (P2) — mounted is not visible.** A band stepped aside on a phone stays mounted. **The chip
  checks it is actually rendered** (`checkVisibility`, or no `display: none` ancestor) at the moment
  of the act; if not, the act is spent, not deferred, so showing the band again releases nothing.
  The claim is created by the parent on that event and expired by the parent's effect after the
  commit its chips' effects ran in, so a chip that remounts later finds it used.
- **F4 (P2) — keep the marked path's immediate apply.** The ordinary path waits for the settings
  store; a marked arrival that went back to it could leave the modal suppressed and nothing opened.
  So the hold stays; only its wait for the purpose read goes.
- **F5 (P2) — Help, and precise promises.** The Help page on Chat says nothing happens without a
  press; it gains the guide. "The first message is the first model call" is qualified: Marginalia's
  relation words may be made on a wide first open, as since 2026-10-05. The security wording is
  about automatic proposals only; the guide's own tools inside a turn the reader sent are unchanged.

## The simpler options passed over

- **Item 1, open a generating mode without arming it** (the band would show its own *Write it*
  press if nothing is stored, and the stored artefact if there is one). More capability — Glossary
  and Summary are the guide's commonest suggestions — but three bands spend on mount regardless
  (Diagram's pictures, Summary's thread, Marginalia's relation words), so "unarmed is free" is not a
  rule the code keeps. Deferred; a `[Q-…]` in the debrief.
- **Item 1, a second parser over the answer's raw text** to find the token to act on. Simpler to
  test, but it would have to repeat `Cited.tsx`'s link-first split and own-line rule exactly, and a
  token it acted on that the draw showed as text would be an act with no button beside it.
- **Item 2, delete `first-open-purpose.ts` outright.** The modal still needs to know whether this
  arrival is a held first open with a band, which is the one fact the module holds.

## Stages

1. **Item 2** (smaller, independent): tests red first (`firstOpenSearch` gives the guide;
   no modal on a wide held first open whatever the purpose read says; the modal on narrow), then
   the code, the docs. Commit.
2. **Item 1**: tests red first (a guide answer that finishes on screen runs its first navigate chip
   once; a loaded transcript does not; a chat thread does not; a `spends`/`writes` chip does not; a
   second navigate chip does not; StrictMode runs once), then `guide-acts.ts`, the `CommandChip`
   effect, the prompt paragraph, security-map.md, chat-tools.md. Commit.
3. Sol code review (write-capable), gates, a Sonnet browser check at 1440 / 820 / 390, push.
