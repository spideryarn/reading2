# Spideryarn

An experiment in AI-assisted reading that **augments** rather than replaces reading.

> it augments human cognition, but it doesn't replace it … instead of trying to make things too
> easy, trying to replace the words with quick and easy summaries so much, but rather we help the
> user get what they need from it, help them read efficiently, but deeply, help them internalize and
> interrogate.
>
> — Greg, 2026-08-24

The product is **Spideryarn**; `reading2` is just the directory and the repo. `CLAUDE.md` is a
symlink to this file — there is only one of it, so edit either name freely.

**This file is a signpost, not a spec**, and it is loaded into every agent's context on every turn,
so it stays short. Everything real lives in `docs/project/`.

## Docs

Start with [vision.md](docs/project/vision.md) — what we're trying to do, and what we're
deliberately not doing.

Then there are seven **entry-point docs**, and they are the way in. Each is a map of its area with a
line on every doc beneath it, saying what is in it and why you'd open it. Only these seven are
listed here; the names under each are files in `docs/project/`.

- **[vision.md](docs/project/vision.md)** — the intent, the principles, the anti-goals, and the two
  exceptions Greg has made to "prefer boring".
  <br>↳ `open-questions.md` · `positioning.md` (the website, the name, who it speaks to first) ·
  `original-version/` (the larger app this is an offshoot of)
- **[architecture.md](docs/project/architecture.md)** — the pipeline stage by stage, what a block
  is, who owns which stage, where the data lives.
  <br>↳ `block-ids.md` · `fetching.md` (stage 1) · `content-extraction.md` (stage 2, and there are
  two) · `hierarchy.md` ·
  `article-images.md` (stage 4.5 — the figures the piece came with, hosted by us) ·
  `ingest-queue.md` (paste a URL, get an article) ·
  `ai-gateway.md` (every paid call goes through OpenRouter, bar one declared exception) ·
  `prompt-caching.md` · `database.md` ·
  `sql.md` (columns over JSON, keys over good intentions) ·
  `export.md` (one article's data, out)
- **[reading-view-overview.md](docs/project/reading-view-overview.md)** — everything the reader
  sees: the spine, the prose, and the band the modes take turns in.
  <br>↳ `web-client.md` (where the client code is) · `new-mode.md` (the checklist) ·
  `granularity-zoom.md` ·
  `column-context.md` (the gist column's fisheye) · `glossary.md` · `summaries.md` ·
  `ideas.md` (the propositions the piece assumes) ·
  `quotes.md` (the lines worth keeping) ·
  `timeline.md` (when the piece says these things happened) ·
  `search.md` · `referee-mode.md` (helping a peer reviewer, without reading for them) ·
  `diagram.md` ·
  `comments.md` (bookmark or annotate a passage; the AI is a tick-box) ·
  `chat-tools.md` (what chat may call) ·
  `live-conversation.md` (talking to the article out loud) ·
  `remember-mode.md` (say what you took from it, and find out) ·
  `quiz.md` (the other half: the article asks, you answer) ·
  `links.md` (hover cards on the article's own hyperlinks) · `tooltips.md` · `keyboard.md` ·
  `touch.md` · `url-state.md` · `library.md` (the shelf) ·
  `public-shelf.md` (the other one: `/read/public`, for strangers) · `page-titles.md` ·
  `reader-profile.md` · `experimental-features.md` (the switch on /profile) ·
  `dictation.md` (talking into a text box) ·
  `copy.md` (reader-facing failure messages) ·
  `website-text.md` (the landing page, the contact address) ·
  `privacy.md` (what we do with a reader's data, and the page that says so)
- **[design-css-overview.md](docs/project/design-css-overview.md)** — the map for anything visual:
  the stylesheets and their order, which mechanism owns a given rule, the colour and type tokens.
  Its live counterpart is `/design`.
  <br>↳ `colour-scales.md` · `icons.md` ·
  `marketing-pages.md` (the signed-out pages, and how to shoot a screenshot that shows what it
  claims to)
- **[security-map.md](docs/project/security-map.md)** — start here for security: the untrusted
  parties (none of them is another reader) and where each defence physically lives.
  <br>↳ `security.md` (the deep dive) · `auth.md` · `admin.md` (the one view across owners) ·
  `billing.md` (what a slot is, and what stops a script taking twenty)
- **[code-quality-overview.md](docs/project/code-quality-overview.md)** — the commands that tell you
  whether what you just did works, and which of them are gates.
  <br>↳ `testing.md` · `typechecking.md` · `linting.md` · `static-analysis.md` (`npm run check`) ·
  `browser-control.md` (which browser automation on which machine — start here) ·
  `browser-testing.md` (what to check) · `browser-testing-playwright.md` (the same, on the box) ·
  `claude-in-chrome.md` (the laptop extension: nothing connected?) · `performance.md` ·
  `counting-lines.md` (how big the repo is)
- **[dev-and-deployment-overview.md](docs/project/dev-and-deployment-overview.md)** — running it on
  your laptop, the command for each pipeline stage, and shipping it to Vercel.
  <br>↳ `debugging.md` (start here when something is broken) · `setup-dev.md` (including which model
  each job uses) · `supabase-local.md` · `version-control.md` · `deployment.md` ·
  `vercel-hosting-deployment.md` (reading the logs) · `sentry-error-monitoring.md` · `logging.md` ·
  `feedback.md` (the Feedback button, and where a bug report goes) ·
  `feedback-reports.md` (and what an agent does with one afterwards) ·
  `hetzner-remote-server-box.md` (the always-on box, and `gjd-remote`) ·
  `changelog.md` (turning deploys into the public `/changelog`) ·
  `worktrees.md` (one tree per agent, and how to start one)

Two of those are worth reading before you touch anything they bear on:
**[granularity-zoom.md](docs/project/granularity-zoom.md)**, the feature this whole app is for, and
**[block-ids.md](docs/project/block-ids.md)**, the contract everything else depends on — see below.

Docs are cross-linked, so a doc often appears under an entry point other than the one that owns it.
That's fine. Every doc has exactly one owner, and `tests/doc-links.test.ts` enforces it.

### The other folders

- **`docs/plans/`** — one file per piece of work, written before it lands and kept afterwards, so
  the reasoning and the evidence survive. A plan names the simpler option it passed over, and why.
- **`docs/postmortems/`** — one file per bug worth understanding: the real root cause and the name
  of its class, the commit that introduced it, the fix that's right for the long term, and what
  would have caught the class.
- **`docs/tutorials/`** — self-contained HTML explainers of how one area works, written for somebody
  who has never read the code — [reusable/write-tutorial.md](docs/reusable/write-tutorial.md) is how
  to write one.
- **`docs/research/`** — the working behind a decision: the options weighed, the sources, the dead
  ends. A plan says what we're doing; a research doc says what else we could have done and why not.
- **[`docs/reusable/`](docs/reusable/README.md)** — notes that aren't about this project and are
  meant to be carried elsewhere, several copied in from Greg's
  [gjdutils](https://github.com/gregdetre/gjdutils/tree/main/docs/instructions) library of "how to
  do this kind of task well" instructions. **When a task matches one, follow it rather than
  inventing a process.** The index is [docs/reusable/README.md](docs/reusable/README.md); the one
  worth knowing unprompted is [silent-success.md](docs/reusable/silent-success.md). One of them is a
  **ritual rather than a reaction**: [improve-the-codebase.md](docs/reusable/improve-the-codebase.md)
  is a whole-tree sweep for the rework worth doing, run every week or so — suggest it when nobody has
  run one lately.

None of those first three is indexed here — there are a lot of files and they keep arriving. List
the directory and read the file names; they say what each one is about, and the first paragraph of
the file says the rest. They are named `yyMMdd<letter>-kebab-description.md`, so they sort by the day
the work started; a plan and its reviews share one letter. Get the name from
`npx tsx scripts/plan-name.ts` — [write-planning-doc.md](docs/reusable/write-planning-doc.md).

## The one contract that matters

Every block of the article gets a **stable id** (`spya-k3m9qt`), and every feature — Hierarchy, summaries,
scroll position, highlights, notes, questions — addresses text by that id, never by character offset
or CSS selector. Ids are minted once and preserved on every later run, so they survive re-extraction.

The format, the reasoning, and the one way to get range checks silently wrong are in
**[block-ids.md](docs/project/block-ids.md)** — read it before touching anything that resolves an id.

## How we write docs here

A doc under `docs/project/` is two things: **intent** — Greg's directions, the goals, the
constraints, the decisions and why they were made, mostly in his own words — and **signposts** to
the other docs and to the code. Not descriptions of code, which the code already provides.

- **Less is more.** Where Greg gave instructions, follow them rather than embroidering. Say each
  thing once, briefly, and leave the next agent room to use its judgment.
- **Update the docs as you go.** If you change what something does, fix the doc in the same piece of
  work.
- **Every doc has a parent.** New doc under `docs/project/` ⇒ add a line for it to the entry-point
  doc that owns it, and link back up. Only the seven are listed in this file, and
  `tests/doc-links.test.ts` fails if a doc has no owner or two.
- **Editing a doc whose wording is a rule** — this file above all, the seven entry points,
  anything in `docs/reusable/` — goes one approved set of changes at a time, with the before and
  after shown: [edit-important-docs.md](docs/reusable/edit-important-docs.md).
  **Signposting is not a rule**, so adding a new doc's line under its entry point, or tweaking a
  pointer's wording, needs no approval — just do it. Greg, 2026-09-02.
- **File names are lower-case kebab-case**, everywhere under `docs/`, even when copied in from
  somewhere that shouted. Rename on sight and fix the links.
- **Quote Greg directly** — his exact wording, in a blockquote, attributed and dated. The phrasing
  carries intent that a paraphrase loses. If you find you've flattened a quote into your own voice,
  put his back.
- **Signpost heavily**, both directions, deep-linking to sections, and out to the code
  (e.g. [`src/blocks.ts`](src/blocks.ts)). **Cite, don't restate.** Give a fact one home. For facts
  held in code, cite the defining file and stable name — `` `src/models.ts` § `STAGE_EFFORT` `` —
  rather than copying a value or line number. For inventories, record the command, scope and run
  date; treat its output as a dated example. Otherwise record the source, date and confidence or
  status. [Why](docs/research/260903b-facts-that-were-wrong.md).
- **Record decisions where they belong.** When something in
  [open-questions.md](docs/project/open-questions.md) gets decided, write it into the relevant doc
  and delete the question. That file should shrink.
- **Harness memory is not where knowledge lives.** An agent's own auto-memory is for its
  preferences, machine-local state, and a pointer to a thread left open. Anything a future reader
  would need — a trap, a decision, a rule — goes in the doc that owns it, where Greg and the other
  agents can see it too.
- **Write down anything a future reader would otherwise have to reverse-engineer** — especially why
  a design went one way rather than the obvious other way, and *especially* where the decision went
  against the recommendation written down at the time.
- **Keep this file short.** Detail goes in the doc; this file gets a line.

## Working agreements for agents

The rules are here; the reasons are behind the links. Several exist because of a specific accident,
and the write-up is worth reading once.

**This is a beta, and speed still wins.** There are real, paying readers since 2026-09-03, but the
readership is small and knows what it signed up for, so we go on optimising for how fast we can
move. It is not the end of the world if something is briefly broken — a database migration that
lands before the code that matches it, and breaks production for the minutes in between, is fine.
What we are not trading away is design: write code that will still be good to work with in six
months. It loosens nothing in **Real data belongs to the reader** below.

**Explain plainly and briefly.** Whenever you explain, summarise or ask a question — in chat, in a
doc, in a commit message.

**Real data belongs to the reader, not to us.** There is one production database and no staging copy
of it, and what is in it is real people's articles, comments, notes and profiles. Reading it is fine.
Anything that changes it — an insert, an update, a delete, any script pointed at the remote —
**ask Greg first when it is major, destructive or risky**, even mid-task. An ordinary additive
migration is none of those: read it, apply it, and say what you ran. What still needs asking is
anything that wipes or overwrites data you did not create — `npm run db:reset` empties the database
and puts nothing back ([supabase-local.md](docs/project/supabase-local.md)) — and anything
destructive on the remote, a dropped column included.
Whatever you run, read its `Target:` line rather than its success line: which database a command
actually reaches is not always the one on its command line, and both mistakes print
`✓ migrations applied` —
[database.md § `DATABASE_URL=… npm run db:migrate` does not do what it looks like](docs/project/database.md#database_url-npm-run-dbmigrate-does-not-do-what-it-looks-like).

**Work in a worktree, not in this checkout.** Before your first edit, check where you are: if
`git rev-parse --git-dir` and `git rev-parse --git-common-dir` print the same path, this is the
shared primary. Call the `EnterWorktree` tool (or launch with `claude --worktree <name>`), run
`npm run worktree:setup` inside it, and land the work with `git push origin HEAD:dev` —
[worktrees.md](docs/project/worktrees.md). A doc edit or a one-line fix may stay here; anything
that touches code moves. Run the job itself the way
[engineering-manager.md](docs/reusable/engineering-manager.md) says — a plan doc, a few stages,
the work delegated, and a GPT Sol review at the end of every stage. Commit each stage, push to
`dev` when you finish, and then remove the worktree if everything is green and done.
**Before deleting a worktree, run `npm run worktree:check` inside it** —
`data/` and `.env.local` are gitignored, so a clean `git status` says "safe" over the top of work
nothing else has a copy of.

### Working in a tree several agents share

- **Check which machine you are on.** `/home/greg/` is probably the Hetzner box, `/Users/greg/` is
  Greg's Mac. A change to either that should still be true next week — a package, a key in
  `.env.local`, a config — is also a change to the file that builds the next box, so ask Greg whether
  to make it so now, going forwards, or both —
  [hetzner-remote-server-box.md § A change to the box is a change to a file](docs/project/hetzner-remote-server-box.md#a-change-to-the-box-is-a-change-to-a-file).
  On the Mac, more caution: a different OS, and not disposable — spike it first where that is safe.
- **Other agents will get in your way; be tolerant.** Every tree shares one local Supabase and one
  dev server, and anyone still in the primary shares its files too. Files change under you, tests go
  red for reasons that are not yours, the database is not how you left it. Absorb it, do your best,
  and carry on — don't try to fence yourself off. If you are in the primary, accept that other
  agents may be editing there too, and that committing some of their changes along with yours is not
  the end of the world.
- **Commit and push to `dev`.** That is the trunk, and a push there builds nothing. `main` is
  production and is written only by `npm run deploy` — pushing to it yourself is an unreviewed
  deploy to real readers, and **nothing mechanical stops you**:
  [version-control.md § What protects `main`](docs/project/version-control.md#what-protects-main-and-what-does-not).
- **Stay inside your stage.** Talk to other stages through the artefacts they write, not by reaching
  into their code — [architecture.md § Stage ownership](docs/project/architecture.md#stage-ownership).
- **Never run a git command that throws work away.** No `git checkout -- …`, `git restore`,
  `git stash`, `git reset --hard`, `git clean`, no switching or rebasing branches — not even "just
  on my own file", because you can't tell whose edits are in it. Other agents' unsaved work is in
  this tree and there is no second copy. Undo your own mistake by editing the text back. If you
  think you really need one of these, ask Greg first.
- **Always merge, never rebase** — including in your own worktree, where the reason above doesn't
  apply but the rule still does. Integrate with `git merge`. Six reasons, two of them specific to
  this repo, in
  [version-control.md § Always merge, never rebase](docs/project/version-control.md#always-merge-never-rebase).
- **Commit only your own files, by name, in one command:**

  ```
  npm run check:staged-revert
  git add -- <any NEW files> && git commit -F <msg> -- <all your files>
  ```

  The first line asks whether the shared index is quietly undoing somebody's commit — the guard
  written after the day that cost six hours, and reachable until 2026-09-03 only by somebody who
  already knew that story
  ([version-control.md](docs/project/version-control.md#commit-your-own-files-by-name-in-one-command)).
  The second is the whole recipe, and it is one command so there is no gap for a peer to land in. The
  trailing `--` pathspec commits those paths **from the working tree, ignoring the index**, so
  whatever anyone else has staged is neither committed nor disturbed. `git add` is only for files
  git does not know about yet — a pathspec cannot name an untracked file. Use `-F <file>`, not
  `-m`. Never `git add -A`, `git add .` or `git commit -a`.

  **Do not put `git reset` in front of it.** The recipe used to, and that was a mistake: the
  pathspec already makes the index irrelevant, so the reset buys you nothing and throws away
  whatever a peer had staged.

  **If a peer has unfinished work inside a file you are committing**, the pathspec form takes their
  hunks too. That is usually fine: commit it and say in the message whose work rode along. Nothing
  is lost and it is not worth stalling over — leave the file out only if their half-done change
  would break the build. Look first with `git diff HEAD -- <file>`, never bare `git diff`, which is
  index-relative and lies in both directions here. **There is no third option**: the private-index
  recipe (`GIT_INDEX_FILE`, `commit-tree`, `update-ref`) was removed on 2026-08-30 after it silently staged a revert of other people's work
  across the whole tree for six hours. Do not reinvent it.
  [version-control.md](docs/project/version-control.md) has the accidents and the reproductions.
- **A merge conflict is a proposal before it is an edit.** Read the history behind both sides, keep
  the best of both, and show Greg the proposal before you change anything —
  [git-resolve-merge-conflicts.md](docs/reusable/git-resolve-merge-conflicts.md).
- **Commit when the work is done**, or when you reach a good stopping point, without being asked —
  **and push it.** Unpushed work is invisible to the other machine and to every check that asks
  whether it landed.

### Before you call it finished

- **Run `npm test` and `npm run typecheck` when you finish a change**, not at commit time — both are
  deterministic and take seconds, and finding out an hour later is the expensive way to find out.
  `npm run lint` on the files you touched; its baseline isn't clean, so it's advice, not a gate.
  [code-quality-overview.md](docs/project/code-quality-overview.md).
- **Reproduce a bug with a failing test before you fix it.** Write the test first and watch it go
  red — a test that was never red proves nothing. Then fix, and check it goes green.
- **A check you have never seen fail is not evidence.** Most of a day's bugs here have been
  something reporting success while doing nothing, with the obvious check agreeing because it shares
  an assumption with the code — [silent-success.md](docs/reusable/silent-success.md).
- **Get a cross-family review before you commit.** Every plan under `docs/plans/` goes to GPT Sol
  before it is built, and the code built from it goes back for a second review — weight that second
  one higher, because a plan-stage review can't find a `PATCH` that writes one field and then
  rejects the request.

  ```
  npx tsx scripts/run-codex.ts --model gpt-5.6-sol --effort high --timeout-minutes 45 \
    --prompt-file <review-prompt> --output <review-answer>
  ```

  Hand it the evidence — the scoped diff, the results file, the script that produced a number — not
  just the prose. Check each finding yourself; some are wrong. And check a verdict actually arrived,
  exit code *and* answer file, because a review that returned nothing looks exactly like one that
  found nothing. [codex-cli-as-subagent.md](docs/reusable/codex-cli-as-subagent.md).
- **Root-cause every bug in a subagent, and write it up** under `docs/postmortems/`: the real cause
  rather than the line that broke, **the class it belongs to, named**, which commit introduced it,
  the fix that's right for the long term, and what would have caught the whole class of it — ranked
  by ease and value where there is more than one.
- **"Close this tab if successful" means exactly that** — close it with the recipe in
  [iterm.md](docs/reusable/iterm.md), and only once the work in that conversation is actually done
  and its checks passed. If anything failed or is unfinished, leave the tab open and say why.

### Delegating

- **Do browser work in a Sonnet subagent.** It's mostly click-look-click and the screenshots are
  large, so keeping them out of the main context is worth more than the extra reasoning. Tell it to
  read [browser-control.md](docs/project/browser-control.md) then
  [browser-testing.md](docs/project/browser-testing.md) first, and ask it back for the conclusion,
  not the page dumps. **Which automation you get is decided by the machine, not by preference** —
  the Claude-in-Chrome extension on Greg's laptop, Playwright against system Chrome on the remote
  box, and the extension cannot follow you there.
- **Ask another model while you are still thinking, not only when you are reviewing.** GPT Sol
  ([codex-cli-as-subagent.md](docs/reusable/codex-cli-as-subagent.md)) for design calls and tricky
  bugs, and **Fable** — a subagent with `model: "fable"` — especially when the requirements are
  unclear or you need someone to arbitrate between two options that both look fine. Fable is a
  different **model**, not a different **family**, so it is never the cross-family check; only Sol
  is that. And no subagent is read-only by construction — an `Explore` lacks `Edit` and `Write` but
  keeps an unrestricted `Bash`, so "don't edit" is a brief you write, not a boundary you get
  ([engineering-manager.md § Delegate](docs/reusable/engineering-manager.md#delegate)).
- **When you rename anything, hunt down everything that names it.** A rename is never one edit. Send
  a cheap subagent to sweep the whole repo — code, docs, plans, tests, fixtures, scripts,
  `package.json` — and grep for fragments as well as the whole name, since a `camelCase` rename and
  its `kebab-case` twin don't match the same pattern. Decide each hit yourself.
  [rename-or-move.md](docs/reusable/rename-or-move.md) — but ignore its advice to branch, which
  isn't allowed here.

### Writing code

- **The store is Postgres and Supabase Storage, and there is only one.** The filesystem store and
  `SPIDERYARN_STORE` are gone as of 2026-09-05; setting the flag now throws
  ([`src/store/live.ts`](src/store/live.ts)) rather than being ignored. **That includes your
  laptop**: the suite needs a database rather than a flag. A feature exercised only on files was a
  feature that shipped broken, which happened once and is why the second store went.
  [database.md](docs/project/database.md); the move is
  [260831b-finish-the-database-move.md](docs/plans/260831b-finish-the-database-move.md) and its
  finish is
  [260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md](docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md).
- **Prefer boring.** One server process, TypeScript + ESM, `tsx` to run,
  no framework churn while the ideas are still moving. Two exceptions exist, both Greg's, both
  weighed rather than slipped past: **Postgres** (a single writable disk is what serverless doesn't
  have) and **shadcn + Tailwind v4**. Check
  [vision.md § Principles](docs/project/vision.md#principles) before adding a third.
- **Prefer simple over easy.** Simple means un-braided — each piece does one thing and can be read on
  its own; easy just means quick to write. Reuse the machinery that's already here rather than adding
  a second way to do the same thing, and when two designs work, take the one with fewer parts
  touching each other.
- **Simplest version first.** Take the simpler product decision, get a v1 working end to end, and
  add the complexity or the optimisation later, once something shows it is needed. When a choice
  would add complexity, a dependency or a trade-off, name it at the point of choosing — in the plan
  and in chat — so Greg decides it rather than inherits it.
  [vision.md § Simpler first](docs/project/vision.md#simpler-first). **Ask the other way round
  too:** when a small product tweak — dropping a case, changing a default — would take a lot of the
  engineering out, ask Greg before you build the hard version. Often that's the route we'll prefer.
- **Let the types catch it.** Make a wrong state something the compiler refuses, not something a
  test finds later: a discriminated union rather than a bag of optionals, a `never` check where a
  `switch` must be exhaustive, a named type at every seam. `strict` and `noUncheckedIndexedAccess`
  are on for exactly this —
  [typechecking.md § The flags, and why](docs/project/typechecking.md#the-flags-and-why). Run
  `npm run typecheck` as you go, not only at the end, and `npm run check` before you commit
  ([static-analysis.md](docs/project/static-analysis.md)).
- **Every stage stays runnable on its own** against a slug, so any one can be re-run without the
  others. Cache anything expensive on a content hash — twelve of the fifteen steps in `STEP_ORDER`
  do, and the exceptions are `fetch`, `extract` and `blocks`; copy *their* choice of hash input
  rather than only the idea ([architecture.md](docs/project/architecture.md#conventions)).
- **Hierarchy — the deeply-nested table of contents — and the granularity-zoom tree are
  [the same structure](docs/project/granularity-zoom.md#the-tree)**, produced by stages 4 and 5
  together. They must not diverge into two trees.
- **Log from the server, `console.log` from the CLI** — the rule is the destination, not the
  function name. Anything in a request path goes through [`src/log.ts`](src/log.ts), and a
  `console.log` there is a bug. Never log anything sensitive or any article prose.
  [logging.md](docs/project/logging.md).
- **Stream any model call a person is waiting on.** A spinner for fifteen seconds and the first
  sentence after two are the same call; only one lets the reader start reading. The plumbing is
  already shared, so a new streaming endpoint is a generator and a route, not a project — and a
  stream can end by simply stopping, which looks exactly like finishing.
  [comments.md § streaming](docs/project/comments.md#streaming). A batch call in the pipeline, which
  nobody is watching, doesn't need this.
- **Before writing any Anthropic SDK code**, load the `claude-api` skill for current model ids and
  parameters. Don't hardcode a model from memory.
- **Before rebuilding something the previous version already solved** — AI headings,
  multi-granularity summaries, Readability edge cases, overlapping highlights, stable element ids —
  check [original-version/](docs/project/original-version/overview.md). It's a library to consult,
  not a backlog to import: that project is far larger in scope, and this one is staying tight.
