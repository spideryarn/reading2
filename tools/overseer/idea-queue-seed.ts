/**
 * THE QUEUE'S FIRST CONTENTS — the sixteen clusters, migrated out of prose.
 *
 * [overseer-queue.md](../../docs/project/overseer-queue.md) held these as a
 * Markdown table with a *waiting on* column, deferred whole by Greg on
 * 2026-09-08 so the fleet could focus on the Overseer and its dashboard. This
 * file is that table as data.
 *
 * **A CHECKED-IN, DETERMINISTIC SEED — not a live authority.** The live queue is
 * one file off the repo (`idea-queue.ts` § where the queue lives); this is the
 * manifest that populates it once, versioned so the migration can be reviewed
 * and re-run against a fixture. GPT Sol's P2-2 named that split, and its P1-4
 * named the rest: **applying this to the real queue is a CUTOVER, not a
 * migration**, because `overseer.md` still names the Markdown file as gate 3's
 * source. Two sources of authorisation is worse than an old one, so the cutover
 * and the runbook edit are one approved change, and that edit is Greg's.
 *
 * **The wording is the doc's, not Greg's.** Each `text` is its one-line reason
 * and each `waitingOn` its own cell, copied rather than improved: a migration
 * that rewrites its content as it goes is a migration nobody can check. So
 * `source` points at the plan that holds the real detail, and these are not
 * presented as quotations.
 *
 * **`by: "overseer"`, so every seeded row arrives as a PROPOSAL — and Greg
 * authorises the sixteen in one act at cutover.**
 *
 * The first version wrote `by: "greg"`, on the reasoning that his approval was
 * real and documented so the field carrying it should name him. GPT Sol
 * objected twice, and the second time named the cheaper honest option this file
 * now takes: **under the documented meaning of `by` — *who recorded this* —
 * naming Greg is simply false provenance.** He did not run the migration; a
 * script did.
 *
 * Seeding them as proposals costs one command at cutover and buys three things.
 * The field stops lying. The authorisation becomes a **fresh, dated, attributed
 * act** by the only person who can make one, instead of a claim about a
 * conversation the day before. And the cutover — which is Greg's anyway, since
 * it edits `overseer.md` — is where that act naturally belongs.
 *
 * So the sixteen land as proposals, and `overseer-queue seed` prints the
 * `authorize` commands rather than performing them.
 *
 * **The four clusters whose *waiting on* names Greg are seeded `needsGreg`**,
 * which is what that field is for: the doc says he was asked on 2026-09-08 and
 * chose to defer rather than decide, so *"ask again before dispatching those
 * four"* — a sentence previously enforced by somebody reading a column, and now
 * by `isDispatchable`.
 *
 * **The Overseer's two proposals are deliberately NOT seeded** (Sol's P1-4).
 * They stay in the Markdown, under the heading that says it may not originate
 * them, until Greg promotes one. Migrating a proposal into the authorisation
 * record is the one move this whole file is careful not to make.
 */
import { envelope, mintId, type IdeaEvent, type IdeaMetadata } from "./idea-queue.js";

/** Where the detail lives. Every cluster points at the same plan. */
const PLAN = "docs/plans/260908f-prioritised-spideryarn-codebase-improvements.md";

type Seed = {
  /** The doc's own cluster letter, kept in the title so the two can be lined up. */
  readonly letter: string;
  readonly line: string;
  readonly waitingOn: string;
  readonly size?: string;
  readonly areas?: readonly string[];
  /** True where the *waiting on* cell names Greg — seeded needing him, so it is not dispatchable. */
  readonly needsGreg?: true;
};

/**
 * The sixteen, in the doc's order — which is also the plan's own recommended
 * order, and its first batch is A, the first B stage, C, D, P.
 */
export const CLUSTERS: readonly Seed[] = [
  {
    letter: "A",
    line: "opening reads overwriting later actions — gate Run/Find/Save until the opening read settles, or reconcile",
    waitingOn: "Greg: submit gate vs reconciliation",
    needsGreg: true,
  },
  {
    letter: "B",
    line: "contain failures in independently mounted modes — wrap Debate first, then an honest inventory of the rest",
    waitingOn: "a lull",
  },
  {
    letter: "C",
    line: 'carry a glossary question into chat — "Ask in chat" opens an editable question about the term',
    waitingOn: "Greg: fresh conversation vs existing draft",
    needsGreg: true,
  },
  {
    letter: "D",
    line: "Knip without a fresh build — stop vite.api.config.ts evaluating the client shell at load",
    waitingOn: "a lull; no product question",
    areas: ["vite.api.config.ts"],
  },
  {
    letter: "E",
    line: "stream the glossary's two lookups — stream the unsaved answer first, then the saved one",
    waitingOn: "a lull",
  },
  {
    letter: "F",
    line: "figures at a readable resolution — trial a ~1,280px srcset candidate under the existing caps",
    waitingOn: "Greg: trial it, or defer F",
    needsGreg: true,
  },
  {
    letter: "G",
    line: "finish the route-table migration — Comments slice next, with its stream-lifetime oracle first",
    waitingOn: "a lull; coordinate with the slice's owner",
  },
  {
    letter: "H",
    line: "one binary-response writer — six header set-sites, six deliberate differences to keep",
    waitingOn: "a relevant route slice",
  },
  {
    letter: "I",
    line: "retire the obsolete revision alias — 13 test imports to repoint, then delete",
    waitingOn: "a lull; XS",
    size: "XS",
  },
  {
    letter: "J",
    line: "one retry predicate for Search and criteria — share the decision, not the row",
    waitingOn: "the next retry-rule edit",
  },
  {
    letter: "K",
    line: "one missing-key check for seven readers — leave the five distinct contracts alone",
    waitingOn: "the next gateway edit",
  },
  {
    letter: "L",
    line: "unknown-throw mapper investigation — XS, may end with no change",
    waitingOn: "a lull",
    size: "XS",
  },
  {
    letter: "M",
    line: "keyboard access to a passage's terms — try jumping to the glossary row before building a list",
    waitingOn: "Greg: which interaction, or defer M",
    needsGreg: true,
  },
  {
    letter: "N",
    line: "retain PDF item boundaries through scoring — fidelity experiment before any heuristic change",
    waitingOn: "a lull; L-sized",
    size: "L",
  },
  {
    letter: "O",
    line: "operate abandoned-draft retention — per-article sweep on step start; no remote run without asking",
    waitingOn: "a lull; the remote run is Greg's",
  },
  {
    letter: "P",
    line: "reader study protocol — doc only; Greg runs the study",
    waitingOn: "a lull",
  },
];

function metadata(seed: Seed): IdeaMetadata {
  return {
    source: PLAN,
    waitingOn: seed.waitingOn,
    size: seed.size ?? null,
    areas: seed.areas === undefined ? [] : [...seed.areas],
    runs: "docs/reusable/engineering-manager.md",
  };
}

/**
 * The events that seed an empty queue.
 *
 * **Deterministic given its inputs** — `at` and `mint` are injected, so the same
 * call twice produces the same file but for the event ids, and a test can assert
 * that the migration produced exactly what the table said. Sol's P1-4 asked for
 * that in as many words: a migration nobody can verify against its source is a
 * migration that quietly rewrote something.
 *
 * **Everything is appended at the back, in the doc's order**, because the doc's
 * order is the plan's recommended order (its first batch: A, the first B stage,
 * C, D, P) and re-sorting it here would be this migration making a decision that
 * belongs to whoever picks the work up.
 */
export function seedEvents(options: { at: string; mint?: () => string }): IdeaEvent[] {
  const mint = options.mint ?? mintId;
  return CLUSTERS.map((seed) => ({
    /* `by: "overseer"` — the script recorded these, and `by` means the
       recorder. `foldQueue` therefore makes each one a PROPOSAL, and Greg's
       `authorize` at cutover is the real authorisation. See the header. */
    ...envelope("overseer", { at: options.at }),
    kind: "added" as const,
    id: mint(),
    text: seed.line,
    title: `${seed.letter} — ${seed.line.split(" — ")[0] ?? seed.line}`,
    metadata: metadata(seed),
    placement: { at: "back" as const },
    needsGreg: seed.needsGreg === true,
    /* **THE SEED STATES NO PRIORITY**, and that is the same restraint as `by`.
       These sixteen are Greg's, and where they sit relative to Overseer tooling
       and the dashboard is a banding he gave on 2026-09-09 — after this file was
       written, and over a queue that will hold more than these. Applying it is
       `overseer-queue set-priorities`, one reviewed command over the live file,
       rather than a number frozen into a migration. 260909d. */
    priority: null,
  }));
}
