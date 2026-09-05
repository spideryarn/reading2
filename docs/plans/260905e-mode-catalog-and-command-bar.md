# A mode catalog and command bar, with room for reader-authored modes

Status as of 2026-09-05: exploration and implementation proposal, not adopted or built. Companion
to [the main app architecture review](260905e-main-app-architecture-review.md). Current source
baseline: `fd370cfe050fc9ad0bdfd107668b857abaab5219`. A command-bar request is captured here; this
documentation task does not implement it.

## Greg's updated brief

> FYI I'm willing to revisit previous decisions (because they might have been judgments made by
> less capable previous models, or perhaps our requirements have evolved), e.g. we might consider
> the idea of a universal mode registry if that has long-term benefits. If you can, distinguish
> between product decisions made by me (treat these with more weight) vs decisions made by previous
> agents (we're more willing to change them).
>
> The goal is what's best long-term for the user and the codebase, and to explore ideas. For example,
> I can imagine a world in which users can build their own new modes (generate UI), or a marketplace
> of modes - though all that is far in the future, and for now I just want to make what we have work well.
>
> I'd also like to have a command bar where I can type (or even talk) and it would open the appropriate
> mode (a bit like Spotlight/Alfred on the Mac), e.g. in a nice-to-have future world I'd be able to just
> click and say out loud "take me to the bit where the article introduces article consciousness" or
> "generate me Quotes and an Illustrated diagram" or "explain how access consciousnes is different
> from phenomenal consciousness" or whatever, and it would perform the appropriate actions. Dunno
> if a mode registry would help with this!
>
> — Greg, 2026-09-05

## The design I recommend

Yes: a mode catalog would help. Give built-in modes one discoverable identity and a common interface
to the reader shell. Give actions a separate, typed interface that the dock, command bar, voice
input and eventually agent tools can invoke. The catalog answers **what is available**; the action
layer answers **what can be done, with which inputs and effects**. Feature implementations keep
their own meaningful logic.

This makes the command bar a useful addition to the present app, while creating an interface that
future user-authored modes could consume. It does not require a general plugin runtime first.
The practical long-term architecture is one logical catalog, small explicit adapters at the
browser/server boundary, and one execution path per action. A single enormous file importing React,
SQL, prompts and every renderer would defeat the startup and maintenance goals.

The strongest argument for a broader registry is no longer speculative extensibility: Dock,
command discovery, titles, feature gating and mode presentation already need overlapping facts.
The cost is a new extension contract that must remain coherent. Pilot it with deliberately unlike
modes before moving the whole application onto it.

## Which earlier decisions carry whose authority

The distinction below concerns provenance, not whether the recommendation was sensible. Direct
product instructions have more weight; agent judgments are candidates to reconsider against the
new requirements. Even a recorded product decision can be revisited, but it must not disappear
inside a refactor.

| Decision or claim | Provenance | Treatment here |
|---|---|---|
| Reading should augment understanding; generated text routes back to prose | Greg's quoted intent and principles in [vision](../project/vision.md) | Preserve as the product objective. A command answer should retain a route to its supporting text. |
| The spine and prose remain the reader, with modes using the middle band | Greg's 2026-08-25 quote in [web-client](../project/web-client.md) | Preserve the shared reader. A phone presentation may change only as a visible product choice. |
| Plain is the default/way out; Dock order is chosen by hand | Greg's quotes in [Plain mode](plain-mode-and-the-way-out.md), and `Dock.tsx`'s order comments | A catalog must preserve both; alphabetical registry iteration must not reorder the dock. |
| Timeline follows the model's reading, not a date sort | Direct Greg quote in [timeline](../project/timeline.md) | A generic timeline renderer may not silently change this. |
| Make new modes easy, consistent and robust | Greg's 2026-09-02 quote in [adding a mode](260902o-adding-a-mode-the-recurring-edits-and-how-to-make-them-one.md) | A primary criterion for the pilot: fewer coordinated edits and clearer checks. |
| Explore generated React/SVG and extensibility | Greg's 2026-08-31 quote in [reader-authored modes](260831am-reader-authored-modes-generative-ui.md) | A real product direction, reaffirmed in this turn; not a feature the agents permanently vetoed. |
| Reject a universal `ModeDef` that replaces built-ins with one extraction/layout DSL | Sol's review, adopted by the author of that plan; Fable argued for it | Reassess. The counterexamples show that one particular schema loses policy, not that a registry cannot reference bespoke implementations. |
| Leave a sixteen-prop `ModeBands` extraction | `App.tsx` attributes it to Greg's team lead in August 28 work, not a direct Greg instruction | Engineering judgement made in context; test a better interface deliberately. |
| Cold offline shell can wait until layer 1 is lived with | Explicitly attributed to Greg in [offline reading](260827r-offline-reading.md), “Decisions Greg made” | Preserve current scope, but recommend revisiting for mobile reopening. It was a sequencing decision, not a permanent exclusion. |
| A command palette is “not worth building here yet” | Agent recommendation in [the earlier-version comparison](../project/original-version/url-state-and-keyboard.md#the-command-palette), conditional on a small app | Its stated revisit conditions—library, settings, several tools—now apply, and Greg has directly requested the direction. Reconsider, not a product veto. |
| “Roughly one reader” / “no spend limit” | Dated premises in the August 31 generative-UI plan | Do not carry forward as current facts. Current billing/admission code exists; inspect it before a rollout decision. |

The previous generative-UI plan's recommendation is analysis, not a transcript of Greg approving
a blanket registry ban. Its [Fable pass](260831am-reader-authored-modes-generative-ui-fable-ideas.md)
and [Sol review](260831am-reader-authored-modes-generative-ui-review-sol.md) disagree about the scope.
We should preserve the useful challenge: show how Quotes' server-verified anchoring, Timeline's
uncertainty/order, and Ideas' nested occurrences survive the design. “Agents rejected this before”
is not an answer to the new brief.

The earlier [tool-framework critique](../project/original-version/tool-framework.md) is still a
useful constraint on the mechanism: flat typed definitions, not runtime registration/locking,
string component paths or behaviour guessed from names. Its explicit conditional recommendation
for a flat catalog is compatible with this proposal. Runtime validation at untrusted boundaries
complements compile-time types; neither replaces the other.

## Three concepts that must stay distinguishable

| Concept | Examples | Why it is separate |
|---|---|---|
| Mode/presentation | Quotes, Diagram → Illustrated, Plain, Chat | A thing the reader opens; it may show existing data or have no artefact at all |
| Action | Open a mode, locate a passage, ensure artefacts, ask a question | A verb with inputs, permission, cost and a result; it can affect several modes |
| Pipeline stage or server tool | `quotes`, `sketch`, `illustrated`; `search_article_meaning` | An implementation capability; several actions may reuse it, and it need not be a navigation destination |

“Generate Quotes and Illustrated” is one intent with several pipeline dependencies and two possible
destinations. “Explain access consciousness” is a question, which may use glossary/search tools
without opening Glossary or Search. A one-to-one mode-to-job registry would encode a false model.

## Mode catalog: concrete scope and migration

Use a **compile-time catalog of built-ins** first. No registration side effects, runtime imports
from user URLs, database-backed plugin installation or widening `Mode` to arbitrary `string`.
Keep metadata importable by both browser and server without pulling either runtime across the seam.

Proposed `src/mode-catalog.ts` contains the shared discovery facts: stable built-in ID, label,
short description/search aliases, experimental status and presentation family (`plain`, `columns`,
`band`). Derive `Mode` from its literal keys or keep the existing closed union with a total
`satisfies Record<Mode, ...>` during migration. Choose one as the final vocabulary owner, not both.
Retain `modes.ts` as a compatibility export until all imports move deliberately.

The catalog can reference command IDs, but do not hand-maintain the same relationship in two places.
For v1, derive each mode's Open action from its ID and give generation actions their own definition.
Titles and Dock descriptions read shared metadata. Manual Dock order remains an explicit ordered
list with exhaustive/duplicate checks; it need not match catalog order or command ranking.

Per-layer adapters stay narrow and total:

| Adapter | Contents | Boundary |
|---|---|---|
| Browser UI | Icon component, controller/presenter, optional code loader | May import React and browser feature code; never imported by the shared/server catalog |
| Visitor policy | Available from public payload, unavailable/owner-only, relevant artefact keys | Existing `visitor.ts` semantics; visible does not mean writable or generatable |
| Action implementation | Typed handler, applicability and result mapping | Reuses navigation, jobs and conversation services; mounting a presenter never executes it |
| Pipeline/store | Current stage definitions, shapes, freshness, permissions and public projections | Existing server modules; not flattened into the browser descriptor |

Some of these tables are appropriate independent projections, not duplicated facts. `label` in
three places is duplication; a renderer and a SQL permission keyed by the same mode are different
facts. Consolidate the former and make the latter exhaustive. Avoid reintroducing `Partial` records
and catch-all defaults that silently lose a newly added mode.

A broader `ModeDefinition` is viable if it composes these pieces through typed references/functions.
It need not mean a universal data schema. Prove the shape against four pilots:

- Plain: no band, no artefact, no model work.
- Ideas: stored/generated data, nested occurrences and passage publication, owner/visitor variants.
- Diagram: sub-modes with different data, renderers and dependencies; Illustrated needs Sketch.
- Chat: a conversation with streaming/live operation lifetimes, not a list backed by a stage.

The pilot passes if adding a built-in requires one discovery definition, its implementation and
explicit policy entries surfaced by the compiler. It fails if a mode gains a bag of meaningless
optionals, casts away capability types, or requires editing the shell's access/position logic.
Do not choose a registry solely because it reduces an edit count while hiding important decisions.

## A shared action contract

The following is a **proposed type sketch**, not an existing API. Names should be aligned with
current types when implemented. Use a mapped action union so adding a verb makes validators,
handlers and effects incomplete at compile time:

```ts
type ActionArguments = {
  "mode.open": { target: ModeTarget };
  "mode.activate": { target: ModeTarget };
  "passage.locate": { query: string; strategy: "words" | "meaning" };
  "passage.jump": { blockId: BlockId };
  "artefacts.ensure": {
    outputs: readonly [GeneratableOutput, ...GeneratableOutput[]];
    useProfile: boolean;
  };
  "chat.ask": {
    question: string;
    conversation: ConversationTarget;
    at: BlockId | null;
    useProfile: boolean;
    origin: QuestionOrigin;
  };
};

type AppAction = {
  [K in keyof ActionArguments]: { kind: K; args: ActionArguments[K] }
}[keyof ActionArguments];
```

`ModeTarget` is a discriminated union: ordinary modes have only their mode ID; Diagram, Remember
and Referee carry their own valid sub-mode vocabulary. `GeneratableOutput` is a closed set of
supported outputs, not any string and not every `StepName`. `ValidatedAnchor` is the current
block/quote contract after resolution. Do not invent character-offset article addressing.

`ConversationTarget` explicitly distinguishes **new** from **existing** thread. New carries its
thread kind and validated thread anchor (or null); existing carries a thread ID whose article,
owner and kind are verified before sending, never a replacement thread anchor. Remember sends
also carry the selected `RememberStance`; encode that with a discriminant rather than making it a
meaningless optional on ordinary Chat. `at` is the current turn's block, distinct from the thread's
anchor. `QuestionOrigin` distinguishes an ordinary question, paragraph-help question and a new
conversation from a comment; preserve `help` and `sourceCommentId` where applicable. These are
semantic inputs, not a bag of callbacks exposed to the interpreter.

**Every initiating control's semantic choices must survive the action boundary.** Capture profile
opt-out, destination, stance, anchor and question origin on submission; never recover missing
values from whichever composer is open later. Map into the current
[`useChat.ts`](../../src/web/useChat.ts) § `SendOptions`/`ChatApi.send`; the adapter owns thread-ID
correction callbacks. The first pilot may support ordinary Chat only. Do not migrate Remember,
Candidates, comment or paragraph-help callers until the action variants preserve their complete
current contract. Existing-thread targets are looked up through the article conversation service,
not trusted because a model supplied an ID.

Similarly, `artefacts.ensure` always retains current valid outputs and carries an explicit profile
choice. Regenerate controls stay on their existing path until a separate typed regeneration action
can express the exact named forced outputs and the current prerequisite/force policy. Do not map
regenerate to ensure, or force a whole pipeline because one output was requested. The shared
generation adapter derives prerequisites from current output state and stage policy, includes them
in the disclosed execution plan and preserves `useStepJob`'s profile opt-out. A caller's deliberate
prerequisite choice must be represented, not silently dropped during migration.

The two opening verbs preserve a distinction already present in the product. `mode.open` is pure
navigation, appropriate to “show existing Quotes,” a deep link or history restoration.
`mode.activate` is an explicit mode selection like pressing its Dock button: it preserves today's
policy that certain empty modes may start their generation. The command palette's ordinary mode
row should initially behave like the Dock row and disclose the same readiness/cost state. An
explicit “generate” command goes straight to `artefacts.ensure`, independent of panel mounting.
These are proposed defaults to validate in the command-bar prototype, not new claims about current UI.

Every action definition supplies a stable ID, human description/aliases, argument validation,
availability with a reason, an effect classification and a typed result. Effects are more precise
than read/write: local navigation, network read, paid model read, persisted generation and
conversation write differ. Read-only Meaning Search can still cost money. Availability is computed
against current capability, connection and inputs, not inferred from whether a button is visible.

Results should distinguish `completed` with typed data, `accepted` with actual job/operation IDs,
`unavailable` with a reason, `cancelled`, `unknown` for an uncertain submission outcome, and `failed`
with safe copy. A job POST is accepted, not
completed. A batch tracks child results; it must not announce everything done because one child
succeeded. Use existing job snapshots as the source of execution progress.

Suggested homes are `src/app-actions.ts` for pure request/result vocabulary and schemas,
`src/web/commands/` for discovery and browser execution, and existing server services for their
operations. These paths are proposals. Runtime schema validation is required at model/network
boundaries; a TypeScript annotation on parsed JSON is not validation. Reuse the repo's existing
validation approach unless a small spike demonstrates why a dependency earns its place.

### Identity, intent and cancellation

Capture the reader/session epoch and article identity when an explicit submission is accepted.
Do not substitute whichever article happens to be open when an interpretation returns. Before
each action, recheck that captured context against the current session and capability. A pending
interpretation for article A must become a cancelled/stale suggestion on navigation to B. A job
already submitted for A may keep running under the current queue policy and remain clearly labelled A.
If the source snapshot changed during interpretation, re-resolve a proposed block/quote against
the current article before jumping; absent is a useful failure, not a guess.

Execution requires explicit user intent. Merely typing, ranking suggestions, loading JavaScript,
rendering a preview, returning by Back or receiving a model tool call does not authorise a paid
action. An unambiguous submitted command names the requested work, but does not prove its price was
visible. Preserve [Diagram's price-before-press policy](../project/diagram.md#what-it-costs-and-what-that-decides):
include the **full prerequisite work and total estimated cost/wait before the spend-authorising
press**. A deterministic action row that already disclosed that plan needs no redundant confirmation.
For free language or voice, if interpretation is the first time the effects/prerequisites/cost are
known, show one inline interpreted-plan confirmation before generation. An editable transcript
alone is not cost disclosure. Use existing estimate sources, not hardcoded prices from this audit.
Revalidate prerequisites at execution; newly required work or a material estimate expansion returns
to that inline plan rather than silently increasing spend. Current outputs may be skipped without
asking again. Existing quota/billing and ownership checks still apply. Clarify material ambiguity
and explicitly confirm forced replacement or scope expansion; external sharing/deletion need not
enter v1 at all. This is a proposed command UX preserving an existing policy, not a new blanket
confirmation dialog around today's correctly priced controls.

Give a submission an execution ID and consume its intent at most once locally. That is **not**
server idempotency: `useJobs.run`/`parseJobRequest` currently accept no client idempotency key, and
`jobs_active_work` only deduplicates queued/running work. A matching work identity after a lost
response is not proof of which request created a completed job. Until the server contract below
exists, an uncertain POST is **never automatically resent**. Reconcile an unambiguously identified
accepted job if available; otherwise return `unknown`, retain the submitted plan and explain that
work may have started. A new user decision to retry must disclose that uncertainty; do not label
the first request “not sent” or promise no duplicate charge. Retrying an interpreter never repeats
actions already accepted or of unknown outcome.

Before enabling automatic job-submission retries, add a durable client-minted idempotency key to
the authenticated job API. In one server transaction, uniquely reserve `(owner, action, key)` with
the canonical request fingerprint and resulting job identity; a repeat returns the original outcome
after completion too, while reuse with different inputs is rejected. Atomically bind admission/job
creation so concurrent requests cannot both create/charge work. Keep a compact receipt/tombstone if
the job is forgotten; do not silently reuse an expired key. Define retention and expired-key errors
before shipping, and test lost responses, concurrent retries, terminal jobs and mismatched payloads
against Postgres. This additive server work is a separately reviewed prerequisite for **automatic
resend**, not a reason to block the navigation-only catalog pilot. Reuse existing chat operation IDs
and server attempt fences for conversation sends; do not build a second chat retry protocol.

Separate “stop interpreting” from “cancel submitted work.” Escape closes the command UI and aborts
an interpretation/dictation that has not submitted anything. It does not cancel already accepted
jobs. An explicit Cancel action uses the existing job cancellation path and reports what actually
stopped. Concurrent chat/live/microphone ownership follows the current feature policy.

## How the examples execute

| Reader request | Proposed interpretation | Existing mechanism and visible result |
|---|---|---|
| “Open Glossary” | `mode.activate` for Glossary; same explicit-selection semantics as Dock | Existing URL helpers and activation policy; current readiness or generation state |
| “Take me to the bit where the article introduces article consciousness” | Locate a passage, then jump to a validated result | Literal search first when useful; meaning search when requested/needed; real BlockIds and passage previews; existing `jumpTo`/`scrollToBlock` |
| “Generate me Quotes and an Illustrated diagram” | Ensure both outputs, coalescing prerequisites | One existing job request for Quotes, Sketch and Illustrated steps, server-ordered; visible progress per output; no forced regeneration by default |
| “Explain how access consciousnes is different from phenomenal consciousness” | `chat.ask`, using the submitted wording and current article context | Existing article conversation/tool loop streams a cited answer; no new generated “explanation mode” required |

Preserve the original text of a question. For the “article consciousness” example, retrieval may
suggest passages about **access** consciousness; if that correction determines the action and the
match is uncertain, show the relevant candidates. Do not quietly reinterpret an ambiguous query
and announce that the article supports the replacement phrase. A confident local search match may
jump directly with a clear return path; the ambiguity threshold is a prototype/product choice.

For multi-output generation, verify current [`useJobs.ts`](../../src/web/useJobs.ts) § `run`,
[`pipeline.ts`](../../src/pipeline.ts), [`step-order.ts`](../../src/step-order.ts) and the
Illustrated dependency before implementing. The current required steps are `quotes`, `sketch`,
`illustrated`; retain the server's validation/order/deduplication, rather than serially clicking
two UI buttons or maintaining a command-specific scheduler. “Generate” proposes ensure semantics;
“regenerate” must be an explicit different intent. If one output is already current, keep it.
Opening Diagram alone still does not mean “buy an illustration.”

Do not navigate through two modes in quick succession merely because two outputs were requested.
Keep the current reading surface while the batch runs and offer links to each result. A sensible
single final destination, if requested, can be selected once. Partial failure should name the
unfinished output and retry only the necessary failed work under the existing job contract.
An unknown submission is not a failed output eligible for blind resend; apply the rule above.

## Reuse what is already built

[`chat-tools.ts`](../../src/chat-tools.ts) already contains `CHAT_TOOLS`, `ToolContext`,
`runTool`, literal/meaning article search and glossary/library/web tools.
[Chat tools](../project/chat-tools.md) records the product intent and the bounded/untrusted result
rules. It is server code, and its current `ToolOutcome` is primarily display/model text. It is not
an application command dispatcher and should not be imported into the browser.

Extract/reuse the underlying search and glossary operations where useful. Give navigation actions
structured results with validated BlockIds; never parse a block ID or job ID back out of prose
rendered for a model. A server interpreter can call allowed read/search tools to resolve an intent,
then return a validated action plan. A browser handler invokes navigation or the existing API.
Existing chat tools remain read/research tools until write-capable actions are separately admitted;
do not expose generation to every chat turn as a side effect of registering a command.

[`useDictationField.ts`](../../src/web/useDictationField.ts), `DictationButton`,
`DictationStrip`, microphone locking and [dictation](../project/dictation.md) already solve speech
capture/transcription. Reuse them. Dictation feeds the **same text field and submit path** as typing.
The live provisional transcript is not an executable command. v1 voice records, transcribes and
shows editable text; a later explicit “speak and execute” gesture may submit the final transcript
once, if the prototype warrants it. Do not build a second always-listening microphone pipeline.

Natural-language interpretation is optional after deterministic command search works. Stream any
person-waiting model interpretation through existing transport/cost handling. Interpret only on
explicit submission, not on every keystroke. A model outputs a bounded `ActionPlan` of known
actions with validated arguments and dependencies. No arbitrary URLs, JavaScript or executable
instructions. Article prose and tool output remain evidence, never authority to add actions.

For v1, execute a small bounded ordered plan. Coalesce independent generation outputs into the
existing queue; do not invent a durable workflow engine. Validate the **whole** plan before the
first action, so a malformed second action cannot leave an unexplained partial mutation. At
execution time recheck permissions/identity before each step because validity can change. Record
which steps were accepted, finished or failed; never pretend a multi-step plan is atomic.

## Command-bar interaction

Start with a searchable action list that works without a model: mode names, aliases, “find in this
article,” “ask this article,” and explicit generation entries. Results include applicability and
why an action is unavailable. Keep the existing Dock as another entry point. A command bar improves
discovery and reachability; it should not force readers to memorise an invisible command language.

Choose a keyboard binding after checking [keyboard](../project/keyboard.md) and existing browser/
app shortcuts. Provide a visible touch button as well. On a phone, reuse the mode/overlay work in
the main plan: visible-viewport fit, reachable submit and close controls, an appropriate true-modal
focus contract, and a result list that stays scrollable above the keyboard. Reopening should keep
an unfinished command draft until an explicit submit/clear, within the same reader identity.

Show the interpreted action briefly as it begins (“Finding a passage…”, “Quotes queued…”), then
stream/progress in the appropriate existing surface. Use action IDs and typed outcomes internally;
do not expose schemas, execution IDs or routing jargon as product UI. An error should say what
did not happen and what the reader can do next, per [copy](../project/copy.md).

**Proposed v1 conversation default:** the palette's “Ask in a new chat” creates a new ordinary Chat
thread and leaves every existing composer draft untouched. Its label/preview names that destination
before submission and exposes the profile choice. Do not append silently to the currently open
thread. An explicitly selected “Continue this chat” action may follow, with a captured/validated
thread ID and its own visible destination. Starting either send must preserve unrelated drafts and
the current conversation's operation rules. Existing Chat UI triggers keep their current thread
choice when migrated. This default is a proposal to assess in the prototype, but it is concrete
enough for the pilot; changing it is a visible product decision, not an executor inference.

## Implementation stages

These are future implementation stages; the present work lands this plan only. Follow the main
plan's worktree, tests, review, browser validation and commit/push cadence.

### Stage: Pilot a discovery catalog with four different built-ins

- [ ] Record current metadata/visitor/activation/Dock ordering behaviour for Plain, Ideas, Diagram
  and Chat. Read the mode-specific policy before treating fields as interchangeable.
- [ ] Introduce the pure catalog and exhaustive UI/policy adapters. Migrate labels/descriptions/
  experimental facts that are truly duplicated; retain manual Dock order and server import barriers.
- [ ] Prove missing/duplicate mode registration fails; mode titles and Dock agree; visitors receive
  only allowed surfaces/data; metadata import does not pull React or pipeline modules across layers.
- [ ] Check that catalog enumeration causes no fetch, generation or controller mount. Measure the
  build graph. Expand to the remaining built-ins only if the four counterexamples remain readable.
- [ ] Update `new-mode.md`, `web-client.md` and relevant ownership signposts after it lands.

### Stage: Establish typed actions and a deterministic command bar

- [ ] Implement argument/result vocabulary and exhaustive dispatcher with injected reader
  capabilities. Do not create a global mutable pointer to whichever reader mounted most recently.
- [ ] Begin with `mode.open`, `mode.activate`, `passage.jump` and simple discovery. Reuse existing
  URL/activation logic. Selecting a mode from Dock and from the palette should have matching
  explicit-press behaviour; direct URL arrival still spends nothing.
- [ ] Add `artefacts.ensure` by reusing the queue submission/reconciliation path and server order.
  Preserve `useProfile` and complete prerequisite disclosure; keep regeneration out until exact
  force semantics have their own typed action. Add ordinary `chat.ask` through the article-scoped
  conversation interface with the explicit new-chat/draft policy above; exclude other thread kinds
  until their semantic inputs have equivalent action variants.
- [ ] Migrate the relevant existing UI triggers to the same actions in small batches, deleting
  duplicate logic only after parity tests. The action API is an implementation seam, not another
  task scheduler or second set of job-generation rules.
- [ ] Build desktop/touch command UI with accessibility/focus/keyboard behaviour; no model required
  to search command names. Commands unavailable offline remain discoverable with honest reasons.
- [ ] Test paired-output generation, existing data, missing prerequisites, rejected quota, uncertain
  POST completion, cancellation and one failed output. Until durable server idempotency lands,
  unknown submissions never automatically resend. Test `useProfile: false`, preserved composer
  drafts and the captured new/existing destination. Opening a mode must not imply force.
- [ ] If automatic POST retries are included, land and review durable server idempotency first,
  including terminal/forgotten jobs, simultaneous duplicate keys and mismatched request rejection.
  It is not provided by the existing active-work deduplication index.

### Stage: Add passage intent resolution and dictation

- [ ] Implement structured locate results using current literal/meaning search operations. Validate
  returned block IDs/ranges against the article; show candidates when the intended passage is unclear.
- [ ] Reuse dictation in the command text field. Test transcript corrections, repeated final events,
  Escape, navigation, account change and microphone contention with live conversation.
- [ ] Add a bounded interpreter only for submitted free language that deterministic actions cannot
  handle. Reuse the AI gateway/stream outcome machinery and preserve original text and explicit intent.
- [ ] Validate complete plans before execution, then identity/permissions per action. Test the
  three quoted user examples, no-match/ambiguous variants, malformed actions and article instructions
  attempting to append extra work. Test undisclosed prerequisites/cost: free-language generation
  shows one inline plan confirmation, while selection of an already-priced deterministic row needs
  no redundant modal. Interpreter replay never repeats accepted or unknown actions.
- [ ] Run real keyboard/touch/voice trials before selecting “speak and execute” or automatic jumping
  behaviour. Update chat-tools, dictation, keyboard and feature docs to describe what actually shipped.

## Future extensibility: useful seams now, broader options later

### Reader-authored lenses

The cheapest user-authored mode remains a named saved query with chosen presentation. Meaning Search
already supplies anchored results. A next step could add versioned instructions and a constrained
result schema rendered by trusted components: passages, grouped lists, cards, comparisons and
validated diagrams. That is a product extension alongside built-ins, not proof it can replace them.

Let such a lens call the same navigation/search/generation actions through a constrained host API.
Use the same validated block/provenance output contract as built-ins. Keep definition, result and
view state distinct: updating a definition must not silently reinterpret old stored results as if
they came from the new version. Check output quality against several articles and expected omissions,
not only the example that inspired the lens. A generated definition remains untrusted input.

### More expressive generated UI

There are three viable directions to compare when constrained lenses become limiting:

| Option | Benefit | Cost and limitation |
|---|---|---|
| Declarative schema + trusted renderers | Consistent mobile/accessibility/provenance; easiest validation | Expressiveness bounded by host components; kit evolution becomes product work |
| Generated code in a separately isolated renderer using a host capability protocol | Richer interaction/visuals and user creativity | Isolation, message validation, resource limits, focus/accessibility, versioning and recovery become a substantial new subsystem |
| Agent produces a reviewed built-in extension | Full native capability and ordinary tests/review | Slow authoring loop and a deployment; useful graduation path for a proven lens |

Generated executable modes are **not permanently ruled out**. An isolated code runtime may be the
right long-term choice if the expressive benefit proves large. It should be evaluated with a small
real example the component kit cannot express; generating arbitrary React into the privileged app
bundle is a different proposition and does not acquire safety from being named a mode.

The common catalog/action interface can serve all three without choosing their storage or sandbox
today. Do not claim that a registry itself provides isolation, permissions or trustworthy output.

### Marketplace

A marketplace adds installation and trust lifecycles, not simply more entries in Dock. Future work
must distinguish publisher identity from the reader paying for execution, definition versions from
result versions, and display permissions from data/model-call capabilities. Cache/run identity will
need article content version, owner, definition/prompt version and relevant profile/model inputs.
Installed IDs should be namespaced separately from the closed built-in vocabulary when that feature
arrives. Do not reserve a database schema or replace every `Mode` with string now.

Existing exact-public-projection and capability checks still apply to shared results. A public
visitor should not execute an owner's plugin, inherit their tools or bill their account merely by
opening its output. Stable saved results should remain readable when a definition is updated or
uninstalled, or clearly declare why they cannot; silently re-running is not a migration policy.

For now, establish discoverability, action validation and good feature boundaries. Evaluate the
four-mode catalog pilot by the present app's simplicity, and the command bar by whether the reader
can reach the intended text/action easily. Those are useful outcomes even if a marketplace never
ships.

## Verification and decision record

The main plan carries current build/check results and the final review disposition. Specific new
checks for this companion should demonstrate: catalog exhaustiveness without one-schema flattening;
current Dock order and visitor/experimental rules; zero effects during discovery; action argument and
result validation; captured identity across delayed interpretation; whole-plan validation before
mutation; actual job acceptance versus completion; no duplicate paid work on retry; exact stable-ID
navigation; and equivalent typed/dictated submissions.

Open product choices for implementation: the command-bar shortcut, precise explicit-selection and
price-display wording, how uncertain passage matches are presented, whether to offer an explicit
continue-existing-thread command in v1, and whether final speech can submit immediately. The proposed
new-chat/no-draft-loss default above applies until deliberately changed. Cost disclosure is a
contract, not an optional prototype choice; immediate voice submission cannot bypass it. None of
these presentation choices blocks the navigation-only catalog pilot. Present concrete prototype
behaviour rather than requesting approval for a vague architecture diagram.

Up: [Main app architecture review](260905e-main-app-architecture-review.md) ·
[Reading view](../project/reading-view-overview.md) · [Chat tools](../project/chat-tools.md)
