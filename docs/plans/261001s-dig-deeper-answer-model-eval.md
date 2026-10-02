# 261001s — which model should write a *Dig deeper* answer? A quality-and-cost eval

Status: **run; result corrected after the numbers review** (§ Result; § What running changed). No
production change — the model is Greg's call. Sol's plan review
([261001s-…-plan-review-sol.md](261001s-dig-deeper-answer-model-eval-plan-review-sol.md)): *build
after fixes*; all nine findings taken, two of them reshaped (§ What the plan review changed). Owner:
the session in worktree `dig-deeper-eval`, dispatched by the Overseer from [Q-dig-deeper-eval].
Follows [261001p](261001p-dig-deeper-one-action-always-searches-bigger-model.md), which put every
*Dig deeper* answer on Opus because Greg asked for "a bigger model", not because anything measured
Opus as better.

**Decided 2026-10-02: the answer stays on Opus**; the finalist run is not bought and Luna + check is
dropped. The write-up, with Greg's words and what would reopen it, is
[research 261002a](../research/261002a-dig-deeper-answer-model.md).

## What Greg asked

> yeah ok, let's set up that eval with at least 3 varied representative tricky examples, and then
> try a few different models (e.g. GPT Sol 6, Kimi K3, DeepSeek v4.1 Flash, Google Gemini 4 if
> available, and a couple of others that look promising based on Artificial Analysis results), and
> we'll have to think about how to trade off quality against cost.
>
> — Greg, 2026-10-01

The Overseer's brief adds: hold the search step fixed so only the answer model varies; include
today's Opus, the old Sonnet, and "Luna generates, Opus checks"; judge blind with a panel spanning
families and a control; measure real per-press cost (first press and repeat) and latency; keep the
whole thing under about $40; **do not change the production model** — that is Greg's call once he
sees the numbers.

## In one paragraph

Six real presses — two per entry point (glossary term, commented passage, cited work), on articles
of different kinds, each hard in a particular way — have their search step **run once and frozen**.
Every arm then answers each of the six from the same messages, **built by production's own
builders** (`buildExplainMessages`, `investigateRequest`) with an eval-only edit (no further search
is possible), three times, at production's 4,000-token ceiling, and each answer goes through its
entry point's real acceptance rule. The first two draws are judged; the third still measures
delivery, variation, cost and caching without buying a third round of judges. A panel of three
judges from three families scores the answers
in small blind batches, each with an Opus answer as a common anchor, against the article and the
exact evidence the answer saw. The ~255k-token article is the exception: each of its two tasks has
a declared evidence packet containing the target, every gold-note block and nearby or intervening
blocks, because the full article plus five answers cannot fit a nominal 262k judge window. Cost,
cache use and latency come from the calls themselves. The
report is a table per arm, the cost–quality frontier, and options for Greg — not a single "best
value", because how much quality a dollar is worth is his to say.

## The examples

Chosen by an Opus subagent reading the local articles; every quote checked verbatim against the
database. Committed as `evals/dig-deeper/examples.ts` (ids, block ids, a short gold note — no
article prose beyond the selected quote).

| id | entry point | article (kind, size) | what makes it hard |
|---|---|---|---|
| `kuhn-challenge` | glossary | Kuhn, *A landscape of consciousness* (long academic PDF, ~255k tokens) — "Challenge Theories", anchored `spya-rwekjr` | Kuhn's own tenth category; the web's "challenge theory/hypothesis" means unrelated things, and the article's definition sits ~1,600 blocks after the anchor |
| `seth-naturalism` | glossary | Seth, *The Mythology of Conscious AI* (essay, ~13k) — "biological naturalism", `spya-z6e85s` | Seth's version (life is necessary) differs from Searle's, which is what the web says |
| `feynman-millikan` | comment | Feynman, *Cargo Cult Science* (talk, ~5k) — the Millikan oil-drop passage, `spya-s9msxy` | a famous claim historians dispute; a good answer keeps Feynman's story apart from the history |
| `kuhn-sapolsky` | comment | Kuhn again — the Sapolsky "die has already been cast" quote, `spya-utvbhw` | the article itself hedges this ~150 blocks earlier, and Sapolsky hedges two blocks later; the web alone misses both |
| `gwern-schmidhuber` | citation | gwern, *The Scaling Hypothesis* (essay, ~26k) — "Schmidhuber 2015/2018", `spya-s4u5y7` | two untitled works behind one footnote; a confident single pick is wrong |
| `antikythera-parker` | citation | *Antikythera mechanism* (Wikipedia, technical, ~24k) — Parker 1950, *The Calendars of Ancient Egypt*, `spya-z55t7c` | the article contradicts itself about 365 vs 354 days; the work is cited for the 354 reading |

Two per entry point because the prompts differ (glossary and comment share explain's `SYSTEM`;
Citations has `INVESTIGATE_SYSTEM`), so one example per prompt would confound "this model is worse"
with "this example is odd". The Kuhn PDF appears twice so the long-context case has two draws; the
second shares the first's cached prefix, which the cost section accounts for.

Gold notes cite block ids. Where the subagent added outside knowledge (the history of the electron
charge, the likely Schmidhuber papers, Parker's 25-year cycle) the note says so, and judges are told
those lines are unverified hints, not ground truth.

## Holding the search step fixed

`capture --spend` runs the production `searchFirst` once per example (Luna + Exa, ~$0.007 each,
with the local library search), and for the two Citations examples the rest of what a press
assembles before its answer: the stored *Look it up* match if there is one (neither has one, so
`findTheWork` runs once, as a first press would), the paper evidence and its passages
(`readCitedPaper`, `findPaperPassages` on Opus, as production does). Each step's wall-clock time is
recorded, for the press latency. The result is frozen per example with a hash of the article's text,
so a later run refuses an article that changed under it.

**Nothing raw is committed** (Sol F9). The frozen inputs hold web excerpts, paper text and passages
from the reader's other saved articles; answers and judgements quote them. All of it lives in the
gitignored run directory `output/dig-deeper-runs/<run>/`; what is committed is the code, the
examples, and the promoted `report.md` with aggregates, hashes and short error descriptions —
the convention in [evals/results/README.md](../../evals/results/README.md) § `summaries/`.

**The answer model gets no web tool, and is told so** (Sol F2). In production it keeps an optional
server tool and may search again; here that would let each arm read different pages. Rather than
leave every arm an instruction it cannot follow, the one line that says to search again is replaced
in the built messages by an eval line — *"That search is all the research there is; you cannot
search again."* — in explain's `DIG` and whole *Web research* section, and in Citations'
`DIG_INVESTIGATE`, opening tool claim and `INVESTIGATE_SYSTEM`'s *What to search* section. The
replacements are string edits on production's output, and the test fails if any text it replaces is
no longer there, so a prompt change cannot quietly make one a no-op.

**And then once production-shaped** (Sol F2): the best two non-Opus arms and Opus run each example
once more through production's prompt and route, with the tool on, 4,000 tokens and one eval-only
model-neutral `max_tool_calls: 8` safety ceiling — to see whether the isolated ranking survives the
real setting. That run is not judged against the others' scores; it is judged as its own small batch
(the three answers per example), and the report says whether the order held.

A separate one-call-per-finalist probe records whether a model can run its own **forced** search
(`tool_choice: "required"`, the Exa tool) — a compatibility note for whether the Luna step could go,
not evidence about search quality.

## The arms

Each id checked against OpenRouter's `/api/v1/models` on 2026-10-01; prices per million tokens
(input / output / cache read), credits not cash (§ Cost).

| arm | model | why it is here |
|---|---|---|
| `opus` | `anthropic/claude-opus-5.5` | today's production answer ($4 / $20 / $0.20) |
| `opus-b` | the same, a second label | the **incumbent generation spread**: two draws of one arm, judged blind beside each other; not in the cost frontier |
| `sonnet-5` | `anthropic/claude-sonnet-5` | the old set-up ($2 / $10 / $0.20) |
| `sonnet-5.5` | `anthropic/claude-sonnet-5.5` | the current Sonnet, same price; AA index 56 to Opus's 58 |
| `luna` | `openai/gpt-6-luna` | the cheap baseline alone ($0.10 / $0.50), so the check's contribution has a number |
| `luna+check` | Luna writes, Opus checks | Greg's idea — § The Opus check |
| `sol` | `openai/gpt-6.1-sol` | Greg named "GPT Sol 6"; 6.1 is the current Sol (listed 2026-09-29) ($2 / $10 / $0.10) |
| `kimi-k3` | `moonshotai/kimi-k3` | Greg named it; AA's best long-context score (AA-LCR 88.7%) ($0.41 / $10, no cache discount) |
| `deepseek-flash` | `deepseek/deepseek-v4.1-flash` | Greg named it; the cheapest serious model ($0.03 / $0.50) |
| `gemini-flash` | `google/gemini-3.8-flash` | **Gemini 4 is not on OpenRouter** — "Gemini 4 Argon" was announced 2026-09-30 for a closed programme. 3.8 Flash is Google's newest listed model ($0.75 / $3.75) |
| `glm-5.3` | `z-ai/glm-5.3` | an AA pick: index 45, about Kimi's, cheaper ($0.22 / $3.39) |
| `grok-4.7` | `x-ai/grok-4.7` | an AA pick: index 46, the highest of the rest ($2 / $6) |

Artificial Analysis, <https://artificialanalysis.ai/leaderboards/models>, read 2026-10-01
(Intelligence Index; the page gives cost per task, not a blended price): Opus 5.5 58, Sonnet 5.5
56, GPT-6.1 Sol 52, Grok 4.7 46, GLM-5.3 45, Qwen3.8 Max 45 (passed over: $5.41 a task, 39
tokens/s), Kimi K3 44, Gemini 3.8 Flash 41, DeepSeek V4.1 Flash 39, Luna 37. Gemini 3.1 Pro
Preview (30) and MiniMax M3 (29) passed over as weaker than arms already in.

**Settings as production would send them** (Sol F1, F3). `max_tokens` is production's 4,000
(`DIG_ANSWER_TOKENS`), reasoning included. Anthropic arms go through job `dig-deeper` — production's
row, with its Anthropic `order` pin, and `wireEffort`'s `high` for Opus. Every other model goes
through job `eval` (no order, no fallback, provider-default effort), which is what a new route row
for it would most likely start as. The model OpenRouter reports back is recorded and must match the
one asked for, or the cell fails.

**Each answer goes through its entry point's acceptance rule** (Sol F1): a glossary press refuses
anything that did not finish (`refuseUnfinished`, src/term-lookup.ts); a comment keeps a truncated
answer; a Citations press refuses an unfinished answer and runs its quote guard
(src/citation-investigate.ts). An answer refused there is **not delivered** — scored as a failure in
the delivered-success rate, and not judged. Quality is reported over delivered answers, beside that
rate. An arm that fails on `length` gets a diagnostic re-run at 8,000 on those cells only, to say
whether a larger ceiling would rescue it.

### The Opus check

Luna answers first, from the same messages. Then one Opus call whose **system prompt and article
part are the Opus answer's**, so it reads the same cached prefix, and whose last part is the
answer's own (the passage, the evidence, the instruction) followed by Luna's draft inside an
`untrusted(...)` fence and this instruction:

> Check the draft against the article and the evidence above. Reply with JSON only:
> `{"action":"keep"}` if it is accurate, uses the sources faithfully and answers the reader well;
> otherwise `{"action":"replace","answer":"…"}` with the corrected answer in full, ready for the
> reader.

Validated (Sol F4): anything that is not exactly one of those two shapes, or a `replace` with an
empty answer, is a failed press, never silently the reader's answer. The report gives the replace
rate and the check's own cost. The bet is that most of a warm Opus press is Opus *writing* (~1,500
output tokens at $20/M), so a `keep` saves most of it; the cold cost — Opus writing the article to
its cache — is not saved at all.

## Judging

**Small batches with a common anchor** (Sol F5). For each (example, run, judge), the eleven
non-anchor arms (`opus-b` included) are split by a seeded shuffle into three batches of three or
four, and **`opus`'s answer from that run is added to every batch** as the anchor. Each batch is
labelled with fresh random letters in a fresh order. The judge sees: the article (cached), except
that the ~255k-token Kuhn article becomes a stable task-specific evidence packet containing the
target, every block named by the gold note and nearby or intervening blocks; the
**exact last part every arm in that example saw** — the passage or term, the frozen search results
and library passages, and for Citations the matched page and the paper's evidence (Sol F5) — the
gold note, and the batch. It is asked for one exact JSON shape, validated locally rather than sent
with `response_format` (support for that parameter was not established for both non-Opus judges),
per label: 1–5 for

- **accuracy** — true to the article and the evidence; nothing false;
- **sourcing** — uses the sources faithfully, says where a point came from, claims no search it did
  not run, does not stretch a source;
- **depth** — adds what a reader who wants to know more would want, beyond the article;
- **plain words** — the house rule in [prompting-guide.md](../project/prompting-guide.md);

an overall 1–10, and a list of factual errors, **each pointing at its evidence** (a block id, a
source number, or "outside knowledge: …"). An error with no pointer is kept but counted apart.

**Declared before the run** (Sol F5):

- **Primary quality** = an arm's mean of (its overall − the anchor's overall in the same batch),
  over every delivered answer the panel could judge. Relative to Opus because absolute scores move
  with what else is in the batch. Delivery is shown separately; unlike the quality mean, the
  acceptable-rate denominator includes every scheduled judged press, so refusal cannot improve it.
- **Acceptable** = accuracy ≥ 4 and sourcing ≥ 4 from at least two of three judges, and no error
  with the same evidence pointer reported by two or more judges. Block IDs and result numbers are
  already stable pointers; an `outside knowledge:` pointer is keyed by its normalized factual
  statement so two unrelated external errors cannot create false agreement. A smaller smoke panel
  cannot certify an answer. An arm's **acceptable rate** is over its judged presses, a refused
  judged press counting as not acceptable.
- **The frontier** = arms no other arm beats on both acceptable rate and repeat-press cost, and the
  same on primary quality. No arm is named "best value" by a formula; the report gives Greg the
  frontier and three readings of it (best quality, cheapest within the control spread of Opus,
  cheapest acceptable on every example) with the price of each.

**Noise** (Sol F6): the run-to-run spread across the two judged draws within each arm; the
`opus`/`opus-b` gap, reported as the
incumbent generation spread, not as a universal floor; **judge stability**, by re-judging one run of
every example a second time with a fresh shuffle and comparing; and intervals bootstrapped over
examples, since six examples, not 162 calls, are the sample. The all-judge mean is primary; each
arm's score from judges outside its own family is a sensitivity check, and the report says where it
disagrees. **Position**: the repeated Opus answer's mean and the non-anchor mean relative to Opus in
the same batch, by displayed position; both avoid mistaking a changing answer mix for an order
effect. **Length**: word counts per arm.

**The panel**: `anthropic/claude-opus-5.5`, `openai/gpt-6.1-sol`, `moonshotai/kimi-k3` — three
families, each its family's strongest on long context.

## Cost and latency

From each call's own `usage` — OpenRouter's `cost`, prompt, cached and cache-write tokens, reasoning
and completion tokens — and our own clock. Cost uses the ledger's `totalSpend`: ordinary calls are
OpenRouter credits (cash is about 5.5% more when buying them), while a BYOK call uses its reported
upstream inference cost, billed on that provider's account.

- **Repeat press** = a run whose cache read covers at least 90% of the article prefix. A run that
  read less is reported as a **cache miss** and not averaged into the repeat price (Sol F3). A model
  with no cache price advantage has a valid full-price repeat observation without a cache hit.
- **First press** is measured where it can be — run 1 of an arm on an example nobody has cached —
  and **reconstructed** where the prefix was already warm (`opus-b`, the check, the second Kuhn
  example): the warm cost plus the prefix's tokens × (write price − read price), validated against
  the arms where both were observed.
- **Per press** = the arm's own call(s) + what every arm shares: the search step, and on Citations
  the *Look it up* and paper-passages calls (Opus in production). Shown separately for first and
  repeat: a current assessed lookup is skipped on repeat, while a no-match is looked up again.
  The shared repeat is a conservative reconstruction, not another measured press: apart from that
  production lookup branch, the captured shared costs and times are held fixed.

**Latency, two columns** (Sol F4): the answer call alone (time to first answer token, total), and
**what the reader waits**: the captured search time, plus on Citations the lookup and paper times
(with two states, first and repeat; an assessed lookup is skipped on repeat, while a no-match is
looked up again), plus
the answer's time to first token. For `luna+check` the first word a reader can see comes after
Luna's whole draft and Opus's verdict (and its whole replacement, since a JSON answer cannot be
streamed as it is written).

## Spend

**The budget is one durable file per run**, shared by capture, probe, answers and judging across
separate invocations (Sol F7). Before every call the runner **reserves an upper bound** — the
request's UTF-8 bytes as a true token upper bound at the uncached price, plus `max_tokens` at the
output price, plus tool fees
— and refuses the call if reserved plus spent would pass `--cap` (default $35). Afterwards it
settles the reservation to the call's reported cost. **A call that reports no cost, or a
non-finite one, halts the run** rather than counting as zero.

The estimate is recomputed by the free preflight once the examples are fixed: it builds every
request, counts tokens, prices them at today's listing and prints the bill. Rough order, before
that: answers ~$12 (the two Kuhn examples are most of it — ~255k tokens each, though the second
reads the first's cache), judging ~$12–18 (Kimi K3 has no cache discount on a 255k-token article),
capture and probes ~$0.5. The third answer draw is already not judged. **If a fresh preflight says
more than ~$35, the plan is cut before spending** — next Kimi comes off the Kuhn batches — and that
goes back to the Overseer if it still does not fit under $40.

## Output and integrity

The run directory holds the **expected matrix, written before anything is bought** (Sol F8): every
(example, arm, run) answer cell and every (example, run, judge, batch) judging cell. A cell's key is
a hash of everything that makes it what it is — the full outgoing request, the frozen evidence, the
arm, the judge prompt and validator, plus the eval and imported production source that builds and
accepts the cell — so a resume never reuses a cell made under an older prompt or input. The commit
is recorded as provenance rather than used as the key. The report refuses to be written as final
until every expected cell is present, current and valid (`completedAt`); a failed judge reply
remains retryable and makes the report partial.

Each cell records the requested model, the model the response named, the generation id and the
upstream. The report has the table per arm — acceptable rate, primary quality, each criterion,
delivered rate, errors, words, first and repeat press cost, both latencies, cache read, truncations —
the noise figures, position bias, the frontier, and the options for Greg, in plain words with the
price of each per press and per hundred presses.

## Stages

1. **Plan** — this doc; Sol's plan review, taken.
2. **Build** — `evals/dig-deeper/` (examples, arms, capture, answer, check, judge, report, budget,
   the CLI), `npm run eval:dig-deeper`, an `evals/README.md` section, and
   `tests/dig-deeper-eval.test.ts` for the parts that can be wrong silently, **each seen red**: an
   arm's request is production's messages with only the declared fields changed and the
   search instructions really replaced; the shuffle decodes sentinels back to the right arm and
   balances positions; three answer draws create only two judged draws; the budget refuses before
   the call, uses a real byte upper bound and halts on missing cost; a judge reply
   with a missing, duplicate or extra label, or a score out of range, is refused; a cell key changes
   when the request does; the acceptance rules; the frontier; a returned model that does not match
   is refused. Then a smoke run (~$1: one example, three arms, one judge).
3. **Run** — capture, answers, checks, judges, the production-shaped finalist run, the probe (under
   tmux).
4. **Review** — Sol, workspace-write, on the eval code **with the numbers and my conclusion**,
   before anything is reported. Re-run what its fixes invalidate.
5. **Report** — the table into this doc and `evals/results/dig-deeper/`, a message to the Overseer
   with the questions for Greg. No production change.

## What the plan review changed

All nine of Sol's findings are taken. Two are reshaped:

- **F5's pairwise judging of finalists against Opus** is replaced by the anchor in every batch,
  which gives each answer a same-batch comparison with Opus at no extra call; the production-shaped
  finalist run adds a second look at the finalists.
- **F2's production-shaped finalist check** is kept but small: Opus and two finalists, one run per
  example.

## What building changed

Stage 2, 2026-10-01. Each is the closest sound option to what the plan said, and why.

- **A glossary press is anchored by production's `anchorIn`, not by the block the example was
  chosen around** (now exported from src/term-lookup.ts, with `refuseUnfinished`). The plan's
  anchors were the picker's; a real press anchors on the first block using the name or an alias.
  So `kuhn-challenge` anchors on the abstract (`spya-qm5580`, the same list of ten categories), and
  `seth-naturalism` on the heading *3: Life Matters* (`spya-tzj2rd`, the alias "Life matters") —
  which is what a reader pressing that entry sends today, a weaker sentence to aim the search with.
  The gold notes are unchanged: the judges have the whole article, or the declared evidence packet
  for the one article too long to fit beside a batch of answers.
- **A cell's key hashes the eval and imported production source that builds and accepts it, not the
  git commit.** Every request, the capture's hash, the arm and the ceiling are in it as planned; the
  commit is recorded on each cell instead. Keyed on the commit, any later commit — the stage-4
  review's own edits included — would have voided every paid cell; omitting the imported acceptance
  rules would have let a production rule change reuse an old result.
- **Citations capture runs production's press itself**, `makeInvestigateCitation` with production's
  deps and four seams: a fake allowance (the shared database's is not spent), a writer that refuses
  to save, timing wrappers round the search and the paper read, and a `run` that records the request
  and stops. So the frozen request is the body production would have streamed, built by
  `investigateRequest` inside the press. *Look it up* saves its find, as a first press does.
- **The finalist run, on Citations, streams the captured production request with the model
  swapped** (job `citation-investigate`, tool on) and applies `reading()`'s rules, rather than
  calling the whole press again, which would re-run the search, the lookup and the paper read and
  read different pages. Glossary and comment finalists likewise stream the captured request and
  apply the same acceptance switch and `refuseUnfinished` rule as `explainStream`. This keeps the
  request on the wire identical to the one keyed and budgeted; calling `explainStream` would rebuild
  it and silently drop the eval's safety field. Every finalist request adds `max_tool_calls: 8`:
  production's `max_uses: 8` is provider-specific and known to be
  ignored on some routes, so it cannot bound this eval's search bill. The reservation prices all
  eight possible $0.01 searches. The one-search compatibility probe uses a ceiling of one. Each
  answer's additional result extracts are stored on its cell and shown only inside its blind letter's
  judge section, so a judge can check sourcing without seeing an arm name or lending one arm's
  private results to another. A missing provider search count is printed as “not reported”, not
  silently turned into zero searches, and a result extract cut by the packet's context allowance is
  labelled as clipped rather than presented as complete.
- **No reader profile** on any press. The comment route sends one when the reader has written one;
  every arm here is pitched at the default reader.
- **The judges go through job `eval`, all three** — judging is not a press. Opus still thinks at
  `high` there (`wireEffort` keys on the model). The exact JSON shape and score ranges are checked
  in code. Round 1 removed the strict `response_format`, whose support had not been established for
  Sol and Kimi, and cut the judge ceiling from 12,000 to 8,000: the estimate and the smoke output
  put five score records near 2,500, while the unmeasured Sol and Kimi routes may also spend the
  allowance on reasoning. The separate long-article evidence packet means that allowance no longer
  competes with a ~255k-token article inside a nominal 262k context.
- **What a call cost is the ledger's own rule** (`totalSpend`, src/ai-spend.ts), not
  `usage.cost` alone. The smoke run found **Luna served BYOK**: `usage.cost` is a legitimate $0 of
  credits, and the inference is billed to our own OpenAI key. Read raw, Luna and the Luna draft
  would have priced at nothing. The report names every BYOK model.
- **Settling a call with no cost has three cases, not one.** A call that *finished* and reported
  none halts the run, as planned. One that *our clock cut off* (or that broke after answering) is
  settled at its step's whole upper bound, with a note — unknown but bounded; the smoke run's
  DeepSeek finalist hit explain's two-minute deadline and halted the run under the first rule, which
  would let one slow model stop the matrix. One *refused before it answered* (a 4xx, no model
  named, no tokens) settles at $0: OpenRouter does not bill it. Round 1 fixed a composite call's
  known first cost being added on top of the whole-step bound, and made the first invocation's cap
  durable so a later command cannot silently raise it.
- **The check's verdict may sit in one ```` ```json ```` fence**; anything else not exactly `keep` or
  a non-empty `replace` is a failed press.
- **A smoke panel cannot certify “acceptable”.** The threshold stays the declared two judges; it
  does not shrink to one. Repeated anchor ratings are averaged back to one vote per judge. Two
  judges pointing to the same normalized outside-knowledge fact also trigger the factual-error
  gate; unrelated external errors do not create false agreement merely because they share that
  marker.
- **Three answer draws, the first two judged.** The original single `runs` setting could not express
  the intended matrix: cutting the third judge run also cut the third answer draw. `judgeRuns` is a
  separate manifest field and flag now. Acceptable rate uses the 12 judged presses; delivery, cost
  and cache use all 18 answers.
- **A Citation repeat skips *Look it up* only after an `assessed` lookup.** A `found` response can
  still be `no-extract`, `not-identified` or `unreadable`, and production retries all three. New
  captures record that state; the frozen legacy captures lack it, so the report charges the retry
  in the conservative direction rather than treating “found” as “assessed”.
- **The bill, with all six captured** (the free, capture-only preflight calculation, 2026-10-02):
  about **$28.1** for the full matrix — answers $13.5, the first two answer draws' judging $5.9,
  the re-judge $2.6, the finalist run and its judging $6.0, and the probe a few cents — plus the
  $0.14 capture already spent. It fits under the $35 run cap; outputs remain assumptions (2,000
  tokens an answer, 2,500 a judgement), while reservations use a deliberately larger byte bound.
- **The isolated prompt now removes every claim that a web tool exists.** Round 1 found that both
  system prompts still promised the missing tool. Exact guarded replacements now cover explain's
  whole *Web research* section and Citations' opening claim as well as the three original edits.
- **A short case runs first, then the 255k-token Kuhn pair.** That spends little to establish each
  route and judge's JSON shape, then exercises the context-limit risk before buying the rest of the
  matrix; same-article cases remain adjacent for caching.
- **The long article is compacted only for judging.** Its full ~255k tokens plus as many as five
  4,000-token answers and a judge reply do not fit a nominal 262k window. Each Kuhn task therefore
  gets a stable packet (32KB and 10KB in the frozen captures) of its target, every gold-note block
  and nearby or short intervening spans. Answer arms still receive the whole article. The prompt
  names the omission so a judge cannot treat unseen sections as evidence; packets are keyed and
  cached separately because the two tasks contain different passages.
- **With all captures frozen, preflight does not open the database.** It reads the six capture
  files and builds the full bill locally; it opens the store only when it must make a stand-in for
  a capture that does not exist yet.
- **Probe results land after each call and resume by arm plus model.** A crash during the second
  probe no longer loses the first and buys it again. Once finalists exist, their two compatibility
  probes are part of report completeness; a missing probe makes the report partial.
- **Position bias uses the repeated control rather than a changing answer mix.** The report groups
  the Opus answer's own score by its position, and each non-anchor answer's score minus Opus in the
  same batch by that answer's position. A raw mean over all arms would confound order with quality.

## What running changed

- **The Kuhn PDF is judged whole.** Sol's pre-spend review (F13) had compacted any article over
  200k tokens into a gold-grounded packet, on the premise of a 262k window. The original judges
  were listed at 1M or more, so the article-only packet threshold became 600k and the test pinning
  it was seen red at 200k. Grok 4.7's replacement window is 500k, which still takes this run's
  ~231k-token request whole; `assertJudgeRequestFits` now checks each complete request against its
  actual judge's window before any future call, rather than relying on that historical threshold.
- **Kimi K3 could not be an answer arm or a judge.** It delivered 3 of 18 answers: every Kuhn
  request (~255k tokens) came back HTTP 429 across two separate sessions, and most other requests
  ran past explain's two-minute deadline. Those count as non-delivery, as they would for a reader.
  Nine first-session 429s (six Kimi, three DeepSeek on Kuhn) were set aside as `*.busy429` and
  re-bought once; DeepSeek then delivered, Kimi did not.
- **Grok 4.7 replaced Kimi as the third-family judge** (`evals/dig-deeper/judges.ts`, its own file
  because `arms.ts` is in every answer cell's key). Grok **did not cache the article prefix**: each
  Kuhn judge call re-read ~231k tokens at ~$1.05 (only 1,152 input tokens were reported as cached),
  and Opus wrote its Kuhn prefix twice because the judge's system prompt differs by entry point.
- **The judging matrix was trimmed to fit the budget**, recorded in the run's `manifest.json`
  (`trimmed`): Grok does not judge `kuhn-sapolsky` (two judges there), and the re-judge pass covers
  `feynman-millikan` and `kuhn-challenge` only (57 pairs). 120 of the 162 planned judge cells.
- **The run's cap was raised three times** — $37 → $38.60 → $38.70 — each time because a warm
  Opus Kuhn call (~$0.13 real) reserves its uncached bound (~$5.65). The auto-mode classifier then
  refused further waiting as a safety bypass; the Overseer took it to Greg, who allowed the run to
  finish under a hard **$50** ceiling for the whole eval. No cap was raised after that.
- **The production-shaped finalist run was not run** — it does not fit under the run's cap, and
  it is offered to Greg as a follow-up (~$7). The forced-search probe ran in the smoke only (Luna,
  DeepSeek: both forced a search).

**Budget-accounting total**: $37.5094 on run `main` (capture $0.14 included) + $1.2292 of smoke
runs = **$38.7386**, rounded to **$38.74**. Of that, $0.7320 is the deliberately conservative
upper bound recorded for ten timed-out calls whose providers reported no cost, so $38.74 is the
number consumed against the cap, not an exact provider bill.

## Result

The eval's own report is promoted to
[evals/results/dig-deeper/2026-10-02-main-report.md](../../evals/results/dig-deeper/2026-10-02-main-report.md);
Sol's review of these numbers and this conclusion (F22–F28, all fixed, *stands after my fixes*) is
[261001s-…-results-review-sol.md](261001s-dig-deeper-answer-model-eval-results-review-sol.md).

Run `main`, 2026-10-02: 216 answers (12 arms × 6 examples × 3 draws), 120 retained blind judge
calls by Opus, GPT-6.1 Sol and Grok 4.7, every cell in the declared trimmed manifest present. The
trim omitted 42 originally planned calls: the re-judge covers only two examples, and
`kuhn-sapolsky` has only Opus and Sol. Quality is each answer's overall score (1–10) minus the Opus
answer's in the same batch, so **0 = as good as Opus**. Cost is per press, warm
("repeat"), and includes the shared search step (~$0.024 average); first press is the cold write of
the article, averaged over the six examples, and dominated by the 255k-token Kuhn PDF.

| arm | delivered | acceptable | quality vs Opus | by the Grok judge | words | repeat press | first press | reader waits |
|---|---|---|---|---|---|---|---|---|
| **Opus 5.5** (today) | 18/18 | 8/12 | 0 | 0 | 337 | $0.085 | $0.74 | 19 s |
| Opus again (control) | 18/18 | 8/12 | −0.06 | −0.10 | 330 | — | — | — |
| **GPT-6.1 Sol** | 18/18 | **10/12** | −0.47 (all) / −1.23 (outside OpenAI) | −0.60 | 204 | **$0.036** | $0.25 | **12 s** |
| Luna + Opus check | 18/18 | 8/12 | −0.29 | −0.50 | 245 | $0.084 | $0.75 | 33 s |
| Grok 4.7 | 18/18 | 8/12 | −0.74 | (own family) | 235 | $0.136 | $0.38 | 46 s |
| Sonnet 5.5 | 18/18 | 6/12 | −1.24 | −1.70 | 270 | $0.065 | $0.38 | 14 s |
| DeepSeek V4.1 Flash | 17/18 | 3/12 | −1.23 | −1.00 | 350 | $0.028 | $0.03 | 41 s |
| Luna alone | 18/18 | 7/12 | −2.21 | −2.50 | 129 | $0.025 | $0.04 | 13 s |
| Sonnet 5 (the old set-up) | 18/18 | 1/12 | −2.38 | −1.90 | 329 | $0.063 | $0.38 | 7 s |
| Gemini 3.8 Flash | 18/18 | 2/12 | −2.79 | −2.40 | 214 | $0.037 | $0.10 | 15 s |
| GLM-5.3 | **8/18** | 2/12 | −1.35 | −1.00 | 290 | $0.071 | $0.05 | 71 s |
| Kimi K3 | **3/18** | 0/12 | −1.33 | −1.00 | 326 | — | — | — |

What it says, in plain words:

- **Opus has the highest quality point estimate**, but this six-example run does not establish that
  it is best. Luna + check's 90% interval (−0.64 to +0.17) and Sol's (−1.06 to +0.06) both include
  Opus; the second Opus draw is −0.06 with a −0.31 to +0.36 interval. The control therefore
  measures generation spread; it does not show that judges can reliably separate Opus from the
  closest alternatives.
- **GPT-6.1 Sol has the strongest acceptability result.** All ten presses with the full panel were
  acceptable. Both available judges also accepted each of the two `kuhn-sapolsky` presses, but the
  missing Grok vote means the predeclared rule cannot certify them: the report correctly says
  **10/12**, and no arm is certified on all twelve. Sol costs about **58% less per warm press** and
  waits **7 seconds less** than Opus. It is shorter (204 words to Opus's 337) and scores lower on
  depth (3.7 to 4.5). How far below Opus it is depends on who judges: Sol's own judge puts it above
  Opus (+0.92), Opus's judge well below (−1.75), and Grok, an outside-family judge rather than a
  neutral one, at −0.60. It is weakest on the long PDF's glossary term (−2.0 on
  `kuhn-challenge`).
- **"Luna writes, Opus checks" produces no meaningful saving.** Opus rewrote Luna's draft in 83%
  of presses. The measured warm total was $0.08437 against Opus's $0.08500 (under 1% saved), while
  its cold press cost slightly more ($0.748 vs $0.743) and the reader waits for both (33 s).
- **Kimi K3 and GLM-5.3 are not usable on this route and two-minute deadline**: they mostly failed
  to deliver at all.
- **Everything cheaper than Sol is clearly worse** (DeepSeek, Luna, Gemini Flash), and Sonnet 5 —
  the set-up before 261001p — is near the bottom.

Caveats: six examples; the arms answered without their own web tool, and the production-shaped
check of the finalists was not run; first-press cost averages over two 255k-token presses and is far
lower on an ordinary article. Judge-family effects are large and asymmetric: the Sol judge reverses
Sol's comparison with Opus (+0.92 versus −1.23 outside OpenAI), the Grok judge scores Grok at −0.50
versus −0.83 outside xAI, and the Opus judge puts every non-anchor arm below Opus. Grok is the third
family and is outside Sol's family, but **"neutral judge" overstates what the design establishes**.

## Simpler options passed over

- **Keep the web tool on and let each arm search.** Closer to production, but the arms would read
  different pages; kept only for the finalist run.
- **One judge.** Cheaper, but every judge here is also an arm and would grade its own family.
- **All twelve answers in one judge call.** A third of the calls, but scores compress and anchor on
  the set (Sol F5).
- **Three examples.** The minimum asked for; six lets each prompt have two.
- **Calling `explainStream` itself for every arm.** The truest path, but it carries the web tool;
  used for the finalist run only.

## Risks

- **Judges reward length and confidence.** The criteria name sourcing and invented searches, errors
  must point at evidence, and word counts are in the report.
- **A gold note written by a model** could be wrong. Each is grounded in block ids and was checked
  against the article; outside-knowledge lines are marked as hints.
- **Prices are today's listing**; per-call `cost` is what the numbers use.
- **Six examples is small.** The report says which differences clear the noise and which do not.
