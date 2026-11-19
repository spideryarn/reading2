# The Sources digest's planner is asked for a floor of leads, not only a ceiling

Report: `spya-f37ug4` (#745), Greg, 2026-10-31 09:27Z, production, on the consciousness paper
(`arxiv-2308-08708-spya-xax6v4`), Sources › Digest. Postmortem:
[261031b-a-validator-floor-the-prompt-never-states.md](../postmortems/261031b-a-validator-floor-the-prompt-never-states.md).
The feature: [261030b](261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md).

## What happened (the evidence, all read-only)

- **The job** `spya-skg6ny`: one step, `sources-digest`, 09:26:28 → 09:26:32, `failure_kind: retry`,
  `[jb-digest-plan]`.
- **The one AI call** (`spideryarn.ai_calls`): `digest-plan`, Sonnet 5.5 via OpenRouter,
  `outcome: ok`, 4.4 s, 89,717 tokens of article written to the cache, **170 output tokens**, $0.23.
  Production's key answered: this was **not** the box's over-limit key and not a budget error
  (production uses a different credential, fingerprint `49a901286417`).
- **The step-failure log line** (Vercel, deployment `dpl_975areFUNtt6f8kmbzJYKRZkfp3m`):
  `The plan had 1 usable leads (0 dropped), fewer than 3, so no search was sent.`

So the model answered well-formed JSON with **one** lead. That lead survived every per-lead check;
the whole plan then failed only at the count floor, because `MIN_LEADS` is 3. A lack of material is
not a good explanation: the paper is a long, heavily cited review with plenty for every angle.

## The cause

The missing floor is the contract defect and enough to explain one lead. It is not proven to be the
only cause, from one model draw: structured output guarantees shape, not how many. The live
measurement after 1 November says whether the range is enough. If it is not, the closing reminder
repeats "write 8–16 leads" next.

`DIGEST_PLAN_SYSTEM` says **"WRITE UP TO 16 LEADS"** and describes the mix in proportions ("about a
third", "a few"). A ceiling and some ratios give no clear lower bound; they do not rule out one
lead. The code's floor, `MIN_LEADS = 3`, is never said to the model. Situate's planner, the one this
stage mirrors and which works in production, asks for a **range**
(`WRITE ${MIN_QUERIES + 4}–${MAX_QUERIES - 1} SEARCH QUERIES`, 12–15 today). The digest's prompt was
never run against a live model before it shipped (the box's key was over its limit; 261030b says
"estimated, not measured"), so the first real run was the first test.

## The change

1. **The prompt asks for a range**: `WRITE ${ASKED_MIN_LEADS}–${MAX_LEADS} LEADS`, with
   `ASKED_MIN_LEADS = 8`, and a line for a piece that cites little: lean on `missed` and `cited-by`
   rather than writing fewer. A module-load assertion keeps `ASKED_MIN_LEADS ≥ MIN_LEADS`, so the
   number asked for can never fall below the number refused.
2. **A test that reads the prompt**: it states a lower bound, and
   `MIN_LEADS ≤ ASKED_MIN_LEADS ≤ MAX_LEADS`. Written first and seen red against today's prompt.
   The module also throws at load if those three ever disagree.
2b. **`minItems: 1` on `leads`, each lead's `blocks` and `queries`** (GPT Sol, plan review F2): the
   most the schema language can say. It cannot prevent this failure (one lead), but the repo's rule
   is that a schema states every live invariant it can.
3. **`PROMPT_VERSION` → `sources-digest/3`.**
4. **The message** (`SOURCES_DIGEST_TOO_FEW_LEADS`), against copy.md: "the plan" is our word, not
   the reader's, and "none was sent" has no clear antecedent. Kind stays `retry`: after the fix a short
   plan is a model wobble, and a fresh plan is the way out. New text:
   *"The AI service did not return enough questions to search for this digest, so no searches were
   run. Try again: each try starts afresh. [jb-digest-plan]"* ("the AI service", per copy.md; and
   no "usually works", which is unmeasured — GPT Sol's F3.)

The threshold stays at 3: below that there is too little searched material to justify paying for
the readers and the dearest call, the Opus writer.

## Passed over

- **Lower `MIN_LEADS` to 1.** Simplest, and it would have let this run through — into ~$0.7 of
  searches, readers and an Opus writer for a one-question digest. The floor is right; the prompt was
  wrong.
- **Re-plan automatically once when the plan is short.** Hides a prompt fault behind a second
  $0.23 call and adds a loop; the reader's own retry does the same, and the log line already counts
  what the model wrote. Revisit if the live measurement shows short plans after this fix.
- **`minItems: 8` in the schema.** Anthropic structured outputs accept only 0 or 1
  (`src/messages-structured-output.ts`), so it cannot say 8; it says 1 (2b).

## Not measured yet

The fix cannot be run against a model from the box until its OpenRouter key resets on 1 November.
The measurement is already queued (`qi-dykn3xjh`, "measure a real run"); this plan adds to it: check
`leadsWritten` on three or four articles, the consciousness paper among them.

## Progress

- 2026-10-31: diagnosed from the production row, ai_calls and the log line; plan written.
- 2026-10-31: GPT Sol plan review ([261031b-plan-review-sol.md](261031b-plan-review-sol.md)), verdict
  *revise*, five findings, all taken except its fourth's signpost under `postmortems.md` (that doc
  lists no files). Built.
