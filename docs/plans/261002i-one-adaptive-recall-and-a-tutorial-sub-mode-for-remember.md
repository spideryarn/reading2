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

**Landed** (stage 2): the prompt rewritten as above, with Socratic's two hard limits kept for the
nudge (*ask only where you could have told*, *never put a disputed conclusion inside a question*);
the picker, its card, the answer tag and their CSS gone; stance out of `Turn`, `ConverseRequest`,
`buildConverseMessages`, the client's send and optimistic rows, `withRetry` and `withEdit`; the
route validating-and-dropping a stale stance on a Remember send only; Help and the Features page
rewritten; the eval renamed and grown to thirteen cases. Two eval runs:
`evals/results/remember-recall.261002i-run-1.md` (quotes pasted in unmarked and uncited, verdict
openers, two questions in a reply) and `remember-recall.md` after tightening (every reply cited, all
under 160 words, the stuck readers told first). Still imperfect: `unclear` corrected rather than
clarified, `disagreement` asked two questions. remember-mode.md § One adaptive voice has the detail.

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

**Landed** (stage 3, as 3a–3c in one commit): `tutorial` in `ThreadKind`/`THREAD_KINDS`, a shared
`SINGLE_THREAD_KINDS`/`isSingleThreadKind`; the CHECK widened and `chat_threads_one_tutorial`
(drizzle/20261002214711_tutorial_thread_kind.sql, generated, applied locally); `targetOf`
generalised; `TUTORIAL_SYSTEM` with Recall's spoken-input and citing sections extracted into shared
constants; `readItFor` exhaustive; Remember's long cap for Tutorial; export and the seed helper keep
every known kind (Candidates was being exported as a chat too). Client: `REMEMBER_VIEWS` is
recall · tutorial · quiz, the chip, `subModeParams` per view, `ConversationBand` keyed on the
single-thread set, no Live props for Tutorial, its own invitation, placeholder and label. Help,
Features and the mode catalog mention it. Tests: tests/tutorial-kind.test.ts,
tests/store-export-thread-kind.test.ts (seen red against the old ternary), route and band cases.
Eval: evals/remember-tutorial.ts, two runs — remember-mode.md § Tutorial has what they showed.

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

### Code review of stages 1–2 — GPT Sol, 2026-10-02 ([answer](261002i-stage-1-2-code-review-sol.md))

No P0s; Sol fixed in the tree, and I read the diff. P1: a retry of a **legacy** answer cleared the
stance in memory but not in Postgres (`stance: null` in `pg-chat.ts`'s retry update, with a test
that seeds a real old stance); and the prompt was tightened against the second eval run (60–100
words with 120 as a ceiling, exactly one question, no verdict opener, clarify a vague reference
before correcting, move away from a failed nudge). P2s: `mode-catalog.ts` still described four
stances; the `expert` eval case wrongly said the piece had three arguments; an optimistic-retry test
still expected the stance; an invalid id in a route test. Sol also reworded the stance comments in
`schema.ts`, `modes.ts`, `types.ts` and four client files. Its Postgres tests could not reach the
database from the sandbox, so I ran them: 93 green across six files.

Sol's verdict was "not ready until a fresh eval shows it", so a third run followed — see
remember-mode.md § What the one-voice runs showed. It found one real fault (an "the article never
mentions X" claim about something in a footnote), now forbidden by an entitlement rule.

### Code review of stage 3 — GPT Sol, 2026-10-02 ([answer](261002i-stage-3-code-review-sol.md))

No P0s; the fourth-kind design passed its audit (no path treats a tutorial thread as a chat, the
migration is a safe widening, `db:chain` passes, and the shared prompt sections left
`REMEMBER_SYSTEM`'s bytes unchanged). Sol fixed in the tree: the export test now restores through
the real seeder and checks the unique index (its assertion then needed the driver's cause, fixed
here); tests for a spoken Tutorial turn being refused, Start over, the chip arming nothing, the
command bar, web-tool parity and full-section prompt equality; a scoped `case` in `subModeParams`;
the Tutorial prompt's one-question, no-evaluative-opener and same-sentence-id rules; the eval's
opener detector. Two P1s left for me, both done: a fresh eval (runs 3 and 4 — the fourth after a
recency line in the final message; remember-mode.md § Tutorial has the numbers), and
remember-mode.md's "cannot be used without reading" contract, now saying Tutorial is the exception
Greg made and what keeps it guided reading. (Sol thought that doc needed Greg's approval to edit; it
is not one of the rule docs AGENTS.md names, so it did not.) The P2 doc drift — url-state, quiz,
icons, modes.ts, activation.ts, quiz.css, last-view — is fixed. Its three Postgres files could not
reach the database from the sandbox; run here, green.

### Browser pass, 2026-10-02 (Sonnet, Playwright, local dev server)

Passed: no stance select in Recall, Send right-aligned at desktop and 390px (on a phone it wraps to
its own row, right-aligned, no overflow); three chips; `?remember=tutorial`; Tutorial's empty state,
placeholder and no Live button; two streamed Tutorial answers, short, ending on one question;
Tutorial persists across a reload and is not shown in Recall; Recall's reply brief, linked and
nudging; an edit with no answer arriving starts a new answer. No console errors. Found: the
not-read reader's first Tutorial answer had no block link — fixed in the prompt and re-evaluated
(run 5). Not exercised in the browser: the editor's "An answer is still arriving…" message (the
editor closes when the composer sends); `tests/remember-edit-asks-again.test.tsx` covers it.

