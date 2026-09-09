# A successful command is not evidence that it produced its artifact

On 2026-09-09, review found two ways the unattended readiness runner could bless derived state it
had not established. An inherited `npm_config_dry_run=true` made `npm ci` exit 0 without replacing
the previous commit's `node_modules`; separately, a failed fleet build could leave
`dist/index.html`, which a later tick accepted merely because it existed. Either could let the
runner check commit B with derived state not known to belong to B. Nothing reached a reader, and no
incorrect readiness record from either state was observed.

The original runner commits `0dc023fb` and `672dcc62` reached `origin/dev` but not `main`; the
reviewed latch commits `977e1314` and `24c6ce34` reached neither `origin/dev` nor `main`.

## What happened

The npm behaviour was reproduced with npm 11.19.0. A stale directory was placed under
`node_modules`, then:

```text
$ npm_config_dry_run=true npm ci --prefer-offline
removed 1 package
exit 0
stale directory: still present
```

The same command with `--dry-run=false` removed it. `runCommand()` preserved inherited npm
configuration, `commandSucceeded()` saw exit 0, and `prepareRunner()` then latched
`preparedFor = B` after a clean Git stamp. That stamp could not contradict the claim because
`node_modules` is ignored.

The fleet case is the opposite half of the same mistake. Vite 8.2.2 was made to fail in
`closeBundle`; it had already written `dist/index.html`:

```text
dist/index.html
✓ built in 103ms
error during build: forced failure after bundle write
exit 1
```

The reachable sequence was: B was latched and its fleet need clear; the missing entry invoked an
ordinary existence repair; the build wrote the entry and then failed; the next tick saw the
surviving entry and skipped the producer. The full check could then run over an incomplete artifact.

## The class: process outcome is not artifact provenance

An exit status describes how a process ended. Existence describes one path at one instant. Neither
says that this invocation produced a complete artifact from these inputs.

The runner promoted those two weak facts into a stronger statement: that `node_modules`, the schema
and the fleet client matched the SHA in `preparedFor`. The post-preparation Git stamp checked only
the tracked source tree, while every disputed artifact was deliberately outside it. The two failures
are duals: a successful no-op preserved an old artifact, while a failed producer published a new but
incomplete artifact. In both, the artifact outlived the evidence meant to justify it.

## Which commits introduced it

`0dc023fb` introduced both underlying assumptions in the first unattended runner: `npm ci` was
accepted by exit status alone, and the fleet build was skipped when its output directory existed.
`672dcc62` improved fleet handling by requiring `index.html` and throwing on build failure, but
still left partial output available to a later existence check.

`977e1314` introduced `preparedFor` and the clean post-preparation latch. That correctly repaired
transition-triggered recovery, but made the remaining assumption explicit and authoritative:
successful command exits plus a clean tracked tree were treated as proof that all ignored derived
state matched the target SHA.

## Why nothing went red

All 47 candidate tests were green because their preparation fakes equated `status: 0` with “the
requested work happened”. None invoked npm with its real inherited dry-run configuration.

The fleet test covered “exit 0 without creating `index.html`”. It did not cover the other direction:
create `index.html`, then exit nonzero, then enter a later call with `rebuild=false`. The clean-tree
postcondition agreed with both defects because Git correctly ignored `node_modules` and `dist/`; it
proved source identity, not derived-artifact provenance.

## What would have caught it, ranked by ease against value

1. **Disable the known no-op mode and remove failed output.** Pass `--dry-run=false` to `npm ci`;
   remove the fleet entry before building and again after a failed build. Done in the reviewed stage.
2. **Exercise producer semantics in red-first tests.** Run real npm with the inherited dry-run
   setting and require a stale sentinel to disappear; simulate a build that writes its entry and
   then fails, and require the following call to rebuild. Done.
3. **Make preparation return evidence about its artifact.** A producer should combine exit 0 with
   an observable completion proof created by that attempt. This is the right long-term design.
4. **Put `build:fleet` in the check that requires it.** Worth considering separately: it removes the
   runner-only prerequisite, though it does not close the wider class.
5. **Strip every inherited `npm_config_*` variable.** Rejected: it would discard legitimate cache
   and registry configuration, fix only one cause, and do nothing about partial build output.
6. **Hash every file in `node_modules` and `dist`.** Rejected: it is expensive and
   platform-sensitive when producers can expose small, specific completion proofs.

## The fix that is right for the long term

The immediate patch closes the two reproduced paths. The durable design is producer-owned artifact
publication: invalidate old completion evidence before an attempt, require success plus a
producer-specific postcondition from that attempt, and publish multi-file output atomically from a
staging directory. Only then may `preparedFor` name the target SHA.

## The thing I would tell myself

I knew the derived files were outside Git, then used a clean Git stamp as the final proof that
preparation had succeeded. I checked that the commands returned, not that their artifacts crossed
from the old state to the new one. For build automation, exit 0 is one premise and file existence is
another; neither is the conclusion.

---

Up: [postmortems.md](../project/postmortems.md)
