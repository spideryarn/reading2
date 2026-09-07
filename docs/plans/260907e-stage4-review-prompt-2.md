# Review round 2: Stage 4 — the four P1 fixes only

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/worktree-postmortem-preventions-260907`,
branch `worktree-worktree-postmortem-preventions-260907`.

**This is a narrowly scoped check of the fixes to F10–F13**, the four established P1s from your round-1
review (`docs/plans/260907e-stage4-review-sol.md`). Round-one discovery is closed. Do **not** re-open
general review of the file, and do not review Stages 1–3 (committed and pushed).

The one question: **are F10, F11, F12 and F13 actually closed, or does each fix leave the same class
of hole in a new place?** F14 and F15 are prose/placement and I have applied them; mention them only
if a fix broke something.

## The candidate

Live pre-commit; base `3e191ee5`.

- Modified: `src/vercel-health.ts` (+98/−0, purely additive: `EXPECTED` entries and comments)
- Untracked: `tests/env-names-are-inventoried.test.ts`

Context, not candidate: `docs/plans/260907e-*.md`, `docs/postmortems/260827b-*.md`.

## What changed, finding by finding

- **F10** — the sweep now covers `import.meta.env` as well as `process.env`, direct and computed.
  `VITE_SENTRY_DSN` and `VITE_VERCEL_ENV` are now inventoried; `src/web/lib/supabase.ts:34`'s
  computed read resolves through the call-site machinery.
- **F11** — **the exact-text prefilter is deleted.** All 530 files are parsed (2.6 s). The recogniser
  now works from the *root object*: `process` or `globalThis.process` appearing anywhere other than
  as the object of a recognised member-read is a **refusal**, so unlisted spellings fail closed
  rather than vanish. A tree-wide survey found zero bare `process` uses today.
- **F12** — `reporterPremiseFailures` traces every reference to `value` in `src/vercel-health.ts`:
  each call argument must be derived from `EXPECTED` (directly, via a `const` built from those, or
  via a `for…of` over one), each field must be one the parser reads, and a non-call reference must be
  a callback on a derived receiver. `with` is now collected and treated as a **read** that must be
  inventoried in its own right, not as a third door.
- **F13** — the `src/env.ts` file-wide exemption is gone, replaced by two named-function entries
  (`applyEnvFile`, `withoutGitVars`) with reasons, plus **alias-following to a fixed point**: an
  environment bound to a `const`, spread-copied, or passed to a local function is followed and reads
  off it are swept. Writes and `delete` are excluded so the loader's own `env[name] = value` is not a
  read.

## Evidence — check it, don't repeat it

Red-before was produced for each fix. The one I care most about is F11's, because it is the
procedural point you made: with the old prefilter restored,

```
× parses every source file, with no text prefilter to skip one   expected 44 to be 530
× finds the reads, including the ones that are not literals
× has no allowlisted name that nothing reads
× sees `import.meta.env`, direct and computed — F10
× sees the spellings the old text prefilter dropped — F11
× refuses the `process` object itself rather than losing sight of it — F11
```

44 of 530 files were being opened, and **the three fixture controls went red too**, because they now
enter at `sweepTree` rather than calling `sweepFile` directly.

Also: F12's attack run against the real file produced
`src/vercel-health.ts:475 — value(<StringLiteral>) is not derived from EXPECTED`. F13's produced
`SPIDERYARN_ENV_PINNED — read at src/env.ts:373`, two hops from `process.env`.

**My own independent mutation:** removing `SPIDERYARN_ENV_PINNED` from its allowlist group goes red
naming `src/env.ts:373`. Restored. (My first attempt at that mutation edited the wrong line and the
suite stayed green — worth saying, because a mutation that silently fails to apply looks exactly like
a passing check.)

Now: 50 distinct names resolved, 36 of which were in neither door before this stage. Six to `EXPECTED`
(all `breaks: null`), thirty to the allowlist. `npm run typecheck` exit 0 with zero `✗`; `biome check`
clean; `tests/env-names-are-inventoried.test.ts` 27/27, `tests/health.test.ts` 31/31,
`tests/build-stamp.test.ts` green.

## Where I overrode you, with a reason

You said to treat `VITE_VERCEL_ENV` as platform-provided. **It is not**, and I checked: Vercel sets
`VERCEL_ENV`, Vite exposes only `VITE_*`, and nothing in this repo bridges them — its sole occurrence
outside the review is the read itself. Filing it with the platform-set group would have given it the
false justification ("a deployment cannot be missing one") that your own F15 is about. It is in
`EXPECTED` with `breaks: null`, and the near-miss is documented in the platform group's comment.

## Attack it

1. **F11 is the one to press.** The prefilter is gone and the recogniser is root-object based. Is the
   refusal genuinely complete — can any read of `process.env` or `import.meta.env` still reach a
   value without either being resolved or producing a refusal? Try the spellings from your own
   round-1 table again, and any new ones the *new* structure admits.
2. **Does F13's alias-following terminate, and is it sound?** It claims a fixed point. Can it loop,
   miss a hop, or follow an alias into something that is not an environment? Does excluding writes
   also exclude a read that happens to be a compound assignment or a destructuring write?
3. **Does F12's premise-tracing have the same shape of gap it was fixing** — a `value` reference form
   it does not classify and therefore ignores rather than refuses?
4. **Did F10 introduce a hole?** `import.meta` is not `process`; is the refusal path as strict for it?
5. **Is anything now refused that should resolve** — a false red that would make somebody weaken the
   check to get their build green? That is the failure mode I would least like to ship.

Findings from `F16` upward, severity and established/reasoned as before. Refuse only on an
established P0 or P1. Verdict: land, land with named changes, or do not land.

## My suspicion — read last

Deleting the prefilter is the right call but it widens what the sweep sees from 44 files to 530, and
`src/web/` was never swept before. If that has pulled in reads whose classification is wrong rather
than missing, I would rather know now.
