### 1 — `npm run labels`

Retire it: **(i)**.

The one-to-one artefact argument does not hold. `extract` already produces multiple artefacts, and hierarchy deliberately produces structure, gists, blocks, and labels as one typed, atomic result. Labels are a second model pass, not an independently publishable pipeline stage. [hierarchy.md](</home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/docs/project/hierarchy.md:443>) is explicit about that.

Option (ii) is only coherent if `labels` becomes a required default step after `hierarchy`. Excluding it from normal ingest would create an intermediate tree that the existing contract says is incomplete. That is a pipeline redesign for the sake of preserving a debugging command.

The extra structure call is regrettable but simpler. If re-labelling proves common enough to justify optimisation, add a maintenance operation later—not a fake optional pipeline stage.

### 2 — `npm run fetch`

I disagree with **(i)**. Choose **(ii) for v1**, preferably named `npm run ingest`; keep `fetch` only as a temporary alias if compatibility matters.

The shelf-entry question is based on a state the system refuses to represent:

- Publication rejects a revision with no blocks or tree. [pg-revisions.ts](</home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/src/store/pg-revisions.ts:1313>)
- Even an improperly published incomplete revision is filtered from the shelf. [pg.ts](</home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/src/store/pg.ts:2199>)

Therefore a new `steps: ["fetch"]` job fetches successfully and then fails publication, leaving an invisible article row—not a confusing shelf card. Worse, on an existing article the draft carries the old blocks and tree, so fetch-only can publish new raw bytes beside old derived content.

The deeper answer is that the question is malformed: atomic published revisions cannot preserve the old “write fetch output now; another process continues later” workflow without a fourth design for durable unfinished jobs. Building that state machine inside this cleanup violates simplest-first. Full ingest is the honest v1.

Fix the typo bug in `enqueue` itself:

```ts
if (!request.url && !request.upload && !(await articleExists(request.slug))) {
  throw 404;
}
```

`articleExists` is owner-scoped, so absent and somebody-else’s both remain indistinguishable. URL and upload routes are exempt; legitimate bare-slug route requests already mean “run something on my existing article.” No real route path should break, though the test explicitly blessing unknown slugs must reverse. Remove the script-level pre-check once this invariant lives at the choke point.

### 3 — merged plan shape

**T belongs before C and B.** Converting ~80 suites against the shared database would make their mutation evidence vulnerable to exactly the contamination 260903e exists to remove. That is not useful parallelism; it makes red and green less trustworthy.

I would make two ordering changes:

1. Put cheap, independently measured **B0 before T**.
2. Do not list **D′2 after T**: 260903e Stage D is D′2’s suite-registration abstraction, so the current status block schedules it twice.

The cleaner sequence is:

`A-store inventory → B0 → T-B factory → T-C lanes/fixes → T-D activation → T-E pollution → C → B → D → D′1b → D′3 → E → F → G → H → I`

The PDF spike is independent and can happen any time before E.

I disagree with “one manifest, two columns” literally. These are orthogonal classifications over overlapping—not identical—universes. The three shared-service exceptions prove it: they are genuine Postgres tests, but their lane depends on GoTrue/shared-service behaviour, something the store verdict cannot predict.

Use **one registry file with two separately typed maps and two completeness guards**. Keep the store-migration inventory in A; finalize the lane map in T-C, after the private factory exists to test clean-database assumptions. Co-location is useful; pretending they are the same verdict is not.

No files were modified. I attempted `npx tsx scripts/store-migration-candidates.ts --out /tmp/...`; the sandbox refused `tsx`’s IPC socket with `EPERM`, before the script ran.