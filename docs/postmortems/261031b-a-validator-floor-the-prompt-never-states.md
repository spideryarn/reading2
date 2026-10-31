# A validator's floor the prompt never states

On 2026-10-31 at 09:26Z, the first real run of the Sources digest in production (Greg, on the
consciousness paper, `arxiv-2308-08708-spya-xax6v4`) stopped at its first step with
*"The plan for the digest did not come back with enough usable questions to search…
[jb-digest-plan]"*. It cost one planner call, $0.23, and no searches. It reached one reader, an admin,
who reported it (`spya-f37ug4`). No digest was stored, and nothing wrong was shown as if it were
right. The feature had shipped in
the 06:53Z deploy (`5aab73ec`), so the defect had been live for two and a half hours; any digest
pressed in that window could have failed this way.

## What happened

All read-only, from production:

- **The job** `spya-skg6ny`: one step, `sources-digest`, 09:26:28 → 09:26:32, `failure_kind: retry`.
- **The one AI call** (`spideryarn.ai_calls`): purpose `digest-plan`, Sonnet 5.5 via OpenRouter,
  `outcome: ok`, 4.4 s, 89,717 article tokens written to the cache, **170 output tokens**.
  Production's key answered, so this was **not** the box's OpenRouter key (over its monthly limit
  until 1 November). Production's credential is a different one and was not over its limit.
- **The step-failure line** in Vercel's logs, the only copy of the count:

  ```
  step failed: sources-digest — arxiv-2308-08708-spya-xax6v4
  The plan had 1 usable leads (0 dropped), fewer than 3, so no search was sent. [jb-digest-plan]
  ```

So the model answered, the JSON parsed, the validator dropped nothing, and the model had written
**one** lead. The code refuses fewer than `MIN_LEADS = 3`. A lack of material is not a good
explanation: the paper is a long, heavily cited review, with plenty for every angle.

The prompt (`DIGEST_PLAN_SYSTEM`, `src/sources-digest.ts`) said:

```
WRITE UP TO 16 LEADS
…
- "cites": … About a third of the leads …
- "check": … A few …
```

A ceiling and some proportions give no clear lower bound; they do not rule out one lead. The floor
of 3 lived only in the code.

**Introduced by** `48b535ec8` (2026-10-30, "Sources digest stage 1: the sources-digest step"), in
the prompt and in `MIN_LEADS`, written in the same commit, in the same file, 250 lines apart. The
commit was mirroring `src/situate.ts`, whose planner asks for a **range**
(`WRITE ${MIN_QUERIES + 4}–${MAX_QUERIES - 1} SEARCH QUERIES`) and works in production. The digest
copied Situate's validator shape and its caps, but its prompt was rewritten around a ceiling.

## The class: a validator's floor the prompt never states

**The code rejects a model's answer for falling short of a number the model was never told.** A
cap the prompt states and the code enforces is fine: the model aims under it and the code catches
the rare overshoot. A floor is different. "Up to N" does not rule out one. Every floor in the
validator has to be in the prompt too, as the bottom of a range, or as an explicit "fewer is fine"
if the code really does accept few. Most of this repo's
"up to N" prompts say exactly that ("Fewer is fine, and none is fine", in `faq.ts`, `ideas.ts`,
`explanations.ts`), and their code accepts few. Swept on 2026-10-31: the digest was the only prompt
whose code demanded more than its prompt allowed.

## Why nothing went red

- **The tests stub the model.** `tests/sources-digest.test.ts` answers the planner with a
  three-lead `PLAN`, so the tests check what the code does with an answer the test chose. They cannot
  see what a real model does with the prompt. That is *a check that shares an assumption with the
  code it checks* ([silent-success.md](../reusable/silent-success.md)): the assumption here was that
  the model writes several leads.
- **The prompt was never run against a model before it shipped.** The box's OpenRouter key was at
  its monthly limit, and the plan said so: cost "estimated, not measured", a live measurement queued
  for 1 November (`qi-dykn3xjh`). That was honest, but it meant production's first press was the
  prompt's first test. The feature was behind the experimental switch, which limited who saw it,
  not whether it worked.
- **Two GPT Sol reviews (plan and code) and the browser pass** looked at fences, caps, quotes and
  the panel. Nobody set the prompt's wording beside the validator's constants, and nobody raised
  it, so this was not a reviewer talked round.

## What would have caught it, ranked by ease against value

1. **A test that reads the prompt for the floor.** `the planner is told the floor the code enforces`
   in `tests/sources-digest.test.ts` parses `WRITE a–b LEADS` out of `DIGEST_PLAN_SYSTEM` and asserts
   `a ≥ MIN_LEADS` and `b = MAX_LEADS`. Seen red against the old prompt, green after. **Done.**
2. **The prompt built from the constants, with an assertion between them.** `ASKED_MIN_LEADS` is
   interpolated into the prompt, and the module throws at load if it is ever below `MIN_LEADS`.
   **Done.**
3. **A rule in [prompting-guide.md](../project/prompting-guide.md): every floor the code enforces
   on a model's list is stated in the prompt**, as a range or as "fewer is fine" when the code accepts
   few. Costs a paragraph. **Done** (the doc's § on counts).
4. **One live call before a new model-driven stage leaves the experimental switch, or before it
   ships when no key is available.** Would have caught this and anything like it (a prompt the
   model reads differently from its author). The repo already has the habit for prompt *changes*
   (prompting-guide.md § measuring a change). Here the key was down, so the honest options were to
   wait a day or ship behind the switch. Shipping behind the switch was reasonable; what it missed
   was saying, at the shipping point, that "untested against a model" also meant "may not work at
   all". Not mechanised: whether to wait for a key is a judgement call.
5. **A generic lint that pairs every `MIN_*` with its prompt.** Rejected: floors and prompts are
   paired by meaning, not by name, and the one case in the repo is covered by item 1.

## The fix that is right for the long term

The long-term fix implemented here is: the prompt asks for `8–16` leads, says what to do when a piece
cites little (lean on "missed" and "cited-by" rather than write fewer), and the number asked for is
tied to the number refused by an assertion and a test. The threshold stays at 3: below that the
searched material does not justify the remaining reader calls and the Opus writer.

Re-planning automatically when a plan comes back short was considered and passed over. It would put
a second $0.23 call behind a prompt fault. Revisit it only if the live measurement shows short plans
after this fix.

Fix plan: [261031b](../plans/261031b-sources-digest-planner-asks-for-a-floor-of-leads.md).

## The thing I would tell myself

Writing `MIN_LEADS = 3` meant deciding that fewer than three is a failure. The prompt said
something different, and I never put the two side by side. When the code is going to reject an
answer, the model has to be told what it must reach, in the prompt, as a number. Here I copied
Situate's validator and wrote a new prompt, and the range in Situate's prompt was the part that
mattered.
