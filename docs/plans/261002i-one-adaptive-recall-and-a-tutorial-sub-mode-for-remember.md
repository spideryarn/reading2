# One adaptive Recall, and a Tutorial sub-mode for Remember

Up: [plans.md](../project/plans.md) · the mode: [remember-mode.md](../project/remember-mode.md)

**Five of Greg's reports on Remember, 2026-10-01, all from one sitting on one article**
(`melnikoff-bargh-2018-mythical-number-2-0-spya-bucuzj`). Overseer queue item `qi-p2ymf8dt`,
session `fb97-98-remember-recall-and-tutorial`.

| Report | Kind | What it asks |
|---|---|---|
| `spya-cjquu6` | suggestion | Recall much more Socratic and **much briefer** — a paragraph or two; correct, then nudge, offering a couple of directions; fill the gaps if they say they don't remember; for a long explanation point to the article or offer a chat |
| `spya-kqynj5` (97) | suggestion | Recall should **always** include block links; maybe Respond isn't needed, tweak Balanced instead |
| `spya-f3b6ab` | problem | Editing an earlier message in Recall did not trigger a new reply |
| `spya-c8x66d` | suggestion | **Remove Signposts**; Socratic disappointed. **One** recall mode — brief, plain, block links, hints that nudge recall a little more each time, and when the reader is struggling, give more. "That's why we only need one mode." |
| `spya-j0scgz` (98) | suggestion | A third sub-mode, **Tutorial**: short alternating turns that teach a little and ask the reader to say it back; spacing back to earlier points; Bloom's taxonomy; adapted to profile and reading goal; block links; plain back-and-forth first, no multiple choice; research in docs/research; a docs/project/remembering-vision.md |

Greg's words are in the feedback notes and are quoted where they decide something below.

## The shape

```
   Remember  ─┬─ Recall    the reader says what they remember; the model corrects briefly
              │            and nudges them to remember a little more.  ONE voice, no picker.
              ├─ Tutorial  NEW. The model teaches a little, asks them to say it back / use it;
              │            short turns, revisits earlier points.  Its own single thread.
              └─ Quiz      unchanged
```

> I think basically I want to get to the point where actually there's really only one recall mode,
> which is fairly brief, simple language makes use of block links and tries to keep nudging me with
> hints and questions so that I'm constantly remembering a bit more and a bit more because the act of
> recollection is what helps learning.
>
> — Greg, `spya-c8x66d`, 2026-10-01

## Stages

Each ends green, committed and pushed; Sol reviews the code at the end of each.

### Stage 1 — the edit bug (`spya-f3b6ab`)

Root-caused in a subagent: a red test first, the fix, a postmortem under `docs/postmortems/`.

**Landed: the reported bug did not reproduce**, on `dev` or against the code in Greg's build — in
jsdom with the real band, against Postgres with the client's exact edit body, and in a real browser
(tick and Enter, first and last message, after Start over and after a reload). His thread was
deleted by a Start over three minutes after the report, and the row carried no diagnostics. The one
weakness the hunt found is a **candidate**: while an answer is still arriving, Enter in the editor did
nothing and the tick merely greyed out, with no word of why. Now the editor says so and keeps the
rewrite; red → green in `tests/remember-edit-asks-again.test.tsx`. The class, *a refusal with no
voice*, is in [261002g](../postmortems/261002g-a-refusal-with-no-voice.md), which says what would
settle it.

### Stage 2 — one adaptive Recall (97, `cjquu6`, `c8x66d`)

**Prompt.** `REMEMBER_SYSTEM` is rewritten as one voice. Kept nearly verbatim, because they are the
hard-won parts: *MOST OF THIS WAS SPOKEN*, *WHAT YOU ARE AND ARE NOT ENTITLED TO SAY*, the citing
rules, the tool rules. Replaced: *THE STANCE* (all four) and *LENGTH*, by a single loop:

1. **At most one correction**, only where the entitlement rules allow one, quoted and cited, in a
   sentence or two.
2. **Then a nudge**: a cue that makes the next bit of recall likely without handing it over —
   *"do you remember why they said that?"*, *"there's a part about X [id] — what was the point of
   it?"*. Often **two directions to choose from**, so a reader who has nothing on one has the other
   (Greg, `cjquu6`: *"it could nudge me in a couple of different directions so that I've got a
   choice"*).
3. **Adaptive by evidence**: if they say they don't remember, are lost, or the last nudge got
   nothing, **fill the gap** plainly and briefly, then a smaller nudge. Never make them fail twice.
   A direct question or "just tell me" gets a plain answer (the old rule 2, kept).
4. **Every reply cites at least one block** (97), the nudge included — the link is the reader's own
   escape hatch, chosen, not imposed.
5. **Brief**: a paragraph or two at most, usually a few sentences. A long explanation becomes a
   pointer to the passage, and the suggestion that Chat is the place to talk it through.

**Plumbing.** The picker goes: the `<select>`, `StanceTip`, the stance tag on answers, the client
sending a stance, `stanceLine`, and the stance carried by retry and edit. What stays:

- **The `stance` column and the read type**, because stored rows have values and dropping a column
  is destructive (CLAUDE.md § Real data). Nothing new writes it. The CHECK stays as it is.
- **The route still accepts a `stance` key from a stale tab, validated against the old four, and
  then drops it.** A tab open across the deploy would otherwise 400 on its next turn; one that
  sends one of the four values gets the one adaptive voice, which is a strict improvement on what it
  asked for. Removal of the acceptance itself is listed under Deferred, with the date it becomes
  safe (a week after deploy).

*Passed over:* keeping Balanced and deleting the other three, with the picker left holding one
option. A one-item picker is a control that does nothing; and Greg's own words are "only one
mode".

**Eval.** `evals/remember-stances.ts` becomes `evals/remember-recall.ts` (rename hunted): its eight
cases × one voice, plus three new ones — a weak, rambling account (expect: one fix and a two-way
nudge), *"I don't remember"* (expect: the gap filled, then an easy nudge), and a second turn after a
nudge that got nothing (expect: no third question in a row without telling). Run it, and read every
answer; the counters (length, ids per reply, banned phrases, ends-in-question) are prompts to look.

### Stage 3 — Tutorial (98)

**Research first**, written up in
[261002c-recall-and-tutorial-pedagogy-for-remember-mode.md](../research/261002c-recall-and-tutorial-pedagogy-for-remember-mode.md)
(Sonnet's web research, then my synthesis), and
[remembering-vision.md](../project/remembering-vision.md) for where the three sub-modes are going.

**A fourth `ThreadKind`, `tutorial`**, and one per article, like Remember's. It is Candidates'
precedent (a third personality on the chat machinery, its own prompt branch) plus Remember's
single-thread rule.

- `THREAD_KINDS`, the schema CHECK (a **widening** — the safe direction, as 0050 was), and a second
  partial unique index `chat_threads_one_tutorial`. One additive migration.
- `targetOf` (src/chat.ts) generalised from `"remember"` to the single-thread kinds.
- `systemFor` → `TUTORIAL_SYSTEM`; `readItFor`; the route's length cap uses Remember's
  (`MAX_REMEMBER_CHARS`), since it is dictated too; `visible` stays chat-only.
- **No Live in Tutorial for now.** `SpokenKind` stays `chat | remember`, and the Live control is not
  offered. Greg: *"this would be ideal for the live real time voice. But that doesn't work very well
  at the moment."* Deferred, named below.
- Client: `RememberView` gains `tutorial`; the chip; `ConversationBand` mounted with
  `kind="tutorial"`; its single-thread logic keyed on a named set of single-thread kinds rather than
  `=== "remember"`; an empty state that asks the opening question (*"What do you remember about it?
  Or say you haven't read it yet."*), so the reader speaks first and the model never writes an
  unprompted turn.
- Export, the command bar's sub-mode list, the features page if it lists sub-modes — wherever the
  compiler or a grep for `"remember"` leads.

**The prompt** (written from the research): one small step per turn — teach a little (two or three
sentences, cited), then one question that asks them to say it back, explain why, give an example,
apply it, or raise a concern, climbing Bloom's levels slowly; every few turns, a question that
reaches back to an earlier point in the conversation; adapt to the profile and reading goal (an
expert with a narrow question gets that question's passages, not the basics); handle *"I haven't
read it"* (start at the top, from zero) and *"here's what I remember"* (start from what they said);
questions that are themselves teaching and make a right guess likely; never "wrong", never praise
inflation; a way out every turn.

**Eval**: a small multi-turn script, three readers (has not read it; read it and remembers some;
expert with a narrow goal and a profile), five turns each with scripted reader replies, read in
full.

*Passed over:* Tutorial as a stance inside the Remember thread. One transcript would then hold two
kinds of conversation with different rules, and switching chip would show the other's turns.

## Deferred, named

- **A tool for the model to start a new Chat thread on a topic** (`cjquu6`: *"hopefully there is a
  tool for starting a new chat thread. And if not, there should be."*). There is none
  ([chat-tools.md](../project/chat-tools.md)). For now the prompt suggests Chat in words. Building it
  means a tool that writes a thread and a client that opens it — its own plan.
- **Live voice in Tutorial.** Live is the natural home for it, and is not good enough yet.
- **Cloze or other specialist interactions** in Tutorial. Greg: *"let's just try and get the plain
  back and forth conversation mode working first."*
- **Removing the route's acceptance of a stale `stance`** — kept indefinitely; it is cheap, and a
  tab can stay open for weeks.
- **Dropping the `stance` column**: destructive, Greg's call, and worth nothing until the export
  stops carrying old values.

## Review log

### Plan review — GPT Sol, 2026-10-02 ([answer](261002i-plan-review-sol.md))

No P0s; four P1s, all accepted, and they change the plan as follows.

- **Tutorial must not inherit Chat's behaviour by default.** A shared `SINGLE_THREAD_KINDS` /
  `isSingleThreadKind` in src/types.ts, used by `targetOf` and by `ConversationBand`; presentation
  by kind kept separate from it (single-thread does not mean same label, invitation or Live). Named
  sites: `ConversationModes` (the `=== "remember"` lifecycle branches, Live props omitted for
  Tutorial), `ChatPanel`'s non-Remember-means-Chat branches, `subModeParams`, QuizPanel's two-item
  toggle, `useChat`'s new-thread titles, and `readItFor` made exhaustive. Model, job, timeout, web
  tool and output limit are deliberately Chat's (as Remember's are), stated and tested.
- **Export and restore keep the kind.** `export.ts`'s `remember ? remember : chat` ternary, and the
  same in tests/helpers/seed-reader-state.ts and the fixture test, widened — with an export → restore
  assertion that a Tutorial thread stays one. (Candidates is lost the same way today; fixed in the
  same line.)
- **`TUTORIAL_SYSTEM` carries the shared rules**: `NO_UNRUN_TOOL_CLAIMS`, `UNTRUSTED_RESULTS`,
  `WEB_LINKS`, plain words, `PROFILE_RULES`, and joins the web-link and plain-words prompt tests and
  the cache byte-identity test.
- **"Start from zero" against "you must have read it".** Sol is right that remember-mode.md's
  defence is that Remember cannot be used without reading. Greg has already decided the case, though:
  *"it may be that the user says nothing. I haven't read it yet."* So Tutorial is **guided reading**,
  which keeps the principle: every teaching step is a small cited piece of the article, and the
  prompt sends the reader into that passage rather than standing in for it. remember-mode.md says so.

P2s accepted: the stale `stance` is accepted only on an ordinary Recall send and refused everywhere
else, as now, and kept **indefinitely** rather than for a week (tabs live longer); stance leaves
`Turn`, the pending row, `ConverseRequest`, the client's send and optimistic rows; a help-flag
retry/edit regression test; "every **substantive** reply cites a block, a pure clarification may
cite none, and an id attaches only to an article claim or quote", with eval cases for each; Help
(`help-modes.tsx`) and the Features page in the same commit; package script, evals README and cost
fixture follow the eval's rename. Stage 3 is split into 3a backend, 3b client, 3c eval.
