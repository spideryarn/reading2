# Tidy the repo root before open-sourcing

Greg, 2026-09-06:

> Is there any junk (especially in the root folder) that we should clean up, i.e. either discard or
> move into subfolders? We're about to open source the repo, and I just want things to be tidy. But
> check carefully, don't break things.

## What "junk" turned out to mean here

Very little. The root's 34 tracked files were 19 config files that have to be at the root, four
markdown files, and **eleven `preview-*.html`** — which is where the clutter actually was. Every
other suspicious-looking directory (`certs/`, `example/`, `experiments/`, `infra/`) has a README
explaining why it exists and is not junk.

The gitignore already keeps the genuinely large local rubbish out of git: `data/`, `output/`,
`logs/`, `scratch-bakeoff/`, `api-dist`, `dist`, `uploads/`, `.playwright-mcp/`, `*.activity.log`.
Nothing there needs doing.

## Findings and proposed actions

### 1. Eleven `preview-*.html` at the root → `preview/` — done, against the review's advice

`preview-callout`, `-chat-markdown`, `-colour`, `-composer`, `-diagram-wait`, `-illustrated`,
`-live`, `-profile`, `-sharing`, `-sketch`, `-timeline`. A third of the root's tracked files, and
the single biggest reason the root looked untidy.

They are **dev-only**. `vite.config.ts` sets no `build.rollupOptions.input` and no custom `root`, so
`vite build` emits `index.html` alone; these are reachable only through the dev server. Sol checked
that claim rather than taking it — `vite.api.config.ts` builds `src/vercel.ts` and not HTML,
`scripts/client-shell.ts` reads exactly `dist/index.html` and globs nothing, `vercel.json` rewrites
to `/index.html`, knip finds `index.html` through its Vite plugin and has no HTML glob, biome's
allowlist covers neither the root nor a future `preview/`, and `tests/preview-pages.test.ts`
enumerates `src/web/preview-*.tsx` rather than the shells. He also ran an independent client build:
the only HTML emitted was `index.html`.

**Sol's recommendation was to leave them where they were**, on the grounds that they are plainly
named developer tooling and the move buys no behaviour while changing URLs. Moved anyway, and the
reasoning is worth recording because it goes against a cross-family review:

- The benefit asked for *was* the cosmetic one. Greg's question was whether anything should be moved
  into subfolders before the repo goes public, and eleven dev shells at the root is the answer to it.
- The failure mode Sol was pointing at is **caught by an existing gate**, not left to vigilance.
  His concrete objection was a reference the first sweep missed — a live Markdown link at
  `docs/plans/chat-markdown.md:238` — and `tests/doc-links.test.ts` asserts that every link in
  `docs/**/*.md` resolves. A missed link goes red rather than quiet.
- There is exactly one such link. The other seventeen mentions across `docs/plans/` and
  `docs/postmortems/` are prose, which the test does not check and which is **deliberately left
  alone**: those files are dated records of where something was at the time, and rewriting them
  would be falsifying history to tidy a path.

What changed: the eleven pages, the eight present-tense references in `src/web/preview-*.tsx` and
`scripts/live-spike.ts`, and that one asserted link. `tests/gutter-target-size.test.ts:28` is *not*
a reference — it names a `preview-gutter.html` in order to say no such file exists.

**Smoke-tested rather than assumed**, which was Sol's condition: a real dev server, all eleven URLs
requested, each answer checked for its own entry module rather than for a 200 — Vite's SPA fallback
returns `index.html` with a 200 and would otherwise have hidden a 404. 11/11 served, and the old
root URL fell through to the fallback, which is what proves the move actually happened.

Five of the eleven carry a header comment saying "delete this file … when the check is done", and
knip reports all eleven `src/web/preview-*.tsx` as imported by nothing. **Not deleted here** — that
is a judgement about whether each check is done, which belongs to whoever wrote it, and it would
take the matching `.tsx` and three fixtures with it.

### 2. `test/` (two files) — dead, and one letter from `tests/`

`test/fixtures/structures.html` and `structures.blocks.json`, added 2026-08-24 by `4bd4d94c` along
with the nested-list fix in `src/blocks.ts`.

**Nothing reads them.** `grep -rn "structures.blocks.json\|structures.html"` over the whole tracked
tree returns two hits, both of which merely *describe* the file:
`scripts/count-lines.ts:80` (a categorisation rule) and `docs/project/counting-lines.md:71`.
`git log --all -S"test/fixtures/structures"` finds no test that ever imported it. So the fixture the
commit message says was written to catch two bugs was committed without the test that reads it.

A top-level `test/` sitting beside a top-level `tests/` with 834 files is also a trap in its own
right — a wrong path there fails by finding nothing rather than by erroring.

**Proposal:** `git mv test/fixtures/structures.* tests/fixtures/` and delete the empty `test/`,
rather than deleting the fixture outright. It is a real, small, hand-cut structural fixture (nested
lists, tables, `<pre>`, bare blockquotes, pre-existing ids) covering exactly what the test article
does not, and it costs 5KB. Moving it puts it where someone writing that missing test would look.
Then update `scripts/count-lines.ts` (the `test/fixtures/` prefix rule becomes redundant —
`/fixtures/` on the next line already claims it), `docs/project/counting-lines.md`, and drop `test`
from `.vercelignore`.

**Sol answered the open question: move it and write the missing test**, which is what happened.
He also checked something better than any of the greps — he ran `splitIntoBlocks()` over the HTML
and all 17 blocks still matched the JSON, so the fixture is not merely orphaned but *correct*, and
worth giving a reason to exist rather than deleting.

`tests/blocks-structural-fixture.test.ts` is that reason: a golden comparing stage 3's output over
the captured HTML against the captured JSON, plus named assertions for the structures the fixture
exists for and for id preservation. Two corrections to this plan came out of writing it. Sol was
right that "nothing reads them" was too strong — `scripts/count-lines.ts` and
`tests/no-raw-nul-bytes.test.ts` both open every tracked file, neither as a semantic consumer — and
right that the plan overstated the unique coverage, since `tests/blocks.test.ts` already covers
nested lists, figures, `<pre>` and `<hr>`. The table, the bare blockquote and the pre-existing ids
are what is genuinely only here.

**All five assertions were watched failing before being believed**, against a mutated copy of the
fixture, restored byte-for-byte afterwards (sha256 checked). That turned up something worth keeping:
the obvious probe for the id-preservation test — renaming an id — leaves it **green**, because it
moves both sides of the comparison together. What it actually guards is stage 3 *minting* an id
where the author's HTML supplied one, which is probed by deleting an `id` attribute. The test says
so in a comment, so the next person does not have to rediscover it.

### 3. Untracked scratch left behind by other agents — reversed, and left alone

Three files, all untracked and none gitignored, so they show up in every `git status` any agent in
this checkout reads: `.tmp-smoke.mts` (2026-09-03, a Playwright smoke script whose own header says
"Throwaway; deleted after the run") and `privacy-1280.png` / `privacy-390.png` (2026-09-02,
screenshots recorded as leftover scratch in
`260904b-pricing-page-and-public-showcase.md`).

They were archived to this session's scratchpad and deleted. **Sol objected, and was right**, so
they have been restored byte-for-byte with their original timestamps:

> Copying them to a session scratchpad and then deleting them is not acceptable. A session
> scratchpad is not durable custody, and an untracked file has no Git recovery path. The files
> belong to other agents; tidying the status output does not transfer ownership.

The mistake was treating "I can put it back within this session" as the same thing as "nothing is
lost". A scratchpad dies with the session; the files would then exist nowhere. And an earlier sweep
had already looked at these three and deliberately left them, which should have been read as a
decision rather than an omission.

None of them was ever going to ship — they are untracked, so open-sourcing does not publish them.
Flagged for their owners rather than removed.

`.env.local~`, an editor backup of the real `.env.local`, is gitignored by `.env*` and never ships
either. **Left alone and flagged** for the same reason, with one of its own: it holds live keys and
it is Greg's, not scratch.

### 4. `package.json` metadata is wrong for a public repo — done

```
"name": "reading2",
"description": "HTML content extraction experiments",
"author": "",
"license": "ISC",
```

The product is Spideryarn; the description is from the first week and describes stage 2 only; and
`license: "ISC"` **contradicted** the `LICENSE` file, which another session committed as `6978e9b5`
at 07:29 while this plan was being written, and which is MIT. That mismatch was the one item here
that was a defect rather than untidiness — in a public repo the two files are the only statement of
terms and they disagreed.

Nothing reads `package.json`'s `name` (checked: no `pkg.name` anywhere in `src`, `scripts`, `evals`,
`tests`), and `"private": true` keeps it off npm regardless. `package-lock.json` carries the name in
two places; those follow, and `npm ci --dry-run` is clean before and after, so the mismatch was
cosmetic either way.

Landed as `name: "spideryarn"`, an accurate description, `author: "Greg Detre"`, `license: "MIT"`.
`"private": true` kept.

## What another session settled while this was being written

`spideryarn2-cb` was working the same open-sourcing question from the other end and landed
`6978e9b5`, "MIT, and a name against every borrowed article", at 07:29 today. It adds the MIT
`LICENSE` with a "Third-party material" carve-out, and attribution in
`tests/fixtures/data-root/README.md` for the five articles whose prose is committed there. **That is
not this plan's work and none of it was touched here.** It matters to this one for two reasons: it
is what makes the `ISC` in `package.json` a contradiction rather than a nit, and its own commit
message leaves exactly one thing open, which is the section below.

## 5. The one open-sourcing blocker, and it is Greg's call rather than an agent's

`evals/pdf/titles/kuhn-landscape-of-consciousness/`. Robert Lawrence Kuhn's "A landscape of
consciousness", Elsevier, **CC BY-NC-ND** — a No-Derivatives licence, which is the condition
`evals/pdf/README.md` records a *different* candidate fixture being rejected for. Its own
`LICENCE.md` is headed **"Licence — do not redistribute"** and says:

> Treat this fixture as internal-only: do not push it anywhere the repository itself would not
> otherwise reach.

Flipping the repository public is precisely that, so the file's own condition contradicts itself the
moment the switch flips. `6978e9b5` flagged it and left it; this plan does not resolve it either,
because it is a rights and publication decision rather than a tidying one.

**What Fable found when asked what actually depends on it**, so the decision can be made with the
cost known rather than guessed:

- **It is not one file.** Besides `source.pdf` (a 3-page cut of 142), the directory holds six
  `records-*.json` transcriptions — the `ee94…` bank alone is ~207 records, roughly 9,800 words of
  the paper's abstract and opening pages retyped as JSON. **Deleting the PDF alone leaves the
  prose.**
- **It is in `npm test`, not only in the hand-run eval.** `tests/pdf-figure-read.test.ts` (`KUHN`,
  line 33) opens it in two tests: lines 74–95 pin a 119×119 logo that the deflate rule wrongly
  called blank, and lines 275–290 need any usable raster after pdf.js teardown. The second swaps
  trivially to `evals/pdf/harder/source.pdf` (CC BY); the first pins a Kuhn-specific property no
  other committed PDF has.
- **One published number moves.** Removing it takes `evals/pdf/titles/expected.json` from ten
  fixtures to nine, so the `6/10` and `7/10` table in
  `260905b-pdf-front-matter-and-the-title-it-stole.md` becomes history rather than something the
  tree reproduces.
- **A substitute is cheap.** The bug is the *Elsevier page-1 template* — "Contents lists available
  at ScienceDirect", the journal masthead set larger than the article's own title — not this
  particular paper. Any CC BY open-access Elsevier paper has the same page 1. Cost: one download, a
  `LICENCE.md`, a `pass0-full.json`, an `expected.json` entry and a `--only=<slug>` transcription
  run at roughly $0.02, then re-cut the table.
- **Working-tree removal does not remove it from history.** `f4871bca`, `e13becdf` and `302413ea`
  (all 2026-09-05) are on `origin/dev` *and* `origin/main`.

So the options are: (a) publish as-is; (b) swap in a CC BY Elsevier paper and remove this one from
the tree, accepting that the bytes stay reachable by SHA; (c) rewrite `dev` and `main` history,
which this repo's own rules forbid and which would break every worktree and the box; (d) if "go
public" means a *new* remote rather than flipping the existing one, publish from a `filter-repo`
clone — nearly free, because the offending commits are one day old.

Fable recommends (b), or (d) if a new remote is happening anyway, at ~85% confidence on "replace,
don't ship". **Not acted on here.** Spending money on a model call and re-cutting a published eval
denominator is not tidying, and the underlying question is Greg's.

## 6. Three more findings, none of them junk, all of them Greg's to decide

From a sweep of everything outside the root.

- **The repo names its owner in shipped source, deliberately.** `greg@gregdetre.com` is the
  hardcoded `ADMIN_EMAIL` in `src/admin.ts` and appears in four other files; the production Supabase
  project ref `alschkahzfagtppxspfq`, two real `auth.users` UUIDs, and the live Stripe
  `acct_`/`prod_`/`price_` ids are all hardcoded too, each with a comment saying why. None is a
  secret and none is a bug. All of them will be public. Worth one conscious look rather than a
  change.
- **The secrets scan is clean.** Every hit for `sk-or-v1-`, `sk-ant-`, `sk_live_`, `sb_secret_`,
  `service_role` and JWT shapes across the tracked tree is a fabricated test placeholder, and the
  four hits in the *whole of git history* are the same. `tests/no-secrets-in-bundle.test.ts` says in
  its own comment that its two sample keys are made up, and neither matches anything in `.env.local`.
  One caveat: `sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz` in `tests/deploy-checks.test.ts` and
  `tests/no-secrets-in-bundle.test.ts` is realistic enough that GitHub's own secret scanning may
  alert on it once the repo is public. It is a positive test case for our detector, so it has to
  look real; expect the alert and dismiss it.
- **Four scripts will never run for a stranger.** `evals/cost/baseline/{coverage.py,final-numbers.py,
  pg-articles.mjs,pg-dump.mjs}` hardcode `/home/greg/code/spideryarn2/…`, and
  `scripts/spike-pdf-width.ts:55` hardcodes a PDF under `/home/greg/uploads/` that is not in the
  repo. They are one-off analysis spikes rather than app code, so this is cosmetic — but they are
  the only tracked files that are *broken by construction* for anyone else.

## What is NOT junk, checked rather than assumed

- `certs/` — Supabase's public root CA plus a README arguing why it is committed; `tests/db-tls.test.ts` guards it.
- `example/` — the hand-authored stage-4/5 fixture corpus; `npm run db:seed-dev` loads it.
- `experiments/decorated/` — a documented playground, deliberately outside `src/`.
- `infra/hetzner/` — terraform for the box, with `example.tfvars` rather than real values.
- `.codex/`, `.gjd-remote/`, `.mcp.json`, `.worktreeinclude` — each is a documented per-project config, and none holds a secret (`.mcp.json` is three URLs, two of them public).
- `api/index.js`, `styles/`, `public/`, `supabase/`, `drizzle/` — all live.
- `docs/plans/` at 1055 files and `docs/postmortems/` at 83 — deliberate, per AGENTS.md.

## `vitest.witness.config.ts` is not dead, whatever knip says

Worth writing down because it looks exactly like junk and is not. A sweep flagged it as an unused
root-level config, which is knip being honest about what it can see: the file is loaded only through
`--config`, at runtime, by `scripts/store-migration-witness.ts` (`const CONFIG` at line 87), and
`tests/one-store-only.test.ts:99` names it in the list of files it guards. Left alone. The general
shape — knip reporting a file reached by a runtime string rather than an import — is worth
remembering before acting on any of its findings.

## What was checked and run

- `npm run build` — both passes green, and `dist/` contains exactly one HTML file, `index.html`.
  That is the preview move's whole safety claim, measured after the move rather than argued before
  it.
- `npm run typecheck` — green.
- `doc-links`, `deploy-checks`, `blocks`, `blocks-structural-fixture`, `gutter-target-size` —
  226 tests, 0 failures. `doc-links` is the one that would have caught a missed Markdown link.
- Earlier, on the first commit: `deploy-checks`, `doc-links`, `one-store-only`, `gjd-remote-config`
  — 191 tests, 0 failures.
- The eleven preview URLs, against a real dev server. 11/11.
- `npm ci --dry-run`, before and after the lockfile edit.

## The simpler option passed over

Doing nothing at all. The root would still be untidy but nothing could break, and for a repo nobody
outside can see that is the right trade. What changed it is that the repo is about to be public: the
root is the first thing a stranger reads, `package.json` contradicted the licence file, and a
top-level `test/` beside `tests/` is a trap that costs somebody an afternoon exactly once.

The narrower version — §4 only, the licence contradiction — was the other candidate, and it is what
a reviewer would have picked. Rejected because §1 is the actual answer to the question Greg asked,
and because §2 turned out to be a fixture that was correct and unused rather than merely untidy,
which is worth a test rather than a shrug.

## What this deliberately did not do

- **Delete the eleven `src/web/preview-*.tsx`**, which knip reports as imported by nothing and five
  of which ask to be deleted in their own headers. Whether each check is done is not a tidying
  question.
- **Touch the third-party fixture corpora**, or §5's Kuhn directory. Rights and publication, not
  tidiness.
- **Touch `README.md`, `CONTRIBUTING.md` or `setup-dev.md`**, which another session was rewriting
  concurrently for the same open-sourcing push.
- **Rewrite prose in `docs/plans/` and `docs/postmortems/`** that names the old preview paths.
  Seventeen mentions, all of them dated records.
