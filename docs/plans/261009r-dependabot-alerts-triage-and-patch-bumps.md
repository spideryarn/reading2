# Dependabot alerts: triage, and the two patch bumps

2026-10-09. GitHub reported 11 Dependabot alerts on `dev` (2 high, 5 moderate, 4 low), unread, and
the security register said so ([security-risks.md § Not reviewed](../project/security-risks.md#not-reviewed)).
This triages what `npm audit` currently reports (which is not provably the same set — see
**Source**), says for each whether our code can reach the vulnerable path, and applies the patch
bumps that fix a high one. Authorised as bugs under Greg's standing rule (2026-10-09: *"You are
definitely authorised to fix bugs any time you notice them"*), and the high ones fall under
[overseer.md § Dependabot alerts](../project/overseer.md#dependabot-alerts) as well.

## Source

The box has no GitHub credential, so `gh api …/dependabot/alerts` was not available. `npm audit
--json` against the lockfile at `83a42ef24` reads the same GitHub advisory database for npm. It
reports 9 vulnerable *nodes* (2 high, 6 moderate, 1 low), three of which — `@esbuild-kit/*` and
`drizzle-kit` — only carry `esbuild`'s advisory up the tree. Separately, there are 9 distinct
advisories across 6 underlying packages, 3 of them high. Neither number is GitHub's 11 / 2 high, and
the two cannot be reconciled from here: alert aggregation, database timing and stale or withdrawn
alerts all move the count. The repo has one manifest, `package.json`, which rules out a second
ecosystem and nothing else. **So this does not claim all 11 alerts are triaged. Somebody signed in to
GitHub should read the alerts page once** and check nothing on it is missing from the table below.

## Triage

Reachable means: can input that is not ours reach the vulnerable function, in the server, the
client, or the build? "Dev tooling" means the package runs only on a developer's machine or in the
build, on our own files.

| Package (installed) | Advisory, severity | Direct? / how it arrives | Reachable? | Smallest fix | Done here? |
|---|---|---|---|---|---|
| `brace-expansion` 5.0.9 | GHSA-qhr7-859c-m2p7 **high**, GHSA-6j4f-fj2g-mc7p **high**, GHSA-q2hr-2g5m-vwhr moderate — DoS on crafted brace patterns | transitive: `@vercel/nft` (dev) → `glob` → `minimatch`, and `@sentry/vite-plugin` (dev) → `@sentry/bundler-plugins` → `glob` → `minimatch` | **No.** Build and test tooling only: `tests/pdf-bundle-trace.test.ts` traces our built API, and `scripts/sentry-build.ts` passes fixed build-output globs. | patch, 5.0.12, inside `minimatch`'s `^5.0.8` — lockfile only | **Yes** (high) |
| `source-map-js` 1.2.1 | GHSA-68fv-2mgg-jv7q **high** — event-loop DoS parsing an *indexed* source map | transitive: `vite` → `postcss`; `@tailwindcss/vite` → `@tailwindcss/node`; `jsdom` → `css-tree` | **No.** The flaw is in `SourceMapConsumer` parsing a hostile map. Vite and Tailwind consume only our own CSS's maps, at build time. `jsdom` *is* a runtime dependency, but `css-tree` imports only `SourceMapGenerator` (`lib/generator/sourceMap.js`), never the consumer. | patch, 1.2.2, inside every parent's `^1.2.1` — lockfile only | **Yes** (high) |
| `dompurify` 3.4.14 | GHSA-p98j-92pf-mc4p low, GHSA-6688-9rhm-gjv2 low — both only under `IN_PLACE: true` | **direct**, runtime, server and client | **No.** Neither binding uses `IN_PLACE`; both hand DOMPurify strings. [`src/sanitize.ts`](../../src/sanitize.ts) records that we moved off `IN_PLACE` deliberately. | patch, 3.4.16 | No — low, unreachable, and it is the sanitiser, a defence ([security-map.md § Where the defences physically live](../project/security-map.md#where-the-defences-physically-live)); left for Greg |
| `smol-toml` 1.8.0 | GHSA-r4xh-jqrq-34v2 moderate — quadratic-time `parse()` | **direct** (dev, pinned exactly), and via `knip` | **Not from production.** Only `scripts/` parse TOML (deploy checks, `gjd-remote` config, Supabase auth config, Claude accounts). One local path does take a file we did not write: `gjd-remote` reads `.gjd-remote/config.toml` from whichever repo it is pointed at, unbounded in size (`scripts/gjd-remote-config.ts`), so a hostile checkout could make it slow. That is a local CPU stall in a dev tool, nothing more. | minor, 1.9.1 — needs the exact pin changed | No — moderate, unreachable |
| `fast-copy` 4.0.4 | GHSA-jggr-w7fw-pc2j moderate — stack exhaustion on deep nesting | transitive: `pino-pretty` (dev) | **No.** `pino-pretty` is only `npm run dev:pretty`, prettifying our own log lines, and its copy call runs only with `ignore`/`include` options, which that script does not pass. | minor, 4.1.0 | No — moderate, unreachable |
| `esbuild` 0.18.20 (and `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`, `drizzle-kit` counted with it) | GHSA-67mh-4wv8-2f99 moderate — esbuild's *dev server* answers any origin | transitive: `drizzle-kit` (dev) → deprecated `@esbuild-kit/esm-loader` → `core-utils` | **No.** The flaw is in `esbuild serve`. The published `drizzle-kit` files never import their declared `@esbuild-kit` dependency; their live schema transform uses the separate direct esbuild dependency. Our dev server is Vite on esbuild 0.28, which is not affected. | no in-range fix. npm's suggestion, `drizzle-kit` 0.18.1, is a *downgrade* across a breaking line; the real options are an `overrides` entry forcing a newer esbuild under `@esbuild-kit`, or waiting for a `drizzle-kit` that drops `@esbuild-kit` | No — goes to Greg as a question, recommending leave |

So nothing on the list can be reached by a stranger's input in the server, the API or the client. The two highs are fixed anyway because
they are free: both are patch releases already inside every parent's declared range, so only
`package-lock.json` changes, and the Overseer's standing rule is to clear highs.

## The change

```sh
npm update --package-lock-only --ignore-scripts brace-expansion source-map-js
# check: exactly 5.0.12 and 1.2.2, and only those two lock records moved
npm install --ignore-scripts
```

No `package.json` edit. (`npm update` cannot pin a version; the assertion stands in for that.)

**The simpler option passed over:** `npm audit fix`, which would also take `fast-copy` and
`dompurify` and move `smol-toml`'s exact pin. It clears more alerts in one line, but it bumps the
sanitiser without anyone choosing to, and the brief is the reachable or high ones only.

**Evidence that it changes nothing a reader gets:** `source-map-js` sits in the client build chain,
so rather than assume it cannot affect the bundle, build before and after and compare. Every build
writes a fresh `builtAt` into the bundle, so a raw hash comparison always differs (the plan review
caught this). The comparison replaces ISO timestamps and the 8-character content hashes in file
names and references with placeholders, then hashes each file. Two baseline builds with no change
in between must agree first; otherwise the comparison proves nothing. This is deliberately scoped
evidence, not byte-for-byte identity: the regex replaces every matching timestamp, including real
timestamps in the changelog bundle, and would hide a change whose only differing text matched one
of its patterns. That is not a plausible output of these two dependency patches; the changed
`source-map-js` path is build-time source-map parsing, while the runtime `css-tree` path imports only
its generator. With the client files otherwise identical, no browser smoke check is needed. The API
bundle keeps most dependencies external, so its bytes say nothing about `jsdom`'s copy of
`source-map-js` at runtime. That copy is covered by the reachability argument above and by the suite.

Gates: `npm test`, `npm run typecheck`, `npm audit` afterwards showing no high.

## Results

- The lockfile diff is the two records and nothing else: `brace-expansion` 5.0.12, `source-map-js`
  1.2.2 (every copy in the tree deduped onto it).
- `npm audit` afterwards: `{"low":1,"moderate":6,"high":0}`. Left: `@esbuild-kit/core-utils`,
  `@esbuild-kit/esm-loader`, `drizzle-kit` and `esbuild` (one advisory), `dompurify`, `fast-copy`
  and `smol-toml`.
- Build comparison: the two baseline builds agreed once normalised. After the change, all 172
  normalised client files are identical. The code review reran the build after `npm ls` confirmed
  that the two patched versions were installed and got the same client result. `api-dist/vercel.js`
  differs only in `builtAt` and in the embedded `index.html`'s script name and sha256, both of which
  follow from the timestamp. Given the regex limitation above and the narrow changed paths, no
  browser smoke check.
- `npm run typecheck` green. `npm test`: 43,721 passed and 2 failed. Both failures are in
  `tests/feedback-endings.test.ts`: another agent's `docs/user-feedback/questions/q-qjbb9a.md`
  (commit 8de0e1ccc) is over that test's length limit. That is disjoint from this change.

## Questions for Greg

**[Q-esbuild-under-drizzle-kit]** `drizzle-kit`, the tool that writes our database migrations, still
pulls in an old, abandoned helper (`@esbuild-kit`) that carries esbuild 0.18. That version has a
moderate advisory: its built-in *dev web server* will answer requests from any website. Nothing of
ours starts that server — the published `drizzle-kit` files do not import their declared
`@esbuild-kit` dependency at all, and their live schema transform uses a separate, direct esbuild
dependency. Our real dev server is Vite on a fixed esbuild. The only fixes are (a) an `overrides`
entry in `package.json` that
forces a newer esbuild under `@esbuild-kit`. That is a major version jump on paper, but since no
`drizzle-kit` file loads `@esbuild-kit` (`grep -rl esbuild-kit node_modules/drizzle-kit` finds
nothing), it would change no behaviour. What it costs is a permanent oddity in `package.json` that
someone has to remember to remove. Or (b): wait for a `drizzle-kit` release that drops
`@esbuild-kit`. The latest stable release, 0.31.11, still declares it. The 1.0 line no longer does
(`npm view drizzle-kit@1.0.0-rc.4 dependencies`, checked 2026-10-09; the code review said
otherwise, and was wrong), but 1.0 is still a release candidate and a major bump of our migration
tool. **Recommendation: (b), leave it.** The alert stays open, but nothing can reach it, and it
clears itself when we move to `drizzle-kit` 1.0 for its own sake. Choose (a) if a clean alerts
count matters more than one extra line in `package.json`.

**[Q-dompurify-3.4.16]** Two low DOMPurify advisories affect only its `IN_PLACE` mode, which
neither of our bindings uses ([`src/sanitize.ts`](../../src/sanitize.ts) explains why we moved off
it). The fix is a patch, 3.4.14 → 3.4.16, but DOMPurify *is* the sanitiser — the defence between a
stranger's HTML and a reader's browser — so it was not mine to move under this brief. **Recommendation:
take the patch in its own small change** with the sanitiser suites (`tests/sanitize*.test.ts`) and
a browser check of one article. It removes nothing we rely on and keeps us on the version the
DOMPurify maintainers are fixing. `src/sanitize.ts`'s line "Our pinned 3.4.14" would change with it.

The two remaining moderates, `smol-toml` 1.9.1 (needs the exact pin in `package.json` moved) and
`fast-copy` 4.1.0 (under `pino-pretty`), are minor bumps in dev-only tools. Under
[overseer.md § Dependabot alerts](../project/overseer.md#dependabot-alerts) moderates are left
alone, so they are recorded here and not taken.
