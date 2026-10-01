# `changelog.ts write` records the trawl model it was given

Overseer queue item `qi-6v66rb63` (authorised by Greg, 2026-09-11), from the changelog run of
2026-09-11 (`eb966c4b`). XS, tooling tier.

## The two problems

1. **The trawl model is a constant.** `scripts/changelog/changelog.ts` writes
   `generated_by: { trawl: "sonnet", review: "sol", copy: "opus" }` on every line. Sonnet is the
   doc's choice for the trawl, but it is rate-limited on some logins, so a run sometimes uses
   Opus. The 2026-09-11 run did, then hand-edited three lines to say so. Anybody who doesn't
   hand-edit records the wrong model, and nothing shows it.
2. **[changelog.md](../project/changelog.md) makes a false promise.** The build-stamp fallback in
   § Running it says a line enumerated from the build stamp "can be split by a later run with
   Vercel access". The file is append-only. Nothing rewrites a line, and `plan` finds the last line's
   `deployment_id` in the deploy list, drops everything up to it, and starts from that line's sha,
   so a later run never sees that range again. Under that append-only contract, the
   `8cd2206..c7d67cb5` line will always cover about seven real deploys.

## What changes

- **`write` takes a required `--trawl-model <name>`** and puts it in `generated_by.trawl`. With
  no flag, `write` refuses before it reads anything. `review` and `copy` stay constants: nobody
  has had to swap those models, and an option nobody needs is just another part.
  The comment over the constant gave the reason for having no flag at all: *"a flag would let a
  run record the wrong one by omission"*. A **required** flag doesn't have that problem, because
  leaving it out is a refusal rather than a default. The value must be one lowercase word or
  model id (`/^[a-z][a-z0-9.-]*$/`), which also catches a misplaced flag swallowing the next
  argument.
- **Step 6 of § Running it** shows the flag and says it names the model the trawl subagents
  actually ran on.
- **The build-stamp sentence** says what is true: a later run can't split the line, because this
  file no longer retains the join to the real deploys inside it. Signposting a fact, not a rule.

## The simpler option passed over

A default of `sonnet`, overridable with the flag. It's one character less work for most runs,
and it's exactly how the wrong model got recorded before: a run that used Opus and forgot the
flag would say Sonnet, and the line would look fine. Rejected.

## Tests

`tests/changelog-runner.test.ts`: `write` without `--trawl-model` refuses (red first, since today
it doesn't), and `buildLines` puts the given model in `generated_by.trawl`.
