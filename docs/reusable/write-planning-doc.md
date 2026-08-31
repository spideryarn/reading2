# Write a planning doc

> **Provenance.** Copied 2026-08-31 from
> [`docs/instructions/WRITE_PLANNING_DOC.md`](https://github.com/gregdetre/gjdutils/blob/main/docs/instructions/WRITE_PLANNING_DOC.md)
> in gregdetre/gjdutils — see [gjdutils-instructions.md](gjdutils-instructions.md). Upstream's
> `planning/` is `docs/plans/` here, and the naming convention has a script; the rest is close to
> verbatim. Upstream also defers to
> [`WRITE_EVERGREEN_DOC.md`](https://github.com/gregdetre/gjdutils/blob/main/docs/instructions/WRITE_EVERGREEN_DOC.md)
> and [`SOUNDING_BOARD_MODE.md`](https://github.com/gregdetre/gjdutils/blob/main/docs/instructions/SOUNDING_BOARD_MODE.md),
> neither of which has been copied here.

This is a guide for writing planning/project management `.md` files. These are for thinking through
& documenting decisions, breaking down complex projects into multiple stages, and tracking progress.

Aim to keep these concise, but emphasise & clearly capture all the decisions, responses, and
requirements from the user.

If you're starting the doc from scratch:

- Get the filename from `npx tsx scripts/plan-name.ts "<description of the work>"` (see below).
- Store it in `docs/plans/`, and first ask the user questions about their project requirements to
  clarify key decisions.

## File naming conventions

Planning docs follow this format: `yyMMdd[letter]-description-in-kebab-case.md`

- Date prefix: `yyMMdd` (e.g. `260831` for 31 Aug 2026)
- Auto-incrementing letter: a letter (a, b, c…) based on creation order within the same day, so
  files sort alphanumerically by creation date. Past `z` it runs `aa`, `ab`, … like spreadsheet
  columns.
- Description: lower-case words separated by hyphens. No exception for acronyms — `toc`, not `ToC`
  ([AGENTS.md](../../AGENTS.md) says lower-case kebab everywhere under `docs/`).
- Sometimes we end up with two docs sharing a day and letter, e.g. if several agents were working
  simultaneously. Don't worry if this happens.

**A plan's review artefacts share its letter**, so they sort next to it:

```
260828q-ai-cost-tracking.md
260828q-ai-cost-tracking-review-prompt.md
260828q-ai-cost-tracking-review-sol.md
260828q-ai-cost-tracking-review-sol.md.activity.log
```

[`scripts/plan-name.ts`](../../scripts/plan-name.ts) works out the next free letter for today —
that's the part you can't work out for yourself, and `docs/plans/` has hundreds of files in it. It
prints a path and creates nothing:

```
$ npx tsx scripts/plan-name.ts "Remote Claude box"
docs/plans/260831a-remote-claude-box.md
```

The same convention and the same script apply to `docs/research/` and `docs/postmortems/` — pass
`--dir` for those.

Update the planning doc regularly to keep the actions up-to-date. When you change it, make minimal,
focused changes, based on new user input.

## Document structure

Don't include a `Date` section at the top since it's implicit from the filename.

### Goal, context

- Clear problem/goal statement(s) at top, plus enough context/background to pick up where we left off
- If the goal is complex, break things down in detail about the desired behaviour.

### References

- Mention relevant evergreen docs (in `docs/project/`), other planning docs (in `docs/plans/`), code
  files/functions, links, or anything else that could provide context
- Try and be fairly precise and comprehensive (e.g. the specific files/functions/sections)
- Provide a brief 1-sentence summary for each of what it's about/why it's relevant
- Roughly prioritise most important/relevant/useful references at the top, e.g. high-level docs, key
  functions, etc

### Principles, key decisions

- Include any specific principles/approaches or decisions that have been explicitly agreed with the
  user (over and above existing project rules, examples, best practices, etc).
- As you get new information from the user, update this doc so it's always up-to-date.
- If there are any surprises/issues, stop immediately, and discuss with the user before proceeding.
- Name the simpler option you passed over, and why.

### Stages & actions

Overall approach:

- Break into lots of stages. Start with a really simple working v1, and gradually layer in
  complexity, ending each stage with passing tests and working code.
- List stages and actions in the order that they should be tackled
- Don't number the stages, so that it's easier to move them around without having to renumber
  everything
- Use `[ ]` and `[x]` checkboxes to indicate todo/done.
- Include subtasks with clear acceptance criteria
- Refer to specific docs, files/functions, examples, links, etc, so it's clear exactly what needs to
  be done
- Explicitly add tasks for writing automated tests, usually before writing code. (Perhaps one or two
  end-to-end tests first, then gradually adding more detailed tests as complexity grows). Explicitly
  add tasks for running the automated tests before ending each stage.
- If there are actions that the user needs to do, add those in too, so we can track progress and
  remind the user.
- Add actions to stop & review with user where appropriate, e.g. when we get to a good stopping
  point, to manually check changes to the user interface, etc
- Add actions to search the web where appropriate, e.g. when debugging, determining best practices,
  making use of 3rd-party libraries, etc
- Add actions to update relevant `docs/project/*.md` evergreen docs. If you think we need a new
  evergreen doc, ask the user
- Explicitly say to use subagents for encapsulated tasks or where the task will create a lot of
  verbose content, e.g. checking browser console output, doing research
- Try to surface potential risks early. For example, if the whole plan rests on the library being
  able to do X, let's do a quick trial to make sure that works.
- Try to organise the stages so that we frontload the business value, so that we could stop partway.
  For example, get it working for the primary/most valuable use-case first.

Upfront preparatory actions:

- Pull the latest changes before we start, to make merge conflicts less likely.
- Upstream suggests a branch per project. **Not here** — several agents share this working tree and
  switching or rebasing branches is forbidden ([AGENTS.md](../../AGENTS.md)).

At the beginning of stages:

- Add an action to write some tests (i.e. before writing code), or to update tests with new edge
  cases (as we add new functionality and layer in complexity). Edge cases should have been
  agreed/prioritised with the user, otherwise stop to discuss them.

After creating the initial planning doc:

- **External critique stage**: get external feedback on the planning approach
  - Commit the initial planning doc first (pre-critique version)
  - Seek feedback from other AI models, team members, or domain experts — here that means GPT Sol
    via [codex-cli-as-subagent.md](codex-cli-as-subagent.md), and it is required, not optional
  - Update planning doc with critique insights and revisions
  - Commit the revised version

At the end of a stage (where appropriate):

- If doing UI-related changes, add an end-of-stage action to check things look ok with browser
  automation tools (provided with rich description of the background/approach to take/success
  criteria).
- **Add health check actions** — use judgment to include appropriate checks based on changes made:
  - **Type checking** (`npm run typecheck`): when modifying typed code, especially API routes, type
    definitions, or core logic
  - **Linting** (`npm run lint`): when adding new files or significantly modifying existing patterns
  - **Testing** (`npm test`): when changing logic that has test coverage
  - **Build verification**: reserve for major changes or final validation — builds are slow
  - **Decision criteria**: choose checks that are likely to catch regressions from the specific
    changes being made. For small isolated changes, lighter checks suffice. For core system changes,
    run comprehensive checks.
- Follow [debrief-progress.md](debrief-progress.md) to output a summary of where things stand
- Update this planning doc with progress so far, log useful learnings/surprises/changes of plan/etc.
- Add an action to stop & review with the user where appropriate.
- Git commit, following [git-commit-changes.md](git-commit-changes.md).

In later stages:

- Add actions to update relevant `docs/project/*.md` evergreen docs. If you think we need a new
  evergreen doc, ask the user
- Add actions to update logging/monitoring if needed

As final actions:

- **Final health check** — run comprehensive validation before completion: build, linter, test
  suite. Only include checks that are relevant to the changes made during the project.
- **Test consolidation** — use a subagent to:
  - Search for all tests added during this work
  - Identify redundant or low-level tests that will be brittle
  - Consolidate into fewer, high-coverage integration or E2E tests
  - Aim for net reduction in test count while maintaining coverage
- Leave the doc in `docs/plans/`. Upstream moves finished docs to `planning/finished/`; here they
  stay put, and the date prefix already says when the work happened.

Example stages & actions (no need to include the words `TODO` or `DONE` explicitly, since the `[ ]`
todo-checkboxes capture that):

```
### Stage: High-level description of this stage
- [ ] This is a top-level action
  - [ ] It can have sub-actions that get ticked off
    - You can add bulletpoint notes with extra detail/context to help plan & shape future actions

### ✅ This stage has already been completed
  - ✅ This action has already been completed
    - 📔 You could journal about useful/unexpected discoveries when you update progress on completed tasks
  - ❌ This action has failed/been skipped
```

## Appendix

Add any other important context here, e.g.

- Summary of web searching
- Example data
- Code snippets & mentions
- Relevant tests
- Rich background, quotes, and context, especially from conversations/decisions from the user
- Alternative approaches that were considered but discarded — describe the desiderata, tradeoffs,
  and especially the approach we did pick and the rationale.
- Other information that should be captured but didn't fit neatly in the above sections
