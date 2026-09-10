#!/usr/bin/env -S npx tsx
/**
 * `overseer-decisions` — record and inspect delegated decisions from a terminal.
 *
 *     npx tsx scripts/overseer-decisions.ts template > /tmp/decision.json
 *     npx tsx scripts/overseer-decisions.ts add --file /tmp/decision.json --by overseer
 *
 * The template is the ergonomic centre: the Overseer writes these while work
 * is moving, and one structured file is easier to inspect than nine shell flags
 * with quoting spread between them.
 *
 * **`--by` is required on every write and never defaulted.** This record is the
 * counterparty to delegated authority; a write with nobody's name on it is
 * exactly what it must refuse. Defaulting to Greg would let an agent mint his
 * authority merely by omitting a flag.
 *
 * **It remains a self-declaration, not proven identity.** Anything running as
 * this Unix user can pass `--by greg`, or append such a line directly. Only
 * Greg's review events are honoured by the fold, but this is a governance
 * constraint rather than an OS boundary. Saying otherwise would advertise a
 * protection the file does not have.
 *
 * Session executions are looked up at decision time, the only moment a reusable
 * pane name can still be joined to a particular run. The three result arms keep
 * "not there" separate from "could not look" without ever refusing a decision.
 *
 * **Schema 2 (plan 260910e).** `add` writes who decided as well as who
 * recorded: the author is `--by` itself (overseer ⇒ the Overseer, greg ⇒
 * Greg), so a file may not carry one. `--by daemon` is refused — only the
 * daemon's report drain records a line as `daemon`, and only for a session's
 * decision. Every other schema-2 field is required in the file, and a file
 * missing any is refused by name rather than defaulted: a default consequence
 * would rank a decision by a guess. Evidence is written in the CLI spelling
 * (`commit:`, `path:`, `decision:`, `queue:`); a decision reference is checked
 * against this record, and the rest are stored as unchecked with the reason,
 * because this command has no git checker of its own.
 *
 * `console.log` is correct here: docs/project/logging.md's rule follows the
 * destination, and this destination is a terminal rather than a server log.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Command, InvalidArgumentError } from "commander";

import {
  describeArtefactCheck,
  parseArtefactSpec,
  spellArtefactRef,
  type ArtefactRef,
  type CheckedArtefact,
} from "../tools/fleet/artefact-ref.js";
import {
  decisionMatchesSearch,
  executionRefFor,
  isPendingReview,
  projectDecisionCheckpoint,
  projectDecisions,
  type DecisionCheckpointInput,
  type DecisionsProjection,
  type ProjectedDecision,
  type ProjectedSessionState,
} from "../tools/fleet/decisions-view.js";
import {
  ASSESSMENT_FIELDS,
  CONSEQUENCES,
  DECISIONS_FILE,
  DECISIONS_SCHEMA,
  DECISION_DOMAINS,
  ID_RULE,
  LEGACY_DECISIONS_SCHEMA,
  NOT_RECORDED,
  appendEvents,
  decisionsRoot,
  envelope,
  mintId,
  parseEvent,
  parseEventDetailed,
  readDecisions,
  spellVersion,
  viewOf,
  type Adviser,
  type BearsOn,
  type Confidence,
  type Consequence,
  type DecidedEvent,
  type DecidedV2Event,
  type DecisionActor,
  type DecisionAuthor,
  type DecisionClass,
  type DecisionDomain,
  type DecisionEvent,
  type DecisionOption,
  type DecisionRecord,
  type DecisionRecorder,
  type DecisionView,
  type GregAsked,
  type NotRecorded,
  type Reversibility,
  type SessionRef,
} from "../tools/overseer/decisions.js";
import { readCheckpoint, storeRoot } from "../tools/overseer/store.js";

const TEMPLATE = `// Copy this to a file, replace the examples, then run:
// npx tsx scripts/overseer-decisions.ts add --file <that-file> --by overseer
// There is no "author" field: --by is who decided (overseer or greg).
// Every field is required. Text is one line each: no tabs or newlines.
{
  "class": "decision",
  "question": "Which shape should the first version use?",
  "options": [
    { "name": "Small", "tradeoffs": "Ships quickly, with fewer extension points." },
    { "name": "General", "tradeoffs": "Handles imagined cases, with more machinery." }
  ],
  "chose": { "option": "Small", "note": "Use the small shape." },
  "why": "There is no demonstrated need for the extension points.",
  "advisers": ["nobody"],
  "bearsOn": { "sessions": [], "plan": null },
  "supersedes": null,
  // consequence: high | medium | low — how much it matters if this is wrong. Ranks first.
  "consequence": "low",
  // reversibility: easy | costly | one-way. Ranks second.
  "reversibility": "easy",
  // domain: product | technical
  "domain": "technical",
  // What you recommend if Greg looks again, or null.
  "recommendation": null,
  // evidence: a list of commit:<sha>, path:<repo-relative path>, decision:<dec-id>, queue:<qi-id>
  "evidence": [],
  // gregAsked: no | asked-answered | asked-awaiting — your claim, and shown as yours.
  "gregAsked": "no",
  // confidence: high | medium | low, or null. An annotation; it never ranks.
  "confidence": null
}`;

/** The schema-2 fields a file must carry: all of them but `author`, which `--by` supplies. */
const INPUT_ASSESSMENT_FIELDS = ASSESSMENT_FIELDS.filter((field) => field !== "author");

type ListAuthor = "overseer" | "greg" | "session" | "legacy";

const HISTORICAL_SEED_ID = "dec-dashstg6";
const HISTORICAL_SEED_COMMAND_ID = "seed-2026-09-09-0812-claude-agents-dashboard-stage-6";
const HISTORICAL_SEED_DECIDED_AT = "2026-09-09T08:12:00Z";

function actor(value: string): DecisionActor {
  if (value === "greg" || value === "overseer") return value;
  if (value === "daemon") {
    throw new InvalidArgumentError(
      "actor must be 'greg' or 'overseer': 'daemon' is written only by the Overseer daemon's report drain, " +
        "when it copies a session's decision",
    );
  }
  throw new InvalidArgumentError(`actor must be 'greg' or 'overseer', not '${value}'`);
}

function listAuthor(value: string): ListAuthor {
  if (value === "overseer" || value === "greg" || value === "session" || value === "legacy") return value;
  throw new InvalidArgumentError(`author must be overseer, greg, session or legacy, not '${value}'`);
}

function listDomain(value: string): DecisionDomain | NotRecorded {
  if (value === NOT_RECORDED || (DECISION_DOMAINS as readonly string[]).includes(value)) {
    return value as DecisionDomain | NotRecorded;
  }
  throw new InvalidArgumentError(`domain must be product, technical or not-recorded, not '${value}'`);
}

function listConsequence(value: string): Consequence | NotRecorded {
  if (value === NOT_RECORDED || (CONSEQUENCES as readonly string[]).includes(value)) {
    return value as Consequence | NotRecorded;
  }
  throw new InvalidArgumentError(`consequence must be high, medium, low or not-recorded, not '${value}'`);
}

function decisionId(value: string): string {
  if (ID_RULE.test(value)) return value;
  throw new InvalidArgumentError(`'${value}' is not a decision id (they look like dec-a3k9mq2p)`);
}

function decisionClass(value: string): DecisionClass {
  if (value === "assumption" || value === "decision" || value === "decline") return value;
  throw new InvalidArgumentError(`class must be 'assumption', 'decision', or 'decline', not '${value}'`);
}

export type Parsed =
  | { command: "template" }
  | { command: "add"; file: string; by: DecisionActor; commandId: string | null }
  | {
      command: "list";
      class: DecisionClass | null;
      unreviewed: boolean;
      json: boolean;
      search: string | null;
      domain: DecisionDomain | NotRecorded | null;
      consequence: Consequence | NotRecorded | null;
      author: ListAuthor | null;
    }
  | { command: "seed" }
  | { command: "show"; id: string }
  | { command: "export" }
  | { command: "reviewed"; id: string; by: DecisionActor; note: string | null }
  | { command: "reversed"; id: string; by: DecisionActor; why: string | null };

/** The grammar only. Every action routes its typed result through `sink`. */
export function buildProgram(sink: (parsed: Parsed) => void = () => {}): Command {
  const program = new Command();
  program.name("overseer-decisions").description("the Overseer's reviewable record of delegated decisions").exitOverride();

  program.command("template").description("print a commented JSON input for add --file").action(() => sink({ command: "template" }));

  program
    .command("add")
    .description("append a decided event from a JSON file, or stdin with --file -")
    .requiredOption("--file <path|->", "the decision input")
    .requiredOption("--by <actor>", "who records it: greg or overseer", actor)
    .option("--command-id <id>", "idempotency key for a retry")
    .action((opts: { file: string; by: DecisionActor; commandId?: string }) =>
      sink({ command: "add", file: opts.file, by: opts.by, commandId: opts.commandId ?? null }),
    );

  program
    .command("list")
    .description("list decisions in review order")
    .option("--class <class>", "only assumption, decision, or decline", decisionClass)
    .option("--unreviewed", "only decisions still pending Greg's review")
    .option("--json", "print the shared projection as JSON")
    .option("--search <text>", "case-insensitive: question, options, choice, why, recommendation, plan, sessions, author")
    .option("--domain <domain>", "only product, technical, or not-recorded", listDomain)
    .option("--consequence <level>", "only high, medium, low, or not-recorded", listConsequence)
    .option("--author <who>", "only decisions made by overseer, greg, a session, or legacy (author not recorded)", listAuthor)
    .action(
      (opts: {
        class?: DecisionClass;
        unreviewed?: boolean;
        json?: boolean;
        search?: string;
        domain?: DecisionDomain | NotRecorded;
        consequence?: Consequence | NotRecorded;
        author?: ListAuthor;
      }) =>
        sink({
          command: "list",
          class: opts.class ?? null,
          unreviewed: opts.unreviewed ?? false,
          json: opts.json ?? false,
          search: opts.search ?? null,
          domain: opts.domain ?? null,
          consequence: opts.consequence ?? null,
          author: opts.author ?? null,
        }),
    );

  program.command("seed").description("apply the one hand-authored historical decision").action(() => sink({ command: "seed" }));

  program
    .command("show")
    .description("show one decision and its accepted history")
    .argument("<id>", "decision id", decisionId)
    .action((id: string) => sink({ command: "show", id }));

  program.command("export").description("print the raw event log for piping").action(() => sink({ command: "export" }));

  program
    .command("reviewed")
    .description("record that Greg reviewed a decision")
    .argument("<id>", "decision id", decisionId)
    .requiredOption("--by <actor>", "who records it: greg or overseer", actor)
    .option("--note <text>", "optional review note")
    .action((id: string, opts: { by: DecisionActor; note?: string }) =>
      sink({ command: "reviewed", id, by: opts.by, note: opts.note ?? null }),
    );

  program
    .command("reversed")
    .description("record that Greg reversed a decision")
    .argument("<id>", "decision id", decisionId)
    .requiredOption("--by <actor>", "who records it: greg or overseer", actor)
    .option("--why <text>", "optional reason for reversal")
    .action((id: string, opts: { by: DecisionActor; why?: string }) =>
      sink({ command: "reversed", id, by: opts.by, why: opts.why ?? null }),
    );

  // Commander copies parser/output settings when a child is created. Restore
  // help and exit overrides after the complete tree exists, as overseer.ts does.
  for (const command of program.commands) {
    command.helpOption("-h, --help", "what this command takes");
    command.exitOverride();
  }
  return program;
}

export type ParseOutcome =
  | { kind: "run"; parsed: Parsed }
  | { kind: "help"; text: string }
  | { kind: "error"; why: string };

export function parseArgv(argv: readonly string[]): ParseOutcome {
  let parsed: Parsed | undefined;
  const program = buildProgram((value) => {
    parsed = value;
  });
  let out = "";
  let err = "";
  const capture = {
    writeOut: (text: string) => {
      out += text;
    },
    writeErr: (text: string) => {
      err += text;
    },
  };
  program.configureOutput(capture);
  for (const command of program.commands) command.configureOutput(capture);
  try {
    program.parse([...argv], { from: "user" });
  } catch (cause) {
    const commander = cause as { exitCode?: number };
    if (commander.exitCode === 0) return { kind: "help", text: out.trimEnd() };
    return {
      kind: "error",
      why: err.trim() || (cause instanceof Error ? cause.message : String(cause)),
    };
  }
  if (parsed === undefined) return { kind: "error", why: "no command was given; use --help" };
  return { kind: "run", parsed };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type AddInput = {
  class: DecisionClass;
  question: string;
  options: readonly DecisionOption[];
  chose: { readonly option: string; readonly note: string | null };
  why: string;
  advisers: readonly Adviser[];
  sessionNames: readonly string[];
  plan: string | null;
  supersedes: string | null;
  consequence: Consequence;
  reversibility: Reversibility;
  domain: DecisionDomain;
  recommendation: string | null;
  /** As the author wrote them; checking is this command's job, at write time. */
  evidence: readonly ArtefactRef[];
  gregAsked: GregAsked;
  confidence: Confidence | null;
};

/** `--by` is who decided, on this command. The drain is the only way a session's decision arrives. */
function authorFor(by: DecisionActor): DecisionAuthor {
  return by === "greg" ? { kind: "greg" } : { kind: "overseer" };
}

function parseEvidenceSpecs(value: unknown): ArtefactRef[] {
  if (!Array.isArray(value)) {
    throw new Error("evidence must be a list of commit:<sha>, path:<path>, decision:<dec-id> or queue:<qi-id>");
  }
  return value.map((spec, index) => {
    if (typeof spec !== "string") throw new Error(`evidence[${index}] must be text such as commit:<sha>`);
    const parsed = parseArtefactSpec(spec);
    if (!parsed.ok) throw new Error(`evidence[${index}] '${spec}': ${parsed.why}`);
    return parsed.ref;
  });
}

/**
 * What this command can honestly say about each reference: a decision is
 * looked up in the record it is about to write to; a commit, path or queue
 * item is stated unchecked, with why, rather than guessed at.
 */
function checkEvidence(refs: readonly ArtefactRef[], view: DecisionView | null): CheckedArtefact[] {
  return refs.map((ref): CheckedArtefact => {
    if (ref.kind !== "decision") {
      return {
        ref,
        check: { state: "unchecked", why: "overseer-decisions add does not check commits, paths or queue items" },
      };
    }
    if (view === null) return { ref, check: { state: "unchecked", why: "the decision record could not be read" } };
    return { ref, check: view.records.some((record) => record.id === ref.id) ? { state: "found" } : { state: "not-found" } };
  });
}

/** Full-line comments are the only extension the generated template needs. */
function stripTemplateComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

/**
 * Validate an add input by forming the real event and passing it through the
 * record's one strict parser. The CLI input differs in one deliberate place:
 * sessions are names, because their execution tokens are facts this command
 * resolves rather than values a caller is allowed to assert.
 */
function parseAddInput(text: string, by: DecisionActor): AddInput {
  let value: unknown;
  try {
    value = JSON.parse(stripTemplateComments(text));
  } catch (cause) {
    throw new Error(`the decision input is not JSON: ${String(cause)}`);
  }
  if (!isRecord(value) || !isRecord(value["bearsOn"])) throw new Error("the decision input needs a bearsOn object");
  if ("author" in value) {
    throw new Error(
      "the decision input may not name an author: --by says who decided (overseer or greg), and a session's " +
        "decision arrives only through the report drain",
    );
  }
  /* **EVERY MISSING FIELD, BY NAME, AND NONE DEFAULTED.** A V1-shaped file is
     the likeliest mistake — an Overseer with an old habit — and a default
     consequence would rank the decision by a guess. */
  const missing = INPUT_ASSESSMENT_FIELDS.filter((field) => !(field in value));
  if (missing.length > 0) {
    throw new Error(
      `the decision input is missing ${missing.join(", ")} — schema 2 requires every one; compare it with \`template\``,
    );
  }
  const rawSessions = value["bearsOn"]["sessions"];
  if (!Array.isArray(rawSessions) || rawSessions.some((name) => typeof name !== "string")) {
    throw new Error("bearsOn.sessions must be an array of session names");
  }
  const sessionNames = rawSessions as string[];
  const evidence = parseEvidenceSpecs(value["evidence"]);
  const provisional: unknown = {
    ...envelope(by, { at: "2026-09-09T00:00:00.000Z" }),
    kind: "decided",
    id: "dec-22222222",
    decidedAt: "2026-09-09T00:00:00.000Z",
    class: value["class"],
    question: value["question"],
    options: value["options"],
    chose: value["chose"],
    why: value["why"],
    advisers: value["advisers"],
    bearsOn: {
      sessions: sessionNames.map((name) => ({
        name,
        execution: { kind: "unavailable", why: "provisional CLI validation" },
      })),
      plan: value["bearsOn"]["plan"],
    },
    supersedes: value["supersedes"],
    author: authorFor(by),
    consequence: value["consequence"],
    reversibility: value["reversibility"],
    domain: value["domain"],
    recommendation: value["recommendation"],
    evidence: evidence.map((ref) => ({ ref, check: { state: "not-found" } })),
    gregAsked: value["gregAsked"],
    confidence: value["confidence"],
  };
  const checked = parseEventDetailed(JSON.stringify(provisional));
  if (!checked.ok) throw new Error(`the decision input is invalid: ${checked.why}; compare it with \`template\``);
  const event = checked.event;
  if (event.kind !== "decided" || event.schema !== DECISIONS_SCHEMA) {
    throw new Error("the decision input did not form a schema-2 decision; compare it with `template`");
  }
  return {
    class: event.class,
    question: event.question,
    options: event.options,
    chose: event.chose,
    why: event.why,
    advisers: event.advisers,
    sessionNames,
    plan: event.bearsOn.plan,
    supersedes: event.supersedes,
    consequence: event.consequence,
    reversibility: event.reversibility,
    domain: event.domain,
    recommendation: event.recommendation,
    evidence,
    gregAsked: event.gregAsked,
    confidence: event.confidence,
  };
}

function checkpointInput(env: NodeJS.ProcessEnv): DecisionCheckpointInput {
  try {
    const read = readCheckpoint(storeRoot(env));
    if (read.kind === "absent") return { kind: "absent" };
    if (read.kind === "unusable") {
      return { kind: "unreadable", why: `${read.why}: ${read.detail}` };
    }
    return { kind: "json", json: read.checkpoint };
  } catch (cause) {
    // A bad store setting or unreadable checkpoint is an unavailable identity
    // source, not permission to invent one and not a reason to lose the record.
    return { kind: "unreadable", why: `the checkpoint could not be read: ${String(cause)}` };
  }
}

function resolveSessions(names: readonly string[], env: NodeJS.ProcessEnv): SessionRef[] {
  const checkpoint = projectDecisionCheckpoint(checkpointInput(env));
  const freshness = checkpoint.kind === "current" ? { kind: "current" } as const : checkpoint;
  const register = checkpoint.kind === "current" ? checkpoint.register : [];
  return names.map((name) => {
    const execution = executionRefFor(name, register, freshness);
    if (execution.kind === "unavailable" && /ambiguous/i.test(execution.why)) {
      console.log(`${execution.why}; stored execution unavailable`);
    }
    return { name, execution };
  });
}

function historicalSeedFields() {
  return {
    kind: "decided" as const,
    id: HISTORICAL_SEED_ID,
    decidedAt: HISTORICAL_SEED_DECIDED_AT,
    class: "decision" as const,
    question:
      "`claude-agents-dashboard` asked whether to continue its mechanical Stage 6 (catalogue → `wire.ts`) with Stage 5 blocked on the SessionDetail re-layout.",
    options: [
      {
        name: "Stop now and leave Stage 6 to a later session",
        tradeoffs: "Costs a fresh session's context to pick it up later.",
      },
      {
        name: "Continue as it was",
        tradeoffs: "A Claude session writing mechanical code against a 76% weekly window.",
      },
      {
        name: "Continue with Codex implementing",
        tradeoffs: "Bills the ChatGPT window at 24%.",
      },
    ],
    chose: {
      option: "Continue with Codex implementing",
      note: "Terra, mechanical; then debrief and stop.",
    },
    why:
      "The work is specified and mechanical, the session holds the context, and Greg's standing answer this morning is to delegate implementation to GPT.",
    advisers: ["nobody"] as const,
    bearsOn: {
      sessions: [
        {
          name: "claude-agents-dashboard",
          execution: { kind: "unavailable" as const, why: "seeded from the hand-kept log" },
        },
      ],
      plan: null,
    },
    supersedes: null,
  };
}

function sameHistoricalSeed(event: DecisionEvent): boolean {
  // Schema is ignored below on purpose: the seed is a V1 decision at either.
  if (event.kind !== "decided") return false;
  const expected = historicalSeedFields();
  return JSON.stringify({ ...event, schema: undefined, eventId: undefined, commandId: undefined, at: undefined, by: undefined }) ===
    JSON.stringify({ ...expected, schema: undefined, eventId: undefined, commandId: undefined, at: undefined, by: undefined });
}

function existingSeed(root: string): DecidedEvent | null {
  let text: string;
  try {
    text = readFileSync(path.join(root, DECISIONS_FILE), "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const event = parseEvent(line);
    if (event?.commandId !== HISTORICAL_SEED_COMMAND_ID) continue;
    if (!sameHistoricalSeed(event) || event.kind !== "decided" || event.by !== "overseer") {
      throw new Error(`command id ${HISTORICAL_SEED_COMMAND_ID} is already used by a different event`);
    }
    return event;
  }
  return null;
}

/**
 * The decision already written under this command id, or null.
 *
 * Reads the raw lines rather than the folded view on purpose: a retry must be
 * recognised even when the record is one the fold rejected, because writing a
 * SECOND copy of a decision behind an existing problem is the worst available
 * outcome. An unparseable line simply is not a match.
 */
/**
 * The author's input, and nothing the machine supplied.
 *
 * This is what two runs of the same command have in common. The decision id is
 * minted per run, `decidedAt` is stamped per run, and every session's
 * `execution` is re-resolved against a register that has moved — so comparing
 * whole events would call every honest retry a conflict, which is the mistake
 * that put this check in the CLI in the first place.
 */
type Authored = {
  by: DecisionRecorder;
  class: DecisionClass;
  question: string;
  options: readonly DecisionOption[];
  chose: { readonly option: string; readonly note: string | null };
  why: string;
  advisers: readonly Adviser[];
  supersedes: string | null;
  plan: string | null;
  sessions: readonly string[];
  /** Schema 2's author-supplied fields, or null for a V1 line — which no schema-2 input can equal. */
  assessment: {
    author: string;
    consequence: Consequence;
    reversibility: Reversibility;
    domain: DecisionDomain;
    recommendation: string | null;
    /** The references as written; the checks are machine-supplied and move between runs. */
    evidence: readonly string[];
    gregAsked: GregAsked;
    confidence: Confidence | null;
  } | null;
};

function authorKey(author: DecisionAuthor): string {
  return author.kind === "session" ? `session:${author.name}` : author.kind;
}

/** One spelling, so both callers compare the same keys in the same order. */
function spellAuthored(fields: Authored): string {
  return JSON.stringify({
    /* **`by` IS PART OF THE COMMAND, not of the machinery.** It is a
       self-declaration the whole record rests on, so the same words filed by a
       different actor is a different command rather than a retry. Leaving it
       out also made this disagree with the fold, whose `commandPayload`
       includes it — two layers with different rules for one key, which is the
       original bug one level down. GPT Sol, reviewing the first fix. */
    by: fields.by,
    class: fields.class,
    question: fields.question,
    options: fields.options,
    chose: fields.chose,
    why: fields.why,
    advisers: fields.advisers,
    supersedes: fields.supersedes,
    plan: fields.plan,
    sessions: fields.sessions,
    assessment:
      fields.assessment === null
        ? null
        : {
            author: fields.assessment.author,
            consequence: fields.assessment.consequence,
            reversibility: fields.assessment.reversibility,
            domain: fields.assessment.domain,
            recommendation: fields.assessment.recommendation,
            evidence: fields.assessment.evidence,
            gregAsked: fields.assessment.gregAsked,
            confidence: fields.assessment.confidence,
          },
  });
}

function authoredContent(event: DecidedEvent): string {
  return spellAuthored({
    by: event.by,
    class: event.class,
    question: event.question,
    options: event.options,
    chose: event.chose,
    why: event.why,
    advisers: event.advisers,
    supersedes: event.supersedes,
    plan: event.bearsOn.plan,
    sessions: event.bearsOn.sessions.map((session) => session.name),
    assessment:
      event.schema === LEGACY_DECISIONS_SCHEMA
        ? null
        : {
            author: authorKey(event.author),
            consequence: event.consequence,
            reversibility: event.reversibility,
            domain: event.domain,
            recommendation: event.recommendation,
            evidence: event.evidence.map((item) => spellArtefactRef(item.ref)),
            gregAsked: event.gregAsked,
            confidence: event.confidence,
          },
  });
}

function authoredInput(input: AddInput, by: DecisionActor): string {
  return spellAuthored({
    by,
    class: input.class,
    question: input.question,
    options: input.options,
    chose: input.chose,
    why: input.why,
    advisers: input.advisers,
    supersedes: input.supersedes,
    plan: input.plan,
    sessions: input.sessionNames,
    assessment: {
      author: authorKey(authorFor(by)),
      consequence: input.consequence,
      reversibility: input.reversibility,
      domain: input.domain,
      recommendation: input.recommendation,
      evidence: input.evidence.map(spellArtefactRef),
      gregAsked: input.gregAsked,
      confidence: input.confidence,
    },
  });
}

function existingDecisionFor(commandId: string, root: string): DecidedEvent | null {
  let text: string;
  try {
    text = readFileSync(path.join(root, DECISIONS_FILE), "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const event = parseEvent(line);
    if (event === null || event.commandId !== commandId) continue;
    if (event.kind !== "decided") {
      throw new Error(`command id ${commandId} is already used by a ${event.kind} event`);
    }
    return event;
  }
  return null;
}

function seedEvent(root: string): DecidedEvent {
  const existing = existingSeed(root);
  if (existing !== null) {
    return { ...existing, eventId: envelope("overseer").eventId };
  }
  /* **THE ONE NEW LINE WRITTEN AT SCHEMA 1, ON PURPOSE.** The seed is a V1
     decision copied from the hand-kept log: nobody recorded its consequence,
     reversibility or who decided it, and stamping schema 2 would mean
     inventing all of them. At schema 1 it folds as `legacy-unrecorded`, which
     is the truth, and matches the copy already in any live record. */
  return {
    ...envelope("overseer", { commandId: HISTORICAL_SEED_COMMAND_ID }),
    schema: LEGACY_DECISIONS_SCHEMA,
    ...historicalSeedFields(),
  };
}

function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function sessionStateText(state: ProjectedSessionState): string {
  if (state.kind !== "unavailable") return state.kind;
  if (state.why.kind === "checkpoint-unavailable") return "unavailable (checkpoint unavailable)";
  return `unavailable (${state.why.detail})`;
}

function authorText(author: DecisionRecord["author"]): string {
  switch (author.kind) {
    case "session":
      return `${author.name} (session)`;
    case "overseer":
      return "the Overseer";
    case "greg":
      return "Greg";
    case "legacy-unrecorded":
      return "author not recorded";
    default: {
      const never: never = author;
      return never;
    }
  }
}

function notRecorded(value: string): string {
  return value === NOT_RECORDED ? "not recorded" : value;
}

/** The author's claim about Greg, in the same words the dashboard uses. */
function gregAskedText(value: DecisionRecord["gregAsked"]): string {
  switch (value) {
    case "no":
      return "the author says Greg was not asked";
    case "asked-answered":
      return "the author says Greg answered";
    case "asked-awaiting":
      return "the author says Greg has been asked and has not answered";
    case "not-recorded":
      return "not recorded";
    default: {
      const never: never = value;
      return never;
    }
  }
}

function evidenceText(evidence: DecisionRecord["evidence"]): string {
  if (evidence.kind === "not-recorded") return "not recorded";
  if (evidence.value.length === 0) return "none given";
  return evidence.value.map((item) => `${spellArtefactRef(item.ref)} (${describeArtefactCheck(item.check)})`).join("; ");
}

function printDecision(item: ProjectedDecision): void {
  const { record } = item;
  const reviewState = record.reviewed ? "REVIEWED" : record.supersededBy === null ? "UNREVIEWED" : "SUPERSEDED";
  console.log(`${reviewState}  ${record.id}  ${record.class}  ${formatAge(item.ageMs)} old`);
  console.log(record.question);
  for (const option of record.options) console.log(`  ${option.name}: ${option.tradeoffs}`);
  console.log(`Chose: ${record.chose.option}${record.chose.note === null ? "" : ` — ${record.chose.note}`}`);
  console.log(`Why: ${record.why}`);
  console.log(
    `Decided by: ${authorText(record.author)} · recorded by ${record.recordedBy === "daemon" ? "the report drain" : record.recordedBy}`,
  );
  console.log(
    `Consequence: ${notRecorded(record.consequence)} · reversibility: ${notRecorded(record.reversibility)} · ` +
      `domain: ${notRecorded(record.domain)}`,
  );
  console.log(
    `Recommendation: ${record.recommendation.kind === "not-recorded" ? "not recorded" : (record.recommendation.value ?? "none given")}`,
  );
  console.log(`Greg asked: ${gregAskedText(record.gregAsked)}`);
  console.log(`Confidence: ${record.confidence === null ? "none given" : notRecorded(record.confidence)}`);
  console.log(`Evidence: ${evidenceText(record.evidence)}`);
  console.log(`Advised by: ${record.advisers.join(", ")}`);
  if (record.bearsOn.plan !== null) console.log(`Plan: ${record.bearsOn.plan}`);
  if (item.sessions.length > 0) {
    console.log(`Sessions: ${item.sessions.map((session) => `${session.name} — ${sessionStateText(session.state)}`).join("; ")}`);
  }
  if (record.supersededBy !== null) console.log(`Superseded by: ${record.supersededBy}`);
  if (record.reversed) console.log(`Reversed${record.reversedWhy === null ? "" : `: ${record.reversedWhy}`}`);
}

function printList(projection: DecisionsProjection, records: readonly ProjectedDecision[]): void {
  console.log(`Composed at ${projection.composedAt}`);
  if (projection.checkpoint.kind === "unavailable") {
    console.log(`Session register unavailable: ${projection.checkpoint.why}`);
  }
  if (projection.aggregates.kind === "unavailable") {
    console.log(`Not-yet-reviewed count is unavailable: ${projection.aggregates.why}`);
    console.log(`Trailing seven days: counts are unavailable for the same reason.`);
  } else {
    console.log(`Not yet reviewed: ${projection.aggregates.notYetReviewed}`);
    const recent = projection.aggregates.trailingSevenDays;
    console.log(
      `Trailing seven days: ${recent.decisions} decisions, ${recent.reviews} reviews, ${recent.reversals} reversals`,
    );
  }
  if (records.length === 0) {
    console.log("No matching decisions.");
    return;
  }
  for (const item of records) printDecision(item);
}

function requireView(root: string): DecisionView {
  const read = readDecisions(root);
  const view = viewOf(read);
  if (view !== null) return view;
  throw new Error(read.kind === "unreadable" ? read.why : `could not read the decision record at ${root}`);
}

function appendOne(event: DecisionEvent, root: string): number {
  const result = appendEvents([event], { root });
  if (!result.ok) {
    console.error(`✗ ${result.why}`);
    return 1;
  }
  console.log(`${event.id}\nversion ${spellVersion(result.view.version)}`);
  return 0;
}

export function runParsed(
  parsed: Parsed,
  env: NodeJS.ProcessEnv = process.env,
  readStdin: () => string = () => readFileSync(0, "utf8"),
): number {
  const root = decisionsRoot(env);
  switch (parsed.command) {
    case "template":
      console.log(TEMPLATE);
      return 0;
    case "add": {
      const text = parsed.file === "-" ? readStdin() : readFileSync(path.resolve(parsed.file), "utf8");
      const input = parseAddInput(text, parsed.by);
      /* **READ BEFORE WRITING, BECAUSE DETERMINISM CANNOT DELIVER THE RETRY.**
         A command id promises that running the same command twice writes once.
         The fold keeps that promise by comparing payloads — but everything this
         command generates moves between runs: a freshly minted decision id, a
         later `decidedAt`, and session executions re-resolved against a register
         that has changed. So an honest retry would read as a conflict, and the
         arm the key exists for would be unreachable.

         The check is therefore here, where the intent is known, and the fold's
         comparison stays as the safety net for writers this file knows nothing
         about.

         **BOTH HALVES, AND THE SECOND ONE WAS DROPPED ONCE.** Recognising the
         retry is only half of what the key promises; refusing a DIFFERENT
         command under the same key is the other, and a version of this that
         compared ids alone exited 0 and printed the earlier decision's id while
         silently discarding a new one. What is compared is the author's input
         (`authoredContent`), because that is the part two runs of one command
         share.

         The gap between reading and appending is not a hole: a racing writer
         trips the fold's own conflict under the lock, which fails safely rather
         than duplicating a decision. (It does not lose a version check — this
         command passes no `expect`; saying otherwise would claim a guard that is
         not there.) */
      if (parsed.commandId !== null) {
        const already = existingDecisionFor(parsed.commandId, root);
        if (already !== null) {
          if (authoredContent(already) !== authoredInput(input, parsed.by)) {
            console.error(
              `✗ command id ${parsed.commandId} already recorded a different decision (${already.id}); ` +
                "nothing was written. Use a new command id, or supersede that decision.",
            );
            return 1;
          }
          console.log(already.id);
          console.log(`already recorded under command id ${parsed.commandId}; nothing was written`);
          return 0;
        }
      }
      const bearsOn: BearsOn = { sessions: resolveSessions(input.sessionNames, env), plan: input.plan };
      const eventEnvelope = envelope(parsed.by, { commandId: parsed.commandId });
      const event: DecidedV2Event = {
        ...eventEnvelope,
        kind: "decided",
        id: mintId(),
        decidedAt: eventEnvelope.at,
        class: input.class,
        question: input.question,
        options: input.options,
        chose: input.chose,
        why: input.why,
        advisers: input.advisers,
        bearsOn,
        supersedes: input.supersedes,
        author: authorFor(parsed.by),
        consequence: input.consequence,
        reversibility: input.reversibility,
        domain: input.domain,
        recommendation: input.recommendation,
        evidence: checkEvidence(input.evidence, viewOf(readDecisions(root))),
        gregAsked: input.gregAsked,
        confidence: input.confidence,
      };
      return appendOne(event, root);
    }
    case "list": {
      const projection = projectDecisions(requireView(root), checkpointInput(env));
      const authorMatches = (author: DecisionRecord["author"], wanted: ListAuthor): boolean =>
        wanted === "legacy" ? author.kind === "legacy-unrecorded" : author.kind === wanted;
      const records = projection.records.filter(
        (item) =>
          (parsed.class === null || item.record.class === parsed.class) &&
          (!parsed.unreviewed || isPendingReview(item.record)) &&
          (parsed.domain === null || item.record.domain === parsed.domain) &&
          (parsed.consequence === null || item.record.consequence === parsed.consequence) &&
          (parsed.author === null || authorMatches(item.record.author, parsed.author)) &&
          (parsed.search === null || decisionMatchesSearch(item.record, parsed.search)),
      );
      if (parsed.json) {
        console.log(JSON.stringify({ ...projection, records }, null, 2));
      } else {
        printList(projection, records);
      }
      return 0;
    }
    case "seed":
      return appendOne(seedEvent(root), root);
    case "show": {
      const record = requireView(root).records.find((candidate) => candidate.id === parsed.id);
      if (record === undefined) {
        console.error(`✗ no decision ${parsed.id}`);
        return 1;
      }
      console.log(JSON.stringify(record, null, 2));
      return 0;
    }
    case "export": {
      const read = readDecisions(root);
      if (read.kind === "unreadable") throw new Error(read.why);
      if (read.kind === "never-written") return 0;
      console.log(readFileSync(path.join(root, DECISIONS_FILE), "utf8").trimEnd());
      return 0;
    }
    case "reviewed":
      return appendOne(
        { ...envelope(parsed.by), kind: "reviewed", id: parsed.id, note: parsed.note },
        root,
      );
    case "reversed":
      return appendOne(
        { ...envelope(parsed.by), kind: "reversed", id: parsed.id, why: parsed.why },
        root,
      );
    default: {
      const never: never = parsed;
      throw new Error(`unhandled command ${JSON.stringify(never)}`);
    }
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const outcome = parseArgv(argv);
  if (outcome.kind === "help") {
    console.log(outcome.text);
    return 0;
  }
  if (outcome.kind === "error") {
    console.error(outcome.why);
    return 1;
  }
  try {
    return runParsed(outcome.parsed);
  } catch (cause) {
    console.error(`✗ ${cause instanceof Error ? cause.message : String(cause)}`);
    return 1;
  }
}

function isMain(): boolean {
  const invoked = process.argv[1];
  return invoked !== undefined && invoked === fileURLToPath(import.meta.url);
}

if (isMain()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((cause: unknown) => {
      console.error(`✗ ${cause instanceof Error ? cause.message : String(cause)}`);
      process.exitCode = 1;
    });
}
