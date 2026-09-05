# Model JSON answer extraction, in the shared parse seam

**2026-09-03.** Greg pasted `dhammatalks.org/suttas/MN/MN10.html` into `/add` and the **Building the
hierarchy** step stopped with the generic `[jb-step-again]` sentence. He filed a Feedback / Problem
report the same afternoon. This plan fixes the class behind it.

Status: **built**, 2026-09-03. All four stages landed. Two decisions arrived during the build and are
recorded where they bite: **no raw-response capture**
(see [Decided](#decided-the-failed-response-is-still-kept-nowhere) below) and
**Stage 3 as arithmetic rather than English**. A third arrived mid-build and changed the design:
extraction **refuses an ambiguous answer** instead of taking the first document — see
[What landed](#what-landed).

## What actually failed

Two production steps died today, both `MalformedJson` out of `parseJsonFrom`
([`src/parse-json.ts`](../../src/parse-json.ts)), on different articles and in different stages:

| Sentry | step | slug | `diagnose()` said | cost |
| --- | --- | --- | --- | --- |
| [SPIDERYARN-READING2-R](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-R) | `hierarchy` | `mn10-spya-np5eep` | `the table-of-contents response is not valid JSON: it breaks at position 5409 of 13547 characters` | $0.1542, 98.6 s |
| [SPIDERYARN-READING2-Q](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-Q) | `timeline` | `constitution` | `the model's answer is not valid JSON: it does not begin with { or [ — 2774 characters, so this is probably not JSON at all` | $0.1287, 27.3 s |

Both sentences came out of the **Vercel runtime logs**, not Sentry: Sentry withholds a message it
cannot prove we wrote every word of, and a step's free-text diagnostic has no registered code
([`src/job-failure.ts`](../../src/job-failure.ts) § The log, and not Sentry). The `jobs`-component
log line carries `aiCalls: 1`, so neither failure was a retry loop.

### The cause

**`stripFence` only removes a code fence that sits at the exact start and the exact end of the
response.** It is documented as deliberately blunt — *"an opening fence at the very start and a
closing one at the very end, nothing in between examined"* — and eleven stages then hand the result
straight to `JSON.parse` via `parseJsonFrom`, on the assumption that the JSON **is** the whole
response. When the model puts anything around its JSON, that assumption breaks, and it breaks in two
different ways which read as two unrelated bugs:

- **Prose before the fence** → the fence is not at index 0, so nothing is stripped, the first
  character is a letter, and `diagnose` reports *"does not begin with { or ["* — the sentence
  `timeline` gave.
- **A close fence or prose after a complete JSON document** → V8 says `Unexpected non-whitespace
  character after JSON at position N`, `ranOut` correctly rules out truncation, and `diagnose` falls
  through to *"it breaks at position N"* — the sentence `hierarchy` gave, at 5,409 of 13,547.

**These are candidate explanations, not established fact, and the difference matters.** Reproducing
the shapes against a copy of `stripFence` (`shapes.mjs`, run 2026-09-03) establishes
*wrapper shape ⇒ observed diagnostic*. It does **not** establish the inverse. Each sentence is
consistent with duller causes too: *"does not begin with { or ["* is equally a refusal written in
prose, or prose with no JSON in it at all — `wasRefused` reads provider metadata only and cannot rule
out a normal `end_turn` apology. And *"breaks at position 5409"* is equally a genuine syntax error at
5409 with 8,138 characters following it; **that a valid document ended at 5409 is unsupported.** The
raw responses are gone (§ Decided, below), so this cannot now be closed — which is the argument for
Stage 3, whose whole job is to make the next one decidable. Raised by GPT Sol, 2026-09-03.

The shapes each produce, measured rather than read:

```
fence, then prose after the close fence  -> Unexpected non-whitespace character after JSON at position 44
bare json, then trailing prose           -> Unexpected non-whitespace character after JSON at position 45
prose first, then fenced json            -> Unexpected token 'H', "Here is th"... is not valid JSON
fence at both ends (handled today)       -> PARSED OK
```

Neither failure was the article. `mn10` is 195 blocks / 70,536 characters — mid-sized, and well
inside the budget. Neither was truncation or a refusal: both stages check `wasRefused` and
`stop_reason === "max_tokens"` **before** parsing and throw distinct errors for those, so a
`MalformedJson` means the model stopped normally and the content shape was wrong.

### Why now, and the claim not to make

Both Sentry issues are `firstSeen` today, which looks like a regression and probably is not.
`46439f1c` *("Split the two audiences a step's failure has, at the seam")* landed this morning and
changed how a step's failure is surfaced, so the same event may have been fingerprinted differently
before. `src/models.ts` has no behaviour change today, and the two effort commits (`eafb8bdc`,
`6129efed`) are eval-side only — `PRODUCTION_EFFORT` is still `"medium"`. **Treat frequency as
unknown**, not as new.

## The one contract this touches

Eleven stages spell the same two lines:

```ts
return parseJsonFrom(stripFence(raw), "the table-of-contents response");
```

`arc`, `glossary`, `hierarchy`, `ideas`, `illustrated`, `labels`, `quiz`, `quotes`, `sketch`,
`timeline`, `tweets`. [`src/search.ts`](../../src/search.ts) is the twelfth and already hunts the
first `{` itself — `parse-json.ts` says it *"is the only one that needs to"*, and today proved that
false. So this is one fix in one place, and the module's own argument for holding both halves
together is the argument for making it here.

## What we are doing, and what we are not

Greg, 2026-09-03, asked which way to go and chose **"don't overengineer it"**:

- **Do**: pull the JSON document out of the response instead of assuming it is the response, in the
  shared seam, so all eleven stages are fixed at once.
- **Not an automatic retry** — and the first draft of this plan argued that backwards, so the
  reasoning is worth restating correctly. It claimed `src/labels.ts`'s *"those do not get better on a
  second ask"* covered this class. It does not: that comment is about labels' own repair protocol,
  and **the successful re-run recorded under Evidence is evidence FOR retryability, not against it.**
  The cost-storm postmortem is inapposite too — it says in its own opening lines that the storm *was
  not a retry*. Both citations were mine and both were wrong.

  The honest version: **fix only the safely recoverable wrapper cases now, and keep the reader's
  explicit Retry**, which they already have — `MalformedJson` carries no `failureKind`, so
  [`src/job-failure.ts`](../../src/job-failure.ts) falls through to offering the button. Then measure
  the residual `MalformedJson` failures and add one automatic retry if they recur. That is a scope
  choice, not a claim about how models behave. ⟨GPT Sol, 2026-09-03⟩
- **Not** strict structured output via a tool schema. It is the permanent cure and it rewrites the
  prompt-and-parse seam of eleven paid stages, re-opening quality questions the hierarchy evals
  settled this week. Its own job, later, if this recurs.

## Stages

### Stage 1 — the failing tests

Red before anything is fixed, in `tests/parse-json.test.ts`, one case per observed shape and one per
shape the docstring already claims to have checked (bare fence, `json` fence, CRLF, backticks inside
a string, missing close fence, prose before, prose after, no fence at all):

- prose before a fenced document → parses, and yields the document
- a close fence followed by prose → parses
- a complete document followed by prose → parses
- backticks inside a string value → **still** parses, unchanged
- genuinely malformed JSON → still throws `MalformedJson`, still with no `cause`, still quoting none
  of the content

Done: the first three are red, the rest green.

### Stage 2 — extraction in the shared seam

One exported helper in [`src/parse-json.ts`](../../src/parse-json.ts) that the eleven callers use,
replacing `parseJsonFrom(stripFence(raw), …)`. It finds the JSON document rather than trimming the
ends of the response — **and refuses rather than choosing when more than one answer is on offer.**

1. `stripFence`, then parse the whole thing. If it parses, done: today's behaviour, byte for byte.
2. Otherwise find the first `{`, use `objectEnd` to find its matching close **respecting string
   literals and escapes** (a brace inside a gist must not end the document), and parse that span.
3. **If a `[` comes before that `{`, throw.** The document is then array-rooted and the brace is a
   sub-value inside it — see the asymmetry below.
4. Then require that nothing outside that span could be another document — no `{` before it and none
   after it, ignoring any inside a string. If there is one, **throw**.

The "no `{` before it" half of step 4 needs no code: the span opens at the first `{`, so by
construction there is none earlier. And after a closed top-level structure there are no open string
literals left to hide a brace inside, so one `indexOf` past the end is the whole check — stricter than
a string-aware scan wherever the two could differ.

**Step 4 is the whole safety of this change, and the first draft of this plan did not have it.** It
said "take the first JSON document", and GPT Sol showed that this trades a loud failure for a
plausible wrong answer:

```
I first considered {"events":[]}.
Final answer:
{"events":[{…the real events…}]}
```

`timeline` treats zero events as a legitimate result, so the empty document would have been **stored
successfully**. A truncated second document (`{"events":[]}` then `{"events":[`) is the same trap.
Refusing costs the reader a Retry click; guessing corrupts an artefact and says nothing —
[silent-success.md](../reusable/silent-success.md).

**`{` only, not `[`.** Verified against all eleven prompts: every one asks for a root object —
`{"arc":…}`, `{"tweets":…}`, `{"plates":…}`, `{"labels":…}`, `{"root":…}`. No caller contracts for a
root array, and looking for `[` would risk latching onto a footnote marker like `[1]` in a preamble,
which articles are full of.

**And the `[` rule is asymmetric on purpose**, which is step 3 above. Not looking for `[` is not the
same as ignoring it, and step 4 alone did not close the hole: with the first four steps in place but
no step 3, a fenced `[{"a":1}]` with a `Note.` after the close fence

    ```json\n[{"a":1}]\n```\n\nNote.

**returned `{"a":1}` — successfully.** The answer was the array; the first `{` is inside it,
`objectEnd` closes on that inner object, and there is no second `{` for step 4 to catch. Exactly the
class this plan exists to close, one level down. `[{"a":1},{"a":2}]` did throw, but only because it
happens to contain a second `{`, which is luck rather than a rule. So a `[` **before** the first `{`
refuses — while a `[` **after** the span is ignored, because a model's sign-off about an article is
full of `[1]` and `[2]` and refusing on those would throw away *"a document, then a sign-off"*, the
main shape this change is for. Both halves are pinned by tests, and the docstring says so, because
the asymmetry reads like an oversight otherwise. ⟨probed on the built helper, 2026-09-03⟩

**Step 3 refuses more than array roots, which is accepted rather than overlooked.** It is a plain
`indexOf`, so a bracket anywhere in a *preamble* refuses too: `See [1] below:` ahead of a perfectly
good object now throws, though nothing there is array-rooted. Often that is the right answer anyway —
`[1]` is itself valid JSON, so such a response really does offer two documents and picking one would
be guessing. Separating the rest would mean asking whether the bracket opens something that closes
and parses, a second candidate hunt for a shape nobody has seen, against *"don't overengineer it"*.
The failure direction is loud, and `diagnose` will name it if it ever shows up.

Constraints that are not negotiable, all from the module header:

- No content in any thrown message. `diagnose` keeps reporting shape only, and `MalformedJson` still
  sets no `cause` — `src/log.ts` follows cause chains, and `tests/parse-json.test.ts` asserts the
  absence.
- `stripFence` keeps working for the case it already handles; extraction is what happens when the
  stripped text still will not parse. A response that parses today must parse identically after.

`parseHits` keeps its own control flow and is **not** re-expressed in terms of the new helper: its
three branches are reader-facing and deliberate — no `{` → `PROVIDER_UNREADABLE`/`no-object`, no
matching close → `ANSWER_OVERFLOWED`/`cut-off`, balanced but invalid → `PROVIDER_UNREADABLE`/
`malformed-json`. It imports `objectEnd` and nothing else about it changes.

Done: the eleven call sites go through it; `tests/search.test.ts` and
`tests/overflow-message-reaches-its-caller.test.ts` green as an explicit acceptance criterion (they
pin those three branches). A test asserts on the **source** that all eleven sites moved —
unit-testing the helper cannot detect a call site nobody repointed, and that check went red on its
first run for six of the eleven, because the pattern missed
`parseJsonAnswer<{ ideas?: unknown }>(…)`.

`npm run typecheck` is clean across all 1,193 files. **`npm test` has one red, and it is not ours:**
`tests/paid-cli-ledger.test.ts`, where commit `b9ab25d0` (another agent's work, the same day) added
`dictation-gate-models` and `dictation-bench-models` as `unscoped` declarations in
`src/spend-declarations.ts` without matching `ADMITTED` entries. Verified by reading the assertion —
it names exactly those two — and by confirming neither file appears in this change's diff. Recorded
rather than fixed, because it belongs to whoever is holding that work.

### Stage 3 — `diagnose` names trailing material

*"It breaks at position 5409"* is what sent this diagnosis after a token-ceiling theory first. A
complete document with junk after it is a different bug from a syntax error mid-document, and
distinguishing them costs a few lines and stores nothing. **Decided, and it carries more weight than
it looks** — see § What this makes of Stage 3 below, and use the arithmetic recipe there rather than
matching any of V8's wording.

### Stage 4 — docs and the postmortem

- `parse-json.ts`'s header: the claim that `search.ts` *"is the only one that needs to"* go looking
  for the first `{` is now false, and the fix is the reason.
- [`docs/postmortems/`](../postmortems/): the class named outright, the commit, and what would have
  caught it — ranked by ease and value.
- [`hierarchy.md`](../project/hierarchy.md) and [`copy.md`](../project/copy.md) if the reader-facing
  behaviour moves.

## Decided: the failed response is still kept nowhere

**Should a response that will not parse be kept, so the next one is diagnosable?** Greg sent this one
to Fable rather than deciding it himself. **Fable's answer is no**, and the decisive point was not in
`parse-json.ts` at all:

> **`raw_response` is gone.** … it would hold model output derived from the reader's article, their
> chat, or their dictated voice. That turns a small financial ledger into the project's largest and
> most sensitive store, kept alive by a pruner that can quietly stop.
>
> — [`src/db/schema.ts`](../../src/db/schema.ts) § `aiCalls`, GPT Sol's call, 2026-08-28, reversing
> Greg's earlier "always store, with pruning"

A failed-only capture is the same object under a narrower filter, and re-opening a cross-family
decision that fresh needs a better reason than one bad afternoon. Three further reasons, in Fable's
order: `parseJsonFrom` has neither a store handle nor a slug, and the artefact store is keyed off a
closed `PATHS` table (`src/store/artifacts-fs.ts` § `pathFor`), so
a new kind is something export, delete, the admin view and the privacy page all have to learn — a
lifecycle, not a line, and disproportionate to *"don't overengineer it"*. The write would happen
inside a `catch`, which is [logging.md](../project/logging.md)'s failure mode 6. And there are paying
readers as of today, whose privacy page covers reading what we already hold, not a new debug copy
written because something broke.

**The honest cost, in Fable's own words:** *"'we'll capture it once it recurs' means the next
occurrence is diagnosed blind too, by definition."* Accepted knowingly.

**The trigger, so this is a decision and not a deferral.** Build capture the day a `MalformedJson`
recurs that the enriched `diagnose()` below cannot explain — a mid-document break at an offset, on a
stage that succeeds on retry. The shape is pre-decided so it is a fast build: one artefact kind
beside the article's others, written by the step seam in `src/pipeline.ts` (which owns the slug and
the store) via a `keep(raw)` callback passed into the parse helper, so the text never touches an
error object; 64 KB cap, overwritten on the next attempt so no pruner is needed, deleted with the
article, production only.

### What this makes of Stage 3

With nothing captured, `diagnose()`'s sentence is **the only thing a future debugger gets**, which
raises Stage 3 from a nicety to the whole of the diagnostic story. Fable's recipe, and the reason it
is arithmetic rather than English: after the parse fails at offset `at`, try `JSON.parse(text.slice(0,
at))` — if *that* parses, the response is a complete document with junk after it, and say so. No V8
wording is matched, so nothing goes stale in a Node upgrade, which is the trap `ranOut` already
avoids on purpose. It goes before the generic "breaks at position" case.

## What landed

`parseJsonAnswer` in [`src/parse-json.ts`](../../src/parse-json.ts) is the seam, and the eleven
stages call it in place of `parseJsonFrom(stripFence(raw), …)`, each keeping its own `source` string
unchanged. `objectEnd` moved out of `src/search.ts` into the same module and is exported;
[`parseHits`](../../src/search.ts) imports it and is otherwise untouched, keeping its own three-way
mapping (`no-object` → `PROVIDER_UNREADABLE`, `cut-off` → `ANSWER_OVERFLOWED`, `malformed-json` →
`PROVIDER_UNREADABLE`), which a `MalformedJson` cannot express. `stripFence`'s behaviour is untouched
too, on purpose — the prose before the object is exactly what both extracting callers scan.

**Three conditions, and the third is the design.** The stripped response is tried whole first, so
anything that parsed before parses identically now and extraction is only ever reached on a response
that was already going to throw. Then the first `{` must open a structure that closes, and that span
must parse. Then — **nothing outside the span may be another `{`**, or this throws rather than
choosing.

That third condition replaced a "first document wins" rule that a cross-family review caught before
it shipped, and the counterexample is the reason to keep it:

```
I first considered {"events":[]}.
Final answer:
{"events":[{…the real events…}]}
```

"First document" hands back `{"events":[]}`, [`src/timeline.ts`](../../src/timeline.ts) treats zero
events as a legitimate result, and the wrong answer is stored with no error —
[silent-success.md](../reusable/silent-success.md) exactly. **A refusal costs the reader a Retry
click; a wrong pick corrupts an artefact and says nothing.** The check needs no second scanner: there
is no `{` before the span (it opens at the first one) and no JSON string literals after it (that
region is prose), so one `indexOf` past the end is the whole of it. The price is that trailing prose
containing a brace now throws where extraction could have read it — taken knowingly.

`{` only, never `[`: all eleven prompts ask for a root object, and scanning for `[` would latch onto
the `[1]` of a footnote marker in a preamble.

Stage 3 is `completeDocumentBefore` and one branch in `diagnose`, built to Fable's arithmetic recipe,
with the inner `JSON.parse`'s error caught and discarded so nothing of the prefix escapes.

**The tests that were red first**, nine of them, before any source changed: the five wrapper shapes,
two complete documents, a `[`-rooted document, a brace inside a string value, and the new `diagnose`
sentence. Three guards were added afterwards that cannot go vacuous — every `AWKWARD` input that
parsed before must parse to the same value; the five wrapper shapes must all have thrown under the
old two lines; and a **caller inventory** asserting on the source of all eleven stage files, because
no test of the helper can notice a stage that never started calling it. That inventory found a real
gap on its first run: six of the eleven pass a type argument, so `parseJsonAnswer(` missed them.

## Evidence

- Reproduction inputs, re-fetched locally 2026-09-03: `data/mn10/` and `output/mn10.blocks.json`
  (195 blocks, 7 headings, 70,536 characters).
- A real `npm run hierarchy` run against those blocks, 2026-09-03 16:21 UTC+1: **it succeeded.**
  244 nodes, 194/194 blocks labelled in 5 calls, 64,560 in / 27,372 out, 218 s, $0.4169 over 6 calls,
  exit 0. The progress counter reached *"13k characters of tree so far"* — the same size as the
  13,547-character response that failed in production. **So the failure is a sampling artefact, not a
  property of this article**, which is the evidence behind "no retry": the next sample is usually
  fine, and the shape the bad sample took is one extraction handles.
- `shapes.mjs`, the six-case check of which malformed shape yields which V8 message, quoted under
  § The cause.
