# Write the release notes for the deploy about to happen

You are one run of `npm run changelog:prepare` (scripts/changelog/release-notes.ts), unattended.
The Overseer is about to deploy `dev`, and the notes you write go out **in** that deploy
(docs/plans/261001q). Read docs/project/changelog.md in full first, § The traps included, then
scripts/changelog/trawl-brief.md and copy-brief.md when you reach those stages.

## What is already done

The script has already promoted whatever production is serving into the history, and run
**step 2 for you**:

    npx tsx scripts/changelog/changelog.ts plan --upcoming {{SHA}} --work {{WORK}}

So `{{WORK}}` holds `upcoming.json`, `spine.json` (one version, no deployment id), `prefilter.json`
and the trawl batches. **Do not run `plan` again, and do not touch Vercel**: there is no deploy
list to fetch — this release has not been deployed yet.

## What you do

Steps 3 to 6 of changelog.md § Running it, every `changelog.ts` command with `--work {{WORK}}`:

3. **Trawl** — one Sonnet subagent per file in `{{WORK}}/batches`, writing to
   `{{WORK}}/items/<batch>.json`, launched once each. Sonnet has hit a weekly 429 on this login
   before; if one dies that way, use Opus subagents instead, at most 12 at once, and say so.
4. **`review-prompt`, then GPT Sol, then `verify`.**
   `npx tsx scripts/run-codex.ts --model sol --effort high --timeout-minutes 90 --sandbox review --prompt-file … --output …`
   with a fresh `--output` path. Check the exit code and that the answer file arrived. If Sol's limit
   has run out, **stop and say so** — never substitute another model and never skip the review.
   Apply any regroups `verify` prints yourself, then `verify --reassign`.
5. **`copy-inputs`**, then one Opus subagent per version (there is one), briefed from copy-brief.md.
6. **`npx tsx scripts/changelog/changelog.ts write --pending --work {{WORK}} --trawl-model <sonnet|opus>`**
   — `--pending` writes the release whole to `src/web/changelog-pending.json` instead of appending
   to the history. It refuses rather than writing a bad file.

Then `npm test -- tests/changelog-file.test.ts`.

## What you do not do

- **Do not commit, push, or deploy.** The script commits the pending file and pushes it once you
  exit; it reads your exit and the file, not your prose.
- Do not edit `src/web/changelog-versions.ndjson` — only `promote` appends to it.
- Do not touch `.env.local`, systemd, `infra/` or any database.
- Never quote a commit message to a reader; article prose never reaches the changelog.
- You are a one-shot `claude -p` run: the moment you end a turn, the process exits and nothing wakes
  you. NEVER arm a waiter, Monitor or cron and stop. Wait for Sol and any tmux job in the foreground
  (a bash loop polling for its `EXIT=` line, up to 10 minutes per call, repeated) and carry on in the
  same turn.

## Finish

A short debrief as your final message: how many commits and batches, which model the trawl ran on,
what Sol corrected or rejected, how many entries the pending release has and in which sections, and
anything you could not do. If you could not write the pending file, say why in the first line.
