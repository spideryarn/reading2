Verdict: the goal is right, but I would not land the rewrite exactly as planned. The dangerous mistake is treating operational rules as documentation: memoryless agents will not open a linked document unless their task gives them a reason to.

## 1. Working agreements

Every imperative should remain in `AGENTS.md`, usually as one sentence. Move the explanations, history, and examples—not the trigger.

| Current rule | Verdict |
|---|---|
| “[Explain plainly](</Users/greg/Dropbox/dev/experim/spideryarn2/AGENTS.md:161>)” | **Keep.** An agent composing an answer will not consult a writing doc first. |
| “[Stay inside your stage](</Users/greg/Dropbox/dev/experim/spideryarn2/AGENTS.md:164>)” | **Keep.** This is specifically needed before an agent explores neighbouring code. |
| “[ToC and zoom are the same structure](</Users/greg/Dropbox/dev/experim/spideryarn2/AGENTS.md:167>)” | **Keep.** Easy to violate by independently “fixing” either feature. |
| “[Stages independently runnable/cacheable](</Users/greg/Dropbox/dev/experim/spideryarn2/AGENTS.md:170>)” | **Keep only the runnable requirement.** The blanket caching claim is false; `database.md` says only two of seven stages currently use content hashes ([line 87](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/database.md:87>)). |
| “[Prefer boring](</Users/greg/Dropbox/dev/experim/spideryarn2/AGENTS.md:172>)” | **Keep as one line**, naming Postgres and shadcn as explicit exceptions. The history can move. |
| “[Check the original version before rebuilding](</Users/greg/Dropbox/dev/experim/spideryarn2/AGENTS.md:193>)” | **Keep.** Nothing in a task naturally prompts this lookup. |
| “[Log from server, console.log from CLI](</Users/greg/Dropbox/dev/experim/spideryarn2/AGENTS.md:197>)” | **Keep**, including “never article prose or secrets.” |
| “[Run test and typecheck when finished](</Users/greg/Dropbox/dev/experim/spideryarn2/AGENTS.md:201>)” | **Keep.** This is agent behaviour, not test documentation. |
| “[Get a cross-family review](</Users/greg/Dropbox/dev/experim/spideryarn2/AGENTS.md:208>)” | **Keep the mandatory two-pass policy and literal command.** Move wrapper mechanics. |
| “[A rename is never one edit](</Users/greg/Dropbox/dev/experim/spideryarn2/AGENTS.md:228>)” | **Keep the repo-wide sweep trigger.** Move the exhaustive checklist. |
| “[Watch a regression test fail first](</Users/greg/Dropbox/dev/experim/spideryarn2/AGENTS.md:237>)” | **Keep.** Agents routinely write a passing test after the fix. |
| “[Root-cause every bug in a subagent and write a postmortem](</Users/greg/Dropbox/dev/experim/spideryarn2/AGENTS.md:239>)” | **Keep.** No linked feature doc will cause this workflow automatically. |
| “[Browser work goes to a Sonnet subagent](</Users/greg/Dropbox/dev/experim/spideryarn2/AGENTS.md:245>)” | **Keep.** `browser-testing.md` explains operation but is not a reliable dispatch trigger. |
| “[Load claude-api before Anthropic SDK work](</Users/greg/Dropbox/dev/experim/spideryarn2/AGENTS.md:251>)” | **Keep.** Model identifiers are exactly what agents otherwise recall from memory. |
| “[Stream calls a person waits on](</Users/greg/Dropbox/dev/experim/spideryarn2/AGENTS.md:253>)” | **Keep the general rule and batch exception.** Move implementation details. |
| “[Never run destructive git commands](</Users/greg/Dropbox/dev/experim/spideryarn2/AGENTS.md:265>)” | **Keep the explicit forbidden list.** Highest-risk rule here. |
| “[Commit when done](</Users/greg/Dropbox/dev/experim/spideryarn2/AGENTS.md:270>)” | **Keep.** |
| “[Commit named paths, including the pathspec on commit](</Users/greg/Dropbox/dev/experim/spideryarn2/AGENTS.md:272>)” | **Keep the entire recipe plus “never add -A/. or commit -a.”** The plan correctly preserves the command. |

The five extraction claims are now mostly satisfied—but only because parallel edits landed while I was reading:

- `version-control.md` already contained the complete rule, recipe, and race explanation ([lines 33–60](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/version-control.md:33>)).
- The repo-specific two-review workflow is now in `codex-cli-as-subagent.md` ([line 31](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/reusable/codex-cli-as-subagent.md:31>)).
- “Prefer boring” and both exceptions are now in `vision.md` ([line 58](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/vision.md:58>)).
- The detailed rename sweep is now in `rename-or-move.md` ([line 24](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/reusable/rename-or-move.md:24>)).
- The general streaming rule is now in `comments.md` ([line 270](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/comments.md:270>)).

At the plan’s starting state, “already written elsewhere” at [line 70](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/agents-md-slimming.md:70>) was false for four of five. Treat this as a migration that must land atomically, not as deletion of duplicates.

Facts still effectively unique to `AGENTS.md` include the plain-language rule, mandatory red-before-green workflow, mandatory bug subagent/postmortem, and the standing requirement that all browser work use a Sonnet subagent. Do not silently drop those to hit 12KB.

Also, the reusable rename document still suggests “creating a branch” for complex work ([line 95](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/reusable/rename-or-move.md:95>)), contradicting this repo’s “no switching branches” rule. That is another reason the local imperative must remain in `AGENTS.md`.

## 2. The overview grouping

The plan says “Six overview docs” at [line 40](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/agents-md-slimming.md:40>) and then lists **seven** at [lines 46–52](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/agents-md-slimming.md:46>). Seven is reasonable. The number is not worth forcing down.

A defensible canonical cut is:

- Vision: `open-questions.md`; keep `original-version/` as a prominent historical-library pointer.
- Architecture: `block-ids.md`, `table-of-contents.md`, `database.md`, `fetching.md`, `content-extraction.md`, `ingest-queue.md`, `prompt-caching.md`, `chat-tools.md`.
- Reading view: `granularity-zoom.md`, `web-client.md`, `column-context.md`, `comments.md`, `copy.md`, `diagram.md`, `glossary.md`, `ideas.md`, `keyboard.md`, `library.md`, `links.md`, `page-titles.md`, `reader-profile.md`, `search.md`, `summaries.md`, `touch.md`, `url-state.md`.
- Design/CSS: `colour-scales.md`, `icons.md`, `tooltips.md`.
- Security: `security.md`, `auth.md`.
- Code quality: `testing.md`, `typechecking.md`, `linting.md`, `static-analysis.md`, `browser-testing.md`, `performance.md`, `counting-lines.md`.
- Dev/deployment: `setup-dev.md`, `supabase-local.md`, `version-control.md`, `deployment.md`, `logging.md`.

The current emerging tree has one clear orphan: **`prompt-caching.md` is referenced by none of the seven overview candidates.**

Several documents require secondary routes:

- `chat-tools.md`: canonical architecture, but also reading-view and security.
- `table-of-contents.md`: canonical architecture, but the reading overview should expose it to someone changing navigation.
- `tooltips.md`: canonical design, secondary reading view.
- `browser-testing.md`: canonical code quality, secondary design/reading.
- `auth.md`: canonical security, secondary deployment.
- `logging.md`: canonical dev/deployment, secondary security.
- `database.md`: canonical architecture, secondary dev/deployment.

Therefore, “every document belongs under one overview” is too tree-shaped. Give every file one canonical parent for completeness checking, while allowing secondary links freely.

### Security naming

`security-overview.md` is confusing. It and `security.md` currently both have the H1 `# Security` ([overview line 1](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/security-overview.md:1>), [deep-dive line 1](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/security.md:1>)).

Call the new file **`security-map.md`**, with H1 “Security map,” and label it “start here” in `AGENTS.md`. Keep `security.md` as the deep dive. Folding the map into `security.md` avoids the naming problem but forces every security lookup to ingest 67KB, so the separate map is justified.

There is also a correctness warning already: the new map says “one reader” at [line 3](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/security-overview.md:3>), while `auth.md` explicitly says anyone authenticated is admitted and every reader has a separate shelf ([lines 205–210](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/auth.md:205>)).

Finally, the 6KB rule at [plan line 60](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/agents-md-slimming.md:60>) does not describe the nominated existing files:

- `architecture.md`: 17.8KB.
- `design-css-overview.md`: 25.1KB.
- `vision.md`: 8.4KB after the moved material.
- The design “overview” contains dated worked examples beginning at [line 46](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/design-css-overview.md:46>) and a long undecided-details section at [line 342](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/design-css-overview.md:342>).

Call these **entry-point docs**, not necessarily one-page overviews. Apply the size constraint only to newly created maps.

## 3. Cheapest rot check

Extend the existing [`tests/doc-links.test.ts`](</Users/greg/Dropbox/dev/experim/spideryarn2/tests/doc-links.test.ts:161>). It already checks that files and anchors resolve, but explicitly says it is not a structural checker ([line 31](</Users/greg/Dropbox/dev/experim/spideryarn2/tests/doc-links.test.ts:31>)).

Give every overview a machine-delimited canonical-child block, or maintain a tiny `docs/project/index.json`. The test should assert:

1. Every top-level `docs/project/*.md`, excluding the seven overview files, appears exactly once as a canonical child.
2. Every indexed child exists; every filesystem child is indexed.
3. Every parent is one of the declared overviews.
4. The parent contains a real Markdown link to the child.
5. If backlinks remain required, the child links back to its canonical parent.
6. Every overview appears exactly once in `AGENTS.md`.
7. `block-ids.md` and `granularity-zoom.md` retain their exceptional direct entries.
8. Duplicate canonical parents fail; secondary links do not count as parents.

Because `npm run check` already runs `npm test` as a gate ([`check.ts` line 59](</Users/greg/Dropbox/dev/experim/spideryarn2/scripts/check.ts:59>)), adding this to the existing test requires no new check orchestration.

Use the working-tree filesystem, not `git ls-files`, so an untracked new document fails immediately.

## 4. Blurb length

Bare filenames are not enough under the stated premise that an agent may read only `AGENTS.md`.

They work for `keyboard.md`, `auth.md`, or `typechecking.md`. They fail for:

- `comments.md` — now largely a legacy mechanism.
- `copy.md` — actually reader-facing failure messages.
- `links.md` — specifically hyperlink hover cards.
- `ideas.md` — propositions, not brainstorming.
- `column-context.md` — gist-column fisheye behaviour.
- `chat-tools.md` — server-side model tool execution.

Agents usually search with `rg` for a concept, route, symbol, or failure phrase. A useful index supplies the vocabulary they might search for; a war-story teaser usually does not.

My break-even:

- In `AGENTS.md`: filename plus a **3–8-word discriminator** for ambiguous files.
- In each overview/map: one **8–20-word sentence** saying what problem or code seam warrants opening it.
- No dates, measurements, detailed failure stories, or implementation inventories in either index layer.

That remains small while making searches such as `rg "reader-facing errors|tool loop|prompt cache" AGENTS.md docs/project` productive.

## 5. Other changes

- Do not duplicate the full pipeline command table into `dev-and-deployment-overview.md`; that is exactly the second-copy rot being removed from `AGENTS.md`.
- Do not add backlinks to 45 files merely as a restructuring batch while agents are editing them. The plan itself acknowledges the collision risk at [lines 103–105](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/agents-md-slimming.md:103>). Land the indexes and structural test first; backlinks can follow safely.
- The new code-quality overview already says `npm run check` runs “all nine” checks ([line 28](</Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/code-quality-overview.md:28>)); `scripts/check.ts` currently has eight steps ([lines 52–107](</Users/greg/Dropbox/dev/experim/spideryarn2/scripts/check.ts:52>)). This is precisely why overviews should signpost rather than duplicate inventories.
- Preserve the product/directory distinction and the `CLAUDE.md` symlink fact from [`AGENTS.md` lines 12–18](</Users/greg/Dropbox/dev/experim/spideryarn2/AGENTS.md:12>). Those are operational facts, not disposable vision prose.
- Replace “Target … with no fact lost” with testable acceptance criteria: size target, structural-index test green, every imperative retained, and a before/after checklist of moved paragraphs.

No files were edited.