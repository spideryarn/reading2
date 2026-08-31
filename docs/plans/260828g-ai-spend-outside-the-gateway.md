# The spend the ledger cannot see

**Status:** plan, 2026-08-28. Successor to
[260827q-ai-cost-tracking.md](260827q-ai-cost-tracking.md), which built the ledger and then said, on every single
run of the report:

```
Not counted here: anything evals/ spends — it does not go through the gateways.
```

Greg asked for *"careful, accurate, **comprehensive** cost-tracking (of all AI spend, including
embeddings, transcription, etc)"*. That line is the ledger admitting it is not comprehensive. This
plan is about deleting the line by making it false, rather than by making it quiet.

## The inventory, which is worse than the line admits

The line says "evals". It is right about the directory and wrong about the shape. Eight call sites
spend money that produces no row, in **three** different ways, on **two** different accounts.

| Where | How it calls | Account | Why there is no row |
| --- | --- | --- | --- |
| [`evals/review-stances.ts`](../../evals/review-stances.ts) | `converse` → chat wire | OpenRouter | metered, but no scope is open |
| [`evals/prompt-caching.ts`](../../evals/prompt-caching.ts) | `converse` → chat wire | OpenRouter | metered, but no scope is open |
| [`evals/embedding-retrieval.ts`](../../evals/embedding-retrieval.ts) | `embedAll` → chat wire | OpenRouter | metered, but no scope is open |
| [`evals/embedding-retrieval.ts:933`](../../evals/embedding-retrieval.ts) — the judge | `new Anthropic()` | **Anthropic** | outside both seams |
| [`evals/pdf/bakeoff/bakeoff.mts:220`](../../evals/pdf/bakeoff/bakeoff.mts) | `new Anthropic()` **and** a hand-rolled `fetch` | **both** | outside both seams |
| [`evals/extraction/rescue.mts:98`](../../evals/extraction/rescue.mts) | hand-rolled `fetch` | OpenRouter | outside both seams |
| [`evals/dictation/bench-transcribers.mjs:22`](../../evals/dictation/bench-transcribers.mjs) | hand-rolled `fetch`, key parsed out of `.env.local` by regex | OpenRouter | outside both seams |
| [`evals/dictation/bench-vocabulary.mjs:16`](../../evals/dictation/bench-vocabulary.mjs) | hand-rolled `fetch`, same regex | OpenRouter | outside both seams |

Three facts in that table matter more than the eight rows.

### 1. Three of them are already metered and only need a scope

`converse` and `embedAll` go through [`src/ai-call.ts`](../../src/ai-call.ts). The call is measured,
priced from OpenRouter's own `usage.cost`, and then dropped on the floor because no collector is
open — `recordSpend` warns and returns. The fix is the line that already exists for the seven
pipeline stages:

```ts
if (isMain) void withLedger("eval", main);
```

`withLedger`'s signature is `(scopeKind: "cli" | "eval", …)`. **The `eval` half has never been
called.** It was written for this and left unwired, which is exactly the sort of thing that reads as
finished.

### 2. Two accounts, and only one of them is reconciled

`--reconcile` reads `GET /api/v1/key` and compares our rows against OpenRouter's own running total.
*(Settled on 2026-08-31: `ANTHROPIC_API_KEY` is out of `.env.local`, the judge moved onto the Skin,
and the bake-off's transport arms are the only Anthropic-direct caller left — pinned by
`tests/no-undeclared-spend.test.ts`. [ai-gateway.md](../project/ai-gateway.md). What follows is what
was true when this was written.)*

`ANTHROPIC_API_KEY` is still live in `.env.local`, and two evals spend on it directly. Nothing in
this repo reads the Anthropic side of the bill, and [question 0 of the previous
plan](260827q-ai-cost-tracking.md#questions-for-greg) withdrew the only mechanism that could — the Admin
Cost API needs a credential this account may not be able to issue.

~~So a direct-Anthropic call cannot be priced at all any more. **The price table was deleted**~~
— **wrong, and GPT Sol caught it.** [`src/pricing.ts`](../../src/pricing.ts) is 406 lines and still
holds `ANTHROPIC_PRICES`, `priceAnthropicCall` and `crossCheckOpenRouter`. What changed when
`usage.cost` arrived is that the seams stopped *using* it, not that it went away — it is kept
precisely so the two can be compared. So a direct-Anthropic call **can** be priced; the figure is
just ours rather than settled, and the row has to say which.

That distinction is the whole of `cost_source`. `credits_used_nanos` means one thing — what
OpenRouter deducted — and an estimate must never land in it, because that column is what
`--reconcile` compares against OpenRouter's own running total.

### 3. Two of the eight are outside the gateway **on purpose**, and that has to be respected

The PDF bake-off's whole reason to exist is comparing transports — one reader is
`transport: "anthropic"`, another is `transport: "openrouter"`, and the point is which wins.
The dictation bench compares sixteen transcribers on OpenRouter's dedicated
`POST /v1/audio/transcriptions`, which is a different endpoint from the one `src/transcribe.ts`
uses for one chosen model.

Routing either through the seam deletes what it measures. So "make everything use the seam" is not
the design; it is a wish that would quietly break two evals.

### C. The ones that must stay raw get a *declared* bypass that still produces a row

**Built as (a)**, and GPT Sol sharpened it into something better than a `recordExternalCall()`:

> a completion-only function can be forgotten, misses throws, and mints the identifier after the
> request.
>
> — GPT Sol, 2026-08-28

So it is a **lifecycle wrapper**, not a report-afterwards call: `withDeclaredExternalCall(id, {model},
fn)` calls `beginSpend` before the network, `recordSpend` exactly once in a `finally`, and hands the
body an `observe` with one method per provider. The only `AiCallRow` construction stays where it
was, in `src/ai-spend.ts`.

Three things stop it becoming a second way to call a model:

- the wrapper lives under `evals/`, so nothing in `src/` reaches it without a relative import that
  stands out in a diff — the *register* is separate ([`src/spend-declarations.ts`](../../src/spend-declarations.ts))
  because the report and the scan both have to read the list;
- `declaredFetch` throws outside a declaration, which is the half with teeth;
- the scan in D fails on any way of reaching a provider that is not in the register.

**Retries were the trap, and I had not seen it.** A bare Anthropic client retries twice by default,
so one `messages.create` can be three billable attempts behind one row — a cost table wrong by a
factor, with nothing looking wrong. `anthropicForDeclared()` sets `maxRetries: 0`, and
`declaredFetch` counts attempts so that the setting has to keep working rather than having been
written down once.

## What was built, 2026-08-28

### A. Scope the four that were already metered — done

`converse` and `embedAll` were measured all along and dropped on the floor because no collector was
open. One line each at the entry point of
[`review-stances.ts`](../../evals/review-stances.ts), [`prompt-caching.ts`](../../evals/prompt-caching.ts),
[`embedding-retrieval.ts`](../../evals/embedding-retrieval.ts) and
[`rescue.mts`](../../evals/extraction/rescue.mts):

```ts
await withLedger("eval", main);
```

`withLedger`'s signature has been `(scopeKind: "cli" | "eval", …)` since the ledger landed and **the
`eval` half had never once been called.** It was written for this and left unwired, which is exactly
the sort of thing that reads as finished.

### B. Re-plumb where the raw call was incidental — done, for one of three

[`rescue.mts`](../../evals/extraction/rescue.mts) hand-rolled a `fetch` because it wanted a model,
not because it wanted its own transport. It now calls `openRouterJson("eval", …)` and nothing about
the request changed: `AI_JOB_ROUTE.eval` sets the same `require_parameters` and
`allow_fallbacks: false` it used to pass by hand.

`AI_JOB_ROUTE.eval` **forbids fallback, and that is the stronger case rather than a copy of `pdf`'s**
— an eval names a model and reports a number against that name, so an upstream substituted silently
means the number belongs to a model the write-up never mentions.

The two dictation benches were **not** re-plumbed, and the reason is not technical. Another agent was
rewriting that directory the same morning — `bench-vocabulary-sources.ts` and `make-clips.mjs` were
minutes old — and re-plumbing a file mid-rewrite loses somebody's work. They are declared instead,
which is the honest state and costs nothing to finish later.

### C — see above. Built as a lifecycle wrapper.

Three declarations are **metered** and write rows: the bake-off's two transports and the embedding
eval's judge. Three are **declared and not yet metered**: the two dictation benches and the
successor one of them is being replaced by.

The judge stayed a bypass rather than moving to the seam, and that is the weakest of the three:
`streamMessage` owns the model on purpose, the judge picks its own per run, and converting it to the
chat wire would lose `thinking: {type: "adaptive"}` — which changes the judgements, which are cached
on disk under a rubric version, which means a full re-judge in real money. Worth revisiting the day
the seam grows an explicit-model entry point.

### D. The scan — [`tests/no-undeclared-spend.test.ts`](../../tests/no-undeclared-spend.test.ts)

Every file git can see — **tracked and not-yet-added**, because listing only tracked files means a
new bypass passes on the machine that wrote it and fails for the first time on somebody else's.

It parses nothing. The obvious design was an AST walk, and it does not work here: this repo is on
TypeScript 7, whose package exports `version` and little else, and every JavaScript parser installed
arrived as somebody else's transitive dependency. **A gate that stops running when an unrelated
package is bumped is worse than no gate, because it goes quiet rather than red.** So it strips
comments itself — tracking the three kinds of string literal, so a `//` inside a URL is not a
comment — and matches the rest.

**It went red on its first real run**, on two files I had not found by reading: a peer's
`bench-vocabulary-sources.ts`, created an hour earlier, spending real money through its own
hand-rolled `fetch`; and a root-level `scratch-tok2.mts` constructing an Anthropic client. That is
the best evidence available that it works.

Six matchers, each proved against its broken state in the same file. What defeats it is written down
in its header rather than left to be discovered: a hostname built by concatenation, a base URL from
an unknown env var, a client from a factory, `curl` in a subprocess. It is a **tripwire, not a
boundary** — the boundary is `declaredFetch`.

### E. Eval rows are stored, and the report keeps them out of the headline

GPT Sol was right that *"you can never un-lose a row"* settles **storage** and not **reporting**:

> the number Greg will use for product pricing should not jump because somebody ran forty PDFs.

So there is no line called `Total`. There is `Product spend`, `Eval spend`, and — only when both
exist — `All recorded`. Each pocket keeps credits, BYOK and *computed* apart, and the computed line
says out loud that it was never reconciled.

## What two rounds of code review changed

GPT Sol returned **NO-SHIP twice**, and both times the findings were paths rather than opinions —
he drove them and reported what came back. Worth listing, because the pattern is the same each time:
every one of them is a way of spending money and then writing *something other than the truth* about
it, and none of them was visible from reading the code.

**Round one.**

1. **The wrapper could spend with no ledger open at all.** `beginSpend` returns `null` outside a
   collector and `recordSpend` warns and drops — so a bypass run without `withLedger` spent and
   recorded nothing, which is the one thing a bypass is only permitted because it does not do. Now
   `persistingSpend()` — deliberately not `collectingSpend()`, because a collector with no sink
   reports to its opener and writes nothing durable.
2. **A declaration was a licence for a whole file.** Any capability in a declared file passed,
   present or future, and another file could import the wrapper and reuse an existing id.
3. **`totalSpend` ignored computed money**, so the line an eval prints at the end of *its own run*
   said `$0.0000` about what it had just spent. The persistent report had been fixed and this had
   not.
4. **The observer was neither account-specific nor once-only.** Calling `observe.openRouter` twice
   under the *Anthropic* declaration produced one accepted row reading
   `provider_account=anthropic, cost_source=provider` — a settled OpenRouter figure attributed to a
   bill that never saw it.

**Round two**, on the fixes.

5. **`AsyncLocalStorage` outlives the callback that created it.** A fetch scheduled inside `fn` and
   awaited afterwards went out against a row already written and closed; a call started from a timer
   set inside a collector ran its body after the box had shut, and the row was counted as *late* and
   thrown away. A store that exists is not a call that is still running.
6. **My filesystem shape check deleted a month of history.** Requiring the 0023 columns made every
   line written before them `unreadable` — 373 rows of real spend removed from every total by the
   check meant to protect it. Now backfilled on read, with exactly the migration's own arithmetic.
7. **The retry row was confidently wrong.** It said `outcome: "ok"` and carried one attempt's figure
   before throwing. Row-versus-no-row was a false choice: it now records `outcome: "error"` and
   *no amount*, so the report counts it under "short by an unknown amount", which is the truth.
8. **`inference_geo` is reported, and I had written that it was not.** Sol checked the installed
   SDK. It is on the row now. The **1.1x US multiplier is deliberately not applied** — this repo's
   price table is checked and dated against a published page, and a second-hand rate is exactly what
   those comments exist to refuse. The geo on the row is what lets the affected calls be found the
   day somebody checks it.
9. **The AST scanner missed a named import of the client class** — `import { Anthropic } from
   "@anthropic-ai/sdk"` works, and the text matcher it replaced had caught it. A regression found
   only because Sol went looking for one.

And one Sol got wrong, caught by the compiler rather than by me: the reasoning-token field is
`thinking_tokens`, not `reasoning_tokens`. An optional property that does not exist reads as
`undefined`, so the column would have stayed null for ever while the code looked right.

### Where I pushed back

- **`openrouter + computed` and `anthropic + provider` are not forbidden.** Sol wanted account and
  source cross-checked. Both are legitimate future rows — OpenRouter reporting no cost while we
  price it ourselves; Anthropic one day reporting a figure — and a constraint that forbids a state
  the design permits is a migration somebody has to undo.
- **A 200 carrying an `error` envelope still records `outcome: "ok"`.** `openRouterJson` cannot know
  what its caller will treat as a refusal, and the transport did succeed. Sol is right that the
  failed-call subtotal therefore misses it; changing it means changing the seam for the whole app,
  which is not this piece of work.
- **Root `scratch-*` files stay exempt while untracked** — though Sol was right that the first
  implementation did not actually say that, and filtered the name even when the file was committed.

## Two bugs the live probe found and the tests did not

Both were found by running one real Haiku call end to end and then reading `npm run cost`, which is
the same way the previous phase found `formatNanos` printing `$0.0000` for money really spent.

1. **The price lookup missed.** The bake-off sends `claude-haiku-4-5-20251001` — the dated spelling
   the SDK answers to — and `ANTHROPIC_PRICES` is keyed on `claude-haiku-4-5`. The row came back
   `cost_source: "none"` with its token counts sitting right there. Fixed with an explicit
   `MODEL_ALIASES` map, **not** a regular expression that strips a trailing date: a stripper would
   price an unreviewed future snapshot at today's rate and the row would look entirely normal. GPT
   Sol asked for exactly that, in advance, and the probe is what showed why.
2. **Every breakdown printed `$0.0000`.** `by()` summed `credits + upstream`, so the declared
   bypasses' money — itemised by day, by job, by model — showed as nothing at all. The pocket lines
   keep the three kinds apart deliberately; a *breakdown* wants the total.

## The number that is still a floor

**US inference is priced above the standard rate**, and nothing here applies the difference. The row
carries `inference_geo`, so the affected calls are findable; `computed_cost_nanos` does not include
the multiplier.

That is a deliberate refusal rather than an oversight.
[`src/pricing.ts`](../../src/pricing.ts) carries `PRICE_CHECKED` and `PRICE_SOURCE` and a paragraph
about why the table is in git rather than in a package — *"a price that can change without anyone
reviewing it is the problem, not the solution"*. Putting a rate into it from a review's citation,
without opening the page, is the thing that paragraph refuses. GPT Sol says it is 1.1x for US-only
inference on Claude 4.6 and later, with a link; that is a good lead and it is not a checked number.

The exposure is bounded and worth stating: it applies only to the **declared bypasses**, which are
eval spend, and only on calls that actually ran in the US. Everything through either gateway carries
OpenRouter's own settled figure and is unaffected.

## What this does not do

- **It does not read the Anthropic bill.** Two accounts, one reconciliation. Those rows are now
  visible and priced, and the report labels them *computed … never reconciled* every run. Anthropic's
  Admin Cost API is not available to an individual account, so the honest interim is a periodic
  manual look at the Console — recorded here rather than left as a silent gap.
- **It does not delete the bake-off's direct-Anthropic arm**, though it probably should be: the app
  cannot use that transport any more, so the bake-off is measuring a road we no longer drive on. That
  is the PDF stage's call, not this one's —
  [architecture.md § Stage ownership](../project/architecture.md#stage-ownership).
- **It does not wire the two dictation benches.** They are named, every run, by
  `npm run cost`.
- **It does not add a cap.** Still report-only, still Greg's decision.

## See also

- [260827q-ai-cost-tracking.md](260827q-ai-cost-tracking.md) — the ledger this depends on
- [ai-gateway.md](../project/ai-gateway.md) — the two seams
- [260828g-ai-spend-outside-the-gateway-sol.md](260828g-ai-spend-outside-the-gateway-sol.md) — GPT Sol's input on the
  plan, including the two premises of mine it corrected
- [260828g-ai-spend-outside-the-gateway-code-review-sol.md](260828g-ai-spend-outside-the-gateway-code-review-sol.md)
  and [-2-sol.md](260828g-ai-spend-outside-the-gateway-code-review-2-sol.md) — the two NO-SHIPs
